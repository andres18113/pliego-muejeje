# PLIEGO isolated k6 benchmark

This suite uses the contract in `frontend/openapi/openapi.json`, including the
catalog search parameter `que`. The historical harness runs on loopback against
a disposable PostgreSQL 18 database; the shared suite also permits explicitly
allowlisted isolated staging targets through the guard described below. It never requests covers, production hosts, payment
providers, mail or object storage. The `api.pliegolibros.com` strings in the local
nginx configuration are forwarded header values; the upstream is always
`127.0.0.1:8080` and no DNS lookup or connection to that hostname occurs.

The 2026-11-04 audit uses `.release-evidence/2026-11-04-vps-audit/` (`<evidence>`
below). Raw files, databases, JARs and logs remain there, outside version control.
No production configuration, existing migration or UI file is changed by this suite.
These are historical audit commands: their old evidence paths are now read-only.
Do not rerun them unchanged. New preparation and validation evidence belongs under
`.release-evidence/2026-11-05-next/`; use the staging kit for future isolated VPS runs.

## Prerequisites

- Linux with PostgreSQL 18 binaries in `/usr/lib/postgresql/18/bin`, `k6`, Python 3,
  `taskset`, `pidstat`, `vmstat`, Maven, Java 25 and a local nginx binary.
- Two distinct CPU cores for Java, PostgreSQL and nginx, plus separate cores for
  k6 and samplers. The measured host has 32 logical CPUs; the harness uses CPUs
  `0,2` for the service processes and `4-31` for the load and monitoring. CPUs
  `0,1` are SMT siblings, as are `2,3`; unused siblings `1,3` avoid competing with
  the service cores. Adjust the constants after checking `lscpu -e` on another host.
- The audit reused a previously verified Temurin 25.0.5+8 at
  `.release-evidence/2026-11-03/temurin/jdk-25.0.5+8`. Set `BENCHMARK_JDK` to another
  Java 25 JDK if needed, recording that environment difference.
- nginx 1.24 was copied from the previous local proxy qualification to
  `<evidence>/performance/bin/nginx`; the harness expects that location. Version
  and SHA-256 evidence is retained. No system nginx configuration is edited.
- A packaged backend with the opt-in `observability` profile and Prometheus
  registry. The default `application.yml` keeps `management.server.port: -1`.

The audit could not create a systemd user scope: no user bus is available.
Consequently **memory is not constrained to the VPS envelope**. Host RAM, CPU
model, OS, storage and absent Cloudflare/TLS/AOP are qualifications on the result.
Do not infer production latency or a hard user ceiling from this local experiment.

## Build and run

From the repository root, build using a writable Maven repository (the audit's
instrumentation work populated the repository below):

```bash
JAVA_HOME="$PWD/.release-evidence/2026-11-03/temurin/jdk-25.0.5+8" \
PATH="$PWD/.release-evidence/2026-11-03/temurin/jdk-25.0.5+8/bin:$PATH" \
taskset -c 4-7 mvn -B -ntp -f backend/pom.xml \
  -Dmaven.repo.local="$PWD/.release-evidence/2026-11-04-vps-audit/instrumentation/maven-repository" \
  -DskipTests package

python3 perf/k6/local-benchmark.py --suite all \
  --session clean-parity-c2 --cluster-key c2 --pg-port 55466 \
  --pg-bin "$PWD/.release-evidence/2026-11-03/pg-noble/root/usr/lib/postgresql/18/bin" \
  --pg-library-path "$PWD/.release-evidence/2026-11-03/pg-noble/root/usr/lib/x86_64-linux-gnu" \
  --extend-if-needed
python3 perf/k6/summarize.py \
  .release-evidence/2026-11-04-vps-audit/performance --recursive
```

`--suite smoke` runs only the 1-VU qualification, with the same required fresh
session/cluster arguments. The command above is the exact clean-c2 invocation;
choose new unused labels for another attempt. Existing evidence and cluster
directories are refused. The harness copies the packaged JAR before starting
Java, so later Maven writes cannot modify the loaded bytes.

Keep the harness in one resident command/session. The managed executor uses
separate PID/IPC/mount namespaces and reaps detached processes when a command
ends; its network namespace is shared. Earlier connection-refused observations
were caused by process lifetime, not independent networks. A single foreground
PostgreSQL `Popen` child remains owned by the harness for the entire matrix.
Explicit fast shutdown and `wait()` record its exit, final control data and
PID-file absence. No PID file is ever deleted and no data directory is reused.

