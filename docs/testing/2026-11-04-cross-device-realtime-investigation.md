# Cross-device billing identity synchronization investigation

Investigation label: 2026-11-04; execution started 2026-11-03 UTC. Source:
`ec48e071854916cdf1051016e0c49fac9145e216`, release reported by the operator:
`20261103T204931Z-ec48e07`, activated 2026-11-03 21:19Z. Existing local operator
changes were preserved. No production access, commit, push, merge or deployment.

## Finding and scope of proof

The retained release frontend artifact contains the wrong SSE URL. In
`frontend/src/app/realtime/RealtimeSync.tsx:7`, the configured API base is treated
as a path ending in `/api/v1`. Production builds instead supply the backend
**origin**, as supported by `frontend/src/shared/api/client.ts:6` and documented
in `frontend/.env.example:2` and the production runbook. Therefore:

```text
VITE_API_BASE_URL=https://api.pliegolibros.com
REST GET: https://api.pliegolibros.com/api/v1/me/billing-identity  (correct)
SSE GET:  https://api.pliegolibros.com/auth/events                (incorrect)
expected: https://api.pliegolibros.com/api/v1/auth/events
```

The existing HttpOnly cookie's `Path=/api/v1/auth` excludes `/auth/events`.
`withCredentials:true` cannot override cookie path matching. The backend maps
only `/api/v1/auth/events`. The default local Vite configuration `/api/v1` masks
this defect, as did the scripted production client that explicitly used the
correct path. Its successful 200/heartbeats/resume/created/withdrawn observations
are entirely compatible with a broken browser connection.

This is confirmed in the **retained release artifact**, not merely inferred
from source. `.release-evidence/2026-11-03/deploy/artifacts/candidate-manifest.json`
identifies source `ec48e07` and `frontendChecks.apiBaseUrl` as the production
origin. Its `frontend-dist.tar` SHA-256 is
`17182e41dc84288ca4904bd47762bef86c693e779bf22fefd0c807b31a1f663e`.
The contained `assets/index-CTdJuWHk.js` SHA-256 is
`889adae2ee6861619f178d776f5f0700c95ac3d045a087506e62e542eddf65f2`.
Both match the manifest. The compiled expression is:

```js
var Es = `${`https://api.pliegolibros.com`.replace(/\/$/, ``)}/auth/events`;
```

Forensic extraction is saved in
`.release-evidence/2026-11-04/release-bundle-forensics.json`. Claude must compare
the installed asset/hash to establish that these are the bytes served in
production; this investigation did not read the production host or browser.
An already-open tab running the previous `64e3c60` bundle has an independent
failure: it contains no `RealtimeSync` at all. Even a corrected deployment
cannot inject new JavaScript into an existing document.

## Work sequence and boundaries

1. Read AGENTS.md, ADR0054/0055, decision SQL/service/gateway, realtime module,
   browser session lifecycle, query invalidation and profile rendering.
2. Build the current application and previous frontend; run native PG18,
   real HTTP SSE and separate customer desktop / admin mobile browser contexts.
3. Observe each boundary before considering a backend change; exercise failure
   and recovery separately from the production build URL.
4. Add the missing cross-session approval HTTP regression; propose frontend
   changes and validate isolated candidates without editing frontend app code.

Native PostgreSQL only, no Docker, no protected ports 5432/55436. Persistent
ignored evidence is under `.release-evidence/2026-11-04/`. Local credentials
remain only in ignored mode-0600 fixture files. No approved migration or baseline
was changed. This investigation did not modify frontend application, feature,
UI, CSS or design files. Concurrent external edits appeared in frontend feature
files at approximately 21:52Z and later in the REST client; they were preserved
and are excluded from this work. Browser baseline builds completed at 21:49Z,
before those edits, and were not replaced with the subsequently dirty source.

## End-to-end flow trace

| Boundary | Actual implementation and expected observation |
|---|---|
| Mobile admin command | `/admin/correcciones` → Aprobar → confirmation dialog → `POST /api/v1/admin/billing-identity-corrections/{id}/decision`, body `{"decision":"APPROVE"}`. Viewport/device changes no backend decision semantics. |
| Controller → application → JDBC | `AdminBillingIdentityCorrectionController.decide` obtains the ADMIN actor from authentication → `BillingIdentityCorrectionService.decide` owns `@Transactional` → `JdbcBillingIdentityCorrectionGateway.decide` calls `sp_admin_billing_identity_correction_decide`. |
| Database API | V080 wrapper delegates to `sp_billing_identity_correction_apply(...,'STAFF_REVIEW',...)`. It changes the customer's identification and updates the same request's `estado`, `decidido_en`, and `decidido_por`. The other correction path is a direct correction without an admin request, so it is not an alternate approval path. |
| Trigger inside decision transaction | V104 `trg_realtime_correction` AFTER INSERT OR UPDATE invokes `fn_realtime_resource_hint`. A changed status other than WITHDRAWN becomes `identity.correction.decided`; `NEW.cliente_id` resolves the **customer's** `cliente.usuario_id`. Resource type `billingIdentity`, resource ID `NEW.solicitud_id::text`. It inserts one customer-scoped and one admin-scoped hint. V101 mail insertion is in the same transaction; failure rolls back the decision and both hints. |
| Commit → publication | Every two seconds `RealtimePublisher` → transactional service → `fn_realtime_publish(1000)`. The sweep sees committed rows only and serializes publishers on the singleton cursor. Public IDs are assigned after business commit. Admin streams read their own scope; they do not consume or steal customer events. |
| Lease/read → SSE | Cookie admission uses current or previous digest within five-minute rotation grace; the admitted lease stores **session_id**, user and role, not the digest. `fn_realtime_read` checks session validity/role with a STABLE statement snapshot and independent per-stream cursor. `RealtimeStreams` polls at two seconds, writes `id`, named `event`, and only resource type/ID, with heartbeats and a nominal 60-second lease. |
| Browser receipt | `RealtimeSync` constructs the URL. This is the retained artifact's first broken browser boundary: origin-only production configuration omits `/api/v1`. With the correct local URL, the Web-Lock leader receives the named event and relays a validated hint through BroadcastChannel. Frozen-leader and online/follower limitations are evaluated separately below. |
| Invalidation → authoritative read | `realtimeInvalidation.ts` maps `identity.correction.decided` for CUSTOMER to exactly `["customer-billing-identity"]`. `invalidateQueries` defaults to refetching active queries and marking inactive ones stale. It does not derive APPROVED from an SSE hint. |
| Render | `AccountPage.tsx:50` mounts that query without an `enabled:false` condition and with `refetchOnMount:"always"`. GET `/me/billing-identity` returns the approved identity and unacknowledged decision; `CorrectionStatus` → `CorrectionDecision` renders “Aprobamos tu corrección…”. Changed fields survive structural sharing. For a fresh request without a newer request, acknowledgment hides the notice; V101 also applies latest/pending selection and a 30-day terminal-request window. |

