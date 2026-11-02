#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$(cd "$script_dir/../../.." && pwd)"
repo_dir="$(cd "$backend_dir/.." && pwd)"
runbook="$repo_dir/docs/deployment/production-runbook.md"
database_name="${PLIEGO_CI_RUNTIME_DATABASE:-pliego_runtime_privileges_ci}"
if [[ ! "$database_name" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
    printf 'Invalid disposable runtime database name\n' >&2
    exit 2
fi
application_port="${PLIEGO_CI_RUNTIME_APP_PORT:-18081}"
application_url="http://127.0.0.1:$application_port"
admin_mode="${PLIEGO_CI_ADMIN_MODE:-postgres_socket}"

for name in PGHOST PGPORT PGPASSWORD; do
    if [[ -z "${!name:-}" ]]; then
        printf 'Required environment variable %s is not set\n' "$name" >&2
        exit 2
    fi
done
if [[ -z "${PLIEGO_DB_URL:-}" || -z "${PLIEGO_DB_USERNAME:-}" || -z "${PLIEGO_DB_PASSWORD:-}" ]]; then
    printf 'The existing CI application database settings are required by this gate\n' >&2
    exit 2
fi
if [[ ! -f "$runbook" ]]; then
    printf 'Production runbook not found: %s\n' "$runbook" >&2
    exit 2
fi

source_jar="$backend_dir/target/pliego-backend-0.1.0-SNAPSHOT.jar"
if [[ ! -f "$source_jar" ]]; then
    printf 'Build the backend jar before running this gate: %s\n' "$source_jar" >&2
    exit 2
fi
if [[ "$application_port" == "${PLIEGO_PG18_APP_PORT:-18080}" ]]; then
    printf 'The strict runtime instance port must differ from the existing CI backend port\n' >&2
    exit 2
fi

admin_psql() {
    local database="$1"
    shift
    case "$admin_mode" in
        postgres_socket)
            command -v sudo >/dev/null 2>&1 || {
                printf 'postgres_socket admin mode requires sudo\n' >&2
                return 2
            }
            sudo -n -u postgres env \
                PGHOST=/var/run/postgresql PGPORT="$PGPORT" PGUSER=postgres PGDATABASE="$database" \
                PLIEGO_CI_RUNTIME_PASSWORD="${runtime_password:-}" \
                psql -X -v ON_ERROR_STOP=1 "$@"
            ;;
        connection)
            local admin_host="${PLIEGO_CI_ADMIN_HOST:-$PGHOST}"
            local admin_port="${PLIEGO_CI_ADMIN_PORT:-$PGPORT}"
            local admin_user="${PLIEGO_CI_ADMIN_USER:-}"
            if [[ -z "$admin_user" ]]; then
                printf 'PLIEGO_CI_ADMIN_USER is required in connection admin mode\n' >&2
                return 2
            fi
            PGHOST="$admin_host" PGPORT="$admin_port" PGUSER="$admin_user" \
                PGPASSWORD="${PLIEGO_CI_ADMIN_PASSWORD:-}" PGDATABASE="$database" \
                PLIEGO_CI_RUNTIME_PASSWORD="${runtime_password:-}" \
                psql -X -v ON_ERROR_STOP=1 "$@"
            ;;
        *)
            printf 'Unsupported PLIEGO_CI_ADMIN_MODE: %s\n' "$admin_mode" >&2
            return 2
            ;;
    esac
}

umask 077
runtime_password="$(openssl rand -hex 32)"
application_jar="$(mktemp /tmp/pliego-runtime-acl.XXXXXX.jar)"
application_log="$(mktemp /tmp/pliego-runtime-acl.XXXXXX.log)"
cleanup_sql="$(mktemp /tmp/pliego-runtime-acl-cleanup.XXXXXX.sql)"
setup_sql="$(mktemp /tmp/pliego-runtime-acl-setup.XXXXXX.sql)"
cp "$source_jar" "$application_jar"

