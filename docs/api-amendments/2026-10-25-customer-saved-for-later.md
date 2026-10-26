# API amendment: Customer Saved for Later

Adds the CUSTOMER-only Saved for Later API described by [ADR-0045](../adr/0045-customer-saved-for-later.md). Existing cart and favorites contracts are unchanged. A saved row is keyed uniquely by customer and edition. Moving a cart line for an edition that is already saved replaces the saved quantity with the latest cart quantity; it does not add the quantities.

## Read Saved for Later

`GET /api/v1/cart/saved` returns every saved item with its current commercial projection. IDs are decimal strings. `quantity` is the quantity to restore; digital formats always have quantity one.

```json
{
  "items": [
    {
      "savedItemId": "501",
      "editionId": "250",
      "title": "1984",
      "authors": "George Orwell",
      "sku": "PLG-LIT-001",
      "coverUrl": "https://covers.pliegolibros.com/covers/editions/v2/PLG-LIT-001.webp",
      "quantity": 2,
      "currentPrice": "19.90",
      "currentSubtotal": "39.80",
      "available": true,
      "unavailabilityReason": null,
      "format": "PAPERBACK",
      "requiresPhysicalFulfillment": true,
      "quantityEditable": true,
      "originalPrice": "22.15",
      "unitSavings": "2.25",
      "originalSubtotal": "44.30",
      "lineSavings": "4.50",
      "savedAt": "2026-10-25T12:00:00Z",
      "updatedAt": "2026-10-25T12:30:00Z"
    }
  ],
  "totalCount": 1
}
```

`currentPrice`, offer amounts, `available`, and `unavailabilityReason` are recalculated by PostgreSQL when read. Supported reasons use the existing cart SQLSTATEs: `P2042`, `P2043`, `P3002`, `P4004`, `P6002`, and `P6003`.

## Move cart item to Saved for Later

`POST /api/v1/cart/items/{cartItemId}/save-for-later` has no request body. It atomically removes the active cart line and upserts its edition and quantity into Saved for Later. The response contains refreshed cart and saved-list snapshots so the client can update both without another read.

```json
{
  "cart": {
    "cartId": "40",
    "state": "ACTIVE",
    "items": [],
    "totalCurrent": "0.00",
    "subtotal": "0.00",
    "taxRate": "15.00",
    "taxAmount": "0.00",
    "shippingAmount": "0.00",
    "total": "0.00",
    "requiresPhysicalFulfillment": false,
    "physicalItemCount": 0,
    "digitalItemCount": 0,
    "originalSubtotal": "0.00",
    "savingsTotal": "0.00",
    "currentSubtotal": "0.00",
    "quoteFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "saved": {
    "items": [
      {
        "savedItemId": "501",
        "editionId": "250",
        "title": "1984",
        "authors": "George Orwell",
        "sku": "PLG-LIT-001",
        "coverUrl": null,
        "quantity": 2,
        "currentPrice": "19.90",
        "currentSubtotal": "39.80",
        "available": true,
        "unavailabilityReason": null,
        "format": "PAPERBACK",
        "requiresPhysicalFulfillment": true,
        "quantityEditable": true,
        "originalPrice": "19.90",
        "unitSavings": "0.00",
        "originalSubtotal": "39.80",
        "lineSavings": "0.00",
        "savedAt": "2026-10-25T12:00:00Z",
        "updatedAt": "2026-10-25T12:30:00Z"
      }
    ],
    "totalCount": 1
  }
}
```

A cart line that no longer belongs to the customer's active cart returns `404 P4003 CART_ITEM_NOT_FOUND`.

## Move a saved item to the cart

`POST /api/v1/cart/saved/{savedItemId}/move-to-cart` has no request body. PostgreSQL calls the same cart-add routine used by `POST /api/v1/cart/items`. It adds the saved quantity for physical editions. For digital editions already present in the cart, the cart remains at one unit. The response is the same `{ "cart", "saved" }` shape as the save operation.

The saved row is deleted only after cart validation succeeds. On any failure, the cart and saved row remain unchanged.

```json
{
  "cart": {
    "cartId": "40",
    "state": "ACTIVE",
    "items": [
      {
        "cartItemId": "801",
        "editionId": "250",
        "title": "1984",
        "authors": "George Orwell",
        "sku": "PLG-LIT-001",
        "coverUrl": null,
        "quantity": 2,
        "currentPrice": "19.90",
        "currentSubtotal": "39.80",
        "available": true,
        "unavailabilityReason": null,
        "format": "PAPERBACK",
        "requiresPhysicalFulfillment": true,
        "quantityEditable": true,
        "originalPrice": "19.90",
        "unitSavings": "0.00",
        "originalSubtotal": "39.80",
        "lineSavings": "0.00"
      }
    ],
    "totalCurrent": "45.77",
    "subtotal": "39.80",
    "taxRate": "15.00",
    "taxAmount": "5.97",
    "shippingAmount": "0.00",
    "total": "45.77",
    "requiresPhysicalFulfillment": true,
    "physicalItemCount": 1,
    "digitalItemCount": 0,
    "originalSubtotal": "39.80",
    "savingsTotal": "0.00",
    "currentSubtotal": "39.80",
    "quoteFingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "saved": { "items": [], "totalCount": 0 }
}
```

## Remove a saved item

`DELETE /api/v1/cart/saved/{savedItemId}` returns `204 No Content`. The client already knows the removed ID and can remove that row locally.

## Errors

All human-facing Problem Details remain in Spanish. Existing SQLSTATE and HTTP mappings are unchanged.

| SQLSTATE / code | HTTP | Title | Detail |
|---|---:|---|---|
| `P4003 CART_ITEM_NOT_FOUND` | 404 | Artículo del carrito no encontrado | El artículo solicitado no existe o no está disponible en tu carrito. |
| `P4006 SAVED_ITEM_NOT_FOUND` | 404 | Artículo guardado no encontrado | El artículo guardado no existe o no está disponible en tu lista. |
| `P3002 INSUFFICIENT_STOCK` | 409 | Existencias insuficientes | No hay existencias suficientes para la cantidad solicitada. |
| `P2041 EDITION_NOT_FOUND` | 404 | Edición no encontrada | La edición solicitada no está disponible. |
| `P2042 EDITION_INACTIVE` | 409 | Edición no disponible | La edición seleccionada no está disponible actualmente. |
| `P2043 BOOK_INACTIVE` | 409 | Libro no disponible | El libro asociado a la edición seleccionada no está disponible actualmente. |
| `P6002 DIGITAL_ALREADY_OWNED` | 409 | Ya tienes esta edición digital | Esta edición digital ya está en tu biblioteca. Puedes consultarla sin volver a comprarla. |
| `P6003 DIGITAL_PURCHASE_PENDING` | 409 | Compra digital pendiente | Ya tienes un pedido abierto con esta edición digital. Revisa ese pedido antes de intentar otra compra. |

Saved items never contribute to active cart totals or checkout, and these operations never add or remove a favorite. V083 creates the persistent list and its routines; V084 adds the edition foreign-key index. The current static OpenAPI document and generated TypeScript API types include these routes and schemas.
