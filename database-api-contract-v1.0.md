# PLIEGO — Database API Contract v1.0

**Document:** DAC-PLIEGO-001  
**Version:** 1.1  
**Status:** APPROVED BASELINE  
**Date:** 2026-09-23  
**Project:** PLIEGO  
**Document type:** Spring Boot ↔ PostgreSQL interface contract  
**Source documents:**  
- `docs/requirements/use-case-baseline-v1.0.md` — internal version 1.1, APPROVED BASELINE  
- `docs/domain/logical-erd-v1.0.md` — internal version 1.1, APPROVED BASELINE  
- `docs/domain/data-dictionary-v1.0.md` — internal version 1.1, APPROVED BASELINE  

**Scope:** Public Database API consumed by the Spring Boot backend  
**Next artifact:** PostgreSQL Physical Model v1.0  

---

# 1. Purpose

This document defines the formal contract between the Java/Spring Boot backend and PostgreSQL for PLIEGO v1.

Its purpose is to eliminate remaining ambiguity before designing the physical model and implementing Stored Procedures, Functions, Triggers, Constraints, Java Gateways and REST endpoints.

The Database API determines:

- which PostgreSQL routines Java may invoke;
- which are commands and which are queries;
- logical input parameters;
- logical results;
- actor authority and ownership;
- transactional behavior;
- concurrency rules;
- lock ordering;
- domain errors;
- idempotency semantics;
- entities read and modified;
- invariants each routine must preserve;
- use-case traceability;
- boundaries between public routines and internal implementation.

This document **does not yet define**:

- final PostgreSQL physical types;
- final physical table names;
- physical column sizes;
- final indexes;
- DDL;
- complete PL/pgSQL syntax;
- final REST/HTTP mapping;
- final Java DTOs;
- final OpenAPI.

---

# 2. Prior audit results

UCB v1.1, Logical ERD v1.1 and Data Dictionary v1.1 were cross-reviewed.

## 2.1 Overall result

No structural defects were found that require:

- adding entities;
- removing entities;
- changing cardinalities;
- modifying PLIEGO v1 scope;
- modifying the approved state machines.

The **19 persistent entities** remain stable.

The baseline can advance to the Database API Contract.

## 2.2 Residual findings

### DAC-AUD-001 — Logical range of `Idioma`

The Dictionary establishes globally:

```text
ISO 639-1       -> 2 characters
ISO 639-2/T     -> 3 characters when 639-1 is unavailable
```

but the `Edicion.Idioma` row retains the old description:

```text
Language code; 2 characters
```

### Normative resolution

This contract establishes:

```text
LanguageCode := canonical code of 2 or 3 lowercase letters
```

with preference for:

1. ISO 639-1 when available;
2. ISO 639-2/T when ISO 639-1 is unavailable.

`PedidoItem.Idioma_Snapshot` preserves exactly the canonical code current at checkout.

**Impact:** minor editorial correction pending in the Dictionary. The ERD is unchanged.

---

### DAC-AUD-002 — Outdated editorial status in ERD §30

ERD v1.1 has a `BASELINE APROBADA` header, but retains a legacy phrase:

```text
remains a baseline candidate
```

### Resolution

The v1.1 header and history are authoritative.

**Valid status:** `BASELINE APROBADA` (APPROVED BASELINE).

There is no functional impact.

---

### DAC-AUD-003 — Administrative queries missing from the preliminary surface

Administrative use cases include `consultar` (querying), while the preliminary UCB surface mainly listed write routines for Autor, Editorial, Categoría, Libro and Edición.

### Resolution

The Database API incorporates administrative query Functions for:

- customers;
- authors;
- publishers;
- categories;
- books;
- editions.

No scope is added: these Functions implement already approved operations.

---

### DAC-AUD-004 — Initial catalog master-record status not uniformly established

The model requires `Estado`, but creation cases do not uniformly specify whether status must be received as a parameter.

### Resolution

To reduce complexity:

```text
New Autor       -> ACTIVE
New Editorial   -> ACTIVE
New Categoria   -> ACTIVE
New Libro       -> ACTIVE
New Edicion     -> ACTIVE
```

Status is not part of the `create` procedures.

To create a record and subsequently make it inactive, use its `set_status` procedure.

This decision retains a single path for status changes.

---

### DAC-AUD-005 — Transactional semantics awaiting specification

The UCB states that Spring demarcates the transaction and PostgreSQL makes the operation atomic, but does not establish the routines' exact behavior.

### Resolution

- Spring Boot starts/commits/rolls back each command's transaction.
- Each business command calls **exactly one public Procedure**.
- PLIEGO public Procedures **do not execute `COMMIT` or `ROLLBACK`**.
- A domain exception aborts the operation and causes rollback.
- A simulated `REJECTED` payment is a **valid business outcome**, not an exception; the `CANCELLED` Pedido and `REJECTED` Pago are committed.

---

### DAC-AUD-006 — Category filter semantics

The UCB defines filtering by category, but does not specify behavior when filtering by a root category.

### Resolution

In the public catalog:

- subcategory filter → exact match;
- root category filter → Libros associated with that root **or any of its direct subcategories**.

The maximum two-level hierarchy makes this rule simple and deterministic.

---

# 3. Binding Database API principles

## 3.1 Single persistence boundary

Spring Boot does not access tables directly.

The valid direction is:

```text
Controller
    ↓
Service
    ↓
Gateway
    ↓
Procedure / Function PostgreSQL
    ↓
tables and internal logic
```

Implementing business SQL in Java using the following is prohibited:

- `SELECT` on tables;
- `INSERT`;
- `UPDATE`;
- `DELETE`;
- business joins;
- stock logic;
- order logic;
- state transitions;
- calculating totals from tables.

The Gateway may contain only the infrastructure needed to invoke a PostgreSQL routine identified by name.

---

## 3.2 Commands and queries

### Procedure

A Procedure represents a **command** that may modify state.

Convention:

```text
sp_<dominio>_<accion>
```

Example:

```text
sp_cart_add_item
sp_checkout
sp_order_cancel
```

### Function

A public Function represents a **query** and must not produce persistent effects.

Convention:

```text
fn_<dominio>_<consulta>
```

Example:

```text
fn_catalog_search
fn_cart_get
fn_customer_orders
```

---

## 3.3 One business operation = one public call

Correct example:

```text
POST /checkout
       ↓
sp_checkout(...)
```

Prohibited example:

```text
Java -> fn_stock(...)
Java -> fn_price(...)
Java -> sp_create_order(...)
Java -> sp_reduce_stock(...)
```

Business orchestration must remain in PostgreSQL.

---

## 3.4 Public versus internal routines

### Public

These are the only routines Java may invoke.

This document defines them explicitly.

### Internal

PostgreSQL may implement internal helpers for:

- normalization;
- ISBN checksum;
- actor validation;
- total calculation;
- payment simulation;
- state transitions;
- snapshot construction;
- timestamp updates;
- other repeated operations.

Internal routines:

- are not part of the Java contract;
- must not be invoked directly by Gateways;
- may change without changing the contract as long as they preserve observable behavior.

---

## 3.5 Execution security

PLIEGO v1 does not introduce a complex PostgreSQL-specific security model.

Rule:

```text
SECURITY INVOKER
```

is the expected behavior of routines.

`SECURITY DEFINER` **will not be used by default**.

It may only be incorporated later if a concrete, documented need arises.

---

# 4. Logical contract types

The following types are abstract. The PostgreSQL Physical Model will define their concrete representation.

| Logical type | Meaning |
|---|---|
| `Id` | Internal identifier |
| `Text` | UTF-8 text |
| `Email` | Input email |
| `EmailCanonical` | Normalized email |
| `Phone` | Canonical phone number |
| `Code` | Controlled code |
| `Slug` | Canonical slug |
| `SKU` | Canonical SKU |
| `ISBN13` | Canonical ISBN-13 |
| `LanguageCode` | Canonical ISO 639-1 or ISO 639-2/T |
| `CountryCode` | ISO 3166-1 alpha-2 |
| `PositiveInt` | Integer > 0 |
| `NonNegativeInt` | Integer >= 0 |
| `MoneyUSD` | Exact USD decimal, two decimal places |
| `Boolean` | true/false |
| `Date` | Calendar date |
| `Instant` | Absolute instant |
| `Url` | URL/URI |
| `StatusCode` | State-machine value |
| `IdList` | Ordered/unordered collection of IDs as specified by contract |
| `AuthorAssignmentList` | Collection of `(AuthorId, Order)` |
| `Record` | Composite logical result |
| `RecordSet` | Ordered result set |

