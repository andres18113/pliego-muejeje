#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/../../../.." && pwd)"
work_dir="$(mktemp -d /tmp/pliego-live-browser.XXXXXX)"
api_port="${PLIEGO_PG18_APP_PORT:-18080}"
frontend_port="${PLIEGO_LIVE_BROWSER_PORT:-5174}"
api_url="http://127.0.0.1:$api_port"
frontend_url="http://127.0.0.1:$frontend_port"
api_pid=''
frontend_pid=''
cleanup() {
    local result=$?
    for pid in "$frontend_pid" "$api_pid"; do
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done
    if (( result != 0 )) && [[ -n "${PLIEGO_GATE_LOG_DIR:-}" ]]; then
        mkdir -p "$PLIEGO_GATE_LOG_DIR"
        cp -R "$work_dir" "$PLIEGO_GATE_LOG_DIR/live-browser-failure"
        printf 'Live browser failure evidence retained at %s/live-browser-failure\n' "$PLIEGO_GATE_LOG_DIR" >&2
    fi
    rm -rf "$work_dir"
}
trap cleanup EXIT

# HTTP is confined to loopback in this disposable fixture; the preceding auth gate tests Secure cookies.
cp "$repo_dir/backend/target/pliego-backend-0.1.0-SNAPSHOT.jar" "$work_dir/backend.jar"
PLIEGO_MAIL_ENABLED=false PLIEGO_AUTH_COOKIE_SECURE=false PLIEGO_CORS_ALLOWED_ORIGINS="$frontend_url" \
    java -jar "$work_dir/backend.jar" "--server.port=$api_port" --server.address=127.0.0.1 >"$work_dir/api.log" 2>&1 &
api_pid=$!
wait_for() {
    local url="$1" pid="$2" log="$3"
    for _ in $(seq 1 60); do
        if curl --noproxy '*' --fail --silent --output /dev/null "$url"; then return; fi
        if ! kill -0 "$pid" 2>/dev/null; then break; fi
        sleep 1
    done
    tail -n 40 "$log" >&2
    return 1
}
wait_for "$api_url/v3/api-docs" "$api_pid" "$work_dir/api.log"

# Bounded synthetic inventory uses the approved Database API, after the transactional gates finish.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE actor bigint; edition record; movement bigint; stock_before integer; stock_after integer;
BEGIN
    SELECT usuario_id INTO actor FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' ORDER BY usuario_id DESC LIMIT 1;
    IF actor IS NULL THEN RAISE EXCEPTION 'Missing disposable admin fixture'; END IF;
    FOR edition IN
        SELECT edicion_id FROM (
            SELECT edicion_id, row_number() OVER (PARTITION BY formato ORDER BY edicion_id) AS rank
            FROM pliego.edicion WHERE estado='ACTIVE' AND formato IN ('PAPERBACK','HARDCOVER') AND precio < 100
        ) physical WHERE rank <= 3
    LOOP
        CALL pliego.sp_inventory_entry(actor,edition.edicion_id,3,'CI browser fixture',movement,stock_before,stock_after);
    END LOOP;
END $$;
SQL

PLIEGO_VITE_CACHE_DIR="$work_dir/vite-cache" PLIEGO_API_PROXY_TARGET="$api_url" "$repo_dir/frontend/node_modules/.bin/vite" "$repo_dir/frontend" \
    --host 127.0.0.1 --port "$frontend_port" --strictPort >"$work_dir/frontend.log" 2>&1 &
frontend_pid=$!
wait_for "$frontend_url/" "$frontend_pid" "$work_dir/frontend.log"
cd "$repo_dir/frontend"
PLIEGO_E2E_LIVE=1 PLIEGO_E2E_BASE_URL="$frontend_url" PLIEGO_API_BASE_URL="$api_url" \
    npx playwright test tests/e2e/digital-physical-contract.live.spec.ts tests/e2e/purchase.live.spec.ts tests/e2e/session.live.spec.ts --workers=1 --output="$work_dir/results"
