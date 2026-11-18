# Tiered billing identity corrections and invoice recipients — API amendment

Decision: [ADR-0043](../adr/0043-tiered-billing-identity-and-invoice-recipients.md). This amendment supersedes the correction and checkout-recipient rules in [ADR-0040's amendment](2026-10-21-required-correctable-cedula.md); approved v1.0 baselines remain unchanged. The current static OpenAPI contract is updated. Additive database changes are exactly V080 and V081.

## Customer billing identity

- `GET /api/v1/me/billing-identity` remains `204` when no identity is registered. Otherwise it returns `200`, always with `Cache-Control: no-store`:

```json
{
  "type": "EC_CEDULA",
  "number": "0912345675",
  "used": true,
  "correctionMode": "REQUEST",
  "correctionRequest": {
    "id": "17",
    "status": "PENDING",
    "proposedType": "EC_RUC",
    "proposedNumber": "0912345675001",
    "reasonCode": "DOCUMENT_TYPO",
    "createdAt": "2026-10-25T12:00:00Z",
    "dueAt": "2026-11-09T12:00:00Z",
    "decidedAt": null,
    "decisionReason": null
  }
}
```

`correctionRequest` is the PENDING request, otherwise the latest decided/withdrawn request closed in the previous 30 days, otherwise `null`. `used` means any invoice in any state on the customer's orders has `destinatario_tipo=ACCOUNT` or `NULL` (historical recipient unknown). OTHER invoices do not count. The flag remains true after account identity changes. `correctionMode` is `DIRECT` when unused and `REQUEST` when used; a same-person cédula ↔ RUC change remains a direct exception when used.

- `POST /api/v1/me/billing-identity/correction` accepts `{ "type", "currentNumber", "number" }` without a password. It may include the legacy `currentPassword` string; it is ignored and not validated. The response is `204` with `Cache-Control: no-store`. An unused identity is corrected directly. If used, only the same-person cédula ↔ RUC pair ending in RUC establishment `001` is direct; all other changes return `409` `P1107 BILLING_IDENTITY_CORRECTION_REQUIRES_REVIEW`. Any valid direct-correction attempt while a request is PENDING returns `409 P1108 BILLING_IDENTITY_CORRECTION_PENDING`.
- `POST /api/v1/me/billing-identity/correction-requests` requires `Idempotency-Key: <UUID>` and accepts:

```json
{
  "type": "EC_RUC",
  "currentNumber": "0912345675",
  "number": "0912345675001",
  "reasonCode": "DOCUMENT_TYPO",
  "note": "El número se registró con un dígito incorrecto."
}
```

It returns `201 Created`, a `Location` header ending in `/api/v1/me/billing-identity/correction-requests/{id}`, and the request snapshot:

```json
{
  "id": "17",
  "status": "PENDING",
  "proposedType": "EC_RUC",
  "proposedNumber": "0912345675001",
  "reasonCode": "DOCUMENT_TYPO",
  "createdAt": "2026-10-25T12:00:00Z",
  "dueAt": "2026-11-09T12:00:00Z",
  "decidedAt": null,
  "decisionReason": null
}
```

`note` is optional, trimmed, and at most 500 characters. Reasons are `DOCUMENT_TYPO`, `DOCUMENT_CHANGED`, or `OTHER`. Replaying the same key and canonical payload returns the same request; changing its payload returns `409 P1010 IDEMPOTENCY_CONFLICT`. A second pending request returns `409 P1108 BILLING_IDENTITY_CORRECTION_PENDING`.

- `POST /api/v1/me/billing-identity/correction-requests/{id}/withdraw` withdraws the customer's own PENDING request and returns `204`. Another account's or nonexistent id returns `404 P1109 BILLING_IDENTITY_CORRECTION_NOT_FOUND`.

## Admin correction requests

All routes require an ADMIN actor; PostgreSQL routines re-check the role.

- `GET /api/v1/admin/billing-identity-corrections?status=PENDING&page=0&pageSize=20` returns the existing page envelope:

```json
{
  "items": [
    {
      "id": "17",
      "customerId": "42",
      "customerName": "Ana Pérez",
      "customerEmail": "ana@example.invalid",
      "currentType": "EC_CEDULA",
      "currentNumber": "0912345675",
      "proposedType": "EC_RUC",
      "proposedNumber": "0912345675001",
      "reasonCode": "DOCUMENT_TYPO",
      "note": "El número se registró con un dígito incorrecto.",
      "status": "PENDING",
      "createdAt": "2026-10-25T12:00:00Z",
      "dueAt": "2026-11-09T12:00:00Z",
      "decidedAt": null,
      "decidedBy": null,
      "decisionReason": null
    }
  ],
  "page": 0,
  "pageSize": 20,
  "totalCount": "1"
}
```

Rows are ordered by oldest `dueAt` first; `status` is optional and pagination defaults to `page=0&pageSize=20`.
An empty out-of-range page still reports the filtered `totalCount`; offsets beyond the existing integer bound return `400 P1006 PAGINATION_OUT_OF_RANGE`.
- `POST /api/v1/admin/billing-identity-corrections/{id}/decision` accepts `{"decision":"APPROVE"}` or `{"decision":"REJECT","decisionReason":"La documentación recibida no permite confirmar el cambio solicitado."}` and returns:

```json
{
  "id": "17",
  "status": "APPROVED",
  "decidedAt": "2026-10-25T12:30:00Z",
  "decidedBy": "30",
  "decisionReason": null
}
```

`decisionReason` is required and Spanish for REJECT. A snapshot conflict returns existing `409 P1105 BILLING_IDENTITY_CONFLICT` and leaves the request pending. A closed request returns `409 P1111 BILLING_IDENTITY_CORRECTION_INVALID_TRANSITION`.

## Checkout invoice recipient

`POST /api/v1/checkout` adds optional `billingRecipient`, accepting `ACCOUNT` or `OTHER` and defaulting to `ACCOUNT`. The existing `billingIdentity`, `buyerName`, and `billingAddress` values remain required for either recipient.

```json
{
  "addressId": "15",
  "paymentMethod": "TRANSFER",
  "simulationOutcome": "APPROVED",
  "fulfillmentMethod": "HOME_DELIVERY",
  "billingRecipient": "OTHER",
  "billingIdentity": { "type": "EC_CEDULA", "number": "1710034065" },
  "buyerName": "Comprador tercero",
  "billingAddress": {
    "line1": "Calle fiscal",
    "provinceId": "17",
    "cityId": "893",
    "countryCode": "EC"
  }
}
```

- `ACCOUNT` preserves current behavior, including first-use registration and `409 P1106 BILLING_IDENTITY_MISMATCH`; new invoices store `destinatario_tipo=ACCOUNT`.
- `OTHER` snapshots the supplied buyer name, identification and address on the invoice. It does not register or change account identity and does not apply P1106. New invoices store `destinatario_tipo=OTHER`; OTHER-only invoice history does not set `used` or change `correctionMode` from `DIRECT`. The idempotency fingerprint includes the kind, so same-key ACCOUNT/OTHER changes return `409 P1010 IDEMPOTENCY_CONFLICT`.
- A same-payload ACCOUNT retry recorded before recipient kind was added remains replayable; pre-existing OTHER/ACCOUNT or changed-payload attempts still conflict. Historical invoices retain `destinatario_tipo=NULL`; the schema default applies only to new invoice inserts.

## Cédula and RUC validation

Billing identity registration, direct correction, correction requests, and either checkout recipient validate `EC_CEDULA` and `EC_RUC` in Java and PostgreSQL. Cédulas and natural-person RUCs keep the modulo-10 cédula check; natural-person RUCs require establishment `001`–`999`. Third-digit-6 public-sector and third-digit-9 private-company RUCs retain 13 digits, a valid province, and a nonzero establishment, but no longer require modulo-11. Validation checks structure only and does not establish SRI registration or ownership.

## New domain errors

| SQLSTATE | Code | HTTP | Spanish title | Spanish detail |
|---|---|---:|---|---|
| P1107 | BILLING_IDENTITY_CORRECTION_REQUIRES_REVIEW | 409 | Esta identificación requiere revisión | Esta identificación ya figura en una factura. Solicita la corrección para que la revisemos. |
| P1108 | BILLING_IDENTITY_CORRECTION_PENDING | 409 | Ya tienes una solicitud pendiente | Ya existe una solicitud de corrección pendiente para esta cuenta. |
| P1109 | BILLING_IDENTITY_CORRECTION_NOT_FOUND | 404 | Solicitud no encontrada | La solicitud no existe o no está disponible para esta cuenta. |
| P1110 | BILLING_IDENTITY_CORRECTION_NOT_REQUIRED | 409 | Puedes corregirla directamente | Esta identificación no requiere una solicitud; usa la corrección directa de tu perfil. |
| P1111 | BILLING_IDENTITY_CORRECTION_INVALID_TRANSITION | 409 | Solicitud ya atendida | La solicitud ya no está pendiente y no puede cambiarse. |

Existing `P1105 BILLING_IDENTITY_CONFLICT`, `P1106 BILLING_IDENTITY_MISMATCH`, `P1010 IDEMPOTENCY_CONFLICT`, and their mappings remain unchanged.
