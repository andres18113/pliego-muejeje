<!-- Updated from the implemented frontend on 2026-09-27. The approved “Catálogo familiar” seed remains the visual direction. -->

---
name: PLIEGO
description: A familiar, editorial bookstore experience for discovering book editions.
---

# Design System: PLIEGO

## Status and visual direction

**Creative North Star: “La librería clara y cercana.”**

The approved first expression, **Catálogo familiar**, remains the visual direction. Preserve its search-first bookstore structure, deep pine and clear paper palette, literary serif paired with a plain sans serif, flat reading surfaces, light dividers, book-like square geometry, and restrained shadows on covers. Production details below describe the public catalog, edition detail, sign-in, registration, cart, checkout, and order confirmation surfaces as implemented.

The frontend source of truth for these rules is `frontend/src/styles.css` and the catalog, auth, and purchase components. The design foundation uses Tailwind CSS 4 and shadcn/ui with Base UI shared controls; their appearance follows the PLIEGO styles.

`CatalogHeader` and `SiteFooter` provide the shared route chrome; sign-in, registration, and checkout use the compact header mode. Cart and order confirmation retain the catalog header and its bookstore navigation.

Notion, Banco Guayaquil, and Stripe remain references for hierarchy, direct Spanish-language copy, and page rhythm. PLIEGO keeps its own bookstore structure, content, and visual tokens. The shared palette and type foundation can carry into administrative work, while navigation and density remain task-specific; this review does not define an administrative page system.

The production catalog order is masthead with search and account actions, category navigation, a wide editorial sage lead, then sort, filters, and edition results. The lead orients the reader to the PLIEGO brand and the editorial character of discovery; it is not a product promotion. It does not require a featured book cover. Catalog results are open jacket-and-facts groups rather than dashboard cards. A manual cover may display when its URL is safe and its license is explicit. Show attribution and license only when the backend supplies them; never infer rights. Missing, unsafe, or failed covers use a quiet “Portada no disponible” treatment, never synthetic jacket art.

## Colors

The production tokens retain the approved seed values. Use semantic roles rather than copying hex values into individual components.

| Token | Value | Role in the implemented UI |
|---|---|---|
| `--pine` | `#24513f` | Primary action, links, available status, selected category text, price range, and selection. |
| `--forest` | `#203d32` | Hover state for primary actions and links; wordmark color; foreground for sage accents. |
| `--terracotta` | `#913b2d` | Small editorial emphasis in the discovery title and empty-state rule. It does not mean success, error, or availability. |
| `--ink` | `#202923` | Main text and control text. |
| `--secondary-ink` | `#545e57` | Supporting copy, labels, metadata, and placeholders. |
| `--paper` | `#fafbf8` | Page and control background. |
| `--sage` | `#e8eee8` | Secondary panels, hover surfaces, fallbacks, loading covers, and selected-category tint. |
| `--cover-sage` | `#cfdbd1` | Base behind catalog and detail covers. |
| `--divider` | `#d2d9d2` | Structural rules and quiet outlines. |
| `--border` / `--input` | `#748276` | Native text, search, and select control borders. Both tokens currently share a value. |
| `--error` | `#7e281f` | Validation and request error messages and server-error outline. |
| `--unavailable` | `#6f352d` | Unavailable edition status, paired with text and an unfilled marker. |
| `--focus` | `#143ecb` | Visible keyboard focus on the light production surfaces. |
| `--focus-on-dark` | `#f3ca72` | Reserved only for a real dark utility surface if one is required in the future; no production surface currently uses it. |

Tailwind aliases map background/card/popover to paper, foreground to ink, primary to pine, secondary/muted/accent to sage, destructive to error, and ring to focus. Primary and destructive foregrounds are white; muted foreground is secondary ink; accent foreground is forest.

Available status uses pine text and a filled circular marker. Unavailable status uses the separate unavailable tone and an outlined marker. Success feedback uses pine; neutral progress uses secondary ink; errors use error. State is always named in text, not communicated by color alone.

