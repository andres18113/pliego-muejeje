# PLIEGO — Product Requirements Document for TestSprite

## 0. Document control

| Field | Value |
|---|---|
| Version | 1.0, evidence snapshot |
| Date | 2026-10-31 |
| Source commit | a9a46b8cff7d397ca233aed7dae1e6a3b267bfbb (verified with git rev-parse HEAD) |
| Scope | Current PLIEGO web app and REST API; local-only TestSprite input |
| Evidence boundary | Static repository analysis only. Not live verification, user research, security certification, or tax/legal opinion. |

Status legend:

- CONFIRMED — approved/latest specification and code agree.
- IMPLEMENTED-UNDOCUMENTED — code implements behavior but no matching approved product/API requirement was found.
- ASSUMPTION — evidence is incomplete; do not treat as a guarantee.
- KNOWN-DEFECT/DEVIATION — code contradicts a documented requirement or expected surface is incomplete. Do not bless observed deviation as intended behavior.
- NOT-IMPLEMENTED — no working in-scope implementation exists; do not generate a positive capability test.

Priorities describe test risk: P0 core account/catalog/purchase/data isolation; P1 important supported behavior; P2 secondary or operational behavior.

Paths are repository-relative. References use file:line, approved document section, migration, or routine. Tests are evidence, not proof of production behavior.

## 1. Product overview

### 1.1 Purpose, roles, modules

PLIEGO is an Ecuador-focused bookstore web application for discovering published physical and digital book editions, buying through an academic payment simulation, and reviewing order and digital ownership history. Backend structure is Controller → Application Service → JDBC Gateway → PostgreSQL Database API. PostgreSQL routines and constraints own business invariants and command atomicity.

Roles actually accepted by current security code:

- Anonymous visitor: public catalog, storefront navigation, published Help, geographic/reference data, and pickup locations.
- CUSTOMER: verified customer account; own profile, identity, addresses, favorites, cart, checkout, orders, invoices, eligibility and library.
- ADMIN: seeded operational account; protected APIs for customers, catalog, inventory, offers, corrections, orders, invoices and logistics.
- No separate STAFF role exists in JWT role allowlist. Public registration creates CUSTOMER only. ADMIN is bootstrapped through backend seed configuration.
- An /admin frontend route exists but is a role-gated placeholder, not an operational console. See FR-ADM-006.

Evidence: PRODUCT.md §Users/Capabilities; backend/src/main/java/com/pliego/foundation/security/JwtConfiguration.java:65-76; SecurityConfiguration.java:79-94; RegisterResponse.java:7-10; frontend/src/app/App.tsx:29-192, 294-325; backend/src/main/java/com/pliego/modules/catalog/api/AdminCatalogController.java:43-240; AdminInventoryController.java:46-115; AdminOrderController.java:51-188.

| Module | Capability |
|---|---|
| identity | Registration, verification, login, revocable refresh sessions, logout, password recovery, email change |
| customer | Profile, addresses, favorites, billing identity/corrections; ADMIN customer access |
| geo | Public Ecuador province/city catalog and validated aliases |
| catalog | Public editions, search/facets/sorts, stock/offer projections; ADMIN catalog/offers |
| cart | Active cart, saved-for-later, server-current prices and availability |
| sales | Checkout, order snapshots/cancellation, pickup, home-delivery simulation; ADMIN operations |
| billing | Simulated invoices/credit notes and private PDF/XML artifacts |
| library | Digital eligibility and ownership-only library |
| help/storefront | Public navigation and published Help |
| notifications | Transactional PostgreSQL outbox and optional Mailtrap HTTP provider |
| foundation | Authorization, Spanish errors, SQLSTATE mapping and validation |

Integration boundary:

- Payment is simulated. There is no card acquirer or real charge. API CARD checks a transient 12–19 digit Luhn number; it is not sent to PostgreSQL. Browser checkout currently always sends APPROVED; other outcomes require API tests.
- Invoice/SRI is an academic simulation. PDF/XML snapshots are rendered asynchronously; no SRI authorization, credential, certificate or SRI network call exists.
- Email is provider-based Mailtrap HTTP when enabled. Default config disables sending and leaves events queued. Automated mail gates use loopback stub; browser tests stub API responses. There is no public outbox/mailbox endpoint.
- Invoice storage defaults to private PostgreSQL bytea. Optional R2 is disabled by default and remains behind Database API access authorization.
- Catalog cover rights/attribution are shown only when supplied; no rights are inferred.

Evidence: backend/README.md:42-55, 132-140; docs/adr/0038-automatic-academic-billing.md:7-15; docs/adr/0046-academic-invoice-pdf-email-and-storage.md:9-38; CheckoutController.java:48-66, 99-105; frontend/src/shared/api/orders.ts:66-80; MailConfiguration.java:8-14; MailtrapMailSender.java:15-40; BillingConfiguration.java:13-19.

### 1.2 Glossary

| Term | Product meaning |
|---|---|
| cédula | Ecuadorian national identity, type EC_CEDULA, exactly 10 ASCII digits with structural/check-digit validation. Does not prove existence or ownership. |
| RUC | Ecuadorian taxpayer identity, type EC_RUC, exactly 13 ASCII digits with type-specific structural validation. No SRI lookup. |
| consumidor final | Not an implemented checkout recipient option; do not invent this behavior. |
| retiro en tienda | STORE_PICKUP at active pickup location, with its own state and ADMIN collection action. |
| entrega a domicilio | HOME_DELIVERY to CUSTOMER-owned Ecuador address; date window and lifecycle are server projections. |
| factura | Simulated academic invoice; explicitly not tax-valid or SRI-authorized. |
| nota de crédito | Simulated credit note issued through ADMIN API for eligible order lifecycle; not a real tax document. |
| edición | Purchasable book format: PAPERBACK, HARDCOVER, EBOOK or AUDIOBOOK. |
| oferta | Time-bounded server-calculated price projection; client does not calculate discount. |
| biblioteca | Digital ownership/history projection, not a reader, player, download or content-delivery service. |
| guardado para después | Customer cart-line holding list, independent of Favoritos. |
| ADMIN | Only elevated role. Protected REST API exists; functional admin workspace does not. |

Evidence: backend/src/main/java/com/pliego/foundation/validation/EcuadorianIdentification.java:3-12, 24-37; CheckoutRequest.java:24-47; LibraryController.java:20-38; backend/README.md:54; ADR 0041, 0043, 0046.

## 2. Test environment for TestSprite

### 2.1 Local-only endpoints and startup reference

The historical docs/deployment/2026-10-10-ux-testsprite.json is evidence of a prior validation-report shape only; its historical rollout environment is not a TestSprite target.

- Frontend Vite: http://127.0.0.1:5173.
- Backend API: http://127.0.0.1:8080; OpenAPI at /v3/api-docs; Swagger at /swagger-ui/index.html.
- Local PostgreSQL helper defaults to port 55432. This document does not authorize starting it or connecting to any running database.
- Playwright defaults to local Vite and binds to 127.0.0.1. README.md §Build and run documents ./scripts/dev.sh up/status/logs/down; down leaves PostgreSQL running. scripts/local-db.sh provides local database start/migrate/stop; backend/README.md §Reproducible local PostgreSQL 18 describes the private cluster.
- Future approved local run: install pinned Java 25/Node 24/PostgreSQL 18 dependencies, run npm ci in frontend, provision a fresh disposable local DB, then ./scripts/dev.sh up. Stop with ./scripts/dev.sh down and stop disposable DB separately with ./scripts/local-db.sh stop. Manual alternative: cd backend && mvn spring-boot:run; separate terminal cd frontend && npm run dev -- --host 127.0.0.1.
- No services were started for this PRD. Never use 127.0.0.1:55433.

Evidence: README.md §Build and run; scripts/dev.sh:22-24, 37-47, 162-218, 220-250; scripts/local-db.sh:8-10, 73-105; backend/README.md:80-107; frontend/playwright.config.ts:3-23.

### 2.2 Test data and account provisioning

- Use synthetic fixture data in a disposable database. scripts/seed-development-catalog.py is referenced by frontend/tests/e2e/purchase.live.spec.ts as development catalog setup; PostgreSQL 18 gates create disposable fixtures for JDBC/API journeys.
- Provision CUSTOMER through registration, then verify with loopback stub/outbox fixture. Registration does not sign in automatically.
- Provision ADMIN only through initial-admin seed/config in isolated DB. Generate/inject its password hash outside this document; never put account values or hashes in TestSprite source, reports, prompts or screenshots.
- If TestSprite requires credentials, inject them through private runner secret store and point only to disposable local accounts. No credential or account value is specified here.
- Reuse fixture setup patterns, not fixture identities: backend/src/test/postgres18/full_journey_http_gate.py, admin_customers_http_gate.py, billing_identity_corrections_http_gate.py.
- Reset disposable DB state between runs: accounts, outbox, cart, addresses, identity, favorites, orders, ownership, stock/offers touched by test. Clear cookies, app session and localStorage attempt recovery. Prefer recreating disposable DB over manual cleanup after failed writes.

Evidence: README.md; scripts/dev.sh; backend/README.md:96-110; migration V010; frontend/tests/e2e/purchase.live.spec.ts:7-8; backend/src/test/postgres18/run_ci_gates.sh.

### 2.3 Verification/reset email and password recovery in tests

Default config disables email sending. Events queue in PostgreSQL outbox, but no user-facing mailbox/outbox endpoint exists. transactional_email_http_gate starts a loopback Mailtrap stub and exercises verify/reset lifecycle. Browser email-action E2E intercepts API and uses synthetic tokens, not real email. TestSprite should stub email API or use loopback stub/outbox fixtures; never enable live Mailtrap delivery. Do not retain action tokens in reports.

If an isolated R2 integration is explicitly tested outside ordinary TestSprite, use a non-production namespace and remove objects. Standard TestSprite runs keep R2 disabled.

Evidence: application.yml:44-58; docs/backend/transactional-email.md:43-55, 86-104, 123-125; backend/src/test/postgres18/transactional_email_http_gate.py; email_verification_fixture.py; frontend/tests/e2e/email-actions.spec.ts; frontend/src/shared/api/attemptStorage.ts.

### 2.4 Payment simulation

No real charge, card or transfer. Use synthetic values only. API CARD requires 12–19 digits passing Luhn; TRANSFER omits cardNumber. CVV/expiry/cardholder are not API checkout fields. Current browser request hardcodes APPROVED; exercise REJECTED/PENDING through isolated API tests. Checkout requires Idempotency-Key, cart ID and quote fingerprint. A timeout must be resolved using the original key, not retried under a new one. Transfer instruction values are environment-configured; do not copy them into PRD, tests, screenshots or reports.

Evidence: CheckoutController.java:48-66, 99-105; CheckoutRequest.java:9-39; frontend/src/shared/api/orders.ts:66-127; CardNumberValidator.java; CheckoutApiIntegrationTest.java.

### 2.5 SAFETY — mandatory TestSprite boundary

- Never run TestSprite against https://pliegolibros.com, https://api.pliegolibros.com, the VPS, production domain or production account.
- Never send real email, use live transactional Mailtrap delivery, or use production/private R2.
- Use only loopback frontend/API, isolated disposable PostgreSQL 18, synthetic data and non-production accounts.
- 127.0.0.1:55433 is explicitly off limits.
- Checkout, cancellation, stock edits, account status changes, correction decisions, invoice issuance and order transitions are destructive. Never run against shared/production data.
- Reset database/outbox, account/cart/favorite/address/billing/order/ownership/stock/offer rows touched, browser cookies/session/localStorage and generated artifacts between runs.
- Never capture .local-db/, .local-secrets/, .env files, dumps, credentials, hashes, tokens, card values, personal data or provider secrets into TestSprite artifacts.

Evidence: user safety constraints; README.md; backend/README.md:82-108, 148-150; docs/deployment/production-runbook.md §1-2; docs/backend/transactional-email.md:53-55.

## 3. Global rules

### 3.1 Language, errors, identifiers

Human-facing titles/details/validation/authentication are Spanish; machine codes and SQLSTATE mappings are stable. API errors use application/problem+json with type, title, status, detail, instance, code, traceId. Validation may add field violations. Do not expose raw SQL, stack traces or provider credentials.

Exact shared examples: title “Datos inválidos”; detail “Revisa los datos enviados e intenta nuevamente.” Missing authentication detail “Debes iniciar sesión para realizar esta operación.” Forbidden detail “No tienes permiso para realizar esta operación.” Internal detail “Ocurrió un error interno. Intenta nuevamente.”

Key domain mapping examples: P1101 email conflict→409; P1104 profile conflict→409; P2041 edition missing→404; P3002 stock conflict→409; P4005 quote changed→409; P5003 not cancellable→409; P6002 digital owned→409; P6003 digital purchase pending→409. JSON IDs and money are decimal strings; money has two decimals; paged counts are strings.

Evidence: ProblemResponse.java:7-17; ApiExceptionHandler.java:30-37, 51-60, 123-162, 179-200, 247-317, 320-463; DatabaseError.java:11-82; PageResponse.java:5-10; backend/README.md:132-144.

### 3.2 Auth, session, CSRF and CORS

Access JWT is Bearer, valid 30 minutes; browser keeps access authority in memory and restores via refresh. Login issues opaque refresh in host-only pliego_session cookie, HttpOnly, SameSite=Strict, path /api/v1/auth, Secure by default, absolute session maximum 30 days. Refresh rotates; logout revokes and clears.

