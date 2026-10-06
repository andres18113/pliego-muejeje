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
| Warm yellow `#f3df83` | Energy and punctuation: the full-stop dot, the audiobook surface on the Home, the saved-favorite mark. Used in bounded doses. | `--store-yellow` |
| Lavender `#e4def4` | Quiet support: hover tints for icon buttons and search results. In commerce it is the **eBook** medium color (cover stages); Ofertas BookCards keep a paler *mist* field. Never the Libros surface. | `--store-lavender` |
| Quiet neutral `#ecebe4` | Stages behind covers, hover rows, footer ground. | `--home-quiet` (Home) |
| Bricolage Grotesque | Expressive display: headlines, book titles in scenes, prices in scenes, wordmark. Tight tracking (≈ −0.04 to −0.055em), short line-height. | `--store-display` |
| Roboto Flex | Everything functional: body, labels, metadata, controls. | Mantine theme `fontFamily` |
| Material Symbols | All interface icons. Only names in `MaterialSymbolName` exist in the subset. | `shared/ui/MaterialSymbol` |
| Mantine | Component foundation (Buttons, ActionIcon, Modal, Menu, Skeleton…), restyled with CSS modules. | `theme/pliegoTheme.ts` |

**The full stop.** A small yellow dot is PLIEGO's recurring mark: after the wordmark and inside the
selected topic chip. Reuse it for "this one / here"; do not decorate with it.

