# Production backup execution and fresh-VPS recovery

2026-11-05. Owner policy: encrypted DB every six hours; conditional RPO ~6–6.5h
(conservative bound 6h35min), DB RTO30min/full service4h until measured. Retention
8/35/91/400 days, corresponding locks7/30/84/365. Invoice objects retain indefinitely
with proposed indefinite hold until the owner sets fiscal policy. Budget ~USD1/month.
Covers, application deploys, schema changes and staging are outside this packet.

Claude executes every VPS/Cloudflare operation. The owner performs every private
key/token/ping-URL step in their own private terminal or privately attached tmux.
Codex prepared local files only. Never enable tracing or session capture around
secret entry; never pass secrets through argv, logs, evidence or environment files.
The private key and all its exports stay off the VPS.

## Ordered enablement

1. **Claude, phase A:** inspect `ops/preflight.sh` then execute read-only preflight
   as root. Require Ubuntu/systemd>=253, PG18 clients/peer access, expected Flyway,
   sufficient disk/memory and required binaries. An externally supplied preflight
   reports the deploy lock held: identify its holder, wait for completion, and
   release only this session's own held descriptor when appropriate. Never delete,
   replace, chmod or bypass the shared lock to make a backup run.
2. **Claude, phase B:** follow the
   [Cloudflare plan](2026-11-05-backup-cloudflare-plan.md). Create/read back private
   `pliego-db-backups`, exact prefix locks/lifecycles, invoice no-expiry rule and
   canary rules. DB locks must stay strictly shorter than expiry. Verify public
   dev URL disabled, no domain/CORS. Stop on drift, public exposure or wrong scope.
3. **Owner, phase B:** follow [credentials and offline custody](2026-11-05-backup-owner-guide.md).
   Generate the protected offline key, test two independent private-key media,
   share only public export/fingerprint and independently verify the fingerprint.
   Create the90-day backup writer, billing source reader and owner restore reader;
   create two external checks (period6h/grace1h, email). No secret values go to Claude.
4. **Codex locally / Claude review, phase C:** build the final packet:

   ```bash
   python3 deploy/backup/ops/packet.py build --output /absolute/new/backup-release
   ```

   Retain emitted `manifest_sha256` independently of the packet. Review its file
   list; it contains backup runtime, production ops and owner workstation tools,
   no application artifacts. Transfer via approved private transport. On VPS make
   the packet and its parents root-owned, without group/other write; retain the
   public key export separately. Stop/drain any previous backup timers/jobs.
5. **Claude, phase C:** inspect bootstrap `ops/install.sh`, independently check
   its hash against reviewed source, then install with nonsecret parameters:

   ```bash
   bash /absolute/backup-release/ops/install.sh \
     --release /absolute/backup-release \
     --manifest-sha256 INDEPENDENT_SHA256SUMS_HASH \
     --account-id APPROVED_32_LOWERCASE_HEX_ACCOUNT \
     --fingerprint INDEPENDENT_FULL_PUBLIC_FINGERPRINT \
     --public-keyring /absolute/public/recipients.gpg --database pliego
   ```

   All placeholders must be replaced with approved nonsecret values. The installer
   authenticates the manifest and every regular contained file before executing
   packet code, rejects private key packets, fixes config/keyring permissions,
   applies only the shared-lock tmpfiles config, validates units and reloads PID1.
   It does **not** start a service or enable a timer. Scripts are root:root0755,
   code directories0755, config directory root:postgres0750 and config/public
   keyring0640; unit/tmpfiles/drop-in files are root:root0644. SQL is0644.
6. **Owner, phase C:** privately run installed
   `/opt/pliego/backup/ops/install-credentials.sh` and `install-ping-urls.sh`.
   These silent-prompt scripts write final root:root0600 files. Writer values
   populate `s3.json` and `object-target.json`; source reader is `object-source.json`;
   check URLs are `heartbeat.json` and `object-heartbeat.json`. Claude verifies only
   filenames, owners/modes and expiry metadata. Install workstation restore reader
   outside the repository using its owner script. Stop on missing/expired values.
7. **Claude, phase D:** inspect merged units, exact0600 root:root deploy lock,
   public fingerprint and postgres access. With the deploy lock free, start
   `pliego-backup.service`; wait for real completion (lock skip is insufficient),
   then start `object-backup.service`. Run the
   [first-run/canary/alert checklist](2026-11-05-production-backup-verification.md):
   all four DB tiers, invoice run marker, equal ciphertext hashes, OpenPGP packets,
   both directions of lock exclusion, actual locked-backup overwrite/delete
   refusals, source-reader write refusal, email failure/overdue/recovery delivery.
   The one approved source refusal PUT must target a unique nonexistent canary
   key; if it succeeds, stop and report without deleting it. All ordinary source
   backup requests remain GET-only. Any wrong scope, unexpected successful
   mutation, incomplete set, skipped run or failed probe blocks activation.
8. **Owner, phase D:** perform attended isolated workstation DB+invoice restore
   using `owner/verify-attended-restore.py`. Pin approved release/Flyway and trusted
   backup IDs/SHA, require the secret-free reports to pass and cluster cleanup.
   Private key/decryption/plaintext stay private; no existing/production cluster
   may be targeted. Preserve only safe reports in the ignored evidence directory.
