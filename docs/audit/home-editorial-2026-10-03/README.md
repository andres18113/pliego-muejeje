# PLIEGO Home — editorial redesign

The Home is rebuilt around the approved ultramarine/yellow identity, Bricolage Grotesque and real jackets. The supplied Headspace screenshots informed rhythm and broad color fields; no Headspace assets, characters, copy or layouts were used.

## Composition

- Integrated blue header: the existing navigation and behavior, with a Home-only color variant.
- One real book in the hero: a stationary jacket in a yellow arch, clear title/author and a large two-line opening. The previous three-book collage is removed.
- Yellow editorial bookshelf: a reading introduction beside a horizontal shelf, with different cover scales, complete jackets, real prices, availability, cart and favorites. Partial jackets invite browsing; their facts and controls appear when the card fits. Keyboard focus brings the complete card into view.
- Three editorial worlds: Philosophy is a wide blue panel with different philosophy editions; Literature pairs story covers on lavender; Mathematics places one large book and a summation symbol above its copy on light blue.
- A large literature poster: the actual edition of *Cien años de soledad*, its author, publisher, format, price and availability, with a mirrored blue/yellow composition.
- A reading close: an expressive blue footer with actual subject navigation and the existing shopping/account destinations.

No new fonts, dependencies, primary palette, fabricated testimonials, promotions, mascots or automatic animation were added. Home navigation and recovery commands share the `HomeActions` primitive. Static yellow fields adapt the existing Mantine accent tokens locally so dark mode keeps readable commerce controls. Error and empty states remain usable at enlarged text sizes.

## Validation

| Check | Result |
| --- | --- |
| TypeScript and production build | Passed |
| Vitest | 192 tests / 27 files passed |
| Default E2E suite | 91 passed; 68 unrelated or opt-in cases skipped |
| New Home visual E2E suite | 14 passed |
| Responsive widths | 320, 375, 768, 1024, 1440, 1920 px, light and dark |
| Axe WCAG 2 A/AA, 2.1 AA, 2.2 AA | Zero violations in Home, search, recovery and empty states |
| Manual/browser review | Entire Home, section transitions, desktop/tablet/mobile, typography, imagery, color balance |
| Interaction checks | Keyboard focus (including the hero), touch, favorites/sign-in destination, book navigation, saved shelf position, category destinations, search and Escape focus return |
| Text/motion | 200% text without horizontal overflow, reduced-motion behavior |
| Product evidence | Jackets decoded and contained at 2:3; featured title checked against the real edition detail API |
| Protected implementation | All 120 protected frontend source files byte-identical to the task-start versions |
| Catalog visual comparison | Zero changed pixels above the fold at 375 and 1440 px in light mode |
| Diff whitespace | Passed |

The real-data Home tests use the local catalog API and cover CDN, with guest authentication intercepted. Recovery tests use explicit error/empty fixtures. The default E2E suite verifies existing commerce, account, authentication and catalog behavior through its established fixtures. Previous storefront-wide opt-in tests and unrelated live account/purchase/session cases were outside this Home-only validation run.

Logs: [build](logs/build.log), [unit](logs/unit.log), [E2E](logs/e2e.log), [Home visual](logs/home-visual.log). The scope check is recorded in [scope-verification.json](scope-verification.json).

## Captures

- [Desktop Home](home-light-1440.png)
- [Wide desktop, dark mode](home-dark-1920.png)
- [Tablet](home-light-1024.png)
- [Mobile, 375 px](home-light-375.png)
- [Mobile, 320 px](home-light-320.png)
- [Subject worlds](explora-temas-light-375.png)
- [Editorial feature](literature-heading-light-1440.png)
- [200% text](text200-light-320.png)
- [Recovery](recovery-light-320.png)
- [Empty catalog](empty-text200-dark-320.png)

There are 76 screenshots covering all six widths and both themes. Section-only exports temporarily hide the sticky header to avoid obscuring their content; full-page and hero captures retain it. The supplied reference images remain in the user's Downloads directory and were not copied into the project.

## Implementation

Home-only files:

- `frontend/src/features/catalog/CatalogHomePage.tsx`
- `frontend/src/features/catalog/HomeEditorial.tsx` and `homeEditorial.module.css`
- `frontend/src/features/catalog/HomeDiscoveryRail.tsx` and `homeDiscoveryRail.module.css`
- `frontend/src/features/catalog/HomeActions.tsx`
- `frontend/src/features/catalog/HomeFooter.tsx` and `homeFooter.module.css`
- `frontend/src/features/catalog/homePage.module.css`

The shared `SiteHeader.tsx` only selects the Home variant at `/`; its original styles and behavior remain unchanged for every other route. `HomeHeader.module.css` contains that variant. Shared BookCard, EditionGrid, SiteFooter, Catalog, detail, checkout, authentication, global theme/styles, backend and API contracts were not edited. Existing E2E assertions were updated only for intentional Home changes, and the new `home-editorial.visual.spec.ts` covers Home behavior and accessibility.

```sh
cd frontend
npm run build
npm test
npm run test:e2e -- --workers=3
PLIEGO_VISUAL_LIVE=1 npm run test:e2e -- home-editorial.visual.spec.ts --workers=3 --output=/tmp/pliego-home-visual-final
```

See [direction.md](direction.md) for the initial composition plan and review. No commit, push or deployment was performed. No remaining blocker.
