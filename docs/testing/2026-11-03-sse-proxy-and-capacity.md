# SSE proxy and capacity evidence — 2026-11-03

Final documentation; code accepted unchanged by the operator/Claude review.
Local execution was deliberately cancelled because this host became unstable
following its unexpected shutdown. No further local runs are part of this handoff.

| Track | Verdict | Scope |
| --- | --- | --- |
| A — reverse proxy | **GO / accepted** | Measured local nginx transport, authentication, replay and lifecycle; no Cloudflare certification |
| B — release correction | **GO for the measured fault-containment and functional requirements** | RQ-RT-CAP-12 and the shared-budget/timeout/heartbeat/abort checks pass; healthy performance is mixed and zero-overhead equivalence is not established |
| Full release gate | **Pending authoritative GitHub CI on the final commit** | Local full-gate attempts are ENVIRONMENT-INVALID and excluded from product acceptance; no clean-runner CI result is claimed here |

## Evidence, source and acceptance boundary

`<evidence>` denotes the operator-selected private, git-ignored persistent evidence
root. Raw logs, clusters, JFR, frozen JARs, extracted nginx/JDK/PG packages and
synthetic credentials remain there. Lost pre-interruption evidence is not counted.
Evidence links below are relative to that root; raw files are not committed.

Source base: `415498927ec5253b599d2521c1d2fac7e45e665f`, branch
`feat/digital-ownership-post-purchase-search`, plus the reviewed uncommitted fix.
No production/VPS/Cloudflare access, commit, push, merge or deployment occurred.
Mail and R2 were disabled. No frontend UI/CSS/design files were edited by this run.
The correction runs use dedicated disposable databases and never access the
protected development/system listeners or the operator's other stack on 55539.

| Artifact | SHA-256 | Evidence |
| --- | --- | --- |
| Original read-only budget; accepted Track A / before correction | `49dd26c58514689010c5ba2e89a154950f2a4db0e4557752170806dce3c8b8fd` | `<evidence>/artifacts/backend.jar`, `<evidence>/artifacts/identity.json` |
| Shared budget, separate SET calls | `1cddbe45a0dbd91a08c181c17bcfbcb2ca7ee324b2ee7ae1fcc144995f583b0b` | `<evidence>/artifact-fixed/` |
| Shared budget, combined settings call separate from routine | `55c2907a1b4abdf73897cb9e9e0992fd2cebe00a24eaf34dea34988122feb5c2` | `<evidence>/artifact-final/` |
| **Final batched settings + routine execution** | `6cd1cd82958322bbf90e0e8343204ae48a452ffd0d6d9b3fb8abbb64a41492e4` | `<evidence>/artifact-batched/backend.jar`, `<evidence>/artifact-batched/identity.json`, source snapshots |

The final full PG18 gate result must come from [GitHub CI](../../.github/workflows/ci.yml)
on the final commit. That workflow selects Temurin using
[`.java-version`](../../.java-version), currently 25.0.5, runs Maven verify and
`run_ci_gates.sh`, which includes `run_runtime_privileges_ci_gate.sh`. The final
commit/clean-runner result is not available in this local session. A partial
local run or a diagnostic JVM configuration does not substitute for that result.

## Method and environment parity

The supplied production target is Ubuntu 24.04, nginx 1.24.0, two vCPUs, 3.8 GiB RAM,
JVM 256/1280 MiB, Hikari 8/2 and PG18 max_connections 30. No new live inspection was
performed. The historical runbook records Temurin 25.0.5; local final paired runs
used verified Temurin 25.0.5+8 with normal tiered JIT, not application `-Xint`.

