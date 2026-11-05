# Disposable SSE capacity and recovery experiment

Requires PostgreSQL18 native binaries, Java25, Python3 and `taskset`. Build/freeze
the reviewed backend JAR first. The runner creates a new private persistent output directory,
its own cluster/database and synthetic fixtures; it binds only loopback. It never
uses an existing database. Ports5432/55436/55539 and output under `/tmp` are refused.
Repository evidence must be inside ignored `.release-evidence`.

```bash
PLIEGO_TEST_DISPOSABLE_DB=1 PYTHONDONTWRITEBYTECODE=1 taskset -c 24,25 python3 -B scripts/load/sse_capacity.py \
  --jar '<evidence>/artifacts/backend.jar' \
  --java-bin '<evidence>/temurin/jdk-25.0.5+8/bin/java' \
  --output '<evidence>/capacity-fixed/t-old' \
  --cpus 24,25 --pg-port 55547 --http-port 18094 --suite healthy-warm

PLIEGO_TEST_DISPOSABLE_DB=1 PYTHONDONTWRITEBYTECODE=1 taskset -c 24,25 python3 -B scripts/load/sse_capacity.py \
  --jar '<evidence>/artifact-batched/backend.jar' \
  --java-bin '<evidence>/temurin/jdk-25.0.5+8/bin/java' \
  --output '<evidence>/capacity-fixed/t-final' \
  --cpus 24,25 --pg-port 55547 --http-port 18094 --suite fixed-warm --expect-bounded
```

Defaults: PostgreSQL55547, HTTP18094, logical CPUs24,25, JVM256m/1280m,
Hikari8/min2, PostgreSQL max_connections30, mail/R2 disabled. Select two available
logical CPUs with `--cpus`; inspect their SMT topology before interpreting CPU
figures. `cpu-topology.txt` records the host mapping. Two logical CPUs may be SMT
siblings on one physical core; that does not prove parity with two production
vCPUs. `--suite recovery` runs the lock fault and recovery cases on another new
scratch database. Omitting `--expect-bounded` permits collection of the original
unbounded pool fault; with it the four REST fault probes must each be200/<500ms.
`--suite connection-lock` runs only the diagnostic lease-table fault after fresh
setup; use a new output directory and record its JAR SHA separately.
`--suite healthy` runs only0/128 read/write ramps. `--suite faults` runs both lock
faults. `--suite fixed` runs0/128 healthy ramps followed by both faults, including
mixed connect/read/disconnect concurrency, admission429 and residual lease expiry.
`--suite healthy-warm` runs an initial0-stream window plus three128-stream windows
in one JVM. Every window first sends200 actual warmup GETs per endpoint at
concurrency4, then measures200 GETs and30 writes of each kind. Distinct labels
preserve every window; raw warmup rows, measured endpoint throughput/time and
JMX measurement-only timestamps distinguish warmup/compilation from steady work.
`--suite fixed-warm` adds both lock faults, admission checks and lease recovery
after that warm sequence in the same JVM. It needs roughly five minutes because
both fault cases deliberately retain failed-cleanup leases until their expiry.
Use separate fresh runs with the old and corrected JAR on the same CPU pair and
resource settings for a regression comparison; historical0,1 data is not a direct
comparison for24,25. Never probe or manage another stack on55539.

The runner automatically starts the PostgreSQL query-age probe during lock faults.
For an independent repeat alongside a running experiment:

```bash
PLIEGO_TEST_DISPOSABLE_DB=1 python3 scripts/load/sse_capacity_pg_probe.py \
  --output '<evidence>/capacity-fixed/t-final' --port 55547
```

It waits for the lock-fault phase, then samples `pg_stat_activity` every100ms for
14seconds. This adds one short-lived monitor connection during the fault only.

The main experiment runs0/32/64/128 distinct subscribers,128 subscribers across32
users/four leases each, a130second steady window with retained-cursor reconnects,
the admission limits, disconnect release,1000/10000 hint publication/delivery/
cleanup, session revocation, backend restart, PostgreSQL restart and kill9 lease
expiry. Fixtures use public routines for501 editions,452 orders and100 digital
grants; measured writes reject fresh identity corrections and transition distinct
physical orders through REST. Direct SQL inserts only synthetic pending correction
inputs and burst hints in the disposable database.

