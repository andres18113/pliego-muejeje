# PLIEGO post-audit implementation plan — 2026-11-05

Status: local work complete and evidence consolidated; production actions are proposals only. Authority: `.release-evidence/2026-11-05-next/CODEX-BRIEF.md` and the owner's explicit local-only execution authorization. `<evidence>` denotes `.release-evidence/2026-11-05-next/`. Existing audit, ADR 0059 and audit evidence remain read-only.

The accepted qualified GO for 10–15 users remains unchanged. Recovery preparation is the first priority. Nothing here authorizes production traffic, Cloudflare API calls or resources, credentials, deployment, commits or pushes. Java/Tomcat/Hikari settings and default management port `-1` stay unchanged; staging artifacts reproduce existing settings only.

| Order | Workstream / severity | Benefit | Operational risk | Effort and deliverable |
| --- | --- | --- | --- | --- |
| P0 | WS1 backup and verified restore / High | Survive host loss with encrypted off-host recoverability | Key loss, silent failed schedule, deletion using a compromised writer, incomplete external invoice recovery | 2–3 implementation days plus owner ceremony; `deploy/backup/`, backup design and executed local drill |
| P1 | WS4 OpenAPI / Low–Medium | Remove unintentional anonymous disclosure of admin surface | Contract-generation or developer tooling breaks if opt-in is missing | 0.5–1 day; narrow uncommitted springdoc defaults/profile candidate, consumer assessment and real connector/contract tests |
| P1 | WS3 isolated capacity confirmation / qualification gate | Verify 15 users with normal JIT under actual 2-vCPU/4-GB cgroup limits | Unrepresentative client placement, mutable packages or wrong host; cost of forgotten VMs | 1 preparation day plus isolated VPS run; `deploy/staging/`, allowlisted k6 guard and dry runs |
| P1 | WS2 JVM diagnosis / unresolved local substrate risk | Distinguish deterministic compiler failure from broader host instability | Misattributing non-reproduction; turning diagnostic flags into production workarounds | 1 investigation day, then ≥2-hour stable staging soak; `perf/jvm/` and investigation evidence |

## Execution and review gates

1. Capture initial dirty workspace and SHA-256 of protected audit artifacts; assign disjoint files and ports. Root consolidates evidence instead of accepting agent summaries as proof.
2. WS1 prepares options, RPO/RTO and key/token custody, hardened units, retention/freshness alerting and all enablement/DR steps. Execute a fresh local PG18 synthetic migration/seed, backup/encrypt/upload/download/decrypt/restore, manifests and backend catalog/auth smoke. Record negative-test outcomes and unsupported local emulation explicitly. No production key or bucket is created.
3. WS4 traces every live and static contract consumer, implements explicit contract-profile opt-in, and verifies defaults deny docs while the generation profile works. Preserve the security matcher implementation and Spanish responses.
4. WS2 copies original replay evidence before executing, repeats compile replay with pinned cores, searches primary trackers and checks the next available Temurin update. Run only a bounded userspace CPU/memory verifier. Prepare a ≥2-hour scrape/load harness with ordinary JIT and explicit native-fault capture.
5. WS3 prepares an isolated Ubuntu24.04 production-parity kit, synthetic seed, separate generator, matrix, cgroup/PSI/NMT capture and teardown. Test the explicit staging allowlist and immutable production-domain refusal, shell syntax/lint, service rendering and a container-free local dry run. Real VPS acceptance is a later separately authorized execution.
6. Root reviews raw test logs, commands and artifacts; reruns focused checks; compares protected SHA-256 values and the unchanged JVM/Tomcat/Hikari/management defaults; produces an exhaustive file and command manifest.

## Review focus

- A successful upload is insufficient: downloadable encrypted bytes, key custody, checksum and full schema/content/privilege restoration must be proved.
- Object lock and lifecycle semantics differ between local S3 stores and R2; label exactly which cases are emulated and which remain owner verification gates.
- External R2 invoice objects are not inside a PostgreSQL dump; document separate preservation and consistency requirements.
- A replay that cannot load the compiler target is not a non-reproducing valid compile. Record classpath/initialization failures separately from valid compilations and fatal exits.
- The staging guard must reject production names even with an explicit opt-in or malicious URL syntax, and must disable redirects. Matching VM resources alone does not prove CPU equivalence.
- Disabling Swagger must preserve the actual CI/dev static contract pipeline and leave SecurityConfiguration unchanged.

