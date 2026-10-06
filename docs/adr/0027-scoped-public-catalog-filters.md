# ADR-0027: Backend-authoritative catalog filter scopes

## Status

Accepted for the requested catalog scope pass, 2026-10-05. Extends ADR-0014's
global metadata contract with the product-type semantics established in ADR-0026.

## Context

Global, Libros, eBooks and Audiolibros share `/catalog` and the existing edition
search. Search already supports productType; discovery previously returned global
categories and facets for every collection. Frontend format filtering could hide
formats but could not correctly scope categories, languages or effective prices.

## Decision

Extend the existing `/api/v1/catalog/categories` and `/filter-options` endpoints
with optional `scope=GLOBAL|PHYSICAL|EBOOK|AUDIOBOOK`. Omitted scope is GLOBAL;
invalid or empty scope returns the existing Spanish validation problem.
Response shapes, money strings, public access and search semantics remain stable.

V050 adds scoped overloads of `fn_public_category_list` and
`fn_public_catalog_filter_facets`. PostgreSQL applies active book/edition states,
`fn_edition_listable`, `fn_edition_product_type`, effective `fn_edition_price`,
and active two-level category ancestry. No-argument discovery remains available.
The older language-row `fn_public_catalog_filter_options()` API remains unchanged.
Controller → read-only transactional service → JDBC gateway only binds scope;
no business SQL or eligibility rules move into Java or React.

CatalogPage derives scope from its existing URL productType, falling back to GLOBAL.
Both discovery query keys include scope. Existing controls consume backend options;
selected absent category/format/language criteria remain representable and removable.
No separate manual lists, page-derived facets, new visual interface, or counts.

## Consequences

Collections expose only their eligible discovery values and price bounds, regardless
of pagination. GLOBAL remains backward compatible for existing callers. Eligibility
means public catalog visibility, matching search: physical inventory may have zero
stock, while digital editions do not require inventory. Facets do not promise that
every combination of selected filters yields results; search and empty states remain
authoritative. Separate category/facet reads retain the existing consistency model.

Database, HTTP/OpenAPI, adapters, URL/cache transitions, selected-filter recovery,
and browser tests guard this boundary. Approved baselines and earlier migrations
are unchanged; the additive migration must be applied before using the new backend.
