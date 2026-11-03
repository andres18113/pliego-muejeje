# ADR0054 — Durable scoped server-sent invalidation events

Date: 2026-11-03. Status: implemented for local review; no production changes.

## Infrastructure and alternatives

The production runbook records one Spring MVC process behind Nginx on one Ubuntu
VPS (2 vCPU, 3.8 GiB RAM), PostgreSQL18, Hikari8, and a Cloudflare proxy. These are
repository observations, not a new live infrastructure inspection. No checked-in
complete Nginx site or systemd unit changes that topology. Java25 is available;
global Spring virtual threads are not enabled in application.yml.

| Mechanism | Fit and operational cost |
|---|---|
| SSE, chosen | Server-to-browser hints over normal authenticated HTTP; native retry and cursor resume. Servlet asynchronous response releases the request thread; writes remain blocking and run on dedicated virtual threads. Nginx buffering must be disabled. |
| WebSockets | Bidirectional protocol and upgrade handling add session/reconnect/heartbeat operations with no required client-to-server messages. Still needs durable fan-out and authorization fencing. |
| Browser polling | Simplest transport, but repeated full REST projections consume database work and add latency even when unchanged. Retained as existing REST recovery on focus/reconnect; no new automatic polling client. |

The old approximate Cloudflare100s assumption is conservative. Current official
documentation lists a **125s Proxy Read Timeout**; this is not a guarantee about
this zone's configuration. A comment immediately and at most every16s keeps well
below either limit. [Cloudflare connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/),
[Spring MVC asynchronous streaming](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-async.html),
[Nginx buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering).

## Authentication and bounded resources

Actual `/me` REST calls use the composite-validated bearer JWT (issuer, audience,
canonical positive subject, known role, UUID jti, timestamps and exact30min life).
The HttpOnly `pliego_session` cookie is an opaque refresh credential scoped to
`/api/v1/auth`, not an access JWT and not sent to `/me/events`. Therefore choose
**GET /api/v1/auth/events** with that existing cookie, preserving its path. Native
`EventSource(url,{withCredentials:true})` requires no token URL or custom header.
Bearer-only requests do not authenticate this endpoint. Existing REST JWT
validation is unchanged. No cookie rotation or business command occurs on this GET.

The Database API resolves only a current refresh digest or its existing5min
rotation grace, an ACTIVE verified customer/admin and a nonrevoked unexpired
session. It rechecks user state/role and session every2s read. Hard60s lifetime
forces reauthentication on reconnect even if a worker is delayed. Four leases per
user are enforced atomically in PostgreSQL across instances;128 streams per
process bound virtual tasks/sockets. 429 `REALTIME_CONNECTION_LIMITED`, Spanish
problem and Retry-After60. Expired leases are recoverable after a crash.
Configured CORS origins and SameSite=Strict remain authoritative; GET requires no
CSRF mutation marker. Last-Event-ID is allowed in CORS. No global cookie path,
JWT-validation or CSRF-policy change is required.

## Durability, ordering and fan-out

Forward V104 attaches lightweight hints to correction requests/acknowledgments,
order/payment/shipment/pickup changes, READY durable notification creation and
digital grants. Rows contain only user/scope, event name, type and ID. The existing
database lifecycle scheduler finalizes stored cancellation deadlines and observes
READY; these committed writes emit hints, without moving eligibility to Java or
the browser. A rolled-back business command leaves no row.

Every instance runs a2s publication sweep. Only publishers serialize on a singleton
cursor row; they assign public event IDs to already committed pending hints in
bounded1000-row batches. Business writers never take that lock. This matters:
an identity sequence allocated inside a business transaction does **not** imply
commit order; assigning replay IDs in triggers could lose a late commit forever.
Readers never see a higher public ID before earlier published batches commit.
No LISTEN connection is reserved from Hikari; each stream briefly calls an indexed
Database API read every2s and releases its connection before sleeping. Every
instance reads the same durable table, so a local broadcast bus is unnecessary.

