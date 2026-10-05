# PLIEGO frontend design language

Read this before changing PLIEGO UI. It describes the system as implemented today; the rendered
Home, header and search are the reference. Extend this language — do not start a new one.

## 1. Core identity

PLIEGO is a bookstore with an editorial voice: a calm paper page, one strong brand color, one warm
accent, big confident type, and real books as the product evidence.

| Element | Role | Current source |
|---|---|---|
| Warm paper `#f6f5f0` | The dominant environment. Most of every page is paper. | `--store-paper` (`storefront.css`) |
| Ultramar `#283da8` | Brand anchor: wordmark, display headlines, primary buttons, selected states, one large brand field per page. | `--store-blue` |
| Ink `#252740` | Body text and neutral headings. | `--store-ink` |
| Warm yellow `#f3df83` | Energy and punctuation: the full-stop dot, the reading scene field, the button on the ultramar field. Used in bounded doses. | `--store-yellow` |
| Lavender `#e4def4` | Quiet support: hover tints for icon buttons and search results; the compact, bounded Catalog band (the one full-strength lavender field, never a full-width section). BookCards use a paler *mist* (lavender ≈56% into paper) so the band stays the lavender moment. | `--store-lavender` |
| Quiet neutral `#ecebe4` | Stages behind covers, hover rows, footer ground. | `--home-quiet` (Home) |
| Bricolage Grotesque | Expressive display: headlines, book titles in scenes, prices in scenes, wordmark. Tight tracking (≈ −0.04 to −0.055em), short line-height. | `--store-display` |
| Roboto Flex | Everything functional: body, labels, metadata, controls. | Mantine theme `fontFamily` |
| Material Symbols | All interface icons. Only names in `MaterialSymbolName` exist in the subset. | `shared/ui/MaterialSymbol` |
| Mantine | Component foundation (Buttons, ActionIcon, Modal, Menu, Skeleton…), restyled with CSS modules. | `theme/pliegoTheme.ts` |

**The full stop.** A small yellow dot is PLIEGO's recurring mark: after the wordmark, beside the hero
headline, and inside the selected topic chip. Reuse it for "this one / here"; do not decorate with it.

**The mascot.** A soft ultramar dome with one yellow folded corner (a *pliego* is a folded sheet),
three tiny paper-colored marks for a face (two lowered lids, a small smile), leaning toward the
yellow dot. It wears ink headphones (a band that follows the head's own outline from behind, two ear cups in
front) and reads a small ink e-reader with a paper screen and three lavender lines under its lowered lids:
books to hold, to read on a device and to listen to. Same flat shapes, no extra detail. It lives only in the Home hero (`HomeMascot.tsx`). It is not a book with eyes, has no
eyeballs/pupils/eyebrows, and is not scattered across the page. Its one sanctioned relative is the
profile reader (`ProfileAvatar.tsx`, Mi perfil only): the same form, fold, paper marks and full stop at
small scale, eyes lowered over an open book it holds. No other surface gets a character.

The ultramar wordmark and its yellow full stop belong to the brand: page headings never reuse that treatment.

## 2. Composition principles

- **One job per section.** Each major section answers a different question (who we are → what to
  read next → one book worth time → how to explore → where to go). Its composition follows that job.
- **Repeat small rules, vary large compositions.** Type scale, spacing rhythm, focus style, radii and
  controls repeat; section layouts do not. Never default to "heading + card grid".
- **Saturated color is bounded.** Yellow and ultramar appear as contained scenes (a rounded field with
  a clear edge), surrounded by paper. Leave neutral space between two saturated episodes.
- **Hierarchy through scale, spacing and contrast**, not through boxes. Add a container only when it
  bounds a scene or groups an interaction.
- **Asymmetry is allowed when it states priority** (headline vs. mascot, cover vs. text).
- **Editorial first, decoration second.** Every shape must do a job (stage, bound, mark). No ornament.
- **Commercial truth stays readable**: title, author, price and availability are always real and legible.
- Radii have meaning: 24px scenes/panels, 999px chips and round controls, 8px buttons, small radii on covers.

## 3. Home patterns (`features/catalog/CatalogHomePage.tsx`)

