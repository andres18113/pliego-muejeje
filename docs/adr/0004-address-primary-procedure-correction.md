# ADR-0004: Correct primary address replacement in PostgreSQL

## Status

Accepted as a forward-only correction required by the approved Database API semantics.

## Date

2026-09-23

## Context

The approved `sp_address_set_primary` procedure changed old and new primary flags in one `UPDATE`. PostgreSQL's non-deferrable partial unique index can check the new row before the old primary row is cleared, causing a duplicate-key failure. A PostgreSQL 18 smoke test reproduced this while the REST contract requires atomic replacement and idempotent setting.

## Decision

Add V020 to replace only the procedure body. Keep the approved name, signature, actor checks, customer lock, P1103 behavior, and public semantics. Clear any previous primary first, then set the requested address in the same procedure transaction. Preserve V001-V019 byte-for-byte.

## Consequences

- PostgreSQL remains the authority for primary-address uniqueness, ownership, locking, and atomicity.
- Existing databases receive the correction through Flyway without changing the approved API surface.
- New installations apply the original migrations and then the corrective V020 migration.

## Validation

- PostgreSQL 18 integration smoke replaces a primary, repeats the same-primary operation, and verifies the database contains at most one primary address.
