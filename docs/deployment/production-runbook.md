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

Last verified deployment: **2026-10-21**, release `20261021-a298dc4`, source
`a298dc4eed2cecba9f197a54df24c90d99e7ef73`, Flyway **73**. These are historical
reference values, not instructions to redeploy that release or expect 73 forever.

| Component | Expected arrangement |
| --- | --- |
| SSH | `deploy@vps1` through the operator's personal SSH alias below |
| VPS | Ubuntu 24.04, 2 vCPU, about 3.8 GiB RAM, 2 GiB swap |
| Java | Java 25; application user/group `pliego`, no login |
| Backend | `/opt/pliego/releases/<release>/pliego-backend-0.1.0-SNAPSHOT.jar` |
| Backend pointer | `/opt/pliego/current` → versioned release |
| Service | `pliego.service`; Spring binds only `127.0.0.1:8080` |
| Secrets | `/etc/pliego/pliego.env`, `root:pliego`, `0640` |
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
   preflight before changing pointers.

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
2. Stop `pliego.service`, draining its connection pool. As the administrative DB
   operator, grant migration-time inherited ownership:

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

Suggested startup budget: a **90-second monotonic deadline**, polls about every
2 seconds, each request capped at 3 seconds and by the remaining deadline. Require
HTTP 200, parse JSON, validate `items` is a list and `totalCount` is a nonnegative
integer/string integer, and compare with preflight observations. An HTML response,
malformed JSON or an unexpectedly empty catalog is not a successful check. A
measured startup requirement can justify a different recorded budget; do not wait
indefinitely or hide an automatic restart loop.

Administrative cleanup, on the `pliego` database, after stopping the service:

```sql
BEGIN;
-- Precondition: pliego_owner already exists, is NOLOGIN and has no elevated
-- attributes. Inspect shared ownership before using REASSIGN OWNED: this app
-- role must not own unrelated databases/tablespaces or serve another system.
REASSIGN OWNED BY pliego_app TO pliego_owner;
GRANT CONNECT ON DATABASE pliego TO pliego_app;
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
REVOKE pliego_owner FROM pliego_app;
COMMIT;
```

Execute as the administrative operator using `runuser -u postgres -- psql -X
-v ON_ERROR_STOP=1 -d pliego`, with SQL passed through a quoted heredoc or a private
file opened by the privileged shell. Do not run it as the application login.
This is environment privilege provisioning, not manual business-schema migration.

An already-open transaction can retain earlier privileges until it ends. A revoke
alone is insufficient: stop/drain before cleanup and restart afterward, including
on the **failure/rollback path**. Do not use `SET ROLE` for migration on pooled
runtime connections. Verify new sessions, not only the administrative session.

The application uses `SECURITY INVOKER`; required table DML/sequence/routine grants
are intentional. Runtime credentials remain trusted backend credentials, not an
end-user row-isolation boundary. See [the privilege note](billing-runtime-privileges.md).

For no-pending-migration releases, keep existing ownership/membership unchanged,
stop the backend, switch its pointer and start once. Flyway still validates
normally. Stop before changing a backend pointer so a live classloader cannot
resolve resources through a pointer that has changed underneath it.

If migration/startup fails at any point after the grant: stop/drain; revoke and
restore the restricted runtime grants/ownership; verify privilege cleanup before
starting either binary. If cleanup or old-binary compatibility cannot be established,
leave the backend stopped, preserve recovery evidence and report the blocker.
Never leave elevated runtime membership in place to make startup appear healthy.
Inspect the actual committed migration prefix: if V074 commits and V075 fails,
V074 remains applied. Check the failed script's transaction configuration and any
nontransactional remnants; do not assume all-or-nothing across migration files.
Recovery must be compatible with that actual state, not just the intended final
schema. Test intermediate prefixes in a disposable DB when their changes could
affect fallback compatibility; never repair history to manufacture a rollback.

## 8. Frontend activation and Nginx

After the backend is healthy as restricted runtime, atomically select the candidate
frontend. For frontend-only deployments, first verify compatibility with the
already-running backend. Check the exact public index and entry-asset hashes.

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
| Public API/site | HTTPS via Cloudflare; canonical `www` redirect retains path/query and final response is 200; SPA direct navigation/reload works |
| Catalog | Counts plausible vs preflight; whole-set sort/page/filter behavior if affected, visible formats and decoding images on `covers.pliegolibros.com` |
| Browser | Relevant affected flows at mobile/desktop; normally 320, 390, 1280, plus 768/real zoom when responsive changes warrant it; no new JS/network errors |
| Private routes | Anonymous billing/identity/invoice/PDF access rejects with 401; authorized ownership/download behavior proven locally without fabricating production purchases |
| CORS/cookies | Canonical frontend origin allowed, foreign origin rejected; Secure/HttpOnly/SameSite behavior preserved. `www` redirects before JS, so do not add it to CORS automatically |
| Origin isolation | Local requests to each HTTPS vhost without the AOP client certificate rejected (verified baseline: 400); external direct-origin access blocked; 8080/5432 loopback only |
| Errors | Understandable Spanish failures, no stacks, SQL or secrets in public responses |
| Workers | Billing/mail/delivery schedulers configured as intended, no failed claims or stuck leases; inspect aggregate queue outcomes |
| Resources | RAM available, swap, CPU/load and disk support steady state; compare to preflight |
| Recovery | Previous release/backup/config metadata retained; rollback preflight passes and schema compatibility is documented |

Do not print or download real private invoices merely to test a GET. Empty queues
prove idle worker health/grants, not successful production document generation.
Billing defaults: enabled, `PT5S`, batch 4; artifact bytes are private PostgreSQL
`bytea`, not public files. Existing legacy documents must remain historical; do not
backfill them by creating orders/invoices yourself. IVA is 0 for new supported
catalog operations; old commercial snapshots remain unchanged.

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

1. Stop/drain the backend if it was elevated, unhealthy, or needs a pointer switch.
2. Complete section 7 privilege cleanup and verify no owner membership/CREATE.
3. Check the old binary's compatibility with the new schema in a disposable DB
   before relying on it. Flyway may ignore future migrations with a warning; do
   not assume that proves old checkout/invoice semantics remain correct. Record
   disabled/new features and any known forward-schema limitations.
4. Atomically restore the recorded old backend and/or frontend targets; start the
   backend as restricted runtime and verify the DB-backed catalog. If restoring
   Nginx, run `nginx -t` before a reload. Frontend-only rollback should not restart
   the backend or change DB privileges. Prefer the recorded `rollbackFrontend`
   tree that preserves both generations of hashed chunks. Already-running new
   clients may still require a reload when their API features cannot be supported
   by the old backend; report that compatibility limit instead of promising a
   transparent, zero-downtime rollback.
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
