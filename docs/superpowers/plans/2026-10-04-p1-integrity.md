# P1 integrity corrections implementation plan

**Goal:** Fix only the four confirmed P1 defects; preserve PLIEGO's visual language and payment simulation.
**Architecture:** Spring transactions and JDBC public Database API calls. PostgreSQL owns keyed command replay, attempt fencing and optimistic profile concurrency. Add migrations; do not edit approved artifacts.
**Spec:** User's confirmed P1 audit scope, 2026-10-04.
**Constraints:** No redesign, P2 changes, credentials, commits, pushes or deployment. Spanish feedback. Execute inline under the user's authorization.

## Tasks

- [x] Reproduce checkout's false absence conclusion with a RED component test. Add keyed checkout and a transaction-safe resolver returning PENDING, CREATED or NOT_CREATED; fence delayed requests before declaring absence. Persist unresolved keys across page reloads. Test replay, rollback, ownership, late commit and delayed arrival.
- [x] Reproduce duplicate addresses by replaying the same HTTP create request and losing a frontend response. Add actor-scoped idempotency keys and an attempt resolver. Persist unresolved keys; resolve before creating another address. Test same/different payloads, deletion, rollback and concurrent replay.
- [x] Reproduce stale profile overwrite with a RED component test and a live HTTP test. Add monotonic profile versioning and precise PATCH with expectedVersion; guard replacement PUT too. Reject stale updates, preserve drafts and require review; reconcile lost responses by reading server state.
- [x] Reproduce misleading payment controls with a RED component test. Use existing styles to explicitly label the development simulation, test-only card fields, simulated approval and absence of real charges. Preserve validators and deterministic test payment behavior.
- [x] Document amended REST/Database API contracts and ADR. Regenerate OpenAPI client types. Run targeted regressions, full Maven verify, PostgreSQL 18 SQL/concurrency/HTTP/Flyway gates, frontend tests/typecheck/build and full Playwright. Preserve logs; report only outcomes and genuine risks.

Verification: [executed results and remaining out-of-scope gate failures](../../testing/p1-integrity-verification-2026-10-04.md).
