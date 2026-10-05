# Remaining P2 robustness and accessibility verification — 2026-10-04

Scope: the six remaining confirmed favorites, profile draft, authentication destination, focus, search name and authentication-link findings. The existing PLIEGO design is preserved. This pass changes frontend behavior and regression coverage only; the existing authoritative favorites status API and versioned profile PATCH already provide the required backend boundaries. Previous validation/P1 changes in the working tree were retained.

## Reproduction and RED evidence

| Finding | Reproduction before the corresponding fix | Full evidence |
| --- | --- | --- |
| Lost favorites response | DELETE changed server membership; aborting the response left the catalog heart pressed and claimed the earlier membership | `/tmp/pliego-p2-red-e2e.log` |
| Profile draft | Leaving/returning removed the editor and draft; appending text during a deferred PATCH removed that text on completion | `/tmp/pliego-p2-red-profile.log` |
| Authentication destination | Addresses returned `/catalog`; order-history search was discarded | `/tmp/pliego-p2-red-unit.log` |
| Favorites focus | Removing a focused row left the surviving row action unfocused; the regression also covers the final empty-state recovery | `/tmp/pliego-p2-red-e2e.log` |
| Search name | The visible “Buscar libros” could not locate the trigger by accessible name | `/tmp/pliego-p2-red-e2e.log` |
| Authentication links | Computed text decoration was `none` in sign-in and registration | `/tmp/pliego-p2-red-e2e.log` |

The two valid profile RED failures were recorded after correcting the test harness import. No implementation fix preceded those reproductions.

## Resulting behavior and regression coverage

- Favorites read the exact requested edition's authoritative status after a transport/server failure. No outcome-unknown mutation is repeated. A failed reconciliation removes `aria-pressed`, explains the uncertainty and makes the action a read-only “Consultar favorito”. A successful read updates cached status across surfaces. Incomplete, duplicate or mismatched status snapshots cannot establish success. Busy controls retain keyboard focus and ignore duplicate activation.
- Profile drafts are scoped to the customer and field in session storage, including phone country and the original concurrency version. They survive route navigation, reload and reauthentication in the same browser session. An in-memory fallback preserves route navigation if storage writes fail; reload persistence then depends on browser storage availability. Passwords are never stored. New input during a save stays in the editor; a confirmed save advances the baseline for the next edit. Restored editors share the in-flight lock/status. Escape/Cancel deliberately discards the draft and recovers focus.
- Authentication validates actual supported Account/customer destinations and preserves their query and fragment. The guest gate passes the full requested location through sign-in, registration and back to the original route. External, malformed and unsupported routes retain the safe fallback.
- Favorites focus recovery chooses the next surviving row at the removed row's position, or the preceding final row, then the appropriate empty-state heading. Tab from the final empty heading reaches the catalog action. The recovery only acts when the removed row held focus and the browser has fallen back to BODY.
- Search keeps its visible design/text and names its trigger “Buscar libros en el catálogo”. The search dialog/input retain their established names. Authentication switch links retain their colors and gain a persistent underline.

25 additional unit/component cases cover destination validation; navigation/save/concurrency/password/country/invalid-phone/cancel draft cases; successful, unchanged and unconfirmed favorite reconciliation; and invalid authoritative snapshots. Eleven deterministic browser cases cover keyboard focus/recovery, uncertainty, destination switching, visible names, link recognition/contrast, adaptation and draft restoration. A new live case aborts an actual successful server DELETE response, verifies the authoritative status and proves exactly one DELETE.

Stale E2E expectations were updated for the search trigger name, favorites row presentation, profile field editors/headings, session profile headings, and scoped account-menu/inline-form selectors. Popover measurements wait for fonts and permit one CSS pixel of subpixel rounding while retaining size, placement and reflow assertions. StockStatus expectations were left unchanged.

## Gates and evidence boundary

| Gate | Result | Full log |
| --- | --- | --- |
| Targeted profile/auth and favorites regressions | PASS | `/tmp/pliego-p2-target-unit.log`, `/tmp/pliego-p2-extra-unit.log`, `/tmp/pliego-p2-profile-edges.log` |
| Complete Vitest | PASS: 300 tests, 38 files | `/tmp/pliego-p2-vitest-full.log` |
| Complete TypeScript and production build | PASS | `/tmp/pliego-p2-build.log` |
| Complete Java `mvn clean verify` | PASS: 138 tests, zero failures/errors | `/tmp/pliego-p2-maven-full.log` |
| PostgreSQL 18 complete Flyway/SQL/concurrency/HTTP runner | PASS on a fresh disposable database, all 38 migrations | `/tmp/pliego-p2-pg-full.log` |
| P2 Chromium browser coverage | PASS: 11 cases | `/tmp/pliego-p2-adaptive-e2e.log` and final complete E2E log |
| Relevant live account/favorites/session browser coverage | PASS: 4 tests against a fresh migrated database | `/tmp/pliego-p2-live-e2e.log` |
| Complete Playwright | 106 passed, 4 unchanged StockStatus failures, 71 configuration-gated skips | `/tmp/pliego-p2-e2e-full.log` |
| Approved migration comparison and whitespace | PASS: 19 ZIP SQL files byte-identical; `git diff --check` | Direct comparison/check |

The first PostgreSQL runner ended when the Python interpreter segfaulted in an existing concurrency script; repeating the complete runner on a fresh database passed. Live browser setup explicitly allows the localhost frontend origin. Its final database is separately migrated and seeded with a small representative catalog through public routines; SQL/concurrency gate fixtures accumulate many synthetic categories and are unsuitable visual fixtures.

Chromium keyboard evidence covers Enter, Tab, Escape, focusable busy controls, removal/recovery and authentication switching. Adaptation covers doubled computed text sizes, CSS zoom 2, 320px reflow and reduced motion; CSS zoom is an approximation rather than a claim of native browser-zoom testing. Light/dark authentication-link contrast is checked using axe-core color-contrast rules. Screenshots were inspected and the new draft status was placed across the editor width to keep feedback readable. Actual screen-reader speech/braille and other browsers were not exercised; these checks are bounded evidence, not a WCAG conformance claim.

All six scoped P2 findings are closed. Unrelated StockStatus diagnostic/production E2E failures remain outside this pass.
