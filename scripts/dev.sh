#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
backend_env_file="$root_dir/.local-db/backend.env"
startup_timeout="${PLIEGO_DEV_STARTUP_TIMEOUT:-180}"

if [[ -n "${XDG_STATE_HOME:-}" ]]; then
  state_home="$XDG_STATE_HOME"
elif [[ -n "${HOME:-}" ]]; then
  state_home="$HOME/.local/state"
else
  printf 'Set HOME or XDG_STATE_HOME before running this script.\n' >&2
  exit 2
fi

state_dir="${state_home%/}/pliego/dev-stack"
backend_pid_file="$state_dir/backend.pid"
frontend_pid_file="$state_dir/frontend.pid"
backend_log="$state_dir/backend.log"
frontend_log="$state_dir/frontend.log"
backend_url="http://127.0.0.1:8080"
frontend_url="http://127.0.0.1:5173"
local_db_mode=0
active_pid=""
active_pgid=""

umask 077
mkdir -p "$state_dir"
chmod 700 "$state_dir"

if [[ ! "$startup_timeout" =~ ^[0-9]+$ ]] || ((startup_timeout < 1)); then
  printf 'PLIEGO_DEV_STARTUP_TIMEOUT must be a positive number of seconds.\n' >&2
  exit 2
fi

case "${PLIEGO_USE_LOCAL_DB:-auto}" in
  auto)
    if [[ -f "$backend_env_file" ]]; then local_db_mode=1; fi
    ;;
  1|true|yes) local_db_mode=1 ;;
  0|false|no) local_db_mode=0 ;;
  *)
    printf 'PLIEGO_USE_LOCAL_DB must be auto, 1, or 0.\n' >&2
    exit 2
    ;;
esac

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$1" >&2
    exit 2
  fi
}

require_command curl
require_command flock
require_command mvn
require_command npm
if [[ "$local_db_mode" == 1 || -z "${PLIEGO_JWT_SECRET:-}" ]]; then require_command openssl; fi
require_command ps
require_command setsid
require_command tail
require_command tr

backend_healthy() {
  local document
  document="$(curl --silent --show-error --fail --max-time 3 "$backend_url/v3/api-docs" 2>/dev/null)" || return 1
  [[ "$document" == *'"title":"PLIEGO API"'* ]]
}

frontend_healthy() {
  local page
  page="$(curl --silent --show-error --fail --max-time 3 "$frontend_url/" 2>/dev/null)" || return 1
  [[ "$page" == *'<div id="root"></div>'* ]]
}

port_open() {
  local port="$1"
  (exec 3<>"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1
}

pid_file_for() {
  case "$1" in
    backend) printf '%s\n' "$backend_pid_file" ;;
    frontend) printf '%s\n' "$frontend_pid_file" ;;
    *) return 2 ;;
  esac
}

process_matches_service() {
  local service="$1"
  local pid="$2"
  local args
  [[ -r "/proc/$pid/cmdline" ]] || return 1
  args="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  case "$service" in
    backend) [[ "$args" == *"spring-boot:run"* ]] ;;
    frontend) [[ "$args" == *"run dev -- --host 127.0.0.1"* || "$args" == *"vite --host"* ]] ;;
    *) return 2 ;;
  esac
}

load_managed_process() {
  local service="$1"
  local pid_file
  pid_file="$(pid_file_for "$service")" || return 2
  [[ -f "$pid_file" ]] || return 1
  read -r active_pid active_pgid < "$pid_file" || return 1
  [[ "$active_pid" =~ ^[0-9]+$ && "$active_pgid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$active_pid" 2>/dev/null || return 1
  process_matches_service "$service" "$active_pid"
}

wait_until_ready() {
  local service="$1"
  local pid="$2"
  local probe
  case "$service" in
    backend) probe=backend_healthy ;;
    frontend) probe=frontend_healthy ;;
    *) return 2 ;;
  esac

  local elapsed=0
  while ((elapsed < startup_timeout)); do
    if "$probe"; then
      printf '%s is ready at %s.\n' "$service" "$([[ "$service" == backend ]] && printf '%s' "$backend_url" || printf '%s' "$frontend_url")"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      return 1
    fi
    sleep 1
    ((elapsed += 1))
  done
  return 1
}