A global file lock is acquired **before** initialization. New cluster data lives
at `<evidence>/clusters/<cluster-key>/data`, with its own short sibling `s/` socket
directory. Socket pathname length must remain below 108 bytes. The selected port
is explicitly guarded (clean-c2 uses 55466); a bind check rejects an occupied port.
The harness waits for its own server-ready log, then verifies PostgreSQL's system
identifier, data directory, port and loopback address against fresh control data
before creating any database, role or fixture. The raw address CIDR is retained.
`cluster-lifecycle.json` and `cluster-fingerprint.json` make these checks reviewable.

`bootstrap.py` uses the packaged application's exact Flyway libraries and
approved V001–V106 migrations, then the runbook's runtime ownership/ACL cleanup,
then `seed.sql`. The owner is `NOLOGIN`; Java uses the non-owner, non-superuser
`pliego_app` role. The final seed commits each author/publisher/category/book/
customer entity rather than accumulating over 1000 subtransactions in one parent
transaction. The original giant-transaction fixture and WAL evidence remain
retained. Changing cluster fencing, PostgreSQL build and transaction shape
improves qualification, but does not isolate the cause of the historical native
MultiXact error.

The clean matrix uses PostgreSQL 18.6's Noble package binaries and their required
ICU 74/libxml libraries from the previous verified local artifact. The host still
runs Ubuntu 26.04, so this is closer binary parity, not a complete Ubuntu 24.04 VM.
Each session snapshots source SHA-256 values and the JAR hash. All credentials,
customer identities and JWT keys are explicitly synthetic; no inherited secret
variables enter children.

Native JVM exits and PostgreSQL integrity errors stop further scheduled runs,
preserve raw evidence and exclude the affected session from capacity acceptance.
A successful k6 threshold result never overrides a known substrate inconsistency.
The native C2 crash, 900-second retry, historical inconsistent cluster and c1
fail-closed setup remain separate historical evidence. A single-method diagnostic
is available only through explicit `--exclude-prometheus-compilation` on another
freshly named session/cluster. It adds exactly this literal option:
`-XX:CompileCommand=exclude,io/micrometer/prometheusmetrics/PrometheusMeterRegistry.lambda$addDistributionStatisticSamples$0`.
It changes no application source and cannot certify default-JIT behavior. The
normal clean-c2 matrix does not use it. Post-run `Compiler.codelist` captures are
read-only and occur after the timed k6 process ends.

The fenced normal-JIT c2 attempt subsequently stopped at a different native C1
level3 fault while compiling Tomcat path parsing. Consequently a narrowly bounded
**diagnostic** cohort was started with basic C1 compilation only:

```bash
python3 perf/k6/local-benchmark.py --suite all \
  --session diagnostic-tier1-c3 --cluster-key c3 --pg-port 55467 \
  --pg-bin "$PWD/.release-evidence/2026-11-03/pg-noble/root/usr/lib/postgresql/18/bin" \
  --pg-library-path "$PWD/.release-evidence/2026-11-03/pg-noble/root/usr/lib/x86_64-linux-gnu" \
  --extend-if-needed --diagnostic-tier1 --skip-explains
```

`--diagnostic-tier1` adds exactly `-XX:TieredStopAtLevel=1`; it does not add the
single-method exclusion. G1 remains the observed collector. Per-run metadata
explicitly records `production_jvm_parity=false` and `diagnostic_jvm_mode=C1-tier1`.
These results cannot establish normal-JIT production capacity or cure either
native compiler failure. The c2 SQL plans remain referenced because the approved
schema, PostgreSQL build, logical fixture and config are unchanged; only the JVM
compiler control differs in c3. No further unbounded compiler-flag experiments
are part of this workflow if that control itself fails.

To run k6 independently against an already resident local fixture:

```bash
env -i PATH=/usr/bin:/bin BENCHMARK_DISPOSABLE=1 \
  BASE_URL=http://127.0.0.1:18085 VUS=15 HOLD=600s \
  FIXTURES="$PWD/.release-evidence/2026-11-04-vps-audit/postgres/fixtures.json" \
  SUMMARY="$PWD/.release-evidence/2026-11-04-vps-audit/performance/manual-summary.json" \
  K6_NO_USAGE_REPORT=true taskset -c 4-31 k6 run \
  --out json=.release-evidence/2026-11-04-vps-audit/performance/manual-raw.json \
  perf/k6/journeys.js
```

