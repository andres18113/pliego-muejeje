# API amendment v1.0.12 — Correo transaccional

Fecha: 2026-10-04. Complementa los contratos aprobados mediante V039, sin editar baselines.

`POST /api/v1/auth/register` conserva request, IDs y errores anteriores; `state` pasa a PENDING_VERIFICATION. Login devuelve 403 / EMAIL_NOT_VERIFIED al acertar contraseña de una cuenta pendiente; las demás credenciales inválidas mantienen 401. Cuentas existentes conservan acceso; ACTIVE/BLOCKED administrativos no cambian.

Nuevos endpoints públicos POST/JSON:

| Ruta | Body | Resultado |
|---|---|---|
| `/api/v1/auth/verify-email` | `{ "token": "<base64url de 43 caracteres>" }` | 204; 400 EMAIL_ACTION_INVALID si inválido/vencido/usado |
| `/api/v1/auth/resend-verification` | `{ "email": "lector@example.invalid" }` | 202 neutro |
| `/api/v1/auth/forgot-password` | Igual | 202 neutro |
| `/api/v1/auth/reset-password` | `{ "token": "<base64url de 43 caracteres>", "password": "<nueva contraseña>" }` | 204; 400 EMAIL_ACTION_INVALID o VALIDATION_ERROR |

Respuesta 202: `{ "message": "Si la cuenta cumple los requisitos, recibirás un correo con los pasos a seguir." }`. Misma respuesta ante desconocido, bloqueado, no elegible o limitado. Token verifica en 24h/reset en 15m, uso único. Cinco solicitudes/email/hora, veinte/IP/hora, cooldown un minuto. Password usa política/BCrypt existentes.

`PUT /api/v1/me/email` conserva request/response y reautenticación; al cambiar email invalida verificación, tokens de acción y refresh, y crea intención de verificación en su transacción. Reset revoca todos los refresh; JWT emitidos conservan expiración hasta 30 minutos. Verificar/resetear no inicia sesión automáticamente.

Checkout conserva contrato e idempotencia; pedido CONFIRMED/pago APPROVED registra email único, atómico y asíncrono. Fallo de correo no revierte checkout. URLs del frontend configuradas: `/verificar-correo#token=...`, `/restablecer-contrasena#token=...`, `/orders/{id}`. Las primeras dos páginas quedan pendientes en frontend; retirar token del historial y enviarlo por POST sin telemetría.

Errores humanos en español y Problem Details existente. SQLSTATE aprobados sin cambios. Códigos nuevos de aplicación EMAIL_NOT_VERIFIED / EMAIL_ACTION_INVALID no sustituyen SQLSTATE.

Arquitectura/rutinas: [ADR 0020](../adr/0020-transactional-email-and-account-verification.md). Configuración/pruebas/outbox: [guía operativa](../backend/transactional-email.md). OpenAPI del backend se actualiza por annotations; frontend y su snapshot generado no se modifican.
