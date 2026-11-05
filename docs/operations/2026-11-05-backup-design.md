# Off-site PostgreSQL backup design

Owner-approved policy, 2026-11-05. The production enablement packet is prepared
locally; installation, real R2 enforcement and recovery remain execution gates.
Claude performs production/Cloudflare operations. The owner alone handles private
keys, token values and ping URLs in a private terminal. This document authorizes
no additional infrastructure or application deployment.

## Recovery and scope

Encrypted logical PostgreSQL 18 backups run every six UTC hours at
00/06/12/18:15, with at most five minutes jitter and a 30-minute timeout.
Conditional RPO is approximately 6–6.5 hours (conservative scheduling bound
6h35min); DB RTO is 30 minutes and full-service RTO four hours. These are objectives
until measured. A snapshot represents dump start, not upload completion; missed
runs breach the objective. Persistent timers catch up once after downtime.

Use the dedicated private Standard R2 bucket `pliego-db-backups`: no public dev
URL, custom domain or CORS. PostgreSQL settings, WAL archiving and the application
remain unchanged. `pg_dump --create -Fc --compress=gzip:6` and password-free
cluster globals form a checksummed tar envelope, encrypted with AES256 and the
owner's public encryption recipient. Only the public keyring is installed on the
VPS. This is logical recovery, without point-in-time WAL replay.

R2 invoice PDF/XML bytes in `billing-pliego` require the separate encrypted
invoice job. The DB contains their keys, checksums and sizes, but no R2 object
bytes. Old `DATABASE` bytea invoices are included in the dump. Covers are outside
the approved scope: production config fixes source `billing-pliego`, prefix
`invoices/`; no cover credential, inventory or schedule is installed or used.
See [invoice preservation](2026-11-05-object-backup.md).

## Retention and publication

| Prefix | Selection | Bucket lock | Lifecycle expiry |
| --- | --- | --- | --- |
| `frequent/` | Every successful six-hour run | 7 days | 8 days |
| `daily/` | First successful UTC-day snapshot | 30 days | 35 days |
| `weekly/` | First successful ISO-week snapshot | 84 days | 91 days |
| `monthly/` | First successful UTC-month snapshot | 365 days | 400 days |
| `object-backups/v1/` | Invoice content/inventory/run markers | Proposed indefinite hold | None |
| `canary/` | Enforcement probes only | 1 day maximum | 2 days maximum, after lock |

The proposed indefinite invoice hold protects older deduplicated blobs that can
still be referenced by arbitrarily newer DB snapshots. A finite age lock could
expire while those references remain live. It is a protective default pending
the owner's fiscal-period decision, with no automatic lifecycle deletion; any
later change needs a reviewed reference-aware policy. Retain old invoice private keys indefinitely while that namespace is retained;
DB lifecycle ages never authorize invoice-key retirement.

