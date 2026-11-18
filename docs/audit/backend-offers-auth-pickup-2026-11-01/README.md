# Local backend delivery — 2026-11-01

Implementation is prepared on `feat/digital-ownership-post-purchase-search`.
No production connection, SSH, production API request, commit, push or deployment
was performed. UI implementation belongs to Claude. Existing PNG modifications,
the pre-existing TestSprite document and concurrent frontend UI work were left alone.

## Scope and evidence

| Task | Finding and resulting behavior | Requirements and evidence |
|---|---|---|
| Offers | V044 applies `[inicio, fin)`; V078 searches/facets require an active projected offer. All 23 preserved October campaign windows ended by October 21. No active-offer filtering defect was reproduced. New campaign tooling creates 21 offers, 7 per format, with approved tier discounts and durations 3/5/7 days. | [Campaign audit and exact future commands](../offers-campaign-2026-11-01/README.md), including candidate plan, local receipts, cart checks, preserved-row hashes and expiration rollback gate. |
| Registration | Registration and verification previously established no session. A separate browser continuation now enables an atomic, verified exchange into one normal session family; a verification link alone still cannot authenticate. | [Acceptance matrix and frontend handoff](../../testing/2026-11-01-registration-continuation.md), ADR 0050, real HTTP/JDBC and seven observed-lock races. |
| Pickup | The old snapshot used checkout capture +25 minutes, without approval reanchoring or opening-hours enforcement. New orders use approval +10 minutes, bounded by the unchanged six-minute cancellation deadline and collection hours. READY had no producer; COLLECTED already had a transactional producer. | [Trace, arithmetic, acceptance and UI copy handoff](../../testing/pickup-ten-minute-readiness-and-notifications.md), ADR 0051, timing/notification gates and historical upgrade gate. |

The exact observed 19:22→19:41 order cannot be reconstructed without its original
timestamps, which were not accessed. Concrete possibilities are documented without
presenting them as measurements. The seeded point is America/Guayaquil, 09:00–17:00,
25 legacy preparation minutes; new public locations advertise ten effective minutes.
An immediate approval at 19:22 now permits pickup at the next 09:00 opening.

The production candidate plan uses archived real catalog evidence. Its current
eligibility is **unverified** until an explicitly authorized live preflight. The
local rehearsal uses a separate identified synthetic catalog and recreates the
23 prior offers with unchanged original dates. It proves 21 correct cart prices,
six ending-soon offers, all twelve type/sort combinations, preserved history,
expiration rollback and zero orders created.

## Migrations and boundaries

- **V096** `registration_session_continuation`: hash-only credentials and rate
  buckets; verified exchange, session fencing and safe revoke-all Database API.
- **V097** `pickup_ten_minute_schedule_and_ready_notifications`: new snapshot
  timing, one-time deferred approval anchoring, collection hours, READY ledger and
  sweep, historical suppression and published Help copy.
- **V098** `admin_edition_offer_row_presence`: administrative visibility of any
  existing row and atomic conditional creation on the existing offer PUT.

ADRs [0050](../../adr/0050-registration-session-continuation.md),
[0051](../../adr/0051-pickup-readiness-and-durable-notifications.md) and
[0052](../../adr/0052-conditional-creation-for-edition-offers.md) record the decisions.
V001–V095 and `pliego-flyway-v1.0.zip` remain byte-for-byte unchanged. Historical
pickup snapshots and confirmation payloads remain unchanged across V096→V097.
Spring retains transaction boundaries; services/controllers contain no business SQL.

The [changed-files report](changed-files.txt) contains the scoped `git diff --stat`
and all untracked files (no staging). The tracked diff is **32 files, +573/−110**;
44 new files add 5,267 lines, including domain evidence. These counts exclude this
report folder, pre-existing PNGs and concurrent UI work.

| Area, including new files and evidence | Files | Added | Removed |
|---|---:|---:|---:|
| Offers | 33 | 3,826 | 13 |
| Registration | 20 | 1,156 | 67 |
| Pickup | 16 | 777 | 23 |
| Shared gates/documentation | 7 | 81 | 7 |

## API contract for the frontend

| Operation | Request | Response |
|---|---|---|
| `POST /api/v1/auth/register` | Existing JSON, optional validated `returnTo` | Existing 201 body; sets `pliego_registration`, no access token. |
| `POST /api/v1/auth/registration-session` | No body; browser cookies; `X-PLIEGO-SESSION-REQUEST: 1` | 200 = `LoginResponse` plus nullable sanitized `returnTo`; 202 = `{state:"PENDING_VERIFICATION"}`, `{state:"REFRESH_REQUIRED"}` or quota-limited `{state:"RETRY_LATER"}` (no Set-Cookie, Retry-After seconds); 204 = absent/invalid/expired/consumed continuation outside recovery, cookie cleared. Missing marker →403. |
| `POST /api/v1/auth/verify-email` | Existing `{token}`; send session marker because continuation may be present | Matching valid continuation and verified token →200 with the same session shape; another browser/user →204 without session. Invalid/used proof →existing400. Cookie-bearing requests without marker →403. |
| `GET /api/v1/admin/editions` | Existing administrative query | Adds `offerRowExists`, including expired/inactive rows. |
| `PUT /api/v1/admin/editions/{id}/offer` | Existing body; optional all-or-none `If-None-Match: *`, `X-Expected-Base-Price`, `X-Expected-Stock` (`NONE` for digital) | No headers: existing upsert. Guarded mode: atomic create-only, unchanged base/stock and public eligibility required; success204, precondition failure existing `P1001`/400. Occupied inventory fails closed rather than deadlocking. |
| Pickup locations/order/admin detail | Existing routes and shapes | Effective new preparationMinutes=10; readyAt/estimatedAt from the authoritative snapshot. Closed new-policy points cannot be READY or collected. |

