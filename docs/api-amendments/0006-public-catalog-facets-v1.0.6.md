# Public catalog facets — additive contract amendment v1.0.6

Date: 2026-10-02. Approved v1 root baselines and V023 remain unchanged.

GET `/api/v1/catalog/filter-options` now additionally returns `formats`, a sorted unique
array of `HARDCOVER` / `PAPERBACK` values actually present in the public catalog. The
existing `languages`, `minimumPrice`, `maximumPrice`, authentication and error contracts
remain. No availability, author, publisher, recency or promotion filter is introduced.

Example with current local data:

```json
{"languages":["es"],"formats":["HARDCOVER","PAPERBACK"],"minimumPrice":"20.00","maximumPrice":"20.00"}
```

V031 introduces `pliego.fn_public_catalog_filter_facets()`, one stable public read through
the JDBC Gateway under the existing Spring read transaction. It aggregates all ACTIVE
editions of ACTIVE books with inventory rows, matching V023 visibility. Zero available
stock does not unpublish an edition. The empty response has both arrays empty and prices
null. Price values stay decimal strings at the JSON boundary; no schema table changes.

This is global discovery metadata, not query-dependent faceting or counts per value.
Clients must not infer a value missing from one paginated edition result. The frontend
tolerates older responses without formats by treating format metadata as absent; it never
substitutes invented choices. Existing active URL criteria remain removable.

Validation: PostgreSQL rollback gate `catalog_filter_facets_gate.sql`, backend catalog API
integration/OpenAPI tests, generated frontend client schema and public exploration E2E.
See [ADR-0014](../adr/0014-public-exploration-and-real-catalog-facets.md).
