# Post-purchase backend/API verification — 2026-10-24

Scope: backend, PostgreSQL and API contracts. No commit or deployment. Existing uncommitted work, including V076, is preserved. V077 is the only new migration. Prices, payment processing, fulfillment, cancellation/refund, ownership acquisition, invoice/credit-note issuance and private PDF/XML storage retain their existing rules.

## Current routines and mixed-order rules

References below name files under `backend/src/main/resources/db/migration/` unless a full path is given. `Vnnn:line` abbreviates the unique `Vnnn__*.sql` file in that directory; Java basenames refer to the module paths listed under changed files or their existing billing/sales modules. These references account for later replacements and renames, rather than treating the original definition as current.

- Customer detail: V017's original authenticated snapshot reader (`V017__create_sales_routines.sql:324`) was renamed `fn_customer_order_detail_internal_v017` by V034. The V055 public wrapper (`V055__digital_and_pickup_cancellation_window.sql:104`) authorizes first, reconciles overdue purchase/home-delivery state, then reads snapshots. V077 now wraps that implementation as `fn_customer_order_detail_internal_v055` and enriches the items. The pricing wrapper remains `V041__authoritative_monetary_projections.sql:483`, with VOLATILE set by `V043__home_delivery_lifecycle.sql:153`. Java reads it and retains the capability/offer-snapshot helpers (`backend/src/main/java/com/pliego/modules/sales/gateway/JdbcCustomerOrderGateway.java:42`).
- Post-purchase fields: latest public `fn_order_post_purchase` is `V072__automatic_academic_billing.sql:614`, delegating to the V055 body now named `internal_v055`, which delegates to the V043 body now named `internal_v043`. Customer list is `V058__qualify_order_list_reconciliation_projection.sql:2`. Grant reconciliation is the V076 replacement, not V045's original body (`V076__single_digital_copy_per_customer.sql:660`).

| Question | Verified rule and evidence |
| --- | --- |
| How is a mixed purchase modeled? | One order, all purchased item snapshots, one payment. Physical formats are PAPERBACK/HARDCOVER (`V032__digital_editions.sql:2`). DIGITAL_ONLY is valid only without physical lines; mixed orders use HOME_DELIVERY or STORE_PICKUP (`V076:234`, `V076:438`). |
| Which lines does fulfillment cover? | Physical lines only. One order-level `pedido_entrega`, then one HOME_DELIVERY shipment or one STORE_PICKUP snapshot when physical items exist (`V076:452`, `V076:455`, `V076:461`). These records have no per-line allocation table; their scope is the physical subset, identified by `requiresPhysicalFulfillment`. All digital lines remain in the same commercial order/invoice. Unique shipment/order and pickup/order identities are established in `V033__order_fulfillment_and_shipments.sql:8` and `V040__store_pickup.sql:30`. |
| When is digital access granted? | Immediately when payment is APPROVED and order is not CANCELLED, including mixed purchases. Payment/order triggers reconcile atomically (`V045__digital_ownership_and_checkout.sql:50`, current body `V076:664`). Neither shipment completion nor the cancellation deadline delays ACTIVE. Pending/rejected payments create no grant (`V076:667`). |
| What does paid mixed cancellation do? | Customer can cancel own order; ADMIN uses the same rule on another customer's order. Refunds the entire payment, sets order CANCELLED, revokes every digital source from that order, restores only sold physical units once, and cancels a shipment if present. It does not cancel only the physical lines or partially refund. Financial/stock body: `V032:865`, `V032:895`, `V032:947`, `V032:966`; shipment wrapper `V033:96`; revocation triggers `V045:50` and current reconcile `V076:668`. Another historical active source, if any, remains owned. |
| What limits cancellation? | HOME_DELIVERY must still be PREPARING after time-based reconciliation (`V043:157`). Digital-only and every STORE_PICKUP order, including mixed pickup, have a six-minute deadline (`V055:13`), anchored to actual approval (`V059__anchor_cancellation_deadline_to_payment_approval.sql:18`). Both customer and ADMIN obey it (`V055:133`). No admin bypass was added. |
| What about a pending mixed transfer? | The simulated invoice remains DRAFT and the order PENDING_PAYMENT. No physical SALE/stock decrement and no grant exist. ADMIN approval performs the physical sale and activates digital sources atomically (`V076:617`). Customer/admin cancellation of this billed pending order sets payment REJECTED, order/shipment CANCELLED, voids the draft, returns zero restored units, and issues no refund or grant (`V072:549`). |
| What happens to billing after refund? | Issued invoice remains immutable; a total simulated credit note is created once. Cancellation of an unpaid draft voids the draft instead (`V072:56`, `V072:572`). |