application_pid=''
safe_to_remove_ci_objects=false
cleanup() {
    local result=$?
    if [[ -n "$application_pid" ]] && kill -0 "$application_pid" 2>/dev/null; then
        kill "$application_pid" 2>/dev/null || true
        wait "$application_pid" 2>/dev/null || true
    fi
    if [[ "$safe_to_remove_ci_objects" == true ]]; then
        admin_psql postgres -c "DROP DATABASE IF EXISTS $database_name WITH (FORCE)" >/dev/null 2>&1 || true
        admin_psql postgres -c 'DROP ROLE IF EXISTS pliego_app; DROP ROLE IF EXISTS pliego_owner' >/dev/null 2>&1 || true
    fi
    rm -f "$application_jar" "$application_log" "$cleanup_sql" "$setup_sql"
    exit "$result"
}
trap cleanup EXIT

existing_state="$(admin_psql postgres -At -F: -c \
    "SELECT (SELECT count(*) FROM pg_roles WHERE rolname IN ('pliego_app','pliego_owner')),
            (SELECT count(*) FROM pg_database WHERE datname='$database_name')")"
if [[ "$existing_state" != '0:0' ]]; then
    printf 'Refusing to reuse lifecycle roles/database; expected clean state, found %s\n' "$existing_state" >&2
    exit 1
fi
safe_to_remove_ci_objects=true

python3 - "$runbook" "$cleanup_sql" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
begin = "-- BEGIN PLIEGO_RUNTIME_ACL_CLEANUP_SQL"
end = "-- END PLIEGO_RUNTIME_ACL_CLEANUP_SQL"
if source.count(begin) != 1 or source.count(end) != 1:
    raise SystemExit("Runbook cleanup SQL markers are missing or duplicated")
start = source.index(begin) + len(begin)
finish = source.index(end)
if finish < start:
    raise SystemExit("Runbook cleanup SQL end marker precedes its begin marker")
block = source[start:finish]
if not block.strip():
    raise SystemExit("Runbook cleanup SQL marker block is empty")
with Path(sys.argv[2]).open("w", newline="") as output:
    output.write(block)
PY

cat > "$setup_sql" <<'SQL'
\set ON_ERROR_STOP on
CREATE ROLE pliego_owner NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\getenv runtime_password PLIEGO_CI_RUNTIME_PASSWORD
CREATE ROLE pliego_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_password';
CREATE DATABASE :"runtime_database" OWNER pliego_owner TEMPLATE template0;
GRANT CONNECT ON DATABASE :"runtime_database" TO pliego_app;
GRANT pliego_owner TO pliego_app;
SQL
printf 'Runtime privilege CI stage: creating isolated database with restricted production-style roles\n'
admin_psql postgres -v "runtime_database=$database_name" -f - < "$setup_sql"

server_version_num="$(psql -X -v ON_ERROR_STOP=1 -At -c 'SHOW server_version_num')"
if (( server_version_num < 180000 )); then
    printf 'PostgreSQL 18 or newer is required; found server_version_num=%s\n' "$server_version_num" >&2
    exit 2
fi

jdbc_host="$PGHOST"
if [[ "$jdbc_host" == *:* && "$jdbc_host" != \[*\] ]]; then jdbc_host="[$jdbc_host]"; fi
runtime_url="jdbc:postgresql://$jdbc_host:$PGPORT/$database_name"
start_backend() {
    local phase="$1"
    printf 'Runtime privilege CI stage: starting Spring Boot as pliego_app (%s)\n' "$phase"
    PLIEGO_DB_URL="$runtime_url" PLIEGO_DB_USERNAME=pliego_app PLIEGO_DB_PASSWORD="$runtime_password" \
        PLIEGO_MAIL_ENABLED=false PLIEGO_BILLING_ENABLED=false \
        java -jar "$application_jar" "--server.port=$application_port" >"$application_log" 2>&1 &
    application_pid=$!
    for _ in $(seq 1 90); do
        if curl --noproxy '*' --fail --silent --output /dev/null "$application_url/v3/api-docs"; then
            printf 'Runtime privilege CI stage: Spring Boot ready (%s)\n' "$phase"
            return
        fi
        if ! kill -0 "$application_pid" 2>/dev/null; then break; fi
        sleep 1
    done
    printf 'Spring Boot did not become ready during %s; application log follows:\n' "$phase" >&2
    tail -n 120 "$application_log" >&2
    return 1
}
stop_backend() {
    if [[ -n "$application_pid" ]] && kill -0 "$application_pid" 2>/dev/null; then
        kill "$application_pid"
        wait "$application_pid" || true
    fi
    application_pid=''
}

