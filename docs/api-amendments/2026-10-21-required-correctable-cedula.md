# Required identification and re-authenticated correction — API amendment

Decision: [ADR-0040](../adr/0040-required-correctable-cedula.md). Supersedes the `PUT`/`DELETE /api/v1/me/billing-identity` entries and the optional `POST /api/v1/checkout` extension of [2026-10-17](2026-10-17-academic-billing.md). New migration `V074__customer_billing_identity_lifecycle.sql`; no approved migration or baseline is edited.

- `GET /api/v1/me/billing-identity`: unchanged. 200 `{type,number}` or 204.
- `PUT /api/v1/me/billing-identity` `{type,number}`: registers the first identification, 204. Repeating the same number returns 204 with no change. A number different from the stored one returns 409 `P1105 BILLING_IDENTITY_CONFLICT`.
- `POST /api/v1/me/billing-identity/correction` `{type,currentNumber,number,currentPassword}`: corrects, 204. Wrong password: 400 `CURRENT_PASSWORD_INVALID`. `currentNumber` different from the stored one: 409 `P1105`. Same or invalid number: 400 `VALIDATION_ERROR`. Audited.
- `DELETE /api/v1/me/billing-identity`: retired; returns 405 `METHOD_NOT_ALLOWED` (unsupported methods no longer return 500).
- `POST /api/v1/checkout`: `billingIdentity`, `buyerName` and `billingAddress` are required (400 when missing). The number must match the customer's own; when the customer has none, the purchase registers it. On mismatch: 409 `P1106 BILLING_IDENTITY_MISMATCH`, with no order and no attempt.

| SQLSTATE | Code | HTTP | Title (Spanish, user-facing) |
|---|---|---|---|
| P1105 | BILLING_IDENTITY_CONFLICT | 409 | Tu identificación cambió |
| P1106 | BILLING_IDENTITY_MISMATCH | 409 | Identificación distinta a la de tu perfil |

Messages never echo the number. Routines: `sp_customer_billing_identity_register`, `sp_customer_billing_identity_correct` and `sp_checkout_billed_quoted` (extended definition). `sp_customer_billing_identity_set` and `sp_customer_billing_identity_remove` are retired.

## Cédula or RUC (ADR-0041, migration `V075__ecuador_identification_ruc.sql`)

- `type` accepts `EC_CEDULA` or `EC_RUC` in `PUT /api/v1/me/billing-identity`, `POST /api/v1/me/billing-identity/correction` and the checkout `billingIdentity`. The number must satisfy the full algorithm of its kind; otherwise 400 `VALIDATION_ERROR` on the `number` field with "Ingresa una cédula (10 dígitos) o un RUC (13 dígitos) válidos".
- `GET /api/v1/me/billing-identity` may return `EC_RUC` with 13 digits.
- A correction may change the kind. The invoice records `TAX_ID` for a RUC; the XML uses `tipoIdentificacionComprador` 04 (RUC) or 05 (cédula).
