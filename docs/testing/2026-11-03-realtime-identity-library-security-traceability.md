# V-model traceability — identity, realtime, library and security

Date: 2026-11-03. Scope: local implementation on
`feat/digital-ownership-post-purchase-search`; no commit, deployment, production
access or UI changes. Approved baselines and V001–V100 remain unchanged.

## Requirement → acceptance → automated evidence → result

| Requirement | Acceptance criteria | Test(s), class/method or SQL gate | Result |
|---|---|---|---|
| RQ-IC-01 | Spanish approval/rejection mail through durable outbox; number/invoice disclaimer or reason; transaction rollback, dedup, no withdrawal mail, competing admins | `BillingIdentityDecisionMailTest` actual worker/transport HTTP approval/rejection, cédula/RUC renderer and invalid withdrawal; `billing_identity_decisions_gate.sql`; `identity_decision_concurrency.py` | PASS; 6 mail tests including real Mailtrap transport against loopback stub, forced-outbox rollback and 2 observed-lock races |
| RQ-IC-02 | Own decided request only; first acknowledgment timestamp retained; repeated 204; foreign/unknown indistinguishable404; pending/withdrawn409 | `BillingIdentityCorrectionApiIntegrationTest.acknowledgmentUsesTheAuthenticatedCustomerAndReturnsNoStoredContent`, `acknowledgmentHidesForeignRequestsAndRejectsPendingWithoutChangingTheirErrorCodes`, `acknowledgmentRequiresACustomerAndAPositiveRequestIdentifier`; `billing_identity_decisions_gate.sql`; `billing_identity_corrections_http_gate.py` | PASS; API/SQL/HTTP and concurrent owner acknowledgment |
| RQ-IC-03 | Pending unchanged; acknowledgment hides latest decision and cannot resurrect an older unacknowledged result; correct nullable OpenAPI | `billing_identity_decisions_gate.sql`; `billing_identity_corrections_http_gate.py`; `BillingIdentityApiIntegrationTest.openApiKeepsProfileDecisionSeparateFromCheckoutIdentityAndAllowsAcknowledgedNull` | PASS; old-notice regression observed red then green |
| RQ-IC-04 | Acknowledgment changes no decision, administrator list, identity event or invoice | `billing_identity_decisions_gate.sql` immutable snapshots, admin-list assertion and update/delete rejection; `identity_decision_concurrency.py`; `realtime_identity_library_upgrade_gate.py` | PASS |
| RQ-RT-00 | One mechanism justified against actual repository infrastructure/auth/threading; client contract documented and implemented | ADR0054 comparisons/sources; `RealtimeControllerTest.streamSendsRetryHeartbeatAndResyncWithProxyHeaders` asserts virtual worker; OpenAPI endpoint/cookie declarations; `RealtimeStreamsTest.shutdownInterruptsIdleStreamsAndReleasesEveryLease` | PASS; SSE + durable database fan-out, bounded REST recovery |
| RQ-RT-01 | Cookie-only scoped stream; anonymous/refused session401; customer cannot read other customer/admin hints; cross-instance user cap; expiry/revocation closes/refuses | `RealtimeControllerTest.anonymousAndBearerOnlyCannotOpenCookieStream`, `invalidCookieAndConnectionCapReturnSpanishProblems`; `realtime_events_gate.py`; `realtime_events_http_gate.py`; `realtime_resource_events_gate.sql` | PASS; 12 concurrent admission attempts, actual HTTP revocation, absolute expiry |
| RQ-RT-02 | Real correction/create/withdraw/decision/ack, order/payment/shipment/pickup, backend deadline and ownership writes emit committed hints only | `realtime_resource_events_gate.sql` real routines, checkout, cancellation/reacquisition, scheduler expiry and actual READY outbox; `realtime_events_gate.py` rollback/commit-order interleave; existing order/pickup/lifecycle gates with V104 triggers | PASS; no rollback hints or duplicate acknowledgment/READY hints |
| RQ-RT-03 | Monotonic committed public IDs; Last-Event-ID replay or explicit gap resync; retention cannot race reads; retry, heartbeats/proxy headers and graceful stop | `realtime_events_gate.py` late business commit, injected retention interleave, 250 own events across 100/100/50 pages with foreign IDs; `realtime_events_http_gate.py`; `RealtimeControllerTest`; `RealtimeStreamsTest` | PASS; VOLATILE race reproduced before STABLE fix; retention query measured on200k rows |
| RQ-RT-04 | Authorized/unauthorized/rollback/resume/gap/heartbeat/cap/revocation and concurrent subscribers/transitions exercised | All realtime gates above; `identity_decision_concurrency.py`; actual HTTP12 subscribers/concurrent writes; `RealtimeStreamsTest`12 shutdown leases | PASS; SQL18 cases, HTTP10 cases, 5 focused Java tests |
| RQ-LIB-01 | List, filtered counts and pagination include only identities with ACTIVE grants | `active_library_gate.sql`; updated `digital_ownership_gate.sql`, `library_checkout_http_gate.py`; `JdbcLibraryGatewayTest` | PASS; mixed OWNED/REVOKED fixtures and out-of-range pagination |
| RQ-LIB-02 | Revoked, foreign and unknown detail use the same Spanish P6001/404 | `active_library_gate.sql`; `library_checkout_http_gate.py`; `post_purchase_digital_access_gate.sql` | PASS |
| RQ-LIB-03 | Retain source grants, cancelled order/digitalAccess, invoices/credit notes and repurchase eligibility | `active_library_gate.sql` full row snapshots; `digital_ownership_gate.sql`; `post_purchase_digital_access_gate.sql`; `post_purchase_digital_access_http_gate.py`; digital-single-copy and cancellation gates | PASS; no business eligibility rewrite |
| RQ-LIB-04 | Ownership, revoked, cross-customer and counts covered automatically | `active_library_gate.sql`; `library_checkout_http_gate.py`; existing digital ownership/concurrency gates | PASS |
| RQ-REG-01 | DB quota120/IP/hour +5/canonical-email/hour before BCrypt/lookup; fixed windows, Spanish429/Retry-After, cleanup | `RegistrationAttemptPostgresIntegrationTest.fiveAttemptsThenSpanish429SkipsBcryptAndAccountLookupAndLogsNoIdentifiers`, `exhaustedScopesAreNeutralForKnownUnknownAndRecoverAfterExpiry`, `maintenanceUsesSeparateSpringTransactionsToCleanExpiredBucketsAndNeutralReceipts`; `registration_attempt_gate.py` | PASS; SQL8 cases, HTTP/JDBC15 cases |
| RQ-REG-02 | New/duplicate201/body/cookie/BCrypt shape neutral; duplicate cannot overwrite or gain account/continuation access | `newDuplicateAndTheirPendingContinuationsHaveSameShapeWithoutAccountMutation`, `existingVerifiedBlockedAndAdminAccountsRemainNeutralAndNeverGetAContinuation`, `neutralAndRealReceiptsExpireAndLogoutTogetherWithoutGrantingAccess`; `registration_attempt_gate.py` | PASS; pending neutral receipts share continuation quotas and never authenticate |
| RQ-REG-03 | Reuse login's trusted Tomcat remote address; untrusted XFF/CF-Connecting-IP cannot choose quota key | `RegistrationAttemptPostgresIntegrationTest.tomcatUsesRightmostUntrustedHopAndIgnoresSpoofedHeadersFromUntrustedPeer`; existing login/continuation proxy tests | PASS; header-spoof exhaustion and untrusted-peer controls |
| RQ-REG-04 | Concurrent quotas, NAT, expiry/recovery, no enumeration, cleanup, infrastructure rollback and existing recovery protection | `concurrentSameEmailAcrossIpsAdmitsFiveAndCreatesOnlyOneAccountAndMessage`, `eightAccountsBehindNatReachBcryptBeforeAnyVerifierIsReleased`, `infrastructureFailureRollsBackAccountButKeepsAdmissionCommitted`, `recoveryAndResendKeepExistingNeutral202AndIndependentQuotas`; `registration_attempt_gate.py` | PASS; observed-lock races, bounded/SKIP LOCKED cleanup |
| RQ-IDX-01 | Inventory every FK and compare declared leading index key columns, exposing partial predicates | `fk_index_catalog.sql`; `fk_index_audit.py`; persisted before/after JSON; `fk_index_gate.sql` | PASS; V10072 FKs,12 raw/20 unconditional absences; V10311/18 |
| RQ-IDX-02 | Real predicates/RI checks, realistic data, ANALYZE/BUFFERS/WAL, costs/growth | `fk_index_audit.py --seed --benchmark --candidate-probes`; all72 FK orphan checks; public revoke-all, edition update and parent-delete probes | PASS;20k ownership/history rows,40k sessions, five samples per scenario |
| RQ-IDX-03 | Only justified indexes, forward migration, explicit rejections and Flyway lock rationale | V103; `fk_index_gate.sql` red before migration, green afterward, each selected index removal detected; ADR0057 | PASS;2 indexes;11 raw absences intentionally deferred |
| RQ-IDX-04 | Persist reproducible before/after summarized plans/timings | `docs/audit/ppa08-fk-indexes/{README.md,seed.sql,before-v103.json,after-v103.json}`; automated audit output | PASS; synthetic local measurements, no production performance claim |

