# ADR0054 — Durable scoped server-sent invalidation events

Date: 2026-11-03. Status: implemented and accepted in operator/Claude review;
authoritative release gate pending GitHub CI on the final commit; no production changes.

## Infrastructure and alternatives

The production runbook records one Spring MVC process behind Nginx on one Ubuntu
VPS (2 vCPU, 3.8 GiB RAM), PostgreSQL18, Hikari 8, and a Cloudflare proxy. These are
repository observations, not a new live infrastructure inspection. No checked-in
complete Nginx site or systemd unit changes that topology. Java 25 is available;
global Spring virtual threads are not enabled in application.yml.

| Mechanism | Fit and operational cost |
|---|---|
| SSE, chosen | Server-to-browser hints over normal authenticated HTTP; native retry and cursor resume. Servlet asynchronous response releases the request thread; writes remain blocking and run on dedicated virtual threads. Nginx buffering must be disabled. |
| WebSockets | Bidirectional protocol and upgrade handling add session/reconnect/heartbeat operations with no required client-to-server messages. Still needs durable fan-out and authorization fencing. |
| Browser polling | Simplest transport, but repeated full REST projections consume database work and add latency even when unchanged. Retained as existing REST recovery on focus/reconnect; no new automatic polling client. |

The old approximate Cloudflare 100s assumption is conservative. Current official
documentation lists a **125s Proxy Read Timeout**; this is not a guarantee about
this zone's configuration. A comment immediately and at most every 16s keeps well
below either limit. [Cloudflare connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/),
[Spring MVC asynchronous streaming](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-async.html),
[Nginx buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering).

## Authentication and bounded resources

Actual `/me` REST calls use the composite-validated bearer JWT (issuer, audience,
canonical positive subject, known role, UUID jti, timestamps and exact 30min life).
The HttpOnly `pliego_session` cookie is an opaque refresh credential scoped to
`/api/v1/auth`, not an access JWT and not sent to `/me/events`. Therefore choose
**GET /api/v1/auth/events** with that existing cookie, preserving its path. Native
`EventSource(url,{withCredentials:true})` requires no token URL or custom header.
Bearer-only requests do not authenticate this endpoint. Existing REST JWT
validation is unchanged. No cookie rotation or business command occurs on this GET.

The Database API resolves only a current refresh digest or its existing 5min
rotation grace, an ACTIVE verified customer/admin and a nonrevoked unexpired
session. It rechecks user state/role and session every 2s read. Hard 60s lifetime
forces reauthentication on reconnect even if a worker is delayed. Four leases per
user are enforced atomically in PostgreSQL across instances; 128 streams per
process bound virtual tasks/sockets. 429 `REALTIME_CONNECTION_LIMITED`, Spanish
problem and Retry-After 60. Expired leases are recoverable after a crash.
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
bounded 1000-row batches. Business writers never take that lock. This matters:
an identity sequence allocated inside a business transaction does **not** imply
commit order; assigning replay IDs in triggers could lose a late commit forever.
Readers never see a higher public ID before earlier published batches commit.
No LISTEN connection is reserved from Hikari; each stream briefly calls an indexed
Database API read every 2s and releases its connection before sleeping. Every
instance reads the same durable table, so a local broadcast bus is unnecessary.

The read routine is STABLE and read-only: its lease, retention head and event
query share the invoking statement's MVCC snapshot. A deterministic interleave
test reproduced silent loss with VOLATILE when cleanup committed between the
head and event reads, then passed with STABLE. A dedicated retention index and
one captured cutoff avoid scanning the retained hour on every idle sweep. With
200,000 fresh synthetic rows/zero expired, the cleanup selection fell from
20.422ms/3,019 blocks to 0.059ms/21 blocks; the new index used 6.0MiB. With expired
work both queries remained bounded to 1,000 returned rows. These local warm-cache
results and the small write/storage tradeoff are in
`docs/audit/realtime-retention.json`, not production capacity evidence.

Retention is one hour after publication, bounded 1000-row cleanup per sweep. A
global retained cursor marks deleted history. Missing, expired, negative/future
cursors require `resync` at the current head; invalid syntax is 400. Cursors are
global decimal strings, including checkpoints over other users' rows; cursor
gaps reveal aggregate activity, never payloads or foreign identifiers. Scope is
checked in SQL from the connection lease, never supplied by the client. Repeated
hints and REST reads are safe; clients must not infer state from hints.

At128 streams an instance performs up to 64 small indexed reads/s, plus the sweep.
This is an engineering bound, not a production load-capacity claim. Monitor active
leases, oldest unpublished age, retained row count, pool wait and send latency.
Slow socket writes occupy virtual threads; fixed connection lifetime and proxy
send timeout bound recovery. Shutdown completes emitters and interrupts tasks;
leases expire within 60s if cleanup cannot reach PostgreSQL. No extra dependency,
PostgreSQL connection pool, Redis, Docker or broker is added.

The initial 2026-11-03 qualification bounded only reads. An eight-second
lease-table stall caused seven blocked disconnects and unrelated REST waits of
1.54–5.52s. The release correction uses one **fair four-permit budget** for every
per-connection admission, read and cleanup call, acquired in `RealtimeStreams`
before invoking the proxied transactional `RealtimeService`. Four is half the
production Hikari 8 pool. The independent publisher remains outside the stream
budget, with at most one scheduled transaction per instance: SSE accounts for at
most five pool connections, leaving three for other work when SSE is the source
of contention. This is a bound on SSE usage, not a reservation against unrelated
REST/background transactions. No second pool, dependency or schema change is added.

