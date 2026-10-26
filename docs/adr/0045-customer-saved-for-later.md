# ADR-0045: Customer Saved for Later list

## Status

Accepted for the backend API and PostgreSQL implementation, 2026-10-25.

## Context

The cart's “Guardar para después” action currently uses `pliego.cliente_favorito` (V029) and removes the cart line. Favorites and deferred cart intent have different meanings: saving a cart line must preserve its quantity and must not change whether the customer follows an edition. Saved items also must not affect cart totals or checkout.

## Decision

Add `pliego.cliente_guardado_despues` in V083 with a generated saved-item ID, a unique `(cliente_id, edicion_id)` pair, customer and edition foreign keys, quantity, and creation/update timestamps. V084 adds the edition-side foreign-key index. Quantities are positive integers; digital editions are constrained to one. A physical quantity records what the customer chose while the item was in the cart. If current stock later falls below that quantity, the saved item remains visible and its restore attempt returns the cart's existing `P3002` error.

The public PostgreSQL Database API owns both moves:

- `sp_cart_save_for_later` locks the digital-purchase customer key, locks the active cart, and then upserts the saved row before deleting the cart line. When that edition already exists in Saved for Later, the latest cart quantity replaces the saved quantity; the row ID and creation time remain stable.
- `sp_cart_saved_move_to_cart` acquires those locks in the same order, calls `sp_cart_add_item` with the saved quantity, and deletes the saved row only after cart validation succeeds. The existing routine remains the sole authority for stock, edition/book status, digital ownership and pending orders, and digital one-copy behavior. A thrown error rolls back the entire move.
- `sp_cart_saved_remove` removes only the customer's saved row. `fn_customer_saved_for_later` returns the live cart commercial projection, including effective offer prices, availability, unavailability reason, format, and fulfillment capabilities.

All mutations run inside the Spring application-service transaction. The move endpoints return a fresh `{ "cart", "saved" }` snapshot from that transaction. The list endpoint returns `{ "items", "totalCount" }`; deleting a saved item returns `204`, allowing the client to remove the known ID locally.

`P4003 CART_ITEM_NOT_FOUND` continues to identify a cart line that is missing at move time. `P4006 SAVED_ITEM_NOT_FOUND` identifies a missing or foreign saved item. Existing cart and digital SQLSTATEs remain stable. PostgreSQL grants the runtime role row-level SELECT/INSERT/UPDATE/DELETE and identity-sequence USAGE for the new table; it receives no TRUNCATE or DDL privilege.

Favorites remain owned by V029 and are not read or written by these routines. Cart totals, accepted quotes, and checkout continue to read only active cart rows; Saved for Later is not a checkout source.

## Consequences

- A customer can independently favorite an edition, keep it in the cart, or save it for later.
- Moving a saved item to the cart preserves physical quantity when current validation allows it. If the item is unavailable or a digital purchase is owned/pending, the item stays saved and the cart stays unchanged.
- Repeated cart-to-saved moves cannot create duplicates. Concurrent same-item moves serialize on the database customer lock and cart row; one request applies and the other receives a safe not-found response.
- Saved quantities and current commercial values are separate: quantity is retained, while price, offer and availability are recalculated at read/restore time.

## Validation

Java API integration tests cover CUSTOMER-only access, DTO/OpenAPI fields, updated snapshots, Spanish not-found handling and existing cart error mapping. PostgreSQL 18 gates cover both directions, latest-wins uniqueness, digital quantity, stock rollback, digital already-in-cart behavior, favorites isolation, cart totals, checkout exclusion, app-role privileges, ownership/pending rollback and simultaneous moves. `mvn clean verify`, the full PostgreSQL 18 gate script and frontend API-type/typecheck commands remain release verification.