## Integration evidence

- Backend: `cd backend && mvn -B --no-transfer-progress verify` —709 tests,
  0 failures/errors,33 opt-in skips; targeted schema test rerun after final response annotations.
- Disposable JDBC/HTTP: `mvn -B --no-transfer-progress -Dtest=RegistrationAttemptPostgresIntegrationTest,LoginAttemptPostgresIntegrationTest,RegistrationContinuationPostgresIntegrationTest test`
  —101/101, no skips. Default Secure cookies were used for this cookie-attribute test.
- Full `backend/src/test/postgres18/run_ci_gates.sh`: PASS, fresh Flyway104/104,
  123 named invocations plus explicit auth/plan/restricted-runtime phases. Restricted
  runtime also passed independently: cleanup applied twice, normal-role restart,
  SQL12/login16/registration8/realtime18/credential9/worker-lease9 controls.
- Populated V100→V104 packaged upgrade:4/4 checks,61 existing tables preserved.
- Existing upgrade matrix:16/16, including8/8 CI gates; one empty PostgreSQL18 DB
  per gate. Post-purchase utility ran its prepare32→migrate34→verify phases.
- `cd frontend && npm run api:types` uses the existing generator. `npx tsc --noEmit`
  passes; `npx vitest run --maxWorkers=8` passes107 files/1322 tests.