### Order-level lifecycle and availableActions

`orderState` retains the compatible values PENDING_PAYMENT, CONFIRMED, PREPARING, SHIPPED, DELIVERED and CANCELLED. `purchaseState` maps physical logistics states to CONFIRMED (`V033:68`), while digital-only finalization projects COMPLETED (`V055:80`). Physical shipment and digital ownership must be read independently.

| Purchase situation | Order / purchase / physical lifecycle | Detail actions |
| --- | --- | --- |
| Approved mixed HOME_DELIVERY, initially | Normally CONFIRMED / CONFIRMED; shipment PREPARING. Scheduler advances shipment through IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED without advancing `pedido.estado` (`V043:80`, `V043:100`). | `cancel` and `canCancel` true while shipment PREPARING; false afterward. No six-minute deadline. `lifecycleState=CONFIRMED`; `libraryAccessState=OWNERSHIP_ONLY` while any of this order's grants is ACTIVE. |
| Approved mixed STORE_PICKUP, within deadline | CONFIRMED / CONFIRMED, pickup PENDING, no shipment. Digital access is already AVAILABLE. | `lifecycleState=CANCELLATION_WINDOW`, `canCancel=true` until deadline, `libraryAccessState=OWNERSHIP_ONLY`. |
| Mixed pickup after deadline | Order PREPARING, purchase CONFIRMED, `finalizado_en` set; later collection sets order DELIVERED and pickup COLLECTED (`V055:43`, `V057__continue_pickup_collection_after_window.sql:18`). | `lifecycleState=PICKUP`, `canCancel=false`; ownership remains active. |
| Digital-only paid | During window CONFIRMED; after deadline order still CONFIRMED but purchase/lifecycle COMPLETED. No address, fulfillment, pickup or shipment. | CANCELLATION_WINDOW → COMPLETED; `canCancel` true → false, ownership stays active. |
| Billed pending mixed transfer | PENDING_PAYMENT / PENDING_PAYMENT, no acquired digital access. | `canCancel=true`, deadline null, lifecycle PENDING_PAYMENT, library NOT_APPLICABLE (`V072:618`). |
| Cancelled/refunded mixed | CANCELLED / CANCELLED; shipment CANCELLED or pickup projects CANCELLED. | `canCancel=false`, lifecycle CANCELLED, library NOT_APPLICABLE when all this order's grants are revoked. |

The exact action expressions are `V043:226`, `V055:85` and `V072:618`. `changeShippingAddress` remains false. `libraryAccessState` is only an aggregate: OWNERSHIP_ONLY if any **source from this order** is ACTIVE, otherwise NOT_APPLICABLE; it does not express per-line pending/revoked access. The REST list has compact item summaries and invoice booleans, **no availableActions or per-line digitalAccess**; detail is authoritative for those fields (`CustomerOrderResponses.java:17`, `:54`).

Existing edge preserved: pickup collection can happen while CONFIRMED before deadline (`V057:14`). Its detail can retain lifecycle CANCELLATION_WINDOW while `canCancel=false`, since due reconciliation only finalizes CONFIRMED orders (`V055:43`). This does not revoke digital ownership.

## Added per-item API contract