| Property | Local measurement / limitation |
| --- | --- |
| CPU | Final app, PG and JMX collector pinned together to logical CPUs 24, 25, SMT siblings of one physical core; original baseline used 0, 1 and proxy 2, 3. CPU count matches, processor/topology/quota equivalence is unproven |
| JVM / pool / PG | Backend 256/1280 MiB; Hikari max 8/min 2; PG18.6 max 30 for capacity. Full-CI fixtures use 100 because two app instances plus direct SQL race clients exceed 30; this is not a capacity measurement |
| OS / memory / storage | Ubuntu 26.04 on WSL2; 15.5 GiB host RAM and persistent ext 4. No 3.8 GiB memory cgroup, swap-pressure or production-disk validation |
| Dataset | 143 users, 501 editions, 452 orders, 100 grants; catalog/orders/library return 20 items from populated projections. Synthetic data, not production cardinalities |
| Role / edge | Capacity uses its scratch owner; proxy tests exercise restricted runtime privileges. Loopback HTTP and fixture cookies do not prove production TLS/AOP, Secure/Strict cross-origin browser behavior or Cloudflare |
| Monitoring | JMX 250 ms; process/PG resources 500 ms; lock probes 100 ms. Snapshots can miss short spikes. PG CPU excludes children living entirely between samples |
| Tool provenance | `<evidence>/temurin/manifest.json`; extracted noble nginx under `<evidence>/proxy/dependencies/`; alternate official noble PG18.6 build under `<evidence>/pg-noble/manifest.json`. All extraction was private, without global installation |

The reproducible method is retained in `scripts/load/sse_proxy_gate.py`,
`sse_proxy_native.mjs`, `sse_capacity.py`, its JMX/PG probes and summarizer, and
`sse_pg18_verify.py`. Historical harness snapshots accompany each run. A control
that overlapped Maven is explicitly excluded at
`<evidence>/capacity-fixed/pre-fix-healthy-pinned/excluded-interference.json`.
The final Temurin pair ran sequentially without competing verification JVMs.

## Track A — reverse proxy: GO for the measured local transport

Ubuntu noble package `nginx_1.24.0-2ubuntu7.19_amd64.deb` was extracted without
installation. The nginx core version matches the supplied production version;
the production Ubuntu package revision was not supplied. The two local server
blocks use two workers and 768 connections per worker. Both reproduce the exact
forwarding, body and timeout directives supplied by the operator; only the
listener/upstream ports, logs, temp paths and explicit worker count differ.
The dedicated block additionally disables buffering, caching and gzip.

Final evidence: `<evidence>/proxy/run-114847-108b18/results.json`,
`nginx.conf`, `<evidence>/proxy/run-114847-108b18/nginx-effective.log`, `<evidence>/proxy/run-114847-108b18/*.wire.json`, `<evidence>/proxy/run-114847-108b18/*.sse`, `<evidence>/proxy/run-114847-108b18/nginx-access.log`
and `<evidence>/proxy/run-114847-108b18/native-results.json`. Each received body byte has a monotonic timestamp.
Commit time is bracketed by database timestamps immediately before and after
COMMIT; latency percentiles below show lower–upper bounds, not an invented exact
commit instant. The publisher ran automatically at its normal 2 s interval.

| Measurement | Unchanged production location | Dedicated SSE location |
| --- | --- | --- |
| First body byte, final run after startup/auth probes | 7.695 ms | 7.678 ms |
| Heartbeat max gap, 3 gaps each | 16.020 s | 16.018 s |
| Inactivity margin below 30 s | 13.980 s | 13.982 s |
| Commit → client p 50, 24 events each | 1976.865–1990.962 ms | 1983.585–1991.642 ms |
| Commit → client p 95 | 1989.384–1994.541 ms | 1990.831–1994.395 ms |
| Clean HTTP stream lifetime | 60.079 s | 60.075 s |
| Chromium lifetime / reconnect delay | 60.075 s / 3.014 s | 60.058 s / 3.018 s |
| SIGSTOP: last byte → incomplete close | 30.032 s | 30.024 s |
| `Content-Encoding` with gzip accepted | Absent | Absent |

Both locations sent the immediate `retry:3000` and heartbeat, then events and
periodic heartbeats without waiting for response completion. Replay from cursor
6 returned the same 24 event IDs in order, without `resync`. Chromium's automatic
reconnect supplied cursor 54 to nginx; each native client saw only its initial
`resync`. Native verification used Chromium 153.0.8010.12 with same-origin loopback
HTTP and a fixture HttpOnly/Strict cookie with `secure=false`. This does not prove
production Secure cookies, real cross-origin browser policy, TLS/AOP or Cloudflare.

