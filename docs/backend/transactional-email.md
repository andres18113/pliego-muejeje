# Correo transaccional de PLIEGO

Auditoría/diseño: [ADR 0020](../adr/0020-transactional-email-and-account-verification.md). Migración nueva: `V039__transactional_email.sql`. Ninguna migración anterior se modifica.

## Configuración externa

| Variable | Uso / valor por defecto |
|---|---|
| `PLIEGO_MAIL_ENABLED` | `false`; detiene todo envío y conserva eventos; cuentas nuevas siguen requiriendo verificación |
| `PLIEGO_MAIL_ENDPOINT` | `https://send.api.mailtrap.io/api/send`; para Sandbox, configurar `https://sandbox.api.mailtrap.io/api/send/{inbox_id}` |
| `PLIEGO_MAILTRAP_API_TOKEN` | Token externo con permiso de envío en el Transactional Stream del dominio verificado; nunca en Git. `PLIEGO_MAIL_TOKEN` se conserva como alias temporal |
| `PLIEGO_MAIL_FROM_ADDRESS` / `PLIEGO_MAIL_FROM_NAME` | Por defecto `no-reply@pliegolibros.com` / `PLIEGO`; usar solo el remitente verificado en Mailtrap |
| `PLIEGO_APP_PUBLIC_URL` | Base HTTPS del frontend, sin query/fragment; debe servir las rutas SPA de verificación/reset |
| `PLIEGO_MAIL_TOKEN_SECRET` | Secreto estable de ≥32 bytes. Si se omite, usa `PLIEGO_JWT_SECRET` con contexto HMAC separado |
| `PLIEGO_MAIL_ALLOW_LOCAL_HTTP` | `false`; HTTP exclusivamente en loopback para desarrollo |
| `PLIEGO_MAIL_CONNECT_TIMEOUT` / `PLIEGO_MAIL_REQUEST_TIMEOUT` | `PT3S` / `PT10S`; máximos 10/20 segundos |
| `PLIEGO_MAIL_POLL_INTERVAL` / `PLIEGO_MAIL_BATCH_SIZE` | `PT30S` / `1`; lote 1–10, procesamiento serial; permite hasta 120 envíos/hora por instancia con los valores por defecto |

No se requieren propiedades SMTP: el adaptador usa `java.net.http.HttpClient` con Bearer API token. Configuración incompleta/insegura impide iniciar cuando está habilitado. `PLIEGO_MAILTRAP_API_TOKEN` se inyecta al proceso desde un gestor de secretos o el entorno; nunca se guarda en frontend, fixtures o archivos versionados. El remitente predeterminado es `PLIEGO <no-reply@pliegolibros.com>`. No se configura `Reply-To`: no hay un buzón de respuestas confirmado. Rotar el secreto de acciones invalida enlaces pendientes; rotar el token API del proveedor no los invalida. Usar polling conservador en VPS.