## Hypotheses

| Hypothesis | Evidence and conclusion |
|---|---|
| H1 old bundle | Confirmed source difference: `64e3c60` lacks the realtime files and root layout mount. There is no application build-version check or service worker upgrading a live document. This can explain a pre-deploy tab; the operator tab's exact bundle remains unobserved. |
| H2 background/frozen leader | The lock is held until `startRealtime` cleanup, not until a stream's 60-second expiration. No visibility, freeze, resume or pagehide handler transfers leadership. Healthy background execution and actual frozen execution must be distinguished in the matrix. |
| H3 session/reconnect | The premise “lease bound to digest” is incorrect after admission: V104 stores `session_id`, and refresh keeps that session. `RealtimeSync` depends on user ID/role, so a same-user token rotation intentionally does not recreate it. Native reconnect carries the new cookie. CLOSED sources are manually recreated with jittered 3/6/12/24/48/60-second backoff; established native retries keep Last-Event-ID. One confirmed client bug: `addOnline` opens a source in a **waiting follower**, bypassing its pending lock. |
| H4 decision target/commit/publication | No defect found. The new real HTTP regression submits a request and approves it as ADMIN while customer and admin streams are already open. Scheduled publication alone delivers both decided hints and the customer's REST projection is APPROVED. No direct enqueue/manual publish substitutes for this path. |
| H5 query/refetch/render | The billing key matches. No custom staleTime/disabled query prevents this mounted refetch; global `refetchOnWindowFocus:false` does remove a fallback after a missed hint. On another route, inactive queries are stale but not refetched until needed; Mi perfil refetches on mount. No global decision notice exists on unrelated pages; that is current presentation scope, not proof of transport failure. |
| H6 cross-origin/cookie | Confirmed production **path-construction** error above. `EventSource` already uses `withCredentials:true`; cookie Path, SameSite=Strict and Secure need no broadening. The two HTTPS subdomains are same-site. CORS allows configured exact origins, credentials and Last-Event-ID. No Safari/Firefox-specific cause is claimed. |

## Frontend proposals for Claude — not applied

1. **Correct URL normalization first.** In `RealtimeSync.tsx:7–9`, use the same
   origin normalization as `shared/api/client.ts`, then append the complete
   `/api/v1/auth/events`. Accept the existing origin-only setting, `/api/v1`,
   and an absolute URL ending in `/api/v1`, including a trailing slash. Prefer
   one shared URL helper to prevent REST/SSE disagreement. Do not add a backend
   alias at `/auth/events`: that would conceal the client defect and still
   miss the correctly scoped cookie.
2. **Honor ownership on recovery.** In `startRealtime`, track whether the lock
   callback has granted leadership; `online` may reconnect only the leader,
   or an intentionally independent tab. Coordinate with Web Locks only when
   BroadcastChannel is available; otherwise use independent bounded streams.
   Current real-lock module probe opens `[1,1]` streams after an online event
   while the second tab still waits; an isolated candidate keeps `[1,0]`.
   With relay unavailable, current startup `[1,0]` becomes candidate `[1,1]`.
   These candidate changes exist only under ignored evidence, not app source.
3. **Make leadership lifecycle-aware.** Add explicit visibility/freeze/pagehide
   cleanup and resume/pageshow acquisition in `realtimeConnection.ts`; prefer
   a visible tab and revalidate active private REST views on return. Test a
   frozen leader with a still-visible follower, thaw, bfcache restoration and
   offline recovery. Releasing a stream does not release the Web Lock: both
   must be managed. Do not reset the mounted user's session solely because
   EventSource cannot expose the status of a failed admission.
4. **Handle existing versions deliberately.** Add a build identifier and a
   no-store version check on startup and visible/pageshow/online transitions,
   with a Spanish update/reload affordance that preserves unsaved work.
   A future check cannot retrofit `64e3c60`: existing old tabs need a reload
   for this release. Version checks are separate from business-data polling.
5. **Keep authoritative invalidation.** Retain the billing key and active-query
   behavior. A visibility/resume resync gives recovery after suspension or a
   failed REST read. `AccountPage` currently handles 401 only for the profile
   query, and suppresses identity-query errors when cached data exists
   (`failed: identityQuery.isError && identityQuery.data === undefined`);
   propose handling identity 401 through session recovery, explicitly refetching
   the identity after successful recovery, and exposing stale identity/refetch
   errors. Refreshing a same-user session alone does not change this query key
   or restart RealtimeSync. These are source-level recovery gaps, not a
   reproduced cause of this operator incident. Decide separately whether product scope calls for a
   global notice outside Mi perfil; it is not necessary to repair this path.

