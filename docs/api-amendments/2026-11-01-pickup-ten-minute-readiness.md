# Horario de retiro y avisos — V097

Esta enmienda actualiza la política de tiempo de retiro de las versiones 0013 y V089 sin cambiar endpoints, DTOs ni SQLSTATE. Véanse [ADR 0051](../adr/0051-pickup-readiness-and-durable-notifications.md) y [criterios de aceptación](../testing/pickup-ten-minute-readiness-and-notifications.md).

`GET /api/v1/pickup-locations` anuncia `preparationMinutes: 10`, la política efectiva de los nuevos checkouts. La configuración anterior almacenada y los snapshots existentes se conservan. Todos los overloads de checkout, incluidos cotizado, idempotente y facturado, delegan en el mismo wrapper que captura la política nueva.

Para los pedidos nuevos, `pickup.readyAt` parte de `max(fecha_aprobacion+10 minutos,cancelacion_hasta)` y se desplaza a la próxima apertura si cae fuera del horario del snapshot. Apertura es inclusiva y cierre exclusivo, en `location.timezone`, todos los días bajo el contrato diario existente. Se admiten horarios que pasan medianoche; no se añaden calendarios o feriados. `preparationMinutes=10` y `estimatedAt=readyAt−10 minutos` conservan la relación aprobada del snapshot. Diez minutos incluye los seis de cancelación y cuatro adicionales.

La primera aprobación de un pago pendiente reprograma una sola vez el snapshot de la política nueva, antes de emitir la confirmación aprobada. Después, ni una aprobación repetida ni una edición de ubicación cambian el horario. Los pedidos históricos mantienen sus timestamps y sus reglas de snapshot anteriores.

El estado actual sigue siendo `PENDING | READY | COLLECTED | CANCELLED`. Para la política nueva, READY exige además que el punto esté abierto en el momento de consultar o recoger. Un pedido que estuvo listo vuelve a PENDING durante horas cerradas y se habilita de nuevo al abrir; `readyAt` sigue registrando su primera disponibilidad. Las vistas de cliente y administración, lookup y colección comparten esa proyección. Intentar recoger con el punto cerrado devuelve el conflicto existente `P5018 / PICKUP_NOT_READY`.

La ventana sigue siendo exactamente `fecha_aprobacion+6 minutos`: se puede cancelar con el reloj anterior al límite y se rechaza desde el límite inclusive. No cambia la autorización, la verificación de código/identidad, el historial ni las capacidades existentes.

READY se encola durablemente una vez por pedido con `ORDER_STATUS:<id>:STORE_PICKUP:READY`. La colección mantiene `ORDER_STATUS:<id>:STORE_PICKUP:COLLECTED` y recupera el READY pendiente si precede al barrido. Un pedido cancelado antes de estar listo no genera ninguno de esos avisos. La migración no envía un backlog READY de retiros históricos ya disponibles, recogidos o cancelados. Payloads, plantillas, layout, enlaces y transporte son los existentes; «una vez» se refiere al enqueue, no garantiza la entrega exactamente una vez a una bandeja.
