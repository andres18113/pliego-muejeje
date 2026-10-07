# Authoritative purchase offer pricing — presentation handoff

This change prepares data for the requested Google Store presentation. CartPage, CheckoutPage, order confirmation, Mis pedidos and order detail layouts are intentionally untouched. Claude can consume the raw amounts and view models without implementing pricing calculations.

## Live cart

`GET /api/v1/cart` retains all previous fields and adds:

| Context | Fields | Meaning |
|---|---|---|
| Item | `currentPrice`, `currentSubtotal` | Existing effective unit price and effective merchandise line subtotal |
| Item | `originalPrice`, `unitSavings` | Current base unit price and authoritative offer saving per unit |
| Item | `originalSubtotal`, `lineSavings` | Base line subtotal and saving multiplied by the actual quantity |
| Summary | `originalSubtotal` | Base merchandise subtotal before offers |
| Summary | `savingsTotal` | Sum of authoritative offer line savings |
| Summary | `currentSubtotal` | Discounted merchandise subtotal; identical to legacy `subtotal` |

`totalCurrent` retains its historical meaning: the cart total including tax, not the new merchandise `currentSubtotal`. Do not relabel legacy `subtotal` as the original subtotal.

Use `toCartPricingViewModel` in `frontend/src/features/purchase/cartPricingViewModel.ts`. It supplies raw decimal strings, formatted labels, and field availability. Zero savings are explicit; an older response without the new fields keeps its current prices and does not fabricate a discount.

## Immutable purchase history

Checkout/checkout resolution, order summaries/recent orders and order detail include `originalSubtotal`, `savingsTotal`, `currentSubtotal`, and `pricingSnapshotAvailable`. The existing `subtotal`, `taxRate`, `taxAmount`, `shippingAmount` and `total` retain paid historical values; the list summary now also forwards that breakdown.

Detail items retain `unitPrice` and `subtotal` as paid amounts and add `originalPrice`, `unitSavings`, `originalSubtotal`, `lineSavings`, and `pricingSnapshotAvailable`. Summary item listings remain lightweight title/format/quantity records; use the existing order detail API for historical item-level prices. Confirmation can render its immediately returned summary and load full detail through the existing flow.

Use `toOrderPricingViewModel` in `orderPricingViewModel.ts` for checkout results, order summaries and detail. `toMisPedidosOrder` exposes optional `historicalPricing` and preserves its earlier shape for legacy responses. The view models return unknown original/savings as null when the server snapshot flag is false or fields are missing. They retain paid amounts independently of the current catalog.

All money is an authoritative decimal string. Formatting is allowed; calculating savings, comparing dates to determine offer validity, applying tax or reconstructing old original prices is not. For quantity greater than one, the unit price display and line savings are different server fields. Use `lineSavings` for the item's quantity-wide saving and `unitSavings` only when explicitly showing a per-unit saving.

## Invariants and expiry

`originalSubtotal - savingsTotal = currentSubtotal`; `currentSubtotal + taxAmount + shippingAmount = total`. Item equivalents use `originalPrice - unitSavings = currentPrice` (cart) or `unitPrice` (order), and `originalSubtotal - lineSavings = currentSubtotal` (cart) or `subtotal` (order).

The next authoritative cart read reflects expired/deactivated/future/suppressed offers. Completed order original/paid/savings values remain immutable after those events, cancellation, refund and idempotent checkout replay. Previous orders without original-price evidence are explicitly unknown; do not substitute today's base price or infer zero historical savings.
