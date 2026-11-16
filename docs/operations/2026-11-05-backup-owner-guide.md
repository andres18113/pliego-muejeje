# Backup credentials, offline key custody and alerts — owner procedure

Prepared locally on 2026-11-05. Codex/Claude must never run the key ceremony or
receive secret values. Owner performs dashboard actions and secret entry in an
unrecorded terminal. Claude reviews/install scripts and handles the VPS operations
in the production enablement checklist. This document does not claim they ran.

## Three R2 credentials, each expiring within 90 days

| Dedicated token name (append creation date) | Permission and only bucket | Installed where / reason |
| --- | --- | --- |
| `pliego-backup-vps-writer` | Object Read & Write; `pliego-db-backups` | VPS `s3.json` and `object-target.json`, same credential. DB and invoice target need PUT, GET, LIST and server-side CopyObject/readback; R2 has no put-only permission. Bucket locks constrain destructive access. |
| `pliego-backup-vps-invoice-reader` | Object Read only; `billing-pliego` | VPS `object-source.json`. Read invoice PDF/XML only; no application token reuse. Bucket scope does not itself restrict object prefixes: the reviewed job limits inventory to invoices. |
| `pliego-backup-owner-restore-reader` | Object Read only; `pliego-db-backups` | Owner workstation `s3.json` and `object-target.json`, same reader. Covers DB and invoice restore without a writer on the workstation. |

No operational Admin token, application credential, covers credential or fourth
target token is needed. A separate temporary control-plane token is used only
on Claude’s workstation during [bucket provisioning](2026-11-05-backup-cloudflare-plan.md);
the owner installs it privately and revokes it afterward, never on the VPS. A future independent remote lister would need its own reader and is a
separate task. The writer has read/write access to the entire target bucket;
use a dedicated bucket and retain the lock/refusal verification gates.

Owner click-path, repeated separately for each row:

1. Sign in to the correct Cloudflare **account** → **R2 object storage** →
   **Overview** → **Account Details** → **API Tokens: Manage**.
2. Select **Create Account API token**, supply the row's dedicated name and
   permission, choose **Apply to specific buckets only**, select only its bucket.
   Account tokens avoid dependency on an individual user's continued membership.
   If account-token creation is unavailable to your role, stop and have the
   account administrator perform this owner step; do not broaden permissions.
3. Set the expiration/TTL end date 90 UTC calendar days after today's UTC date,
   leave the start active immediately. Verify the scope and expiry on the summary,
   then **Create Account API token**. Read the returned **Access Key ID** and
   **Secret Access Key** privately; these are the S3 credentials, distinct from
   a Cloudflare management Bearer token. Never paste either into chat/evidence.