start_backend migration
flyway_state="$(admin_psql "$database_name" -At -F: -c \
    'SELECT count(*), max(version)::integer FROM public.flyway_schema_history WHERE success AND version IS NOT NULL')"
if [[ "$flyway_state" != '100:100' ]]; then
    printf 'Expected Spring Boot Flyway startup as pliego_app to apply 100 migrations; found %s\n' "$flyway_state" >&2
    exit 1
fi
printf 'Runtime privilege CI stage: Spring Boot migration Flyway=%s as pliego_app\n' "$flyway_state"
stop_backend

printf 'Runtime privilege CI stage: applying cleanup SQL extracted from runbook (1/2)\n'
admin_psql "$database_name" -f - < "$cleanup_sql"
printf 'Runtime privilege CI stage: applying cleanup SQL extracted from runbook (2/2)\n'
admin_psql "$database_name" -f - < "$cleanup_sql"

start_backend restricted-restart
printf 'Runtime privilege gate: strict pliego_app/pliego_owner mode required\n'
PGHOST="$PGHOST" PGPORT="$PGPORT" PGDATABASE="$database_name" PGUSER=pliego_app PGPASSWORD="$runtime_password" \
    psql -X -v ON_ERROR_STOP=1 -v require_strict_mode=1 -f "$script_dir/runtime_privileges_gate.sql" \
        -f "$script_dir/digital_ownership_gate.sql"
PGHOST="$PGHOST" PGPORT="$PGPORT" PGDATABASE="$database_name" PGUSER=pliego_app PGPASSWORD="$runtime_password" \
    psql -X -v ON_ERROR_STOP=1 -f "$script_dir/verified_pickup_privileges_gate.sql"
PGHOST="$PGHOST" PGPORT="$PGPORT" PGDATABASE="$database_name" PGUSER=pliego_app PGPASSWORD="$runtime_password" \
    psql -X -v ON_ERROR_STOP=1 -f "$script_dir/mail_deliverability_gate.sql" \
        -f "$script_dir/pending_email_change_gate.sql" \
        -f "$script_dir/pending_email_change_security_gate.sql" \
        -f "$script_dir/offers_campaign_gate.sql" \
        -f "$script_dir/offer_timestamp_gate.sql" \
        -f "$script_dir/pickup_timing_notifications_gate.sql"
PGHOST="$PGHOST" PGPORT="$PGPORT" PGDATABASE="$database_name" PGUSER=pliego_app PGPASSWORD="$runtime_password" \
    python3 "$script_dir/registration_continuation_gate.py"
PGHOST="$PGHOST" PGPORT="$PGPORT" PGDATABASE="$database_name" PGUSER=pliego_app PGPASSWORD="$runtime_password" \
    PLIEGO_LOGIN_GATE_STRICT=1 python3 "$script_dir/login_attempt_gate.py"
PGHOST="$PGHOST" PGPORT="$PGPORT" PGDATABASE="$database_name" PGUSER=pliego_app PGPASSWORD="$runtime_password" \
    PLIEGO_TEST_DISPOSABLE_DB=1 python3 "$script_dir/credential_expiry_gate.py"
PGHOST="$PGHOST" PGPORT="$PGPORT" PGDATABASE="$database_name" PGUSER=pliego_app PGPASSWORD="$runtime_password" \
    PLIEGO_TEST_DISPOSABLE_DB=1 python3 "$script_dir/worker_lease_gate.py"
stop_backend
printf 'Runtime privilege CI lifecycle stage passed; strict mode required, cleanup idempotent, database isolated\n'
