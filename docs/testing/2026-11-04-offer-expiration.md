# Offer expiration and refresh: requirement traceability

Date: 2026-11-04, America/Guayaquil. Design: [ADR0058](../adr/0058-offer-expiration-and-refresh.md).
Migration: V106. No production access, deployment, commit or push.
Frontend feature/UI/style directories were not edited by the backend change; the browser wiring was added separately by Claude (rows marked "UI").

## Evidence and environment

Raw logs, disposable PG18 cluster and packaged artifacts live only under the
git-ignored `.release-evidence/2026-11-04/offers/` directory. PostgreSQL listens on
loopback port 55441, independently of the other task. Maven/JVM processor count is 2;
frontend tests use one worker. Temporary gate artifacts use this evidence root.

The behavioral RED on V105 is `red-checkout.log`: a CALL entered an observed
edition lock wait before expiry, resumed after the database deadline, and wrongly
persisted the discounted total. V106's corresponding case passes. No clock was
mocked and no production routine was replaced to demonstrate that defect.

## Requirement-to-test matrix

Evidence filenames below are relative to the raw-evidence directory above.
SQL gates use raising assertions in a rolled-back fixture transaction; Python
concurrency tests use observed `pg_stat_activity` barriers and DB deadlines.

| Requirement | Test name / gate | Evidence |
|---|---|---|
| 1: offers cease applying exactly at end; inclusive start | `offer_lifecycle_gate.sql`, five instants (start−1µs, start, end−1µs, end, end+1µs), repeated in three timezones | `green-lifecycle.log`; `full-pg-gates.log` |
| 2: public catalog, global search, offers, detail and facets refresh to base price | `offer_refresh_http_gate.py::main`, all PAPERBACK/EBOOK/AUDIOBOOK fixtures; legacy `offers_http_gate.py`, catalog and offer SQL gates | `full-pg-gates.log` |
| 2: cart quoted before end and purchased after end | `offer_expiry_checkout_gate.py::run_case`, expired-before-call physical/digital, unquoted base price and quoted P4005 | `red-checkout.log`, `green-checkout.log`; `full-pg-gates.log` |
| 2: one CALL straddles end while waiting for locks | `run_case`, physical/digital edition lock, physical/mixed inventory lock, each with and without accepted quote; verifies exact totals and zero committed effects on P4005 | `green-checkout.log`; `full-pg-gates.log` |
| 2: expiry after purchase pricing decision preserves internal consistency | `expiry_after_pricing_before_item_insert`, observed item-insert barrier after stored pricing instant, mixed quoted discounted totals/snapshots, later stable replay | `green-checkout.log`; `full-pg-gates.log` |
| 2: payment compatibility | `quoted_payment_outcomes`, PENDING and REJECTED fingerprint equivalence and replay; legacy checkout/order/payment gates | `green-checkout.log`; `full-pg-gates.log` |
| 2: digital purchases, saved-for-later and favorites use current authoritative price | `offer_refresh_http_gate.py::main`, digital catalog/cart plus saved EBOOK and favorites for all three formats; `offer_lifecycle_gate.sql` expired read checks | `full-pg-gates.log`; `green-lifecycle.log` |
| 3: public clock, explicit null, no cache, only public metadata | `OfferRefreshControllerTest.anonymousClock_isNotCached_andContainsOnlyPublicTimingMetadata`, `.noFutureTransition_retainsAnExplicitNullDeadline`; `offerRefresh.test.ts`; live HTTP clock assertions | `maven-verify.log`, `frontend-tests.log`, `full-pg-gates.log` |
| 3: actual scheduled transition reaches an already-open authenticated browser stream | `offer_refresh_http_gate.py::main`, consumes creation hints first then requires later expiry hints; no manual publisher/advance call | `full-pg-gates.log` |
| 3: SSE public allowlist, both roles, unchanged private isolation/replay/revocation | `offer_lifecycle_gate.sql` customer/admin read and five invalid public-scope combinations; complete existing `realtime_events_gate.py`, `realtime_events_http_gate.py`, `realtime_resource_events_gate.sql`, Java realtime suite | `green-lifecycle.log`, `full-pg-gates.log`, `maven-verify.log`, `java-postgres.log` |
| 3: generated contract matches Java endpoint and shared Zod reader | Spring `/v3/api-docs` snapshot; `npm run api:types`; `npm run typecheck`; shared clock schema tests | `openapi.raw.json`, `frontend-generation.log`, `frontend-typecheck-final.log`, `frontend-tests.log` |
| 4: no unauthorized replenishment | Schema/routine/migration and November campaign audit; no offer creation from lifecycle routine; lifecycle compares full offer row before/after and upgrade preserves four authored offers | ADR0058; `green-lifecycle.log`, `upgrade/summary.json` |
| 5: PostgreSQL business authority and Spring transaction/JDBC boundaries | New SQL gates + live REST/JDBC tests; `OfferLifecyclePostgresIntegrationTest` uses actual proxied service and pooled DB calls; existing architecture/unit checks | `java-postgres.log`, `maven-verify.log`, `full-pg-gates.log` |
| 6: worker restricted to observation/hints; dedicated scheduling preserves other workers | `OfferLifecycleSchedulingTest.offerWork_usesItsDedicatedScheduler_evenWhenTheDefaultSchedulerIsBusy`, `.dedicatedScheduler_preservesBootDefaultScheduler_forOtherWorkers`, `.disablingOfferScheduling_doesNotCreateAnotherScheduler`; expired reads with worker disabled | `maven-verify.log`, `green-lifecycle.log` |
| 7: concurrent runners, idempotence and locked-row recovery | `offer_lifecycle_concurrency.py::two_runners`, `skip_locked_then_recover`, `rollback_then_retry` | `green-concurrency.log`; `full-pg-gates.log` |
| 7: restart catchup and atomic queue/hint/counter rollback | `offer_lifecycle_gate.sql` deliberately overdue start+end, one coalesced hint, rerun no hint, rolled-back advance remains due; `offer_expiry_upgrade_gate.py::assert_seed_and_catchup` | `green-lifecycle.log`, `upgrade/summary.json`, `full-pg-gates.log` |
| 7: migration cannot miss a concurrent admin write | `offer_expiry_upgrade_gate.py::installation_writer_race`, packaged V106 trigger installation holds table lock before seed, observed writer wait, then one marker/hint | `upgrade-gate.log`, `upgrade/offer-install-migration-*.log`, `upgrade/summary.json` |
| 7: timestamptz/Ecuador timezone and exact microseconds | `offer_lifecycle_gate.sql` UTC/Guayaquil/Auckland boundary loop; Ecuador calendar day assertions; live offset-preserving offer metadata | `green-lifecycle.log`, `full-pg-gates.log` |
| 7: structured logs and durable success/failure/lag state | `OfferLifecycleSchedulerTest` three tests; `OfferLifecyclePostgresIntegrationTest.status_mapsDurableSuccessFailureCounters_andRestoresPooledExecutionLimits`; SQL operational counters/lag checks | `maven-verify.log`, `java-postgres.log`, `green-lifecycle.log` |
| 7: timeout configuration resets on pooled connection | New lifecycle Postgres status test and complete `RealtimeTransactionPostgresIntegrationTest` (four real transaction tests) | `java-postgres.log` |
| 8: history, orders, paid discount snapshots and replay never change | New lifecycle row comparison; checkout replay/P9001 assertion; packaged 105→106 preserves 68 prior tables, four offers, two orders/three discounted items, old pricing instant NULL; legacy order snapshot SQL/concurrency/HTTP gates | `green-checkout.log`, `upgrade/summary.json`, `full-pg-gates.log` |
| Runtime privileges and nonregression | Existing full strict runtime lifecycle gate plus new `offer_lifecycle_gate.sql` under restricted `pliego_app`; complete catalog/cart/sales/realtime gates | `full-pg-gates.log`, `pg-final-stage.log` |
| 3 (UI): an open page re-reads prices after a transition, server-relative, never the browser wall clock | `app/realtime/offerRefresh.test.tsx` — `nextOfferCheckDelay` (margin, wrong system clock, revalidation bound, elapsed time, ≥1s clamp); `OfferRefreshSync` "re-reads the mounted price views right after an offer ends, and only then" (catalog, navigation counts and cart invalidated; non-price public data untouched) | `npx vitest run --maxWorkers=8`: 111 files / 1,374 tests passed (2026-11-04) |
| 3 (UI): administrative edits reach guests within the revalidation bound; quiet when unchanged | `OfferRefreshSync` "revalidates within the bound and stays quiet while nothing changed; an administrative edit re-reads prices" | same run |
| 3 (UI): background tabs do not poll and revalidate on return; failures retry quietly; no UI, stops on unmount | `OfferRefreshSync` "does not ask while the tab is hidden…", "retries quietly after a failed read…" | same run |
| 3 (UI): signed-in hint `catalog.offers.changed` and stream resync refresh every price view for both roles | `app/realtime/realtime.test.ts` "maps the public offer hint to every price view for both roles, and nothing else", "…resync refetches every private and price view, never other public data" | same run |
| 3 (UI): no price read can predate the first clock observation | `primeOfferRefreshClock()` in `main.tsx` issues the clock before the app renders; a boundary after that instant is always the first `nextTransitionAt` (design argument; covered indirectly by the transition test) | code review |

