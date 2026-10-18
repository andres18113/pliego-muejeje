# PLIEGO — REST API Contract v1.0

**Document:** RAC-PLIEGO-001  
**Version:** 1.0  
**Status:** APPROVED BASELINE  
**Date:** 2026-09-23  
**Project:** PLIEGO  
**Document type:** REST / HTTP and application security contract  
**Base path:** `/api/v1`  
**Backend:** Java 25 + Spring Boot + Spring Security  
**Persistence:** PostgreSQL 18 through Database API  
**Frontend:** Outside implementation scope; this contract constitutes its future interface.

**Source documents:**
- `docs/requirements/use-case-baseline-v1.0.md` — v1.1 BASELINE
- `docs/domain/logical-erd-v1.0.md` — v1.1 BASELINE
- `docs/domain/data-dictionary-v1.0.md` — v1.1 BASELINE
- `docs/architecture/database-api-contract-v1.0.md` — v1.1 BASELINE
- `docs/database/physical-model-postgresql-v1.0.md` — v1.0 BASELINE
- `docs/database/db-routines-catalog-v1.0.md` — v1.0 BASELINE
- Flyway Baseline v1.0 — APPROVED BASELINE, PostgreSQL 18 smoke PASS

---

# 1. Purpose

This document defines PLIEGO v1's public HTTP interface.

Its objective is to translate approved Database API operations into a stable REST contract without creating a second business-logic layer.

The contract specifies:

- routes;
- HTTP methods;
- authentication;
- authorization;
- JWT;
- request DTOs;
- response DTOs;
- JSON representation;
- pagination;
- filters;
- sorting;
- HTTP codes;
- Problem Details;
- SQLSTATE translation;
- retry and recovery rules;
- endpoint → use case → PostgreSQL routine traceability;
- OpenAPI requirements.

The contract does not authorize Controllers or Services to reimplement rules already owned by PostgreSQL.

---

# 2. Authority principle

The mandatory architectural direction is:

```text
HTTP Request
    ↓
Controller
    ↓
Application Service
    ↓
JDBC Gateway
    ↓
PostgreSQL Database API
    ↓
SP / Function / Constraint / Trigger
```

## 2.1 Spring Boot responsibility

Spring Boot is responsible for:

- HTTP;
- JSON serialization/deserialization;
- JWT authentication;
- preventive role-based authorization;
- syntactic request validation;
- password hashing/verification;
- transaction demarcation;
- JDBC invocation of a PostgreSQL routine;
- SQLSTATE → application error → HTTP translation;
- OpenAPI;
- technical logging;
- correlation/trace ID.

## 2.2 PostgreSQL responsibility

PostgreSQL remains the authority over:

- uniqueness;
- ownership;
- the actor's actual status;
- associations;
- inventory;
- cart;
- checkout;
- snapshots;
- totals;
- transitions;
- simulated payment;
- cancellation;
- history;
- multi-entity rules.

## 2.3 One-call rule

A business REST command must normally produce:

```text
1 endpoint
→ 1 Application Service
→ 1 Gateway
→ 1 public PostgreSQL Procedure
```

Orchestrating several business operations from Java to replace an approved Procedure is not permitted.

---

# 3. General HTTP conventions

## 3.1 Base path

```text
/api/v1
```

No version header shall be included for v1.

## 3.2 JSON

Normal requests and responses:

```http
Content-Type: application/json
```

Errors:

```http
Content-Type: application/problem+json
```

Encoding:

```text
UTF-8
```

## 3.3 JSON naming

All JSON attributes use:

```text
lowerCamelCase
```

Example:

```json
{
  "editionId": "42",
  "publicationDate": "2024-05-01",
  "currentPrice": "18.50"
}
```

SQL `snake_case` names are not exposed.

---

# 4. Type representation

## 4.1 Identifiers

PostgreSQL uses `BIGINT`.

REST serializes them as **positive decimal strings**:

```json
{
  "editionId": "922337203685477580"
}
```

Never as JSON `number`.

Reason: a future JavaScript/TypeScript client must not lose precision because of the IEEE-754 safe-integer limit.

### Path parameters

Route IDs use decimal text:

```text
/api/v1/orders/123
```

and must match:

```text
^[1-9][0-9]*$
```

Spring converts safely to `Long`.

---

## 4.2 Money

All amounts are represented externally as **decimal strings with exactly two decimal places**.

Example:

```json
{
  "price": "19.90",
  "total": "124.50"
}
```

Java uses:

```text
java.math.BigDecimal
```

The following are not used:

```text
float
double
Float
Double
```

This protects precision when interoperating with JavaScript and `NUMERIC(30,2)`.

---

## 4.3 Quantities

Quantities and stock are exposed as JSON integers when within the `INTEGER` range.

Example:

```json
{
  "quantity": 3,
  "stockMinimum": 5
}
```

---

## 4.4 Dates

Civil date:

```text
YYYY-MM-DD
```

Example:

```json
"publicationDate": "1949-06-08"
```

Instants:

```text
RFC 3339 / ISO-8601 UTC
```

Example:

```json
"createdAt": "2026-09-23T19:15:23.481Z"
```

Responses use UTC.

---

## 4.5 Booleans

Native JSON boolean:

```json
{
  "available": true
}
```

---

## 4.6 Null

An absent optional value is serialized as `null` when the attribute is a stable part of the DTO.

Example:

```json
{
  "isbn13": null
}
```

In `PUT` requests, omitting an optional attribute and `null` have equivalent semantics:

```text
set absence
```

because update Procedures fully replace the mutable set.

---

# 5. Pagination

## 5.1 Query parameters

```text
page
pageSize
```

Defaults:

```text
page = 0
pageSize = 20
```

Constraints:

```text
page >= 0
1 <= pageSize <= 50
```

## 5.2 Response

```json
{
  "items": [],
  "page": 0,
  "pageSize": 20,
  "totalCount": "0"
}
```

`totalCount` is serialized as a string because PostgreSQL returns `BIGINT`.

`totalPages` is not included; the consumer can derive it.

## 5.3 Empty result

An empty set is successful:

```http
200 OK
```

Not:

```http
404 Not Found
```

---

# 6. Sorting

The consumer sends only closed-set codes.

Arbitrary column names are not accepted.

## Catalog

```text
TITLE_ASC
PRICE_ASC
PRICE_DESC
```

Default:

```text
TITLE_ASC
```

Any other value:

```text
400 INVALID_ARGUMENT
```

Administrative searches use the fixed order defined by Database API and do not expose `sort` in v1.

---

# 7. Security and authentication

