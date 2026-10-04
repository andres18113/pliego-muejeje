# Post-purchase backend audit and implementation — 2026-10-03

## Existing repository model

V006/V017 already contained distinct order/payment tables, immutable purchased
identity/price/quantity/totals, immutable recipient/address/contact snapshots,
append-only order/inventory histories and transactional checkout/cancellation.
V032 already supported physical/digital/mixed purchases and restored only physical
stock. Customer routes were `/api/v1/orders`; `/me/orders` was not present.
The missing concepts were separate physical fulfillment/shipment, tracking/estimated
delivery, billing identity, invoices and credit notes. Logistics lived in orderState;
list responses did not include purchased-item summaries or document availability.

## Delivered changes

V033 adds HOME_DELIVERY fulfillment for purchased physical formats, typed shipment
state/tracking/window/timestamps and append-only shipment events. STORE_PICKUP is
reserved without behavior. Digital-only purchases receive no physical fulfillment.
Backfill uses purchased format and recorded order history, preserving unknown values.

V034 adds immutable commercial invoice header/billing address/lines, typed external
electronic-processing/artifact extension tables and immutable full credit notes.
Explicit ADMIN issuance snapshots the billing identity/address and purchased lines;
refund/cancellation cannot rewrite them. Current v1 taxes remain zero/NOT_ASSESSED,
without asserting fiscal exemption or SRI compliance. Credit notes reference the
immutable invoice, require a refunded payment and preserve their own issuer/time/
number/reason/totals. Partial correction policies are not introduced.

The compatible overall orderState remains. Independent purchaseState describes
the commercial purchase; physical shipment owns its lifecycle including
OUT_FOR_DELIVERY. Payment keeps existing states. PostgreSQL calculates available
customer actions and owns all command rules; existing Spring services/gateways and
transaction boundaries are reused. No production dependencies/services were added.

Customer history adds at most three historical line summaries plus counts, shipment/
fulfillment/window and invoice availability. Customer/admin detail adds shipment/
history, invoice and credit-note projections, commercial state and actions. ADMIN
adds tracking, shipment transition, invoice issuance and full credit-note commands.
Existing checkout/cancel signatures and string ID/money conventions are preserved.
OpenAPI schema names distinguish customer/admin summaries and document requests/
responses. Details are in [amendment 0008](../api-amendments/0008-post-purchase-v1.0.8.md)
and [ADR-0017](../adr/0017-post-purchase-lifecycle-and-documents.md).

## Verification evidence

- RED before implementation: SQL asserted missing commercial/shipment projections;
  all four new live HTTP tests failed against V032/old REST on missing fields/routes.
- Targeted SQL passed for saved-address/profile/catalog edits, complete shipment
  delivery, cancellation/refund, invoice snapshot stability and mutation/append/delete
  guards, invoice preservation after refund, full-credit-note issuance/immutability,
  list/detail consistency, invalid/terminal transitions and digital-only purchases.
- Targeted live HTTP gate passed 4/4 groups through real Spring JDBC/PostgreSQL,
  including ADMIN access control, Spanish validation, actions, exact money and IDs.
- Targeted existing customer/admin order Maven tests passed 18/18.
- Final `mvn -B -f backend/pom.xml clean verify`: 123 tests, zero failures/errors/skips,
  BUILD SUCCESS on Java 25.0.4.1. Existing endpoint-coverage total updated 58 → 62.
- Populated Flyway V032 → V034 upgrade passed for confirmed/preparing/shipped/
  delivered/canceled/rejected and digital-only orders. All previous detail fields
  and recorded history times remained equal; no invoices/carriers/estimates were
  fabricated. Final successful Flyway history: 34 migrations through V034.
- Full `backend/src/test/postgres18/run_ci_gates.sh` passed on a separate clean
  PostgreSQL 18.6 database: 11 SQL gates, 5 concurrency gates and 7 HTTP gates.
  This includes all existing checkout/customer/admin order, inventory-restoration
  and digital-edition gates. The first attempt used populated upgrade fixtures;
  the existing catalog-category gate intentionally requires clean global counts,
  so it was rerun on a new empty database and passed without changing that test.
- Runtime OpenAPI verified distinct typed customer/admin/detail/invoice/credit-note
  schemas, exact money strings, the customer list item schema and all four routes.
- Fresh read-only review found a legacy SQLSTATE/validation-precedence regression.
  Direct-routine tests reproduced RED P5002; restoring P1001 before order lookup
  produced GREEN. Final Maven and complete PostgreSQL gate ran after this fix.
- SHA-256 verification confirmed all pre-existing migration files V001–V032 stayed
  unchanged, including the pre-existing uncommitted V032. `git diff --check` passed.

Test logs and fixture snapshots were held in `/tmp/pliego-postpurchase-*`; no real
customer data or credentials were used. Borrowed older urllib test helpers emit
Python 3.14 resource-cleanup warnings on error responses; these did not affect results.

## Deliberately deferred

Real payment/carrier integrations, carrier webhooks, pickup behavior, split shipments,
shipping-address corrections, digital entitlements, partial returns/refunds, tax
calculation/fiscal numbering, PDF/XML generation/storage/download authorization and
SRI submission/compliance. No frontend changes, commits, pushes or deployment.
