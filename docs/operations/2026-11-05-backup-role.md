# PostgreSQL backup identity — retained local evaluation

2026-11-05. Local-only backup role evaluation; extracted from the prior mixed role/cost
report so the backup-only commit excludes staging and performance work. No production,
provider-account/API access, real credentials or paid resources were used.

## G3 — dedicated PostgreSQL backup role

**Keep peer `postgres` as the kit default.** A dedicated role is technically viable
for the current migrated schema, but adoption remains an opt-in owner decision
after authentication and restore preparation. The evaluated role was `LOGIN
INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, with exactly
one membership: `pg_read_all_data`. No role/configuration change was installed.

`deploy/backup/tests/role-evaluation.py` reuses `local-restore.py`'s canonical
snapshot/logger helpers without rerunning the prior passing transport drills.
Three disposable loopback PostgreSQL18.6 clusters were initialized under the
gap evidence directory; the real V001–V106 migrations, runtime ownership/ACL
cleanup, catalog/customer seed and commerce/bytea-invoice seed were applied.
Both superuser and dedicated-role custom dumps and `--globals-only
--no-role-passwords` dumps restored successfully to fresh clusters: **71 tables,
5,367 rows, role attributes/memberships, table/database/schema/routine/default
ACLs and sequence values all matched**. Globals SQL matched after removing only
per-invocation psql safety nonces. All three servers stopped with exit0.

The migration scan and live catalog found zero RLS tables/policies, large
objects and nondefault tablespaces; `plpgsql` was the only extension. The role
could execute 290 business routines, all invoker routines, and could write zero
tables. A real UPDATE was denied. Added post-comparison probes showed dumps
fail for an RLS-enabled table and an ungranted large object, with the expected
error messages. PostgreSQL18 documents table/view/sequence reads and schema
usage for this predefined role, with no RLS bypass.
[Predefined roles](https://www.postgresql.org/docs/18/predefined-roles.html).

Two material limits were measured:

- **Sensitive catalog access remains:** `pg_read_all_data` can SELECT
  `pg_authid`, including password verifiers, on this PG18 build. The synthetic
  cluster contained no verifiers; evidence records capability/count only.
  `--no-role-passwords` excludes them from the archive, but does not restrict the
  login role's capabilities. Membership also reaches other databases to which
  the role can connect. A narrower custom grant model would require separate
  design and continuing migration coverage.
- **Bootstrap identity matters during restore:** a fresh target initialized as
  `restore_admin` failed to replay `GRANT pg_read_all_data TO pliego_backup ...
  GRANTED BY postgres`, because recreated `postgres` was not the bootstrap
  superuser and lacked ADMIN on the predefined role. The successful targets
  used bootstrap `postgres` and a separately retained restore copy that omitted
  only its duplicate `CREATE ROLE postgres;`. No other SQL or errors were skipped.
  Preserve and inspect the original globals file. PostgreSQL documents the
  duplicate bootstrap-role issue and `--no-role-passwords` catalog behavior.
  [pg_dumpall](https://www.postgresql.org/docs/18/app-pg-dumpall.html),
  [role grant rules](https://www.postgresql.org/docs/18/sql-grant.html).

Owner decisions before any opt-in: accept cluster-wide read/verifier visibility;
choose a separate operating-system account versus the existing `postgres` UID;
approve `pg_ident.conf` mapping and the specific preceding `pg_hba.conf` peer rule,
socket/state/keyring permissions and unit changes; then test the exact production
authentication path and a restore with the required bootstrap/grantor identity.
Setting only `PGUSER=pliego_backup` does not make the current peer path work.
Keeping OS `postgres` also retains that account's ability to authenticate as the
DB superuser, so it supplies limited process-compromise isolation.
[Peer authentication](https://www.postgresql.org/docs/18/auth-peer.html),
[username maps](https://www.postgresql.org/docs/18/auth-username-maps.html).
Review every future RLS, large-object, tablespace or privileged extension change
before claiming complete dumps; do not silently add BYPASSRLS or extra memberships.

Raw local evidence: `.release-evidence/2026-11-05-gaps/g3/drill-c/commands.jsonl`,
`database-comparison.json`, `object-and-role-inventory.json`, original archives,
restore copies and all source/target JSON snapshots. Launcher exit0 and shutdown
logs are retained. Failed attempts `drill-a` (bootstrap identity) and `drill-b`
(incorrect expectation that verifier catalogs were denied) remain visible.
Loopback trust proved dump permissions, not production peer authentication.
This role-only differential test makes no new R2 claim; the prior drill-f Moto
transport evidence remains separate.
