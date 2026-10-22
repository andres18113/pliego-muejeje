# ADR-0040: Identification required to buy, not editable, correctable with re-authentication

Date: 2026-10-21. Status: accepted. Partially supersedes [ADR-0037](0037-ecuador-billing-identity.md): the attribute is no longer optional, replaceable or removable.

## Context

Every purchase issues a named academic invoice, so an Ecuadorian identification is required to buy. PLIEGO validates the algorithm only; it does not query the civil registry or prove ownership. A mistyped number can therefore pass validation. Locking it forever would turn that typo into a permanent defect; leaving it as freely editable as any other field would let a fiscal datum change silently.

## Decision

- **One identification per account, required to buy.** `POST /api/v1/checkout` requires `billingIdentity`, `buyerName` and `billingAddress`. A billed purchase uses the customer's own identification: when the customer has none yet, the validated number of that purchase becomes theirs in the same transaction (`REGISTERED`, origin `CHECKOUT`). A different number returns `P1106 BILLING_IDENTITY_MISMATCH` and creates no order, attempt or invoice.
- **Explicit, confirmed registration.** `PUT /api/v1/me/billing-identity` registers the first number. Repeating the same number changes nothing, so a lost reply can be retried safely. A different number returns `P1105 BILLING_IDENTITY_CONFLICT` and never overwrites. The interface reads the full number back ("¿Es correcta tu cédula?") before storing it.
- **Not editable, but correctable.** There is no free edit and no removal: `sp_customer_billing_identity_set` and `sp_customer_billing_identity_remove` are retired and `DELETE` returns 405. `POST /api/v1/me/billing-identity/correction` requires the current password (`CURRENT_PASSWORD_INVALID`, as for the email change) and the number the customer saw (compare-and-set; if it changed, `P1105`). The interface also reads the number back before sending it.
- **Immutable audit.** `pliego.cliente_identificacion_evento` records every registration and correction (action, origin, previous and new number and type, timestamp) and is insert-only. A trigger blocks direct `UPDATE`/`DELETE` on `cliente_identificacion` except inside the correction command, for that customer only.
- **Issued invoices never change.** They keep their own snapshot; a correction applies to new invoices only.
- No cross-account uniqueness: knowing a number proves no ownership (ADR-0037 still applies). Existing customers need no data reset: a customer without an identification adds it in Mi perfil or at checkout.

## Consequences

- Typos are handled by the check digit, by reading the number back, and by a controlled correction: never silently, never from a stale tab, never by someone with an open session but without the password.
- The internal unbilled checkout routines (`sp_checkout_quoted`, `sp_checkout_idempotent`) remain for historical upgrade gates; the REST API no longer exposes them.
- Verifying ownership against an official source is out of the academic scope; it would be added as an extra state without changing this model.