Every DB lifecycle age is strictly greater than its lock age. Locks take
precedence over lifecycle deletion, and actual deletion is asynchronous.
Administrative privileges can remove R2 locks; keep administration separate from
writer custody. [Cloudflare bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
and [lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
The reviewed exact REST configuration and readback are documented in the
[Cloudflare plan](2026-11-05-backup-cloudflare-plan.md).

`backup.sh` captures dump-start UTC day/week/month once. After frequent PUTs it
uses CopyObject for tier promotion and fully GET-checks ciphertext and checksum
at each destination. Completion markers are last. Atomic local per-tier receipts
advance only after their own complete set; interrupted/state-lost runs repeat a
unique promotion rather than skip a period. Partial sets are never recovery
points. A failed later promotion causes failure and no success heartbeat even
when the frequent snapshot is independently complete. No remote pruning occurs.

## Credentials, keys and isolation

Use three expiring R2 credentials, each scoped to exactly one bucket:

- VPS writer: Object Read & Write on `pliego-db-backups`; shared physical writer
  values are installed as `s3.json` and `object-target.json` for the two jobs.
- VPS invoice source: Object Read only on `billing-pliego`, `object-source.json`.
- Owner restore reader: Object Read only on `pliego-db-backups`, outside the repo.

R2 provides no put-only permission. Locks limit a compromised object's writer
while in force, but cannot prevent bogus new archives, quota exhaustion or missing
future backups. Encryption gives confidentiality and integrity, not authenticated
source signatures. Choose a trusted pre-incident snapshot after compromise and
compare independent ID/hash history. A dump can contain executable SQL; restore
only on a trusted isolated host. [R2 permissions](https://developers.cloudflare.com/r2/api/tokens/).

Owner-run silent-prompt scripts write final 0600 root:root credential files;
`LoadCredential=` delivers them to hardened postgres jobs without environment or
argv exposure. Real expiry is recorded and rejected when expired. Rotate within
90 days and on exposure; atomically install new values, test both jobs and an
independent reader, then revoke old tokens. Preserve clock synchronization.
[Owner credential and key guide](2026-11-05-backup-owner-guide.md) gives the
exact private ceremony, two protected media, custodians and break-glass checklist.

Use the default `postgres` peer connection. The
[backup role evaluation](2026-11-05-backup-role.md) explains why merely changing
PGUSER to `pg_read_all_data` does not establish sufficient isolation. No DB role,
HBA or business-schema change is part of this packet. Hardened services retain
empty capabilities, NoNewPrivileges, protected system/home and private devices.

Per-run plaintext uses private 0700 directories and umask 0077; ordinary EXIT
cleanup cannot handle power loss/SIGKILL. Inspect abandoned state directories only
after checking for live jobs and locks. Keep all restore plaintext off the VPS.
Never copy the private key, passphrase or private-key backups to the VPS.

## Scheduling, deployment exclusion and alerts

Both DB and invoice units order after tmpfiles setup and use
`OpenFile=/run/lock/pliego-deploy.lock:deploy-lock:read-only` (systemd >=253).
`deploy-lock.py` validates PID1's descriptor, locks the existing inode with
`flock -n`, and inherits it across the entire child. Its fixed `--job invoices`
selection executes `invoice-backup.sh`; other commands cannot be supplied.
A held lock skips the run without receipts or heartbeat. Unit success alone
therefore does not prove a backup occurred. Both jobs also serialize their own
state. A deploy lock may be held by a deployment or the other backup stream.

Install exactly `f /run/lock/pliego-deploy.lock 0600 root root - -` as
`/etc/tmpfiles.d/pliego-deploy-lock.conf`, then apply only that file with
`systemd-tmpfiles --create /etc/tmpfiles.d/pliego-deploy-lock.conf`. `f` preserves
inode/content while enforcing metadata; never substitute `f+`, unlink, replacement
or relaxed permissions. PID1 opens only the existing file. The deploy runbook's
`exec 9>/run/lock/pliego-deploy.lock; flock -n 9` semantics stay unchanged.
[Systemd OpenFile](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#OpenFile=).

Invoice cadence is 00/06/12/18:55 UTC plus at most five minutes jitter, offset
40 minutes from DB scheduling. Jobs contend rather than overlap when DB takes
longer. First pairing explicitly completes DB then invoice copy and checks
coverage against the restored DB. Timers alone cannot prove that pairing.

The packet installs two Healthchecks drop-ins and distinct failure helpers.
DB success follows all tier publications; invoice success follows a real complete
copy. A skipped deployment gate cannot send success. The drop-ins replace the
legacy alert.curl receiver list with the corresponding Healthchecks helper; the
legacy helper is conditioned on its own file's presence. Keep separately approved
legacy integrations only after reviewing the merged unit configuration.

Create two external checks, DB and invoices, each period six hours/grace one hour,
with tested email delivery for failure, absence/overdue and recovery. Each stream
requires its own success. DB local freshness checks all four tiers hourly
(frequent 7h, daily 31h, weekly 8d+1h, monthly 32d); they cannot detect VPS loss.
An independently hosted read-only lister with separately held durable ID/hash
history remains recommended against a compromised sender; none is provisioned.
See [alerts/restore](2026-11-05-alert-restore.md).

## Installation, first acceptance and recovery

Follow the [production operations checklist](2026-11-05-backup-production-operations.md).
Build `ops/packet.py build --output /absolute/new/release` locally and retain its
manifest SHA256 independently. The root installer first checks that manifest pin,
all payload hashes, containment and regular paths before executing packet code.
It requires a root-owned source tree, validates endpoint/database/fingerprint and
public-only key packets, installs atomic files with fixed owners/modes, applies
only the lock tmpfiles rule, verifies units and reloads PID1. It never starts
services or enables timers. Reinstallation requires paused timers/drained jobs.

Claude reviews first real DB/invoice completion, ciphertext/hash readbacks,
actual R2 canaries and both alert paths; owner verifies isolated DB and invoice
restore. Only then does separate `activate.sh --first-run-verified MANIFEST_SHA256`
enable the three timers. It checks installed hashes, credential presence/expiry
and DB tier freshness; the flag attests Claude's remote/restore review, which the
script cannot independently infer from a local receipt. `uninstall.sh` disables
scheduling only and refuses to cancel an active job. Keys, config, receipts and
all remote objects remain preserved.

Weekly perform attended fresh isolated PG18 DB plus invoice verification; monthly
rehearse whole-host recovery; quarterly test an older archive/key. Fresh-VPS DR
keeps the private key and decryption on the owner workstation, transfers verified
plaintext only through approved private transport to a new empty cluster, checks
Flyway against pinned matching artifacts and canonical runtime privileges, then
performs controlled application smoke before separately authorized traffic cutover.
No restore may overwrite production. The operations guide gives the ordered steps.

## Cost and evidence limits

Budget approximately USD1/month for the small DB plus invoice dataset. Historical
observations were ~2.3MB DB ciphertext; roughly 94 tier snapshots total ~216MB.
R2 Standard is $0.015/GB-month, $4.50/million Class A and $0.36/million Class B
requests before shared allowances/rounding. Invoice copies retain all generations
and repeatedly GET-check old blobs; growth or a second provider changes costs.
Public prices are estimates; verify current account usage before reliance.
[Cloudflare pricing](https://developers.cloudflare.com/r2/pricing/).

Accepted native synthetic PG18/Moto evidence lives in
`.release-evidence/2026-11-05-gaps/FINAL-REPORT.md`; production-packet evidence is
`.release-evidence/2026-11-05-prod-backup/`. Local tests cannot establish real R2
scope/locks/expiry/lifecycle, PID1 credentials/boot behavior, notification receipt,
private-key custody or achieved production RPO/RTO. Those gates require recorded
Claude/owner execution. Historical staging, JVM, Actuator and performance work is
outside this backup release.
