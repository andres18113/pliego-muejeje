# API amendment v1.0.8 — Post-purchase lifecycle and documents

Implemented by V033/V034 and [ADR-0017](../adr/0017-post-purchase-lifecycle-and-documents.md).
Approved baselines and existing migrations remain unchanged. Runtime `/v3/api-docs`
documents the expanded typed schemas; the frontend OpenAPI export is untouched.

## Existing behavior and state boundaries

Customer endpoints remain `GET /api/v1/orders`, `GET /api/v1/orders/{orderId}` and
`POST /api/v1/orders/{orderId}/cancel`. There is no `/me/orders` alias. Identifiers
and money remain JSON strings, quantities/counts remain numbers, timestamps are
ISO 8601, absent objects are null and histories are arrays.

| Concept | Authoritative representation | States |
|---|---|---|
| Commercial purchase | `purchaseState`, derived from the existing order | PENDING_PAYMENT, CONFIRMED, CANCELLED |
| Compatible overall order projection | Existing `orderState` | PENDING_PAYMENT, CONFIRMED, PREPARING, SHIPPED, DELIVERED, CANCELLED |
| Payment | Existing `payment.state` / list `paymentState` | PENDING, APPROVED, REJECTED, REFUNDED |
| Fulfillment | `fulfillment.method` | HOME_DELIVERY implemented; STORE_PICKUP reserved |
| Physical shipment | `shipment.state` | PENDING, PREPARING, SHIPPED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED |
| Invoice | `invoice.state` | ISSUED; DRAFT is internal atomic issuance staging |
| Electronic processing | Nullable `invoice.electronicIssuance.state` | SUBMITTED, AUTHORIZED, REJECTED, for a future adapter |
| Full credit note | `creditNotes[].state` | ISSUED |

An order delivered at home has purchaseState CONFIRMED, shipment DELIVERED,
payment APPROVED and overall orderState DELIVERED. Cancellation can independently
yield purchaseState CANCELLED, payment REFUNDED, shipment CANCELLED, invoice ISSUED
and a subsequently issued credit note. Invoice issuance does not ship or change
payment; cancellation/refund never alters an issued invoice.

Physical shipment progresses PENDING → PREPARING → SHIPPED → OUT_FOR_DELIVERY →
DELIVERED. SHIPPED → DELIVERED remains supported for existing admin clients.
OUT_FOR_DELIVERY leaves the compatible overall projection SHIPPED. Cancellation
is available before shipment, from approved CONFIRMED/PREPARING purchases; the
existing cancellation command owns payment refund, stock restoration and shipment
cancellation in one transaction. There is no separate shipment-cancel command
that could silently leave a paid active order.

Only purchased physical formats create HOME_DELIVERY fulfillment and a shipment.
Mixed orders have one physical shipment. Digital-only orders have null fulfillment
and shipment; no digital delivery/entitlement is implied. The prior digital-only
admin order transition behavior is retained for compatibility.

## Compact history projection

`GET /api/v1/orders` preserves pagination, ownership and ordering. Each existing
summary gains:

- `purchaseState`, nullable `fulfillmentMethod`, nullable `shipmentState`.
- Nullable `estimatedDeliveryFrom` / `estimatedDeliveryTo`.
- `itemCount` (distinct purchased lines), `unitCount` (sum of quantities),
  `itemSummary`: at most three purchased lines ordered by orderItemId, each with
  string `orderItemId`, historical `title`, `format`, numeric `quantity`.
- Nullable `invoiceState`, `invoicePdfAvailable`, `invoiceXmlAvailable`.

No delivery address, full items, tracking history, billing identity or invoice
lines are repeated in list responses. No current catalog title/price/cover is
used to reconstruct purchased identity. A missing invoice has null invoiceState
and false artifact flags.

## Customer and administrative detail

Existing detail fields (`items`, `subtotal`, `total`, `address`, `payment`,
`stateHistory`, and admin inventory movements/customer information) remain.
Both detail endpoints add:

- `purchaseState`.
- `fulfillment`: null or `{method}`.
- `shipment`: null or string `shipmentId`, `state`, nullable `carrier`,
  `trackingCode`, `trackingUrl`, estimated window, `createdAt`, nullable
  `preparingAt`, `shippedAt`, `outForDeliveryAt`, `deliveredAt`, `canceledAt`,
  and append-only `history`.
- Shipment events contain string `eventId`, `type` STATUS/TRACKING,
  `origin` USER/SYSTEM/MIGRATION, nullable string `actorUserId`, previous/new
  state, carrier/tracking snapshots and `at`. Migration events retain the
  recorded historical times. Editing tracking records a new event.
- `invoice`: null or the issued invoice described below.
- `creditNotes`: full credit-note summaries (empty when absent), with string
  creditNoteId/invoiceId, documentNumber, state, reason, subtotal, taxTotal,
  total and issuedAt. Full corrections refer to the invoice's immutable lines
  and billing identity/address; they do not duplicate those snapshots.
- `availableActions`: `{cancel: boolean, changeShippingAddress: false}`.

Actions come from PostgreSQL and are advisory snapshots: commands revalidate under
the order lock. Existing order-time delivery addresses remain immutable. Profile
and saved-address edits never change them; shipping-address replacement after
purchase is intentionally unsupported. An invoice billing address is separate.

## Administrative commands

All new commands require ADMIN. Services own Spring transactions, and gateways
invoke public routines without business-table SQL. Query detail after an unknown
command response before deciding whether to retry issuance/transition commands.
Repeated invoice/full credit issuance returns a conflict.

| Route | Input | Success |
|---|---|---|
| `POST /api/v1/admin/orders/{orderId}/shipment/transitions` | `{targetState}`: PREPARING/SHIPPED/OUT_FOR_DELIVERY/DELIVERED | 200 `{orderId, shipment}` |
| `PUT /api/v1/admin/orders/{orderId}/shipment/tracking` | Full replacement of nullable carrier/tracking/window fields | 200 `{orderId, shipment}` |
| `POST /api/v1/admin/orders/{orderId}/invoice` | Explicit document number, buyer identity and billing address | 201 `{orderId, invoiceId}` |
| `POST /api/v1/admin/orders/{orderId}/credit-notes` | `{documentNumber, reason}` for a full credit | 201 `{orderId, creditNoteId}` |

Tracking accepts carrier/trackingCode/trackingUrl, estimatedDeliveryFrom/To.
URLs require HTTPS, tracking codes require a carrier, URLs require a code,
and both window endpoints must be present together with from ≤ to. Null fields
clear those values. Delivered/canceled shipments cannot be modified or regressed.

Invoice request:

```json
{
  "documentNumber": "COMMERCIAL-0001",
  "buyerName": "Nombre del comprador",
  "identityType": "OTHER",
  "identityNumber": "Identificación proporcionada",
  "buyerEmail": "billing@example.invalid",
  "billingAddress": {
    "line1": "Dirección de cobro",
    "line2": null,
    "city": "Quito",
    "province": "Pichincha",
    "countryCode": "EC",
    "postalCode": null
  }
}
```

Buyer email is optional. Identity types are provider-neutral NATIONAL_ID, TAX_ID,
PASSPORT, OTHER; validation does not certify any country's identifier algorithm.
Document numbers are unique application/commercial references, without claiming
SRI numbering semantics. The command derives lines and totals from purchased
snapshots and requires an approved, active purchase. It never accepts caller
prices, quantities, taxes, totals or arbitrary metadata.

## Invoice and credit-note model

Invoice detail contains invoiceId, documentNumber, state, buyerName, identityType,
identityNumber, buyerEmail, currency USD, subtotal, taxTotal, total, issuedAt,
separate billingAddress, immutable items, nullable electronicIssuance and PDF/XML
availability flags. Each item contains invoiceItemId, orderItemId, description,
quantity, unitPrice, subtotal, taxTreatment, nullable taxRate, taxAmount and total.
Money is an exact two-decimal string. Tax rate, when future computation exists,
is a decimal percentage string.

