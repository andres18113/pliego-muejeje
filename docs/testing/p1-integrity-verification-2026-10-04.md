# P1 integrity verification — 2026-10-04

Scope: only checkout uncertain outcomes, lost address-create responses, concurrent profile overwrites, and explicit development payment simulation. No UI redesign, P2 production corrections, commits, pushes or deployment.

## RED evidence (before each correction)

- `P1Integrity.test.tsx`: four failures reproduced false “No se creó ningún pedido”, a second address POST, stale unrelated profile fields in the payload, and absent no-real-charge disclosure. Complete log: `/tmp/pliego-p1-red-frontend.log`.
- Live HTTP address replay returned different address IDs. Log: `/tmp/pliego-p1-red-address_replay.log`.
- Live HTTP stale PUT overwrote a concurrent phone change (204 rather than 409). Log: `/tmp/pliego-p1-red-profile_concurrency.log`.
- Live HTTP checkout replay could not return the committed original receipt (P4001 rather than 201). Log: `/tmp/pliego-p1-red-checkout_replay.log`.
- Storage key generation surfaced a raw dependency error rather than Spanish feedback. Log: `/tmp/pliego-p1-red-storage.log`.
- Cross-tab pointer replacement lost the original key and changed the key used by a deferred resolver. Both regressions failed before correction. Log: `/tmp/pliego-p1-red-cross-tab.log`.
- A storage event exposed resolution while checkout preflight was still active. Log: `/tmp/pliego-p1-red-preflight.log`.

## Completed verification

| Gate | Result | Complete log |
| --- | --- | --- |
| `mvn -B -Dmaven.repo.local=/tmp/pliego-m2 clean verify` | PASS: 125 tests, zero failures/errors | `/tmp/pliego-p1-maven.log` |
| PostgreSQL 18 `run_ci_gates.sh`, fresh disposable database | PASS: 36 Flyway migrations; 12 SQL, 6 concurrency and 8 HTTP gates | `/tmp/pliego-p1-pg-full.log` |
| Additional live HTTP P1 validation contracts | PASS: replay, stale PUT/PATCH, missing/malformed keys, omitted vs explicit null, invalid fields/versions | `/tmp/pliego-p1-green-http.log` |
| Real PostgreSQL transactions held open | PASS: PENDING before completion, committed receipt, rollback fence, delayed arrival, actor isolation, concurrent replay, later-cart protection, racing profile updates and ABA | `/tmp/pliego-p1-concurrency.log` |
| `npm test` | PASS: 216 tests across 30 files | `/tmp/pliego-p1-vitest-full.log` |
| `npm run build` (includes full `tsc --noEmit`) | PASS | `/tmp/pliego-p1-frontend-build.log` |
| Targeted Playwright purchase and native cross-tab coordination | PASS: 12 tests | `/tmp/pliego-p1-e2e-targeted.log` |
| Full Playwright, `--workers=2` | 89 passed, 4 failed, 70 configuration-gated skips | `/tmp/pliego-p1-playwright-final.log` |
| Approved archive comparison | PASS: 19 approved SQL files byte-identical to `pliego-flyway-v1.0.zip` | Checked directly with Python zipfile |
| `git diff --check` | PASS | No whitespace errors |

The original full Playwright run with 16 workers had loading timeouts and stale simulation-text expectations. Fixtures were amended for the new profile version; checkout assertions now use the explicit simulation text and keyed resolution contract. A repeat with four workers had one intermittent catalog focus failure plus the four StockStatus failures. The final complete run with two workers passed catalog focus and all purchase tests.

## Remaining full-Playwright failures (outside P1 scope)

- `stockstatus-diagnostic.spec.ts:15`, Light and Dark: expects stock-status icons with width 16, but the current visual design omits those icons (width 0).
- `stockstatus-production.spec.ts:69`, light and dark: expects one `[data-bookcard]` on Favorites, but the current Favorites design renders entity rows.

These assertions remain unchanged. The production StockStatus, Favorites layouts and styles were not modified to satisfy them. Opt-in live/visual tests remain disabled by their existing environment configuration; no extra tests were disabled.

## Review and operational limits

Independent read-only review found and then confirmed corrections for cross-tab claims, mutable async keys and overlap with checkout preflight. No remaining important finding was reported in the PostgreSQL fences, Spring/JDBC boundaries, optimistic profile updates or simulation disclosure.

Browser recovery requires retained local storage and native Web Locks (available in the verified Chromium context). Unsupported coordination/storage fails closed before sending a new command. Clearing all browser recovery metadata or moving to a separate device loses the key needed for automatic resolution; committed server receipts still remain. Ledgers/tombstones intentionally have no expiry: introducing pruning requires an explicit policy that cannot revive delayed requests. Existing external HTTP clients must supply Idempotency-Key and expectedVersion as documented in amendment v1.0.10.
