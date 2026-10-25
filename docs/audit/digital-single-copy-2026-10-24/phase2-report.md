# PLIEGO Phase 2: digital purchase recovery

2026-10-24. No commit, deployment or production data access. Phase 1 business design retained.

## Delivered behavior

- V076 eligibility adds nullable `pending_order_id`, mapped to string/null `pendingOrderId` through JDBC, the response, live OpenAPI, generated TypeScript and the frontend Zod parser. The ID uses the exact blocking predicate already used by `pendingOrder`, is customer-scoped, and deterministically selects the lowest ID among legacy duplicate open sources. Existing locks, command idempotency, quantities and business routines are unchanged.
- Cart, drawer and checkout use the existing capability-based rule: `requiresPhysicalFulfillment=false`, `quantityEditable=false`, quantity 1 displays `1 copia digital por cuenta`. An uneditable physical line displays `Cant. N`.
- P6002/P6003 use shared Spanish conflict copy. Blocked cart lines keep pricing/offers and block checkout; eligibility supplies real library/order links, with collection fallbacks when IDs cannot be read. The cart keeps Quitar.
- CUSTOMER digital edition pages and their floating pill show owned > pending order > in-cart actions. Loading/read failure keeps the normal add button. Eligibility queries include the actor, batch at 50 IDs, and share the customer-cart invalidation prefix. Physical editions, guests and staff keep their flow.
- Checkout treats these two codes as definitive refusals. Its existing problem area offers library/order/cart recovery; the attempt ends and cannot resubmit even if a cart refresh is stale. Unknown transport/payment-outcome handling remains separate.
- Independent read-only review identified focused add controls disappearing when eligibility arrives. Local focus now moves to the replacement action in the page/pill, preserving focus inside an open drawer and enabling drawer focus restoration. Two regression tests failed before the fix and passed afterward.

## Phase 2 files

Backend/API:
- `backend/src/main/resources/db/migration/V076__single_digital_copy_per_customer.sql`
- `backend/src/main/java/com/pliego/modules/library/application/DigitalEligibility.java`
- `backend/src/main/java/com/pliego/modules/library/gateway/JdbcDigitalEligibilityGateway.java`
- `backend/src/test/java/com/pliego/modules/customer/api/DigitalEligibilityApiIntegrationTest.java`
- `backend/src/test/postgres18/digital_single_copy_gate.sql`
- `backend/src/test/postgres18/digital_single_copy_http_gate.py`
- `frontend/openapi/openapi.json`, `frontend/src/shared/api/generated.ts`
- `frontend/src/shared/api/digitalEligibility.ts`, `digitalEligibility.test.ts`
- `frontend/src/shared/api/orders.ts`, `orders.test.ts`

Frontend:
- `frontend/src/features/library/digitalEligibilityQuery.ts`
- `frontend/src/features/library/digitalPurchaseState.ts`, `digitalPurchaseState.test.ts`
- `frontend/src/features/library/DigitalConflictLink.tsx`
- `frontend/src/features/catalog/stockStatusModel.ts`, `stockStatusModel.test.ts`
- `frontend/src/features/catalog/EditionDetailPage.tsx`, `editionDetail.module.css`
- `frontend/src/features/catalog/EditionDigitalEligibility.test.tsx`
- `frontend/src/features/catalog/useBookCardActions.test.tsx`, `StockRobustness.test.tsx`
- `frontend/src/features/purchase/CartPage.tsx`, `CartPage.test.tsx`
- `frontend/src/features/purchase/CartPreview.tsx`, `CartPreview.test.tsx`
- `frontend/src/features/purchase/CheckoutPage.tsx`, `DigitalCheckout.test.tsx`
- `frontend/tests/e2e/digital-single-copy.spec.ts`

Documentation:
- `docs/adr/0042-single-digital-copy-per-customer.md`
- `docs/api-amendments/2026-10-24-single-digital-copy.md`
- `docs/design/PLIEGO_FRONTEND_DESIGN_LANGUAGE.md`
- `docs/superpowers/plans/2026-10-24-digital-phase2.md`
- This report.

Reviewed and retained the user's started `cartQuery.ts` / `cart.module.css` quantity implementation. `DigitalCheckout.test.tsx` already imported `within` in the starting tree. Existing navigation, sticky pill mechanics and cart-offer display were preserved. The pre-turn tracked diff is `/tmp/pliego-phase2-start.patch`; comparison against its reconstructed frontend found 363 existing source/test files byte-identical, including navigation and prior e2e files.

## Backend verification

