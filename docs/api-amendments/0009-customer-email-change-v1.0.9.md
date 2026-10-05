# API amendment v1.0.9 — Customer email change

Implemented by V035. Approved baselines and existing migrations remain unchanged. Runtime
`/v3/api-docs` documents the new route; the frontend OpenAPI export is not regenerated here
(it also predates v1.0.8), so the frontend types this one route locally.

## Why

The CUSTOMER profile could change names and phone (`PUT /api/v1/me`) but not the email, which is
also the sign-in identity. Mi perfil edits each field separately, including the email.

## Route

`PUT /api/v1/me/email` (CUSTOMER, JWT subject is the actor)

```json
{ "newEmail": "nuevo@example.com", "currentPassword": "…" }
```

| Status | Code | When |
|---|---|---|
| 200 `{ "email": "nuevo@example.com" }` | — | Changed (or already that email). The response carries the normalized stored email. |
| 400 | `VALIDATION_ERROR` | Missing/blank/malformed email (> 254 chars, no `@`) or missing current password. |
| 400 | `CURRENT_PASSWORD_INVALID` | The current password is wrong. Deliberately not 401: the session is valid. |
| 400 | `P1001` | The database rejects the normalized email (same rule as registration). |
| 409 | `P1101` | Another account already uses that email (same code as registration). |
| 401 | — | Missing/expired JWT, as for every `/me` route. |

Human-facing titles and details are Spanish. No existing code or SQLSTATE mapping changed;
`CURRENT_PASSWORD_INVALID` is new.

## Behavior

- Re-authentication happens in the application with the existing BCrypt `PasswordEncoder`; the
  database never receives the plaintext password. `fn_customer_password_hash(actor)` serves only the
  CUSTOMER actor's own hash.
- `sp_customer_change_email(actor, new_email, OUT email)` reuses registration's
  `fn_normalize_email`, validation (P1001) and the `uq_usuario_email` uniqueness (P1101). It locks the
  user row; an unchanged email is an idempotent no-op.
- Sessions and JWTs are keyed by user id, so open sessions stay valid. The next sign-in uses the new email.
- Profile reads (`GET /api/v1/me`) and the refresh response show the new email.

## Mail integration point

No email is sent. After a real change the application publishes `CustomerEmailChanged(userId,
previousEmail, newEmail)`. A future mail adapter (Mailtrap/Brevo) should listen with
`@TransactionalEventListener(phase = AFTER_COMMIT)` to notify the previous address or confirm the new
one. If confirmation-before-switch is later required, the route can evolve to a pending change
without changing the stored-email rules above.

## Verification

- `customer_email_change_gate.sql` (added to `run_ci_gates.sh`, which now expects 35 migrations):
  normalization, sign-in with the new email only, idempotency, P1101, P1001 without side effects,
  CUSTOMER-only actor.
- `CustomerApiIntegrationTest`: password confirmation, Spanish problems for taken/malformed input,
  event published only for a real change.
