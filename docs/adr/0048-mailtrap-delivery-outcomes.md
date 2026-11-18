# ADR 0048 — Resultados de entrega y retención por destinatario

Fecha: 2026-11-01. Estado: aceptado para la implementación local solicitada.

## Contexto y decisión

V060 ya persiste `message_ids[0]`; `SENT` significa aceptación, no entrega.
Se conserva ese contrato y se añade V093, sin cambiar V001–V092. El módulo
notifications recibe `POST /api/v1/webhooks/mailtrap` en formato JSON, valida
`Mailtrap-Signature` (HMAC-SHA256 hexadecimal sobre bytes crudos, secreto como
texto UTF-8, comparación constante), y confirma 200 solo tras persistir el lote.
Sin `PLIEGO_MAILTRAP_WEBHOOK_SECRET` rechaza con 404. No depende de mail.enabled.

Un inbox durable deduplica `event_id`. Un procesador con transacciones cortas
proyecta por `message_id`, incluso si el webhook llegó antes de guardar el recibo.
Los eventos desconocidos quedan pendientes y observables. No se guardan payloads,
SMTP, direcciones del webhook ni tokens: solo IDs, estado, fecha y motivo permitido.
Los duplicados con datos distintos se rechazan; no se cambian SQLSTATE existentes.

`delivery`, `bounce`, `soft bounce`, `reject` y `suspension` se proyectan aparte
del estado de envío. Solo `bounce` permanente y rechazo/suspensión cuya razón
identifica una suppression bloquean destinatarios; rechazo de dominio y fallo
temporal no declaran inválida una dirección. La fecha del proveedor ordena
eventos; a igual fecha el fallo permanente prevalece. Una entrega posterior limpia
el bloqueo. `since` identifica el último fallo permanente autoritativo, de modo que
no depende del orden de llegada de un éxito intermedio. El estado por dirección
conserva conocimiento sobre snapshots viejos. Los nuevos snapshots guardan su hora
real de captura para distinguir cambios de email aunque el proveedor solo dé segundos.
La proyección del perfil se ordena por separado dentro de la generación actual;
no copia al perfil fallos de snapshots excluidos al volver a una dirección anterior.
El indicador del usuario solo cambia si su email actual coincide y el evento no
es anterior al último cambio de email; cambiar email limpia ese indicador.

Antes del HTTP, el worker consulta una rutina pública que retiene la fila como
`HELD / EMAIL_UNDELIVERABLE` si la dirección está bloqueada. HELD nunca se reclama
automáticamente. Ningún webhook reencola FAILED/HELD ni cambia destinatarios de
snapshots históricos. Se conserva la revisión operativa previa a cualquier reenvío.

`GET /api/v1/me` añade `emailDelivery: {status: OK|UNDELIVERABLE, since}`.
OK significa ausencia de un fallo permanente conocido, no verificación ni garantía
de entrega. El motivo interno no se expone al cliente.

## Cambio de identidad

Se mantiene el cambio inmediato de ADR 0020/0032. Un email pendiente requeriría
definir unicidad/reserva, tokens, recuperación, login y respuestas de cambio de
email; no es una corrección acotada compatible con los contratos actuales.
Se recomienda diseñarlo después: mantener dirección verificada, verificar la nueva
y promoverla atómicamente, invalidando sesiones y tokens al promover. Los JWT
actuales siguen vigentes hasta expirar; checkout no añade un requisito nuevo.

## Límites y validación

La proyección asíncrona tiene una ventana de hasta 5 segundos más procesamiento;
un envío ya iniciado no se puede retirar. No se importan resultados históricos
ni se consulta producción. Los IDs desconocidos requieren reconciliación, nunca
correlación automática por variables arbitrarias del payload. Inbox y estados
requieren la misma política de acceso/retención que outbox; no borrar deduplicación
mientras puedan reintentarse eventos. Pruebas Java y gates PostgreSQL 18 cubren
firmas, replay, orden, recibo tardío, bloqueo, corrección y privilegios.

Fuente: [webhooks oficiales de Mailtrap](https://docs.mailtrap.io/email-api-smtp/advanced/webhooks)
y [estados y eventos](https://docs.mailtrap.io/email-api-smtp/analytics/statuses-and-events).