## Approvals in dependency order

All local tests and candidate artifacts are already authorized. The following are future approvals, not pending questions for this task:

1. Approve backup design, RPO/RTO, retention, recovery ownership and budget; inventory encrypted DB plus separate invoice/cover dependencies.
2. Approve offline key generation, private-key custody, recovery-key holders, rotation and break-glass drill.
3. Approve a dedicated private backup bucket, scoped writer and separately held read-only restore credential, immutable retention/lock and lifecycle rules; owner performs any Cloudflare actions. Application credentials are never reused.
4. Approve any explicitly listed new production packages; approve root-only credential installation and backup/freshness/alerting units and the independent silence-detection destination.
5. Approve the first production backup and isolated restore verification before relying on the schedule. This task performs neither.
6. Approve isolated staging/generator VM creation, private network/firewall access, pinned package artifacts and cost ceiling. Approve its synthetic load and later destruction; never target production.
7. Review the WS4 candidate diff and CI evidence, approve its normal release/deployment separately, then have the operator verify docs behavior through the real edge.
8. Only after a representative stable-environment normal-JIT matrix and ≥2-hour soak pass, approve a separate monitoring activation with loopback binding, access boundary and measured overhead. Production monitoring remains disabled now.

## Rollback and stop conditions

Backup candidate rollback: stop/disable only the proposed backup/timer/freshness units and revoke the writer; preserve locked ciphertext, previous recovery keys and restore credentials. Never delete the last verified recovery point. A failed backup must not replace the freshness marker; freshness alerts must work without successful backups.

OpenAPI rollback: revert only the candidate springdoc/profile/tooling changes and redeploy through the canonical runbook after separate authorization. No schema rollback is involved.

Staging rollback: stop generators first, preserve evidence, stop the isolated services, destroy synthetic database/VM disks and revoke staging-only access. No production service or configuration is touched.

Any native JVM fault, PostgreSQL integrity error, dropped measurement, wrong target identity, failed guard, missing artifact hash or inconsistent restore blocks the affected result. Preserve its logs and classify the failure; a green HTTP summary cannot override a native crash or corrupt restore. Diagnostic JIT controls never qualify production capacity.

## Evidence and results

| Workstream | Executed evidence | Result and qualification |
| --- | --- | --- |
| WS1 | `<evidence>/ws1/drill-f/{PASS,commands.jsonl,database-comparison.json,backend-smoke.json,timings-and-limitations.json}`; `<evidence>/root/restore-raw-manifests.log`; WS1 `FINAL-REPORT.md` and validation ledgers | Native PG18.6 synthetic source/target;106successful versions,71tables/5367rows with identical content/counts, ACLs and sequences, least-privilege runtime probe; catalog/login/authenticated-cart200. Backup0.561s, ciphertext1,198,934bytes; local restore through backend smoke9.189s. Root independently compared raw source/target manifests. |
| WS2 | `<evidence>/ws2/replays/**/command.json`, `replay-summary.json`, `host-verify-core{0,2}.log`, `collector-probe.log`; `<evidence>/root/{replay-raw-verification,jvm-tests}.log` |40principal+1initial+9copied-runtime Java replays clean, target selected,0newfatal; bounded2x128MiB/60s verification clean.12harness tests pass. Classification unresolved; flattened classpath and short host test cannot establish hardware/JDK causality. No newer GA update available from official source. |
| WS4 | `<evidence>/ws4/{commands.jsonl,green-openapi-isolated-config.log,full-backend-tests.log,openapi-contract.json,ci-profiles.log}`; `<evidence>/root/{backend-test-summary,ws4-artifact-integrity,security-config-preserved}.log` |10dedicated tests pass: five docs/UI routes404 by default; explicit contract profile serves200 and exports104paths/41admin paths.795total backend tests,0failures/errors,39skipped. Exported paths/components and generated types equal static frontend contract. Nine consumer CI steps opt in. SecurityConfiguration and all non-springdoc application YAML bytes preserved. |
| WS3 | `<evidence>/ws3/{REPORT.md,commands.jsonl,final-guard-tests.log,final-safety-tests-v3.log,suite-body-proof.json,nginx-test.log}`; `<evidence>/root/{target-guard-tests,final-staging-tests,final-workload-body}.log` |46 guard and7 safety/parity/recovery tests pass; mutation removing production refusal fails four tests as expected. Unit/PG tuning bytes match the offline production capture. Workload/threshold/redirect bodies unchanged; both suites pass k6 init. ShellCheck, systemd validation, high-port local Nginx config and four dry-run plans pass. Plans are explicitly unexecuted VM commands. Actual VPS capacity/cgroups/firewall remain unproven. |

