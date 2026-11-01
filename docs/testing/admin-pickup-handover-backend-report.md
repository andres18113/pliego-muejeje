# Admin pickup handover — backend verification report

Date: 2026-11-01. Fixed specification read first: [admin-pickup-handover-v-model.md](admin-pickup-handover-v-model.md). That specification was not edited.

Implemented REQ-2, REQ-3, backend REQ-4/5/6, REQ-7 and REQ-8. Existing list, lookup and collect response contracts remain unchanged. V001–V090 and approved baselines were not edited.

## Final contracts

- `GET /api/v1/admin/pickups/{orderId}` → 200 `AdminPickupDetail` = every `PickupView` field plus `paymentMethod: string | null` and `availableActions: { cancel: boolean, cancellationDeadline: string | null }`. Detail reconciles the purchase lifecycle before projection. Cancellation availability comes from the existing PostgreSQL `fn_order_post_purchase` rules, including V055/V059 and the V072 simulated DRAFT/PENDING branch.
- `POST /api/v1/admin/pickups/{orderId}/verify-code`, body `{ code: string }` → the same 200 detail shape. Normalizes with `fn_normalize_pickup_code`; compares only this order. No reconciliation or row writes; PostgreSQL STABLE routine and Spring read-only transaction. Collect always verifies the submitted credential again.
- Neither response contains the pickup code. The inherited fields are `orderId`, `orderReference`, `state`, `orderState`, `paymentState`, `createdAt`, `readyAt`, `collectedAt`, `collectedBy`, `identityVerified`, `location`, `customer`, `items`, `unitCount`, `total`. Customer includes registered `identityType`/`identityNumber`; IDs/money remain strings, REST timestamps UTC.
- Existing `POST /api/v1/admin/orders/{orderId}/cancel` → `{ orderId: string, previousState: string, orderState: string, paymentState: string, restoredUnits: number }`. The new `sp_admin_order_cancel` asserts ADMIN then delegates to unchanged `sp_order_cancel`.
- 404 `P5016` / `PICKUP_NOT_FOUND`: unknown or non-pickup detail/verification. 400 `P5013` / `PICKUP_CODE_INVALID`: wrong or another order's valid code, identical problem response except request trace ID. 400 `VALIDATION_ERROR`: invalid body or missing/false identity verification. Collection conflicts remain 409 `P5017` / `PICKUP_ALREADY_COLLECTED`, `P5018` / `PICKUP_NOT_READY`, `P5002` / `ORDER_INVALID_TRANSITION`; refused cancellation remains 409 `P5003` / `ORDER_NOT_CANCELLABLE`.
- All routes: anonymous 401, CUSTOMER 403; new routines assert ADMIN and explicitly grant runtime EXECUTE without PUBLIC EXECUTE. No general admin abuse limiter exists in the repository, so no infrastructure was introduced.
- Client exports: `adminPickupDetailSchema`, `AdminPickupDetail`, `getAdminPickup(orderId, signal?)`, `verifyAdminPickupCode(orderId, code)`; `adminOrderCancellationSchema`, `AdminOrderCancellation`, `cancelAdminOrder(orderId)`. New requests use `cache: "no-store"`; codes appear only in POST bodies. Existing exports remain.

Full JSON examples: [API amendment](../api-amendments/2026-11-01-admin-pickup-handover.md).

## Verification

- `cd backend && mvn verify`: **471 passed, 0 failed/errors, 1 pre-existing skipped** (472 total). Focused pickup JUnit classes: **18 passed**.
- Clean PostgreSQL **18.6** on `127.0.0.1:55439`, separate from the review stack: Flyway **91/91**, through V091. A clean database named `handover_ci_verified` is used for the full CI run.
- `run_ci_gates.sh`: **passed end to end (exit 0)**. Includes **46/46 SQL gates, 20/20 concurrency/database gates, 29/29 HTTP gates, 2/2 additional auth HTTP gates, 56/56 query plans, and the runtime ACL lifecycle; 0 failures**. The runtime gate was also run independently and passed.
- The full CI rerun uses the worker settings already defined in `.github/workflows/ci.yml`: `PLIEGO_BILLING_ENABLED=true`, poll `PT0.1S`, batch `20`. An earlier run with development defaults (five-second poll, batch four) passed the pickup gates but timed out the existing invoice-artifact wait; no billing code or timeout was changed.
- Query-plan gate: **56/56 passed, 0 failed**, including the two newly registered V091 JDBC SELECTs; no JIT.
- Runtime ACL gate: passed with `pliego_app` after owner membership removal, two idempotent cleanup runs and an isolated migration/restart through V091. Includes executing the verified pickup behavior gate as the restricted role.
- The new handover HTTP/JDBC gate: **43 passed, 0 failed**. It also executes verification successfully inside a PostgreSQL `BEGIN READ ONLY` transaction. Its before/after state comparison holds a separate fixture lock so scheduled reconciliation cannot race the assertion; verification itself acquires no row lock.
- Verified pickup SQL gate: passed, including due-but-unreconciled code verification with unchanged order/pickup/history/outbox rows; normalized/legacy codes; 404s; ADMIN assertions; cancellation deadline anchored to approval + six minutes; existing collection guards and immutable audit.
- Verified pickup concurrency: passed for same-admin and different-admin simultaneous attempts; each records exactly one collection, one history event and one outbox event. Sequential repeats also return 409 without overwriting audit.
- `cd frontend && npm run api:types`: passed. Only the two generated backend paths and their two new schemas were merged into the existing OpenAPI snapshot, preserving other local contracts. They match the running backend exactly.
- `cd frontend && npx vitest run src/shared`: **422 passed, 0 failed**, 27 files. Focused shared API suite: **40 passed, 0 failed**.
- `cd frontend && npx tsc --noEmit -p tsconfig.json`: passed; **0 shared/api errors**.