| Section | Pattern | Principle |
|---|---|---|
| Hero (`HomeEditorial`) | Paper; one large ultramar Bricolage headline; one short paragraph; one primary action; the mascot. No covers, no carousel. | Brand expression comes from type + character, not product imagery. |
| Tu próxima lectura (`HomeNextReading`, `HomeReadingScene`) | Topic chips → one large yellow scene per book → next scene peeks → centered controls. | Discovery as a guided episode, not a product row. |
| Feature (`HomeLiterature`) | The page's single large ultramar field: one book, white display title, yellow action, cover on a paper stage. | One strong brand moment per page. |
| Explore (`HomeCategories`) | A typographic index: glyph, subject name, one line, small cover pair on a quiet stage, arrow; rows separated by rules. | Low density after a saturated scene; navigation, not merchandising. |
| Footer (`HomeFooter`) | Warm-neutral ground, functional links, ultramar wordmark. | A quiet close. |

**Reading scene details** (reuse when building any featured-book carousel):
- **Chips** choose a real set (top-level catalog categories). They sit in one row with the category
  link, directly above the scene they control. Selected: ultramar fill + yellow dot. They are toggle
  buttons (`aria-pressed`), not tabs.
- **Scene**: cover staged directly on the yellow field with generous space; no circles or plinths.
  Text hierarchy: author (quiet, above) → large display title (the link) → publisher/binding →
  price (display type) + availability pill → actions.
- **Actions**: explicit primary "Agregar al carrito" (ultramar; dashed/outlined when unavailable);
  quieter outlined "Guardar/Guardado"; feedback text below; no tooltips over commercial data.
- **Peek**: the next scene shows enough to reveal its cover (~184px desktop), separated by a clear
  gap. After the last scene the paper resumes; no fragments of the previous scene.
- **Controls**: one centered group under the viewport — previous, dots, next. Dots mean "book n of
  this set" only. No textual counter, no controls scattered around the scene.

## 4. Header and search (`app/navigation/SiteHeader*`, `HeaderSearch*`)

| State | Treatment |
|---|---|
| Top of page | Paper bar, no border or shadow, airier height (88px desktop). Ultramar wordmark + yellow dot, text nav links, field-shaped search trigger, round cart/account icons. |
| Scrolled | Same bar compacted (72px desktop); slightly smaller wordmark and trigger; hairline border + very soft shadow. The header gives back its lost height as margin so content never jumps. |
| Nav links | No filled blocks. A short ultramar rule appears on hover/current page. |
| Account menu | The account icon opens the only Account navigation: a paper panel (20px radius) that names who is signed in (name in Bricolage, email muted, on a quiet mist field), then Perfil · Direcciones · Favoritos · Pedidos, then Cerrar sesión. The current page reads ultramar with the yellow "here" dot (`aria-current="page"`). Arrow keys open it from the icon; Esc returns focus to the icon. |
| Search closed | Pill-shaped trigger: icon, "Buscar libros", `/` key hint (hidden on touch). Flexible width; icon-only on phones. `/` opens search unless typing elsewhere. |
| Search open | One surface (field + results) centered under the header on a light, slightly blurred ink veil — never a full-width white strip or heavy black overlay. Phones: full-height sheet with back arrow. |
| Empty | "Explora por tema" topic links + a short usage hint. |
| Typing | Previous results stay in place, dimmed; skeleton rows only on the first query. |
| Results | Rows: small cover, title (strong), author (muted), arrow on hover/focus; "Ver todos los resultados de «…»" at the end. |
| No results | Display-type "Sin coincidencias para «…»", one line of guidance, topics to explore. Not an error. |

Shared system cues: paper surfaces, ultramar focus/brand lines, 999px controls, Bricolage only for
the wordmark and state titles, quiet muted labels. Keyboard: Esc closes and returns focus to the
trigger, click outside closes, ↓/↑ move between field and results, Enter searches the whole catalog.

**Search shortcut.** Pressing `/` anywhere outside a text field or dialog opens search; Escape closes it and
returns focus to the search button. The search control is a compact rounded pill: the search symbol, "Buscar libros" and a small `/` keycap
(the keycap is hidden on touch-only devices and from screen readers, which get `aria-keyshortcuts`); on phones it
is the icon alone.

