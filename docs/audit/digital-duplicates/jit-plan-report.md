# Customer query planner / JIT regression audit

Date: 2026-10-24, branch `feat/digital-ownership-post-purchase-search`, PR #16. Local disposable PostgreSQL 18.6 at `127.0.0.1:55476`, Java 25.0.4.1. No production access or commits.

## Scope and result

Only these four files change:

- `backend/src/main/resources/db/migration/V079__customer_query_planner_cardinality.sql`: 37 metadata-only `ALTER FUNCTION ... ROWS` statements, using exact input signatures. 32 singleton projections/lookups use `ROWS 1`; five standalone paginated/batch functions use their validated maximum of 50. Function COST, bodies, volatility, security, results, locking and invariants are unchanged.
- `backend/src/test/postgres18/customer_query_plan_gate.py`: reads the actual customer-facing Java gateway SELECT strings, mirrors the three catalog runtime substitutions, checks 41 query variants plus four forced generic prepared plans, and records costs, timings and complete JSON plans. 38 cases run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` in rollback transactions. Seven authentication/email command cases use EXPLAIN without executing token side effects; their behavior remains covered by the HTTP gates.
- `backend/src/test/postgres18/run_ci_gates.sh`: require `79:79` successful Flyway migrations and run the plan gate after all HTTP/authentication gates have populated data. JSON plans are retained in `PLIEGO_GATE_LOG_DIR/customer-query-plans.json`.
- `docs/audit/digital-duplicates/jit-plan-report.md`: this report.

V076, V077 and V078 remain byte-for-byte unchanged. No frontend, CSS, frontend test or design documentation was edited.

The exact `JdbcCartGateway.CART_GET` query, including `fn_purchase_item_capabilities` and all three cross-joined routines, fell from **136,687,542.90 to 7.59** estimated total cost. With `jit=on` and the default `jit_above_cost=100000`, its measured execution fell from **122.951 ms (106.945 ms JIT compilation)** to **8.827 ms**, with no JIT section. Its generic prepared plan fell from the same cost and 115.286 ms to 7.59 and 5.740 ms. Before correction, the top estimate was 500,000,000 rows; after correction it is one row. Both actually return one row.

The final controlled regression is **43/45 passing before V079 (two cart variants fail cost/JIT assertions), 45/45 after V079**. Every audited query is below the default JIT threshold; none remains over budget. Largest final cost is 2,909.81 for order list. All 38 analyzed cases have no JIT section with default settings. These are observed plans on gate fixtures, not a production-size or universal future-plan guarantee.

## Planner metadata choices and review

The singleton chain covers cart get/quote/offer/acceptance projection/requirements/delivery, actor authorization, V077 order-detail and its reconciliation readers, post-purchase wrappers, order pricing, edition detail/offers, idempotent command resolution, profile/billing identity, auth lookup/refresh, invoice download, help article and aggregate catalog facets. Eligibility/favorite batches and standalone favorites/library/help pages use `ROWS 50`. Variable-length addresses, categories and pickup-location lists retain their existing estimates.

Catalog search/global search/offers from V078 and the multirow order-list functions were reviewed and measured. Their existing gateway costs already fit the budget. An initial broader draft setting these paginated functions to `ROWS 50` made PostgreSQL reverse the catalog gateway hash join from Left to Right, hashing the paged function output and changing returned order. The existing `catalog_search_fold_http_gate.py:53` caught the pagination inconsistency. Changing COST from 100 through 1,000,000 did not correct the join orientation. The final migration therefore leaves these multirow estimates unchanged; changing Java ordering or planner settings would exceed this task's scope. This preserves the observed behavior, but the catalog and order gateway wrappers still depend on incidental ordering without an outer ORDER BY; a durable ordering guarantee requires a separate gateway change.

Independent review also caught that legacy `fn_public_catalog_filter_options()` returns one row per language, not a singleton. Its proposed alteration was removed; the actual gateway uses the singleton facets function. A transactional catalog comparison confirmed the hash of all `pg_proc` fields except `prorows` is identical before/after V079: `f836668b8270e644cab4470b603cd695`. Only ROWS metadata changes.

## Query coverage and realistic parameters

The baseline database `pliego_jit_before_20261024` was created empty (zero application tables), migrated through V078 by the pre-change jar and populated by the complete existing runner: 80/80 gate programs passed. Before/after costs below use that same database and data; V079 was applied separately with `psql -1` for the controlled comparison. This baseline intentionally retains 78 entries in Flyway history. The final runner tests use different empty databases and real Flyway V079, never this comparison database or `pliego_ci_repro`.

Fixture selection uses an ACTIVE customer's populated cart, a customer's ACTIVE digital grant and its actual order/ownership identity, a published help article, and an issued invoice with real PDF bytes. It ensures one listable digital offer through the public offer routine because earlier gates can expire offers or exhaust physical stock. Catalog parameters include a real offered book title, `TITLE_ASC`/offer `RELEVANCE`, page 0, size 20 and actual product-type overloads. Actor/order/edition parameters are typed bigint; eligibility and favorites receive actual edition IDs. Representative cart, detail, eligibility, global search, library, offers and PDF cases assert nonempty results. Four cases additionally use `plan_cache_mode=force_generic_plan` with actual PREPARE/EXECUTE bindings.

All customer-facing SELECTs in the current JDBC gateways are included: billing, cart, catalog, billing identity, customer/profile/address/favorites, help, identity, eligibility, library, checkout, orders, pickup locations and storefront. Admin-only, inventory and scheduled-worker queries are excluded. Unreviewed new SELECTs fail binding lookup, and required cart/detail/eligibility/global-search identities are asserted to prevent a parser/rename from silently dropping critical checks.

Cart mutation and checkout acceptance gateways issue CALL statements. PostgreSQL does not support `EXPLAIN CALL` (verified: syntax error at CALL, exit 1); there is no top-level estimated plan cost to report for these commands. Their shared singleton helpers are corrected by V079; their transaction, acceptance, replay, concurrency and invariants are exercised by the existing SQL/database/HTTP suites. No claim is made that outer EXPLAIN exposes every nested PL/pgSQL statement plan.

## Before/after EXPLAIN costs

`generic` means forced generic prepared plan. `product_type` is the actual runtime overload. The shorter catalog signatures are also audited as compatibility entry points. Values are top-level estimated **Total Cost**, not execution times. Timings below are server EXPLAIN execution times, including JIT when present, excluding network/process startup.

| Gateway query / variant | V078 total cost | V079 total cost | V079 execution (ms) |
| --- | ---: | ---: | ---: |
| `JdbcBillingGateway.fn_invoice_artifact_metadata` | 0.27 | 0.27 | 3.092 |
| `JdbcBillingGateway.fn_invoice_artifact_download` | 10.25 | 0.26 | 2.863 |
| `JdbcCartGateway.CART_GET` | 136,687,542.90 | 7.59 | 8.827 |
| `JdbcCartGateway.CART_GET.generic` | 136,687,542.90 | 7.59 | 5.740 |
| `JdbcCatalogGateway.CATALOG_SEARCH_QUERY` | 50.20 | 50.20 | 7.842 |
| `JdbcCatalogGateway.CATALOG_GLOBAL_SEARCH_QUERY` | 50.20 | 50.20 | 6.598 |
| `JdbcCatalogGateway.EDITION_DETAIL_QUERY` | 37.08 | 37.08 | 0.489 |
| `JdbcCatalogGateway.PUBLIC_CATEGORY_LIST_QUERY` | 10.25 | 10.25 | 2.066 |
| `JdbcCatalogGateway.PUBLIC_FILTER_OPTIONS_QUERY` | 20.25 | 0.27 | 2.622 |
| `JdbcCatalogGateway.fn_offers_filter_options` | 0.27 | 0.27 | 1.939 |
| `JdbcBillingIdentityGateway.fn_customer_billing_identity` | 10.25 | 0.26 | 1.263 |
| `JdbcCustomerGateway.PROFILE_QUERY` | 21.09 | 8.43 | 0.811 |
| `JdbcCustomerGateway.PASSWORD_HASH_QUERY` | 0.26 | 0.26 | 1.113 |
| `JdbcCustomerGateway.ADDRESS_LIST_QUERY` | 10.25 | 10.25 | 1.305 |
| `JdbcCustomerGateway.FAVORITES_QUERY` | 10.25 | 0.75 | 2.397 |
| `JdbcCustomerGateway.FAVORITE_STATUS_QUERY` | 10.25 | 0.75 | 1.251 |
| `JdbcCustomerGateway.fn_address_create_resolve` | 10.25 | 0.26 | 1.280 |
| `JdbcHelpGateway.fn_help_categories` | 19.31 | 19.31 | 0.064 |
| `JdbcHelpGateway.fn_help_search` | 10.25 | 0.75 | 1.492 |
| `JdbcHelpGateway.fn_help_article` | 19.30 | 19.30 | 0.050 |
| `JdbcIdentityGateway.AUTH_QUERY` | 8.29 | 8.29 | 0.018 |
| `JdbcIdentityGateway.CREATE_SESSION_QUERY` | 0.27 | 0.27 | plan only |
| `JdbcIdentityGateway.REFRESH_SESSION_QUERY` | 10.25 | 0.26 | plan only |
| `JdbcIdentityGateway.REVOKE_SESSION_QUERY` | 0.26 | 0.26 | plan only |
| `JdbcIdentityGateway.fn_email_action_request` | 0.26 | 0.26 | plan only |
| `JdbcIdentityGateway.fn_email_action_set_return_path` | 0.26 | 0.26 | plan only |
| `JdbcIdentityGateway.fn_email_action_consume` | 0.26 | 0.26 | plan only |
| `JdbcIdentityGateway.fn_email_verification_for_user` | 0.26 | 0.26 | plan only |
| `JdbcDigitalEligibilityGateway.fn_customer_digital_eligibility` | 10.25 | 0.75 | 3.408 |
| `JdbcDigitalEligibilityGateway.fn_customer_digital_eligibility.generic` | 10.31 | 0.81 | 3.444 |
| `JdbcLibraryGateway.fn_customer_library` | 15.25 | 1.00 | 3.060 |
| `JdbcLibraryGateway.fn_customer_library_detail` | 0.27 | 0.27 | 2.575 |
| `JdbcCheckoutGateway.fn_checkout_resolve` | 10.25 | 0.26 | 1.554 |
| `JdbcCheckoutGateway.fn_order_fulfillment` | 0.27 | 0.27 | 0.527 |
| `JdbcCheckoutGateway.fn_order_pricing` | 4.10 | 4.10 | 0.024 |
| `JdbcCheckoutGateway.fn_order_offer_pricing` | 10.67 | 10.67 | 0.065 |
| `JdbcCustomerOrderGateway.LIST` | 2,909.81 | 2,909.81 | 6.311 |
| `JdbcCustomerOrderGateway.DETAIL` | 3,147.41 | 11.60 | 8.326 |
| `JdbcCustomerOrderGateway.DETAIL.generic` | 3,147.41 | 11.60 | 8.707 |
| `JdbcPickupLocationGateway.fn_pickup_locations` | 11.14 | 11.14 | 0.052 |
| `JdbcStorefrontGateway.fn_storefront_navigation` | 0.27 | 0.27 | 8.808 |
| `JdbcCatalogGateway.CATALOG_SEARCH_QUERY.product_type` | 50.20 | 50.20 | 7.772 |
| `JdbcCatalogGateway.CATALOG_GLOBAL_SEARCH_QUERY.product_type` | 50.20 | 50.20 | 6.197 |
| `JdbcCatalogGateway.CATALOG_GLOBAL_SEARCH_QUERY.product_type.generic` | 50.20 | 50.20 | 7.975 |
| `JdbcCatalogGateway.CATALOG_SEARCH_QUERY.offers` | 50.20 | 50.20 | 3.529 |

## Reproduction commands

Run from the repository root. The existing `/tmp/pliego-digital-phase1/env.sh` contains disposable local credentials and was never printed or committed.

```bash
source /tmp/pliego-digital-phase1/env.sh
# Server was already accepting connections; pg_ctl status was misleading across
# the process namespace. The requested start returned an existing-PID error.
# Confirmed with pg_isready/SQL, without removing the PID file or restarting it.
/usr/lib/postgresql/18/bin/pg_ctl -D /tmp/pliego-digital-phase1/pgdata \
  -o "-p 55476 -k /tmp" -l /tmp/pliego-digital-phase1/postgres.log start