Backup negatives: wrong key exit2; corrupt/truncated stored ciphertext exit1; actual partial HTTP request times out28; client-side expired credential exit1; missing/stale freshness exit1; retained local version deletion curl22/HTTP400AccessDenied. Moto permits a retained-name overwrite as a new S3 version and does not validate real R2 credentials. These are disclosed emulator limitations, with actual R2 token/overwrite/delete canaries required before activation. No R2 verification was attempted.

The copied-runtime replay driver exit1 is an intentional coordinator stop at a reserved directory boundary; all nine completed Java children exited0. Retained red/isolation and preliminary restore-harness failures are not hidden or counted as passing tests. No native crash or PostgreSQL integrity failure recurred in the selected executed local cohorts.

Weekly attended restores use the offline key on an independent verifier; monthly fresh-VPS rehearsal and quarterly old-key/non-latest archive checks are specified in the backup design. DB dumps cover bytea invoice artifacts but exclude R2 invoice object bytes; a separate approved object-recovery policy is required before claiming complete invoice disaster recovery.

Before every future production release, pause/drain the proposed backup unit before taking `/run/lock/pliego-deploy.lock`, perform canonical migration/privilege cleanup and postflight, then resume timers. The backup's own lock does not share the root-only deployment lock. First-enablement review must accept this operational exclusion.

The final exhaustive deliverable/evidence inventories, consolidated commands/exits and retained limitations are linked from `<evidence>/root/FINAL-REPORT.md`.

Final review resolved bootstrap startup polling, tar-JDK capture, pristine-cluster preflight, failure-path restrictive HBA/PostgreSQL stop, frozen guard/collector inputs and host-visible PrivateTmp selection. The root independently repeated all7 staging safety checks and46 guard checks and compared both full workload bodies. Real throttling is demonstrated only if future memory.events high increments; reading memory.high proves policy configuration only.

The final protected-file comparison is `<evidence>/root/protected-final.log`:19,707 audit/doc files and400 additional immutable source/baseline files unchanged. `<evidence>/root/security-config-preserved.log` proves application.yml differs only by springdoc defaults and SecurityConfiguration is unchanged. No frontend UI or existing migration was edited. No production/R2 API action, commit, push or deployment occurred.

## Independent review (Claude, 2026-11-05)

Claude re-ran the decisive checks rather than relying on agent summaries:

| Check | Result | Evidence |
| --- | --- | --- |
| Completed audit preserved | `vps-audit-2026-11-04.md` and ADR 0059 SHA-256 unchanged; audit evidence still 19,705 files, none newer than the brief | `<evidence>/audit-preserve.sha256` |
| Full backend suite on the final tree | 795 tests, 0 failures, 0 errors, 39 skipped (existing PostgreSQL/R2-gated suites); all 10 new OpenAPI tests executed | `<evidence>/claude-full-test.log` |
| Independent backup/restore drill | PASS: 71/71 tables with identical counts and content, identical ACLs and sequences, 106 Flyway versions, backend catalog/login/authenticated-cart 200; backup 0.563 s, 1,198,934 B ciphertext, download+verify+decrypt 0.125 s, restore 0.686 s; stale/missing freshness and retained-version delete refused | `<evidence>/ws1/drill-claude-review/` |
| Staging parity | `deploy/staging/pliego.service` and `99-pliego.conf` are byte-identical (after comments) to the production capture of 2026-11-04 | `diff` against `.release-evidence/2026-11-04-vps-audit/prod/inventory-221729.txt` |
| k6 target guard | 46/46 pass; staging safety tests 7/7; JVM harness tests pass | `node --test perf/k6/target-guard.test.mjs`, `deploy/staging/test_staging.py`, `perf/jvm/test_soak.py` |

Corrections and additions from the review:

1. **WS4 gap fixed by Claude:** `scripts/ops/rehearse-reset.py` and `scripts/load/sse_capacity.py` start the JAR directly and poll `/v3/api-docs` for readiness, so the springdoc-off default would have made them wait forever. Both now set `SPRING_PROFILES_INCLUDE=contract` for their local backend only. The candidate's consumer inventory therefore covers CI, `scripts/dev.sh`/`start-backend.sh`, the reset rehearsal and the SSE capacity harness.
2. **WS1 retention promotion:** `daily/weekly/monthly` copies are created only by the 00:15 UTC run. If that run fails or a `Persistent=` catch-up runs at another hour, that tier is skipped for the period. Before enablement, promote the first successful run of each UTC day/week/month (state marker), or accept and document the gap.
3. **WS1 scope:** database dumps exclude invoice objects stored in the R2 `billing-pliego` bucket. Owner decision needed: R2 replication/versioning or a periodic encrypted object copy, so that "full invoice recovery" is not claimed from the DB backup alone.
4. **WS1 privilege note:** the backup unit runs as `postgres` (peer superuser). Acceptable for pg_dump plus globals, with the hardened unit; a dedicated non-superuser role with `pg_read_all_data` is the stricter alternative, and should be evaluated at enablement.
5. **WS2:** 50 clean replays and a 2×128 MiB/60 s user-space test cannot clear the workstation; classification stays **unresolved**. The host checks that can settle it are owner actions: Windows Memory Diagnostic or MemTest86 on this machine, plus the ≥2-hour normal-JIT soak on the staging VPS. Production monitoring stays disabled until the soak passes.


## Local backup gap follow-up — 2026-11-05 restart

The independent review's retention, object bytes and privilege follow-ups were
executed locally under `.release-evidence/2026-11-05-gaps/CODEX-BRIEF.md`, including
its shutdown Addendum. The [updated design](2026-11-05-backup-design.md) supersedes
the earlier hour00-only promotion and manual-only exclusion description above:
first-success day/ISO-week/month receipts, CopyObject/readback, per-tier freshness,
and a full-duration lock using systemd OpenFile preserve the root lock's existing
path/mode and postgres hardening. Manual pause/drain remains defence in depth.
Separate disabled candidates cover invoice bytes/pinned cover inventories and
optional deadman delivery; an attended isolated verifier performs fresh PG18
restore checks. Role evaluation retains postgres as default with measured caveats.
Public ARIN data confirms supervisor-supplied HostRush attribution. The exact
plan/CPU class, region and account currency remain owner decisions; conditional
monthly/hourly cost inputs do not authorize provisioning.
See `.release-evidence/2026-11-05-gaps/FINAL-REPORT.md` for final raw evidence,
command exits, retained failures, owner gates and emulator limits. No production,
Cloudflare/R2 API, credential, backend or CI edit is part of this follow-up.

## Independent review of the backup gap follow-up (Claude, 2026-11-05)

Re-run rather than accepted from reports (`.release-evidence/2026-11-05-gaps/claude-review/`):
full backup unit suite 42/42 with none skipped, object tests 9/9, ShellCheck and rendered-unit
validation clean, changed-source freeze 33/33, protected audit hashes OK, and a fresh full
PG18 + Moto regression drill (`g1/drill-claude`): 71/71 tables and 5,367 rows identical, ACLs and
sequences identical, 106 Flyway versions, backend catalog/login/authenticated cart 200, all 8
deliberate negative probes refused. `backend/**` and `.github/**` are byte-identical to the
session start.

Defect found and corrected: the OpenFile deploy-lock gate depended on a post-boot lock
"policy" that did not exist; `/run` is volatile, so every backup after a reboot would have failed
until the next deployment. Fixed by `deploy/backup/pliego-deploy-lock.tmpfiles.conf`
(`f /run/lock/pliego-deploy.lock 0600 root root - -`) and explicit
`After=systemd-tmpfiles-setup.service`; 3 new + 7 lock tests pass. Root ownership and PID1
delivery remain a first-enable host check.

Accepted conclusions: keep `postgres` peer as the dump identity (`pg_read_all_data` still reads
`pg_authid`); invoice/cover bytes need the separate opt-in object copy, not a lock on the
application prefix; Healthchecks-style dead-man ping is the primary silence detector, an off-VPS
read-only lister the secondary. Production provider is HostRush (ARIN `NET-65-75-201-0-1`).
