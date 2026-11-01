# PLIEGO production deployment runbook

This is the canonical operating guide for Codex, Claude Code, another coding agent,
or a human operator deploying this repository to the existing PLIEGO VPS. Read
[`AGENTS.md`](../../AGENTS.md) first. Repository skills point here; this document
does not depend on previous conversations, personal skills, or ignored local logs.

Reading or installing the guide is not authorization to deploy. A user's existing
instruction to deploy the selected release is sufficient; do not repeatedly ask
for approval of routine steps within that scope. A review-only or documentation
request authorizes no production changes. Commit/push and changes outside the
deployment boundary need their own authorization.

## 1. Scope and operating contract

- Deploy a pinned, reviewed commit with successful CI for that exact SHA. Do not
  deploy an arbitrary newer branch tip, an older unrelated green run, or a mixture
  of revisions. Record local/remote divergence and explain the selected target.
- Preserve the approved modular monolith, Java 25, Spring JDBC, PostgreSQL 18 and
  database-owned business rules. Do not introduce Docker, JPA or a replacement
  deployment platform.
- Build locally. Transfer executable JARs, production `dist` assets and necessary
  non-secret deployment metadata only. Never compile on production unless a
  verified constraint requires an explicitly explained exception.
- Preserve SSH configuration, UFW, PostgreSQL exposure/tuning, Cloudflare, DNS,
  certificates and Authenticated Origin Pulls (AOP). A verified defect outside
  this boundary is a blocker to report, not permission to redesign infrastructure.
- Use normal backend Flyway for schema changes. Never edit applied migrations,
  repair history, initialize schema manually, delete/recreate the DB, reverse
  Flyway, or restore a backup automatically during application rollback.
- Do not import fixtures, change prices/stock/offers, extend offer dates, create
  accounts/orders, or send email merely to obtain a green production smoke test.
  Use disposable local identities/providers for write-heavy tests. Any production
  write smoke must have a controlled identity, explicit scope and cleanup plan.
- Once deployment is authorized, finish preparation, release activation and
  verification autonomously. Stop on a real unresolved blocker; report the failed
  action, production state and recovery path. Do not claim success from CI alone.

## 2. Known environment — revalidate, do not assume