Se conserva el HTTP client del JDK: el backend ya lo usa, solo se integra el endpoint de envío transaccional y no se necesita otra dependencia. El SDK oficial de Java existe, pero no reemplaza aquí una capacidad ausente del cliente actual. Mailtrap documenta el endpoint, Bearer, `message_ids`, categorías y variables personalizadas en su [API transaccional](https://docs.mailtrap.io/developers/email-sending/transactional), [autenticación](https://docs.mailtrap.io/developers/authentication), [cliente oficial Java](https://github.com/mailtrap/mailtrap-java) y [límites](https://docs.mailtrap.io/developers/rate-limits).

## API y seguridad

Rutas nuevas públicas POST/JSON; tokens en body, nunca query de API.

| Endpoint | Request / resultado |
|---|---|
| `/api/v1/auth/register` (modificado) | Request existente; 201 `state=PENDING_VERIFICATION`, usuario y verificación atómicos |
| `/api/v1/auth/login` (modificado) | 403 `EMAIL_NOT_VERIFIED` solo tras acertar contraseña; desconocido/bloqueado/contraseña errónea siguen 401 |
| `/api/v1/auth/verify-email` | `{"token":"<43 caracteres base64url>"}`; 204 o 400 `EMAIL_ACTION_INVALID` |
| `/api/v1/auth/resend-verification` | `{"email":"lector@example.invalid"}`; 202 neutro |
| `/api/v1/auth/forgot-password` | Mismo request y 202 neutro |
| `/api/v1/auth/reset-password` | `{"token":"<43 caracteres base64url>","password":"<nueva>"}`; 204 o 400 |
| `/api/v1/me/email` (modificado) | Request existente con contraseña actual; nuevo correo requiere verificación y revoca refresh |

Registro conserva P1101 por email duplicado. Resend/forgot responden idénticamente ante desconocido, bloqueado, no elegible o limitado. Cuotas persistentes 20/IP/hora y cinco/email/hora; cooldown de un minuto por cuenta/propósito. `remoteAddr` evita confiar directamente en headers de cualquier cliente; si hay proxy, configurar el proxy confiable en el despliegue para preservar IP real. Cambio autenticado de email: cuota independiente de cinco/usuario/hora, sin invertir locks con cuotas públicas.

ACTIVE/BLOCKED siguen siendo estados administrativos. `usuario.email_verificado_en` es independiente; las cuentas anteriores se consideran verificadas. Verificación vence en 24h, reset en 15m. Uso único; resend invalida el anterior. Tokens HMAC-SHA256 con propósito separado y nonce aleatorio de 256 bits; BD guarda solo hash y nonce no utilizable sin secreto externo, nunca token plano. Un correo ya reclamado puede llegar tras resend, pero su token invalidado no funciona.

Reset reutiliza BCrypt/política existente y revoca todos los refresh, incluidos anteriores de rotación; invalida acciones pendientes. Login vuelve a comprobar hash/estado/verificación bajo lock para no crear sesiones con una comprobación de contraseña obsoleta. JWT previos conservan expiración actual hasta 30 minutos; no existe revocación inmediata de JWT. Verificar/reset no inicia sesión automáticamente.

## Compra y outbox

Completado en checkout significa pago APPROVED/pedido CONFIRMED, distinto de entrega DELIVERED. El evento único `ORDER_CONFIRMED:{pedido_id}` conserva replay de `sp_checkout_idempotent`. V061 añade `ORDER_STATUS` para HOME_DELIVERY (`PREPARING`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`), STORE_PICKUP (`PREPARING`, `COLLECTED`) y DIGITAL (`COMPLETED`), además de `ORDER_CANCELLED` tras la cancelación/reembolso del cliente. Rechazos, transiciones inválidas, cancelaciones administrativas y reconciliaciones repetidas no generan avisos duplicados. HTML/texto usan snapshots de items y fulfillment; la ruta de pedido es `/orders/{id}` y la de biblioteca `/biblioteca`.

Tablas `correo_token`, `correo_outbox`, `correo_limite`. Abstracción `TransactionalMailSender`; Mailtrap encapsulado en adaptador HttpClient reutilizable del JDK. Claim/complete en transacciones cortas REQUIRES_NEW; HTTP después del commit. Un scheduler serial, sin broker ni dependencias adicionales. El request incluye `category` con el tipo de evento y `custom_variables.pliego_outbox_id` sin datos personales. La respuesta `success=true` debe incluir exactamente un `message_ids`; el identificador se guarda en `correo_outbox.id_mensaje_proveedor` y se registra junto al ID de outbox, sin guardar el cuerpo de respuesta. Las claves únicas son `ORDER_CONFIRMED:{id}`, `ORDER_STATUS:{id}:{method}:{state}` y `ORDER_CANCELLED:{id}`.

PENDING → SENDING → SENT/FAILED. UUID propietario, lease 60s, intentos, próximo intento, timestamps, error de código fijo. Claims concurrentes usan FOR UPDATE SKIP LOCKED. Máximo cinco intentos; 429/5xx reintentan tras 30/60/120/240s más polling. La documentación actual no define `Retry-After` para este endpoint; se mantiene backoff exponencial. 4xx restantes terminan FAILED. SENT significa HTTP 200 con aceptación e ID del proveedor, no entrega al buzón. El fallo de proveedor no revierte checkout.

Mailtrap documenta 150 llamadas API cada 10 segundos por token; las cuentas nuevas también tienen throughput inicial de 150 correos/hora y el plan Free limita a 150/día. El poll por defecto limita PLIEGO a 120/hora por instancia, pero no puede ampliar un límite diario del proveedor: comprobar el plan antes de activar tráfico real y subir los límites de PLIEGO solo si la cuenta tiene capacidad suficiente. [Rate limits API](https://docs.mailtrap.io/developers/rate-limits) · [Límites de envío por plan](https://docs.mailtrap.io/email-api-smtp/setup/sending-limits).

Timeout/IO/lease abandonado termina FAILED/AMBIGUOUS_DELIVERY. La API Mailtrap no documenta idempotency keys: perder la respuesta impide garantizar a la vez entrega y cero duplicados. No reintentar automáticamente aceptación incierta; reconciliar actividad del proveedor antes de reenvío administrativo. No hay endpoint público/admin para reenviar outbox. Logs solo ID/tipo/intentos/outcome/código seguro, sin destinatarios/cuerpos. Revisar FAILED y políticas de retención con acceso administrativo controlado.

La prueba manual [`mailtrap_manual_smoke.py`](../../backend/src/test/postgres18/mailtrap_manual_smoke.py) usa el endpoint real de PLIEGO para solicitar un reset a una cuenta de prueba elegible y espera el estado de outbox y el `message_ids` persistido. Ejecútala desde el mismo entorno que tiene `PLIEGO_MAIL_ENABLED=true`, el token externo, `PLIEGO_APP_PUBLIC_URL` y `PG*` para la base conectada al backend; configura `PLIEGO_MAIL_SMOKE_RECIPIENT` y, si corresponde, `PLIEGO_MAIL_SMOKE_API_URL`. Solo envía con el argumento `--confirm-real-email`; nunca se ejecuta en CI. Confirmar después el evento `delivery` en Email Logs: Mailtrap distingue la aceptación API de los eventos finales de entrega.

Webhooks: Mailtrap puede reportar `delivery`, `soft bounce`, `bounce`, `spam`, `reject` y otros eventos con `message_id` y `event_id`, y firma las solicitudes mediante HMAC-SHA256. Aportaría valor para distinguir aceptación del proveedor y entrega o rebote posterior. Se recomienda un alcance posterior con endpoint HTTPS autenticado, validación de firma sobre el cuerpo crudo, deduplicación por `event_id`, procesamiento asíncrono y una tabla de eventos/estado de entrega. No se implementa en esta iteración; por ahora consultar Email Logs. [Documentación oficial de webhooks](https://docs.mailtrap.io/email-api-smtp/advanced/webhooks) y [estados/eventos](https://docs.mailtrap.io/email-api-smtp/analytics/statuses-and-events).

Rutinas nuevas: `sp_customer_register_with_verification`, `fn_email_rate_limit`, `fn_email_action_enqueue`, `fn_email_action_request`, `fn_email_verification_for_user`, `fn_email_action_consume`, `fn_auth_session_create_checked`, `fn_invalidate_changed_email`, `fn_mail_outbox_claim`, `fn_mail_outbox_complete`. Se reemplaza `fn_user_auth_data`; checkout anterior se renombra `sp_checkout_internal_v033` y wrapper conserva firma. Trigger nuevo `trg_usuario_email_verification`.

## Plantillas

Todas las plantillas se componen con `MailLayout` (mismo paquete que `MailTemplates`): una sola hoja blanca sobre
papel cálido, la marca PLIEGO en ultramar, un titular, secciones breves, una acción principal en ultramar y un pie
discreto. HTML con tablas y estilos en línea (sin scripts, fuentes web ni recursos remotos salvo el logo y las portadas), `color-scheme:
light only`, ancho máximo 600 px y versión en texto plano coherente. El verde solo marca un ahorro. `MailTemplates.render`
dibuja el snapshot que recibe: no deriva estados, importes ni plazos, y rechaza un tipo o un estado que no conoce.

| Tipo | Emitido hoy por el outbox | Datos que lee |
|---|---|---|
| `VERIFY_EMAIL` (alta y reenvío), `RESET_PASSWORD` | Sí | `nonce`, `expiresAt` |
| `ORDER_CONFIRMED` | Sí | `orderId`/`orderNumber`, `customerName`, `customerEmail`, `date`, totales e impuestos, items con snapshots pagados/originales/ahorros, `delivery`, `pickup`, `actionPath`, `libraryPath` |
| `ORDER_STATUS` | Sí, por transición única | `method`, `state`, `orderState`, `fulfillmentState`, `lifecycleState`, customer, `eventAt`, items y pricing históricos, dirección o pickup snapshot, carrier/tracking y rutas de acción |
| `ORDER_CANCELLED` | Sí, solo cancelación de cliente con pago REFUNDED | customer, `paymentState`, `refundAmount`, `refund`, items/pricing históricos, `cancellationAt`, ruta de pedido; sin datos de inventario ni entitlement |

Campos opcionales que las plantillas dibujan cuando el snapshot los incluye y omiten si faltan: por ítem `authors`,
`format`, `coverUrl`, `originalSubtotal`, `lineSavings`; por pedido `originalSubtotal`, `savingsTotal`. El precio
anterior y el ahorro solo aparecen juntos y cuando el servidor informa un ahorro mayor que cero. Una compra sin
`delivery` ni `pickup` se presenta como digital (sin envío, con enlace a Mi biblioteca); en una compra mixta la
referencia a Mi biblioteca depende de `format` en los ítems.

Las señales se insertan desde los procedimientos/triggers de PostgreSQL que persisten la transición, dentro de esa misma transacción. La reconciliación de HOME_DELIVERY y la finalización de digital/pickup también producen los eventos al avanzar estados vencidos. Pickup no tiene estado READY: `readyAt` es una estimación snapshot, así que no se emite un aviso de listo ficticio.

`TransactionalMailTest` escribe cada plantilla en `backend/target/mail-previews/` (HTML y texto) para revisarla a la vista.

## Pruebas sin credenciales reales

Los tests SpringBootTest fuerzan `pliego.mail.enabled=false` mediante TestPropertySource, con prioridad sobre variables de entorno, incluso si el desarrollador hereda PLIEGO_MAIL_ENABLED=true. Los tests de envío construyen explícitamente el transporte de loopback.

También se reemplaza `fn_customer_password_hash` con una lectura VOLATILE/FOR UPDATE; el lock del usuario dura toda la reautenticación y cambio de email. El gate concurrente reproduce y evita que reset confirme entre la comprobación de la contraseña y el cambio sensible.

`cd backend && mvn clean verify`: Java usa HttpServer local, gateways fake y secretos ficticios. No envío real. Con PostgreSQL 18, configurar PGHOST/PORT/DATABASE/USER/PASSWORD, PLIEGO_DB_URL/USERNAME/PASSWORD, placeholders admin ficticios y JWT de prueba en una base descartable; después del build ejecutar:

```sh
bash backend/src/test/postgres18/run_ci_gates.sh
```

Runner fuerza correo desactivado e incluye SQL, claims concurrentes y sesiones/HTTP. En **otra base descartable vacía**, apuntando las variables a ella:

```sh
python3 backend/src/test/postgres18/transactional_email_http_gate.py
```

El gate inicia backend y stub Mailtrap en loopback, usa token/remitente ficticios y verifica verificación/reset/BCrypt/sesiones, consumo concurrente único, checkout durante 503 y posterior retry 200. GitHub Actions ejecuta ambos. Log completo del backend local: `/tmp/pliego-mail-http-backend.log`; no imprime tokens/passwords/cookies. Preview manual Sandbox requiere token externo de Sandbox e inbox_id; pruebas automáticas no lo necesitan.

En **otra base descartable vacía**, el gate de upgrade aplica V001–V060, crea pedidos históricos, arranca de nuevo con V061/V062 y compara snapshots/outbox antes y después; también reconcilia esos pedidos con el scheduler y comprueba la idempotencia:

```sh
python3 backend/src/test/postgres18/transactional_email_lifecycle_upgrade_gate.py
```

## Inventario de archivos de esta iteración

- Nuevo módulo `backend/src/main/java/com/pliego/modules/notifications/`: `application/{MailConfiguration,MailProperties,MailMessage,MailLayout,OutboxMail,MailDeliveryException,MailDeliveryReceipt,TransactionalMailSender,MailTemplates,MailOutboxService,MailOutboxWorker}.java`, `gateway/{MailOutboxGateway,JdbcMailOutboxGateway}.java`, `provider/MailtrapMailSender.java`.
- Nuevos archivos de identidad: `application/{EmailActionTokens,EmailActionService}.java`, `api/{EmailActionController,EmailActionRequests,InvalidEmailActionException}.java`; nuevo `foundation/security/EmailNotVerifiedException.java`.
- Los once fixtures SpringBootTest añaden TestPropertySource para desactivar correo ante variables heredadas. También se actualiza la documentación del evento existente `customer/application/CustomerEmailChanged.java` para reflejar la entrega persistente.
- Modificados en backend: `identity/application/AuthService.java`, `identity/gateway/{IdentityGateway,JdbcIdentityGateway}.java`, `identity/api/{AuthController,RegisterRequest,RegisterResponse}.java`, `customer/application/CustomerService.java`, `foundation/security/SecurityConfiguration.java`, `foundation/web/ApiExceptionHandler.java`, `src/main/resources/application.yml`, `README.md`.
- Nueva migración `src/main/resources/db/migration/V039__transactional_email.sql`.
- V061 permite los tipos de ciclo de pedido y los encola transaccionalmente desde transiciones autoritativas; V060 persiste la correlación con el ID de aceptación de Mailtrap.
- Tests nuevos: `src/test/java/com/pliego/modules/notifications/TransactionalMailTest.java`; `src/test/postgres18/{transactional_email_gate.sql,transactional_email_http_gate.py,transactional_email_lifecycle_upgrade_gate.py,transactional_email_concurrency.py,email_verification_fixture.py}`. Los gates HOME_DELIVERY, STORE_PICKUP y digital verifican eventos, snapshots, fallos de transición e idempotencia; el gate HTTP cubre reinicio con outbox pendiente usando solo el stub local; el gate de upgrade cubre V060→V062 con pedidos históricos. Smoke real separado: `mailtrap_manual_smoke.py`.
- Documentación: ADR 0020 e índice, esta guía, amendment `0012-transactional-email-v1.0.12.md`, plan `docs/superpowers/plans/2026-10-04-transactional-email.md`; CI `.github/workflows/ci.yml` añade stub local en base aislada.

## Frontend

Las rutas `/verificar-correo`, `/reenviar-verificacion`, `/recuperar-contrasena` y `/restablecer-contrasena` están implementadas. Los tokens se leen desde el fragmento, se retiran del historial y se envían por POST; registro espera verificación y login ofrece solicitar otro enlace. El frontend no conoce ni recibe el token de Mailtrap.
