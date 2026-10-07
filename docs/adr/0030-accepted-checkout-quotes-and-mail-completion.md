# ADR 0030: Accepted checkout quotes and observable mail completion

Date: 2026-10-06. Status: accepted within the authorized final robustness audit.

The frontend re-read the cart before checkout, but a second tab or offer expiry between that read and the command could change the purchased quantities or prices. An isolated real HTTP reproduction reviewed one unit and created an order for two. An outbox worker could also log `SENT` after its owner/state-fenced completion was ignored by PostgreSQL.

PostgreSQL produces `quoteFingerprint` from the actor, cart, sorted edition/format/quantity/pricing lines and merchandise/tax/shipping totals. The frontend passes this opaque value as `expectedQuoteFingerprint`. `sp_checkout_quoted` serializes actor/key attempts and holds the cart and ordered edition/book locks while comparing the accepted fingerprint before invoking the existing business checkout. A mismatch publishes new SQLSTATE `P4005` / HTTP 409 with Spanish review-and-confirm feedback. Existing SQLSTATE mappings are preserved.

The fingerprint is captured with the immutable checkout receipt INSERT. Replay compares the original fingerprint and command metadata before consulting any current cart or prices; changed payloads retain `P1010`. V063 introduces the additive projection/contract; V065 replaces its attempted post-insert update after the existing immutable-history trigger rejected that path in the disposable database. No trigger or historical migration was weakened. The existing Spring transaction owns all order, payment, stock, grant, receipt and outbox effects.

For compatibility, requests that do not assert `expectedQuoteFingerprint` retain the approved current-cart contract. The shipped frontend supplies the returned fingerprint; clients that need accepted-quote protection must retain and send it. Historical PostgreSQL signatures remain available. This is an additive API extension, not a payment-provider integration.

`fn_mail_outbox_try_complete` locks the matching SENDING/owner row and returns whether the existing completion routine applied. The worker logs `STALE_COMPLETION` instead of persisted success when the fence rejects it, preserving a valid provider receipt ID in operational logs for reconciliation. V064 retains old void maintenance signatures. Provider acceptance remains distinct from mailbox delivery; uncertain acceptance stays terminal/recoverable by reconciliation rather than blind resend.

Evidence: final audit accepted-quote HTTP gate (quantity, price, equal-total substitution, concurrent duplicate, lost-response replay, actor isolation, master-lock wait and real offer expiry); rollback gate reaches approved payment/grant/email/receipt before injecting failure; mail completion gate rejects wrong-owner/reaped/terminal completions. See `docs/audit/final-release-2026-10-06/`.