Reads/admissions use a fair timed wait of at most 2s; failed read admission still
runs the independent heartbeat/lifetime checks. Cleanup waits at most 100ms for
the same budget and falls back to the existing 60s lease on failure. Cleanup may
temporarily clear an existing shutdown interrupt for this bounded best effort,
then restores it. All paths release the permit after the proxied transaction
returns and before any socket write. Publisher cadence and behavior are unchanged.

Connect, read and disconnect each have a one-second Spring transaction timeout.
Inside these transactions, the JDBC gateway sets `SET LOCAL lock_timeout='100ms'`
and `SET LOCAL statement_timeout='1s'` before calling the unchanged public
Database API. Both SET commands and the routine SELECT are submitted through one
prepared JDBC execution, with explicit String/UUID/BIGINT bindings (including a
nullable replay cursor). The gateway consumes the SET update counts, validates
the routine's single-column/single-row result and closes/drains JDBC resources.
This removes a separate configuration execution per poll without moving a setting
inside the already-running routine statement. It relies on the tested PGJDBC
composite-query behavior; no unmeasured on-wire roundtrip count is claimed.
These execution settings reset on commit/rollback, including on a reused physical
connection; they do not replace database business invariants.
Native tests repeat seven connect/read-null/read-cursor/disconnect cycles on the
same pooled backend, checking both local settings and their reset after each call,
as well as all three lock/rollback paths.
No V106 is required because no database object or persistent policy changes.
Transaction timeout does not include Hikari acquisition time. The stream budget
limits that path's contribution to pool occupancy before any borrow.

Admission budget exhaustion or PostgreSQL55P03/57014 uses the existing
429 `REALTIME_CONNECTION_LIMITED` / Retry-After 60 contract. Other database errors
keep their approved SQLSTATE/error mappings. Public Spanish problem text is
unchanged; OpenAPI clarifies temporarily busy admission. Failed reads end the
stream for normal reconnect; failed cleanup leaves the lease to expire.

The global handler recognizes only the exact events URI with an already
committed `text/event-stream` response. Expected client aborts, async completion
and timeout are normal closes logged at most at DEBUG; no ProblemDetail is
written into that stream. Unexpected server failures reaching the established-stream MVC handler
still log ERROR with the exception, while ordinary REST and pre-stream errors
retain their Spanish ProblemDetail behavior.

Completed local tests and both 128-stream lock experiments pass the corrected
fault-containment requirements. Healthy performance is mixed, not proof of zero
overhead. The operator cancelled local execution after the host's unexpected
shutdown and unrelated native PG/JVM failures. Every local full-gate attempt is
ENVIRONMENT-INVALID and excluded from product acceptance; neither a full pass
nor a product NO-GO is inferred from those attempts. GitHub CI, using Temurin
selected by `.java-version` on clean runners, supplies the authoritative full
PG18 gate result for the final commit. No such final-commit result is claimed here.

A contended cleanup can leave its lease counting against the 4/user cap for up
to 60s. Hikari acquisition is outside the 1s deadline, and other work can exhaust
the remaining pool slots. The abort classifier includes specific Spring async
exception-message matches, so Spring upgrades require classification regression
tests. No Cloudflare, production-load or 3.8GiB memory-pressure proof is implied.

[The retained-evidence report](../testing/2026-11-03-sse-proxy-and-capacity.md)
records the before/after fault experiments, settings/reset integration tests,
resource parity and qualification limits.

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
recreate the source after a bounded 60s delay on initial failure; use the existing
auth REST flow to distinguish an ended session. The 3s retry is for established
streams. Avoid retry loops while hidden/offline and share a stream across tabs.

## Verification

`realtime_events_gate.py` covers SQL isolation, rollback, replay, out-of-order
business commits, concurrent caps, revoked sessions, retention gaps and cleanup.
`RealtimeControllerTest` covers anonymous/bearer refusal,429, malformed cursors,
SSE headers/retry/heartbeat/resync. The consolidated traceability document records
the final integration and HTTP gate results.

## Frontend contract correction (2026-11-04)

The first production frontend built the stream URL by appending `/auth/events` to `VITE_API_BASE_URL`. Production
configures the bare API origin, so browsers requested `https://api.pliegolibros.com/auth/events` — a path that does
not exist and to which the `/api/v1/auth`-scoped cookie is not sent — and never synchronized (investigation:
`docs/testing/2026-11-04-cross-device-realtime-investigation.md`). The stream URL is now built like every API call,
`apiUrl("/api/v1/auth/events")` from the shared normalized origin; tests pin every accepted form of the variable.
The client also coordinates tabs only with both Web Locks and BroadcastChannel, reconnects on `online` only as the
leader, yields stream and lock on `freeze`/`pagehide`, rejoins on `resume`/`pageshow`, and re-reads mounted private
views when a tab returns to view. A build ID and `/version.json` let open tabs offer a reload after a release. No
backend, protocol, polling or WebSocket change was needed.
