# ADR-0017: Separate post-purchase lifecycle and historical documents

## Status

Accepted for implementation within the requested backend audit (2026-10-03).

## Context and audit

V006/V017 already provide immutable `pedido_item` identity/price/quantity snapshots,
an immutable `pedido_direccion` delivery/contact snapshot, separate `pago`, append-only
order history and transactional cancellation/refund/stock restoration. V032 extends
these purchases to digital and mixed orders without inventing digital stock.
The customer routes are `/api/v1/orders`, not `/me/orders`. Their detail uses
historical data, but their list has no items. Logistics currently shares `pedido.estado`.
No shipment, invoice, billing identity or credit note exists.

## Decision

Keep the modular monolith and Controller → Spring application transaction → JDBC
public Database API. Add typed relational fulfillment, shipment/history, invoice
header/billing address/lines, electronic processing/artifact extension tables, and
credit notes. No dependencies, workers, services or JSON business storage are added.
JSON remains only the existing Database API's nested read projection format.

`purchaseState` is the independent commercial interpretation of the existing order:
`PENDING_PAYMENT`, `CONFIRMED`, `CANCELLED`. The existing `orderState` remains a
compatible overall projection (`PREPARING`, `SHIPPED`, `DELIVERED` included).
Shipment is authoritative for physical logistics: `PENDING`, `PREPARING`, `SHIPPED`,
`OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`. Payment retains its existing states.
New shipment commands maintain the compatible overall projection; a fulfilled
purchase remains commercially CONFIRMED. Shipment events are append-only.

Only physical purchases acquire HOME_DELIVERY fulfillment. Mixed orders have one
physical shipment; digital-only orders have none. STORE_PICKUP is a reserved typed
method, without commands or behavior. No digital entitlements are implied.
Existing order address/item snapshots are reused and never replaced. Address changes
after purchase are unavailable; the API reports this explicitly. Cancellation remains
limited to approved payments before shipment and restores physical stock once.

Issue invoices explicitly through an ADMIN command with an explicit billing identity
and address, never by assuming the delivery recipient is the buyer. Copy purchased
lines and current v1 totals into immutable issuance records. V1 has no tax computation;
record tax amounts of zero with `NOT_ASSESSED`, without claiming tax exemption or
fiscal compliance. Issuance is not automatic at checkout. A full credit note can be
issued against a refunded purchase's existing invoice, preserving the invoice.
Partial refunds, return policies and tax calculation require a later amendment.

Provider-neutral electronic submission status/references/timestamps and PDF/XML
artifact references are separate typed extension tables. No SRI-specific identifier
semantics, authorization, document generation or legal compliance is claimed.

## Alternatives and consequences

Replacing the established order enum would break checkout, admin and frontend
consumers. Keeping all lifecycles in that enum would prevent independent documents
and tracking. Separate relational entities with an explicitly compatible overall
projection are the smallest evolution; compatibility duplicates a logistics summary
but all public commands update it atomically. Old routine bodies remain internal
delegates for established checkout/inventory invariants.

Migration backfills physical fulfillment and known shipment transitions from stored
history. Unknown carrier/estimates remain null. Existing documents are not fabricated.

## Validation

PostgreSQL 18 tests cover snapshots after profile/catalog edits, independent states,
delivery, cancellation, invoice/credit-note immutability and rejected transitions.
Live HTTP tests cover compact list/detail consistency, ownership, ADMIN commands,
Spanish validation, IDs/money formatting and available actions. Maven verification
and the entire PostgreSQL 18 CI gate protect existing checkout/inventory behavior.
