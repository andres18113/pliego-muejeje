# PLIEGO — Use Case Baseline v1.0

**Document:** UCB-PLIEGO-001  
**Version:** 1.1  
**Status:** BASELINE APPROVED FOR LOGICAL DESIGN  
**Date:** 2026-09-23  
**Project:** PLIEGO  
**Document type:** Use case specification and functional baseline  
**Scope:** Backend, business logic, and persistence  
**Frontend:** Outside this baseline's implementation scope; the API must allow its later incorporation.  

---

## 1. Purpose

This document establishes the **PLIEGO functional use case baseline** and constitutes the source of truth for the following lifecycle stages:

1. logical data model design;
2. ERD development;
3. data dictionary;
4. business rule definition;
5. PostgreSQL Database API design;
6. Stored Procedure, Function, Trigger, and Constraint definition;
7. REST API design;
8. test design;
9. implementation by Codex/Claude or other agents;
10. subsequent validation and maintenance.

The main purpose is to reduce functional ambiguity before physical design and implementation. No critical entity, relationship, state transition, or business rule should be introduced later without justification in this baseline or a formal change request.

---

## 2. Software Engineering approach

The specification adopts Requirements Engineering principles consistent with **ISO/IEC/IEEE 29148:2018** and uses **UML 2.5.1**-compatible terminology for actors and use cases.

The baseline follows this process:

**Elicitation → Analysis → Specification → Validation → Baseline → Traceability → Change management**

### 2.1 Requirements quality criteria

Each requirement and use case shall, as applicable, be:

- necessary;
- unambiguous;
- consistent;
- feasible;
- verifiable;
- traceable;
- sufficiently complete;
- independent of implementation decisions that are not architecturally mandatory.

### 2.2 Normative language

In this document:

- **SHALL** indicates a mandatory requirement.
- **SHALL NOT** indicates a mandatory prohibition.
- **MAY** indicates permitted but optional behavior.
- **OUT OF SCOPE** indicates behavior deliberately excluded from PLIEGO v1.

---

## 3. System context

PLIEGO is an e-commerce system specializing in the sale of physical books.

The approved architecture is:

```text
API client / Future frontend
            │
            │ HTTP + JSON
            ▼
       Spring Boot
            │
            │ Database API
            ▼
       PostgreSQL
            │
            ├── Stored Procedures
            ├── Functions
            ├── Triggers
            └── Constraints
```

### 3.1 Binding architectural principles

- Backend: **Java 25 + Spring Boot**.
- Database engine: **PostgreSQL**.
- Database evolution: **Flyway**.
- JPA and Hibernate shall not be used.
- Spring Boot shall access business operations through **JDBC Gateways**.
- Authoritative business logic shall reside in PostgreSQL.
- Controllers and Services shall not contain business SQL.
- The backend shall expose a versioned REST API under `/api/v1`.
- No frontend shall be implemented at this stage.
- The architecture shall not prevent a web or mobile frontend from later consuming the same API.
- Docker shall not be used.
- Git and GitHub shall be used for version control and collaboration.

---

## 4. PLIEGO v1 functional scope

### 4.1 Included

PLIEGO v1 includes:

- registration and authentication;
- `CUSTOMER` and `ADMIN` roles;
- customer profile;
- addresses;
- authors;
- publishers;
- categories and subcategories;
- books;
- editions;
- covers and license metadata;
- inventory per edition;
- inventory movements;
- cart;
- checkout;
- orders;
- status history;
- simulated academic payment;
- cancellation;
- logical refund of the simulated payment;
- REST API;
- OpenAPI documentation;
- Flyway migrations;
- minimal functional auditing through histories;
- GitHub and CI.

### 4.2 Out of scope

The following are excluded from PLIEGO v1:

- frontend;
- mobile application;
- multiple branches;
- multiple warehouses;
- suppliers and supplier purchases;
- stock reservations;
- eBooks;
- digital files;
- AI recommendations;
- wishlist;
- reviews;
- ratings;
- coupons;
- promotions;
- configurable taxes;
- shipping cost calculation;
- SRI integration;
- real payment gateway;
- carriers;
- logistics tracking;
- marketplace;
- microservices;
- Redis;
- Kafka/RabbitMQ;
- Docker;
- Kubernetes.

---

## 5. Frozen domain decisions

These decisions form part of the baseline and must not be modified implicitly during implementation.

| Topic | PLIEGO v1 decision |
|---|---|
| Libro and Edición | Distinct concepts |
| Commercial unit | **Edición** is the item sold |
| Price | Belongs to Edición |
| ISBN | Belongs to Edición |
| SKU | Belongs to Edición |
| Editorial | Belongs to Edición |
| Autor | Related to Libro N:M |
| Categoría | Related to Libro N:M |
| Categories | At most two levels |
| Inventario | One global inventory per Edición |
| Carrito | At most one `ACTIVE` cart per Cliente |
| Stock in cart | Not reserved |
| Price in cart | Current price |
| Price in order | Snapshot |
| Order address | Snapshot |
| Order bibliographic data | Snapshot |
| Pago | Simulated and synchronous |
| Payment attempts | One Pago per Pedido in v1 |
| Currency | USD |
| Discounts | None in v1 |
| Additional taxes | Not calculated in v1 |
| Shipping cost | 0 in v1 |
| Total | Equal to subtotal in v1 |
| Catalog deletion | Logical deletion by status |
| Inventory movements | Immutable |
| Order history | Mandatory |
| Initial admin | Provisioned through controlled configuration/migration with per-environment secrets (never in Git); not through public registration |

---

## 6. Actors

### ACT-01 — Visitor

Unauthenticated user.

Can:

- register;
- authenticate;
- browse the catalog;
- search for books;
- view edition details.

### ACT-02 — Customer

Authenticated user with the `CUSTOMER` role.

Inherits the Visitor's public capabilities and can also:

- manage their profile;
- manage their addresses;
- manage their cart;
- perform checkout;
- view their orders;
- cancel eligible orders.

### ACT-03 — Administrator

Authenticated user with the `ADMIN` role.

Can:

- manage authors;
- manage publishers;
- manage categories;
- manage books;
- manage editions;
- view inventory;
- record adjustments/receipts;
- set minimum stock;
- manage order statuses;
- view orders;
- block or unblock customer accounts.

---

## 7. Use case catalog

| ID | Use case | Primary actor |
|---|---|---|
| CU-AUTH-01 | Register customer | Visitor |
| CU-AUTH-02 | Authenticate user | Visitor |
| CU-ADM-SEC-01 | Manage customer status | Administrator |
| CU-CUS-01 | Manage profile | Customer |
| CU-CUS-02 | Manage addresses | Customer |
| CU-CAT-01 | Browse and search catalog | Visitor / Customer |
| CU-CAT-02 | View edition details | Visitor / Customer |
| CU-ADM-CAT-01 | Manage authors | Administrator |
| CU-ADM-CAT-02 | Manage publishers | Administrator |
| CU-ADM-CAT-03 | Manage categories | Administrator |
| CU-ADM-CAT-04 | Manage books | Administrator |
| CU-ADM-CAT-05 | Manage editions | Administrator |
| CU-INV-01 | View inventory | Administrator |
| CU-INV-02 | Record administrative inventory movement | Administrator |
| CU-INV-03 | Configure minimum stock | Administrator |
| CU-CART-01 | View cart | Customer |
| CU-CART-02 | Add edition to cart | Customer |
| CU-CART-03 | Change item quantity | Customer |
| CU-CART-04 | Remove item from cart | Customer |
| CU-SAL-01 | Perform checkout | Customer |
| CU-PAY-01 | Process simulated payment | System |
| CU-SAL-02 | View own orders | Customer |
| CU-SAL-03 | Cancel order | Customer |
| CU-ADM-SAL-01 | Manage orders | Administrator |