The representation of `IdList`, `AuthorAssignmentList` and complex structures will be established by the PostgreSQL Physical Model.

---

# 5. Parameter conventions

## 5.1 Prefixes

Input parameters:

```text
p_<nombre>
```

Output parameters/results:

```text
o_<nombre>
```

---

## 5.2 Authenticated actor

Every private operation receives:

```text
p_actor_user_id : Id
```

This value:

- comes from the authenticated Spring Security identity;
- is **not** accepted from the client-controlled body;
- corresponds to `Usuario.UsuarioId`.

PostgreSQL resolves from it:

- existence;
- status;
- role;
- associated Cliente;
- resource ownership.

This prevents Java from having to pass `ClienteId` as the source of authorization.

---

## 5.3 Optional parameters

An optional `null` parameter means:

```text
criterion absent
```

in search Functions.

Update Procedures use **full replacement of the mutable set** semantics, not implicit PATCH.

Therefore:

- `null` in an optional field means “set absence”;
- it does not mean “retain previous value”.

The backend must read/send the full state of mutable attributes when invoking an `update` Procedure. Every `update` revalidates the structural invariants of its corresponding `create`.

This eliminates the ambiguity between:

```text
do not modify
```

and:

```text
set NULL
```

---

# 6. Pagination conventions

Functions returning paginated collections receive:

```text
p_page      : NonNegativeInt
p_page_size : PositiveInt
```

Rules:

```text
p_page >= 0
1 <= p_page_size <= 50
```

`p_page` is **zero-based**.

Example:

```text
p_page = 0
p_page_size = 20
```

represents the first page.

Every row of a paginated query conceptually includes:

```text
total_count
```

to avoid a second count query.

When there are no results:

```text
empty RecordSet
total_count = 0
```

The exact physical mapping of the total will be defined in the Physical Model.

---

# 7. Sorting conventions

Functions do not receive unrestricted SQL fragments.

They receive predefined codes.

Catalog example:

```text
TITLE_ASC
PRICE_ASC
PRICE_DESC
```

Any unrecognized code produces:

```text
P1001 INVALID_ARGUMENT
```

This prevents consumer-controlled dynamic SQL.

If the consumer does not specify a sort, REST supplies `TITLE_ASC`.

---

# 8. Authority and authorization

## 8.1 Technical validation in Spring

Spring Security may block in advance:

- absence of authentication;
- an administrative endpoint without the expected role.

## 8.2 Final authority in PostgreSQL

Private routines revalidate:

- actor existence;
- `Usuario.Estado = ACTIVE`;
- role;
- Cliente association when applicable;
- resource ownership.

This includes reading and cancelling one's own orders: a `BLOCKED` user cannot operate their cart or orders; intervention goes through ADMIN.

Spring validation does not replace PostgreSQL.

---

# 9. Transaction contract

## 9.1 Mutating Procedures

Every mutating public Procedure must execute within a Spring-initiated transaction.

Pattern:

```text
Spring BEGIN
    CALL pliego.sp_xxx(...)
Spring COMMIT
```

If PostgreSQL raises an exception:

```text
Spring ROLLBACK
```

## 9.2 Procedure rule

Public Procedures:

- do not execute `COMMIT`;
- do not execute `ROLLBACK`;
- do not split a business operation across multiple transactions.

Atomicity is achieved because all their logic occurs within the caller's transaction.

## 9.3 Query Functions

Public Functions are read-only.

They must not produce:

- inserts;
- updates;
- deletes;
- transitions;
- persistent side effects.

## 9.4 Exception versus business outcome

### Exception

Examples:

- insufficient stock;
- nonexistent edition;
- unauthorized actor;
- invalid address;
- impossible transition.

Result:

```text
ROLLBACK
```

### Valid business outcome

Simulated payment rejected:

```text
Pedido = CANCELLED
Pago = REJECTED
Carrito = ACTIVE
```

Result:

```text
COMMIT
```

No exception is thrown for simulated rejection.

---

# 10. Domain error model

## 10.1 General rule

Public routines must expose expected errors through a stable five-character SQLSTATE.

Recommended format:

```text
Pxxxx
```

The backend must decide based on:

```text
SQLSTATE
```

and **not** by comparing human-readable messages.

The message may include a stable symbolic code.

Conceptual example:

```text
SQLSTATE: P3002
MESSAGE:  INSUFFICIENT_STOCK
```

Unexpected PostgreSQL errors outside this table are considered technical failures.

---

## 10.2 Domain SQLSTATE catalog

### General / actor

| SQLSTATE | Symbolic code | Semantics |
|---|---|---|
| P1001 | INVALID_ARGUMENT | Parameter outside the contract |
| P1002 | ACTOR_NOT_FOUND | Actor Usuario does not exist |
| P1003 | ACTOR_INACTIVE | Actor Usuario is not ACTIVE |
| P1004 | ACTOR_NOT_ADMIN | Operation requires ADMIN |
| P1005 | ACTOR_NOT_CUSTOMER | Operation requires CUSTOMER |

### Identity / customer

| SQLSTATE | Code | Semantics |
|---|---|---|
| P1101 | EMAIL_ALREADY_EXISTS | Normalized email already registered |
| P1102 | CUSTOMER_NOT_FOUND | CUSTOMER profile does not exist |
| P1103 | ADDRESS_NOT_FOUND | Address does not exist or is not visible to the actor |

### Catalog

| SQLSTATE | Code | Semantics |
|---|---|---|
| P2001 | AUTHOR_NOT_FOUND | Autor does not exist |
| P2002 | AUTHOR_INACTIVE | New Autor in association is INACTIVE |
| P2011 | PUBLISHER_NOT_FOUND | Editorial does not exist |
| P2012 | PUBLISHER_INACTIVE | New/assigned Editorial is INACTIVE |
| P2021 | CATEGORY_NOT_FOUND | Category does not exist |
| P2022 | CATEGORY_INACTIVE | New category in association is INACTIVE |
| P2023 | CATEGORY_INVALID_HIERARCHY | Invalid parent/cycle/depth |
| P2024 | CATEGORY_SLUG_EXISTS | Slug already exists |
| P2031 | BOOK_NOT_FOUND | Libro does not exist |
| P2032 | BOOK_REQUIRES_AUTHOR | ACTIVE Libro would have no author |
| P2033 | BOOK_REQUIRES_CATEGORY | ACTIVE Libro would have no category |
| P2034 | AUTHOR_ORDER_INVALID | Invalid/duplicate authorship order |
| P2041 | EDITION_NOT_FOUND | Edition does not exist |
| P2042 | EDITION_INACTIVE | Edition is INACTIVE for business operation |
| P2043 | BOOK_INACTIVE | Libro is INACTIVE for business operation |
| P2044 | SKU_ALREADY_EXISTS | Duplicate SKU |
| P2045 | ISBN_ALREADY_EXISTS | Duplicate ISBN |
| P2046 | ISBN_INVALID | Invalid ISBN format/checksum |
| P2047 | COVER_METADATA_INVALID | Inconsistent cover metadata/license |
| P2048 | EDITION_DATA_INVALID | Edition data violates invariants |

### Inventory

| SQLSTATE | Code | Semantics |
|---|---|---|
| P3001 | INVENTORY_NOT_FOUND | Edition Inventario does not exist |
| P3002 | INSUFFICIENT_STOCK | Insufficient stock |
| P3003 | STOCK_QUANTITY_INVALID | Invalid movement quantity |
| P3004 | STOCK_MINIMUM_INVALID | Invalid minimum stock |
| P3005 | STOCK_MOVEMENT_DUPLICATE | SALE/CANCELLATION already applied |
| P3006 | SALE_REQUIRED_FOR_CANCELLATION | CANCELLATION without prior SALE |

### Cart

| SQLSTATE | Code | Semantics |
|---|---|---|
| P4001 | CART_NOT_ACTIVE | Required cart does not exist/is no longer active |
| P4002 | CART_EMPTY | Checkout on empty cart |
| P4003 | CART_ITEM_NOT_FOUND | Item does not exist or does not belong to the actor |
| P4004 | CART_QUANTITY_INVALID | Quantity <= 0 or outside the contract |

### Order / payment

