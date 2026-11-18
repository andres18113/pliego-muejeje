# PPA-08 / RQ-IDX01–04: foreign-key index review

Measured 2026-11-03 on a dedicated, disposable PostgreSQL **18.6** cluster,
loopback port 55538, database `pliego_fk_index`. No production/VPS access, Docker,
approved migration edits, row deletion or uniqueness changes form part of this
change. Decisions are recorded in [ADR-0057](../../adr/0057-evidence-based-foreign-key-indexes.md).

## Catalog result

The V100 database has **72 foreign keys; exactly 12 lack a valid leading-key
index**, confirming the reported count. A stricter unconditional-index count is
20. V103 leaves **11 raw absences / 18 unconditional absences**, adding the two
justified access paths below. An empty database was migrated through V001–V100
using the pinned Flyway dependencies and `scripts/LocalFlyway.java`; the same
database then applied V103. V101/V102 belong to the parallel feature tracks and
are intentionally absent from this isolated index experiment. The root
integration run verifies the complete migration sequence.

[`fk_index_catalog.sql`](../../../backend/src/test/postgres18/fk_index_catalog.sql)
enumerates every FK, columns in declared order, parent, ON DELETE/UPDATE actions,
and every valid, ready, live B-tree with the whole FK as its leading **key**
columns. Composite leading keys count; INCLUDE-only and trailing attributes do
not. Predicate text is kept so partial coverage is visible. All current prefix
indexes use B-tree. Full 72-row inventories and summarized plans are in
[before-v103.json](before-v103.json) and [after-v103.json](after-v103.json).
These files contain no row dump, secrets or production data.

Six existing partial prefixes use `FK_column IS NOT NULL`: category parent,
provider-event outbox, address geography, inventory movement order, pickup actor
and pickup-location geography. Equality to a non-null parent key implies these
predicates, so additional full indexes would duplicate the usable lookup.
The pending-only outbox index covers current invalidation statements but not
whole-history parent checks; a full index is deferred because user hard deletion
is not a supported workflow. The active-only session index is insufficient for
current revoke-all/reset/email commands and is supplemented by V103.

## Fixture and method

The fixture has 2,000 customers, four staff actors, 1,000 physical editions,
1,000 digital editions plus one unused edition, 20,000 orders/items/invoices,
20,000 checkout receipts/favorites/retained ownership identities/correction
requests/inventory movements/order-history rows, 10,000 shipments/histories and
10,000 pickup snapshots, 2,000 credit notes, 240 added help articles (249 total),
and 40,000 session families. Every customer has 20 sessions, two active and
eighteen revoked; actor histories are intentionally skewed toward four staff.
Retained digital identities have no grants, exercising the format guard's
requirement to consider history after revocation.

[`seed.sql`](seed.sql) is synthetic bulk performance setup, not an end-to-end
business journey or a seed migration. It temporarily suppresses trigger side
effects in a transaction, keeps CHECK/UNIQUE checks, and creates valid parent
keys first. The harness subsequently checks **all 72 FK relationships for orphan
rows**, with SIMPLE-match NULL semantics, before running any measurements.
Previously existing fixture business-history relationships are not a proof of
checkout correctness; the existing business gates cover those invariants.

Each measurement uses `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` five times
with the normal planner (`enable_seqscan` is unchanged). Results retain the SQL,
node types, chosen indexes, shared buffers, WAL and elapsed samples, rather than
full raw plan dumps. Tables are analyzed. Mutating statements, hypothetical
candidate index builds and real parent DELETE probes run in rollback
transactions. Five samples warm the cache; these are not cold-disk or throughput
benchmarks. `VACUUM FULL ANALYZE` on the two selected fixture tables between
phases removes dead tuples left by the rollback insert experiments; this
operation is confined to this disposable database and is not migration SQL.

For each of the twelve absences, the harness measures (1) a child-side FK miss
with `FOR KEY SHARE`, which exercises the worst-case full scan for an
unreferenced parent, (2) the current routine's relevant internal statement
predicate/join, and (3) both statements with a temporary hypothetical index.
These internal statements isolate the access path; they are not claimed to be
the complete public routine or its authorization/locking logic. Public
`fn_auth_session_revoke_all`, an actual edition format UPDATE, and parent DELETE
RI triggers are also executed separately.

## Decisions for every raw absence

Every listed FK uses ON UPDATE NO ACTION and immutable identity keys. DELETE
NO ACTION is the default unless RESTRICT is shown. The indexed parent-side
primary key is present in every case. “FK ms” is the five-run median child probe
before → after the real V103 migration, not a synthetic latency promise.

