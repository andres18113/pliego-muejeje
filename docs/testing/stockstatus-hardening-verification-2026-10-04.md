# StockStatus isolated hardening — 2026-10-04

## Four original failures

The focused baseline reproduced four failures, with four other StockStatus cases already passing (`/tmp/pliego-stock-baseline-e2e.log`).

| Failure | Proven cause | Correction |
| --- | --- | --- |
| Diagnostic Light | Expected a visible 16px Material Symbol inside Catalog cards, despite the approved quiet 7px dot/open ring hiding that symbol | Explicit shared `quiet` variant; check its shape, words, contrast and geometry. Keep the existing symbol checks for normal/text/badge variants |
| Diagnostic Dark | Same obsolete icon assumption in the dark scheme | Same variant-aware assertions, retaining dark contrast and layout checks |
| Production Light | Looked for `[data-bookcard]` on Favorites, whose approved collection uses `[data-favorite-row]` | Target the actual reading-list rows and retain status, disabled-action, descriptions, contrast and reflow checks |
| Production Dark | Same obsolete Favorites grid assumption in the dark scheme | Same actual-consumer coverage in dark mode |

No icon was added to the approved quiet treatment and Favorites was not changed back into a Catalog grid.

## Consumer audit and one contract

| Real consumer | Confirmed status source and visual treatment | Purchase and recovery behavior |
| --- | --- | --- |
| BookCard: Catalog and any EditionGrid | Public edition `available`; shared quiet text, filled ultramar mark / open muted ring | Native unavailable cart disable; shared action names/icons/state; favorite/detail stay available; focus falls back to favorite/detail |
| FavoriteRow: Favorites | Saved-edition `available`; the same quiet variant with Account color variables | Same shared action contract; native unavailable disable; favorite/detail remain usable; focus stays within the row |
| PDP | Public edition detail `available`; existing text/symbol treatment | No purchase action when unavailable or the public edition has disappeared; after a confirmed restock/republication purchasing returns; focus recovers to the edition heading, described by the status |
| HomeReadingScene | Category-preview edition `available`; existing scene pill, text and decorative symbol | Shared action contract; native unavailable disable; favorite/detail continue; local focus recovery |
| HomeLiterature feature | Category-preview edition `available`; existing on-brand text/symbol treatment | Its action navigates to the edition and is correctly available for either state |
| Cart rows | Cart-line `available` and reason for its exact quantity; existing text/symbol/explanation | Unavailable cannot increase; P3002 may decrease to recover; inactive or unknown causes retain quantity and allow removal. A residual reason cannot override an available read |
| Checkout desktop aside and mobile disclosure | The same authoritative cart-line read and explanations | Unavailable lines natively disable the simulated purchase; its description names the blocker. Focus moves to the warning, then returns to the enabled action if that warning disappears |

Developer diagnostics (`StockStatusSpecimen`, `BookCardStockPreview`, `BookCardSpecimen`) use the same production component/model. Theme previews are fixtures, not additional business rules.

`resolveStockStatus` is the sole interpretation of a confirmed availability read: **Disponible** or **No disponible**, decorative mark/symbol, optional exact explanation and stock eligibility for purchase/quantity controls. True wins over a residual reason. False without a known reason never invents “Agotado” or an inventory cause. Stock eligibility allows an attempt, not a reservation or a promise that another cart unit is covered; PostgreSQL retains final command validation.

`resolveCartAction` applies the same stock eligibility plus the operation/permission state, and gives all card/row/scene consumers their visible text, accessible label, icon and enabled/busy state. Unavailable always has native `disabled`. A pending available operation uses `aria-disabled`, retains focus and has no active handler. Authentication, permissions, an unknown command outcome and a missing PDP price remain explicit separate restrictions; they never change the stock read.

A quantity or sale-state command rejection describes that attempt and refreshes authoritative stock. It never permanently sets a local edition-unavailable flag. A later confirmed available read restores the action; unknown mutation outcomes still require reconciliation and are never blindly repeated. Sale-state rejection feedback uses past tense so it cannot contradict a later available read.

