# Digital purchases and catalog search verification — 2026-10-24

## Result and scope

**PASS:** Maven **320/320 tests** (0 failures/errors/skipped); PostgreSQL gate runner **80/80 gates** (0 failed); duplicate-data upgrade **1/1**; seeded V077→V078 performance/limited-role migration **1/1**; frontend `npx tsc --noEmit` **passed**. All final verification processes exited 0.

No commit, deployment, developer database access, deletion or refund of user data. Only newly named disposable databases on **127.0.0.1:55476**, PostgreSQL **18.6**, were used. Neither :55432 nor the other review's `pliego_review_pp` / :18081 was used. Existing uncommitted V076/V077, Java/API/invoice work and frontend changes were preserved. No frontend source, CSS, frontend tests or design documentation was edited by this work; the API contract did not change.

The coordinator's description of development :8080 using old classes and its database remaining at V075 is supplied context, not independently inspected here. These results verify the packaged current backend and migrated disposable databases. They do **not** claim that the running development environment has acquired the new enforcement or that its existing duplicates have disappeared.

## Rules verified

`AGENTS.md`, `CLAUDE.md`, ADR-0042, V076, V077 and the latest catalog/search definitions and Java gateways were read before implementation. Controller → Application Service → JDBC Gateway and Spring transaction boundaries remain intact. No Java business SQL, JPA, Docker or extension was introduced.

The new `digital_mixed_single_copy_http_gate.py` performs four real HTTP → Spring → JDBC → PostgreSQL scenarios:

1. AUDIOBOOK X plus PAPERBACK, HOME_DELIVERY, CARD APPROVED: CONFIRMED order with both lines, address and shipment. Repeating add-to-cart returns **409 P6002**. Acceptance of the original pre-purchase cart ID/fingerprint with a new checkout key also returns P6002. Retrying the successful key returns the identical response and adds no payment, order, stock movement or receipt. Library list contains exactly one item for X; its detail contains exactly one ACTIVE source with the winning order ID.
2. A legacy stale active cart seeded with the original lines projects `available=false`, `unavailabilityReason=P6002`. Accepting its current quote returns **409 P6002**, with order count, payment count, inventory movement count, stock and checkout receipt count unchanged. A different EBOOK edition of the **same book/title** can still be purchased and has its own single ACTIVE source.
3. A PENDING TRANSFER mixed order blocks add-to-cart and subsequent CARD checkout with **409 P6003**. Exactly one order/payment remains and there is no SALE or stock decrement.
4. Additional pre-acquisition stale-cart coverage: create a pending mixed CARD order, seed the legacy active generation **before payment capture**, approve its payment through ADMIN HTTP, then read/accept the stale cart. Its item timestamps precede payment approval; the projection reports P6002 and acceptance returns 409 with no further commercial effects. A separate HTTP race of two approved mixed CARD checkouts yields one 201, one 409 P6002, one order/payment/receipt and one physical SALE.

Fixture SQL is limited to catalog/customer setup, persisted-state assertions and constructing legacy stale carts. V076's cart-add API deliberately cannot create such a conflicting active generation. Successful purchases, retries, quotes, conflicts, library reads and payment approval in this gate use real HTTP.

The quote contract is intentionally preserved: **GET /cart returns 200 with blocked lines and their reasons; checkout acceptance returns 409**. ADR-0042 explicitly requires this projection so stale lines can be inspected and removed. Changing quote reads into 409 responses would be a new API behavior, and was unnecessary for enforcement.

`digital_single_copy_concurrency.py` now adds a mixed AUDIOBOOK/PAPERBACK **CARD** race using the existing deterministic `compete` lock/wait helper and explicit expected cart ID. Together with its existing approved/pending races, all **3/3** preserve exactly one order/payment/receipt; the mixed winner consumes the physical unit once. Existing SQL/HTTP gates continue covering grant transitions, deferred capture, ownership precedence, revocation, cancellation, repurchase, authorization and rollback.

No single-copy database/backend defect was found; **V076 and V077 were not amended**.