No polling of business resources, WebSocket, extra pool, broker or migration is
justified by these findings. No architectural behavior was changed, so no ADR
addendum or V106 is warranted.

## Real-browser reproduction setup and evidence

The disposable stack uses PostgreSQL **18.6** on loopback **55447**, persistent
data under the ignored evidence directory, 105 successful migrations through
V105, Java 25, backend **18087**, Hikari maximum **8**, and local HTTP cookie
Secure=false. No process used ports 5432 or 55436. Frontend builds are served
through a loopback static reverse proxy: current default `/api/v1` at **5180**,
previous `64e3c60` at **5178**, origin-only configuration at **5179**, and its
URL-only candidate copy at **5181**. The Vite server at **5177** supports the
isolated module probes. All runtime data and credentials are synthetic.

Initial cluster setup used `/tmp/pliego-browser-pg18-1104`. After the tests it
was cleanly shut down and moved intact to
`.release-evidence/2026-11-04/browser/pgdata`, then restarted on 55447. Pre/post
cluster identifier **7704065239210582029**, V105, **26 requests** and **293 event
rows** match. `pg-before-move.json` and `pg-after-move.json` preserve that check;
the coordinator independently verified the final data directory and counts.
At handoff native PG remains running; disposable backends/proxies were stopped.
After the final refresh/reconnect qualification, the same persistent cluster
contains **27 requests and 303 events**, still V105 (`pg-final-state.json`).

Every matrix row uses a new CUSTOMER desktop browser context and an independent
ADMIN context with Playwright's **Pixel 7** descriptor. Mi perfil is open before
the correction is created/decided. A disposable helper creates the customer's
request through its real API; the administrator then navigates the real
`/admin/correcciones` UI, clicks **Aprobar**, and confirms **Aprobar corrección**
in the real confirmation dialog. Screenshots include the mobile confirmation
and desktop result. No approval REST mock substitutes for this UI journey.

Chromium **153.0.8010.12** runs headfully using the existing display. Playwright
normally forces every page focused/visible and disables background throttling.
A copied Playwright runtime under ignored evidence disables only its forced
focus override; normal background flags are removed for authentic visibility
runs. Neither installed dependencies nor application source was edited for this.
Actual `document.visibilityState`, native Web-Lock ownership/queue, and CDP
lifecycle events are recorded. Initial headless/default-focus attempts are not
accepted as hidden-tab evidence. The early frozen attempt whose second tab was
on the catalog is also excluded: that page could not render a profile notice.

Instrumentation records CDP Network requests/responses and named EventSource
events/IDs, source creation/open/error, BroadcastChannel send/receive, billing
REST reads, and DOM notice appearance. Cookie metadata uses
`Network.requestWillBeSentExtraInfo` and stores only name/path/blocked reasons
and a presence boolean. The ordinary request event's `hasCookie:false` field
is not authoritative because CDP can omit cookie headers there. Cookie values,
access tokens and request Authorization headers are not copied into evidence.

For the production-configured reproduction, `/auth/events` returned **401
application/problem+json**, the cookie was excluded as **NotOnPath**, and no
notice/refetch appeared during the 15-second observation after a real approval.
Only changing the URL in a copied built bundle to `/api/v1/auth/events` produced
**200 text/event-stream**, an included session cookie and an automatic notice.
The wrong-path result is a local backend observation; no production status is
inferred without inspecting that site's routing.

The frozen-leader case gives an especially precise boundary: for request **19**,
customer event **222** and admin event **223** were published **1.586s** after
enqueue, both **before** thaw at 21:57:20.308Z. The visible follower stayed stale
through the ten-second frozen observation. Thaw immediately released execution
of event delivery → BroadcastChannel → billing refetch → render, with both
notices rendered within **14ms**. Thus the failure was after durable publication, in the browser leader's
suspended execution/relay, rather than admin targeting or database publication.
The SQL proof is `browser/frozen-publication-before-thaw.txt`.

The final 190-second soak recorded SSE opens at 22:08:59.996Z, 22:10:03.091Z,
22:11:06.164Z and 22:12:09.231Z, using **one EventSource object**. At 80.023 seconds
it triggered the existing SessionProvider visibility refresh path by advancing
`Date.now` only during dispatch and immediately restoring it. POST
`/auth/refresh` (`252.133`) returned **200** with Set-Cookie at 22:10:22.953Z;
an aggregate-only database check confirmed persisted rotation at 22:10:22.916Z
without revocation (`early-refresh-session-rotation.json`). Real JWT validation
and SSE clocks were unchanged.

Two native reconnect requests **after rotation**, `252.134` at 22:11:06.149Z and
`252.135` at 22:12:09.222Z, both sent **Last-Event-ID: 307** and the session cookie
with the correct path and no blocked reasons, and both returned **200 SSE**.
These occurred 43.196s and 106.269s after the accepted refresh and before the real
admin approval at 22:12:13.352Z. The customer received decided event **308** and
rendered without reload in **1.893s**. This proves reconnect across four stream
lifetimes and across a forced normal refresh; it does not claim a real 30-minute
wall-clock soak. The earlier soak refreshed only at its end; it is retained as
prior evidence but is superseded for this matrix row.

Initial 401/429 admissions were fault-injected once at the browser routing layer,
then allowed through to the real server. CLOSED sources reopened after **2.718s**
and **2.944s**, respectively, and subsequent real approvals rendered. This
qualifies client recovery, not production authorization or quota exhaustion.
The 429 test also confirms that the client does not honor a 60-second admission
Retry-After; native EventSource does not expose that header to its callback.

### Reproduction matrix

