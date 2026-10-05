# STORE_PICKUP y proyección monetaria

[ADR0021](../adr/0021-basic-store-pickup.md), [ADR0022](../adr/0022-authoritative-ecuador-monetary-projections.md), [contrato pickup](../api-amendments/0013-store-pickup-v1.0.13.md), [contrato monetario](../api-amendments/0014-authoritative-monetary-projections-v1.0.14.md).

## Persistencia y flujos

V040 añade ubicacion_retiro y pedido_retiro como subtipo tipado del pedido_entrega existente. Seed real de referencia PUCE suministrado por usuario: nombre/dirección/Quito/Pichincha/EC/170525, latitud -0.21, longitud -78.4914, America/Guayaquil,09:00–17:00,activo,preparationMinutes25. Permite múltiples ubicaciones; no Singleton ni claves de proveedores de mapas. openingHours son TIME informativos, sin días de semana inferidos. DB API administrativa sp_pickup_location_update valida/edita ubicación y estado; no CRUD REST adicional en esta iteración.

Checkout conserva firmas SQL/home y default fulfillmentMethod=HOME_DELIVERY. STORE_PICKUP exige pickupLocationId y ningún addressId; valida existencia/activo bajo lock. Pedido pickup no tiene pedido_direccion ni envio. Digital-only rechaza pickup; mezcla físico/digital lo admite. Digital HOME_DELIVERY conserva contrato legacy sin fulfillment físico.

Snapshot propio de ubicación/código/horario/zona/preparación. estimatedAt usa reloj servidor; readyAt suma minutos efectivos y se expone UTC ISO, con timezone snapshot para representación local. No reconsulta ubicación editada. Referencia P- de seis a ocho caracteres base32 sin0/1/I/O, secuencia y UNIQUE; no es secreto de autorización.

Retiro PENDING mientras compra CONFIRMED. POST admin orders/{id}/pickup/collect con pickupCode exige ADMIN y confirma DELIVERED/fecha_retiro/historial una sola vez. No fuerza espera hasta readyAt porque es una estimación. CANCELLED usa estado comercial existente; colección/cancelación comparten el lock del pedido. Rutas legacy de status/carrier/tracking rechazan pickup. No estado READY ni correo programado.

Idempotencia mantiene advisory lock/fence/receipt y añade método/location al fingerprint. Replay devuelve mismo checkout incluso con ubicación inactiva/editada, carrito posterior o pedido recogido; fulfillment de confirmación solo contiene snapshot inmutable. Detalle añade estado/collectedAt actuales. Lista customer usa fulfillmentMethod existente y shipmentState=null; detail address=null. Factura mantiene dirección fiscal explícita, sin usar domicilio de tienda como dirección del cliente.

## Importes

V041 conserva todos los importes históricos; pedidos anteriores siguen tasa/impuesto/envío cero. Precios actuales se consideran netos. Nuevas compras: IVA configurado15.00%, taxAmount=sum(round(lineSubtotal*rate/100,2)), shippingAmount0.00 y total=subtotal+taxAmount+shippingAmount. Carrito, executor, pedido/item, pago, receipt, invoice/items y crédito total coinciden. Catálogo/tasa futura no recalculan compras/documentos. Restricciones y triggers impiden editar snapshots financieros. Receipt usa NUMERIC30,2.

REST cart/checkout/resolve/customer+admin detail exponen subtotal,taxRate,taxAmount,shippingAmount,total como strings decimales. taxRate porcentaje15.00, no fracción0.15. totalCurrent de cart se mantiene como alias de grand total; DB legacy fn_cart_get mantiene su contrato, JDBC usa fn_cart_quote. Empty cart cobra0.00. Invoice/credit conservan taxTotal y añaden taxRate/shippingAmount. El frontend recibe estos campos y no debe calcular IVA.

## Correo

Misma outbox V039, clave ORDER_CONFIRMED:{id}, mismos límites/retries/proveedor. Snapshot se publica tras completar fulfillment, en la transacción de checkout. Plantilla texto/HTML añade lugar/dirección, hora estimada en timezone del local, referencia e instrucción de presentar confirmación; desglose de IVA/envío autoritativo. Rechazados no generan confirmación. Ningún mensaje diferido ni sistema nuevo de email.

## Archivos y rutinas

- Migraciones nuevas V040__store_pickup.sql y V041__authoritative_monetary_projections.sql; V001–V039 intactas.
- Sales: PickupLocation, PickupService, PickupLocationGateway/JdbcPickupLocationGateway, PickupLocationController, AdminPickupController; checkout y post-purchase DTO/controller/JDBC existentes extendidos. Cart DTO/controller/JDBC usa proyección de precio. MonetaryAmounts en foundation.money solo transporta valores. SecurityConfiguration permite GET público; DatabaseError/handler añade P5010–P5013 en español. MailTemplates conserva transporte existente.
- Rutinas principales nuevas: fn_pickup_locations, fn_order_fulfillment, fn_generate_pickup_code, sp_pickup_location_update, sp_pickup_collect, sp_checkout_execute, overloads checkout/checkout_idempotent; fn_cart_quote, fn_order_pricing, fn_checkout_tax_rate, fn_customer_order_detail_priced, fn_admin_order_detail_priced. Se reemplazan delegates legacy, status, post-purchase/invoice/credit y constructor outbox dentro de migraciones nuevas; se añaden guards de snapshots monetarios/retiro.
- Gates: store_pickup_gate.sql, store_pickup_concurrency.py, store_pickup_http_gate.py, monetary_projection_gate.sql, monetary_upgrade_gate.py. TransactionalMailTest/CheckoutApiIntegrationTest añaden RED; stubs existentes/OpenAPI y expectativas de grand total se actualizan. CI ejecuta gates y Mailtrap local/upgrade.

## Validación

Build: `cd backend && mvn clean verify`. Native PG18: variables PG* y PLIEGO_DB_*/ADMIN_*/JWT_SECRET de pruebas, una base vacía descartable y `bash backend/src/test/postgres18/run_ci_gates.sh` (correo forzado desactivado). Ejecutar también `transactional_email_http_gate.py` y `monetary_upgrade_gate.py`, cada uno en otra base vacía descartable; usan backend y stub local/objetivos Flyway40→41, sin correos externos.

Diferidos: frontend, mapas/geolocalización/routing/GSAP/Turf, calendario/días/festivos y ready notifications, stock por ubicación/capacidad/logística avanzada, gestión REST/UI de puntos, tarifas de transporte y clasificación/exenciones fiscales. No commit/push/deploy.