write_pid_file() {
  local service="$1"
  local pid="$2"
  local pid_file
  local pgid=""
  pid_file="$(pid_file_for "$service")" || return 2

  for _ in {1..20}; do
    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
    [[ "$pgid" == "$pid" ]] && break
    sleep 0.05
  done
  if [[ "$pgid" != "$pid" ]]; then
    printf 'Could not isolate the %s process group; its log is %s.\n' "$service" "$state_dir/$service.log" >&2
    kill -TERM "$pid" 2>/dev/null || true
    return 1
  fi

  printf '%s %s\n' "$pid" "$pgid" > "$pid_file"
  chmod 600 "$pid_file"
}

start_backend() {
  local managed
  local pid_file="$backend_pid_file"

  if backend_healthy; then
    printf 'Backend is already ready at %s.\n' "$backend_url"
    return 0
  fi

  if managed="$(load_managed_process backend && printf '%s %s' "$active_pid" "$active_pgid")"; then
    read -r active_pid active_pgid <<< "$managed"
    printf 'Waiting for the existing backend process (pid %s).\n' "$active_pid"
    if wait_until_ready backend "$active_pid"; then return 0; fi
    printf 'Backend did not become ready. See %s.\n' "$backend_log" >&2
    return 1
  fi
  rm -f "$pid_file"

  if port_open 8080; then
    printf 'Port 8080 is occupied by a service that is not the PLIEGO API.\n' >&2
    return 1
  fi

  if [[ "$local_db_mode" == 0 ]]; then
    local missing=()
    for variable in PLIEGO_DB_PASSWORD PLIEGO_ADMIN_EMAIL PLIEGO_ADMIN_PASSWORD_HASH; do
      if [[ -z "${!variable:-}" ]]; then missing+=("$variable"); fi
    done
    if ((${#missing[@]} > 0)); then
      printf 'Missing backend environment variables: %s\n' "${missing[*]}" >&2
      printf 'Export them or use the private local database with PLIEGO_USE_LOCAL_DB=1.\n' >&2
      return 2
    fi
  fi

  touch "$backend_log"
  chmod 600 "$backend_log"
  nohup setsid bash -c '
    set -Eeuo pipefail
    repo_root="$1"
    env_file="$2"
    if [[ -n "$env_file" ]]; then
      set -a
      source "$env_file"
      set +a
    fi
    exec "$repo_root/scripts/start-backend.sh"
  ' pliego-backend "$root_dir" "$([[ "$local_db_mode" == 1 ]] && printf '%s' "$backend_env_file")" \
    >> "$backend_log" 2>&1 </dev/null 9>&- &
  active_pid=$!
  write_pid_file backend "$active_pid"
  if ! wait_until_ready backend "$active_pid"; then
    kill -0 "$active_pid" 2>/dev/null || rm -f "$pid_file"
    printf 'Backend did not become ready. See %s.\n' "$backend_log" >&2
    return 1
  fi
}

start_frontend() {
  local managed
  local pid_file="$frontend_pid_file"

  if frontend_healthy; then
    printf 'Frontend is already ready at %s.\n' "$frontend_url"
    return 0
  fi

  if managed="$(load_managed_process frontend && printf '%s %s' "$active_pid" "$active_pgid")"; then
    read -r active_pid active_pgid <<< "$managed"
    printf 'Waiting for the existing frontend process (pid %s).\n' "$active_pid"
    if wait_until_ready frontend "$active_pid"; then return 0; fi
    printf 'Frontend did not become ready. See %s.\n' "$frontend_log" >&2
    return 1
  fi
  rm -f "$pid_file"

  if port_open 5173; then
    printf 'Port 5173 is occupied by a service that is not the PLIEGO frontend.\n' >&2
    return 1
  fi
  if [[ ! -d "$root_dir/frontend/node_modules" ]]; then
    printf 'Frontend dependencies are missing. Run npm ci in %s/frontend first.\n' "$root_dir" >&2
    return 2
  fi

  touch "$frontend_log"
  chmod 600 "$frontend_log"
  nohup setsid bash -c '
    set -Eeuo pipefail
    cd "$1/frontend"
    exec npm run dev -- --host 127.0.0.1
  ' pliego-frontend "$root_dir" >> "$frontend_log" 2>&1 </dev/null 9>&- &
  active_pid=$!
  write_pid_file frontend "$active_pid"
  if ! wait_until_ready frontend "$active_pid"; then
    kill -0 "$active_pid" 2>/dev/null || rm -f "$pid_file"
    printf 'Frontend did not become ready. See %s.\n' "$frontend_log" >&2
    return 1
  fi
}

ensure_local_database() {
  [[ "$local_db_mode" == 1 ]] || return 0
  if backend_healthy; then
    "$root_dir/scripts/local-db.sh" start 9>&-
  else
    "$root_dir/scripts/local-db.sh" migrate 9>&-
  fi
}

start_stack() {
  ensure_local_database
  start_backend
  start_frontend
  printf 'PLIEGO is ready: %s (web) and %s (API).\n' "$frontend_url" "$backend_url"
  printf 'Run "%s status" to inspect or "%s logs" to follow service logs.\n' "$root_dir/scripts/dev.sh" "$root_dir/scripts/dev.sh"
}

stop_service() {
  local service="$1"
  local pid_file
  pid_file="$(pid_file_for "$service")" || return 2
  if ! load_managed_process "$service"; then
    rm -f "$pid_file"
    printf '%s is not managed by this script; leaving it alone.\n' "$service"
    return 0
  fi

  printf 'Stopping %s (pid %s).\n' "$service" "$active_pid"
  kill -TERM -- "-$active_pgid" 2>/dev/null || true
  local elapsed=0
  while ((elapsed < 10)) && kill -0 -- "-$active_pgid" 2>/dev/null; do
    sleep 1
    ((elapsed += 1))
  done
  if kill -0 -- "-$active_pgid" 2>/dev/null; then
    kill -KILL -- "-$active_pgid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

stop_stack() {
  stop_service frontend
  stop_service backend
  if [[ "$local_db_mode" == 1 ]]; then
    printf 'Local PostgreSQL stays running; stop it separately with scripts/local-db.sh stop.\n'
  fi
}

show_service_status() {
  local service="$1"
  local url="$2"
  local probe="$3"
  local managed
  if "$probe"; then
    if managed="$(load_managed_process "$service" && printf '%s' "$active_pid")"; then
      printf '%s ready at %s (managed, pid %s).\n' "$service" "$url" "$managed"
    else
      printf '%s ready at %s (not managed by this script).\n' "$service" "$url"
    fi
  elif managed="$(load_managed_process "$service" && printf '%s' "$active_pid")"; then
    printf '%s is starting (pid %s).\n' "$service" "$managed"
  else
    printf '%s is stopped.\n' "$service"
  fi
}

show_status() {
  show_service_status backend "$backend_url" backend_healthy
  show_service_status frontend "$frontend_url" frontend_healthy
  if [[ "$local_db_mode" == 1 ]]; then
    "$root_dir/scripts/local-db.sh" status
  else
    printf 'Using externally configured PostgreSQL.\n'
  fi
}

show_logs() {
  local service="${1:-all}"
  case "$service" in
    backend) [[ -f "$backend_log" ]] || { printf 'No backend log exists yet.\n' >&2; return 1; }; tail -n 80 -f "$backend_log" ;;
    frontend) [[ -f "$frontend_log" ]] || { printf 'No frontend log exists yet.\n' >&2; return 1; }; tail -n 80 -f "$frontend_log" ;;
    all)
      [[ -f "$backend_log" || -f "$frontend_log" ]] || { printf 'No service logs exist yet.\n' >&2; return 1; }
      local logs=()
      [[ -f "$backend_log" ]] && logs+=("$backend_log")
      [[ -f "$frontend_log" ]] && logs+=("$frontend_log")
      tail -n 80 -f "${logs[@]}"
      ;;
    *) printf 'Usage: %s logs [backend|frontend]\n' "$root_dir/scripts/dev.sh" >&2; return 2 ;;
  esac
}

command_name="${1:-up}"
shift || true
case "$command_name" in
  up|down|restart)
    exec 9>"$state_dir/stack.lock"
    flock -x 9
    case "$command_name" in
      up) start_stack ;;
      down) stop_stack ;;
      restart) stop_stack; start_stack ;;
    esac
    ;;
  status) show_status ;;
  logs) show_logs "${1:-all}" ;;
  help|-h|--help)
    cat <<EOF
Usage: $root_dir/scripts/dev.sh [up|down|restart|status|logs [backend|frontend]]

  up       Start PostgreSQL (if local), Flyway, backend, and Vite. Safe to repeat.
  down     Stop only backend/frontend processes started by this script.
  restart  Restart backend/frontend without deleting local database data.
  status   Show backend, frontend, and local PostgreSQL status.
  logs     Follow both private service logs, or choose one service.

If .local-db/backend.env exists, local PostgreSQL 18 is used. Set
PLIEGO_USE_LOCAL_DB=0 to use the backend environment already exported in your shell.
EOF
    ;;
  *)
    printf 'Unknown command: %s\n' "$command_name" >&2
    printf 'Run "%s help" for usage.\n' "$root_dir/scripts/dev.sh" >&2
    exit 2
    ;;
esac
