# PLIEGO storefront redesign — 2026-10-03

Implemented a contemporary bookstore identity around ultramarine, lavender, yellow paper and violet ink. Bricolage Grotesque carries the editorial headings and wordmark; Roboto Flex carries reading, navigation, prices and forms. The storefront present in the working tree at task start was the visual baseline.

The gray hero, repeated pale media tiles, pill header, small product typography and interchangeable category cards were replaced. Home now has an immersive split opening, an actual catalog selection mixing the three subjects, distinct subject panels and a literature feature using real edition metadata. Catalog has a colored title band, persistent subject navigation, visible desktop topics and larger complete jackets. The footer, search, category menus and filter drawer use the same palette.

The initial discovery selection settles before the shelf mounts so scroll snapping cannot start it at the second book. Partially visible books invite scrolling, while their commerce controls become visible when the full card fits; focusing a book scrolls its card into view. Existing favorites, cart feedback, unavailable states, URL criteria, pagination and return navigation remain in place.

## Representative captures

- [Home, desktop](home-light-1440.png)
- [Home, 320 px](home-light-320.png)
- [Home, dark mode](home-dark-1440.png)
- [Catalog, desktop](catalog-light-1440.png)
- [Catalog, mobile](catalog-light-375.png)
- [Catalog, dark tablet](catalog-dark-1024.png)
- [Search with keyboard focus](search-light-375.png)
- [Category navigation](navigation-dark-375.png)
- [Filter drawer](filters-dark-320.png)

The directory contains 84 primary captures: Home and Catalog in both themes at 320, 375, 768, 1024, 1440 and 1920 px; enlarged text; search; category navigation; filters. Additional mouse/touch, focus, hover and scroll captures are preserved in `/tmp/pliego-redesign-legacy/`.

## Verification

| Check | Result |
| --- | --- |
| TypeScript and production build | Passed |
| Vitest | 192 tests, 27 files passed |
| Default Playwright suite | 91 passed; 54 opt-in cases skipped |
| Opt-in public storefront suite | All 49 passed, including the 12 new accessibility scenarios |
| Axe WCAG 2 A/AA, 2.1 AA and 2.2 AA checks | No violations in Home, Catalog, search, category navigation and filters at all six widths in both themes |
| Responsive and interaction checks | Mouse/touch, keyboard, focus return, 200% text, reduced motion, no document overflow, complete cover frames |
| Cover completeness | Both public result pages checked, covering all 55 editions |
| Diff whitespace | Passed |

The 54 opt-in cases in the default run include the 49 public storefront cases, which were explicitly executed separately with `PLIEGO_VISUAL_LIVE=1`. Five unrelated live account, purchase and session cases were not enabled. Commerce behavior is covered by the default E2E fixtures; the visual run uses the real local catalog API and cover CDN. The legacy customer chrome checks use fixture authentication and cart state.

Complete logs: [build](logs/build.log), [unit tests](logs/unit.log), [E2E](logs/e2e.log), [visual checks](logs/visual.log).

```sh
cd frontend
npm run build
npm test
npm run test:e2e -- --workers=3
PLIEGO_VISUAL_LIVE=1 npm run test:e2e -- storefront --workers=3 --output=/tmp/pliego-visual-complete
```

## Main implementation files

- `frontend/src/storefront.css` and `frontend/src/main.tsx`: palette, public surfaces, editorial type and local font loading.
- `frontend/src/app/navigation/SiteHeader.tsx` and `SiteHeader.module.css`: full-width sticky navigation, search entry, category panels and account compatibility.
- `frontend/src/features/catalog/HomeEditorial.tsx` and `homeEditorial.module.css`: hero, subject panels and literature feature.
- `frontend/src/features/catalog/CatalogHomePage.tsx` and `HomeDiscoveryRail.tsx`: real discovery selection, stable initial loading and rail interaction.
- `frontend/src/features/catalog/CatalogPage.tsx`, `CatalogControls.tsx`, `CatalogFilters.tsx` and `exploration.module.css`: catalog composition, topic navigation, filter presentation and focus alignment.
- `frontend/src/features/catalog/BookCard.tsx`, `storefrontBookCard.module.css`, `EditionGrid.tsx`, `EditionLoadingGrid.tsx` and `catalogLayout.module.css`: complete jackets, readable facts, independent commerce actions, responsive grids and loading composition.
- `frontend/src/shared/ui/SiteFooter.tsx`: public bookstore footer.
- `frontend/tests/e2e/storefront-redesign.visual.spec.ts`: real-data accessibility and responsive verification; existing visual assertions updated to the new intentional geometry and typography.
- `frontend/package.json` and lockfile: locally hosted Bricolage Grotesque and Axe for development verification.

See [direction.md](direction.md) for the design rationale. Approved root baselines, backend code, migrations and API contracts were not modified by this task. No commit, push or deployment was performed. No remaining blocker.
