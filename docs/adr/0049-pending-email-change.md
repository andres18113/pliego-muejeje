# ADR 0049 — Confirmar el correo nuevo antes de cambiar la identidad

Fecha: 2026-11-01. Estado: aceptado para la implementación local solicitada.

El contrato solicitado sustituye el cambio inmediato de ADR 0020/0032 y la
limitación de alcance de ADR 0048. Se mantiene Controller → Application Service
transaccional → JDBC Gateway → Database API SECURITY INVOKER, sin dependencias nuevas.

V094 añade solicitudes versionadas por UUID y credenciales por propósito
EMAIL_CHANGE_CONFIRM / EMAIL_CHANGE_CANCEL. Mantiene email, verificación, sesiones y
destinatarios actuales hasta confirmar. No reserva la nueva dirección: valida
unicidad al solicitar y nuevamente al promover, traduciendo uq_usuario_email a
P1101 como antes. El lock de usuario serializa solicitud, confirmación, cancelación,
reset y reautenticación. El historial mínimo conserva hashes/nonce y estados para
distinguir enlaces usados, sustituidos, vencidos, cancelados y ya confirmados.
No persiste credenciales planas; Java comprueba HMAC derivado en tiempo constante.

La solicitud vence en 24 horas. Reenviar rota únicamente la credencial de
confirmación, conserva el enlace de recuperación y el vencimiento original. Se
permiten cinco solicitudes y cinco reenvíos por usuario/hora, con cooldown de un
minuto para reenvíos. Sustituir una solicitud invalida ambos enlaces anteriores.
Cancelar es idempotente; después de confirmar devuelve EMAIL_CHANGE_ALREADY_CONFIRMED.
Promover usa la normalización/uniquidad y revocación existentes y marca el nuevo
correo verificado dentro de la misma transacción. Los JWT ya emitidos conservan
su expiración; no se reencolan filas FAILED/HELD.

Se reutiliza la outbox y MailLayout para confirmación, aviso al correo actual y
aviso final al correo anterior. Un rebote/suppression de EMAIL_CHANGE_CONFIRM se
proyecta solo a su solicitud y versión, nunca al perfil actual ni al bloqueo global
de destinatarios. Los otros avisos conservan las reglas de ADR 0048. La proyección
respeta orden temporal y no contamina una solicitud sustituta.

Se conservan las firmas SQL históricas para lectores/gates existentes; la API REST
usa exclusivamente los comandos nuevos. El perfil amplía su lectura pública con
pendingEmail nullable. V095 vincula la creación de sesión al correo canónico usado por login y cancela
solicitudes pendientes al recuperar la contraseña del correo actual. Estas dos
protecciones cierran carreras de recuperación sin cambiar las respuestas públicas.
Códigos nuevos P1120–P1128 son aditivos; no cambian los
SQLSTATE ni códigos públicos previos.

Validación: pruebas Java, gates PostgreSQL 18 de invariantes/concurrencia/HTTP,
upgrade desde V087, instalación limpia y ciclo ACL del runbook. Solo entornos
locales descartables; toda operación de producción queda fuera del alcance.