9. **Claude, phase E:** review all phase-D evidence, then explicitly attest the
   installed manifest after successful real first-run/restore/alert gates:

   ```bash
   /opt/pliego/backup/ops/activate.sh --first-run-verified INSTALLED_MANIFEST_SHA256
   ```

   This separately enables DB, invoices and DB freshness timers. The script checks
   installed hashes, credential modes/expiry and DB tier freshness. The argument
   is Claude's review acknowledgment; it does not prove remote/restore gates by
   itself. Require next UTC firings (DB :15, invoices :55, <=5min jitter), both
   independent check states and next verified remote markers. A :55 invoice job
   is deliberately beyond the DB nominal :50 deadline; any unusual overlap still
   fails safely by skipping without heartbeat. Investigate every skip.

## Ongoing operations and rollback

Every week perform an attended fresh DB+invoice restore; monthly rehearse whole-host
recovery; quarterly exercise older ciphertext and a retired key. Track last good
ID/hash, dump-start time, end-to-end times, bucket bytes, token expiry and recipient
fingerprint. A recommended off-VPS read-only lister adds independent stored-byte
publication checks; no lister is deployed by this packet. A sender heartbeat alone
cannot prove uncompromised archives or successful future restores.

Rotate each token within90days and on exposure. Owner privately installs new
values atomically; Claude tests both jobs/readback and owner tests restore-reader
access before owner revokes old values. Rotate public recipient annually/on
exposure after an offline decrypt test; retain retired private keys for every
remaining DB **and indefinitely retained invoice** namespace. Preserve old key
custody/revocation records and two protected media at separate locations.

Before deployments pause both backup timers, let both jobs drain, then take the
unchanged deploy lock. Keep it through canonical migration/privilege postflight;
release it before restarting only timers previously active. The exact canonical
runbook/skill additions are supplied as
[an unapplied patch](runbook-backup-patch.diff); Claude reviews/applies separately.
Do not run canonical application deployment as part of this backup installation.

For scheduling rollback run `/opt/pliego/backup/ops/uninstall.sh`. It disables the
three timers and checks for drained jobs; it never kills a dump, deletes local
keys/credentials/receipts, changes the app, removes locks or touches remote objects.
If a job is active, scheduling is already stopped; wait for natural completion
before further changes. Investigate root cause before reinstallation/reactivation.
No remote delete/prune is part of rollback.

## Fresh-VPS disaster recovery

1. **Owner declares incident:** preserve evidence, contain the affected service,
   choose a trusted completed snapshot and record accepted loss since dump start.
   If compromise is suspected, corroborate ID/hash from independent records.
   This is incident authorization; this guide does not authorize restoring over
   production or changing DNS/Cloudflare. Recovery target must be a new empty host.
2. **Claude provisions the separately approved host:** PostgreSQL18, approved
   Java/runtime/security baseline, loopback DB, runtime identity and private paths.
   Recover pinned matching application artifacts/config templates from independent
   custody. This backup contains neither OS/TLS configuration nor app releases.
3. **Owner on isolated workstation:** unlock the appropriate offline key and
   restore-reader credential. Verify/decrypt/restore into a fresh local PG18
   cluster and verify invoices against that DB using the attended wrapper. Stop
   on missing references, mismatch, wrong provenance/Flyway or invalid privileges.
   Keep private keys on the workstation throughout. Never use a cloud decrypt service.
4. **Claude/owner transfer reviewed recovery material:** use approved encrypted
   private transport for plaintext DB envelope and verified invoice files, restrict
   temporary directories0700/files0600. On a **new empty** target cluster with
   bootstrap postgres inspect globals and preserve the original. A reviewed replay
   copy may omit only its exact duplicate `CREATE ROLE postgres;`; all other SQL
   errors fail closed. Restore globals with ON_ERROR_STOP and database with
   `pg_restore --create --exit-on-error`; do not repair Flyway or run unrelated
   migrations to force a backup to pass. Never copy a private key to the target.
5. **Owner installs fresh secrets; Claude verifies:** globals intentionally contain
   no role password hashes. Restore canonical peer/HBA/runtime credentials and
   validate owner NOLOGIN, runtime no elevated attributes/ownership/CREATE/owner
   membership using the canonical read-only postflight. Match restored consecutive
   Flyway history to pinned matching artifacts, then read-only invariant/API smoke.
6. **Invoice rehydration if source/account lost:** preserve verified plaintext-to-
   original-key mapping from restored metadata. Only after a separate authorized
   restore writer is provided, repopulate the separately approved replacement
   private bucket, compare every size/SHA and check authenticated invoice downloads.
   Normal backup/source-read credentials must not become restore writers. Existing
   `billing-pliego` source objects must not be overwritten under this packet.
7. **Controlled application startup and acceptance:** keep external mail/billing
   effects controlled until validation, then perform authorized catalog/auth/order/
   invoice smoke and restore approved worker settings. Owner separately authorizes
   traffic cutover only after acceptance. Record measured DB and service RTO/RPO.
8. **Resume protection:** install/verify the backup packet and both external checks
   on the replacement, rotate compromised credentials, repeat real readback/restore
   gates, then activate. Owner cleans private plaintext/key imports under custody
   policy, stops temporary clusters and unmounts media. Preserve encrypted recovery
   points and safe evidence; never weaken locks or delete the last verified copy.
