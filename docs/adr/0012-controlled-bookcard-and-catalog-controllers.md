# ADR-0012: Controlled BookCard and catalog action controllers

## Status

Accepted for the authorized BookCard v1 production migration, 2026-10-01.

## Context

The approved BookCard v1 contract defines edition presentation, one native navigation link, permanent sibling actions and responsive behavior. The production EditionCard mixed this anatomy with mutation-aware buttons, duplicated navigation and hover-only cover overlays. Favorites fabricated an EditionSummary with an ISBN value it did not receive. The development probe maintained a second card and cover-URL guard.

## Decision

- Implement BookCard as a controlled catalog-domain view. Its dependencies are Mantine, Material Symbols, shared BookCover and StockStatus; it has no session, query, mutation or catalog-grid responsibilities.
- Use one pure `toBookCardData` adapter for the common catalog/favorite edition projection. Preserve opaque string IDs, exact decimal-string formatters, author snapshots and provenance.
- Keep authentication, deferred intentions, optimistic favorite updates, rollback, cache invalidation and cart reconciliation in `useBookCardActions`, called by `CatalogBookCard`. The detail favorite button reuses the favorite controller.
- Preserve existing `from`, `catalogReturn`, `coverPreview` and modified-click scroll behavior. The grid and route own list items, columns, shell and loading placeholders.
- Reuse BookCover's existing public-HTTPS policy and decode cache. Its card presentation always contains the artwork, reserves 2:3 and supplies a decorative thumbnail; detail/compact presentations retain their established behavior.
- Represent API quantity/permission constraints as restricted cart actions, not a fabricated general stock boolean. An unresolved POST outcome requires a read; if it cannot be confirmed, block another POST and offer the cart route. Commands have no automatic retry.
- Make the diagnostic render BookCard itself, with simulated controllers only. Remove the previous card markup, hover-overlay styles, duplicate cover guard and fabricated favorite DTO.

## Validation

Component tests run without query/session providers. Adapter tests cover favorite inputs and large string IDs/money; cover tests preserve shared URL handling and forbid cropping in card mode. Production-route browser tests cover the approved grid, keyboard order, complete accessible identity, cover geometry, independent actions, deferred authentication, rollback, cart uncertainty and return context. Run the complete frontend unit and configured browser suites, reporting their existing EditionDetailPage failures and backend-dependent live skips explicitly.

Approved foundations, API contracts, database routines and backend boundaries are unchanged.
