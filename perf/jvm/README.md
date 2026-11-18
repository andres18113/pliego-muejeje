# JVM diagnostics and normal-JIT staging soak

Prepared only. Never run this against production. The completed 2026-11-04 audit
and ADR0059 stay read-only; all new logs belong in a fresh evidence directory.
No script changes backend configuration, JVM flags, Tomcat/Hikari settings, or
systemd units. Production `management.server.port: -1` remains unchanged.

`replay.py` consumes **copies** of `inputs/replay_pid112.log` and the crash JAR's
unpacked `classpath/BOOT-INF/{classes,lib}` under its evidence root. Use a new
label; existing attempt directories are refused. It records every Java argv,
UTC start, duration, exit, target-compile detection and fatal filenames. Run the
same copied Temurin release first; a newer update is a separate diagnostic label.
This uses the same class/dependency bytes with a flattened classpath; it cannot
recreate Spring Boot's original classloader or all live VM/heap/JIT history.
`ReplayIgnoreInitErrors` and missing MethodHandle profile warnings further limit
negative evidence. A compiler bailout is not proof of the original optimization
path completing. Read raw compilation output before interpretation.

`host-verify.py --core 0 --seconds 60 --mib 128` is a bounded userspace pattern,
SHA-256 known-answer and integer known-answer check. The second worker on core2
uses another128MiB. It writes no host data and is not a full-memory/hardware test.
Coordinate shared-host CPU use before replay or verification.

## Staging soak

Use the WS3 isolated2-vCPU/4GB Ubuntu24.04 kit, synthetic fixtures and a **separate
load-generator VM**. The service must already be running with its reviewed
production-parity flags, normal tiered JIT, and the explicitly selected loopback
observability profile. Keep management8081 out of Nginx. Record unit hash, JAR
hash, Java/PG builds, cgroup limits, MainPID and NRestarts before/after. Run the
observer locally on the **target**, not the generator, as an account that can
read the service `/proc`, cgroup and crash files and attach `jcmd`. This is staging
preparation; provisioning and actual remote execution require operator approval.

PrivateTmp is significant: with the original read-only working directory a JVM
fatal file may fall back to its private `/tmp`. Before load, resolve the service's
host-visible `/tmp/systemd-private-…-pliego.service-…/tmp` using its mount
information and host directory listing. Verify the actual path belongs to that
MainPID/unit. Do not pass `/proc/PID/root/tmp`: that alias disappears with the PID.
Use that **host path** as `--watch` and `--fatal-dir`. Root may be needed. Start
`fatal-collector.py` and wait for its `ready.json` before the observer and load:

```bash
python3 perf/jvm/fatal-collector.py --watch "$STAGING_PRIVATE_TMP" \
  --out "$EVIDENCE/soak-fatal-collector" --seconds 7800
```

Keep the collector in a separate foreground terminal. It uses inotify, opens new
`hs_err_pid*.log`/`replay_pid*.log` files promptly, and copies from retained file
descriptors even after unlink. It requires no service flag or unit change. It is
best effort: files deleted before servicing the create event, event overflow,
permission errors, or host failure can still lose a dump. If the real staging
crash location/capture cannot be verified, qualification is incomplete; an absent
dump never turns a JVM exit/restart into success. Preserve the systemd journal
and coredump metadata where available. No crash dump was generated in the local
replay tests; collector behavior was tested with a synthetic file and unlink.

On the target, another foreground terminal runs:

```bash
python3 perf/jvm/soak.py --staging-only --pid "$STAGING_JAVA_PID" \
  --jcmd "$STAGING_JDK/bin/jcmd" --fatal-dir "$STAGING_PRIVATE_TMP" \
  --out "$EVIDENCE/soak-target" --duration 7500 --interval 2
```

Wait for `soak-target/ready.json`. Start the generator within60seconds so all7200
steady seconds plus ramps/graceful completion fit in7500seconds of observation.
If later, restart with a new evidence directory. Alternatively increase observer
and collector duration accordingly. No short-run override can certify a soak.

On the separate generator, with the WS3 exact-host safety guard in place:

```bash
python3 perf/jvm/load.py --staging-only \
  --base-url http://10.20.0.10:80 --allow-hosts 10.20.0.10 \
  --fixtures /private/synthetic-fixtures.json --out "$EVIDENCE/soak-load" \
  --hold 7200
```

The wrapper passes `BENCHMARK_DISPOSABLE=1`, `BENCHMARK_STAGING=1`, and
`BENCHMARK_ALLOWED_HOSTS` to the **unchanged journeys/thresholds**. It additionally
requires a private resolved origin, exact allowlist and an explicit HTTP port;
`*.pliegolibros.com` is always rejected. For an SSH tunnel use an allowlisted
loopback origin; that tunnel must reach staging. The suite itself independently
guards targets. The wrapper intentionally cannot bypass an older loopback-only
suite, so align with WS3 before remote use. It saves suite/fixture hashes, argv,
controlled synthetic environment, raw k6 points, summary, log and exit status.
Optional `--sse` adds15stream VUs for the same15accounts for the entire hold.

The observer retains gzipped full Prometheus scrapes every2seconds, `/proc`
process/host snapshots, PSI, cgroup memory/events/stat/cpu, effective VM flags,
command line/version, final compiler codelist and available fatal files. NMT is
captured **only if already enabled**; unchanged production flags do not enable
it, so `nmt_enabled=false` is an explicit measurement limitation. No NMT/JIT flag
is added. Cgroup limits must be MemoryHigh1700MiB and MemoryMax2GiB. MemoryHigh
reclaim events are retained; they are not fabricated OOMs. New OOM/kill events,
PID change/death, new fatal/replay data, scrape failure/gap>5.5s, shortened runtime
or absence of a final C2 Prometheus export-lambda compilation all fail closed.
An export lambda that has not reached/remained in the code cache is inconclusive,
not a runtime defect; inspect evidence and qualify on a fresh longer run if needed.

## Acceptance and production activation gate

A zero observer exit is only `OBSERVATION_PASS_PENDING_LOAD_AND_DB_REVIEW`.
Accept the environment only when the target covers **at least7200steady seconds
of15VU load**, every2-second scrape succeeds, both processes finish cleanly,
there are zero unexpected JVM/service restarts/fatal reports/PG integrity errors
or OOM events, original k6 thresholds all pass with positive samples in every
journey group, and the normal-JIT/cgroup/parity evidence is complete. Check PG
logs for ERROR/PANIC/MultiXact anomalies, systemd NRestarts/journal, and compare
sample resources over the whole window for sustained growth/reclaim pressure.
Retain exact commands/exits and hashes; run `perf/k6/summarize.py` against the
result as appropriate. k6exit99 or native faults invalidate acceptance.

The WS3 smoke,5VU,10VU, three15VU repeats and15+SSE confirmation remain required
alongside this soak. A clean soak cannot retrospectively validate invalid WSL
runs. Any native crash means stop load, retain evidence and reassess on an
independent host before changing JVM/application behavior. No config workaround
is proposed from these observations.

Only after staging passes, operator approval must separately cover production
profile/port and effective overrides, restart window, collector/provider,
credential handling if applicable, scrape interval, alert ownership/thresholds
and resource budget (ADR0059). Verify loopback binding and application-port
isolation after approved activation. Roll back by disabling the profile and
restarting. Production remains disabled throughout this work.

Local verification: `python3 -m unittest discover -s perf/jvm -p 'test_*.py' -v`.
The tests cover URL guards, compiler-workaround rejection, missing metrics and
OOM semantics. They do not execute a real2-hour service soak or prove systemd
PrivateTmp lifecycle behavior on the target.