## 7.1 Model

PLIEGO v1 uses authentication:

```text
stateless
Bearer JWT
no persisted session
no refresh token
```

There is no session table.

There is no server logout endpoint.

Logout means deleting the access token on the client.

## 7.2 Standards

The token uses a signed JWT and is transmitted exclusively through:

```http
Authorization: Bearer <token>
```

Tokens are not accepted in:

- query string;
- URL;
- request body;
- PLIEGO v1 authentication cookie.

## 7.3 TLS

Outside local development, Bearer tokens must be transmitted only over HTTPS.

---

# 8. JWT v1

## 8.1 Algorithm

PLIEGO v1 uses:

```text
HS256
```

Spring Security must configure an explicit allowlist:

```text
alg = HS256
```

and reject:

- `none`;
- any other algorithm;
- invalid signatures.

## 8.2 Secret

Environment variable:

```text
PLIEGO_JWT_SECRET
```

Must contain at least:

```text
32 cryptographically random bytes
```

Never stored in Git.

Must not be a human password.

## 8.3 Claims

Token:

```json
{
  "iss": "pliego",
  "aud": "pliego-api",
  "sub": "123",
  "role": "CUSTOMER",
  "iat": 1790180000,
  "exp": 1790181800,
  "jti": "uuid"
}
```

### `iss`

```text
pliego
```

### `aud`

```text
pliego-api
```

### `sub`

`UsuarioId` serialized as a decimal string.

### `role`

```text
CUSTOMER
ADMIN
```

### `iat`

Issued at.

### `exp`

Expiration.

### `jti`

Technical random UUID.

Not persisted.

## 8.4 Validity

TTL v1:

```text
30 minutes
```

There is no refresh token.

On expiration, the user authenticates again.

## 8.5 Validation

Spring Security must validate:

- signature;
- exact algorithm;
- `iss`;
- `aud`;
- `exp`;
- `sub`;
- recognized role.

The JWT role serves preventive authorization.

PostgreSQL revalidates the actual role/status through `fn_assert_actor`.

Therefore, altering a signed claim does not allow database rules to be bypassed.

## 8.6 Blocked user

A signed JWT that has not yet expired does not enable a user who subsequently became `BLOCKED`.

The Database API responds:

```text
P1003 ACTOR_INACTIVE
```

and REST translates it to:

```http
401 Unauthorized
```

---

# 9. Passwords

## 9.1 Hash

Spring Security uses:

```text
BCrypt
strength = 12
```

PostgreSQL receives only:

```text
passwordHash
```

It never receives the original password.

## 9.2 v1 policy

Registration password:

```text
minimum 8 characters
maximum 72 UTF-8 bytes
```

The following are not artificially imposed:

- uppercase letter;
- symbol;
- number;

as separate requirements.

Empty strings are not permitted.

## 9.3 Out of scope

PLIEGO v1 does not include:

- password change;
- password recovery;
- MFA;
- email verification.

---

# 10. Roles

## Public

No token required:

- registration;
- login;
- catalog;
- public edition details.

## CUSTOMER

Requires:

```text
JWT role=CUSTOMER
```

for:

- profile;
- addresses;
- cart;
- checkout;
- own orders;
- own cancellation.

## ADMIN

Requires:

```text
JWT role=ADMIN
```

for:

- users;
- administrative catalog;
- inventory;
- administrative orders.

Spring applies preventive authorization, and PostgreSQL repeats it as the authority.

---

# 11. Registration

## POST `/api/v1/auth/register`

**Auth:** public  
**CU:** CU-AUTH-01  
**DB:** `sp_customer_register`

### Request

```json
{
  "email": "usuario@example.com",
  "password": "password-segura",
  "firstNames": "Ana María",
  "lastNames": "Pérez López",
  "phone": "+59325550134"
}
```

`phone` is optional.

### Spring

1. validates structure;
2. validates password policy;
3. generates BCrypt hash;
4. calls `sp_customer_register` once.

### Response

```http
201 Created
```

```json
{
  "userId": "100",
  "customerId": "87",
  "state": "ACTIVE"
}
```

### Errors

- `400` invalid request;
- `409 P1101 EMAIL_ALREADY_EXISTS`.

Does not log in automatically.

---

# 12. Login

## POST `/api/v1/auth/login`

**Auth:** public  
**CU:** CU-AUTH-02  
**DB:** `fn_user_auth_data`

### Request

```json
{
  "email": "usuario@example.com",
  "password": "password-segura"
}
```

### Flow

1. Spring calls `fn_user_auth_data(email)`.
2. If nonexistent → invalid auth.
3. If state != ACTIVE → invalid auth.
4. Spring verifies BCrypt.
5. Generates JWT.

### Response

```http
200 OK
```

```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresInSeconds": 1800,
  "user": {
    "userId": "100",
    "email": "usuario@example.com",
    "role": "CUSTOMER"
  }
}
```

### Error

Nonexistent user, blocked user, or incorrect password produces the same external error:

```http
401 Unauthorized
```

```text
AUTH_INVALID_CREDENTIALS
```

The failed condition is not revealed.

---

# 13. CUSTOMER profile

## GET `/api/v1/me`

**Auth:** CUSTOMER  
**DB:** `fn_customer_profile`

### Response

```json
{
  "customerId": "87",
  "email": "usuario@example.com",
  "firstNames": "Ana María",
  "lastNames": "Pérez López",
  "phone": "+59325550134",
  "state": "ACTIVE"
}
```

---

## PUT `/api/v1/me`

**Auth:** CUSTOMER  
**DB:** `sp_customer_update`

PUT represents full replacement of mutable attributes.

### Request

```json
{
  "firstNames": "Ana María",
  "lastNames": "Pérez López",
  "phone": null
}
```

### Response

```http
204 No Content
```

Email cannot be modified.

---

# 14. Addresses

## GET `/api/v1/me/addresses`

**Auth:** CUSTOMER  
**DB:** `fn_address_list`

```http
200 OK
```

Response:

```json
[
  {
    "addressId": "15",
    "alias": "Casa",
    "recipient": "Ana Pérez",
    "line1": "Av. Principal 123",
    "line2": null,
    "city": "Quito",
    "province": "Pichincha",
    "countryCode": "EC",
    "postalCode": null,
    "reference": "Frente al parque",
    "phone": "+59325550134",
    "primary": true
  }
]
```

---

## POST `/api/v1/me/addresses`

**Auth:** CUSTOMER  
**DB:** `sp_address_create`

### Request