The 33.029 s SIGSTOP started after a periodic heartbeat. Both proxies retained the
already-started HTTP 200 headers and ended with `IncompleteRead` at the measured
30 s inactivity deadline. They did not emit a new 504 response after commitment.
The healthy 60 s lifetime was never cut by this timeout. The held-permit unit
regression separately proves heartbeat progress without reads; its 21 s deadline
is not a 16 s scheduling guarantee under arbitrary contention or CPU suspension.

| Requirement | Result and evidence |
| --- | --- |
| RQ-RT-PROXY-01: nginx/config parity | PASS: extracted noble 1.24.0; exact supplied location, `$http_cf_connecting_ip` policy preserved; effective config retained |
| RQ-RT-PROXY-02: immediate/unbuffered body | PASS: timed initial bytes, 4 heartbeat frames, 24 event frames per location; `<evidence>/proxy/run-114847-108b18/healthy-*.wire.json` |
| RQ-RT-PROXY-03: commit latency | PASS: n=24 per location, paired commit brackets and received bytes in `<evidence>/proxy/run-114847-108b18/results.json` |
| RQ-RT-PROXY-04: cursor resume | PASS: 24 exact ordered replay IDs each; native nginx log receives automatic Last-Event-ID 54 |
| RQ-RT-PROXY-05: lifetime/retry | PASS: clean approximately 60 s HTTP close; native retry approximately 3 s; `<evidence>/proxy/run-114847-108b18/native-results.json` |
| RQ-RT-PROXY-06: auth/admission | PASS: absent, malformed, well-formed invalid, revoked cookie and valid bearer without cookie → 401; four SQL leases, fifth → 429/Retry-After 60; malformed cursors → 400 |
| RQ-RT-PROXY-07: CORS/credentials | PASS: exact approved Origin and credentials on GET/errors; OPTIONS GET/Last-Event-ID → 200; foreign Origin GET/OPTIONS → 403 |
| RQ-RT-PROXY-08: gzip/timeouts | PASS: no gzip; healthy margin approximately 14 s; delayed heartbeat closes at 30 s as expected; `<evidence>/proxy/run-114847-108b18/stall-*.wire.json` |
| RQ-RT-PROXY-09: scope/revocation | PASS: customer A/B/admin receive only intended IDs on both proxies; revocation closes four streams in 1.944–2.010 s, old cookie refused and new session admitted |
| RQ-RT-PROXY-10: public edge/browser | NOT TESTED: no production access; explicit-UA curl and real cross-origin browser checks remain in the runbook |

The dedicated location is **recommended, not required by these measurements**:
the unchanged location honors `X-Accel-Buffering: no`, and default gzip types do
not compress this content type. Keep the measured 30 s read timeout rather than
the old 75 s assumption. Explicit off settings protect the SSE policy from future
general proxy changes; they did not materially change measured delivery latency.

Attempt 1, `<evidence>/proxy/run-114544-7c7361`, is retained as a harness failure:
the native log parser expected an empty cursor instead of nginx's `-` marker.
Its transport probes passed (initial body 203.6–254.8 ms), but the full gate is
counted only from the corrected fresh attempt. No controlled cold/warm experiment was performed. The final backend log contains
11 exception-handler warnings around deliberate disconnects/SIGSTOP/cleanup:
the global handler tries to render ProblemDetail after the response became
`text/event-stream`. No publisher failure was logged. Successful transport checks
do not mean clean disconnect logs; this remains an operational defect to address.

## Track B — release correction and fault results

One fair four-permit budget covers admission, reads and disconnect cleanup before
calling Spring's transactional service/Hikari borrow. The publisher is unchanged,
outside this budget, with at most one scheduled transaction per instance. Thus
SSE contributes at most four per-connection borrows plus one publisher, leaving
three of Hikari's eight slots for other work when SSE is the source of contention.
This is not a reservation against unrelated REST/background transactions.

