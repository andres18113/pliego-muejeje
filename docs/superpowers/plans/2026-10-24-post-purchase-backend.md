# Post-purchase backend implementation plan

> **For agentic workers:** Execute the authorized request task by task, with independent billing investigation and final review. Do not commit.

**Goal:** Expose source-specific digital ownership on customer order lines and authenticated inline invoice viewing for the separately built UI.

**Architecture:** Preserve Controller → Service → JDBC Gateway and PostgreSQL-owned rules. V077 adds customer read data only. Reuse private invoice artifacts and existing authorization.

**Tech Stack:** Java 25, Spring Boot/JDBC, PostgreSQL 18, Flyway, OpenAPI, Zod.

**Spec:** User's detailed post-purchase request, 2026-10-24; resulting evidence in `docs/audit/post-purchase-2026-10-24/backend-report.md`.

## Global constraints

- Preserve all existing uncommitted work, particularly V076. No commits, JPA, Docker, or business-rule changes.
- Only permitted frontend contract files may change. Do not edit UI, CSS, frontend/tests or docs/design.
- Spanish human-facing validation; stable existing codes and SQLSTATEs.
- Use fresh disposable database names on native PostgreSQL 18 at port 55476.

## Review focus

- Revoked old source followed by repurchase must never appear AVAILABLE on the cancelled order.
- Pending/rejected payments and missing historical grants must not imply access.
- Mixed fulfillment remains physical while digital ownership is immediate on approval.
- Foreign orders must remain indistinguishable from missing orders.
- Inline applies only to PDF; default downloads and artifact readiness behavior remain compatible.

### Task 1: Source-specific digital access

Files: V077 migration; sales OrderModels, CustomerOrderResponses, JdbcCustomerOrderGateway, CustomerOrderController; sales API/gateway tests; new PostgreSQL SQL/HTTP gates; orders.ts and orders.test.ts.

- [x] Add failing contract tests for physical null and digital AVAILABLE/PENDING_PAYMENT/REVOKED/UNAVAILABLE, nullable library ID, and invalid client payloads.
- [x] Extend the canonical customer order detail projection while retaining authorization/reconciliation and all snapshots. Read the grant by order item; AVAILABLE means ownership only, not content delivery.
- [x] Map projected values through gateway/domain/response and Zod. Confirmation already navigates to the customer order detail; verify this and document why checkout receipt stays unchanged.
- [x] Exercise physical-only, digital-only, home-delivery/pickup mixed, cancelled mixed, pending transfer mixed, rejection, finalized ownership and repurchase isolation through PostgreSQL and HTTP.

### Task 2: Invoice viewing

Files: billing controller/service and billing tests; invoice HTTP gate.

- [x] Add failing HTTP tests for optional inline PDF, attachment default, invalid XML disposition, auth/authz, readiness and absence.
- [x] Implement disposition validation at the HTTP boundary and reuse existing download service/Database API.
- [x] Verify generated PDF academic disclosure; inspect credit-note artifact support, adding endpoint only if actual stored documents exist.

### Task 3: Verification and handoff

Files: run_ci_gates.sh, frontend/openapi/openapi.json, frontend/src/shared/api/generated.ts, backend-report.md.

- [x] Run focused tests, full `mvn verify`, then full native PostgreSQL runner with V077 and new gates in fresh databases.
- [x] Export live OpenAPI, regenerate types, run orders contract tests and `npx tsc --noEmit`; report UI errors without editing forbidden paths.
- [x] Independently review the change; verify protected file hashes and write precise rules, JSON examples, file:line citations, commands/counts and remaining limits to the report.


Execution notes: Added a deterministic blocked approval/detail concurrency gate after review identified a stale statement snapshot. Used INLINE plus explicit object/null types to preserve OpenAPI 3.1 nullability. Updated two historical-pricing refund assertions to exclude only live digitalAccess; all immutable fields remain compared. Final verification: Maven320, native PostgreSQL77 gates/Flyway77, orders48 and TypeScript all pass. Detailed evidence and limits are in the audit report. No commits.
