# ADR 0021 — Retiro en tienda sobre el fulfillment existente

Fecha: 2026-10-04. Estado: aceptado para la implementación solicitada.

## Auditoría

V033 define `pedido_entrega.metodo` HOME_DELIVERY/STORE_PICKUP; solo HOME_DELIVERY está implementado. `envio` y su historial modelan carrier/tracking separados del estado comercial del pedido. Digital-only no tiene pedido_entrega/envio. V032 conserva checkout, snapshots y locks de catálogo/inventario; exige dirección incluso para digital. V036 añade receipts inmutables checkout_attempt, advisory lock por actor/key, fingerprint, carrito esperado y resolución/fence. V034 proyecta fulfillment/shipment en detalle de cliente/admin y método en lista de cliente. Las direcciones se mapean actualmente como obligatorias en JDBC/API aunque SQL permite ausencia. Facturación usa dirección fiscal explícita. V039 registra ORDER_CONFIRMED único dentro de checkout y envía mediante outbox separada.

## Decisión

V040 crea ubicaciones de retiro relacionales y `pedido_retiro`, subtipo uno-a-uno del `pedido_entrega` existente, con snapshot tipado e inmutable. Ningún pedido pickup crea envio ni contacto ficticio. Ubicaciones múltiples, FK e índices; primera ubicación real de referencia proporcionada por el usuario: PUCE sede matriz, Av. 12 de Octubre y Vicente Ramón Roca 1076, Quito/Pichincha/EC, 170525, latitud -0.210000, longitud -78.491400, America/Guayaquil, 09:00–17:00, preparación 25 minutos. No persistir altitud, innecesaria para esta función. Horario como TIME de apertura/cierre; días de atención no especificados, no inferir calendario semanal.

Checkout admite `fulfillmentMethod` opcional (default HOME_DELIVERY por compatibilidad), dirección solo para HOME_DELIVERY, pickupLocationId solo para STORE_PICKUP. Esas reglas y elegibilidad activa se validan también en PostgreSQL. Solo carritos con productos físicos pueden usar pickup; mezclas físico/digital lo admiten y digital-only pickup se rechaza. Legacy digital HOME_DELIVERY conserva dirección/contacto y ausencia de fulfillment físico.

Extender la implementación actual de checkout para condicionar la dirección, conservando algoritmos y locks de stock/pago. Un único executor común y wrapper de fulfillment/outbox, con firmas legacy delegando al nuevo contrato. Añadir método/location al fingerprint tipado del receipt; replay sigue funcionando aunque se inactive/edite ubicación, cambie fulfillment o se recoja el pedido después. Las firmas SQL legacy HOME_DELIVERY siguen disponibles; el trigger de receipt inmutable queda vigente.

Snapshot de nombre, dirección, ciudad/provincia/país/código postal, coordenadas, zona, horario, preparación. `estimatedAt` usa clock_timestamp() del servidor y `readyAt` 25 minutos efectivos después según preparationMinutes snapshot. TIMESTAMPTZ representa instante independiente de la zona del VPS; timezone snapshot rige presentación local y correo. No consultar/recalcular ubicación actual en pedidos anteriores, no prometer apertura ni disponibilidad del personal fuera del horario.

Referencia humana corta P- + base32 sin 0/1/I/O, derivada de secuencia y constraint UNIQUE: referencia, no credencial de autenticación. Retiro pendiente mientras pedido CONFIRMED; comando ADMIN autenticado `pickup/collect` con código marca fecha_retiro y estado comercial existente DELIVERED, con historial; repetición idéntica es inocua. CANCELLED existente cancela retiro sin otra máquina de estados. No READY automático, carriers, tracking ni scheduler nuevo.

GET público de ubicaciones activas devuelve datos estándar, sin proveedor de mapas. Detalle customer/admin amplía fulfillment con snapshot pickup y collectedAt/state. Listado existente ya representa STORE_PICKUP por fulfillmentMethod y shipmentState null. Confirmación checkout añade fulfillment inmutable; proyección de receipts siempre devuelve misma información aun después de colección. ORDER_CONFIRMED usa misma outbox/worker y plantilla: lugar/dirección, hora local estimada, código e instrucción de presentar confirmación. No correo diferido “listo”.

## Validación y límites

La revisión independiente detectó que sp_order_change_status confundía pickup sin envio con digital. V040 reemplaza esa rutina para rechazar STORE_PICKUP en el comando heredado; home/digital conservan sus transiciones y pickup solo se recoge mediante pickup/collect. La regresión SQL reprodujo el bypass antes de la corrección; también se cubre el endpoint admin existente.

RED antes de código en PostgreSQL y API/plantillas. Gates de home, pickup, ubicación desconocida/inactiva, inputs excluyentes, snapshots, tiempo, secuencia/unique, receipts/outbox, digital-only/mixed, colección/cancelación y concurrencia. Luego Maven y todos los gates PostgreSQL/HTTP relevantes. Ningún cambio frontend, commit, push o despliegue.

Diferidos: mapas/geolocalización/rutas, calendario/días/festivos/capacidad, avisos de listo, múltiples almacenes/stock por punto, CRUD UI/API de ubicaciones y logística avanzada. Ubicaciones pueden editarse operacionalmente por la Database API administrativa, con invariantes SQL.