Read/admission budget waits are bounded at 2 s; cleanup waits 100 ms for that budget
and falls back to the existing 60 s lease if contended or unsuccessful. Missing a
permit still reaches heartbeat, lifetime and stop checks. No permit is held for
socket writes. Each connection transaction has a 1 s Spring timeout and local 100 ms
lock /1 s statement limits. SET, SET and the unchanged approved routine SELECT are
batched in one prepared JDBC execution with typed parameters and validated/drained
results. No second pool or V106 is required: no database object or business rule
changes. The server settings reset on commit and rollback on the same physical
connection; they do not leak to REST/publisher work.

Admission budget exhaustion or 55P03/57014 uses existing 429
`REALTIME_CONNECTION_LIMITED`, unchanged Spanish text and Retry-After 60. Other
SQLSTATE mappings remain intact. The exact committed-SSE abort path writes no
ProblemDetail and logs expected closes at most DEBUG; unexpected errors reaching
the MVC handler still log ERROR and ordinary REST/pre-stream errors are preserved.

### Before / after: 128 streams and an 8 s relation lock

Four independent REST requests start at each scheduled offset; cells are their
min–max HTTP latency in ms. All returned 200. The before code capped reads only,
so failed reads could accumulate unbudgeted disconnect transactions. Later cursor
waves were not measured in that baseline and are not reconstructed.

| Locked relation / REST wave | Before: read-only budget | After shared budget (reported intermediate 1cdd) | Final batched 6cd / Temurin |
| --- | --- | --- | --- |
| Cursor, 2.5 s | 5.512–5.956 | 5.303–6.960 | 4.408–4.864 |
| Cursor, 4.5 s | Not measured | 2.028–4.177 | 2.326–2.814 |
| Cursor, 6.5 s | Not measured | 4.950–7.308 | 1.657–3.143 |
| Lease, 2.5 s | 106.186–110.557 | 4.388–4.707 | 2.496–2.816 |
| Lease, 4.5 s | 3532.233–3546.690 | 2.233–3.502 | 1.906–2.784 |
| Lease, 6.5 s | 1535.619–1545.828 | 1.738–3.085 | 1.419–2.150 |

Evidence: `<evidence>/capacity/run-1/results.json` (cursor before),
`<evidence>/capacity/connection-lock-late/results.json` (lease before),
`<evidence>/capacity-fixed/fixed-run/results.json` (intermediate after), and
`<evidence>/capacity-fixed/t-final/results.json` (final). A separate before-fix
bounded repeat reached 5519.025 ms and correctly failed its 500 ms assertion at
`<evidence>/capacity/connection-lock-bounded/`. The 500 ms threshold is a local
fault-test criterion, not a production SLA.

The reported intermediate after ranges were cursor 2.028–7.308 ms and
lease 1.738–4.707 ms. The final batched build independently passed all 24 fault probes
in 1.419–4.864 ms, including every 4.5/6.5 s wave that exposed the original starvation.
Each final fault retained 133 valid PG probes with zero probe errors. Sampled active
connect/read/disconnect functions peaked at 4, or 5 including the one publisher;
maximum mixed query ages were 100.630 ms (cursor) and 100.945 ms (lease). PG sampling
counts active function SQL, not every setup/commit phase; the unit mixed-borrow
counter verifies the wider pre-transaction budget invariant.

During the final lease lock, valid admission probes at 2.5/4.5/5.0 s all returned
429, Retry-After 60 and the unchanged code before unlock. Their total durations
were 1585.496/102.691/103.883 ms. The first includes fair budget waiting:100 ms is the
server lock limit, not a 100 ms end-to-end admission promise. Stream capacity had
already been released before these probes, avoiding a vacuous process-cap 429.