BookCard production expectations now name the explicit `quiet` variant, and the pending diagnostic waits for `aria-busy` before inspecting the state. Its disabled matcher is supplemented with a native-property/focus/duplicate-activation check; all unavailable transition and enlarged-text checks also assert the actual native `disabled` property.

All stock-bearing queries share `stockReadOptions`: existing mount/mutation reads plus stale-data refresh on return to the browser tab. There is no polling or claim of instantaneous inventory synchronization. Static StockStatus instances have no role, live region or tab stop; their surfaces own announcements and focus recovery. Focus recovery only acts on the action that lost focus, never on an unrelated focused control.

The approved colors, words, mark/symbol treatments, cart outlines and layouts are preserved. Quiet treatment CSS is centralized; consumers supply color variables rather than hide symbols and reinterpret stock independently. PDP's column/button can wrap at enlarged text without changing its normal design.

## RED evidence and fixes

- Seven new real-consumer failures: unavailable quantity increases lacked native disable; unavailable/unknown reasons could permit increases; stale reasons suppressed available quantity controls; Favorites and PDP remained blocked after restock; checkout's stock blocker was only ARIA-disabled. `/tmp/pliego-stock-red-unit.log`.
- Six dynamic consumer paths lost focus to BODY when a current read removed/disabled the focused action. `/tmp/pliego-stock-red-focus.log`. The initial transition harness also exposed that the application globally suppressed focus refresh; the stock-bearing read policy now opts into stale-data refresh.
- A focused checkout warning could disappear on restock and strand focus; coverage checks return to the re-enabled submit action.
- Public-edition withdrawal (404) removed the focused PDP action and stranded focus despite its alert. Withdrawal and republication now focus the missing-edition heading and restored edition heading without exposing stale stock or sending a command. `/tmp/pliego-stock-red-withdrawal.log`.
- At 320px and 200% text the PDP column expanded to 342px and caused 34px page overflow. The favorite control's intrinsic size prevented wrapping. `/tmp/pliego-stock-red-200.log`. The column now has `min-width: 0` and the control can wrap within its parent.

Browser transition coverage checks both 320px and 1280px, available → unavailable → available, exact focus destinations, suppressed native disabled clicks, accessible descriptions and preservation of unrelated focus. Enlarged-text coverage visits Catalog, Favorites, both PDP states, Home scenes/editorial feature, Cart and Checkout at 320px/1280px in light/dark with reduced motion. Existing 320–1920px diagnostic and production contrast/reflow/keyboard checks remain effective.

## Verification

| Gate | Result | Complete log |
| --- | --- | --- |
| Focused unit/component regressions | PASS: 68 cases before final quiet-variant additions | `/tmp/pliego-stock-target-unit.log` |
| Complete frontend unit/component suite | PASS: 309 tests in 39 files | `/tmp/pliego-stock-vitest-full.log` |
| TypeScript and production build | PASS | `/tmp/pliego-stock-build.log` |
| Focused StockStatus Chromium suite | PASS: 18 tests, including all four original failures and PDP withdrawal/republication | `/tmp/pliego-stock-focused-e2e.log` |
| Related BookCard/StockStatus focused browser gate | PASS: 34 cases before the final withdrawal addition | `/tmp/pliego-stock-focused-final-e2e.log` |
| Complete frontend Playwright suite | PASS: 120 passed, zero failures, 71 existing configuration-gated skips | `/tmp/pliego-stock-e2e-full.log` |
| Whitespace | `git diff --check` | Direct check |

This evidence covers Chromium and the controlled API responses used by real application consumers, not a new backend/live-server gate or screen-reader speech/braille run. Enlarged text is tested through doubled root text sizing. Business routines, migrations, approved root baselines and previous audit fixes were preserved. No commit, push or deployment was performed.

No stock-related inconsistency remains in the audited consumers and states. Screenshots at 320px/200% text were inspected; complete logs and retained traces remain on temporary disk.
