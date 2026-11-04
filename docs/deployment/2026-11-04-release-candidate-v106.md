# Release candidate: V106 (offer expiration, checkout pricing instant and browser refresh)

Preparation date: **2026-11-04, America/Guayaquil. Prepared, NOT deployed.**
The release SHA is the branch head selected at deployment time; it must have its
own green **PLIEGO CI** run (runbook section 4). The deployment record (section 11)
captures that SHA, the run and artifact checksums, following the
[V101–V105 precedent](2026-11-03-release-candidate-v101-v105.md).

Currently qualified code candidate: **`9c5afd73c328bf6ae9d3b0b17b9f699b0651d286`**,
[PLIEGO CI 41901244197](https://github.com/andres18113/pliego-muejeje/actions/runs/41901244197),
all three jobs successful. The commit containing this record and the tooling fix
supersedes that candidate and needs its own green PLIEGO CI run; **Claude will
report the resulting SHA and run**. This record authorizes no production access
or action. Only release helpers/tests, documentation, ignored evidence and local
verification were changed or run.
No SSH, VPS, Cloudflare or production endpoint was contacted; no commit, push,
merge, index or HEAD mutation was performed by this preparation.

Follow the [production runbook](production-runbook.md) in full, especially sections
1, 6, 7, 8b, 9 and 10, and the [runtime privilege note](billing-runtime-privileges.md).
The split-pointer tooling limitation is resolved locally as recorded below.
Activation still requires the selected release head's own green CI, pinned artifacts
and the authorized operator's live gates. The ordered procedure remains pending.

## Last recorded production state — not a live preflight

| Component | Last recorded value | Evidence and limitation |
|---|---|---|
| Backend | `/opt/pliego/releases/20261103T204931Z-ec48e07`; source `ec48e071854916cdf1051016e0c49fac9145e216` | Runbook and V101–V105 deployment outcome; subsequent frontend logs retain this pointer |
| Database | PostgreSQL 18; Flyway 105, 105 successful, zero failed | Later frontend preflight at 2026-11-04T02:55:47Z; not inspected now |
| Frontend | `/var/www/pliego/releases/20261104T021801Z-33b4ef5`; source `33b4ef54bc3b52d0ec5f7db7c74d92d1d8d70f3b` | Switch recorded 2026-11-04T02:57:10Z, monitor at 03:11:35Z |
| Frontend identity | index SHA-256 `cf0c532f97f3eacf5ec3394a1058e1c77192ef80bdb155e18c1c365a270e9e11`; build ID `20261104T021801Z-33b4ef5`; recorded CI 41759796199 | Historical frontend package/records, not this candidate's CI or hashes |
| Intermediate frontend | `20261104T014518Z-27ee059` switched at 2026-11-04T01:57:54Z | Superseded by the recorded `33b4ef5` frontend |
| Runtime/configuration | Recorded backend active, zero restarts; R2/mail preserved; owner membership/CREATE absent | Revalidate all roles, ownership, environment presence/settings, ports, queues and hashes immediately before activation |

The prepared plans in `.release-evidence/2026-11-05/frontend-release-27ee059/` and
`frontend-release-33b4ef5/` still say “prepared, NOT executed”; that heading alone
does not establish deployment. The later local records
`.local-secrets/deployment-2026-11-04-frontend{,-33b4ef5}/f1.out`, `f3.out` and
`f4.out` record the switches above. Their dated directory names are evidence
labels: 2026-11-04T03:11:35Z is **2026-11-03T22:11:35-05:00**. Neither a directory
label nor an earlier observation establishes current production state.

Sanitized extracts and source-log hashes are in
`.release-evidence/2026-11-04/release-prep/recorded-production-state.json`.
The operator must recapture both pointers independently, their JAR/index/tree
hashes, complete Flyway history/checksums, role/ACL state, service/configuration,
listening ports, catalog totals, offer deadlines and queue/resource aggregates.
Unexpected drift requires review; do not overwrite another release.

### Release-tooling limitation — resolved locally

Resolved in [`scripts/ops/deploy/`](../../scripts/ops/deploy/): version 3 pins
independent backend/frontend IDs, source SHAs and hashes, plus PF-based recovery.
Version-2 common-ID manifests remain supported. Drift gates cover both pointers;
component-only rollback leaves the other pointer/service untouched. Prior safety
gates remain; no production installation or manifest was changed.

The full offline suite passed **53 tests: 35 existing + 18 new**, including
split manifest/dry-run/actual fixture recovery, drift during drain, scoped CLI
recovery and legacy/root-mode checks. See
[`test_split_pointers.py`](../../scripts/ops/deploy/test_split_pointers.py) and
`.release-evidence/2026-11-04/release-prep/tooling/{full-tests.log,split-pointer-e2e.json,verification-summary.json}`.
Final committed/copy hashes, CI and live qualification remain required.

## Scope and artifact identity

On top of `33b4ef5`, the candidate includes:

- V106 and [ADR 0058](../adr/0058-offer-expiration-and-refresh.md):
  one post-lock `clock_timestamp()` purchase pricing instant; immutable
  `pedido.pricing_evaluated_at` for new orders; accepted-quote comparison against
  created snapshots, with existing `P4005 / CART_QUOTE_CHANGED` on mismatch.
  Replays retain their original result; old orders remain NULL and are not repriced.
- Replaced `fn_edition_offer`, `sp_checkout_execute`, `sp_checkout_quoted`,
  `fn_capture_order_item_offer_snapshot` and `fn_realtime_read`; new explicit-time
  pricing helpers, `offer_transition`, `offer_lifecycle_run`, guarded
  `realtime_event.public_scope`, triggers and indexes.
- A dedicated Spring offer lifecycle scheduler, `@Scheduled` fixed delay 1000 ms,
  initial delay 1000 ms, batch at most 1000. Property
  `pliego.offers.scheduler-enabled` / environment `PLIEGO_OFFERS_SCHEDULER_ENABLED`
  defaults enabled. It observes starts/ends and queues hints, without rewriting
  offers or creating successor discounts. Pricing expiry does not depend on it.
- Public `GET /api/v1/catalog/offer-refresh`, `Cache-Control: no-store`; authenticated
  SSE adds allowlisted `catalog.offers.changed` to both roles. See the
  [API amendment](../api-amendments/2026-11-04-offer-expiration-and-refresh.md).
- Frontend catalog page size 24, offer-card cleanup, phone navigation sheet fix,
  and `OfferRefreshSync` at startup, transitions and a maximum 60-second
  revalidation interval. An absent endpoint causes recurring 404 console/network
  errors despite 60-second retry. **Activate and verify the restricted backend,
  including the public refresh endpoint, BEFORE publishing the frontend.**
- Spring Boot Actuator is packaged with `management.server.port: -1`:
  HTTP management is disabled, with no extra port. There are no HTTP health or
  metrics endpoints to use for release readiness. A future observability binding
  discussed in ADR 0058 is not delivered by merely packaging Actuator.

The application changes are committed at code head
`9c5afd73c328bf6ae9d3b0b17b9f699b0651d286`, qualified by CI 41901244197 above.
This preparation leaves the record and tooling fix uncommitted for Claude.
Build/freeze artifacts from the reviewed branch head selected for deployment,
including these changes, and require that exact commit's own green CI.

| Item | Preparation evidence / final requirement |
|---|---|
| V106 resource SHA-256 | `c5c1d6d89147bdc00b75b8e244206c9eaf672e45934fad6a3140e9f192d2bca6` |
| V106 Flyway checksum | `-1466890365`; recompute from the final JAR and require installed history to match |
| Historical resources | Local old/new JAR comparison: V001–V105 byte-identical; all 19 migration resources in approved `pliego-flyway-v1.0.zip` byte-identical |
| Final artifacts | JAR SHA-256, dist file/tree/index/entry hashes, archive SHA-256, build ID and helper/input hashes: **pending final build** |
| CI qualification | Code head `9c5afd73c328bf6ae9d3b0b17b9f699b0651d286`: green PLIEGO CI 41901244197, all three jobs successful. The superseding record/tooling commit needs its own green run, including PostgreSQL upgrade/HTTP/concurrency/browser gates; Claude reports SHA/run |

Local comparison files are `release-prep/migrations-local.json` and
`approved-zip-comparison.json`. These compare locally built JARs, not the installed
production JAR; repeat section 6's comparison against the actual installed artifact.

## Ordered operator procedure — future, not executed

All remote steps require a separately authorized release operation. Use only the
runbook's personal connection
`ssh -F /home/andres18123/.ssh/config pliego-vps` and one persistent privileged
operator shell. Commands here are instructions, not observed production results.

1. **Pin and qualify locally (runbook section 4).** Select the reviewed branch head
   at deployment time, record its full SHA and its own complete successful PLIEGO
   CI run, review the final diff and rerun relevant tests on that source. Claude
   reports the superseding record/tooling commit and its green run. Build Java 25
   JAR and frontend dist locally from the same immutable source; set `VITE_API_BASE_URL=https://api.pliegolibros.com` and a unique safe
   `PLIEGO_BUILD_ID` matching release `R`. Freeze them, all seven reviewed helpers
   and non-secret manifests. Hash every artifact/input/helper with SHA-256; verify
   archive hygiene, PNG brand assets and retained hashed chunks. Do not rebuild a
   running JAR or packaged dist. No index/HEAD mutation is part of this record.

2. **Lock and preflight (sections 3/5).** In the authorized persistent privileged
   shell, hold `exec 9>/run/lock/pliego-deploy.lock; flock -n 9` throughout backup,
   activation, cleanup and verification. Stop if locked. Set validated IDs:
   `R=<UTC_timestamp>-<short_release_SHA>`, `PB=<observed_previous_backend_ID>` and
   `PF=<observed_previous_frontend_ID>`, independently. Capture pointers, complete
   Flyway history, installed JAR/index/tree/config/helper hashes, role/ownership
   state, public catalog count, resources, ports and queues. Require the exact
   successful V001–V105 history, not just max(version)=105; V106 is the **single**
   pending migration. If already 106 or otherwise different, stop and reassess.
   Capture offer instants and table sizes/locks as below. Record any
   `PLIEGO_OFFERS_SCHEDULER_ENABLED` override and management override without
   dumping secrets; disabled scheduler or management exposure blocks acceptance.

3. **Prepare private recovery and stage frozen bytes (section 6).** Record both
   previous pointers before changing anything. Preserve previous releases, R2/mail
   settings and environment in place. Create a root-only, create-exclusive
   `/opt/pliego/deployment/$R`, `D`; `W=$D/staging` and `S=$W/scripts`.
   Transfer only frozen JAR/dist archive, seven helpers and non-secret input/SQL
   manifests through the personal connection into unique deploy-owned 0700
   staging; install copied files root:root 0600 in private 0700 directories.
   Verify copied bytes against the independently retained local SHA-256 set
   **before executing any helper as root**. No source tree, credentials or local
   environment files go to the VPS.
   Capture role/owner/grant metadata without password hashes; back up relevant
   unit/Nginx files privately and create the **pre-migration** PostgreSQL custom
   backup as in section 6: privileged shell opens a create-exclusive 0600 file,
   `pg_dump` runs as postgres, exit status checked, archive listed via
   `pg_restore --list` on stdin. Listing does not prove restore. Do not copy the
   environment file into public or ordinary release artifacts.

4. **Verify/install both candidate and recovery trees (section 6).** Compare all
   already-applied migrations in the installed previous backend JAR against the
   candidate; also compare approved ZIP resources. The helper is Python-based
   because the VPS has no unzip:

   ~~~bash
   python3 "$S/compare_migrations.py" \
     "/opt/pliego/releases/$PB/pliego-backend-0.1.0-SNAPSHOT.jar" \
     "$W/pliego-backend-0.1.0-SNAPSHOT.jar" \
     --previous-max 105 --candidate-max 106 > "$D/migrations.json"
   ~~~

   Require exactly V106 pending and no historical byte discrepancy. Install the
   new backend in a create-exclusive directory root:pliego 0750, JAR 0640; verify
   pliego can traverse/read it. Validate the whole frontend archive before creation,
   then prepare candidate and **separate** recovery frontend against PF, retaining
   missing hashed chunks in both directions without changing previous trees:

   ~~~bash
   python3 "$S/prepare_frontend.py" "$W/frontend-dist.tar" \
     "/var/www/pliego/releases/$PF" "/var/www/pliego/releases/$R" \
     "/var/www/pliego/releases/$PF-rollback-web-for-$R" \
     --release "$R" --previous-release "$PF" > "$D/frontend-prepare.json"
   ~~~

   Require root:root 0755/0644, both brand PNGs, previous index byte identity in
   recovery, candidate index identity, and exact tree manifests. Use the reviewed
   split-pointer-capable manifest tool to bind source/CI, independent PB/PF,
   previous/candidate/recovery hashes, compatibility evidence, full history,
   preflight count, configuration and helpers into private create-exclusive
   `release.json`. Use runbook section 6's explicit `previousBackendReleaseId`,
   `previousFrontendReleaseId`, `previousBackendSourceSha` and
   `previousFrontendSourceSha`; compatibility evidence's `previousSourceSha`
   identifies PB. Run the genuine read-only
   `rollback.py --release "$R" --dry-run` before activation; require all checks.
   Preserve its output. Do not disable checks to create a manifest.

5. **Final drift gate.** Under the same lock, immediately compare both pointers,
   full history/checksums, artifact/tree/config/helper hashes and restrictions
   against preflight and manifest. Resolve any change before stopping production.
   Verify backup, reviewed compatibility, recovery targets and sudo access.
   Confirm section 7 cleanup/postflight SQL copied exactly from the final runbook,
   hash-verified and privately installed. Preparation extracted exact copies as
   `release-prep/acl-cleanup.sql` and `acl-postflight.sql`; their authority remains
   the canonical section 7 blocks, not an old ignored script.

6. **BACKEND FIRST: single V106 via temporary inherited ownership (section 7).**
   This is a bounded maintenance window, with two drains/restarts, not zero downtime.

   ~~~bash
   python3 "$S/service_state.py" drain pliego --timeout 45
   systemctl show pliego --property=ActiveState,Result,MainPID
   ~~~

   Require failed OR inactive and MainPID=0, using named properties. Confirm pool
   drainage; do not parse combined `--value` ordering. As the administrative DB
   operator, after checking owner is NOLOGIN/non-elevated and app has no unrelated
   shared ownership:

   ~~~sql
   GRANT pliego_owner TO pliego_app;
   SELECT pg_has_role('pliego_app','pliego_owner','USAGE'); -- t
   ~~~

   Never SET ROLE on pooled connections or change runtime role attributes/password.
   Use section 6's reviewed `atomic_link`:

   ~~~bash
   atomic_link /opt/pliego/current "/opt/pliego/releases/$R"
   python3 "$S/service_state.py" start pliego
   python3 "$S/poll_catalog.py" --manifest "$D/release.json"
   ~~~

   Normal backend startup runs Flyway. Inspect bounded startup/journal and the
   **complete** planned history, including successful V106 and its checksum.
   Use the runbook's 90-second monotonic startup budget unless a measured,
   reviewed exception exists; accept catalog totalCount as integer or decimal
   string. No manual migration SQL and no concurrent second backend.

7. **Stop/drain, reassign/grant/revoke, restricted restart (section 7).**
   Never publish the frontend while membership remains:

   ~~~bash
   python3 "$S/service_state.py" drain pliego --timeout 45
   runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d pliego -f - \
     < "$W/acl-cleanup.sql"
   ~~~

   Run **the exact canonical PLIEGO_RUNTIME_ACL_CLEANUP_SQL transaction**:
   REASSIGN OWNED app→owner, explicit table/sequence/routine/Flyway grants and
   owner defaults, the final geo read-only and column-ACL resets, no CREATE,
   REVOKE owner membership, COMMIT. The new INVOKER routines/triggers require
   these grants; EXECUTE alone is insufficient. Passing a file on stdin lets
   postgres read it without traversing D's root-only directory.
   Require section 5's `f|f|f|f` and zero app-owned objects before start.

   ~~~bash
   python3 "$S/service_state.py" start pliego
   python3 "$S/poll_catalog.py" --manifest "$D/release.json"
   runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d pliego -f - \
     < "$W/acl-postflight.sql"
   ~~~

   All canonical postflight values must be `t`; recapture full successful V106
   history, role/ownership state, journal, scheduler status and public endpoint.
   This fresh restricted pool is the accepted backend. Also complete the
   Actuator, listening-port and SSE checks below **before** publishing frontend.

8. **Frontend only after backend acceptance (section 8).** Recheck pointer/index
   drift, then `atomic_link /var/www/pliego/current "/var/www/pliego/releases/$R"`.
   **No Nginx edit or reload.** The existing root follows this symlink.
   Section 8b's exact SSE location remains separate pending hardening; the
   measured existing location is sufficient. Preserve TLS/AOP, forwarding,
   Cloudflare, unit, secrets, loopback binding, R2 and mail.
   Verify public index/entry/version identities and caches, brand PNG content
   types, SPA reload, www redirect, mobile/desktop catalog/phone sheet and absence
   of recurring offer-refresh 404s. Retain old hashed chunks for open tabs.

9. **Postflight and handoff (sections 9–11).** Repeat all acceptance gates and the
   qualified rollback helper's `--dry-run` to a distinct private postdeploy file.
   Observe scheduler/SSE/other worker queues and resources over time, including
   real offer end instants. Record actual times, versions/hashes/pointers,
   restrictions, backup paths, checks performed/skipped and rollback qualification.
   Remove only this release's transfer staging after acceptance; keep immutable
   releases, recovery tree, manifests/logs and backup. Do not mark this preparation
   as deployed until those operator results exist.

## Read-only SQL preflight and postflight

Execute later as the administrative operator, with `psql -X -v ON_ERROR_STOP=1
-d pliego -f -` on stdin in the locked session. Each inspection uses
`BEGIN READ ONLY`, `statement_timeout='15s'` and `lock_timeout='1s'`, then ROLLBACK.
A timeout is an inconclusive check; record and investigate it.

Before activation:

~~~sql
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='1s';
SHOW server_version;
SELECT installed_rank,version,checksum,success,type,script
  FROM public.flyway_schema_history ORDER BY installed_rank;
SELECT count(*) FILTER (WHERE success) AS successful,
       count(*) FILTER (WHERE NOT success) AS failed,
       max(version::integer) AS max_version
  FROM public.flyway_schema_history;
SELECT c.relname,c.reltuples::bigint AS estimated_rows,
       pg_total_relation_size(c.oid) AS total_bytes
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='pliego'
   AND c.relname IN ('pedido','realtime_event','edicion_oferta');
SELECT state,count(*) FROM pg_stat_activity
 WHERE datname=current_database() GROUP BY state;
SELECT mode,granted,count(*) FROM pg_locks
 WHERE relation IN ('pliego.pedido'::regclass,'pliego.realtime_event'::regclass,
                    'pliego.edicion_oferta'::regclass)
 GROUP BY mode,granted;
SELECT count(*) AS prepared_transactions FROM pg_prepared_xacts;
SELECT to_regclass('pliego.offer_transition') AS transition_table,
       to_regclass('pliego.offer_lifecycle_run') AS lifecycle_table;
SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,
       rolreplication,rolbypassrls
 FROM pg_roles WHERE rolname IN ('pliego_app','pliego_owner');
SELECT has_schema_privilege('pliego_app','pliego','CREATE'),
       has_schema_privilege('pliego_app','public','CREATE'),
       has_database_privilege('pliego_app',current_database(),'CREATE'),
       pg_has_role('pliego_app','pliego_owner','MEMBER'); -- f|f|f|f
SELECT count(*) AS app_owned_objects FROM pg_shdepend
 WHERE refclassid='pg_authid'::regclass
   AND refobjid=(SELECT oid FROM pg_roles WHERE rolname='pliego_app')
   AND deptype='o'
   AND dbid IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()));