`journeys.js` requires `BENCHMARK_DISPOSABLE=1`; historical audit invocations use
an HTTP loopback URL with an explicit port. Non-loopback execution additionally
requires the staging opt-in and exact allowlist described below. Redirects are
disabled. The resident local harness gives all
children an environment allowlist: inherited `PLIEGO_MAILTRAP_*`, `PLIEGO_R2_*`,
cloud credentials, datasource credentials and JVM option variables cannot enter.
It sets mail and R2 disabled explicitly and disables the billing artifact worker.

## Fixtures and safe checkout

`seed.sql` uses approved Database API routines with per-entity commits and contains an
explicit database, port, server-address and PG18 guard. It creates 425 books,
424 editions, 545 authors, 577 author links, 172 publishers, 175 physical inventory
rows, 44 offers (21 active), 12 synthetic categories and 160 synthetic verified
customers with delivery addresses. Customer count intentionally exceeds the
production five users to avoid account-sharing contention during stress. Physical
inventory is deliberately ample, so this measures service capacity rather than
stock exhaustion. Titles are synthetic; query selectivity differs from production.
The fixture is analyzed before load; repeatable warm-cache measurements do not
model an un-analyzed or cold production database.

All checkouts use `TRANSFER`, `simulationOutcome=PENDING`, a fresh UUID idempotency
key and the current cart ID/quote fingerprint. No payment is confirmed. The
approved routine necessarily creates a local **DRAFT** invoice and **PENDING**
payment row, together with a `PENDING_PAYMENT` order. The billing worker is off,
so those drafts must never become issued invoices or generated artifacts. Mail
delivery and R2 are off. Final aggregate SQL evidence checks invoice/payment
states, artifact count and outbox states; no real financial or delivery effect is
possible in this disposable environment. Disabling billing is a parity difference;
home delivery, offer lifecycle and realtime retain their defaults.

## Journeys and load schedule

Each VU follows a deterministic ten-journey cycle: 70% browsing, 20% authenticated
cart work, 10% pending checkout. This is an explicit engineering mix, since the
production request sample cannot establish a representative conversion funnel.
The 1-VU smoke starts with checkout so every group has positive samples.

Every journey lists a catalog page, filters by physical format/language/price,
loads filter/category options, performs a global search and opens a real seeded
edition. Account journeys log in, restore the cookie session with `/auth/refresh`,
add/read/update a cart and log out; checkout journeys also submit the guarded
pending transfer. VUs retain independent cookie jars. Each think interval is
uniform 2–6 seconds. Related filter requests and the two quantity edits occur in
short bursts, as explicit journey steps; there is no think delay after every HTTP
request. This model yields request throughput from active users, rather than a
fixed arrival-rate test.

The local nginx location matches the measured production forwarding, 30-second
read timeout, default buffering/gzip behavior and absence of an upstream keepalive
pool. It maps synthetic `CF-Connecting-IP` to `X-Forwarded-For`; the trusted
loopback Tomcat proxy resolves a distinct client IP per VU. This represents
distinct local clients honestly without disabling admission limits. The local
HttpOnly cookie uses `Secure=false` because the client connection is HTTP; other
cookie/session behavior and actual BCrypt cost 12 are retained.

| Run | Steady users | Sustained stage | Repeats |
| --- | ---: | --- | ---: |
| Smoke | 1 | 45 seconds | 1 |
| Baseline | 5 | 90 seconds | 2 |
| Expected | 10 | 90 seconds | 2 |
| Target, SSE off | 15 | 600 seconds | 3 |
| Target, SSE on | 15 HTTP VUs plus 15 stream VUs, representing the same 15 accounts | 600 seconds HTTP | 1 |
| Initial stress | 25, 40, 60, 100, 160 | 120 seconds at each step | 1 |
| Optional extended stress | 250, then 400, then 600 | 120 seconds per independent run, stopping at the first failed threshold | As needed |

