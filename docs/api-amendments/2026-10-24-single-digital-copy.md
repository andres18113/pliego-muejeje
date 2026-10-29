# Single digital copy per customer — Phase 1

V076 and [ADR-0042](../adr/0042-single-digital-copy-per-customer.md) make ownership and open digital orders authoritative at cart add, quote acceptance, order creation, payment capture and grant activation. Existing paid grants are never silently discarded.

| Wire code / SQLSTATE | Domain label | HTTP | Spanish title | Spanish detail |
| --- | --- | --- | --- | --- |
| P6002 | DIGITAL_ALREADY_OWNED | 409 | Ya tienes esta edición digital | Esta edición digital ya está en tu biblioteca. Puedes consultarla sin volver a comprarla. |
| P6003 | DIGITAL_PURCHASE_PENDING | 409 | Compra digital pendiente | Ya tienes un pedido abierto con esta edición digital. Revisa ese pedido antes de intentar otra compra. |

Existing error mappings remain unchanged. `CartItem.unavailabilityReason` adds P6002/P6003 and `available=false` for stale blocked digital lines. Cart reads still return their complete pricing and line projection. Acceptance raises the conflict and rolls back all effects. A same-key successful checkout replay returns its original receipt.

`GET /api/v1/me/digital-eligibility?editionIds=12,34` requires CUSTOMER authentication. Accept 1–50 positive IDs; reject missing/empty/oversized/malformed input. Each ID appears once in first-occurrence order, including absent or physical IDs (not digitally purchasable). There is no customer ID input.

```json
[
  {"editionId":"12","owned":true,"ownedItemId":"81","pendingOrder":false,"pendingOrderId":null,"inCart":false,"purchasable":false},
  {"editionId":"34","owned":false,"ownedItemId":null,"pendingOrder":false,"pendingOrderId":null,"inCart":true,"purchasable":true}
]
```

`ownedItemId` links to `/biblioteca/{id}` and is null without an ACTIVE grant. `pendingOrder` means a non-CANCELLED, not-finalized digital source with a PENDING or APPROVED payment. It can coexist with ownership during the cancellation window. `inCart` is informational and does not make a digital edition unpurchasable. `purchasable` also requires an active digital edition and active book. Results are advisory: checkout rechecks under its customer transaction lock. Cancellation/refund followed by grant revocation allows another purchase. Finalization alone does not remove ownership.

Repeated addition of an eligible digital edition already in the cart returns its existing line at quantity one; an input quantity other than one still raises P4004. Physical rules and all pricing remain unchanged.

Before release, inspect historical duplicate sources without changing them:

```sql
SELECT o.owned_item_id, o.cliente_id, o.edicion_id,
       count(*) AS active_grants, array_agg(g.pedido_item_id ORDER BY g.pedido_item_id) AS source_items
FROM pliego.digital_ownership o JOIN pliego.digital_grant g USING (owned_item_id)
WHERE g.state = 'ACTIVE'
GROUP BY o.owned_item_id, o.cliente_id, o.edicion_id
HAVING count(*) > 1;
```

V076 emits aggregate counts during migration and preserves these sources. No new uniqueness constraint over legacy grants is added. New acquisitions and reactivations are serialized and checked; existing sources remain independently refundable. Production data inspection and deployment are outside this phase.

Phase 2 API correction (2026-10-24): `pendingOrderId` is the nullable string ID for `/orders/{id}`, taken from the same blocking source as `pendingOrder`. When legacy duplicates exist, the lowest blocking order ID is returned deterministically. It can coexist with `ownedItemId`; ownership keeps presentation/error precedence. No order from another customer is exposed. V076 is amended under explicit authorization because it has not been committed or deployed; locking, command idempotency and all business gates remain unchanged.