Times below are seconds from the administrator's confirmation click to the
observed customer GET, decided BroadcastChannel receipt, and DOM notice. They
include the admin command and scheduled publication, not just network transit.
Node/CDP instrumentation can reorder observations by a millisecond; this is
functional evidence, not a latency benchmark. A dash means no matching decided
relay, not necessarily no resync relay. All IDs are disposable fixture IDs.

| Scenario | Result | Request / SSE event ID | Billing GET | Decided relay | Notice render |
|---|---|---|---:|---:|---:|
| Customer visible | PASS | 13 / 148 | 2.753 | — | 2.758 |
| Mi perfil actually hidden; second tab focused | PASS | 14 / 158 | 2.654 | 2.655 | 2.661 |
| Different hidden leader; Mi perfil visible follower | PASS | 18 / 212 | 2.629 | 2.629 | 2.635 |
| Leader frozen, Mi perfil follower visible | **FAIL while frozen**, recovers on thaw | 19 / 222 | 10.154 | 10.154 | Both within 10.164; 0.014 after thaw |
| 190s, four SSE lifetimes, two reconnects after token refresh | PASS | 54 / 308 | 1.885 | — | 1.893 |
| Offline → online, hidden profile | PASS via resync | 20 / resync 233 | 2.147 | 2.146 (resync) | 2.155 |
| Actual backend SIGTERM and JVM restart | PASS | 25 / resync 281, decided 282 | 2.856 | — | 2.864 |
| Previous `64e3c60` frontend / new backend | **FAIL**, no SSE or live GET in 15s; F5 control passes | 26 / none | — | — | — |
| Current origin-only production configuration | **FAIL**, wrong URL, 401, no successful stream in 15s | 9 / none | — | — | — |
| Copied origin-only bundle, URL corrected | PASS | 10 / 118 | 0.730 | — | 0.737 |
| Initial 401 then healthy SSE admission | PASS | 11 / 128 | 1.399 | — | 1.413 |
| Initial 429 then healthy SSE admission | PASS | 12 / 138 | 1.622 | — | 1.631 |

Authoritative row sources: `browser-authentic.ndjson` for visible/hidden;
`browser-authentic3.ndjson` for different leader/frozen/offline;
`browser-early-refresh.ndjson` for the soak; `browser-restart-clean.ndjson` for restart
and the old-bundle positive control; `browser-url-admission.ndjson` for the
origin comparison and admission faults. `browser/matrix-summary.json` links
each row's HTTP request ID, SSE IDs, open times and source log. Original
`results-*.json`, mobile confirmation screenshots and profile screenshots are
retained beside those files.

The H1 test checks the actual old UI, not the newer notice text which that
bundle never renders: before F5 the old identification remained, the proposed
identification and legacy “Corregida según tu solicitud…” copy were absent,
and there was no SSE or live billing GET. After explicit F5 both the proposed
identification and old approval copy appeared. That control reload is recovery
by reload, not an automatic update, and is excluded from live timing columns.

The accepted restart logs record SIGTERM, JVM exit **143**, a new JVM becoming
ready, browser reconnection, then real admin approval/notice. The initial
20-second supervisor timeout was shorter than Spring's 30-second shutdown
grace, and proxy v1 failed to close its downstream when the upstream aborted;
its failed restart result is excluded. The final supervisor allows 45 seconds
and proxy v2 propagates upstream errors/aborts. A shutdown warning about an
already recycled emitter was observed after the grace period; it did not
prevent JVM exit or accepted reconnection. No incident fix is inferred from
that ancillary warning.

No natural Energy Saver, discard, five-minute intensive-throttling transition,
bfcache round trip, Safari/Firefox or actual production browser was tested.
The required explicit CDP freeze/thaw was tested. The lifecycle proposal needs
Claude's implementation and the frozen-row regression to pass **before thaw**;
thaw recovery is not represented as a candidate lifecycle fix.

### Reproduce using retained artifacts

The exact start, build, proxy and browser commands are preserved in
`.release-evidence/2026-11-04/browser/README.md`; the following reruns use the
retained credentials without printing them. Start the stopped backend/proxies
with the README first; PG is already running at handoff:

```bash
source .release-evidence/2026-11-04/browser/stack.env
export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
export XDG_CONFIG_HOME=/tmp/pliego-browser-config-authentic
export XDG_CACHE_HOME=/tmp/pliego-browser-cache-authentic
export DISPLAY=:0
MATRIX_AUTHENTIC=1 MATRIX_HEADED=1 MATRIX_RUN=reproduce-lifecycle MATRIX_CASES=visible,focus-second,leader-other,frozen,offline node .release-evidence/2026-11-04/browser/browser-matrix.mjs
MATRIX_HEADED=1 MATRIX_RUN=reproduce-url MATRIX_CASES=production-origin,production-fixed,refused401,refused429 node .release-evidence/2026-11-04/browser/browser-matrix.mjs
MATRIX_HEADED=1 MATRIX_RUN=reproduce-soak MATRIX_CASES=long,old node .release-evidence/2026-11-04/browser/browser-matrix.mjs
```

For restart, start a fresh disposable `backend-supervisor.py` as described in
that README before `MATRIX_CASES=restart`; it coordinates readiness via local
files and restarts only this loopback JVM. For the connection ownership
red→green probe, run
`node .release-evidence/2026-11-04/frontend-module-probe.mjs`. It uses isolated
browser routes and source read from ec48e07, so it needs no Vite/backend and
remains reproducible after concurrent frontend edits. Its Fake EventSource
makes that a module test, not an additional
end-to-end matrix row. Do not rebuild the baseline from the later concurrent
frontend edits and label the output ec48e07 unchanged.

## Backend changes and verification

No backend application or database defect was demonstrated. No migration,
controller/service/gateway behavior, authentication setting or SSE endpoint was
changed. The only backend edit is the missing regression in
`backend/src/test/postgres18/realtime_events_http_gate.py:71`:

* Customer and ADMIN cookie-authenticated SSE streams open before the request.
* A real billed identity fixture requires administrative review.
* Public customer submit and public ADMIN APPROVE exercise the actual routine,
  trigger and scheduled publisher; neither manual enqueue nor manual publication
  stands in for these commands.
* Both streams must receive the matching `identity.correction.decided`, resource
  type and request ID within 12 seconds, with a cursor after their initial head.
* Customer REST must return the new identification and APPROVED request.

Sensitivity was verified on isolated `pliego_backend_rt_probe` with its own
backend at 18088. An ignored probe temporarily suppressed **only decided** hints
in the actual trigger function, retaining created hints. Public approval still
returned 200, and the new test failed specifically with
`preopened stream did not receive identity.correction.decided`. The probe restored
the exact original function in `finally`; the same HTTP gate then passed 11/11.
This probe never modified a migration file or the browser database.

| Check | Result | Evidence under `.release-evidence/2026-11-04/` |
|---|---|---|
| `RealtimeControllerTest` | 4 passed | `backend/com.pliego.modules.realtime.RealtimeControllerTest.txt` |
| `RealtimeStreamsTest` | 9 passed | `backend/com.pliego.modules.realtime.RealtimeStreamsTest.txt` |
| `BillingIdentityCorrectionApiIntegrationTest` | 40 passed | `backend/com.pliego.modules.customer.api.BillingIdentityCorrectionApiIntegrationTest.txt` |
| `RealtimeTransactionPostgresIntegrationTest` on native PG18 | 4 passed | `backend/com.pliego.modules.realtime.RealtimeTransactionPostgresIntegrationTest.txt` |
| `realtime_events_gate.py` | 18/18; scoped 250-row replay, late commit, retention race, concurrent admissions | `backend/realtime-events-pg-gate.json` |
| `realtime_resource_events_gate.sql` | Passed, including real decision and rollback | `backend/realtime-resource-pg-gate.txt` |
| Extended `realtime_events_http_gate.py` | 11/11 after restoration | `backend/realtime-events-http-restored.txt` |
| Decided-only trigger fault | Failed at the intended missing-decided assertion | `backend/decided-mutation-failure.txt` |
| `billing_identity_corrections_http_gate.py` | Passed | `backend/billing-identity-http-gate.txt` |
| Existing frontend realtime/session unit tests | 33 passed across two files | `npx vitest run src/app/realtime/realtime.test.ts src/app/session.test.tsx`, 2026-11-03 21:54Z |
| Production read-only SQL, executed locally with a real decided request | Passed; two published decided rows in distinct correct scopes | `backend/report-readonly-local-validation.txt` |

The focused Java checks total **57 passed**, including four real PG transaction
tests. This is not a claim that the whole CI gate suite or production was tested.
The baseline frontend unit tests passed despite the production URL defect because
they did not exercise the origin-only production build. A module probe uses real
Web Locks/BroadcastChannel but fake EventSource and must not be represented as a
full transport test. Its online ownership and missing-relay candidates are
executable red→green evidence; URL acceptance below uses real built browsers.

Re-run backend checks using the disposable environment only; start backend
18087 from the retained README before running HTTP gates:

```bash
set -a
source .release-evidence/2026-11-04/browser/stack.env
set +a
mvn -q -f backend/pom.xml -Dtest=RealtimeControllerTest,RealtimeStreamsTest,BillingIdentityCorrectionApiIntegrationTest test
PGDATABASE=pliego_backend_rt_probe PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55447/pliego_backend_rt_probe mvn -q -f backend/pom.xml -Dtest=RealtimeTransactionPostgresIntegrationTest test
# These mutate only the isolated probe database, never the browser matrix DB:
PGDATABASE=pliego_backend_rt_probe python3 backend/src/test/postgres18/realtime_events_gate.py
PGDATABASE=pliego_backend_rt_probe psql -X -v ON_ERROR_STOP=1 -f backend/src/test/postgres18/realtime_resource_events_gate.sql
# The real HTTP gate targets the disposable browser backend, when no matrix is running:
python3 backend/src/test/postgres18/realtime_events_http_gate.py
python3 backend/src/test/postgres18/billing_identity_corrections_http_gate.py
```

## Exact read-only production checks for Claude

Run the checked-in companion
[`2026-11-04-cross-device-realtime-readonly.sql`](2026-11-04-cross-device-realtime-readonly.sql)
using the existing authorized production connection. It is explicitly
`BEGIN READ ONLY`, has bounded statement/lock timeouts, and returns IDs and
aggregates only: no email, name, identification number, business payload,
session UUID, cookie or digest. Supply the operator's numeric correction ID:

```bash
psql -X -v ON_ERROR_STOP=1 -v request_id=123 -f docs/testing/2026-11-04-cross-device-realtime-readonly.sql
```

Expected for a fresh approval: one approved request, the customer's user ID
distinct from the deciding admin, one decision mail, and two decided hint rows.
One row has `customer_hint_count=1` targeting the customer; the other has
`admin_hint_count=1`, null target user; each has `published_hint_count=1` and
an event ID at or below the head. Unpublished age increasing beyond the sweep
cadence points to publication trouble. Recent publication age measures **event
activity**, not a publisher heartbeat: an idle healthy publisher need not change
it. This SQL was executed locally, not on production.

Run during a **fresh reproduction**, preferably before and immediately after
the mobile approval. Published history lasts one hour and stream leases about
60 seconds. Missing old events or leases cannot reconstruct the 21:24Z state;
these tables have no historical subscriber-delivery receipts. A published row
proves durable targeting/publication, not browser receipt. Current active lease
counts can show a disconnected tab or excess connections, but are not historical
proof of a frozen leader. Do not call `fn_realtime_publish`, enqueue functions,
or other mutating Database API routines in production to diagnose this.

