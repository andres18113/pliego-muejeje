# Frontend IHC evidence — 2026-10-06

Scope: read-only frontend review against AGENTS.md, approved design language, UX baseline, Impeccable audit and Web Interface Guidelines. Root integrated fixes; this audit wrote only evidence. Browser API calls were intercepted with synthetic fixtures; no shared database commands were sent.

## Executed checks

- Narrow Vitest: 2 files, 5 tests passed, 13 skipped. Library isolated 404/private-cache and orders failed-read/API-failure/expired-session tests.
- `e2e.log`: 6 existing fixture tests passed; quantity keyboard and collapsed-address error recovery at 375/1280px with relevant rendered text doubled, plus registration/profile/server-field recovery.
- `tablet-keyboard.log`: 2 copies of those keyboard/address tests passed at 768px; temporary test files stayed in `/tmp`.
- `before-browser-results.json`: delayed keyboard navigation to library/Help details left BODY focused at 375/1280px. Pre-fix library screenshots retained as `before-library-detail-*.png`.
- `after-browser-results.json`: library/Help headings focused after delayed reads at 375/768/1280px, reduced motion; no horizontal overflow on sampled list/detail/Help surfaces. Post-fix screenshots `after-library-detail-*.png`.
- The post-fix browser script ran axe `color-contrast` only on the light library detail: zero violations and zero incomplete results; 36/37/37 nodes passed at 375/768/1280px.
- `isolated-baseline-cases.log`: 5 prior failure cases passed with one worker and unique output: StockStatus dark production, StockStatus enlarged keyboard, pickup at 390px including axe, mixed checkout, registration validation.

## Findings and dispositions

| Finding | Root cause | Disposition/evidence |
|---|---|---|
| Unknown cart undo could repeat additive POST after recovery GET also failed | Restore error handler retained a POST retry while server result was unknown | Root replaced retry with GET-only `Consultar carrito`; source inspected in `CartPage.tsx`. Root owns command regression evidence. Existing successful-read `departedBack` guard already prevented duplication in that case. |
| Library 401 retained expired authority | Library hooks had private-cache metadata without session expiry handling | Root added shared expiry effect for list/detail; source inspected in `libraryQuery.ts`. |
| Async detail route lost reading focus | Route effect ran before h1 existed and never reran | Reproduced before; post-fix observer confirmed H1 focus at all three widths. Root's separate regression covers preserving deliberate user focus. |
| Shared read failure obscured permissions/throttling/service cause and allowed busy retries | ProblemDetail discarded; aria-disabled lacked handler guard | Root passes errors, gives status-specific Spanish recovery and guards busy retries; source inspected in `CartPage.tsx` and checkout pre-submit recovery. |

## Nielsen's ten heuristics

| Heuristic | Concrete example | Evidence |
|---|---|---|
| 1. Visibility of system status | Cart per-line feedback, loading/live statuses, orders stale-read notice | Source review; browser loading-to-heading checks. |
| 2. Match with real world | Spanish book/author/media facts, address objects, purchase/ownership state labels | Source review and library screenshots. |
| 3. User control and freedom | Undo, cancellation keep action, dirty-address discard confirmation | Source review; root corrected unknown undo recovery. |
| 4. Consistency and standards | Shared Field, ChoicePicker, ConfirmDialog; CUSTOMER gate | Source review; root aligned library 401 recovery. |
| 5. Error prevention | Availability guard, fresh cart read, submit lock, valid payment/destination requirements | Source review; pickup/mixed-checkout fixture checks passed. |
| 6. Recognition rather than recall | Covers/title/author, order snapshots, owned-item metadata, saved destinations | Source review and reflow screenshots. |
| 7. Flexibility and efficiency | Keyboard quantity picker, search shortcut, URL criteria/pagination | Keyboard checks passed at 375/768/1280px; delayed detail focus corrected. |
| 8. Aesthetic and minimalist design | Approved bookstore/account/purchase composition retained | Source and library screenshot review; no redesign introduced by audit. |
| 9. Recognize, diagnose and recover from errors | Associated field errors, conflict refresh, non-disclosing unavailable states | Registration/profile/address checks passed; root corrected read recovery. |
| 10. Help and documentation | Header Ayuda, published article route, library Help action | Source review and post-fix keyboard article navigation. |

## POUR

| Principle | Scoped evidence | Boundary |
|---|---|---|
| Perceivable | Native labels, text availability/ownership states, async status feedback; library light contrast scan passed; relevant controls at 200% text passed | No full-page zoom or complete production contrast evaluation. |
| Operable | Keyboard quantity/address recovery at 375/768/1280px; corrected async heading focus | No physical touch device or complete keyboard walkthrough of every route. |
| Understandable | Spanish associated field errors, retained correctable values, explicit no-order/unknown outcomes, corrected read recovery | Status-specific reads are partly source-reviewed; not every endpoint/status permutation was executed. |
| Robust | Semantic main/nav/headings and maintained Mantine widget/dialog contracts; Chromium DOM/axe checks | No NVDA/VoiceOver/Jaws sessions or Safari/Firefox evidence. This is not a WCAG conformance claim. |

## HTTP recovery mapping

| Status | Concrete recovery | Evidence type |
|---|---|---|
| 400 | Auth/profile/address violations map to exact controls; cart quantity violations remain local | Source review; fixture registration/profile/address checks executed. |
| 401 | Protected work clears authority and offers sign-in with safe return path; library now follows shared behavior | Orders expired-session unit executed; library correction source inspected. |
| 403 | CUSTOMER role gate; shared reads now explain denied access and offer a permitted destination | Source inspected. |
| 404 | Isolated unavailable catalog edition/acquisition; order non-disclosure; stale cart item refresh | Source inspected; library isolated 404 unit executed. |
| 409 | Stock/category/pickup conflicts refresh dependencies and preserve safe context | Source inspected; dedicated command-conflict suites not rerun by this audit. |
| 429 | Shared read feedback now explains waiting instead of a connection fault | Source inspected; no Retry-After timing claim. |
| 500 | Checkout/cancellation preserve unknown outcome; cart undo now reads before another additive command | Source inspected; root owns command regressions. |
| 503 | Reads distinguish failure from empty and stale snapshots; actionable service recovery | Orders API-failure unit and pickup recovery/browser checks executed. |

## Initial runner failures

StockStatus dark/enlarged, mixed checkout and registration baseline failures were `browserContext.close` ENOENT under shared `frontend/test-results/.playwright-artifacts-*`. Root confirmed concurrent Playwright processes deleted each other's default artifacts. Isolated unique-output reruns passed. Pickup390 failed during axe with a destroyed frame execution context, without reporting a rule violation; isolated rerun passed.

The StockStatus checkout test expected `Hacer pedido` enabled before selecting/confirming payment. This contradicted the current `!paymentReady` submit guard and the pickup suite's own disabled expectation. Root owns updating that obsolete fixture expectation; this audit did not edit tests.