ROLLBACK;
~~~

Also inspect naming conflicts for every new V106 relation/routine/index/trigger,
complete owner distributions and queue aggregates using runbook sections 2/5.
Compare old routine identities with the final candidate manifest. No call to
`fn_offer_lifecycle_advance` or fixture privilege gates belongs in production checks.

After restricted restart, repeat full history (106 successes, zero failures, exact
historical checksums plus V106), restrictions/ownership and the **entire canonical
section 7 postflight**, not only the four booleans. Then:

~~~sql
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='1s';
SELECT p.oid::regprocedure AS routine,p.prokind,
       pg_get_function_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result,
       md5(pg_get_functiondef(p.oid)) AS definition_md5,
       has_function_privilege('pliego_app',p.oid,'EXECUTE') AS app_execute
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='pliego' AND p.proname IN (
   'fn_edition_offer','fn_edition_offer_at','fn_edition_price_at',
   'sp_checkout_execute','sp_checkout_quoted','fn_capture_order_item_offer_snapshot',
   'fn_guard_order_pricing_instant','fn_offer_hint','fn_offer_transition_changed',
   'fn_offer_lifecycle_advance','fn_offer_lifecycle_failure',
   'fn_offer_lifecycle_status','fn_offer_refresh_clock','fn_realtime_read')
 ORDER BY p.proname,pg_get_function_identity_arguments(p.oid);
SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE t.tgname IN ('trg_pedido_pricing_instant_immutable',
                    'trg_offer_transition_changed');
SELECT conname,convalidated,pg_get_constraintdef(oid)
 FROM pg_constraint
 WHERE conrelid IN ('pliego.pedido'::regclass,'pliego.realtime_event'::regclass)
   AND conname IN ('ck_pedido_pricing_instant_finite','ck_realtime_event_scope');
SELECT column_name,is_nullable,column_default FROM information_schema.columns
 WHERE table_schema='pliego'
   AND (table_name='pedido' AND column_name='pricing_evaluated_at'
     OR table_name='realtime_event' AND column_name='public_scope');
SELECT relation,privilege,
       has_table_privilege('pliego_app',relation,privilege) AS granted
 FROM (VALUES ('pliego.offer_transition'),('pliego.offer_lifecycle_run')) r(relation)
 CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE')) a(privilege)
 ORDER BY relation,privilege;
SELECT pliego.fn_offer_lifecycle_status();
SELECT pliego.fn_offer_refresh_clock();
SELECT count(*) AS unpublished,
       min(created_at) AS oldest_unpublished
 FROM pliego.realtime_event WHERE event_id IS NULL;
ROLLBACK;
~~~

Compare definitions/hashes/signatures, constraints, defaults and trigger definitions
with expectations extracted from a PG18 database migrated by the **final pinned
JAR**. Hash presence alone is not a semantic proof. Verify each required DML grant
individually too: PostgreSQL's comma-list privilege check means **any**, not all.
Read status twice at least several seconds apart after startup grace; require
successCount advancing and recent lastSuccessAt, no growing failures, and due
pending/lag draining. Operational thresholds from ADR 0058: after 30-second grace,
no success, success age >60 s or due lag >60 s is unhealthy; those are monitoring
bounds, not hard scheduler/SSE delivery guarantees. Last failure timestamp/code
may be historical: compare deltas. A disabled scheduler is not accepted for this
candidate even though future health bindings may represent disabled differently.