Verify the installed release and asset without changing anything:

```bash
readlink -f /var/www/pliego/current
sha256sum /var/www/pliego/current/assets/index-CTdJuWHk.js
```

The second command should return
`889adae2ee6861619f178d776f5f0700c95ac3d045a087506e62e542eddf65f2`
if the retained artifact is installed. If that asset is absent or different,
inspect the actual HTML entry/chunk names and compare them to that release's
manifest instead of assuming ec48e07 is still current.

An anonymous canonical-path CORS check is also read-only and carries no cookie:

```bash
curl --silent --show-error --max-time 5 --dump-header - --output /dev/null -H 'Origin: https://pliegolibros.com' https://api.pliegolibros.com/api/v1/auth/events
```

Expect 401 for the anonymous session, with the configured exact
`Access-Control-Allow-Origin: https://pliegolibros.com` and
`Access-Control-Allow-Credentials: true`. This checks response policy for that
origin, not an authenticated browser stream. Production CORS remains unverified
by this local investigation; a scripted HTTP client does not enforce it.

In the **affected already-open customer tab**, read these in DevTools before
reloading; only paths/origins and build asset names are returned:

```js
Array.from(document.querySelectorAll('script[type="module"][src]'),
  s => new URL(s.src).pathname);
performance.getEntriesByType("resource")
  .filter(e => /\/auth\/events$/.test(new URL(e.name).pathname))
  .map(e => ({origin: new URL(e.name).origin, path: new URL(e.name).pathname}));
```

Record Network → EventStream request pathname, HTTP status/MIME, event IDs and
whether `pliego_session` is included **by name only**, never copy its value or
Authorization headers. Expected broken artifact path is `/auth/events`; the
canonical stream is `/api/v1/auth/events`. No events request plus a previous
entry asset supports H1; the incorrect request supports the URL diagnosis.
An admitted canonical stream with a published decided row but no visible-tab
refetch requires examining leader/relay lifecycle next. Cross-origin Resource
Timing can omit details; use the actual Network entry for status and cookies.


## Verification of the implemented fix

Executed 2026-11-03 UTC after Claude's uncommitted frontend changes. This section
supersedes the original client-failure verdict **for the tested working-tree
snapshot**; the original release-artifact investigation remains historical evidence.
`<evidence>` means `.release-evidence/2026-11-04/implemented-fix` throughout this section.

**Verdict:** the actual implemented SSE/version behavior passed the qualified
browser matrix. The complete validation gate is **NOT GREEN**: the exact requested
command suffered a native process fault, and the subsequent direct Vitest execution
reported one focus assertion failure. Native bfcache restoration could not be
qualified in this Chromium environment. No frontend source was edited to obtain
any result, and no application bundle was hand-patched.

### Tested snapshot and disposable stack

- Actual working-tree frontend/backend/shared sources were hashed before building:
  `<evidence>/source-manifest-before.json`, `source-diff-before.patch`.
  All **1,147** entries still match the final manifest and filesystem after browser
  and compiler/test execution; see `source-manifest-final.json`,
  `final-validation.json` and `review/final-independent-review.json` under `<evidence>`.
- Native **PostgreSQL 18.6**, fresh initdb directly under
  `<evidence>/pgdata`, port **55457**, migrations **V001–V105**. Backend built from
  the working tree on **18097**, Hikari maximum **8**, local HTTP cookie Secure=false,
  unchanged cookie `Path=/api/v1/auth`, SameSite=Strict, HttpOnly.
- Build A uses `VITE_API_BASE_URL=http://127.0.0.1:18097` (origin only) and
  `PLIEGO_BUILD_ID=verification-A`; static frontend **5190** has a different origin
  from the API and shares its site. There is **no API reverse proxy on the frontend**.
  Credentialed browser CORS and native EventSource therefore run across origins.
  Version/history tests independently serve **5192/5193**, with those exact origins
  allowed by the local API's CORS configuration.
- Build B uses the same working-tree source and API origin, stamped
  `PLIEGO_BUILD_ID=verification-B`. Both are actual `vite build` outputs. The build
  step did not run tsc/Vitest; the requested final validation was reserved for the end.
- A entry: `assets/index-O6gc6Qaj.js`, SHA-256
  `39b7d3dcd72b5d5269e0b4d606c289eba059c040941a5ffae01bdf7d0361ab56`.
  B entry: `assets/index-BTrgG53-.js`, SHA-256
  `6d4ad619b012ff5dfe361f64502ee3689e736932b6ffb9a26c9a2e0352263814`.
  Browser-response hashes, embedded build IDs and each build's real `version.json`
  match (`<evidence>/version/results.json`, `version/source-comparison-final.json`).
- Chromium **153.0.8010.12**: independent mobile ADMIN and desktop CUSTOMER contexts;
  mobile confirmations use real Aprobar/Rechazar UI and their confirmation dialogs.
  Customer setup uses disposable fixtures, and administrative decisions are actual
  public API commands from that UI. No decision or SSE delivery is mocked.
  The initial 401/429 responses are controlled admission faults only; recovery goes
  to the real API. Browser tooling disables Playwright's forced focus override for
  genuine hidden-tab cases; application code/assets remain unchanged.

### Qualified decision matrix

Each row is a distinct customer and real ADMIN decision, not a count of repeated
attempts. Times are milliseconds from the admin confirmation to the first matching
customer billing GET, decided relay and DOM outcome. Source IDs/page IDs, HTTP/CDP
IDs, cursor values, visibility, cookies **by metadata only**, and authoritative
projection status are retained in `<evidence>/matrix-summary.json` and its linked
NDJSON files. Timing is functional evidence, not a throughput/SLO benchmark.

