# PLIEGO Backend Handoff v1.0

Practical starting point for the frontend UX and screen architecture. The executable API reference is the generated OpenAPI document at `/v3/api-docs` and Swagger UI at `/swagger-ui/index.html` on a running backend; the approved [REST contract](../../rest-api-contract-v1.0.md) provides the stable v1 contract. The backend serves 50 REST endpoints.

## Architecture

```text
Frontend
→ REST /api/v1
→ Spring Controllers
→ Application Services
→ Spring JDBC Gateways
→ PostgreSQL Database API
```

The modular monolith groups code by context:

- **identity** — CUSTOMER registration and login, BCrypt password verification, JWT issuance.
- **customer** — authenticated profile and addresses; ADMIN customer search and status changes.
- **catalog** — public edition search/detail; ADMIN authors, publishers, categories, books, and editions.
- **inventory** — ADMIN stock search, movement history, entries, adjustments, and minimum stock.
- **cart** — authenticated customer's active cart and item changes, including availability checks.
- **sales** — checkout, customer orders/cancellation, ADMIN order search/detail, logistics transitions, and cancellation.
- **foundation** — security, validation, JDBC support, SQLSTATE translation, and RFC 9457 errors.

Controllers handle HTTP, services apply transaction boundaries, gateways call PostgreSQL's public Database API. Business invariants and command atomicity live in PostgreSQL.

## API conventions

- All REST routes use `/api/v1`. Public routes are `POST /auth/register`, `POST /auth/login`, and `GET /catalog/editions` plus `GET /catalog/editions/{editionId}`. OpenAPI and Swagger are also public. Other routes require a bearer JWT and their documented role: `CUSTOMER` or `ADMIN`.
- Login returns a JWT with `tokenType: Bearer` and `expiresInSeconds: 1800`. Send it as `Authorization: Bearer <accessToken>`. There is no refresh-token or logout endpoint. New registrations create CUSTOMER accounts; the initial ADMIN is seeded through backend configuration.
- Identifiers are JSON decimal strings to avoid JavaScript integer precision loss. Money is a decimal string with two fractional digits. Date-time values are RFC3339 strings; publication dates are ISO dates (`YYYY-MM-DD`). Quantities, page indexes, and page sizes remain JSON numbers.
- Search responses use `{ items, page, pageSize, totalCount }`. `page` is zero-based; default `pageSize` is 20 and the maximum is 50. `totalCount` is a string.
- Errors use Spanish RFC 9457 Problem Details (`application/problem+json`), including stable machine-readable `code` and a `traceId`. Validation details may include field violations. Use `code`/HTTP status for behavior and show the Spanish human-facing text.
- Runtime API schema: `/v3/api-docs`; interactive reference: `/swagger-ui/index.html`. Read request/response schemas and role requirements there instead of duplicating endpoint definitions in frontend code.

## Supported screens

### PUBLIC

- **Catalog** — search and paginate public editions; filter by title, author, ISBN, category, price, language, and format; select title/price ordering.
- **Edition detail** — book/edition metadata, authors, categories, publisher, price, cover attribution, and availability.
- **Login / registration** — email and password login; CUSTOMER registration. There is no password reset or self-service ADMIN creation endpoint.

### CUSTOMER

- **Profile** — view/update names, phone, and account state.
- **Address book** — list, create, edit, delete, and set primary delivery address.
- **Cart** — view active cart, add an edition, change quantity, or remove an item. Each item includes current price/subtotal, availability, and an optional unavailability reason; the displayed total uses current prices.
- **Checkout** — choose a saved address and supported simulated payment input/outcome. CARD input is validated by the API and is not persisted. The response is created for either payment outcome.
- **Orders** — paginated own-order list and order detail with stored purchase/address/payment snapshots and state history; cancel an eligible order.

### ADMIN

- **Customers** — search customers and change status between `ACTIVE` and `BLOCKED`.
- **Catalog administration** — search/create/edit/activate/deactivate authors, publishers, categories, books, and editions.
- **Inventory** — search stock, inspect movement history, record entries or adjustments, and set minimum stock.
- **Orders and logistics** — filter orders, inspect detail/history/inventory movements, advance logistics state, or cancel an eligible order.

## Navigation and behavior

```text
Guest → Catalog → Edition detail → Login / Register

CUSTOMER
Login → Catalog → Cart → Checkout → Orders → Order detail
                         └→ unavailable item: review/remove before resolving checkout conflict
Profile → Addresses → choose delivery address at checkout

ADMIN
Login → Customers
      → Catalog administration
      → Inventory
      → Orders / logistics
```

- ADMIN can still search a blocked customer. A blocked customer cannot start a new session; the API returns the same generic invalid-credentials response as for other login failures. Existing tokens do not bypass current account-state checks on protected operations; handle the returned API error as authoritative.
- Cart item `available` and `unavailabilityReason` reflect current purchasability; checkout can reject a cart whose items cannot be fulfilled. Re-read the cart after such a conflict.
- `APPROVED` checkout produces order `CONFIRMED` and payment `APPROVED`. `REJECTED` is a successful simulated outcome: order `CANCELLED`, payment `REJECTED`, and stock is not sold. The rejected attempt leaves the cart active. Show the returned order and outcome rather than treating every HTTP 201 as paid.
- Customer/admin cancellation is only available for eligible `CONFIRMED` or `PREPARING` orders. Successful post-payment cancellation yields `CANCELLED`/`REFUNDED`; stock is restored. Other states cannot be cancelled.
- ADMIN logistics transitions are sequential: `CONFIRMED → PREPARING → SHIPPED → DELIVERED`. Present only the next permitted transition. Cancellation is a separate action while eligible.
- Checkout and cancellation are non-idempotent commands. If a response is unknown after a timeout, fetch the cart/orders or order detail before taking another action; do not retry automatically.

## Local backend reference

Startup variables, PostgreSQL/Flyway setup, and build commands are in the [backend README](../../backend/README.md). Configure an exact CORS origin for the frontend development/production origins. Keep JWT signing and database credentials server-side.
