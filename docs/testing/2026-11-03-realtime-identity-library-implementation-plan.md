# Local implementation plan — 2026-11-03

The supplied brief authorizes implementation on the current branch, shared workspace,
parallel agents, contract generation and local gates. No commit, deployment or UI work.
Existing screenshot/CSS changes belong to the user and remain outside this patch.

1. Identity/library agent: V101, ADR0055, decision outbox and acknowledgments;
   OWNED-only library. Tests include foreign IDs, idempotency, rollback and history.
2. Registration agent: V102, ADR0056, persisted quotas with trusted remote address;
   neutral registration and continuation responses. Tests include concurrent quotas,
   normalization, expiry, spoofing and duplicates without account access.
3. Index agent: V103, ADR0057, catalog audit and realistically seeded EXPLAIN plans;
   add only justified indexes and publish reproducible evidence.
4. Coordinator: V104, ADR0054, durable scoped SSE invalidation stream with replay,
   retention, session fencing, bounded connections and database-owned expiry events.
   Write SQL/HTTP tests first, then the Database API, gateway, service and controller.
5. Coordinator integrates OpenAPI and the existing type generator, updates the SQL
   runner, executes backend verify, fresh/upgrade gates, TypeScript and Vitest, and
   records each RQ with observed evidence in the requested traceability matrix.

Review focus: foreign resource identifiers; committed events published out of order;
cookie path and native EventSource; multi-instance caps and reconnect gaps; no
registration continuation that grants access to an existing account.

Migration numbers and shared contracts are assigned centrally. Separate disposable
PostgreSQL clusters isolate local experiments. All verbose command output goes to
/tmp logs. The full backend gate is the coordinator's responsibility.