```bash
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=/tmp/pliego-codex-m2 -f backend/pom.xml verify

source /tmp/pliego-digital-phase1/env.sh
createdb pliego_digital_phase2_20261024_a
PGDATABASE=pliego_digital_phase2_20261024_a \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_digital_phase2_20261024_a \
CHECKOUT_BASE_URL=http://127.0.0.1:18077 PLIEGO_PG18_APP_PORT=18077 \
PLIEGO_GATE_LOG_DIR=/tmp/pliego-digital-phase2/gates \
bash backend/src/test/postgres18/run_ci_gates.sh

createdb pliego_digital_phase2_upgrade_20261024
PGDATABASE=pliego_digital_phase2_upgrade_20261024 \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_digital_phase2_upgrade_20261024 \
python3 backend/src/test/postgres18/digital_single_copy_upgrade_gate.py
```

Maven: **310 passed, 0 failed/errors/skipped**. Native PostgreSQL 18 runner: **73/73 gates passed** (35 SQL, 17 database/concurrency, 19 HTTP, 2 authentication), all 76 migrations. Separate V075→V076 upgrade: **1/1 passed**. Fresh empty databases were created before each runner. The new SQL assertions initially failed on the absent column; the completed gates verify null before acquisition, actual pending/approved order links, actor isolation and null after cancellation. Logs: `/tmp/pliego-phase2-maven.log`, `/tmp/pliego-phase2-gates.log`, `/tmp/pliego-phase2-upgrade.log`.

The contract was reread from local `/v3/api-docs`; only the new schema property differs from the initial contract. The established server URL was retained. `npm --prefix frontend run api:types` regenerated the types.

## Frontend verification

TypeScript: **exit 0, 0 errors**. Vitest: **90 files, 1,052 passed, 0 failed**. Logs: `/tmp/pliego-phase2-tsc-final.log`, `/tmp/pliego-phase2-vitest-final.log`. The 19 new Playwright cases pass within the final full suite, including keyboard focus restoration after a sticky add/drawer close. The final full non-live/non-visual Playwright run was **334 passed, 16 failed, 6 skipped (356 total)**. The new digital spec contributes **19 passed, 0 failed**, already included in that total. Log: `/tmp/pliego-phase2-e2e-final-sequential.log`; artifacts: `/tmp/pliego-phase2-playwright-final-sequential`.

### Evidence for unrelated failures

A separate frontend was reconstructed under `/tmp/pliego-phase2-baseline` from HEAD plus the exact pre-turn diff `/tmp/pliego-phase2-start.patch`, including the two already-existing untracked ParentLink files, root shared validation data, cover manifest and a separate copy of the same installed dependencies. No Phase 2 product code or new spec was present. Its full identical suite, with only the local base URL changed to port 5174, produced **310 passed, 21 failed, 6 skipped (337 total)**. Log: `/tmp/pliego-phase2-e2e-baseline-complete.log`; artifacts: `/tmp/pliego-phase2-playwright-baseline-complete`.

**15 of the final run's 16 failures reproduce by identical test title in the initial frontend:** four `back-navigation.spec.ts` primary-section tests and eleven `catalog-header.spec.ts` shared-header tests. Their traces show the existing 30-second test deadline expiring during multi-route navigation/visibility checks. The baseline also fails six other pre-existing cases that passed in the final Phase 2 run, including the remaining header width. Comparison of exact titles is saved at `/tmp/pliego-digital-phase2/baseline-comparison.json`.

The remaining failure is `production-state-help.spec.ts` → “Account verification follows explicit current-email state at 390px”: its full-run trace is still at the lazy-route “Abriendo tu página…” fallback at the 30-second deadline. This unchanged test and account implementation pass in the initial frontend (25.7 s) and in an isolated recheck of the final frontend (**1 passed, 0 failed; 9.0 s test / 9.4 s run**). Log: `/tmp/pliego-phase2-account-recheck.log`. This is load-sensitive timing, not a new digital-state assertion failure. The full suite remains non-green; no old tests or navigation/profile behavior were changed to hide these failures.

```bash
# Reconstructed pre-turn frontend, run only after the final frontend suite completed:
cd /tmp/pliego-phase2-baseline/frontend
PLIEGO_E2E_BASE_URL=http://127.0.0.1:5174 \
npx playwright test $(ls tests/e2e/*.spec.ts | grep -v -E "\.live\.|\.visual\." ) \
  --output /tmp/pliego-phase2-playwright-baseline-complete

# Isolated final-frontend recheck, no source changes:
cd /home/andres18123/PLIEGO/frontend
npx playwright test tests/e2e/production-state-help.spec.ts \
  --grep 'Account verification follows explicit current-email state at 390px' \
  --workers=1 --output /tmp/pliego-phase2-playwright-account-recheck
```

Earlier concurrent full-suite attempts suffered resource contention and were excluded from the final counts. The final runs above were sequential. Initial baseline attempts with missing shared data or font assets were also excluded; the completed comparison used all assets/dependencies locally and had no module/font-serving errors.