**Total: 24 use cases.**

---

# 8. Detailed use case specification

## CU-AUTH-01 — Register customer

**Objective:** Create a valid customer account for PLIEGO.  
**Primary actor:** Visitor.  
**Trigger:** The visitor requests account creation.

### Input data

- email;
- password;
- nombres;
- apellidos;
- optional phone number.

### Preconditions

- The actor does not need to be authenticated.
- The email must have a syntactically valid format.
- The password must comply with the backend's technical policy.

### Main flow

1. The Visitor submits the registration request.
2. Spring Boot validates the request's structure and format.
3. Spring Security generates a secure password hash.
4. PostgreSQL normalizes the email.
5. PostgreSQL verifies that no other Usuario has the same normalized email.
6. PostgreSQL creates the Usuario with role `CUSTOMER`.
7. PostgreSQL creates exactly one Cliente associated with the Usuario.
8. Usuario and Cliente are committed within the same transaction.
9. The system returns registration confirmation.

### Alternative flows

**A1 — Existing email**

1. PostgreSQL detects an already registered email.
2. The operation is rejected.
3. No Usuario is created.
4. No Cliente is created.

Domain result: `EMAIL_ALREADY_EXISTS`.

**A2 — Invalid data**

The operation is rejected without partial persistence.

### Success postconditions

- A Usuario exists.
- Exactly one associated Cliente exists.
- The Usuario has role `CUSTOMER`.
- The Usuario is in `ACTIVE` status.
- The password is never stored in plaintext.

### Related rules

- BR-SEC-001
- BR-SEC-002
- BR-CUS-001

### Affected entities

- Usuario
- Cliente

### Acceptance criteria

- Two users cannot have the same normalized email.
- A Cliente created by this case can never exist without its corresponding Usuario.
- If Cliente creation fails, Usuario creation must also be rolled back.

---

## CU-AUTH-02 — Authenticate user

**Objective:** Authenticate a registered, enabled Usuario.  
**Primary actor:** Visitor.

### Input

- email;
- password.

### Main flow

1. The Visitor supplies credentials.
2. PostgreSQL locates the Usuario by normalized email.
3. PostgreSQL verifies that the Usuario is `ACTIVE`.
4. Spring Security checks the supplied password against the stored hash.
5. If the password is valid, Spring Boot generates the application's stateless authentication mechanism (signed token, e.g. JWT; the REST/Security contract will define format, claims, and expiration).
6. The response identifies the Usuario's role.

### Alternative flows

- Nonexistent Usuario.
- Incorrect password.
- Blocked Usuario.

Externally, these scenarios may produce an invalid-authentication response without revealing unnecessary details.

### Postconditions

The commercial domain is not modified.

### Entities

- Usuario

---

## CU-ADM-SEC-01 — Manage customer status

**Objective:** Allow an Administrator to block or reactivate access to a customer account.  
**Actor:** Administrator.

### Preconditions

- Authenticated Administrator.
- The target Usuario must exist.
- The target Usuario must have role `CUSTOMER`.

### Main flow — Block

1. The Administrator selects a Cliente.
2. The system identifies the associated Usuario.
3. PostgreSQL changes `Usuario.estado` from `ACTIVE` to `BLOCKED`.
4. The operation is committed.

### Main flow — Reactivate

1. The Administrator selects a `BLOCKED` account.
2. PostgreSQL changes its status to `ACTIVE`.
3. The operation is committed.

### Rules

- A blocked Cliente cannot authenticate.
- Blocking does not delete historical data.
- Blocking does not delete the cart or orders.

### Entities

- Usuario
- Cliente

---

## CU-CUS-01 — Manage profile

**Objective:** View or modify the authenticated Cliente's basic data.  
**Actor:** Customer.

### Preconditions

- Authenticated Usuario.
- Usuario with role `CUSTOMER`.
- Associated Cliente.

### Permitted operations

- view nombres;
- view apellidos;
- view phone number;
- update nombres;
- update apellidos;
- update phone number.

### Out of scope

Email changes and password changes are not part of PLIEGO v1.

### Authorization rule

A Cliente can access only their own profile.

### Entities

- Usuario
- Cliente

---

## CU-CUS-02 — Manage addresses

**Objective:** Manage the Cliente's delivery addresses.  
**Actor:** Customer.

### Operations

- list;
- create;
- update;
- delete;
- set as primary.

### Minimum address data

- alias;
- recipient;
- address line 1;
- city;
- province;
- country (`PaisCodigo` ISO 3166-1 alpha-2, e.g. `EC`);
- phone number.

### Optional data

- address line 2;
- postal code;
- reference.

### Rules

1. A Cliente may have zero or more Direcciones.
2. At most one Dirección may be primary.
3. A Cliente may have no primary address.
4. A Dirección may be modified only by its owner.
5. Setting a Dirección as primary must unmark the previous one within the same transaction.
6. Deleting a Dirección does not modify historical orders.
7. A Dirección may be physically deleted because orders use independent snapshots.
8. If the selected Dirección does not exist or does not belong to the Cliente at the transactional instant of checkout, checkout is rejected with a domain error.

### Entities

- Cliente
- Direccion

---

## CU-CAT-01 — Browse and search catalog

**Objective:** Enable discovery of commercially available books and editions.  
**Actors:** Visitor, Customer.  
**Authentication:** Not required.

### Search parameters

- title text;
- author;
- ISBN;
- category.

### Filters

- category;
- minimum price;
- maximum price;
- language;
- format.

### Sorting

- title ascending;
- price ascending;
- price descending.

### Pagination

- default size: 20;
- maximum size: 50.

### Main flow

1. The actor requests the catalog with zero or more filters.
2. PostgreSQL obtains Libros and Ediciones matching the criteria.
3. They are considered commercially publishable only when `Libro.estado = ACTIVE` and `Edicion.estado = ACTIVE`. An `INACTIVE` Autor, Editorial, or Categoría does not hide or invalidate existing editions; it only prevents new associations.
4. Availability is determined from Inventario.
5. Sorting is applied.
6. Pagination is applied.
7. The system returns the requested page.

### Availability rule

An Edición with `stock_actual = 0` may appear in the catalog, but must be reported as unavailable.

### Minimum result

- editionId;
- bookId;
- title;
- authors;
- publisher;
- ISBN when present;
- price;
- cover;
- format;
- language;
- availability.

### Entities

- Libro
- Edicion
- Autor
- LibroAutor
- Categoria
- LibroCategoria
- Editorial
- Inventario

