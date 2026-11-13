# ADR 0058: Offer expiration, checkout clocks and browser refresh

Date: 2026-11-04. Status: accepted for implementation within the requested backend scope.

## Context and decision

V044 already makes every live pricing path use the half-open interval `[inicio, fin)`
at PostgreSQL statement time. This includes catalog/search/offers/detail, cart,
favorites, saved items and digital purchases. No job is required to make an offer
expire. `statement_timestamp()` does, however, remain fixed while one checkout
CALL waits for master, inventory or pickup locks. A transaction clock (`now()`)
would be even older. See [PostgreSQL clocks](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

V106 retains statement-consistent live reads and captures `clock_timestamp()` once
inside checkout after its locks, immediately before monetary snapshots. Explicit
time helpers use that same instant for totals, taxes, lines and offer snapshots.
New orders store `pricing_evaluated_at`; old orders remain untouched. This is the
purchase pricing decision instant, not transaction commit time: an order priced
before expiry can finish committing afterwards. Accepted quotes are also checked
against the resulting immutable snapshots; a discrepancy raises the existing
`P4005 / CART_QUOTE_CHANGED` and rolls back every effect. Successful idempotent
replays retain their original result.

Use Spring `@Scheduled` every second, matching existing workers, solely to observe
starts/ends and enqueue invalidation hints. Cron/systemd would add installation,
credentials and coordination outside the application, without improving pricing
correctness. A dedicated single-thread scheduler prevents long mail jobs from delaying this worker.
Spring fixed delay bounds local overlap; PostgreSQL advisory locking
and a bounded `SKIP LOCKED` queue handle multiple instances. Missed starts and ends
coalesce into a hint to refetch current state after restart. Hints and advancement
commit together. Offers remain ACTIVE/INACTIVE historical rows; expiry does not
delete or rewrite them. No new discount is created.

## Browser contract

`GET /api/v1/catalog/offer-refresh` is public and `Cache-Control: no-store`:

* `serverTime`: PostgreSQL observation time, RFC3339 offset timestamp.
* `nextTransitionAt`: earliest strictly future start/end of an ACTIVE offer, or
  null. It is global, conservatively includes hidden/non-discount offers, and is
  independent of page/filter so an empty offers page can discover a future start.
* `revalidateAfterSeconds`: 60; upper bound on metadata revalidation even when no
  known transition exists, covering later administrative edits for guests.

Claude owns UI wiring. Fetch metadata **before** price-bearing content. Schedule
refetch using server-relative time and monotonic elapsed time, including request
latency; do not compare the browser wall clock directly. At the deadline invalidate
all mounted catalog/search/offers/detail/navigation/facet and private cart,
favorites/saved views, then renew metadata. Cancel or await older in-flight reads
so a pre-boundary response cannot overwrite the refresh. Refetch on visibility,
online and reconnect; clamp long timers and avoid zero-delay loops. The backend
cannot update an open browser until that wiring is released. Existing HTTP caches
must respect the existing catalog `no-store` policy; do not retain price responses.

ADR0054 gains one strictly allowlisted **public catalog hint** in the existing
authenticated stream: `catalog.offers.changed`, data
`{"resourceType":"edition","resourceId":"<positive edition ID>"}`.
Both authorized roles may receive it. Public rows cannot carry user IDs, admin
scope, other event names or resource types. All existing private branches, session
checks, replay ordering, publication and retention remain intact. This avoids
one row per registered user and replay gaps from fanout only to current leases.
Administrative offer writes enqueue immediately; scheduled transitions enqueue
after observation (normally 1s plus existing 2s publication/read cadence, not a
hard latency guarantee). REST remains authoritative. Stream resync must also
invalidate mounted public price views. Guests use the refresh clock and bounded
metadata revalidation, without authentication or a public SSE endpoint.

## Monitoring, recovery and limits

`fn_offer_lifecycle_status()` and the catalog lifecycle service expose durable
last-attempt/success/failure timestamps, failure code and counters, processed
transition totals, last batch count/max lag, current pending count/oldest deadline
and lag. Structured scheduler logs carry state, count and lag, or a stable failure
code. A failed transaction records failure in a separate best-effort transaction;
DB outage is detected through growing success age and logs even if this write fails.

The separate observability task should bind: counters for successful/failed runs
and transitions; gauges for seconds since last success, pending count, oldest due
lag and last batch lag; a timer around advancement; health based on stale success
and due lag (allow a startup grace and honor scheduler-disabled). Existing SSE
publication lag must be monitored independently. Do not add Actuator/Micrometer
dependencies here. Batch size is capped at 1000; catch-up may need several runs.
All instants are `timestamptz`; Ecuador display uses America/Guayaquil, UTC-05:00.

Concrete later bindings (no dependency added here):

| Metric / health | Source and aggregation |
|---|---|
| `pliego.offers.lifecycle.success.total` | `successCount`, durable global total; use max across instances, never sum duplicate DB projections |
| `pliego.offers.lifecycle.failure.total` | `failureCount`, same global aggregation |
| `pliego.offers.lifecycle.transitions.total` | `transitionCount`, coalesced offer observations, same global aggregation |
| `pliego.offers.lifecycle.pending` | `pendingCount`, currently due queue rows |
| `pliego.offers.lifecycle.lag.seconds` | `lagSeconds`, DB time minus oldest currently due deadline, zero when empty |
| `pliego.offers.lifecycle.last.success.age.seconds` | DB `serverTime - lastSuccessAt`; missing before the first successful run |
| `pliego.offers.lifecycle.batch.lag.seconds` | `lastMaxLagSeconds`; the last committed batch's largest observed delay |
| `pliego.offers.lifecycle.duration` | Future per-process timer around proxied `advance`, tagged outcome; excludes no database business decisions |
| `offerLifecycle` health | Disabled worker is not DOWN. After 30s startup grace, report DOWN when no success, success age>60s, or current due lag>60s. Include lastFailureCode/lastFailureAt without sensitive exception text. |

The 60s thresholds are operational defaults for a future binding, not a claim of
hard delivery latency. A healthy database with a failed SSE publisher can still
have stale browsers, so retain ADR0054's publication-lag monitoring as well.

## Replenishment

The approved schema, routine catalog, migrations, ADR0052 and November campaign
tool contain authored offers and guarded admin writes, but no authoritative queue
of preapproved successor promotions. The campaign candidate plan is operational
evidence, not ongoing authorization. Automatic replenishment is deliberately absent.
Adding it requires an approved promotion source with author/approval provenance,
edition, exact price, start/end instants, budget/eligibility policy, revocation,
single-row history compatibility, idempotent consumption and audit, plus a separate
architecture/product decision. Expiry alone never authorizes a replacement.

## Validation

See the requirement-to-test matrix in `docs/testing/2026-11-04-offer-expiration.md`.
No production access, release, commit, price changes or UI feature edits are part
of this work.