`GET /api/v1/orders/{orderId}` always emits `requiresPhysicalFulfillment` and `digitalAccess` on every item. IDs are strings. Existing fields/pricing snapshots are preserved. V077 reads the exact `digital_grant.pedido_item_id` primary key, not another purchase's active ownership (`V045:15`).

| Digital state | Source evidence | ownedItemId |
| --- | --- | --- |
| PENDING_PAYMENT | Noncancelled order, PENDING payment, no revoked source | null |
| AVAILABLE | This line's ACTIVE grant, APPROVED payment, noncancelled order | This source's ownership ID, string |
| REVOKED | This line's grant is REVOKED or payment REFUNDED | null |
| UNAVAILABLE | Rejected/cancelled without acquired ownership; defensive missing-grant/inconsistent cases | null |

Physical lines return null. A rejected purchase or cancellation before approval has never acquired a grant, so it is UNAVAILABLE rather than evidence of revoked acquisition. AVAILABLE means **ownership only**: the existing library still reports `contentAccessSupported=false`, `accessState=OWNERSHIP_ONLY` (`V045:67`). It does not promise a reader, player or downloadable book.

Exact new shapes, shown as item excerpts within an approved mixed HOME_DELIVERY detail:

```json
{
  "orderId": "700",
  "orderState": "CONFIRMED",
  "purchaseState": "CONFIRMED",
  "items": [
    {"orderItemId":"800","editionId":"20","requiresPhysicalFulfillment":true,"digitalAccess":null},
    {"orderItemId":"801","editionId":"21","requiresPhysicalFulfillment":false,"digitalAccess":{"state":"AVAILABLE","ownedItemId":"81"}},
    {"orderItemId":"802","editionId":"22","requiresPhysicalFulfillment":false,"digitalAccess":{"state":"AVAILABLE","ownedItemId":"82"}}
  ],
  "availableActions": {"cancel":true,"changeShippingAddress":false,"canCancel":true,"cancellationDeadline":null,"lifecycleState":"CONFIRMED","libraryAccessState":"OWNERSHIP_ONLY"}
}
```

Other exact digitalAccess values:

```json
[
  {"state":"PENDING_PAYMENT","ownedItemId":null},
  {"state":"REVOKED","ownedItemId":null},
  {"state":"UNAVAILABLE","ownedItemId":null}
]
```

The UI may link an AVAILABLE item to `/biblioteca/81`; the backing authenticated detail endpoint is `/api/v1/me/library/81`. Cancellation followed by repurchase reuses a stable ownership identity, but the old source stays REVOKED/null and cannot borrow the replacement grant (`V076:674`, V077). Existing revoked library identities remain readable for history; withholding the item link here is a source-access capability, not deletion of that history.

Confirmation uses this same detail: successful checkout and recovered checkout navigate to `/orders/{orderId}` (`frontend/src/features/purchase/CheckoutPage.tsx:527`, `:315`), then `OrderPage.tsx:60`/`ordersQuery.ts:13` load it. Checkout and attempt-resolution receipts therefore retain their existing shapes without adding duplicate item snapshots.

Concurrency: V077 first completes the authorized/reconciling reader in a separate PL/pgSQL statement, then enriches items with a fresh grant snapshot under the retained order lock. A deterministic regression reproduced APPROVED + UNAVAILABLE when approval committed during a blocked read; the separate-statement version returns APPROVED + AVAILABLE with the correct ID. Spring still owns the transaction (`CustomerOrderService.java:27`).

OpenAPI marks digitalAccess required and nullable with an inline object/null union; both inner fields are required. Explicit INLINE/types annotations prevent the schema generator from emitting the invalid combination `type:null` plus `$ref` and losing null from generated TypeScript. The Zod client validates all four states, requires a positive string ID only for AVAILABLE, rejects access on physical lines and explicit null on digital lines, and accepts an absent field from an older server without inferring ownership.

## Invoice viewing and UI metadata

New option:

```http
GET /api/v1/orders/700/invoice/files/PDF?disposition=inline
Authorization: Bearer <customer token>
```

Success is the same private PDF bytes with `Content-Type: application/pdf`, `Content-Disposition: inline; filename=...`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and Content-Length. Filename encoding uses the existing UTF-8 ContentDisposition builder. Omitted disposition or `disposition=attachment` preserves downloads for PDF/XML. XML inline and unknown disposition values return Spanish 400 VALIDATION_ERROR. The ADMIN alias accepts the same query option. See `backend/src/main/java/com/pliego/modules/billing/api/BillingController.java:46`.

Authenticated fetch still supplies the bearer token; a bare browser link does not add it. The API does not introduce public/signed URLs. A UI can fetch the PDF using its authenticated client and display the received bytes.

Readiness/auth behavior retained:

- 409 INVOICE_FILE_NOT_READY for a simulated file not yet ready, including a draft/pending payment.
- 404 INVOICE_FILE_UNAVAILABLE for legacy invoice without stored bytes.
- Another customer's order and a missing order both return 404 P5001 through the same Database API authorization (`V072:592`, `V073__academic_invoice_artifacts.sql:108`).
- Existing order without any invoice: metadata returns 404 INVOICE_NOT_FOUND; file GET retains its existing 409 INVOICE_FILE_NOT_READY behavior. Missing credentials 401; ADMIN using customer path 403. Validation errors remain 400.

Use `GET /api/v1/orders/{orderId}/invoice` for the most precise display decision. Its complete ready representation is:

```json
{"invoiceId":"91","orderId":"700","state":"ISSUED","provenance":"SIMULATED","documentNumber":"999-999-000000001","files":[{"type":"PDF","state":"READY"},{"type":"XML","state":"READY"}]}
```

The number format above was observed on the disposable fixture; IDs illustrate the shape. Consume the returned number rather than constructing it. Metadata contains no buyer identification or storage keys. Fields are defined in `InvoiceMetadataResponse.java:8`; the authoritative projection is `V073:91`.

| Evidence for one “Ver factura” action | Meaning |
| --- | --- |
| Metadata 404 INVOICE_NOT_FOUND | No invoice exists for this owned order. |
| state=DRAFT, documentNumber=null | Payment has not produced an issued document. |
| state=ISSUED and PDF entry READY | Inline PDF can be fetched; no XML state is needed for this action. |
| PDF PENDING / PROCESSING / FAILED | Invoice exists but PDF is not ready; file GET returns 409. |
| provenance=LEGACY and PDF UNAVAILABLE | Historical invoice exists without a retrievable PDF. Do not present an enabled file action. |
| state=VOID | Voided draft; not an issued downloadable document. |

Order detail also exposes an issued `invoice` or null, `invoice.invoiceId`, `state`, `pdfAvailable`, `xmlAvailable`; list exposes `invoiceState`, `invoicePdfAvailable`, `invoiceXmlAvailable` (`V043:206`, `V043:219`, `V058:18`). These are useful compact flags; metadata distinguishes draft/void/legacy/preparation. Legacy artifact references alone should not be treated as proof of retrievable bytes; metadata READY checks `factura_archivo_contenido` (`V073:100`).

**The generated PDF already contains “SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA”.** `InvoiceRenderer.java:25` defines it; `AcademicInvoicePdf.java:66` draws it on every page. No generator or invoice-data change was needed. Verification decodes actual generated/stored PDF text operators, including WinAnsi accents and the em dash; it also verifies XML disclosure.

## Credit notes

`nota_credito` stores an immutable header linked to the invoice: ID, document number, state, reason, subtotal, tax rate/total, shipping amount, total and issuance time. The latest explicit ADMIN routine remains `V041:402`; automatic simulated full refund credit is `V072:56`, idempotent by invoice. It copies the issued invoice totals and leaves the invoice/files intact. A pending draft cancellation voids the draft and creates no credit note.

