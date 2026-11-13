# Backup role evaluation and staging cost inputs

2026-11-05. Local-only evaluation and public pricing research. No production,
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

## G6 — HostRush identified; conditional cost ceiling

**Provider: HostRush.** The supervisor supplied the network attribution; a public
ARIN RDAP lookup independently confirms `HOSTRUSH02`, handle
`NET-65-75-201-0-1`, range `65.75.201.0/24`, registrant **HostRush**. Only the
registry endpoint was contacted, never the production address.
[ARIN network record](https://rdap.arin.net/registry/ip/65.75.201.152),
[ARIN RDAP documentation](https://www.arin.net/resources/registry/whois/rdap/).

The audit proves 2 vCPU, 4 GB class RAM (MemTotal 4,009,848 KiB), 40G disk,
KVM, Xeon Cascadelake and Ubuntu 24.04. Additional supervisor-supplied Red Hat
KVM DMI and `cloud-init nocloud` facts describe the guest, not the commercial
SKU. **Exact plan, region and account currency remain unknown.** HostRush's
public page advertises Dallas, but that does not locate this production VM.
CPU-equivalence qualification requires the same provider **and plan/CPU class**;
matching the vCPU/RAM count at another provider cannot supply that evidence.

Public prices actually retrieved on 2026-11-05 are below. HostRush lists monthly
prices, with no retrieved hourly/proration terms or exact 2-vCPU/4-GB KVM offer.
Its 1-core/4-GB listing is $6/month, 2-core/8-GB is $11/month (both marked out of
stock), and 4-core/12-GB is $24/month. These are reference listings, not the
production SKU or an approved replacement. Do not use the OpenVZ rows for KVM
parity. The page's dollar symbol does not establish this account's currency.
[HostRush public VPS listings](https://www.hostrush.com/vps/).

| Resource | Billing input | Planned 8h / contingency 12h | Equivalence |
| --- | --- | --- | --- |
| HostRush staging, production's 2-vCPU/4-GB plan | **Owner to supply plan/price**, currency, minimum term and fees | Quote pending; budget a full initial month if monthly with no verified proration | Same provider; exact plan/CPU class still to confirm |
| Separate HostRush k6 generator | Owner to supply selected plan/price and billing terms | Quote pending; separate full-month minimum may apply | Generator capacity must be observed |
| DigitalOcean Basic Regular 2-vCPU/4-GiB target | USD $0.03571/h equivalent; $24/month cap | $0.28568 / $0.42852 | **Non-equivalent alternative**, not production CPU evidence |
| Separate DigitalOcean generator, same size | USD $0.03571/h equivalent; $24/month cap | $0.28568 / $0.42852 | Non-equivalent alternative |
| Two DigitalOcean VMs, compute only | USD $0.07142/h; $48/month cap | **$0.57136 / $0.85704** | Cost illustration only |

DigitalOcean's public bundled prices and billing terms are independently
retrieved references. They use per-second billing with a 60-second/$0.01 minimum
and 672h monthly cap; powered-off VMs continue billing until destroyed. v5 prices
have no monthly cap and are excluded.
[Droplet prices](https://www.digitalocean.com/pricing/droplets),
[billing rules](https://docs.digitalocean.com/products/droplets/details/pricing/).

The estimated 8h window allocates 1h bootstrap/parity/seed, 3h normal-JIT matrix,
at least 2h soak, 1h export/teardown and 1h buffer. Budget both VMs for the full
window; 12h is the contingency deadline. These are planning allowances, not
measured durations. Monitor the independent generator's CPU/memory; its initial
2-vCPU size is not a proved load ceiling.

**Ceiling rule:** for verified hourly billing, projected cost is
`target_hours × target_rate + generator_hours × generator_rate + fees + tax + overage`,
respecting each provider's minimum/rounding. Propose a **USD $5 total session
ceiling** only for an hourly configuration whose 12h quote fits it, with a 12h
teardown deadline. For HostRush monthly billing, use
`target_first_term + generator_first_term + fees + tax + contingency` instead;
do **not** divide a monthly price by 720 or assume a refund/proration. For
example, two listed $24/month 4-core/12-GB nodes would incur at least $48 before
extras for an initial month and would not qualify the original production plan.
The $5 hourly ceiling therefore cannot authorize that monthly purchase.

G6 research is complete with conditional pricing inputs. Remaining owner
decisions are the exact HostRush plan/CPU class, region, account currency/tax,
current stock, full minimum term/setup/renewal/cancellation terms, target and
generator selection, and the resulting total ceiling. These remain enablement
decisions; no question or provisioning is needed to finish this local work.
Public RDAP JSON, HostRush/alternative HTML, web lookup output, fetch exit codes
and arithmetic remain in `.release-evidence/2026-11-05-gaps/g6/`.