mvn --batch-mode --no-transfer-progress \
  -Dmaven.repo.local=/tmp/pliego-codex-m2 -f backend/pom.xml verify

# Controlled before/after, populated V078 baseline:
PGDATABASE=pliego_jit_before_20261024 \
  python3 backend/src/test/postgres18/customer_query_plan_gate.py \
  --output /tmp/pliego-jit/before.json
PGDATABASE=pliego_jit_before_20261024 psql -X -v ON_ERROR_STOP=1 -1 \
  -f backend/src/main/resources/db/migration/V079__customer_query_planner_cardinality.sql
PGDATABASE=pliego_jit_before_20261024 \
  python3 backend/src/test/postgres18/customer_query_plan_gate.py \
  --output /tmp/pliego-jit/after.json

createdb pliego_jit_final_enabled_20261024
createdb pliego_jit_final_disabled_20261024
createdb pliego_jit_final_forced_20261024
psql -X -d postgres -v ON_ERROR_STOP=1 \
  -c 'ALTER DATABASE pliego_jit_final_forced_20261024 SET jit_above_cost=0'
# Each database was verified to have zero non-system tables before its runner.

# Execute this environment for each row in the run table below:
export PLIEGO_BILLING_POLL_INTERVAL=PT0.1S PLIEGO_BILLING_BATCH_SIZE=20
export PLIEGO_RUN_LIVE_BROWSER=0
PGDATABASE=pliego_jit_final_enabled_20261024 \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_jit_final_enabled_20261024 \
CHECKOUT_BASE_URL=http://127.0.0.1:18078 PLIEGO_PG18_APP_PORT=18078 \
PLIEGO_BILLING_ENABLED=true PLIEGO_GATE_LOG_DIR=/tmp/pliego-jit/final-enabled \
bash backend/src/test/postgres18/run_ci_gates.sh

