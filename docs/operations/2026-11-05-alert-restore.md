# Backup alerts and attended restore verification

Owner-approved production policy, 2026-11-05; locally prepared tooling has not
installed services or contacted production/R2/real alert receivers. Claude executes
the production checklist; the owner privately creates credentials and checks.
See [execution and DR](2026-11-05-backup-production-operations.md).

## Alert choice

Use **Healthchecks.io success/failure push as the primary**, with an independent
**off-VPS read-only R2 lister in GitHub Actions as the secondary**. The primary
uses two separate secret ping URLs: DB and invoices, each detecting its own
VPS/network/job silence. No successful DB ping substitutes for an invoice ping. It receives a
success only after all selected backup tiers complete readback and publication;
OnFailure sends `/fail`. Configure a six-hour period plus one-hour grace, activate
and test a missed heartbeat, `/fail`, recovery, recipient delivery and escalation.
A failure to send the ping logs a fixed warning and leaves a good backup successful.
A missing first ping must also produce an operational test alarm before reliance.

Public USD prices checked 2026-11-05; verify again before owner signup:

| Service | Free limits | Published paid entry | Fit |
| --- | --- | --- | --- |
| [Healthchecks.io](https://healthchecks.io/pricing/) | 20 jobs, 100 ping log entries per job | Supporter $5/month retains free limits; Business 100 jobs $20/month or $192/year | Two backup checks fit; 100 entries are about 25 days at four successes/day, less with failures |
| [Cronitor](https://cronitor.io/pricing) | Hacker: 5 monitors, one user, email/Slack; fastest checks five minutes | Business $2/monitor/month + $5/user/month; no minimum | One monitor + one user $7/month; capable alternative |
| [Better Stack](https://betterstack.com/pricing) | Personal-project plan: 10 monitors & heartbeats, email/Slack | Responder $34/month, or $29/month annual; extra 10 heartbeats $20/month, or $17 annual | Confirm commercial eligibility; no assumption PLIEGO qualifies for personal-project free service |

The helper intentionally implements Healthchecks UUID endpoints only; alternatives
need a separately reviewed adapter. See [Healthchecks failure semantics](https://healthchecks.io/docs/signaling_failures/).
No ping URL appears in argv, stdout, stderr or request bodies. Do not use shell
tracing or put it in an EnvironmentFile. Request bodies contain only `success` or
`fail`; redirects are rejected and a five-second network timeout bounds delivery.

The secondary should run every 15 minutes with a separate one-bucket **Object Read
only** credential. List each tier's complete markers, GET the newest, validate
ID/hash/size/time, and alert on missing/stale/future markers or regressing IDs.
Keep last-observed ID/SHA outside the VPS/R2 writer's control. Apply the same
freshness limits as the kit: frequent 7h, daily 31h, weekly 8d+1h, monthly 32d.
Give the lister its own independent dead-man check; otherwise its silence goes
undetected. It validates publication metadata, not decryptability or DB integrity.

[GitHub scheduled workflows can be delayed or dropped during high load](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
so avoid hour boundaries and monitor the monitor. Owner must create the workflow,
secret, durable last-seen state, notification route, and approve its Actions budget:
96 runs/day taking one minute each would use 2,880 runner minutes per 30 days.
At the published standard Linux two-core rate of $0.006/minute that is $17.28
before included compute credits; GitHub Free currently includes $12/month shared
compute credit. Actual duration/rounding, existing usage and plan determine cost.
[GitHub billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)
depends on plan and repository visibility. No `.github/` file is changed here.

A [Cloudflare Worker cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
is an alternative requiring an owner-created Worker, secret/binding, schedule and
external receiver. [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/)
allows 100,000 requests/day; CPU/storage and other account use still need review.
It shares Cloudflare's provider/account failure domain with R2, so it is weaker
against account loss. Neither implementation is provisioned by this task.

## Production integration

The owner creates two Healthchecks checks: database and invoices, each period
six hours and grace one hour, with an enabled email recipient. DB schedule is
00/06/12/18:15 UTC plus at most five minutes jitter; invoices use :55, beyond the
DB job's nominal :50 timeout bound. Failure, never-started/overdue and recovery
email receipt must be tested. Follow the
[verification guide](2026-11-05-production-backup-verification.md) for exact probes,
including a temporary short-period check to avoid waiting seven hours. Never
print the ping URL or use it as a shell argument.

Owner-run `ops/install-ping-urls.sh` silently writes root:root0600
`/etc/pliego-backup/heartbeat.json` and `object-heartbeat.json`. Both contain
`{"url":"OWNER_CREATED_HEALTHCHECKS_PING_URL"}` with the owner's actual UUID URL.
The DB failure unit uses the first physical file; the invoice helper maps the
second to the same logical `heartbeat.json` name required by heartbeat.py.
`LoadCredential=` keeps values out of config/environment/argv/logs.

`ops/install.sh` installs explicit drop-ins for both jobs and DB freshness. They
reset the base OnFailure list and select only their respective Healthchecks
failure helper. This packet does not provision legacy `alert.curl`; its legacy
unit is conditional on that file's existence. Inspect merged units before
retaining any separately approved receiver. The production packet requires both
ping files before first service start; a missing LoadCredential fails closed.
Standalone example files retain their historical opt-in behavior.

DB success is emitted after every selected tier completes. Invoice success is
emitted by `invoice-backup.sh` only after a complete copy. Both paths are behind
the full-duration shared deploy gate; skipped jobs send no success. Heartbeat
network/helper failure logs fixed diagnostics while preserving a valid backup's
exit status. A good exit status without a success marker can still be a lock
skip, so inspect receipts, markers and receiver state. DB freshness sends only
failure and never refreshes success. For complete rollback, disable timers with
`ops/uninstall.sh`, preserve credentials/keys/receipts and let active jobs drain.

## Operator-attended verifier

Use an isolated, trusted owner workstation with PostgreSQL **18**, curl, Python3,
tar, sha256sum and GnuPG. The script is `deploy/backup/verify-restore.py`; it creates
its own new cluster, uses a private mode0700 socket directory, starts no TCP
listener and stops the cluster on ordinary success/failure or SIGINT/SIGTERM.
Timed-out subprocess groups are killed before cluster cleanup. Never run it as root.
A new work path is mandatory; no existing cluster is accepted. Keep paths short
for PostgreSQL's Unix-socket path limit. Disk must accommodate ciphertext,
plaintext dump, restored database and review evidence. The work directory is
retained mode0700; report/command ledger contain statuses and aggregates only.

A database dump can execute SQL/code. Before using the private key or restoring,
choose a trustworthy immutable archive and inspect provenance after suspected
writer/superuser compromise. SHA/GPG integrity is not an authenticated source
signature. The isolated verifier must have no production DB connectivity, no
production application credentials and no unnecessary network access. The script
itself enforces fresh local PG startup, not a host firewall or VM boundary.

1. Verify the kit and approved release/migration count. Owner creates a separate
   read-only S3 credential JSON (`access_key`, `secret_key`, `expires_at`) in a
   private credential directory; it must not be the source writer/application key.
2. Retrieve the offline key under the approved custody ceremony, verify its
   fingerprint and unlock it on the workstation. Keep `GNUPGHOME` mode0700. The
   script does not accept a passphrase argument or automate private-key custody.
3. Configure only endpoint/bucket/region and the credential **directory path** in
   the environment. Run, replacing non-secret paths/endpoint with approved values:

   ```bash
   export BACKUP_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
   export BACKUP_BUCKET=pliego-db-backups BACKUP_REGION=auto
   export CREDENTIALS_DIRECTORY=/private/pliego-verify-credentials
   deploy/backup/verify-restore.py \
     --work-dir /private/restore-20261105 \
     --gnupg-home /private/offline-keyring \
     --database pliego --expected-flyway 106
   ```

   The placeholder endpoint is rejected until replaced by the approved 32-hex
   account ID. No actual endpoint is contacted by this preparation.
4. Require exit0 and `report.json` result `PASS`. The script paginates marker
   listings and chooses the newest timestamp/UUID completion ID in `frequent/`,
   ignoring partial uploads. It refuses stale/future/invalid markers (7h default),
   verifies outer SHA/size, decrypts, checks inner SHA and backup ID, restores
   globals and the database, checks consecutive successful Flyway versions against
   the operator-pinned count, and checks schema/relation/routine owners, runtime
   flags/grants, canonical geography/address ACL rules, constraint-validation policy,
   stock/invoice arithmetic and stored invoice-bytea SHA. `--prefix` permits a
   monthly/weekly non-latest exercise with an explicit matching
   `--max-age-hours`; this never silently falls back after a corrupt latest set.
5. Read-only smoke runs the catalog Database API **as `pliego_app`** inside
   `BEGIN READ ONLY`; no account/customer rows, passwords or tokens enter the
   report. This is a DB smoke, not an HTTP login/cart or full application smoke.
   Add the canonical isolated application smoke during monthly recovery rehearsal.
   The four exact historical identity constraints left `NOT VALID` by V072, V075
   and V080 are allowed by name and table; every other unvalidated constraint
   fails. The verifier does not retroactively reject grandfathered identities.
6. Bootstrap is `postgres` because PG18 role-membership grants can explicitly
   name that grantor. The verifier removes exactly the single duplicate
   `CREATE ROLE postgres;` statement from replay globals; every other SQL error
   is fatal. It never ignores broad restore errors, disables constraints, repairs
   grants, or runs migrations to make a failed backup pass.
7. Retain only the secret-free report/command-status ledger in approved evidence.
   Check `cluster_stopped=true`, remove the private plaintext work directory and
   temporary key home/derived keys under the custody procedure, unmount key media
   and destroy/revoke temporary restore credentials as appropriate. After SIGKILL
   or host loss, manually inspect the private work directory and stop its cluster
   before cleanup; an EXIT handler cannot handle power loss.

Run weekly, monthly for the broader fresh-host procedure, and quarterly with an
old key and non-latest archive. PASS covers DB recovery only: R2 invoice
bytes require the separate object-backup verifier. No live-source row equality
is claimed without a shared snapshot or trusted independent source manifest.
Moto tests demonstrate local S3 protocol/selection/corruption handling and native
PG18 restoration; they do not validate real R2 credentials, scope, account loss,
bucket locks/lifecycle, provider availability, notification receipt or key custody.

Owner inputs still required: private check creation, account/recipient/escalation
rota, attended verifier host/custodians/calendar, approved release count/provenance
and cleanup policy. Six-hour period/one-hour grace and both streams are approved.
An independent secondary lister/provider/budget remains a separate recommendation;
no workflow, Worker or other hosted monitor is created by this packet.
