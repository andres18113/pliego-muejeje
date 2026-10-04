# ADR-0015: Rebuild the public storefront from Google Store evidence

## Status

Accepted for the explicitly authorized storefront replacement, 2026-10-02. Supersedes
the visual composition and drawer-only desktop facets in ADR-0014. Its API, URL,
availability and transaction decisions remain applicable.

## Evidence

The primary sources are the local Google Store distillation and evidence archive,
the saved Home and Pixel pages, and all five navigation HTML/CSS archives. File names
and SHA-256 hashes are in `docs/audit/storefront-2026-10-02/sources.json`. The available
DOCX has no `(1)` suffix; the requested evidence ZIP does exist with `(1)`.

Measured reference patterns include a 1392px navigation capsule, 60px desktop / 52px
compact height, a 12px top offset, a 1280px navigation breakpoint, 32px capsule radius,
28px panel radius, 32px mega-menu column gaps, and 24px product gaps. Editorial headings
use 60/68px and 48/56px at desktop, 32/40px and 28/34px in compact layouts. Accessories
uses square product surfaces, a facet sidebar, and three columns. Popular products use
rounded portrait surfaces and a horizontal rail. These are separate visual treatments.

## Decision

- Keep React, Mantine, Roboto Flex, Material Symbols, the installed PLIEGO blue palette
  and its semantic light/dark colors. Declare the already installed Mantine hooks package
  directly for responsive composition; its version is unchanged.
- Keep one persistent SiteHeader. Desktop categories are native links/buttons in a
  disclosure, opened by delayed hover, click, Enter or ArrowDown. Hover preserves focus;
  Escape and outside click close it. Compact navigation uses a Mantine modal with back
  navigation, scroll containment and focus restoration. Only one header layer is open.
- Replace the normal header temporarily with the global search capsule. Its real catalog
  suggestions are debounced and cancellable. Arrow keys, Tab, Enter and Escape work;
  submitted global searches clear unrelated facets exactly as before.
- Replace the text introduction with a commercial hero using real category cover data,
  one catalog CTA, an eight-edition horizontal rail, and image-led category destinations.
  Do not describe alphabetic discovery data as popular, new or recommended.
- Give `/catalog` three product columns from 600px and two below it. At 1024px and above,
  facets live in a compact sidebar with collapsed groups. Single-choice facets apply on
  selection; monetary input requires explicit validation and submission. Compact filters
  retain their cancellable draft and explicit apply action inside a drawer.
- Keep query/category in the page heading and their clear action beside it; do not repeat
  that same criterion as another label. Other applied criteria remain removable text.
  Ordering appears only when real price metadata makes it useful or an existing URL
  order needs recovery. Changes reset pagination, preserving existing URL semantics.
- Add an opt-in storefront presentation to the controlled BookCard. Its projection,
  cart/favorite controllers, mutation recovery and canonical StockStatus resolver stay
  shared. Favorites and diagnostic surfaces keep their existing presentation.
- Preserve cover containment, product price and stock from the API, return navigation,
  horizontal rail state, vertical scroll restoration and Spanish feedback. No API or
  database changes are needed. Detail, cart and checkout only receive the global header.

## Intentional differences

Real book covers replace device photography and video. Three real categories replace
Google's device families; no extra commercial destinations are fabricated to fill columns.
Book formats are single-choice radios because the existing API accepts one format, not
multiple selections. Price ordering stays PLIEGO's supported title/price contract instead
of Google's unsupported Featured/Newest options. Publication rankings, swatches, grid
density toggles and promotional claims are omitted because the task does not justify
those capabilities. Dark mode uses the existing PLIEGO semantic colors; the reference
package does not provide a paired dark version of every public Google screen.

## Verification

Build, unit tests, E2E and visual evidence are recorded in the storefront audit. Actual
Home/catalog, scrolled navigation, search and categories are captured at 320, 375, 768,
1024, 1440 and 1920 CSS pixels in both themes. Browser keyboard and touch checks cover
layers, focus, facets, history, transaction recovery, cover failures and 200% text.
No screen-reader conformance claim is inferred from browser automation.