```json
{
  "alias": "Casa",
  "recipient": "Ana Pérez",
  "line1": "Av. Principal 123",
  "line2": null,
  "city": "Quito",
  "province": "Pichincha",
  "countryCode": "EC",
  "postalCode": null,
  "reference": "Frente al parque",
  "phone": "+59325550134",
  "makePrimary": true
}
```

### Response

```http
201 Created
```

```json
{
  "addressId": "15"
}
```

---

## PUT `/api/v1/me/addresses/{addressId}`

**Auth:** CUSTOMER  
**DB:** `sp_address_update`

Same address attribute set except `makePrimary`.

```http
204 No Content
```

---

## DELETE `/api/v1/me/addresses/{addressId}`

**Auth:** CUSTOMER  
**DB:** `sp_address_delete`

```http
204 No Content
```

A second DELETE may produce:

```http
404 ADDRESS_NOT_FOUND
```

---

## PUT `/api/v1/me/addresses/{addressId}/primary`

**Auth:** CUSTOMER  
**DB:** `sp_address_set_primary`

Idempotent.

```http
204 No Content
```

---

# 15. Public catalog

## GET `/api/v1/catalog/editions`

**Auth:** public  
**DB:** `fn_catalog_search`

### Query parameters

```text
title
author
isbn13
category
minPrice
maxPrice
language
format
sort=TITLE_ASC
page=0
pageSize=20
```

### Example

```text
GET /api/v1/catalog/editions?category=literatura&language=es&page=0&pageSize=20
```

### Nonexistent category

Syntactically valid but unknown slug:

```http
200 OK
```

with an empty page.

### Item

```json
{
  "editionId": "250",
  "bookId": "80",
  "title": "Don Quijote de la Mancha",
  "authors": "Miguel de Cervantes",
  "publisher": "Editorial Ejemplo",
  "isbn13": "9780306406157",
  "price": "18.50",
  "coverUrl": "https://...",
  "coverLicense": "PUBLIC_DOMAIN",
  "coverAttribution": null,
  "format": "PAPERBACK",
  "language": "es",
  "available": true
}
```

### Response

`PageResponse<CatalogEditionSummary>`.

---

## GET `/api/v1/catalog/editions/{editionId}`

**Auth:** public  
**DB:** `fn_edition_detail`

### Response

Includes:

```json
{
  "editionId": "250",
  "bookId": "80",
  "title": "Don Quijote de la Mancha",
  "subtitle": null,
  "synopsis": "...",
  "authors": [
    {
      "authorId": "12",
      "name": "Miguel de Cervantes",
      "order": 1
    }
  ],
  "categories": [
    {
      "categoryId": "2",
      "name": "Literatura",
      "slug": "literatura",
      "parentCategoryId": null
    }
  ],
  "publisher": {
    "publisherId": "7",
    "name": "Editorial Ejemplo"
  },
  "isbn13": "9780306406157",
  "sku": "PLG-LIT-001",
  "language": "es",
  "format": "PAPERBACK",
  "pageCount": 560,
  "publicationDate": "2024-01-01",
  "price": "18.50",
  "coverUrl": "https://...",
  "coverLicense": "PUBLIC_DOMAIN",
  "coverSourceUrl": "https://...",
  "coverAttribution": null,
  "available": true
}
```

Non-publishable/nonexistent Edición:

```http
404 Not Found
```

The Controller converts zero rows from the Function to 404.

---

# 16. Customer administration

## GET `/api/v1/admin/customers`

**Auth:** ADMIN  
**DB:** `fn_admin_customer_search`

Query:

```text
query
state
page
pageSize
```

Response:

`PageResponse<AdminCustomerSummary>`.

---

## PUT `/api/v1/admin/customers/{customerId}/status`

**Auth:** ADMIN  
**DB:** `sp_customer_set_status`

Request:

```json
{
  "state": "BLOCKED"
}
```

Allowed:

```text
ACTIVE
BLOCKED
```

Same-state is idempotent.

Response:

```http
204 No Content
```

---

# 17. Author administration

## GET `/api/v1/admin/authors`

→ `fn_admin_author_search`

Query:

```text
query
state
page
pageSize
```

## POST `/api/v1/admin/authors`

→ `sp_author_create`

Request:

```json
{
  "name": "George Orwell",
  "biography": "..."
}
```

Response:

```http
201 Created
```

```json
{
  "authorId": "15"
}
```

## PUT `/api/v1/admin/authors/{authorId}`

→ `sp_author_update`

```http
204 No Content
```

## PUT `/api/v1/admin/authors/{authorId}/status`

→ `sp_author_set_status`

Request:

```json
{
  "state": "INACTIVE"
}
```

Same-state idempotent.

```http
204 No Content
```

---

# 18. Publisher administration

## GET `/api/v1/admin/publishers`

→ `fn_admin_publisher_search`

## POST `/api/v1/admin/publishers`

→ `sp_publisher_create`

Request:

```json
{
  "name": "Penguin Books",
  "description": null
}
```

Response:

```json
{
  "publisherId": "8"
}
```

Status:

```http
201 Created
```

## PUT `/api/v1/admin/publishers/{publisherId}`

→ `sp_publisher_update`

```http
204 No Content
```

## PUT `/api/v1/admin/publishers/{publisherId}/status`

→ `sp_publisher_set_status`

```http
204 No Content
```

---

# 19. Category administration

## GET `/api/v1/admin/categories`

→ `fn_admin_category_search`

## POST `/api/v1/admin/categories`

→ `sp_category_create`

Request:

```json
{
  "name": "Ciencia ficción",
  "slug": "ciencia-ficcion",
  "description": null,
  "parentCategoryId": "2"
}
```

Response:

```http
201 Created
```

```json
{
  "categoryId": "22"
}
```

## PUT `/api/v1/admin/categories/{categoryId}`

→ `sp_category_update`

Replacement request:

```json
{
  "name": "Ciencia ficción",
  "slug": "ciencia-ficcion",
  "description": null,
  "parentCategoryId": "2"
}
```

```http
204 No Content
```

## PUT `/api/v1/admin/categories/{categoryId}/status`

→ `sp_category_set_status`

```http
204 No Content
```

---

# 20. Book administration

## GET `/api/v1/admin/books`

→ `fn_admin_book_search`

Query:

```text
query
state
page
pageSize
```

---

## POST `/api/v1/admin/books`

→ `sp_book_create`

### Request

```json
{
  "title": "1984",
  "subtitle": null,
  "synopsis": "...",
  "authors": [
    {
      "authorId": "15",
      "order": 1
    }
  ],
  "categoryIds": [
    "2",
    "7"
  ]
}
```