Contended cleanup left 117 cursor-fault and 128 lease-fault SQL leases. All rows
cleared, with zero remaining leases observed 0.680/0.344 s after the latest captured
expiry; reconnect returned 200 in both cases. A failed disconnect can therefore
leave a lease counting against the 4/user cap for up to 60 s. Physical deletion may
follow expiry; these samples do not claim immediate cleanup or sub-second expiry
precision. No pool acquisition timeout or SSE ProblemDetail/write-handler error
was logged in the final paired run. There were two unrelated Springdoc startup
WARN records, so this is not a claim of zero WARN logs globally.

### Healthy regression and measured cost

The final pair is `<evidence>/capacity-fixed/t-old/` (49dd) versus
`<evidence>/capacity-fixed/t-final/` (6cd), both using Temurin 25.0.5+8, CPUs 24, 25,
Hikari 8/2, PG max 30 and the same unchanged populated fixture. Each artifact has
one 0-stream window and three 128-stream windows. Every window first performs 200
actual warmup GETs per endpoint, then 200 measured GETs per endpoint at concurrency 4,
plus 30 fresh identity REJECT decisions and 30 distinct order transitions. This is
3200 measured reads, 3200 warmup reads and 240 writes per artifact, all 200. Each 128
window also confirmed the 129th admission is 429/Retry-After 60.

Cells below are p 50 ms / p 95 ms / endpoint requests per second. The 128 cells are
medians of the three per-window statistics, not pooled percentiles of 600 requests.
Request latency excludes JWT construction and response JSON decoding; endpoint
throughput includes the client window's work. The sequence is not randomized and
JIT, caches, background work and host variation remain confounders.

| Read endpoint | Old 0 streams | Old 128 median | Final 0 streams | Final 128 median |
| --- | --- | --- | --- | --- |
| Catalog | 7.010 / 16.293 / 490.6 | 4.890 / 10.311 / 702.5 | 6.969 / 15.225 / 504.4 | 4.914 / 9.828 / 698.0 |
| /me | 2.803 / 7.911 / 1046.8 | 1.926 / 5.357 / 1556.2 | 2.630 / 7.447 / 1085.8 | 1.823 / 4.491 / 1576.3 |
| /orders | 33.588 / 40.941 / 116.1 | 30.069 / 41.908 / 127.3 | 32.101 / 129.901 / 91.7 | 31.006 / 44.596 / 111.6 |
| /me/library | 7.019 / 11.755 / 531.1 | 5.775 / 10.387 / 645.9 | 6.086 / 12.965 / 560.8 | 4.915 / 10.905 / 697.9 |

| Write command | Old 0 p 50/p 95 ms | Old 128 median p 50/p 95 ms | Final 0 p 50/p 95 ms | Final 128 median p 50/p 95 ms |
| --- | --- | --- | --- | --- |
| Identity decision | 7.829 / 13.145 | 7.252 / 11.616 | 8.930 / 31.308 | 8.173 / 16.717 |
| Order transition | 7.286 / 13.008 | 6.722 / 9.568 | 9.468 / 37.442 | 7.896 / 12.219 |

The comparison is **mixed**, not proof of zero overhead. Cross-artifact median
read throughput changed by catalog−0.6%, /me+1.3%, /orders−12.3%, library+8.0%.
/orders median p 95 was 41.908→44.596 ms (+6.4%). Its three old RPS windows were
119.343/137.867/127.261, versus 111.564/123.048/106.234 final. These costs remain
visible; they are not erased by classifying crashed full gates as invalid.

Within the final artifact, 128-stream read throughput and p 95 were better than
its own 0-stream baseline, as were both write p 95 medians. That establishes the
sampled healthy functional regression check, not a causal speedup from SSE or
cross-build performance equivalence. The final 0-stream /orders p 95 was already
129.901 ms, exposing substantial startup/order effects. Three sequential windows
cannot establish strict no-loss equivalence, a p 99 SLA or production capacity.

Earlier stages remain retained: the two-SET-call candidate had /orders p 95
121.412 ms versus 54.046 ms in its first control; repeated warm windows still showed
14–25% read-throughput cost for several endpoints. Combining only the SET calls
reduced that cost but left a measured 5.6% /orders throughput difference. The final
batched routine build is separately identified above. See
`<evidence>/capacity-fixed/warm-report.md`, `final-warm-report.md` and
`temurin-warm-report.md`; no valid earlier measurements were deleted or relabeled.

