# P1 accessibility verification — 2026-10-04

Scope: only missing cart quantity in the accessible tree and hidden invalid optional address fields. Existing styles, layouts, payment/address robustness, API contracts, backend and P2 behavior are preserved. No commit, push or deployment.

## Acceptance criteria and implementation

1. Cart exposes the current server quantity together with its “Cantidad:” label. Increment/decrement with Enter/Space synchronizes that text and retains focus on the control. Existing control names, disabled semantics and status feedback remain unchanged. Implementation removes only `aria-hidden` from the numeric span.
2. Invalid line2/postalCode/reference in a closed native disclosure opens the section before focus is attempted. After rendering, focus moves to its first invalid optional field. Its Spanish validation message becomes visible and remains associated through `aria-describedby`; `aria-invalid` identifies the invalid state. The draft is preserved and correction permits Save. Already-open details retain existing first-error focus behavior. Native summary Enter/Space toggling remains available.

## Reproduction and RED evidence

- Vitest: cart numeric text was inaccessible, and the disclosure stayed closed for all three invalid optional fields. Four regressions failed before production changes. Full log: `/tmp/pliego-a11y-red-unit.log`.
- Chromium: the ARIA snapshot contained “Cantidad:” instead of “Cantidad: 2”; Save kept the invalid postal code inside closed details. Both reproductions failed at 375px and 1280px before production changes. Full log: `/tmp/pliego-a11y-red-browser.log`.
- jsdom does not implement summary keyboard activation fully, so disclosure setup in component tests uses native click. The real Chromium tests exercise summary Enter/Space and the complete recovery path with the keyboard.

## Verification

| Gate | Result | Complete log |
| --- | --- | --- |
| Targeted cart/address component tests | PASS: quantity semantics and all optional fields; open-disclosure first-error behavior also covered by the full suite | `/tmp/pliego-a11y-targeted-unit.log` |
| `npm test` | PASS: 221 tests across 31 files | `/tmp/pliego-a11y-vitest-full.log` |
| `npm run build` including `tsc --noEmit` | PASS | `/tmp/pliego-a11y-build.log` |
| Targeted Chromium accessibility, purchase and cross-tab regressions | PASS: 16 tests | `/tmp/pliego-a11y-targeted-browser.log` |
| Full Playwright, `--workers=2` | 93 passed, 4 existing StockStatus failures, 70 configuration-gated skips | `/tmp/pliego-a11y-e2e-full.log` |
| `git diff --check` | PASS | No whitespace errors |

Chromium's native CDP Accessibility tree confirms cart StaticText for the initial value and both keyboard changes. The postal-code textbox is present with its exact label, the Spanish maximum-length description and native invalid state after revealing the disclosure. Tests verify focus, error/field visibility, field viewport bounds, error in viewport, preserved input and one successful update after correction.

The browser tests double computed font sizes for the relevant cart value, form labels, summary text, input values and Save text, including fixed-pixel fonts. Newly inserted error text is also doubled. At 375px and 1280px, keyboard recovery and saving remain available and no horizontal page overflow is introduced. This is a scoped 200% text-resize check, not a page-wide WCAG conformance evaluation.

## Evidence boundary and remaining risks

Tested browser: Chromium through Playwright 1.63.0 on Linux. Actual screen-reader speech/braille combinations such as NVDA/Firefox or VoiceOver/Safari were not tested. Browser accessibility-tree evidence establishes the represented names, text, descriptions and states; it does not establish a general WCAG conformance verdict.

Existing StockStatus E2E assertions outside this P1 scope expect omitted icons and BookCards on the current Favorites row layout. Their production behavior and assertions were not changed. Opt-in live/visual suites retain their existing environment-based skips.
