# Catalog filter scope implementation plan

> For agentic workers: execute the independent database/frontend tasks with Codex-native
> agents and integrate backend/contract verification in the primary session.

**Goal:** Authoritative catalog discovery for GLOBAL, PHYSICAL, EBOOK, AUDIOBOOK.
**Architecture:** Extend existing PostgreSQL discovery overloads and REST endpoints;
keep the current JDBC layers, URL state, TanStack Query and filter components.
**Tech stack:** PostgreSQL 18, Java 25, Spring JDBC/Boot/Flyway, React/TypeScript.
**Spec:** `docs/superpowers/specs/2026-10-05-catalog-filter-scope-design.md`.

## Global constraints

- Do not commit, push, deploy, redesign UI, modify approved baselines or old migrations.
- Preserve existing dirty changes, ranking, cards, checkout, offers and Home.
- Business rules remain PostgreSQL-owned; REST feedback is Spanish.
- Both discovery endpoints accept `scope`, default GLOBAL, same response shapes.

## Review focus

- Empty scope and unknown scope must fail explicitly; omission remains GLOBAL.
- Category parent/child eligibility must match catalog search.
- Physical stock=0 stays discoverable; missing inventory does not create options.
- Selected absent criteria stay representable and removable after scope changes.
- Cache entries must not leak categories or formats between scopes.

## Task 1: Database discovery

Files: new `backend/src/main/resources/db/migration/V050__catalog_filter_scope.sql`,
new `backend/src/test/postgres18/catalog_filter_scope_gate.sql`, existing `run_ci_gates.sh`.
Interfaces: overload `fn_public_category_list(VARCHAR)` and
`fn_public_catalog_filter_facets(VARCHAR)`; no-arg APIs remain GLOBAL-compatible.

- [x] Add and execute failing scoped SQL gate against V049.
- [x] Add migration reusing edition type/listability/price functions and category hierarchy.
- [x] Run isolated PostgreSQL 18 migrations and catalog regression gates; update CI V050 gate.

## Task 2: Backend contract

Files: catalog Controller, Service, Gateway/JdbcGateway, CatalogApiIntegrationTest;
new JDBC binding coverage if needed; frontend OpenAPI snapshot and generated types.
Interfaces: validated string scope passed to SQL overloads; default `GLOBAL` at REST.

- [x] Add failing HTTP scope tests and OpenAPI parameter expectations.
- [x] Thread scope through existing layers, bind SQL parameter, document enum/default.
- [x] Run backend tests/package, export actual generated OpenAPI and regenerate API types.

## Task 3: Frontend integration

Files: shared catalog adapter/tests, CatalogPage/tests, catalogFacets,
CatalogFilters/tests and new focused browser coverage as needed.
Interfaces: adapters retain signal-first compatibility and accept scope second;
CatalogScope derives from productType or GLOBAL. Keys include scope.

- [x] Add failing route/adapter/selected criteria coverage.
- [x] Request scoped categories/facets; remove frontend format eligibility logic.
- [x] Preserve selected category controls and URL/draft/empty-state behavior.
- [x] Run focused and full unit tests, typecheck/build, focused browser checks.

## Task 4: Integration and review

Files: new ADR and verification report under docs; no unrelated modifications.

- [x] Check implementation against spec and preserve initial dirty-file changes.
- [x] Run relevant PostgreSQL/backend/OpenAPI/frontend/browser checks to completion.
- [x] Obtain independent code review, fix findings, record exact results and remaining gaps.
