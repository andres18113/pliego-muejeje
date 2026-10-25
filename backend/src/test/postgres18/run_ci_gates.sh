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
export PLIEGO_MAIL_ENABLED=false

server_version_num="$(psql -X -v ON_ERROR_STOP=1 -At -c 'SHOW server_version_num')"
if (( server_version_num < 180000 )); then
    printf 'PostgreSQL 18 or newer is required; found server_version_num=%s\n' "$server_version_num" >&2
    exit 2
fi

source_jar="$backend_dir/target/pliego-backend-0.1.0-SNAPSHOT.jar"
if [[ ! -f "$source_jar" ]]; then
    printf 'Build the backend jar before running this gate: %s\n' "$source_jar" >&2
    exit 2
fi

umask 077
# Spring Boot reads nested classes lazily: a parallel Maven repackage must never
# replace the bytes beneath the running gate's classloader.
application_jar="$(mktemp /tmp/pliego-pg18-gates.XXXXXX.jar)"
cp "$source_jar" "$application_jar"
if [[ -n "${PLIEGO_GATE_LOG_DIR:-}" ]]; then
    mkdir -p "$PLIEGO_GATE_LOG_DIR"
    application_log="$PLIEGO_GATE_LOG_DIR/backend.log"
else
    application_log="$(mktemp /tmp/pliego-pg18-gates.XXXXXX.log)"
