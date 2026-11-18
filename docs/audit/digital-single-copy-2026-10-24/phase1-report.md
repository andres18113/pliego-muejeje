# PLIEGO Phase 1: one digital copy per customer

Implementation date: 2026-10-24. No commit or deployment. Existing frontend changes were preserved.

## Changed files

- `backend/src/main/resources/db/migration/V076__single_digital_copy_per_customer.sql`: the only new migration; existing V001–V075 and the approved ZIP are unchanged.
- `backend/src/main/java/com/pliego/foundation/database/DatabaseError.java` and `foundation/web/ApiExceptionHandler.java`: two new conflict mappings and Spanish feedback.
- `backend/src/main/java/com/pliego/modules/cart/api/CartResponses.java`: documented cart reason enum.
- `backend/src/main/java/com/pliego/modules/library/api/DigitalEligibilityController.java`, `application/DigitalEligibility.java`, `application/DigitalEligibilityService.java`, `gateway/DigitalEligibilityGateway.java`, `gateway/JdbcDigitalEligibilityGateway.java`: authenticated batch eligibility Database API adapter.
- Java tests: `CartApiIntegrationTest`, `CheckoutApiIntegrationTest`, `OpenApiCoverageTest`, and new `DigitalEligibilityApiIntegrationTest` in the customer API test package (reuses the existing customer security/context fixture).
- PostgreSQL tests: new `digital_single_copy_gate.sql`, `digital_single_copy_support.py`, `digital_single_copy_concurrency.py`, `digital_single_copy_http_gate.py`, `digital_single_copy_upgrade_gate.py`. Updated `digital_editions_gate.sql`, `digital_ownership_gate.sql`, and `run_ci_gates.sh` for the new invariant and V076.
- `docs/adr/0042-single-digital-copy-per-customer.md`, ADR index, `docs/api-amendments/2026-10-24-single-digital-copy.md`, and this report.
- Contract files only in frontend: `frontend/openapi/openapi.json`, regenerated `frontend/src/shared/api/generated.ts`, and the cart Zod enum in `frontend/src/shared/api/cart.ts`.

## Database behavior and locking

Ownership means a retained `digital_ownership` identity with at least one ACTIVE grant. A REVOKED grant alone does not confer ownership. A digital order source blocks a second purchase while its order is not CANCELLED, `finalizado_en IS NULL`, and its payment is PENDING or APPROVED. The current V072 flow really supports pending payments and closes their original carts. Approved orders in the six-minute cancellation window can be owned and pending simultaneously; ownership takes error precedence. Finalized purchases remain owned. Cancellation/refund revokes sources and permits repurchase when no other active/open source remains.

The new transaction advisory lock is keyed by `digital-purchase:<cliente_id>`. It is acquired before cart/order/master locks and retained through Spring's transaction. A lock on an active cart alone would miss a later deferred capture or another cart generation. PostgreSQL's existing READ COMMITTED transaction behavior provides fresh post-lock statements. Existing cart/master/inventory locks and pricing formulas remain intact. No Java business SQL or transaction control was introduced.

Cart add, cart checkout quote projection, quoted/billed/idempotent acceptance, checkout execution, order-item insertion, capture and ACTIVE grant transitions recheck under this lock. The cart projection retains blocked lines with `available=false` and a non-null reason; acceptance raises before effects. Explicit stale cart IDs still produce the new digital conflict when another checkout won. Same-key successful receipts replay before ownership checks. Grant reconciliation is idempotent for the same item and preserves acquisition snapshots; another active item raises and rolls back the transaction. Valid revoked grants can reactivate; a newly purchased source after cancellation reuses the stable ownership identity.

V076 replaces the ownership identity's silent conflict insertion with a serialized lookup/create and explicit grant checks. It audits duplicate ACTIVE source groups using a migration NOTICE, adds two nonunique lookup indexes, and adds no uniqueness constraint over legacy sources. Paid historical sources are retained, not silently revoked to force a constraint. Defensive triggers also reject conflicting new order items, payment transitions and grant activations. Physical quantities (including existing 1–10 checks), stock, discounts, pickup, refund routines and the six-minute cancellation window are preserved.

## Existing data audit

The local disposable V075 baseline had **0 duplicate ownership identity groups and 0 duplicate ACTIVE grant groups**. This is not a production data audit. The V075→V076 upgrade fixture deliberately created **one identity with two ACTIVE grants (one excess source)**, another revoked source, and duplicate pending orders. Real Flyway migration succeeded, retained the complete historical grant JSON unchanged, allowed same-item replay/refunds, and rejected new acquisitions/reactivations and conflicting captures. Production duplicate counts remain unknown; the API amendment contains a read-only preflight query and V076 reports aggregate counts when applied.