Final warm-window JVM RSS peaked at 522.0 MiB and heap use 206.5 MiB; the fault phases
peaked at 526.3 MiB JVM RSS and 142.8 MiB PG PSS. Combined sampled JVM+PG CPU was
25.6–40.7% of the two-logical-CPU allocation during the 128 windows. Main-pool
active snapshots peaked at 6 during warm windows and 5 during faults; pending
snapshots were 0 and logged Hikari acquisition timeouts 0. PG peaked at 11 including
monitors, 19 below 30. These are sampled workload margins, not reserved capacity or
memory-pressure proof on a 3.8 GiB VPS. Final JFR/GC summaries are retained and valid
under `<evidence>/capacity-fixed/temurin-jfr-validation.json`.

### Requirement ledger for the release correction

| Requirement | Result | Evidence |
| --- | --- | --- |
| **RQ-RT-CAP-12 — lease-write stall** | **PASS**: all 12 final lease-lock REST probes 200/1.419–2.816 ms across 2.5/4.5/6.5 s; original 1.54–5.52 s starvation removed in this experiment | `<evidence>/capacity-fixed/t-final/results.json`, `connection-lock-query-age.jsonl` |
| RQ-RT-CAP-15 — shared fair budget | PASS: mixed admissions/reads/cleanup never exceed 4; publisher remains independently bounded at 1; permits acquired before transactions | `<evidence>/fix-budget/red.log`, `<evidence>/fix-budget/expanded-green.log`; final Maven unit results; final 133-sample probes per fault |
| RQ-RT-CAP-16 — local lock/statement limits | PASS: 100 ms/1 s in real Spring transactions, all three lock failures 55P03; same physical session resets after commit/rollback, no partial admission | `<evidence>/security-review/pg-timeouts-final-5/results.json`, JUnitXML and logs; seven reuse loops/28 observations |
| RQ-RT-CAP-17 — heartbeat/lifetime/socket budget | PASS: held-permit heartbeat regression, stop/lifetime checks retained and socket writes hold no permit | `<evidence>/fix-budget/heartbeat-latch.log`, final 738-test verify; `RealtimeStreamsTest` |
| RQ-RT-CAP-18 — normal SSE aborts | PASS:17 actual MVC resolver tests; no appended ProblemDetail or WARN for expected closes, real MVC errors remain ERROR, REST/pre-stream errors preserved; final load has 0 handler/write errors versus 384 old stack-header occurrences | `<evidence>/fix-abort/green.log`; `<evidence>/capacity-fixed/t-final/backend-0.log`, `<evidence>/capacity-fixed/temurin-summary.json` |
| RQ-RT-CAP-19 — admission and cleanup recovery | PASS: existing 429/code/Retry-After 60 under lock, failed cleanup expires and reconnect 200, no permanent lease leak | `<evidence>/capacity-fixed/t-final/results.json` |
| RQ-RT-CAP-20 — healthy 128 regression / cost | PASS for completed functional samples; performance MIXED, strict throughput equivalence not established | `<evidence>/capacity-fixed/temurin-within-build-comparison.json`, `temurin-warm-report.md`, raw ramp samples |
| RQ-RT-CAP-21 — authoritative full gate | PENDING GitHub CI on the final commit; local full attempts below are ENVIRONMENT-INVALID and not counted | [CI workflow](../../.github/workflows/ci.yml), [Java version](../../.java-version) |

The original resource caps 4/user, 128/process and 2 s poll interval are unchanged.
Earlier completed baseline evidence (49dd, before this correction) includes the
0/32/64/128/multilease ramps, fifth/user and 129th/process 429, a 130 s window with
256 explicit reconnects and 768 unique markers, 1000/10000 exact scoped deliveries,
retention/resync, approximately 1.97 s revocation and approximately 60 s crash-lease
recovery. Those results remain at `<evidence>/capacity/run-1/`; they are not silently
recast as final-code reruns. The final correction specifically repeats the lock,
healthy, admission, cleanup and abort requirements above.

