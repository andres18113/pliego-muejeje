# Correo transaccional de PLIEGO

Auditoría/diseño: [ADR 0020](../adr/0020-transactional-email-and-account-verification.md). Migración nueva: `V039__transactional_email.sql`. Ninguna migración anterior se modifica.

## Configuración externa

| Variable | Uso / valor por defecto |
|---|---|
| `PLIEGO_MAIL_ENABLED` | `false`; detiene todo envío y conserva eventos; cuentas nuevas siguen requiriendo verificación |
| `PLIEGO_MAIL_ENDPOINT` | URL externa completa: producción `https://send.api.mailtrap.io/api/send`; Sandbox `https://sandbox.api.mailtrap.io/api/send/{inbox_id}` |
| `PLIEGO_MAIL_TOKEN` | API token autorizado para dominio o Sandbox; nunca en Git |
| `PLIEGO_MAIL_FROM_ADDRESS` / `PLIEGO_MAIL_FROM_NAME` | Remitente externo habilitado por el proveedor |
| `PLIEGO_APP_PUBLIC_URL` | Base HTTPS del frontend, sin query/fragment |
| `PLIEGO_MAIL_TOKEN_SECRET` | Secreto estable de ≥32 bytes. Si se omite, usa `PLIEGO_JWT_SECRET` con contexto HMAC separado |
| `PLIEGO_MAIL_ALLOW_LOCAL_HTTP` | `false`; HTTP exclusivamente en loopback para desarrollo |
| `PLIEGO_MAIL_CONNECT_TIMEOUT` / `PLIEGO_MAIL_REQUEST_TIMEOUT` | `PT3S` / `PT10S`; máximos 10/20 segundos |
| `PLIEGO_MAIL_POLL_INTERVAL` / `PLIEGO_MAIL_BATCH_SIZE` | `PT10S` / `5`; lote 1–10, procesamiento serial |

No se requieren propiedades SMTP: HTTP con Bearer API token. Configuración incompleta/insegura impide iniciar cuando está habilitado. No se modifica DNS ni Cloudflare; el dominio remitente debe estar habilitado previamente. Rotar el secreto de acciones invalida enlaces pendientes; rotar el token API del proveedor no los invalida. Usar polling conservador en VPS.

