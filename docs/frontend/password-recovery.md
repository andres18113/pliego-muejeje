# Password reset from the profile

The profile sheet includes the **Contraseña → Cambiar** row. The row opens in place with one sentence naming the current email and the link's limits, and **Enviar enlace** / Cancelar in the action slot; the outcome appears in the row's status line. It uses the current email from `GET /api/v1/me`, never the editing draft or the session's old email; the step remounts if that email changes and discards late responses. While the profile refreshes, Enviar enlace waits. With an email pending verification, Cambiar is disabled and a quiet line under the sheet offers to resend the verification.

The identity recovery flow is reused, with no new API and no new password rule:

1. The explicit click calls `POST /api/v1/auth/forgot-password` with the profile email and `returnTo: "/account"`.
2. The existing transactional service requests the action through JDBC and the Database API. The mail worker delivers the link.
3. The link opens `/restablecer-contrasena?from=%2Faccount#token=…`. The page removes the token from the address and keeps it in memory only. Opening the link does not consume it.
4. The person types and confirms the new password. `POST /api/v1/auth/reset-password` consumes the token once and revokes previous refreshable sessions.
5. Access continues through the usual sign-in; its main action keeps the return to the profile. There is no automatic sign-in.

Existing server controls keep the token hash, 15-minute expiry, request limits and a generic public response. The request alone neither changes the password nor ends the session. Access tokens issued before the change keep their bounded expiry; the interface does not promise an instant sign-out on other devices.

The profile action blocks simultaneous clicks and waits one minute before allowing another explicit request after an acceptance, an uncertain result or a rate limit. It never retries automatically. «Solicitud recibida» confirms acceptance, not delivery. A lost response asks the person to check the inbox before retrying. Late results are discarded if the account, the view or the shown email changes. The visual wait complements the server limits.

Decision aligned with the [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): recovery through a separate channel, a single-use expiring link and later access through normal sign-in. The Spring → JDBC → Database API architecture is kept and the schema is not modified.

## Verification

- `PasswordRecovery.test.tsx`: profile sheet row, opening in place, Escape/Cancelar, current email, simultaneous clicks, manual resend, uncertain failures, definite rejection, rate limit, pending verification, and account/email changes during the response.
- `backend/src/test/postgres18/password_profile_http_gate.py`: REST, PostgreSQL and delivery to a local HTTP provider; concurrent single use, expiry, quotas, rejection of the old password, access with the new one and revocation of refreshable sessions. Requires a **disposable, migrated** database, the built JAR and the local `PG*`, `PLIEGO_DB_*`, `PLIEGO_JWT_SECRET` variables. Run with `python3 backend/src/test/postgres18/password_profile_http_gate.py`; `--serve` offers a backend and local mailbox fixture for the browser. It never delivers external mail.
- Regressions: full frontend suite, build and browser coverage for profile, navigation and billing. An additional real run from the profile to the local mailbox, reset and sign-in; visual review at 320/768/1280 px in both themes.

Local evidence for the original implementation: `/tmp/pliego-password-*.log` and `/tmp/pliego-password-profile-*.png`. Fixtures use synthetic accounts and no credentials or tokens are included in the repository.

Result on 17 October 2026: **898/898 frontend tests**, **20/20 browser tests**, build approved and a full real run with local mail approved. The independent review left no open findings. The real run confirmed a single send and consumption, rejection of the old password, access with the new one and return to the profile. Screenshots in six size and theme combinations.
