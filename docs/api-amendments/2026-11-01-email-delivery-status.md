# Resultados de entrega de correo — 2026-11-01

## Perfil del cliente

`GET /api/v1/me` añade el campo de solo lectura:

```json
{"emailDelivery":{"status":"UNDELIVERABLE","since":"2026-11-01T15:33:37Z"}}
```

`status` es `OK` o `UNDELIVERABLE`; `since` es fecha UTC del último fallo permanente autoritativo o
`null` para OK. OK significa ausencia de bloqueo conocido; no garantiza entrega
y es independiente de `emailVerified`. La API no expone motivo SMTP ni texto del
proveedor. No cambia autorización ni checkout. La UI puede indicar en español:
“No pudimos entregar correos a esta dirección. Revisa y corrige tu correo.”
No se modifica frontend en esta implementación.

## Webhook Mailtrap

`POST /api/v1/webhooks/mailtrap`, `Content-Type: application/json`.
Autenticación exclusiva de esta integración por `Mailtrap-Signature`: HMAC-SHA256
hexadecimal del cuerpo crudo con el secreto de firma interpretado como texto UTF-8.
Sin JWT de cliente. Desactivado (404) si no se configura
`PLIEGO_MAILTRAP_WEBHOOK_SECRET`; también puede recibir con envíos desactivados.

Formato configurado: objeto `{"events":[...]}`; se admite además array JSON.
Máximo 500 eventos y 1 MiB. JSON Lines no está habilitado: configurar JSON en Mailtrap.
Se proyectan `delivery`, `bounce`, `soft bounce`, `reject`, `suspension` del stream
transactional; otros eventos/streams se ignoran con ACK. Se requieren `event_id`,
`message_id` (1–128 caracteres de ID seguros) y timestamp epoch entero para los
eventos que se procesan. No se usa `custom_variables` para correlacionar.

Respuesta 200 sin cuerpo solo después de persistir todo el lote. Deduplicación
por `event_id`; mismo ID/datos normalizados devuelve 200, ID con datos distintos
devuelve 409 y revierte el lote entero. El procesador asíncrono conserva eventos
sin recibo conocido y los correlaciona cuando se persiste el mensaje del proveedor.

| HTTP | Código |
|---|---|
| 401 | `MAIL_WEBHOOK_INVALID_SIGNATURE` (firma ausente, inválida o cuerpo alterado) |
| 400 | `MAIL_WEBHOOK_INVALID_PAYLOAD` (formato inválido) |
| 409 | `MAIL_WEBHOOK_EVENT_CONFLICT` |
| 413 | `MAIL_WEBHOOK_TOO_LARGE` |
| 404 | `NOT_FOUND` (secreto ausente) |
| 500 | `INTERNAL_SERVER_ERROR` (persistencia fallida; Mailtrap debe reintentar) |

Validación de argumentos de la API de BD conserva P1001/`INVALID_ARGUMENT` y su
mapeo HTTP existente. No cambia ningún código ni SQLSTATE preexistente.

## Efectos operativos

`correo_outbox.estado=SENT` sigue significando aceptación por el proveedor.
`entrega_estado` registra DELIVERED/BOUNCED/SOFT_BOUNCE/REJECTED/SUPPRESSED/SUSPENDED.
`bounce` permanente bloquea; reject/suspension solo bloquea si identifica la lista
de supresión. Una entrega posterior elimina el bloqueo. Los empates favorecen
fallo permanente y los eventos antiguos no revierten información más reciente.

Preflight del worker deja `HELD / EMAIL_UNDELIVERABLE` para destinatario bloqueado;
HELD no se reclama. Los webhooks y el cambio de email nunca reencolan correo fallido
o retenido ni retargetean snapshots. Reenvío requiere revisión operativa y autorización
según el runbook; no se añade endpoint de reenvío. Ver [ADR 0048](../adr/0048-mailtrap-delivery-outcomes.md).

Contrato del proveedor: [firma y formato](https://docs.mailtrap.io/email-api-smtp/advanced/webhooks).
