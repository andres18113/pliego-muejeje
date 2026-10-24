# Application security review — 2026-10-24

Scope: static review of application auth/RBAC, session lifecycle, frontend private-data storage, JDBC/injection sinks, billing delivery, mail HTTP/XML paths, and CI. No production calls, secrets displayed, account creation, or external mutations. Prior reviewer conclusions resumed where noted. Approved baseline artifacts were not changed.

## Confirmed defect — fixed locally

### APP-01 / Low: profile drafts retain personal data after logout or account replacement
- `frontend/src/features/account/profileDraft.ts:4,29-35,73` stores an edited field and its full original profile (name, email, telephone) in `sessionStorage`, with an in-memory Map fallback.
- Original `frontend/src/app/session.tsx:63-68` private-data cleanup removed queries/mutations and legacy billing data but never profile drafts.
- Reproduction: sign in, edit a profile field without saving, leave the editor, then logout or replace identity. Prior profile content remained in same-tab `sessionStorage` and the fallback remained readable by profile draft code.
- Exposure: a subsequent operator with access to that browser tab/storage can inspect prior personal data. No unauthenticated remote disclosure or access-token bypass was found.
- Fix: `clearProfileDrafts()` now clears the fallback and only `pliego-profile-draft:*` storage entries; the existing session private-data cleanup invokes it at logout, clear, expiry and identity replacement.
- Draft restoration during ordinary route changes, same-identity bearer renewal, and initial successful cookie restoration remains supported. Bootstrap preserves only drafts matching the authenticated canonical email; customerId and userId are independent sequences and are not assumed equal. Other users' drafts and invalid-cookie bootstrap drafts are purged. StrictMode bootstrap is covered. Other browser storage is retained.
- Regression evidence: five new cases failed before the fix; afterward `npm test -- src/app/session.test.tsx src/features/account/ProfileDraft.test.tsx` passed 31/31. `npm run typecheck` and scoped `git diff --check` passed. Full suite after updating the old cross-identity draft-retention assertion: 87 files / 1015 tests passed after the bootstrap preservation fix; log `/tmp/pliego-security/frontend/frontend-tests-bootstrap-privacy-final.log`. Final typecheck log: `/tmp/pliego-security/frontend/frontend-typecheck-bootstrap-privacy-final.log`. The authority test confirms the draft remains erased before and after a pending prior-account save completes; no refetch of the new account or late success UI occurs.
- Files changed: `frontend/src/app/session.tsx`, `frontend/src/app/session.test.tsx`, `frontend/src/features/account/profileDraft.ts`, `frontend/src/features/account/AccountAuthorityBoundary.test.tsx`.

## Confirmed absence of controls / residual abuse exposure

### APP-R1 / Medium, deployment-dependent: public registration bypasses mail request quotas
- `backend/src/main/java/com/pliego/modules/identity/application/AuthService.java:51-54` performs BCrypt and registers without a request-origin quota.
- `backend/src/main/resources/db/migration/V039__transactional_email.sql:75-82` creates an account and verification email without calling the email rate-limit routine.
- Email/IP quotas at `V039:112-114` apply to forgot-password/resend, not registration.
- Reproduction assumption: where the public API has no additional edge registration limit, submit valid registration requests with distinct email addresses from one source. Every successful request creates a persistent account and verification outbox row; quotas protecting resend/forgot do not apply.
- Consequence: account/database growth, BCrypt CPU consumption and outbound-email/provider-quota depletion; legitimate mail can be delayed in the shared outbox. No mail abuse performed, no account rows created, no deployed proxy configuration verified.
- This is a verified missing application control, not a verified production outage. Fix requires admission/rate controls at the trusted proxy or an application boundary, with consistent identity handling and explicit 429 semantics.

### APP-R2 / Accepted baseline: login has no brute-force control
- `AuthService.java:61-65` accepts every password attempt and performs BCrypt.
- `rest-api-contract-v1.0.md:2489` explicitly accepts this risk and defers proxy mitigation; do not misrepresent it as a new implementation regression.
- No deployed proxy protection verified. Rate limiting should be assessed before public exposure or revisited as a product-security decision.

### APP-R3 / Accepted design: access tokens outlive password reset/logout
- Reset revokes refresh sessions; previously issued access tokens retain their maximum 30-minute expiry (`EmailActionController.java:46`). Logout likewise only revokes the persistent session.
- This is documented bounded residual access, not evidence that refresh revocation fails.

## Controls examined / no additional confirmed exploit
- Prior reviewer plus resumed inspection: HS256-only decoder, minimum 32-byte signing key, exact issuer/audience, zero timestamp tolerance, positive numeric subject, allowed roles, UUID jti, and exact 30-minute lifetime.
- Host-only refresh cookie defaults HttpOnly, Secure, SameSite=Strict, narrow auth path; refresh/logout require custom session header and configured-origin CORS. Access token stays in frontend module memory.
- Security matcher requires ADMIN for admin paths and CUSTOMER for account/cart/orders; inspected controllers derive actor exclusively from validated JWT subject and forward actor plus resource ID to JDBC gateways. Database routine ownership is reviewed separately by the database workstream.
- JDBC gateways use prepared statements and bound parameters; inspected variable SQL selects internal constants. No dynamic request-to-SQL sink found in Java.
- No `dangerouslySetInnerHTML`, innerHTML, eval, or Function sink found in frontend source. Tracking links are restricted to HTTPS by database constraint and routine validation (V033:21,197). Return navigation paths are allowlisted (`AuthReturnPaths.java:8-19`).
- Billing documents pass JWT actor into the gateway, use attachment disposition, no-store and nosniff; no user-controlled filesystem path handling found.
- Invoice XML writer escapes values; schema validation enables secure processing and blocks external DTD/schema access (`InvoiceRenderer.java:176,214-216`). No untrusted inbound XML API found.
- Mail HTTP endpoint is configuration-owned, uses connect/request timeouts and NEVER redirects (`MailtrapMailSender.java:23,31`); no customer-controlled server HTTP target or process invocation found.
- Frontend reset/verification credentials come from fragments and are removed from history, retained in component memory (`emailActionHooks.ts:13-21,49`). Profile drafts do not persist passwords.
- CI is push/ordinary pull_request only, contents:read, with commit-pinned actions; no pull_request_target, secret interpolation or attacker-controlled shell expression found in `.github/workflows/ci.yml`.

## Limitations
- No live HTTP penetration test, distributed load test, browser exploit session, production config/proxy/role inspection, or provider call performed.
- Secret discovery and dependency/CVE analysis belong to sibling workstreams; this report does not certify their absence.
- An inability to clear browser storage when the browser itself throws on removal cannot be resolved by application code; in-memory draft fallback is always cleared first.
