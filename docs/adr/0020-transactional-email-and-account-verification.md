# ADR 0020 — Correo transaccional y verificación de cuenta

Fecha: 2026-10-04. Estado: aceptado para la implementación solicitada.

## Auditoría y contexto

PLIEGO es un monolito modular Java 25 / Spring Boot 4.1.1, JDBC, PostgreSQL 18 y Flyway. Las capas siguen Controller → Service transaccional → Gateway → API de PostgreSQL (`SECURITY INVOKER`). No hay JPA, broker, scheduler ni outbox existentes. Las migraciones actuales terminan en V038. Los triggers existentes mantienen timestamps, snapshots e invariantes; las migraciones originales y baselines permanecen intactos.

`AuthService.register` aplica BCrypt (coste 12) y `sp_customer_register` crea usuario CUSTOMER ACTIVE y cliente. El email es canónico, único y es la identidad de login. Solo existen ACTIVE/BLOCKED, sin verificación. Login entrega JWT HS256 (30 minutos) y cookie HttpOnly con refresh persistente (30 días); V026–V028 implementan rotación, repetición durante cinco minutos y revocación. No hay recuperación ni cambio de contraseña público. Los JWT ya emitidos son stateless: revocar refresh no invalida inmediatamente access tokens.

`PUT /api/v1/me/email` reautentica por contraseña, cambia email y publica `CustomerEmailChanged`, sin consumidor ni persistencia. Los clientes pueden consultar/editar perfil, direcciones y favoritos; admin puede buscar clientes y bloquearlos.

`POST /api/v1/checkout` usa `sp_checkout_idempotent` (V036) y delega en `sp_checkout` (V033/V032). Pago APPROVED cambia pedido a CONFIRMED; pago rechazado crea CANCELLED. V033 separa preparación/envío/entrega de la compra. Hay consultas/cancelaciones públicas de pedidos y transiciones, tracking, facturas y notas de crédito admin. Confirmación de compra significa CONFIRMED, no DELIVERED. Existen snapshots reales de productos, cantidades, precio/subtotal/total y dirección; no se inventan moneda ni número comercial de pedido.

Configuración única application.yml con variables PLIEGO_*, sin perfiles específicos; errores REST centralizados en español por SQLSTATE. Tests Java usan SpringBootTest/MockMvc con gateways fake y transacciones sin BD; gates adicionales ejecutan PostgreSQL 18 y HTTP reales. Se extienden ambos patrones.

## Decisión

Añadir módulo notifications con abstracción `TransactionalMailSender`, adaptador HTTP Mailtrap mediante HttpClient del JDK, plantillas HTML/texto escapadas y worker serial de bajo consumo. No dependencias ni servicios nuevos. Registro y solicitudes de tokens pertenecen a identity. Una migración V039 añade estado de verificación, tokens de acción y outbox. SQL mantiene elegibilidad, límites, consumo, idempotencia y snapshots; Spring mantiene límites transaccionales.

Mantener ACTIVE/BLOCKED administrativos. Añadir `email_verificado_en`: las cuentas existentes se consideran verificadas; nuevas cuentas requieren verificación y registro responde PENDING_VERIFICATION. `fn_user_auth_data` proyecta UNVERIFIED para bloquear login sin afectar clientes bloqueados ni ADMIN. Al cambiar email se invalida la verificación y los tokens anteriores, se revocan refresh y se solicita verificación del nuevo correo dentro de la misma transacción. No se reutiliza el evento en memoria como garantía de entrega.

Escoger recuperación de contraseña como único caso adicional: llena un vacío de identidad y reutiliza BCrypt y sesiones revocables. Verificación: 24 horas; reset: 15 minutos. Tokens de 256 bits derivados por HMAC-SHA256 de nonce aleatorio de 256 bits y secreto externo, con separación por propósito. Solo persistir hash SHA-256 y nonce no utilizable sin el secreto; ningún token plano en BD/outbox. El secreto puede usar el secreto JWT existente con contexto HMAC diferente, o un secreto de correo independiente. Rotarlo invalida acciones pendientes.

Solicitudes públicas neutras, límites persistentes por hash de email (5/hora) y dirección remota (20/hora), cooldown por cuenta/propósito de un minuto. Uso único, invalida tokens previos y correos pendientes. Restablecer revoca todas las sesiones refresh y ambos propósitos de tokens. JWT anteriores conservan su vida máxima actual de 30 minutos.

El wrapper de `sp_checkout` captura al final el snapshot y crea un único evento ORDER_CONFIRMED por pedido, en la misma transacción, incluyendo checkout idempotente y llamadas SQL. No enviar para CANCELLED ni transiciones de fulfillment.

Outbox PENDING → SENDING → SENT/FAILED con propietario UUID, lease, intentos, próximo intento, timestamps y error seguro. Claim usa FOR UPDATE SKIP LOCKED y transacción corta. HTTP ocurre después de commit, con timeouts. Máximo cinco intentos; backoff 30/60/120/240 segundos para 429/5xx. Fallos permanentes terminan FAILED. Timeout/IO incierto y leases abandonados terminan FAILED (AMBIGUOUS_DELIVERY), requieren reconciliar antes de reenviar. Esto evita duplicar automáticamente envíos cuya aceptación no conocemos; la API Mailtrap no documenta idempotency keys ni garantía exactly-once. SENT significa aceptado por proveedor, no entregado al buzón. MAIL_ENABLED=false conserva eventos, no los reclama ni envía.

HTTPS para URLs públicas y endpoint salvo loopback explícito de desarrollo. Credenciales, remitente y URLs exclusivamente externos. Logs solo id/tipo/estado/intentos/código seguro, sin destinatarios, payload ni respuesta del proveedor. Plantillas sin imágenes remotas; se usan datos del snapshot.

## Alternativas

SMTP requiere librería y expresa peor clasificación de errores; HTTP conserva contratos oficiales con cero dependencias. Envío directo acopla checkout al proveedor y pierde consistencia; evento Spring AFTER_COMMIT no es persistente. Un broker añade operación innecesaria en VPS pequeño.

## Validación

La revisión independiente reprodujo una carrera entre reset y reautenticación para cambio de correo. V039 reemplaza `fn_customer_password_hash` por una lectura VOLATILE con FOR UPDATE; Spring conserva el lock durante BCrypt y el cambio sensible. Una prueba PostgreSQL concurrente comprueba que reset no se confirma en medio de esa transacción. `fn_auth_session_create_checked` también serializa emisión de refresh con reset y revalida el hash usado por el login.

Pruebas Java de token, plantillas, HTTP local stub, worker y endpoints. Gate PostgreSQL verifica registro, expiración, consumo/reenvío, límites, reset/sesiones, rollback, claim concurrente/idempotencia y checkout/outbox. Build Maven y gates existentes con fixtures explícitamente verificadas. Frontend pendiente: registro/verificación/reenvío, recuperación/reset y aviso tras cambiar email.

Fuentes: [Mailtrap OpenAPI oficial](https://github.com/mailtrap/mailtrap-openapi/blob/main/specs/email-sending-transactional.openapi.yml), [autenticación](https://docs.mailtrap.io/developers/authentication), [límites](https://docs.mailtrap.io/developers/rate-limits).
