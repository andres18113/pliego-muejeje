# PLIEGO — Data Dictionary v1.0

**Document:** DD-PLIEGO-001  
**Version:** 1.1  
**Status:** APPROVED BASELINE  
**Date:** 2026-09-23  
**Project:** PLIEGO  
**Document type:** Logical data dictionary and semantic attribute specification  
**Source documents:**

- `docs/requirements/use-case-baseline-v1.0.md`
- `docs/domain/logical-erd-v1.0.md`

**Scope:** PLIEGO v1 persistent domain  
**Next artifact:** Database API Contract v1.0 / PostgreSQL physical model

---

# 1. Purpose

This document establishes the meaning, domain, requiredness, mutability, sensitivity and validation rules of **PLIEGO v1** persistent data.

The Data Dictionary is the third structural design source, after the *Use Case Baseline v1.0* and *Logical ERD v1.0*. Its role is to eliminate ambiguities before selecting PostgreSQL physical types and defining Stored Procedures, Functions, Triggers, Constraints and indexes.

This document must enable two different implementers to build the same physical model without having to reinterpret:

- what each attribute means;
- when it may be null;
- what its source of truth is;
- which values are valid;
- which data is historical;
- which data may be modified;
- which values must be unique;
- which fields are derived;
- which rules require cross-entity validation.

---

# 2. Derivation methodology

The dictionary is obtained through:

```text
Use Case Baseline v1.0
        ↓
Logical ERD v1.0
        ↓
Consistency audit
        ↓
Defect resolution
        ↓
Semantic data definition
        ↓
Data Dictionary v1.0
```

The following Software Engineering principles apply:

1. **Traceability:** every attribute must justify its existence through a domain need, rule or use case.
2. **Semantic uniqueness:** the same mutable concept must not have two authoritative sources.
3. **Normalization:** master data remains normalized; only expressly justified historical snapshots are allowed.
4. **Verifiability:** every attribute rule must subsequently be convertible into a test or constraint.
5. **Minimum sufficient complexity:** no catalogs or entities are added that PLIEGO v1 does not need.
6. **Stable history:** committed commercial facts are not rewritten from current master data.
7. **Logical/physical separation:** `BIGINT`, `VARCHAR`, `NUMERIC`, `TIMESTAMPTZ`, indexes and final PostgreSQL syntax are not yet established.

---

# 3. Consistency audit result

Before defining attributes, consistency between the Use Case Baseline and logical ERD was audited. The following defects, omissions or ambiguities were found.

## 3.1 Normative corrections

| ID | Finding | Resolution for PLIEGO v1 | Impact |
|---|---|---|---|
| DD-COR-001 | `Direccion` and `PedidoDireccion` did not identify the country. This leaves province/city meaning ambiguous and limits future evolution. | Mandatory `PaisCodigo` is added to both entities, using an ISO country code. | The logical ERD must reflect the attribute in its next revision. |
| DD-COR-002 | `PedidoItem` preserved format, ISBN and publisher, but not the Edicion's language, although `Edicion.Idioma` may be corrected. | Mandatory `IdiomaSnapshot` is added. | The logical ERD must reflect the attribute. |
| DD-COR-003 | `Carrito.CANCELLED` was modeled although no v1 use case produces that state and the baseline itself reserved it for the future. | `CANCELLED` is removed from the Carrito v1 domain. States: `ACTIVE`, `CHECKED_OUT`. | UCB/ERD correction in the next revision. Reduces dead state. |
| DD-COR-004 | The ERD allowed `Pedido.Subtotal >= 0` and `Pago.Monto >= 0`, but every Pedido has at least one item, with positive quantity and price. | `Pedido.Subtotal > 0`, `Pedido.Total > 0` and `Pago.Monto > 0`. | Corrects numerical invariants. |
| DD-COR-005 | Uniqueness of an Edicion within Pedido was not declared, although Pedido derives from a Carrito where Edicion is unique. | `PedidoId + EdicionId` is an alternate key in `PedidoItem`. | Avoids duplicate lines for the same edition. |
| DD-COR-006 | The Pedido–Pago relationship was defined, but not the full compatibility of their states. | A valid Pedido/Pago matrix is established. | Mandatory cross-entity rule. |
| DD-COR-007 | `MovimientoInventario` did not establish protection against duplicate `SALE` or `CANCELLATION` for the same Edicion in a Pedido. | For Pedido movements, `(PedidoId, EdicionId, Tipo)` must be unique. | Strengthens traceability and logical idempotence. |
| DD-COR-008 | `MovimientoInventario.Motivo` was ambiguous for administrative movements. | `Motivo` is mandatory for `ENTRY`, `ADJUSTMENT_IN` and `ADJUSTMENT_OUT`; it is not mandatory for automatic movements. | Improves auditing. |
| DD-COR-009 | The semantics of already associated inactive master entities were undefined. | Deactivating Autor/Editorial/Categoria prevents new associations, but does not automatically delete or hide existing historical relationships. | Avoids unwanted cascade effects. |
| DD-COR-010 | Normalization of email, SKU and codes had not been defined. | Logical canonical representations are established. | Eliminates uniqueness ambiguity. |
| DD-COR-011 | `Pago.Referencia` lacked duplicate semantics. | When present, it must uniquely identify the simulated payment result. | Adds a conditional alternate key. |
| DD-COR-012 | `AutoresSnapshot` could be interpreted as a non-atomic multivalued list. | Defined as an **atomic historical display string**, constructed in authorship order and separated deterministically. | Keeps the historical exception compatible with the relational model. |

These corrections do not extend the project's functional scope; they resolve ambiguities necessary to derive the physical model without further interpretation.

## 3.2 Reviewed and retained decisions

The following items were reviewed and **are not considered defects**:

- `Autor.Nombre` is not unique: two real authors may share a name.
- `Libro.Titulo` is not unique: distinct works or bibliographic versions may share a title.
- `Editorial.Nombre` is not declared unique in the logical model; a publisher's official identity must not be inferred exclusively from its name.
- `Carrito` does not reserve stock: availability is revalidated at checkout.
- Pedido does not require an FK to Carrito: a rejected attempt may leave Carrito active for a new checkout.
- `PedidoDireccion` does not reference the original Direccion: the snapshot must be independent.
- `PedidoItem` retains a historical FK to Edicion because Edicion is not physically deleted.
- Currency does not require its own entity in v1 because the entire system operates in USD.

---

# 4. Dictionary conventions

## 4.1 Requiredness

- **M:** mandatory; cannot lack a value.
- **O:** optional; may be absent.
- **C:** conditional; mandatory only when a specified condition is met.
- **D:** derived; obtained from other data and not a primary source of truth.

## 4.2 Mutability

- **I:** immutable after entity creation.
- **M:** mutable through an authorized use case.
- **R:** restrictively mutable through a state machine or specific procedure.
- **S:** automatically managed by the system.
- **A:** append-only; neither modified nor deleted once created.
- **D:** derived; not updated independently.

