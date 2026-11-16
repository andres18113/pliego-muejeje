# Retiro: horario y avisos de transición

Contrato implementado por V097 y [ADR 0051](../adr/0051-pickup-readiness-and-durable-notifications.md). Validación exclusivamente local; sin SSH, base de datos, API ni proveedor de producción.

| Requisito | Criterio de aceptación | Evidencia ejecutable |
|---|---|---|
| REQ-P1 | En horario abierto, aprobación 10:00 → cancelación 10:06 y READY 10:10; no se suman los 25 minutos configurados ni diez después de seis | `pickup_timing_notifications_gate.sql`, helper literal y checkout cotizado real con ubicación configurada en 25 |
| REQ-P2 | 16:49:59 → 16:59:59; 16:50 → apertura siguiente 09:00 si cierra 17:00; apertura inclusiva, cierre exclusivo | Gate SQL: límites literales, horario nocturno y aprobación 19:22 con punto cerrado |
| REQ-P3 | Una disponibilidad del día anterior no autoriza READY, colección ni correo mientras el punto está cerrado | Gate SQL: snapshot nuevo aprobado el día anterior; colección rechazada P5018 y barrido sin correo |
| REQ-P4 | Un pago por transferencia pendiente se ancla a su aprobación real; repetir aprobación no mueve el horario | Gate SQL: `sp_checkout_billed_quoted` → `sp_billed_order_approve`, exactos diez/seis minutos |
| REQ-P5 | `readyAt=estimatedAt+preparationMinutes`, con preparación diez; confirmación, cliente y administración comparten el timestamp | Gate SQL y `store_pickup_gate.sql`; inmutabilidad tras aprobar y replay |
| REQ-P6 | A 5:59 todavía se puede cancelar y reembolsar; a 6:01 se devuelve P5003; un cancelado no recibe READY/COLLECTED | Gate SQL: cancelación real con movimiento SALE y reloj de aprobación sembrado |
| REQ-P7 | Una fila READY por pedido, aunque compitan barridos o se repita la ejecución | `pickup_notifications_concurrency.py`: productor bloqueado tres segundos, segundo worker no bloqueado, ocho barridos concurrentes/repetidos |
| REQ-P8 | Un fallo antes del commit no pierde ni duplica la transición; otro proceso la recupera | Gate SQL: rollback de marcador/outbox; gate concurrente: rollback y barridos en procesos psql nuevos |
| REQ-P9 | Retiro verificado encola un COLLECTED; también recupera READY si el mostrador gana al barrido | Gate SQL y concurrencia: dos colecciones concurrentes, un éxito, P5017 para la repetición, un historial y una fila por correo |
| REQ-P10 | Verificar código no recoge ni modifica la identidad; código equivocado/no verificado no entrega | Regresión `verified_pickup_gate.sql`, `admin_pickup_handover_http_gate.py` y pruebas Java existentes |
| REQ-P11 | Desplegar no reprograma pedidos anteriores ni envía correos de retiro histórico | `pickup_timing_upgrade_gate.py`: V096 → V097 en base vacía separada; compara pedido, ítems, pago, snapshot, historial y outbox; barridos sin backlog |
| REQ-P12 | READY y COLLECTED usan los textos y enlaces del layout existente; snapshots antiguos no reciben una explicación de diez minutos inventada | `TransactionalMailTest`: render real, 21 pruebas; explicación condicional al snapshot de diez minutos |
| REQ-P13 | Si el cierre ocurre entre comprobar READY y encolarlo, quedan cero filas READY y el marcador pendiente; la apertura siguiente recupera una sola fila. Un evento ya durable permite completar sin duplicarlo | `pickup_closing_boundary_gate.py`: reloj determinista 16:59:59 → 17:00 → 09:00, ejecución real del encolador y barridos; también comprueba deduplicación y restauración del predicado tras ROLLBACK |

La aritmética anterior es verificable en las migraciones: si A es aprobación y C captura de retiro, el plazo es A+6 y la disponibilidad anterior C+25. Por tanto, `readyAt−cancelacion_hasta=19 minutos+(C−A)`. Si 19:22 era el fin de la ventana y la captura coincidió con aprobar a las 19:16, el cálculo produce 19:41. Una aprobación diferida seis minutos después de la captura también deja diecinueve minutos entre aprobación y disponibilidad anterior. Ninguno de esos supuestos está confirmado para el pedido observado: no se consultó producción. Si 19:22 era la aprobación inmediata, la fórmula de 25 minutos por sí sola no demuestra 19:41. El seed real, además, atiende 09:00–17:00; la política nueva desplaza una aprobación a las 19:22 hasta la siguiente apertura a las 09:00.

El motivo de faltar READY queda localizado en la ausencia de productor SQL. El motivo de no recibir un COLLECTED concreto queda sin determinar: el productor y el renderizador ya estaban presentes. Las pruebas demuestran el enqueue y el render; no una entrega en bandeja. El sender trata IOException/Interrupted como FAILED con AMBIGUOUS_DELIVERY, sin reintento automático; solo 429/5xx producen RETRY. El enqueue es único, pero no prueba la entrega final en bandeja.

Las pruebas de actualización se ejecutan en una base vacía exclusiva. Las pruebas de concurrencia exigen `PLIEGO_TEST_DISPOSABLE_DB=1` y `PGHOST` de loopback. Los gates SQL revierten todos sus efectos. El checkout de una ubicación muestra diez minutos efectivos; su configuración persistida de 25 queda como legado y los pedidos históricos conservan sus snapshots.

El gate de cierre se incluye en `run_ci_gates.sh` y se ejecuta con el propietario de la base desechable: sustituye transaccionalmente solo `fn_pickup_is_open_at` por el mismo cálculo con un reloj de prueba, conservando las rutinas reales de estado, encolado y finalización. El ROLLBACK restaura la definición original y el gate comprueba esa restauración incluso al fallar. No introduce un reloj configurable en producción ni requiere privilegios adicionales de `pliego_app`; los nueve gates existentes del rol restringido siguen ejecutándose por separado.

Pendientes visuales para una fase autorizada de frontend (no se modifican en este trabajo):

- `frontend/src/features/purchase/PickupDetails.tsx`: explicar diez minutos totales desde aprobación y próxima apertura, manteniendo la hora del snapshot.
- `frontend/src/features/purchase/PickupLocationPicker.tsx`: texto de preparación de diez minutos efectivos y horario de colección.
- `frontend/src/features/admin/AdminPickupDetailPage.tsx` y cola de retiros: explicar PENDING cuando el punto está cerrado, sin habilitar la colección por la hora pasada.
- Revisar mensajes fijos de confirmación/cancelación para que «seis minutos» empiece en la aprobación del pago. El contenido de Ayuda publicado procede del backend y ya se actualiza por V097.