PGDATABASE=pliego_jit_final_disabled_20261024 \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_jit_final_disabled_20261024 \
CHECKOUT_BASE_URL=http://127.0.0.1:18079 PLIEGO_PG18_APP_PORT=18079 \
PLIEGO_BILLING_ENABLED=false PLIEGO_GATE_LOG_DIR=/tmp/pliego-jit/final-disabled \
bash backend/src/test/postgres18/run_ci_gates.sh

PGDATABASE=pliego_jit_final_forced_20261024 \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_jit_final_forced_20261024 \
CHECKOUT_BASE_URL=http://127.0.0.1:18080 PLIEGO_PG18_APP_PORT=18080 \
PLIEGO_BILLING_ENABLED=true PLIEGO_GATE_LOG_DIR=/tmp/pliego-jit/final-forced \
bash backend/src/test/postgres18/run_ci_gates.sh

bash -n backend/src/test/postgres18/run_ci_gates.sh
git diff --check
```

## Verification results

Final Maven verification: **320 tests, 0 failures, 0 errors, 0 skipped; BUILD SUCCESS**, 30.202 seconds. Log: `/tmp/pliego-jit/maven-final.log`.

The runner contains **37 SQL + 18 database/concurrency + 23 HTTP + 2 authentication + 1 plan = 81 gate programs**. Counts here refer to programs, not their internal assertions or nested Python unittest cases. The new plan program separately reports 45 query cases. Optional browser gates are disabled because this task is database/backend only, following the cited Phase 1 verification command.

| Final fresh database | Billing | `jit_above_cost` | Gate programs passed / failed / not reached | Plan cases passed / failed | Wall time | Exit |
| --- | --- | ---: | --- | --- | ---: | ---: |
| `pliego_jit_final_enabled_20261024` | true | 100000 | 81 / 0 / 0 | 45 / 0 | 104 s | 0 |
| `pliego_jit_final_disabled_20261024` | false | 100000 | 72 / 1 / 8 | runner did not reach plan gate; separate invocation 45 / 0 | 132 s | 1 |
| `pliego_jit_final_forced_20261024` | true | 0 | 66 / 1 / 14 | runner did not reach plan gate; separate invocation 0 / 45 (expected policy rejection) | 163 s | 1 |
| `pliego_jit_final_forced_retry_20261024` | true | 0 | 80 / 1 / 0 (only strict plan policy fails) | 0 / 45 (expected policy rejection) | 201 s | 1 |

The billing-disabled run stops at `automatic_billing_http_gate.py` after its 35-second artifact wait: `artifact worker did not produce PDF/XML`. All 37 SQL, all 18 database/concurrency and the preceding 17 HTTP gate programs passed. The remaining five HTTP, two authentication and one plan gate programs were not reached because the runner uses `set -e`. This negative configuration run was not reported as a pass. To verify the plan repair independently of that worker, the plan gate was also run directly on its populated database and passed 45/45 (maximum cost 1,663.96).

```bash
source /tmp/pliego-digital-phase1/env.sh
PGDATABASE=pliego_jit_final_disabled_20261024 \
python3 backend/src/test/postgres18/customer_query_plan_gate.py \
  --output /tmp/pliego-jit/final-disabled/customer-query-plans.json