## Commands and results

The disposable environment is local and excluded from Git. Reproduction requires
an isolated PostgreSQL 18 cluster and fixture credentials, never a production URL.

* `PLIEGO_TEST_DISPOSABLE_DB=0 mvn --batch-mode --no-transfer-progress -f backend/pom.xml -DargLine='-XX:ActiveProcessorCount=2 -Xmx512m' verify`: **748 discovered, 709 passed, 39 explicitly database-gated skips, zero failures/errors**. All relevant catalog/cart/sales/realtime unit and Spring API classes run in full.
* `mvn --batch-mode --no-transfer-progress -f backend/pom.xml -Dtest=OfferLifecyclePostgresIntegrationTest,RealtimeTransactionPostgresIntegrationTest -DargLine='-XX:ActiveProcessorCount=2 -Xmx384m' test` with disposable environment: **6 passed, zero skips/failures/errors**, including the six relevant real-DB cases skipped above.
* `python3 backend/src/test/postgres18/offer_expiry_upgrade_gate.py` against a dedicated empty upgrade database: **pass**; packaged 105→106, 68 tables, 4 offers, 2 paid orders / 3 discounted items preserved, 2 catchup observations once, concurrent migration writer captured.
* New checkout gate: **15 scenarios passed**; lifecycle concurrency: **3 passed**; explicit instant loop: **15 boundaries passed** (five per timezone), plus all lifecycle recovery/scope/monitoring assertions.
* PostgreSQL 18: `bash backend/src/test/postgres18/run_ci_gates.sh` passed its **58 SQL gates and 70 Python/concurrency/HTTP gates**, then its fail-closed plan registry stopped on the newly introduced `fn_offer_refresh_clock`. After registering all four lifecycle gateway statements, `python3 backend/src/test/postgres18/customer_query_plan_gate.py --output <evidence>/gates/customer-query-plans.json` passed **75/75 query plans** (the 129th main gate). `bash backend/src/test/postgres18/run_runtime_privileges_ci_gate.sh` then completed with exit 0: **13 SQL gates and six Python gates under restricted production-style roles**, including the new lifecycle gate. This is phased verification; the original full-runner exit was 1, and the corrected final-stage exit was 0. Evidence: `full-pg-gates.log`, `pg-final-stage.log` and `gates/customer-query-plans.json`. No earlier passing behavior gates were rerun merely for the registry update.
* Frontend: `npm run api:types` and `npm run typecheck` passed; `npm test -- --maxWorkers=1`: **110 files / 1,365 tests passed, zero failures**, including nine new shared clock tests.

