# API amendment: INEC province and city catalog

**Date:** 2026-10-25  
**Status:** Accepted  
**Related decision:** ADR-0044

## Public reference reads

### `GET /api/v1/geo/provinces`

Returns Ecuador's active provinces, ordered with Spanish collation.

```json
[
  { "id": "17", "code": "17", "name": "Pichincha" },
  { "id": "23", "code": "23", "name": "Santo Domingo de los Tsáchilas" }
]
```

### `GET /api/v1/geo/provinces/{provinceId}/cities`

Returns active selectable localities in the province, ordered alphabetically by Spanish collation and then by canton name and DPA code. Canton seats are not placed ahead of the alphabetical order.

```json
[
  {
    "id": "899",
    "code": "170156",
    "name": "Conocoto",
    "kind": "PARROQUIA_RURAL",
    "cantonName": "Distrito Metropolitano de Quito",
    "aliases": []
  },
  {
    "id": "893",
    "code": "1701",
    "name": "Quito",
    "kind": "CABECERA_CANTONAL",
    "cantonName": "Distrito Metropolitano de Quito",
    "aliases": []
  }
]
```

Each city always includes `aliases: string[]`, ordered with Spanish collation. For example, Guayas includes:

```json
{
  "id": "495",
  "code": "0927",
  "name": "General Antonio Elizalde",
  "kind": "CABECERA_CANTONAL",
  "cantonName": "General Antonio Elizalde",
  "aliases": ["Bucay", "General Elizalde"]
}
```

Migration V082 seeds the complete INEC CGE 2026 code set: 1,171 city rows (223 seat rows, 948 rural-parish rows), 1,048 active choices and 278 evidence-backed, province-scoped aliases (Bucay → General Antonio Elizalde, Playas → General Villamil, Chongón → Guayaquil). Sevilla Don Bosco is the current canonical seat 1413; its starred former rural parish 140157 stays inactive. `pliego_app` keeps SELECT only on `provincia`, `ciudad` and `ciudad_alias`, even where production default privileges grant DML. Legacy addresses and pickup locations are backfilled only while their IDs are null; historical order/invoice/pickup snapshots remain unchanged.

IDs are decimal JSON strings. `code` is the official two-digit province DPA code on province rows, and the four- or six-digit DPA code on city rows. `kind` is `CABECERA_CANTONAL` or `PARROQUIA_RURAL`. City labels can repeat; `cantonName` disambiguates them.

Both public GET responses include:

```http
Cache-Control: public, max-age=86400, stale-while-revalidate=86400
```

ETag is not defined because the current API has no existing ETag convention for reference reads.

## Address inputs

Create/update customer addresses, checkout billing addresses (including `billingRecipient: "OTHER"`), and administrator supplied invoice billing addresses prefer catalog IDs. During the SPA compatibility window, the complete old `city`/`province` text pair is also accepted and resolved by PostgreSQL against one active canonical locality, a seat name or one official alias. The IDs pair and name pair are mutually exclusive; partial or mixed pairs receive `VALIDATION_ERROR`. Request names are never stored as free text.

```json
{
  "line1": "Av. Principal 123",
  "line2": null,
  "provinceId": "17",
  "cityId": "893",
  "countryCode": "EC",
  "postalCode": "170101"
}
```

When using catalog IDs, `provinceId` and `cityId` are positive decimal strings. Customer create/update requests retain their other existing fields, including recipient and phone. The same billing-address shape is nested at `billingAddress` in checkout and invoice issue requests. Billing catalog IDs identify Ecuador, so `countryCode` is `EC` for these requests. `city` and `province` are deprecated optional fields supported temporarily for older SPA bundles:

```json
{
  "line1": "Calle de prueba 123",
  "city": "Bucay",
  "province": "Guayas",
  "countryCode": "EC"
}
```

Customer address responses keep the existing names and add IDs and the review flag:

```json
{
  "city": "Quito",
  "province": "Pichincha",
  "cityId": "893",
  "provinceId": "17",
  "cityNeedsReview": false
}
```

For a legacy address that could not be matched uniquely, `city` and `province` keep their original text, both IDs are `null`, and `cityNeedsReview` is `true`. A HOME_DELIVERY checkout can still use it; the order snapshot copies the stored text. An edit must resolve to a new catalog pair, after which the names are canonical catalog values and the flag becomes `false`.

`GET /api/v1/pickup-locations` keeps its city/province names and adds nullable `provinceId`, `cityId`, and `cityNeedsReview` fields for legacy master rows. The pickup details copied into an order remain the existing text-only snapshot shape.

## Errors

The following database conditions return HTTP 400 Problem Details with Spanish `title` and `detail`:

| `code` / SQLSTATE | Condition | Detail |
|---|---|---|
| `P5014` (SQLSTATE `P5014`) | City exists and is active but is outside the selected province | `La ciudad no pertenece a la provincia seleccionada.` |
| `P5015` (SQLSTATE `P5015`) | City ID/name is unknown, inactive or ambiguous | `Elige una ciudad de la lista.` |

Malformed or missing IDs use the existing `VALIDATION_ERROR` contract and Spanish field messages.

## Compatibility

The API prefers `provinceId` and `cityId`; the complete deprecated name-only pair is temporarily accepted to protect cached SPA bundles. The strict database adapter resolves folded exact matches only and always stores catalog IDs and canonical names. Successful legacy requests emit `geo_legacy_payload operation=...` with no user or location values. Remove the REST name fields/branches after 30 days from API release and seven consecutive days with zero successful legacy events; if use continues at day 30, wait until the zero-use window is met. The direct PostgreSQL Database API text overloads remain strict adapters. Response names remain present. Order, invoice and pickup-history snapshots retain their current text-only shape and are never rewritten.

After V082 is applied and before the application release, an operator can count rows left for review with this read-only query:

```sql
SELECT 'customer_address' AS source, count(*) AS needs_review
  FROM pliego.direccion WHERE provincia_id IS NULL OR ciudad_id IS NULL
UNION ALL
SELECT 'pickup_location', count(*)
  FROM pliego.ubicacion_retiro WHERE provincia_id IS NULL OR ciudad_id IS NULL;
```

The V1.0 REST contract's address examples at `rest-api-contract-v1.0.md:847-899` still show text fields; the approved database contract's text signatures at `database-api-contract-v1.0.md:1361-1394` describe the retained strict adapters. Those approved baselines are unchanged. Older dated billing examples remain historical; this amendment governs current geographic request fields.

## API consumer compatibility audit