```

Fresh-run timings (ms), distinct from the controlled comparison table. The first forced column is the standalone gate after the crash; the retry column comes from the complete forced runner:

| Query | Billing true, normal JIT threshold | Billing false, standalone plan gate | First forced JIT | Forced JIT retry |
| --- | ---: | ---: | ---: | ---: |
| CART_GET | 8.043 | 6.400 | 114.379 | 184.701 |
| CART_GET, generic prepared | 5.496 | 5.017 | 109.693 | 192.614 |
| Order detail | 5.586 | 7.090 | 83.656 | 97.670 |
| Digital eligibility | 3.468 | 4.235 | 29.702 | 30.465 |
| Global catalog search, actual product-type overload | 6.217 | 6.470 | 28.976 | 30.849 |

The first forced run passed all 37 SQL, 18 database/concurrency and 11 HTTP programs, then failed in `store_pickup_http_gate.py`. At **21:47:30.489 -05**, the native PostgreSQL server logged **SIGSEGV / signal 11** while a JDBC session executed the exact customer order-detail SELECT, terminated other server processes and recovered automatically. The failing request was the second read of a stored pickup order after the pickup location was deactivated; its response lacked `fulfillment` because the connection died. This is an observed native crash under forced JIT, not a passing functional verification. Server evidence is in `/tmp/pliego-digital-phase1/postgres-review.log:7928` and `/tmp/pliego-jit/final-forced/backend.log`; diagnostic SQL did not reproduce it in **8/8 prepared executions** of the affected order in one fresh connection (one row each, 70.188–89.240 ms). No native crash root cause is claimed.

After recovery, the plan gate was invoked separately on that same forced database. All 45 cases produced plans; all 38 analyzed SELECTs executed successfully, and both cart variants stayed below 200 ms. It correctly returned exit 1 with 0/45 policy passes because all costs were positive against threshold zero and all 45 plans contained JIT sections (seven are planning-only). Timings in the forced column above are from that separate invocation. This proves these individual query executions complete with actual JIT; it does not prove the entire forced-JIT HTTP lifecycle is reliable. The second full forced run on `pliego_jit_final_forced_retry_20261024` completed all **80 functional programs with zero functional failures**, then correctly failed only the strict plan gate (0/45 policy passes). All 38 ANALYZE cases executed, all 45 plans contained JIT sections, and CART_GET remained below 200 ms: **184.701 ms ordinary, 192.614 ms generic**. The entire run took 201 seconds and exited 1 solely at the expected threshold-zero/JIT rejection. It reported Flyway 79:79 and `jit=on`, threshold 0. No second SIGSEGV was logged. This completes a full functional exercise with forced JIT, while leaving the first intermittent native crash unexplained.

```bash
source /tmp/pliego-digital-phase1/env.sh
PGDATABASE=pliego_jit_final_forced_20261024 \
python3 backend/src/test/postgres18/customer_query_plan_gate.py \
  --output /tmp/pliego-jit/final-forced/customer-query-plans.json
