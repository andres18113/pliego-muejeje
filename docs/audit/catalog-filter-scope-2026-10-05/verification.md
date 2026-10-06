# Catalog filter scope verification — 2026-10-05

## Implemented contract

The existing Controller → read-only Service → JDBC Gateway → PostgreSQL API
owns categories and facets for GLOBAL, PHYSICAL, EBOOK, AUDIOBOOK. Both existing
discovery endpoints accept optional scope, default GLOBAL. Response schemas and
money strings stay unchanged; no counts were introduced. V050 overloads reuse
active book/edition, listability, product type, effective pricing and active
category ancestry. Physical stock zero remains public, matching search.

CatalogPage derives scope from URL productType and scopes both query keys and
requests. Options come from the backend; missing selected category/format/language
remain representable and removable. UI styling, ranking, cards, offers, Home,
checkout and unrelated routes received no changes from this pass. Existing and
concurrent workspace edits were preserved. No commit, push or deployment.

## Results

| Verification | Result | Full evidence |
| --- | --- | --- |
| SQL regression proving missing scoped contracts on V049 | Expected RED | `/tmp/pliego-scope-red.log` |
| PostgreSQL 18 V050 migration | PASS; 50 successful migrations | `/tmp/pliego-scope-v050-flyway.log` |
| Scoped/category/facet/global-search/contract/digital/offer/storefront SQL gates | 10/10 PASS | `/tmp/pliego-scope-regressions.log` |
| CI shell syntax | PASS | `bash -n backend/src/test/postgres18/run_ci_gates.sh` |
| Backend final full tests and package | 172 PASS, zero failures/errors/skips | `/tmp/pliego-filter-scope/backend-final.log`, `backend/target/surefire-reports/` |
| Packaged backend startup/Flyway | PASS; validates all 50 migrations, schema V050 | `/tmp/pliego-filter-scope/backend-server-final.log` |
| Real HTTP/JDBC | Four scopes, effective price bounds, search parity, defaults, invalid scope, selected cross-scope empty results PASS | `/tmp/pliego-filter-scope/live-http-final.log` |
| OpenAPI and generated types | PASS; only the two discovery paths changed against initial snapshot; schemas and server metadata unchanged | `/tmp/pliego-filter-scope/api-types.log` |
| Frontend scoped tests RED → GREEN | 8 expected failures → 8 PASS | `/tmp/pliego-catalog-scope-frontend-{red,green}.log` |
| Focused frontend unit tests | 69 PASS; final route coverage 9 PASS | `/tmp/pliego-catalog-scope-frontend-{focused,route}.log` |
| Final full frontend unit tests | 59 files, 508 PASS | `/tmp/pliego-filter-scope/frontend-final-unit.log` |
| Final typecheck and production build | PASS | `/tmp/pliego-filter-scope/frontend-final-build.log` |
| Focused scoped Playwright | 3 PASS, desktop navigation/history plus recovery/reload at 390/1440px | `/tmp/pliego-catalog-scope-browser.log` |
| Live browser against isolated backend/database | Four scope navigations/category radios and selected-category empty-state recovery PASS | `/tmp/pliego-filter-scope/live-browser-final.log` |
| Broader catalog/header/exploration Playwright | Initial 36/57 PASS; two artifact failures passed on isolated rerun; 19 assertions remain failing | `/tmp/pliego-filter-scope/browser-regressions.log`, `/tmp/pliego-filter-scope/browser-header-recheck.log` |
| Independent code review | No Critical/Important findings; minor OpenAPI server-port drift corrected | `/tmp/pliego-filter-scope/review.diff` and review transcript |
| Whitespace for owned changed files | PASS | `git diff --check -- <owned paths>` |

The isolated live browser initially encountered a CORS rejection on its separate
frontend port and an incorrect assumption that populated header sections were
links. Verification configuration allowed that origin and exercised the existing
section menu's “Ver todos” link. Neither required product changes.

## Remaining verification gaps

No scoped functional gap was found. The broader browser suite is still red:

- 17 checks expect retired price inputs, hidden disclosure choices, a desktop
  drawer trigger, old option labels, or absence of the existing sort selector.
- One representative-cover fixture points to a missing cover asset.
- One price-visibility viewport assertion fails at 1280×720; no visual adjustment
  was made in this architecture pass.

Two initial header failures were missing Playwright trace artifacts; both passed
with isolated output. All sixteen header cases have passing evidence. Concurrent
edits to unrelated frontend components were observed through Vite HMR, so broad
visual conclusions from this run are limited. Unit tests emit jsdom's existing
“Not implemented: navigation to another Document” message but exit successfully.

## Files changed by this pass

Backend:

- `backend/src/main/resources/db/migration/V050__catalog_filter_scope.sql`
- `backend/src/main/java/com/pliego/modules/catalog/api/CatalogController.java`
- `backend/src/main/java/com/pliego/modules/catalog/application/CatalogService.java`
- `backend/src/main/java/com/pliego/modules/catalog/gateway/CatalogGateway.java`
- `backend/src/main/java/com/pliego/modules/catalog/gateway/JdbcCatalogGateway.java`
- `backend/src/test/java/com/pliego/modules/catalog/api/CatalogApiIntegrationTest.java`
- `backend/src/test/postgres18/catalog_filter_scope_gate.sql`
- `backend/src/test/postgres18/run_ci_gates.sh`

Frontend:

- `frontend/openapi/openapi.json`
- `frontend/src/shared/api/generated.ts`
- `frontend/src/shared/api/catalog.ts`
- `frontend/src/shared/api/catalog.test.ts`
- `frontend/src/features/catalog/CatalogPage.tsx`
- `frontend/src/features/catalog/CatalogPage.test.tsx`
- `frontend/src/features/catalog/CatalogFilters.tsx`
- `frontend/src/features/catalog/CatalogFilters.test.tsx`
- `frontend/src/features/catalog/catalogFacets.ts`
- `frontend/tests/e2e/catalog-scope.spec.ts`
- `frontend/tests/e2e/catalog.spec.ts` — discovery request glob compatibility only
- `frontend/tests/e2e/catalog-header.spec.ts` — discovery request glob compatibility only

Documentation:

- `docs/adr/0027-scoped-public-catalog-filters.md`
- `docs/adr/README.md`
- `docs/superpowers/specs/2026-10-05-catalog-filter-scope-design.md`
- `docs/superpowers/plans/2026-10-05-catalog-filter-scope.md`
- `docs/audit/catalog-filter-scope-2026-10-05/verification.md`
