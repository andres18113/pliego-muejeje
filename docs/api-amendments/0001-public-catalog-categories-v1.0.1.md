# Public Catalog Categories — API Amendment v1.0.1

**Status:** Active additive amendment to the approved PLIEGO v1 contracts  
**Applies to:** backend-v1.0.0 REST base path `/api/v1`  
**Related shape:** [Public catalog homepage proposal](../frontend/public-catalog-homepage-v1.0.md)  
**Source baselines:** [REST API Contract v1.0](../../rest-api-contract-v1.0.md), [Database API Contract v1.0](../../database-api-contract-v1.0.md), [DB Routines Catalog v1.0](../../db-routines-catalog-v1.0.md)

This forward-only amendment closes the public category-discovery and category-filter state gaps. It leaves the approved baseline documents and V001–V021 migrations unchanged. The executable OpenAPI contract is generated from the Catalog controller at `/v3/api-docs`.

## REST contract

### `GET /api/v1/catalog/categories`

Public; no bearer token required. Returns the complete flat hierarchy used for catalog navigation. It is not paginated because the client needs the whole parent/child list to build the navigation tree.

```json
{
  "items": [
    { "slug": "literatura", "name": "Literatura", "parentSlug": null },
    { "slug": "novela", "name": "Novela", "parentSlug": "literatura" }
  ]
}
```

`slug` is the stable value used by the existing catalog `category` query parameter. `name` is the display name. `parentSlug` is null for a root and contains the root slug for a subcategory. No database ID, administrative state, description, or empty category is exposed.

The endpoint returns categories that are ACTIVE, have an ACTIVE parent when they are subcategories, and can lead to at least one publicly listed edition. Public listing uses the catalog's existing publication boundary: active Book and Edition with an Inventory row. Stock quantity does not affect category visibility; an edition with zero stock remains a public listing and its category remains navigable.

Results are ordered by root display name, root before its children, then category display name and slug. The hierarchy remains limited to the existing two-level category model.

### `GET /api/v1/catalog/editions?category={slug}`

Existing query parameter with explicit state semantics:

| Category filter | Result |
|---|---|
| Malformed slug | Existing validation response: `400 VALIDATION_ERROR` (`application/problem+json`). |
| Syntactically valid slug that does not exist | `200 OK` with an empty `PageResponse`. This preserves the deliberate v1 unknown-slug behavior. |
| Existing category is INACTIVE | `409 Conflict`, wire code `P2022` (symbolic mapping `CATEGORY_INACTIVE`), using the existing Problem Details mapping. |
| Existing subcategory is ACTIVE but its parent is INACTIVE | Same `409` / `P2022` response because the subcategory is not publicly browsable outside its parent. |
| Existing ACTIVE category with no editions matching the other filters | `200 OK` with an empty `PageResponse`. |
| ACTIVE root category | Matches editions assigned directly to that root or to one of its ACTIVE direct children. Editions associated only with inactive children are excluded from that category-filtered result. |
| ACTIVE subcategory | Matches editions assigned directly to that subcategory. |

An inactive category's retained book associations continue to exist. They do not make that category appear in public navigation or cause its editions to match the inactive category filter. Those editions can still appear in an unfiltered catalog query or through another active category association, subject to the existing active Book/Edition publication rules.

The unknown-slug empty-page behavior is an intentional baseline rule documented in v1.0. The distinction added here is that a known inactive category is a domain-state conflict, not an empty search result. The Problem Details `code` field continues to carry the SQLSTATE; the symbolic database error name is documentation shorthand.

## Database API amendment

### `fn_public_category_list()`

New read-only public Database API function:

```text
fn_public_category_list()
-> RecordSet<PublicCatalogCategory>

PublicCatalogCategory:
  category_slug          : Slug
  category_name          : Text
  parent_category_slug   : Slug?
```

It returns only public-browseable categories as defined above. It reads category, book-category, book, edition, and inventory state in PostgreSQL. It does not expose inventory quantities and has no persistent side effects.

### `fn_catalog_search`

V022 replaces the implementation without changing its signature or catalog summary result shape. When the normalized category slug identifies an INACTIVE category, or an ACTIVE child whose parent is INACTIVE, it raises the established `P2022 CATEGORY_INACTIVE` domain error. A syntactically valid unknown slug continues to return zero rows. Category matching now considers only ACTIVE categories with an ACTIVE parent path; root slugs still include ACTIVE direct children.

## Implementation mapping

- Flyway migration: `V022__public_catalog_categories.sql`; prior approved migrations are unchanged.
- REST path: `CatalogController` exposes `GET /catalog/categories`; existing edition routes retain their paths.
- Application flow: `CatalogController → CatalogService → CatalogGateway → JdbcCatalogGateway → fn_public_category_list`.
- Error handling: `P2022` is already mapped to HTTP 409 / symbolic `CATEGORY_INACTIVE` and rendered through the existing Spanish Problem Details handler. No new SQLSTATE, error format, or Java business rule is introduced.
- OpenAPI: Springdoc publishes the category schema and the catalog-search `409` response from the controller annotations.

## Discovery lead decision

The approved “Catálogo familiar” direction does not require a backend-selected featured edition. Keep the discovery lead editorial and generic; do not promote the first alphabetically sorted edition as a featured item. No featured-edition endpoint or database routine is added.