## 4.3 Sensitivity classification

- **PUB:** public catalog data.
- **INT:** nonsensitive internal data.
- **PER:** Cliente personal data.
- **AUT:** sensitive credential or authentication material.
- **COM:** internal historical/commercial data.

Classification guides API and log exposure; it does not yet constitute a complete security model.

## 4.4 Logical type domains

| Logical domain | Meaning |
|---|---|
| Identifier | Internal identity without commercial meaning |
| Short text | Controlled short string |
| Medium text | Moderately descriptive string |
| Long text | Narrative text |
| Code | Canonical value from a controlled set |
| Email | Normalized email address |
| Phone | Contact number represented as canonical text |
| Nonnegative integer | 0 or greater |
| Positive integer | 1 or greater |
| USD amount | Exact decimal monetary value with at most 2 decimal places |
| Boolean | true/false |
| Date | Civil date without time |
| Instant | Absolute event date and time; semantically UTC |
| URL/URI | Reference to an external resource or one served by the application |

PostgreSQL types are not yet inferred from these domains.

---

# 5. Global representation rules

## 5.1 Strings

- Mandatory values cannot be `null`, empty or whitespace-only.
- Input values must have surrounding whitespace removed before persistence.
- For optional fields, an empty string is interpreted as absence and must be normalized to `null`.
- Display text preserves user capitalization except for fields with a canonical representation.

## 5.2 Email

`EmailNormalizado` is obtained through:

1. removing surrounding whitespace;
2. converting to lowercase.

No attempt will be made in v1 to semantically rewrite the domain or local part beyond this normalization.

Example:

```text
Input:    Usuario@Ejemplo.COM
Canon:    usuario@ejemplo.com
```

## 5.3 SKU

Canonical representation:

- without surrounding whitespace;
- uppercase;
- conceptual length: 1–64 characters;
- allowed characters: ASCII letters, digits, period, hyphen and underscore;
- must start with a letter or digit.

Valid example:

```text
PLG-LIT-000042
```

## 5.4 ISBN-13

When present:

- exactly 13 digits;
- retained as text to preserve leading zeros;
- must pass the ISBN-13 checksum;
- globally unique across Ediciones.

## 5.5 Language

Represented by a lowercase ISO 639-1 code; if the language lacks a 639-1 code, lowercase ISO 639-2/T is used.

Examples:

```text
es
en
fr
```

## 5.6 Country

`PaisCodigo` uses uppercase ISO 3166-1 alpha-2 codes. The valid list is closed and lives in the physical model's constraint/check; extending it requires a formal change.

Examples:

```text
EC
CO
PE
```

## 5.7 Money

- PLIEGO v1 operates in USD.
- Amounts are exact decimals.
- At most two decimal places.
- `float`/`double` are not used as monetary sources.

## 5.8 Timestamps

All `FechaCreacion`, `FechaActualizacion` and event-date attributes represent an absolute instant.

Semantically, they are handled in UTC; conversion to the interface time zone is the responsibility of the future presentation layer.

## 5.9 Civil dates

`FechaPublicacion` represents a publication date, not an instant. No time zone conversion applies.

## 5.10 Phone

Canonical representation:

1. remove surrounding whitespace and display separators (`espacios`, `-`, `.`, `(`, `)`);
2. retain an initial `+` when applicable;
3. retain the remainder as digits.

Example:

```text
Input:    +593 (2) 555-0134
Canon:    +59325550134
```

The phone number is contact data, not an identity key: it imposes no uniqueness.

---

# 6. Controlled domains

## 6.1 UsuarioRol

```text
CUSTOMER
ADMIN
```

## 6.2 UsuarioEstado

```text
ACTIVE
BLOCKED
```

## 6.3 EstadoCatalogo

Applies to Autor, Editorial, Categoria, Libro and Edicion.

```text
ACTIVE
INACTIVE
```

## 6.4 FormatoEdicion

```text
PAPERBACK
HARDCOVER
```

## 6.5 LicenciaPortada

PLIEGO v1 permits covers whose reuse is documented through one of the following codes:

```text
PUBLIC_DOMAIN
CC0
CC_BY
CC_BY_SA
OWNED
```

Licenses incompatible with the intended e-commerce use are not incorporated without first modifying this domain and reviewing their terms.

## 6.6 TipoMovimientoInventario

```text
ENTRY
ADJUSTMENT_IN
ADJUSTMENT_OUT
SALE
CANCELLATION
```

## 6.7 EstadoCarrito

**Correction DD-COR-003:**

```text
ACTIVE
CHECKED_OUT
```

`CANCELLED` is outside PLIEGO v1 because no use case produces it.

## 6.8 EstadoPedido

```text
PENDING_PAYMENT
CONFIRMED
PREPARING
SHIPPED
DELIVERED
CANCELLED
```

## 6.9 MetodoPago

```text
CARD
TRANSFER
```

## 6.10 EstadoPago

```text
PENDING
APPROVED
REJECTED
REFUNDED
```

## 6.11 OrigenTransicionPedido

```text
USER
SYSTEM
```

---

# 7. Usuario entity

## 7.1 Definition

Authenticatable identity within PLIEGO.

## 7.2 Keys

- Logical PK: `UsuarioId`.
- AK: `EmailNormalizado`.

## 7.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| UsuarioId | M | Identifier | I | INT | Internal identifier. Has no business meaning. |
| EmailNormalizado | M | Email; 3–254 characters | I v1 | PER | Login identity. Must be unique after trim + lowercase normalization. Email changes do not exist in v1. |
| PasswordHash | M | Nonempty technical text | I v1 | AUT | Result of a password-hashing algorithm managed by Spring Security. Never contains a plaintext password. Not exposed in APIs. |
| Rol | M | UsuarioRol | I | INT | Defines `CUSTOMER` or `ADMIN`. Role changes do not exist in v1. |
| Estado | M | UsuarioEstado | R | INT | `ACTIVE` on creation; ADMIN may switch Cliente between `ACTIVE` and `BLOCKED`. |
| FechaCreacion | M | Instant | S | INT | Time when Usuario was created. Immutable. |
| FechaActualizacion | M | Instant | S | INT | Time of the last persistent Usuario change. |

## 7.4 Invariants

- `EmailNormalizado` unique.
- `CUSTOMER` Usuario must have exactly one Cliente.
- `ADMIN` Usuario has no Cliente in PLIEGO v1.
- `BLOCKED` prevents authentication but does not delete commercial history.

---

# 8. Cliente entity

## 8.1 Definition

Commercial profile of a Usuario with role `CUSTOMER`.

## 8.2 Keys

- PK: `ClienteId`.
- AK: `UsuarioId`.