## 4b. Catalog (`features/catalog/CatalogPage.tsx`)

The catalog is the calm working counterpart of the Home: paper, one compact lavender band, books first.
At 1280×720 the first row's covers, titles, authors and prices are visible on load (guarded by `catalog.spec.ts`).

| Part | Treatment |
|---|---|
| Opening band | One bounded lavender field (24px radius, paper around it, ≈90px tall when no criteria). Left: collection name (or `Resultados para «…»`) in ultramar Bricolage with the yellow "here" dot, and the count beside it. Right: sort and `Filtros` as paper pills (ultramar outline + count badge when active). Applied criteria — paper tokens, `Limpiar todo` from two — sit beside the trigger and wrap onto a second line only when the title needs the room. Phones stack title, controls, criteria. |
| Category | Shown by the heading, the header nav and the `Tema` group in the filter drawer — never as in-page tabs or a sidebar. |
| Filters | Mantine Drawer (right; full width on phones) at every width. Choices are Home-style chips (ultramar + yellow dot when chosen) and apply immediately; only the typed price range has `Aplicar precio`. Footer: `Restablecer filtros` + `Ver N ediciones` (closes). |
| Grid | 2 / 3 / 4 / 5 columns (600px, 920px, 1200px): a library shelf, not a showcase. Breakpoints sit where a card would drop below ≈200px (cart label + icon + 44px favorite at 16px card padding). Gaps 16 / 20 / 24 / 24; row spacing (20–32px) lives in item padding, not row-gap. |
| Pagination | One centered group like the carousel controls: Anterior · numbered pages (first, last, current ±1, ellipses; current = ultramar disc) · Siguiente. Phones put the numbers on their own line. |

## 5. Product presentation

| Context | Form | Notes |
|---|---|---|
| Catalog grid | `BookCard` via `EditionGrid` / `CatalogBookCard` | One product as one scene: a bounded mist field (18px radius, no shadow; 16px on phones) holds the jacket, identity, price, stock and actions together. The same field for every card: jackets bring the variety, never per-book colors or gradients. The cover stands centered and bottom-anchored on the field with the Home cover shadow (no grey stage, no plinth); left-aligned Bricolage title, muted author, Bricolage price; a quiet stock line (small ultramar dot + words, open ring + muted words when unavailable — never red). Action tray: ultramar `Agregar` filling the line beside a round paper favorite disc that turns yellow with an ultramar heart when saved (the "this one" mark). Unavailable editions step back to paper with a hairline lavender edge and a dashed-outline cart (muted text and icon, disabled), as in the reading scene. Six shared subgrid rows keep every price, stock line and action aligned. |
| Editorial feature | Bespoke layout (`HomeLiterature`) | One book as a story; display title, cover on a stage. |
| Reading scene | `HomeReadingScene` | Designed for its scale — **never an enlarged BookCard**. |
| Search result | Compact row | Identification only; destination is the PDP. |
| PDP | `EditionDetailPage` + `editionDetail.module.css` (physical editions; eBooks and audiobooks keep the previous presentation until designed) | The complete commercial truth for one edition, in reading order on a 1048px axis. A quiet trail (Catálogo \| title); the jacket at its own proportions with the shadow on its real edge (no stage, no letterbox; a mist 2:3 placeholder only when there is no cover), sticky beside the text on wide screens; the title in ink Bricolage (smaller when long), author, then publisher, format and language as one muted line. The purchase decision is the page's one mist scene: Bricolage price, the quiet stock line, the ultramar "Agregar al carrito" filling the row and the favorite as a paper capsule that turns yellow with an ultramar heart when saved; unavailable steps back to paper with a hairline edge. Then the remaining facts (ISBN-13, pages, publication) as label-over-value pairs, the synopsis in a 62ch column (six lines, opened in full on request when long) and categories as one light line of links. No rules between parts. Tablet keeps the jacket beside identity and purchase with the reading parts full width below; phones stack jacket, identity, purchase, facts, synopsis with full-width actions. |

All of them read price, stock, favorite and cart from the same sources: `toBookCardData`,
`StockStatus`, `useFavoriteControl`, `useCartControl`, favorites status queries. Never re-implement
those rules; change presentation only.