This follows the current [R2 authentication path and S3 permission model](https://developers.cloudflare.com/r2/api/tokens/)
and [S3 bucket selection labels](https://developers.cloudflare.com/r2/get-started/s3/).
Account-token availability depends on the owner's [account role](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/).

Dashboard-selected dates are **00:00 UTC**, not end of day. For example, creation
on 2026-11-05 with end date 2027-02-03 means
`expires_at=2027-02-03T00:00:00Z` (90 calendar days; under 90 elapsed days when
created later in the day). Use the actual dashboard date, never a new date based
on installation time. If the UI presents a different expiry, reconcile it before
continuing. No-expiry is unacceptable. See [Cloudflare TTL semantics](https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/).
The local installer refuses past expiry, non-UTC values or more than 90 days
remaining; it cannot verify provider scope/expiry and performs no network call.

## Install secret values privately

First Claude verifies the release manifest and installs the reviewed backup kit
and `/etc/pliego-backup` root:postgres 0750. Owner then runs on VPS root terminal:

```bash
/opt/pliego/backup/ops/install-credentials.sh
/opt/pliego/backup/ops/install-ping-urls.sh
```

If running directly from the reviewed release directory, use the same paths under
`deploy/backup/`. Installers require no arguments and read `/dev/tty`; all access
keys, secrets and URLs use silent `read -rs`. Stop recording/logging/screen sharing
and disable tmux pipe-pane/session capture before entry. Do not use `script`,
`tee`, `bash -x`, shell history commands containing values, environment variables,
CLI arguments or cloud screenshots. Claude/Codex must detach/stop observing the
secret-entry pane before owner entry. A secret visible in chat or capture is
compromised: revoke it and create a replacement.

The R2 installer asks for writer, source-reader and each actual UTC expiry. It
writes JSON keys `access_key`, `secret_key`, `expires_at` as atomic **root:root
0600** files directly within `/etc/pliego-backup`. `s3.json` and
`object-target.json` intentionally contain the same dedicated writer, reducing
the credential inventory. The ping installer writes `{"url":…}` to
`heartbeat.json` (DB) and `object-heartbeat.json` (invoices), root:root 0600.
No values are printed; only installation status and expiry. Do not `cat` files.

PID1 reads these root-only files with `LoadCredential`; postgres reads the
service's private copy, not the originals. The DB service maps
`s3.json:/etc/pliego-backup/s3.json`; invoice service maps its source/target names.
DB heartbeat maps `heartbeat.json:/etc/pliego-backup/heartbeat.json`; invoice
heartbeat maps logical `heartbeat.json:/etc/pliego-backup/object-heartbeat.json`.
That logical name is required by `heartbeat.py`. Failure helpers use the matching
mapping. See [systemd credential delivery](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#LoadCredential=).

On the isolated owner workstation run, without sudo:

```bash
deploy/backup/owner/install-workstation-credentials.sh
```

Choose an absolute directory outside every repository and `.release-evidence`,
with an existing parent. New directory mode is 0700; existing directory must be
owner-owned 0700. It installs the separate read-only restore credential as two
0600 files, `s3.json` and `object-target.json`, for existing DB/object verifiers.
Keep its parent on encrypted storage. Pass only its directory path through
`CREDENTIALS_DIRECTORY`. Neither key tooling nor installers contact R2.

Rotation: calendar reminders at day 60, 75 and 85; replace before day 90. Create a
new token with identical single-bucket scope and fresh <=90-day expiry, drain the
backup job before replacing files, rerun the installer privately, then Claude
verifies first backup/readback/receipt and an owner-attended restore. Revoke the
old token in the same R2 API Tokens page only after successful verification.
Revoke immediately after compromise; if writer compromised, retain immutable
archives and select a trusted recovery point. File replacement is atomic per
file, not across files; do not rotate while services are active. Local expiry
checks stop expired jobs; Healthchecks must report their failures/silence.
Record token **name**, scope, creation/expiry and custodian only, never values.

## Offline key ceremony (owner alone)

Use a trusted isolated workstation with GnuPG 2.2+ and pinentry, Python3 and
standard GNU utilities. Never use VPS, CI or a shared screen. In WSL, use a Linux
terminal with working curses pinentry, a short Linux path for GNUPGHOME and Linux
filesystems that actually enforce 0700/0600 (not default `/mnt/c` permissions).
A local path backed by encrypted removable media is preferred. Unlock/mount two
independent encrypted media as separate filesystem devices. Create one private
0700 export directory on each, and a separate 0700 directory for public exports.
Do not choose repository/evidence paths, symlinks or nested ceremony locations.
The script rejects two directories on the same filesystem; separate folders on
one disk are not independent backups. Backups must ultimately reside in different
physical locations; separate partitions alone do not meet custody policy.

Disconnect networking and run yourself:

```bash
deploy/backup/owner/generate-offline-key.sh
```

The script asks only for local paths and an owner-presence attestation. It creates
a **new dedicated** GNUPGHOME, sets `GPG_TTY`, disables loopback/external pinentry
caching and enforces a 24-character minimum through gpg-agent. Choose at least six
randomly generated words with sufficient total length, or an independently
random password of comparable strength. Enter passphrases solely in pinentry;
never in shell prompts, command arguments, environment or a passphrase file.
GnuPG [documents enforced passphrase constraints](https://www.gnupg.org/documentation/manuals/gnupg/Agent-Options.html).

It generates a three-year RSA4096 certification/signing primary plus RSA4096
encryption subkey; OpenPGP RFC4880 and AES256 are compatible with the existing
backup tools. It exports public `recipients.gpg` and full `fingerprint.txt` to
the public-export directory. Both independent media receive
`pliego-private-key.gpg`, a complete passphrase-protected primary/subkey export;
metadata validation rejects unprotected exports. It then imports **each copy**
into a fresh media-local 0700 home, clears that agent's cache, asks pinentry to
unlock, decrypts an AES256 self-test and compares bytes. Only synthetic self-test
plaintext is used. Test homes/agents are removed on ordinary exit; original key
home and both protected exports remain. Power loss can leave temporary test
homes: inspect and clean these privately before unmounting. A failed ceremony
must be reviewed privately; do not rerun over its existing key/export paths.
GnuPG [documents key generation and complete secret exports](https://gnupg.org/documentation/manuals/gnupg24/gpg.1.html).

Owner verifies the printed full fingerprint against `fingerprint.txt` and records
it through an independent channel. **Only** `recipients.gpg` and `fingerprint.txt`
may go to Claude for VPS installation. The original dedicated home contains the
private key and automatic revocation certificate (`openpgp-revocs.d`); both stay
offline. Do not send it, either private export, passphrase or revocation certificate.

Custody checklist (owner records completion outside this repository):

- Name primary and alternate recovery holders; each can retrieve one independently
  stored protected media copy. Record physical locations, sealed-media identifiers,
  full fingerprint, algorithm/creation/expiry and last successful self-test.
- Keep passphrase in an encrypted password manager and sealed break-glass recovery
  custody separate from media. Define who can approve access when the primary is
  unavailable; test that alternate holder can restore without the primary.
- Keep encrypted offline home and revocation certificate safe; unmount both backup
  media after ceremony. Never leave private keys on VPS or inside repo/evidence.
- Weekly attended fresh DB + paired invoice restore; monthly broader fresh-host
  rehearsal; quarterly test the other media and an older retained recovery point.
  Evidence contains only fingerprints, completion/exit status, counts and timings.
- Review at least annually, rotate before three-year expiry or suspected compromise.
  Generate a new key in another fresh home, verify both exports/self-tests, install
  only new public material, verify first backup and restore, then switch schedules.
- Preserve **every old decryption key** while any retained ciphertext references it.
  Monthly DB retention is 400 days; invoice archives currently have no expiry, so
  old invoice decryption keys must be retained indefinitely until an approved
  preservation/re-encryption policy proves they are no longer needed. Expiry or
  revocation is not permission to destroy a decryption key.
- Break-glass recovery uses isolated owner workstation/fresh clusters only, offline
  media/fingerprint verification and separately scoped restore reader. Never restore
  over production. After incident, terminate agents, remove plaintext/test imports
  under the media policy, rotate affected credentials and record recovery results.

## Two external Healthchecks checks

Owner creates a Healthchecks account/project for PLIEGO, enables account MFA and
sets owner/alternate access. In **Checks → Add Check**, create
`PLIEGO production DB backup` and `PLIEGO production invoice backup`. For each,
open its schedule control and select **Simple**, **Period 6 hours**, **Grace Time
1 hour**. DB schedule is 00/06/12/18:15 UTC (+<=5m); invoices :55 (+<=5m), with
30/45-minute service bounds. Six-hour intervals plus one-hour grace allow normal
jitter; the alarm target is about seven hours after last successful completion.
Success follows all selected tiers or all invoice publication/readback, never job
start. New checks require a real first ping before reliance; leaving one New is
not an absence test. See [check schedules and grace](https://healthchecks.io/docs/configuring_checks/).

In the project's **Integrations** page, add **Email**, enter owner and alternate
recipient addresses, complete any verification email, and enable that integration
for **both** checks (ON icons on Checks/detail pages). Send its test notification
and confirm actual inbox receipt. Enable hourly down reminders in **Account
Settings → Email Reports** and monthly/weekly reports if useful. Keep a written
response rota and escalation to the alternate. Healthchecks [documents integration
assignment](https://healthchecks.io/docs/configuring_notifications/) and [multiple
email recipients/reminders](https://healthchecks.io/docs/faq/).

Use each check's default **UUID HTTPS ping URL** (`hc-ping.com`), not a slug,
project API key, custom domain or query-string variant. Set filtering to **Only
POST**; leave body keyword filtering off. Owner silently installs both via the
ping installer above. Ping URLs authenticate telemetry and remain secrets.
The helper has fixed diagnostics, refuses redirects and does not print the URL;
network failure yields a warning, so missing-heartbeat delivery is essential.
Healthchecks [explains its secret ping identifiers](https://healthchecks.io/docs/).

Acceptance tests before timers are relied upon (Claude handles unit commands,
owner watches dashboard/inbox; no ping values enter command lines):

1. After first successful DB and invoice backups, both checks must show Up and
   owner must confirm the latest completion belongs to the corresponding job.
2. Claude runs `systemctl start pliego-backup-heartbeat-fail.service` and
   `systemctl start object-backup-heartbeat-fail.service`; confirm Down **and** inbox
   failure delivery. Then require an actual successful job to return it to Up and
   confirm recovery notification. `/fail` is a failure event, not a generic success
   ping; see [failure signaling](https://healthchecks.io/docs/signaling_failures/).
3. Prove overdue delivery without waiting seven hours: temporarily create an extra
   `PLIEGO silence-test` check with **Simple 1 minute / Grace 1 minute**, attach the
   same verified email integration. Owner uses the check's dashboard **Ping Now**
   action if available; otherwise owner privately uses the dashboard-provided test
   facility to establish one initial success. Confirm Up, then send no further
   pings; after >2 minutes confirm Down and email. Do not replace either production
   secret, pause real backups or change real check periods. If no dashboard test
   action is available, use the owner-only procedure immediately below.
4. Test recovery of that temporary check, remove it after evidence, and record only
   check label, settings, UTC transition timestamps and confirmed receipt (no URL,
   UUID, dashboard screenshot or message containing ping identifiers).

For step 3 fallback, owner runs this **privately**, outside capture. It sends one
success to the temporary check; no URL in argv, environment or evidence:

```bash
set +xv
ulimit -c 0
export -n owner_test_ping
IFS= read -rs -p 'Temporary silence-test default UUID URL: ' owner_test_ping; printf '\n'
printf '%s\0' "$owner_test_ping" | python3 -c '
import http.client,re,sys,urllib.parse
try:
    value=sys.stdin.buffer.read(512).decode().removesuffix("\0")
    if not re.fullmatch(r"https://hc-ping\.com/[a-fA-F0-9-]{36}",value): raise ValueError()
    parsed=urllib.parse.urlsplit(value)
    connection=http.client.HTTPSConnection("hc-ping.com",timeout=5)
    connection.request("POST",parsed.path,body=b"success")
    response=connection.getresponse()
    if not 200 <= response.status < 300: raise ValueError()
    print("Temporary test success sent")
except Exception:
    raise SystemExit("Temporary test delivery failed; value hidden")
finally:
    if "connection" in locals(): connection.close()
'
unset owner_test_ping
```

Do not let healthy pings conceal stale tiers/invoice state. A failed, missing or
late check is an incident: review fixed journal markers and freshness receipts,
check credential expiry and storage lock/configuration, rerun approved job only
after cause is understood, escalate if unresolved. Healthchecks cannot prove
ciphertext decryptability or account-loss independence; attended restores and
separate custody remain required.