## HTTP, SSE and Actuator acceptance — future checks

Use an explicit User-Agent on **every public request**: Cloudflare has blocked
default Python/curl clients. Capture response status/headers/body privately;
never use cookie-bearing verbose traces or echo authentication material.

~~~bash
curl --silent --show-error --max-time 10 --max-filesize 65536 \
  --user-agent 'Mozilla/5.0 PLIEGO-Release-Verification/1.0' \
  --dump-header "$D/offer-refresh.headers" --output "$D/offer-refresh.json" \
  --write-out '%{http_code}\n' \
  'https://api.pliegolibros.com/api/v1/catalog/offer-refresh'
~~~

Require 200 JSON, `Cache-Control: no-store`, and exactly `serverTime`,
`nextTransitionAt` (offset instant or explicit null), `revalidateAfterSeconds:60`.
Compare with DB observation and strictly future ACTIVE-offer boundary; no prices
or private fields. Test anonymous access with no cookie. Backend loopback catalog
and public catalog still return authoritative data. A Cloudflare HTML/403/1010
page proves neither endpoint health nor Actuator rejection.

SSE: use an **existing authorized session**, private 0600 curl config containing
its cookie, as described in runbook section 8b:

~~~bash
curl --config "$PLIEGO_SSE_PRIVATE_CURL_CONFIG" \
  --user-agent 'Mozilla/5.0 PLIEGO-SSE-Verification/1.0' \
  --no-buffer --http1.1 --max-time 70 \
  --dump-header "$D/sse.headers" --output "$D/sse.body" \
  --header 'Origin: https://pliegolibros.com' \
  --header 'Accept: text/event-stream' --header 'Accept-Encoding: gzip' \
  'https://api.pliegolibros.com/api/v1/auth/events'
