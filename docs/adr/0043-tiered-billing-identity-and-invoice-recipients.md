# ADR-0043: Tiered billing identity corrections and separate invoice recipients

Date: 2026-10-25. Status: accepted. Extends ADR-0040 and ADR-0041; supersedes the specific decisions identified below.

## Context

PLIEGO keeps one Ecuadorian billing identification on each customer account. A typo can be corrected, but once that number appears on an invoice the system must preserve the invoice snapshot and review changes that could change the buyer's identity. Checkout also needs to support an invoice issued to someone other than the account holder without changing that holder's profile.

## Decision

### Correction tiers

- Registration is unchanged: no identification is collected at account registration.
- PostgreSQL defines whether the account has ever been **used for billing**: at least one invoice in any state, including `DRAFT`, for an order belonging to the customer has recipient kind `ACCOUNT` or `NULL` (the historical value before recipient kind was recorded). An `OTHER` invoice does not count. This is account-level history and remains true after the account number changes, including through same-person conversion or admin approval; it is not a comparison against the current number. No cross-account uniqueness assumption is made.
- A correction is direct when the number has never been used. It remains a compare-and-set against the number shown to the customer (`P1105` on mismatch), and it writes an immutable event. No current password is required. The legacy JSON field `currentPassword` remains optional and is ignored.
- Once an account has been used for billing, a cédula ↔ natural-person RUC change remains direct only when the RUC is the same ten-digit cédula followed by `001`. This uses a distinct audit action. Other changes create a correction request; a direct-correction attempt returns `P1107 BILLING_IDENTITY_CORRECTION_REQUIRES_REVIEW`.
- A direct correction, including the same-person exception, returns `P1108 BILLING_IDENTITY_CORRECTION_PENDING` while a correction request is pending. This keeps the request's compare-and-set snapshot actionable.
- The read model sets `used=true` and `correctionMode=REQUEST` if any ACCOUNT or historical NULL invoice exists, even after the account number changes. OTHER-only invoices leave the identity unused and `correctionMode=DIRECT`. The database still accepts the same-person cédula/RUC exception as a direct correction when `correctionMode=REQUEST`.

### Correction requests

- A request stores the current type/number snapshot, proposed type/number, reason (`DOCUMENT_TYPO`, `DOCUMENT_CHANGED`, or `OTHER`), an optional trimmed note of at most 500 characters, status, timestamps, decision actor and customer-facing decision reason. `due_at` is computed by PostgreSQL as `created_at + 15 days`.
- There is at most one `PENDING` request per customer. Submit uses a customer-scoped UUID idempotency key and canonical payload fingerprint. The same key and payload replays the original request; a different payload returns the existing `P1010 IDEMPOTENCY_CONFLICT`.
- Customers may withdraw only their own pending request. Withdrawal records its closure timestamp in `decided_at` (with `decided_by` and `decision_reason` null) so the required recent-withdrawal read model can be derived without an unrequested second timestamp.
- Admins may list requests by status, paged oldest due first, and decide `APPROVE` or `REJECT`. Rejection requires a Spanish customer-facing reason. Approval compares the account to the submission snapshot and applies the existing correction internals with origin `STAFF_REVIEW`. A stale snapshot returns `P1105` and the transaction leaves the request pending.
- The request row is append-only except for a single `PENDING` → `APPROVED`, `REJECTED`, or `WITHDRAWN` transition. Submit, withdrawal, approval, and rejection append immutable `cliente_identificacion_evento` rows.
- Approval only affects future checkouts. No invoice in any state is updated.

### Checkout recipient

- `billingRecipient` is `ACCOUNT` by default and preserves current checkout behavior, including identity registration on first billed checkout and `P1106` when the submitted number differs from the account.
- `billingRecipient=OTHER` snapshots the validated buyer name, cédula/RUC, and billing address on the invoice only. It neither registers nor changes `cliente_identificacion`, and it does not use `P1106`. A customer without a saved identification stays without one.
- Invoice `destinatario_tipo` is added nullable without a default, then receives a default of `ACCOUNT` for future inserts. Historical rows remain `NULL`, because the recipient is unknown. The API value names are `ACCOUNT` and `OTHER`. The recipient kind participates in the existing idempotency fingerprint. Checkout effects remain in the current atomic PostgreSQL procedure, and issued invoice rows remain immutable.
- Same-payload `ACCOUNT` retries recorded before the recipient kind entered the fingerprint remain replayable. New attempts include the kind, so changing `ACCOUNT` to `OTHER` or vice versa under one key conflicts.

### RUC validation

