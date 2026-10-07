# ADR 0024 — Simulación autoritativa de entrega a domicilio

Fecha: 2026-10-04. Estado: aceptado para la implementación solicitada.

## Modelo y decisión

V043 extiende `pedido_entrega`, `envio` y `envio_historial` de V033. No crea otra máquina de pedidos. HOME_DELIVERY confirmado comienza PREPARING; pasa a IN_TRANSIT a los 2 minutos, OUT_FOR_DELIVERY a los 4 y DELIVERED a los 6. El estado comercial y el pago siguen CONFIRMED/APPROVED. STORE_PICKUP conserva `pedido_retiro`, sus snapshots, código y colección administrativa; digital-only no crea envío.

`envio.fecha_confirmacion` usa el primer evento CONFIRMED del historial comercial. `transito_desde`, `reparto_desde` y `entrega_desde` persisten los límites absolutos TIMESTAMPTZ desde ese instante; no dependen del tiempo de ejecución del scheduler. Los eventos y timestamps realizados usan los límites planificados aunque la reconciliación ocurra después. El trigger BEFORE INSERT inicia el envío dentro del checkout existente, incluyendo idempotencia, pago, inventario y outbox.

La configuración vive en `home_delivery_config`: preparing_minutes, in_transit_minutes, out_for_delivery_minutes, cada uno entre 1 y 1440, inicialmente 2/2/2. `CALL pliego.sp_home_delivery_configure(3,4,5)` cambia las duraciones para nuevos envíos. Los anteriores conservan sus deadlines. La configuración permanece tras reinicios y no modifica checksums Flyway; no se recalcula desde variables de cada instancia. Este comando es operacional de Database API, sin endpoint REST nuevo.

## Concurrencia, lectura y cancelación

`sp_home_delivery_reconcile(order)` bloquea pedido y después envío, muestrea clock_timestamp después de adquirir locks y avanza todos los estados vencidos en una sola transacción. Los eventos SYSTEM/STATUS de la simulación tienen un índice único por envío/estado. La rutina nunca cambia `pedido.estado` ni su historial comercial. Estados terminales no avanzan.

`sp_home_delivery_advance_due(batch)` selecciona pedidos vencidos con FOR UPDATE OF pedido SKIP LOCKED, en orden determinista; después llama a la misma rutina. No toma primero locks de envíos. Cada lote es una transacción Spring y admite hasta 1000 pedidos (default 100). `HomeDeliveryScheduler` → `HomeDeliveryService` → `JdbcHomeDeliveryGateway` invoca únicamente esta Database API. Poll default PT10S, configurable con PLIEGO_HOME_DELIVERY_POLL_INTERVAL; PLIEGO_HOME_DELIVERY_BATCH_SIZE y PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED controlan lote y ejecución. Funciona independientemente de correo habilitado.

Los detalles customer/admin autorizan antes de reconciliar. Sus funciones son VOLATILE y los servicios usan transacciones de escritura; las funciones priced también son VOLATILE para observar la proyección posterior. Así, una lectura tras downtime obtiene el estado correcto incluso con scheduler deshabilitado. Los listados mantienen su contrato y se actualizan por scheduler o detalle.

`sp_order_cancel` autentica, verifica ownership, bloquea y reconcilia antes de delegar los efectos comerciales/stock/pago existentes. HOME_DELIVERY solo se cancela en PREPARING; después devuelve P5003/ORDER_NOT_CANCELLABLE y no reembolsa ni restaura inventario. availableActions.cancel usa ese mismo estado persistido. Una excepción revierte la reconciliación dentro del comando rechazado; futuras lecturas/scheduler la persisten. La decisión sigue usando el estado correcto incluso si el lock se adquiere después del límite temporal.

La API administrativa existente no puede acelerar esta simulación. Solicitar el estado ya alcanzado es idempotente; adelantar/retroceder devuelve P5002. SHIPPED de input legacy equivale a IN_TRANSIT; la respuesta comercial del comando sigue CONFIRMED. El estado SHIPPED y eventos previos se conservan para historia legacy; V043 permite recuperarlos y no reescribe historial inmutable ni estados comerciales históricos.

## Contrato y verificación

La proyección existente expone shipment.state, history, preparingAt, shippedAt (inicio de IN_TRANSIT), outForDeliveryAt y deliveredAt como strings/timestamps. No necesita campos, rutas ni OpenAPI nuevos. No se modifica frontend ni se introduce ningún timer React.

Regresiones reales PostgreSQL 18: límites exactos 0/2/4/6, cancelación antes/después, lectura retrasada customer/admin, downtime, scheduler repetido, concurrencia entre workers/detalle/cancelación, espera de lock cruzando límite, eventos únicos, configuración con snapshots y STORE_PICKUP intacto. Gate HTTP verifica GET/cancel y avance real del scheduler vía JDBC; upgrade Flyway V042→V043 preserva eventos y recupera envíos legacy. Los gates existentes se adaptan a la separación comercial/logística sin quitar sus verificaciones de pago, stock, ownership o facturas.

## Límites

Es simulación, no evidencia de entrega por transportista. El reloj PostgreSQL debe ser correcto. El scheduler limita carga por lote, por lo que puede haber backlog en listados; detalle y cancelación reconcilian individualmente. Desde V061, cada etapa HOME_DELIVERY que se persiste produce su evento en la misma outbox; la reconciliación vencida emite los pasos alcanzados una sola vez. Los envíos históricos terminados/cancelados permanecen intactos; los activos necesitan un evento CONFIRMED para obtener deadlines. No se añade integración externa, frontend, deploy ni permisos nuevos.

El mapping frontend existente `orderStory.ts` reconoce SHIPPED pero no IN_TRANSIT; sus textos/progreso necesitan un pase separado. Se conserva intacto por el alcance backend solicitado.
