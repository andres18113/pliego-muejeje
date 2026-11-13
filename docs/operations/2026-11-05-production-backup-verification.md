# Production backup phase-D verification — 2026-11-05

This is an execution packet, not production evidence. Codex prepared and tested
locally; **Claude runs VPS/R2 steps after review, owner runs secret/key steps**.
Never restore into production. Preserve the preflight, phase-B configuration JSON,
first-run receipts and the isolated restore JSON reports. Do not capture raw
journals, SQL rows, private invoice keys, provider error bodies, tokens or ping URLs.

## Before the first pair

Require phase-A preflight accepted, public recipient independently verified, phase-B
bucket readback PASS, owner-installed credentials/alerts and phase-C installation
verified. Both timers remain disabled until first jobs complete and later phase-E
activation is accepted. If preflight reports the deployment lock held, **wait for
its owner to finish**. Never bypass, truncate, replace or manually remove it.
Both DB and invoice units acquire the same lock through systemd OpenFile. Use the
reviewed services, not direct backup-script invocation or a second held deploy lock.

Claude executes on the VPS:

```bash
sudo systemctl start pliego-backup.service
sudo python3 /opt/pliego/backup/ops/verify-journal.py --unit pliego-backup.service
sudo systemctl start object-backup.service
sudo python3 /opt/pliego/backup/ops/verify-journal.py --unit object-backup.service
```

Run DB before invoices so the invoice copy covers the selected restored metadata.
`verify-journal.py` queries only that unit's current invocation, internally reads
its journal and emits allowlisted JSON: completion marker/counts, exit/result,
lock skip and heartbeat flags. It never prints journal lines. Require both exit0,
`result=PASS`, completion present, no lock skip, heartbeat success and no warning.
An `inactive` successful oneshot is normal. A held-lock skip exits0 but has no
completion and **fails this verifier**. A heartbeat success marker establishes
HTTP delivery only; owner dashboard and actual email receipt remain separate gates.
The invoice timer is offset to UTC `:55` after the six-hour DB schedule; retain the
published service limits/jitter and monitor each stream independently.

## Readback and refusal probes

Claude uses only installed file paths. Substitute the non-secret reviewed account
endpoint and full original recipient fingerprint; script reports must be NEW paths.
Run root on the VPS for its root:root credentials. Transfer only JSON reports into
`.release-evidence/2026-11-05-prod-backup/prod/` after private operator review.

```bash
endpoint=https://REPLACE_WITH_32_HEX_ACCOUNT_ID.r2.cloudflarestorage.com
fingerprint=REPLACE_WITH_FULL_UPPERCASE_FINGERPRINT
sudo python3 /opt/pliego/backup/ops/verify-r2.py first-run \
  --endpoint "$endpoint" --credential /etc/pliego-backup/s3.json \
  --fingerprint "$fingerprint" --receipts /var/lib/pliego-backup \
  --report /root/pliego-backup-first-readback.json
sudo python3 /opt/pliego/backup/ops/verify-r2.py lock-canary \
  --endpoint "$endpoint" --credential /etc/pliego-backup/s3.json \
  --report /root/pliego-backup-lock-canary.json
sudo python3 /opt/pliego/backup/ops/verify-r2.py source-refusal \
  --endpoint "$endpoint" --credential /etc/pliego-backup/object-source.json \
  --report /root/pliego-invoice-source-refusal.json
```

`first-run` uses the writer to list each DB tier's completion marker, checks exact
local receipt equality, downloads ciphertext/sidecar, verifies SHA256 and size,
and checks public-key/encrypted-data OpenPGP packets using `gpg --list-only` in an
empty public-only home. It **does not decrypt**. It also checks the newest invoice
run and its encrypted inventory's index, sidecar, digest, size and packet types.
All four DB tier receipts must be fresh (≤7h); this command is specifically for
first installation, when every tier was promoted. A later weekly/monthly rehearsal
uses the existing attended verifier's explicit prefix/age options instead.

