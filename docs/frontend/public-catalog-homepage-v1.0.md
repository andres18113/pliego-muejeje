# PLIEGO Public Catalog Homepage — Proposed Production Surface

**Status:** Proposed for review; not approved for implementation  
**Surface:** Public discovery and catalog homepage  
**Roles:** Guest and CUSTOMER  
**API baseline:** backend-v1.0.0; public catalog routes in [`rest-api-contract-v1.0.md`](../../rest-api-contract-v1.0.md)  
**Visual authority:** [`DESIGN.md`](../../DESIGN.md), approved direction “Catálogo familiar”  
**Related behavior baseline:** [`product-design-and-ux-v1.0.md`](product-design-and-ux-v1.0.md), outcomes O-01 and task F-01

This proposal shapes the first production frontend surface. It keeps the approved familiar, editorial bookstore direction and uses the existing public API as the data and capability boundary. It does not set implementation tokens, choose a frontend implementation, or claim user research or accessibility conformance.

## 1. Purpose and scope

Help a visitor find a commercially listed **edition**, understand its current price and availability, and open its detail. The same catalog is available to a signed-in CUSTOMER. The page does not add cart mutation, checkout, recommendations, promotional claims, delivery claims, or stock quantities.

The main path is:

```text
Open catalog → search, browse a category, or refine → review editions → open edition detail
```

Edition detail is the next surface, already defined as S-02 in the UX baseline. On that surface a CUSTOMER can add an available edition to their cart; a Guest can choose sign-in or account creation. Returning to the catalog restores the non-sensitive query, category, filters, sort, page, and prior reading position where possible, then refreshes catalog data.

## 2. Information hierarchy and section order

1. **Skip link and masthead.** PLIEGO wordmark linking to Catalog; prominent search; Guest links for sign-in and account creation, or CUSTOMER links to Cart, Orders, and Account. No prototype P monogram. Do not show an informational utility strip unless approved factual copy exists.
2. **Category navigation.** Root categories and their subcategories, using bookstore language and clear current-category state. Root-category selection includes editions assigned directly to the root and its children, as the current catalog routine specifies.
3. **Discovery lead.** One page heading, a brief factual instruction, and the primary search control. Follow the approved editorial hierarchy and use real catalog covers only under the approved cover-rights and attribution rules.
4. **Catalog controls.** Active category/search context, refinements, clear-filters action, and sort control. Keep these close to the results they change.
5. **Results summary.** Number of editions returned, current sort, and active criteria. Use “ediciones” so a person can distinguish editions from the underlying book.
6. **Edition results.** Unboxed cover-and-facts groups in a responsive grid. Each item links to its edition detail.
7. **Pagination.** Previous/next controls and a natural one-based page position. Preserve all current criteria when paging.
8. **Footer.** Project identity and only approved destinations or legal content when those are supplied. Do not invent support, policy, delivery, or payment pages.

The page has one `h1`; each major section has a meaningful heading. The visual reading order and DOM order remain the same.

## 3. Navigation

- The PLIEGO wordmark returns to the unfiltered Catalog entry.
- Category links filter the current catalog and keep the chosen category visibly selected. Subcategory links are available under their parent. Selecting another category replaces the single category filter; removing the category returns to the broader catalog.
- Edition title and cover lead to that edition's detail route. Provide a visible text link such as “Ver edición” in addition to the cover so the action does not depend on recognizing an image.
- Guest account links lead to the existing sign-in and CUSTOMER registration surfaces. If reached from an edition or filtered catalog, preserve the safe return intent. Registration success leads to sign-in; it does not imply an authenticated session.
- CUSTOMER links expose the existing Cart, Orders, and Account surfaces. ADMIN routing remains in the ADMIN workspace; this public navigation does not turn ADMIN into a CUSTOMER purchasing experience.
- Browser back/forward and direct edition links work. A missing or no-longer-public edition shows the existing unavailable detail state and a clear route back to the catalog.

## 4. Search and discovery behavior

### Main search

Use one prominent search form with a visible search-scope selector for **Título**, **Autor**, or **ISBN-13**, a labeled query input, and a submit button. This makes the query behavior truthful: the API has separate `title`, `author`, and `isbn13` parameters and combines supplied filters rather than providing a cross-field “search everything” operation. The selected scope maps to exactly one of those parameters; category and refinements remain separate.

- Title and author accept partial text. Trim surrounding whitespace; submit on Enter or the visible search button. Do not show suggestions or claim instant search because no suggestion endpoint exists.
- ISBN-13 accepts 13 digits. Ignore spaces and hyphens in the input, then send only if the normalized value is exactly 13 ASCII digits. Keep the entered value and associate any error with the field.
- Submitting a changed query resets to UI page 1 (API `page=0`). Keep the current sort and refinements unless the person clears them.
- Reflect submitted criteria in the URL so refresh, browser history, and links preserve the search. Never place authentication credentials or session data in the URL.
- Do not fetch on every keystroke. Show submitted/pending feedback and then announce the returned result count without moving focus away from the form.