~~~

Require prompt retry 3000/heartbeat, content type text/event-stream, no compression,
no-cache, exact origin/credentials, healthy heartbeat gaps near 16 s below the
preserved 30 s upstream timeout, normal close near 60 s and 3 s
reconnect. Resume with a captured decimal Last-Event-ID; distinguish replay/resync.
The loopback backend must send X-Accel-Buffering:no; Nginx normally consumes/hides
that header, so it need not appear through Cloudflare. Verify prompt unbuffered
bytes on the public path; do not change Nginx just to expose the header.
Anonymous GET must be 401; preserve CORS and existing stream limits. Test natural
offer-end `catalog.offers.changed` hints and refetch in an already-open real
browser; no manual offer edit or synthetic event to manufacture this result.
No natural transition during the window means live hint delivery remains pending,
not failed or proven. Controlled 429/lease/revocation/write probes require their
own scope; existing local/CI evidence covers them. SSE admission/leases themselves
write operational state, although this check creates no business order/mail/invoice.

For Actuator, check **each** route anonymously and with an existing authenticated
CUSTOMER and ADMIN session when available; private curl configs hold cookies or
Authorization, never command-line token values. Retain distinct role outputs and
bound response size: a 200 or oversized body is a failed gate. Do not print or
download an unexpected management payload beyond that bound.