Last verified deployment: **2026-11-01**, release `20261101T004004Z-4100391`, source
`410039152f3db2687922289fd68eb807c8d9fb07`,
[CI run 41251068050](https://github.com/andres18113/pliego-muejeje/actions/runs/41251068050),
Flyway **87** (V087 checksum `-414291521`). These operator-verified values are
historical references, not instructions to redeploy that release or assume they
remain current.

| Component | Expected arrangement |
| --- | --- |
| SSH | `deploy@vps1` through the operator's personal SSH alias below |
| VPS | Ubuntu 24.04, 2 vCPU, about 3.8 GiB RAM, 2 GiB swap |
| Java | Temurin 25.0.5; application user/group `pliego`, no login |
| Backend | `/opt/pliego/releases/<release>/pliego-backend-0.1.0-SNAPSHOT.jar` |
| Backend pointer | `/opt/pliego/current` → versioned release |
| Service | `pliego.service`; Spring binds only `127.0.0.1:8080` |
| Unit policy | `Restart=on-failure`, `TimeoutStartSec=3min`, `TimeoutStopSec=45s`; systemd `EnvironmentFile`, no drop-ins |
| Secrets | `/etc/pliego/pliego.env`, `root:pliego`, `0640` |
| Mail | `PLIEGO_MAIL_ENABLED=true` at the verified deployment |
| Frontend | `/var/www/pliego/releases/<release>/`, only built static assets |
| Frontend pointer | `/var/www/pliego/current`; Nginx document root points here |
| Operations | `/opt/pliego/deployment/<release>/`, root-only metadata/logs/backups |
| DB | PostgreSQL 18, cluster `18/main`, `pliego`, only `127.0.0.1:5432` |
| Runtime DB role | `pliego_app`: login, no elevated attributes, ownership or CREATE |
| Owner role | `pliego_owner`: NOLOGIN, no elevated attributes; owns application objects |
| JVM / Hikari | `-Xms256m -Xmx1280m`; pool max 8, minimum idle 2; PG max_connections 30 |
| Public frontend | `https://pliegolibros.com`; `www` redirects to apex, retaining route/query |
| Public API | `https://api.pliegolibros.com` → Nginx → loopback backend |
| Covers | `https://covers.pliegolibros.com` → R2; deployment normally leaves it alone |
| Nginx sites | `/etc/nginx/sites-available/pliegolibros.com`, `/etc/nginx/sites-available/pliego-api` |
| Frontend Origin CA | `/etc/ssl/certs/pliego-root-origin.pem`, key path `/etc/ssl/private/pliego-root-origin.key` |
| API Origin CA | `/etc/ssl/certs/pliego-origin.pem`, key path `/etc/ssl/private/pliego-origin.key` |
| AOP trust | `/etc/nginx/certs/pliego-aop-rootca.crt`, `ssl_verify_client on` on all three hostnames |
| Exposure | UFW active; 80/443 Cloudflare-only, SSH allowed; 8080/5432 not public |

Memory, disk, catalog counts, active offers and job counts are observations to
recapture. Expired offers are not missing deployment data; preserve original dates.

### R2 storage for newly generated invoice files

Production R2 is **ACTIVE since 2026-11-01**, activation `r2-20261101T013556Z`,
service restart `01:39:21Z`. The operator verified the activation and configuration
below. New invoice PDF/XML files use R2 under `invoices/`; the worker uploads them
before the Database API transaction marks the artifact READY. The first production
invoice after activation (2026-11-01) stored its PDF and XML in R2 under `invoices/`,
both READY on the first attempt with no database bytes and one `INVOICE_ISSUED`
event marked SENT; the earlier invoice's bytea files kept matching checksums.

Historical artifacts with `storage_kind` NULL or `DATABASE` remain in PostgreSQL
and use the Database API stream path regardless of R2. The R2 adapter's
`download`/`access` methods retain this `databaseStored` branch; activation does not
backfill bytea artifacts. PostgreSQL bytea is still the code default when R2 is
disabled, not the active production destination for new files.

For future environments without R2 rows, keep two separate authorized steps:
first deploy with R2 disabled (no R2 variables required), then configure and enable
R2 in a separately authorized activation. The operator maintains these variables
in `/etc/pliego/pliego.env` (`root:pliego 0640`); never include credential values
in documentation or release evidence. Verified production settings:

- `PLIEGO_R2_ENABLED=true`
- `PLIEGO_R2_PRODUCTION_STORAGE=true`
- `PLIEGO_R2_BUCKET=billing-pliego`
- `PLIEGO_R2_ENDPOINT`: HTTPS account host only, without a path
- `PLIEGO_R2_REGION=auto`
- `PLIEGO_R2_ACCESS_KEY_ID`
- `PLIEGO_R2_SECRET_ACCESS_KEY`
- `PLIEGO_R2_PRESIGN_TTL_SECONDS=300` (valid range `1`–`300`)
- `PLIEGO_R2_KEY_PREFIX=invoices/` (explicit; no default)

Local development uses `PLIEGO_R2_KEY_PREFIX=local-dev/invoices/` and
`PLIEGO_R2_PRODUCTION_STORAGE=false` (the default). Non-production prefixes must
start with `local-dev/`; this strict convention prevents accidental selection of
another namespace. Production storage requires exactly `invoices/`. Every prefix
must be nonempty and end in `/`, so a non-production prefix can never be an
ancestor of `invoices/` (neither the empty prefix nor `invoices` is valid).

When `PLIEGO_R2_ENABLED=true`, missing or invalid configuration stops startup with
a Spanish error. Keep the production environment file root-owned and mode `0640`
(`root:pliego`), and local development environment files that hold R2 values mode
`0600`; never copy them or their values to a release manifest, command line,
build log or deployment output.
Keep R2 enabled once any `storage_kind='R2'` row exists. Disabling it leaves
metadata READY but returns `404 INVOICE_FILE_UNAVAILABLE` for those artifacts;
it does not backfill them into PostgreSQL. The old release `a298dc4` cannot serve
R2 rows. Rollback of the activation's environment change is valid only while zero
R2 rows exist; otherwise re-enable R2 to restore access. Any future backfill needs
separate review. The optional live smoke test requires an explicit `local-dev/`
prefix, refuses production storage, and is never part of deployment verification.

**Shared storage decision.** For this academic project, the project owner accepts
one private bucket (`billing-pliego`) and one key pair shared by development and
production, with `local-dev/invoices/` and `invoices/` respectively. Development
sharing alone does not require rotation before first production activation.

**LIMITATIONS.** Application guards prevent accidental application access across
prefixes, including reads and presigning of a database row from another
environment. The credentials themselves are bucket-scoped: anyone or any tool
holding the development environment file can read, write or delete production
objects outside the application. Prefix isolation is not credential isolation.
Keep development environment files `0600`, never copy them, and rotate immediately if a value
leaks.

**Credential rotation.** The R2 key pair is an S3 credential scoped to the invoice
bucket (read, write, list). The Cloudflare API token issued with it is not used by
PLIEGO and must not be stored on the server. Rotate the key pair (create the new
pair, update `/etc/pliego/pliego.env`, restart, verify one invoice view, then revoke
the old pair in Cloudflare) when: a value has appeared outside the environment file
(chat, ticket, terminal transcript, screenshot), an operator with access leaves,
or at least every 90 days. Presigned links need no revocation: each expires after the
configured TTL (300 s) and is issued only after Database API authorization.

**Framing.** On desktop, the customer invoice page (`/orders/:orderId/invoice`)
frames the signed R2 URL; with PostgreSQL storage it frames a `blob:` URL. If Nginx
or Cloudflare adds a `Content-Security-Policy` to the storefront, its `frame-src`
(or `child-src`/`default-src`) must allow
`https://<account-id>.r2.cloudflarestorage.com` and `blob:`; otherwise the page
shows an empty frame while "Abrir en otra pestaña" and "Descargar PDF" keep working.

**Bucket verification (owner dashboard, 2026-11-01).** `r2.dev` is disabled,
there are no custom domains or CORS policy, storage class is Standard, and the only
lifecycle rule is the default incomplete-multipart-upload abort. The app uses
single PUTs, so this rule does not affect invoices. No bucket CORS policy is needed
for the current page: it navigates to or frames signed URLs instead of fetching
them with JavaScript.

**Read-only monitoring.** Run these aggregate queries on the `pliego` database;
do not select customer data, object keys, document bytes or raw errors. Adapted
from the operator's verified `r2-monitor.sql`:

```sql
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT estado,tipo,intentos,count(*) AS jobs,
       min(siguiente_intento) AS next_attempt,min(actualizado_en) AS oldest_update
  FROM pliego.factura_archivo_trabajo GROUP BY estado,tipo,intentos
 ORDER BY estado,tipo,intentos;
SELECT count(*) FILTER(WHERE estado='FAILED') AS failed,
       count(*) FILTER(WHERE estado='PENDING') AS pending,
       count(*) FILTER(WHERE estado='PENDING' AND siguiente_intento<=clock_timestamp()) AS pending_due,
       count(*) FILTER(WHERE estado='PROCESSING' AND lease_until<clock_timestamp()) AS expired_processing,
       count(*) FILTER(WHERE estado='PROCESSING' AND lease_until<clock_timestamp() AND intentos>=5) AS expired_final_attempt,
       COALESCE(max(intentos),0) AS max_attempts
  FROM pliego.factura_archivo_trabajo;
SELECT COALESCE(storage_kind,'LEGACY_BYTEA') AS storage_kind,count(*) AS artifacts,
       COALESCE(sum(size_bytes),0) AS metadata_bytes
  FROM pliego.factura_archivo GROUP BY storage_kind ORDER BY storage_kind;
SELECT count(*) AS r2_prefix_violations FROM pliego.factura_archivo
 WHERE storage_kind='R2' AND (object_key IS NULL OR left(object_key,9)<>'invoices/');
SELECT estado,count(*) AS events,COALESCE(max(intentos),0) AS max_attempts,
       min(fecha_creacion) AS oldest_created,max(fecha_creacion) AS newest_created
  FROM pliego.correo_outbox WHERE tipo='INVOICE_ISSUED' GROUP BY estado ORDER BY estado;
ROLLBACK;
```

Review FAILED jobs, due PENDING work and expired PROCESSING leases; prefix
violations must be zero. In the unit journal, inspect `code=UPLOAD_FAILED`,
`code=UPLOAD_FAILURE_RECORDING_FAILED`, `code=R2_KEY_OUTSIDE_PREFIX`,
`code=COMPLETION_UNCERTAIN` and `state=STALE_COMPLETION`; successful completion is
`state=READY`. Share marker counts, not raw records containing invoice IDs.

**Failure recovery.** If jobs reach FAILED, verify credentials, the account-host
endpoint and connectivity with a read-only `HeadBucket` from the server, keeping
credentials and signing data out of output. Jobs retry up to five attempts with
backoff; FAILED requires a reviewed requeue, never ad-hoc SQL. Never delete objects
or rows to clear a failure. If a credential leaks, follow **Credential rotation**
above; preserve the shared-bucket limitations and keep R2 enabled for existing rows.

### Invoice email backlog before enabling mail

V084 queues one `INVOICE_ISSUED` row per newly issued invoice whether or not mail
delivery is enabled. Order notifications (`ORDER_CONFIRMED`, `ORDER_STATUS`,
`ORDER_CANCELLED`) and invoice notifications never expire: when
`PLIEGO_MAIL_ENABLED` becomes `true`, the worker sends every `PENDING` row oldest
first (default one per 30 s). Verification and reset emails expire with their
tokens (`ACTION_EXPIRED`); nothing else does. Before turning mail on, or after any
long mail outage, inspect the backlog read-only:

```sql
SELECT tipo, count(*), min(fecha_creacion), max(fecha_creacion), max(intentos)
  FROM pliego.correo_outbox WHERE estado = 'PENDING' GROUP BY tipo ORDER BY tipo;
```

If stale notifications must not reach customers, the owner decides a cutoff and an
operator retires them with an approved, audited statement instead of deleting rows,
for example marking them `FAILED` with `ultimo_error = 'STALE_NOT_SENT'` for the
chosen types and age. Never delete outbox rows: their event keys keep enqueueing
idempotent. A permanent claim-time freshness rule is a reviewed migration, not an
operator action.

## 3. Access, secrets and evidence

Every remote connection and transfer must use:

```bash
ssh -F /home/andres18123/.ssh/config pliego-vps
```

`ssh-add -l` can check the agent. Do not edit global/personal SSH configuration,
copy private keys or enable password/root SSH. On another operator machine, obtain
the authorized personal config path; do not guess credentials or replace keys.

Use interactive sudo when authentication is required, for example:

```bash
ssh -F /home/andres18123/.ssh/config -t pliego-vps
# In the remote deploy session, authenticate through the terminal:
sudo -i
```

The server-side commands below run in this privileged operator shell, not through
root SSH. For automation, use the environment's secure credential-input mechanism.
Never put passwords/tokens in command arguments, shell history, tool output,
source, manifests, JARs, `dist`, screenshots or logs. Do not enable `set -x`.
Do not pipe a password into the same stdin used to transport a script or SQL.

Before any production mutation, hold an exclusive deployment lock for the entire
operation. In the persistent remote privileged shell:

```bash
exec 9>/run/lock/pliego-deploy.lock
flock -n 9
```

If acquisition fails, stop: another operator may be deploying. The lock must stay
held across backup, activation, cleanup and verification. Separate short SSH
commands must not each acquire/release it; use one persistent session or one
orchestrator process. Do not remove another operation's lock file to bypass it.

Do not print/source/dump secret files for discovery, `/proc/.../environ`, unfiltered
systemd Environment properties or HTTP Authorization/cookie/token payloads.
Inspect secret file existence, owner/group and mode; when configuration verification
is necessary, extract only allowlisted non-secret fields or presence booleans in
memory. Preserve existing secrets. Request the missing credential by name if needed.
Do not recover it from old chat messages or copy credentials into this guide.

Maintain complete **private** local logs under an ignored `0700` directory such as
`.local-secrets/deployment-<UTC-date>/`; use `0600` files. Keep server-side logs,
database dumps and release manifests root-only. Dumps contain customer data and
possibly credential material: never commit or publish them. Show only useful,
sanitized evidence. Do not assume ignored evidence from a previous agent exists.

## 4. Pin and validate the release locally

From the repository root:

```bash
git status --short
git rev-parse HEAD
git log -5 --oneline
git ls-remote --heads origin main
```

Keep user changes intact. If the requested SHA differs from HEAD, use an authorized
isolated checkout; do not reset/stash/discard their work. Record any explicitly
approved uncommitted patch with its own file-hash manifest. A green committed SHA
does not certify additional uncommitted code.

For a committed release, confirm CI using GitHub CLI or the corresponding official
API/connector. Example (set `target_sha` to the verified full SHA):

```bash
gh run list -R andres18113/pliego-muejeje --commit "$target_sha" \
  --workflow ci.yml --json databaseId,headSha,status,conclusion,url
gh run view -R andres18113/pliego-muejeje "$run_id" \
  --json headSha,status,conclusion,jobs,url
```

The authoritative run must match the SHA, be completed/successful, and include
the required jobs in [the actual workflow](../../.github/workflows/ci.yml).
Record reruns/failures rather than selecting an old successful attempt to hide a
current failure. Missing CI access or an ambiguous target must be resolved before
production activation. Do not make an unrelated CI fix silently part of the release.

Read the diff, backend/frontend READMEs, configuration, relevant ADRs and deployment
notes. Specifically inspect pending migrations, startup bootstrap requirements,
workers, external services, filesystem writes and backward compatibility. A
documentation-only commit can still change an approved ZIP: preserve the selected
approved baseline and compare bytes, not just migration names/counts.

Typical local validation:

```bash
# From backend/
mvn -B --no-transfer-progress verify
# From frontend/; npm ci when installing/restoring the locked dependencies
npm ci
npm run test
VITE_API_BASE_URL=https://api.pliegolibros.com npm run build
npm run test:e2e
```

The frontend build includes typecheck. Run the lint/check commands actually defined
by the target revision; do not invent a lint script. Follow Playwright prerequisites
and the target tests' fixture/opt-in setup. Keep registration, payment, mail and DB
tests in an isolated environment. Never point test runners or development startup
scripts at production credentials.

For DB/backend changes, use native disposable PostgreSQL 18 and the current CI
recipe. `backend/src/test/postgres18/run_ci_gates.sh` needs disposable `PG*`, app
credentials and loopback endpoints. Run relevant forward-upgrade and restricted
runtime probes too. Billing/upgrade test enablement differs: follow the current
workflow, which disables the billing worker when starting historical schemas.
Keep external mail disabled or use the local stub. Never execute these fixture
gates against production, even when a gate contains `ROLLBACK`.

If Node 24.21 exhibits the previously observed native V8 compiler abort, preserve
the failure log and use this local workaround with the same test assertions:

```bash
node --no-opt --no-maglev --regexp-interpret-all --no-concurrent-recompilation \
  node_modules/vitest/vitest.mjs run --maxWorkers=1 \
  --execArgv=--no-opt --execArgv=--no-maglev \
  --execArgv=--regexp-interpret-all --execArgv=--no-concurrent-recompilation
```

Do not disable tests or permanently change application runtime flags for a test
runner issue. Allow the complete suite to finish; quiet output is not failure.

Freeze the artifacts after validation. Native test servers must run an immutable
copy of the JAR: Spring reads nested classes lazily, so replacing a live target JAR
during another Maven repackage can break a test process. Do not rebuild `dist`
while another task packages/verifies it.

## 5. Read-only production preflight

Use the SSH command above. Capture identity/OS, unit state, actual pointer targets,
configuration hashes, ports, resources and these administrative read queries:

```sql
SHOW server_version;
SHOW max_connections;
SELECT installed_rank, version, checksum, success
FROM public.flyway_schema_history ORDER BY installed_rank;
SELECT datname, pg_get_userbyid(datdba) FROM pg_database WHERE datname='pliego';
SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication FROM pg_roles WHERE rolname IN ('pliego_app','pliego_owner');
SELECT has_schema_privilege('pliego_app','pliego','CREATE'),
       has_schema_privilege('pliego_app','public','CREATE'),
       has_database_privilege('pliego_app','pliego','CREATE'),
       pg_has_role('pliego_app','pliego_owner','MEMBER');
```

The final four booleans must normally be false. Also record owner distributions,
business counts and queue aggregates without selecting identities, hashes, nonce/
token data, private invoice snapshots/files or mail bodies. Check data-dependent
new constraints before migration. Example: a new cedula check may preserve legacy
rows but block a later UPDATE of an invalid legacy DRAFT invoice. Report such a
conflict before changing data; never manufacture an identity to satisfy it.

Before the first release that applies V082 (INEC province/city catalog), also record
`SELECT count(*) FROM pliego.direccion` and `SELECT count(*) FROM pliego.ubicacion_retiro`;
acceptance compares them with ADR-0044's read-only `needs_review` counts after migration.

Useful remote commands (inspect/filter outputs before sharing):

```bash
id -un
hostname
cat /etc/os-release
readlink -f /opt/pliego/current
readlink -f /var/www/pliego/current
stat -c '%U:%G %a %n' /etc/pliego/pliego.env
systemctl show pliego --property=User,Group,ActiveState,SubState,UnitFileState,NRestarts,MemoryCurrent
ss -ltnp
free -m
df -h /
nginx -t
ufw status verbose
```

Read only relevant, sanitized Nginx/unit settings. Preserve existing loopback bind,
JVM/pool/hardening, proxy headers, SPA fallback, no-store HTML and immutable hashed
assets. Do not dump all service configuration if it might contain inline secrets.

Record whether this is frontend-only, backend-only, or coordinated. A frontend-only
release does not require DB membership changes, a backend restart or Flyway work.
A backend release without pending migrations normally needs no owner membership.

## 6. Package, transfer and prepare recovery

Use a unique release ID, e.g. `<UTC timestamp>-<short SHA>`; allow only letters,
digits, underscores and hyphens in values used as paths/commands. Never interpolate
unvalidated input or secret values into shell commands. Do not reuse a partially
prepared release directory by overwriting it.

1. Hash the JAR, each current `dist` file and the frontend archive with SHA-256.
   A frontend archive contains relative regular files rooted at `dist` contents;
   reject traversal, absolute paths and links. Exclude source, `.env`, keys,
   `node_modules` and source maps that embed source. Only explicitly public
   configuration belongs in the bundle.
2. Transfer through `ssh -F /home/andres18123/.ssh/config pliego-vps` into a unique
   `0700` deploy-owned staging directory. A safe implementation uses a binary file
   as SSH stdin and a fixed remote file destination. Avoid local recompilation or
   uploading the repository. Compare remote hashes before installation.
3. Compare every **already-applied** migration's bytes in the installed executable
   JAR (`BOOT-INF/classes/db/migration/`) with the candidate. Compare the original
   migrations with the approved ZIP too. Matching filenames are insufficient.
   The VPS has no `unzip`; use Python `zipfile` to compare migration entry bytes.
   Stop on any discrepancy; do not repair Flyway or edit an applied migration.
4. Before activation, capture both previous pointer targets and configuration
   hashes in `/opt/pliego/deployment/<release>/release.json` (`0700` directory,
   `0600` manifest). Store candidate hashes, source SHA, expected migration set,
   previous backend/frontend, deployment scope and planned rollback there.
5. Back up relevant Nginx/unit files. Since the environment file is unchanged,
   preserve it in place: do not duplicate secrets into the release. If an authorized
   configuration change is necessary, design its private recovery separately.
6. Create a root-only PostgreSQL custom-format backup before schema changes.
   In a privileged shell, open the `0600` output before invoking `pg_dump` as
   postgres; ensure it completed, then verify the archive with `pg_restore --list`.
   A Python `os.open(..., O_CREAT|O_EXCL, 0o600)` plus subprocess stdout is suitable.
   A successful archive listing checks structure; it does not prove full restore.
   Capture non-secret owner/grant state because the database dump alone does not
   recreate global roles. Never print role password hashes or dump contents.
7. Install backend directories as `root:pliego 0750`, JAR `0640`; frontend dirs
   `root:root 0755`, files `0644`. Verify `pliego`/Nginx can traverse/read them.
   Keep secrets/private documents out of the static tree.
8. Retain missing **hashed static assets** from the previous release without
   overwriting candidate files, so existing tabs do not receive chunk 404s. Never
   copy the old index over the new one. Keep both versioned releases for rollback.
   Prepare the reverse direction too: a separate versioned rollback frontend tree
   can contain the previous build plus missing candidate hashed assets. Verify its
   index is byte-identical to the previous build and record `rollbackFrontend`
   separately from `previousFrontend`. This serves new tabs' lazy chunks after a
   rollback without modifying an immutable previous release in place.
9. Prepare a release-specific `rollback.py` or equivalent with a genuine read-only
   `--dry-run`. It must validate old targets, planned ownership cleanup, schema/binary
   compatibility and `nginx -t`; see section 10. It must not change privileges,
   pointers or service state during preflight. Syntax-check it and exercise its
   preflight before changing pointers. Include section 7's early-failure recovery
   so a failure before the temporary owner grant restores previous availability.

Immediately before activation, compare the live pointers and installed artifact
hashes with the captured preflight state. Stop on unexpected drift instead of
overwriting another operator's release.

Avoid replacing an existing symlink non-atomically with `rm` then `ln`. Example
helper for a privileged remote shell (targets must have been installed/verified):

```bash
atomic_link() {
  python3 - "$1" "$2" <<'PY'
import os, pathlib, sys, uuid
link = pathlib.Path(sys.argv[1])
parent = {"/opt/pliego/current": pathlib.Path("/opt/pliego/releases"),
          "/var/www/pliego/current": pathlib.Path("/var/www/pliego/releases")}
assert str(link) in parent and link.is_symlink()
target = pathlib.Path(sys.argv[2]).resolve(strict=True)
assert target.is_dir() and target.parent == parent[str(link)].resolve(strict=True)
temporary = link.with_name(link.name + "." + uuid.uuid4().hex)
temporary.symlink_to(target)
try:
    os.replace(temporary, link)
finally:
    if temporary.is_symlink():
        temporary.unlink()
PY
}
# Call only with verified absolute release paths:
# atomic_link /opt/pliego/current "$new_backend"
# atomic_link /var/www/pliego/current "$new_frontend"
```

## 7. Backend activation and migration privileges

This sequence is essential **after the owner/runtime separation**. Old deployment
scripts from before this separation may omit the temporary grant and fail on new
migrations. Do not run an old hardcoded release script blindly.

If there are pending migrations:

1. Confirm the backup, compatibility tests, rollback and operator sudo access.
   Use a bounded maintenance window; this is not a zero-downtime procedure.
2. Stop `pliego.service`, draining its connection pool; verify the stopped state
   as described below. As the administrative DB operator, grant migration-time
   inherited ownership:

   ```sql
   GRANT pliego_owner TO pliego_app;
   SELECT pg_has_role('pliego_app','pliego_owner','USAGE'); -- must be true
   ```

   This temporary membership is not a runtime setting. Never change passwords,
   make the runtime SUPERUSER, or set pooled connections' role to `pliego_owner`.
3. Atomically select the verified candidate backend; start the normal service.
   Its ordinary Flyway startup applies pending migrations. Do not run SQL migration
   files manually or launch a second backend against the same DB concurrently.
4. Poll the local DB-backed catalog endpoint with a bounded timeout, inspect the
   startup journal and verify the planned Flyway versions/checksums succeeded.
   Do not publish the new frontend or declare completion while privileges remain.
5. **Stop the service again**, then run the administrative transaction below.
   New objects may belong to `pliego_app` because Flyway ran under that session
   identity; reassignment and explicit grants are required.
6. Assert runtime privilege booleans are false, then restart the normal service.
   Recheck Flyway, local catalog, unit/worker logs and runtime privileges. Only
   this restricted, fresh pool is the accepted runtime state.

**Stop/start procedure.** Java exits 143 on SIGTERM, so `systemctl stop pliego`
can leave `ActiveState=failed`, `Result=exit-code`. Treat either failed or inactive
with `MainPID=0` as drained; waiting only for inactive times out. Inspect
`systemctl show pliego --property=ActiveState,Result,MainPID` and run
`systemctl reset-failed pliego` before the next start, including recovery starts.
On 2026-11-01, attempt 1 waited only for inactive and caused about 1.5 minutes of
downtime before a manual restart.

**Early-failure recovery.** Any failure before the temporary owner GRANT must
restore the previous release's availability: leave pointers unchanged, verify the
exact original Flyway history (V073 for the 2026-11-01 attempt) and section 5's
`f|f|f|f`, then reset-failed and restart the previous binary. If the temporary
grant was applied but Flyway still has that exact original history, revert only
that grant with `REVOKE pliego_owner FROM pliego_app`; verify `f|f|f|f` and zero
`pliego_app`-owned objects before restarting the previous binary. The full ACL
cleanup below references V082 geo tables and cannot run on a pre-V082 schema.
Any partial migration prefix stays stopped pending reviewed recovery.

Suggested startup budget: a **90-second monotonic deadline**, polls about every
2 seconds, each request capped at 3 seconds and by the remaining deadline. Require
HTTP 200, parse JSON, validate `items` is a list and `totalCount` is a nonnegative
integer/string integer, and compare with preflight observations. An HTML response,
malformed JSON or an unexpectedly empty catalog is not a successful check. A
measured startup requirement can justify a different recorded budget; do not wait
indefinitely or hide an automatic restart loop.

Full administrative cleanup, on the `pliego` database, after stopping the service
and confirming the required V082 tables exist (use the early-failure procedure
above only when history is exactly unchanged):

```sql
-- BEGIN PLIEGO_RUNTIME_ACL_CLEANUP_SQL
BEGIN;
-- Precondition: pliego_owner already exists, is NOLOGIN and has no elevated
-- attributes. Inspect shared ownership before using REASSIGN OWNED: this app
-- role must not own unrelated databases/tablespaces or serve another system.
REASSIGN OWNED BY pliego_app TO pliego_owner;
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pliego_app',current_database());
END; $$;
GRANT USAGE ON SCHEMA public, pliego TO pliego_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pliego TO pliego_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pliego TO pliego_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pliego TO pliego_app;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA pliego TO pliego_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flyway_schema_history TO pliego_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pliego_owner IN SCHEMA pliego
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pliego_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pliego_owner IN SCHEMA pliego
  GRANT USAGE, SELECT ON SEQUENCES TO pliego_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pliego_owner IN SCHEMA pliego
  GRANT EXECUTE ON ROUTINES TO pliego_app;
-- Defaults are schema-wide and support future business tables; reset geo ACLs after every broad grant.
-- Address/pickup FKs lock ciudad with KEY SHARE; one column UPDATE is sufficient, not table-level UPDATE.
-- No owner DML is needed on provincia: business address/pickup FKs reference ciudad directly.
GRANT UPDATE (ciudad_id) ON TABLE pliego.ciudad TO pliego_owner;
-- V082 revoked app's owner DML on these catalogs; REASSIGN OWNED carries that ACL to pliego_owner.
REVOKE ALL PRIVILEGES ON TABLE pliego.provincia, pliego.ciudad, pliego.ciudad_alias FROM pliego_app;
-- Also clear any column ACLs; table-level REVOKE does not remove column-level grants.
DO $$
DECLARE geo_column RECORD;
BEGIN
  FOR geo_column IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
     WHERE c.oid IN ('pliego.provincia'::regclass,'pliego.ciudad'::regclass,
                     'pliego.ciudad_alias'::regclass)
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM pliego_app',
                   geo_column.column_name,geo_column.schema_name,geo_column.table_name);
  END LOOP;
END; $$;
GRANT SELECT ON TABLE pliego.provincia, pliego.ciudad, pliego.ciudad_alias TO pliego_app;
-- Runtime needs no schema/database DDL; drop direct grants before ending temporary owner membership.
REVOKE CREATE ON SCHEMA public, pliego FROM pliego_app;
DO $$
BEGIN
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM pliego_app',current_database());
END; $$;
REVOKE pliego_owner FROM pliego_app;
COMMIT;
-- END PLIEGO_RUNTIME_ACL_CLEANUP_SQL
```

Execute as the administrative operator using `runuser -u postgres -- psql -X
-v ON_ERROR_STOP=1 -d pliego`, with SQL passed through a quoted heredoc or a private
file opened by the privileged shell. Do not run it as the application login.
This is environment privilege provisioning, not manual business-schema migration.

An already-open transaction can retain earlier privileges until it ends. A revoke
alone is insufficient: stop/drain before cleanup and restart afterward, including
on the **failure/rollback path**. Do not use `SET ROLE` for migration on pooled
runtime connections. Verify new sessions, not only the administrative session.
The final geo-table revokes must remain after the blanket grants and schema-wide
defaults; any later migration that adds a geo reference table must keep its own
explicit read-only ACL because PostgreSQL defaults cannot exclude named tables.

After the cleanup and restricted restart, run this **read-only** postflight query
block as the administrative operator. Every result must be `t` before declaring
the restricted runtime ready:

```sql
WITH geo(table_name, relation_oid) AS (
  VALUES ('provincia','pliego.provincia'::regclass),
         ('ciudad','pliego.ciudad'::regclass),
         ('ciudad_alias','pliego.ciudad_alias'::regclass)
)
SELECT table_name,
       has_table_privilege('pliego_app',relation_oid,'SELECT') AS app_select,
       NOT (has_table_privilege('pliego_app',relation_oid,'INSERT')
         OR has_table_privilege('pliego_app',relation_oid,'UPDATE')
         OR has_table_privilege('pliego_app',relation_oid,'DELETE')
         OR has_table_privilege('pliego_app',relation_oid,'TRUNCATE')) AS app_no_table_writes
  FROM geo ORDER BY table_name;

SELECT NOT EXISTS (
  SELECT FROM pg_attribute a
   WHERE a.attrelid IN ('pliego.provincia'::regclass,'pliego.ciudad'::regclass,
                        'pliego.ciudad_alias'::regclass)
     AND a.attnum>0 AND NOT a.attisdropped
     AND (has_column_privilege('pliego_app',a.attrelid,a.attnum,'INSERT')
       OR has_column_privilege('pliego_app',a.attrelid,a.attnum,'UPDATE')
       OR has_column_privilege('pliego_app',a.attrelid,a.attnum,'REFERENCES'))
) AS app_no_geo_column_insert_update_references;

SELECT has_column_privilege('pliego_owner','pliego.ciudad','ciudad_id','UPDATE')
         AS owner_city_id_update,
       EXISTS (
         SELECT FROM pg_attribute a
         CROSS JOIN LATERAL aclexplode(COALESCE(a.attacl,'{}'::aclitem[])) acl
          WHERE a.attrelid='pliego.ciudad'::regclass
            AND a.attname='ciudad_id'
            AND acl.grantee=(SELECT oid FROM pg_roles WHERE rolname='pliego_owner')
            AND acl.privilege_type='UPDATE'
       ) AS owner_explicit_city_id_update,
       NOT has_table_privilege('pliego_owner','pliego.ciudad','UPDATE')
         AS owner_no_table_update;

SELECT NOT pg_has_role('pliego_app','pliego_owner','MEMBER') AS app_not_owner_member,
       NOT has_schema_privilege('pliego_app','public','CREATE') AS app_no_public_create,
       NOT has_schema_privilege('pliego_app','pliego','CREATE') AS app_no_pliego_create,
       NOT has_database_privilege('pliego_app',current_database(),'CREATE') AS app_no_database_create;

SELECT has_table_privilege('pliego_app','pliego.direccion','SELECT') AS address_select,
       has_table_privilege('pliego_app','pliego.direccion','INSERT') AS address_insert,
       has_table_privilege('pliego_app','pliego.direccion','UPDATE') AS address_update,
       has_table_privilege('pliego_app','pliego.direccion','DELETE') AS address_delete;
```

The block only reads PostgreSQL privilege/catalog metadata; it performs no writes.
`runtime_privileges_gate.sql` deliberately performs customer and address writes
inside a transaction that it rolls back. It is for CI and isolated restores only,
**not production**.

The application uses `SECURITY INVOKER`; required table DML/sequence/routine grants
are intentional. Runtime credentials remain trusted backend credentials, not an
end-user row-isolation boundary. See [the privilege note](billing-runtime-privileges.md).

For no-pending-migration releases, keep existing ownership/membership unchanged,
stop the backend, switch its pointer and start once. Flyway still validates
normally. Stop before changing a backend pointer so a live classloader cannot
resolve resources through a pointer that has changed underneath it.

If migration/startup fails after the grant: stop/drain and inspect the actual
Flyway history first. Use the early-failure procedure only for the exact original
history; otherwise restore restricted grants/ownership when the schema supports
the full cleanup. Verify cleanup before starting either binary. If cleanup or
old-binary compatibility cannot be established, leave the backend stopped,
preserve recovery evidence and report the blocker.
Never leave elevated runtime membership in place to make startup appear healthy.
Inspect the actual committed migration prefix: if V074 commits and V075 fails,
V074 remains applied. Check the failed script's transaction configuration and any
nontransactional remnants; do not assume all-or-nothing across migration files.
Recovery must be compatible with that actual state, not just the intended final
schema. A partial migration prefix stays stopped; assess intermediate-prefix
compatibility in a disposable DB for a reviewed recovery, never by repairing
history to manufacture a rollback.

## 8. Frontend activation and Nginx

After the backend is healthy as restricted runtime, atomically select the candidate
frontend. For frontend-only deployments, first verify compatibility with the
already-running backend. Check the exact public index and entry-asset hashes.

**Email brand assets.** Transactional emails load their logo from the storefront:
`<PLIEGO_APP_PUBLIC_URL>/brand/pliego-logo-email.png`, and messages delivered
before that lockup load `/brand/pliego-logo.png`. Before activating a backend whose
mail templates name a brand file, confirm the candidate `dist` contains it (the
frontend test `emailBrandAssets` enforces this at build time). After the frontend
switch, both URLs must answer `200` with `Content-Type: image/png`; the SPA fallback
answers a missing file with `200 text/html`, so a status code alone proves nothing.
The interval between backend start and this switch is tolerable because clients
fetch the logo when a message is opened and the fallback is `no-store`, but keep it
short and never end a release with the backend ahead of its brand assets.

The existing Nginx root follows `/var/www/pliego/current`. A symlink-only release
normally requires **no Nginx edit or reload**. If a verified deployment requirement
does require a change to a PLIEGO vhost, save a private backup first, preserve
server names, HTTPS/Origin CA/AOP and proxy security, run `nginx -t`, and only then
reload. Do not reload after a failed syntax test.

Preserve SPA routing and refresh of `/account`, `/catalog`, `/checkout`, etc.
HTML uses no-store; versioned assets use immutable caching. Retain old chunks for
open tabs. Do not change Cloudflare caching or purge DNS to mask an artifact error.

## 9. Acceptance checks

Use observed preflight values and the candidate's migration set; do not hardcode
past counts such as 425 editions, 73 migrations or a previous test total.

| Check | Required evidence |
| --- | --- |
| Artifact identity | Local/staged/installed JAR and archive hashes match; public HTML/entry assets match the new build after redirects |
| Service | Active and enabled, intended user/group/JVM/pool; no unexpected restarts or startup errors |
| DB/Flyway | Correct DB/PG18, all planned migrations successful, historical checksums intact, restricted runtime has no owner membership or CREATE |
| Functional API | `GET /api/v1/catalog/editions?page=0&pageSize=1` returns valid DB-backed data; no dedicated Actuator/health endpoint is assumed |
| Geographic inputs | If an authorized smoke check writes an address, checkout billing address or invoice address, read the public province/city catalog and submit the selected `provinceId`/`cityId` pair; verify public `Bucay` → General Antonio Elizalde and `Playas` → General Villamil aliases. After V082, report the read-only `needs_review` counts from ADR-0044 (saved addresses and pickup locations left with null catalog IDs) next to the preflight totals; they keep their text and stay deliverable, so a count is information, never a reason to edit customer data |
| Public API/site | HTTPS via Cloudflare; canonical `www` redirect retains path/query and final response is 200; SPA direct navigation/reload works |
| Catalog | Counts plausible vs preflight; whole-set sort/page/filter behavior if affected, visible formats and decoding images on `covers.pliegolibros.com` |
| Email assets | `/brand/pliego-logo-email.png` and `/brand/pliego-logo.png` return `image/png` (not `text/html`); a sample of `covers/editions/email-v1/*.jpg` returns `image/jpeg` |
| Browser | Relevant affected flows at mobile/desktop; normally 320, 390, 1280, plus 768/real zoom when responsive changes warrant it; no new JS/network errors |
| Private routes | Anonymous billing/identity/invoice/PDF access rejects with 401; authorized ownership/download behavior proven locally without fabricating production purchases |
| CORS/cookies | Canonical frontend origin allowed, foreign origin rejected; Secure/HttpOnly/SameSite behavior preserved. `www` redirects before JS, so do not add it to CORS automatically |
| Origin isolation | Origin requests to all three HTTPS vhosts without the AOP client certificate return 400 (operator re-verified 2026-11-01); external direct-origin access blocked; 8080/5432 loopback only |
| Errors | Understandable Spanish failures, no stacks, SQL or secrets in public responses |
| Workers | Billing/mail/delivery schedulers configured as intended, no failed claims or stuck leases; inspect aggregate queue outcomes |
| Resources | RAM available, swap, CPU/load and disk support steady state; compare to preflight |
| Recovery | Previous release/backup/config metadata retained; rollback preflight passes and schema compatibility is documented |

Do not print or download real private invoices merely to test a GET. Empty queues
prove idle worker health/grants, not successful production document generation.
Billing defaults: enabled, `PT5S`, batch 4; new production artifacts use private R2,
while historical PostgreSQL `bytea` remains streamable. Existing legacy documents
must remain historical; do not backfill them by creating orders/invoices yourself.
IVA is 0 for new supported catalog operations; old commercial snapshots remain
unchanged.

Journal gates fail on ERROR-level Spring records only; match the record's level,
not arbitrary `Exception` text. WARN and Exception occurrence counts are
informational; review worker markers and queue state separately as described above.

For mail, preserve existing configuration and inspect outbox aggregates first.
Never resend demo messages or treat `SENT` as inbox receipt. Distinguish application
outbox persistence, provider acceptance, provider delivery event and human receipt.
At most one identifiable transactional smoke when token/sender and controlled
recipient are authorized; otherwise report that specific validation as untested.

Public browser probes should block business writes. If stubbing anonymous session
refresh for a read-only probe, the current contract is 204, not a fake login/token.
Classify blocked Cloudflare `/cdn-cgi/rum` telemetry separately from business POSTs;
do not mislabel telemetry or mocked contracts as product defects.

## 10. Rollback and failure handling

Prepare recovery **before** switching. A release rollback selects the recorded
compatible recovery targets and restores explicitly backed-up config changes; it
keeps current business data, applied Flyway migrations and owner/runtime separation.

1. Stop/drain the backend if it was elevated, unhealthy, or needs a pointer switch;
   accept failed/inactive with `MainPID=0` and reset-failed before starting.
2. Apply section 7's schema-appropriate cleanup and verify no owner membership/
   CREATE. Exact-original-history recovery revokes only the temporary grant;
   do not run the V082-dependent block on an older schema. A partial migration
   prefix stays stopped for reviewed recovery.
3. Check the old binary's compatibility with the new schema in a disposable DB
   before relying on it. Flyway may ignore future migrations with a warning; do
   not assume that proves old checkout/invoice semantics remain correct. Record
   disabled/new features and any known forward-schema limitations.
   Once R2 rows exist, keep R2 enabled and choose a binary that serves them;
   `a298dc4` cannot. An R2 environment rollback requires zero R2 rows.
4. Atomically restore the recorded old backend and/or frontend targets; start the
   backend as restricted runtime and verify the DB-backed catalog. If restoring
   Nginx, run `nginx -t` before a reload. Frontend-only rollback should not restart
   the backend or change DB privileges. Prefer the recorded `rollbackFrontend`
   tree that preserves both generations of hashed chunks. Already-running new
   clients may still require a reload when their API features cannot be supported
   by the old backend; report that compatibility limit instead of promising a
   transparent, zero-downtime rollback. A frontend rollback target must still
   contain every `/brand/` image the running backend's mail templates reference
   (`pliego-logo-email.png` from the release that introduced it); keep it in the
   rollback tree or roll the backend back with it, then re-run the Email assets check.
5. Verify public requests, workers, ports and logs. Report whether rollback was
   actually executed or only preflight-tested. Keep failed releases/logs for review.

A dump is emergency recovery material, not a routine rollback command. Restoring
production data is a separate explicit recovery decision because it can erase
orders placed after the backup. No automatic restore, DROP DATABASE, Flyway repair
or destructive schema rollback is allowed by this runbook.

Do not loop indefinitely on failed deploys. Make a bounded startup attempt and a
compatible application rollback when available. If either fails, preserve the
restricted state, previous static frontend and evidence, and report the concrete
blocker rather than making unrelated infrastructure changes.

## 11. Handoff and ongoing operations

Write a non-secret local and server-side release record with: source SHA and CI
URL; artifact hashes; current/previous targets; startup times; planned/applied
migrations; configuration hashes and intentional changes; owner/runtime state;
test/build/browser results with local-vs-production distinctions; resources;
backup/rollback paths and actual/preflight status; untested checks and blockers.
Do not infer successful authentication/mail/invoice journeys from anonymous GETs.
Keep staging until hashes and public checks pass; then remove only this deployment's
explicit staging directory. Preserve releases, evidence and backups; retention or
pruning is a separate task. Avoid committing deployment logs or credentials.

Normal operational commands:

```bash
ssh -F /home/andres18123/.ssh/config pliego-vps \
  'systemctl status pliego nginx --no-pager'
ssh -F /home/andres18123/.ssh/config -t pliego-vps \
  'sudo journalctl -u pliego -n 100 --no-pager'
ssh -F /home/andres18123/.ssh/config -t pliego-vps \
  'sudo systemctl restart pliego'
```

For recovery, inspect the recorded release's `rollback.py` before invoking its
`--dry-run` or actual rollback; substitute the manifest's verified path, not a past
release hardcoded in a conversation. A normal restart with no pending migration
must succeed without granting the runtime owner privileges.

## Mailtrap webhook activation and deliverability

These steps describe a future authorized operation. They do not authorize a
release, production access, Mailtrap changes, suppression removal, or customer
email resends. V093 must be released through the normal pinned-artifact and
migration privilege lifecycle above before activation.

1. In Mailtrap, prepare an Email Sending webhook for the sending domain and
   transactional stream. Use the public HTTPS route `/api/v1/webhooks/mailtrap`
   on port 443, JSON payload format, and the delivery, bounce, soft bounce,
   reject and suspension events. JSON Lines is not supported by this receiver.
2. Obtain the webhook signing secret from Mailtrap and provision it through the
   existing secret-injection mechanism as `PLIEGO_MAILTRAP_WEBHOOK_SECRET`.
   Never paste it in this runbook, command history, URL, logs, or a tracked file.
   The receiver validates `Mailtrap-Signature` using HMAC-SHA256 on raw bytes;
   it returns 404 when the secret is absent. It operates independently of
   `PLIEGO_MAIL_ENABLED`. Changing or rotating the secret requires a controlled
   backend restart and coordinated update in Mailtrap.
3. With explicit authorization for the provider configuration, use Mailtrap's
   webhook test and activate the webhook. This tests webhook ingestion, not an
   email resend. Confirm HTTP 200 and signature enforcement; investigate 401,
   409, 413 or 5xx before activation. Monitor the provider's webhook retry/pause
   status. Configure the proxy to pass the signature header and unmodified body
   and permit JSON payloads up to the receiver's 1 MiB limit.

Deliverability check (read-only, authorized operators only):

```sql
SELECT tipo, estado, entrega_estado, count(*)
  FROM pliego.correo_outbox
 GROUP BY tipo, estado, entrega_estado ORDER BY tipo, estado, entrega_estado;
SELECT estado, motivo,
       count(*) FILTER (WHERE procesado_en IS NULL) AS pending,
       count(*) FILTER (WHERE procesado_en IS NOT NULL) AS projected,
       min(recibido_en) FILTER (WHERE procesado_en IS NULL) AS oldest_pending
  FROM pliego.correo_evento_proveedor GROUP BY estado, motivo ORDER BY estado, motivo;
SELECT count(*) AS unmatched_events
  FROM pliego.correo_evento_proveedor e
 WHERE e.procesado_en IS NULL AND NOT EXISTS (
   SELECT FROM pliego.correo_outbox o WHERE o.id_mensaje_proveedor=e.id_mensaje_proveedor);
SELECT count(*) AS accounts_with_known_delivery_failure
  FROM pliego.usuario WHERE email_no_entregable_desde IS NOT NULL;
```

`SENT` means API acceptance. `entrega_estado` records the asynchronous outcome;
neither implies that a message reached the inbox rather than spam. Projection
runs every five seconds in short transactions. Unmatched events remain durable
until their provider message receipt is available; investigate persistent unmatched
events or `mail_event state=PROJECTION_FAILED`. Historical failures are not imported
automatically: activation cannot retroactively fix an already-sent outbox record.

For provider evidence, `scripts/mailtrap-deliverability.py` reads suppressions and
recent `not_delivered` logs using `PLIEGO_MAILTRAP_API_TOKEN`. It performs GET only,
sets an explicit User-Agent (avoids Cloudflare code 1010 from urllib's default UA),
refuses redirects, and prints only allowlisted fields and canonical SHA-256
recipient hashes. Default lookback is 24 hours and one page; `--hours` and
`--max-pages` bound larger reads. Pagination truncation is explicit. It never
prints SMTP text, subjects, recipients or tokens, deletes suppressions, or sends
messages. Run only after authorization for the target account; this change was
tested with a fake transport, never against production.

Hard bounce/suppression makes future worker sends to that address
`HELD / EMAIL_UNDELIVERABLE`; held rows remain visible and are never automatically
claimed. A corrected account address clears its profile indicator; a later delivery
can clear address blocking, while FAILED/HELD rows stay unchanged. Keep event IDs
for deduplication through the provider replay window; cleanup needs a separately
reviewed retention procedure, not ad-hoc deletion.

After the customer corrects and verifies the address, separately authorize any
Mailtrap suppression removal. Never remove suppression just to retry an invalid
address. Review original recipient snapshots, token expiry, provider acceptance
and delivery history before any requeue through the existing reviewed operational
process. There is no public/admin resend endpoint or automatic retargeting, and
this change adds none. Any customer email resend requires separate authorization.

See [ADR 0048](../adr/0048-mailtrap-delivery-outcomes.md) and the
[API amendment](../api-amendments/2026-11-01-email-delivery-status.md).