---

## CU-CAT-02 — View edition details

**Objective:** Show detailed bibliographic and commercial information for an Edición.  
**Actors:** Visitor, Customer.  
**Authentication:** Not required.

### Input

- Edición identifier.

### Result

- title;
- subtitle;
- synopsis;
- ordered authors;
- categories;
- publisher;
- ISBN;
- SKU;
- language;
- format;
- page count;
- publication date;
- current price;
- cover;
- cover license;
- cover source;
- attribution when applicable;
- availability.

### Rule

Administrative inventory information must not be exposed as part of public details.

### Entities

- Libro
- Edicion
- Autor
- LibroAutor
- Categoria
- LibroCategoria
- Editorial
- Inventario

---

## CU-ADM-CAT-01 — Manage authors

**Objective:** Maintain the Autores catalog.  
**Actor:** Administrator.

### Operations

- create;
- view;
- update;
- deactivate;
- reactivate.

### Data

- required name;
- optional biography;
- status.

### Rules

1. The Autor's name is not a unique key.
2. Two distinct authors may share a name.
3. No physical DELETE is performed.
4. An `INACTIVE` Autor cannot be associated with new Libros.
5. Deactivating an Autor does not delete historical `LibroAutor` relationships.

### Entities

- Autor
- LibroAutor

---

## CU-ADM-CAT-02 — Manage publishers

**Objective:** Maintain the Editoriales catalog.  
**Actor:** Administrator.

### Operations

- create;
- view;
- update;
- deactivate;
- reactivate.

### Rules

1. Name required.
2. No physical DELETE is performed.
3. An `INACTIVE` Editorial cannot be assigned to new Ediciones.
4. Deactivating an Editorial does not delete existing Ediciones.

### Entities

- Editorial
- Edicion

---

## CU-ADM-CAT-03 — Manage categories

**Objective:** Maintain the thematic classification of Libros.  
**Actor:** Administrator.

### Hierarchical model

PLIEGO v1 supports at most two levels:

```text
Root category
└── Subcategory
```

### Data

- name;
- slug;
- optional description;
- optional parent_id;
- status.

### Rules

1. A root category has `parent_id = NULL`.
2. A subcategory must point to a root category.
3. A subcategory cannot have children.
4. Cycles cannot exist.
5. `slug` must be unique.
6. No physical DELETE exists.
7. An `INACTIVE` Categoría cannot be assigned to new Libros.
8. Deactivating a category does not delete `LibroCategoria`.

### Entities

- Categoria
- LibroCategoria

---

## CU-ADM-CAT-04 — Manage books

**Objective:** Maintain the intellectual works available in the catalog.  
**Actor:** Administrator.

### Required creation data

- title;
- at least one Autor;
- at least one Categoría.

### Optional data

- subtitle;
- synopsis.

### Creation flow

1. The Administrator supplies Libro data.
2. PostgreSQL validates that all Autores exist and are `ACTIVE`.
3. PostgreSQL validates that all Categorías exist and are `ACTIVE`.
4. PostgreSQL creates the Libro.
5. PostgreSQL creates the `LibroAutor` associations.
6. PostgreSQL records authorship order.
7. PostgreSQL creates the `LibroCategoria` associations.
8. The entire operation is committed atomically.

### Subsequent operations

- update metadata;
- change authors;
- change authorship order;
- change categories;
- deactivate;
- reactivate.

### Rules

1. An `ACTIVE` Libro must have at least one Autor.
2. An `ACTIVE` Libro must have at least one Categoría.
3. No physical DELETE exists.
4. Deactivating the Libro does not delete Ediciones.
5. If the Libro is `INACTIVE`, none of its Ediciones may be published commercially even if the Edición is `ACTIVE`.

### Entities

- Libro
- Autor
- LibroAutor
- Categoria
- LibroCategoria

---

## CU-ADM-CAT-05 — Manage editions

**Objective:** Maintain specific commercial versions of Libros.  
**Actor:** Administrator.

### Required data

- Libro;
- Editorial;
- SKU;
- language;
- format;
- page count;
- price.

### Optional data

- ISBN-13;
- publication date;
- cover and associated metadata.

### Permitted formats

- `PAPERBACK`;
- `HARDCOVER`.

### ISBN rules

If ISBN is provided:

1. it must contain 13 digits;
2. it must have a valid ISBN-13 checksum;
3. it must be unique among Ediciones.

### SKU rules

- required;
- unique;
- stable after creation.

### Commercial rules

- price > 0;
- page count > 0;
- the Editorial must be `ACTIVE` when creating the Edición and when reassigning it;
- the Libro must exist (it may be `INACTIVE`; publishability requires both to be `ACTIVE` under BR-CAT-010);
- the Edición uses USD currency.

### Cover

When a cover exists, the following may be recorded:

- `cover_url`;
- `cover_license`;
- `cover_source_url`;
- `cover_attribution`.

If a cover is recorded, its license and source must be identified.

### Inventory creation

When creating an Edición:

1. PostgreSQL creates the Edición.
2. PostgreSQL automatically creates its Inventario.
3. `stock_actual = 0`.
4. `stock_minimo = 0`.
5. Edición and Inventario form an atomic operation.

### Subsequent operations

- correct metadata;
- change price;
- update cover;
- deactivate;
- reactivate.

### Stable identity

After creation:

- the association with Libro is not changed;
- the SKU is not changed.

If another commercial edition needs to be represented, a distinct Edición is created.

### Entities

- Libro
- Editorial
- Edicion
- Inventario

---

## CU-INV-01 — View inventory

**Objective:** Allow the Administrator to know stock levels and traceability.  
**Actor:** Administrator.

### Summary information

- edition;
- SKU;
- ISBN;
- title;
- current stock;
- minimum stock;
- low-stock indicator;
- Edición status.

### Low-stock definition

`bajo_stock = stock_minimo > 0 AND stock_actual <= stock_minimo`

(`stock_minimo = 0` means "no threshold": a newly created edition with `0/0` does not start in low-stock status.)

### Filters

- edition;
- title;
- SKU;
- low stock only.

### History

The Administrator may view the Movimientos de Inventario associated with an Edición.

### Entities

- Inventario
- MovimientoInventario
- Edicion
- Libro

---

## CU-INV-02 — Record administrative inventory movement

**Objective:** Modify stock levels explicitly and traceably.  
**Actor:** Administrator.

### Permitted administrative types

- `ENTRY`;
- `ADJUSTMENT_IN`;
- `ADJUSTMENT_OUT`.

### System-reserved types

- `SALE`;
- `CANCELLATION`.

### Movement data

- Inventario;
- type;
- quantity;
- previous stock;
- resulting stock;
- reason;
- date;
- responsible user when applicable.

### Rules

1. `cantidad` is stored as a positive value.
2. The Tipo determines whether the operation adds or subtracts.
3. Resulting stock can never be negative.
4. Every committed stock change must have a MovimientoInventario.
5. MovimientoInventario is immutable.
6. A committed movement is neither edited nor deleted.
7. Errors are corrected through a compensating movement.

### Entities

- Inventario
- MovimientoInventario
- Usuario

