# ADR-0014: One catalog entry and data-backed exploration controls

## Status

Accepted for public exploration refactor, 2026-10-02. Refines the exploration navigation
in ADR-0013; its persistent Header, search, account/cart and session contracts remain.

## Evidence and decision drivers

The local Google Store synthesis and primary evidence distinguish an editorial Home from
a filterable listing. Accessories uses a heading/results toolbar and grouped facets beside
the grid; categories/landings are navigation. The user authorizes direct reproduction of
compatible observed structure and behavior, preserving PLIEGO tokens and bookstore facts.
The real local API has three public themes, PAPERBACK/HARDCOVER, one language and one
price. The previous UI repeats equivalent catalog actions and always exposes weak facets.

## Decision

Keep `/` for editorial discovery and `/catalog` for comparing the full public listing.
The existing Header owns the sole general search. No permanent catalog query form,
category tabs, second search submit button or generic Home catalog CTA. Header provides
the global catalog destination; Home's content leads to real editions and real themes.

Home uses an eight-edition horizontal rail, using the existing paginated read and BookCard
controller. It has the observed Google Store discovery structure: full-width product row,
24px gaps, a next-product peek, previous/next controls and responsive touch scroll. No
invented popular, new or recommended rankings. Native scroll plus history-entry state
preserves horizontal position when returning from an edition; vertical restoration remains.

Catalog has one title/count/tools row followed immediately by its existing dense grid.
Topics and useful auxiliary facets appear only in a Mantine Drawer when requested. Topic
links remain editorial on Home; in the filter form they are single-choice radios matching
one category criterion. Drafts apply together. Reset clears topic/format/language/price,
keeping query and ordering. Applied criteria are plain removable text, never a permanent
chip navigation strip. Price ordering only appears when metadata varies or an existing
URL sort needs recovery. URL remains authoritative; all criterion changes reset page.
Back/forward/reload and edition returns retain context. No further API capabilities are
added by this correction beyond the formats metadata already implemented below.

BookCard, StockStatus, the edition projection/controllers and approved grid tracks remain
unchanged. New exploration surfaces use the existing Mantine theme, Roboto Flex,
Material Symbols and semantic light/dark roles. CSS stays local; obsolete exploration
selectors are removed with a CSS parser, preserving unrelated declarations.

## API-first addition

Extend GET `/api/v1/catalog/filter-options` additively with `formats`. A new V031 read
routine `pliego.fn_public_catalog_filter_facets()` returns languages, formats and price
bounds from all public editions, using the same visibility rules as V023. Keep V023 and
its routine unchanged. Controller → Service → JDBC Gateway remains; no business SQL in
Controller/Service, no JPA and no new deployment stack. One database read yields a
coherent metadata snapshot. Money stays strings at REST boundary. The frontend tolerates
an older response lacking formats by exposing no unverified format choices.

## Validation and tradeoffs

Metadata is global, not dependent faceting or facet counts; no unsupported promise of
disabling every empty combination. Matching editions remain authoritative. Verify public
visibility/empty metadata in PostgreSQL with rollback, API integration/OpenAPI, frontend
schema and draft/URL recovery, six widths in both themes, keyboard/touch and enlarged
text, then final backend/frontend build and E2E including the local API.
No human usability study or assistive-technology certification is implied by browser tests.