## Existing duplicates

[find-duplicate-active-digital-purchases.sql](find-duplicate-active-digital-purchases.sql) runs in a REPEATABLE READ, READ ONLY transaction. For every customer/edition/owned-item group with more than one ACTIVE source, it lists each source order/item, payment ID/method/state/reference, creation/approval/acquisition dates, cancellation deadline, digital line amount/tax and whole-order payment amount. It never reconciles or modifies data.

The enhanced V075→V076 upgrade gate creates two historical ACTIVE sources for one identity before migrating. It verifies that the audit lists **both expected order IDs**, and that all grant JSON is unchanged after migration and audit. Existing checks then verify same-source replay, refusal of new/reactivated sources, pending-capture rollback and independent cancellation/refund of disposable sources. The empty-result audit was also executed on the separate regression database.

V076 retains historical duplicates; it neither deletes grants nor refunds them. The [README](README.md) explains review and the existing ADMIN `POST /api/v1/admin/orders/{orderId}/cancel` command. Cancellation operates on the **whole order**, including other digital/physical lines, full payment, stock restoration and applicable credit note. Finalized/out-of-window orders can return P5003; this work creates no bypass or partial-line refund command.

No audit was run against the user's actual customer 437 / orders 281 and 282. Whether to refund a source, which order to retain and how to handle an ineligible historical order remain business decisions.

## Catalog implementation and search inventory

New migration: **V078__accent_insensitive_catalog_search.sql**, following the highest existing V077.

`pliego.fn_search_fold(text)` is `IMMUTABLE`, `STRICT`, `PARALLEL SAFE`, SECURITY INVOKER. It normalizes canonical Unicode input to NFC, lowercases and translates accented Latin uppercase/lowercase letters. An explicit uppercase map handles databases whose default case conversion leaves accented uppercase unchanged. NULL stays NULL. Spanish **ñ folds to n** for discovery, so `nino` finds `niño`; display text, edition identity, SKU/ISBN identities and Spanish ordering are unchanged. The helper is immutable and suitable for expression indexes without installing an extension.

An initial implementation that folded every row during matching materially regressed the seeded query time. The final migration computes title/author folds on writes through **stored generated columns**:

- `libro.search_title_folded`, derived from `fn_search_fold(titulo)`.
- `autor.search_name_folded`, derived from `fn_search_fold(nombre)`.

Routine/import updates automatically regenerate these values. Two covering `text_pattern_ops` indexes, `ix_libro_search_fold_cover` and `ix_autor_search_fold_cover`, cover the folded columns and small ID/display values. Prefix plans use these indexes. Leading-wildcard substring searches can still scan candidates; the performance fix is avoiding repeated normalization during those scans. No unsupported claim of indexed `%substring%` lookup is made, and no pg_trgm/unaccent extension or new production extension privilege is needed.

The migration replaces **12 current routine definitions**:

| Search surface | Latest source / definitions | Existing matched fields retained |
| --- | --- | --- |
| Public catalog, independent filters | V069, both `fn_catalog_search` overloads | title, author; exact ISBN unchanged |
| Global catalog and header suggestions | V069, both `fn_catalog_search_global` overloads | title, author; compact exact ISBN unchanged |
| Offers, legacy Database API text searches | V044, `fn_catalog_search_offers`, `fn_catalog_search_global_offers` | title, author; existing ISBN path |
| ADMIN authors, publishers, categories, books | V013, four search routines | corresponding names, category slug, book title/author |
| ADMIN editions | V032, `fn_admin_edition_search` | title, SKU, exact ISBN |
| Inventory | V015, `fn_inventory_search` | title; existing exact normalized SKU filter unchanged |

`HeaderSearch.tsx` calls `searchPublicEditions` with `que`, unfiltered scope, TITLE_ASC and pageSize=6. It shares `JdbcCatalogGateway`'s global routines with the catalog; there is no separate suggestion routine to fix. `JdbcStorefrontGateway` reads navigation through `fn_storefront_navigation`, which has no text-query predicate. ADMIN and inventory Java gateways call the routines listed above. Help article search and non-catalog customer/order searches are unrelated and remain outside this change.