### Refinements and sorting

Expose the API-supported refinements: category, current-price minimum/maximum, language, and format. Format maps the only supported values (`PAPERBACK`, `HARDCOVER`) to readable Spanish labels. Language accepts a two- or three-letter code (for example, `es`) because the public contract has no language-options resource; label and help text must make that input understandable. Price fields accept non-negative values, and the page explains a reversed range beside the fields before submission. The server remains authoritative and its Spanish validation response is shown in context.

Each changed refinement resets to page 1. Active refinements are visible and individually removable; “Limpiar filtros” clears refinements while leaving the main search query intact, and a separate clear-search action clears the query. Sort options map only to title ascending (default), price ascending, and price descending. Sort changes also reset to page 1.

Page numbers are presented from 1 while requests remain zero-based. Use `totalCount` and `pageSize` to derive available pages; the API default page size is 20. Do not expose page 0 or invent a total-pages API field.

### Category browsing dependency

The current public API accepts one category **slug** as a catalog filter and the SQL routine applies a root slug to that root plus its children. Edition detail also returns its own category values. There is no public endpoint that enumerates category names, slugs, hierarchy, or active navigation choices; the category search endpoint is ADMIN-only. Therefore the approved category navigation cannot be populated from the current Guest/CUSTOMER contract without hard-coded or otherwise unapproved content.

Keep the category navigation in the proposed structure, but treat a public category index (or an explicitly approved, maintained public content source) as a prerequisite for implementing the complete browse navigation. Do not call ADMIN routes from this page, infer a complete taxonomy from a few edition details, or invent category slugs. A known category slug in a direct link can still be sent to catalog search; an unknown but syntactically valid slug returns an ordinary empty result. The current search routine does not check category state, so a formerly valid slug for an inactive category may still match editions through retained book-category associations. The category-index/API work must settle how inactive or stale category links behave.

## 5. Edition presentation and actions

Each result represents an **edition**, not just a title. Keep the facts close to its cover:

- Manual cover, when `coverUrl` is present with its license and required attribution. Preserve the portrait cover treatment in DESIGN; show the local fallback after a missing or failed image.
- Edition title and returned author string, followed by publisher.
- Current edition price, formatted as USD from the API's two-decimal string.
- Readable format and language, plus ISBN-13 when present if space and task value warrant it.
- Availability as words and a non-color cue: **Disponible** or **No disponible** from the API boolean. Never expose stock counts or imply a reservation. Keep unavailable editions viewable, but do not present them as purchasable on this page.
- A clear “Ver edición” link. Do not put an add-to-cart mutation on the result tile; detail is the review point and existing CUSTOMER action boundary.

The primary homepage action is submitting a search. Category links and filter controls support browsing; edition-detail links are the primary next action from an individual result. Sign-in and registration are secondary account actions. No promotional badge, review rating, recommendation label, discount, bestseller status, or featured status is shown without a source that explicitly supports it.

## 6. Discovery lead and featured-cover constraint

DESIGN.md calls for a two-column discovery lead at wide widths, with copy beside one featured cover. The existing API has no editorial-feature flag, ranking, or homepage-content endpoint. The default catalog order is title ascending, which is not evidence that the first title is featured. Do not relabel the first search result as an editorial pick.

Retain the approved lead hierarchy and cover placement as the visual target. Before implementation, resolve the cover content through an approved source that identifies a public edition to feature and supplies valid cover rights/attribution, or approve a production variant of the existing direction that omits the unsupported feature. This is a content/API decision, not a new visual exploration.

## 7. Responsive behavior

- At wide widths, follow DESIGN.md's order: masthead with search and account actions, category navigation, two-column discovery lead, then results. Results use a four-column presentation when the available width supports readable facts.
- As width reduces, wrap or stack masthead content and place search below the brand/actions as described in DESIGN.md. Keep category destinations reachable; a small-screen disclosure may group the same ordinary links, with no ARIA menu behavior.
- Stack the discovery lead. Reduce the edition grid to two columns at narrow widths when the cover and title remain legible; at very narrow widths or high zoom, allow one column. Never clip title, author, price, availability, filters, or pagination to preserve column count.
- Let filter controls reflow into a simple single-column form. Do not require horizontal dragging to reach a filter, category, or result action. Preserve query, page, and focus when orientation or viewport width changes.
- Support text enlargement to 200%, reflow at 320 CSS pixels, text-spacing overrides, browser zoom, and Spanish text expansion without loss of content or functionality.

## 8. Loading, empty, error, stale, and unavailable states