Refresh/logout POSTs require X-PLIEGO-SESSION-REQUEST: 1. Missing/invalid auth is 401; authenticated wrong role is 403. /api/v1/admin/** requires ADMIN; customer protected routes require CUSTOMER. Spring CSRF middleware is disabled for bearer APIs; exact-origin credentialed CORS and request marker protect cookie mutation. CORS methods GET/POST/PUT/PATCH/DELETE/OPTIONS; allowed headers Authorization, Content-Type, Idempotency-Key, X-PLIEGO-SESSION-REQUEST; exposes X-Trace-Id; default origins empty and wildcard is not allowed.

Evidence: AuthSessionCookie.java:10-42; AuthSessionRequestFilter.java:14-42; SecurityConfiguration.java:52-123; AuthController.java:32-117; backend/README.md:132; amendment 0004; ADR 0010.

### 3.3 Pagination, filters, dates, currency and IVA

- Paged APIs: page zero-based, default 0; pageSize default 20, range 1–50; response {items,page,pageSize,totalCount}.
- Catalog search limit 140; sort TITLE_ASC/TITLE_DESC/PRICE_ASC/PRICE_DESC/BEST_SELLING. Offer sort RELEVANCE/ENDING_SOON/PRICE_ASC/PRICE_DESC. Invalid filters return 400 Spanish validation details. Unknown valid category returns empty page; inactive category returns 409.
- Datetimes are RFC3339/ISO offset date-time; date-only values YYYY-MM-DD; order display uses es-EC.
- Money is authoritative PostgreSQL projection, USD, two decimal places. Browser displays rather than recalculates totals/discount/tax/shipping. Current Ecuador IVA is 0% per ADR 0033 and V067.
- Catalog/offers preserve filter state in URL; changed filter/sort resets page. Digital eligibility accepts 1–50 positive IDs.

Evidence: CatalogController.java:54-87, 89-115, 141-155; DigitalEligibilityController.java:38-50; ApiExceptionHandler.java:191-200; purchaseText.ts:37-51; ADR 0033; migrations V038, V041, V067, V078, V079.

### 3.4 Accessibility and responsive baseline

Repository declares no formal WCAG level. Evidence covers specific keyboard/focus/label/error/responsive behaviors and scoped Chromium accessibility-tree checks only; do not call product WCAG compliant.

Test viewport probes required here: 320, 390, 768, 1280 CSS pixels. Existing sorting tests use 320/390/1280; responsive evidence includes 320/375/1280. These are test widths, not all CSS breakpoints. Catalog filters collapse at ≤480; catalog uses two columns ≤740, three 741–1050, four above 1050; checkout summary changes at 900. Playwright project is Chromium only. Firefox, WebKit/Safari and screen-reader compatibility are unverified.

Keyboard focus must be visible; fields have labels, invalid state and associated error; loading/errors use named announcements. Test via DOM/accessibility tree and keyboard paths.

Evidence: docs/design/PLIEGO_FRONTEND_DESIGN_LANGUAGE.md §Layout and §Focus; docs/testing/p1-accessibility-verification-2026-10-04.md:13-33; p1-accessibility.spec.ts; production-responsive.spec.ts; testsprite-catalog-sorting.spec.ts:7-54; frontend/playwright.config.ts:16-23.

## 4. Functional requirements

Each requirement block includes Title/ID, Status, Priority, Roles, Source traceability, Preconditions, Main flow, Alternative flows, Validations, Business constraints, Error handling, Edge cases, Acceptance criteria, and Test notes.

### Identity and account

#### FR-AUTH-001 — Register CUSTOMER

- Status: CONFIRMED. Priority: P0. Roles: anonymous.
- Source traceability: AuthController.java:44-55; RegisterRequest.java:15-25; PasswordPolicy.java:5-16; migrations V037/V039; routine sp_customer_register_with_verification; docs/backend/transactional-email.md:29-39; AuthPages.tsx:22-49, 215-260; AuthApiIntegrationTest; registration-return.spec.ts.
- Preconditions and main flow: no session; submit names/email/password/optional phone; create CUSTOMER in PENDING_VERIFICATION; show confirmation; do not sign in.
- Alternative flows: duplicate email conflict; invalid input remains correctable.
- Validations: email required/formatted/max254; password ≥8 Unicode code points and ≤72 UTF-8 bytes; names ≤120 code points; optional phone follows Ecuador rules.
- Business constraints: CUSTOMER only; password BCrypt; account and verification outbox event atomic.
- Error handling: 400 VALIDATION_ERROR title “Datos inválidos”, detail “Revisa los datos enviados e intenta nuevamente.”; field texts “El correo es obligatorio.”, “Usa al menos 8 caracteres.”; duplicate 409 P1101 title “Correo ya registrado”, detail “Ya existe una cuenta con ese correo electrónico.”
- Edge cases: Unicode code points and bytes differ; registration never authenticates.
- Acceptance criteria:
  - API — Given unique valid input, when POST /api/v1/auth/register, then 201, state PENDING_VERIFICATION, no authenticated session.
  - API — Given duplicate email, then 409 P1101 and exact duplicate detail above.
  - UI — Given valid form, when submitted, then confirmation replaces form and no session is established.
- Test notes: unique synthetic account in disposable DB; destructive. Remove account/outbox or discard DB.

#### FR-AUTH-002 — Verify and resend email

- Status: CONFIRMED. Priority: P0. Roles: anonymous.
- Source traceability: EmailActionController.java:24-43; EmailActionRequests.java:14-24; ApiExceptionHandler.java:144-149; EmailActionPages.tsx:110-150; migrations V039/V066/V070; transactional_email_http_gate.py; email-actions.spec.ts.
- Preconditions and main flow: registration/action queued; browser reads token from fragment, removes it from history, POSTs JSON token, then returns to safe local intent; verification never logs in.
- Alternative flows: missing/expired/used token offers resend; resend response stays neutral.
- Validations: token exactly 43 URL-safe characters; email max254; return path max2048 and local-only. Verification expires at 24h, single-use; resend invalidates earlier token.
- Business constraints: generic response; one-minute cooldown; max five per email and twenty per source IP/hour.
- Error handling: invalid 400 EMAIL_ACTION_INVALID, title “Enlace inválido”, detail “El enlace venció, ya fue utilizado o no es válido. Solicita uno nuevo.”; resend 202 exact text “Si la cuenta cumple los requisitos, recibirás un correo con los pasos a seguir.”
- Edge cases: stale response cannot override latest link; unsafe external return goes to safe path.
- Acceptance criteria:
  - API — Valid token POST /verify-email returns 204.
  - API — Unknown/blocked/limited email POST /resend-verification returns 202 with same neutral text.
  - UI — Malformed link sends no verification command and offers “Solicitar otro enlace”.
- Test notes: loopback stub only; single-use/destructive; reset DB/browser state.

#### FR-AUTH-003 — Login and logout

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER, ADMIN.
- Source traceability: AuthController.java:58-117; LoginRequest.java:10-17; AuthSessionCookie.java:10-42; SecurityConfiguration.java:52-68; ApiExceptionHandler.java:123-149; AuthPages.tsx:56-120, 141-207; migrations V026-V028/V039; AuthApiIntegrationTest; session.live.spec.ts.
- Preconditions and main flow: active valid credentials, verified CUSTOMER; login returns JWT and refresh cookie; CUSTOMER returns safe intent; ADMIN navigates /admin; logout revokes cookie session.
- Alternative flows: correct password/unverified is distinct 403 with resend link; absent/blocked/wrong password generic 401.
- Validations: email max254 valid; password non-empty, ≤72 UTF-8 bytes at login.
- Business constraints: roles CUSTOMER/ADMIN; blocked user cannot create session; login does not reveal account existence.
- Error handling: 401 AUTH_INVALID_CREDENTIALS title “Credenciales inválidas”, detail “El correo o la contraseña son incorrectos.”; 403 EMAIL_NOT_VERIFIED title “Verifica tu correo”, detail “Confirma tu correo para acceder a tu cuenta. Puedes solicitar otro enlace de verificación.”; logout 204.
- Edge cases: ADMIN page is placeholder only.
- Acceptance criteria:
  - API — Valid verified login returns 200, Bearer type and host-only HttpOnly cookie.
  - API — Missing/invalid auth is 401; wrong role 403 ACCESS_DENIED, detail “No tienes permiso para realizar esta operación.”
  - API — POST /logout with valid cookie and marker returns 204 and clearing cookie.
  - UI — Successful CUSTOMER login shows “Inicio de sesión correcto. Abriendo tu cuenta…”.
- Test notes: disposable role accounts; clear cookie and memory session.

#### FR-AUTH-004 — Refresh persistent session

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER, ADMIN.
- Source traceability: AuthController.java:72-101; AuthSessionCookie.java:14-42; AuthSessionRequestFilter.java:14-42; SecurityConfiguration.java:70-97; migrations V026-V028; amendment 0004; auth_session_http_gate.py; authSessionRecovery.test.ts.
- Preconditions and main flow: valid unrevoked refresh cookie and marker header; POST refresh rotates credential and restores role/access token; absolute session max30 days.
- Alternative flows: absent/expired/revoked cookie becomes signed-out; missing marker forbidden.
- Validations: marker exact value 1; access JWT 30min.
- Business constraints: DB stores digest, not refresh credential; reset/email change revokes refresh sessions.
- Error handling: missing marker 403 ACCESS_DENIED, “No tienes permiso para realizar esta operación.”
- Edge cases: rotated token replay rejected; app fails closed when required coordination fails.
- Acceptance criteria:
  - API — Valid cookie + marker POST /refresh returns 200 and rotated cookie.
  - API — Cookie without marker returns 403 ACCESS_DENIED.
  - UI — Reload with valid refresh session restores protected route without login form.
- Test notes: refresh mutates session; disposable browser/session only.

#### FR-AUTH-005 — Recover password

- Status: CONFIRMED. Priority: P0. Roles: anonymous.
- Source traceability: EmailActionController.java:31-50; EmailActionRequests.java:14-29; ApiExceptionHandler.java:144-149; EmailActionPages.tsx:152-202; migrations V039/V070; transactional_email_http_gate.py; EmailActionPages.test.tsx.
- Preconditions and main flow: request reset, read one-time token from loopback outbox, set/confirm password, clear current frontend session.
- Alternative flows: unknown/blocked/limited account gets identical response; invalid token offers new request.
- Validations: email max254; token 43 chars; password ≥8 code points/≤72 bytes; confirmation exact match.
- Business constraints: token expires at 15min, single-use; reset revokes refresh sessions and pending actions; existing access JWT may remain until max30min expiry.
- Error handling: 202 exact neutral text “Si la cuenta cumple los requisitos, recibirás un correo con los pasos a seguir.”; invalid 400 EMAIL_ACTION_INVALID; UI texts “Usa al menos 8 caracteres.”, “La contraseña es demasiado larga. Usa una más corta.”, “Las contraseñas no coinciden.”
- Edge cases: no account enumeration; unknown request outcome is not auto-retried.
- Acceptance criteria:
  - API — Any validly formatted email POST /forgot-password returns 202 with same response.
  - API — Valid unused token POST /reset-password returns 204 and revokes refresh sessions.
  - UI — Mismatched password shows “Las contraseñas no coinciden.” and sends no request.
- Test notes: local stub; password update destructive; discard DB.

#### FR-CUS-001 — Maintain profile and account email

- Status: CONFIRMED. Priority: P1. Roles: CUSTOMER.
- Source traceability: CustomerController.java:56-113; ProfileUpdateRequest.java:14-28; EmailChangeRequest.java; PersonRules.java:9-42; migrations V035-V039/V066/V068; routines sp_customer_update_versioned, sp_customer_patch, sp_customer_change_email; CustomerApiIntegrationTest; customer_email_change_gate.py; ProfileDraft.test.tsx.
- Preconditions and main flow: GET /me; update names/phone with expectedVersion; change email with current password and verify new address.
- Alternative flows: PATCH one allowed field; stale version reloads current profile.
- Validations: names 1–120 code points; optional Ecuador phone +593, mobile 9 digits/fixed 8; expectedVersion nonnegative 64-bit decimal; new email max254; current password max256.
- Business constraints: actor is JWT; optimistic concurrency; email change revokes refresh and requires new verification; email change rate ≤5/user/hour.
- Error handling: stale 409 P1104 title “Tu perfil cambió”, detail “Tus datos cambiaron desde que empezaste a editar. Revisa el perfil actual antes de guardar de nuevo.”; duplicate 409 P1101 detail “Ya existe una cuenta con ese correo electrónico.”; wrong current password 400 CURRENT_PASSWORD_INVALID.
- Edge cases: phone formatting normalized; validation does not prove reachability.
- Acceptance criteria:
  - API — Given current expectedVersion, when PUT /api/v1/me succeeds, then status is 204 and a following GET confirms the updated version.
  - API — Stale expectedVersion returns 409 P1104 and exact detail above.
  - API — Correct current password + unused email, when PUT /api/v1/me/email succeeds, returns status 200 and reports emailVerified=false until confirmation.
- Test notes: synthetic CUSTOMER; profile/email change destructive; discard DB.

#### FR-BIL-001 — Maintain cédula/RUC billing identity

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER.
- Source traceability: BillingIdentityController.java:25-50; BillingIdentityRequest.java:8-15; EcuadorianIdentification.java:3-37; migrations V071/V074/V075/V080; routines fn_is_valid_ec_identification, fn_customer_billing_identity_read_model; ADR 0037/0040/0041/0043; BillingIdentityApiIntegrationTest; CedulaEditor.tsx.
- Preconditions and main flow: CUSTOMER reads and saves EC_CEDULA or EC_RUC; checkout reuses identity for ACCOUNT recipient.
- Alternative flows: once account identity appears on invoice, correction may require review.
- Validations: cédula 10 ASCII digits, RUC 13; province prefix 01–24 or 30 and type-specific structure/check digit; trim ASCII spaces only.
- Business constraints: algorithm does not prove identity exists/owned; invoice snapshots immutable; checkout requires valid identity.
- Error handling: 400 field text “Ingresa una cédula (10 dígitos) o un RUC (13 dígitos) válidos”; P1106 detail “La factura usa la cédula o el RUC registrado en tu perfil. Si es incorrecto, corrígelo en Mi perfil.”; P1107 detail “Esta identificación ya figura en una factura. Solicita la corrección para que la revisemos.”
- Edge cases: distinguish cédula/person RUC/public/private entity structures.
- Acceptance criteria:
  - API — Valid type-number pair, when PUT /api/v1/me/billing-identity succeeds, returns status 204; following GET returns normalized identity.
  - API — Wrong length/check digit returns 400 with exact identification message above.
  - UI — Unsaved invalid identity is never shown as saved.
- Test notes: shared synthetic vectors only; never include real-looking ID in tests/reports; write destructive.

#### FR-BIL-002 — Request/withdraw/review identity correction

- Status: CONFIRMED. Priority: P1. Roles: CUSTOMER; ADMIN decision via API.
- Source traceability: BillingIdentityController.java:25-74; BillingIdentityCorrectionRequests.java:15-35; AdminBillingIdentityCorrectionController.java:28-59; migration V080; routines sp_customer_billing_identity_correction_request_submit, fn_admin_billing_identity_correction_requests, sp_admin_billing_identity_correction_decide; ADR 0040/0043; BillingIdentityCorrectionApiIntegrationTest; billing_identity_corrections_http_gate.py; IdentityCorrectionPage.tsx.
- Preconditions and main flow: billed current identity requires review; customer submits proposal/reason/note and may withdraw pending; ADMIN lists/decides.
- Alternative flows: identity not requiring review uses direct correction; only one pending request; stale compare number conflicts.
- Validations: current number 10 or 13 digits; reason DOCUMENT_TYPO/DOCUMENT_CHANGED/OTHER; note max500; proposed identity validated; rejection requires Spanish reason.
- Business constraints: request customer-bound and compare-and-set; approval changes identity; customer cannot see another account request.
- Error handling: P1108 detail “Ya existe una solicitud de corrección pendiente para esta cuenta.”; P1111 detail “La solicitud ya no está pendiente y no puede cambiarse.”; missing reject reason “Escribe en español el motivo del rechazo.”
- Edge cases: concurrent withdraw/decision has one winner; replay cannot duplicate.
- Acceptance criteria:
  - API — Valid required-review request returns 201 and exactly one PENDING request.
  - API — ADMIN rejects without reason: 400 VALIDATION_ERROR and exact field text above.
  - API — Second decision after final state returns 409 P1111.
- Test notes: synthetic identity only; correction decision sensitive/destructive; disposable DB.

#### FR-GEO-001 — Browse Ecuador province/city catalog and aliases

- Status: CONFIRMED. Priority: P1. Roles: anonymous.
- Source traceability: GeoController.java:19-45; GeoService.java; migration V082 routines fn_geo_provinces/fn_geo_cities/fn_geo_resolve_address; ADR 0044; geo_catalog_http_gate.py; geo_alias_http_gate.py; ProvinceCityFields.tsx; geo-fixtures.ts.
- Preconditions and main flow: GET provinces then cities for selected province; choose matched IDs. DB aliases include Bucay, Playas and Playas (Gral. Villamil), resolved to canonical selectable location.
- Alternative flows: legacy paired city/province names are compatibility only.
- Validations: positive decimal province ID ≤ signed64; city active and in province; country EC.
- Business constraints: canonical INEC catalog read-only; aliases unique/collision checked; ambiguous place names not silently resolved.
- Error handling: P5014 400 detail “La ciudad no pertenece a la provincia seleccionada.”; P5015 400 detail “Elige una ciudad de la lista.”
- Edge cases: duplicate city names require province.
- Acceptance criteria:
  - API — Valid province returns 200 list of active cities and aliases.
  - API — Mismatched city/province returns 400 P5014 and exact detail above.
  - UI — Province change loads city options for that province; save uses chosen IDs.
- Test notes: catalog reads safe; address write destructive; synthetic content only.

#### FR-CUS-002 — Manage delivery addresses

- Status: CONFIRMED. Priority: P1. Roles: CUSTOMER.
- Source traceability: CustomerController.java:56-171; AddressRequest.java:16-63; migrations V020/V036/V037/V082; routines sp_address_create_idempotent, sp_address_create_resolve, sp_address_update/delete/set_primary; amendment 0010 and geo catalog amendment; CustomerApiIntegrationTest; addresses.spec.ts.
- Preconditions and main flow: CUSTOMER lists/creates/edits/deletes addresses and sets primary; create has Idempotency-Key and resolve path.
- Alternative flows: zero addresses allowed; checkout can use shared address editor.
- Validations: alias1–80; recipient≤241 code points; line1 1–200; line2≤200; postal≤20; reference≤300; Ecuador phone; country EC; primary flag required; province/city IDs paired.
- Business constraints: actor-owned, one primary; deleting primary uses DB replacement; other country rejected.
- Error handling: field messages “El alias es obligatorio.”, “La dirección principal es obligatoria.”, “Las entregas están disponibles únicamente en Ecuador.”, “Envía provinceId y cityId juntos, o ciudad y provincia juntos.”; 404 P1103 detail “La dirección solicitada no existe o no está disponible para tu cuenta.”
- Edge cases: same idempotency key/different body conflicts; concurrent primary changes serialize.
- Acceptance criteria:
  - API — Valid address POST returns 201 and actor-owned address.
  - API — After setting another primary, address list has exactly one primary=true.
  - UI — Saved address appears with alias and can be selected at checkout.
- Test notes: synthetic addresses; create/edit/delete destructive; reset fixture.

### Storefront and catalog

#### FR-CAT-001 — Navigation, search, filters, sorting and pagination

- Status: CONFIRMED. Priority: P0. Roles: anonymous, CUSTOMER.
- Source traceability: CatalogController.java:54-155; StorefrontController.java:10-18; migrations V022/V023/V030/V031/V046/V050/V078/V079; routines fn_catalog_search_global/fn_public_catalog_categories/fn_public_catalog_filter_options; ADR 0013/0014/0027/0035; CatalogApiIntegrationTest; testsprite-catalog-sorting.spec.ts:1-54; catalog_search_fold_http_gate.py.
- Preconditions and main flow: public navigation/categories/facets load; query searches ISBN exact or partial title/author; filters category/title/author/ISBN/price/language/format/type; URL retains state.
- Alternative flows: global query precedence; unknown valid category empty; inactive category 409; accent-insensitive search and Spanish title order.
- Validations: query≤140; ISBN13 digits; price≥0; language 2–3 letters; formats PAPERBACK/HARDCOVER/EBOOK/AUDIOBOOK; types PHYSICAL/EBOOK/AUDIOBOOK; sort TITLE_ASC/TITLE_DESC/PRICE_ASC/PRICE_DESC/BEST_SELLING; page≥0; pageSize1–50 default20.
- Business constraints: page shape {items,page,pageSize,totalCount}; count string; PostgreSQL owns result/order/count.
- Error handling: 400 VALIDATION_ERROR detail “Revisa los filtros enviados e intenta nuevamente.”; exact field text “La búsqueda no puede superar 140 caracteres.” and “El orden debe ser TITLE_ASC, TITLE_DESC, PRICE_ASC, PRICE_DESC o BEST_SELLING.”
- Edge cases: sort/filter resets page and preserves other query keys; beyond-last page empty.
- Acceptance criteria:
  - API — Accent-insensitive query returns matching rows, status 200.
  - UI — At 320/390/1280, fixture of 13 titles/pageSize2 orders correctly ascending/descending; filters stay in URL and page resets.
  - API — pageSize=51 returns 400 with “El tamaño de página debe ser un número entero entre 1 y 50.”
- Test notes: GET; stable synthetic catalog fixture; do not change offers/stock to arrange results.

#### FR-CAT-002 — Edition detail, covers and stock status

- Status: CONFIRMED. Priority: P0. Roles: anonymous, CUSTOMER.
- Source traceability: CatalogController.java:117-165; CatalogEditionDetailResponse.java; migrations V013/V016/V032/V045/V047/V049; routines fn_edition_detail/fn_digital_eligibility; EditionDetailPage.tsx; StockStatus.tsx; BookCover.tsx; EditionDetailPage.test.tsx; StockRobustness.test.tsx.
- Preconditions and main flow: public edition exists; show supplied facts, price, availability, format, digital metadata and cover metadata.
- Alternative flows: missing/inactive is unavailable; missing/unsafe/failed cover shows “Portada no disponible”.
- Validations: positive edition ID; supported physical/digital formats.
- Business constraints: availability is server projection, not stock count; cart reserves nothing; checkout revalidates.
- Error handling: 404 P2041 title “Edición no encontrada”, detail “La edición solicitada no está disponible.”
- Edge cases: stock can change between detail/cart/checkout; never infer cover rights.
- Acceptance criteria:
  - API — Published ID detail returns 200 and authoritative availability.
  - API — Missing public ID returns 404 P2041 and exact detail above.
  - UI — Failed/missing cover displays “Portada no disponible”, no generated jacket.
- Test notes: GET-only; fixture catalog.

#### FR-CAT-003 — Public offers and admin offer projection

- Status: CONFIRMED. Priority: P1. Roles: anonymous/CUSTOMER browse; ADMIN manage by API.
- Source traceability: CatalogController.java:89-115; EditionOfferController.java:24-47; migrations V044/V050-V054/V078; routines fn_catalog_search_offers/sp_edition_offer_set/remove; ADR 0025/0028; OffersPage.test.tsx; offers_http_gate.py; offers.spec.ts.
- Preconditions and main flow: active offers exist; browse server offer values; ADMIN PUT/DELETE offer.
- Alternative flows: no active results empty; offer sorts RELEVANCE/ENDING_SOON/PRICE_ASC/PRICE_DESC.
- Validations: pageSize1–50; dates ordered; discount positive and ≤base price.
- Business constraints: DB calculates effective price/savings; checkout snapshots immutable and quote rechecked.
- Error handling: inactive edition 409 P2042 detail “La edición no está disponible para esta operación.”; invalid filter 400.
- Edge cases: offer expiry between browse/checkout requires review.
- Acceptance criteria:
  - API — Offer response exposes effectivePrice/savings as server amounts with two decimals.
  - API — CUSTOMER/anonymous admin offer write returns 401/403; ADMIN can mutate fixture edition.
  - UI — Card/detail use same server effective price.
- Test notes: browse safe; offer change destructive/date-sensitive; isolated DB only.

### Favorites and cart

#### FR-FAV-001 — Maintain own favorites

- Status: CONFIRMED. Priority: P1. Roles: CUSTOMER.
- Source traceability: CustomerController.java:173-215; migrations V029/V078; routines fn_customer_favorites/sp_customer_favorite_add/remove; amendment 0005; CustomerApiIntegrationTest; FavoritesPage.tsx:99-145; favorites.spec.ts; favorites.live.spec.ts.
- Preconditions and main flow: authenticated customer adds/removes edition and views current price/availability.
- Alternative flows: sign-in intent returns to safe local destination; stale result cannot overwrite newer action; empty page offers catalog.
- Validations: positive edition ID; paging bounds.
- Business constraints: per-customer and separate from cart/saved list; add/remove state-idempotent.
- Error handling: missing auth 401; wrong role 403; inactive edition maps P2042.
- Edge cases: removing last item from later page shows empty-page recovery.
- Acceptance criteria:
  - API — PUT /api/v1/me/favorites/{editionId} returns 204; subsequent GET status marks favorite=true.
  - UI — Empty list heading “Todavía no tienes favoritos” and action “Explorar el catálogo”.
  - UI — Removed last row on later page shows “No hay más ediciones en esta página.”
- Test notes: writes destructive; disposable account/edition.

#### FR-CART-001 — Edit active cart

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER.
- Source traceability: CartController.java:46-120; CartRequests.java:15-27; ExactQuantity.java:16-24; migrations V005/V016/V025/V051/V063/V065/V083; routines fn_cart_get/sp_cart_add_item/update_item/remove_item; CartApiIntegrationTest; CartPage.tsx:35-40, 148-226, 320-350; cart-presentation.spec.ts.
- Preconditions and main flow: authenticated customer; add edition, read current subtotal/availability, update quantity, remove.
- Alternative flows: unavailable item stays visible and blocks checkout until adjusted/removed.
- Validations: edition ID positive; quantity whole number 1–2,147,483,647; fractional/scientific values rejected.
- Business constraints: no stock reservation; DB checks active edition/book and stock; price from current server projection.
- Error handling: 400 P4004 detail “La cantidad debe ser mayor que cero.”; 409 P3002 detail “No hay existencias suficientes para la cantidad solicitada.”; changed quote P4005.
- Edge cases: failed update keeps previous quantity; final-unit race rechecked on checkout.
- Acceptance criteria:
  - API — Add available edition returns cart line with server amount and availability.
  - API — Fractional quantity returns 400 and “Escribe una cantidad entera de hasta 2147483647, sin decimales.”
  - UI — Unavailable row stays visible, checkout disabled and copy “Ajusta o quita los libros no disponibles para continuar con la compra.”
- Test notes: cart writes destructive; disposable customer/catalog; clear cart afterward.

#### FR-CART-002 — Digital single-copy eligibility and duplicate prevention

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER.
- Source traceability: DigitalEligibilityController.java:26-50; migrations V032/V045/V047/V076/V077; routines fn_digital_eligibility/fn_guard_digital_ownership_identity; ADR 0016/0026/0042; digital_single_copy_http_gate.py; digital_single_copy_concurrency.py; digital-single-copy.spec.ts.
- Preconditions and main flow: customer eligibility query for 1–50 editions; existing owned/open digital item displays owned/in-cart state.
- Alternative flows: nonexistent, physical or inactive edition is not purchasable; backend rechecks at checkout.
- Validations: list 1–50 positive IDs; digital quantity exactly one.
- Business constraints: one valid digital copy per customer/edition, one open purchase; serialized in PostgreSQL; refund revokes source entitlement only if no other valid purchase remains.
- Error handling: 409 P6002 detail “Esta edición digital ya está en tu biblioteca. Puedes consultarla sin volver a comprarla.”; P6003 detail “Ya tienes un pedido abierto con esta edición digital. Revisa ese pedido antes de intentar otra compra.”
- Edge cases: simultaneous checkout attempts allow at most one open purchase.
- Acceptance criteria:
  - API — Owned edition eligibility=OWNED; duplicate checkout returns P6002 and does not create another sale.
  - API — Concurrent requests create at most one valid ownership/open order.
  - UI — Owned/in-cart item has no duplicate purchase action.
- Test notes: checkout/ownership destructive; isolated PostgreSQL 18 only.

#### FR-CART-003 — Guardado para después

- Status: CONFIRMED. Priority: P1. Roles: CUSTOMER.
- Source traceability: CartController.java:57-98; migration V083 routines fn_cart_saved_list/sp_cart_save_for_later/sp_cart_saved_move_to_cart/sp_cart_saved_remove; ADR 0045; SavedForLater.tsx:18-46; cart_saved_for_later_http_gate.py; cart-saved-for-later.spec.ts.
- Preconditions and main flow: owned cart line or saved line; move between cart and holding list or delete.
- Alternative flows: unavailable item remains saved and reports current reason.
- Validations: positive IDs; actor-owned line only.
- Business constraints: independent from Favorites; quantity retained; stock/price rechecked on move.
- Error handling: 404 P4006 detail “El artículo guardado no existe o no está disponible en tu lista.”; stock conflict P3002.
- Edge cases: repeated move/remove cannot affect another customer.
- Acceptance criteria:
  - API — POST save-for-later returns 200, removes item from active cart and lists it once as saved.
  - UI — Empty section says “Guardado para después” and “No hay libros guardados”.
  - API — POST move-to-cart returns 200, restores quantity and recalculates server availability; DELETE saved returns 204.
- Test notes: mutates cart/saved data; disposable account.

### Checkout and orders

#### FR-CHK-001 — Select fulfillment and billing recipient/address

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER.
- Source traceability: CheckoutRequest.java:9-68; CheckoutController.java:48-66; PickupLocationController.java; migrations V040/V043/V055-V059/V068/V081/V082; ADR 0021/0024/0029/0034/0043/0044; CheckoutPage.tsx:661-680, 800-907; PickupLocationPicker.tsx; store-pickup.spec.ts; store_pickup_http_gate.py.
- Preconditions and main flow: active nonempty cart; choose HOME_DELIVERY/address, STORE_PICKUP/location, or DIGITAL_ONLY/no destination. Billing recipient ACCOUNT or OTHER; OTHER is invoice-only.
- Alternative flows: no pickup location shows “No hay puntos de retiro disponibles. Puedes elegir Entrega o volver a consultar más tarde.”; separate invoice address for pickup/digital; home delivery may reuse delivery address.
- Validations: fulfillment enum exact; destination shape mutually exclusive; pickup requires physical line; ACCOUNT/OTHER exact; buyerName max240; billing identity and address required.
- Business constraints: DB revalidates address ownership/location activity; no browser-invented delivery date; OTHER does not mutate profile.
- Error handling: P5004 “La dirección seleccionada no está disponible.”; P5010 “El punto de retiro seleccionado no existe.”; P5011 “El punto de retiro está inactivo. Selecciona otro.”; P5012 “El retiro en tienda requiere al menos un producto físico.”
- Edge cases: switching modes clears incompatible destination; invoice address remains distinct unless user chooses reuse.
- Acceptance criteria:
  - API — HOME_DELIVERY with valid owned address passes destination validation.
  - API — STORE_PICKUP with digital-only cart returns 400 P5012 and exact message above.
  - UI — Empty pickup list shows exact empty message and blocks submission.
  - UI — OTHER recipient labels field “Nombre o razón social” and shows “Solo para esta factura.”
- Test notes: checkout creates order; destructive; isolated database.

#### FR-CHK-002 — Submit simulated checkout and resolve outcomes

- Status: CONFIRMED for API; browser limitation DV-002. Priority: P0. Roles: CUSTOMER.
- Source traceability: CheckoutController.java:35-105; CheckoutRequest.java:9-47; CardNumberValidator.java; migrations V017/V036/V041/V063/V065/V067/V076/V081; routines sp_checkout_quoted/fn_checkout_resolve; ADR 0022/0030/0033/0042; CheckoutApiIntegrationTest; checkout_http_gate.py; frontend/src/shared/api/orders.ts:66-127; purchase.spec.ts.
- Preconditions and main flow: valid accepted quote, billing and fulfillment; POST with Idempotency-Key. API represents APPROVED, REJECTED, PENDING; standard UI always submits APPROVED.
- Alternative flows: quote/stock/address/digital conflict rejected before effects; response loss resolves same attempt.
- Validations: CARD/TRANSFER; CARD 12–19 digit Luhn; TRANSFER omits number; cart ID positive; quote fingerprint 64 lowercase hex; amounts server-provided.
- Business constraints: no real charge; cardNumber write-only/transient and not sent to PostgreSQL; approval creates CONFIRMED/APPROVED; rejection returns 201 with CANCELLED/REJECTED and cart active; pending payment can await ADMIN; IVA 0%.
- Error handling: invalid card 400 INVALID_CARD_NUMBER, title “Tarjeta inválida”, detail “El número de tarjeta no es válido.”; changed quote P4005 detail “Los productos, las cantidades o los precios cambiaron. Revisa el total actualizado antes de confirmar la compra.”; stock conflict “Uno o más libros ya no tienen existencias suficientes.”
- Edge cases: HTTP 201 may describe rejected payment; timeout is unknown, not safe retry.
- Acceptance criteria:
  - API — APPROVED valid checkout returns 201, order CONFIRMED and payment APPROVED.
  - API — REJECTED returns 201, order CANCELLED/payment REJECTED, no stock sale, cart stays active.
  - API — Resolve returns PENDING/NOT_CREATED/CREATED and exact order when created.
  - UI — Checkout sends APPROVED and only cardNumber for CARD; UI does not claim real charge.
- Test notes: no real cards/payment. Checkout mutates order/stock/cart/outbox; destructive.

#### FR-CHK-003 — Recover uncertain checkout without duplicate command

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER.
- Source traceability: CheckoutController.java:69-75; migrations V036/V063/V065; routine fn_checkout_resolve; amendment 0010; attemptStorage.ts; orders.ts:80-127; accepted_quote_http_gate.py; p1-attempts.spec.ts.
- Preconditions and main flow: command started with key/accepted quote; UI blocks submit after ambiguous outcome and resolves key.
- Alternative flows: PENDING remains blocked; NOT_CREATED permits new attempt only after server confirmation.
- Validations: key UUID; browser requires localStorage/Web Locks.
- Business constraints: immutable command receipt; same key/different payload conflicts.
- Error handling: unknown read text “Aún no pudimos consultar el resultado” and “Comprueba tu conexión. La compra sigue sin resolverse.”; P1010 title “Intento con datos diferentes”.
- Edge cases: reload/tabs share attempt; clearing recovery metadata loses automatic resolution but not server receipt.
- Acceptance criteria:
  - API — Resolve existing attempt returns 200 state matching server ledger.
  - UI — After simulated network loss, exactly one checkout POST occurs before resolution.
- Test notes: possible order write; destructive disposable DB; retain browser state during recovery.

#### FR-ORD-001 — List/view own orders and snapshots

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER.
- Source traceability: CustomerOrderController.java:40-121; migrations V034/V045/V048/V058/V077; routines fn_customer_orders/fn_customer_order_detail; ADR 0017/0026; CustomerOrderApiIntegrationTest; OrdersPage.tsx:105-161; orders-lifecycle.spec.ts.
- Preconditions and main flow: customer session; list own paged orders; open detail with line/address/payment/history and server actions.
- Alternative flows: another owner order is hidden as not found; optional legacy projection may be absent.
- Validations: positive ID; page0+, size1–50 default20.
- Business constraints: actor from JWT; history is snapshot, not recalculated; client never infers shipment state.
- Error handling: 404 P5001 detail “El pedido solicitado no existe o no está disponible para tu cuenta.”
- Edge cases: legacy optional projection can be absent; render less rather than guess.
- Acceptance criteria:
  - API — Customer A GET of Customer B order returns 404 and no owner data; own order list/detail return 200.
  - UI — List item action is “Ver pedido”; detail shows returned state, total and item snapshot.
- Test notes: GET only; synthetic orders.

#### FR-ORD-002 — Order transitions and cancellation

- Status: CONFIRMED. Priority: P1. Roles: CUSTOMER read/cancel; ADMIN transitions.
- Source traceability: CustomerOrderController.java:51-112; AdminOrderController.java:63-164; AdminPickupController.java; migrations V043/V048/V055-V061; routines sp_order_change_status/sp_home_delivery_reconcile/sp_pickup_collect; ADR 0024/0029; AdminOrderApiIntegrationTest; home_delivery_lifecycle_gate.py; store_pickup_http_gate.py; orderState.ts:18-43; OrdersPage.tsx:110-116.
- Preconditions and main flow: approved order; HOME_DELIVERY PREPARING→IN_TRANSIT→OUT_FOR_DELIVERY→DELIVERED; pickup PREPARING→COLLECTED; digital→COMPLETED. Customer may cancel delivery only during PREPARING; pickup/digital first six minutes after payment approval.
- Alternative flows: ADMIN approves pending transfer; pickup collection uses correct code; detail reconciles due states.
- Validations: positive order ID; next allowed state only; pickup code matches.
- Business constraints: purchase/payment/shipment/pickup/invoice/ownership separate; scheduler defaults PT10S/batch100; delivery stages default 2min each.
- Error handling: 409 P5002 detail “El pedido no puede pasar al estado solicitado desde su estado actual.”; 409 P5003 “El pedido ya no puede cancelarse en su estado actual.”; P5013 “El código de retiro no corresponde al pedido.”
- Edge cases: repeated stage may reconcile idempotently; timeout requires detail read.
- Acceptance criteria:
  - API — Allowed next transition returns 200 and updated server state.
  - API — Skipped state returns 409 P5002 and no state/history mutation.
  - API — Eligible cancellation returns 200/CANCELLED/REFUNDED/restoredUnits; repeat returns 409 without second restoration.
  - UI — Labels include “En preparación”, “En camino”, “En reparto”, “Entregado”, “Compra completada”.
- Test notes: transitions/cancel/refund/stock destructive; disposable database only.

### Invoice, library, Help and notifications

#### FR-INV-001 — Generate academic invoice/credit note

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER read; ADMIN issue.
- Source traceability: BillingController.java:32-47; AdminOrderController.java:164-188; migrations V034/V038/V067/V071-V075/V080-V085; routines sp_invoice_issue/sp_credit_note_issue/fn_invoice_artifact_claim/fn_invoice_artifact_complete; ADR 0033/0038/0046; InvoiceRenderer.java:25-54, 150-165; BillingControllerTest; InvoiceRendererTest; invoice_artifacts_gate.py.
- Preconditions and main flow: approved billed checkout; worker renders immutable PDF/XML; cancellation/refund may issue one credit note.
- Alternative flows: pending artifact returns processing; legacy invoice may have no file.
- Validations: immutable source snapshot; PDF/XML MIME; artifact limit ≤10 MiB.
- Business constraints: provenance SIMULATED; exact PDF legend “SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA”; no SRI authorization or real tax claim.
- Error handling: no invoice 404 INVOICE_NOT_FOUND, title “Factura no disponible”, detail “El pedido todavía no tiene una factura.”; processing 409 INVOICE_FILE_NOT_READY, detail “La compra está registrada. El documento todavía se está preparando; consulta nuevamente en unos momentos.”
- Edge cases: no document fabricated for historical order without source snapshot.
- Acceptance criteria:
  - API — Approved billed order eventually has ISSUED/SIMULATED metadata.
  - API — Pending file returns 409 INVOICE_FILE_NOT_READY and exact detail above.
  - UI — Pending state says “Estamos preparando tu factura.”; ready PDF contains academic/no-SRI disclaimer.
- Test notes: invoice creation destructive; synthetic order, no tax provider.

#### FR-INV-002 — View/download private invoice file

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER owner, ADMIN.
- Source traceability: BillingController.java:49-130; InvoiceDocumentPage.tsx:38-46, 104-190; DatabaseInvoiceDocumentStore.java:5-32; BillingConfiguration.java:13-19; V084/V085; ADR 0046; BillingDownloadApiTest; InvoiceDocumentPage.test.tsx; post_purchase_invoice_http_gate.py.
- Preconditions and main flow: authenticated owner/admin and READY artifact; access route streams PostgreSQL default or short-lived signed URL in optional R2.
- Alternative flows: legacy/unavailable gives no action; pending gives retry.
- Validations: PDF/XML; inline PDF only; attachment for XML; no-store/nosniff; signed TTL 1–300 seconds, default300.
- Business constraints: Database API authorizes storage; default private PostgreSQL bytea; no browser storage credentials.
- Error handling: 404 INVOICE_FILE_UNAVAILABLE, “El archivo no está disponible para descarga.”; invalid disposition 400, “La presentación debe ser attachment o inline.”
- Edge cases: refresh signed URL for each action; owner mismatch must not leak document.
- Acceptance criteria:
  - API — Non-owner receives 404 and no bytes/access URL.
  - API — READY default storage returns API_STREAM; optional isolated R2 URL expires ≤300 seconds.
  - UI — Download requests attachment and file name derives from invoice/order number.
- Test notes: no real R2; fixture documents sensitive and screenshots/artifacts must be discarded.

#### FR-INV-003 — Queue invoice email after artifact completion

- Status: CONFIRMED. Priority: P1. Roles: system; CUSTOMER recipient.
- Source traceability: V039/V060/V061/V064/V084; fn_invoice_artifact_complete/fn_mail_outbox_claim/fn_mail_outbox_complete; MailOutboxWorker.java:10-43; MailtrapMailSender.java:15-50; docs/adr/0046-academic-invoice-pdf-email-and-storage.md:38; docs/backend/transactional-email.md:43-55, 69-84; TransactionalMailTest; mail_completion_gate.sql.
- Preconditions and main flow: PDF first becomes READY; when enabled worker sends event via Mailtrap.
- Alternative flows: disabled leaves PENDING; 429/5xx bounded retries; ambiguous transport becomes FAILED.
- Validations: HTTPS provider except loopback test; max five attempts; batch 1–10.
- Business constraints: one event per invoice; checkout unaffected by mail failure; SENT means provider acceptance, not delivery; no resend endpoint.
- Error handling: provider failures do not roll back checkout/invoice.
- Edge cases: queued backlog can send if later enabled; TestSprite never enables live provider.
- Acceptance criteria:
  - API — With mail disabled, an eligible invoice operation keeps its documented HTTP outcome; the existing PostgreSQL 18 gate verifies one PENDING outbox event and zero provider calls.
  - API — With the loopback provider stub, the existing outbox gate verifies one persisted receipt and no duplicate event on replay; no public API exposes raw outbox rows.
  - UI — Never assert email delivery from order state.
- Test notes: loopback only; outbox mutation destructive.

#### FR-LIB-001 — Read digital library and eligibility

- Status: CONFIRMED. Priority: P0. Roles: CUSTOMER.
- Source traceability: DigitalEligibilityController.java:26-50; LibraryController.java:18-39; migrations V045/V047/V062/V076/V077; routines fn_digital_eligibility/fn_customer_library/fn_customer_library_item; ADR 0026/0042; DigitalEligibilityApiIntegrationTest; LibraryRoutes.test; library_checkout_http_gate.py.
- Preconditions and main flow: customer reads eligibility for 1–50 editions and own library list/detail.
- Alternative flows: revoked ownership remains in history but unavailable; foreign/missing item not found.
- Validations: 1–50 positive IDs; type EBOOK/AUDIOBOOK; pageSize1–50.
- Business constraints: ownership from valid approved purchase line; no reader/download/content delivery.
- Error handling: 404 P6001 detail “El título solicitado no existe o no pertenece a tu biblioteca.”; >50 IDs field “Puedes consultar hasta cincuenta ediciones.”
- Edge cases: cancellation revokes source grant unless another valid purchase remains.
- Acceptance criteria:
  - API — Customer A library contains no Customer B item.
  - API — 51 IDs returns 400 and exact max-list message above.
  - UI — Detail shows ownership/purchase facts and no reader/download action.
- Test notes: ownership fixture requires checkout, destructive; discard DB.

#### FR-LIB-002 — Render LibraryAccessLink from authoritative state only

- Status: CONFIRMED. Priority: P1. Roles: CUSTOMER.
- Source traceability: frontend/src/features/purchase/LibraryAccessLink.tsx:8-28; migration V077; fn_customer_order_detail/fn_customer_library_item; ADR 0042; digitalPurchaseState.test.ts; storefront-library.spec.ts.
- Preconditions and main flow: order detail supplies digitalAccess projection.
- Alternative flows: no link for physical, pending, rejected, cancelled, revoked, or missing owned item.
- Validations: no UI inference; consume state only.
- Business constraints: approved uncancelled order + digital line + AVAILABLE + ownedItemId required; link does not grant ownership/content.
- Error handling: library API P6001 for unowned item.
- Edge cases: accessible name includes title.
- Acceptance criteria:
  - UI — Eligible line renders link “Ver en Mi biblioteca: {title}” to /biblioteca/{ownedItemId}.
  - UI — Ineligible line renders zero library links.
- Test notes: read-only after fixture setup; ownership setup destructive.

#### FR-HELP-001 — Browse published Help

- Status: CONFIRMED. Priority: P1. Roles: anonymous, CUSTOMER.
- Source traceability: HelpController.java:13-39; migrations V046/V062/V086/V087; routines fn_help_categories/fn_help_articles/fn_help_article; ADR 0026; StorefrontHelpApiIntegrationTest; storefront_help_http_gate.py; HelpRoutes.tsx:46-85, 92-145; production-state-help.spec.ts.
- Preconditions and main flow: browse published topics/articles, search and open slug; identity guidance may show own correction status.
- Alternative flows: empty search says “No encontramos recursos para esto.” or “Aún no hay recursos publicados.”; transient error can “Reintentar”; unknown slug not found.
- Validations: query≤140; slug lowercase and ≤140; applicability GENERAL/PHYSICAL/EBOOK/AUDIOBOOK; pageSize1–50.
- Business constraints: published articles only; no support-ticket feature.
- Error handling: 404 HELP_ARTICLE_NOT_FOUND, title “Artículo no encontrado”, detail “El artículo solicitado no está disponible.”
- Edge cases: no draft leakage; correction status customer-specific.
- Acceptance criteria:
  - API — Categories/articles return 200 with published rows only.
  - API — Unknown slug returns 404 HELP_ARTICLE_NOT_FOUND.
  - UI — Empty query result shows “No encontramos recursos para esto.” and “Ver todos los recursos”.
- Test notes: GET only; article corpus is disposable DB fixture.

### Administration and notifications

#### FR-ADM-001 — Customer admin API

- Status: CONFIRMED (API). Priority: P1. Roles: ADMIN.
- Source traceability: AdminCustomerController.java:40-85; migrations V012/V026/V039; routines fn_admin_customer_search/sp_customer_set_status; AdminCustomerApiIntegrationTest; admin_customers_http_gate.py.
- Preconditions and main flow: ADMIN searches customers and changes ACTIVE/BLOCKED.
- Alternative flows: blocked customer remains searchable but cannot start a session; existing access token is rechecked.
- Validations: state ACTIVE/BLOCKED; pageSize1–50.
- Business constraints: API only; no public account-create route.
- Error handling: missing customer 404 P1102 title “Cliente no encontrado”, detail “El cliente solicitado no está disponible.”; wrong role 403.
- Edge cases: status can change after login and before protected request.
- Acceptance criteria:
  - API — ADMIN GET search returns 200 paginated.
  - API — ADMIN PUT customer status returns 204; after block, customer login returns generic 401.
- Test notes: status change destructive; isolated two-user fixture.

#### FR-ADM-002 — Catalog admin API

- Status: CONFIRMED (API). Priority: P1. Roles: ADMIN.
- Source traceability: AdminCatalogController.java:43-240; migrations V014/V018/V019/V078; routines sp_author/publisher/category/book/edition create/update/set_status; AdminCatalogApiIntegrationTest; full_journey_http_gate.py.
- Preconditions and main flow: ADMIN searches/creates/updates/activates/deactivates authors, publishers, categories, books, editions.
- Alternative flows: duplicate SKU/ISBN/slug or invalid/inactive references conflict.
- Validations: request DTO bounds; ISBN/SKU/slug unique; author order unique.
- Business constraints: book requires author/category; publication references active entities; V021 defers book update constraint.
- Error handling: 409 P2045 detail “Ya existe una edición con ese ISBN.”; P2024 detail “Ya existe una categoría con ese identificador.”
- Edge cases: deactivation affects public availability, not order history.
- Acceptance criteria:
  - API — Non-ADMIN POST admin book returns 401/403.
  - API — Valid ADMIN create returns 201 and item appears once in search.
- Test notes: writes alter catalog; isolated DB only.

#### FR-ADM-003 — Inventory and offer admin APIs

- Status: CONFIRMED (API). Priority: P1. Roles: ADMIN.
- Source traceability: AdminInventoryController.java:46-115; EditionOfferController.java:24-47; migrations V015/V044/V051-V054; routines fn_inventory_search/fn_inventory_movements/sp_inventory_entry/sp_inventory_adjust/sp_inventory_set_minimum/sp_edition_offer_set/remove; AdminInventoryApiIntegrationTest; offers_http_gate.py; offers_concurrency.py.
- Preconditions and main flow: ADMIN views inventory/movements, records entry/adjustment/minimum, sets/removes offer.
- Alternative flows: low-stock filter; invalid offer window/inactive edition rejected.
- Validations: positive stock quantity, nonnegative minimum, valid reason, offer dates/discount.
- Business constraints: movement immutable, cannot decrement below zero; DB serializes stock/offer writes; checkout rechecks.
- Error handling: 404 P3001; 409 P3002 detail “No hay existencias suficientes para realizar el ajuste.”; 400 P3004 “El stock mínimo no puede ser negativo.”; inactive edition P2042.
- Edge cases: final-unit race has one winner.
- Acceptance criteria:
  - API — Valid inventory entry returns 201 and adds exactly one movement record; minimum update returns 204.
  - API — Negative resulting inventory adjustment returns 409 P3002 and leaves no movement.
  - API — ADMIN PUT/DELETE offer returns 204; CUSTOMER offer mutation receives 403.
- Test notes: inventory/price mutation destructive; disposable edition only.

#### FR-ADM-004 — Review identity correction API

- Status: CONFIRMED (API). Priority: P1. Roles: ADMIN.
- Source traceability: AdminBillingIdentityCorrectionController.java:28-59; migration V080; routines fn_admin_billing_identity_correction_requests/sp_admin_billing_identity_correction_decide; ADR 0043; BillingIdentityCorrectionApiIntegrationTest; billing_identity_corrections_http_gate.py.
- Preconditions and main flow: ADMIN lists and decides PENDING corrections.
- Alternative flows: decided request conflicts; reject needs Spanish reason.
- Validations: status PENDING/APPROVED/REJECTED/WITHDRAWN; positive ID; pageSize1–50.
- Business constraints: one decision; approved correction updates identity through DB.
- Error handling: missing rejection reason 400 “Escribe en español el motivo del rechazo.”; repeat decision 409 P1111.
- Edge cases: concurrent customer withdrawal/ADMIN decision has one winner.
- Acceptance criteria:
  - API — ADMIN list pageSize20 returns ≤20 rows.
  - API — Second decision returns 409 P1111.
- Test notes: identity change sensitive/destructive; disposable data only.

#### FR-ADM-005 — Operate orders/logistics through ADMIN API

- Status: CONFIRMED (API). Priority: P1. Roles: ADMIN.
- Source traceability: AdminOrderController.java:51-188; AdminPickupController.java:19-32; migrations V017/V034/V043/V048/V055-V085; routines fn_admin_orders/fn_admin_order_detail/sp_order_change_status/sp_pickup_collect/sp_invoice_issue/sp_credit_note_issue; ADR 0017/0024/0029/0038/0046; AdminOrderApiIntegrationTest; admin_orders_http_gate.py; post_purchase_invoice_http_gate.py.
- Preconditions and main flow: search/detail, approve pending payment, advance state, cancel eligible order, set tracking, collect pickup, issue academic invoice/credit note.
- Alternative flows: unknown response requires reading detail; invalid state conflicts.
- Validations: positive IDs, allowed transition, pickup code, DTO tracking/document fields.
- Business constraints: ADMIN only; no skipped state; no SRI; replay does not duplicate invoice/outbox.
- Error handling: 409 P5002 detail “El pedido no puede pasar al estado solicitado desde su estado actual.”; wrong role 403.
- Edge cases: detail may reconcile home delivery; repeated payment approval idempotent.
- Acceptance criteria:
  - API — ADMIN order list/detail return 200, max50 rows.
  - API — ADMIN approves valid pending transfer with 204; replay creates no duplicate invoice.
  - API — Skipped transition returns 409 P5002 and no state mutation.
- Test notes: order/payment/stock/documents mutable; disposable DB only.

#### FR-ADM-006 — Admin frontend is not implemented

- Status: NOT-IMPLEMENTED. Priority: P2. Roles: ADMIN; anonymous/CUSTOMER role-gated.
- Source traceability: frontend/src/app/App.tsx:191, 294-325; README.md §Implemented v1 vertical slices; frontend/src/shared/api/generated.ts:699-943, 1352-1537.
- Preconditions and main flow: open /admin; anonymous sees login gate; CUSTOMER sees restricted message; ADMIN sees placeholder and logout.
- Alternative flows: login routes ADMIN to /admin but exposes no operational work.
- Validations: frontend role check; backend authorization remains authoritative.
- Business constraints: admin business capabilities are protected API only.
- Error handling: anonymous receives “Inicia sesión para continuar.”; CUSTOMER “Esta área no está disponible para tu cuenta.”; ADMIN “Tu sesión está activa. Las herramientas de administración aún no forman parte de esta versión del frontend.”
- Edge cases: successful admin login does not imply usable back-office.
- Acceptance criteria:
  - UI — ADMIN sees “Área administrativa” and exact placeholder message above.
  - UI — CUSTOMER sees restricted heading and “Ir al inicio”; no admin mutation request occurs.
- Test notes: read-only. Do not generate positive admin UI CRUD tests.

#### FR-NOT-001 — Transactional notification outbox

- Status: CONFIRMED. Priority: P1. Roles: system; CUSTOMER recipient.
- Source traceability: MailOutboxWorker.java:10-43; MailProperties.java:7-28; MailtrapMailSender.java:15-50; docs/backend/transactional-email.md:43-55, 69-84; migrations V039/V060-V064/V084; TransactionalMailTest; mail_completion_gate.sql.
- Preconditions and main flow: DB transaction enqueues event; optional worker claims/sends only when enabled.
- Alternative flows: disabled leaves PENDING; 429/5xx bounded retries; ambiguous IO becomes FAILED.
- Validations: provider HTTPS except loopback test; max five attempts; batch1–10.
- Business constraints: order/invoice events dedupe; SENT means provider acceptance, not delivery; no resend endpoint; logs omit recipient/body.
- Error handling: provider failure does not roll back checkout/invoice.
- Edge cases: queued backlog could send if later enabled; TestSprite never enables live provider.
- Acceptance criteria:
  - API — With mail disabled, an eligible invoice operation keeps its documented HTTP outcome; the existing PostgreSQL 18 gate verifies one PENDING outbox event and zero provider calls.
  - API — With the loopback provider stub, the existing outbox gate verifies one persisted receipt and no duplicate event on replay; no public API exposes raw outbox rows.
  - UI — Never assert email delivery from order state.
- Test notes: loopback only; outbox mutation destructive.

## 5. Non-functional requirements

#### NFR-SEC-001 — Role and ownership isolation

- Status: CONFIRMED. Priority: P0. Area: security.
- Source traceability: SecurityConfiguration.java:79-97; JwtConfiguration.java:65-76; module controllers; customer order/library/invoice gates.
- Acceptance criteria:
  - API — Missing token on protected CUSTOMER route returns 401 AUTH_REQUIRED, detail “Debes iniciar sesión para realizar esta operación.”
  - API — CUSTOMER on /api/v1/admin/** returns 403 ACCESS_DENIED, detail “No tienes permiso para realizar esta operación.”
  - API — Cross-customer profile/address/cart/order/invoice/library reads disclose no private content.
- Test notes: cross-user reads safe; status changes destructive.

#### NFR-SEC-002 — Protect refresh mutation and CORS

- Status: CONFIRMED. Priority: P0. Area: security/session.
- Source traceability: AuthSessionCookie.java:10-42; AuthSessionRequestFilter.java:14-42; SecurityConfiguration.java:70-123; amendment 0004; auth_session_http_gate.py.
- Acceptance criteria:
  - API — Cookie includes HttpOnly, SameSite=Strict, path /api/v1/auth, Secure outside configured local HTTP.
  - API — Refresh/logout without X-PLIEGO-SESSION-REQUEST: 1 returns 403.
  - API — Credentialed CORS never responds with wildcard origin.
- Test notes: disposable session only.

#### NFR-SEC-003 — Safe Spanish Problem Details

- Status: CONFIRMED. Priority: P0. Area: security/errors.
- Source traceability: ProblemResponse.java:7-17; ApiExceptionHandler.java:30-37, 51-60, 96-113, 165-183; DatabaseExceptionTranslator.java:12-26; DatabaseError.java:11-82; DatabaseExceptionTranslatorTest; SensitiveDataToStringTest.
- Acceptance criteria:
  - API — Malformed JSON returns 400 MALFORMED_JSON, title “Solicitud inválida”, detail “El cuerpo de la solicitud falta o no contiene JSON válido.”
  - API — Unexpected exception returns 500, title “Error interno”, detail “Ocurrió un error interno. Intenta nuevamente.”, traceId present, raw SQL/stack absent.
- Test notes: synthetic errors only.

#### NFR-SEC-004 — Rate limit public email actions

- Status: CONFIRMED. Priority: P1. Area: security/abuse.
- Source traceability: EmailActionController.java:24-36; docs/backend/transactional-email.md:37-41; V039 fn_email_rate_limit; transactional_email_http_gate.py.
- Acceptance criteria:
  - API — Existing, unknown, blocked and limited account requests all receive same 202 response.
  - API — Enforce one-minute cooldown, five per email/hour, twenty per source IP/hour.
- Test notes: outbox/rate rows mutate; disposable DB only.

#### NFR-PRIV-001 — Minimize personal, payment and document data

- Status: CONFIRMED. Priority: P0. Area: privacy.
- Source traceability: CheckoutRequest.java:18-20, 41-47, 82-86; DatabaseInvoiceDocumentStore.java:5-32; ADR 0038:7-15; ADR 0046:38; transactional email docs:47-55; SensitiveDataToStringTest.
- Acceptance criteria:
  - API — CARD number absent from DB, response and logs; CVV/expiry/cardholder are not checkout API fields.
  - API — Non-owner invoice gets no bytes/access URL; success response is no-store.
  - API/log — Outbox logs contain no recipient/body.
  - UI — Invoice says “SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA” and does not claim SRI authorization.
- Test notes: synthetic data only; discard generated documents/screenshots.

#### NFR-A11Y-001 — Preserve keyboard, focus, labels and error association

- Status: ASSUMPTION for global WCAG level; CONFIRMED for listed interactions. Priority: P1. Area: accessibility.
- Source traceability: docs/frontend/product-design-and-ux-v1.0.md:199, 228; p1-accessibility-verification-2026-10-04.md:13-33; p1-accessibility.spec.ts; Field.tsx; App.tsx:209-225.
- Acceptance criteria:
  - UI — Keyboard reaches actions on auth, cart, address dialog, checkout, invoice and /admin; focus stays visible and moves to announced outcome.
  - UI — Invalid field has aria-invalid=true and linked Spanish message.
  - UI — Scoped 200% text resize has no horizontal overflow and critical controls stay in viewport.
- Open: no WCAG 2.1/2.2 A/AA/AAA target and no broad conformance audit.
- Test notes: scoped Chromium only; not screen-reader certification.

#### NFR-PERF-001 — Bound pages and preserve query-plan gates

- Status: CONFIRMED for page bounds/query gates; no latency SLA. Priority: P1. Area: performance.
- Source traceability: CatalogController.java:62-80; CustomerOrderController.java:54-57; ApiExceptionHandler.java:191-200; V079; customer_query_plan_gate.py; testsprite-catalog-sorting.spec.ts:7-35.
- Acceptance criteria:
  - API — Paged endpoints use page0/pageSize20 default, max50; never return more than 50.
  - DB — PostgreSQL 18 query-plan gate passes all defined assertions.
  - UI — 13-row fixture/pageSize2 has seven pages, total13 unique rows and “Página N de 7”.
- Open: no latency percentile target approved.
- Test notes: query-plan gate needs isolated populated PostgreSQL 18.

#### NFR-REL-001 — Atomic/idempotent commands

- Status: CONFIRMED. Priority: P0. Area: reliability.
- Source traceability: AGENTS.md; amendment 0010; ADR 0030; migrations V036/V063-V065; CheckoutController.java:48-75; accepted_quote_http_gate.py; p1-attempts.spec.ts.
- Acceptance criteria:
  - API — Same checkout key/payload replay returns same receipt and no duplicate effects.
  - API — Same key/different payload returns 409 P1010, detail “Este intento ya se usó con otros datos. Consulta su resultado antes de continuar.”
  - UI — Unknown checkout result is resolved before another POST.
- Test notes: writes order; disposable DB.

#### NFR-REL-002 — Bound mail/invoice worker retries

- Status: CONFIRMED. Priority: P1. Area: reliability.
- Source traceability: MailOutboxWorker.java:10-43; InvoiceArtifactWorker.java:10-59; transactional email docs:47-55; ADR 0046:38-75; V060-V064/V073-V085; TransactionalMailTest; InvoiceArtifactWorkerTest.
- Acceptance criteria:
  - Worker — 429/5xx retries at most five times with 30/60/120/240-second backoff plus polling.
  - Worker — Ambiguous mail result is FAILED, not blind duplicate retry.
  - Worker — Invoice artifact READY only after renderer/storage and DB completion succeed.
- Test notes: loopback mail, disposable DB, asynchronous worker.

#### NFR-DATA-001 — Preserve PostgreSQL invariants under races

- Status: CONFIRMED. Priority: P0. Area: integrity.
- Source traceability: AGENTS.md; database-api-contract-v1.0.md; migrations V017/V036/V045/V047/V052-V059/V063-V065/V076/V080-V085; digital_single_copy_concurrency.py; checkout_last_unit.py; order_cancel_concurrency.py; address_primary_concurrency.py.
- Acceptance criteria:
  - DB/API — Two purchases for final physical unit do not make stock negative and at most one approval succeeds.
  - DB/API — Two same-customer digital purchases create at most one valid ownership/open order.
  - DB/API — Concurrent primary changes leave exactly one primary address.
  - DB/API — Concurrent cancellation restores stock/refund at most once.
- Test notes: all races write; isolated PostgreSQL 18 only.

#### NFR-I18N-001 — Spanish interface and Ecuador formatting

- Status: CONFIRMED. Priority: P1. Area: i18n.
- Source traceability: AGENTS.md; ADR 0003/0035; purchaseText.ts:37-51; formatters.ts; ApiExceptionHandler.java.
- Acceptance criteria:
  - UI/API — Human-facing errors are Spanish and machine code remains stable.
  - UI — Order date/number uses es-EC; money uses server two-decimal USD projection.
  - API — Catalog Spanish title ordering passes catalog_spanish_order_gate.
- Test notes: read-only/synthetic invalid requests.

#### NFR-RESP-001 — Keep core actions usable at required widths

- Status: CONFIRMED for existing responsive behavior; 390/768 are additional probes. Priority: P1. Area: responsive.
- Source traceability: design language §Layout/checkout; production-responsive.spec.ts; testsprite-catalog-sorting.spec.ts:7-54; production-responsive.spec.ts:54-79.
- Acceptance criteria:
  - UI — At 320/390/768/1280, key header, filter, checkout, order and invoice controls fit without horizontal overflow.
  - UI — At 320, header controls remain inside viewport and do not overlap.
  - UI — Checkout summary is reachable before form; at ≤900 it uses disclosure layout.
- Test notes: browser only; synthetic fixture.

#### NFR-OBS-001 — Trace and redact errors/logs

- Status: CONFIRMED. Priority: P2. Area: observability.
- Source traceability: TraceIdFilter.java; ProblemDetailFactory.java; ProblemResponse.java:7-17; transactional email docs:47-55; SensitiveDataToStringTest.
- Acceptance criteria:
  - API — Problem response includes non-empty traceId.
  - API/log — No SQL, stack trace, hash, token, recipient or payment credential is present in public error/log output.
- Test notes: synthetic error only.

## 6. End-to-end journeys

All data below is disposable/synthetic. Admin is API-only.

### J-001 — Accent-insensitive catalog discovery (UI)

1. Open /.
2. Search an accented/unaccented title/author phrase.
3. Verify que URL state and server results.
4. Apply category/filter and TITLE_ASC.
5. Open edition detail.
6. Repeat at widths 320, 390, 1280 and confirm Spanish sort/filter preservation.

Requirements FR-CAT-001/002/003; evidence testsprite-catalog-sorting.spec.ts.

### J-002 — Register, verify, sign in (UI + local stub)

1. Open /register and submit synthetic details.
2. Confirm PENDING_VERIFICATION and no session.
3. Get action through loopback stub/outbox fixture.
4. Open /verificar-correo and verify.
5. Sign in; confirm CUSTOMER route and refresh cookie.

Requirements FR-AUTH-001–004; evidence registration-return.spec.ts, email-actions.spec.ts, session.live.spec.ts, transactional_email_http_gate.py.

### J-003 — Reset password (UI + local stub)

1. From /sign-in choose “¿Olvidaste tu contraseña?”.
2. Request reset for synthetic account.
3. Retrieve from test stub; submit replacement and confirmation.
4. Confirm old refresh session revoked and new login works.
5. Repeat mismatch/expired cases; ensure no blind retries.

Requirements FR-AUTH-005; evidence EmailActionPages.test.tsx and email-actions.spec.ts.

### J-004 — Profile, identity and Ecuador address (UI/API)

1. Sign in as disposable CUSTOMER; update profile with current expectedVersion.
2. Save a shared test-vector cédula/RUC.
3. Open /account/addresses; select province and supported Bucay/Playas alias.
4. Save synthetic address as primary and confirm it appears at checkout.
5. If correction needs review, submit as CUSTOMER and decide with ADMIN API.

Requirements FR-CUS-001/002, FR-BIL-001/002, FR-GEO-001; evidence ecuador-forms.spec.ts, addresses.spec.ts, profile-identity.spec.ts.

### J-005 — Favorite and cart holding flow (UI)

1. Browse as CUSTOMER; add favorite and check /favorites.
2. Add physical edition to cart; change quantity.
3. Save for later; verify it leaves active cart and appears under “Guardado para después”.
4. Move back; verify quantity restored and availability rechecked.
5. Remove item and use empty-cart catalog action.

Requirements FR-FAV-001, FR-CART-001/003; evidence favorites.spec.ts, cart-presentation.spec.ts, cart-saved-for-later.spec.ts.

### J-006 — Home delivery purchase and academic invoice (UI/API worker)

1. Add available physical edition and open /checkout.
2. Choose HOME_DELIVERY, owned address and ACCOUNT/OTHER billing recipient.
3. Choose TRANSFER or synthetic Luhn-valid CARD; never use real card.
4. Submit once; browser outcome is APPROVED.
5. Verify order snapshot at /orders/{id}.
6. Poll invoice metadata to READY; open /orders/{id}/invoice, inspect disclaimer/download.
7. If testing mail, assert outbox/stub acceptance only, never inbox delivery.

Requirements FR-CHK-001/002/003, FR-ORD-001, FR-INV-001–003; evidence production-purchase.spec.ts, purchase.spec.ts, billing.spec.ts, post_purchase_invoice_http_gate.py.

### J-007 — Pickup and cancellation window (UI/API)

1. Create disposable physical/mixed cart.
2. Choose STORE_PICKUP and active test pickup point.
3. Submit approved simulation and confirm pickup snapshot.
4. Exercise cancellation before/after six-minute boundary in controlled fixture.
5. Use ADMIN API to collect with valid code; wrong code returns P5013.
6. Confirm pickup has no invented shipment tracking.

Requirements FR-CHK-001, FR-ORD-002; evidence store-pickup.spec.ts and store_pickup_http_gate.py.

### J-008 — Digital ownership and duplicate prevention (UI/API)

1. Browse EBOOK/AUDIOBOOK and fetch eligibility.
2. Add one copy, submit DIGITAL_ONLY without address/location, approved simulation.
3. Verify order LibraryAccessLink to /biblioteca/{ownedItemId}.
4. Retry; expect P6002 when owned or P6003 while open order.
5. Cancel in disposable fixture; verify grant revocation/other valid grant behavior.
6. Confirm no reader/download control.

Requirements FR-CART-002, FR-CHK-001/002, FR-LIB-001/002; evidence digital-single-copy.spec.ts, storefront-library.spec.ts, digital_single_copy_http_gate.py.

### J-009 — Quote conflict and uncertain checkout recovery (UI/API)

1. Capture cart ID/fingerprint.
2. Change fixture quote in isolated DB between read and submit.
3. Expect P4005 and no order.
4. Simulate dropped response after one checkout POST.
5. Resolve same key; show exact order if CREATED; remain blocked if PENDING.

Requirements FR-CHK-002/003, NFR-REL-001; evidence p1-attempts.spec.ts, accepted_quote_http_gate.py.

### J-010 — Cancel order and inspect history (UI/API)

1. Create approved disposable order.
2. Open /orders and detail.
3. Cancel only while server marks it eligible.
4. Verify CANCELLED/REFUNDED/history/stock restoration once.
5. Retry and expect P5003 without second restore.

Requirements FR-ORD-001/002; evidence orders-lifecycle.spec.ts, order_cancel_concurrency.py.

### J-011 — Browse Help (UI)

1. Open /ayuda and search published cédula/RUC guidance.
2. Open article and related link.
3. As CUSTOMER, verify only own correction status appears.
4. Open unknown slug and confirm no draft content.

Requirements FR-HELP-001; evidence production-state-help.spec.ts, storefront_help_http_gate.py.

### J-012 — ADMIN operations smoke (API only)

1. Use disposable ADMIN provisioned through seed configuration.
2. Read customer/catalog/inventory/order/correction pages.
3. Write fixture catalog/stock/offer/order/correction data only in disposable DB.
4. Exercise one allowed transition and wrong-role rejection.
5. Do not treat /admin placeholder as back-office.

Requirements FR-ADM-001–006; evidence full_journey_http_gate.py, admin_customers_http_gate.py, admin_orders_http_gate.py, billing_identity_corrections_http_gate.py.

## 7. Traceability matrix and route coverage

### 7.1 Citation convention

To keep each block readable, a bare Java class name refers to the class under the module directory named in that requirement, in backend/src/main/java/com/pliego/modules/<module>/{api,application,gateway}. Foundation names refer to backend/src/main/java/com/pliego/foundation/{security,web,database,validation}. Named frontend component/test paths are under frontend/src or frontend/tests as written. Migration names are exact files in backend/src/main/resources/db/migration. PostgreSQL 18 gate names are under backend/src/test/postgres18. This makes each source trace resolvable to one exact repository file and line/routine.

### 7.2 Requirement-to-test traceability

| Requirement | Primary evidence | Existing automated evidence | TestSprite gap |
|---|---|---|---|
| FR-AUTH-001 | AuthController/RegisterRequest; V039 | AuthApiIntegrationTest; registration-return.spec.ts | Use stub, not real inbox |
| FR-AUTH-002 | EmailActionController; V039/V070 | transactional_email_http_gate.py; email-actions.spec.ts | No real email |
| FR-AUTH-003 | AuthController/SecurityConfiguration; V026-V028 | AuthApiIntegrationTest; session.live.spec.ts | Admin UI placeholder |
| FR-AUTH-004 | Cookie/filter; V026-V028 | auth_session_http_gate.py; authSessionRecovery.test.ts | Add generated cookie assertions |
| FR-AUTH-005 | EmailActionController; V039 | transactional_email_http_gate.py; EmailActionPages.test.tsx | No real email |
| FR-CUS-001 | Profile/email controllers; V035-V039/V066/V068 | CustomerApiIntegrationTest; ProfileDraft.test.tsx; customer_email_change_gate.py | Add stale-version UI path |
| FR-BIL-001 | BillingIdentityRequest; V071/V075/V080 | BillingIdentityApiIntegrationTest; ecuador-forms.spec.ts | Never use real IDs |
| FR-BIL-002 | Correction controllers; V080 | BillingIdentityCorrectionApiIntegrationTest; billing_identity_corrections_http_gate.py | No admin UI |
| FR-GEO-001 | GeoController; V082 | geo_catalog_http_gate.py; geo_alias_http_gate.py | Add 390/768 viewports |
| FR-CUS-002 | CustomerController/AddressRequest; V020/V036/V082 | CustomerApiIntegrationTest; addresses.spec.ts; address_primary_concurrency.py | Isolated customer required |
| FR-CAT-001 | Storefront/Catalog controllers; V022/V023/V046 | StorefrontHelpApiIntegrationTest; CatalogHomePage.test.tsx | Stable catalog fixture |
| FR-CAT-002 | Catalog detail; V013/V032/V047 | EditionDetailPage.test.tsx; StockRobustness.test.tsx | Live stock fixture |
| FR-CAT-003 | Offers controllers; V044/V051-V054 | OffersPage.test.tsx; offers_http_gate.py; offers.spec.ts | Offer writes isolated only |
| FR-FAV-001 | CustomerController favorites; V029 | favorites.spec.ts; favorites.live.spec.ts | Live fixture opt-in |
| FR-CART-001 | CartController/requests; V016/V025/V051 | CartApiIntegrationTest; cart-presentation.spec.ts | Stock race gate only |
| FR-CART-002 | Eligibility/library; V076/V077 | digital_single_copy_http_gate.py; digital-single-copy.spec.ts; concurrency gate | Parallel API race only |
| FR-CART-003 | CartController saved; V083 | cart_saved_for_later_http_gate.py; cart-saved-for-later.spec.ts | DB concurrency gate |
| FR-CHK-001 | CheckoutRequest/pickup/geo; V040/V043/V082 | StorePickup.test.tsx; store_pickup_http_gate.py | Controlled cancellation clock |
| FR-CHK-002 | Checkout billing/payment; V080/V081 | CheckoutBilling.test.tsx; checkout_billing_recipient_http_gate.py | Synthetic identity only |
| FR-CHK-003 | CheckoutController; V063/V065/V067 | CheckoutApiIntegrationTest; checkout_http_gate.py; purchase.spec.ts | REJECTED/PENDING API-only due DV-002 |
| FR-CHK-004 | Checkout resolve; V036/V063/V065 | accepted_quote_http_gate.py; p1-attempts.spec.ts | Preserve localStorage during recovery |
| FR-ORD-001 | CustomerOrderController; V034/V077 | CustomerOrderApiIntegrationTest; OrdersPage.test.tsx | Two-user isolation fixture |
| FR-ORD-002 | AdminOrder/pickup; V043/V048/V055-V061 | admin_orders_http_gate.py; home_delivery_lifecycle_gate.py; store_pickup_http_gate.py | Async lifecycle fixture |
| FR-INV-001 | BillingController/InvoiceRenderer; V073/V084 | BillingControllerTest; InvoiceRendererTest; invoice_artifacts_gate.py | Generated document cleanup |
| FR-INV-002 | BillingController/document store; V084/V085 | BillingDownloadApiTest; InvoiceDocumentPage.test.tsx; post_purchase_invoice_http_gate.py | No live R2 |
| FR-INV-003 | Outbox worker; V039/V060-V064/V084 | TransactionalMailTest; mail_completion_gate.sql | Loopback only; no delivery assertion |
| FR-LIB-001 | Library/eligibility controllers; V077 | LibraryRoutes.test.tsx; library_checkout_http_gate.py | No content service by design |
| FR-LIB-002 | LibraryAccessLink.tsx; V077 | digitalPurchaseState.test.ts; storefront-library.spec.ts | Refund edge API-only |
| FR-HELP-001 | HelpController; V046/V086/V087 | StorefrontHelpApiIntegrationTest; HelpRoutes.test.tsx; production-state-help.spec.ts | Published DB fixture |
| FR-ADM-001 | AdminCustomerController; V012 | AdminCustomerApiIntegrationTest; admin_customers_http_gate.py | API only |
| FR-ADM-002 | AdminCatalogController; V014 | AdminCatalogApiIntegrationTest; full_journey_http_gate.py | API only |
| FR-ADM-003 | AdminInventory/EditionOffer controllers; V015/V044 | AdminInventoryApiIntegrationTest; offers_http_gate.py; offers_concurrency.py | API only, writes isolated |
| FR-ADM-004 | Correction admin controller; V080 | BillingIdentityCorrectionApiIntegrationTest; billing_identity_corrections_http_gate.py | API only |
| FR-ADM-005 | Admin order/pickup controllers; V017/V034/V043 | AdminOrderApiIntegrationTest; admin_orders_http_gate.py; full_journey_http_gate.py | API only |
| FR-ADM-006 | App.tsx admin route/placeholder | App.tsx role branch; auth/session UI tests | No positive admin UI test |
| FR-NOT-001 | MailOutboxWorker; V039/V060-V064/V084 | TransactionalMailTest; mail_completion_gate.sql | Loopback only; no public outbox API |
| NFR-SEC-001 | SecurityConfiguration/JWT authorization | AuthApiIntegrationTest; adversarial/session gates | Add full role matrix |
| NFR-SEC-002 | Cookie/filter/CORS config | auth_session_http_gate.py | Add generated header/CORS assertions |
| NFR-SEC-003 | ProblemDetail handler/translator | DatabaseExceptionTranslatorTest; SensitiveDataToStringTest | Add all-module error assertions |
| NFR-SEC-004 | V039 limits/email actions | transactional_email_http_gate.py | Use disposable request counters |
| NFR-PRIV-001 | Checkout DTO, invoice access, mail docs | SensitiveDataToStringTest; BillingDownloadApiTest; invoice gate | Assert artifact cleanup |
| NFR-A11Y-001 | Shared fields/focus behavior | p1-accessibility.spec.ts; scoped verification | No WCAG target |
| NFR-PERF-001 | Page validation/V079 | customer_query_plan_gate.py; sorting spec | No latency SLA |
| NFR-REL-001 | V036/V063-V065 command receipt | accepted_quote_http_gate.py; p1-attempts.spec.ts | Add more lost-response cases |
| NFR-REL-002 | Mail/Invoice workers; V060-V064/V073-V085 | TransactionalMailTest; InvoiceArtifactWorkerTest | Fault injection loopback only |
| NFR-DATA-001 | DB invariants/concurrency migrations | digital_single_copy_concurrency.py; checkout_last_unit.py; order_cancel_concurrency.py; address_primary_concurrency.py | Isolated PostgreSQL 18 only |
| NFR-I18N-001 | Spanish errors/locale ordering | validation tests; catalog_spanish_order_gate.sql | Broader string checks optional |
| NFR-RESP-001 | Responsive CSS/browser gates | production-responsive.spec.ts; testsprite-catalog-sorting.spec.ts | Add 390/768 probes |
| NFR-OBS-001 | Trace filter/problem factory | DatabaseExceptionTranslatorTest; SensitiveDataToStringTest | Add cross-module trace assertion |

### 7.3 Frontend route inventory

| UI route | Requirement |
|---|---|
| / and /catalog | FR-CAT-001 |
| /catalog/editions/:editionId | FR-CAT-002 |
| /ofertas | FR-CAT-003 |
| /ayuda and /ayuda/:slug | FR-HELP-001 |
| /sign-in, /register | FR-AUTH-001, FR-AUTH-003 |
| /verificar-correo, /reenviar-verificacion | FR-AUTH-002 |
| /recuperar-contrasena, /restablecer-contrasena | FR-AUTH-005 |
| /account | FR-CUS-001, FR-BIL-001 |
| /account/identity | FR-BIL-001, FR-BIL-002 |
| /account/addresses | FR-GEO-001, FR-CUS-002 |
| /favorites | FR-FAV-001 |
| /cart | FR-CART-001/002/003 |
| /checkout | FR-CHK-001/002/003 |
| /orders, /orders/:orderId | FR-ORD-001/002, FR-LIB-002 |
| /orders/:orderId/invoice | FR-INV-001/002 |
| /biblioteca, /biblioteca/:ownedItemId | FR-LIB-001/002 |
| /admin | FR-ADM-006 |
| * not found | Shared fallback is explicitly out of product test scope; no business capability |
| /dev/theme | Development-only; explicitly out of product scope |

Source inventory: frontend/src/app/App.tsx:18-192, 294-329.

### 7.4 REST endpoint inventory

Every controller mapping found in the requested modules is assigned below. The method and path groups are the route patterns observed in controller annotations.

| API endpoint(s) | Requirement / scope |
|---|---|
| POST /api/v1/auth/register, /login | FR-AUTH-001, FR-AUTH-003 |
| POST /api/v1/auth/refresh, /logout | FR-AUTH-003, FR-AUTH-004 |
| POST /api/v1/auth/resend-verification, /forgot-password, /verify-email, /reset-password | FR-AUTH-002, FR-AUTH-005 |
| GET /api/v1/me; PUT/PATCH /api/v1/me; PUT /api/v1/me/email | FR-CUS-001 |
| GET /api/v1/me/addresses; POST /api/v1/me/addresses; POST /api/v1/me/addresses/attempts/{key}/resolve | FR-CUS-002 |
| PUT/DELETE /api/v1/me/addresses/{addressId}; PUT /api/v1/me/addresses/{addressId}/primary | FR-CUS-002 |
| GET/PUT /api/v1/me/billing-identity; POST /api/v1/me/billing-identity/correction; POST /api/v1/me/billing-identity/correction-requests; POST /api/v1/me/billing-identity/correction-requests/{id}/withdraw | FR-BIL-001, FR-BIL-002 |
| GET /api/v1/admin/billing-identity-corrections; POST /api/v1/admin/billing-identity-corrections/{requestId}/decision | FR-ADM-004 |
| GET /api/v1/reference/countries, /api/v1/reference/transfer-details | FR-GEO-001, FR-CHK-001/002; values are environment-configured and omitted |
| GET /api/v1/geo/provinces; GET /api/v1/geo/provinces/{provinceId}/cities | FR-GEO-001 |
| GET /api/v1/storefront/navigation | FR-CAT-001 |
| GET /api/v1/catalog/editions; GET /api/v1/catalog/editions/{editionId}; GET /api/v1/catalog/categories; GET /api/v1/catalog/filter-options | FR-CAT-001/002 |
| GET /api/v1/catalog/offers; GET /api/v1/catalog/offers/filter-options | FR-CAT-003 |
| GET /api/v1/me/favorites; GET /api/v1/me/favorites/status; PUT/DELETE /api/v1/me/favorites/{editionId} | FR-FAV-001 |
| GET /api/v1/cart; POST /api/v1/cart/items; PUT/DELETE /api/v1/cart/items/{cartItemId} | FR-CART-001 |
| GET /api/v1/cart/saved; POST /api/v1/cart/items/{cartItemId}/save-for-later; POST /api/v1/cart/saved/{savedItemId}/move-to-cart; DELETE /api/v1/cart/saved/{savedItemId} | FR-CART-003 |
| GET /api/v1/me/digital-eligibility; GET /api/v1/me/library; GET /api/v1/me/library/{ownedItemId} | FR-CART-002, FR-LIB-001 |
| GET /api/v1/pickup-locations | FR-CHK-001 |
| POST /api/v1/checkout; POST /api/v1/checkout/attempts/{key}/resolve | FR-CHK-001/002/003 |
| GET /api/v1/orders; GET /api/v1/orders/{orderId}; POST /api/v1/orders/{orderId}/cancel | FR-ORD-001/002 |
| GET /api/v1/orders/{orderId}/invoice; GET /api/v1/orders/{orderId}/invoice/files/{type}; GET /api/v1/orders/{orderId}/invoice/files/PDF/access | FR-INV-001/002 |
| Same invoice routes under /api/v1/admin/orders/{orderId}/invoice | FR-INV-001/002, FR-ADM-005 |
| GET /api/v1/help/categories; GET /api/v1/help/articles; GET /api/v1/help/articles/{slug} | FR-HELP-001 |
| GET/POST /api/v1/admin/authors; PUT /api/v1/admin/authors/{authorId}; PUT /api/v1/admin/authors/{authorId}/status | FR-ADM-002 |
| GET/POST /api/v1/admin/publishers; PUT /api/v1/admin/publishers/{publisherId}; PUT /api/v1/admin/publishers/{publisherId}/status | FR-ADM-002 |
| GET/POST /api/v1/admin/categories; PUT /api/v1/admin/categories/{categoryId}; PUT /api/v1/admin/categories/{categoryId}/status | FR-ADM-002 |
| GET/POST /api/v1/admin/books; PUT /api/v1/admin/books/{bookId}; PUT /api/v1/admin/books/{bookId}/status | FR-ADM-002 |
| GET/POST /api/v1/admin/editions; PUT /api/v1/admin/editions/{editionId}; PUT /api/v1/admin/editions/{editionId}/status | FR-ADM-002 |
| PUT/DELETE /api/v1/admin/editions/{editionId}/offer | FR-ADM-003 |
| GET /api/v1/admin/inventory; GET /api/v1/admin/inventory/{editionId}/movements; POST /api/v1/admin/inventory/{editionId}/entries; POST /api/v1/admin/inventory/{editionId}/adjustments; PUT /api/v1/admin/inventory/{editionId}/minimum | FR-ADM-003 |
| GET /api/v1/admin/customers; PUT /api/v1/admin/customers/{customerId}/status | FR-ADM-001 |
| GET /api/v1/admin/orders; GET /api/v1/admin/orders/{orderId}; POST /api/v1/admin/orders/{orderId}/approve-payment, /transitions, /cancel, /shipment/transitions, /invoice, /credit-notes; PUT /api/v1/admin/orders/{orderId}/shipment/tracking; POST /api/v1/admin/orders/{orderId}/pickup/collect | FR-ADM-005 |
| GET /v3/api-docs and /swagger-ui/** | Developer API reference, explicitly outside product journeys |

Route evidence: controller @RequestMapping/@Get/Post/Put/Patch/Delete mappings under backend/src/main/java/com/pliego/modules; frontend/openapi/openapi.json; frontend/src/shared/api/generated.ts:156-1708; SecurityConfiguration.java:79-94.

Route audit result: 0 in-scope API endpoints without a requirement mapping. UI routes are in §7.3; wildcard not-found fallback and /dev/theme are explicitly out of product test scope.

## 8. Assumptions, deviations and out of scope

### 8.1 Open questions

- OQ-001 — No repository-wide WCAG conformance level is approved; existing checks are scoped Chromium.
- OQ-002 — Only Chromium is configured. Firefox, WebKit/Safari and screen-reader support are unverified.
- OQ-003 — 390/768 are required TestSprite viewports but not defined CSS breakpoints.
- OQ-004 — No request latency SLO is approved; page bounds/query-plan gates are measurable contract.
- OQ-005 — Product owner should confirm whether card UI should collect expiry/CVV/cardholder while backend accepts only cardNumber.
- OQ-006 — TestSprite secret injection and local-only runner networking must be configured outside this repository.

### 8.2 Known defects/deviations

- DV-001 — PRODUCT.md describes an older no-refresh/no-logout, no-email-verification version; later ADR/API amendments and code implement persistent sessions, verification and recovery. Current behavior follows later amendments plus code.
- DV-002 — Browser checkout always sends APPROVED (frontend/src/shared/api/orders.ts:72-78). API/database can represent REJECTED/PENDING; browser has no outcome selector. Test those outcomes through API only.
- DV-003 — Card UI collects expiry/CVV/cardholder (frontend/src/features/purchase/CheckoutPage.tsx:1009-1138), but API DTO accepts only cardNumber and client submits only cardNumber. Do not claim extra fields are backend-validated or persisted; use synthetic values only.
- DV-004 — ADMIN APIs exist but /admin frontend is placeholder (App.tsx:294-325). Operational frontend is NOT-IMPLEMENTED.
- DV-005 — No SRI authorization, real payment processing, content reader/player/download, carrier integration, or public/admin outbox-event resend endpoint is implemented. These are out of scope.
- DV-006 — Mail and R2 are disabled by default. Production enablement is outside TestSprite.

### 8.3 Explicitly out of scope

- OOS-001 — Production site/VPS/API and production identities.
- OOS-002 — Live transactional email and live/private production R2.
- OOS-003 — Real payment authorization/capture/refund and SRI authorization or signing.
- OOS-004 — Real shipping carrier/tracking integrations.
- OOS-005 — Digital content storage, delivery, reader, player, downloads or DRM.
- OOS-006 — Functional admin UI pages; admin APIs are API-only in this release.
- OOS-007 — Support ticket submission.
- OOS-008 — Analytics and user research not present in repository.
- OOS-009 — Development-only /dev/theme and diagnostic surfaces.

## 9. Static self-check

This is a document audit, not an implementation test. Counts are FR/NFR blocks only; journeys and OQ/DV records are not requirement blocks.

- Source commit: requested SHA verified using git rev-parse HEAD.
- Requirement source audit: each CONFIRMED/IMPLEMENTED-UNDOCUMENTED block has a Source traceability field with at least one concrete file:line, approved doc/ADR, migration, routine, or test. CONFIRMED blocks lacking a citation: 0.
- Requirement counts: 48 total; 46 CONFIRMED; 0 IMPLEMENTED-UNDOCUMENTED; 1 ASSUMPTION; 0 KNOWN-DEFECT/DEVIATION blocks; 1 NOT-IMPLEMENTED. The six deviation findings are recorded separately as DV-001–DV-006; they are not encoded as expected behavior.
- Route audit: UI routes are listed in §7.3 and REST route families in §7.4. Unmapped in-scope routes/endpoints: 0. Shared not-found fallback and development-only /dev/theme are explicitly out of product test scope.
- Sensitive-data grep: email literals, credential assignments, JWT-like values, AWS access keys and bcrypt hashes each matched 0 times. A 10–13 digit scan matched only the documented quantity maximum 2147483647. No local account/record IDs were copied; .local-db/.local-secrets/.env contents were not inspected.
- No tests, application services, databases, network, mail provider, R2, or production systems were used for this documentation task.

| Module/area | CONFIRMED | IMPLEMENTED-UNDOCUMENTED | ASSUMPTION | KNOWN-DEFECT/DEVIATION | NOT-IMPLEMENTED | Total |
|---|---:|---:|---:|---:|---:|---:|
| identity | 5 | 0 | 0 | 0 | 0 | 5 |
| customer/profile | 1 | 0 | 0 | 0 | 0 | 1 |
| billing identity | 2 | 0 | 0 | 0 | 0 | 2 |
| geo/address | 2 | 0 | 0 | 0 | 0 | 2 |
| catalog/storefront | 3 | 0 | 0 | 0 | 0 | 3 |
| favorites/cart | 4 | 0 | 0 | 0 | 0 | 4 |
| checkout/sales | 3 | 0 | 0 | 0 | 0 | 3 |
| orders | 2 | 0 | 0 | 0 | 0 | 2 |
| billing/invoices | 3 | 0 | 0 | 0 | 0 | 3 |
| library | 2 | 0 | 0 | 0 | 0 | 2 |
| help/notifications | 2 | 0 | 0 | 0 | 0 | 2 |
| administration | 5 | 0 | 0 | 0 | 1 | 6 |
| cross-cutting NFR | 12 | 0 | 1 | 0 | 0 | 13 |
| TOTAL | 46 | 0 | 1 | 0 | 1 | 48 |

Section outline: 0 Document control; 1 Product overview; 2 Test environment; 3 Global rules; 4 Functional requirements; 5 Non-functional requirements; 6 End-to-end journeys; 7 Traceability matrix and route coverage; 8 Assumptions, deviations and out of scope; 9 Static self-check.
