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

**The logo.** A folded-sheet P — ultramar body, one yellow folded corner — beside the ultramar Bricolage wordmark.
The approved drawings live in `docs/design/brand/` (source of truth; geometry is not edited) with runtime copies in
`frontend/public/brand/`, and every surface draws them through `shared/ui/BrandLogo`: the lockup in the headers
(≈120px wide; the mark alone under 360px, and under 600px in the purchase header), both footers and the opening
screen; the reverse drawings on the dark scheme; `pliego-app-icon.svg` as the favicon; a PNG of the lockup in the
email shell. The logo is never decoration inside a page.

**The full stop.** A small yellow dot is PLIEGO's recurring mark inside the interface: in the
selected topic chip. Reuse it for "this one / here"; do not decorate with it.

**The mascot.** A soft ultramar dome with one yellow folded corner (a *pliego* is a folded sheet),
three tiny paper-colored marks for a face (two lowered lids, a small smile), leaning a little. It wears ink headphones (a band that follows the head's own outline from behind, two ear cups in
front) and reads a small ink e-reader with a paper screen and three lavender lines under its lowered lids:
books to hold, to read on a device and to listen to. Same flat shapes, no extra detail. On the Home it lives only in the Ayuda card (`HomeDestinations`), standing in the card's lower half with a question on its shoulder; it is not in the hero. The component (`features/catalog/HomeMascot.tsx`) stays available for other surfaces such as sign-in, registration, recovery, empty states or campaign pages. It is not a book with eyes, has no
eyeballs/pupils/eyebrows, and is not scattered across the page. It has no relatives: the former profile reader is retired, and the account is identified by `AccountMonogram` instead. No other surface gets a character.