```bash
cd frontend
npx tsc --noEmit
npx vitest run src
npx playwright test $(ls tests/e2e/*.spec.ts | grep -v -E "\.live\.|\.visual\." ) --output /tmp/pliego-phase2-playwright-final-sequential
```

## Screenshots

Mocked API fixtures with synthetic account/payment data. Both 1280px desktop and 360px phone; full-page captures plus the actual scrolled floating pill. No image-generation assets were used.

- [cart-P6002-1280.png](/tmp/pliego-digital-phase2/screenshots/cart-P6002-1280.png)
- [cart-P6002-360.png](/tmp/pliego-digital-phase2/screenshots/cart-P6002-360.png)
- [cart-P6003-1280.png](/tmp/pliego-digital-phase2/screenshots/cart-P6003-1280.png)
- [cart-P6003-360.png](/tmp/pliego-digital-phase2/screenshots/cart-P6003-360.png)
- [cart-digital-1280.png](/tmp/pliego-digital-phase2/screenshots/cart-digital-1280.png)
- [cart-digital-360.png](/tmp/pliego-digital-phase2/screenshots/cart-digital-360.png)
- [checkout-P6002-1280.png](/tmp/pliego-digital-phase2/screenshots/checkout-P6002-1280.png)
- [checkout-P6002-360.png](/tmp/pliego-digital-phase2/screenshots/checkout-P6002-360.png)
- [checkout-P6003-1280.png](/tmp/pliego-digital-phase2/screenshots/checkout-P6003-1280.png)
- [checkout-P6003-360.png](/tmp/pliego-digital-phase2/screenshots/checkout-P6003-360.png)
- [checkout-digital-P6002-1280.png](/tmp/pliego-digital-phase2/screenshots/checkout-digital-P6002-1280.png)
- [checkout-digital-P6002-360.png](/tmp/pliego-digital-phase2/screenshots/checkout-digital-P6002-360.png)
- [checkout-digital-P6003-1280.png](/tmp/pliego-digital-phase2/screenshots/checkout-digital-P6003-1280.png)
- [checkout-digital-P6003-360.png](/tmp/pliego-digital-phase2/screenshots/checkout-digital-P6003-360.png)
- [drawer-P6002-1280.png](/tmp/pliego-digital-phase2/screenshots/drawer-P6002-1280.png)
- [drawer-P6002-360.png](/tmp/pliego-digital-phase2/screenshots/drawer-P6002-360.png)
- [drawer-P6003-1280.png](/tmp/pliego-digital-phase2/screenshots/drawer-P6003-1280.png)
- [drawer-P6003-360.png](/tmp/pliego-digital-phase2/screenshots/drawer-P6003-360.png)
- [drawer-digital-1280.png](/tmp/pliego-digital-phase2/screenshots/drawer-digital-1280.png)
- [drawer-digital-360.png](/tmp/pliego-digital-phase2/screenshots/drawer-digital-360.png)
- [edition-inCart-1280.png](/tmp/pliego-digital-phase2/screenshots/edition-inCart-1280.png)
- [edition-inCart-360.png](/tmp/pliego-digital-phase2/screenshots/edition-inCart-360.png)
- [edition-inCart-sticky-1280.png](/tmp/pliego-digital-phase2/screenshots/edition-inCart-sticky-1280.png)
- [edition-inCart-sticky-360.png](/tmp/pliego-digital-phase2/screenshots/edition-inCart-sticky-360.png)
- [edition-owned-1280.png](/tmp/pliego-digital-phase2/screenshots/edition-owned-1280.png)
- [edition-owned-360.png](/tmp/pliego-digital-phase2/screenshots/edition-owned-360.png)
- [edition-owned-sticky-1280.png](/tmp/pliego-digital-phase2/screenshots/edition-owned-sticky-1280.png)
- [edition-owned-sticky-360.png](/tmp/pliego-digital-phase2/screenshots/edition-owned-sticky-360.png)
- [edition-pending-1280.png](/tmp/pliego-digital-phase2/screenshots/edition-pending-1280.png)
- [edition-pending-360.png](/tmp/pliego-digital-phase2/screenshots/edition-pending-360.png)
- [edition-pending-sticky-1280.png](/tmp/pliego-digital-phase2/screenshots/edition-pending-sticky-1280.png)
- [edition-pending-sticky-360.png](/tmp/pliego-digital-phase2/screenshots/edition-pending-sticky-360.png)


## Deviations and open questions

No functional scope deviation or outstanding product question. V076 was amended under the user's explicit exception; no V077 was added. The missing-`within` defect was already corrected in the starting working tree. The only unresolved verification limitation is the pre-existing/load-sensitive Playwright failures documented above. All failures introduced by the implementation/tests were corrected. Scoped whitespace verification passed; two pre-existing blank lines at EOF in navigation files remain untouched.