`lock-canary` creates one random object under `canary/`, reads its exact bytes,
then attempts one overwrite and one delete. Both must return HTTP409 with
`ObjectLockedByBucketPolicy`; an unrelated authorization error does not prove a
lock. It reads original bytes again and leaves the object for the two-day lifecycle.
[Cloudflare's current R2 error table](https://developers.cloudflare.com/r2/api/error-codes/)
distinguishes that retention conflict from HTTP403 `AccessDenied`.

`source-refusal` first checks that the invoice reader can list with `max-keys=0`
(no object/customer data is returned). It sends **exactly one PUT**, without retries,
to a unique `pliego-backup-canary/<uuid>.txt` key in `billing-pliego`, guarded by
`If-None-Match: *`. Require HTTP403 `AccessDenied`. **If it unexpectedly succeeds,
STOP all further verification/activation and report the synthetic key. Never
retry, overwrite or delete that object.** A transport error, HTTP412, redirect,
invalid-token signature or generic403 is not permission proof. No other source
mutation is performed by any verifier or backup job.

Optional expired/revoked-token test: owner creates a disposable short-TTL backup
reader, installs it through the owner silent-prompt tooling into a NEW outside-repo
private directory (never overwrite the operational reader). Before expiry/revocation,
Claude runs `verify-r2.py reader-baseline --endpoint "$endpoint" --credential
/private/disposable/s3.json --report /private/token-before.json`; require exit0.
Owner then revokes that disposable token in Cloudflare, or waits past its actual
provider TTL. Repeat with action `expired-reader` and NEW report `/private/token-after.json`.
This probe intentionally bypasses **only the local JSON expiry guard**, to require
server HTTP401 `Unauthorized` or403 `AccessDenied`; it cannot turn a local expired-file
refusal into evidence of server expiry. Keep before/after non-secret reports and
owner attestation of revocation/time. Other provider codes fail closed for review.
Do not change any operational credential or its `expires_at` for this exercise.

## Owner-attended paired restore

Owner uses an isolated workstation without production DB/application credentials.
Verify toolkit/release provenance, current expected Flyway count, offline recipient
and the [custody procedure](2026-11-05-backup-owner-guide.md). The private key stays
on owner media/workstation. Unlock through pinentry in the owner's own terminal;
never supply passphrases in argv, environment, pipes or evidence. No key command is
run by Claude/Codex. Do not share the screen containing secret input.

The workstation installer provides a mode0700 directory containing **only**
`s3.json` and `object-target.json`, holding the separately scoped backup-target
read-only reader. No source credential is allowed. Choose a NEW short work path
outside every repository and `.release-evidence` tree, on private/encrypted storage.
Run from the reviewed checkout as a non-root owner:

```bash
python3 deploy/backup/owner/verify-attended-restore.py \
  --private-work /private/pliego-r-UNIQUE \
  --gnupg-home /owner/offline-keyring \
  --credentials-directory /owner/pliego-restore-credentials \
  --account-id REPLACE_WITH_32_LOWERCASE_HEX \
  --fingerprint REPLACE_WITH_FULL_ORIGINAL_UPPERCASE_FINGERPRINT \
  --expected-flyway REPLACE_WITH_VERIFIED_RELEASE_COUNT
```

The wrapper invokes the existing `verify-restore.py` unchanged. That verifier
selects the newest complete fresh frequent archive, pins its SHA, verifies/decrypts
it, creates a **new socket-only PG18 cluster**, restores globals/DB, checks Flyway,
ACLs/invariants and read-only Database API smoke, then stops the cluster. The
wrapper restarts only that newly created cluster, runs `object-backup.py verify`
against its restored `pliego.factura_archivo`, forces read-only database queries,
and verifies every invoice's decrypted SHA256 and size. It never contacts the live
invoice source. It stops the cluster again on success/failure and timeout/interruption
as far as process cleanup permits.

Require exit0 and `result=PASS`, DB and invoice checks true and `cluster_stopped=true`.
The report records the R2 invoice-reference count; zero means zero references in
that restored DB, never an assertion about uncommitted/orphan/live documents.
The wrapper copies **only allowlisted secret-free JSON** to
`.release-evidence/2026-11-05-prod-backup/restore/<run>/report.json`. Plaintext DB,
invoice files, detailed private logs and temporary curl credentials stay in the
owner's private work directory; do not copy them into evidence. Owner reviews and
removes private work under custody policy, unmounts key media and retires temporary
reader credentials. After power loss/SIGKILL, inspect and stop that **private**
cluster before cleanup; handlers cannot run after host loss. Never use a production
PGHOST/PGSERVICE or restore over an existing cluster.

Record observed restore duration separately from the 30min DB /4h service objectives.
This paired pass proves DB and referenced invoice recovery only. Authenticated HTTP
invoice download, rehydration to a replacement source bucket, fresh-VPS recovery,
cover restoration and actual service RTO remain separate exercises.

## Alerts without a seven-hour wait

The owner configures two independent production checks: DB and invoices, each a
six-hour period and one-hour grace, email enabled and recipients verified. The
[owner guide](2026-11-05-backup-owner-guide.md) contains creation and silent URL
installation steps; no ping URL enters argv/logs.

1. After the real successful paired jobs, owner confirms both production checks Up
   and their expected ping times. Claude checks each installed service's OnFailure
   mapping without printing credentials. The first real success is required; a
   never-pinged New check is not a silence test.
2. Claude runs `sudo systemctl start pliego-backup-heartbeat-fail.service` and
   `sudo systemctl start object-backup-heartbeat-fail.service`. Existing helpers
   send `/fail` using the correct LoadCredential mapping. Owner confirms each
   check Down and actual inbox receipt, then the owner/Claude run the next real
   successful job in DB→invoice order for recovery to Up. Do not fabricate success
   while a backup is failing. [Failure semantics](https://healthchecks.io/docs/signaling_failures/)
   describe the immediate failure endpoint.
3. Owner creates a **temporary third check** with the same email channel, period
   60s, grace60s. From their own terminal they use the owner guide's silent
   single-ping snippet once, confirm Up, then send nothing. Observe Down and email
   after >2min plus provider processing delay. No production timer/check/URL is
   changed. The [official Management API limits](https://healthchecks.io/docs/api/)
   allow minimum60s for period and grace; the
   [check behavior](https://healthchecks.io/docs/configuring_checks/) explains
   silence after grace. Delete the temporary check only after recording result.
4. Store only check labels, non-secret UTC times and boolean dashboard/email/recovery
   outcomes in `prod/alert-tests.json`. Omit UUIDs, URLs, recipient addresses and
   screenshots containing identifiers. If delivery/overdue/recovery is unproved,
   stop phase-E activation; helper exit0 alone is insufficient because heartbeat
   failure intentionally leaves a valid backup's status unchanged.

Local mock tests establish guards and protocol ordering, and public-only packet
parsing was executed against synthetic ciphertext. They do not establish real R2
scope/lock/expiry, notification receipt, provider lifecycle timing, key custody,
production data integrity, account-loss resilience or achieved RTO.