## 8.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| ClienteId | M | Identifier | I | INT | Internal profile identifier. |
| UsuarioId | M | FK Usuario | I | INT | Must point to a Usuario with role `CUSTOMER`. Unique. |
| Nombres | M | Short text; 1–120 | M | PER | Cliente's given names. Cannot be blank. |
| Apellidos | M | Short text; 1–120 | M | PER | Cliente's surnames. Cannot be blank. |
| Telefono | O | Phone; 7–20 | M | PER | General contact. When present, normalized by removing insignificant display separators and retaining an initial `+` when applicable. |
| FechaCreacion | M | Instant | S | INT | Profile creation. |
| FechaActualizacion | M | Instant | S | INT | Latest profile update. |

## 8.4 Invariants

- `UsuarioId` cannot be shared between Clientes.
- Given names and surnames are display data, not identity keys.

---

# 9. Direccion entity

## 9.1 Definition

Reusable address registered by a Cliente for selection during checkout.

## 9.2 Keys

- PK: `DireccionId`.

## 9.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| DireccionId | M | Identifier | I | INT | Internal identifier. |
| ClienteId | M | FK Cliente | I | INT | Address owner. |
| Alias | M | Short text; 1–80 | M | PER | Convenience label, e.g. `Casa` or `Trabajo`. Not unique. |
| Destinatario | M | Short text; 1–200 | M | PER | Person who will receive the order. |
| DireccionLinea1 | M | Medium text; 1–200 | M | PER | Primary delivery address. |
| DireccionLinea2 | O | Medium text; max. 200 | M | PER | Additional address information. |
| Ciudad | M | Short text; 1–100 | M | PER | Ciudad/localidad. |
| Provincia | M | Short text; 1–100 | M | PER | Province/state/administrative region. |
| PaisCodigo | M | ISO country code; 2 characters | M | PER | **Added by DD-COR-001.** ISO 3166-1 alpha-2 code. |
| CodigoPostal | O | Short text; max. 20 | M | PER | Postal code where applicable. Treated as text. |
| Referencia | O | Medium text; max. 300 | M | PER | Additional directions for locating the address. |
| Telefono | M | Phone; 7–20 | M | PER | Delivery contact phone number. |
| EsPrincipal | M | Boolean | M | INT | Indicates whether it is the current primary address. |
| FechaCreacion | M | Instant | S | INT | Creation. |
| FechaActualizacion | M | Instant | S | INT | Latest modification. |

## 9.4 Invariants

- A Direccion belongs to exactly one Cliente.
- Per Cliente, at most one Direccion has `EsPrincipal = true`.
- It is valid for a Cliente to have no primary Direccion.
- Deleting a Direccion does not affect previous orders.

---

# 10. Autor entity

## 10.1 Definition

Person or authorial identity associable with one or more Libros.

## 10.2 Keys

- PK: `AutorId`.
- The name is **not** an alternate key.

## 10.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| AutorId | M | Identifier | I | PUB | Internal identifier. |
| Nombre | M | Short text; 1–200 | M | PUB | Autor display name. May be repeated among different authors. |
| Biografia | O | Long text; conceptual max. 5.000 | M | PUB | Biographical overview. |
| Estado | M | EstadoCatalogo | R | PUB | `ACTIVE` or `INACTIVE`. |
| FechaCreacion | M | Instant | S | INT | Record creation. |
| FechaActualizacion | M | Instant | S | INT | Latest modification. |

## 10.4 Deactivation semantics

An `INACTIVE` Autor:

- cannot be added to a new `LibroAutor` relationship;
- retains existing relationships;
- may still be displayed as the author of an already associated Libro;
- does not automatically delete or deactivate Libros.

---

# 11. Editorial entity

## 11.1 Definition

Publishing organization responsible for an Edicion.

## 11.2 Keys

- PK: `EditorialId`.
- `Nombre` is not considered a unique key in v1.

## 11.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| EditorialId | M | Identifier | I | PUB | Internal identifier. |
| Nombre | M | Short text; 1–200 | M | PUB | Editorial name. |
| Descripcion | O | Medium text; max. 2.000 | M | PUB | Optional description. |
| Estado | M | EstadoCatalogo | R | PUB | `ACTIVE` or `INACTIVE`. |
| FechaCreacion | M | Instant | S | INT | Creation. |
| FechaActualizacion | M | Instant | S | INT | Latest modification. |

## 11.4 Deactivation semantics

An `INACTIVE` Editorial:

- cannot be assigned to new Ediciones;
- retains already associated Ediciones;
- its name may still be displayed in existing Ediciones;
- does not automatically make an existing Edicion `INACTIVE`.

---

# 12. Categoria entity

## 12.1 Definition

Thematic classification of Libros with a maximum two-level hierarchy.

## 12.2 Keys

- PK: `CategoriaId`.
- AK: `Slug`.

## 12.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| CategoriaId | M | Identifier | I | PUB | Internal identifier. |
| CategoriaPadreId | O | FK Categoria | R | INT | Absent for a root category; present for a subcategory. |
| Nombre | M | Short text; 1–120 | M | PUB | Visible name. |
| Slug | M | Text code; 1–140 | M | PUB | Unique human-readable identifier. Normalized to lowercase, without surrounding whitespace and with `-` as separator. |
| Descripcion | O | Medium text; max. 1.000 | M | PUB | Thematic description. |
| Estado | M | EstadoCatalogo | R | PUB | `ACTIVE` or `INACTIVE`. |
| FechaCreacion | M | Instant | S | INT | Creation. |
| FechaActualizacion | M | Instant | S | INT | Latest modification. |

## 12.4 Invariants

- `Slug` globally unique.
- Root category: `CategoriaPadreId = null`.
- Subcategory: `CategoriaPadreId != null` and the parent must be a root.
- A subcategory cannot have children.
- Cannot reference itself.
- Cycles cannot exist.
- Maximum depth: 2.

## 12.5 Deactivation semantics

- Cannot be added to new `LibroCategoria` associations.
- Existing associations remain.
- Deactivation does not automatically deactivate Libros.
- The inactive category must not be offered as a new classification option in future administrative interfaces.

---

# 13. Libro entity

## 13.1 Definition

Abstract bibliographic work, independent of its commercial versions.

## 13.2 Keys

- PK: `LibroId`.
- Title is not unique.

## 13.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| LibroId | M | Identifier | I | PUB | Internal work identifier. |
| Titulo | M | Medium text; 1–300 | M | PUB | Main title of the work. |
| Subtitulo | O | Medium text; max. 300 | M | PUB | Subtitle, when present. |
| Sinopsis | O | Long text; conceptual max. 10.000 | M | PUB | Description/summary of the work. |
| Estado | M | EstadoCatalogo | R | PUB | Commercial availability control at work level. |
| FechaCreacion | M | Instant | S | INT | Creation. |
| FechaActualizacion | M | Instant | S | INT | Latest change. |

## 13.4 Invariants

For `Libro.Estado = ACTIVE`:

- at least one `LibroAutor` must exist;
- at least one `LibroCategoria` must exist.

Deactivating Libro makes none of its Ediciones publishable, without changing those Ediciones' individual states.

---

# 14. LibroAutor entity

## 14.1 Definition

N:M association between Libro and Autor, including author display order.

## 14.2 Keys

