# ADR-0008: Keep cover delivery URLs separate from unresolved licensing provenance

## Status

Accepted

## Date

2026-09-27

## Decision Drivers

- Serve prepared cover assets from the public PLIEGO CDN using the existing Edition cover URL field.
- Keep licensing, source, and attribution metadata null when the available data does not establish them.
- Use the existing Edition model and REST contract without adding a separate media store.

## Considered Options

1. Treat the CDN URL as proof of licensing and populate licensing metadata.
2. Add a separate cover delivery model and new API fields.
3. Allow a delivery URL while licensing and provenance fields remain independently nullable.

## Decision Outcome

**Chosen option**: Allow `portada_url` to identify the delivery asset when all licensing and provenance fields are null. Existing validation remains in force when licensing metadata is supplied.

The cover preparation pipeline generates `cover_url` from each manifest object's key. The existing ADMIN seed flow applies those URLs to Edition rows that already exist. Catalog search and Edition detail continue returning the same `coverUrl` field backed by `portada_url`.

### Positive Consequences

- Prepared assets can be displayed without inventing license, source, or attribution claims.
- Catalog and detail views share the URL stored on the Edition.
- New manifest entries flow through generated seed data and the importer without per-edition code changes.

### Negative Consequences

- A displayed asset can have unknown licensing provenance; catalog operators must add verified metadata when it becomes available.
- Cover URL validation no longer requires licensing metadata when all such fields are unresolved.

## Validation

- The V024 PostgreSQL gate creates an Edition with a delivery URL and null provenance, then verifies search and detail return the same URL.
- Cover pipeline and seed sync tests verify URL derivation, dynamic manifest iteration, idempotency, and preservation of null metadata.
