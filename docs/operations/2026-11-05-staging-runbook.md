# Isolated 15-user qualification — 2026-11-05

Status: implementation prepared and locally checked; **no VPS created or contacted**.
This procedure does not modify production or enable its monitoring. An isolated
Ubuntu24.04.5, 2-vCPU/4-GB VM with Temurin25.0.5+8 and PostgreSQL18.6 is the remaining
normal-JIT capacity gate. Historical local C1 diagnostic results do not satisfy it.

## Identity, placement and approved inputs

An operator must authorize two disposable VM allocations, their hourly budgets,
region/network, the offline package list, synthetic fixture installation, firewall
changes and eventual destruction. Never target the existing VPS, copy production
data/environment files, or use an actual user, storage token or mail token.
No Cloudflare resource/API is involved. No commit/push/deployment is authorized here.

Create a vanilla Ubuntu24.04.5 target with exactly2 vCPUs/4GB, no PostgreSQL cluster,
pliego service or existing firewall allow rules. Use a separate small generator VM
in the same region/private network; it owns all k6 CPU. Record provider VM IDs,
private IPv4s, both `/etc/machine-id` values, administrator ingress IPv4, region,
SSH host fingerprint verified through the provider console, and destruction UTC in
a private copy of `deploy/staging/isolated-record.example.json`. The example contains
intentional placeholders and is refused by apply. Two distinct VM and machine IDs
are required. DNS is unnecessary for this kit; the shared guard can admit explicit
staging DNS names but does not attest their resolution. Approve DNS/IP mapping and
isolation out of band before using that general guard elsewhere.

A workstation through a tunnel is an alternative generator only after adapting its
record validation for that placement and recording RTT, tunnel CPU and packet loss.
The provided apply runner deliberately requires the separate VM record. Target80
admits only generatorIPv4; SSH22 admits generator/adminIPv4. Management8081,
backend8080 and PostgreSQL55468 remain loopback. Default-deny ingress plus a pristine
UFW ruleset are enforced; verify packet behavior from allowed and denied hosts before
accepting any measurement. No public ingress is needed.

Stage a frozen repository at `/opt/pliego/staging-repo` on the target and the same
sources on the generator. Provide a private offline artifact directory containing:

1. Official verified Temurin25.0.5+8 archive named `temurin-25.0.5+8.tar.gz`.
2. Exact tested frozen `pliego-backend-0.1.0-SNAPSHOT.jar`, built for that source SHA.
3. Complete reviewed `.deb` dependency closure for this Ubuntu image, including
   PostgreSQL18.6 pgdg, nginx, sysstat, ufw and Python3. The script uses `dpkg --install`
   and refuses version drift after installation; it never fetches missing packages.

Verify package/archive provenance using vendor signatures/checksums independently;
`freeze-inputs.py` hashes identity, not provenance. No newer Temurin diagnostic build
may replace the pinned capacity runtime. Run the following on the frozen source tree:

```bash
python3 deploy/staging/freeze-inputs.py --artifacts /var/tmp/pliego-staging-artifacts
```

Keep pins, frozen-source manifest, vendor verification and source SHA with the change
record; review them before transfer. All dependencies must already be available offline.
There is no unattended download that could resolve a later package version.

## Render, install and seed on the isolated target

All commands below are templates for an approved future run; none was executed against
a VM during this work. From `/opt/pliego/staging-repo`, render first:

```bash
deploy/staging/bootstrap.sh --record /root/isolated-record.json \
  --pins /var/tmp/pliego-staging-artifacts/pins.json \
  --artifacts /var/tmp/pliego-staging-artifacts \
  --out .release-evidence/2026-11-05-next/ws3/target-plan
```

After reviewing that exact plan, root executes it with `APPLY_STAGING=1` and `--apply`
in a fresh `--out` directory. It refuses an existing PostgreSQL cluster before any
package installation, then verifies the fresh installed DB before changing its port/HBA.
Temporary loopback postgres trust exists only during migration/fixture setup; the
finally cleanup restores peer + runtime SCRAM and stops both backend/PostgreSQL on failure.
If any cleanup command fails it retains the trust marker and reports incomplete recovery;
verify PostgreSQL is stopped before destruction. Stop and destroy a
failed partially installed VM; do not rerun bootstrap into reused database state.

