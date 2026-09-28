#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="$root_dir/.local-db"
data_dir="$state_dir/data"
socket_dir="$state_dir/socket"
env_file="$state_dir/backend.env"
pg_bin="${PLIEGO_PG18_BIN:-/usr/lib/postgresql/18/bin}"
port="${PLIEGO_LOCAL_PG_PORT:-55432}"

if [[ ! "$port" =~ ^[0-9]{1,5}$ ]] || ((port < 1 || port > 65535)); then
  printf 'PLIEGO_LOCAL_PG_PORT must be a TCP port (1–65535).\n' >&2
  exit 2
fi
for utility in initdb pg_ctl psql createdb dropdb; do
  if [[ ! -x "$pg_bin/$utility" ]]; then
    printf 'PostgreSQL 18 utility missing: %s\n' "$pg_bin/$utility" >&2
    exit 2
  fi
done

postgres() { "$pg_bin/psql" -X -h "$socket_dir" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
database() { "$pg_bin/psql" -X -h 127.0.0.1 -p "$port" -U pliego -d pliego -v ON_ERROR_STOP=1 "$@"; }
running() { [[ -f "$data_dir/PG_VERSION" ]] && "$pg_bin/pg_ctl" -D "$data_dir" status >/dev/null 2>&1; }

prepare() {
  umask 077
  mkdir -p "$state_dir" "$socket_dir"
  chmod 700 "$state_dir" "$socket_dir"
  if [[ ! -f "$data_dir/PG_VERSION" ]]; then
    "$pg_bin/initdb" -D "$data_dir" -U postgres --encoding=UTF8 --locale=C \
      --auth-local=trust --auth-host=scram-sha-256 --no-instructions >/dev/null
  fi
  if [[ ! -s "$state_dir/db-password" ]]; then
    if [[ -f "$env_file" ]]; then
      printf 'The database password file is missing; restore it or recreate the local cluster.\n' >&2
      exit 2
    fi
    openssl rand -hex 32 > "$state_dir/db-password"
  fi
  if [[ ! -s "$state_dir/jwt-secret" ]]; then
    openssl rand -hex 32 > "$state_dir/jwt-secret"
  fi
  if [[ ! -f "$env_file" ]]; then
    cat > "$env_file" <<EOF
# Generated local credentials. Keep this file outside Git.
export PGHOST=127.0.0.1
export PGPORT='$port'
export PGDATABASE=pliego
export PGUSER=pliego
export PGPASSWORD='$(cat "$state_dir/db-password")'
export PLIEGO_DB_URL='jdbc:postgresql://127.0.0.1:$port/pliego'
export PLIEGO_DB_USERNAME=pliego
export PLIEGO_DB_PASSWORD='$(cat "$state_dir/db-password")'
export PLIEGO_ADMIN_EMAIL='dev-admin@example.invalid'
# Replace this before the first migration to enable local ADMIN sign-in.
export PLIEGO_ADMIN_PASSWORD_HASH='dev-placeholder-not-usable'
export PLIEGO_JWT_SECRET='$(cat "$state_dir/jwt-secret")'
export PLIEGO_CORS_ALLOWED_ORIGINS='http://127.0.0.1:5173'
EOF
    chmod 600 "$env_file"
  else
    local configured_port
    configured_port="$(sed -n "s/^export PGPORT='\([0-9]*\)'$/\1/p" "$env_file")"
    if [[ "$configured_port" != "$port" ]]; then
      printf 'Existing local configuration uses port %s; set PLIEGO_LOCAL_PG_PORT to match.\n' "$configured_port" >&2
      exit 2
    fi
  fi
}

start() {
  prepare
  if ! running; then
    "$pg_bin/pg_ctl" -D "$data_dir" -l "$state_dir/server.log" \
      -o "-h 127.0.0.1 -p $port -k $socket_dir" start
  fi
  local version
  version="$(postgres -At -c 'SHOW server_version_num')"
  if ((version < 180000 || version >= 190000)); then
    printf 'Expected PostgreSQL 18, found version number %s.\n' "$version" >&2
    exit 2
  fi
  if [[ "$(postgres -At -c "SELECT 1 FROM pg_roles WHERE rolname = 'pliego'")" != 1 ]]; then
    postgres -v "role_password=$(cat "$state_dir/db-password")" <<'SQL' >/dev/null
CREATE ROLE pliego LOGIN PASSWORD :'role_password';
SQL
  fi
  if [[ "$(postgres -At -c "SELECT 1 FROM pg_database WHERE datname = 'pliego'")" != 1 ]]; then
    "$pg_bin/createdb" -h "$socket_dir" -p "$port" -U postgres --owner=pliego pliego
  fi
  printf 'PLIEGO PostgreSQL 18 is running on 127.0.0.1:%s.\n' "$port"
}

migrate() {
  start
  # Reuse the backend's pinned Flyway and PostgreSQL dependencies without starting HTTP.
  (cd "$root_dir/backend"; mvn --batch-mode --no-transfer-progress -q \
    dependency:build-classpath -Dmdep.outputFile="$state_dir/migration-classpath")
  (set -a; source "$env_file"; set +a; \
    java --class-path "$(cat "$state_dir/migration-classpath")" \
      "$root_dir/scripts/LocalFlyway.java" "$root_dir/backend/src/main/resources/db/migration")
  (set -a; source "$env_file"; set +a; database -At -c \
    "SELECT version FROM public.flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1")
}

case "${1:-}" in
  start) start ;;
  migrate) migrate ;;
  backend)
    start
    (set -a; source "$env_file"; set +a; exec "$root_dir/scripts/start-backend.sh")
    ;;
  recreate)
    start
    "$pg_bin/dropdb" -h "$socket_dir" -p "$port" -U postgres --if-exists --force pliego
    "$pg_bin/createdb" -h "$socket_dir" -p "$port" -U postgres --owner=pliego pliego
    migrate
    ;;
  stop)
    if running; then "$pg_bin/pg_ctl" -D "$data_dir" -m fast stop; fi
    ;;
  status)
    if running; then "$pg_bin/pg_ctl" -D "$data_dir" status; else printf 'PLIEGO PostgreSQL is stopped.\n'; fi
    ;;
  *)
    printf 'Usage: %s {start|migrate|backend|recreate|stop|status}\n' "$0" >&2
    exit 2
    ;;
esac
