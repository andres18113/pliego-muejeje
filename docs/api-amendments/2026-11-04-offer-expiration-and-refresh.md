# API amendment: offer expiry and automatic refresh

Implements [ADR0058](../adr/0058-offer-expiration-and-refresh.md). Existing offer,
monetary, authentication and private SSE payloads remain compatible.

## Public refresh clock

`GET /api/v1/catalog/offer-refresh`, no authentication, `Cache-Control: no-store`.
The response always has exactly these fields:

```json
{
  "serverTime": "2026-11-05T04:59:55Z",
  "nextTransitionAt": "2026-11-05T05:00:00Z",
  "revalidateAfterSeconds": 60
}
```

`serverTime` is the PostgreSQL statement observation instant. `nextTransitionAt`
is the earliest strictly future ACTIVE offer start/end in the database, or null.
It is global, independent of filters/page and conservatively includes hidden or
currently non-discounted editions. It reveals only an aggregate time, no offer
plan or private resource. `revalidateAfterSeconds` bounds the wait before checking
the clock again, including when nextTransitionAt is null. The current value is 60.
RFC3339 offsets represent instants; `2026-11-05T05:00:00Z` equals Ecuador midnight
`2026-11-05T00:00:00-05:00`.

UI integration (Claude): fetch clock before content; schedule the earlier of the
transition or revalidation deadline using server-relative time and monotonic
elapsed time, with request latency accounted for. At that deadline renew the
clock and invalidate mounted price/offer views. Coordinate in-flight reads so an
older response cannot overwrite the refresh. Always revalidate on visibility,
online and stream reconnect/resync. Clamp long timers; avoid immediate retry
loops. This metadata schedules reads; only fresh REST/checkout decides prices.

## Authenticated public-catalog hint

Existing `GET /api/v1/auth/events` additionally delivers to either authorized
role:

```text
id:<existing global decimal cursor>
event:catalog.offers.changed
data:{"resourceType":"edition","resourceId":"123"}
```

`resourceId` is a positive decimal edition ID. This is an invalidation hint,
including administrative edits/clear and observed starts/ends. No price/status,
identity, credentials or private order data is included. Publication/replay,
retention, scoped session authentication and connection limits are unchanged.
Existing private events retain their prior authorization. The schema permits
public scope only for this exact event/type/id shape.

On the hint or resync, invalidate mounted catalog/search/offers/detail,
navigation and filter/facet queries, plus cart, saved-for-later and favorites.
A changed offer can affect list membership/sorting/counts beyond the named item.
Guests use the public clock; no anonymous event stream is added. The dedicated
worker's nominal 1s cadence plus existing SSE 2s publication/read intervals is not
a hard delivery deadline. Expiry pricing is independent of this worker.

## Checkout

Current reads continue to use `[startsAt, endsAt)` at the statement instant.
Checkout captures a single PostgreSQL wall-clock instant after its relevant locks
and prices the entire purchase at that instant. An offer ending at that instant
is excluded. An accepted pre-expiry quote that differs after a lock wait returns
the existing 409 `P4005` (`CART_QUOTE_CHANGED` database code), with no order/payment
or other committed business effects; the UI must obtain and accept a new quote.
Unquoted compatibility commands reprice from the database. Successful idempotent
replays and historical order/payment/invoice snapshots never reprice.

No automatic replacement offers are created. Browser behavior requires Claude's
UI wiring; this amendment supplies its backend contract and shared API client.