| SQLSTATE | Code | Semantics |
|---|---|---|
| P5001 | ORDER_NOT_FOUND | Pedido does not exist or is not visible to CUSTOMER |
| P5002 | ORDER_INVALID_TRANSITION | Logistics transition not allowed |
| P5003 | ORDER_NOT_CANCELLABLE | Current state does not allow cancellation |
| P5004 | CHECKOUT_ADDRESS_INVALID | Address does not exist/does not belong to Cliente |
| P5005 | PAYMENT_OUTCOME_INVALID | Unrecognized simulator outcome |
| P5006 | PAYMENT_STATE_INVALID | Incompatible Pago state |
| P5007 | PAYMENT_REFERENCE_CONFLICT | Duplicate Pago reference |

---

## 10.3 Constraint error normalization

If a concurrent race produces a standard constraint violation for a rule with a domain code, the routine must normalize it to the corresponding domain SQLSTATE using the mandatory mapping:

```text
duplicate email                   -> P1101
duplicate SKU                     -> P2044
duplicate ISBN                    -> P2045
duplicate slug                    -> P2024
duplicate payment reference       -> P5007
duplicate SALE/CANCELLATION        -> P3005
second ACTIVE Carrito             -> reread the existing one; if unable, P4001
second primary address            -> serialize/unmark; P1001 only if unable to comply
duplicate initial history         -> technical failure (not exposed through a valid API)
```

## 10.4 Routine → SQLSTATE matrix

Applicable codes per routine or group (plus the blanket actor checks in §8.2 where applicable):

| Routine / group | Applicable codes |
|---|---|
| `sp_customer_register` | P1001, P1101 |
| `fn_user_auth_data` | none (empty by design) |
| Administrative searches | P1001, P1002, P1003, P1004 |
| `sp_customer_set_status` | P1001, P1002, P1003, P1004, P1102 |
| `fn_customer_profile`, `fn_address_list`, `fn_cart_get` | P1002, P1003, P1005 |
| `sp_customer_update` | P1001, P1002, P1003, P1005, P1102 |
| Address create/update/delete/set_primary | P1001, P1103 |
| `fn_catalog_search`, `fn_edition_detail` | P1001 (sort/enum); unknown slug → 0 rows |
| Catalog admin create/update/set_status | blanket ADMIN checks, entity NOT_FOUND, uniqueness, create invariants also on update |
| Inventory entry/adjust/set_minimum | P2041, defensive P3001, P3003, P3002 (adjust-out), P3004 |
| Cart add/update/remove | P2041, P2042, P2043, P3002, P4001, P4003, P4004 |
| `sp_checkout` | P1001, P4001, P4002, P5004, P2042, P2043, P3002, P5005 |
| `sp_order_cancel` | P5001, P5003, P3005, P3006, P5006 (owning CUSTOMER or ADMIN) |
| `sp_order_change_status` | P5001, P5002 |
| Order queries (customer/admin) | P1002, P1003, P1004/P1005 by role; P5001 for someone else's/nonexistent detail |

## 10.5 Technical integrity error

| SQLSTATE | Code | Classification |
|---|---|---|
| P9001 | IMMUTABLE_HISTORY_VIOLATION | TECHNICAL_INTEGRITY_ERROR |

Not a domain error. Future HTTP: 500. A correct endpoint never produces it; `DatabaseExceptionTranslator` must recognize it.

---

# 11. Concurrency and lock ordering

## 11.1 Principle

Every operation modifying shared resources must:

1. validate the resource;
2. acquire locks in a deterministic order;
3. make changes;
4. preserve invariants;
5. finish without depending on locks external to the transaction.

Actor status is validated at the start; a subsequent concurrent block does not abort the ongoing operation (it applies to new invocations).

---

## 11.2 Cart

The Procedures:

- `sp_cart_add_item`;
- `sp_cart_update_item`;
- `sp_cart_remove_item`;
- `sp_checkout`;

must serialize concurrent modifications to the same Carrito.

Rule:

```text
first: Cliente's ACTIVE Carrito -> FOR UPDATE
```

If none exists when adding:

- creation must be safe against two concurrent requests;
- the “at most one ACTIVE” constraint is the final defense;
- the routine must resolve the conflict leaving exactly one ACTIVE Carrito.

---

## 11.3 Checkout

Logical locking order:

```text
1. Usuario/Cliente actor validated
2. Carrito ACTIVE                     FOR UPDATE
3. Selected Dirección                read lock preventing DELETE during snapshot
4. Cart items
5. Inventarios, ordered by EdicionId ASC     FOR UPDATE
6. create Pedido/Pago/snapshots/movements
```

Inventarios are **always** locked in ascending `EdicionId` order to reduce deadlock risk between checkouts sharing multiple editions.

Once acquired:

- stock is revalidated;
- inventory is updated;
- corresponding movements are created.

---

## 11.4 Administrative inventory

`sp_inventory_entry` and `sp_inventory_adjust`:

```text
Inventario objetivo -> FOR UPDATE
```

before calculating `StockAnterior` and `StockPosterior`.

---

## 11.5 Cancellation

`sp_order_cancel`:

```text
1. Pedido                         FOR UPDATE
2. Associated Pago
3. Inventarios from PedidoItem,
   ordered by EdicionId ASC      FOR UPDATE
4. restoration + movements
5. simulated refund
6. history
```

Two concurrent cancellations cannot restore the same stock twice.

Uniqueness of `(PedidoId, EdicionId, CANCELLATION)` provides additional defense.

---

## 11.6 Primary address

Operations that may change the primary address serialize on the owning Cliente before modifying flags on its Direcciones.

This preserves:

```text
COUNT(Direccion WHERE EsPrincipal) <= 1
```

---

## 11.7 Libro and relationships

`sp_book_update` locks the Libro before replacing:

- metadata;
- authorships;
- categories.

Full replacement occurs in a single transaction.

---

# 12. Idempotency

PLIEGO v1 does not incorporate general `Idempotency-Key` infrastructure.

## 12.1 Naturally idempotent operations

These are idempotent with respect to final state:

- `sp_customer_set_status`;
- `sp_author_set_status`;
- `sp_publisher_set_status`;
- `sp_category_set_status`;
- `sp_book_set_status`;
- `sp_edition_set_status`;
- `sp_inventory_set_minimum`;
- `sp_address_set_primary`.

Requesting the same valid state again succeeds without additional effects.

## 12.2 Non-idempotent operations

Examples:

- registering a customer;
- creating an author/publisher/category/book/edition;
- inventory entry;
- inventory adjustment;
- adding units to the cart;
- rejected checkout.

The caller must not automatically retry them as if they were idempotent.

## 12.3 Approved checkout

Once checkout for a Carrito ends as `APPROVED`:

```text
Carrito -> CHECKED_OUT
```

so a second call cannot generate another purchase from the same cart.

## 12.4 Rejected checkout

A `REJECTED` Pago keeps the Carrito `ACTIVE`.

A new call represents **a new business attempt** and may generate another `CANCELLED` Pedido.

This is intentional v1 behavior.

## 12.5 Retry after timeout

The retry/recovery policy after a timeout or unknown outcome belongs to the REST API Contract: blindly reexecuting non-idempotent commands after losing the response is prohibited.

---

# 13. Payment simulator contract

## 13.1 Scope

There is no external gateway.

Simulation occurs within the `sp_checkout` flow.

## 13.2 Deterministic parameter

`sp_checkout` receives:

```text
p_payment_outcome : Code
```

Allowed values:

```text
APPROVED
REJECTED
```

Random outcomes are not allowed.

This parameter is **technical/academic** and does not represent real financial authorization.

The REST/Security Contract will decide whether it is exposed directly in academic environments or obtained by Spring from test configuration.

## 13.3 APPROVED outcome

It must produce:

```text
Pago.Estado   = APPROVED
Pedido.Estado = CONFIRMED
Carrito       = CHECKED_OUT
stock         = deducted
SALE          = created per item
```

`Pago.Referencia` is mandatory and unique. Format: `SIM-<UUIDv4>` (generated by PostgreSQL).

## 13.4 REJECTED outcome

It must produce:

```text
Pago.Estado   = REJECTED
Pedido.Estado = CANCELLED
Carrito       = ACTIVE
stock         = unchanged
SALE          = none
```

It may record `DetalleResultado`. Reference = NULL in v1 (required by CHECK).

## 13.5 Refund

There is no separate public payment operation.

`REFUNDED` is only produced through:

```text
sp_order_cancel
```

when the Pedido had an `APPROVED` Pago.

---