Covers are product evidence: complete, 2:3, never cropped, never decorative collages, staged on
neutral or scene surfaces so their colors don't compete with the palette.

## 5b. Account (`features/account/AccountShell.tsx` and the pages that use it)

One family, one job per page. Each page stands on its own: `AccountShell` gives it a quiet orientation
trail (`Inicio | Mi perfil`, a `Ruta` nav: Inicio is a link, the page is muted with `aria-current`, the bar
is drawn) starting on one centered 760px axis on every Account page (Mi perfil's column; full width on phones);
then the page name centered on the content axis in Roboto Flex 600 (≈1.5–1.875rem, ink — the header's
functional language, never a second wordmark), an optional centered intro, then the body. Account content sits on
the Account sheet tone (`#fbfaf7`; dark `#26283f`), one step lighter than the header's paper: the tone change
at the header's lower edge is the only separation — no rule, no shadow. There is no in-page section bar: the header's account menu moves between Account
pages, so nothing competes with the global navigation. It re-points the legacy purchase tokens to PLIEGO
inside the Account only. Pages never share one card layout.

| Page | Composition |
|---|---|
| Mi perfil | Identity first, read-only, and compact: identity plus every field and its action fit the first desktop viewport (1280×720 and up). A centered mist scene holds the profile reader (`ProfileAvatar`) and the name in display type; below, one paper sheet lists Nombres, Apellidos, Correo and Teléfono as one line each (label · value · Material `edit` action; "Agregar" when empty; phones stack label over value). Editing is inline and local: the value becomes an underlined input in the same place and size, Guardar/Cancelar take the Editar slot, the row label names the input, nothing else moves; one field at a time; Escape/Cancelar return focus to its action. The email change adds one underlined line for the current password. |
| Direcciones | Each address is a complete object. The primary one is the yellow "here" scene with an ultramar Principal badge; others are paper with a hairline; adding is a dashed object in the same grid. Actions live inside each object. Adding and editing share one editor (`AddressForm` in a Mantine Modal): a sheet-tone panel (24px radius, 680px) over a light ink veil, with the list still readable behind it; phones get a full-height sheet. Its title is ultramar Bricolage; the round close button and the Guardar / Cancelar row stay pinned while the fields scroll (not pinned on short viewports). Focus enters at the title and returns to the control that opened it. Escape, the close button, the veil and Cancelar all ask before leaving typed data, and do nothing while a save is in flight. Confirmations are their own small dialog (`ConfirmDialog`: 440px sheet, 24px radius, Bricolage question, the consequence in one or two lines, focus on the answer that changes nothing): "¿Descartar los cambios?" over the editor, and "¿Eliminar «alias»?" for deletion, which names the address, says previous orders keep their delivery data, and is the only place the dark red (`--error`) fills a button. Nothing is confirmed inside a card. The objects are a centered wrapping set (320–386px each, up to three across): one or two sit together on the page axis and rows fill out as addresses are added; phones stack full width. |
| Favoritos | Not a catalog grid: the saved collection is one lavender scene holding a reading list of paper rows (`FavoriteRow`: cover, identity, today's price and stock, cart, quiet "Quitar"). Same commercial sources as BookCard. "Quitar" removes at once and never asks: an `UndoToast` (shared snackbar — a small ultramar field at the foot of the viewport with the yellow action) says "Quitado de favoritos" and offers "Deshacer", which restores the edition and moves focus to its row. The toast waits while hovered, focused or working. |
| Mis pedidos | One order-card grammar at two volumes on one 920px axis, grouped per page from the server state (presentation only; backend order kept inside each group). **En curso** leads: each order is a mist object with the state in ultramar display type, the estimated window or payment note, its books and identity/units; top right carry the labelled pairs "Realizado" (date) and "Total" in functional type, with an ultramar "Ver pedido" at the lower right. **Anteriores** uses the same card, quieter: sheet surface with a hairline border, no lavender, no table rules; read as Pedido N.°, date and units, then the final state and its books (beside the identity on wide screens, below it on phones), with the labelled "Total" and an outlined "Ver pedido" directly below it on the right, where active orders place theirs — delivered/collected keep ink and a check, cancelled steps back to muted text with its refund note. Books are a small cover plus the purchased title and quantity (`itemSummary`; only the cover is looked up by edition, as in the order detail); never chips. Every unit is one link; no timeline here. |
| Detalle de pedido | One composition for every state (`orderPage.module.css`), under the normal store header: "Volver a mis pedidos" (only the text is underlined, never the arrow), the centered page name "Detalle del pedido", one identity row (Pedido N.°, Realizado, Total), then a fulfillment panel beside a compact Pago card — both sheets with a hairline, no ultramar field. The panel holds the server state as its heading (`orderStory.ts`, presentation only: ultramar in motion, ink once arrived, muted when closed), one sentence, the delivery estimate, "Cancelar pedido" only when the server allows it, a five-part progress bar with the yellow full stop on the current step, the tracking guide and recorded shipment history only when they exist (shipped or delivered), the confirmed address or the pickup point with its code, and the purchased books (cover, title, price, quantity) in a mist inset — never repeated in another section. Closed orders drop the bar and the cancel action and mute the books. Pago lists method, totals and refund; a Factura card appears only when a document exists. Internal values stay out of the page: no payment reference and no pickup timezone identifier. A cancelled order says "a petición tuya" only when its own history shows the customer made the change, and states the refund as its own sentence. Phones stack panel then Pago. |

## 5b-2. Purchase flow (`features/purchase/PurchaseFlow.tsx`, `purchaseFlow.module.css`)

Cart, checkout and confirmation are one family on the Account sheet tone. Cart and checkout replace the site
header with the focused `PurchaseHeader` (wordmark · centered place and count — `Carrito (n artículos)`,
`Pago (n artículos)` · account); there is no catalog navigation, search or step trail in the flow. Each stage puts
its content beside one **summary sheet** (`PurchaseSummary`: mist, 24px radius, sticky on desktop, after the content
on narrow screens) that keeps its place and always holds the total in display type together with the stage's final
action: `Continuar con la compra`, `Hacer pedido` (it submits the payment form through `form="checkout-form"`),
`Ver el pedido completo`. Checkout is centred on the page (≤1160px).

| Stage | Composition |
|---|---|
| Carrito | The focused entry to the flow: `PurchaseHeader` replaces the site header on `/cart` (wordmark · centered `Carrito (n artículos)` · account; no catalog navigation, search or stage trail). `Seguir comprando` sits on the page's centre axis above the cart as one light link (Material `home` + underlined words) to `/catalog`. Each book is one purchase unit on a paper field (24px radius): cover, title in Bricolage, author; the shared `QuantityPicker` (1–10, capped at the current quantity when the server says it cannot grow) beside the line amount; then `Guardar para después` and `Quitar`. Availability is stated only when it fails. Both actions report in the `UndoToast` with `Deshacer`. Below the units, apart from the summary, `Guardado para después` is the customer's Favoritos — the same API and `FavoriteRow`, a preview of four with a link to the whole collection, and a calm empty state; never a second list. The sheet (`Resumen del pedido`) shows Subtotal, `IVA (rate %)` and Envío exactly as the cart API reports them (`subtotal`, `taxRate`, `taxAmount`, `shippingAmount`, `total`), then Total and `Continuar con la compra`; nothing is calculated in the frontend. |
| Pago (checkout) | No banners: the page is the two decisions and the summary. Two paper fields (24px), each a decision with its name and, once made, the way to change it. **Entregar en**: the chosen address as plain lines (recipient, street, city, phone — no alias, no chips) with `Cambiar dirección`, then `Entrega a domicilio` with Material `local_shipping`, the delivery window exactly as the cart API reports it (`Entrega 5 Oct - 7 Oct`; years only across a year boundary; nothing when the API sends none — the dates are never computed in the frontend), and each book's cover thumbnail and title, the delivery window as short dates (`Entrega entre el 4 oct y el 6 oct`: today through the day after tomorrow, a checkout statement — the API sets no estimate until an order ships) and each book's cover thumbnail and title; that switches to a focused selection — saved addresses as radio objects, `Añadir nueva dirección`, and the quiet line "Puedes editar o eliminar tus direcciones en Direcciones" — and choosing one returns to the compact view. Without an address the field offers `Añadir dirección` at once. Adding always opens the shared `AddressEditorDialog` (the Direcciones editor), never an inline form. **Pago**: "Pagar el importe total" over two rows, `Tarjeta de crédito o débito` and `Transferencia bancaria`. The card row opens a dialog with the accepted brands, the card fields and persistent CVV help; `Usar esta tarjeta` validates there and the field then shows only the brand mark and `Marca-1234` with `Cambiar método de pago`. Under it, visually secondary: Material `credit_card` and `account_balance` marks over "Financiación y más opciones disponibles". Under it, visually secondary: Material `credit_card` and `account_balance` marks over "Financiación y más opciones disponibles". Card data is never stored: after any attempt it is cleared and asked again. Transfer shows the bank data (`TransferFacts`). The sheet (`Resumen del pedido`) lists the books, then Subtotal, `IVA (rate %)`, Gastos de envío and Total from the cart API, and the action `Hacer pedido`. Focus returns to the control that opened each dialog, or to the change action once a choice is made. |
| Confirmación | Shown once, when checkout hands over the order (`location.state.purchased` on `/orders/:id`). The order story scene (`orderStory`, same tones as Detalle de pedido) leads with what happens next — the shipment track, transfer data or the way back to the cart — then the delivery address; the sheet lists what was bought, payment and reference. |

Fulfillment follows the API (`fulfillment.ts`): checkout creates every physical order as `HOME_DELIVERY`, so the
method is stated, not chosen. `STORE_PICKUP` is reserved in the contract with no store, schedule or checkout
parameter: do not render a pickup choice until the checkout command accepts one.

## 5c. Forms: country, phone and the form token layer

- **Form tokens** (`shared/ui/pliegoFormSurface.module.css`): pages still built on the legacy purchase styles
  (Account via `AccountShell`, the purchase flow via `PurchaseFlow`) apply `.surface`, which re-points the
  legacy tokens (`--pine`, `--forest`, `--sage`, `--focus`, `--control-*`) to ultramar / lavender / ink. No green
  remains in fields, buttons, choices or focus on those pages. Add the class to a page; do not restyle rule by rule.
- **CountryPicker** (`shared/ui/CountryPicker.tsx`, Mantine Popover + Drawer): a field-shaped trigger (flag + value,
  same height/edge/radius as its neighbours, full column width) opens one search field over one list. ≥600px: a
  compact paper panel anchored under the trigger (≥320px, ≤420px wide, list ≤264px; flips above when needed).
  Phones: a bottom sheet of fixed height (`min(85dvh, 640px)`) with 48px rows. Selected = ultramar + check and is
  centred on open; hover/keyboard row = lavender tint; focus is always ultramar.
- **Keyboard and focus**: ↓/↑ on the trigger open it; the search is a `combobox` driving the `listbox`
  (↓/↑, PageUp/PageDown, Enter); Escape, Tab, a choice or a click outside close it and return focus to the trigger
  without scrolling the page. Only the list scrolls. A tap on a phone does not raise the on-screen keyboard; opening
  from a keyboard focuses the search. A polite status announces the result count.
- **QuantityPicker** (`shared/ui/QuantityPicker.tsx`, Mantine Combobox): the same trigger edge and focus and the same
  floating paper list as CountryPicker, sized to its content and without search. The trigger keeps focus while the
  list is open (↓/↑, Enter, Escape); chosen = ultramar + check; rows are ≥44px (48px on touch). Never a native select.
- **InternationalPhoneField**: prefix and number are one control — one edge, one focus ring, a hairline between
  them; the prefix list shows calling codes and search matches name, ISO code or code digits. When its column is very
  narrow (large text, tight inline rows) the prefix stacks above the number instead of overflowing.
- Consumers: Mi perfil (phone), `AddressForm` (country + phone) in Direcciones and Checkout. Style the shared
  component, never a page-specific copy.

Order rules: cancellation appears only when `availableActions.cancel` is true; the address change is never
offered (the API returns false). Purchase, payment, shipment and documents are shown as the API reports
them, never derived from each other. Invoices are commercial PLIEGO documents: show "No calculados" for
NOT_ASSESSED taxes, "Aún no disponible" without electronic issuance, and no download links (none exist).

## 5d. Footer (`shared/ui/SiteFooter.tsx`)

Home and Catalog end on the ultramar field with the large wordmark. Every other page ends on the same content
set quietly on its own ground under one soft edge (`SiteFooter.module.css`): the small ultramar wordmark with
its yellow full stop, the line "Libros para mirar el mundo de otra manera.", and one row of links — the
contextual "Volver al catálogo" (Material `arrow_back`), Todos los libros, Favoritos, Carrito. No columns, no
marketing blocks; phones stack brand over links.

## 6. Interaction language

- Motion answers the user: scene changes, search open/close, state swaps, header compaction.
  Durations ≈ 140–520ms with `cubic-bezier(.32, .94, .6, 1)`; small translations, no scaling of
  surfaces whose size matters.
- The only unprompted motion is the mascot's one-time settle. No autoplay, no loops, no infinite carousels.
- Every motion has a `prefers-reduced-motion: reduce` path where the change is instant but still clear.
- Visible focus everywhere (2–3px ultramar outline; yellow on ultramar fields). Hover and pressed
  states change color or a rule, not layout.
- Carousels have real boundaries: disabled-looking ends stay focusable (`aria-disabled`), inactive
  scenes are `inert`, arrow keys are never stolen from nested controls, touch swipe only complements buttons.
- Small visual indicators still get ≥44px hit areas and descriptive names.
- Selection state (chips) and position state (dots) are separate controls with separate semantics.

## 7. Responsive philosophy

Responsive means **recomposition, not shrinking**. Keep semantic order; change arrangement.

| Range | Approach |
|---|---|
| ≥1280 | Full text navigation in the header; widest peeks; side-by-side compositions. |
| 1024–1279 | Navigation moves into the menu; headline/mascot and cover/text stay side by side, tighter. |
| 768–1023 | Hero headline spans the width with copy and mascot sharing the band below; scenes stack the cover band above the text. |
| <768 | One column, one complete active scene with a small peek, icon-only search trigger, full-height search sheet, controls stay ≥44px. |

Avoid fixed widths/heights that clip at 320px or 200% text: use `minmax(0, …)`, wrapping rows,
`clamp()` type, and container-relative sizes.

## 8. Where things live

- **Mantine theme** (`theme/`): base font, primary color, radii, component defaults.
- **Tokens** (`storefront.css`): the storefront palette and display font; `--home-*` locals on the Home surface.
- **Shared PLIEGO components**: commercial and navigation behavior (`BookCard`, `StockStatus`,
  `BookCover`, `MaterialSymbol`, header/search, action hooks). Reuse before creating.
- **CSS modules beside each feature**: layout and composition of a page or section. New pages compose
  existing primitives in their own module rather than adding global CSS.

## Do not regress to

- Ultramar (or any saturated color) covering the whole Home or every section.
- Generic ecommerce grids or "heading + cards" for every section.
- Rounded cards wrapped around every piece of content.
- Decorative gradients, glassmorphism, arbitrary floating shapes, decorative circles behind covers.
- Giant book-cover collages or covers as hero brand art.
- Literal books with faces; eyeballs, pupils or skeptical brows on the mascot; mascots everywhere.
- Generic AI aesthetics; a new font, palette or icon set per redesign.
- Excessive pills; pills that look selectable but control nothing.
- Exposed native scrollbars in designed rails; tiny accidental slivers as "peeks".
- Carousel controls scattered around the scene; counters competing with dots.
- Product metadata floating without hierarchy; tooltips covering price or actions.
- Full-width white search strips and heavy black overlays.
- Redesigning an approved page from scratch without a real reason.
- Copying Headspace (or any reference) assets, characters, layouts or wording.

## Before changing frontend UI

- Does it still look unmistakably PLIEGO?
- Does it preserve the paper → ultramar → yellow hierarchy?
- Does the section solve a distinct user/design job?
- Is the composition more appropriate than another generic card grid?
- Are existing Mantine components, PLIEGO components and contracts reused?
- Is product/commercial truth preserved from the shared sources?
- Does it recompose responsively (1440, 1024, 768, 390, 320, 200% text)?
- Are focus, keyboard, accessibility names and reduced motion preserved?
- Am I extending this system rather than inventing another identity?
