# ADR-0019: Shared personal-data validation and precise numeric boundaries

## Status
Accepted within the user's confirmed validation/error-handling audit scope (2026-10-04).

## Decision
Keep the modular monolith, JDBC Database API and Spring transactions. Share a versioned language-neutral name repertoire/pattern, normalization, limits and Spanish messages in `shared/validation/person-rules.json`. Generate literal Unicode 17 letter/mark ranges so browser, JVM and PostgreSQL locale/version differences cannot change the accepted name repertoire. Use NFC, trim surrounding whitespace, and normalize space separators without dropping letters or symbols. Names have 1–120 Unicode code points per field, accepting letter/mark segments separated by spaces, straight/curly apostrophes and hyphens. Reject digits, inappropriate symbols and standalone marks.

Preserve these name limits and expand current/historical address recipient capacity to 241 code points (120 + space + 120). A recovery-only recipient control lets the user correct any server-rejected automatic recipient without changing their profile. Valid address UI stays unchanged.

Use matching Google phone metadata 9.0.40: existing libphonenumber-js 1.13.14/max on the frontend, libphonenumber 9.0.40 on Java. Require an explicit international prefix at the API/plain registration control; the profile/address country picker remains an explicit national-input context. Strip presentation separators only and reject extensions/letters. Parsing/formatting must leave all phone digits unchanged; do not silently discard a national trunk zero after a country code. The Database API enforces canonical structure; Java's shared input policy validates numbering-plan metadata before the command, like the existing transient CARD validation boundary. Do not rewrite existing stored data or historical snapshots.

Preserve server field violations and map their exact request-field names explicitly to each form control. Unknown violations stay general feedback; never infer a field from a generic validation code. Retain drafts and error associations/focus, including hidden address details.

Represent cart quantity exactly at the JSON boundary and convert only after exact integer/int32 validation. Preserve PostgreSQL's positive-quantity P4004 invariant. Bound pagination multiplication using BIGINT before existing INTEGER offsets execute; new overflow cases use additive P1006/400 while existing mappings stay stable.

## Validation
Observe RED component, MockMvc and live HTTP/SQL regressions before fixes. Share positive/negative Unicode/phone vectors; test recipient241 through checkout snapshots, precise profile versions, field-error routing, fractional/overflow quantities and extreme pagination. Run full frontend, Maven and PostgreSQL 18 gates plus relevant/full Chromium checks. No UI redesign, unrelated P2 corrections, commits or deployment.

Executed evidence: [validation verification record](../testing/validation-audit-verification-2026-10-04.md).