- Verbose private logs: `/tmp/pliego-realtime/logs/`, `/tmp/pliego-upgrade-*.log`.
  Sanitized retained results are in the adjacent `2026-11-03-verification-results.json`. No live
  Mailtrap message, R2 object, production account or VPS command was used.

## Changes discovered during verification

The old register endpoint exposed201/new vs409/duplicate; RQ-REG-02 required a
neutral state-only response and inert duplicate continuation. Existing dependent
HTTP fixtures now resolve their own accounts privately rather than expecting
public IDs. The shared API accepts additive fixture/server properties but only
validates/uses the neutral state; generated types describe the current wire body.

A pre-existing OpenAPI class-name collision hid the profile's decision fields
behind checkout's two-field identity schema. `StoredBillingIdentity` now has its
own schema, including an explicit null union. No UI feature file was modified.

The pre-existing extra `release_pending_upgrade_gate.py` compared whole historical
pickup rows without excluding two nullable V097 additions. Its initial failure
was exactly those new NULL keys. The gate now excludes those additive keys and
explicitly asserts both remainNULL; a fresh full V087→V104 run passes. It changes
no business SQL or historical data. No other historical gate needed repair.

Review reproduced a retention/read race and an idle200k-row cleanup scan. STABLE
read snapshots and the retention index fix them; the deterministic race test is
red before the fix and green afterward. Disposable fixture cleanup also exposed
that ephemeral hints must cascade when their user is deleted; V104 permits that
without introducing a new restriction on existing cleanup paths.

## Limits and handoff

SSE is a new backend contract; Claude owns EventSource/cross-tab coordination and
acknowledgment UI. Native EventSource initial429 needs explicit bounded retry;
the ADR documents60s backoff. Lifecycle-derived hints follow the existing10s
sweep plus publication/read intervals; REST remains authoritative. Four streams
per user and128 per process are initial engineering caps, not proven production
capacity. The runbook's Nginx stanza is documented only, never applied here.

Registration/recovery request quotas already existed for resend and forgot-
password. Token consumption in `reset-password` still computes BCrypt before
validating arbitrary reset tokens; that separate residual is documented in
ADR0056. Retention/cleanup are batch-bounded and require backlog monitoring.
Ordinary V103 index builds need a future authorized size/lock preflight; no
production cardinalities were accessed. No sandbox blocker remains for local work.