Current checkout total equals subtotal and performs no tax calculation. Issuance
therefore preserves zero tax with NOT_ASSESSED and null taxRate; this is a commercial
record, not a claim that a product is tax-exempt or that this is a compliant fiscal
invoice. ISSUED means the local immutable commercial document exists, distinct from
future electronic authorization. Header, billing address and lines cannot be
updated/deleted; lines also cannot be appended after issuance.

A refunded purchase with an issued invoice may receive exactly one full credit
note. It references the immutable invoice, copies its totals, records its own
number/reason/issuer/time, and remains immutable. No credit is issued automatically
by cancellation, and no credit exists without an invoice or refund. Partial refunds,
returns and fiscal correction policy are deferred.

Electronic extension tables hold provider/state/externalReference/submittedAt/
authorizedAt, and PDF/XML object references. No SRI-specific access-key or
authorization-number semantics are invented. Absence of adapter records/artifacts
is null/false; there are no generated dummy PDF/XML URLs or download endpoints.

## Persistence and Database API

V033 adds pedido_entrega, envio, envio_historial; it backfills only physical orders,
using purchased formats and recorded order history/timestamps. Unknown tracking,
estimates and out-for-delivery times stay null. V034 adds factura, factura_direccion,
factura_item, factura_emision_electronica, factura_archivo and nota_credito. It does
not fabricate invoices for old orders.

The public checkout/cancel/order-status signatures are unchanged. Their preserved
V032 checkout/cancel bodies are renamed internal delegates. Customer order detail
and admin detail append purchase_state/fulfillment/shipment/invoice/credit_notes/
available_actions; customer list appends the compact fields described above. Original
read routines remain internal delegates for ownership, snapshots and approved errors.

New public procedures (all IN parameters except explicit OUT):

```text
sp_shipment_transition(actor BIGINT, order BIGINT, target VARCHAR)
sp_shipment_update_tracking(actor BIGINT, order BIGINT, carrier VARCHAR,
  code VARCHAR, url VARCHAR, estimated_from TIMESTAMPTZ, estimated_to TIMESTAMPTZ)
sp_invoice_issue(actor BIGINT, order BIGINT, document_number VARCHAR,
  buyer_name VARCHAR, identity_type VARCHAR, identity_number VARCHAR,
  buyer_email VARCHAR, line1 VARCHAR, line2 VARCHAR, city VARCHAR,
  province VARCHAR, country_code VARCHAR, postal_code VARCHAR, OUT invoice_id BIGINT)
sp_credit_note_issue(actor BIGINT, order BIGINT, document_number VARCHAR,
  reason VARCHAR, OUT credit_note_id BIGINT)
```

All commands lock the order before its dependent entities. Existing wire SQLSTATEs
remain stable: P1001 invalid input, P5001 missing/unavailable order, P5002 incompatible
transition or duplicate document, P5003 cancellation conflict, P5006 payment conflict.
No new error mapping is introduced. HTTP human-facing validation/errors stay Spanish.

## Verification and deferred integrations

`post_purchase_gate.sql` verifies historical snapshots, invoice mutation guards,
independent states, delivered/canceled lifecycles, credit notes and list/detail
consistency. `post_purchase_http_gate.py` tests real REST/JDBC projections and commands.
`post_purchase_upgrade_gate.py prepare|verify` checks a populated V032 → V034 upgrade.
The complete PostgreSQL 18 CI gate now requires 34 migrations and includes the new
SQL/HTTP gates, alongside existing checkout/order/digital/concurrency checks.

Real carrier integration/webhooks, pickup, split shipments, address corrections,
digital entitlements, partial returns/refunds, tax computation, fiscal numbering,
PDF/XML generation/storage/download authorization and SRI submission/compliance
are future work. No new production service or frontend change is included.
