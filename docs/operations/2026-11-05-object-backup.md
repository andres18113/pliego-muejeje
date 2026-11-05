# Encrypted invoice object preservation — 2026-11-05

Owner-approved production scope: PDF/XML invoice objects in private
`billing-pliego`, source prefix `invoices/`. The separate encrypted destination
is private `pliego-db-backups`, prefix `object-backups/v1/`. This packet performs
no source write, overwrite or deletion. Covers and their historical frozen-inventory
feature are outside scope; no cover credential/config/timer is installed or used.

## Data and consistency

`pliego.factura_archivo` stores `storage_kind`, `object_key`, full SHA256 `checksum`,
`size_bytes` and MIME. R2 keys are
`invoices/<invoiceId>/<full-SHA256>.<pdf|xml>`, with 1 byte–10MiB per object.
The DB dump retains old bytea invoices but only metadata for R2 invoices.
The immutable committed DB references are authoritative; orphan app uploads are
excluded. Source bytes must match their DB size and full hash before encryption.

`object-backup.py copy` uses a single READ ONLY metadata snapshot. A dedicated
read-only source credential supplies GETs only. The destination writer is the
same backup-bucket-scoped writer as DB backup, delivered under
`object-target.json`; it never reuses the application token. Values are delivered
by systemd LoadCredential and placed only in private per-run curl configs.

Completed plaintext digests are reused only after remote completion, ciphertext
and checksum GET verification. New bytes are encrypted to the offline public
recipient and stored under full recipient/ciphertext hashes, with SHA sidecars
and index completion last. The encrypted inventory hides invoice keys. A unique
run marker is published only when every reference and inventory verifies.
Lost local state retries safely using remote completed indexes. Interrupted runs
may leave ciphertext orphans; no automatic pruning occurs.

The production unit uses postgres peer, existing hardening, private state and a
full-duration shared deployment-lock descriptor. It selects the fixed invoice
wrapper, which signals success only after copy completes. An excluded run sends
no success heartbeat. Its six-hour UTC :55 schedule follows the DB :15 schedule
with at most five minutes jitter; DB runs may contend and cause an invoice skip.
Catch-up order and timers do not establish pairing. For initial acceptance,
complete DB then invoice copy and verify every reference against the restored DB.

## Retention and access

Invoice backup prefix: **no lifecycle expiry** until the owner sets fiscal
retention and approves reference-aware deletion. Proposed bucket lock: **indefinite hold**,
protecting old reused blobs that remain referenced by newer DB snapshots. A
finite age lock can expire while those references remain live. The owner accepts
this default at phase B; later fiscal/reference-aware policy changes require
separate review. No expiry or deletion is scheduled.
Retain each retired invoice private key indefinitely alongside its retained
namespace; finite DB lifecycle ages never authorize invoice-key retirement.

The source `billing-pliego` bucket stays unchanged. A source-prefix lock could
break legitimate same-key PUT retries and is outside this packet. R2 locks are
administratively removable and do not protect against account loss. Consider a
separately approved offline/second-provider encrypted copy for that failure mode.
R2's S3 API has no native bucket replication configuration.
[Compatibility](https://developers.cloudflare.com/r2/api/s3/api/),
[bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/).

## Attended recovery and monitoring

On the isolated owner workstation, restore and verify the DB first. The attended
wrapper then uses its restored metadata, an offline private-key home and the
separate backup read credential to run invoice `verify`. It needs no source
credential. It downloads complete blobs, checks outer hashes, decrypts and checks
each plaintext against DB SHA256/size. Output goes to a fresh private directory,
named by plaintext digest rather than untrusted object path. Partial plaintext
from a failed run remains private and requires owner cleanup.

See [owner credentials/custody](2026-11-05-backup-owner-guide.md) and the
[production execution/DR checklist](2026-11-05-backup-production-operations.md).
Verification alone does not repopulate a live bucket. Incident recovery must map
each verified file to its original restored DB key, use a separately authorized
restore writer and verify authenticated downloads before cutover. Never regenerate
or silently replace missing fiscal artifacts.

Create a separate invoices Healthchecks check, period six hours/grace one hour;
DB freshness cannot stand in for this stream. Test failure, absent/overdue and
recovery email receipt before enabling timers. A recommended independent lister
checks invoice `runs/*/complete.json` freshness (7h), blob publication and durable
last-seen IDs outside writer control; none is provisioned here.

## Cost and proof boundary

Ciphertext and encrypted inventory generations remain indefinitely. R2 Standard
storage is $0.015/GB-month before allowances/rounding; 10GB is ~$0.15/month.
One thousand unchanged blobs rechecked 120 times/month require roughly 360,000
Class B GETs (~$0.13 before allowances), plus inventory/run/new-copy requests.
Re-estimate against actual counts/growth within the ~USD1/month combined budget.
[Cloudflare prices](https://developers.cloudflare.com/r2/pricing/).

Historical synthetic evidence in `.release-evidence/2026-11-05-gaps/g4/` covers
metadata restore, ciphertext reuse, byte equality and failures for wrong key,
corruption, missing target and altered pins. Moto cannot prove R2 permissions or
lock enforcement. Actual writer lock canaries belong only in the backup bucket.
The approved source-reader refusal canary is one unique nonexistent source key;
if PUT unexpectedly succeeds, stop and report without deletion. Real recovery,
provider enforcement, custody and notification remain execution evidence gates.
