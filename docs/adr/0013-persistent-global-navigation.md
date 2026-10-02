# ADR-0013: Persistent global navigation in the application layout

## Status

Accepted for the global Header refactor, 2026-10-02.

## Context

CatalogHeader mixed global navigation, native search-dialog lifecycle, category navigation,
customer identity and cart reads in a catalog-owned component. Pages mounted their own
copies, including auth and purchase variants. Navigation remounted the chrome, and scroll
changed its geometry. The existing Mantine provider, semantic light/dark roles, Material
Symbols, REST client, session controller and TanStack Query caches are reusable foundations.

## Decision

ApplicationLayout owns one SiteHeader under SessionProvider. It persists across ordinary
route transitions. The root route error boundary owns its fallback SiteHeader and supplies
its own SessionProvider. Pages own their main content and footer, without a second Header.
The header is an app-level integration boundary in `src/app/navigation`, with
CatalogNavigation, HeaderSearch and HeaderAccount/Cart components and scoped CSS.

One discriminated panel state coordinates categories, search and account; route changes
close panels without overriding the route-heading focus policy. Mantine supplies the
Popover, Modal, Menu, buttons and input. Category navigation remains normal links in a
non-modal disclosure; account implements menu keyboard behavior; search contains focus
until closed. Escape and explicit close restore the invoker, while navigation and outside
presses let focus follow the destination. No hover-only controls or global keyboard shortcut.

The header has stable geometry (76px desktop/tablet, 64px at 600px and below). Scroll over
8px adds token-based elevation without moving controls or hiding navigation. Categories
use a content-sized multi-column panel, changing to expandable lists on mobile. All
category depths and orphan/cyclic recovery remain reachable. Loading, empty and failure
states retain a full-catalog escape. Category queries load on demand and share catalog cache.

Search is global: both suggestions and submission search titles, authors and ISBN through
the approved `que` REST parameter, without unrelated filters. The URL preloads the current
query; suggestions debounce 220ms and cancel obsolete reads. Detail links carry the global
search destination in `from`. The customer cart reuses its existing query; guest cart opens
the existing customer gate. ADMIN gets its administrative destination rather than a cart.
Session persistence, logout, favorites, cart mutations and business APIs are unchanged.

## Tradeoffs

The expanded category panel is justified by the bookstore taxonomy; promotional/image
trays from the reference would add unrelated visual load. One short-lived search modal
protects query and suggestion focus on all sizes, at the cost of one explicit search action.
Mantine semantic tokens also expose the pre-existing difference between the current
Mantine design foundation and older pine/paper page styles. This refactor scopes theming
to the Header and does not migrate the business pages or rewrite approved design baselines.

## Validation

Vitest verifies category recovery and existing route behavior. Playwright covers one Header
per production route, persistence on client navigation, 320/375/768/1024/1440/1920px in
both themes, stable scroll geometry, keyboard, touch, panel coordination and real API flows.
Build includes TypeScript checking. Browser evidence does not certify screen-reader or
whole-site WCAG conformance; those need a scoped human/assistive-technology evaluation.
