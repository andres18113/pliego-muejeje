# PLIEGO functional integration implementation plan

**Goal:** Complete Offers, eBooks, Audiobooks and supported customer email flows within the existing architecture, without visual redesign, commits, pushes or deployments.

**Architecture:** Controller → Application Service → JDBC Gateway → PostgreSQL public Database API. PostgreSQL owns effective prices, eligibility, totals, digital quantities and immutable order snapshots. React Query and the existing typed API client own frontend reads and command states.

**Constraints:** Preserve existing workspace changes and approved migrations. Java 25, PostgreSQL 18, Spring JDBC, no JPA or Docker. Spanish customer feedback. No digital download/streaming invention. Provider configuration remains backend-only.

## Tasks and ownership

- [x] Offers backend agent: V044, edition offer commands/query, effective prices in catalog/favorites/cart/quote/checkout, Java contract, focused PostgreSQL/HTTP tests, ADR and amendment. Verify timed activation/expiry, no stacking, inactive editions, immutable prior orders and physical stock.
- [x] Digital frontend agent: supported edition metadata, digital-only pickup presentation, address-based simulated checkout, physical/mixed compatibility, focused component/live tests. Retain backend enforcement and quantity one.
- [x] Email agent: existing verification/resend/password recovery/reset APIs, fragment-token routes, registration/email-change messaging, safe command states, client/hooks/component tests. No new provider integration.
- [x] Root: synchronize exported OpenAPI/generated types, implement offers client/query/page and server-provided discount presentation, wire email routes, review all agent changes, run integrated checks, write Claude handoff.

## Verification and review

Write behavioral regressions before implementations. Run focused tests fully with logs under `/tmp/pliego-integration*`; inspect summaries/failures only. Then run backend Maven verification, PostgreSQL 18 SQL/concurrency/HTTP/Flyway gate, transactional-email delivery gate, frontend tests/build, and focused mocked/live E2E. Review loading/error/empty states, stale offer boundaries, mixed physical/digital orders, token replay/expiry and unknown command outcomes. Stop expanding verification after required checks pass.

## Progress

- Repository and existing contracts inspected. Offers absent; digital domain/cart/purchase and transactional email backend already exist. Digital checkout retains the existing address requirement and forbids digital-only pickup. The current workspace is intentionally reused to integrate uncommitted prior work.

- Integration verified: backend 153 tests, frontend 440 tests/build, 42 PostgreSQL components plus Secure session gate, transactional-email provider stub and eight integrated browser tests. Independent review fixes are closed. Claude handoff: `docs/frontend/claude-functional-integration-handoff-2026-10-05.md`.