# 14. Database API — Identity / Security

## 14.1 `sp_customer_register`

### Type

Public Procedure.

### Use case

CU-AUTH-01.

### Logical signature

```text
sp_customer_register(
    p_email         : Email,
    p_password_hash : Text,
    p_first_names   : Text,
    p_last_names    : Text,
    p_phone         : Phone?
)
->
    o_user_id       : Id,
    o_customer_id   : Id,
    o_user_state    : StatusCode
```

### Authority

Public; no authenticated actor required.

### Responsibilities

1. normalize email;
2. check uniqueness;
3. validate nonempty values;
4. create Usuario:
   - role `CUSTOMER`;
   - status `ACTIVE`;
5. create Cliente;
6. preserve the 1:1 relationship;
7. commit both inserts atomically.

### Does not perform

- password hashing;
- sending email;
- session/token creation.

The hash comes from Spring Security.

### Errors

- P1001 INVALID_ARGUMENT
- P1101 EMAIL_ALREADY_EXISTS

### Writes

- Usuario
- Cliente

---

## 14.2 `fn_user_auth_data`

### Type

Public query Function.

### Use case

CU-AUTH-02.

### Logical signature

```text
fn_user_auth_data(
    p_email : Email
)
-> UserAuthRecord?
```

### Result

```text
user_id
email_canonical
password_hash
role
state
```

### Semantics

- normalizes email;
- returns zero results if it does not exist;
- does not raise a `USER_NOT_FOUND` error;
- does not verify the password;
- does not generate a token.

Spring Security:

1. retrieves the record;
2. validates `state`;
3. verifies the password against the hash;
4. generates a stateless token.

### Reads

- Usuario

---

## 14.3 `fn_admin_customer_search`

### Type

Administrative Function.

### Use case

CU-ADM-SEC-01.

### Logical signature

```text
fn_admin_customer_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : StatusCode?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<CustomerAdminSummary>
```

### Filters

`p_query` may match:

- email;
- first names;
- last names.

### Minimum result

```text
user_id
customer_id
email
first_names
last_names
phone
state
created_at
total_count
```

### Authority

Actor `ACTIVE` + `ADMIN`.

### Errors

- P1001
- P1002
- P1003
- P1004

---

## 14.4 `sp_customer_set_status`

### Type

Administrative Procedure.

### Use case

CU-ADM-SEC-01.

### Logical signature

```text
sp_customer_set_status(
    p_actor_user_id  : Id,
    p_customer_id    : Id,
    p_new_state      : UsuarioEstado
)
->
    o_customer_id    : Id,
    o_user_id        : Id,
    o_effective_state: UsuarioEstado
```

### Rules

- ACTIVE ADMIN actor;
- target must exist;
- target must be CUSTOMER;
- valid states: ACTIVE/BLOCKED;
- does not delete the cart;
- does not alter orders;
- requesting the same state is idempotent success.

### Errors

- P1001
- P1002
- P1003
- P1004
- P1102

### Writes

- Usuario

---

# 15. Database API — Customer

## 15.1 `fn_customer_profile`

```text
fn_customer_profile(
    p_actor_user_id : Id
)
-> CustomerProfile
```

Result:

```text
customer_id
email
first_names
last_names
phone
state
```

Actor:

```text
ACTIVE + CUSTOMER
```

---

## 15.2 `sp_customer_update`

```text
sp_customer_update(
    p_actor_user_id : Id,
    p_first_names   : Text,
    p_last_names    : Text,
    p_phone         : Phone?
)
-> CustomerProfile
```

Semantics:

- replaces the profile's mutable set;
- does not modify email;
- does not modify role;
- does not modify status.

Errors:

- P1001
- P1002
- P1003
- P1005
- P1102

---

## 15.3 `fn_address_list`

```text
fn_address_list(
    p_actor_user_id : Id
)
-> RecordSet<AddressRecord>
```

Result:

```text
address_id
alias
recipient
line1
line2
city
province
country_code
postal_code
reference
phone
is_primary
```

Recommended order:

1. primary first;
2. ascending creation order or alias as a stable criterion defined in the physical model.

---

## 15.4 `sp_address_create`

```text
sp_address_create(
    p_actor_user_id : Id,
    p_alias         : Text,
    p_recipient     : Text,
    p_line1         : Text,
    p_line2         : Text?,
    p_city          : Text,
    p_province      : Text,
    p_country_code  : CountryCode,
    p_postal_code   : Text?,
    p_reference     : Text?,
    p_phone         : Phone,
    p_make_primary  : Boolean
)
->
    o_address_id    : Id
```

If `p_make_primary = true`:

- unmarks the previous primary;
- marks the new one;
- all in one transaction.

---

## 15.5 `sp_address_update`

```text
sp_address_update(
    p_actor_user_id : Id,
    p_address_id    : Id,
    p_alias         : Text,
    p_recipient     : Text,
    p_line1         : Text,
    p_line2         : Text?,
    p_city          : Text,
    p_province      : Text,
    p_country_code  : CountryCode,
    p_postal_code   : Text?,
    p_reference     : Text?,
    p_phone         : Phone
)
```

`EsPrincipal` is not modified here.

Use `sp_address_set_primary`.

If the address does not belong to the actor, the routine responds:

```text
P1103 ADDRESS_NOT_FOUND
```

to avoid exposing someone else's ownership.

---

## 15.6 `sp_address_delete`

```text
sp_address_delete(
    p_actor_user_id : Id,
    p_address_id    : Id
)
```

Rules:

- owner only;
- physical DELETE allowed;
- if it was primary, having zero primary addresses afterward is valid;
- does not alter PedidoDireccion.

Errors:

- P1103 ADDRESS_NOT_FOUND

---

## 15.7 `sp_address_set_primary`

```text
sp_address_set_primary(
    p_actor_user_id : Id,
    p_address_id    : Id
)
```

Rules:

- owner only;
- serializes changes to the Cliente's primary addresses;
- leaves exactly that Dirección as primary;
- repeating on the current primary is idempotent success.

---

# 16. Database API — Public catalog

## 16.1 `fn_catalog_search`

### Type

Public Function.

### Use cases

CU-CAT-01.

### Logical signature

```text
fn_catalog_search(
    p_title_query    : Text?,
    p_author_query   : Text?,
    p_isbn13         : ISBN13?,
    p_category_slug  : Slug?,
    p_price_min      : MoneyUSD?,
    p_price_max      : MoneyUSD?,
    p_language       : LanguageCode?,
    p_format         : FormatoEdicion?,
    p_sort           : Code,
    p_page           : NonNegativeInt,
    p_page_size      : PositiveInt
)
-> RecordSet<CatalogEditionSummary>
```

### Filter semantics

All supplied filters are combined using AND.

#### Title

Case-insensitive partial match.

#### Autor

Case-insensitive partial match on `Autor.Nombre`.

#### ISBN

Exact canonical match.

#### Category

If the slug identifies:

- a subcategory → exact association;
- a root → association with the root or any direct subcategory.

Unknown slug → 0 rows, no error.

#### Price

```text
p_price_min <= Edicion.Precio <= p_price_max
```

where applicable.

### Publishability

Only returns:

```text
Libro ACTIVE
AND Edicion ACTIVE
```

Previously associated inactive Autor/Editorial/Categoria records do not hide the edition.

### Availability

```text
available = StockActual > 0
```

Zero stock does not remove the result.

### Minimum result

```text
edition_id
book_id
title
authors_ordered
publisher_name
isbn13
price
cover_url
cover_license
cover_attribution
format
language
available
total_count
```

Does not expose exact `StockActual` in the public API.

---

## 16.2 `fn_edition_detail`

```text
fn_edition_detail(
    p_edition_id : Id
)
-> EditionPublicDetail?
```

Only returns a publishable edition.

If:

- it does not exist;
- Libro is INACTIVE;
- Edicion is INACTIVE;

returns zero results.

Result:

```text
edition_id
book_id
title
subtitle
synopsis
authors_ordered
categories
publisher
isbn13
sku
language
format
page_count
publication_date
price
cover_url
cover_license
cover_source_url
cover_attribution
available
```

---

# 17. Database API — Catalog administration

## 17.1 Administrative queries

All require:

```text
p_actor_user_id -> ACTIVE ADMIN
```

and support pagination when the set may grow.

### `fn_admin_author_search`

```text
fn_admin_author_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : EstadoCatalogo?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<AuthorAdminRecord>
```

### `fn_admin_publisher_search`