~~~bash
for route in actuator actuator/health actuator/env actuator/heapdump actuator/metrics
do
  name=$(printf '%s' "$route" | tr '/' '-')
  curl --silent --show-error --max-time 10 --max-filesize 65536 \
    --user-agent 'Mozilla/5.0 PLIEGO-Release-Verification/1.0' \
    --dump-header "$D/$name.anonymous.headers" \
    --output "$D/$name.anonymous.json" --write-out '%{http_code}\n' \
    "https://api.pliegolibros.com/$route" > "$D/$name.anonymous.status"
  for role in customer admin
  do
    case "$role" in
      customer) auth_config="$PLIEGO_CUSTOMER_PRIVATE_CURL_CONFIG" ;;
      admin) auth_config="$PLIEGO_ADMIN_PRIVATE_CURL_CONFIG" ;;
    esac
    curl --config "$auth_config" \
      --silent --show-error --max-time 10 --max-filesize 65536 \
      --user-agent 'Mozilla/5.0 PLIEGO-Release-Verification/1.0' \
      --dump-header "$D/$name.$role.headers" \
      --output "$D/$name.$role.json" --write-out '%{http_code}\n' \
      "https://api.pliegolibros.com/$route" > "$D/$name.$role.status"
  done
done
~~~

Require only the **backend's** application/problem+json Spanish responses:
anonymous 401 (`AUTH_REQUIRED`), authenticated 404. Confirm status/title/detail/code
and absence of stack/SQL/management payload, not just HTTP status. **Never 200,
Actuator JSON, health/metrics/env/heapdump data or a management response**.
An expired session's 401 does not prove authenticated 404; verify session validity
without printing it, and report untested roles if unavailable. Also check loopback
to distinguish origin behavior from edge rejection; no new port is permitted.

Capture before and after in the privileged operator shell:

~~~bash
ss -ltnp > "$D/listeners-before.txt"
# Repeat after restricted restart to a distinct file:
ss -ltnp > "$D/listeners-after.txt"
systemctl show pliego --property=ActiveState,SubState,NRestarts,MainPID,MemoryCurrent
~~~

Compare address/port sets, disregarding expected PID changes: backend only
127.0.0.1:8080, PostgreSQL only loopback:5432, **no new management listener**.
Check the packaged YAML remains -1 and only allowlisted effective override values/
presence, never dump Environment or /proc environ. Inspect
`MANAGEMENT_SERVER_PORT`, exposure/base-path overrides and command-line/property
sources privately; stop if they enable management or make the response evidence
ambiguous. No Nginx reload or new exposure is needed.

## Checkout and real offer-end verification without production purchases

Production verification for this release creates **no real orders, payment
attempts, emails, invoices, accounts, offers, price changes or stock changes**.
Do not run local/CI fixture gates against production, even if they ROLLBACK.
Do not POST checkout “just to see P4005”: HTTP commands commit through Spring;
a failed-looking request may have effects or a successful response may queue mail.

Read-only evidence proves installed contracts/configuration and current pricing
projections, not successful checkout execution. Capture exact routine definitions/
hashes, complete successful Flyway 106, healthy lifecycle status, public clock
200/no-store and current catalog/offers/detail projections. The real **2026-11-05,
2026-11-07 and 2026-11-09** end groups must be observed at their **stored fin
instants**, with explicit offsets; do not assume midnight or extend dates.
No authoritative production campaign receipt with exact times was established
from the inspected local preparation artifacts. The November campaign candidate
has durations, and `local-applied.json` is a synthetic local fixture, not live data.
A non-authoritative hint only: the storefront showed an offer card reading "Termina el
9 de noviembre, 17:21" on 2026-11-04, consistent with offers applied at 17:21:55
-05:00 on 2026-11-02, so the first group most likely ends **2026-11-05 near 17:21
-05:00**. Plan the activation window around it, but the operator must still obtain
the exact instants read-only:

~~~sql
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='1s';
SELECT fin AT TIME ZONE 'UTC' AS end_utc,
       fin AT TIME ZONE 'America/Guayaquil' AS end_guayaquil,
       count(*) AS offers
 FROM pliego.edicion_oferta WHERE estado='ACTIVE'
 GROUP BY fin ORDER BY fin;
SELECT o.oferta_id,o.edicion_id,o.inicio,o.fin,e.precio AS base_price,
       current_offer.price,current_offer.offer_id
 FROM pliego.edicion_oferta o JOIN pliego.edicion e USING(edicion_id)
 CROSS JOIN LATERAL pliego.fn_edition_offer(e.edicion_id) current_offer
 WHERE o.estado='ACTIVE'
 ORDER BY o.fin,o.edicion_id;
