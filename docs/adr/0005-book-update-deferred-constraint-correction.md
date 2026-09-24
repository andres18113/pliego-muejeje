# ADR-0005: Correct deferred-constraint statement in sp_book_update

## Status

Accepted as a forward-only correction required by the approved Database API semantics.

## Date

2026-09-23

## Context

The approved `sp_book_update` procedure (V014) defers `uq_libro_autor_orden`
with an unqualified `SET CONSTRAINTS uq_libro_autor_orden DEFERRED` statement.
PostgreSQL cannot resolve that table-constraint name while `search_path`
excludes the `pliego` schema, so every call failed with SQLSTATE 42704
(`constraint "uq_libro_autor_orden" does not exist`) and the REST layer
faithfully surfaced HTTP 500 with a Spanish non-disclosing problem. The I12
live gate reproduced this on PostgreSQL 18 via `PUT
/api/v1/admin/books/{bookId}` and via direct `CALL pliego.sp_book_update`.

## Decision

Add V021 to replace only the procedure body. Keep the approved name,
signature, actor checks, locks, validations, snapshot rebuild, and public
semantics. Replace the unqualified statement with `SET CONSTRAINTS ALL
DEFERRED`: `uq_libro_autor_orden` is the only `DEFERRABLE` constraint in the
schema, so exactly that constraint is deferred to `COMMIT`, preserving the
approved intent. Preserve V001–V020 byte-for-byte.

## Consequences

- PostgreSQL remains the authority for book replacement, author-order
  validation, and snapshot consistency.
- Existing databases receive the correction through Flyway without changing
  the approved API surface.
- New installations apply the original migrations and then corrective
  V020–V021 migrations.

## Validation

- Direct `CALL pliego.sp_book_update` on PostgreSQL 18 succeeds, including a
  multi-author reorder; duplicate author order is still rejected with P2034.
- The `full_journey_http_gate.py` live gate exercises `PUT
  /api/v1/admin/books/{bookId}` twice and now passes end to end.