The JAR is installed and fully frozen before any backend start. The existing
`perf/k6/bootstrap.py` uses its exact Flyway libraries, V001–V106, the canonical
runtime ACL cleanup and unchanged `seed.sql`. `pliego_owner` is NOLOGIN and runtime
`pliego_app` is non-owner/non-superuser after cleanup. The helper only accepts
explicit local disposable ports; staging uses its approved55468 for database
`pliego_benchmark`. This port/database-name variance prevents weakening the fixture
fence. PostgreSQL tuning bytes remain identical to production's99-pliego.conf.
Bootstrap output is under `.release-evidence/2026-11-05-next/ws3/staging-bootstrap`.

The original production unit is copied literally, including all hardening and
ExecStart arguments, MemoryHigh1700M/MemoryMax2G/TasksMax256. There is no NMT flag,
compiler workaround, JVM option environment variable, logging flag or tuning change.
The explicit staging-only observability profile uses loopback8081; production
`application.yml` remains `management.server.port: -1`. Synthetic mail, R2 and billing
artifact worker are disabled; synthetic transfer checkout creates only pending order,
payment and draft invoice states. Keep home-delivery/offer/realtime defaults.
Catalog fixture sizes match the audit:425 books,424 editions,545 authors,172 publishers,
175 inventory rows and44 offers(21 active), plus160 synthetic customers to avoid
shared-account contention. No stock/price/approved SQL is edited.

Nginx preserves the API location's proxy version, buffering default, empty Connection/
Forwarded headers, request-size and timeout semantics. Staging substitutes
`api.staging.invalid`/HTTP/80 for production's forwarded host/HTTPS/443. Synthetic
CF-Connecting-IP is trusted solely because the firewall admits only the controlled
generator; there is no Cloudflare or AOP. Cookies use Secure=false for this private
HTTP run. TLS/edge latency and production cookie transport are outside this result.

After bootstrap, record `ufw status verbose`, ports, java/PG/package versions,
OS image/CPU/memory/disk/swap, JAR/unit/config/fixture/source hashes and identity.
Verify catalog/auth smoke manually with synthetic fixtures before the matrix; bootstrap
health alone does not claim checkout readiness. Transfer only synthetic fixtures.json
to generator through the verified SSH connection. Never transfer a production env file.

## Matrix and evidence on the separate generator

Use a dedicated known_hosts file populated from out-of-band host verification. The
runner disables personal SSH config, agent forwarding and password fallback; it checks
the pinned fingerprint before connecting. A staging operator SSH key must already be
available locally; do not put it in this repository or output directory. Grant only the
reviewed isolated host's capture commands the required sudo privileges, never on production.

```bash
deploy/staging/run-matrix.sh --record /private/isolated-record.json \
  --known-hosts /private/staging-known-hosts --fixtures /private/fixtures.json \
  --ssh-user staging --out .release-evidence/2026-11-05-next/ws3/qualification-plan
```

Execute the approved plan with `RUN_STAGING=1 --apply` and a fresh output directory.
The target kit must remain at `/opt/pliego/staging-repo`. Matrix is smoke1VU45s,
5VU90s,10VU90s,15VU600s three independent repeats, then15 ordinary+15 SSE workers
for the same15 accounts, ordinary600s and streams660s. Ramps/think time/checkouts,
journeys and thresholds are unchanged. Every run gets full raw k6 JSON, summary,
exact argv/environment, UTC timestamps and exit status. SHA256 records bind suite,
guard, fixture SQL and JAR to this candidate. Different hashes from the prior audit
reflect the guard import only; local suffix/diff proof shows the workload unchanged.

The target's concurrent sampler must signal ready before load. It checks the same
PID/restart count and effective cgroup high/max, then saves pidstat, vmstat,5s PSI,
memory.events/stat/current/high/max, CPU stats, complete loopback Prometheus scrapes,
jcmd VM.flags/VM.command_line/VM.native_memory, journal and PostgreSQL logs. SSH carries
only evidence/control; scrapes execute locally rather than being publicly exposed.
For a manual reviewer tunnel, use a separately verified SSH command with
`-L 127.0.0.1:18091:127.0.0.1:8081`; access local18091 only. Do not change management
binding or create a public metrics listener. Retain all private target evidence under
`/var/lib/pliego-staging-evidence` and retrieve via the same verified SSH connection.