ROLLBACK;
~~~

Record which date convention the three groups use, UTC or Guayaquil. Preserve
`inicio`/`fin` exactly. Immediately before/after each stored end, observe public
catalog/detail/cart projections only for already-authorized existing data, clock
metadata and lifecycle/SSE counters. At and after fin the half-open interval
excludes that offer and returns base pricing; a later public response establishes
“expired by observation time”, not exact microsecond execution. Use explicit-time
SQL helpers for boundary analysis without changing clocks/rows, and local tests
for precise equality. If activation occurs after a deadline, verify catch-up and
current price; do not recreate the missed historical public observation.

A **proposed-only** later production write smoke would require explicit owner
scope: a controlled identity and recipient, exact cart/edition/quantity and
payment outcome, allowed mail/invoice/payment/stock effects, window, idempotency
key and recovery/cleanup through approved application routines. Cancellation can
retain order/payment/invoice/audit history and cannot recall sent mail; raw DELETE
or promising complete erasure is not cleanup. Without that scope, leave checkout
execution untested in production. Prefer the disposable local/CI evidence below.

## Local evidence and rollback qualification

Raw preparation evidence is private and git-ignored under
`/home/andres18123/PLIEGO/.release-evidence/2026-11-04/release-prep/`.
It is not an artifact to publish or a replacement for final-SHA CI.

- Initial helper verification passed 35 tests and reproduced the split-pointer
  refusal. After the tooling fix, the complete offline suite passed **53 tests**
  (35 existing + 18 new); evidence is under `release-prep/tooling/`.
- Fresh old/current JAR builds and six Actuator exposure tests passed from isolated
  copies; current JAR migrated a fresh disposable PostgreSQL 18 database on port
  55443 to V106 (this fresh run is not a populated forward-upgrade rehearsal).
  The old ec48e07 JAR then passed restricted-runtime HTTP/SSE checks listed below.
- Pre-existing V106 evidence was read and copied with hashes to
  `prior-v106-evidence/`; it was **not rerun by this preparation**.
  `green-checkout.log` records **15 passing cases**: physical/digital/mixed,
  expiry before call and across edition/inventory waits, P4005 with atomic
  rollback, one pricing instant, post-decision expiry, immutable/idempotent replay,
  PENDING and REJECTED outcomes. Upgrade summary records populated 105→106,
  preservation of 68 existing tables, two paid orders/three discounted items/four
  offers, NULL legacy timestamps, billed/idempotent replay and concurrent admin
  write captured by trigger installation.
- That prior suite reports Maven 748 discovered / 709 passed / 39 skipped,
  phased PostgreSQL gates (the initial full runner failed on missing query-plan
  bindings before correction), and later corrected stages. These historical
  results do not mean a new complete final-SHA run passed. Review
  [the requirement matrix](../testing/2026-11-04-offer-expiration.md), logs and the
  actual CI workflow; the selected deployment head's own green CI remains mandatory.

### ec48e07 on a V106 database

**Availability-only emergency rollback**, subject to the local results and
operator's artifact/ACL revalidation; never reverse Flyway. The SQL compatibility
surface and observed runtime smoke are detailed in
`release-prep/rollback/analysis.md`. Full feature compatibility is unavailable:
ec48e07 has no offer lifecycle scheduler or public offer-refresh route.
Restoring it cannot deliver this candidate's
automatic refresh contract. Pair it with the independently recorded previous
frontend (normally 33b4ef5, with both asset generations retained). Already-open
candidate tabs may need a user reload and otherwise retry the absent clock every
60 s with console errors.

Its Flyway validated the 106-entry history, warned that V106 is newer than the
old JAR's latest available V105, and applied no migration. That observed startup
does not qualify an incomplete or altered history. All fourteen new/replaced
routine identities/results and definition MD5s are captured in
`rollback/database-compatibility-metadata-final.json`; old declarations are in
`rollback/replaced-routine-old-definitions.json`.

| V106 surface | Compatibility basis to verify |
|---|---|
| Replaced routine interfaces | Existing argument modes/types/results retained for fn_edition_offer, both checkout procedures, snapshot trigger and fn_realtime_read; old JDBC callers keep their contracts |
| Checkout behavior | Old Java invokes V106 SQL: post-lock price instant/P4005 protection remains database-owned; output shape and approved SQLSTATE mapping stable |
| pedido column/trigger | Nullable new column, no backfill/default for legacy orders; old updates preserve it, so immutability trigger only rejects changing the pricing instant |
| Offer writes | AFTER INSERT/UPDATE trigger writes transition queue and a public hint; old admin API needs new table/helper grants. Clear is an update, not deletion; queue FK is ON DELETE RESTRICT |
| realtime_event scope | New NOT NULL default false preserves old private/admin inserts and valid scope; public rows are tightly allowlisted |
| Realtime read/publisher | JSON shape/cursor/session/private isolation retained; the old scheduled publisher and Java reader delivered public catalog and private hints to both CUSTOMER and ADMIN in the local HTTP/SSE smoke |
| Runtime grants | SECURITY INVOKER requires new tables/functions plus existing realtime sequence/table access after reassignment; section 7 exact cleanup, geo revokes, no ownership/CREATE and fresh pools remain mandatory |

