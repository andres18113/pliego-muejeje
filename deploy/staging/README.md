# Isolated staging kit — prepared, not provisioned

Use the [staging runbook](../../docs/operations/2026-11-05-staging-runbook.md).
No script creates a VM, contacts production, calls Cloudflare, or downloads software.
Every wrapper defaults to a plan; `--apply` executes only on explicitly recorded
isolated identities. Plans record `exit_status: null` and `NOT_EXECUTED_DRY_RUN`.
A plan exit 0 means its rendering succeeded, never that the VM commands succeeded.

Files:

- `pliego.service`: byte-for-byte production unit from offline inventory lines252–295.
  No JVM/Tomcat/Hikari flags changed. MemoryHigh1700M, MemoryMax2G, TasksMax256.
- `99-pliego.conf`: byte-for-byte production PostgreSQL values, lines637–645.
- `nginx-staging.conf`: private HTTP proxy preserving API location semantics.
  Only forwarded host/scheme/port differ; no TLS/Cloudflare/AOP.
- `staging.env`: synthetic values only; mail/R2/billing disabled, existing
  observability profile explicitly enabled in staging. Shared default stays -1.
- `bootstrap.sh`: install approved offline packages/JDK/JAR, migrate through the
  existing fenced helper, remove migration privileges, seed original synthetic
  catalog, install unchanged unit, firewall, start and wait for health.
- `run-matrix.sh`: run k6 on separate recorded generator; observe target through
  strict verified SSH, save full JSON points, stop on threshold or substrate failure.
- `capture.sh`: root-only target inventory, JDK identity, cgroup enforcement,
  pidstat/vmstat/PSI, 5s local scrapes, best-effort fatal collection, journal and PG logs.
- `teardown.sh`: stop services on matching isolated machine and print required
  provider-console destruction steps. It does not claim to delete a VM or erase disks.
- `freeze-inputs.py`: hash already reviewed offline artifact/dependency closure and
  every migration/helper/config input. Never download or freeze a changing build.
- `test_staging.py`: local safety, manifest corruption, record and literal parity tests.

Local plan example, from repository root (use a fresh evidence directory):

```bash
deploy/staging/bootstrap.sh --out .release-evidence/2026-11-05-next/ws3/my-plan
node --test perf/k6/target-guard.test.mjs
python3 deploy/staging/test_staging.py
```

All real package/service/firewall/cgroup and capacity claims remain unproven until
an approved isolated VPS run. Packages on that new VPS require approval; the kit
expects Ubuntu24.04.5's complete offline dependency closure, PostgreSQL18.6 pgdg,
nginx, sysstat, ufw and Python3, plus the separately verified Temurin25.0.5+8 archive.
No package is added to production. Python's standard library suffices for this kit.