Contrato confirmado en [OpenAPI oficial](https://github.com/mailtrap/mailtrap-openapi/blob/main/specs/email-sending-transactional.openapi.yml), [autenticación](https://docs.mailtrap.io/developers/authentication), [límites](https://docs.mailtrap.io/developers/rate-limits) y [Sandbox](https://github.com/mailtrap/mailtrap-openapi/blob/main/specs/sandbox-sending.openapi.yml).

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

Completado significa pago APPROVED/pedido CONFIRMED, distinto de entrega DELIVERED. Wrapper de `sp_checkout` conserva V033/V032 y captura snapshots al final. Evento único `ORDER_CONFIRMED:{pedido_id}`, también con replay de `sp_checkout_idempotent`. No correo para rechazo/cancelación/transiciones de fulfillment. HTML/texto incluyen ID, fecha, productos, cantidades, precios/subtotales/total y dirección snapshot cuando hay entrega física; ruta real `/orders/{id}`. No se inventa moneda ni número comercial. HTML escapado, sin imágenes remotas.

Tablas `correo_token`, `correo_outbox`, `correo_limite`. Abstracción `TransactionalMailSender`; Mailtrap encapsulado en adaptador HttpClient reutilizable del JDK. Claim/complete en transacciones cortas REQUIRES_NEW; HTTP después del commit. Un scheduler serial, sin broker ni dependencias adicionales.

PENDING → SENDING → SENT/FAILED. UUID propietario, lease 60s, intentos, próximo intento, timestamps, error de código fijo. Claims concurrentes usan FOR UPDATE SKIP LOCKED. Máximo cinco intentos; 429/5xx reintentan tras 30/60/120/240s más polling. 4xx restantes terminan FAILED. SENT significa HTTP 200/aceptación, no entrega al buzón. El fallo de proveedor no revierte checkout.

Timeout/IO/lease abandonado termina FAILED/AMBIGUOUS_DELIVERY. La API Mailtrap no documenta idempotency keys: perder la respuesta impide garantizar a la vez entrega y cero duplicados. No reintentar automáticamente aceptación incierta; reconciliar actividad del proveedor antes de reenvío administrativo. No hay endpoint público/admin para reenviar outbox. Logs solo ID/tipo/intentos/outcome/código seguro, sin destinatarios/cuerpos. Revisar FAILED y políticas de retención con acceso administrativo controlado.

Rutinas nuevas: `sp_customer_register_with_verification`, `fn_email_rate_limit`, `fn_email_action_enqueue`, `fn_email_action_request`, `fn_email_verification_for_user`, `fn_email_action_consume`, `fn_auth_session_create_checked`, `fn_invalidate_changed_email`, `fn_mail_outbox_claim`, `fn_mail_outbox_complete`. Se reemplaza `fn_user_auth_data`; checkout anterior se renombra `sp_checkout_internal_v033` y wrapper conserva firma. Trigger nuevo `trg_usuario_email_verification`.

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

## Inventario de archivos de esta iteración

- Nuevo módulo `backend/src/main/java/com/pliego/modules/notifications/`: `application/{MailConfiguration,MailProperties,MailMessage,OutboxMail,MailDeliveryException,TransactionalMailSender,MailTemplates,MailOutboxService,MailOutboxWorker}.java`, `gateway/{MailOutboxGateway,JdbcMailOutboxGateway}.java`, `provider/MailtrapMailSender.java`.
- Nuevos archivos de identidad: `application/{EmailActionTokens,EmailActionService}.java`, `api/{EmailActionController,EmailActionRequests,InvalidEmailActionException}.java`; nuevo `foundation/security/EmailNotVerifiedException.java`.
- Los once fixtures SpringBootTest añaden TestPropertySource para desactivar correo ante variables heredadas. También se actualiza la documentación del evento existente `customer/application/CustomerEmailChanged.java` para reflejar la entrega persistente.
- Modificados en backend: `identity/application/AuthService.java`, `identity/gateway/{IdentityGateway,JdbcIdentityGateway}.java`, `identity/api/{AuthController,RegisterRequest,RegisterResponse}.java`, `customer/application/CustomerService.java`, `foundation/security/SecurityConfiguration.java`, `foundation/web/ApiExceptionHandler.java`, `src/main/resources/application.yml`, `README.md`.
- Nueva migración `src/main/resources/db/migration/V039__transactional_email.sql`.
- Tests nuevos: `src/test/java/com/pliego/modules/notifications/TransactionalMailTest.java`; `src/test/postgres18/{transactional_email_gate.sql,transactional_email_http_gate.py,transactional_email_concurrency.py,email_verification_fixture.py}`. Modificados: `AuthApiIntegrationTest`, `CustomerApiIntegrationTest`, `OpenApiCoverageTest` y gates `checkout_gate.sql`, `full_journey_http_gate.py`, `auth_session_http_gate.py`, `digital_editions_http_gate.py`, `p1_integrity_http_gate.py`, `run_ci_gates.sh`.
- Documentación: ADR 0020 e índice, esta guía, amendment `0012-transactional-email-v1.0.12.md`, plan `docs/superpowers/plans/2026-10-04-transactional-email.md`; CI `.github/workflows/ci.yml` añade stub local en base aislada.

## Frontend pendiente

Implementar `/verificar-correo` y `/restablecer-contrasena`; leer fragment `#token=`, retirarlo del historial y enviarlo por POST, sin analytics/telemetría del token. Añadir solicitud neutra de recuperación/reenvío. Registro debe esperar verificación en lugar de login automático. Login maneja EMAIL_NOT_VERIFIED. Cambio de email explica verificación y limpia/restaura sesión apropiadamente. `/orders/{id}` ya existe y exige login. No se modificó frontend ni su OpenAPI generado.