Each ramp has5seconds warmup and200 requests per endpoint with concurrency4;
there are30 fresh decisions and30 distinct order transitions. Retain the result
sample counts and windows. The130second run requests all four endpoints together
every200ms and reconnects closed streams with their last cursor. It enqueues one
durable marker per customer every20s, checks delivery across two reconnect cycles,
and reports duplicate deliveries, route mismatches and unexpected resyncs. Bursts
require every reader to reach the final published head, then settle another2.2s
before checking the exact delivered set and scope. Cleanup forces an old cursor
and checks `resync`. These clients are
Python HTTP consumers; browser EventSource behavior needs separate validation.

Local attach JMX samples the named main pool every250ms. The separate collector
uses `-Xint` on the same selected CPU pair; the backend keeps default JIT. CPU, memory and PostgreSQL sampling is
every500ms. JFR profiles, GC logs, crash/replay paths, Java temporary files,
source snapshots and source SHA-256 manifests stay under the output directory.
SIGKILL leaves active JFR repository chunks; normal exit produces a final `.jfr`.
An unfinished SIGKILL chunk may remain locked and unreadable; validate with
`jfr summary` before describing an assembled file as a recovered recording.
The local JVM attach mechanism may use a transient Unix socket in its operating
system attach directory; that socket is not retained evidence.
PostgreSQL CPU sums observed postmaster/child tick deltas, missing
short-lived processes between samples; PSS avoids adding shared RSS pages several
times. JMX sample maxima can miss short waits. The test does not impose a memory
cgroup; the actual evidence filesystem is recorded and differs from production.
No production RAM/storage capacity claim follows.

Both cursor-table and lease-table faults hold an8s exclusive lock with128 streams.
Each independently schedules four concurrent REST requests at
2.5/4.5/6.5s after observing lock acquisition, so an earlier slow wave cannot hide
a later wave. The SQL probe counts active connect/read/disconnect together and
publisher work separately. The bounded gate requires1–4 mixed stream operations,
mixed plus publisher≤5, query age below2s and all twelve REST200 responses below
500ms. During the lease lock three admission probes must return the existing429
REALTIME_CONNECTION_LIMITED with Retry-After60; it records how many original
clients had already closed. Failed disconnect cleanup may leave rows until their
captured≤60s lease expiry. The runner waits for all rows to clear and a successful
reopen before completing. The diagnostic always retains its verdict. With `--expect-bounded`,
any REST response above500ms or different from200 raises after the measurements
are emitted and exits nonzero. Without that flag the runner completes and labels
the diagnostic failure in `run-status.json`. A failure disproves a universal
reserved REST-connection claim.

Summarize one or several runs without exporting fixture credentials:

```bash
python3 scripts/load/sse_capacity_summarize.py \
  '<evidence>/capacity/run-1' \
  --output '<evidence>/capacity/summary.json' \
  --report '<evidence>/capacity/report.md'
```

Compare the old warm control and final batched artifact on the same verified JDK:

```bash
python3 -B scripts/load/sse_capacity_summarize.py \
  '<evidence>/capacity-fixed/t-old' \
  '<evidence>/capacity-fixed/t-final' \
  --output '<evidence>/capacity-fixed/temurin-summary.json' \
  --fixed-report '<evidence>/capacity-fixed/temurin-report.md' \
  --warm-report '<evidence>/capacity-fixed/temurin-warm-report.md'
```

Replace the quoted `<evidence>` placeholder with the private evidence root. Quotes
keep the placeholder from being interpreted as shell redirection. Keep absolute
private evidence paths out of committed documents.
Run the two artifacts sequentially and use fresh output names. Keep measurements
from different JDK vendors or patch versions separate, and use the matching
JDK's `bin/jfr` for recording validation and event export.

Retain failed attempts, monitoring gaps and runtime crash records. Keep raw JVM
error reports private because they can contain environment variables. A normal
exit stops the backend and scratch cluster and leaves the evidence directory.
`run-status.json` distinguishes completed, failed and partial attempts. Retain all
attempts and identify which artifact SHA was measured. The summary includes raw
denominators, coverage and observed baseline ratios. Sequential warm runs and30
writes do not establish a production capacity or p99 SLA.
`--report` requires a main ramp run among the inputs; JSON summaries also support
individual targeted runs. Pass all diagnostic/reproducer attempts alongside the
main run to preserve a failed qualification even when historical execution passed.
Use `--fixed-report` for a clean old healthy control plus the corrected fixed suite.
Use `--warm-report` for a pair of completed healthy-warm runs. These reports expose
window-to-window latency ranges and CPU/GC rather than automatically certifying
performance equivalence. Keep the CPU pair exclusive of Maven or other heavy jobs
until both artifacts finish; preserve and exclude overlapping attempts explicitly.