- Composite PK: `(LibroId, AutorId)`.
- AK: `(LibroId, OrdenAutoria)`.

## 14.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| LibroId | M | FK Libro | I within the relationship | PUB | Participating Libro. |
| AutorId | M | FK Autor | I within the relationship | PUB | Participating Autor. |
| OrdenAutoria | M | Positive integer | M | PUB | Position used to display authors. Values unique within Libro. |

## 14.4 Rules

- The same Libro/Autor pair cannot exist twice.
- `OrdenAutoria > 0`.
- Positions cannot be repeated within a Libro.
- The sequence need not be contiguous; relative order is obtained in ascending order.
- An Autor newly added to the relationship must be `ACTIVE`.

---

# 15. LibroCategoria entity

## 15.1 Definition

N:M association between Libro and Categoria.

## 15.2 Keys

- Composite PK: `(LibroId, CategoriaId)`.

## 15.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| LibroId | M | FK Libro | I within the relationship | PUB | Classified Libro. |
| CategoriaId | M | FK Categoria | I within the relationship | PUB | Assigned Categoria. |

## 15.4 Rules

- The same association is not duplicated.
- A Categoria added to a new association must be `ACTIVE`.

---

# 16. Edicion entity

## 16.1 Definition

Specific physical commercial version of a Libro. This is the unit that PLIEGO sells, prices and inventories.

## 16.2 Keys

- PK: `EdicionId`.
- AK: `SKU`.
- Conditional AK: `ISBN13` when present.

## 16.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| EdicionId | M | Identifier | I | PUB | Internal identifier. |
| LibroId | M | FK Libro | I | PUB | Work to which it belongs. Cannot change after Edicion creation. |
| EditorialId | M | FK Editorial | M | PUB | Current Editorial of the Edicion. A new Editorial must be `ACTIVE`. |
| SKU | M | SKU code; 1–64 | I | PUB | Internal, canonical and unique commercial identifier. |
| ISBN13 | O | 13 digits | Restricted M | PUB | Edicion ISBN. When present, valid checksum and unique. May be corrected administratively. |
| Idioma | M | LanguageCode; 2 or 3 characters | M | PUB | Main content language. Lowercase canonical form (ISO 639-1 or 639-2/T). |
| Formato | M | FormatoEdicion | M | PUB | `PAPERBACK` or `HARDCOVER`. |
| NumeroPaginas | M | Positive integer; conceptual range 1–100.000 | M | PUB | Number of pages in the Edicion. |
| FechaPublicacion | O | Date | M | PUB | Publication date. Does not alone determine commercial availability in v1. |
| Precio | M | USD amount; 0.01–999,999,999.99 | M | PUB | Current price. Source of truth for the active cart. |
| PortadaUrl | O | URL/URI; conceptual max. 2.048 | M | PUB | Cover image location. Does not contain binary data. |
| PortadaLicencia | C | LicenciaPortada | M | PUB | Required if `PortadaUrl` exists. |
| PortadaFuenteUrl | C | URL/URI; max. 2.048 | M | PUB | Required if `PortadaUrl` exists; identifies documented provenance. |
| PortadaAtribucion | O | Medium text; max. 500 | M | PUB | Attribution text when required by the license or source. |
| Estado | M | EstadoCatalogo | R | PUB | `ACTIVE` or `INACTIVE`. |
| FechaCreacion | M | Instant | S | INT | Creation. |
| FechaActualizacion | M | Instant | S | INT | Latest change. |

## 16.4 Conditional cover rules

```text
PortadaUrl IS NULL
=> PortadaLicencia, PortadaFuenteUrl and PortadaAtribucion may be null

PortadaUrl IS NOT NULL
=> PortadaLicencia required
=> PortadaFuenteUrl required
```

`PortadaAtribucion` is mandatory with `CC_BY` and `CC_BY_SA`; optional with `PUBLIC_DOMAIN`, `CC0` and `OWNED` (recommended when provided by the source). Removing `PortadaUrl` requires setting `PortadaLicencia`, `PortadaFuenteUrl` and `PortadaAtribucion` to null.

## 16.5 Publishability

An Edicion is publishable when:

```text
Edicion.Estado = ACTIVE
AND Libro.Estado = ACTIVE
```

Purchase availability additionally requires:

```text
Inventario.StockActual > 0
```

---

# 17. Inventario entity

## 17.1 Definition

Single source of truth for an Edicion's current stock in PLIEGO v1.

## 17.2 Keys

- Shared logical PK: `EdicionId`.
- FK: `EdicionId -> Edicion`.

## 17.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| EdicionId | M | FK/identificador | I | INT | Identifies the Edicion whose inventory it represents. |
| StockActual | M | Nonnegative integer | R | INT | Currently existing units. Changes only through authorized inventory, sale or cancellation operations. |
| StockMinimo | M | Nonnegative integer | M | INT | Administrative threshold for the low-stock indicator. |
| FechaActualizacion | M | Instant | S | INT | Latest change to `StockActual` or `StockMinimo`. |

## 17.4 Initial values

When creating Edicion:

```text
StockActual = 0
StockMinimo = 0
```

## 17.5 Derived datum

```text
BajoStock = StockMinimo > 0 AND StockActual <= StockMinimo
```

`BajoStock` does not require independent storage. (`StockMinimo = 0` means "no threshold".)

---

# 18. MovimientoInventario entity

## 18.1 Definition

Immutable event explaining every committed change to `Inventario.StockActual`.

## 18.2 Keys

- PK: `MovimientoInventarioId`.
- Conditional AK for Pedido movements: `(PedidoId, EdicionId, Tipo)`.

## 18.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| MovimientoInventarioId | M | Identifier | I | COM | Event identifier. |
| EdicionId | M | FK Inventario/Edicion | A | COM | Affected Inventario. |
| PedidoId | C | FK Pedido | A | COM | Required for `SALE` and `CANCELLATION`; absent for administrative movements. |
| UsuarioActorId | C | FK Usuario | A | INT | Required for administrative movements; must correspond to ADMIN. Absent for automatic sale/cancellation movements. |
| Tipo | M | TipoMovimientoInventario | A | COM | Nature of the change. |
| Cantidad | M | Positive integer | A | COM | Absolute movement magnitude; never stored as negative. |
| StockAnterior | M | Nonnegative integer | A | COM | Stock immediately before the event. |
| StockPosterior | M | Nonnegative integer | A | COM | Stock immediately afterward. |
| Motivo | C | Medium text; 1–500 | A | COM | Required for `ENTRY`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`. Optional for automatic movements. |
| Fecha | M | Instant | A | COM | Time when the movement was committed. |

## 18.4 Rules by type

| Tipo | PedidoId | UsuarioActorId | Motivo | Effect |
|---|---|---|---|---|
| ENTRY | null | required ADMIN | required | adds |
| ADJUSTMENT_IN | null | required ADMIN | required | adds |
| ADJUSTMENT_OUT | null | required ADMIN | required | subtracts |
| SALE | required | null | optional | subtracts |
| CANCELLATION | required | null | optional | adds |

## 18.5 Arithmetic invariants

```text
ENTRY / ADJUSTMENT_IN / CANCELLATION:
StockPosterior = StockAnterior + Cantidad

