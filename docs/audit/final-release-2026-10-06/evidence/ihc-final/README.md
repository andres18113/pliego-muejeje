# Final focused frontend IHC — frozen source, 2026-10-06

Chromium/Playwright 1.63, reduced motion, 375px mobile, 768px tablet and 1280px desktop. Public pages read the isolated API through frontend on port 5174; a single catalog 503 was injected per context and removed before retry. Guest form validation remained entirely local. Quantity checks used a separate synthetic CUSTOMER context with every API intercepted. No business command reached the database; no credentials or raw traces were saved.

41 representative public stage captures, three shared quantity checks and three guest validation checks completed. Zero browser page errors, zero attempted business writes and zero horizontal overflow in the tested surfaces. Search, edition, Help article, 404 and 404 → Home navigation explicitly waited for the destination heading and its focus. Search submission and returning Home were verified after route commit, avoiding old-heading measurements during lazy navigation.

## Nielsen's ten heuristics

| Heuristic | Concrete evidence at the three widths |
|---|---|
| 1. Visibility of system status | Catalog exposes a Spanish 503 alert and retry; successful authoritative read removes the alert. Combobox expanded state changes false→true→false. |
| 2. Match with real world | Public edition facts use title/author/price, media labels and textual availability; forms show correo/contraseña and Spanish correction messages. |
| 3. User control and freedom | Escape closes search and restores its trigger; Escape closes mobile/tablet filter drawer and restores its trigger; Escape dismisses sort/quantity without changing the selection; 404 offers keyboard recovery home. |
| 4. Consistency and standards | Shared ChoicePicker sort and quantity both expose collapsed/expanded state, popup ID and retained focus. The exact maintained Mantine attributes now pass aria-required-attr. |
| 5. Error prevention | Guest favorite intent navigates to sign-in rather than sending a write. Empty credentials cannot submit: both fields become invalid and focus lands on email; no authentication POST is sent. |
| 6. Recognition rather than recall | Covers or visible missing-cover placeholders accompany titles; sort choices are displayed in a labelled listbox; applied search criteria remain in the URL; the guest return intent is preserved. |
| 7. Flexibility and efficiency | Skip link focuses main; slash opens search; Enter searches/navigates; ArrowDown opens sort and quantity; Escape restores the expected reading/control position. |
| 8. Aesthetic and minimalist design | Home/catalog/edition screenshots retain the approved bookstore composition. Home375 was visually reviewed; no clipping or visual change was introduced by the semantic combobox fix. |
| 9. Recognize, diagnose and recover from errors | Injected503 gives Spanish title/detail and a keyboard retry that returns to a 200 read. Empty form errors are associated through aria-describedby; missing-page recovery returns to a focused Home heading. |
| 10. Help and documentation | Published Ayuda list and an actual article open by keyboard with the article heading focused; search exposes its title/author/ISBN guidance and keyboard instructions. |

## POUR

| Principle | Observed outcome | Evidence boundary |
|---|---|---|
| Perceivable | Visible textual availability, media and error messages; explicit labels; six targeted axe rules scanned catalog at all widths. | One contrast alert per width concerns only inactive pagination Anterior; see exemption below. No dark-mode or full-page zoom conclusion from this run. |
| Operable | Keyboard skip/search/filter/sort/quantity/edition/Help/404 tasks complete; appropriate heading/control focus retained; no measured horizontal overflow. | No physical touch device or full keyboard enumeration of every route. |
| Understandable | Spanish error/correction copy, preserved guest return intent, disabled invalid transitions and clear retry/home recovery. |503 and 404 recovery plus local validation executed here; other HTTP status/private flows belong to separate root gates. |
| Robust | Native form names/descriptions and password masking checked; combobox aria-expanded/aria-controls resolve the current listbox; zero page errors. | Chromium DOM/axe evidence only; no NVDA/VoiceOver/JAWS or Safari/Firefox evaluation. No general WCAG conformance claim. |

## Required state and contrast findings

The earlier closed-sort defect was repaired through Combobox.Target withExpandedAttribute. This final pass verified closed false, open true with aria-controls matching the rendered listbox, Escape false and retained focus on both sort and quantity at all three widths. Current axe reports zero aria-required-attr findings.

Axe still reports Anterior at 3.37:1 on the first catalog page. Pagination.tsx:52 renders an aria-hidden, inactive span without href, handler or tabindex. It represents a disabled previous-page action and meets the inactive user-interface-component exception in WCAG 1.4.3; it is not an active text/control defect. All other measured catalog text passed the targeted contrast scan. The raw finding remains in results.json and is explicitly classified, rather than silently discarded.

## Artifacts

summary.json is the compact result; results.json contains 41 public stage records and raw targeted axe findings. quantity-results.json records the synthetic ten-option quantity listbox states and focus. guest-validation-results.json records local field errors and zero business writes. Four representative screenshots are preserved alongside this report; full logs and remaining screenshots stay under /tmp/pliego-final-audit/ihc-final-scope/. No unresolved actionable finding was reproduced in this frozen final scope.