**The mascot.** A soft ultramar dome with one yellow folded corner (a *pliego* is a folded sheet),
three tiny paper-colored marks for a face (two lowered lids, a small smile), leaning a little. It wears ink headphones (a band that follows the head's own outline from behind, two ear cups in
front) and reads a small ink e-reader with a paper screen and three lavender lines under its lowered lids:
books to hold, to read on a device and to listen to. Same flat shapes, no extra detail. On the Home it lives only in the Ayuda card (`HomeDestinations`), standing in the card's lower half with a question on its shoulder; it is not in the hero. The component (`features/catalog/HomeMascot.tsx`) stays available for other surfaces such as sign-in, registration, recovery, empty states or campaign pages. It is not a book with eyes, has no
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
| Hero (`HomeDiscovery`) | Paper; a centered ink Bricolage headline, "Descubre el mundo de PLIEGO.", with the name alone in ultramar (≤4rem — the first tiles stay in the first viewport); one muted line; then three entry points from the storefront projection (`useStorefrontNavigation`: Libros, eBooks, Audiolibros). Each is a bounded field (24px) filled by that format's own photograph (`features/catalog/assets/discovery-*.webp`: a stack of books, an e-reader, a phone with headphones; `object-fit: cover`, never stretched) — the section's first featured jacket or its Material glyph stands in only if the file fails to load — over the section name, one line and one text link with `chevron_right` ("Explorar libros / eBooks / audiolibros") whose hit area is the whole tile. The hero is at least one viewport tall under the header, its content centered, so the next section starts below the first screen. On the text links only the words underline on hover; the arrow stays a separate mark. Phones turn the tiles into rows (field left, text right) so all three stay in the first screen. No carousel, no button. | The brand by name, the three ways to read, one entry point each. |
| Popular (`HomePopular`) | "Popular en PLIEGO" centered, then one open row of titles: the storefront projection's featured five in its order (up to three books, one eBook, one audiobook), followed by up to ten more books read from the server's own `Más vendidos` destination for Libros through the catalog search, in the server's order, skipping titles already in the row. Fewer when the data has fewer; never invented. Only the image area is bounded (20px, ≈1:1.2, a little shorter on short desktop windows) and always holds the real jacket with an object shadow — no device or headphone drawings. Its tone says the medium: quiet neutral for a book, lavender for an eBook, pale yellow for an audiobook; every title adds the same quiet line in the frame's top-left corner — Material `book_2` + "Libro", `mobile` + "eBook", `headphones` + "Audiolibro" (13px, ink, no chip). Title in Bricolage (two lines, the item's one link, covering the item), author, price with the previous price struck and a quiet `Ver edición` with `chevron_right` sit on the page surface with generous steps between them. The row is a track that steps by whole pages (5 titles from 1000px, 3 below, 2 on phones), titles outside the page `inert`, touch swipes as a complement, no loop, no autoplay, no native scroll. Its footer is one system: round arrows (`aria-disabled` at each end) around position dots (one per page, ultramar pill for the current one) — or a thin position rail when there are more than six pages, as on phones — then one quiet line, `Más vendidos` and the section names the server gives that destination for. The controls are omitted when everything fits one page. Identification only — no stock or cart. | What is popular, as products in a row rather than category panels. |
| Ofertas and Ayuda (`HomeDestinations`) | Two large fields of equal height side by side (24px; stacked below 900px), each from the projection's `OFFERS` / `HELP` section: its label as a small eyebrow, a Bricolage headline, one line, one 8px button with `arrow_forward` whose hit area is the whole card, and one drawn idea in the lower half. No covers, prices or photographs. **Ofertas** is the page's ultramar field: white headline, yellow button, and a single yellow percent sign in Bricolage 800, far larger than the card, tilted and cropped by its edges (it straightens a little on hover; the drawings never take the pointer, so the oversized glyph cannot cover the button). **Ayuda** is a light lavender field with ink text in both schemes: ultramar button, and the mascot standing whole in the middle of the lower half, close under the button, with a paper speech disc holding an ultramar question mark on its shoulder. Decorative sizes are in container units, and the art keeps its own room, so larger text makes the card taller instead of running under the drawing. | Where else to go, said with type and one character rather than merchandise. |
| Why PLIEGO (`HomeBenefits`) | The page's quiet close after ultramar, yellow and lavender. "¿Por qué comprar en PLIEGO?" left-aligned in Bricolage over one muted line, then exactly four white cards on the paper (24px, a hairline of shadow that deepens on hover; one step lighter than the page in the dark scheme): a filled ink Material symbol (`menu_book`, `local_shipping`, `sell`, `help`), a Bricolage 600 statement ("Todo en un solo lugar.", "Envío gratis.", "Ofertas que sí valen la pena.", "Ayuda cuando la necesites."), one muted line, and an ink text link with `chevron_right` resting on the card's foot (`Ver todo el catálogo`, `Explorar libros`, `Ver ofertas`, `Ir a Ayuda`), its hit area the whole card. Links are `/catalog` and the projection's destinations for Libros, Ofertas and Ayuda. No color fills, covers, character or illustration. Four across from 1000px, two by two below, one per row on phones; no carousel. | Why buy here, stated plainly. |
| Closing (`HomeClosing`) | One quiet neutral field (24px) before the footer: "Ya está. Ahora solo falta encontrar tu próxima historia." centered in Bricolage 600, and under it Material `check_circle` + "¡Muchas gracias!" in ultramar. No action, no form, nothing about subscriptions. | A calm last word about reading. |
| Footer (`HomeFooter`) | Warm-neutral ground on the Home's 1280px axis, compact. Left: the ultramar wordmark over "Libros para mirar el mundo de otra manera." Right: three short groups under quiet labels — **Explorar** (the projection's Libros, eBooks, Audiolibros, Ofertas), **Tu PLIEGO** (Mi biblioteca, Favoritos, Carrito, Mi cuenta) and **Ayuda** (Ayuda plus the Help API's own Compras, Entrega a domicilio and Pagos topics, only when it publishes them). Never the subject tree. Under a hairline, `Métodos de pago`: the four card marks the payment dialog accepts (Visa, Mastercard, American Express, Diners Club — the same `react-svg-credit-card-payment-icons` marks on small white plates) and Material `account_balance` + "Transferencia bancaria". Under a second hairline, "© 2026-2026 PLIEGO" in small muted type. Brand above the groups below 900px; two groups across on phones, payment marks wrapping under their label. | A quiet, useful close. |

## 4. Header and search (`app/navigation/SiteHeader*`, `HeaderSearch*`)

| State | Treatment |
|---|---|
| Top of page | Paper bar, no border or shadow, airier height (88px desktop). Ultramar wordmark + yellow dot, text nav links, field-shaped search trigger, round cart/account icons. |
| Scrolled | Same bar compacted (72px desktop); slightly smaller wordmark and trigger; hairline border + very soft shadow. The header gives back its lost height as margin so content never jumps. |
| Nav links | No filled blocks. A short ultramar rule appears on hover/current page. |
| Section menus | The bar lists the sections of the storefront projection (`useStorefrontNavigation`). A section with featured titles, subjects or a bestseller destination is a disclosure button with Material `expand_more`; the others (Ofertas, Ayuda) stay direct links. Its menu (`HeaderNavigation.tsx`) is one bounded paper panel under the bar (24px radius, ≤1120px, soft shadow, the page behind a light ink veil — never a full-width strip): the section name in Bricolage over `Ver todos` (ultramar), `Más vendidos` and `Ofertas` with its quiet count, only when the server supplies them; up to three compact titles (jacket on a mist field, title, author, price with the previous price struck); and `Temas`, the top-level subjects only (eight at most) as a quiet list. A section with destinations only gets a panel its own size. Click, Enter or ↓ open it; one menu at a time; hovering another section switches only while a menu is already open; Escape closes and returns focus to the section; a press outside, leaving it with Tab or choosing a destination closes it; `/` still opens search. |
| Phone sheet | Below 960px the menu button opens a left sheet titled "Navegación": the same sections as rows between rules; a section with secondary destinations unfolds in place (destination pills, featured titles as compact rows, subjects in two columns) and the current section carries the yellow "here" dot. Never a shrunken desktop panel. |
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

The catalog is PLIEGO's commerce surface: calmer and more utilitarian than the Home. One architecture
serves Libros, eBooks and Audiolibros (`productType`); the medium speaks only through the cover stage.
At 1280×720 the first row's covers, titles, authors and prices are visible on load (guarded by `catalog.spec.ts`).

| Medium | Stage behind covers (`BookCard` `data-media`, from the edition's format) |
|---|---|
| Libros (`PHYSICAL`) | Warm paper gray `#ecebe4` |
| eBooks (`EBOOK`) | Lavender ≈72% into paper |
| Audiolibros (`AUDIOBOOK`) | Warm yellow ≈42% into paper |

Page, heading, controls and text stay paper / ink / ultramar for every medium; never a per-route page tint.

| Part | Treatment |
|---|---|
| Heading | The collection name (`Libros`, `eBooks`, `Audiolibros`, a topic, or `Resultados para «…»`) in ink Bricolage with the count beneath it as a muted line. No band, no dot, no color field. |
| Desktop (≥1024px) | Persistent left sidebar (248px): `Filtros` with `filter_list`, then compact disclosure groups between hairline rules (`Tema`, `Formato`, `Idioma` — only what the scoped filter-options/categories return), each closed by default unless it holds a choice, showing that choice as a short ultramar line when closed. Choices are native radio rows (44px) whose ring fills ultramar; they apply immediately through the URL. `Restablecer filtros` (Material `refresh`, ink) always closes the sidebar and acts only while a filter is applied (muted and disabled otherwise); it keeps the collection (`productType`). |
| Below 1024px | The same panel in a right Mantine Drawer (full width on phones) opened by an outlined `Filtros` button with a count; footer `Restablecer filtros` + `Ver N ediciones`. |
| Sort and criteria | Desktop: `Ordenar por` sits at the end of the heading's line, so the sidebar and the first row of the shelf start on the same line; applied criteria (removable tokens, 6px radius, quiet fill — never the medium itself) head the sidebar under `Filtros`. Below desktop they share the toolbar above the grid with the `Filtros` trigger. Sort options are exactly the search contract: `Más vendidos`, `Título: A–Z`, and the two price orders when the scoped prices differ. The control is the shared `ChoicePicker` in its quiet appearance: field-shaped trigger (muted caption, bold value, ultramar edge + halo on focus), a white list aligned to the trigger's end, transparent options with a faint neutral hover, the current choice in ultramar text with a check — no filled blocks. |
| Price | Browsed through sorting. No typed min/max form; price-range URLs remain valid, shown as a removable token. |
| Grid | `EditionGrid` commerce shelf: 2 columns on phones, 3 from 600px and 3 beside the sidebar on desktop (≈220px cards at 1024, ≈320px at 1440). Gaps 16 / 20 / 24 / 32; row spacing 32–48px. Never five compressed cards. |
| Cart preview | The catalog card has no add action, so the catalog never opens the cart. `CartPreview` (right drawer showing the server cart, API totals, `Continuar con la compra` / `Ver carrito`) stays mounted as shared infrastructure for purchase surfaces such as the edition page, opened through `useCartPreview()` / `useCartControl({ onAdded })`. |
| Pagination | One centered group: Anterior · numbered pages (current = ultramar disc) · Siguiente. Phones put the numbers on their own line. |

## 4c. Ofertas (`features/catalog/OffersPage.tsx`, `offers.module.css`)

A calm commercial page, never a discount wall: the page is paper and the color lives inside the cards.

| Part | Treatment |
|---|---|
| Opening | "Ofertas" centered in ultramar Bricolage (no dot, no band) over one muted line. Product types the server reports are Home-style toggle chips on the same axis with their counts (chosen = ultramar + yellow dot). |
| Toolbar | The server count ("45 ofertas") faces `Tema` and `Ordenar` as mist pill selects with Material `expand_more`; options and labels come from the filter-options API. Phones stack count, then each control on its own line. |
| Shelf | `EditionGrid` with `presentation="offers"`: the catalog shelf with one card fewer per row (2 / 3 from 680px / 4 from 1080px), each `BookCard` also showing its edition line (format and language). |
| Offer on a card | In buying order inside the price row of every `BookCard`: today's price in Bricolage with the previous price struck beside it, "Ahorras $X (N %)" in ultramar, the offer's own message, Material `schedule` + "Quedan N días" and "Termina el 12 de octubre, 23:59", then "Términos de la oferta" as a quiet disclosure. Only an offer the server marks `endingSoon` turns its remaining-days line into a small yellow pill — the one yellow on the page. Values are the API's; `offersPresentation.ts` only words the end date and percentage. |
| States | Skeleton shelf while reading; error as a centered direction with "Volver a intentar"; an empty shelf is a dashed place to fill that tells no offers, no offers for these filters ("Ver todas las ofertas") and an out-of-range page apart. |
| Pages | One centered group: Anterior, "Página N de M", Siguiente as outlined pills, then a quiet "Explorar libros". |

## 4d. Ayuda (`features/help/HelpRoutes.tsx`, `help.module.css`)

The calmest storefront page: paper throughout, reading rather than merchandising, on a 920px axis. No contact channels, chat or accordions — every answer is its own article page.

| Part | Treatment |
|---|---|
| Landing | "Ayuda" centered in ink Bricolage over one muted line; one prominent search (a field-shaped pill with Material `search` and the ultramar `Buscar` inside the same edge; the action drops under the field on phones); the published categories as toggle chips (`Todos los temas` first; chosen = ultramar + yellow dot); then the server count facing `Tipo de compra` as a mist pill select. |
| Index | Articles as a typographic index between hairline rules, like Home's Explore: title in Bricolage (the row's one link, covering the row), summary, a quiet line with topic and applicability only when they add something, and an ultramar arrow. Pagination is the centered group, shown only past one page. |
| Article | "Volver a Ayuda", the topic as an ultramar link to that topic's list, the title in ink Bricolage, the summary as a muted lead and the body in one 62ch column at 1.7 line-height. Body text is plain text split on blank lines (single line breaks kept); it is never rendered as HTML. The page closes on its one mist scene, "¿Necesitas algo más?", with the links back into Ayuda. |
| States | Skeleton rows or lines while reading; errors as a centered direction with `Reintentar` (topics fail separately with `Reintentar temas`); an empty result is a dashed place that tells a search without matches from filters without matches and offers `Ver toda la Ayuda`; an unknown article says "Artículo no disponible" with the way back and no retry. |

## 5. Product presentation

| Context | Form | Notes |
|---|---|---|
| Catalog grid | `BookCard` with `media` (browse card) via `EditionGrid` / `CatalogBookCard` | No field, border or shadow, and no action row: the jacket stands centered on a square stage (10px radius) in its medium's color with the Home cover shadow; the stage, title and author form the one link to the edition, where buying happens. The favorite is a 44px quiet paper disc in the stage's top-right corner — a sibling of the link, never inside it — that turns yellow with an ultramar heart when saved. Below the stage, left-aligned: Bricolage title, muted author, Bricolage price, the quiet stock line (an unavailable jacket dims). Ofertas and Favoritos keep their cart actions (scene card / reading-list row). |
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
| Mi biblioteca | The customer's owned digital titles (`features/library/LibraryRoutes.tsx`, `library.module.css`), ownership only — never a reader, player, download or progress. The Account masthead, then Home-style toggle chips on the page axis (Todos · eBooks · Audiolibros; chosen = ultramar + yellow dot), the server count, and a shelf of owned objects on a 920px axis, two across and one when an object would drop below ≈340px: a mist field (18px) with the jacket, the media line (Material `menu_book` / `headphones` in ultramar), the title in Bricolage as the object's one link, authors and "Adquirido el …". A revoked title steps back to the sheet with a hairline, muted type and `block`. Empty views are a dashed place to fill that names the filter and links to the matching catalog. The detail has "Volver a Mi biblioteca", then one ownership scene (mist, 24px): jacket beside media, the title in ink Bricolage (smaller when long), authors, the ownership state with `check_circle`, the acquisition date, and only the server's `availableActions` as pills (`Ver pedido` ultramar, `Ayuda` outlined). Below, "Datos de la edición" as label-over-value pairs and "Información de compra" as one hairline sheet per source purchase (Pedido N.°, date, Pedido / Pago / Titularidad). Dates read as long Spanish dates and durations as hours and minutes (`libraryPresentation.ts`); states and labels come from `libraryViewModel.ts`. Phones stack jacket, identity, full-width actions, facts, purchases. |

## 5b-1. Account access and email actions (`features/auth/AuthPages.tsx`, `EmailActionPages.tsx`, `AuthFlow.tsx`, `authFlow.module.css`)

Sign-in, registration, verification and recovery are one family: a single 440px column on the paper under the normal header — never a card around the page, no step trail, no badges. Wayfinding first ("Volver al catálogo" on sign-in and registration, "Iniciar sesión" on the email pages), the page name in ink Bricolage (≈1.9–2.4rem), one line of direction, a compact form with a full-width ultramar action, then quiet underlined links.

| Part | Treatment |
|---|---|
| State grammar (`AuthState`) | Every outcome reads the same way: a 44px marked disc, a short Bricolage title, one or two lines, then the actions. **waiting** (Material `mail`): the next step happens in the customer's inbox; **info**: a decision on this page; **success** (ultramar disc, `check_circle`); **error** (`error`): it did not complete or nobody could confirm it; **terminal** (outlined disc, `link_off`): the link is finished and a new one is needed. The server does not tell invalid, expired and used links apart, so there is one terminal state. |
| "Revisa tu correo" | The family's one mist scene (24px): after registration and after a resend or recovery request. Registration ends here, not on "cuenta creada": it names the address, says the account still needs its verification, and offers `Iniciar sesión` (outlined) and `Reenviar verificación`. Requests show the server's neutral message as written — never whether the account exists. |
| Sign-in | A failed attempt is stated once in a tinted field above the form. An unverified account is direction, not an error: the same field in mist with the server's wording and `Solicitar enlace de verificación`, which carries the typed address to the resend page. |
| Verification and reset | The link is used only after the customer confirms (`Verificar correo`, or the new-password form). Success offers `Iniciar sesión`; a finished or missing link offers `Solicitar otro enlace`. |
| Mi perfil | Email change stays in the Correo row; under the sheet one quiet centered line offers `Reenviar verificación de correo`. |

Customer copy never names the mail provider, tokens or internal states.

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
- No unprompted motion on the Home (the mascot component keeps its one-time settle for wherever it is used). No autoplay, no loops, no infinite carousels.
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
| 1024–1279 | Navigation moves into the menu; the hero keeps its three fields across, tighter; cover/text stay side by side. |
| 768–1023 | The hero keeps its three fields across under the full-width headline; scenes stack the cover band above the text. |
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