The [routine diff](catalog-search-routines.diff) compares every replacement with its latest definition. Reversing only matching-operand/query-fold substitutions reconstructs **12/12 source definitions exactly**. Validation, joins, active-category behavior, availability, offers, product scopes, filters, all ORDER BY expressions/collations/tie-breakers, LIMIT/OFFSET and return columns are unchanged. No new title, publisher, synopsis or narrator fields were added to public matching.

SQL and HTTP regression coverage includes `como`, `COMO`, `CÓMO`, `Cómo`, canonically decomposed `Cómo`, partial/exact searches, accented authors, ñ and reverse accent matching against unaccented stored data. Physical PAPERBACK/HARDCOVER, EBOOK and AUDIOBOOK are covered. Tests preserve product/format/language/category/price filters, offer searches, existing SKU and compact ISBN matches, independent title/author filters, all five catalog sorts, page boundaries, out-of-range counts and the six-item header request. The fixture uses **Cómo comportarse en la multitud** in every format; the actual seeded audiobook **Cómo comportarse en la multitud: una novela** is also returned by `como` after V078.

## EXPLAIN and privileges

The reproducible [benchmark](catalog-search-performance.py) loads **425** repository catalog editions into a new database through ADMIN HTTP: **176 PAPERBACK, 135 EBOOK, 114 AUDIOBOOK**. It reads the published/imported staging, preserves its identity/price/metadata, skips the existing excluded SKU, supplies disposable physical inventory and neither uploads images nor rewrites repository metadata.

It starts the built backend at Flyway V077, runs ANALYZE and EXPLAIN, stops it, applies V078 through real Flyway startup, and repeats. Each actual global-routine query uses AUDIOBOOK scope, page zero/20 results, 16 independent EXPLAIN ANALYZE samples; the first is excluded and the remaining 15 produce the reported median. These are warm-buffer latency observations, not a production load test.

| Query | V077 median ms / returned rows | V078 median ms / returned rows |
| --- | --- | --- |
| Cómo | 8.131 / 2 | 7.891 / 2 |
| como | 7.389 / 0 | 8.029 / 2 |
| García | 7.846 / 2 | 8.382 / 2 |
| garcia | 7.034 / 0 | 8.612 / 2 |
| niño | 7.497 / 1 | 7.632 / 1 |
| nino | 7.377 / 0 | 7.712 / 1 |
| 9780306406157 | 6.740 / 0 | 6.276 / 0 |
| libro | 7.349 / 0 | 6.763 / 0 |

Equivalent-result searches stay within approximately −8% to +7%, and all final medians are below 9 ms. Previously missing accentless queries now do the required work of returning matches. The first per-row-fold implementation took roughly 15–18 ms; generated columns removed that material regression. The inner title join changed from ~0.15 ms to **0.18 ms**, with 5 folded matches rather than 3 accent-exact matches. It uses a small sequential scan/hash join; measured prefix checks use Bitmap Index Scans on the new indexes (~0.089 ms for `como%`, ~0.024 ms for `garcia%`). Detailed [plans](catalog-search-explain.txt) and [sample summary](catalog-search-performance.json) are retained.

The complete V001→V078 startup and the measured V077→V078 migration ran as `pliego_fold_owner_20261024`, the disposable database owner with `rolsuper=false`, `rolcreatedb=false`, `rolcreaterole=false`. Only `plpgsql` was installed. Flyway reported **78 successful migrations / max version 78**; helper metadata was `provolatile=i`, `proisstrict=true`, `proparallel=s`. This proves the migration does not require superuser or extension installation rights. Generated stored columns require a one-time catalog-table rewrite and normal migration locks; large production catalogs would need release-time scheduling. Large-catalog throughput is not inferred from this 425-edition measurement.

## Exact final verification commands

Run from the repository root, unless noted. Environment is the supplied disposable local file; no credentials were written into tracked files. Database names below were newly created empty for their run. The restricted owner role was provisioned only in the disposable cluster with an ephemeral local credential; role provisioning is separate from application migration privileges.