## Completed local verification that counts

| Verification | Completed result | Evidence |
| --- | --- | --- |
| Final batched-code Maven verify, normal tiered Ubuntu JDK | PASS: 738 tests, 0 failures/errors, 37 skips | `<evidence>/fix-budget/maven-verify-batched.log` |
| Same final JAR Maven verify, normal tiered Temurin 25.0.5+8 | PASS: 738 tests, 0 failures/errors, 37 skips; 62 s | `<evidence>/fix-budget/maven-verify-temurin.log` |
| Earlier 738-test passes during correction | PASS, intermediate artifacts only; not substitutes for final-code verification | `<evidence>/fix-budget/maven-verify.log`, `<evidence>/fix-budget/maven-verify-final-2.log` |
| Final native PG timeout/reset tests | PASS: 4/4, 0 skips on Temurin, real proxied service and JDBC, seven reuse loops/28 observations | `<evidence>/security-review/pg-timeouts-final-5/results.json` |
| Final fault and healthy pair | PASS for completed functional assertions; throughput cost shown above | `<evidence>/capacity-fixed/temurin-paired-exit.json`, `<evidence>/capacity-fixed/t-final/run-status.json`, `<evidence>/capacity-fixed/temurin-final-verification.json` |
| Abort tests | PASS: 17/17, actual converters/output and captured resolver/handler logs | `<evidence>/fix-abort/green.log` |
| Held-permit heartbeat / mixed-borrow tests | PASS; original regressions fail before fixes; all final unit cases also covered by 738-test passes | `<evidence>/fix-budget/red.log`, `<evidence>/fix-budget/expanded-green.log`, `<evidence>/fix-budget/heartbeat-latch.log` |

The 37 default Maven skips include the four opt-in native PG cases, which were
then executed separately with zero skips. A scheduling-dependent unused Mockito
stub and the first one-connection Flyway test-fixture startup were corrected
before these final passes; their failed setup logs remain retained. The initial
Track A build's 711-test pass is historical, not the final correction count.

## Invalid local full-gate attempts — not counted

The operator assessed this host as unstable after its unexpected shutdown and
unrelated native PG/JVM failures. All local full-gate attempts are therefore
**ENVIRONMENT-INVALID**, not product PASS/FAIL verdicts. Exact failure kinds remain
visible below, including attempts that failed setup or a diagnostic assertion
rather than crashing. No approved migration or test assertion was weakened to
obtain a green result. Code, tests and gate scripts were accepted unchanged when
the operator cancelled further execution.

| Attempt | Failure / termination kind | Classification and retained evidence |
| --- | --- | --- |
| `gates` | Connection refused after setup and gate were split across executor network namespaces; no native crash | ENVIRONMENT-INVALID (harness setup); `<evidence>/gates/full-gates.log`, `<evidence>/gates/setup.log` |
| `gates-run-2` | Owner-mode fixture rejected `gateadmin` instead of required scratch role `pliego`; no native crash | ENVIRONMENT-INVALID (harness setup); `<evidence>/gates-run-2/full-gates.log` |
| `gates-run-3` | Strict login concurrency exhausted PG max 30; reserved connection slots unavailable to its direct test clients | ENVIRONMENT-INVALID (CI fixture connection budget); `<evidence>/gates-run-3/full-gates.log`, `<evidence>/gates-run-3/postgres.log` |
| `gates-run-4` | PG18.6 internal error: MultiXact 5455 not created, during strict realtime replay enqueue/publish | ENVIRONMENT-INVALID (native PG); `<evidence>/gates-run-4/full-gates.log`, `<evidence>/gates-run-4/postgres.log` |
| `gates-final` | PG18.6 internal error: MultiXact 1731 not created, during `login_attempt_gate.py`650-call flood | ENVIRONMENT-INVALID (native PG); `<evidence>/gates-final/full-gates.log`, `<evidence>/gates-final/postgres.log` |
| `gates-noble` | Temurin 25.0.5 C1 tier-3 SIGSEGV at `ciMethod::method_data_or_null`, compiling JDK Xerces `SchemaParsingConfig::checkFeature`; HTTP billing request lost its server | ENVIRONMENT-INVALID (native JVM); `<evidence>/gates-noble/full-gates.log`, `<evidence>/gates-noble/hs-error-43.log`, `<evidence>/gates-noble/replay_pid43.log` |
| `gates-c2` | Nondefault C2-only diagnostic stopped at `pickup_notifications_concurrency.py`: second READY worker assertion; no native crash in that attempt, diagnosis cancelled | ENVIRONMENT-INVALID (diagnostic configuration/unstable host); `<evidence>/gates-c2/full-gates.log`; not adjudicated as a product defect here |

