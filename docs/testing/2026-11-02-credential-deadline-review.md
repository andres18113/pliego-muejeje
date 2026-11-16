# Credential deadlines, JWT validation and input bounds — review traceability (2026-11-02)

Scope: the JWT validator refactor and the extended review of every package with token, signature or time-window
checks, requested before the release on top of 0f745dd. Migration fixes live in `V100__credential_deadline_and_input_fixes.sql`;
V001–V098 are unchanged (V100 replaces routine bodies only — signatures, `SECURITY INVOKER` and grants are kept).
PPA-05 login protection is traced separately in [ppa05-login-attempt-protection.md](ppa05-login-attempt-protection.md).

Common defect class: a deadline compared with the transaction's start time (`CURRENT_TIMESTAMP`, or a qualification
evaluated before `FOR UPDATE`) is frozen while the transaction waits for a lock, so a credential or worker lease that
expires during the wait is still accepted. Every fix locks first and samples `clock_timestamp()` afterwards.

| Requirement | Defect before | Fix | Test (fails before, passes after) |
|---|---|---|---|
| Access tokens: HS256 only, issuer `pliego`, exactly audience `pliego-api`, positive canonical numeric `sub`, role CUSTOMER/ADMIN, canonical UUID `jti`, `iat` not in the future, `exp` present and exactly `iat`+1800 s, **and still current** | One OR-chained validator (no live bypass: the standard `JwtTimestampValidator(Duration.ZERO)` was already present) | `JwtConfiguration`: composite `DelegatingOAuth2TokenValidator` of built-in `JwtIssuerValidator`, `JwtTimestampValidator(ZERO)` (empty `exp` rejected), `JwtClaimValidator`s and one lifetime validator; uniform `INVALID_TOKEN`. Shared constants in `JwtAccessTokenClaims` | `JwtClaimValidatorsTest` (40 cases), `JwtConfigurationTest` (39 signed/unsigned tokens, incl. issued 3 days ago with exp = iat+30 min, expired 1 s ago, future iat/nbf, HS512/none), `AuthApiIntegrationTest` uniform Spanish 401 |
| Issuance and validation agree | `JwtTokenIssuer` signed a caller-supplied lifetime other than 1800 s (decoder rejected it) | Issuer rejects an inconsistent lifetime before signing | `JwtTokenIssuerTest.issue_whenCallerSuppliesDifferentLifetime_rejectsBeforeSigning` |
| Refresh: 30-day absolute expiry and 5-minute replay grace hold after a lock wait | `fn_auth_session_refresh` (V027) used transaction time | V100: lock session, then check expiry/revocation/state/grace on the wall clock | `credential_expiry_gate.py` (current/prior expiry after an observed wait, rotation/retry/revoke) |
| Email verification and password reset links expire at 24 h even after a lock wait | `fn_email_action_consume_internal_v039` (V039) compared frozen `CURRENT_TIMESTAMP` | V100: wall clock after user/token locks; public wrappers, fences and revocation unchanged | `credential_expiry_gate.py` (expired VERIFY_EMAIL/RESET_PASSWORD return false and consume nothing) |
| Offer windows are finite `[inicio, fin)` | `sp_edition_offer_set` (V044) checked ordering only; ±infinity broke public reads (500) | V100: `isfinite` on start/end, existing P1001 | `offer_timestamp_gate.sql`, `offers_http_gate.py` (Java MIN/MAX sentinels, nothing persisted) |
| Mail worker sends only within its lease | `fn_mail_outbox_prepare_send` (V094) qualified the lease before the row lock | V100: lock, then owner/state/lease on the wall clock; NULL owner rejected | `worker_lease_gate.py` |
| Invoice worker fails/reschedules only within its lease | `fn_invoice_artifact_fail` (V073) same pattern | V100: lock first, then check | `worker_lease_gate.py` |
| Admin catalog ids are bounded positive longs; list elements present | Digit strings above `Long.MAX_VALUE` and null elements reached `parseLong` → 500 | `AdminCatalogRequests`: existing `@DecimalMax` String-id convention, `@NotNull` elements, Spanish messages | `AdminCatalogApiIntegrationTest` (overflow/null → 400, gateway untouched; `Long.MAX_VALUE` controls) |
| Digital eligibility batch ids are all present | `?editionIds=1,,2` produced null → PostgreSQL 22P02 → 500 | `DigitalEligibilityController`: element `@NotNull` | `DigitalEligibilityApiIntegrationTest.batchRejectsEmptyIdentifierEntriesBeforeGateway` |

Reviewed without a confirmed defect: PPA-05 admission/windows/Retry-After math, refresh credential generation and
rotation, V096 registration continuation, email-change secrets (constant-time comparison), Mailtrap webhook HMAC
(constant-time, signature before parse), R2 SigV4 presigned URLs, and admin/customer/offer/invoice/library/pickup
authorization. Upgrade V098 → V100 is covered by `login_attempt_upgrade_gate.py`; the full runner expects 100 migrations.