```text
fn_admin_publisher_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : EstadoCatalogo?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<PublisherAdminRecord>
```

### `fn_admin_category_search`

```text
fn_admin_category_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : EstadoCatalogo?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<CategoryAdminRecord>
```

Must include parent information when one exists.

### `fn_admin_book_search`

```text
fn_admin_book_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : EstadoCatalogo?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<BookAdminRecord>
```

Each BookAdminRecord must include:

- Libro data;
- authors with IDs and `OrdenAutoria`;
- categories with IDs;
- status.

### `fn_admin_edition_search`

```text
fn_admin_edition_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : EstadoCatalogo?,
    p_book_id       : Id?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<EditionAdminRecord>
```

`p_query` may match:

- SKU;
- ISBN;
- title.

Must return the mutable fields needed for administration.

---

## 17.2 Autor

### `sp_author_create`

```text
sp_author_create(
    p_actor_user_id : Id,
    p_name          : Text,
    p_biography     : Text?
)
->
    o_author_id     : Id
```

Initial status:

```text
ACTIVE
```

### `sp_author_update`

```text
sp_author_update(
    p_actor_user_id : Id,
    p_author_id     : Id,
    p_name          : Text,
    p_biography     : Text?
)
```

### `sp_author_set_status`

```text
sp_author_set_status(
    p_actor_user_id : Id,
    p_author_id     : Id,
    p_new_state     : EstadoCatalogo
)
```

Rules:

- does not delete LibroAutor;
- deactivation does not automatically hide Libros;
- same state = idempotent success.

---

## 17.3 Editorial / Publisher

### `sp_publisher_create`

```text
sp_publisher_create(
    p_actor_user_id : Id,
    p_name          : Text,
    p_description   : Text?
)
->
    o_publisher_id  : Id
```

Initial status `ACTIVE`.

### `sp_publisher_update`

```text
sp_publisher_update(
    p_actor_user_id : Id,
    p_publisher_id  : Id,
    p_name          : Text,
    p_description   : Text?
)
```

### `sp_publisher_set_status`

```text
sp_publisher_set_status(
    p_actor_user_id : Id,
    p_publisher_id  : Id,
    p_new_state     : EstadoCatalogo
)
```

Does not automatically modify existing editions.

---

## 17.4 Category

### `sp_category_create`

```text
sp_category_create(
    p_actor_user_id    : Id,
    p_name             : Text,
    p_slug             : Slug,
    p_description      : Text?,
    p_parent_category_id : Id?
)
->
    o_category_id      : Id
```

Initial status `ACTIVE`.

Validates:

- global slug;
- existing parent;
- root parent;
- no depth > 2.

### `sp_category_update`

```text
sp_category_update(
    p_actor_user_id      : Id,
    p_category_id        : Id,
    p_name               : Text,
    p_slug               : Slug,
    p_description        : Text?,
    p_parent_category_id : Id?
)
```

If a root category has children, it cannot become a subcategory because that would create invalid depth.

### `sp_category_set_status`

```text
sp_category_set_status(
    p_actor_user_id : Id,
    p_category_id   : Id,
    p_new_state     : EstadoCatalogo
)
```

Does not delete LibroCategoria.

---

## 17.5 Libro

### AuthorAssignmentList

Each entry contains:

```text
author_id
order
```

Rules:

- no repeated IDs;
- `order > 0`;
- no repeated order;
- order need not be contiguous.

### `sp_book_create`

```text
sp_book_create(
    p_actor_user_id : Id,
    p_title         : Text,
    p_subtitle      : Text?,
    p_synopsis      : Text?,
    p_authors       : AuthorAssignmentList,
    p_category_ids  : IdList
)
->
    o_book_id       : Id
```

Initial status `ACTIVE`.

Requires:

```text
>= 1 author
>= 1 category
```

All introduced Autores and categories must be `ACTIVE`.

Atomically creates:

- Libro;
- LibroAutor;
- LibroCategoria.

### `sp_book_update`

```text
sp_book_update(
    p_actor_user_id : Id,
    p_book_id       : Id,
    p_title         : Text,
    p_subtitle      : Text?,
    p_synopsis      : Text?,
    p_authors       : AuthorAssignmentList,
    p_category_ids  : IdList
)
```

Semantics:

- replaces the current set of authors and categories;
- reorders authorship within a transaction;
- an existing INACTIVE association may be retained;
- an INACTIVE Autor/category not previously associated cannot be introduced;
- if Libro is `ACTIVE`, the final list must retain at least one Autor and one category.

### `sp_book_set_status`

```text
sp_book_set_status(
    p_actor_user_id : Id,
    p_book_id       : Id,
    p_new_state     : EstadoCatalogo
)
```

To transition to `ACTIVE`:

```text
>= 1 LibroAutor
>= 1 LibroCategoria
```

Does not change edition status.

---

## 17.6 Edition

### `sp_edition_create`

```text
sp_edition_create(
    p_actor_user_id        : Id,
    p_book_id              : Id,
    p_publisher_id         : Id,
    p_sku                  : SKU,
    p_isbn13               : ISBN13?,
    p_language             : LanguageCode,
    p_format               : FormatoEdicion,
    p_page_count           : PositiveInt,
    p_publication_date     : Date?,
    p_price                : MoneyUSD,
    p_cover_url            : Url?,
    p_cover_license        : LicenciaPortada?,
    p_cover_source_url     : Url?,
    p_cover_attribution    : Text?
)
->
    o_edition_id           : Id
```

Initial status:

```text
ACTIVE
```

Rules:

- Libro must exist; it may be INACTIVE.
- Editorial must be ACTIVE.
- Unique SKU.
- Optional ISBN must be valid and unique.
- LanguageCode has 2 or 3 canonical letters.
- price > 0.
- pages > 0.
- cover complies with the license matrix.

Creates in the same transaction:

```text
Edicion
Inventario(StockActual=0, StockMinimo=0)
```

### `sp_edition_update`

```text
sp_edition_update(
    p_actor_user_id        : Id,
    p_edition_id           : Id,
    p_publisher_id         : Id,
    p_isbn13               : ISBN13?,
    p_language             : LanguageCode,
    p_format               : FormatoEdicion,
    p_page_count           : PositiveInt,
    p_publication_date     : Date?,
    p_price                : MoneyUSD,
    p_cover_url            : Url?,
    p_cover_license        : LicenciaPortada?,
    p_cover_source_url     : Url?,
    p_cover_attribution    : Text?
)
```

Cannot modify:

- LibroId;
- SKU.

If `PublisherId` changes, the new Publisher must be ACTIVE.

If it retains the current Publisher even when INACTIVE, updating other metadata remains valid.

### `sp_edition_set_status`

```text
sp_edition_set_status(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_new_state     : EstadoCatalogo
)
```

Does not change Libro.

---

# 18. Database API — Inventory

## 18.1 `fn_inventory_search`

```text
fn_inventory_search(
    p_actor_user_id : Id,
    p_edition_id    : Id?,
    p_title_query   : Text?,
    p_sku           : SKU?,
    p_low_stock_only: Boolean?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<InventorySummary>
```

Actor: ADMIN ACTIVE.

Result:

```text
edition_id
book_id
title
sku
isbn13
edition_state
stock_actual
stock_minimo
low_stock
updated_at
total_count
```

`low_stock`:

```text
StockMinimo > 0
AND StockActual <= StockMinimo
```

---

## 18.2 `fn_inventory_movements`

```text
fn_inventory_movements(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_type          : TipoMovimientoInventario?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<InventoryMovementRecord>
```

Order:

```text
Fecha DESC
```

with a stable secondary criterion by ID.

---

## 18.3 `sp_inventory_entry`

```text
sp_inventory_entry(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_quantity      : PositiveInt,
    p_reason        : Text
)
->
    o_movement_id   : Id,
    o_stock_before  : NonNegativeInt,
    o_stock_after   : NonNegativeInt
```

Actor ADMIN.

Generated type:

```text
ENTRY
```

Lock:

```text
Inventario FOR UPDATE
```

---

## 18.4 `sp_inventory_adjust`

```text
sp_inventory_adjust(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_adjustment_type : Code,
    p_quantity      : PositiveInt,
    p_reason        : Text
)
->
    o_movement_id   : Id,
    o_stock_before  : NonNegativeInt,
    o_stock_after   : NonNegativeInt
```

`p_adjustment_type` only allows:

```text
ADJUSTMENT_IN
ADJUSTMENT_OUT
```

