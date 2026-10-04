# ADR-0016: Digital editions and stockless availability

## Status

Accepted — 2026-10-03, implemented under the requested digital-format extension.

## Context

Edition formats currently imply physical inventory in discovery, cart and sales.
Digital content is simulated; categories remain thematic and covers remain edition assets.
The PostgreSQL Database API owns invariants and Spring owns transactions.

## Decision

- Extend formats to PAPERBACK, HARDCOVER, EBOOK and AUDIOBOOK in V032 only.
- Keep minimal typed columns on `pliego.edicion`: optional `ebook_formato` (EPUB/PDF),
  `audio_duracion_segundos` (positive integer), and ordered `audio_narradores` (typed
  text array, 1–32 nonblank names of at most 200 characters for AUDIOBOOK).
  Narrator names have no independent identity or administration in this scope;
  a typed array avoids both unstructured JSON and an unnecessary performer catalog.
- Physical editions require pageCount and prohibit digital metadata. EBOOK may
  omit pageCount and ebookFileFormat; AUDIOBOOK prohibits pageCount and requires
  duration and narrators. Missing metadata is never fabricated.
- Digital editions have no inventory row. Availability is active book + active
  edition. Physical availability still requires enough physical stock. Shared
  database predicates centralize these rules. Digital cart quantities are exactly one.
- Changing between physical and digital fulfillment is prohibited (P2048), including
  direct database writes. Create another edition of the same work instead. Changes
  within either family remain possible with coherent replacement metadata.
- Preserve existing SQL command signatures through delegating overloads. Extend
  read routine results and REST DTOs additively. Admin digital stockActual is null.
- Checkout remains the existing simulated payment/order workflow, including its
  required address and logistics states. It snapshots digital formats but never
  checks, deducts or restores digital stock. Cancellation restoredUnits counts
  physical units only. No digital fulfillment or entitlement is implied.

## Consequences

Existing physical data and stock behavior need no manual changes. Narrators are
ordered names, not author/category assignments. EPUB/PDF describe the simulated
edition; they do not identify uploaded files. Existing frontend clients must be
extended separately before displaying digital records.

## Validation

PostgreSQL gates cover upgraded physical data, constraints, legacy SQL overloads,
stockless catalog/facets/favorites/cart, mixed checkout/cancellation and inventory
rejection. Live HTTP gates exercise real JDBC bindings and REST/OpenAPI schemas;
existing physical SQL, concurrency and HTTP gates and cover pipeline tests remain required.