## API and errors

`GET /api/v1/me/digital-eligibility?editionIds=...` takes 1–50 positive IDs and returns each ID once in first-occurrence order:

```json
[{"editionId":"12","owned":true,"ownedItemId":"81","pendingOrder":false,"inCart":false,"purchasable":false}]
```

The actor comes only from the authenticated CUSTOMER subject. `ownedItemId` links to `/biblioteca/{id}` and is null without an active grant. Missing, physical or inactive editions are not digitally purchasable. `inCart` is informational, and does not prevent checkout. The read is advisory; commands always revalidate. OpenAPI includes the success array, validation/authentication responses and new cart reasons; generated types match the live contract.

| SQLSTATE / wire code | Domain label | HTTP | Spanish title | Spanish detail |
| --- | --- | --- | --- | --- |
| P6002 | DIGITAL_ALREADY_OWNED | 409 | Ya tienes esta edición digital | Esta edición digital ya está en tu biblioteca. Puedes consultarla sin volver a comprarla. |
| P6003 | DIGITAL_PURCHASE_PENDING | 409 | Compra digital pendiente | Ya tienes un pedido abierto con esta edición digital. Revisa ese pedido antes de intentar otra compra. |

The wire code is the SQLSTATE, following ADR-0009. Existing mappings are unchanged.

## Verification commands

Run from the repository root. Tests used native PostgreSQL **18.6** under `/tmp/pliego-digital-phase1/pgdata`, port 55476, with disposable local credentials; no Docker or production connection. The environment file is local under `/tmp`, not tracked.

```bash
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=/tmp/pliego-codex-m2 -f backend/pom.xml verify

source /tmp/pliego-digital-phase1/env.sh
PGDATABASE=pliego_digital_verified \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_digital_verified \
CHECKOUT_BASE_URL=http://127.0.0.1:18077 PLIEGO_PG18_APP_PORT=18077 \
PLIEGO_GATE_LOG_DIR=/tmp/pliego-digital-phase1/verified \
bash backend/src/test/postgres18/run_ci_gates.sh

PGDATABASE=pliego_digital_upgrade_final \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_digital_upgrade_final \
python3 backend/src/test/postgres18/digital_single_copy_upgrade_gate.py

npm --prefix frontend run api:types
frontend/node_modules/.bin/tsc --noEmit --incremental false -p frontend/tsconfig.json
git diff --check -- backend docs/adr docs/api-amendments frontend/src/shared/api frontend/openapi
```

Maven result: **BUILD SUCCESS; 310 tests, 0 failures, 0 errors, 0 skipped**. This includes API/security/context integration tests using the project's fake gateways; real JDBC/database integration is exercised by the PostgreSQL/HTTP runner.

The full PostgreSQL runner comprises **35 SQL gates, 17 database/concurrency gates, 19 HTTP gates and 2 authentication gates** (73 total; individual Python scripts may contain multiple unittest cases). Flyway applies all **76 migrations**. New approved and pending races use distinct checkout keys: exactly one order/payment/receipt persists, and only the approved winner gets an ACTIVE grant. HTTP races exercise Spring transactions and JDBC. The separate upgrade gate verifies legacy duplicate ACTIVE sources and deferred capture rollback.

**Final results:** PostgreSQL runner **73/73 gates passed, 0 failed**; V075→V076 duplicate-data upgrade **1/1 gate passed, 0 failed**; OpenAPI type generation and scoped whitespace checks passed. Logs remain under `/tmp/pliego-digital-phase1/` (`maven-final.log`, `gates-verified.log`, `upgrade-final.log`, `verified/backend.log`).

Type generation passed. The additional frontend type check reports **one TS2739 error** in `frontend/src/features/catalog/stockStatusModel.ts:4`: its exhaustive label map lacks P6002/P6003. That interface change is intentionally deferred to Phase 2 under the user's frontend boundary. The permitted cart Zod schema already accepts both codes, and the backend blocks checkout. No other frontend source was changed by this implementation.

An initial Maven invocation without the local repository override failed because `~/.m2` is read-only in this sandbox; using the existing writable `/tmp/pliego-codex-m2` cache resolved it.

## Scope differences and follow-up

- The prior V032 routine actually rejected a repeated digital add. It now returns the existing quantity-one line as requested, while input quantities other than one remain P4004 errors.
- Quote reads return unavailable lines under the lock instead of throwing, so clients can inspect/remove them. Acceptance, order creation and capture raise the conflict and roll back effects.
- Existing legacy duplicate paid sources are preserved for explicit financial review. Duplicate legacy pending orders must be cancelled down to one before capture.
- Production data audit/deployment and frontend labels/eligibility presentation belong to later authorized work. No production action or commit was performed.
