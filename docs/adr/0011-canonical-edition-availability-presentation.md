# ADR-0011: Centralize edition availability presentation

## Status

Accepted for the authorized StockStatus production implementation, 2026-10-01.

## Context

Catalog, edition detail, favorites, cart and checkout repeated availability presentation. Cart/checkout shared a separate reason formatter; detail and card command handling classified the same SQLSTATEs separately. Catalog availability means a publishable edition with positive inventory; cart availability means the requested line quantity is covered. Treating P3002 as a general out-of-stock indicator loses that distinction.

PLIEGO's approved Mantine design system and BookCard contract require neutral text plus a Material Symbol, compact/normal typography, full explanations and no color-only meaning. Legacy production surfaces still have fixed light backgrounds, which are incompatible with the approved dark foreground aliases.

## Decision

- Own `StockStatus` and its pure resolver in the catalog domain; purchase and favorites reuse them.
- Keep canonical reason types at the shared API boundary, derived from the generated `CartItem` type. The cart validator consumes the one supported-code tuple. Generated contracts and backend routines are unchanged.
- Render only the backend-confirmed boolean and optional canonical reason. Never derive stock from quantities, active flags, permissions, missing covers or a command's failure.
- Resolve Spanish label, icon and explanation centrally. A separate pure command-feedback helper classifies the existing availability-conflict SQLSTATEs; it never produces an edition boolean. Containers still own queries, reconciliation and mutations.
- Require a boolean on edition-detail responses so malformed reads become read failures instead of false stock statuses.
- Use Mantine Text + the shared MaterialSymbol. The indicator has no focus or live-region behavior; callers own contextual announcements and descriptions.
- Apply existing semantic surface/text tokens locally to the migrated legacy metadata areas. Do not introduce a second theme or migrate unrelated pages, layout, controls or foundations.
- Make `/dev/theme` render the production component and resolver rather than maintain a second implementation.

## Consequences and validation

The API remains the owner of availability and cause precedence. Cart quantity conflicts and checkout recovery keep their existing transaction flow. Order-state indicators remain separate; successful cancellation reports returned inventory rather than promising publishability.

Verify with resolver/component/API-boundary tests, existing frontend tests and Playwright on the actual homepage/catalog/favorites/detail/cart/checkout routes in light/dark at 320–1920px. Check full explanations, contrast, overflow, keyboard/description semantics and enlarged text. Review must reject new label/icon/color mappings outside the resolver, production imports from `/dev`, and frontend stock calculations.
