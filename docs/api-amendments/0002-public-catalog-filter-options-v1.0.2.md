# Public Catalog Filter Options — API Amendment v1.0.2

**Status:** Active additive amendment to the approved PLIEGO v1 contracts  
**Applies to:** backend-v1.0.0 REST base path `/api/v1`  
**Source baselines:** [REST API Contract v1.0](../../rest-api-contract-v1.0.md), [Database API Contract v1.0](../../database-api-contract-v1.0.md), [DB Routines Catalog v1.0](../../db-routines-catalog-v1.0.md)

This forward-only amendment adds database-backed public catalog filter options. It leaves the approved baseline documents and V001–V022 migrations unchanged.

## REST contract

### `GET /api/v1/catalog/filter-options`

Public; no bearer token required. Returns every language code and the inclusive minimum/maximum price among currently public editions.

```json
{
  "languages": ["en", "es"],
  "minimumPrice": "4.50",
  "maximumPrice": "38.00"
}
```

`languages` contains sorted, distinct codes from active editions joined to active books and inventory. A zero-stock edition remains part of the public catalog and contributes its language and price, matching `fn_catalog_search`. When there are no public editions, `languages` is empty and both price bounds are `null`. Money remains a decimal string at the JSON boundary.

## Database API amendment

### `fn_public_catalog_filter_options()`

New read-only public Database API function:

```text
fn_public_catalog_filter_options()
-> RecordSet<PublicCatalogFilterOption>

PublicCatalogFilterOption:
  language_code   : ISO-639 code?
  minimum_price   : Money?
  maximum_price   : Money?
```

The function reads the same active Book, active Edition, and Inventory publication boundary as public catalog search. It returns one row per distinct language and repeats the global price bounds on each row. With no public editions it returns one row with a null language and null bounds, allowing the REST response to return an empty language list and null bounds.

## Implementation mapping

- Flyway migration: `V023__public_catalog_filter_options.sql`; prior approved migrations are unchanged.
- REST path: `CatalogController` exposes `GET /catalog/filter-options`.
- Application flow: `CatalogController → CatalogService → CatalogGateway → JdbcCatalogGateway → fn_public_catalog_filter_options`.
- OpenAPI: Springdoc publishes the new response schema from the controller annotation.
