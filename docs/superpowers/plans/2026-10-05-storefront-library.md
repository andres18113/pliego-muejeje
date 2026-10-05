# Storefront and library implementation plan

Authority: user request and ADR-0026. Work stays in the existing shared workspace; no commits, pushes or deployment. Approved root baselines and existing migrations remain immutable. User delegates decomposition and execution to the orchestrator; no additional design approval is needed.

## Tasks and ownership
1. Checkout/library agent: V045, checkout request/routines, cart checkout requirements, library module and focused Java/PostgreSQL tests. Preserve existing command receipts; grants are per purchased item with stable customer/edition ownership. Digital-only fulfillment is absent; mixed logistics apply only to physical lines.
2. Storefront/Help agent: V046, catalog media/BEST_SELLING routines, storefront/help modules and focused Java/PostgreSQL tests. Stable 30-day confirmation window, deterministic recent/ID fallback, domain-owned offers and published Help only.
3. Frontend agent: API adapters, query keys/hooks, typed states/routes, catalog sort/media integration and checkout requirements. No final navigation/library/help UI or styling. Integrate exact backend contracts; invalidate authenticated library data on resolved purchases/cancellation.
4. Orchestrator: security/error mappings, live OpenAPI export and generated types, ADR index, test runner integration, disposable PostgreSQL verification, focused E2E, independent review and concise Claude handoff.

## Integration checks
| Producers / consumers | Contract | Resolution |
|---|---|---|
| Checkout / frontend | DIGITAL_ONLY request and authoritative cart requirements | Backend agent sends exact DTOs before frontend implementation |
| Library / frontend | /api/v1/me/library list/detail and genuine available actions | Stable ownership identity; no content actions |
| Catalog/storefront/Help / frontend | productType, BEST_SELLING, navigation/help read DTOs | Backend agent sends exact DTOs; projection uses existing routes |
| Both backend tasks / migration runner | V045 then V046 | Disjoint files; orchestrator updates migration expectations |
| Backend / generated API | OpenAPI and generated.ts | Orchestrator is sole owner after backend integration |

## Verification
Record baseline results, add focused regression tests before behavior, run backend verify and PostgreSQL SQL/HTTP/concurrency gates, regenerate live OpenAPI, run frontend tests/typecheck/build and focused Playwright checks. Store verbose output under /tmp/pliego-architecture-pass and inspect exit status, summaries and failures. Run a separate reviewer over the integrated uncommitted diff; resolve correctness findings before handoff.

## Progress
- Initial discovery: existing stockless digital editions, command receipts, mixed stock handling and independent physical fulfillment reused.
- Ruling: execute in the user's shared checkout with disjoint ownership, because the user requested integrated uncommitted work and delegated sequencing.
- Ruling: no reader/player/progress capability; ownership detail is the academic simulation boundary.
- Ruling: V047 adds immutable ownership/grant source guards and V048 blocks legacy physical status commands for digital-only purchases. These forward-only corrections were identified during invariant/lifecycle review after V045–V046 had been migrated.
- Task 1 implementation complete: ownership-only library, authoritative cart requirements and checkout compositions; live HTTP exposed and corrected customer/admin JDBC address assumptions.
- Task 2 implementation complete: scoped ranking/navigation and published Help; PostgreSQL and focused Java checks green.
- Task 3 implementation complete pending final verification: typed adapters/hooks/states and semantic routes; independent review corrected confirmation fixtures to authoritative fulfillment=null.
- Task 4 integration: fresh Flyway V001–V048 and backend verify (162 tests) passed. Live OpenAPI regeneration, full PostgreSQL gates, frontend/browser checks and independent review in progress.
- Task 4 complete: 162 backend tests, 462 frontend tests, typecheck/build, full PostgreSQL 18 SQL/concurrency/HTTP/session gates, live ownership/navigation browser checks and historical V044→V048 upgrade passed. Independent review accepted after resolving confirmation nullability, handoff paths and safe sign-in returns to library. Existing 44 migrations and 27 tracked root artifacts were hash/content checked unchanged. Final mocked purchase/pickup/navigation browser regression rerun recorded separately.
