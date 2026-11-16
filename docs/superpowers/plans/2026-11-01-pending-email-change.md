# Pending email change Implementation Plan

> **For agentic workers:** use superpowers:executing-plans; independent mail rendering and release fixture preparation may use parallel agents. No commits or branch integration.

**Goal:** Implement the supplied pending-email contract and verify the complete pending release locally.
**Architecture:** Keep Spring transaction boundaries and business invariants in SECURITY INVOKER PostgreSQL routines; reuse outbox, action HMAC and MailLayout.
**Tech Stack:** Java 25, Spring Boot, Spring JDBC, PostgreSQL 18, Flyway, existing React API generation.
**Spec:** User contract in this session; architecture decisions in docs/adr/0049-pending-email-change.md.

## Global Constraints

- Local only; no commits, pushes, Docker, deploys, production access, Mailtrap API calls or real email.
- Preserve pre-existing work and V001–V093 bytes; add V094+ only.
- Human-facing text Spanish; preserve old machine codes and SQLSTATE mappings.
- Frontend edits only openapi/openapi.json and src/shared/api/generated.ts; UI belongs to Claude.

## Review Focus

- Delayed bounce from an obsolete confirmation must not affect the new request/current account.
- Old cancellation link after resend must still work; after replacement it must fail.
- Confirm uniqueness failure must roll back consumption and all identity/session/outbox effects.
- Concurrent confirmation/cancellation must produce one final identity state and no duplicate notices.
- Sending an expired/replaced token must be fenced at claim/preflight without requeueing HELD.

### Task 1: Persistence and invariants

Files: V094__pending_email_change.sql, V095__email_change_recovery_and_session_fencing.sql, pending_email_change_gate.sql/security_gate.sql, pending_email_change_concurrency.py/security_concurrency.py.
- [x] Write SQL gate covering request/current identity, all token states, rates, resend, expiry, uniqueness race, notices and pending bounce isolation; run RED.
- [x] Implement tables, new public commands/profile/token lookup, claim/preflight and delivery projection; run GREEN.
- [x] Race double confirm and confirm/cancel in committed independent connections; assert one winner.

### Task 2: API and mail

Files: customer and identity service/controller/gateway/profile, security/error handling, token/mail templates/previews and Java tests.
- [x] Pin HTTP/status/body/auth/password behavior with failing tests.
- [x] Implement exact contract and constant-time credential verification with SQL invariants.
- [x] Pin mail copy/routes/recipients/token purpose with failing unit tests, implement, render previews.
- [x] Run focused Java tests and reconcile old immediate-change assertions.

### Task 3: Release verification

Files: PostgreSQL runners/gates, release_pending_upgrade_gate.py, generated OpenAPI/types, release traceability report.
- [x] Create fresh loopback PostgreSQL 18 and realistic V087 fixture database, preserve fixture snapshots.
- [x] Upgrade V088→latest, clean install V001→latest, pending SQL/HTTP/concurrency and restricted-runtime ACL gates.
- [x] Verify all webhook signature/formats/batch/replay/disabled cases against local stubs.
- [x] Export live /v3/api-docs and regenerate only API types.
- [x] Run mvn -q test with full /tmp log; create requirement-to-test matrix including Claude frontend rows.
- [x] Complete broad PostgreSQL gates and remaining plans/ACL separately after new-query registration; verify protected hashes and report exact results/authorization.

Execution notes: independent review identified stale-login issuance and pending confirmation surviving password reset; V095 and RED→GREEN security tests close both. Reset remains available for ADMIN. Other UI files changed concurrently by Claude and were not edited by this implementation. All test logs remain under /tmp.