Response:

```http
201 Created
```

```json
{
  "bookId": "90"
}
```

---

## PUT `/api/v1/admin/books/{bookId}`

→ `sp_book_update`

Complete request with the same shape as create.

`authors` and `categoryIds` fully replace current associations.

```http
204 No Content
```

---

## PUT `/api/v1/admin/books/{bookId}/status`

→ `sp_book_set_status`

```json
{
  "state": "INACTIVE"
}
```

```http
204 No Content
```

---

# 21. Edition administration

## GET `/api/v1/admin/editions`

→ `fn_admin_edition_search`

Query:

```text
query
state
bookId
page
pageSize
```

---

## POST `/api/v1/admin/editions`

→ `sp_edition_create`

### Request

```json
{
  "bookId": "90",
  "publisherId": "8",
  "sku": "PLG-LIT-001",
  "isbn13": "9780306406157",
  "language": "es",
  "format": "PAPERBACK",
  "pageCount": 328,
  "publicationDate": "2024-01-15",
  "price": "18.50",
  "coverUrl": "https://...",
  "coverLicense": "CC_BY",
  "coverSourceUrl": "https://...",
  "coverAttribution": "..."
}
```

Response:

```http
201 Created
```

```json
{
  "editionId": "250"
}
```

---

## PUT `/api/v1/admin/editions/{editionId}`

→ `sp_edition_update`

Does not accept:

```text
bookId
sku
```

because they are immutable.

Request:

```json
{
  "publisherId": "8",
  "isbn13": "9780306406157",
  "language": "es",
  "format": "PAPERBACK",
  "pageCount": 328,
  "publicationDate": "2024-01-15",
  "price": "19.90",
  "coverUrl": null,
  "coverLicense": null,
  "coverSourceUrl": null,
  "coverAttribution": null
}
```

Response:

```http
204 No Content
```

---

## PUT `/api/v1/admin/editions/{editionId}/status`

→ `sp_edition_set_status`

```http
204 No Content
```

---

# 22. Inventory

All require ADMIN.

## GET `/api/v1/admin/inventory`

→ `fn_inventory_search`

Query:

```text
editionId
title
sku
lowStockOnly
page
pageSize
```

Item:

```json
{
  "editionId": "250",
  "bookId": "90",
  "title": "1984",
  "sku": "PLG-LIT-001",
  "isbn13": "9780306406157",
  "editionState": "ACTIVE",
  "stockActual": 12,
  "stockMinimum": 5,
  "lowStock": false,
  "updatedAt": "2026-09-23T19:30:00Z"
}
```

---

## GET `/api/v1/admin/inventory/{editionId}/movements`

→ `fn_inventory_movements`

Query:

```text
type
page
pageSize
```

---

## POST `/api/v1/admin/inventory/{editionId}/entries`

→ `sp_inventory_entry`

Request:

```json
{
  "quantity": 20,
  "reason": "Ingreso de inventario"
}
```

Response:

```http
201 Created
```

```json
{
  "movementId": "450",
  "stockBefore": 12,
  "stockAfter": 32
}
```

---

## POST `/api/v1/admin/inventory/{editionId}/adjustments`

→ `sp_inventory_adjust`

Request:

```json
{
  "type": "ADJUSTMENT_OUT",
  "quantity": 2,
  "reason": "Corrección de conteo físico"
}
```

Allowed:

```text
ADJUSTMENT_IN
ADJUSTMENT_OUT
```

Response:

```http
201 Created
```

```json
{
  "movementId": "451",
  "stockBefore": 32,
  "stockAfter": 30
}
```

---

## PUT `/api/v1/admin/inventory/{editionId}/minimum`

→ `sp_inventory_set_minimum`

Request:

```json
{
  "stockMinimum": 5
}
```

Same value is idempotent.

```http
204 No Content
```

---

# 23. Cart

CUSTOMER.

## GET `/api/v1/cart`

→ `fn_cart_get`

Always:

```http
200 OK
```

Without a physical cart:

```json
{
  "cartId": null,
  "state": null,
  "items": [],
  "totalCurrent": "0.00"
}
```

With a cart:

```json
{
  "cartId": "40",
  "state": "ACTIVE",
  "items": [
    {
      "cartItemId": "100",
      "editionId": "250",
      "title": "1984",
      "authors": "George Orwell",
      "sku": "PLG-LIT-001",
      "coverUrl": null,
      "quantity": 2,
      "currentPrice": "19.90",
      "currentSubtotal": "39.80",
      "available": true,
      "unavailabilityReason": null
    }
  ],
  "totalCurrent": "39.80"
}
```

---

## POST `/api/v1/cart/items`

→ `sp_cart_add_item`

Request:

```json
{
  "editionId": "250",
  "quantity": 2
}
```

The operation can:

- create an item;
- increment an existing item.

It therefore returns:

```http
200 OK
```

no attempt is made to distinguish `201`/`200`.

Response:

```json
{
  "cartId": "40",
  "cartItemId": "100",
  "quantity": 2
}
```

---

## PUT `/api/v1/cart/items/{cartItemId}`

→ `sp_cart_update_item`

Request:

```json
{
  "quantity": 3
}
```

Response:

```http
200 OK
```

```json
{
  "cartId": "40",
  "cartItemId": "100",
  "quantity": 3
}
```

---

## DELETE `/api/v1/cart/items/{cartItemId}`

→ `sp_cart_remove_item`

```http
204 No Content
```

---

# 24. Checkout

## POST `/api/v1/checkout`

**Auth:** CUSTOMER  
**DB:** `sp_checkout`

### Academic v1 request

```json
{
  "addressId": "15",
  "paymentMethod": "CARD",
  "simulationOutcome": "APPROVED"
}
```

Allowed payment methods:

```text
CARD
TRANSFER
```

Allowed simulation outcomes:

```text
APPROVED
REJECTED
```

## 24.1 Academic consideration

`simulationOutcome` exists exclusively because PLIEGO v1 implements deterministic academic payment.

A consumer can force `APPROVED`.

Therefore this interface:

> DOES NOT represent real financial authorization.

If a real gateway is incorporated in a future version, this parameter shall disappear from the public contract.

## 24.2 APPROVED

Response:

```http
201 Created
Location: /api/v1/orders/{orderId}
```

```json
{
  "orderId": "700",
  "orderState": "CONFIRMED",
  "paymentState": "APPROVED",
  "total": "39.80",
  "paymentReference": "SIM-550e8400-e29b-41d4-a716-446655440000"
}
```

