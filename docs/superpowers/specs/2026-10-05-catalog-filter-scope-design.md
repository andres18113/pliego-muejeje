# Scoped catalog filter contract

The requested catalog pass extends existing discovery, without visual redesign.
`GET /api/v1/catalog/categories` and `/filter-options` accept optional `scope`:
`GLOBAL` (default), `PHYSICAL`, `EBOOK`, `AUDIOBOOK`. Response shapes stay unchanged.
The three product scopes reuse search's `productType` semantics; global means all types.

PostgreSQL owns scoping through overloads of existing discovery routines in V050.
Eligible editions have active books and editions and satisfy `fn_edition_listable`.
Physical editions with inventory and zero stock remain visible, matching search.
Digital formats do not require inventory. No new publisher, cover, asset, or stock
restrictions are introduced. `fn_edition_product_type` owns format classification;
facet price bounds retain `fn_edition_price`. Active category ancestors appear when
their own association or an active child's association contains an eligible edition.
No facet counts are introduced. Existing no-argument database contracts remain valid.

Controller → transactional application service → JDBC gateway remains unchanged.
Scope is validated at REST and database boundaries. Spanish validation feedback and
existing P1001 mappings remain. Search and ranking routines are unchanged.

The frontend derives scope from URL productType, sends it for both discovery reads,
and keys both caches by scope. It consumes authoritative options without filtering
formats in React. Selected category, format, language, and price criteria remain in
URL/draft state even when absent from discovery, with recoverable selected controls.
Home and offers keep their existing calls/defaults. Cards, checkout, unrelated routes,
approved root artifacts and earlier migrations remain untouched by this pass.

Verification covers all four scopes, inactive and unlistable editions, hierarchy,
effective prices, empty metadata, omitted scope compatibility, invalid scope,
selected filters, cache switching, API/OpenAPI, and browser navigation. Use an isolated
PostgreSQL 18 test database and retain complete logs. Do not commit, push, or deploy.