Ordinary runs have separate 15-second ramps up/down and graceful completion.
Stress has 30-second ramps between steps and after the final step. The initial
160-user ceiling matches the original distinct account fixture. With
`--extend-if-needed`, the harness checks whole-run threshold flags and individual
steady-stage results. If all pass, it invokes guarded `extend-customers.sql`
outside any timed window, writes a separately hashed `fixtures-extended.json`,
warms the new fixture at 15 VUs for 120 seconds and runs independent 250/400/600-VU
steps. Each has 30-second ramps and 120 seconds sustained. It stops at the first
nonzero k6 status. `step.js` reuses the unchanged real-contract journeys.

The entire clean qualification, including optional extended stress, uses one
foreground PostgreSQL and one Java lifetime. Catalog counts remain fixed;
customer count grows only for the explicitly labeled extended phase, preventing
shared-cart races between synthetic users. Report the last passing and first
failing stage as a bracket, with workload qualifications, rather than an exact
capacity. A completed exit 99 is valid threshold-crossing evidence; an underlying
native failure is a separate integrity/stability finding.

## SSE and measurements

k6 uses its standard HTTP client, with a 75-second timeout, to hold each stream
until the server's approximately 60-second lifetime ends. It parses the complete
body afterward. Validation requires HTTP 200, `text/event-stream`, no transport
error, parseable frames/heartbeat and a 55–65 second lifetime. It counts event,
checkpoint, resync and heartbeat frames separately. No extension is installed.
This verifies completed streams and event content, **not individual event arrival
latency or heartbeat gaps**. The previous SSE transport qualification remains a
separate source of evidence.

Both stream and ordinary VU cohorts map modulo 15 to the same 15 accounts, with
independent per-VU cookie sessions. Thus private cart/order invalidations from the
ordinary journeys reach the active stream cohort. There are 30 k6 VUs in this
comparison, modeling 15 logical users with an HTTP worker and a stream worker each.
Alternating `Last-Event-ID: 0` exercises resume-presence metering; it is not a
claim of correct replay for a real previously consumed cursor.

The suite tags endpoint names with templates and groups catalog/search/detail,
auth/cart/checkout. Unexpected 401, 429 and any other unexpected status count as
errors. Thresholds are p95 <800 ms for catalog/search/detail, <1500 ms for auth/cart,
<3000 ms for checkout, and unexpected errors <1%. Every group must have positive
request count; an empty group cannot silently pass. SSE has a separate error
threshold. `ordinary_http_duration` excludes the long-lived stream requests;
the built-in aggregate `http_req_duration` contains them and must not be used as
ordinary HTTP latency in the SSE run.

One Prometheus scrape every five seconds captures both Hikari pools, Tomcat,
heap/GC/threads, process CPU and SSE meters. Full raw scrapes are saved alongside
UTC JSONL host memory, PSI and Java/PostgreSQL `/proc` snapshots. PostgreSQL process
titles in the later sampler revision distinguish client backends from internal
workers; counts of all PostgreSQL PIDs are not client connection counts. One
guarded read-only aggregate query after a run ends verifies synthetic IP admission
buckets and the absence of issued/approved/artifact/sent effects. It adds no SQL
polling inside the measured window. Independent
`pidstat` and `vmstat` run in the same window. NMT summaries are captured before,
after, and at about 60 seconds during each longer run. Scraping and NMT add a small
unquantified measurement cost; five-second snapshots can miss short pool spikes.

`summarize.py` recomputes p50/p90/p95/p99, request counts, RPS and error rates per
group directly from raw points, retains the k6 threshold flags and reports any
percentile reconciliation difference. It also reports individual endpoint
latencies, including login separately. Whole-run results include ramps and
graceful completion. Additional steady-window statistics use the longest plateau
of the actual `vus` metric, with approximately one-second boundary resolution;
stress stage results and resource windows remain distinct from aggregate claims.
`measurement_valid` means the server/test completed without an infrastructure
abort; `all_thresholds_passed` and `slo_accepted` are separate fields. A healthy
stress run with k6 exit 99 is valid evidence of a threshold crossing and must be
retained as the first measured constraint. `valid_for_capacity` in the original
run metadata records native-process survival, rather than threshold acceptance.

