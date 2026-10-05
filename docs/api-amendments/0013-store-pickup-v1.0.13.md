# API amendment v1.0.13 — STORE_PICKUP

V040 extends existing fulfillment with relational locations and pickup snapshot. HOME_DELIVERY clients can omit fulfillmentMethod; it defaults to HOME_DELIVERY and still requires addressId. STORE_PICKUP requires pickupLocationId and forbids addressId. Same Idempotency-Key must keep method/location/address/cart/payment inputs; replay preserves receipt, including immutable confirmation data after store edits/collection.

Public `GET /api/v1/pickup-locations` returns an array of active locations: id/name/address/city/province/countryCode/postalCode, numeric latitude/longitude, timezone, openingHours {opensAt,closesAt}, active, preparationMinutes. Initial reference: PUCE Quito supplied by user, -0.21/-78.4914, America/Guayaquil,09:00–17:00,25minutes. No map-provider data, calendar/weekdays or altitude contract.

Pickup checkout request:

```json
{"fulfillmentMethod":"STORE_PICKUP","pickupLocationId":"1","paymentMethod":"TRANSFER","simulationOutcome":"APPROVED"}
```

Use the ID returned by listing. Existing expectedCartId and card validation apply. Invalid combinations400; location absent404/P5010, inactive409/P5011, digital-only pickup400/P5012. Physical/digital mixed carts permit pickup. Legacy digital-only HOME_DELIVERY preserves prior contact/address behavior and no physical fulfillment.

Checkout/attempt resolution add `fulfillment`: method and immutable pickup {location,estimatedAt,readyAt,preparationMinutes,pickupCode}. readyAt is an ISO UTC instant; location.timezone defines local presentation. It is estimated, not staff readiness. Detail customer/admin returns same snapshot plus fulfillment.state PENDING/COLLECTED/CANCELLED and collectedAt; address=null and shipment=null for pickup. Customer list uses existing fulfillmentMethod=STORE_PICKUP and shipmentState=null.

`POST /api/v1/admin/orders/{orderId}/pickup/collect`, body `{"pickupCode":"P-..."}` requires ADMIN;204 marks overall order DELIVERED and collection timestamp/history. Same command repeats without another history entry. Invalid code400/P5013. Collection/cancellation share the order lock and only one succeeds; shipment/tracking commands do not apply. Code is human reference, not authentication. No automatic READY state or deferred email.

Confirmation remains one ORDER_CONFIRMED event/worker; includes location/address, estimated local time, reference and instruction to present confirmation. [ADR0021](../adr/0021-basic-store-pickup.md).