- Cédulas and natural-person RUCs keep modulo-10 validation; a natural-person RUC remains a valid cédula plus establishment `001`–`999`.
- Public-sector (third digit `6`) and private-company (third digit `9`) RUCs keep 13 digits, valid province, the appropriate third digit, and a nonzero establishment; they no longer require the legacy modulo-11 check digit. This relaxes validation only; existing rows and invoice snapshots are not rewritten.
- Java, PostgreSQL, and the shared frontend validator use the same fixtures for the relaxed public/private company RUC rule.

## Supersession

- ADR-0040's re-authenticated/current-password correction requirement is superseded by the tiered workflow above. Its immutable audit, compare-and-set behavior, required registration/read-back, and rule that invoices never change remain in force.
- ADR-0040's rule that every billed checkout must use the account's identification is superseded only for `billingRecipient=OTHER`. `ACCOUNT` behavior remains unchanged.
- ADR-0041's modulo-11 requirement for public-sector and private-company RUCs is superseded. Cédula and natural-person RUC validation, province rules, establishment checks, and algorithm-only/no-ownership claim remain in force.

The approved migration set for this amendment is exactly V080 (billing identity correction workflow and admin paging) and V081 (invoice recipient snapshot, checkout procedure, and replay compatibility). These versions consolidate the unreleased V082–V084 drafts.

## Deferred decisions

- **Passport:** deferred to keep account billing identifiers within the existing cédula/RUC validators and invoice mapping.
- **Consumidor final at or below USD 50:** deferred because PLIEGO invoices are an academic simulation and every invoice remains named, independent of the real-world threshold.
- **Cross-account uniqueness:** deferred because an identifier does not prove account ownership and a global uniqueness rule could block legitimate shared or organizational billing.
- **Encryption at rest:** deferred until key management, rotation, backup, and search requirements have an approved design; the current access boundary and no-store response remain.

## Legal and SRI reference check (2026-10-25)

“VERIFIED” means the cited official text was checked for the stated subject; it is not a legal opinion on the complete PLIEGO simulation.

| Citation | Status | Checked subject |
|---|---|---|
| LOPDP Art. 10 | VERIFIED | Principles include purpose, minimization, accuracy, confidentiality, and security. |
| LOPDP Art. 14 | VERIFIED | Rectification/update requests are to be handled within fifteen days; the request due timestamp uses fifteen calendar days. |
| LOPDP Art. 18 | VERIFIED | Lists exceptions to rectification, updating, deletion, opposition, annulment, and portability; it is not the source of the fifteen-day period. |
| RGLOPDP Art. 12 | VERIFIED | Favors accessible, simplified digital channels and requires demonstrating title/representation. |
| RGLOPDP Art. 13 | VERIFIED | Describes information expected in a rights request. |
| RGLOPDP Art. 15 | VERIFIED | Requires registering requests and the attention given to them. |
| RCV Art. 19 | VERIFIED | SRI's 2024 circular confirms the current USD 50 consumer-final threshold. The SRI-hosted consolidated PDF modified in 2020 still displays the prior USD 200 text, so the circular is the current checked source for the threshold. |
| SRI RUC guidance | VERIFIED | SRI states that private/public company RUCs and foreign natural-person RUCs without a cédula have no specific validation algorithm mandated by current rules; PLIEGO retains its specified structural checks. |

Sources: [LOPDP official text](https://www.gob.ec/sites/default/files/regulations/2025-01/01%20Ley%20Org%C3%A1nica%20de%20Protecci%C3%B3n%20de%20Datos%20Personales.pdf), [RGLOPDP official text](https://www.gob.ec/sites/default/files/regulations/2025-01/02%20Reglamento%20General%20a%20la%20Ley%20Org%C3%A1nica%20de%20Protecci%C3%B3n%20de%20Datos%20Personales_0.pdf), [SRI 2024 circular on USD 50](https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar?id=6549b576-12c9-4d2f-a7cd-6e42d4cb887e&nombre=NAC-DGECCGC24-00000005.pdf), [SRI RUC guidance](https://www.sri.gob.ec/web/intersri/buscador?_com_liferay_portal_search_web_search_results_portlet_SearchResultsPortlet_INSTANCE_uzxPwvfxyoLa_assetEntryId=64533&_com_liferay_portal_search_web_search_results_portlet_SearchResultsPortlet_INSTANCE_uzxPwvfxyoLa_mvcPath=%2Fview_content.jsp&_com_liferay_portal_search_web_search_results_portlet_SearchResultsPortlet_INSTANCE_uzxPwvfxyoLa_type=content&p_l_back_url=%2Fbuscador%3Fq%3Dleyes%26delta%3D75&p_p_id=com_liferay_portal_search_web_search_results_portlet_SearchResultsPortlet_INSTANCE_uzxPwvfxyoLa&p_p_lifecycle=0&p_p_mode=view&p_p_state=maximized).
