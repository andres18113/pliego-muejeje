# Cambio de correo pendiente — 2026-11-01

Sustituye el cambio inmediato del correo de login. El cambio se publica en
[V094 y V095](../adr/0049-pending-email-change.md); requiere ambas migraciones.
El estado de entregabilidad de ADR 0048 permanece independiente de la verificación.

| Ruta | Resultado |
|---|---|
| `PUT /api/v1/me/email` `{newEmail,currentPassword}` | 202 `{email,pendingEmail:{address,expiresAt}}`. `email` sigue siendo el actual. |
| `GET /api/v1/me` | Añade `pendingEmail: null \| {address,expiresAt,delivery: OK\|UNDELIVERABLE}`. Expirado se lee como null. |
| `POST /api/v1/me/email-change/resend` | Autenticado, 202 sin cuerpo. Rota solo la confirmación. |
| `DELETE /api/v1/me/email-change` | Autenticado, 204, idempotente. |
| `POST /api/v1/auth/email-change/confirm` `{token}` | Público, 200 `{email}`. Promoción atómica, verificación y revocación de todos los refresh. |
| `POST /api/v1/auth/email-change/cancel` `{token}` | Público, 200 sin cuerpo incluso si ya se canceló. Si se confirmó, devuelve 410 `EMAIL_CHANGE_ALREADY_CONFIRMED`. |

`expiresAt` usa fecha UTC ISO 8601. La solicitud vive 24 horas; reenviar conserva
su fecha de vencimiento y el enlace de recuperación original. Otra solicitud
sustituye ambos enlaces. Límites por usuario: cinco solicitudes por hora; cinco
reenvíos por hora y un minuto entre envíos de confirmación. El límite devuelve
429 `EMAIL_CHANGE_RATE_LIMITED`. No se reserva la dirección nueva.

| SQLSTATE nuevo | Código público | HTTP |
|---|---|---|
| P1120 | EMAIL_CHANGE_SAME_ADDRESS | 400 |
| P1121 | EMAIL_CHANGE_NOT_PENDING | 404 |
| P1122 | EMAIL_CHANGE_RATE_LIMITED | 429 |
| P1123 | EMAIL_CHANGE_TOKEN_INVALID | 400 |
| P1124 | EMAIL_CHANGE_TOKEN_EXPIRED | 410 |
| P1125 | EMAIL_CHANGE_TOKEN_USED | 410 |
| P1126 | EMAIL_CHANGE_TOKEN_SUPERSEDED | 410 |
| P1127 | EMAIL_CHANGE_CANCELLED | 410 |
| P1128 | EMAIL_CHANGE_ALREADY_CONFIRMED | 410 |

Los códigos preexistentes conservan su representación y significado: conflicto
de unicidad sigue siendo 409 `P1101`, contraseña incorrecta sigue usando su código
actual y los argumentos SQL inválidos mantienen `P1001`. Dirección actual repetida:
“Ese ya es tu correo actual.” Todos los mensajes públicos están en español.
Los errores de enlace no indican si una cuenta existe.

Los enlaces llevan únicamente `#token=`: confirmación `/confirmar-correo`,
recuperación `/cancelar-cambio-correo`. La confirmación usa un propósito HMAC distinto
del de cancelación. No inicia sesión. Después de confirmar, la UI debe pedir login;
los access tokens ya emitidos mantienen su vencimiento máximo existente de 30 minutos.
El aviso final al correo anterior lleva a `/ayuda`.

El correo de confirmación se dirige a la dirección nueva y no incluye la anterior.
Un rebote/suppression suyo afecta solo `pendingEmail.delivery`. Los avisos al correo
actual/anterior conservan el preflight HELD de ADR 0048. Confirmar limpia el indicador
de la cuenta, nunca reencola FAILED/HELD ni retargetea snapshots.

Dos protecciones adicionales de recuperación: el login comprueba bajo lock que su
correo canónico no cambió entre BCrypt y creación de sesión; restablecer la
contraseña del correo actual cancela atómicamente un cambio pendiente, de modo que
una confirmación previamente entregada no sobreviva a esa recuperación.

El OpenAPI exportado expresa el pendiente como `anyOf` (objeto o null) para que el
tipo generado sea `PendingEmail | null`. No hay cambios manuales en código UI;
las pantallas, navegación y recuperación visual quedan a cargo de Claude.