| Referencing table / column | DELETE | Current access path and decision | FK ms |
| --- | --- | --- | --- |
| `ayuda_articulo.categoria_id` | NO ACTION | `fn_help_search` constrains `estado='PUBLISHED'`; existing `(estado,categoria_id,posicion,slug)` covers that path. 249-row table. Defer category-only index: it buys only an unsupported hard-delete check. | 0.042 → 0.046 |
| `checkout_attempt.order_id` | NO ACTION | `sp_checkout_idempotent` reads `(actor_user_id,attempt_key)` PK. Order identities and receipts are retained. Defer reverse order lookup. | 0.888 → 0.713 |
| `cliente_favorito.edicion_id` | RESTRICT | `fn_customer_favorite_status` / add/remove use `(cliente_id,edicion_id)` PK; list uses customer/recent index. Edition deactivation does not delete the parent. Defer. | 0.604 → 0.520 |
| `cliente_identificacion_solicitud_correccion.decidido_por` | NO ACTION | Admin list filters state/due order; individual decisions lock request PK. Deciding staff is projected, not a filter. Staff is blocked rather than deleted. Defer actor index. | 1.458 → 1.422 |
| `digital_ownership.edicion_id` | RESTRICT | **Add:** `fn_guard_owned_digital_format` checks edition-only existence including revoked ownership history. Customer-first PK/unique cannot cover it. | **0.604 → 0.028** |
| `envio_historial.usuario_actor_id` | NO ACTION | `fn_order_post_purchase_internal_v043` reads shipment/time index; actor is projected. History/staff retained. Defer. | 0.474 → 0.439 |
| `factura.usuario_emisor_id` | NO ACTION | `fn_invoice_snapshot_data_internal_v088` reads invoice PK; post-purchase reads unique order key. Issuer is projected. Issued snapshots/staff retained. Defer. | 1.450 → 1.455 |
| `factura_item.pedido_item_id` | NO ACTION | Invoice snapshot first filters `factura_id`, using `(factura_id,pedido_item_id)`, then joins the order-item PK. Order items/documents retained. Defer reverse line index. | 0.451 → 0.485 |
| `movimiento_inventario.usuario_actor_id` | RESTRICT | `fn_inventory_movements` filters edition and orders by time; existing edition/time index covers it. Actor is audit output, not a filter. Defer. | 0.860 → 0.671 |
| `nota_credito.usuario_emisor_id` | NO ACTION | Post-purchase joins invoice/order and unique invoice FK; issuer projected. 2,000 retained credit notes. Defer. | 0.131 → 0.123 |
| `pedido_estado_historial.usuario_actor_id` | RESTRICT | Admin/customer detail uses order/time index. Actor is projected and identities are retained. Defer. | 0.727 → 0.651 |
| `pedido_retiro.ubicacion_retiro_id` | NO ACTION | `fn_admin_pickup_detail` / lookup read order PK or unique pickup code; scheduling uses readiness index. Location snapshots are retained and location is disabled logically. Defer. | 0.479 → 0.490 |

Temporary candidates reduce each large-table FK miss to a small index probe, as
expected. On supported statements, however, **only the ownership candidate
changes the selected access path**; the other eleven keep the same existing
indexes (small elapsed differences are cache/noise, not evidence for adding an
index). The JSON preserves their candidate plan summaries and storage estimates
so these rejections can be revisited if a new query or hard-delete workflow is
approved. There is no rule asserting that every FK must have a new full index.

## Selected read/command results

| Operation | Before ms | After ms | Shared blocks before → after | Plan/result |
| --- | ---: | ---: | ---: | --- |
| Format guard's ownership existence statement | 0.656 | 0.039 | 128 → 5 | Seq Scan → Index Only Scan, `ix_digital_ownership_edicion` |
| Whole-history session revoke statement | 2.074 | 0.819 | 1,087 → 390 | Seq Scan → Bitmap Heap/Index Scan, `ix_sesion_autenticacion_usuario` |
| Public `fn_auth_session_revoke_all` | 3.370 | 1.794 | 1,498 → 807 | Includes user/continuation locks and session update |
| Actual edition format update | 2.106 | 1.456 | 636 → 524 | Includes all current edition triggers |
| Actual DELETE of unused user, rolled back | 9.665 | 7.306 | See JSON trigger summaries | Runs all referencing RI triggers, including session CASCADE |
| Actual DELETE of unused edition, rolled back | 2.002 | 1.574 | See JSON trigger summaries | Runs all referencing RI triggers, including ownership RESTRICT |

The real DELETE checks are maintenance-scenario evidence, not a newly introduced
delete API. They still pay for deliberately unindexed relationships. No parent
primary key changes or cascade semantics are altered by V103.