## 24.3 REJECTED

Rejection is a **valid commercial outcome**, not an HTTP error.

Also:

```http
201 Created
Location: /api/v1/orders/{orderId}
```

```json
{
  "orderId": "701",
  "orderState": "CANCELLED",
  "paymentState": "REJECTED",
  "total": "39.80",
  "paymentReference": null
}
```

`402 Payment Required` is not used.

---

# 25. CUSTOMER orders

## GET `/api/v1/orders`

→ `fn_customer_orders`

Query:

```text
page
pageSize
```

Response `PageResponse<CustomerOrderSummary>`.

Item:

```json
{
  "orderId": "700",
  "createdAt": "2026-09-23T19:30:00Z",
  "orderState": "CONFIRMED",
  "total": "39.80",
  "paymentState": "APPROVED"
}
```

---

## GET `/api/v1/orders/{orderId}`

→ `fn_customer_order_detail`

Includes:

- header;
- item snapshots;
- address snapshot;
- payment;
- history.

Another customer's order and a nonexistent order:

```http
404
P5001 ORDER_NOT_FOUND
```

same result, to avoid revealing existence.

---

## POST `/api/v1/orders/{orderId}/cancel`

→ `sp_order_cancel`

Request body:

```text
empty
```

Response:

```http
200 OK
```

```json
{
  "orderId": "700",
  "previousState": "CONFIRMED",
  "orderState": "CANCELLED",
  "paymentState": "REFUNDED",
  "restoredUnits": 2
}
```

The operation is not idempotent by response.

After a committed cancellation, repetition produces a conflict.

---

# 26. ADMIN orders

## GET `/api/v1/admin/orders`

→ `fn_admin_orders`

Query:

```text
state
dateFrom
dateTo
customerId
page
pageSize
```

`dateFrom` / `dateTo` use RFC3339.

---

## GET `/api/v1/admin/orders/{orderId}`

→ `fn_admin_order_detail`

Also includes related inventory movements.

---

## POST `/api/v1/admin/orders/{orderId}/transitions`

→ `sp_order_change_status`

`POST` is used, not `PUT`, because the approved logistics transition **is not same-state idempotent**.

Request:

```json
{
  "targetState": "PREPARING"
}
```

Allowed transitions:

```text
CONFIRMED -> PREPARING
PREPARING -> SHIPPED
SHIPPED -> DELIVERED
```

Response:

```http
200 OK
```

```json
{
  "orderId": "700",
  "previousState": "CONFIRMED",
  "orderState": "PREPARING"
}
```

`CANCELLED` is not accepted here.

---

## POST `/api/v1/admin/orders/{orderId}/cancel`

→ `sp_order_cancel`

Same cancellation response.

ADMIN may cancel eligible orders without ownership.

---

# 27. Endpoint summary

| Method | Path | Auth | Database API |
|---|---|---|---|
| POST | `/auth/register` | Public | sp_customer_register |
| POST | `/auth/login` | Public | fn_user_auth_data |
| GET | `/me` | CUSTOMER | fn_customer_profile |
| PUT | `/me` | CUSTOMER | sp_customer_update |
| GET | `/me/addresses` | CUSTOMER | fn_address_list |
| POST | `/me/addresses` | CUSTOMER | sp_address_create |
| PUT | `/me/addresses/{id}` | CUSTOMER | sp_address_update |
| DELETE | `/me/addresses/{id}` | CUSTOMER | sp_address_delete |
| PUT | `/me/addresses/{id}/primary` | CUSTOMER | sp_address_set_primary |
| GET | `/catalog/editions` | Public | fn_catalog_search |
| GET | `/catalog/editions/{id}` | Public | fn_edition_detail |
| GET | `/admin/customers` | ADMIN | fn_admin_customer_search |
| PUT | `/admin/customers/{id}/status` | ADMIN | sp_customer_set_status |
| GET | `/admin/authors` | ADMIN | fn_admin_author_search |
| POST | `/admin/authors` | ADMIN | sp_author_create |
| PUT | `/admin/authors/{id}` | ADMIN | sp_author_update |
| PUT | `/admin/authors/{id}/status` | ADMIN | sp_author_set_status |
| GET | `/admin/publishers` | ADMIN | fn_admin_publisher_search |
| POST | `/admin/publishers` | ADMIN | sp_publisher_create |
| PUT | `/admin/publishers/{id}` | ADMIN | sp_publisher_update |
| PUT | `/admin/publishers/{id}/status` | ADMIN | sp_publisher_set_status |
| GET | `/admin/categories` | ADMIN | fn_admin_category_search |
| POST | `/admin/categories` | ADMIN | sp_category_create |
| PUT | `/admin/categories/{id}` | ADMIN | sp_category_update |
| PUT | `/admin/categories/{id}/status` | ADMIN | sp_category_set_status |
| GET | `/admin/books` | ADMIN | fn_admin_book_search |
| POST | `/admin/books` | ADMIN | sp_book_create |
| PUT | `/admin/books/{id}` | ADMIN | sp_book_update |
| PUT | `/admin/books/{id}/status` | ADMIN | sp_book_set_status |
| GET | `/admin/editions` | ADMIN | fn_admin_edition_search |
| POST | `/admin/editions` | ADMIN | sp_edition_create |
| PUT | `/admin/editions/{id}` | ADMIN | sp_edition_update |
| PUT | `/admin/editions/{id}/status` | ADMIN | sp_edition_set_status |
| GET | `/admin/inventory` | ADMIN | fn_inventory_search |
| GET | `/admin/inventory/{id}/movements` | ADMIN | fn_inventory_movements |
| POST | `/admin/inventory/{id}/entries` | ADMIN | sp_inventory_entry |
| POST | `/admin/inventory/{id}/adjustments` | ADMIN | sp_inventory_adjust |
| PUT | `/admin/inventory/{id}/minimum` | ADMIN | sp_inventory_set_minimum |
| GET | `/cart` | CUSTOMER | fn_cart_get |
| POST | `/cart/items` | CUSTOMER | sp_cart_add_item |
| PUT | `/cart/items/{id}` | CUSTOMER | sp_cart_update_item |
| DELETE | `/cart/items/{id}` | CUSTOMER | sp_cart_remove_item |
| POST | `/checkout` | CUSTOMER | sp_checkout |
| GET | `/orders` | CUSTOMER | fn_customer_orders |
| GET | `/orders/{id}` | CUSTOMER | fn_customer_order_detail |
| POST | `/orders/{id}/cancel` | CUSTOMER | sp_order_cancel |
| GET | `/admin/orders` | ADMIN | fn_admin_orders |
| GET | `/admin/orders/{id}` | ADMIN | fn_admin_order_detail |
| POST | `/admin/orders/{id}/transitions` | ADMIN | sp_order_change_status |
| POST | `/admin/orders/{id}/cancel` | ADMIN | sp_order_cancel |