---

## CU-INV-03 — Configure minimum stock

**Objective:** Define an Edición's low-inventory threshold.  
**Actor:** Administrator.

### Input

- edition;
- new `stock_minimo`.

### Rules

- `stock_minimo >= 0`.
- Changing minimum stock does not modify current stock.
- It does not generate a MovimientoInventario because it does not represent a stock variation.

### Entities

- Inventario

---

## CU-CART-01 — View cart

**Objective:** View the Cliente's active cart.  
**Actor:** Customer.

### Preconditions

Authenticated and enabled Cliente.

### Rules

1. A Cliente may have multiple historical Carritos.
2. At most one may be `ACTIVE`.
3. If no active cart exists, a conceptually empty cart is returned without necessarily creating a physical row.
4. Displayed prices correspond to each Edición's current price.
5. The cart does not constitute an inventory reservation.
6. Items whose Edición or Libro has become `INACTIVE` remain displayed, marked unavailable; checkout rejects them.
7. Adding targets `editionId`; modifying/deleting targets the item identifier within the Cliente's cart.

### Result

- items;
- quantity;
- current price;
- subtotal per item;
- current total.

### Entities

- Cliente
- Carrito
- CarritoItem
- Edicion

---

## CU-CART-02 — Add edition to cart

**Objective:** Add a marketable Edición to the active cart.  
**Actor:** Customer.

### Input

- editionId;
- quantity.

### Preconditions

- `ACTIVE` Cliente;
- quantity > 0.

### Main flow

1. PostgreSQL locates the `ACTIVE` Carrito.
2. If none exists, it creates one.
3. PostgreSQL verifies that the Edición exists.
4. Verifies `Edicion.estado = ACTIVE`.
5. Verifies `Libro.estado = ACTIVE`.
6. Queries Inventario.
7. Validates that the total requested quantity does not exceed `stock_actual`.
8. If the Edición is not in the cart, creates a CarritoItem.
9. If it already exists, increments its quantity.
10. Commits the operation.

### Rules

- The same Edición appears only once per Carrito.
- Conceptual constraint: `UNIQUE(carrito_id, edicion_id)`.
- Adding to the cart does not reserve stock.
- Availability is validated again during checkout.

### Alternatives

- Nonexistent Edición.
- Inactive Libro.
- Inactive Edición.
- Invalid quantity.
- Insufficient stock.

### Entities

- Carrito
- CarritoItem
- Libro
- Edicion
- Inventario

---

## CU-CART-03 — Change item quantity

**Objective:** Change the requested quantity for an Edición already in the cart.  
**Actor:** Customer.

### Input

- CarritoItem identifier;
- new quantity.

### Rules

- new quantity > 0;
- new quantity <= stock_actual;
- the Carrito must be `ACTIVE`;
- the Carrito must belong to the authenticated Cliente.

Zero quantity does **not** mean deletion. Deletion uses CU-CART-04.

### Entities

- Carrito
- CarritoItem
- Inventario

---

## CU-CART-04 — Remove item from cart

**Objective:** Remove an Edición from the active cart.  
**Actor:** Customer.

### Rules

- the Carrito must belong to the Cliente;
- the Carrito must be `ACTIVE`;
- the CarritoItem may be physically deleted;
- deleting the last item does not delete the Carrito;
- the Carrito remains `ACTIVE` and empty.

### Entities

- Carrito
- CarritoItem

---

## CU-SAL-01 — Perform checkout

**Objective:** Convert an active Carrito into a consistent purchase.  
**Actor:** Customer.  
**Included case:** `<<include>> CU-PAY-01 Procesar pago simulado`.

### Input

- Dirección identifier;
- supported payment method.

### Preconditions

- authenticated Cliente;
- `ACTIVE` Cliente;
- `ACTIVE` Carrito;
- Carrito with at least one item;
- existing Dirección;
- Dirección belonging to the Cliente.

### Main flow

1. PostgreSQL obtains the Cliente's `ACTIVE` Carrito.
2. PostgreSQL locks the resources needed to prevent inconsistent concurrent checkout.
3. Verifies that the cart contains at least one CarritoItem.
4. Obtains all involved Ediciones.
5. Validates again that each Libro is `ACTIVE`.
6. Validates again that each Edición is `ACTIVE`.
7. Obtains current prices.
8. Obtains and locks the involved Inventarios.
9. Verifies sufficient stock for each item.
10. Calculates each item's subtotal.
11. Calculates the Pedido subtotal.
12. Sets `total = subtotal`.
13. Creates the Pedido in `PENDING_PAYMENT` status.
14. Records the first PedidoEstadoHistorial.
15. Creates a PedidoItem for each cart item.
16. Copies commercial snapshots to PedidoItem.
17. Copies the selected Dirección to PedidoDireccion.
18. Creates a `PENDING` Pago.
19. Includes CU-PAY-01.

### Result if payment is approved

20. Pago changes to `APPROVED`.
21. PostgreSQL deducts Inventario.
22. A `SALE` MovimientoInventario is recorded for each modification.
23. Pedido changes to `CONFIRMED`.
24. PedidoEstadoHistorial is recorded.
25. Carrito changes to `CHECKED_OUT`.
26. The transaction is committed.

### Result if payment is rejected

20. Pago changes to `REJECTED`.
21. Pedido changes to `CANCELLED`.
22. PedidoEstadoHistorial is recorded.
23. Inventario is not deducted.
24. Carrito remains `ACTIVE`.
25. The transaction commits the rejected commercial outcome.

### Technical failure

If a technical error prevents a consistent commercial state from being produced, the entire operation is rolled back.

### Atomicity rules

A committed result must never exist with:

- a `CONFIRMED` Pedido without stock deduction;
- deducted stock without a `CONFIRMED` Pedido;
- a `SALE` MovimientoInventario without its stock decrease;
- a Pedido without PedidoItem;
- a Pedido without PedidoDireccion;
- a Pedido without Pago.

### Concurrency rule

When two checkouts compete for the last units, only those for which sufficient stock exists may commit. Stock can never become negative.

The Database API Contract will define lock order (cart/order and inventories sorted by `EdicionId`) and the loser's domain error code. Transaction demarcation resides in Spring Boot (Service/Gateway); business atomicity resides in the PostgreSQL routine, which executes each operation in a single transaction.

### Entities

- Cliente
- Direccion
- Carrito
- CarritoItem
- Libro
- Edicion
- Inventario
- MovimientoInventario
- Pedido
- PedidoItem
- PedidoDireccion
- PedidoEstadoHistorial
- Pago

---

## CU-PAY-01 — Process simulated payment

**Objective:** Allow academic completion of the purchase cycle without integrating an external gateway.  
**Actor:** System.  
**Initiating actor:** CU-SAL-01.

### Preconditions

- a `PENDING_PAYMENT` Pedido exists;
- a `PENDING` Pago exists;
- Pago amount = Pedido total.

### Supported methods in v1

- `CARD`;
- `TRANSFER`.

### Main flow — Approved

1. The simulator processes the academic attempt.
2. Produces an `APPROVED` result.
3. A simulated payment reference is assigned.
4. Control returns to checkout.