ADJUSTMENT_OUT / SALE:
StockPosterior = StockAnterior - Cantidad
```

Always:

```text
Cantidad > 0
StockAnterior >= 0
StockPosterior >= 0
```

## 18.6 Immutability

All attributes are append-only. A committed MovimientoInventario is neither modified nor deleted.

---

# 19. Carrito entity

## 19.1 Definition

Temporary grouping of a Cliente's purchase intent.

## 19.2 Keys

- PK: `CarritoId`.
- Conditional uniqueness rule: at most one `ACTIVE` Carrito per Cliente.

## 19.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| CarritoId | M | Identifier | I | INT | Internal identifier. |
| ClienteId | M | FK Cliente | I | INT | Propietario. |
| Estado | M | EstadoCarrito | R | INT | `ACTIVE` or `CHECKED_OUT`. |
| FechaCreacion | M | Instant | S | INT | Physical Carrito creation. |
| FechaActualizacion | M | Instant | S | INT | Latest change to state or relevant content. |

## 19.4 States

```text
ACTIVE -> CHECKED_OUT
```

`CHECKED_OUT` is final.

A checkout rejected due to payment does **not** change Carrito; it remains `ACTIVE`.

---

# 20. CarritoItem entity

## 20.1 Definition

A selected Edicion and its quantity within a Carrito.

## 20.2 Keys

- PK: `CarritoItemId`.
- AK: `(CarritoId, EdicionId)`.

## 20.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| CarritoItemId | M | Identifier | I | INT | Item identifier. |
| CarritoId | M | FK Carrito | I | INT | Owning Carrito. |
| EdicionId | M | FK Edicion | I | PUB | Requested Edicion. |
| Cantidad | M | Positive integer | M | INT | Requested units. Must be > 0. |
| FechaCreacion | M | Instant | S | INT | First addition of the item. |
| FechaActualizacion | M | Instant | S | INT | Latest quantity change. |

## 20.4 Rules

- A CarritoItem may only be modified while its Carrito is `ACTIVE`.
- When adding/modifying, `Cantidad <= StockActual` is validated at that instant.
- This condition does not guarantee stock until checkout.
- Does not store price as a source of truth.

## 20.5 Query-derived data

```text
PrecioActual = Edicion.Precio
SubtotalActual = Cantidad × PrecioActual
```

---

# 21. Pedido entity

## 21.1 Definition

Persisted commercial transaction created during checkout.

## 21.2 Keys

- PK: `PedidoId`.

## 21.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| PedidoId | M | Identifier | I | COM | Internal Pedido identifier. |
| ClienteId | M | FK Cliente | I | COM | Owning Cliente. |
| Estado | M | EstadoPedido | R | COM | Current state according to the state machine. |
| Subtotal | M | USD amount > 0 | I | COM | Historical sum of PedidoItem subtotals. |
| Total | M | USD amount > 0 | I | COM | Commercial total. In v1 it must equal Subtotal. |
| FechaCreacion | M | Instant | S | COM | Instant of Pedido creation at checkout. |
| FechaActualizacion | M | Instant | S | COM | Latest Pedido state change. |

## 21.4 Invariants

- Must have at least one PedidoItem.
- Must have exactly one PedidoDireccion.
- Must have exactly one Pago.
- Must have at least one PedidoEstadoHistorial.
- `Subtotal > 0`.
- `Total > 0`.
- `Total = Subtotal` in v1.
- Implicit currency: USD.

## 21.5 Allowed states

```text
PENDING_PAYMENT
CONFIRMED
PREPARING
SHIPPED
DELIVERED
CANCELLED
```

Transitions are defined in the Use Case Baseline and in this document's cross-entity rules section.

---

# 22. PedidoItem entity

## 22.1 Definition

Immutable commercial line of a Pedido. Retains a reference to Edicion and sufficient snapshots to preserve what was purchased even if the catalog changes.

## 22.2 Keys

- PK: `PedidoItemId`.
- **AK added by DD-COR-005:** `(PedidoId, EdicionId)`.

## 22.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| PedidoItemId | M | Identifier | I | COM | Internal identifier. |
| PedidoId | M | FK Pedido | A | COM | Owning Pedido. |
| EdicionId | M | FK Edicion | A | COM | Historical reference to the purchased Edicion. |
| SKU_Snapshot | M | SKU code | A | COM | Exact SKU copy at checkout. |
| ISBN_Snapshot | O | 13 digits | A | COM | ISBN copy; null if the Edicion had no ISBN. |
| Titulo_Snapshot | M | Medium text; 1–300 | A | COM | Title displayed at purchase time. |
| Autores_Snapshot | M | Medium text; 1–1.000 | A | COM | Historical author string, ordered by `OrdenAutoria` and separated deterministically by `; `. |
| Editorial_Snapshot | M | Short text; 1–200 | A | COM | Editorial name at checkout. |
| Formato_Snapshot | M | FormatoEdicion | A | COM | Purchased format. |
| Idioma_Snapshot | M | Language code | A | COM | **Added by DD-COR-002.** Purchased language. |
| PrecioUnitario | M | USD amount > 0 | A | COM | Price of one unit at checkout. |
| Cantidad | M | Positive integer | A | COM | Purchased units. |
| Subtotal | M | USD amount > 0 | A | COM | `PrecioUnitario × Cantidad`. |

## 22.4 Invariants

```text
Cantidad > 0
PrecioUnitario > 0
Subtotal = PrecioUnitario × Cantidad
```

An Edicion appears at most once within the same Pedido.

## 22.5 Snapshot semantics

Snapshots:

- are obtained within the same checkout operation;
- are not subsequently recalculated;
- they are not the catalog's source of truth;
- are the Pedido's historical source of truth.

Capturing `NumeroPaginas`, `FechaPublicacion` or `PortadaUrl` is not considered necessary for v1 transactional truth.

---

# 23. PedidoDireccion entity

## 23.1 Definition

Immutable snapshot of the Direccion selected during checkout.

## 23.2 Keys

- Shared logical PK/FK: `PedidoId`.

## 23.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| PedidoId | M | FK Pedido | A | COM | Pedido to which the snapshot belongs. |
| Destinatario | M | Short text; 1–200 | A | PER/COM | Recipient copy. |
| DireccionLinea1 | M | Medium text; 1–200 | A | PER/COM | Primary address copy. |
| DireccionLinea2 | O | Medium text; max. 200 | A | PER/COM | Additional address information copy. |
| Ciudad | M | Short text; 1–100 | A | PER/COM | City copy. |
| Provincia | M | Short text; 1–100 | A | PER/COM | Province/region copy. |
| PaisCodigo | M | ISO country code; 2 characters | A | PER/COM | **Added by DD-COR-001.** Delivery country at checkout. |
| CodigoPostal | O | Short text; max. 20 | A | PER/COM | Postal code copy. |
| Referencia | O | Medium text; max. 300 | A | PER/COM | Reference copy. |
| Telefono | M | Phone; 7–20 | A | PER/COM | Delivery contact phone number. |

## 23.4 Rules

- There is no FK to Direccion.
- Generated from a Direccion belonging to the Pedido's Cliente.
- Not modified after checkout.
- Deleting or editing the original Direccion does not affect this snapshot.

---

# 24. Pago entity

## 24.1 Definition

Result of the single simulated payment attempt associated with a Pedido in PLIEGO v1.

## 24.2 Keys

- PK: `PagoId`.
- AK: `PedidoId`.
- Conditional AK: `Referencia` when present.

## 24.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| PagoId | M | Identifier | I | COM | Pago identifier. |
| PedidoId | M | FK Pedido | I | COM | Must be unique: one Pago per Pedido. |
| Metodo | M | MetodoPago | I | COM | `CARD` or `TRANSFER`. |
| Estado | M | EstadoPago | R | COM | Payment attempt state. |
| Monto | M | USD amount > 0 | I | COM | Must exactly equal Pedido.Total. |
| Referencia | O | Short text; 1–100 | R | COM | Reference generated by the simulator. When present, unique. |
| DetalleResultado | O | Medium text; max. 500 | R | COM | Academic explanation of the result, without sensitive card data. |
| FechaCreacion | M | Instant | S | COM | Created as `PENDING`. |
| FechaActualizacion | M | Instant | S | COM | Latest state change. |

## 24.4 State machine

```text
PENDING -> APPROVED -> REFUNDED
       \-> REJECTED