| State | User-visible behavior and recovery |
|---|---|
| Initial load / search pending | Keep the page heading and submitted criteria visible. Mark the results region busy, show a concise Spanish loading status, and prevent duplicate submissions only while the request is pending. Do not announce every keystroke. |
| Successful results | Announce the result count politely; keep focus in the submitted control. Show returned items, current price and availability, page position, and active criteria. |
| Empty unfiltered catalog | Explain that there are no currently listed editions and offer a retry/read-refresh action. Do not frame this as a search failure. |
| Empty filtered result | Say that no editions match the current criteria; keep criteria editable and offer removal/clear actions. For a category, say no listed editions were found for that category. A syntactically valid unknown slug is still this state. |
| Stale page | If a non-first page becomes empty after catalog changes, explain that the result page is no longer available and offer the first page while preserving search, category, filters, and sort. Do not show “Page 0.” |
| Read failure | Distinguish the failed request from zero results. Show the Spanish Problem Details title/detail when supplied, retain safe submitted criteria, and offer retry. GET reads may be retried. Never expose SQL, stack traces, or secrets. |
| Refresh failure with prior results | Keep prior items only with a clear warning that current price/availability could have changed; provide retry. Do not present cached availability as freshly confirmed. |
| Cover missing or broken | Replace only the image with the labeled neutral fallback; preserve title, author, price, availability, and detail link. |
| Edition unavailable at detail | Use the existing non-disclosing 404 detail state and link back to the preserved catalog context. On return, re-read results. |
| No network / request interrupted | Preserve query and filters. Show that the catalog could not be updated and provide retry when connected; do not silently clear the page or convert the failure to an empty state. |

The catalog is public and read-only, so this page has no command-pending, authorization-gated, or mutation-success state. Customer-only cart behavior remains on detail/cart surfaces.

## 9. Accessibility and interaction requirements

- Use native header, navigation, main, and footer landmarks; include a skip link to main content. Use ordinary links for routes and category navigation, buttons for actions, and native labeled inputs/selects. Avoid custom menu or combobox behavior.
- Keep a logical keyboard sequence through wordmark, search scope/query/submit, category links, filters, sort, result links, pagination, and account actions. All actions work without pointer input; visible focus follows the approved treatment and is not hidden by sticky content.
- Give every control a persistent visible label. Associate help and field errors programmatically. Group related refinements with a visible legend. Do not rely on placeholders, color, or icons alone.
- Use meaningful headings and link text. A cover that repeats the adjacent title can have empty alternative text; the edition link itself must name the edition. A fallback communicates that the cover is unavailable without replacing the book facts.
- Announce result count, loading, and request failures through an appropriate polite status region. Avoid moving focus for ordinary result refresh; on navigation to detail, update the document title and expose the detail heading. On browser return, restore the catalog context and focus to the originating result link where possible.
- Convey availability and selected filters with text/state as well as color. Maintain the contrast, visible focus, and target-size commitments in DESIGN.md and WCAG 2.2 AA-informed implementation requirements.
- Respect reduced-motion preferences; no autoplay, auto-rotating cover carousel, flashing effect, or motion-only status.
- Verify keyboard-only paths, computed accessible names, 200% text resize, 320 CSS pixel reflow, text-spacing overrides, touch use, and representative screen-reader output during implementation. This proposal is not a conformance result.

## 10. Reusable patterns to shape during implementation

These are behavior patterns, not final component APIs or design tokens:

- **Public masthead** — PLIEGO home link, search area, and role-appropriate account destinations.
- **Catalog search form** — scope, query, validation, submit, URL synchronization, and pending feedback.
- **Category navigation** — root/subcategory hierarchy, selected state, and responsive disclosure; depends on the category-index decision above.
- **Catalog filter group** — price, language, format, active-filter removal, and clear behavior.
- **Sort and result summary** — visible criteria, result count, and sort state.
- **Edition presentation** — cover/fallback, edition facts, availability, and detail link.
- **Catalog pagination** — one-based labels backed by zero-based API paging and context preservation.
- **Read-state feedback** — loading, empty, stale, unavailable, and retryable read error patterns with Spanish copy.

Share a pattern only when the same behavior occurs on another approved surface; keep catalog-specific data and rules within the catalog feature.

## 11. Implementation gates and evidence limits

Before this surface is approved for implementation, resolve:

1. **Category source and lifecycle:** add/approve a Guest/CUSTOMER-safe source for public category names, slugs, parent-child relationships, and active state, or explicitly approve a maintained static content source. Define behavior for inactive/stale slugs because the current search routine can still match retained associations.
2. **Featured edition source:** identify an approved public edition and cover rights/attribution for the lead, or approve omitting the unsupported feature slot within “Catálogo familiar.”
3. **Copy review:** confirm Spanish regional wording and the concise search/empty/error copy before locking UI text. Existing API human-facing errors are Spanish; no customer research or regional language validation is available.

Evidence is limited to DESIGN.md, PRODUCT.md, the frozen REST contract/backend implementation, and the approved frontend UX baseline. There are no supplied customer studies, search logs, analytics, content rankings, or accessibility test results. The proposed labels and category-navigation interaction remain hypotheses for later task-based review.
