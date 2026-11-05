# PLIEGO encrypted production backup packet

Owner-approved policy, prepared locally on 2026-11-05; production installation and
activation require the ordered Claude/owner execution gates. Read the
[design](../../docs/operations/2026-11-05-backup-design.md),
[execution and DR guide](../../docs/operations/2026-11-05-backup-production-operations.md),
[owner credential/custody guide](../../docs/operations/2026-11-05-backup-owner-guide.md),
[Cloudflare plan](../../docs/operations/2026-11-05-backup-cloudflare-plan.md) and
[verification checklist](../../docs/operations/2026-11-05-production-backup-verification.md).
No application deployment, migration, Docker or new production package is included.

`backup.sh` + `common.sh` produce PostgreSQL18 logical dumps and password-free
cluster globals, inner checksums, AES256 public-key encryption and remote
ciphertext/checksum GET verification. Unique completion markers are published last.
Daily/weekly/monthly tier promotion uses first-success period receipts and
CopyObject/readback. Retention expiry is8/35/91/400days with shorter7/30/84/365day
locks. Partial uploads never count as recovery points; no remote pruning occurs.

`object-backup.py` copies only committed invoice PDF/XML references from
`billing-pliego/invoices/` to encrypted `pliego-db-backups/object-backups/v1/`.
Source access is GET-only. Ciphertext/index/inventory/run publication is verified.
Production config never selects the historical cover inventory feature. Invoice
backup objects have no lifecycle expiry and a proposed indefinite hold, pending
owner fiscal/reference-aware policy. Retain old decryption keys while any invoice
namespace needs them.

Both jobs run as hardened postgres services behind `deploy-lock.py`. PID1 supplies
an existing root-owned read-only lock via OpenFile (systemd>=253); the wrapper
retains flock through the entire fixed DB or invoice command. A contention skip
advances no receipt or heartbeat. Install the exact tmpfiles rule
`f /run/lock/pliego-deploy.lock 0600 root root - -`; it preserves inode/content and
enforces metadata. Never substitute f+, unlink, replacement or relaxed mode.
The canonical deploy lock open/flock semantics remain unchanged.

DB schedule:00/06/12/18:15UTC with <=5min jitter and30min timeout. Invoice
schedule:00/06/12/18:55UTC, beyond the nominal latest DB deadline, with45min timeout.
Persistent timers catch up once. Always establish first-run pairing explicitly:
complete DB then invoices and verify against the restored DB. The RPO~6–6.5h,
DB RTO30min and service RTO4h are objectives until demonstrated.

## Build, install and activate separately

```bash
python3 deploy/backup/ops/packet.py build --output /absolute/new/backup-release
```

Retain the emitted manifest hash independently. The packet includes runtime,
production ops and owner tools plus their helpers; the VPS installer copies only
VPS runtime/ops dependencies. The owner key-generation scripts remain workstation
only. No secret/private material belongs in this directory or any packet.

After review/transfer, Claude runs root `ops/install.sh --release /absolute/release
--manifest-sha256 HASH --account-id ACCOUNT --fingerprint FULL_FINGERPRINT
--public-keyring /absolute/public/recipients.gpg`. These are nonsecret arguments.
The bootstrap verifies the independently pinned SHA256SUMS and all contained
regular payloads before executing packet code; actual install requires root-owned,
non-writable source paths. `--verify-only` authenticates a packet without requiring
root or modifying system paths. Reinstall only with timers paused/jobs drained.

Installer outputs: scripts root:root0755 under `/opt/pliego/backup`, public keyring
and nonsecret configs root:postgres0640 under root:postgres0750
`/etc/pliego-backup`, units/drop-ins/tmpfiles0644. It rejects private key packets,
validates PG18/curl SigV4/systemd, applies only its tmpfiles file, verifies units
and postgres access, then daemon-reloads. It never starts or enables anything.

Owner privately runs `ops/install-credentials.sh` and `ops/install-ping-urls.sh`:
all values use silent prompts and final0600files. VPS writer values are shared
between `s3.json`/`object-target.json`, scoped only to the backup bucket; separate
`object-source.json` is billing read-only. Offline restore uses a separate backup
reader. Two physical check files `heartbeat.json`/`object-heartbeat.json` map to
logical `heartbeat.json` in their units. No secrets enter argv/logs/environment.

The installed heartbeat drop-ins select separate Healthchecks failure helpers,
replacing the unused legacy alert.curl dependency. The legacy helper is conditional
on its credential file's presence. Success follows actual completed publication;
missing/failed pings preserve the backup result. Create/test two external checks
with period6h/grace1h and email failure/overdue/recovery delivery. Hourly DB local
freshness checks all tier receipts; it cannot detect whole-host loss.

After real first-run remote canaries, both stream checks, attended isolated DB+
invoice restore and alert delivery pass, Claude runs:

```bash
/opt/pliego/backup/ops/activate.sh --first-run-verified INSTALLED_MANIFEST_SHA256
```

That acknowledgment records human review; the script also checks installed hashes,
credential modes/expiry and local DB tier freshness before enabling three timers.
`ops/uninstall.sh` disables scheduling, lets jobs drain and preserves every local
key/receipt/credential and remote object. No rollback deletes retained backups.
Canonical deployment pause/drain/resume changes are supplied as an unapplied
[patch](../../docs/operations/runbook-backup-patch.diff).

## Verification and local tests

`restore.sh` downloads/checks/decrypts an envelope and never executes SQL.
`verify-restore.py` adds fresh socket-only PG18 restore, pinned Flyway checks,
ACL/invariant/Database API smoke and cluster cleanup. Owner-attended
`owner/verify-attended-restore.py` pairs DB and invoices. All private-key operations
and plaintext restoration occur on the isolated owner workstation; never overwrite
an existing or production cluster. Retain only secret-free reports in evidence.

```bash
python3 -m unittest discover -s deploy/backup/tests -p 'test_*.py' -v
python3 deploy/backup/tests/object-backup-test.py
```

Native regression harness `tests/local-restore.py` uses PG18, pinned local Moto
and synthetic fixtures. Reuse verified local tools, keep runtime/evidence paths
new and short, and stop temporary clusters/Moto/key agents. It never contacts R2.
Existing gap evidence records native DB/ACL/sequence/Flyway/HTTP recovery proof.
Moto does not establish actual R2 scope/expiry/lock/lifecycle, real PID1 delivery,
owner key custody, notification receipt or production recovery times.