Observed locally with the exact old JAR on V106 after canonical ACL cleanup:

| Exercise | Result |
|---|---|
| Catalog/cart/quote | HTTP 200; discounted total 5.00 and quote present |
| Quoted billed checkout and replay | HTTP 201 / 201; total 5.00; stored pricing instant; detail 200 |
| Order cancellation/update | HTTP 200; pricing instant preserved |
| Expired offer and accepted stale quote | Fresh catalog base price 7.25; HTTP 409/P4005; no new order items committed |
| Old admin offer PUT | HTTP 204; transition queue row created through new trigger |
| Old realtime publisher/reader | Both roles received public catalog and private hints, without manual publication |
| Runtime restrictions | CREATE/membership f/f/f/f, zero app ownership, full canonical postflight passed |
| New-feature deficit | offer-refresh 404; during five seconds without the new worker, success count stayed fixed and a due transition remained pending despite correct fresh expired pricing |

See `rollback/smoke-results.json`, routine/trigger/default metadata and logs in
the evidence root. These tests used disposable identities/providers with mail/R2/
billing worker disabled; they do not qualify real mail delivery, R2 access,
invoice generation, future load or production identities. No application rollback
was performed in production.

## Migration risks and rollback procedure

V106 is one normal transactional migration. Adding nullable pricing_evaluated_at
does not backfill orders, and public_scope has a constant false default; that does
**not** make the whole migration metadata-only. Immediate CHECK validation scans
pedido/realtime_event under ALTER TABLE's ACCESS EXCLUSIVE locks; ordinary index
builds scan realtime_event and edicion_oferta, and trigger installation takes
SHARE ROW EXCLUSIVE locks. Locks last through this migration transaction's commit,
including the subsequent O(number of offers) queue seed. Existing ACTIVE rows seed
their inicio, including past dates; first worker runs catch up in bounded batches.
No deployment-duration claim is supported for current production cardinalities.

Stop/drain app writers first; preflight table sizes, long/idle transactions,
prepared transactions, external writers and conflicting locks. Budget maintenance,
WAL/disk and catch-up load from actual observations. A one-second worker adds
regular singleton updates even when no transitions are due; monitor CPU/pool/WAL,
pending lag and SSE publication lag. The scheduler does not guarantee wall-clock
delivery under suspension, contention or failed publication. Do not disable it or
grant permanent ownership to mask a failure.

Before changing pointers, recovery must be installed, hash-pinned, compatible and
dry-run qualified with independently correct previous backend/frontend IDs.
During failures:

1. Before temporary GRANT: retain previous pointers, verify **exact original
   V001–V105 history** and restrictions, reset-failed/start previous service.
   After GRANT with that exact unchanged history: stop/drain, revoke **only**
   temporary membership, verify no app ownership/CREATE, then restore previous
   availability. Do not leave an elevated pool running.
2. With complete successful V106: stop/drain, run the full canonical section 7
   cleanup, verify every privilege/ownership gate, then use the reviewed,
   split-pointer-capable rollback helper under held FD9. It must revalidate
   hashes/config/history before and after drain, atomically select the qualified
   ec48e07 backend and PF recovery frontend, reset-failed/start restricted runtime,
   poll catalog, and recheck unchanged history/restrictions. Its dry-run must pass
   before activation and after publication. Use the qualified version-3 manifest
   for split pointers; never fabricate a common previous ID.
3. Any failed/partial/unexpected history, nontransactional remnants, failed cleanup
   or unestablished compatibility: keep backend stopped and preserve evidence for
   reviewed recovery. “One pending migration” does not justify skipping inspection.
4. Frontend-only recovery while retaining healthy V106 backend uses only the
   qualified PF recovery symlink; no backend restart, grants or Nginx reload.
   Keep R2 and mail enabled for existing data. Never restore a dump, DROP/repair
   history or reverse Flyway as an application rollback. A data restore needs a
   separate explicit recovery decision.

## Handoff to Claude and pending outcome

Claude reports the commit containing this record and tooling fix, together with
its own successful PLIEGO CI run ID/URL and all three required jobs. That commit
supersedes the currently qualified code head `9c5afd73c328bf6ae9d3b0b17b9f699b0651d286`
(CI 41901244197). The release SHA remains the reviewed branch head selected at
deployment time, with its own green run. Build/test/freeze that source and capture
SHA, run, release/build IDs, JAR/dist/archive/index/entry/helper/input SHA-256
manifests, final V106 bytes/checksum and definition hashes in the deployment record.
Refresh rollback evidence if relevant bytes changed, then bind actual preflight
values and independently observed previous targets into the private manifest.
The split-pointer tooling fix is locally qualified by the 53-test evidence above;
its final committed bytes still need CI and copied-helper hash verification.

The future operator, under separate authorization, supplies live preflight,
backup paths/listing, exact stored offer deadlines, activation/drain/cleanup times,
full V106 history, all-t ACL postflight, public/SSE/Actuator/listener/browser/
worker/resource checks and postdeploy rollback dry-run. Until those exist,
**production activation and all live acceptance results remain pending**.