Customers already receive `creditNotes` in authenticated order detail (`V043:222`; `PostPurchaseResponses.java:26`). ADMIN issuance remains `POST /api/v1/admin/orders/{orderId}/credit-notes` (`AdminOrderController.java:175`).

There is **no credit-note PDF/XML generator, artifact queue or byte storage**, and no customer credit-note file endpoint. V073's queue/storage/download records reference `factura_id` exclusively (`V073:3`, `V073:18`, `V073:108`); renderer handles invoice snapshots only (`InvoiceRenderer.java:28`). Therefore the condition for adding a customer credit-note download endpoint is not met. No document or readiness flag was invented.

## Verification

All final checks passed. Native PostgreSQL **18.6** ran at 127.0.0.1:55476; no Docker, production connection or real credentials were used. Databases were newly created empty databases: `pliego_post_purchase_red_20261024` (V076 red/isolated SQL checks), `pliego_post_purchase_verified_20261024` (initial runner attempt), and `pliego_post_purchase_final_20261024` (complete final runner). Use another fresh name when reproducing.

```bash
mvn --batch-mode --no-transfer-progress \
  -Dmaven.repo.local=/tmp/pliego-codex-m2 -f backend/pom.xml verify

source /tmp/pliego-digital-phase1/env.sh
PGDATABASE=postgres createdb pliego_post_purchase_final_20261024
PGDATABASE=pliego_post_purchase_final_20261024 \
PLIEGO_DB_URL=jdbc:postgresql://127.0.0.1:55476/pliego_post_purchase_final_20261024 \
CHECKOUT_BASE_URL=http://127.0.0.1:18078 PLIEGO_PG18_APP_PORT=18078 \
PLIEGO_GATE_LOG_DIR=/tmp/pliego-post-purchase/final \
bash backend/src/test/postgres18/run_ci_gates.sh

# Export /v3/api-docs from the verified backend while it is running.
# The snapshot retains its prior servers value, rather than the disposable port.
npm --prefix frontend run api:types
npm --prefix frontend test -- src/shared/api/orders.test.ts
(cd frontend && npx tsc --noEmit)

git diff --check -- backend docs/audit/post-purchase-2026-10-24 \
  docs/superpowers/plans/2026-10-24-post-purchase-backend.md \
  frontend/openapi frontend/src/shared/api
python3 -m py_compile backend/src/test/postgres18/post_purchase_*.py \
  backend/src/test/postgres18/cart_order_offer_http_gate.py
bash -n backend/src/test/postgres18/run_ci_gates.sh
```

| Check | Final result |
| --- | --- |
| Maven verify | **BUILD SUCCESS: 320 tests, 0 failures, 0 errors, 0 skipped**. Includes controller/security integration contexts with test gateways and unit mapper/renderer tests. |
| PostgreSQL runner | **77/77 gates passed**: 36 SQL, 18 database/concurrency, 21 HTTP, 2 authentication gates. Script counts, not the number of inner unittest cases/assertions. Real JDBC/Spring transactions are exercised by the HTTP gates. |
| Fresh Flyway | **77 successful migrations through V077**, `77:77`; all original migration checksums retained. |
| Orders Zod/client tests | **48/48 passed**. |
| OpenAPI/type generation | Passed; only CustomerOrderItem and both invoice-file route contracts changed relative to the starting working-tree OpenAPI. Generated digitalAccess is object-or-null, disposition is optional attachment-or-inline. |
| `npx tsc --noEmit` | **Passed, exit 0**. No TypeScript error in features or elsewhere was found in the current tree; no UI file was changed to obtain this result. |
| Syntax and scoped whitespace | Passed. |
| Protected-file hashes | **414 existing files unchanged**, including V001–V076, all pre-existing protected UI/CSS/tests/design files. Existing tracked diffs outside this task's file set are byte-for-byte unchanged from the starting diff. |
| Independent final review | Snapshot race identified, reproduced and fixed; final review found no remaining material issue. |