**Total endpoints v1: 50.**

The difference from the 49 public routines is because:

```text
sp_order_cancel
```

is exposed through one CUSTOMER endpoint and one ADMIN endpoint.

---

# 28. Problem Details

PLIEGO uses RFC 9457-compatible Problem Details.

## 28.1 Shape

```json
{
  "type": "urn:pliego:problem:P3002",
  "title": "INSUFFICIENT_STOCK",
  "status": 409,
  "detail": "The requested quantity is not currently available.",
  "instance": "/api/v1/checkout",
  "code": "P3002",
  "traceId": "d66ab35e..."
}
```

Standard fields:

```text
type
title
status
detail
instance
```

PLIEGO extensions:

```text
code
traceId
```

## 28.2 Security rule

Never include:

- SQL;
- constraint name;
- stack trace;
- password hash;
- unnecessary internal data;
- details of other users' resources.

---

# 29. HTTP errors originating in the REST layer

Not all errors originate in PostgreSQL.

## 29.1 Invalid request

```text
VALIDATION_ERROR
```

HTTP:

```text
400
```

Unknown fields are rejected (normative strict JSON binding).

May include:

```json
{
  "violations": [
    {
      "field": "quantity",
      "message": "must be greater than 0"
    }
  ]
}
```

Spring validation is preventive.

The database remains the business authority.

## 29.2 Invalid JSON

```text
MALFORMED_JSON
HTTP 400
```

## 29.3 Credentials

```text
AUTH_INVALID_CREDENTIALS
HTTP 401
```

## 29.4 Missing token

```text
AUTH_REQUIRED
HTTP 401
```

Header:

```http
WWW-Authenticate: Bearer
```

## 29.5 Invalid/expired token

```text
AUTH_INVALID_TOKEN
HTTP 401
```

## 29.6 Preventively denied access

```text
ACCESS_DENIED
HTTP 403
```

The database rechecks the role.

---

# 30. SQLSTATE → HTTP mapping

## 30.1 400 Bad Request

| SQLSTATE | Code |
|---|---|
| P1001 | INVALID_ARGUMENT |
| P2034 | AUTHOR_ORDER_INVALID |
| P2046 | ISBN_INVALID |
| P2047 | COVER_METADATA_INVALID |
| P2048 | EDITION_DATA_INVALID |
| P3003 | STOCK_QUANTITY_INVALID |
| P3004 | STOCK_MINIMUM_INVALID |
| P4004 | CART_QUANTITY_INVALID |
| P5005 | PAYMENT_OUTCOME_INVALID |

---

## 30.2 401 Unauthorized

| SQLSTATE | Code |
|---|---|
| P1002 | ACTOR_NOT_FOUND |
| P1003 | ACTOR_INACTIVE |

For authenticated endpoints, both invalidate the authentication context.

---

## 30.3 403 Forbidden

| SQLSTATE | Code |
|---|---|
| P1004 | ACTOR_NOT_ADMIN |
| P1005 | ACTOR_NOT_CUSTOMER |

---

## 30.4 404 Not Found

| SQLSTATE | Code |
|---|---|
| P1102 | CUSTOMER_NOT_FOUND |
| P1103 | ADDRESS_NOT_FOUND |
| P2001 | AUTHOR_NOT_FOUND |
| P2011 | PUBLISHER_NOT_FOUND |
| P2021 | CATEGORY_NOT_FOUND |
| P2031 | BOOK_NOT_FOUND |
| P2041 | EDITION_NOT_FOUND |
| P3001 | INVENTORY_NOT_FOUND |
| P4003 | CART_ITEM_NOT_FOUND |
| P5001 | ORDER_NOT_FOUND |
| P5004 | CHECKOUT_ADDRESS_INVALID |

`CHECKOUT_ADDRESS_INVALID` uses 404 because it represents a nonexistent address or one not belonging to the user without revealing ownership.

---

## 30.5 409 Conflict

| SQLSTATE | Code |
|---|---|
| P1101 | EMAIL_ALREADY_EXISTS |
| P2002 | AUTHOR_INACTIVE |
| P2012 | PUBLISHER_INACTIVE |
| P2022 | CATEGORY_INACTIVE |
| P2023 | CATEGORY_INVALID_HIERARCHY |
| P2024 | CATEGORY_SLUG_EXISTS |
| P2032 | BOOK_REQUIRES_AUTHOR |
| P2033 | BOOK_REQUIRES_CATEGORY |
| P2042 | EDITION_INACTIVE |
| P2043 | BOOK_INACTIVE |
| P2044 | SKU_ALREADY_EXISTS |
| P2045 | ISBN_ALREADY_EXISTS |
| P3002 | INSUFFICIENT_STOCK |
| P3005 | STOCK_MOVEMENT_DUPLICATE |
| P3006 | SALE_REQUIRED_FOR_CANCELLATION |
| P4001 | CART_NOT_ACTIVE |
| P4002 | CART_EMPTY |
| P5002 | ORDER_INVALID_TRANSITION |
| P5003 | ORDER_NOT_CANCELLABLE |
| P5006 | PAYMENT_STATE_INVALID |

---

## 30.6 500 Internal Server Error

### P5007

```text
PAYMENT_REFERENCE_CONFLICT
```

A `SIM-UUID` reference collision is not a decision the client can correct.

HTTP:

```text
500
```

### P9001

```text
IMMUTABLE_HISTORY_VIOLATION
```

Classification:

```text
TECHNICAL_INTEGRITY_ERROR
```

HTTP:

```text
500
```

It should never occur through a valid REST call.

### PostgreSQL 23514

If a `CHECK` escapes despite prevalidation:

```text
DatabaseContractViolationException
HTTP 500
```

It is not converted to `P1001`.

### Other unexpected SQLSTATEs

```text
InternalServerError
HTTP 500
```

The PostgreSQL message is not leaked to the consumer.

---

# 31. DatabaseExceptionTranslator

There must be a single central translation:

```text
SQLException
    ↓
SQLSTATE
    ↓
ApplicationException
    ↓
ProblemDetail
```

Controllers do not inspect SQLSTATE.

Gateways do not decide HTTP.

---

# 32. HTTP validation

Spring may validate only syntactic/contractual aspects:

- required fields;
- nonempty string;
- lengths;
- basic formats;
- positive quantity;
- enum format;
- email structure;
- JSON structure;
- positive IDs;
- pagination.

It must not decide as the authority:

```text
if stock < quantity
if order.status == ...
if publisher inactive
if cart belongs to customer
```

Those rules remain in PostgreSQL.

---

# 33. Retry / Recovery

## 33.1 GET

GETs are safe/read-only and may normally be retried.

## 33.2 Idempotent PUTs

May be retried if the client lost the response:

- `/me`;
- address update;
- set primary;
- CUSTOMER/Autor/Editorial/Categoría/Libro/Edición status;
- stock minimum;
- PUT `/cart/items/{id}` (absolute quantity: same final state);
- DELETEs (idempotent in effect; the second returns 404).

The operation produces the same final state.

## 33.3 Non-idempotent POSTs

Must not be blindly retried after a timeout:

- register;
- catalog create;
- inventory entry;
- inventory adjustment;
- cart add;
- checkout;
- cancel;
- order transition.

## 33.4 Checkout recovery

If the consumer loses the response to:

```text
POST /checkout
```

it must not automatically execute the same POST again.

It must query:

```text
GET /orders
```

to determine whether a new Pedido appeared.

A future improvement could add Idempotency-Key, but it is outside v1.

After `P5007` (reference collision, with full rollback), retrying checkout is safe: it creates another Pedido without duplicating effects.

## 33.5 Rejected checkout

A new POST after a `REJECTED` result represents a new commercial attempt and may create another `CANCELLED` Pedido.

## 33.6 Logistics transition

After a timeout on:

```text
POST /admin/orders/{id}/transitions
```

ADMIN must retrieve:

```text
GET /admin/orders/{id}
```

before deciding to repeat.

## 33.7 Accepted v1 risks

- Login may allow user enumeration through timing (without dummy bcrypt verification).
- The password limit is validated by UTF-8 bytes, not characters.
- `jti` serves only log correlation; there is no revocation in v1.
- Without rate limiting, login accepts the risk of online brute force (future mitigation at the proxy, §45).
- The full address is logged only with an explicit debug flag and redaction.

---

# 34. CORS

CORS belongs to deployment configuration.

v1 rules:

- explicit allowlist per environment;
- no indiscriminate `*` for authenticated deployment;
- allow `Authorization`;
- methods according to endpoints;
- localhost permitted only in development.

No frontend origin is frozen yet.

---

# 35. Logging

Each request must have:

```text
traceId
```

Record:

- HTTP method;
- path template;
- status;
- duration;
- principal userId when present;
- Database routine;
- SQLSTATE on failure.

Do not log:

- password;
- full JWT;
- PasswordHash;
- CVV/PAN;
- full address except for controlled diagnostic needs.

---

# 36. OpenAPI

## 36.1 Target version

PLIEGO will document the API in:

```text
OpenAPI 3.1.2
```

Although later OpenAPI versions exist, 3.1.2 is fixed as the interoperability baseline for the PLIEGO v1 Spring toolchain.

Moving to a later minor version is a compatible technical decision if the tooling supports it and the observable contract does not change.

## 36.2 Document

Must describe:

- 50 endpoints;
- Bearer JWT scheme;
- request schemas;
- response schemas;
- enum values;
- pagination;
- ProblemDetail;
- examples;
- status codes;
- roles in description;
- ID/money formats.

## 36.3 Development URLs

Recommended:

```text
/v3/api-docs
/swagger-ui/index.html
```

The exact route may be adjusted through configuration without changing the `/api/v1` API.

---

# 37. Shared DTOs

## 37.1 `PageResponse<T>`

```json
{
  "items": [],
  "page": 0,
  "pageSize": 20,
  "totalCount": "0"
}
```

## 37.2 `StatusUpdateRequest`

```json
{
  "state": "ACTIVE"
}
```

## 37.3 `AuthorAssignmentRequest`

```json
{
  "authorId": "15",
  "order": 1
}
```

## 37.4 `ProblemResponse`

Compatible with RFC 9457.

---

# 38. Java DTO conventions

Java records are recommended for immutable transport DTOs:

```java
record RegisterRequest(...)
record LoginRequest(...)
record PageResponse<T>(...)
```

IDs received through JSON may be modeled as `String` in the DTO and converted through a common parser to `long`, or exposed through configured `Long` serialization.

Observable rule:

> JSON always presents IDs as strings.

Amounts are converted:

```text
JSON string ↔ BigDecimal
```

through explicit serialization.

---

# 39. Controllers by feature

Recommended structure:

```text
auth/
  AuthController

customer/
  ProfileController
  AddressController

catalog/
  CatalogController
  AdminAuthorController
  AdminPublisherController
  AdminCategoryController
  AdminBookController
  AdminEditionController

inventory/
  AdminInventoryController

cart/
  CartController

order/
  CheckoutController
  OrderController
  AdminOrderController
```

A monolithic `AdminController` is not created.

---

# 40. Gateways

Each Controller reaches a Service, and each Service a specific Gateway.

Example:

```text
CheckoutController
    ↓
CheckoutService
    ↓
OrderDbGateway
    ↓
sp_checkout
```

The following is not permitted:

```text
CheckoutService
→ InventoryDbGateway
→ CartDbGateway
→ PaymentDbGateway
```

to orchestrate checkout in Java.

---

# 41. Transaction demarcation

Commands calling Procedures execute within a Spring transaction.

Conceptual example:

```java
@Transactional
public CheckoutResponse checkout(...) {
    return orderDbGateway.checkout(...);
}
```

One call:

```text
Service → Gateway → CALL
```

Read Functions do not require a write transaction.

---

# 42. Response Location

POSTs creating a primary resource must include `Location` when a natural REST URI exists.

Examples:

### Register

No public `/users/{id}` endpoint is exposed, so `Location` is not mandatory.

### Create admin author

Without an individual GET in v1, `Location` is omitted.

### Checkout

An individual GET does exist:

```http
Location: /api/v1/orders/{orderId}
```

It must be included.

---

# 43. HTTP cache

PLIEGO v1 does not define advanced HTTP caching.

Defaults:

- auth/customer/cart/order/admin → `Cache-Control: no-store`;
- the public catalog may use caching in the future;
- ETags are not introduced in v1.

This avoids unrequired complexity.

---

# 44. Content limits

## JSON body

Configure a reasonable maximum size at server level.

v1 recommendation:

```text
1 MiB
```

There are no binary uploads.

Covers are URLs, not files.

## Arrays Book

