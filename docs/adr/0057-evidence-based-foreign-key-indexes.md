# ADR-0057: Index foreign keys when current access paths justify the cost

Date: 2026-11-03. Status: implemented for local review; no production deployment.

PPA-08's claim of twelve unindexed foreign keys is correct for V100 if “indexed”
means a valid, ready, live B-tree with the FK columns as its leading key columns,
including partial indexes. The catalog has 72 FKs. Excluding partial indexes
increases the apparent absence count to twenty; six of the eight partial cases
already cover every relevant non-null FK equality. The other two require checking
their state predicates against real callers. `INCLUDE` columns, trailing keys,
invalid indexes and indexes being built do not establish prefix coverage.

V103 adds only two nonunique, unconditional B-trees:

* `digital_ownership(edicion_id)`: `fn_guard_owned_digital_format` must check all
  retained identities when an edition's format changes, including identities
  whose grants were revoked. The customer-first unique index cannot serve this
  edition-only lookup efficiently. The index also supports the edition FK's
  RESTRICT check. There is no ownership uniqueness or lifecycle change.
* `sesion_autenticacion(usuario_id)`: `fn_auth_session_revoke_all`, password-reset
  consumption and email invalidation update all families for a user, including
  previously revoked families. The existing active-only partial index cannot
  cover these predicates. The full index also covers the FK's CASCADE check.

On a synthetic PostgreSQL 18.6 fixture with 20,000 ownership identities and 40,000
session families, the first statement changed from a sequential scan to an index
only scan (0.656 → 0.039 ms, 128 → 5 shared blocks). The session update changed
from a sequential scan to bitmap index/heap scans (2.074 → 0.819 ms,
1,087 → 390 shared blocks). These are five-run local medians, not production
latency or capacity claims. The public revoke-all command and actual edition
format update were measured separately, as were real parent DELETE RI triggers.

The other eleven raw absences are deliberately deferred. Current help reads
constrain publication state; checkout retries use their actor/key primary key;
favorites use customer/edition; correction lists use state/due order; shipment
and order histories use their parent order/shipment; invoices and credit notes
use invoice/order keys; inventory history uses edition/time; pickup detail uses
order. Their hypothetical indexes improve child probes for hard deletes of
unreferenced parent rows, but do not improve the measured supported access paths.
Users, commercial documents and their actor identities are retained, and catalog
removal is a logical state change. No supported account/edition/location hard
delete or primary-key renumbering workflow was found. A future such workflow
must revisit these decisions. The full candidate-by-candidate assessment is in
the [audit report](../audit/ppa08-fk-indexes/README.md).

The pending-only `correo_outbox(usuario_id,tipo)` index covers current account
invalidation statements, which explicitly require `estado='PENDING'`. It cannot
cover a whole-history user FK check; adding a full outbox user index is deferred
for the same unsupported-hard-delete reason. Existing non-null partial FK
indexes are retained. V103 removes no index, constraint, trigger, routine or row.

The added indexes occupied 168 KiB and 320 KiB on the fixture, about 8.6 and 8.2
bytes per live row with its duplicate-key distribution. Measured 2,000-row
inserts added 3.4% and 9.6% execution time and approximately 29% and 11% WAL,
respectively. Both are estimates from this local fixture; key cardinality,
page splits, bloat, caching and hardware change the cost.

V103 uses ordinary `CREATE INDEX` inside Flyway's transaction, preserving atomic
rollback and avoiding invalid partially built indexes. The measured heaps were
1.0 MiB and 6.0 MiB; both index builds together took 18 ms locally. Ordinary
builds block writers while acquiring/holding the table lock. Production sizes,
traffic and acceptable lock time were not inspected, so these results do not
authorize an online production build. Release preparation must measure those
tables and follow the canonical deployment runbook. If the write pause is
unacceptable, use separately reviewed, forward concurrent migrations, each
with its own `executeInTransaction=false` sidecar and failed-index recovery;
`CREATE INDEX CONCURRENTLY` cannot run in Flyway's default transaction. Never
silently change an already applied migration.

Validation: a V100 disposable database made the new SQL gate fail; V103 made it
pass. Removing either selected index inside a rollback transaction makes the
same gate fail. Catalog coverage, 72 FK orphan checks, five-run statement and
parent-trigger EXPLAIN ANALYZE/BUFFERS/WAL summaries, hypothetical alternatives,
storage and insert costs are saved under
[`docs/audit/ppa08-fk-indexes/`](../audit/ppa08-fk-indexes/README.md).

References: PostgreSQL 18 [foreign key indexing](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-FK),
[multicolumn indexes](https://www.postgresql.org/docs/18/indexes-multicolumn.html),
[partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html), and
[transactional/concurrent index builds](https://www.postgresql.org/docs/18/sql-createindex.html).