### Alternative flow — Rejected

1. The simulator produces `REJECTED`.
2. The corresponding academic reference or reason is recorded.
3. Control returns to checkout.

### Rules

- CVV is not stored.
- The full card number is not stored.
- The simulator does not represent a real financial gateway.
- The processed amount must match the Pedido total.
- The result (`APPROVED`/`REJECTED`) must be deterministic and controllable from checkout for academic and testing purposes (the Database API Contract will define the parameter); never unseeded random behavior.

### Entities

- Pedido
- Pago

---

## CU-SAL-02 — View own orders

**Objective:** Allow the Cliente to view their commercial history.  
**Actor:** Customer.

### Operations

- list orders;
- view details.

### Minimum summary

- orderId;
- date;
- status;
- total;
- payment status.

### Minimum details

- items with snapshot;
- address snapshot;
- Pago;
- status history.

### Authorization rule

A Cliente may view only their own Pedidos.

### Entities

- Pedido
- PedidoItem
- PedidoDireccion
- Pago
- PedidoEstadoHistorial

---

## CU-SAL-03 — Cancel order

**Objective:** Cancel a Pedido while its status still permits commercial reversal.  
**Actor:** Owning customer.

### Cancellable statuses

- `CONFIRMED`;
- `PREPARING`.

### Non-cancellable statuses

- `PENDING_PAYMENT` (no post-commit observable Pedido has this status; the guard exists for completeness);
- `SHIPPED`;
- `DELIVERED`;
- `CANCELLED`.

### Main flow

1. PostgreSQL locks the Pedido.
2. Verifies ownership.
3. Verifies that the status permits cancellation.
4. Changes Pedido to `CANCELLED`.
5. For each PedidoItem, restores the purchased quantity to Inventario.
6. For each restoration, creates a `CANCELLATION` MovimientoInventario.
7. If Pago is `APPROVED`, changes it to `REFUNDED`.
8. Records PedidoEstadoHistorial.
9. Commits the transaction.

### Rules

- The Pedido is not deleted.
- The Pago is not deleted.
- PedidoItem records are not deleted.
- Inventory restoration and the change to `CANCELLED` are atomic.
- The payment refund is simulated in v1.

### Entities

- Pedido
- PedidoItem
- Pago
- Inventario
- MovimientoInventario
- PedidoEstadoHistorial

---

## CU-ADM-SAL-01 — Manage orders

**Objective:** Allow the Administrator to view and advance the Pedidos logistics flow.  
**Actor:** Administrator.

### Queries

- all orders;
- by status;
- by date range;
- by customer;
- details;
- history.

### Permitted administrative transitions

```text
CONFIRMED -> PREPARING
PREPARING -> SHIPPED
SHIPPED -> DELIVERED

CONFIRMED -> CANCELLED
PREPARING -> CANCELLED
```

### Prohibited transitions

Examples:

```text
CONFIRMED -> DELIVERED
SHIPPED -> PREPARING
DELIVERED -> CANCELLED
CANCELLED -> CONFIRMED
```

### History rule

Every committed transition generates PedidoEstadoHistorial with:

- order;
- previous status;
- new status;
- date;
- origin (`USER` or `SYSTEM`);
- acting Usuario when origin is `USER` (absent in automatic checkout transitions, e.g. payment resolution).

### Administrative cancellation

When the Administrator moves a Pedido from `CONFIRMED` or `PREPARING` to `CANCELLED`, the same inventory-restoration and simulated-refund rules defined in CU-SAL-03 must apply.

The transition to `CANCELLED` with effects (restoration + refund) belongs to a single routine (`sp_order_cancel`); `sp_order_change_status` does not implement `CANCELLED` and rejects it.

### Entities

- Pedido
- PedidoEstadoHistorial
- PedidoItem
- Inventario
- MovimientoInventario
- Pago
- Usuario

---

# 9. Consolidated business rules

## 9.1 Security and identity

| ID | Rule |
|---|---|
| BR-SEC-001 | The Usuario's normalized email must be unique. |
| BR-SEC-002 | The password must never be persisted in plaintext. |
| BR-SEC-003 | Only an `ACTIVE` Usuario may authenticate. |
| BR-SEC-004 | Only ADMIN may execute administrative operations. |
| BR-SEC-005 | A CUSTOMER may operate only on their own resources. |

## 9.2 Cliente

| ID | Rule |
|---|---|
| BR-CUS-001 | Every Usuario with role CUSTOMER must have exactly one Cliente. |
| BR-CUS-002 | A Cliente may have zero or more Direcciones. |
| BR-CUS-003 | At most one Dirección per Cliente may be primary. |

## 9.3 Catalog

| ID | Rule |
|---|---|
| BR-CAT-001 | Every Libro must have a title. |
| BR-CAT-002 | An ACTIVE Libro must have at least one Autor. |
| BR-CAT-003 | An ACTIVE Libro must have at least one Categoría. |
| BR-CAT-004 | An Edición belongs to exactly one Libro. |
| BR-CAT-005 | An Edición belongs to exactly one Editorial. |
| BR-CAT-006 | SKU is required and unique. |
| BR-CAT-007 | ISBN-13, when present, must be valid and unique. |
| BR-CAT-008 | Edición price > 0. |
| BR-CAT-009 | Page count > 0. |
| BR-CAT-010 | An Edición is publishable only if Libro and Edición are ACTIVE. |
| BR-CAT-011 | A Libro has an N:M relationship with Autor. |
| BR-CAT-012 | A Libro has an N:M relationship with Categoría. |
| BR-CAT-013 | Categories have at most two levels. |
| BR-CAT-014 | A subcategory cannot have descendants. |
| BR-CAT-015 | Authorship order must be preserved. |

## 9.4 Inventario

| ID | Rule |
|---|---|
| BR-INV-001 | Each Edición has exactly one Inventario in v1. |
| BR-INV-002 | stock_actual >= 0 always. |
| BR-INV-003 | stock_minimo >= 0. |
| BR-INV-004 | Every committed stock change generates MovimientoInventario. |
| BR-INV-005 | MovimientoInventario is immutable. |
| BR-INV-006 | SALE may be generated only by the checkout process. |
| BR-INV-007 | CANCELLATION may be generated only by cancelling a previously confirmed Pedido. |

## 9.5 Carrito

| ID | Rule |
|---|---|
| BR-CART-001 | A Cliente may have at most one ACTIVE Carrito. |
| BR-CART-002 | CarritoItem quantity must be > 0. |
| BR-CART-003 | The (Carrito, Edición) pair is unique. |
| BR-CART-004 | A non-marketable Edición cannot be added. |
| BR-CART-005 | Adding to the cart does not reserve stock. |
| BR-CART-006 | Checkout revalidates stock and price. |

## 9.6 Pedido

