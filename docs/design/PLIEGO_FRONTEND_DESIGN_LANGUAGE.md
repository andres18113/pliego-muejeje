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
yellow dot. It lives only in the Home hero (`HomeMascot.tsx`). It is not a book with eyes, has no
eyeballs/pupils/eyebrows, and is not scattered across the page.

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
| Search closed | Pill-shaped trigger: icon, "Buscar libros", `/` key hint (hidden on touch). Flexible width; icon-only on phones. `/` opens search unless typing elsewhere. |
| Search open | One surface (field + results) centered under the header on a light, slightly blurred ink veil — never a full-width white strip or heavy black overlay. Phones: full-height sheet with back arrow. |
| Empty | "Explora por tema" topic links + a short usage hint. |
| Typing | Previous results stay in place, dimmed; skeleton rows only on the first query. |
| Results | Rows: small cover, title (strong), author (muted), arrow on hover/focus; "Ver todos los resultados de «…»" at the end. |
| No results | Display-type "Sin coincidencias para «…»", one line of guidance, topics to explore. Not an error. |

Shared system cues: paper surfaces, ultramar focus/brand lines, 999px controls, Bricolage only for
the wordmark and state titles, quiet muted labels. Keyboard: Esc closes and returns focus to the
trigger, click outside closes, ↓/↑ move between field and results, Enter searches the whole catalog.

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
| Catalog / favorites grids | `BookCard` via `EditionGrid` / `CatalogBookCard` | One product as one scene: a bounded mist field (18px radius, no shadow; 16px on phones) holds the jacket, identity, price, stock and actions together. The same field for every card: jackets bring the variety, never per-book colors or gradients. The cover stands centered and bottom-anchored on the field with the Home cover shadow (no grey stage, no plinth); left-aligned Bricolage title, muted author, Bricolage price; a quiet stock line (small ultramar dot + words, open ring + muted words when unavailable — never red). Action tray: ultramar `Agregar` filling the line beside a round paper favorite disc that turns yellow with an ultramar heart when saved (the "this one" mark). Unavailable editions step back to paper with a hairline lavender edge and a dashed-outline cart (muted text and icon, disabled), as in the reading scene. Six shared subgrid rows keep every price, stock line and action aligned. |
| Editorial feature | Bespoke layout (`HomeLiterature`) | One book as a story; display title, cover on a stage. |
| Reading scene | `HomeReadingScene` | Designed for its scale — **never an enlarged BookCard**. |
| Search result | Compact row | Identification only; destination is the PDP. |
| PDP | `EditionDetailPage` | The complete commercial truth for one edition. |

All of them read price, stock, favorite and cart from the same sources: `toBookCardData`,
`StockStatus`, `useFavoriteControl`, `useCartControl`, favorites status queries. Never re-implement
those rules; change presentation only.

Covers are product evidence: complete, 2:3, never cropped, never decorative collages, staged on
neutral or scene surfaces so their colors don't compete with the palette.

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