fi
application_port="${PLIEGO_PG18_APP_PORT:-18080}"
application_pid=''
cleanup() {
    local result=$?
    if [[ -n "$application_pid" ]] && kill -0 "$application_pid" 2>/dev/null; then
        kill -CONT "$application_pid" 2>/dev/null || true
        if (( result != 0 )) && [[ -n "${PLIEGO_GATE_LOG_DIR:-}" ]] && command -v jcmd >/dev/null 2>&1; then
            timeout 10s jcmd "$application_pid" Thread.print > "$PLIEGO_GATE_LOG_DIR/jvm-threads.log" 2>&1 || true
        fi
        # While a blocked request still waits: every session, what blocks it, and the advisory locks held or awaited.
        if (( result != 0 )) && [[ -n "${PLIEGO_GATE_LOG_DIR:-}" ]] && command -v psql >/dev/null 2>&1; then
            timeout 15s psql -X -At -F ' | ' -c "SELECT pid, application_name, state, wait_event_type, wait_event,
                    pg_blocking_pids(pid), now() - xact_start AS xact_age, left(regexp_replace(query, '\s+', ' ', 'g'), 300)
                FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() ORDER BY xact_start NULLS LAST" \
                -c "SELECT l.pid, l.locktype, l.mode, l.granted, l.classid, l.objid, l.objsubid
                FROM pg_locks l WHERE l.locktype = 'advisory' OR NOT l.granted ORDER BY l.granted, l.pid" \
                > "$PLIEGO_GATE_LOG_DIR/postgres-locks.log" 2>&1 || true
        fi
        kill "$application_pid" 2>/dev/null || true
        wait "$application_pid" 2>/dev/null || true
    fi
    rm -f "$application_jar"
    if [[ -z "${PLIEGO_GATE_LOG_DIR:-}" ]]; then rm -f "$application_log"; fi
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
if [[ "$flyway_state" != '79:79' ]]; then
    printf 'Expected 79 successful versioned Flyway migrations through V079; found %s\n' "$flyway_state" >&2
    exit 1
fi
printf 'PostgreSQL server_version_num=%s; Flyway successful migrations=%s\n' "$server_version_num" "$flyway_state"

for gate in checkout_gate.sql customer_orders_gate.sql admin_orders_gate.sql catalog_public_categories_gate.sql catalog_public_filter_options_gate.sql catalog_cover_delivery_gate.sql cart_unavailability_codes_gate.sql catalog_global_search_gate.sql catalog_search_fold_gate.sql catalog_contract_gate.sql catalog_filter_facets_gate.sql catalog_filter_scope_gate.sql digital_editions_gate.sql post_purchase_gate.sql customer_email_change_gate.sql customer_profile_verification_gate.sql ecuador_contact_policy_gate.sql numeric_validation_gate.sql transactional_email_gate.sql mail_completion_gate.sql mixed_checkout_rollback_gate.sql store_pickup_gate.sql monetary_projection_gate.sql ecuador_zero_tax_gate.sql delivery_window_gate.sql offers_gate.sql cart_offer_projection_gate.sql order_offer_snapshot_gate.sql digital_ownership_gate.sql digital_single_copy_gate.sql storefront_help_gate.sql purchase_line_capabilities_gate.sql catalog_spanish_order_gate.sql email_action_return_context_gate.sql ecuador_cedula_gate.sql automatic_billing_gate.sql post_purchase_digital_access_gate.sql; do
    printf 'Running %s\n' "$gate"
    psql -X -v ON_ERROR_STOP=1 -f "$script_dir/$gate"
done

for gate in checkout_last_unit.py order_cancel_concurrency.py address_primary_concurrency.py \
    admin_order_concurrency.py register_email_concurrency.py p1_integrity_concurrency.py person_validation_database_gate.py transactional_email_concurrency.py store_pickup_concurrency.py home_delivery_lifecycle_gate.py offers_concurrency.py order_offer_snapshot_concurrency.py automatic_billing_concurrency.py ecuador_cedula_cases_gate.py invoice_artifacts_gate.py invoice_artifacts_concurrency.py digital_single_copy_concurrency.py post_purchase_digital_access_concurrency.py; do
    printf 'Running %s\n' "$gate"
    if [[ "$gate" == invoice_artifacts_concurrency.py ]]; then
        # Keep the scheduled artifact worker from competing with the two test workers.
        # HTTP/worker behavior is exercised separately after this database-only race.
        kill -STOP "$application_pid"
        if timeout 180s python3 "$script_dir/$gate"; then
            kill -CONT "$application_pid"
        else
            status=$?
            kill -CONT "$application_pid"
            exit "$status"
        fi
    else
        timeout 180s python3 "$script_dir/$gate"
    fi
done

for gate in checkout_http_gate.py customer_orders_http_gate.py admin_orders_http_gate.py \
    admin_customers_http_gate.py full_journey_http_gate.py digital_editions_http_gate.py post_purchase_http_gate.py p1_integrity_http_gate.py accepted_quote_http_gate.py person_validation_http_gate.py numeric_validation_http_gate.py store_pickup_http_gate.py home_delivery_http_gate.py offers_http_gate.py cart_order_offer_http_gate.py library_checkout_http_gate.py storefront_help_http_gate.py automatic_billing_http_gate.py digital_single_copy_http_gate.py digital_mixed_single_copy_http_gate.py catalog_search_fold_http_gate.py post_purchase_digital_access_http_gate.py post_purchase_invoice_http_gate.py; do
    printf 'Running %s\n' "$gate"
    timeout 180s python3 "$script_dir/$gate"
done

PLIEGO_TEST_API_BASE_URL="$application_url" timeout 180s python3 "$script_dir/auth_session_http_gate.py"
timeout 180s python3 "$script_dir/auth_adversarial_http_gate.py"
printf 'Running customer_query_plan_gate.py\n'
plan_gate_args=()
if [[ -n "${PLIEGO_GATE_LOG_DIR:-}" ]]; then
    plan_gate_args=(--output "$PLIEGO_GATE_LOG_DIR/customer-query-plans.json")
fi
timeout 180s python3 "$script_dir/customer_query_plan_gate.py" "${plan_gate_args[@]}"
printf 'PostgreSQL 18 SQL, concurrency, HTTP, and Flyway gates passed.\n'
if [[ "${PLIEGO_RUN_LIVE_BROWSER:-0}" == 1 ]]; then
    kill "$application_pid"
    wait "$application_pid" 2>/dev/null || true
    application_pid=''
    bash "$script_dir/run_live_browser_gates.sh"
fi
