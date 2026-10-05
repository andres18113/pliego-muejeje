# REST / Database API amendment v1.0.11 — confirmed validation findings

2026-10-04. Amends the approved baselines and v1.0.10 only for the six confirmed validation/error-handling findings. See ADR-0019. Approved root artifacts and V001–V036 are unchanged; no stored personal data or historical snapshots are rewritten.

## Names and recipients

Registration and replacement/precise profile updates share `shared/validation/person-rules.json` with the frontend. The pinned Unicode 17 repertoire accepts letter/combining-mark segments separated by spaces, straight/curly apostrophes (`'`, `’`) or hyphens (`-`, `‐`, `‑`). A combining mark must follow a letter. Digits, emoji, underscores, slashes, other symbols and control characters inside a name are rejected. Names are normalized to NFC; Unicode space separators become ordinary spaces and surrounding whitespace is trimmed. No letters are removed and no case is changed.

Each names/surnames field contains 1–120 Unicode code points after normalization, including supplementary letters. Browser controls do not impose UTF-16 maxlength truncation; submitted drafts remain intact on rejection. Examples: `Ána`, decomposed `Ána`, `李`, `محمد`, `नंदिनी`, `O’Connor-Pérez`, `Jean-Luc` are accepted. `Gat1n`, `Ana_`, `Ana🙂` are rejected with the field-specific message “Tus nombres/apellidos solo pueden contener letras, espacios, apóstrofes y guiones.” Empty and overlong fields receive their own specific messages.

Address recipient capacity is 1–241 Unicode code points, compatible with 120 names + one space + 120 surnames. V037 expands both `direccion.destinatario` and immutable order address snapshot storage to VARCHAR(241), and the address create/update routines use that limit. Recipients remain delivery text, not a new personal-name restriction. REST reports a `recipient` violation for missing/overlong values. Valid forms still derive the recipient from the profile; if it is invalid or rejected by the server, a labelled recovery input appears with the retained automatic value, the exact field message and focus. The user can correct it without changing their profile or other address fields.

## Phones

Frontend uses existing libphonenumber-js 1.13.14 with full (`max`) metadata; Java adds libphonenumber 9.0.40, the matching metadata release. Shared positive/negative cases are in `shared/validation/person-cases.json`. Phone numbers are optional in registration/profile and required for addresses.

API requests and registration's plain phone control require an explicit `+` country prefix. Spaces (including normalized Unicode space separators), parentheses, dots and hyphens are presentation separators. Only these separators are removed. Canonical representation is `+` followed by 7–15 digits with a nonzero initial country-code digit, then validated against numbering-plan metadata. Extensions, letters, unsupported country codes and invalid numbers are rejected. Formatting/parser output must preserve every original digit. A national trunk zero following a country code is rejected rather than silently dropped; significant zeros, such as Italian national numbers, remain supported.

The existing profile/address country picker supplies an explicit country for national input. It still normalizes national input within that chosen context; the backend receives the canonical international number. Pasted invalid extensions/symbols or ambiguous international input are preserved in the same styled control so the user can correct the actual text. Country-picker searches never mutate phone input.

Friendly messages distinguish missing prefix, invalid characters/extensions, invalid numbering-plan data and a trunk zero after the prefix. Explicit empty/null optional phones clear the field; punctuation-only input such as `()` cannot become an implicit clearing request. Java validates metadata before the business command, just as existing CARD data is validated at the boundary. PostgreSQL validates canonical phone structure through its Database API. Neither claims reachability or number ownership. Existing ambiguous phone data is preserved; a precise edit to an unrelated field does not revalidate or reinterpret that data.

## Authoritative field errors

Problem Details retains `violations: [{ "field": "requestField", "message": "specific Spanish message" }]`. Existing codes/status mappings remain stable. The frontend error object preserves all valid field/message entries, strips untrusted extra properties, and maps request-field names exactly:

- Registration/sign-in use their corresponding `firstNames`, `lastNames`, `email`, `password`, `phone` controls.
- Profile PATCH's `value` maps only to the currently edited names/surnames/phone control; other fields are not guessed.
- Email change maps `newEmail` to the email input and `currentPassword` to password.
- Address errors map to their actual controls; optional-field errors open the disclosure and recipient errors reveal recovery. Errors retain `aria-invalid`, visible descriptions and focus.
- Checkout maps `addressId`, `paymentMethod` and `cardNumber` to their controls; unknown errors remain general feedback.
- Cart `quantity` violations become line feedback while preserving the current server quantity.

No generic `VALIDATION_ERROR` is reinterpreted as an email error. Drafts survive field errors. A generic error without an applicable field remains general feedback.

## Exact quantities and safe pagination

Cart POST/PUT quantity remains a JSON integer/int32 in OpenAPI (1–2147483647). The backend parses numeric tokens exactly with BigDecimal, validates integral int32 representability and only then calls `intValueExact()`. `1.5`, `1.0000000000000001`, `1e-1` and out-of-int32 values return 400/`VALIDATION_ERROR` with a `quantity` violation: “Escribe una cantidad entera de hasta 2147483647, sin decimales.” No command, cart/inventory mutation or silent truncation occurs. An exactly integral token such as `1.0` is accepted as quantity 1. Nonpositive integers retain the approved PostgreSQL P4004 behavior.

V038 extends `fn_assert_pagination` using BIGINT multiplication. `page` must be a nonnegative int32 and `pageSize` 1–50. If `page * pageSize` exceeds 2147483647, public Database API routines return additive P1006/400 before any existing integer OFFSET expression can overflow. Largest representable offsets remain valid and return ordinary empty pages when beyond the result count. Existing invalid-input SQLSTATE P1001 remains unchanged. REST pagination violations/type errors return specific page/pageSize descriptions; P1006 advises returning to the first page or reducing page size.

## Sources and verification

The shared metadata pairing is recorded in the installed libphonenumber-js changelog (1.13.14 → 9.0.40), with the canonical library's [validation/formatting documentation](https://github.com/google/libphonenumber) and [release history](https://github.com/google/libphonenumber/releases). Literal name ranges avoid locale-dependent PostgreSQL [regular-expression character classes](https://www.postgresql.org/docs/18/functions-matching.html).

See the validation verification record for observed RED tests, complete test/gate results and evidence limitations. The fixtures that previously used digits in customer names were updated to valid names without weakening their business assertions.