| ID | Rule |
|---|---|
| BR-ORD-001 | Checkout operates only on a nonempty ACTIVE Carrito. |
| BR-ORD-002 | A persisted Pedido must have at least one PedidoItem. |
| BR-ORD-003 | Pedido has exactly one PedidoDireccion in v1. |
| BR-ORD-004 | Pedido has exactly one Pago in v1. |
| BR-ORD-005 | PedidoItem preserves commercial snapshots. |
| BR-ORD-006 | PedidoDireccion preserves an independent snapshot. |
| BR-ORD-007 | Committed checkout and inventory deduction are atomic. |
| BR-ORD-008 | Every Pedido transition generates history. |
| BR-ORD-009 | Only transitions defined by the state machine are allowed. |
| BR-ORD-010 | total = subtotal in PLIEGO v1. |
| BR-ORD-011 | PLIEGO v1 currency is USD. |

## 9.7 Pago

| ID | Rule |
|---|---|
| BR-PAY-001 | Pago amount must equal Pedido total. |
| BR-PAY-002 | Pedido cannot remain CONFIRMED without APPROVED Pago. |
| BR-PAY-003 | APPROVED Pago may transition only to REFUNDED. |
| BR-PAY-004 | A Pedido cancelled after approval must reflect REFUNDED Pago. |
| BR-PAY-005 | PLIEGO does not persist CVV or the full card number. |

---

# 10. State machines

## 10.1 Usuario

```text
ACTIVE <-> BLOCKED
```

Physical deletion of Usuario is not defined in v1.

## 10.2 Libro, Edición, Autor, Editorial, and Categoría

```text
ACTIVE <-> INACTIVE
```

## 10.3 Carrito

```text
ACTIVE -> CHECKED_OUT
```

`CHECKED_OUT` is final in v1.

`CANCELLED` is outside the Carrito domain in PLIEGO v1 (DD-COR-003): no use case produces it.

## 10.4 Pedido

```text
PENDING_PAYMENT
      │
      ├──> CONFIRMED -> PREPARING -> SHIPPED -> DELIVERED
      │         │           │
      │         └──────────> CANCELLED
      │                     ▲
      │                     │
      └--------------------> CANCELLED
```

| Current status | Permitted next status |
|---|---|
| PENDING_PAYMENT | CONFIRMED, CANCELLED |
| CONFIRMED | PREPARING, CANCELLED |
| PREPARING | SHIPPED, CANCELLED |
| SHIPPED | DELIVERED |
| DELIVERED | None |
| CANCELLED | None |

`PENDING_PAYMENT` is transient and intra-transactional within CU-SAL-01: it is created and resolved to `CONFIRMED` or `CANCELLED` in the same transaction, so no post-commit observable Pedido remains `PENDING_PAYMENT`. Each committed checkout persists two history records: the initial (`NULL -> PENDING_PAYMENT`, `SYSTEM`) and terminal (`PENDING_PAYMENT -> CONFIRMED` or `PENDING_PAYMENT -> CANCELLED`, `SYSTEM`).

## 10.5 Pago

```text
PENDING -> APPROVED -> REFUNDED
       \-> REJECTED
```

`REJECTED` and `REFUNDED` are final.

---

# 11. Deletion policy

| Entity | Policy |
|---|---|
| Usuario | Not physically deleted |
| Cliente | Not physically deleted |
| Direccion | Physical DELETE allowed |
| Autor | ACTIVE/INACTIVE status |
| Editorial | ACTIVE/INACTIVE status |
| Categoria | ACTIVE/INACTIVE status |
| Libro | ACTIVE/INACTIVE status |
| LibroAutor | Updatable association; relationship DELETE allowed |
| LibroCategoria | Updatable association; relationship DELETE allowed |
| Edicion | ACTIVE/INACTIVE status |
| Inventario | Not deleted |
| MovimientoInventario | Never deleted |
| Carrito | Not deleted |
| CarritoItem | Physical DELETE allowed |
| Pedido | Never deleted |
| PedidoItem | Never deleted |
| PedidoDireccion | Never deleted |
| Pago | Never deleted |
| PedidoEstadoHistorial | Never deleted |

---

# 12. Derived domain entities

The baseline justifies the following persistent entities:

1. Usuario
2. Cliente
3. Direccion
4. Autor
5. Editorial
6. Categoria
7. Libro
8. LibroAutor
9. LibroCategoria
10. Edicion
11. Inventario
12. MovimientoInventario
13. Carrito
14. CarritoItem
15. Pedido
16. PedidoItem
17. PedidoDireccion
18. Pago
19. PedidoEstadoHistorial

Adding a new persistent entity to the ERD is not authorized without a justifying use case, requirement, business rule, or formal change.

---

# 13. Derived conceptual cardinalities

```text
Usuario 1 -------- 0..1 Cliente
Cliente 1 -------- 0..N Direccion

Libro N ---------- M Autor
Libro N ---------- M Categoria

Categoria 0..1 --- 0..N Categoria
(maximum depth = 2)

Libro 1 ----------- 0..N Edicion
Editorial 1 ------- 0..N Edicion

Edicion 1 --------- 1 Inventario
Inventario 1 ------ 0..N MovimientoInventario

Cliente 1 --------- 0..N Carrito
Carrito 1 --------- 0..N CarritoItem
Edicion 1 --------- 0..N CarritoItem

Cliente 1 --------- 0..N Pedido
Pedido 1 ---------- 1..N PedidoItem
Edicion 1 --------- 0..N PedidoItem

Pedido 1 ---------- 1 PedidoDireccion
Pedido 1 ---------- 1 Pago
Pedido 1 ---------- 1..N PedidoEstadoHistorial
```

### Additional constraints

- CUSTOMER Usuario → exactly 1 Cliente.
- At most one ACTIVE Carrito per Cliente.
- `UNIQUE(Carrito, Edicion)`.
- Edición → exactly 1 Inventario.
- Pedido generated by checkout → exactly 1 Pago.
- Every Pedido must record at least its initial status in PedidoEstadoHistorial.
- `Pedido.Subtotal > 0` and `Pedido.Total > 0` (derived: at least one item with quantity and price > 0).
- `Pago.Monto > 0` (derived: `Monto = Total`).
- `UNIQUE(Pedido, Edicion)` in PedidoItem.

---

# 14. Mandatory snapshots

## 14.1 PedidoItem

Must preserve at least:

- `edicion_id` as a historical reference;
- `sku_snapshot`;
- `isbn_snapshot`;
- `titulo_snapshot`;
- `autores_snapshot`;
- `editorial_snapshot`;
- `formato_snapshot`;
- `idioma_snapshot` (Edición language at checkout);
- `precio_unitario`;
- `cantidad`;
- `subtotal`.

Snapshots are the Pedido's historical source. Later catalog changes cannot alter historical content.

## 14.2 PedidoDireccion

Must preserve at least:

- recipient;
- address line 1;
- address line 2;
- city;
- province;
- country (`PaisCodigo` ISO 3166-1 alpha-2);
- postal code when present;
- reference;
- phone number.

The alias is not copied to the snapshot (a convenience label for the Cliente). Modifying or deleting a Cliente's Dirección does not alter PedidoDireccion.

---

# 15. Consolidated functional requirements

## Identity and customers

- RF-AUTH-001 Register a CUSTOMER account.
- RF-AUTH-002 Prevent duplicate emails.
- RF-AUTH-003 Authenticate users.
- RF-AUTH-004 Distinguish CUSTOMER and ADMIN.
- RF-SEC-001 Allow ADMIN to block/reactivate Clientes.
- RF-CUS-001 View/modify own profile.
- RF-CUS-002 Manage own addresses.