The logo belongs to the brand: page headings never reuse its treatment.

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
| Top of page | Paper bar, no border or shadow, airier height (88px desktop). The logo, text nav links, field-shaped search trigger, round cart/account icons. |
| Scrolled | Same bar compacted (72px desktop); slightly smaller logo and trigger; hairline border + very soft shadow. The header gives back its lost height as margin so content never jumps. |
| Nav links | No filled blocks. A short ultramar rule appears on hover/current page. |
| Section menus | The bar lists the sections of the storefront projection (`useStorefrontNavigation`). A section with featured titles, subjects or a bestseller destination is a disclosure button with Material `expand_more`; the others (Ofertas, Ayuda) stay direct links. Its menu (`HeaderNavigation.tsx`) is one bounded paper panel under the bar (24px radius, ≤1120px, soft shadow, the page behind a light ink veil — never a full-width strip) in the Google Store composition: on the left the section name as a small ink heading led by its medium's muted 16px glyph (`book_2` Libros, `mobile` eBooks, `headphones` Audiolibros — the same glyphs as the Home and the edition page; no chip), up to three featured titles from the projection as small cards (≤9.375rem wide, 20px radius, a 100px jacket stage over a title area reserved for three lines on every card — 14px/1.25, centered, hyphenated, clamped with an ellipsis after the third line, shorter titles vertically centered, the full title kept in the link's name — no author or price — scannable, not a mini catalog) each on its medium's field — warm paper gray for a book, lavender for an eBook, pale yellow for an audiobook, as on the catalog cards — and 8px under them, as part of the same group, a compact "Explorar todos los libros / eBooks / audiolibros" pill sized to its words and aligned with the cards (48px, a faint ultramar field, label and arrow on one line, the arrow on an ultramar disc) to the section's own destination; on the right "Explorar más" with only the destinations the server supplies for that section (`Más vendidos`, `Ofertas` with its quiet count) as 64px rows grouped into one rounded block. No subject list: the menu is for fast discovery, not a directory. The phone sheet unfolds the same architecture in place. A mouse opens a menu on hover and moves between sections without a click (a click right after the hover keeps it open); leaving the bar and panel closes it after 150ms unless keyboard focus is inside. Click, Enter or ↓ also open it; one menu at a time; Escape closes and returns focus to the section; a press outside, leaving it with Tab or choosing a destination closes it; `/` still opens search. **No legacy green**: inside the header, its account panel, the search overlay and the phone sheet, the old global `--forest`/`--sage` tokens (inherited by `a:hover`, text and secondary buttons from `styles.css`) are re-pointed to the header accent, so text and actions stay ink and ultramar in every hover, open and selected state; the media surfaces keep their colours. |
| Phone sheet | Below 960px — or earlier, whenever larger text leaves the centered sections less than 12px from the wordmark or the actions (measured in `SiteHeader.tsx`) — the menu button opens a left sheet titled "Navegación": the same sections as rows between rules; a section with secondary destinations unfolds in place (destination pills, featured titles as compact rows, subjects in two columns) and the current section carries the yellow "here" dot. Never a shrunken desktop panel. |
| Account menu | The account icon opens the only Account navigation: a paper panel (20px radius) that names who is signed in (a 40px `AccountMonogram`, name in Bricolage, email muted, on the panel's own paper over a hairline — no lavender), then Perfil · Direcciones · Favoritos · Pedidos, then Cerrar sesión. The current page reads ultramar with the yellow "here" dot (`aria-current="page"`). Arrow keys open it from the icon; Esc returns focus to the icon. |
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
| Opening | A small ink eyebrow "Ofertas especiales" over one centered ink Bricolage headline, "Descubre las últimas ofertas." — no explanatory line, no band. Product types the server reports, in its order and with its counts, follow as thin compact chips (36px, 10px radius, a hairline on the paper; chosen = a faint ultramar wash with a 1.5px ultramar edge and ultramar text — no fill, no yellow dot) so the controls stay secondary to the offers. |
| Toolbar | The server count ("23 ofertas") faces `Tema` and `Ordenar por`, both the shared `ChoicePicker` in its quiet appearance (as the catalog sort: transparent trigger with muted caption, bold value and `expand_more`; white list aligned to the trigger's end; neutral hover; the current choice in ultramar with a check). Themes ("Todos los temas" first, then each with its count) and orders come from the filter-options API; never a native select. Phones stack the count, then the two triggers. |
| Shelf | `EditionGrid` with `presentation="offers"` renders `OfferCard` (Google Store offers) on the catalog shelf with one card fewer per row (2 / 3 from 680px / 4 from 1080px). Every medium shares one white stage (20px; one step lighter than the ground in dark) — never the catalog's lavender, yellow or gray: the jacket centered with the Home cover shadow and sized from the room left between the chip band and the cue band; a tiny muted "eBook" / "Audiolibro" cue bottom-left for digital editions; a quiet transparent 40px heart top-right (ultramar when saved). Below on the paper: the Bricolage title (no author) and "Ver oferta" with `arrow_forward` in ultramar text. The whole card is one link to the edition page (where buying happens); "Ver oferta" is part of it, not a second link. No cart button, stock line, edition line or offer copy. |
| Offer on a card | One price line: today's price in Bricolage, the previous price smaller and struck, and the saving as one pale-green chip with Material `sell` ("Ahorras $15,99", no percentage). An urgency chip (pale red, top-left of the stage) appears only when the server's `daysRemaining` is 5 or less: "Queda 1 día", "Quedan N días", "Termina hoy" at 0. No end date on the card. Values are the API's; `offersPresentation.ts` only words them. |
| States | Skeleton shelf while reading; error as a centered direction with "Volver a intentar"; an empty shelf is a dashed place to fill that tells no offers, no offers for these filters ("Ver todas las ofertas"). |
| Complete set | No customer-facing pages: the shelf holds every active offer for the chosen type, theme and order. `getAllPublicOffers` reads the server's own pages at its largest size (50) in its order and keeps each edition once; the count, ranking and filters stay the server's. An old `?page=` in a link is ignored. |
| Close | After the last offer, before the footer: three white cards (24px, Google Store benefit cards; one step lighter than the ground in dark), each a centered ultramar Material symbol, a short Bricolage statement and one muted line — `event` "Ofertas por tiempo limitado.", `sell` "Ahorra en cualquier formato.", `price_check` "Precio siempre actualizado." — stating only what offers really do. Three across from 900px, stacked below. No links, covers or color fields; no "Explorar libros". |

## 4d. Ayuda (`features/help/HelpRoutes.tsx`, `help.module.css`)

The calmest storefront page: paper throughout, reading rather than merchandising (landing on a 1120px axis, articles on 720px). No contact channels, chat or accordions — every answer is its own article page.

| Part | Treatment |
|---|---|
| Landing | Resources first — no search field, topic chips, purchase-type filter or counts. One large centered line in ink Bricolage, "Estamos aquí para ayudarte.", then "Echa un vistazo a estos recursos de asistencia" over the resources, on a 1120px axis with generous space. |
| Resources | The API's published articles as white cards (24px, neutral hairline; up to three across, centered; one column on phones): an ultramar Material symbol, the title in Bricolage as the card's one link (its target is the whole card), the summary, then topic/applicability in small muted text and an ultramar arrow. The symbol follows the published topic (`compras` shopping_bag, `retiro` storefront, `pagos` payments, `cancelaciones-y-reembolsos` currency_exchange, `cuenta-y-correo` person, `entrega-a-domicilio` local_shipping, `ebooks` mobile, `audiolibros` headphones; otherwise by applicability, `help` for general). `?category`, `?applicability`, `?que` and `?page` are still answered by the API (links from articles use them): a narrowed address adds one quiet line, "Recursos sobre …" with "Ver todos los recursos". Never lavender. |
| Article | "Volver a Ayuda", the topic as an ultramar link to that topic's resources, the title in ink Bricolage, summary and plain-text body in one 62ch column, closing on a white hairline card, "¿Necesitas algo más?", with the ways back into Ayuda. |
| States | Skeleton cards or lines while reading; errors as a centered direction with `Reintentar`; an empty result is a dashed place that offers `Ver todos los recursos` when the address narrowed them; an unknown article shows the shared `NotFoundScene` under "Volver a Ayuda". |

## 5. Product presentation

| Context | Form | Notes |
|---|---|---|
| Catalog grid | `BookCard` with `media` (browse card) via `EditionGrid` / `CatalogBookCard` | No field, border or shadow, and no action row: the jacket stands centered on a square stage (10px radius) in its medium's color with the Home cover shadow; the stage, title and author form the one link to the edition, where buying happens. The favorite is a 44px quiet paper disc in the stage's top-right corner — a sibling of the link, never inside it — that turns yellow with an ultramar heart when saved. Below the stage, left-aligned: Bricolage title, muted author, Bricolage price, the quiet stock line (an unavailable jacket dims). Ofertas and Favoritos keep their cart actions (scene card / reading-list row). |
| Search result | Compact row | Identification only; destination is the PDP. Cover, title and author lead (authors through `formatAuthorNames`, without role marks such as "(coord.)"); the medium is one quiet muted cue from the edition's format — `mediaCue` in `catalogMedia.ts`: Material `book_2` Libro, `mobile` eBook, `headphones` Audiolibro — in its own column at the row's end, under the author on phones. Same for all three; never a coloured row. |
| PDP | `EditionDetailPage` + `editionDetail.module.css` (physical editions, eBooks and audiobooks share one composition, `data-media` on the page) | The complete commercial truth for one edition, in reading order on a 1048px axis. A quiet trail (Catálogo \| title); the jacket at its own proportions with the shadow on its real edge (no stage, no letterbox; a mist 2:3 placeholder only when there is no cover), sticky beside the text on wide screens; the title in ink Bricolage (smaller when long) and the author — nothing else in the identity. The purchase decision is the page's one quiet scene on the Libros warm paper gray (`#ecebe4`; a neutral lift of the ground in dark — never lavender, the eBook color): Bricolage price, with an active offer read in three short rows — today's price with the previous one struck; the shared Ofertas chips (`OfferChips`: the pale-green saving with Material `sell`, then the pale-red days left only when the server's `daysRemaining` is 5 or less) as one group; availability on its own quiet line — the same on every medium, with no offer copy, terms or end date (without an offer, price and availability share one line), the quiet stock line, the ultramar "Agregar al carrito" filling the row (filled from the global `--store-action` token, ultramar in both schemes; `--store-link` is link text and never a fill) and the favorite as a paper capsule that turns yellow with an ultramar heart when saved; unavailable steps back to paper with a hairline edge. Then "Datos de la edición" as one small record — Editorial, Formato, Idioma, Páginas, Publicación, ISBN-13 (only those the edition has), label over value on three columns (two on phones), each fact stated once on the page — the synopsis in a 62ch column (six lines, opened in full on request when long) and categories as one light line of links. No rules between parts. Tablet keeps the jacket beside identity and purchase with the reading parts full width below; phones stack jacket, identity, purchase, facts, synopsis with full-width actions. **eBooks** use the same page with lavender (≈72% into paper; `#2e2b4d` in dark) as their only supporting surface — the purchase scene and the missing-cover placeholder — a quiet Material `mobile` + "eBook" line (13px, ink, no chip) above the title, and Formato read as "eBook · EPUB" when the file format is known. **Audiobooks** do the same with pale yellow (≈42% into paper; ≈26% into the dark ground) — the saved favorite keeps its full yellow and adds a faint ultramar edge to read on that field — a quiet `headphones` + "Audiolibro" line, Formato as "Audiolibro · 14 h 31 min", and Narración from the narrators in order; the demo catalog's placeholder narrator is said once as "Voz de demostración" (presentation only; the stored value is unchanged). Facts never leave one alone on a row: digital formats fold their one technical detail into Formato, and four facts sit as two pairs. Controls stay ink and ultramar on every medium; there is no reader, player, download, streaming or progress on this page. **Loading** is the same composition with quiet ink bones sized to each line (title, author, price, actions, six facts, five synopsis lines), the card's cover and title when the reader came from one, and the medium's surface and cue when it is known — the edition's medium carried from the card, else the `productType` of the collection it came from; with neither, the purchase scene is neutral paper with a hairline. A visually hidden heading and `role="status"` say "Consultando la edición"; the bones pulse gently and stand still under reduced motion. |

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
| Mi perfil | Identity first, read-only, and compact: identity plus every field and its action fit the first desktop viewport (1280×720 and up). The identity sits directly on the page's paper, centered, with no coloured field: `AccountMonogram` (`shared/ui`: the customer's initials in Bricolage on an ultramar disc, Material `person` when there is no name, here 76px with PLIEGO's yellow full stop at its foot), then the name in display type and its supporting line; below, one paper sheet lists Nombres, Apellidos, Correo and Teléfono as one line each (label · value · Material `edit` action; "Agregar" when empty; phones stack label over value). Editing is inline and local: the value becomes an underlined input in the same place and size, Guardar/Cancelar take the Editar slot, the row label names the input, nothing else moves; one field at a time; Escape/Cancelar return focus to its action. The email change adds one underlined line for the current password. |
| Direcciones | Each address is a complete object. The primary one is the yellow "here" scene with an ultramar Principal badge; others are paper with a hairline; adding is a dashed object in the same grid. Actions live inside each object. Adding and editing share one editor (`AddressForm` in a Mantine Modal): a sheet-tone panel (24px radius, 680px) over a light ink veil, with the list still readable behind it; phones get a full-height sheet. Its title is ultramar Bricolage; the round close button and the Guardar / Cancelar row stay pinned while the fields scroll (not pinned on short viewports). Focus enters at the title and returns to the control that opened it. Escape, the close button, the veil and Cancelar all ask before leaving typed data, and do nothing while a save is in flight. Confirmations are their own small dialog (`ConfirmDialog`: 440px sheet, 24px radius, Bricolage question, the consequence in one or two lines, focus on the answer that changes nothing): "¿Descartar los cambios?" over the editor, and "¿Eliminar «alias»?" for deletion, which names the address, says previous orders keep their delivery data. `ConfirmDialog` (`shared/ui`) is one grammar for every confirmation: white sheet (`#26283f` in dark) over a neutral dark veil, the keep answer as an ultramar outline (ink outline in dark) with a faint tint of its own colour on hover/press, and a 3px ultramar ring (pale ultramar in dark) for focus — never a lavender fill. `destructive` confirmations (deleting an address, cancelling an order) are the only places the dark red (`--error`) fills a button; hover and press are darker reds, and focus adds the ring without changing the fill. Nothing is confirmed inside a card. The objects are a centered wrapping set (320–386px each, up to three across): one or two sit together on the page axis and rows fill out as addresses are added; phones stack full width. |
| Favoritos | Not a catalog grid: the saved collection is one soft neutral-gray field (never lavender, the eBook colour) holding a reading list of paper rows (`FavoriteRow`: cover, identity, today's price and stock, cart, quiet "Quitar"). Same commercial sources as BookCard. On this page "Quitar" asks first in the destructive `ConfirmDialog` ("¿Quitar de Favoritos?" · "Conservar" / "Quitar de Favoritos"); everywhere else — catalog cards, edition detail, the cart's saved list — the heart stays immediate and never asks. After removal an `UndoToast` (shared snackbar — a small ultramar field at the foot of the viewport with the yellow action) says "Quitado de favoritos" and offers "Deshacer", which restores the edition and moves focus to its row. The toast waits while hovered, focused or working. |
| Mis pedidos | One order-card grammar at two volumes on one 920px axis, grouped per page from the server state (presentation only; backend order kept inside each group). **En curso** leads: each order is a white card with a hairline (`#2b2d47` in dark; its edge turns ultramar on hover) with the state in ultramar display type, the estimated window or payment note, its books and identity/units; top right carry the labelled pairs "Realizado" (date) and "Total" in functional type, with an ultramar "Ver pedido" at the lower right. **Anteriores** uses the same card, quieter: the same white card with a hairline, no table rules; read as Pedido N.°, date and units, then the final state and its books (beside the identity on wide screens, below it on phones), with the labelled "Total" and an outlined "Ver pedido" directly below it on the right, where active orders place theirs — delivered/collected keep ink and a check, cancelled steps back to muted text with its refund note. Books are a small cover plus the purchased title and quantity (`itemSummary`; only the cover is looked up by edition, as in the order detail); never chips. Every unit is one link; no timeline here. An order whose immutable pricing snapshot holds a saving adds a quiet green `sell` "Ahorraste $X" under its total, as on the detail page; nothing is shown otherwise. Within the six-minute window a digital or pickup order adds "Puedes cancelarlo durante los primeros 6 minutos." (only while `canCancel`); a finalized digital purchase moves to Anteriores as "Compra completada" with "Disponible en Mi biblioteca."; the page re-reads at the earliest cancelable deadline. |
| Detalle de pedido | One composition for every state (`orderPage.module.css`), under the normal store header: "Volver a mis pedidos" (only the text is underlined, never the arrow), the centered page name "Detalle del pedido", one identity row (Pedido N.°, Realizado, Total), then a fulfillment panel beside a compact Pago card — both sheets with a hairline, no ultramar field. The panel holds the server state as its heading (`orderStory.ts`, presentation only: ultramar in motion, ink once arrived, muted when closed), one sentence, the delivery estimate, "Cancelar pedido" only when the server allows it, a five-part progress bar with the yellow full stop on the current step, the tracking guide and recorded shipment history only when they exist (shipped or delivered), the confirmed address or the pickup point with its code, and the purchased books (cover, title, price, quantity) in a mist inset — never repeated in another section. Closed orders drop the bar and the cancel action and mute the books. Pago lists method, totals and refund; a Factura card appears only when a document exists. Internal values stay out of the page: no payment reference and no pickup timezone identifier. A cancelled order says "a petición tuya" only when its own history shows the customer made the change, and states the refund as its own sentence. Phones stack panel then Pago. **Books, savings and delivered**: the purchased books sit on a white sheet (hairline; the dark ground in dark) — never lavender — rows unchanged. With the order's immutable pricing snapshot, Pago reads Subtotal (original), "Ahorro total" (green), IVA, Gastos de envío, "Total pagado", and each discounted book shows its paid price, the original struck beside it and a pale-green `sell` chip "Ahorraste $X en este artículo" inside its row; without a snapshot nothing is added. Progress fills green; DELIVERED collapses to one full green bar with "Entregado" and its time (no five stage labels), the event history below. **Six-minute window (ADR 0029)**: read only from `availableActions` — `lifecycleState` and `canCancel`. A digital purchase in `CANCELLATION_WINDOW` reads "Compra confirmada" with "Puedes cancelar este pedido durante los primeros 6 minutos." while the server offers cancellation; once `COMPLETED` it reads "¡Gracias por tu compra!", "Tu compra está confirmada.", "Puedes revisar tus artículos comprados en Mi biblioteca." and one "Ver Mi biblioteca" → (`/biblioteca`), never a reader, player or download. A pickup order keeps its pickup state and adds the window line while cancelable. Inside the window the cancel block states only the consequence. "Cancelar pedido" asks in the destructive `ConfirmDialog` ("¿Cancelar el pedido N.° …?", the refund of the order total and what is released; "Conservar pedido" / "Confirmar cancelación", focus on keeping); nothing is confirmed inline. `cancellationDeadline` only schedules a re-read (immediately if already past; never a countdown or a client decision). |
| Mi biblioteca | The customer's owned digital titles (`features/library/LibraryRoutes.tsx`, `library.module.css`), ownership only — never a reader, player, download or progress. The Account masthead, then PLIEGO's shared filter chips (`shared/ui/filterChips.module.css`, the same thin chips as Ofertas: 36px, hairline, chosen = ultramar edge and text on a faint wash — never a solid pill or a dot) on the page axis (Todos · eBooks · Audiolibros), the server count, and a shelf of owned objects on a 920px axis, two across and one when an object would drop below ≈340px: a white card with a thin, quiet ultramar edge (30% ultramar, 1px; 18px radius; never lavender or any colour by format) with the jacket, the media line (Material `mobile` / `headphones` in ultramar), the title in Bricolage as the object's one link, authors and "Adquirido el …". A revoked title steps back to the sheet with a hairline, muted type and `block`. Empty views are a dashed place to fill that names the filter and links to the matching catalog. The detail has "Volver a Mi biblioteca", then one ownership scene (white card, the same thin ultramar edge, 24px; the purchase cards share it): jacket beside media, the title in ink Bricolage (smaller when long), authors, the ownership state with `check_circle`, the acquisition date, and only the server's `availableActions` as pills (`Ver pedido` ultramar, `Ayuda` outlined). Below, "Datos de la edición" as label-over-value pairs and "Información de compra" as one hairline sheet per source purchase (Pedido N.°, date, Pedido / Pago / Titularidad). Dates read as long Spanish dates and durations as hours and minutes (`libraryPresentation.ts`); states and labels come from `libraryViewModel.ts`. Phones stack jacket, identity, full-width actions, facts, purchases. |

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
| Carrito | The focused entry to the flow: `PurchaseHeader` replaces the site header on `/cart` (wordmark · centered `Carrito (n artículos)` · account; no catalog navigation, search or stage trail). `Seguir comprando` sits on the page's centre axis above the cart as one light link (Material `home` + underlined words) to `/catalog`. Each book is one purchase unit on a paper field (24px radius): cover, title in Bricolage, author; the shared `QuantityPicker` (1–10, capped at the current quantity when the server says it cannot grow) beside the line amount; then `Guardar para después` and `Quitar`. Availability is stated only when it fails. Both actions report in the `UndoToast` with `Deshacer`. Below the units, apart from the summary, `Guardado para después` is the customer's Favoritos — the same API and `FavoriteRow`, a preview of four with a link to the whole collection, and a calm empty state; never a second list. The sheet (`Resumen del pedido`) shows Subtotal, `IVA (rate %)` and Envío exactly as the cart API reports them (`subtotal`, `taxRate`, `taxAmount`, `shippingAmount`, `total`), then Total and `Continuar con la compra`; nothing is calculated in the frontend. **Offers** (from the server's offer projection, never computed): a line with a positive `lineSavings` shows its price with the original line subtotal smaller and struck, and a compact pale-green chip with Material `sell`, "Ahorras $X en este artículo" (the line saving, already for its quantity), sized to its words and sharing the actions' row (chip left, actions right) until the card is narrower than 40rem, when it drops under them. In the saved list, cart confirmations ("Esta edición digital ya está en tu carrito.") read as a quiet ultramar note with Material `info`; moving a line saved during the visit back to the cart restores its quantity and withdraws the now-stale undo. With a positive `savingsTotal` the summary reads Subtotal (`originalSubtotal`), "Ahorro total hoy" (−`savingsTotal`, restrained green), IVA, Envío, Total; otherwise the plain subtotal and no savings row. Quantity is the quiet `Cant. N ˅` picker (transparent trigger, the shared paper list); a fixed quantity reads `Cant. 1` the same way. **Composition** (Google Store cart): a compact centred pair on a 1120px axis over a warm grey ground (`#f1f0eb`; the dark ground in dark) — each line a white card (20px, hairline edge) with an 88px cover, the title, quantity facing its price (no per-unit line), the actions, and the saving strip; beside it a white summary card (20px, hairline edge, never lavender) with the total emphasised and a pill CTA. The cart restates its base text in rem so it follows the reader's text size. |
| Pago (checkout) | No banners: the page is the two decisions and the summary. Two paper fields (24px), each a decision with its name and, once made, the way to change it. **Entregar en**: the chosen address as plain lines (recipient, street, city, phone — no alias, no chips) with `Cambiar dirección`, then `Entrega a domicilio` with Material `local_shipping`, the delivery window exactly as the cart API reports it (`Entrega 5 Oct - 7 Oct`; years only across a year boundary; nothing when the API sends none — the dates are never computed in the frontend), and each book's cover thumbnail and title, the delivery window as short dates (`Entrega entre el 4 oct y el 6 oct`: today through the day after tomorrow, a checkout statement — the API sets no estimate until an order ships) and each book's cover thumbnail and title; that switches to a focused selection — saved addresses as radio objects, `Añadir nueva dirección`, and the quiet line "Puedes editar o eliminar tus direcciones en Direcciones" — and choosing one returns to the compact view. Without an address the field offers `Añadir dirección` at once. Adding always opens the shared `AddressEditorDialog` (the Direcciones editor), never an inline form. **Pago**: "Pagar el importe total" over two rows, `Tarjeta de crédito o débito` and `Transferencia bancaria`. The card row opens a dialog with the accepted brands, the card fields and persistent CVV help; `Usar esta tarjeta` validates there and the field then shows only the brand mark and `Marca-1234` with `Cambiar método de pago`. Under it, visually secondary: Material `credit_card` and `account_balance` marks over "Financiación y más opciones disponibles". Under it, visually secondary: Material `credit_card` and `account_balance` marks over "Financiación y más opciones disponibles". Card data is never stored: after any attempt it is cleared and asked again. Transfer shows the bank data (`TransferFacts`) on a soft blue field derived from ultramar (`#283da8` at 7% into white; `#3a52d0` at 22% into the dark ground) with white datum cards (the dark ground in dark), ultramar icon and copy actions (a light ultramar `#aab8ff` in dark) and a blue-tinted copy hover — never lavender, a solid ultramar fill or a gradient. Only the checkout panel sets these tokens; order pages keep their own. The sheet (`Resumen del pedido`) lists the books, then Subtotal, `IVA (rate %)`, Gastos de envío and Total from the cart API, and the action `Hacer pedido`. Focus returns to the control that opened each dialog, or to the change action once a choice is made. **Composition** (Google Store checkout): white cards (20px, hairline edge; one step lighter than the ground in dark) on the cart's warm grey ground — never lavender — with section titles at 1.5rem Bricolage 600 and everything inside one clear step smaller (address and items ≈15–16px, 32px item covers, 56px payment rows with a neutral icon disc; the chosen row takes an ultramar edge). The summary is one compact white card titled "Resumen del pedido" on one line: each line's title, `formato · N unidades × precio` and amount; a discounted line adds its original subtotal struck under the amount and the server's line saving as a quiet green `sell` "Ahorras $X". Totals read Subtotal (`originalSubtotal`), "Ahorro total" (green, label and amount), IVA, Gastos de envío, Total when the cart has a saving; otherwise the plain subtotal. No offer expiry in checkout. **Payment dialogs** (card and `Código de seguridad`) are white sheets (`#2b2d47` in dark) with white, neutral-edged fields that stay white when focused — no lavender surface, tint or hover; ultramar remains for the title, actions and focus. Card fields validate with the checkout schema when left (Tab or blur) and live while a touched field is corrected; an empty field is checked only when left with Tab, so focus that merely passed through it (autofocus, the automatic advance after a complete number) raises nothing; a pointer press on `Usar esta tarjeta`, `Cancelar` or close skips the blur check (submit validates all, cancel discards) so no message moves the button mid-press. Invalid fields carry `aria-invalid` and point to their message with `aria-describedby`. |
| Confirmación | Shown once, when checkout hands over the order (`location.state.purchased` on `/orders/:id`). The order story scene (`orderStory`, same tones as Detalle de pedido) leads with what happens next — the shipment track, transfer data or the way back to the cart — then the delivery address; the sheet lists what was bought, payment and reference. **Surfaces and savings**: white cards (20px, hairline edge; `#2b2d47` in dark) on the warm grey ground — "Tu pedido", the order details, the delivery items and digital purchases; the map's callout is white and its frame neutral — never lavender. With the order's immutable pricing snapshot (`pricingSnapshotAvailable`), totals read Subtotal (original), "Ahorro total" (green), IVA, Gastos de envío, "Total pagado", and each discounted line shows its paid unit price, the original struck beside it and a quiet green `sell` "Ahorraste $X" (the line saving); never an offer expiry. Without a snapshot the historical amounts read as before and no saving is shown. Under the reference map link: "Referencia PUCE en la entrada principal." |

Fulfillment follows the API (`fulfillment.ts`): checkout creates every physical order as `HOME_DELIVERY`, so the
method is stated, not chosen. `STORE_PICKUP` is reserved in the contract with no store, schedule or checkout
parameter: do not render a pickup choice until the checkout command accepts one.

## 5c. Forms: country, phone and the form token layer

- **Form tokens** (`shared/ui/pliegoFormSurface.module.css`): pages still built on the legacy purchase styles
  (Account via `AccountShell`, the purchase flow via `PurchaseFlow`) apply `.surface`, which re-points the
  legacy tokens (`--pine`, `--forest`, `--sage`, `--focus`, `--control-*`) to ultramar / lavender / ink. No green
  remains in fields, buttons, choices or focus on those pages. Add the class to a page; do not restyle rule by rule.
- **Page shell** (`styles.css`): `#root` is a column at least as tall as the viewport and `main` takes the slack, so the
  footer always closes the page. Pages do not reserve height of their own (`min-height` in vh) to push the footer down.
- **Status and feedback** (`storefront.css`: `--status-surface`, `--status-edge`, `--status-soft`): notices and
  stale-data notes (`.purchase-notice`, `.stale-data-note`, the purchase flow's `.notice`) are a white sheet with a
  neutral hairline and ink text — a strong first line, an optional quiet second one; fields that need the customer
  (unknown payment attempt, the auth states, transfer data, the "attention" order scene) are a soft neutral gray.
  Green is for genuine success and savings, dark red for errors, ultramar for actions. Never lavender. Copy states the
  outcome for the customer ("El pago fue reembolsado."), never what the system did internally.
- **Legacy token names** (`styles.css` `:root`): `--pine`, `--forest`, `--sage`, `--ink`, `--divider`… are historical
  names that now hold PLIEGO's values (ultramar, ink, warm paper, neutral lines). No brand green exists; green is
  only semantic (savings, shipment progress, success). Text selection is ultramar.
- **Missing pages** (`shared/ui/NotFoundScene.tsx`, after Mantine's "404 in the background" pattern, built with
  Mantine `Container`/`Title`/`Text`/`Group`/`Button`): warm paper, a very large faint ink `404` behind (decorative),
  "No encontramos esta página.", "Puede que el enlace haya cambiado o que la página ya no esté disponible." and one
  ultramar pill, `← Ir al inicio` (Home). Used by the catch-all route, the route error boundary (without the numeral:
  "No pudimos mostrar esta página.") and a missing Help article. Pages unavailable to the account use the quiet
  `← Ir al inicio` link. Never "Ir al catálogo" as an error recovery; domain empty states keep their own actions.
- **Loading** (`styles.css`): opening the app shows the logo on paper with one muted line
  ("Comprobando tu sesión…"); a slow route shows one small white pill at the top with an ultramar dot
  ("Preparando la compra…") — never a coloured bar.
- **Footers**: Home and Catalog close on the storefront footer (`HomeFooter`: wordmark, the three link groups,
  Métodos de pago, the legal line, on warm neutral); every other page closes on the compact `SiteFooter` (faint
  neutral ground). There is no blue footer and no per-route footer.
- **Crear cuenta**: the whole decision fits the first desktop viewport (down to 1366×650): a 560px column, Nombres
  and Apellidos on one row, Correo and Contraseña full width, the optional phone collapsed, the action, and
  "¿Ya tienes una cuenta? Iniciar sesión" directly under it. Fields are checked once visited or on submit, then as
  they are corrected — never while untouched. Phones stack.
- **After signing in**: back to the page that asked for it when it is a valid destination; otherwise Home.
- **Interaction states** (`storefront.css`): every generic control — header icons, account menu rows, outlined
  buttons, picker rows, choices, close buttons — hovers, opens and selects with `--store-hover` (a faint ultramar
  on paper; `--pliego-surface-hover` points to it) and presses with `--store-press`; outlined buttons, which also sit
  on coloured grounds, use the translucent `--store-tint` / `--store-tint-press`. Current items read ultramar (with
  the yellow dot where used). Lavender is the eBook medium's colour and never a generic hover, press or selection.
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
set quietly on its own ground under one soft edge (`SiteFooter.module.css`): the logo, the line "Libros para mirar el mundo de otra manera.", and one row of links — the
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