```

## 24.5 Constraints

- Does not store CVV.
- Does not store PAN/complete card number.
- `Monto > 0`.
- `Monto = Pedido.Total`.
- `Referencia` is mandatory in `APPROVED`, optional in `REJECTED` (the reason lives in `DetalleResultado`); initially `null` in `PENDING` and immutable after resolution; `REFUNDED` does not modify it.
- `APPROVED` can change only to `REFUNDED`.
- `REJECTED` and `REFUNDED` are final.

---

# 25. PedidoEstadoHistorial entity

## 25.1 Definition

Append-only record of Pedido creation and state transitions.

## 25.2 Keys

- PK: `PedidoEstadoHistorialId`.

## 25.3 Attributes

| Attribute | Required | Domain / conceptual range | Mut. | Sens. | Definition and rules |
|---|---:|---|---|---|---|
| PedidoEstadoHistorialId | M | Identifier | I | COM | Historical event identifier. |
| PedidoId | M | FK Pedido | A | COM | Affected Pedido. |
| UsuarioActorId | C | FK Usuario | A | INT | Required when `Origen = USER`; absent when `Origen = SYSTEM`. |
| Origen | M | OrigenTransicionPedido | A | COM | Indicates whether the transition was caused by a user or the system. |
| EstadoAnterior | O/C | EstadoPedido | A | COM | `null` exclusively for the Pedido's first record. |
| EstadoNuevo | M | EstadoPedido | A | COM | State established by the event. |
| Fecha | M | Instant | A | COM | Transition time. |

## 25.4 Rules

### Initial record

```text
EstadoAnterior = null
EstadoNuevo = PENDING_PAYMENT
Origen = SYSTEM
UsuarioActorId = null
```

### Automatic approved-payment transition

```text
PENDING_PAYMENT -> CONFIRMED
Origen = SYSTEM
UsuarioActorId = null
```

### Automatic rejected-payment transition

```text
PENDING_PAYMENT -> CANCELLED
Origen = SYSTEM
UsuarioActorId = null
```

### Administrative transitions

```text
Origen = USER
UsuarioActorId = ADMIN who performed the operation
```

### Cancellation by Cliente

```text
Origen = USER
UsuarioActorId = CUSTOMER Usuario owning the Pedido
```

Every record is immutable.

---

# 26. Pedido–Pago compatibility matrix

The combination of states must be consistent.

| Pedido state | Compatible Pago states | Observation |
|---|---|---|
| PENDING_PAYMENT | PENDING | Transient intra-transactional state within checkout; never observable post-commit |
| CONFIRMED | APPROVED | Confirmed purchase |
| PREPARING | APPROVED | Paid Pedido being prepared |
| SHIPPED | APPROVED | Paid Pedido shipped |
| DELIVERED | APPROVED | Paid Pedido delivered |
| CANCELLED | REJECTED, REFUNDED | Initial rejection or cancellation after approved payment |

Invalid combinations include:

```text
CONFIRMED + PENDING
CONFIRMED + REJECTED
SHIPPED + REFUNDED
DELIVERED + REJECTED
CANCELLED + APPROVED
CANCELLED + PENDING
```

The cancellation transition from `CONFIRMED`/`PREPARING` must update Pago to `REFUNDED` within the same business operation.

---

# 27. Consistency rules between Pedido and its dependencies

For every Pedido persisted upon completion of the checkout operation, the following must hold:

```text
COUNT(PedidoItem) >= 1
COUNT(PedidoDireccion) = 1
COUNT(Pago) = 1
COUNT(PedidoEstadoHistorial) >= 1
```

Additionally:

```text
Pedido.Subtotal = SUM(PedidoItem.Subtotal)
Pedido.Total = Pedido.Subtotal
Pago.Monto = Pedido.Total
```

For each PedidoItem:

```text
PedidoItem.Subtotal = PedidoItem.PrecioUnitario × PedidoItem.Cantidad
```

---

# 28. Inventory consistency rules

## 28.1 Source of truth

`Inventario.StockActual` is the present state.

`MovimientoInventario` explains the history of committed variations.

No other `Stock` attribute must exist in:

- Libro;
- Edicion;
- CarritoItem;
- PedidoItem.

## 28.2 Administrative operation

Stock change and MovimientoInventario must occur in the same transaction.

## 28.3 Sale

For each committed PedidoItem, exactly one `SALE` movement is produced for the same Edicion.

## 28.4 Cancellation

For each PedidoItem of a Pedido cancelled after approval, exactly one `CANCELLATION` movement is produced for the same Edicion. Each `CANCELLATION` requires the previous `SALE` for the same `(PedidoId, EdicionId)`; `CANCELLED` orders due to initial rejection (without `SALE`) do not generate `CANCELLATION`.

## 28.5 Identity of order movements

For the same Pedido and Edicion:

- at most one `SALE`;
- at most one `CANCELLATION`.

This prevents applying the same outgoing movement or restoration twice.

---

# 29. Catalog consistency rules

## 29.1 Active Libro

An `ACTIVE` Libro must retain:

```text
>= 1 LibroAutor
>= 1 LibroCategoria
```

The `INACTIVE` state of an associated Autor or Categoria does not delete that association or require Libro deactivation.

## 29.2 Publishable Edicion

```text
Libro.Estado = ACTIVE
AND Edicion.Estado = ACTIVE
```

## 29.3 Purchasable Edicion

```text
Libro.Estado = ACTIVE
AND Edicion.Estado = ACTIVE
AND Inventario.StockActual > 0
```

## 29.4 Inactive Editorial

An inactive Editorial:

- cannot be associated with a new Edicion;
- does not automatically invalidate existing Ediciones.

---

# 30. Derived data not persisted as sources of truth

| Datum | Derivation |
|---|---|
| Libro available for an Edicion | Libro ACTIVE + Edicion ACTIVE + StockActual > 0 |
| Low stock | StockMinimo > 0 AND StockActual <= StockMinimo |
| Current CarritoItem price | Edicion.Precio |
| Current CarritoItem subtotal | Cantidad × Edicion.Precio |
| Current Carrito total | sum of current subtotals |
| Cliente full name | Nombres + Apellidos |
| Pedido total | sum of PedidoItem.Subtotal; in v1 equals Subtotal |

This data may be returned by Database API Functions/queries, but must not become duplicate sources of truth without an explicit subsequent decision.

---

# 31. Historical attributes versus master data

| Current concept | Master source | Historical snapshot |
|---|---|---|
| Title | Libro.Titulo | PedidoItem.Titulo_Snapshot |
| Authors | Autor + LibroAutor | PedidoItem.Autores_Snapshot |
| Editorial | Editorial.Nombre | PedidoItem.Editorial_Snapshot |
| SKU | Edicion.SKU | PedidoItem.SKU_Snapshot |
| ISBN | Edicion.ISBN13 | PedidoItem.ISBN_Snapshot |
| Format | Edicion.Formato | PedidoItem.Formato_Snapshot |
| Language | Edicion.Idioma | PedidoItem.Idioma_Snapshot |
| Price | Edicion.Precio | PedidoItem.PrecioUnitario |
| Address | Direccion | PedidoDireccion |
| Pedido state | Pedido.Estado | PedidoEstadoHistorial |
| Stock | Inventario.StockActual | MovimientoInventario before/after |

Snapshots must not be synchronized when the master source changes.

---

# 32. Consolidated nullability

## Never null

Including:

- PK identifiers;
- mandatory references;
- Usuario.EmailNormalizado;
- Usuario.PasswordHash;
- Cliente.Nombres/Apellidos;
- Autor.Nombre;
- Editorial.Nombre;
- Categoria.Nombre/Slug;
- Libro.Titulo;
- Edicion.SKU/Idioma/Formato/NumeroPaginas/Precio;
- Inventario.StockActual/StockMinimo;
- Carrito.Estado;
- CarritoItem.Cantidad;
- Pedido.Estado/Subtotal/Total;
- required PedidoItem snapshots;
- minimum PedidoDireccion data;
- Pago.Metodo/Estado/Monto;
- PedidoEstadoHistorial.Origen/EstadoNuevo/Fecha.

## Nulls allowed by nature

- Cliente.Telefono;
- Direccion.Linea2;
- Direccion.CodigoPostal;
- Direccion.Referencia;
- Autor.Biografia;
- Editorial.Descripcion;
- Categoria.CategoriaPadreId;
- Categoria.Descripcion;
- Libro.Subtitulo;
- Libro.Sinopsis;
- Edicion.ISBN13;
- Edicion.FechaPublicacion;
- Portada* when no cover exists;
- PedidoItem.ISBN_Snapshot;
- PedidoDireccion.Linea2/CodigoPostal/Referencia;
- Pago.Referencia before the result;
- Pago.DetalleResultado;
- PedidoEstadoHistorial.EstadoAnterior only for the first event.

## Conditional nulls

- MovimientoInventario.PedidoId;
- MovimientoInventario.UsuarioActorId;
- MovimientoInventario.Motivo;
- Edicion.PortadaLicencia;
- Edicion.PortadaFuenteUrl;
- PedidoEstadoHistorial.UsuarioActorId.

Conditions are defined in the corresponding entities.

---

# 33. Consolidated mutability

## Immutable or historical

- IDs;
- Usuario.Rol;
- Edicion.LibroId;
- Edicion.SKU;
- every committed MovimientoInventario;
- Pedido.ClienteId;
- Pedido.Subtotal/Total;
- all PedidoItem;
- all PedidoDireccion;
- Pago.PedidoId/Metodo/Monto;
- all PedidoEstadoHistorial.

## Controlled mutable data

- Usuario.Estado;
- Cliente data;
- Direccion;
- Autor;
- Editorial;
- Categoria;
- Libro;
- permitted Edicion metadata;
- Edicion.Precio;
- Inventario.StockMinimo;
- CarritoItem.Cantidad;
- Carrito, Pedido and Pago states according to their machines.

## Operational stock mutability

`Inventario.StockActual` is not edited as master data; it changes only as an effect of inventory/sale/cancellation procedures that generate MovimientoInventario.

---

# 34. Format validations versus business rules

## 34.1 Format validations

May also exist in Spring Boot to protect the HTTP contract:

- nonempty string;
- maximum length;
- basic email structure;
- positive integer;
- code format.

## 34.2 Business authority

PostgreSQL remains authoritative over:

- email/SKU/ISBN/slug uniqueness;
- ISBN checksum;
- entity states;
- valid associations;
- stock;
- cart/order/address ownership;
- totals;
- transitions;
- snapshots;
- movements;
- Pedido/Pago compatibility.

Equivalent frontend or Java validation is only preventive and does not replace the database engine's rule.

---

# 35. Data that must never be exposed in public responses

- `PasswordHash`;
- unnecessary internal authentication identifiers;
- another Cliente's personal data;
- another Cliente's addresses;
- another Cliente's PedidoDireccion;
- internal reasons for administrative movements except through an administrative endpoint;
- unnecessary technical information from the payment simulator.

Catalog data classified as `PUB` may be part of public APIs according to the use case.

---

# 36. Data not modeled in PLIEGO v1

The dictionary confirms the deliberate absence of:

- `BodegaId`;
- `SucursalId`;
- supplier;
- acquisition cost;
- reserved stock;
- tax;
- discount;
- coupon;
- shipping cost;
- tracking;
- tax invoice;
- eBook file;
- review/rating;
- wishlist;
- persisted refresh token;
- user session;
- complete bank card;
- CVV.

Their absence must not be compensated with improvised columns during implementation.

---

# 37. Revised logical key matrix

| Entity | PK | AK / uniqueness |
|---|---|---|
| Usuario | UsuarioId | EmailNormalizado |
| Cliente | ClienteId | UsuarioId |
| Direccion | DireccionId | at most one primary address per Cliente |
| Autor | AutorId | — |
| Editorial | EditorialId | — |
| Categoria | CategoriaId | Slug |
| Libro | LibroId | — |
| LibroAutor | LibroId + AutorId | LibroId + OrdenAutoria |
| LibroCategoria | LibroId + CategoriaId | — |
| Edicion | EdicionId | SKU; ISBN13 if present |
| Inventario | EdicionId | — |
| MovimientoInventario | MovimientoInventarioId | PedidoId + EdicionId + Tipo for SALE/CANCELLATION |
| Carrito | CarritoId | at most one ACTIVE per Cliente |
| CarritoItem | CarritoItemId | CarritoId + EdicionId |
| Pedido | PedidoId | — |
| PedidoItem | PedidoItemId | PedidoId + EdicionId |
| PedidoDireccion | PedidoId | — |
| Pago | PagoId | PedidoId; Referencia if present |
| PedidoEstadoHistorial | PedidoEstadoHistorialId | — |

---

# 38. Change responsibility matrix

| Datum | Authorized operation |
|---|---|
| Usuario.Estado | Administrative customer management |
| Cliente.* | Profile management |
| Direccion.* | Address management |
| Autor/Editorial/Categoria/Libro/Edicion | Administrative catalog management |
| Inventario.StockMinimo | Configure minimum stock |
| Inventario.StockActual | Entry/adjustment/checkout/cancellation SP |
| MovimientoInventario | Creation only within the stock-changing operation |
| Carrito | Cart management / checkout |
| CarritoItem | Cart management |
| Pedido.Estado | Checkout / cancellation / administrative management |
| PedidoItem | Creation only at checkout |
| PedidoDireccion | Creation only at checkout |
| Pago | Checkout / subsequent cancellation |
| PedidoEstadoHistorial | Append only upon Pedido transition |

---

# 39. Rules for the future physical model

The physical model must preserve at least:

1. EmailNormalizado uniqueness;
2. SKU uniqueness;
3. conditional ISBN13 uniqueness;
4. Categoria.Slug uniqueness;
5. Libro/Autor uniqueness;
6. Libro/OrdenAutoria uniqueness;
7. Libro/Categoria uniqueness;
8. 1:1 Edicion/Inventario relationship;
9. at most one ACTIVE Carrito per Cliente;
10. Carrito/Edicion uniqueness;
11. Pedido/Edicion uniqueness in PedidoItem;
12. 1:1 Pedido/PedidoDireccion relationship;
13. 1:1 Pedido/Pago relationship;
14. Pago Referencia uniqueness when present;
15. Pedido/Edicion/Tipo uniqueness for `SALE` and `CANCELLATION` movements;
16. positive integer quantities where applicable;
17. nonnegative stock;
18. positive prices and amounts;
19. categories with at most two levels;
20. valid state transitions;
21. Pedido/Pago compatibility;
22. nullability conditions established in this dictionary.

The specific physical technique (`UNIQUE`, `CHECK`, partial index, trigger, Function or SP) will be decided in the Physical Model / Database API Contract.

---

# 40. Correction traceability to earlier artifacts

Revision v1.1 incorporates the following (correction traceability to earlier artifacts):

| Correction | UCB | ERD |
|---|---|---|
| PaisCodigo in Direccion/PedidoDireccion | minor update | yes |
| IdiomaSnapshot in PedidoItem | minor update | yes |
| Remove Carrito.CANCELLED from v1 | yes | yes |
| Totals/amounts strictly > 0 | yes, if >= 0 appears | yes |
| AK PedidoId+EdicionId | nonfunctional | yes |
| Pedido/Pago matrix | clarification | yes |
| SALE/CANCELLATION movement AK | nonfunctional | yes |
| Required Motivo for administrative movements | clarification | yes |
| Master entity deactivation semantics | clarification | yes |
| Email/SKU/code normalization | clarification | yes |
| Pago Referencia unique when present | nonfunctional | yes |
| AutoresSnapshot as an atomic, ordered historical string | clarification | yes |

These modifications are compatible with v1 scope and require no new entities. Upper conceptual bounds (e.g. maximum price, pages, lengths) are technical guards accepted in this baseline.

---

# 41. Dictionary completeness validation

| Question | Result |
|---|---|
| Do all 19 ERD entities have definitions? | Yes |
| Does every attribute have an unambiguous meaning? | Yes |
| Are mandatory/optional/conditional distinguished? | Yes |
| Have relevant conceptual ranges been established? | Yes |
| Has mutability been established? | Yes |
| Has sensitive data been identified? | Yes |
| Has normalization of commercial identifiers been established? | Yes |
| Is commercial history preserved? | Yes |
| Has country in addresses been resolved? | Yes |
| Has PedidoItem historical language been resolved? | Yes |
| Do Pedido and Pago have compatible states? | Yes |
| Is duplicate Edicion within Pedido prevented? | Yes |
| Is applying SALE/CANCELLATION twice prevented? | Yes |
| Was a Carrito state unsupported by any use case removed? | Yes |
| Were new out-of-scope entities introduced? | No |
| Were PostgreSQL types selected prematurely? | No |
| Do critical data-semantics TBDs remain? | No |

---

# 42. Approval criterion

The Data Dictionary v1.1 moves to **APPROVED BASELINE** status: corrections `DD-COR-001` through `DD-COR-012` are accepted and fed back into revision v1.1 of:

- Use Case Baseline;
- Logical ERD.

Once approved, data semantics must not be modified during implementation to suit the code. Any change must follow change management and traceability.

---

# 43. Next stage

With the Data Dictionary validated, the recommended sequence is:

```text
Use Case Baseline
        ↓