## Storage, writes and migration strategy

| Selected index | Measured size | Bytes/live row | Added bytes / heap | 2,000 INSERT ms before → after | INSERT WAL bytes before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| ownership edition | 172,032 (168 KiB) | 8.60 | 16.4% of 1.0 MiB | 16.768 → 17.344 (+3.4%) | 471,563 → 607,796 (+28.9%) |
| session user | 327,680 (320 KiB) | 8.19 | 5.2% of 6.0 MiB | 28.960 → 31.734 (+9.6%) | 1,104,251 → 1,225,840 (+11.0%) |

Sizes come from temporary candidates built on the same analyzed live rows before
the rollback write batches. Each added index means one additional B-tree
maintenance operation per insert/delete and per changed FK key. An unchanged FK
key does not itself prevent HOT updates; existing indexes and available heap
space still determine whether an update can be HOT. The schema already has
other indexes that affect session revocation updates. No current index is
removed because access patterns differ.

At the same duplicate-key distribution, one million live rows would add roughly
8.2 MiB / 7.8 MiB, respectively. Budget **8–32 MiB per million rows per index**
before bloat as a rough cardinality-sensitive range, plus an operational margin
for page splits and dead tuples. This is a storage estimate, not measured future
growth. More distinct edition/customer values reduce B-tree deduplication and
increase bytes per row. Elapsed insert percentages include normal triggers/FK
checks and local noise; WAL and size make the write tradeoff explicit.

V103 is a normal, atomic Flyway migration with two ordinary `CREATE INDEX`
statements. On these small heaps the combined build took **18 ms**. It acquires
locks that block writers until transaction completion; the local duration is
not an upper bound for production. No production table sizes or workload were
read. Before release, the canonical runbook's authorized preflight must assess
size, active writers and acceptable pause. For materially larger/busy tables,
separately reviewed forward concurrent migrations need one concurrent statement
per migration, `executeInTransaction=false` sidecars and invalid-index recovery.
`CONCURRENTLY` cannot be inserted into V103's default transaction. No release,
concurrent index build, production lock or migration-history repair was run.

## Reproduce and gate mapping

Start a separate PostgreSQL 18 cluster using the binaries/layout from
`scripts/local-db.sh`, with a unique `/tmp` state directory, port and DB name
containing `fk_index`; leave the shared `.local-db` untouched. Use the existing
pinned migration classpath and `scripts/LocalFlyway.java` to migrate an empty
dedicated DB to V100. Set normal PG environment variables for loopback and
`PLIEGO_TEST_DISPOSABLE_DB=1`; then run:

```bash
python3 backend/src/test/postgres18/fk_index_audit.py --seed --benchmark --candidate-probes --output /tmp/pliego-fk-index-before.json
psql -X -v ON_ERROR_STOP=1 -f backend/src/test/postgres18/fk_index_gate.sql
# The gate above must fail at V100. Reclaim rollback-fixture bloat on these two
# disposable tables, apply V103 with Flyway, then record the after phase:
python3 backend/src/test/postgres18/fk_index_audit.py --benchmark --output /tmp/pliego-fk-index-after.json
psql -X -v ON_ERROR_STOP=1 -f backend/src/test/postgres18/fk_index_gate.sql
```

The seed/benchmark modes refuse absent disposable opt-in, non-loopback hosts and
DB names lacking the dedicated marker. Default catalog mode is read-only and
needs no seed. The SQL gate is read-only and is suitable for the common CI run;
it verifies both selected unconditional prefixes and fails for an unreviewed new
raw absence, while documenting the eleven accepted deferrals. The root agent
integrates it into the shared runner; this track does not modify that file.

| Requirement | Evidence / verification |
| --- | --- |
| RQ-IDX01 | `fk_index_catalog.sql`; before/after 72-FK JSON inventories; 12/20 → 11/18 counts |
| RQ-IDX02 | `fk_index_audit.py --seed --benchmark --candidate-probes`; all 72 FK orphan checks; 13 current-statement/FK scenarios; actual parent RI triggers; insert/WAL/size summaries |
| RQ-IDX03 | New V103 only; ADR-0057 selected/deferred decisions and transactional/concurrent rationale; `fk_index_gate.sql` red at V100, green at V103, each selected index removal detected in rollback probes |
| RQ-IDX04 | `before-v103.json`, `after-v103.json`, the timing/plan/cost tables here; logs `/tmp/pliego-fk-index-*.log` |

Limits: these are synthetic local, warm-cache measurements on one database,
not a production cardinality audit, capacity forecast, cold-cache test, business
journey or evidence of a production incident's cause. The full shared application
regression/migration/upgrade suite belongs to the root integration run.