The read routine is STABLE and read-only: its lease, retention head and event
query share the invoking statement's MVCC snapshot. A deterministic interleave
test reproduced silent loss with VOLATILE when cleanup committed between the
head and event reads, then passed with STABLE. A dedicated retention index and
one captured cutoff avoid scanning the retained hour on every idle sweep. With
200,000 fresh synthetic rows/zero expired, the cleanup selection fell from
20.422ms/3,019 blocks to0.059ms/21 blocks; the new index used6.0MiB. With expired
work both queries remained bounded to1,000 returned rows. These local warm-cache
results and the small write/storage tradeoff are in
`docs/audit/realtime-retention.json`, not production capacity evidence.

Retention is one hour after publication, bounded1000-row cleanup per sweep. A
global retained cursor marks deleted history. Missing, expired, negative/future
cursors require `resync` at the current head; invalid syntax is400. Cursors are
global decimal strings, including checkpoints over other users' rows; cursor
gaps reveal aggregate activity, never payloads or foreign identifiers. Scope is
checked in SQL from the connection lease, never supplied by the client. Repeated
hints and REST reads are safe; clients must not infer state from hints.

At128 streams an instance performs up to64 small indexed reads/s, plus the sweep.
This is an engineering bound, not a production load-capacity claim. Monitor active
leases, oldest unpublished age, retained row count, pool wait and send latency.
Slow socket writes occupy virtual threads; fixed connection lifetime and proxy
send timeout bound recovery. Shutdown completes emitters and interrupts tasks;
leases expire within60s if cleanup cannot reach PostgreSQL. No extra dependency,
PostgreSQL connection pool, Redis, Docker or broker is added.

## Frontend contract (Claude owns implementation)

Response headers: `Content-Type:text/event-stream`, `Cache-Control:no-cache`,
`X-Accel-Buffering:no`. `retry:3000`; immediate and periodic `:heartbeat` comments.
Normal named events have `id:<decimal>` and data
`{"resourceType":"billingIdentity|order|library","resourceId":"<decimal>"}`.
No PII, status, amount, email, JWT or business snapshot is carried. Resource IDs
are internal REST IDs, not public order display references. Native EventSource
keeps Last-Event-ID on automatic reconnect. New instances/page loads receive
`resync`, so active views must always refetch. Heartbeat/checkpoint comments have
no UI behavior. Stream termination reopens after retry and revalidates the cookie.

| Event name | CUSTOMER invalidation | ADMIN invalidation |
|---|---|---|
| identity.correction.created | GET /me/billing-identity | GET /admin/billing-identity-corrections |
| identity.correction.decided | GET /me/billing-identity | GET /admin/billing-identity-corrections |
| identity.correction.withdrawn | GET /me/billing-identity | GET /admin/billing-identity-corrections |
| identity.correction.acknowledged | GET /me/billing-identity | none |
| order.changed | GET /orders and /orders/{id}, related invoice/digital-access views | GET /admin/orders, /admin/orders/{id}, /admin/pickups and /admin/pickups/{id} |
| order.cancellation-window.expired | GET /orders and /orders/{id}, cancellation capabilities | GET /admin/orders, /admin/orders/{id}, /admin/pickups and /admin/pickups/{id} |
| pickup.ready | GET /orders and /orders/{id} | GET /admin/orders, /admin/orders/{id}, /admin/pickups and /admin/pickups/{id} |
| library.changed | GET /me/library, /me/library/{id}, /me/digital-eligibility and /cart | none |
| resync | All mounted authoritative customer REST views | All mounted authoritative admin REST views |

All paths above carry `/api/v1`. `resync` data is exactly
`{"reason":"replay-unavailable"}`. ADMIN sessions receive only admin hints;
CUSTOMER sessions receive only their own hints. Login/logout/session failures
must be resolved by existing auth REST; do not put credentials into EventSource
URLs. Cross-tab coordination and UI integration remain Claude's scope.

Native EventSource does not provide application access to a429 response's
Retry-After header and may treat admission failures as terminal. Claude should
recreate the source after a bounded60s delay on initial failure; use the existing
auth REST flow to distinguish an ended session. The3s retry is for established
streams. Avoid retry loops while hidden/offline and share a stream across tabs.

## Verification

`realtime_events_gate.py` covers SQL isolation, rollback, replay, out-of-order
business commits, concurrent caps, revoked sessions, retention gaps and cleanup.
`RealtimeControllerTest` covers anonymous/bearer refusal,429, malformed cursors,
SSE headers/retry/heartbeat/resync. The consolidated traceability document records
the final integration and HTTP gate results.