| Consumer | Location | Status |
|---|---|---|
| Customer address form and create/update API client | `frontend/src/features/purchase/AddressForm.tsx:37-39,208-219`; `frontend/src/shared/api/customer.ts:107-110,143-147` | Already sends IDs. UI remains with reviewer. |
| Checkout billing form/client | `frontend/src/features/purchase/CheckoutBilling.tsx:151-153,279-285`; `frontend/src/shared/api/orders.ts:66-80` | Already sends IDs. UI remains with reviewer. |
| Administrator invoice address UI | `frontend/src/shared/api/orders.ts:247-255,333-341` | No invoice-issue request writer exists in the frontend; response decoders remain text snapshots. |
| Customer address response decoder | `frontend/src/shared/api/customer.ts:66-80` | Names remain; nullable IDs/review flag are preserved. |
| Order/invoice response decoders and snapshots | `frontend/src/shared/api/orders.ts:247-255,333-341`; `frontend/tests/e2e/post-purchase.spec.ts:9,14` | Not request writers; keep immutable snapshot names. |
| Backend REST address writers and JDBC adapters | `CustomerController.java:123,139`; `JdbcCustomerGateway.java:141,159`; `CheckoutRequest.java:35`; `CheckoutController.java:48,63`; `JdbcCheckoutGateway.java:75`; `AdminOrderController.java:164,169,178`; `JdbcAdminOrderGateway.java:243,246`; `PostPurchaseRequests.java:27` | Updated to accept IDs plus the temporary strict name-pair adapter. |
| Snapshot tables, immutable history and email/invoice projections | `V006__create_order_payment_tables.sql:41`; `V019__create_triggers.sql:63`; `V034__invoices_and_post_purchase_projections.sql:19,145`; `V039__transactional_email.sql:201`; `V040__store_pickup.sql:30,308,463`; `V041__authoritative_monetary_projections.sql:447,476`; `V043__home_delivery_lifecycle.sql:210`; `V061__transactional_order_lifecycle_emails.sql:45`; `V072__automatic_academic_billing.sql:585` | Immutable text snapshots/readers; unchanged by this feature. |
| Address/order response mocks | Under `frontend/tests/e2e/`: `addresses.spec.ts:7-8`, `p1-accessibility.spec.ts:5`, `store-pickup.spec.ts:19`, `storefront-library.spec.ts:22`, `stockstatus-production.spec.ts:31`, `production-purchase.spec.ts:90,171`, `purchase.spec.ts:197`, `billing.spec.ts:26`; also `frontend/src/test/purchase.tsx:159-162`, `frontend/src/test/pickup.ts:4`, `frontend/src/features/purchase/OrderPage.test.tsx:35,280`, `OrderConfirmation.test.tsx:12` | Response/read-model snapshots still require city/province text; not request payloads. |
| Live saved-address setup | `frontend/tests/e2e/store-pickup.live.spec.ts:27-30` | Updated to catalog IDs. |
| Other live browser specs | `frontend/tests/e2e/account.live.spec.ts`, `session.live.spec.ts`, `library-storefront.live.spec.ts`, `storefront.visual.live.spec.ts`, `orders-lifecycle.live.spec.ts`, `digital-physical-contract.live.spec.ts`, `purchase.live.spec.ts`, `favorites.live.spec.ts` | No address or billing request contains city/province text. |
| Backend Java API tests | `backend/src/test/java/com/pliego/modules/customer/api/CustomerApiIntegrationTest.java`; `backend/src/test/java/com/pliego/modules/sales/api/CheckoutApiIntegrationTest.java`; `CheckoutBillingRequestTest.java`; `AdminOrderApiIntegrationTest.java` | Updated for both IDs and the temporary old-name pair. |
| PostgreSQL/HTTP gates | `backend/src/test/postgres18/geo_alias_http_gate.py`; `checkout_billing_recipient_http_gate.py`; `post_purchase_invoice_http_gate.py`; `geo_upgrade_gate.py` | Updated to prove alias resolution, strict transition behavior and legacy delivery. |
| Direct SQL Database API fixtures (`backend/src/test/postgres18/`) | `automatic_billing_gate.sql:32,38-159`; `checkout_billing_recipient_gate.sql:38-109`; `ecuador_contact_policy_gate.sql:23-51`; `digital_editions_gate.sql:91`; `post_purchase_upgrade_gate.py:49`; `ecuador_tax_upgrade_gate.py:100`; `offers_gate.sql:68`; `checkout_gate.sql:34`; `monetary_projection_gate.sql:34`; `admin_orders_gate.sql:34`; `billing_identity_upgrade_gate.py:58,103`; `mixed_checkout_rollback_gate.sql:19`; `customer_orders_gate.sql:38`; `address_primary_concurrency.py:25,27`; `digital_ownership_gate.sql:21,54,112`; `digital_single_copy_gate.sql:21`; `store_pickup_gate.sql:27`; `ecuador_zero_tax_gate.sql:46`; `admin_order_concurrency.py:41`; `post_purchase_digital_access_gate.sql:70,171,193`; `billing_identity_corrections_gate.sql:27,62-66`; `automatic_billing_upgrade_gate.py:77,106`; `geo_upgrade_gate.py:101,123-131`; `checkout_last_unit.py:52`; `geo_catalog_gate.sql:149-192`; `digital_single_copy_support.py:19`; `billing_identity_corrections_http_gate.py:42`; `post_purchase_gate.sql:25,44,55,68`; `post_purchase_digital_access_concurrency.py:17`; `automatic_billing_concurrency.py:11` | Kept as intentional strict Database API text-overload coverage. V082 resolves these names through the same catalog and cannot write free text. |
| Root `scripts/` | `scripts/` | No city/province request payloads found. |
| Backend contributor example | `backend/README.md:9-13` | Updated to describe IDs and the temporary strict adapter. |
| Deployment smoke guidance | `docs/deployment/production-runbook.md:453-470` | Updated to direct any write smoke request to catalog IDs and verify the alias reads. No smoke payload was previously present. |
| Deployment skill | `.agents/skills/pliego-deploy/SKILL.md:53-56` | Its file is read-only in this workspace. It contains no request payload; the matching runbook instruction is updated. |
| Earlier billing/post-purchase amendments | `docs/api-amendments/2026-10-17-academic-billing.md:8`; `docs/api-amendments/0008-post-purchase-v1.0.8.md:117-121`; `docs/api-amendments/2026-10-25-tiered-billing-identity-and-invoice-recipients.md:127-130` | The older dated/versioned examples remain historical; the same-day tiered-billing example now uses the ID pair without changing its identity decision. This amendment governs geographic fields. |

### UI work for the reviewer

Review the already catalog-backed UI in `frontend/src/features/purchase/AddressForm.tsx:37-39,208-219`, `CheckoutBilling.tsx:151-153,279-285`, `CheckoutPage.tsx:214`, `frontend/src/features/account/AddressBook.tsx`, and `frontend/src/shared/ui/ProvinceCityFields.tsx`. Make sure the client searches `City.aliases`, preserves the dependent province → city choice and prompts for a new catalog choice when `cityNeedsReview` is true. `frontend/src/shared/api/geo.ts:7-14` currently defaults missing aliases to `[]`; the server now always includes the array. `frontend/src/shared/api/customer.ts:112-114` also needs the UI owner to classify P5014/P5015 as known address errors instead of “unknown result.” No administrator invoice issue request UI was found.

Legacy text-signature PostgreSQL routines remain for existing Database API callers, but resolve names only when they identify one active catalog pair and then delegate to the ID-based routines. They cannot write an arbitrary or ambiguous location.