The standalone restricted-role diagnostic at `<evidence>/role-c2/full-gates.log`
completed, but used C2-only mode and did not execute the complete combined gate.
It is informational and not counted as authoritative full-gate acceptance.

The Temurin replay identifies the JDK's own Xerces XML-schema processing in the
unchanged billing path. No native failure is attributed to the SSE correction,
and no specific compiler, database or hardware root cause is asserted here.

Other excluded attempts are not full-gate results: Ubuntu OpenJDK 25.0.4.1 C1 crashed
before Flyway/load while compiling Spring ASM `Frame::execute`, retained at
`<evidence>/capacity-fixed/batched/backend-hs-error-34.log` with replay/JFR; old
reverse-control fixtures hit PG MultiXact 1116 before any measurements at
`<evidence>/capacity-fixed/pre-fix-warm-after/` and `<evidence>/capacity-fixed/aba-after/`; one retry failed
Unix socket path-length setup. These failures do not erase the completed,
error-free measurements above. Native-only reproductions did not establish a
root cause; neither a known compiler defect nor a Noble-build/JDK cure is claimed.

GitHub CI on the final commit is the authoritative full PG18 result, using clean
runners and Temurin selected from `.java-version`. Its result is **not observed
here**. No further local Maven, gate, load or JVM diagnostic run is authorized
by this documentation handoff.

## Residual risks and operating limits

- A contended/failed cleanup can leave a lease counting against the 4/user cap for
  up to 60 s, despite immediate release of the local process slot. Reconnect may
  receive 429 until the SQL lease expires.
- Hikari acquisition is not covered by the 1 s transaction/statement deadline.
  The budget bounds SSE's contribution; unrelated REST/background work can still
  exhaust the pool. A 100 ms server lock limit is not a 100 ms total request bound.
- The abort classifier matches specific Spring async-completion exception messages
  as well as recognized client-disconnect types/causes. Spring upgrades/message
  changes require retesting classification. The committed-SSE guard still avoids
  incompatible ProblemDetail writes; unexpected MVC errors remain ERROR.
- Healthy cross-artifact performance is mixed. Short sequential warm windows do
  not prove zero overhead or steady-state throughput equivalence; /orders costs
  are explicitly retained. Sampled CPU/RSS/GC margins are not production sizing.
- No Cloudflare/TLS/AOP, real cross-origin Secure/Strict browser-cookie,
  production-load/cardinality, slow downstream, sustained input above publisher
  capacity, 3.8 GiB memory-pressure or production-storage proof is claimed. Mail/R2
  remained disabled; two local logical CPUs are SMT siblings, not certified VPS
  hardware equivalence.
- Nominal 60 s lifetime and heartbeat scheduling are not hard wall-clock guarantees
  under a stopped JVM, pool exhaustion, CPU suspension or blocked socket writes.
  The local healthy proxy margin remains the measured approximately 14 s.

**Final verdict:** A is GO for its accepted local transport scope. B is GO for the
accepted release correction and completed local fault/functional requirements,
with mixed performance documented. Full-release gate acceptance remains pending
the final commit's authoritative GitHub CI; unstable-host full runs are excluded,
not used to assign a product NO-GO or to claim a clean full-gate pass.
