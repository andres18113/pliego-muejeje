# Confirmed validation/error-handling findings — verification

2026-10-04. Scope is the six confirmed validation findings only. Preserve the existing UI/design and P1 integrity/accessibility fixes. No unrelated P2 production changes, commits, pushes or deployment. See API amendment v1.0.11 and ADR-0019.

## Observed RED evidence

| Finding | Before-change evidence | Complete log |
| --- | --- | --- |
| Recipient limits | A valid 120+120 profile produced a 241-character recipient; real address HTTP rejected it at 200. The frontend lacked a recipient recovery control. | `/tmp/pliego-validation-red-recipient_limits.log`, `/tmp/pliego-validation-red-frontend.log` |
| Names | Real registration accepted `Gat1n` (201); replacement and precise profile requests accepted digits. Frontend registration/profile regressions failed before corrections. | `/tmp/pliego-validation-red-personal_names.log`, `/tmp/pliego-validation-red-backend.log`, `/tmp/pliego-validation-red-frontend.log` |
| Phones | Real registration accepted ambiguous national `0991234567`; formatted international input was rejected by the old backend; profile PATCH bypassed the phone rule. The profile widget stripped pasted extension text. | `/tmp/pliego-validation-red-phone_rule.log`, `/tmp/pliego-validation-red-backend.log`, `/tmp/pliego-validation-red-frontend.log` |
| Field errors | Error conversion discarded `violations`; password errors were assigned to email, city errors were general feedback, and checkout payment errors lacked their specific field description. | `/tmp/pliego-field-errors-red.log`, `/tmp/pliego-validation-red-frontend.log`, `/tmp/pliego-validation-red-checkout-fields.log` |
| Exact quantities | MockMvc POST fraction 1.5 returned 200 after truncation; real HTTP fraction reached PostgreSQL (P3002/409) rather than field validation. Overflow lacked its quantity description. | `/tmp/numeric-cart-red.log`, `/tmp/numeric-validation-http-red.log`, `/tmp/pliego-validation-red-cart-feedback.log` |
| Pagination | Real `page=2147483647&pageSize=50` returned HTTP 500. SQL helper accepted an unsafe product. | `/tmp/pliego-validation-pagination-red.log`, `/tmp/numeric-pagination-red.log` |

Further boundary regressions observed before correcting the associated implementation: punctuation-only optional phones were interpreted as clearing; country-picker search was captured as phone input; OpenAPI incorrectly represented BigDecimal quantity as string despite the integer annotation. Logs: `/tmp/pliego-validation-red-phone-junk.log`, `/tmp/pliego-validation-red-phone-search.log`, `/tmp/pliego-validation-numeric-http.log`.

## Completed gates

| Gate | Result | Complete log |
| --- | --- | --- |
| Targeted frontend forms, shared person rules and cart field errors | PASS: 69 tests before final checkout/shared-vector additions | `/tmp/pliego-validation-targeted-frontend.log` |
| Targeted Java person/cart boundaries | PASS: 24 tests before final punctuation/schema additions | `/tmp/pliego-validation-targeted-backend.log` |
| `mvn -B -Dmaven.repo.local=/tmp/pliego-m2 -f backend/pom.xml clean verify` | PASS: 138 tests, zero failures/errors | `/tmp/pliego-validation-maven-full.log` |
| Full frontend `npm test -- --maxWorkers=2` | PASS: 275 tests in 35 files | `/tmp/pliego-validation-vitest-full.log` |
| `npm run build` including full `tsc --noEmit` | PASS | `/tmp/pliego-validation-frontend-build.log` |
| PostgreSQL 18 `run_ci_gates.sh` on a new disposable database | PASS: all 38 Flyway migrations; SQL, concurrency and HTTP gates | `/tmp/pliego-validation-pg-full.log` |
| Targeted Chromium validation, purchase and accessibility | PASS: 17 tests | `/tmp/pliego-validation-e2e-targeted.log` |
| Complete Playwright, `--workers=2` | 95 passed, 4 existing failures, 70 configuration-gated skips | `/tmp/pliego-validation-e2e-full.log` |
| Approved migration comparison | PASS: 19 SQL files byte-identical to the approved ZIP | Direct zipfile comparison |
| `git diff --check` | PASS | No whitespace errors |

The disposable database was first migrated from empty through V038. Tests with old digit-bearing customer-name fixtures then exposed invalid fixtures, which were replaced by letter-only names and matching expected customer names. The complete SQL/concurrency/HTTP runner subsequently passed; no migration or business assertion was weakened. PostgreSQL is 18.6; Chromium uses Playwright 1.63.0.

## What the regressions establish

- Shared Unicode positive/negative cases execute in Java, frontend and PostgreSQL. Supplementary characters use code-point length; NFC accents preserve spelling and limits. Database routines reject invalid new names without changing profile version/state; precise unrelated edits preserve legacy phone data.
- Shared phone cases establish matching metadata/normalization, significant Italian zeros, explicit international prefixes, separator formatting, unsupported country codes, trunk-zero rejection, extensions and punctuation-only rejection. Invalid input remains visible for correction; country search does not mutate phone state.
- Real HTTP exercises registration, profile PATCH, recipient creation/replay, 242-character rejection and checkout of the 241-character recipient into the historical order snapshot. The frontend reveals the recovery control only when needed and retains other address data.
- Violation parsing retains valid field/message entries, removes rejected-value extras, and never guesses a field. Forms expose each affected control's invalid state/description, preserve submitted text, reveal hidden controls and focus the first mapped error. Cart retains the server quantity after a rejected edit.
- Raw JSON POST and PUT quantity tests use fractions, scientific fractions, high precision and int32 overflow; each rejection leaves cart/items/inventory unchanged. Exactly integral 1.0 works and response/OpenAPI quantity remains integer/int32.
- Public catalog HTTP and SQL test unsafe and safe extreme offsets, controlled P1006/400, page/pageSize type/range feedback and preserved P1001 mappings.

## Remaining gate failures and evidence limits

The four complete-Playwright failures remain the unchanged Light/Dark assertions in `stockstatus-diagnostic.spec.ts:15` (expects omitted icons) and `stockstatus-production.spec.ts:69` (expects BookCards on the current Favorites row layout). No StockStatus/Favorites production behavior was changed to satisfy those unrelated assertions. Opt-in live/visual suites retain their existing environment skips; no additional tests were disabled.

Numbering-plan metadata requires deliberate future paired updates; validation does not prove phone reachability/ownership. Existing nonconforming stored names/phones are preserved rather than rewritten; editing the affected field requires correction under the new rule. Unicode acceptance is pinned to version 17.0. Browser keyboard/error semantics are tested in Chromium; actual screen-reader speech/braille combinations were not exercised. Full logs remain on local temporary disk and the verification conclusions are recorded here.
