#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$(cd "$script_dir/../../.." && pwd)"

required=(PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PLIEGO_DB_URL PLIEGO_DB_USERNAME \
    PLIEGO_DB_PASSWORD PLIEGO_ADMIN_EMAIL PLIEGO_ADMIN_PASSWORD_HASH PLIEGO_JWT_SECRET CHECKOUT_BASE_URL)
for name in "${required[@]}"; do
    if [[ -z "${!name:-}" ]]; then
        printf 'Required environment variable %s is not set\n' "$name" >&2
        exit 2
    fi
done

# These gates use urllib and may inherit a proxy that intercepts loopback traffic.
export no_proxy="127.0.0.1,localhost"
export NO_PROXY="$no_proxy"

server_version_num="$(psql -X -v ON_ERROR_STOP=1 -At -c 'SHOW server_version_num')"
if (( server_version_num < 180000 )); then
    printf 'PostgreSQL 18 or newer is required; found server_version_num=%s\n' "$server_version_num" >&2
    exit 2
fi

application_jar="$backend_dir/target/pliego-backend-0.1.0-SNAPSHOT.jar"
if [[ ! -f "$application_jar" ]]; then
    printf 'Build the backend jar before running this gate: %s\n' "$application_jar" >&2
    exit 2
fi

umask 077
application_log="$(mktemp /tmp/pliego-pg18-gates.XXXXXX.log)"
application_port="${PLIEGO_PG18_APP_PORT:-18080}"
application_pid=''
cleanup() {
    if [[ -n "$application_pid" ]] && kill -0 "$application_pid" 2>/dev/null; then
        kill "$application_pid" 2>/dev/null || true
        wait "$application_pid" 2>/dev/null || true
    fi
    rm -f "$application_log"
}
trap cleanup EXIT

java -jar "$application_jar" "--server.port=$application_port" >"$application_log" 2>&1 &
application_pid=$!
application_url="${CHECKOUT_BASE_URL%/}"
ready=false
for _ in $(seq 1 60); do
    if curl --noproxy '*' --fail --silent --output /dev/null "$application_url/v3/api-docs"; then
        ready=true
        break
    fi
    if ! kill -0 "$application_pid" 2>/dev/null; then
        break
    fi
    sleep 1
done
if [[ "$ready" != true ]]; then
    printf 'Backend did not become ready; application log follows:\n' >&2
    tail -n 120 "$application_log" >&2
    exit 1
fi

flyway_state="$(psql -X -v ON_ERROR_STOP=1 -At -F: -c \
    'SELECT count(*), max(version)::integer FROM public.flyway_schema_history WHERE success AND version IS NOT NULL')"
if [[ "$flyway_state" != '21:21' ]]; then
    printf 'Expected 21 successful versioned Flyway migrations through V021; found %s\n' "$flyway_state" >&2
    exit 1
fi
printf 'PostgreSQL server_version_num=%s; Flyway successful migrations=%s\n' "$server_version_num" "$flyway_state"

for gate in checkout_gate.sql customer_orders_gate.sql admin_orders_gate.sql; do
    printf 'Running %s\n' "$gate"
    psql -X -v ON_ERROR_STOP=1 -f "$script_dir/$gate"
done

for gate in checkout_last_unit.py order_cancel_concurrency.py address_primary_concurrency.py \
    admin_order_concurrency.py register_email_concurrency.py; do
    printf 'Running %s\n' "$gate"
    timeout 180s python3 "$script_dir/$gate"
done

for gate in checkout_http_gate.py customer_orders_http_gate.py admin_orders_http_gate.py \
    admin_customers_http_gate.py full_journey_http_gate.py; do
    printf 'Running %s\n' "$gate"
    timeout 180s python3 "$script_dir/$gate"
done

printf 'PostgreSQL 18 SQL, concurrency, HTTP, and Flyway gates passed.\n'