The four new gates cover physical-only, digital-only, HOME_DELIVERY/STORE_PICKUP mixed orders, EBOOK and AUDIOBOOK, immediate/finalized access, paid mixed customer/admin cancellation, total refund/physical restoration, pending mixed transfer before/after approval, pending cancellation/rejection with no acquisition, repurchase/source isolation, canonical/priced projections, another customer 404, inline/default headers, 409 preparation, legacy/missing 404 behavior, ADMIN compatibility and actual generated PDF disclosure. The concurrent gate deliberately starts an order read while approval holds the order lock and verifies the committed payment and grant agree.

Red/green evidence: new API/client tests failed before the fields existed; the SQL gate failed on V076 with missing line capabilities and passed after V077. Concurrent approval initially produced `APPROVED|UNAVAILABLE|`; the corrected projection produces `APPROVED|AVAILABLE|<ownedId>`. The first full runner exposed an old refund test comparing live access along with immutable snapshots; the SQL/HTTP refund tests now exclude only digitalAccess from that immutable comparison and explicitly verify revoked access in HTTP. The final complete runner passed after that correction.

Logs are local under `/tmp/pliego-post-purchase/`: `maven-verify.log`, `gates-final.log`, `final/backend.log`, `orders-final.log`, `tsc.log`, `sql-red.log`, `sql-green.log`, `concurrency-red.log`, `concurrency-green.log`. The temporary development HTTP server was stopped; the gate runner shuts down its own application.

## Files changed by this task

- `backend/src/main/resources/db/migration/V077__customer_order_line_digital_access.sql` — customer detail read projection; original migrations untouched.
- `backend/src/main/java/com/pliego/modules/sales/application/OrderModels.java` — digital access value, compatible constructors.
- `backend/src/main/java/com/pliego/modules/sales/api/CustomerOrderResponses.java`, `CustomerOrderController.java` — required nullable wire field, accurate OpenAPI null union, forwarding only.
- `backend/src/main/java/com/pliego/modules/sales/gateway/JdbcCustomerOrderGateway.java` — maps Database API JSON without deriving business state.
- `backend/src/main/java/com/pliego/modules/billing/api/BillingController.java` — PDF inline option and Spanish validation; existing service/gateway/storage retained.
- `backend/src/test/java/com/pliego/modules/sales/api/CustomerOrderApiIntegrationTest.java`, `sales/gateway/HistoricalOrderPricingGatewayTest.java` — schema/response and gateway tests.
- `backend/src/test/java/com/pliego/modules/billing/BillingDownloadApiTest.java` (new), `BillingControllerTest.java` — real HTTP security/service context and existing call updates.
- `backend/src/test/postgres18/post_purchase_digital_access_gate.sql`, `post_purchase_digital_access_http_gate.py`, `post_purchase_digital_access_concurrency.py`, `post_purchase_invoice_http_gate.py` (new); `run_ci_gates.sh` — V077 and the new gates. Also updated `order_offer_snapshot_gate.sql` and `cart_order_offer_http_gate.py` so refund comparisons retain every historical field while allowing only digitalAccess to change; the HTTP gate additionally asserts REVOKED/null.
- `frontend/openapi/openapi.json`, `frontend/src/shared/api/generated.ts`, `frontend/src/shared/api/orders.ts`, `orders.test.ts` — API contract and client validation only; previous edits retained.
- `docs/superpowers/plans/2026-10-24-post-purchase-backend.md` and this report.

## Open questions and existing limits

- No blocking product question remains for these API additions. UI presentation of preparing/legacy/no-invoice cases is left to the separately built UI; the API states above supply the decision data.
- This adds library ownership links, not delivery of ebook/audio content. Credit-note rendering remains absent and would require separately approved scope.
- Existing pickup early-collection lifecycle wording and no-invoice file-GET 409 are documented compatibility behaviors, preserved here.
- No production data audit, migration, deployment or credential change was performed.