The Database API validates author/category rules.

REST must reject syntactically invalid arrays, but must not impose arbitrary limits absent from the baseline.

---

# 45. Rate limiting

Not part of PLIEGO v1.

Neither Redis nor additional infrastructure is introduced.

It may be added later at a reverse proxy/gateway without modifying business contracts.

---

# 46. Versioning

The contract is identified by:

```text
/api/v1
```

Compatible changes:

- add an optional response field;
- add a new endpoint;
- add an optional filter.

Incompatible changes:

- rename/remove a required field;
- change endpoint semantics;
- change an observable type;
- alter a state machine;
- change existing error codes.

An incompatible change requires:

```text
/api/v2
```

or explicit compatibility management.

---

# 47. Endpoint → Use Case traceability

| Case | Endpoint(s) |
|---|---|
| CU-AUTH-01 | POST `/auth/register` |
| CU-AUTH-02 | POST `/auth/login` |
| CU-ADM-SEC-01 | GET `/admin/customers`, PUT `/admin/customers/{id}/status` |
| CU-CUS-01 | GET/PUT `/me` |
| CU-CUS-02 | `/me/addresses...` |
| CU-CAT-01 | GET `/catalog/editions` |
| CU-CAT-02 | GET `/catalog/editions/{id}` |
| CU-ADM-CAT-01 | `/admin/authors...` |
| CU-ADM-CAT-02 | `/admin/publishers...` |
| CU-ADM-CAT-03 | `/admin/categories...` |
| CU-ADM-CAT-04 | `/admin/books...` |
| CU-ADM-CAT-05 | `/admin/editions...` |
| CU-INV-01 | GET inventory + movements |
| CU-INV-02 | POST entry/adjustment |
| CU-INV-03 | PUT minimum |
| CU-CART-01 | GET `/cart` |
| CU-CART-02 | POST `/cart/items` |
| CU-CART-03 | PUT `/cart/items/{id}` |
| CU-CART-04 | DELETE `/cart/items/{id}` |
| CU-SAL-01 | POST `/checkout` |
| CU-PAY-01 | included in `/checkout` |
| CU-SAL-02 | GET `/orders`, GET `/orders/{id}` |
| CU-SAL-03 | POST `/orders/{id}/cancel` |
| CU-ADM-SAL-01 | `/admin/orders...` |

Coverage:

```text
24 / 24 use cases
```

---

# 48. Endpoint → Database API traceability

The complete table in §27 is normative.

Rule:

> No v1 business endpoint may access PostgreSQL tables directly.

A new route requiring persistence without a corresponding routine must stop implementation and go through change management.

---

# 49. Minimum REST tests

## Auth

- successful registration;
- duplicate email 409;
- successful login;
- incorrect credentials 401;
- blocked 401;
- expired JWT 401;
- incorrect JWT algorithm 401;
- CUSTOMER on admin 403;
- ADMIN on customer-only 403/DB defense.

## JSON / validation

- malformed JSON 400;
- unknown enum 400;
- invalid ID 400;
- pageSize > 50 400;
- unknown fields 400 (strict).

## Catalog

- public without token;
- filters;
- category unknown → 200 empty;
- edition inactive → detail 404;
- money string;
- ID strings.

## Customer

- address ownership;
- delete;
- primary idempotent.

## Inventory

- insufficient adjustment →409;
- entry returns movement.

## Cart

- add;
- increment same edition;
- update;
- remove;
- inactive item remains visible as unavailable.

## Checkout

- APPROVED → 201;
- REJECTED → 201;
- invalid simulationOutcome →400/P5005;
- insufficient stock →409/P3002;
- another user's address →404/P5004;
- Location header;
- money exact;
- no blind retry.

## Orders

- customer only own order;
- customer cancellation;
- admin cancellation;
- invalid transition 409;
- transition POST not PUT.

## Errors

- ProblemDetail structure;
- `traceId`;
- no SQL leakage;
- P9001 →500;
- raw `23514` →500 DatabaseContractViolation.

---

# 50. Approval criterion

REST API Contract v1.0 moves to `BASELINE APROBADA`. Conditions met:

1. 50 routes accepted;
2. JWT HS256 + claims + TTL accepted;
3. BCrypt password policy accepted;
4. IDs as strings accepted;
5. money as strings accepted;
6. Problem Details RFC 9457 accepted;
7. SQLSTATE → HTTP accepted;
8. retry/recovery accepted;
9. OpenAPI 3.1.2 accepted;
10. no new business rules in Java.

---

# 51. Definition of Ready for Spring implementation

A feature may be handed to Codex/Claude when it has:

- CU;
- endpoint;
- auth/role;
- DTO request;
- DTO response;
- Gateway routine;
- status codes;
- Problem mappings;
- acceptance tests.

This completes the Definition of Ready defined in UCB.

---

# 52. Design lifecycle status

With this document's approval:

```text
Use Case Baseline v1.1        BASELINE
        ↓
Logical ERD v1.1             BASELINE
        ↓
Data Dictionary v1.1        BASELINE
        ↓
Database API Contract v1.1   BASELINE
        ↓
Physical Model v1.0         BASELINE
        ↓
Routine Catalog v1.0        BASELINE
        ↓
Flyway Baseline v1.0         BASELINE
        ↓
REST API Contract v1.0       BASELINE
        ↓
IMPLEMENTATION
```

From this point onward, implementation must materialize contracts, not redefine requirements.

---

# 53. History

| Version | Date | Status | Description |
|---|---|---|---|
| 1.0 | 2026-09-23 | APPROVED BASELINE | First complete PLIEGO REST contract. Defines 50 endpoints, stateless JWT, exact JSON representation, DTOs, Problem Details, SQLSTATE→HTTP mapping, retry/recovery, OpenAPI, and traceability of 24/24 use cases to the approved Database API. RT-01–RT-05 patch applied; RT-06–RT-10 as accepted risks. |

---

# 54. References

## Internal artifacts

- Use Case Baseline v1.1.
- Logical ERD v1.1.
- Data Dictionary v1.1.
- Database API Contract v1.1.
- PostgreSQL Physical Model v1.0.
- Stored Procedure / Function / Trigger Catalog v1.0.
- Flyway Baseline v1.0.

## External standards

- RFC 7519 — JSON Web Token (JWT).
- RFC 8725 / BCP 225 — JSON Web Token Best Current Practices.
- RFC 6750 — Bearer Token Usage.
- RFC 9457 — Problem Details for HTTP APIs.
- OpenAPI Specification 3.1.2 — PLIEGO v1 documentation baseline.
