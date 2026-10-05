# ADR-0018: Resolve command outcomes and reject stale profile writes

## Status
Accepted within the authorized P1 correction scope (2026-10-04).

## Decision
Retain Controller → Spring application transaction → JDBC public Database API. Add actor-scoped UUID idempotency keys for checkout/address POSTs. Store immutable command fingerprints and original result snapshots in typed PostgreSQL ledgers, in the same transaction as business effects. Do not store PAN/CVV. Replays return the original result and never consume a new cart or recreate a deleted address. Different input with the same key is a conflict.

Resolution is a POST because it can permanently fence an attempt. A transaction-scoped advisory lock is shared by execution and resolution. A nonblocking resolver returns PENDING when execution holds the lock; after acquiring it, it returns the committed result or records NOT_CREATED. That terminal absence prevents a delayed original command from executing later. No list, timing threshold or transient empty read proves failure. Unknown transport responses retain the actor's pending key in browser local storage across remounts/reloads. Storage failure prevents a new command from being sent without recovery information. Native Web Locks serialize actor/operation claims across tabs; unsupported contexts fail closed. Each key has an independent durable recovery record so a shared-pointer change cannot erase an in-flight attempt. Async completion stays bound to the submitted key.

Profile reads expose a monotonic decimal version. A database trigger increments it whenever names/phone actually change, including existing routines. Precise PATCH and replacement PUT compare expectedVersion while holding the customer row lock. A mismatch returns P1104/409 and changes nothing. The editor retains the original version across background refreshes; conflicts require deliberate review. Lost responses are reconciled by reading only the edited field and version, without replaying a replacement of unrelated fields.

## Consequences
UUID keys and expectedVersion are contract requirements for HTTP writes. Existing approved SQL routines remain available as delegates; approved migrations are untouched. New error mappings are additive. Ledgers/tombstones must not be pruned while delayed requests or replay remain possible. Pending recovery metadata contains only user ID and UUID, not personal/card data. Browser storage loss cannot recover an unknown key; the backend still deduplicates requests carrying that key. Checkout's test payment behavior remains deterministic and visibly simulated.

## Validation
RED component and live HTTP regressions reproduce the four confirmed defects. PostgreSQL tests exercise concurrent replay, pending commit/rollback, delayed arrivals, per-actor ownership, key conflicts and optimistic concurrency. Full Maven/frontend/PostgreSQL/Playwright gates protect current behavior.