Raw clean per-run paths are `<evidence>/performance/sessions/clean-parity-c2/runs/<name>/{run.json,summary.json,
raw.json,results.json,k6.log,pidstat.txt,vmstat.txt,samples/}`. Consolidated clean results
are in that session as `results.{json,md}`; `summarize.py <evidence>/performance --recursive`
also creates `results-all.{json,md}` across historical and clean sessions. Each `invocation.json` retains the exact k6 argv and controlled synthetic environment.
Exact runtime argv, UTC start/end,
exit status and output paths are in `runtime-commands.jsonl`; setup/package
commands and failures are in `commands.jsonl` and `setup-commands.jsonl`.

## Additive review cohort: checkout sample size and database commits

The review addon is separate from all completed matrix rows. It leaves
`journeys.js` and original raw files unchanged. `--suite checkout-review` uses one
fresh fenced cluster and the same C1-tier1/configuration, with an explicitly
hashed newly hardened JAR, for exactly three new cases:

1. 15 HTTP workers, 120-second hold, existing journeys.
2. 15 HTTP plus 15 stream workers, 120-second hold; the stream scenario runs 150 seconds
  and completes in-flight approximately 60-second GETs normally.
3. `checkout-weighted.js`:15 workers × 10 iterations, targeting 150 actual checkout
  HTTP requests and 150 positive 201/PENDING/PENDING_PAYMENT response checks.

The focused checkout uses real login/session cookies, clears only its own
synthetic cart through the API, adds a stocked physical edition, reads the current
quote and submits an unconfirmed transfer with a fresh idempotency key. Uniform
2–6-second think time remains. It is a 100%-checkout-focused journey, not the
original 70/20/10 mix. Its actual counts and primary percentile samples must be
reported alongside p95/p99; iterations alone do not establish checkout coverage.

The optional `--db-observer` points to the guarded read-only observer under the
raw PostgreSQL review evidence. It starts before each new case and must produce
`ready.json` before load. One READ ONLY transaction clears its statistics snapshot
before every 5-second `pg_stat_database` sample; it does not commit per sample.
After load the runner allows at least 6 seconds for asynchronous backend counter
publication, stops the observer and retains its final rollback outside the
counter window. Use actual UTC sample windows and retain observer overhead/status.
Original C3 database commits/s were NOT MEASURED; new observations must never be
relabeled as original matrix evidence.

Example of the separately labeled addon (choose unused local labels/port):

```bash
python3 perf/k6/local-benchmark.py --suite checkout-review \
  --session review-checkout-c4 --cluster-key c4 --pg-port 55468 \
  --pg-bin "$PWD/.release-evidence/2026-11-03/pg-noble/root/usr/lib/postgresql/18/bin" \
  --pg-library-path "$PWD/.release-evidence/2026-11-03/pg-noble/root/usr/lib/x86_64-linux-gnu" \
  --diagnostic-tier1 --skip-explains \
  --db-observer "$PWD/.release-evidence/2026-11-04-vps-audit/postgres/review-corrections/observe-db-commits.py"
```

The native compiler failures are local-host qualification instability, not proved
PLIEGO software defects. C1 may consume more CPU, so headroom can be plausibly
conservative, but no formal bound or production parity follows. A remaining
normal-C2 qualification on a dedicated staging 2-vCPU/4-GB VPS is a future plan
only; this workflow never contacts a VPS or production.

## Isolated VPS qualification (prepared 2026-11-05)

The shared `target-guard.js` preserves explicit-port HTTP loopback use with
`BENCHMARK_DISPOSABLE=1`. A non-loopback host additionally requires
`BENCHMARK_STAGING=1` and an exact lowercase hostname/IP entry in comma-separated
`BENCHMARK_ALLOWED_HOSTS`. Production apex and every subdomain are refused even
when allowlisted. Credentials, URL paths/query/fragments, malformed ports and
ambiguous local aliases are refused; all existing request redirects remain disabled.
The guard does not verify DNS resolution or ownership: use only an operator-verified
isolated staging identity. Workload and threshold bodies are unchanged.

Run `node --test perf/k6/target-guard.test.mjs` for the pure guard tests. Use the
[staging kit](../../deploy/staging/README.md) and
[runbook](../../docs/operations/2026-11-05-staging-runbook.md) for the separate-generator
matrix. The older local harness remains local-only; do not execute it to provision
staging or write new results into the completed audit tree. Default production
monitoring stays off; preparing this kit neither provisions nor contacts a VPS.