NMT was not enabled in the unchanged service. `jcmd VM.native_memory` may print
`Native memory tracking is not enabled` even with exit0; record **unavailable**, never
claim an NMT summary or add a flag. OS/cgroup/heap metrics remain available. A configured
`memory.high=1782579200` and `memory.max=2147483648` proves cgroup policy is applied;
`memory.events high` increments prove actual throttling only if the workload reaches it.
Zero high events means the threshold was not exercised, not that throttling failed.

Fatal logs are best-effort: ProtectSystem=strict prevents writes in WorkingDirectory,
and PrivateTmp directs fallback files into `/proc/<pid>/root/tmp` or host
`/tmp/systemd-private-*-pliego.service-*/tmp`. Capture discovers the live path before
load and starts WS2's fast inotify collector. A retained file descriptor can survive
unlink, but deletion before its create event is serviced remains a race. Record
absence explicitly; any process exit/restart invalidates capacity even without dumps.
Capture always saves the journal after sampler failure. Never accept a passing k6
summary over SIGSEGV/SIGBUS, C1/C2 fatal error, PostgreSQL PANIC/MultiXact/corruption,
OOM or loss of sampler evidence. Observer failure terminates the current k6 process
and prevents later rows; k6 nonzero/threshold failure also stops the matrix.

Acceptance remains catalog/search/detail p95<800ms; auth/cart<1500ms; checkout<3000ms;
unexpected errors<1%, checks>99%, every group count>0 and SSE error<1%/connections>0.
Require all three15-user repeats plus SSE to pass, normal JIT throughout, no native/DB
integrity failure, no JVM restart/OOM, complete raw evidence and enforced cgroup limits.
Report p50/p90/p95/p99, requests/counts, actual checkout sample count, throughput,
whole-run and steady-window resource peaks, scrape cost/interval and latency qualifications.
Review post-run read-only aggregate states: no issued invoice, approved payment,
artifact or delivered mail. Pending/DRAFT rows are expected. Those checks run outside
the timed load. A failed row is valid failure evidence, never an accepted capacity row.

## Optional WS2 soak

Use [perf/jvm/README.md](../../perf/jvm/README.md) observer and load templates for a
separate at-least2-hour normal-JIT15-VU cohort,5s-or-faster loopback scrapes, unchanged
unit and the same private fatal collector. Observer runs on target; load runs on
separate generator. Extend the approved destruction deadline and cost budget first.
Do not substitute that optional cohort for the three required600s repeats. Any missing
NMT remains a documented limitation; production monitoring remains disabled until the
WS2 stable-environment gate and owner authorization are both satisfied.

## Teardown, budget and proof limits

On the target, render `deploy/staging/teardown.sh --record /root/isolated-record.json
--out <fresh-private-directory>`, review, then use `DESTROY_STAGING=1 --apply`.
The script stops services only after identity matches. Export private evidence plus
checksums, then manually destroy **both recorded VM IDs**, attached disks and snapshots
through the provider console. Verify deletion and billing end; record receipt IDs.
Unlinking synthetic PGDATA on a cloud SSD is not proof of secure erase. Retain only
synthetic evidence, with private filesystem permissions and the approved retention.

Allow2–3h for approval/transfer/bootstrap/verification, about50–65min for the matrix
including ramps/graceful stops, and30min review/teardown: reserve5h of both VMs.
Cost model:5×(target_hourly+generator_hourly)+disks+egress+tax. An **illustrative budget
assumption**, not a vendor quote, of$0.05/h target+$0.02/h generator gives$0.35 compute;
add$0.14 compute for2h optional soak. Reprice actual approved region/SKU/minimum billing,
offline package transfer and snapshots before allocation. No actual spend occurred.

Local checks establish parsing, lint, literal unit/tuning parity, guard negatives,
manifest/record refusal, unchanged workload body, nginx configuration and dry-run
plans only. The original port80 nginx -t failed under local unprivileged bind rules;
the successful local rendering changes only its listen address to127.0.0.1:18092.
They cannot prove Ubuntu VM installation, packet isolation, SSH identity,
systemd cgroup enforcement, crash capture under real PrivateTmp teardown,15-user
capacity, normal-JIT stability or actual cost. Raw local evidence is
`.release-evidence/2026-11-05-next/ws3/`; failed and intentionally negative statuses
remain retained. No production audit artifact was rewritten.