## Frontend and cross-stack (independent review and UI integration)

Reviewed against the backend above: SSE controller/stream loop, V104 trigger scoping (customer rows by owning
`usuario_id`, admin rows only `admin_scope`, acknowledgment/library never admin), email templates (all values escaped),
registration neutrality, V103 evidence. Re-verified on fresh disposable PostgreSQL 18.6 databases including V105:
`mvn verify` 778/0 failures, `run_ci_gates.sh` passed (Flyway 105:105), runtime-privileges lifecycle passed, opt-in
PostgreSQL auth tests 101/101, V100→V104 populated upgrade 4/4. Frontend: `tsc --noEmit` clean, Vitest 1323/1323
(107 files), Playwright 359 passed / 87 live-only skipped.

| Requirement | Acceptance criteria | Test(s) | Result |
|---|---|---|---|
| RQ-UI-IC-01 | A decision reads once on Mi perfil as a neutral dismissible notice; no permanent "Corregida según…" line; rejection links to its reason | `CedulaEditor.test.tsx` "reads an approval once…", "says a request was not applied…" | Pass |
| RQ-UI-IC-02 | Closing acknowledges on the server once, hides the notice, returns focus to "Corregir"; failure keeps the notice with an alert; 404/409 treated as already closed | `CedulaEditor.test.tsx` acknowledgment, failure and 409 cases | Pass |
| RQ-UI-RT-01 | A decision arriving while the page is open appears without reload and is announced politely | `CedulaEditor.test.tsx` "announces a decision…"; `realtime-identity.spec.ts` live approval | Pass |
| RQ-UI-RT-02 | One stream per browser (Web Lock leader), hints relayed to other tabs, acknowledgment in one tab closes the other, leader hand-over on close, reconnects resume | `realtime-identity.spec.ts` (stable ×3); `app/realtime/realtime.test.ts` | Pass |
| RQ-UI-RT-03 | Hints only invalidate the owning REST views per role; resync refetches private views, never the catalog; malformed hints and foreign-account relays ignored; refused streams back off 3s→60s and reconnect when online | `app/realtime/realtime.test.ts` (7 cases) | Pass |
| RQ-UI-RT-04 | Notice accessible (axe WCAG 2.2 AA), 44px close target, no horizontal scroll at 320/768px and 200% text | `realtime-identity.spec.ts` width cases | Pass |
| RQ-UI-LIB-01 | A cancelled title's address says it left Mi biblioteca and that the order and refund stay in Mis pedidos, with both destinations | `LibraryRoutes.test.tsx` 404 case | Pass |
| RQ-UI-LIB-02 | Help Center states the implemented behaviour (library, cancelled order/refund location, decision email) | V105; `storefront_help_gate.sql`, `storefront_help_http_gate.py` | Pass |
| RQ-UI-ORD-01 | "Pedido cancelado" has a finished order's prominence (display face 650) in neutral ink, never the success green, in the list and the detail | `orders-lifecycle.spec.ts` "cancelled home delivery…" computed-style assertions | Pass |
| RQ-UI-REG-01 | Registration 429 pauses like sign-in (time stated, typed data kept, "En pausa", resumes) without revealing account existence | `AuthPages.test.tsx` "pauses registration…" | Pass |
| RQ-UI-REG-02 | The waiting page never claims an account was created (neutral duplicates) and offers sign-in / password reset | `AuthPages.test.tsx`, `registration-return.spec.ts`, `email-actions.spec.ts` | Pass |
| RQ-UI-FAV-01 | Favorites keeps "Ya está en el carrito" with a persistent "Ver carrito" (digital: the cart action in place, focus returns there after the drawer; physical: link on the quantity line); no cart rule changes | `CartFeedback.test.tsx`; `cart-add-feedback.spec.ts` at 320/390/1280px | Pass |

## Release preparation (proxy, capacity, live journeys)

Reverse-proxy rows RQ-RT-PROXY-01…10 and capacity rows RQ-RT-CAP-01…14 plus the release-correction rows RQ-RT-CAP-15+
live in [2026-11-03-sse-proxy-and-capacity.md](2026-11-03-sse-proxy-and-capacity.md). Real-stack journey evidence
(identity notifications, order updates, cancelled ownership, registration protection, Favorites shortcut) and the
production read-only preflight are in [the release-candidate record](../deployment/2026-11-03-release-candidate-v101-v105.md).