The approved values retain their documented contrast: ink on paper 14.41:1, secondary ink on paper 6.49:1, white on pine 9.04:1, terracotta on sage 6.22:1, error on paper 9.15:1, unavailable on paper 9.10:1, and blue focus against paper 7.83:1 and sage 6.91:1. Input borders measure 3.89:1 against paper. Keep normal text at or above 4.5:1 and large text at or above 3:1.

## Typography

Inter Variable is the interface and reading sans serif, with Inter and system sans-serif fallbacks. Literata Variable is the editorial serif, with Georgia and a serif fallback. Both variable faces are loaded for weights 100–900, including Latin Extended; the implemented faces are upright.

| Use | Implemented treatment |
|---|---|
| Catalog discovery title | Literata 400; 40–55px with 1.02 line height on wide screens. At phone widths it scales to 38–48px, then holds at 38px under 480px. Terracotta highlights only a short phrase. |
| Edition detail title | Literata 400; 34–48px, 1.08 line height. The subtitle is Literata at 20px. |
| Auth page title | Literata 400; 37–46px, 1.1 line height. |
| Section headings | Literata 400; generally 19–27px. Synopsis and category headings are 21px. |
| Wordmark | Literata 700, 25px, 0.1em tracking with a small, bold Inter “CATÁLOGO” line. The footer wordmark is 17px. |
| Body and functional copy | Inter 400; base size 14px and 1.55 line height. Introductory copy is 14–15px; edition-detail authors are 16px. |
| Controls, navigation, and metadata | Inter, usually 11–13px. Labels use 600 weight; prices and key values use 650–700. Auth inputs use 16px text. |
| Edition cards | Edition title is Inter 650 at 13px/1.3; author, publisher, and format are Inter 12px/1.45. The jacket and detail-page title carry the literary voice; card facts stay functional. |

Keep long synopsis and body copy near 65–75 characters per line where the layout allows; the detail synopsis is capped at 68ch.

## Layout and spacing

The centered page frame is at most 1440px wide, with 42px side insets on wide screens and 18px at widths up to 740px. The public catalog is spacious but direct: sections are separated by whitespace and thin rules, with no general-purpose container shadows.

Use the shared sizing tokens for repeated controls and borders: `--control-min-height` is 44px, `--auth-control-min-height` is 48px, `--border-width` is 1px, and `--radius` is 2px.

The desktop masthead is a 106px minimum, three-part grid for wordmark, search, and account actions. The search pairs a scope select, query field, and primary button. Category navigation follows it. Root categories use bordered square-edged tiles in a flexible grid; selected roots use a pine border and pale sage tint. Child categories open in a small paper popover. The discovery lead is a sage panel with one text column, a 226px minimum height, and a short title and introduction. The result controls put the sort select opposite the catalog heading; filter fields sit between thin rules. Results use four columns above 1050px, three from 741–1050px, and two at 740px and below.

Catalog jackets keep a 0.72 width-to-height ratio and a 230px maximum width on wide screens. Grid gaps are 30px vertically and 24px horizontally, tightening to 27px/18px on small screens and 24px/14px below 480px. Catalog metadata stays grouped directly beneath each cover. Use a soft offset shadow on the jacket only: catalog covers use `0 9px 20px rgb(28 37 30 / 14%)`; detail covers use `8px 12px 21px rgb(31 44 38 / 22%)`. Missing-cover fallbacks have no detail-cover shadow.

Edition detail is a centered, two-column reading layout, at most 1080px wide, with a cover column capped at 355px and a generous fluid gap. The right column leads with title, author, publisher, price, availability, and edition facts before synopsis and categories. At 480px and below the cover centers above the copy and is capped at 290px.

Sign-in and registration use the compact masthead, with the wordmark but no search or account links. The form column is centered and capped at 480px. Registration presents its successful result in the same column, replacing the form with a confirmation and sign-in action.

### CUSTOMER purchase layout