The earlier local Java attempt inherited the worker-disabled environment in two
scheduler configuration tests. Those tests now explicitly enable the worker when
testing its presence; the full rerun above passes. Two initial full-gate setup
attempts used the wrong owner role/bootstrap email for the existing fixtures;
their logs are retained separately and excluded from passing evidence. The
upgrade fixture initially omitted an audiobook narrator and was corrected before
the successful fresh-database run. The final broad run used CI's billing worker settings so the invoice artifact HTTP gates ran fully. No native crash was observed.

## Scope and remaining limits

Read projections price at a single statement instant. Checkout prices at its
stored post-lock database instant; a commit may finish after expiry. The browser
must not treat hints as business state. The UI wiring (`app/realtime/OfferRefreshSync`,
`offerRefresh.ts`, the `catalog.offers.changed` hint) is implemented; timely updates
still depend on healthy DB/SSE publication, and background tabs revalidate on return. Guest discovery of later admin edits has a 60s metadata
revalidation bound. Scheduler intervals are targets, not hard realtime guarantees.

Replenishment is absent because there is no approved successor-promotion source.
Metrics/health dependencies are absent; the exact later bindings and thresholds
are in ADR0058. Preexisting dirty files are preserved.

Changed paths only: [manifest](2026-11-04-offer-expiration-files.txt).