Does not allow:

- ENTRY;
- SALE;
- CANCELLATION.

`ADJUSTMENT_OUT` never leaves negative stock.

---

## 18.5 `sp_inventory_set_minimum`

```text
sp_inventory_set_minimum(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_stock_minimum : NonNegativeInt
)
->
    o_stock_minimum : NonNegativeInt
```

Does not generate MovimientoInventario.

`0` means:

```text
no low-stock threshold
```

---

# 19. Database API — Cart

## 19.1 `fn_cart_get`

```text
fn_cart_get(
    p_actor_user_id : Id
)
-> CartView
```

Actor ACTIVE CUSTOMER.

### If an ACTIVE Carrito exists

Returns:

```text
cart_id
state = ACTIVE
items[]
total_current
```

Each item includes:

```text
cart_item_id
edition_id
title
authors
sku
cover
quantity
current_price
current_subtotal
available
unavailability_reason?
```

### If no ACTIVE Carrito exists

Conceptually returns:

```text
cart_id = null
state = null
items = []
total_current = 0
```

Does not create a Carrito.

### Deactivated item

If Libro or edition became INACTIVE:

- the item is not hidden;
- `available = false`;
- checkout will reject it.

---

## 19.2 `sp_cart_add_item`

```text
sp_cart_add_item(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_quantity      : PositiveInt
)
->
    o_cart_id       : Id,
    o_cart_item_id  : Id,
    o_quantity      : PositiveInt
```

Flow:

1. ACTIVE CUSTOMER actor;
2. gets/creates ACTIVE Carrito;
3. locks Carrito;
4. validates ACTIVE Libro;
5. validates ACTIVE Edicion;
6. validates current stock;
7. inserts item or increments quantity;
8. validates total quantity <= current stock.

Does not reserve stock.

Relevant errors:

- P2041
- P2042
- P2043
- P3002
- P4004

---

## 19.3 `sp_cart_update_item`

```text
sp_cart_update_item(
    p_actor_user_id : Id,
    p_cart_item_id  : Id,
    p_quantity      : PositiveInt
)
->
    o_cart_id       : Id,
    o_cart_item_id  : Id,
    o_quantity      : PositiveInt
```

Rules:

- item belongs to the actor's ACTIVE Carrito;
- quantity > 0;
- quantity <= current stock;
- does not reserve stock.

If item belongs to someone else/does not exist:

```text
P4003 CART_ITEM_NOT_FOUND
```

---

## 19.4 `sp_cart_remove_item`

```text
sp_cart_remove_item(
    p_actor_user_id : Id,
    p_cart_item_id  : Id
)
```

Rules:

- own ACTIVE Carrito only;
- physical DELETE of the item;
- if left empty, Carrito remains ACTIVE.

---

# 20. Database API — Sales / Orders

## 20.1 `sp_checkout`

### Type

Critical Procedure.

### Use cases

- CU-SAL-01
- includes CU-PAY-01

### Logical signature

```text
sp_checkout(
    p_actor_user_id  : Id,
    p_address_id     : Id,
    p_payment_method : MetodoPago,
    p_payment_outcome: Code
)
->
    o_order_id       : Id,
    o_order_state    : EstadoPedido,
    o_payment_state  : EstadoPago,
    o_total          : MoneyUSD,
    o_payment_reference : Text?
```

### Preconditions

- ACTIVE CUSTOMER actor;
- Dirección exists and belongs to the actor;
- ACTIVE Carrito;
- nonempty Carrito.

### Locking

1. Carrito FOR UPDATE.
2. Dirección protected against DELETE during snapshot.
3. Inventarios by `EdicionId ASC` FOR UPDATE.

### Revalidations

For each item:

```text
Libro ACTIVE
Edicion ACTIVE
Cantidad > 0
StockActual >= Cantidad
current Precio > 0
```

### Snapshots

Each PedidoItem copies:

- SKU;
- ISBN;
- title;
- authors in order;
- publisher;
- format;
- language;
- unit price;
- quantity;
- subtotal.

PedidoDireccion copies:

- recipient;
- address 1/2;
- city;
- province;
- country;
- postal code;
- reference;
- phone.

Does not copy Alias.

### History

Always creates:

```text
NULL -> PENDING_PAYMENT
Origen = SYSTEM
```

Then, in the same transaction:

#### APPROVED

```text
PENDING_PAYMENT -> CONFIRMED
Origen = SYSTEM
```

#### REJECTED

```text
PENDING_PAYMENT -> CANCELLED
Origen = SYSTEM
```

### APPROVED

- Pago APPROVED;
- mandatory and unique Referencia;
- one SALE per PedidoItem;
- stock deducted;
- Pedido CONFIRMED;
- Carrito CHECKED_OUT.

### REJECTED

- Pago REJECTED;
- Pedido CANCELLED;
- no SALE;
- stock unchanged;
- Carrito ACTIVE.

### Errors

Among others:

- P4001 CART_NOT_ACTIVE
- P4002 CART_EMPTY
- P5004 CHECKOUT_ADDRESS_INVALID
- P2042 EDITION_INACTIVE
- P2043 BOOK_INACTIVE
- P3002 INSUFFICIENT_STOCK
- P5005 PAYMENT_OUTCOME_INVALID

### Atomicity

Any domain/technical error before the final outcome causes a full rollback.

---

## 20.2 `fn_customer_orders`

```text
fn_customer_orders(
    p_actor_user_id : Id,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<CustomerOrderSummary>
```

Default order:

```text
FechaCreacion DESC
```

Result:

```text
order_id
created_at
order_state
total
payment_state
total_count
```

Includes orders:

- confirmed;
- in logistics;
- delivered;
- cancelled by rejection;
- cancelled afterward.

Never returns another Cliente's orders.

---

## 20.3 `fn_customer_order_detail`

```text
fn_customer_order_detail(
    p_actor_user_id : Id,
    p_order_id      : Id
)
-> CustomerOrderDetail?
```

Result:

```text
order header
items snapshots
address snapshot
payment
state history
```

Pedido does not exist or belongs to someone else:

```text
P5001 ORDER_NOT_FOUND
```

The existence of someone else's order is not distinguished externally.

---

## 20.4 `sp_order_cancel`

### Purpose

The only public routine owning the transition to `CANCELLED` after an approved payment.

### Signature

```text
sp_order_cancel(
    p_actor_user_id : Id,
    p_order_id      : Id
)
->
    o_order_id      : Id,
    o_previous_state: EstadoPedido,
    o_order_state   : EstadoPedido,
    o_payment_state : EstadoPago,
    o_restored_units: NonNegativeInt
```

### Allowed actors

#### CUSTOMER

- must own the Pedido.

#### ADMIN

- may cancel any permitted Pedido.

### Source states

```text
CONFIRMED
PREPARING
```

### Procedure

1. lock Pedido;
2. validate actor;
3. validate state;
4. retrieve PedidoItems;
5. lock Inventarios by EdicionId ASC;
6. verify a prior SALE exists for each item;
7. restore stock;
8. create CANCELLATION per item;
9. Pago APPROVED -> REFUNDED;
10. Pedido -> CANCELLED;
11. create history:
    - Origen USER;
    - UsuarioActorId = actor;
12. commit.

### Duplicate defense

For each edition:

```text
maximum 1 CANCELLATION per Pedido
```

### Errors

- P5001 ORDER_NOT_FOUND
- P5003 ORDER_NOT_CANCELLABLE
- P3005 STOCK_MOVEMENT_DUPLICATE
- P3006 SALE_REQUIRED_FOR_CANCELLATION
- P5006 PAYMENT_STATE_INVALID

---

## 20.5 `fn_admin_orders`

```text
fn_admin_orders(
    p_actor_user_id : Id,
    p_state         : EstadoPedido?,
    p_date_from     : Instant?,
    p_date_to       : Instant?,
    p_customer_id   : Id?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<AdminOrderSummary>
```

Actor ADMIN.

Default order:

```text
FechaCreacion DESC
```

---

## 20.6 `fn_admin_order_detail`

```text
fn_admin_order_detail(
    p_actor_user_id : Id,
    p_order_id      : Id
)
-> AdminOrderDetail?
```

Includes:

- basic Cliente data;
- Pedido;
- snapshots;
- Pago;
- history;
- associated SALE/CANCELLATION movements.

---

## 20.7 `sp_order_change_status`

### Purpose

Logistics advancement only.

### Signature