The cart uses an open two-column layout: a ruled list of books and a sage summary up to 340px wide. Each row starts with a small jacket, then title, author, current unit price and availability; quantity controls, current subtotal and removal stay with that book. Covers retain the jacket-only shadow. The heading warns that cart stock is not reserved. The summary shows units, current total, and the action to continue. An unavailable book keeps its row and a named status; the summary explains the blocker instead of offering checkout.

Checkout keeps a single reading sequence: current order summary, delivery address, payment method, academic outcome, and final order action. Above 900px the order summary is a sage sidebar beside the form. At 900px and below it becomes a native disclosure before the form, with units and total always visible. Sections use top rules and Literata headings. Saved addresses are full-row radio choices showing alias, recipient, address and phone; the primary address is preselected when available. A new address opens an inline form, with two fields per row where space allows. The saved address is then selected for this purchase.

Payment choices are radio rows. Card shows one transient test-number field and help text; transfer shows a short no-extra-data note. The academic simulation is a separate section with explicit approved and rejected results, their effects on order, stock and cart, and a statement that PLIEGO does not charge money. The final button includes the current total. The confirmation page leads with the order result, then order number, total, payment method/reference, item snapshot and delivery snapshot. The rejected simulation has a clear route back to the active cart.

## Components and states

### Buttons and links

Buttons are square-edged with a 2px radius, 44px minimum height, 9px/16px padding, 9px icon gap, and 650 weight. The primary button is pine with white text and changes to forest on hover. The secondary button is transparent with a pine outline and text; hover adds sage and forest text. Auth form actions are full width and 48px high. Disabled or aria-disabled buttons use 0.72 opacity and a progress cursor.

Use the shared `Button` component’s primary, secondary, and text variants for matching task actions. Use `ButtonLink` when the action navigates, preserving anchor semantics while sharing the same appearance.

Text actions and account links stay visually light and underlined where they need link affordance. Hover changes pine to forest or adds a sage background; selected category navigation uses text and surface changes rather than pill styling. Keep interactive targets at least 44px high where the shared controls provide that target.

The shared `BackToCatalogLink` handles page and compact footer placements with the same return destination and label. Pass it the validated return destination so catalog criteria are preserved.

### Inputs, selects, and filters

Search, text, email, password, telephone, and select controls use the paper surface, ink text, a 1px input-border outline, 2px corners, and at least 44px height. Standard controls use 9px/11px padding. Labels are 12px and 600 weight, with 5–6px between label and control. Auth inputs are 48px high and use 16px text. Placeholders use secondary ink at full opacity.

Use the shared `Field` wrapper for repeated label/control pairs across search, filters, and auth. `FieldMessage` supplies inline help or validation copy; the control keeps responsibility for its `aria-describedby` relationship. Keep range fieldsets and page-level alerts local where their semantics differ.

The sort select is 40px high on wide screens and 42px on small screens. Filter controls are native selects and text inputs for category, language, and format, plus a dual range control for price. The range track is 4px; pine thumbs are circular with a paper outline. Active criteria are compact square-edged outlined rows, not rounded chips, with a 24px remove target. At widths up to 480px, filters are behind a “Refinar la búsqueda” disclosure that starts collapsed; from 481px upward they are visible in the page flow.

### Focus, validation, and feedback

All keyboard focus-visible targets receive a 3px solid focus outline with a 3px offset and 2px corner radius. The implemented public and auth surfaces are light, so they use the blue focus token.

Invalid fields expose aria-invalid and a linked Spanish error message in error color. Filter errors are 11px; auth errors are 12px and semibold. A server error is grouped in a lightly tinted paper panel with a 1px error outline and error-colored heading. The field border itself does not change color for aria-invalid. Successful auth feedback uses pine; validating/submitting feedback uses secondary ink. Loading and stale-result states retain the catalog layout, use quiet sage surfaces or skeletons, and provide status text. Empty states use a short terracotta rule and Literata heading. Request failures retain explanatory Spanish copy and retry or recovery actions.