The strengthened 16 core rows first drain initial request/resync work and confirm
PENDING before the admin decision; they then require a post-decision hint followed
by a matching fresh REST projection. This prevents a late created hint alone from
qualifying the decided-event path. Both long cases drain that work during the soak;
the restarted cases reconnect before the decision. Every accepted row records the
matching `identity.correction.decided` event.

| Case | Request | Status | SSE hints after decision | GET | Relay | Render | Peak sources |
|---|---:|---|---|---:|---:|---:|---:|
| visible-approved | 25 | PASS | identity.correction.decided#281 | 3660ms | — | 3668ms | 1 |
| visible-rejected | 26 | PASS | identity.correction.decided#291 | 1630ms | — | 1638ms | 1 |
| hiddenprofile-approved | 27 | PASS | identity.correction.decided#301 | 1720ms | — | 1726ms | 1 |
| hiddenprofile-rejected | 28 | PASS | identity.correction.decided#311 | 1571ms | — | 1581ms | 1 |
| hiddenleader-approved | 29 | PASS | identity.correction.decided#321 | 1522ms | 1522ms | 1530ms | 1 |
| hiddenleader-rejected | 30 | PASS | identity.correction.decided#331 | 3658ms | 3658ms | 3665ms | 1 |
| frozenleader-approved | 31 | PASS | identity.correction.decided#347 | 1614ms | — | 1620ms | 1 |
| frozenleader-rejected | 32 | PASS | identity.correction.decided#359 | 2940ms | — | 2946ms | 1 |
| offline-approved | 34 | PASS | identity.correction.decided#371 | 55ms | — | 61ms | 1 |
| offline-rejected | 35 | PASS | identity.correction.decided#385 | 130ms | — | 139ms | 1 |
| refused401-approved | 36 | PASS | identity.correction.decided#395 | 1825ms | — | 1832ms | 1 |
| refused401-rejected | 37 | PASS | identity.correction.decided#405 | 1005ms | — | 1012ms | 1 |
| refused429-approved | 38 | PASS | identity.correction.decided#415 | 1768ms | — | 1776ms | 1 |
| refused429-rejected | 39 | PASS | identity.correction.decided#425 | 1979ms | — | 1988ms | 1 |
| identity-approved | 40 | PASS | identity.correction.decided#435 | 2413ms | — | 2423ms | 1 |
| identity-rejected | 41 | PASS | identity.correction.decided#445 | 2480ms | — | 2489ms | 1 |
| restart-approved | 19 | PASS | identity.correction.decided#207 | 2685ms | — | 2694ms | 1 |
| restart-rejected | 20 | PASS | identity.correction.decided#217 | 2723ms | — | 2732ms | 1 |
| long-approved | 22 | PASS | identity.correction.decided#381 | 302ms | — | 310ms | 1 |
| long-rejected | 21 | PASS | identity.correction.decided#379 | 2113ms | — | 2120ms | 1 |

The offline rows' first notice appears at **61/139ms** through reconnect/visibility
revalidation, before their decided SSE frames. Their separate
`qualifiedDecisionPipeline` checks prove decided **371/385** subsequently led to
fresh billing GETs at **2262/2436ms**, returning APPROVED/REJECTED projections at
**2265/2440ms**. Thus the early first-render timing is not attributed to a later frame.

The customer on `/account/identity` initially sees **Solicitud de corrección**.
For requests **40/41**, decided **435/445** removes that heading and renders
**Revisamos tu solicitud** without navigation/reload, with the correct applied/not
applied badge, Entendido action and rejection reason. Both document IDs remain
unchanged. The profile cases also verify actual hidden/visible states.

For frozen requests **31/32**, the original leader's native EventSource is CLOSED
and the visible follower owns the sole open source before the admin command.
Both decisions render **before thaw**, in **1620/2946ms**; customer/admin hints are
already durably published. Native resume on thaw is recorded, and the old leader
starts its billing GET **2/1ms** after thaw, returning 200. It remains without its
own live source while the follower keeps the single open source. Native lock-queue
reentry is source-inferred, not directly measured; the single-source result and
resume refetch are measured (`<evidence>/review/final-independent-review.json`).

Both long rows run **190 real seconds**, with **four successful 60-second stream
openings and one EventSource object** per customer. At approximately 80 seconds,
the existing SessionProvider visibility refresh is forced with a temporary
`Date.now` advance, immediately restored. Each real refresh returns 200 with
Set-Cookie. Each then has **two native reconnects after rotation**, both 200 SSE,
with `pliego_session` on the correct path, no blocked reasons and Last-Event-ID
(**298**, then **370**). JWT validation and server/SSE clocks are unchanged. See
`<evidence>/matrix-long.ndjson`, `results-long.json` and the post-rotation request
metadata in `matrix-summary.json`; this is not a real 30-minute wall-clock soak.

Both backend-restart rows retain the customer document across actual SIGTERM,
JVM exit **143**, startup/readiness and SSE reconnection; each subsequent real
mobile decision renders correctly (`<evidence>/backend-restart.ndjson`,
`matrix-restart-qualified.ndjson`).

### Connection accounting

Peak simultaneous **non-CLOSED native EventSource objects = 1** in every customer
context and in each qualified administrator run. Frozen/pagehide handoff closes
one source before another tab opens its replacement. Offline/online with a waiting
follower settles to **exactly one** live source, including a burst of online events.
Cumulative historical constructors/openings are recorded separately and are not
reported as simultaneous connections; native document destruction is also tracked.
`<evidence>/final-validation.json` retains these assertions.

An old **server lease row** can temporarily persist after client.close until the
next write detects the abort or the bounded lease expires. History observations
record stale lease counts separately; two lease rows do not mean two live browser
EventSources. No claim of instant server-row cleanup is made.