Logical ERD
        ↓
Data Dictionary
        ↓
Database API Contract
        ↓
PostgreSQL physical model
        ↓
Flyway
        ↓
SP / Functions / Triggers
        ↓
REST API Contract
        ↓
Implementation
```

The next document, **Database API Contract v1.0**, must define per use case:

- public PostgreSQL routine;
- type: Procedure or Function;
- input parameters;
- result;
- domain error codes;
- transaction;
- affected tables/entities;
- enforced invariants;
- expected functional permissions;
- idempotency/concurrency where applicable.

---

# 44. Document history

| Version | Date | Status | Description |
|---|---|---|---|
| 1.0 | 2026-09-23 | BASELINE CANDIDATE | First formal PLIEGO dictionary. Audits UCB v1.0 and Logical ERD v1.0, defines semantics for all 19 entities and resolves twelve defects/ambiguities before the physical model. |
| 1.1 | 2026-09-23 | BASELINE | Architectural review: finalizes canonical phone/language/country, cover attribution, Referencia lifecycle, invalid CANCELLED+PENDING matrix, CANCELLATION requiring previous SALE, low stock with threshold and DD-COR-012 traceability; feeds back into UCB/ERD v1.1. |

---

# 45. Project references

- `docs/requirements/use-case-baseline-v1.0.md`
- `docs/domain/logical-erd-v1.0.md`
- PLIEGO Architecture Baseline: Java 25 + Spring Boot + PostgreSQL + Flyway; PostgreSQL-centered business logic; no ORM; frontend implemented later and decoupled.
- ISO/IEC/IEEE 29148:2018 — Requirements Engineering.
- OMG UML 2.5.1 — conceptual modeling reference.