### Purchase states and recovery

Cart and checkout loading use short status text in place; book-level updates keep quantity and removal in the row and report success or failure beside it. Removing a book moves keyboard focus to the resulting cart notice. An empty cart or checkout uses the same editorial empty-state rule and a catalog action. Unavailable editions remain visible with a text reason and a route to adjust the cart.

Checkout validation names the missing address, payment method, card number or simulated result beside the affected choice. While the order is checked or submitted, the button names progress and repeat submission is blocked. A changed cart or address, stock conflict, or known API failure appears in a bounded error panel with a specific next action. If the result of the non-idempotent checkout is unknown, the page says a pedido may already exist, blocks another submission, and offers a read of recent orders before any new attempt. The card number is cleared after the attempt. A successful read leads to the order page; a confirmed absence returns to the current cart and permits a fresh decision.

Order confirmation is a read surface, not a new checkout step. Approved and rejected simulated payments have distinct Spanish headings and explanations. The order page can also show its current state when opened later. Pending order reads, missing or inaccessible orders, and read failures each retain a useful heading or status and a catalog or retry path. Guest, expired-session and wrong-role gates explain access and offer sign-in or catalog recovery without exposing purchase data.

### Borders and radii

Use 1px dividers and control outlines, with 2px corners for the page’s controls, category tiles, and buttons. Keep catalog items unboxed. The only circular shapes in the core system are the availability marker and price-slider thumbs. Reserve cover shadows for the physical jackets; use tonal surfaces and rules to organize the rest.

## Responsive conventions

| Width | Implemented behavior |
|---|---|
| Above 1050px | Three-part masthead, four-column edition grid, full filter row. |
| 901–1050px | Masthead moves account actions beside the wordmark and search below; edition grid becomes three columns; filters wrap into a four-column arrangement. |
| 741–900px | Same three-column grid; filters become two columns. |
| 481–740px | Page insets reduce to 18px; masthead places wordmark and account links above full-width search; categories and filter fields reflow; edition grid becomes two columns. |
| 480px and below | Filter disclosure is shown and starts collapsed; detail cover stacks above copy; auth spacing tightens; footer can wrap. |
| 360px and below | Wordmark shrinks to 21px; language and format filters occupy full rows. |

For purchase pages, the cart and order columns stack at 900px; the cart summary loses its sticky position and checkout switches to the compact order disclosure. At 560px and below, cart controls move below each book's jacket and copy, payment methods stack, and the new-address form becomes one column. Order facts remain two columns where they fit, with long references spanning the row. Purchase buttons and choice rows retain at least 44px targets, headings and totals wrap, and error/recovery text stays in document order.

At reduced-motion preference, disable smooth scrolling, button transitions, and loading-skeleton animation. The product keeps content order and complete labels as layouts narrow; category and filter controls remain reachable without clipping.

Keep the interface in Spanish, preserve visible focus and text labels for states, and use licensed cover artwork with available source and attribution. Do not add unsupported promotions or commerce guarantees, dashboard framing, decorative glass, or gradient text.

## Production direction and seed reconciliation

The production system preserves the approved seed’s visual character and decisions: pine, paper, ink, sage, terracotta, Literata/Inter, 42px/18px page insets, 2px corners, flat catalog surfaces, jacket-only shadows, Spanish labels, and visible focus.

The discovery lead is a wide editorial sage panel. Preserve the approved headline, “Una lectura empieza por una pista.”, and its literary, restrained character. The panel provides brand and editorial orientation, not product promotion, and does not depend on a featured edition. Do not add a featured-edition dependency unless a future product requirement explicitly calls for curated featured content. This production decision supersedes the original seed’s two-column copy-and-featured-cover composition.

The optional dark utility strip is not part of the current production system. Keep `--focus-on-dark` reserved only; do not use it until a real surface requires the dark utility treatment. The current header uses a Literata “PLIEGO” wordmark with a “CATÁLOGO” label; this records the UI treatment and does not approve a separate logo asset.