### Version replacement and real history

Only complete, freshly built static trees plus their `version.json` were replaced.
No JavaScript string substitutions were used. Version tests wait the real **60s**
throttle interval; they do not alter clocks to bypass it.

| Case | Result | Evidence |
|---|---|---|
| Build A open → full B publication → real hidden/visible transition | PASS: exact snackbar, draft/document preserved, no automatic reload; Actualizar fetches verified B entry | `<evidence>/version/results.json` (visible), `observations.ndjson`, `visible-before-explicit-update.png` |
| Build A open → B → real offline/online | PASS: same guarantees and exact B bytes after Actualizar | `<evidence>/version/results.json` (online), `online-before-explicit-update.png` |
| Build A open → B → explicitly synthetic PageTransitionEvent pageshow | PASS for the actual application's listener: same guarantees; **not native bfcache evidence** | `<evidence>/version/results-synthetic.json`, `observations-synthetic.ndjson`, `synthetic-pageshow-before-explicit-update.png` |
| Real history away/back, single customer tab, then mobile ADMIN APPROVE | PASS: delegated native close has readyState=2, lock released, fresh GET after return, one native source and automatic approval notice | `<evidence>/version/realtime-history-results.json` (single-tab), `realtime-history.ndjson` |
| Real history away/back with a waiting follower, then mobile ADMIN REJECT | PASS: old source closes, follower owns the lock, one native source after return, both pages show rejection | `<evidence>/version/realtime-history-results-peer-rerun.json`, `realtime-history-peer-rerun.ndjson` |
| Real cached-document pageshow/bfcache restoration | **UNSUPPORTED / NOT QUALIFIED**: persisted=false; a new document loads | `<evidence>/version/results.json` (pageshow), native CDP reasons and navigation entries |

All three accepted A→B listener cases show exactly **Hay una versión nueva de
PLIEGO.**, preserve the unsaved Nombres draft, retain the A document until the
customer chooses **Actualizar**, and then load the exact B entry hash above.

Native CDP reasons were **MainResourceHasCacheControlNoStore**,
**JsNetworkRequestReceivedCacheControlNoStoreResource** and
**BrowsingInstanceNotSwapped**. No BroadcastChannel-specific exclusion was observed.
The native history flows verify pagehide cleanup and ordinary return/fresh-document
recovery; they do not prove restoration of an A document from bfcache. The synthetic
pageshow test exercises the production listener but cannot fill that native gap.
See `<evidence>/version/README.md` for timing, build hashes and commands.

### Final compiler/unit gate and remaining failure for Claude

The exact requested command was executed **once**, after browser runs:

```bash
cd frontend && npx tsc --noEmit && npx vitest run --maxWorkers=8
```

It exited **139**, printing only **Segmentation fault**, with no TypeScript
diagnostic or Vitest result (`<evidence>/final-frontend-checks-exact.log`). A prior
harness process had also exited 139 before executing a browser case; those native
faults are environment-invalid attempts, not application assertion results.
Node 24.22.1, npx 11.19.1 and loading TypeScript 5.9.3 subsequently succeeded.

To obtain usable diagnostics without repeating that exact command, the same local
compiler and runner were invoked directly once:

```bash
cd frontend
node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run --maxWorkers=8
```

TypeScript passed. Vitest completed with **107 files passed / 1 failed** and
**1,343 tests passed / 1 failed** (exit 1). Raw evidence:
`<evidence>/final-frontend-checks-direct.log`. No test or source was edited, and no
second full Vitest execution was used to replace this failure with a pass.

The precise failing assertion is
`frontend/src/features/account/IdentityCorrectionPage.test.tsx:121`, test
**turns a direct correction the server refuses as already invoiced into a request,
without losing the number**. After the P1107 fallback, it expects the **Lo escribí
mal** radio to have focus; observed active element is **body**. The preceding
Spanish alert and preserved-number assertions at lines 119–120 pass.

The related application handoff is
`frontend/src/features/account/IdentityCorrectionPage.tsx:335–340`:
`setServerReview(true)`, close confirmation, then a single
`requestAnimationFrame(() => reasonRef.current?.focus())`.
The radio mounts conditionally at lines 398–405; ConfirmDialog uses
`returnFocus=false` and a transition at
`frontend/src/shared/ui/ConfirmDialog.tsx:34–36`. Focus/commit/dialog timing is a
candidate explanation, **not a proven browser cause**. This exact P1107 handler
already exists in ec48e07 (then lines 261–266), so the failure is not attributed
to the new SSE/version changes. Browser P1107 fallback focus was not separately
reproduced. Claude should investigate this failing focus contract before calling
the entire suite green; the realtime/version browser matrix itself found no
confirmed functional defect in the implemented fixes.

### Evidence preservation and limits

The authoritative 20-row map is `<evidence>/matrix-summary.json` / `.md`:
**16 core-strong + 2 restart-qualified + 2 long**. Independent source, decision,
version and lifecycle audits are under `<evidence>/review/`. Earlier functional
rows and initial harness failures remain retained but are not double-counted:
late created-hint paths, exact text matching against material glyphs, source-map
entries from destroyed documents, a too-short server-lease assertion, launch
readiness/native process failures and an optional screenshot protocol failure.
These attempts were corrected in the harness, without changing the application.

Fresh native PG remains persistent/running on **55457**, with V105, **41 correction
requests and 446 realtime rows**, cluster identifier **7704073784507977751**
(`<evidence>/pg-final-state.json`). Task-owned API/static/browser processes were
stopped. Exact reproduction commands, source/artifact hashes and privacy-safe
instrumentation are documented in `<evidence>/README.md` and
`<evidence>/version/README.md`. No production access, commit, push or deployment
was performed; local A→B static replacement was the requested test operation.
