# STORE_PICKUP Implementation Plan

> Ejecución nativa mediante superpowers:executing-plans, usando el estado actual del workspace. No commits/push/deploy.

Goal: soportar retiro básico mediante checkout/fulfillment/email existentes.
Architecture: mismo monolito JDBC y API PostgreSQL, outbox V039, sin frontend ni modelos paralelos.
Tech Stack: Java25/Spring Boot/PostgreSQL18/Flyway.
Spec: docs/adr/0021-basic-store-pickup.md

User steering: extend the same checkout/cart/order/invoice path with authoritative IVA15% monetary amounts. Additional spec: docs/adr/0022-authoritative-ecuador-monetary-projections.md. Add V041 without modifying V040's pickup schema/business model.

## Global Constraints

V001–V039 intactas; añadir V040. Datos PUCE dados por usuario, preparación25. Reglas en PostgreSQL; errores españoles y SQLSTATE existentes estables. Map contract agnóstico. No commits/push/deploy/frontend ni infraestructura nueva.

## Review Focus

- Receipts legacy/fences se conservan y fingerprint incluye fulfillment/location.
- Digital-only no crea fulfillment físico; mixed sí permite pickup.
- Ubicación editada/inactiva no cambia historia ni invalida replay.
- Confirmación/outbox única contiene snapshot final; ninguna dirección/carrier ficticios.
- Colección/cancelación comparten estado comercial/locks existentes y no duplican historial.

## Task 1: PostgreSQL

Files: V040__store_pickup.sql; store_pickup_gate.sql; store_pickup_concurrency.py.
Interfaces: sp_checkout overload extendido; sp_checkout_idempotent overload; fn_pickup_locations; fn_order_fulfillment; sp_pickup_collect; sp_pickup_location_update.

- [x] Escribir y ejecutar RED para ubicación, checkout, inputs, snapshot/time/code, replay/outbox, digital/mixed y lifecycle.
- [x] Crear schema tipado, seed PUCE, executor checkout compartido y wrappers compatibles, extender receipts y post-purchase/outbox.
- [x] Pasar gates SQL y concurrencia en PostgreSQL18 aislado.

## Task 2: REST/JDBC/email

Files: sales CheckoutRequest/Service/Gateway/Response; PickupLocationController/Service/Gateway; post-purchase DTO/mapping; AdminOrderController; MailTemplates; affected Java tests.
Interfaces: CheckoutRequest fulfillmentMethod/pickupLocationId, CheckoutResult.fulfillment; GET pickup-locations; POST admin orders/{id}/pickup/collect.

- [x] Escribir RED de inputs, proyecciones y email; ejecutar afectadas.
- [x] Adaptar contratos y gateways a rutinas, null address de pickup, colección y plantilla con horario local/código.
- [x] Pasar tests afectados y actualizar OpenAPI coverage.

## Task 3: Integración y entrega

Additional monetary task: RED monetary_projection_gate.sql (per-line cent rounding, cart→checkout→payment→invoice→credit, immutable snapshots/replay); V041 typed tax/shipping columns and pricing/cart/detail functions; MonetaryAmounts value type and flat REST fields; same outbox/email tax breakdown. Shipping remains0.00 without inventing a delivery tariff. Existing gates update explicit grand-total assertions, preserving unit-price/subtotal fixtures.

Files: store_pickup_http_gate.py; run_ci_gates.sh; API amendment0013, ADR index/backend README.

- [x] Ejecutar build/suite Java completa y gates PostgreSQL/HTTP, incluido Mailtrap local.
- [x] Revisión independiente de seguridad/idempotencia, corregir hallazgos con RED/GREEN.
- [x] Documentar contratos, invariantes/límites y reportar solo áreas solicitadas; no tocar frontend ni integrar Git.