```bash
mkdir -p /tmp/pliego-digital-duplicates

mvn --batch-mode --no-transfer-progress \
  -Dmaven.repo.local=/tmp/pliego-codex-m2 -f backend/pom.xml verify \
  > /tmp/pliego-digital-duplicates/maven-final.log 2>&1

source /tmp/pliego-digital-phase1/env.sh
createdb pliego_dup_final_20261024
PGDATABASE=pliego_dup_final_20261024 \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_dup_final_20261024 \
CHECKOUT_BASE_URL=http://127.0.0.1:18089 PLIEGO_PG18_APP_PORT=18089 \
PLIEGO_GATE_LOG_DIR=/tmp/pliego-digital-duplicates/final \
bash backend/src/test/postgres18/run_ci_gates.sh \
  > /tmp/pliego-digital-duplicates/final-gates.log 2>&1

createdb pliego_dup_upgrade_verified_20261024
PGDATABASE=pliego_dup_upgrade_verified_20261024 \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_dup_upgrade_verified_20261024 \
python3 backend/src/test/postgres18/digital_single_copy_upgrade_gate.py \
  > /tmp/pliego-digital-duplicates/upgrade-verified.log 2>&1

createdb -O pliego_fold_owner_20261024 pliego_fold_perf_final_20261024
PGUSER=pliego_fold_owner_20261024 PGDATABASE=pliego_fold_perf_final_20261024 \
PLIEGO_DB_USERNAME=pliego_fold_owner_20261024 \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_fold_perf_final_20261024 \
python3 docs/audit/digital-duplicates/catalog-search-performance.py \
  > /tmp/pliego-digital-duplicates/performance-final.log 2>&1

# From frontend/:
npx tsc --noEmit > /tmp/pliego-digital-duplicates/tsc.log 2>&1

# From repository root:
python3 -m py_compile \
  backend/src/test/postgres18/catalog_search_fold_http_gate.py \
  backend/src/test/postgres18/digital_mixed_single_copy_http_gate.py \
  backend/src/test/postgres18/digital_single_copy_concurrency.py \
  backend/src/test/postgres18/digital_single_copy_upgrade_gate.py \
  docs/audit/digital-duplicates/catalog-search-performance.py
bash -n backend/src/test/postgres18/run_ci_gates.sh
git diff --check -- backend docs/audit/digital-duplicates
```

Final gate breakdown: **37 SQL**, **18 database/concurrency**, **23 HTTP**, **2 authentication** = **80 passed, 0 failed**. Flyway **78/78**. New mixed HTTP scenario groups **4/4**; deterministic single-copy races **3/3**. Separate duplicate-data upgrade **1 passed, 0 failed**. Source equivalence **12/12**. Python/shell syntax and whitespace checks passed. No frontend API regeneration was necessary.

Before implementation, `psql -X -v ON_ERROR_STOP=1 -f backend/src/test/postgres18/catalog_search_fold_gate.sql` on new `pliego_dup_red_20261024` at V077 failed as intended with `fold global query como: expected 3 formats, got 0`. It passed after V078. During development, harness errors (a missing expected-cart argument and an audit-column offset) were corrected, and a manual exploratory backend was stopped after a Maven repackage replaced its open source jar; the final gate runner uses its existing private jar snapshot. The final fresh-database run above covers the corrected files and has no failures.

Independent read-only review found the audit-test column-offset mistake; it was corrected and the fresh upgrade gate passed. No additional confirmed correctness issue remained. Final evidence logs are in `/tmp/pliego-digital-duplicates/`; permanent plans/diffs and summary accompany this report.

## Open questions

- The business decision for existing duplicate charges is pending; this task did not authorize cancellation/refund of user orders.
- Actual development/production duplicate counts and cancellation eligibility are unverified here because those databases were explicitly outside scope.
- Applying V076–V078 and restarting the developer's old backend were outside the authorized database boundary. The current disposable verification does not change that runtime.