Both cookies are host-only, `HttpOnly`, `Secure` by default, `SameSite=Strict`,
`Path=/api/v1/auth`, without Domain. Continuation expiry is no later than its initial
verification proof or 24 hours. The normal `pliego_session` retains absolute 30-day
expiry, 30-minute bearer tokens and existing five-minute refresh replay behavior.
The five-minute continuation replay returns REFRESH_REQUIRED and never creates a
second family; clients recover via normal refresh and shared browser cookies.

**Coordinated frontend adoption is required before release.** The existing
handwritten verification helper must send the marker and handle 200/204; the waiting
tab must call the new exchange and handle 202/refresh recovery. Only OpenAPI,
generated TypeScript and Zod contract schemas were changed here. The pickup handoff
lists affected UI copy; no feature/UI/CSS/design files were edited by this work.

## Verification

| Check | Result |
|---|---|
| Full Maven `verify` on reviewed source | 554 tests, zero failures/errors, one skipped: 553 passed. The opt-in R2 live smoke was skipped because PLIEGO_R2_LIVE_TEST is unset; no external storage call. |
| Full frontend `npm test` | 1,257 passed in 103 files. |
| Frontend `npm run build` | Passed TypeScript and production build. |
| Offers tool unit suite | 17 passed. |
| Offer PostgreSQL lock races | Four passed, including real inventory-command deadlock regression. |
| Registration lock races | Seven passed, including verification/exchange and revoke-all in both orders. |
| Pickup upgrade of final packaged JAR | Passed V096→V097, immutable snapshots and historical/future notification boundary. |
| Full PostgreSQL 18 CI runner | Passed all 112 primary gates: 52 SQL and 60 Python. |
| Strict runtime role lifecycle | Passed startup migration as pliego_app, two idempotent runbook cleanup applications, restricted restart, eight SQL gates and registration security/races under the restricted role. |

Commands used, with disposable database credentials supplied through private local
environment files:

```bash
cd backend
mvn --offline --batch-mode --no-transfer-progress \
  -Dmaven.repo.local=/tmp/pliego-nov01/m2 verify

# From repository root, using CI-equivalent worker configuration:
PLIEGO_TEST_DISPOSABLE_DB=1 PLIEGO_BILLING_ENABLED=true \
PLIEGO_BILLING_POLL_INTERVAL=PT0.1S PLIEGO_BILLING_BATCH_SIZE=20 \
PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED=true \
bash backend/src/test/postgres18/run_ci_gates.sh

python3 -m unittest discover -s scripts/ops/offers-campaign -p 'test_*.py'
# Separate EMPTY disposable database:
python3 backend/src/test/postgres18/pickup_timing_upgrade_gate.py

cd frontend
npm test
npm run build
```

Private verbose logs remain in `/tmp/pliego-nov01/`. The final runner uses
`logs/full-ci-workers.log` and `logs/full-ci-workers/`. Machine-readable results
and sanitized summaries are in [verification.json](verification.json). Initial validation found and
resolved two real lock-order defects (registration IP/user and offer/inventory),
an obsolete endpoint-count assertion and a mail fixture assuming collection after
closing. Earlier local runner attempts also exposed environment mismatches: the
owner must be the existing CI role `pliego`, and the invoice worker must be enabled
as in CI. Those attempts are not counted as passing full runs.

The sandbox denied Maven writes to
`/home/andres18123/.m2/repository/.../resolver-status.properties`. A writable copy
at `/tmp/pliego-nov01/m2` allowed the full offline build; no sandbox blocker remains.

## Limits and future production action

The reason for a particular customer's missing COLLECTED receipt remains unknown:
its enqueue/render paths already existed, and production/provider access was
excluded. Tests prove durable, deduplicated enqueue and rendering, not inbox receipt.
Ambiguous provider timeouts fail closed under the existing mail contract.

The READY sweep shares the existing lifecycle scheduler and its configuration.
Historical logically-ready/collected/cancelled pickups do not receive a backlog;
old unapproved/still-cancellable orders retain eligibility for future transitions.

No production command has been executed. The [campaign audit](../offers-campaign-2026-11-01/README.md)
contains the exact future preflight/apply commands; both require explicit new
authorization, an administrator token supplied only through environment, and an
independently authorized release containing V098. The campaign plan stores durations,
so applying later computes fresh dates. The batch is not one transaction; durable
receipts identify partial application and there is no automatic retry/rollback.

Deploying the uncommitted authentication/pickup changes remains outside this task.
There is no pinned CI artifact for this local diff; no SSH or deployment shortcut
is proposed. A separately authorized release must follow the
[canonical runbook](../../deployment/production-runbook.md).