Counts below are passed/failed. JUnit counts test methods, HTTP counts acceptance assertions, shared API counts expanded Vitest cases. A case may cover several ACs, so rows overlap.

| AC | JUnit | Real HTTP/JDBC | Shared API |
|---|---:|---:|---:|
| AC-2.1 | 3/0 | 2/0 | 1/0 |
| AC-2.2 | 4/0 | 1/0 | 1/0 |
| AC-2.3 | 4/0 | 1/0 | 1/0 |
| AC-2.4 | 5/0 | 2/0 | 1/0 |
| AC-2.5 | 2/0 | 4/0 | 4/0 |
| AC-3.2 | 5/0 | 3/0 | 8/0 |
| AC-3.3 | 2/0 | 2/0 | 1/0 |
| AC-4.3 | 2/0 | 2/0 | 1/0 |
| AC-5.2 | 1/0 | 3/0 | 1/0 |
| AC-6.2 | 1/0 | 2/0 | 1/0 |
| AC-6.3 | 1/0 | 3/0 | 0/0 |
| AC-7.1 | 1/0 | 8/0 | 7/0 |
| AC-8.1 | 3/0 | 4/0 | 12/0 |
| AC-8.2 | 0/0 | 6/0 | 4/0 |

The SQL and runtime gates additionally cover AC-3.3, AC-4.3, AC-5.2, AC-6.2, AC-6.3, AC-7.1 and AC-8.2. Backend evidence completes UT-B, IT-DB and IT-API for this scope. Shared API tests support the frontend contract; UI component tests, browser ST and screenshot AT are outside this backend/shared-API task and were not performed. REQ-1 and frontend-only ACs (3.1, 4.1/4.2, 5.1, 6.1/6.4, 7.2, UI confirmation in 8.1) remain with the frontend work.

## Files changed by this task

- Migration: `backend/src/main/resources/db/migration/V091__admin_pickup_handover_detail.sql`.
- Sales API/application: `AdminPickupController.java`, `AdminPickupResponses.java`, `PickupModels.java`, `PickupService.java` under `backend/src/main/java/com/pliego/modules/sales/`.
- Sales gateway: `PickupLocationGateway.java`, `JdbcPickupLocationGateway.java`, `JdbcAdminOrderGateway.java` in that module.
- JUnit: `AdminPickupApiIntegrationTest.java`, `PickupServiceTest.java`, `PickupGatewayTest.java`; catalog `OpenApiCoverageTest.java` endpoint count 102 → 104.
- PostgreSQL gates: `admin_pickup_handover_http_gate.py`, `verified_pickup_gate.sql`, `verified_pickup_concurrency.py`, `verified_pickup_privileges_gate.sql`, `customer_query_plan_gate.py`, `run_ci_gates.sh`, `run_runtime_privileges_ci_gate.sh` under `backend/src/test/postgres18/`.
- Shared frontend API: `adminPickups.ts`, `adminPickups.test.ts`, new `adminOrders.ts`, new `adminOrders.test.ts`, regenerated `generated.ts`; `frontend/openapi/openapi.json`.
- Documentation: appended ADR-0047 section; new `docs/api-amendments/2026-11-01-admin-pickup-handover.md`; this report.

No feature/UI/CSS/design/deployment/agent files were edited by this task. Unrelated and concurrent working-tree changes were preserved. No commits, push, deployment or production access. The review stack on 8080/5173/55432 was not used or modified. Logs and disposable test state are under `/tmp/pliego-handover-work/`; the disposable PostgreSQL server was stopped after verification.