## Catalog

- RF-CAT-001 Browse public catalog.
- RF-CAT-002 Search by title.
- RF-CAT-003 Search by author.
- RF-CAT-004 Search by ISBN.
- RF-CAT-005 Filter by category.
- RF-CAT-006 Filter by price, language, and format.
- RF-CAT-007 Paginate results.
- RF-CAT-008 View Edición details.
- RF-CAT-009 Manage Autores.
- RF-CAT-010 Manage Editoriales.
- RF-CAT-011 Manage Categorías.
- RF-CAT-012 Manage Libros.
- RF-CAT-013 Manage Ediciones.

## Inventory

- RF-INV-001 Maintain independent inventory per Edición.
- RF-INV-002 View inventory.
- RF-INV-003 Record receipts.
- RF-INV-004 Record adjustments.
- RF-INV-005 Prevent negative stock.
- RF-INV-006 Maintain movement history.
- RF-INV-007 Configure minimum stock.

## Cart

- RF-CART-001 View active cart.
- RF-CART-002 Add Edición.
- RF-CART-003 Change quantity.
- RF-CART-004 Remove item.
- RF-CART-005 Maintain at most one ACTIVE cart per Cliente.

## Sales and orders

- RF-ORD-001 Perform checkout.
- RF-ORD-002 Revalidate status, price, and stock during checkout.
- RF-ORD-003 Deduct stock transactionally.
- RF-ORD-004 Preserve purchase snapshots.
- RF-ORD-005 View own order history.
- RF-ORD-006 View order details.
- RF-ORD-007 Control status transitions.
- RF-ORD-008 Allow administrative logistics management.
- RF-ORD-009 Allow cancellation in valid statuses.
- RF-ORD-010 Restore inventory during valid cancellation.
- RF-ORD-011 Maintain status history.

## Payment

- RF-PAY-001 Create Pago associated with Pedido.
- RF-PAY-002 Process academic APPROVED/REJECTED result.
- RF-PAY-003 Reflect REFUNDED on a cancellation after approval.
- RF-PAY-004 Do not store sensitive card data.
- RF-PAY-005 Maintain exactly one Pago per Pedido in v1.

---

# 16. Binding nonfunctional requirements

| ID | Category | Requirement |
|---|---|---|
| RNF-001 | Integrity | A transactional operation must not leave partial persistence. |
| RNF-002 | Concurrency | Concurrent checkouts cannot produce negative stock or overselling. |
| RNF-003 | Security | Passwords never in plaintext. |
| RNF-004 | Security | Administrative operations require ADMIN. |
| RNF-005 | Authorization | CUSTOMER does not access another Cliente's resources. |
| RNF-006 | Maintainability | Database changes through Flyway. |
| RNF-007 | Architecture | Controller -> Service -> Gateway separation. |
| RNF-008 | Architecture | No JPA/Hibernate. |
| RNF-009 | Architecture | Controllers/Services without business SQL. |
| RNF-010 | Interoperability | REST API with JSON. |
| RNF-011 | Evolution | Backend independent of the future frontend. |
| RNF-012 | Traceability | Every stock change has a MovimientoInventario. |
| RNF-013 | Testability | Critical SPs/functions must test successful and failing paths. |
| RNF-014 | Configuration | Secrets are not stored in Git. |
| RNF-015 | Performance | Catalog always paginated. |
| RNF-016 | Accuracy | Money uses exact decimal types. |
| RNF-017 | Traceability | Every Pedido transition has history. |

---

# 17. Relationships between use cases

### `<<include>>`

- CU-SAL-01 **includes** CU-PAY-01.

### Rule reuse

- CU-SAL-03 and administrative cancellation in CU-ADM-SAL-01 use the same inventory-reversal and simulated-refund rules.
- CU-CART-02 and CU-CART-03 use the same availability authority: Inventario.
- CU-CAT-01 and CU-CAT-02 use the same commercial-publication condition.

No `<<extend>>` relationships are introduced in v1 because they add no clarity to the current domain.

---

# 18. Use case → entities matrix

| Use case | Main entities |
|---|---|
| CU-AUTH-01 | Usuario, Cliente |
| CU-AUTH-02 | Usuario |
| CU-ADM-SEC-01 | Usuario, Cliente |
| CU-CUS-01 | Usuario, Cliente |
| CU-CUS-02 | Cliente, Direccion |
| CU-CAT-01 | Libro, Edicion, Autor, LibroAutor, Categoria, LibroCategoria, Editorial, Inventario |
| CU-CAT-02 | Libro, Edicion, Autor, LibroAutor, Categoria, LibroCategoria, Editorial, Inventario |
| CU-ADM-CAT-01 | Autor, LibroAutor |
| CU-ADM-CAT-02 | Editorial, Edicion |
| CU-ADM-CAT-03 | Categoria, LibroCategoria |
| CU-ADM-CAT-04 | Libro, Autor, LibroAutor, Categoria, LibroCategoria |
| CU-ADM-CAT-05 | Libro, Editorial, Edicion, Inventario |
| CU-INV-01 | Inventario, MovimientoInventario, Edicion, Libro |
| CU-INV-02 | Inventario, MovimientoInventario, Usuario |
| CU-INV-03 | Inventario |
| CU-CART-01 | Cliente, Carrito, CarritoItem, Edicion |
| CU-CART-02 | Carrito, CarritoItem, Libro, Edicion, Inventario |
| CU-CART-03 | Carrito, CarritoItem, Inventario |
| CU-CART-04 | Carrito, CarritoItem |
| CU-SAL-01 | Cliente, Direccion, Carrito, CarritoItem, Libro, Edicion, Inventario, MovimientoInventario, Pedido, PedidoItem, PedidoDireccion, Pago, PedidoEstadoHistorial |
| CU-PAY-01 | Pedido, Pago |
| CU-SAL-02 | Pedido, PedidoItem, PedidoDireccion, Pago, PedidoEstadoHistorial |
| CU-SAL-03 | Pedido, PedidoItem, Pago, Inventario, MovimientoInventario, PedidoEstadoHistorial |
| CU-ADM-SAL-01 | Pedido, PedidoItem, Pago, Inventario, MovimientoInventario, PedidoEstadoHistorial, Usuario |

---

# 19. Main traceability matrix