```text
sp_order_change_status(
    p_actor_user_id : Id,
    p_order_id      : Id,
    p_new_state     : EstadoPedido
)
->
    o_order_id      : Id,
    o_previous_state: EstadoPedido,
    o_order_state   : EstadoPedido
```

### Actor

ADMIN ACTIVE.

### Allowed transitions

```text
CONFIRMED -> PREPARING
PREPARING -> SHIPPED
SHIPPED -> DELIVERED
```

### Explicit prohibition

Does not allow:

```text
CANCELLED
```

Cancellation exclusively uses:

```text
sp_order_cancel
```

### History

Each success adds:

```text
Origen = USER
UsuarioActorId = p_actor_user_id
```

### Errors

- P5001
- P5002

---

# 21. Database API — Payment

PLIEGO v1 **does not expose dedicated public Pago Procedures**.

Rationale:

- `PENDING -> APPROVED/REJECTED` belongs to `sp_checkout`;
- `APPROVED -> REFUNDED` belongs to `sp_order_cancel`;
- no use case allows altering Pago independently.

This decision prevents a second writer of the Pago state machine.

Internal PostgreSQL Pago operations are not part of the Java contract.

---

# 22. Actor → routine matrix

| Group | Public | CUSTOMER | ADMIN |
|---|---:|---:|---:|
| Registration | Yes | — | — |
| Auth data | Yes | — | — |
| Public catalog | Yes | Yes | Yes |
| Cliente profile | — | Yes | — |
| Addresses | — | Yes | — |
| Customer admin | — | — | Yes |
| Catalog admin | — | — | Yes |
| Inventory | — | — | Yes |
| Cart | — | Yes | — |
| Checkout | — | Yes | — |
| Own orders | — | Yes | — |
| Cancel own order | — | Yes | — |
| Administrative order cancellation | — | — | Yes |
| Logistics management | — | — | Yes |

---

# 23. Use case → Database API matrix

| Use case | Public routine(s) |
|---|---|
| CU-AUTH-01 | `sp_customer_register` |
| CU-AUTH-02 | `fn_user_auth_data` |
| CU-ADM-SEC-01 | `fn_admin_customer_search`, `sp_customer_set_status` |
| CU-CUS-01 | `fn_customer_profile`, `sp_customer_update` |
| CU-CUS-02 | `fn_address_list`, `sp_address_create`, `sp_address_update`, `sp_address_delete`, `sp_address_set_primary` |
| CU-CAT-01 | `fn_catalog_search` |
| CU-CAT-02 | `fn_edition_detail` |
| CU-ADM-CAT-01 | `fn_admin_author_search`, `sp_author_create`, `sp_author_update`, `sp_author_set_status` |
| CU-ADM-CAT-02 | `fn_admin_publisher_search`, `sp_publisher_create`, `sp_publisher_update`, `sp_publisher_set_status` |
| CU-ADM-CAT-03 | `fn_admin_category_search`, `sp_category_create`, `sp_category_update`, `sp_category_set_status` |
| CU-ADM-CAT-04 | `fn_admin_book_search`, `sp_book_create`, `sp_book_update`, `sp_book_set_status` |
| CU-ADM-CAT-05 | `fn_admin_edition_search`, `sp_edition_create`, `sp_edition_update`, `sp_edition_set_status` |
| CU-INV-01 | `fn_inventory_search`, `fn_inventory_movements` |
| CU-INV-02 | `sp_inventory_entry`, `sp_inventory_adjust` |
| CU-INV-03 | `sp_inventory_set_minimum` |
| CU-CART-01 | `fn_cart_get` |
| CU-CART-02 | `sp_cart_add_item` |
| CU-CART-03 | `sp_cart_update_item` |
| CU-CART-04 | `sp_cart_remove_item` |
| CU-SAL-01 | `sp_checkout` |
| CU-PAY-01 | Internal to `sp_checkout`; no separate public routine |
| CU-SAL-02 | `fn_customer_orders`, `fn_customer_order_detail` |
| CU-SAL-03 | `sp_order_cancel` |
| CU-ADM-SAL-01 | `fn_admin_orders`, `fn_admin_order_detail`, `sp_order_change_status`, `sp_order_cancel` |

All 24 use cases have Database API coverage.

---

# 24. Routine → entity matrix

| Routine / group | Reads | Writes |
|---|---|---|
| `sp_customer_register` | Usuario | Usuario, Cliente |
| `fn_user_auth_data` | Usuario | — |
| `fn_admin_customer_search` | Usuario, Cliente | — |
| `sp_customer_set_status` | Usuario, Cliente | Usuario |
| `fn_customer_profile` | Usuario, Cliente | — |
| `sp_customer_update` | Usuario, Cliente | Cliente |
| Address API | Usuario, Cliente, Direccion | Direccion |
| `fn_catalog_search` | Libro, Autor, LibroAutor, Categoria, LibroCategoria, Editorial, Edicion, Inventario | — |
| `fn_edition_detail` | catalog + Inventario | — |
| Admin Author | Usuario, Autor | Autor |
| Admin Publisher | Usuario, Editorial | Editorial |
| Admin Category | Usuario, Categoria | Categoria |
| Admin Book | Usuario, Libro, Autor, LibroAutor, Categoria, LibroCategoria | Libro, LibroAutor, LibroCategoria |
| Admin Edition | Usuario, Libro, Editorial, Edicion, Inventario | Edicion, Inventario on creation |
| Inventory query | Usuario, Libro, Edicion, Inventario, MovimientoInventario | — |
| Inventory commands | Usuario, Inventario | Inventario, MovimientoInventario |
| Cart query | Usuario, Cliente, Carrito, CarritoItem, Libro, Edicion, Inventario | — |
| Cart commands | Usuario, Cliente, Carrito, CarritoItem, Libro, Edicion, Inventario | Carrito, CarritoItem |
| `sp_checkout` | Usuario, Cliente, Direccion, Carrito, CarritoItem, Libro, Edicion, Editorial, Autor, LibroAutor, Inventario | Pedido, PedidoItem, PedidoDireccion, Pago, PedidoEstadoHistorial, Inventario, MovimientoInventario, Carrito |
| Order queries | Pedido and dependencies | — |
| `sp_order_cancel` | Usuario, Pedido, PedidoItem, Pago, Inventario, MovimientoInventario | Pedido, Pago, Inventario, MovimientoInventario, PedidoEstadoHistorial |
| `sp_order_change_status` | Usuario, Pedido | Pedido, PedidoEstadoHistorial |

---

# 25. Invariants by preferred technique

The final technique will be established in the Physical Model, but this contract assigns responsibility.

## 25.1 Constraints

Preferred for:

- PK;
- FK;
- NOT NULL;
- uniqueness;
- positive quantities;
- nonnegative stock;
- positive prices/amounts;
- simple domain values.

## 25.2 Procedures

Authority for:

- multi-entity rules;
- ownership;
- states;
- cart;
- checkout;
- inventory;
- cancellation;
- snapshots;
- atomic creation of Edicion + Inventario;
- replacement of Libro associations.

## 25.3 Functions

Authority for:

- search;
- composite views;
- read calculations;
- availability;
- display totals.

## 25.4 Triggers

They will only be used when they provide a clear cross-cutting guarantee.

Acceptable candidates:

- `FechaActualizacion`;
- protecting invariants impossible to express through CHECK;
- protecting append-only structures if the physical model considers it necessary.

Complex trigger chains will not be used to implement checkout or cancellation.

---

# 26. Java implementation rules

## 26.1 Gateway

Each Java module will have dedicated Gateways.

Examples:

```text
CustomerDbGateway
CatalogDbGateway
InventoryDbGateway
CartDbGateway
OrderDbGateway
```

## 26.2 Allowed

- `SimpleJdbcCall`;
- `CallableStatement`;
- equivalent infrastructure for invoking Functions/Procedures;
- mapping results to Java records/DTOs;
- translating SQLSTATE into application exceptions.

## 26.3 Prohibited

- `JpaRepository`;
- `EntityManager`;
- JPA entities;
- Hibernate;
- SQL against tables;
- join logic in Java;
- recalculating business rules as the authority;
- `float`/`double`/`Float`/`Double` for money (use `java.math.BigDecimal` ↔ `NUMERIC`).

## 26.4 Transaction boundary

Command operations must execute with Spring transaction demarcation.

A public business operation must make a single Database API call.

---

# 27. Error translation in Java

A single component will be implemented, conceptually:

```text
DatabaseExceptionTranslator
```

Responsibility:

```text
SQLException
   ↓
SQLSTATE
   ↓
Domain/Application Exception
```

Example:

```text
P3002
   ↓
InsufficientStockException
```

Controllers must not inspect SQLException directly.

A `23514 CHECK_VIOLATION` reaching the Gateway is translated to `DatabaseContractViolationException` (technical failure / HTTP 500). It is not automatically translated to `P1001`, to avoid hiding internal bugs.

The final HTTP mapping belongs to the REST API Contract.

---

# 28. Minimum observability

Each Gateway must safely log:

- routine name;
- duration;
- success/failure;
- SQLSTATE on failure;
- correlation/request ID if present.

It must not log:

- PasswordHash;
- password;
- full address data unnecessarily;
- nonexistent sensitive card data.

No additional infrastructure is required.

---

# 29. Contract evolution rules

## 29.1 Compatible change

Examples:

- adding an optional output field;
- adding a new administrative Function;
- optimizing internal implementation.

Version 1.x may be retained.

## 29.2 Incompatible change

Examples:

- removing a mandatory parameter;
- changing a parameter's meaning;
- changing the atomicity rule;
- changing the state machine;
- changing persistent cardinality.

Requires:

1. change management;
2. UCB/ERD/DD review;
3. new contract version;
4. compatible migration.

## 29.3 Internal routines

They may change freely if they preserve the observable contract of public routines.

---

# 30. Minimum test criteria per routine

## 30.1 Functions

Each Function must test:

- expected result;
- filters;
- pagination;
- empty results;
- invalid actor when applicable;
- ownership when applicable.

## 30.2 CRUD Procedures

Must test:

- success;
- nonexistent entity;
- incorrect actor;
- invalid data;
- uniqueness;
- rollback.

## 30.3 Inventory

Must test:

- entry;
- adjustment in;
- adjustment out;
- insufficient stock;
- movement created;
- concurrency.

## 30.4 Cart

Must test:

- implicit cart creation;
- new item;
- incrementing the same item;
- invalid quantity;
- insufficient stock;
- deactivated item;
- ownership;
- two concurrent cart creation requests.

## 30.5 Checkout

Mandatory tests:

1. APPROVED;
2. REJECTED;
3. empty cart;
4. inactive edition;
5. inactive book;
6. nonexistent address;
7. someone else's address;
8. insufficient stock;
9. current price used;
10. correct snapshots;
11. two history records;
12. SALE per item only on APPROVED;
13. CHECKED_OUT Carrito only on APPROVED;
14. concurrency for the last unit;
15. rollback on technical failure.

## 30.6 Cancellation

Mandatory tests:

- owning CUSTOMER;
- non-owning CUSTOMER;
- ADMIN;
- CONFIRMED;
- PREPARING;
- SHIPPED rejected;
- DELIVERED rejected;
- exact restoration;
- one CANCELLATION per item;
- REFUNDED;
- second attempt does not duplicate stock.

---

# 31. Mandatory concurrency tests

## 31.1 Last unit

```text
Stock = 1

Checkout A: quantity 1
Checkout B: quantity 1
```

Required result:

```text
exactly one CONFIRMED
the other -> P3002 INSUFFICIENT_STOCK
Final Stock = 0
```

Never:

```text
Stock < 0
```

## 31.2 Two cart creations

Two concurrent calls to `sp_cart_add_item` for a Cliente without a Carrito.

Result:

```text
exactly one ACTIVE Carrito
```

## 31.3 Double cancellation

Two concurrent calls to `sp_order_cancel`.

Result:

```text
stock restored only once
one CANCELLATION per edition
```

## 31.4 Concurrent adjustments

Two adjustments to the same Inventario must serialize, and each Movimiento must reflect a correct pair:

```text
StockAnterior -> StockPosterior
```

---

# 32. Rules the Physical Model must resolve

The next artifact must turn this contract into concrete PostgreSQL decisions.

It must establish:

1. ID types;
2. money types;
3. domain representation;
4. physical type for 2/3-character LanguageCode;
5. arrays/JSON/composite types for input collections;
6. composite result representation;
7. indexes;
8. partial indexes;
9. constraints;
10. FKs and `ON DELETE`;
11. timestamps;
12. physical naming;
13. procedure for primary-address uniqueness;
14. at most one ACTIVE Carrito;
15. conditional ISBN uniqueness;
16. conditional Pago.Referencia uniqueness;
17. SALE/CANCELLATION uniqueness;
18. concrete locks;
19. helper functions;
20. minimum triggers;
21. Flyway layout.

---

# 33. Decisions explicitly not made here

This contract does not yet determine:

- `BIGINT` versus UUID;
- exact `VARCHAR(n)`;
- PostgreSQL ENUM versus CHECK;
- JSONB versus arrays/composite types for lists;
- exact text-search implementation;
- trigram/full-text indexes;
- physical constraint names;
- OpenAPI details;
- JWT expiration/claims;
- exact password-hashing algorithms;
- CORS;
- frontend.

---

# 34. Completeness validation

| Question | Result |
|---|---|
| Do all 24 use cases have a Database API? | Yes |
| Were the missing administrative queries covered? | Yes |
| Is there a single public writer of post-payment CANCELLED? | Yes: `sp_order_cancel` |
| Is there a single public writer of logistics advancement? | Yes: `sp_order_change_status` |
| Does Pago have independent public writers? | No |
| Is checkout a single call? | Yes |
| Do stock rules remain in PostgreSQL? | Yes |
| Is deterministic locking defined? | Yes |
| Is simulated payment deterministic? | Yes |
| Is business rejection distinguished from technical failure? | Yes |
| Do errors have a stable contract? | Yes |
| Does Java need business SQL against tables? | No |
| Is SECURITY DEFINER required? | No |
| Were new entities incorporated? | No |
| Was a frontend introduced? | No |
| Are critical structural decisions still TBD? | No |

---

# 35. Definition of Ready for the Physical Model

The PostgreSQL Physical Model may begin when this contract is approved.

It must receive as inputs:

```text
UCB v1.1
DER v1.1
DD v1.1
Database API Contract v1.0
```

It must not silently alter:

- semantic routine signatures;
- state machines;
- errors;
- ownership;
- logical locking;
- atomicity;
- business outcomes.

If a physical limitation requires changing these points, this contract must be revisited through change management.

---

# 36. Minor corrections recommended for prior artifacts

Before or during formal approval of this contract, applying two editorial errata is recommended:

### DD v1.1

Change:

```text
Edicion.Idioma — Language code; 2 characters
```

to:

```text
Edicion.Idioma — LanguageCode; 2 or 3 characters
```

in accordance with §5.5.

### DER v1.1

Change in §30:

```text
remains a baseline candidate
```

to:

```text
remains an APPROVED BASELINE
```

These corrections do not justify a major version or modify behavior.

---

# 37. Document history

| Version | Date | Status | Description |
|---|---|---|---|
| 1.0 | 2026-09-23 | BASELINE CANDIDATE | First formal Database API contract. Audits UCB/ERD/DD v1.1, establishes Spring↔PostgreSQL authority, public Procedures/Functions, transactions, locking, SQLSTATE, payment simulator and full use-case traceability. |
| 1.1 | 2026-09-23 | APPROVED BASELINE | Incorporates B1–B9: routine→SQLSTATE matrix (§10.4), mandatory normalization mapping, explicit blanket checks for blocked users, unknown slug → empty, update revalidates create, BigDecimal, SIM-UUID and REJECTED NULL, retry deferred to REST, accepted blocking race, TITLE_ASC default. Adds technical P9001 and 23514 policy. |

---

# 38. References

## PLIEGO artifacts

- `docs/requirements/use-case-baseline-v1.0.md` — internal version 1.1.
- `docs/domain/logical-erd-v1.0.md` — internal version 1.1.
- `docs/domain/data-dictionary-v1.0.md` — internal version 1.1.

## Technical references

- PostgreSQL 18 — PL/pgSQL Errors and Messages (`RAISE`, SQLSTATE).
- PostgreSQL 18 — PL/pgSQL Transaction Management.
- PostgreSQL 18 — Data Consistency Checks at the Application Level / row locking.
- PostgreSQL 18 — `CREATE PROCEDURE`.
- Approved PLIEGO architecture: Java 25 + Spring Boot + PostgreSQL + Flyway; no ORM; authoritative business logic in PostgreSQL; frontend later.
