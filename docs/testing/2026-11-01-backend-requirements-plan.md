# Backend requirements and verification plan — 2026-11-01

Scope: the three requirements supplied by the user on branch
`feat/digital-ownership-post-purchase-search`. Implementation and review are local;
production access, commits, pushes, deployment and UI edits are excluded.

Architecture: retain Controller → Application Service → JDBC Gateway and the
PostgreSQL public Database API. Spring controls transactions. Add migrations
V096 (registration continuation), V097 (pickup), V098 (administrative offer-row
visibility); never modify V001–V095 or the approved archive. Record decisions
after ADR 0049. Preserve pre-existing PNG and test-document modifications.

| Requirement | Implementation / contract | Acceptance evidence |
|---|---|---|
| O1 Expired offers explain the empty page | Trace active window, availability, public filters, preserved October campaign | Existing offers SQL/HTTP gates and documented source locations; no inferred live DB state |
| O2 Prepare a fresh campaign without overwriting history | Duration-based plan, 18–24 eligible CDN-covered editions, balanced formats, approved tier discounts, exclude all October edition IDs | Generator tests, preflight rejects changed prices/stock/existing rows, local API application, format/ending-soon counts |
| O3 API-only administrative application | Dry-run default; existing admin route exposes row existence; existing offer PUT is the only campaign write | Dry-run makes no mutations, refused stale plans, authenticated admin only, public detail/list and cart price verification; expiration rollback gate |
| A1 Registration secret grants no access | Random opaque HttpOnly Secure Strict host-only cookie; hash-only DB; user and sanitized return path binding; TTL no longer than verification | Registration integration tests, cookie assertions, token secrecy and expiry checks |
| A2 Verification and continuation create one normal session | Atomic exchange and same-browser verification; other browsers verify without login | Pending 202, invalid 204, verified 200; two concurrent calls create one session family; documented short replay/refresh recovery |
| A3 Existing authentication fences remain effective | Password reset, email change, logout-all, disablement and password login invalidate/clear continuation | Existing session, email-change and fencing suites plus continuation regression and concurrency tests; CSRF marker and safe return paths |
| P1 Payment-to-pickup target is ten minutes | New pickup snapshots anchor to approval +10 minutes and six-minute deadline; collection must be during opening hours | Exact +10 boundary, closed/near-close cases, cancellation +5:59/+6:01; historical rows retain snapshots |
| P2 Pickup notification transitions are durable | READY sweep and collection enqueue via existing outbox, per-order/kind dedupe, concurrent claims | SQL concurrency/restart tests, cancelled orders excluded, historical ready/collected suppression, existing collect/code verification gates |
| P3 Customer/admin/email/help projections agree | Database timing fields and existing Spanish mail templates; separate handoff of UI copy changes | Pickup and mail tests; frontend generated contract checks only |

Execution uses independent domain workers with separate disposable PostgreSQL 18
databases. Each worker writes domain-specific acceptance cases and evidence before
the combined review. The coordinator inspects the final diff, runs full Maven
verification and the PostgreSQL CI harness, and records exact pass/fail counts.
Verbose logs stay in local files; reports contain summaries and failures.

Review focus: continuation theft/replay and concurrent revocation; existing expired
offer rows invisible to public APIs; offer PUT upsert races; readiness at closing
boundaries; mail queues racing cancellation or a deployment backfill. Campaign
execution cannot atomically reserve a whole batch through the existing REST API:
any residual race or partial application must be stated and made reviewable.

No production command in these documents is authorization to execute it. Campaign
application requires a later explicit user authorization; deployment remains
outside this task.