# Diagnostic prepared order reader, eight EXPLAIN ANALYZE executions: exit 0.
PGDATABASE=pliego_jit_final_forced_20261024 \
psql -X -qAt -v ON_ERROR_STOP=1 -f /tmp/pliego-jit/reproduce-order-detail.sql
# Retry: identical final jar/environment to the forced run, but fresh database:
createdb pliego_jit_final_forced_retry_20261024
psql -X -d postgres -v ON_ERROR_STOP=1 \
  -c 'ALTER DATABASE pliego_jit_final_forced_retry_20261024 SET jit_above_cost=0'
PGDATABASE=pliego_jit_final_forced_retry_20261024 \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_jit_final_forced_retry_20261024 \
CHECKOUT_BASE_URL=http://127.0.0.1:18080 PLIEGO_PG18_APP_PORT=18080 \
PLIEGO_BILLING_ENABLED=true PLIEGO_GATE_LOG_DIR=/tmp/pliego-jit/final-forced-retry \
bash backend/src/test/postgres18/run_ci_gates.sh
```

The three primary final databases independently report `79:79`, `jit=on`; their thresholds are respectively 100000, 100000 and 0. The final packaged V079 exactly matches the working file (SHA-256 `2477f848915c31834e772255a1cc55b4b1d24931d22e16f88b08872b8578d900`). Scope/unchanged migration checks, shell syntax, Python parsing and `git diff --check` passed.

CI configuration: `.github/workflows/ci.yml` sets `PLIEGO_BILLING_ENABLED=false` at the Maven job level for historical upgrade jobs, but the step **Run live SQL, concurrency, HTTP, Flyway, and browser gates** explicitly overrides it to `true`, with poll interval `PT0.1S` and batch size 20. The billing HTTP/artifact worker test needs that override; billing-disabled failure is a configuration expectation, not a cart/JIT regression. No billing behavior, gate skips or CI configuration were changed.

With `jit_above_cost=0`, every positive query cost violates the required gate condition `cost < current_setting('jit_above_cost')`. Consequently a strict plan gate must reject that run even when requests work. The forced run deliberately retains that rejection instead of disabling JIT, raising the threshold or bypassing assertions. Its functional gate results and measured query times are reported separately above.

Earlier exploratory runs are retained in `/tmp/pliego-jit/{enabled,disabled,forced}.log`: the broader draft's enabled and forced runs failed the pre-existing catalog pagination assertion; the disabled run failed billing artifact generation as expected. Those runs used the withdrawn broader metadata and are not final verification. Initial gate authoring also exposed invalid fixture sorts and exhausted offers; these were corrected before the final red/green comparison. No test results are inferred from those failed attempts.

Remaining limitations: the unexplained intermittent PostgreSQL native crash during the first forced-JIT HTTP run (not reproduced by the full fresh retry or 8/8 prepared diagnostic executions); the latent outer-ordering dependency described above; EXPLAIN-only authentication/email command cases; no EXPLAIN support for CALL; no production-scale or nested-statement plan guarantee. No audited final query remains above the default 100000 budget.

## References

PostgreSQL 18 documents [ROWS planner metadata](https://www.postgresql.org/docs/18/sql-alterfunction.html) and [cost-based JIT decisions](https://www.postgresql.org/docs/18/jit-decision.html). The measurements and counts in this report come from the local verification artifacts, not these documentation examples.