| Requirement | Use case(s) |
|---|---|
| RF-AUTH-001 | CU-AUTH-01 |
| RF-AUTH-002 | CU-AUTH-01 |
| RF-AUTH-003 | CU-AUTH-02 |
| RF-AUTH-004 | CU-AUTH-01, CU-AUTH-02 |
| RF-SEC-001 | CU-ADM-SEC-01 |
| RF-CUS-001 | CU-CUS-01 |
| RF-CUS-002 | CU-CUS-02 |
| RF-CAT-001..008 | CU-CAT-01, CU-CAT-02 |
| RF-CAT-009 | CU-ADM-CAT-01 |
| RF-CAT-010 | CU-ADM-CAT-02 |
| RF-CAT-011 | CU-ADM-CAT-03 |
| RF-CAT-012 | CU-ADM-CAT-04 |
| RF-CAT-013 | CU-ADM-CAT-05 |
| RF-INV-001..007 | CU-INV-01, CU-INV-02, CU-INV-03, CU-SAL-01, CU-SAL-03 |
| RF-CART-001 | CU-CART-01 |
| RF-CART-002 | CU-CART-02 |
| RF-CART-003 | CU-CART-03 |
| RF-CART-004 | CU-CART-04 |
| RF-CART-005 | CU-CART-01, CU-CART-02 |
| RF-ORD-001..004 | CU-SAL-01 |
| RF-ORD-005..006 | CU-SAL-02 |
| RF-ORD-007 | CU-SAL-03, CU-ADM-SAL-01 |
| RF-ORD-008 | CU-ADM-SAL-01 |
| RF-ORD-009..010 | CU-SAL-03, CU-ADM-SAL-01 |
| RF-ORD-011 | CU-SAL-01, CU-SAL-03, CU-ADM-SAL-01 |
| RF-PAY-001..005 | CU-SAL-01, CU-PAY-01, CU-SAL-03, CU-ADM-SAL-01 |

---

# 20. Preliminary Database API functional surface

This section **does not yet define SQL signatures**. Its purpose is to demonstrate that the use cases can be implemented and prepare the next stage.

```text
AUTH
  sp_customer_register
  fn_user_auth_data
  sp_customer_set_status

CUSTOMER
  fn_customer_profile
  sp_customer_update
  fn_address_list
  sp_address_create
  sp_address_update
  sp_address_delete
  sp_address_set_primary

CATALOG
  fn_catalog_search
  fn_edition_detail

ADMIN CATALOG
  sp_author_create
  sp_author_update
  sp_author_set_status

  sp_publisher_create
  sp_publisher_update
  sp_publisher_set_status

  sp_category_create
  sp_category_update
  sp_category_set_status

  sp_book_create
  sp_book_update
  sp_book_set_status

  sp_edition_create
  sp_edition_update
  sp_edition_set_status

INVENTORY
  fn_inventory_search
  fn_inventory_movements
  sp_inventory_entry
  sp_inventory_adjust
  sp_inventory_set_minimum

CART
  fn_cart_get
  sp_cart_add_item
  sp_cart_update_item
  sp_cart_remove_item

SALES
  sp_checkout
  fn_customer_orders
  fn_customer_order_detail
  sp_order_cancel
  fn_admin_orders
  fn_admin_order_detail
  sp_order_change_status
```

`sp_order_cancel` is the only routine that transitions to `CANCELLED` with effects; `sp_order_change_status` covers only logistics advancement (`CONFIRMED -> PREPARING -> SHIPPED -> DELIVERED`), and `sp_inventory_adjust` covers `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` (initial receipt uses `sp_inventory_entry`).

Parameter, return, SQLSTATE, and transactional contract definitions belong to the **Database API Contract** document following the logical ERD.

---

# 21. Entities explicitly excluded from the v1 ERD

The v1 ERD shall not include the following without formal approval:

- Bodega;
- Sucursal;
- Proveedor;
- CompraProveedor;
- ReservaStock;
- Wishlist;
- Reseña;
- Rating;
- Cupon;
- Promocion;
- Impuesto;
- Envio;
- Transportista;
- FacturaSRI;
- ArchivoDigital;
- Ebook;
- MarketplaceSeller;
- Outbox;
- Sesion;
- persisted RefreshToken;
- PrecioHistorico.

Their absence is deliberate and prevents over-modeling.

---

# 22. Definition of Ready for implementation

A use case may be handed to Codex/Claude only when the following exist:

1. use case ID;
2. associated requirements;
3. business rules;
4. affected entities;
5. preconditions;
6. main flow;
7. relevant alternative flows;
8. postconditions;
9. defined Database API;
10. defined REST endpoint when applicable;
11. acceptance criteria;
12. expected tests.

An agent shall not simply be asked to “implement cart” or “do checkout” without these contracts.

---

# 23. Definition of Done

A feature is considered complete when the following are synchronized, where applicable:

```text
Use case
    ↓
Requirement
    ↓
Business rule
    ↓
Flyway
    ↓
SP / Function / Trigger / Constraint
    ↓
Java Gateway
    ↓
Application Service
    ↓
REST Controller
    ↓
OpenAPI
    ↓
Tests
    ↓
Documentation
```

---

# 24. Change management

This baseline must not be edited informally to adapt the document to an implementation already completed.

If a need contradicting this baseline emerges during ERD, Database API, or implementation work:

1. identify the affected use case;
2. identify affected requirements and rules;
3. document the reason;
4. assess impact on the ERD, database, API, and tests;
5. approve the change;
6. increment the document version;
7. update traceability before implementation.

Examples:

- `v1.0 -> v1.1` for compatible corrections;
- `v1.x -> v2.0` for significant changes in scope or behavior.

---

# 25. Baseline closure criterion

The baseline is considered sufficiently closed to begin the ERD when:

- no critical actors remain unidentified;
- no v1 features lack a use case;
- no persistent entities lack functional justification;
- critical cardinalities can be derived;
- transactional entity statuses are defined;
- permitted transitions are defined;
- inventory rules are defined;
- checkout is defined transactionally;
- commercial history uses snapshots;
- academic payment is delimited;
- scope exclusions are explicit;
- no critical decisions are marked `TBD`.

**Result:** this baseline meets the preceding conditions and is authorized for deriving the **PLIEGO logical ERD**.

---

# 26. Next authorized stage

The next lifecycle stage will be:

```text
Use Case Baseline v1.0
        ↓
Logical ERD
        ↓
Data dictionary
        ↓
Database API Contract
        ↓
PostgreSQL physical model
        ↓
Definitive SP / Function / Trigger catalog
        ↓
REST contracts
        ↓
Implementation Work Orders
```

PostgreSQL physical types, indexes, and final Stored Procedure signatures shall not be defined before validating the logical ERD.

---

## Document history

| Version | Date | Status | Description |
|---|---|---|---|
| 1.0 | 2026-09-23 | BASELINE | First formal PLIEGO use case baseline. Consolidates scope, actors, rules, statuses, conceptual cardinalities, and traceability to enable ERD design without material ambiguity. |
| 1.1 | 2026-09-23 | BASELINE | Architectural review: feeds back DD-COR-001/002 (country and language), removes Carrito.CANCELLED, sets > 0 invariants and Pedido/Edición uniqueness, defines transient PENDING_PAYMENT, USER/SYSTEM history origin, deterministic simulator, stateless auth, transaction and cancellation ownership, visibility with INACTIVE masters, and threshold-based low stock. |

---

## Methodological references

- ISO/IEC/IEEE 29148:2018 — Systems and software engineering — Life cycle processes — Requirements engineering.
- OMG Unified Modeling Language (UML), Version 2.5.1.
- Approved PLIEGO project architecture: Java 25, Spring Boot, PostgreSQL, Flyway, database-centered business logic, and REST API decoupled from the future frontend.
