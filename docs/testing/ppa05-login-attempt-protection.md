# PPA-05: trazabilidad de protección del login

Implementación: [ADR 0053](../adr/0053-login-attempt-protection.md), V099. Entorno local PostgreSQL 18.6 / Java 25.0.4.1; ninguna conexión de producción. No se editan migraciones aprobadas ni UI. Resultados completos y fallos de preparación conservados en `/tmp/pliego-audit/ppa05/`.

| Requisito | Evidencia que debe fallar si se rompe |
| --- | --- |
| Cuenta+IP, ráfaga y backoff progresivo | `login_attempt_gate.py::burst_and_backoff`: cinco admisiones, sexto rechazo, incremento de solicitudes sin extender espera, escalones hasta 300 s |
| Techo por IP y techo global de cuenta entre IPs | `ceilings`: 600/10 min y 60/15 min de verificaciones admitidas; `many_ips`: 20 escritores en una transacción SQL de cuota retenida artificialmente, sin BCrypt, y contador final exacto 21; la prueba HTTP K=8 verifica ausencia de serialización durante BCrypt |
| Rechazos de pareja no propagan lockout | SQL `denied_flood_isolation`: 650 rechazos conservan presupuesto en 5, otra IP de la cuenta y otra cuenta del mismo NAT entran; HTTP `deniedPairFloodIsCountedWithoutLockingOutOwnerAtAnotherIp` confirma respuesta real y contador total |
| Ventanas fijas y sin bloqueo permanente | `ceilings`, `pair_window_and_success`: mover sólo expiración del fixture reinicia contador y espera; ningún UPDATE de estado de usuario |
| Claves canónicas, hash-only, sin existencia como condición | `parity`, restricciones de tabla V099; desconocido y conocido producen contadores iguales; mayúsculas usan el mismo bucket |
| NAT con/sin XFF, sin locks IP/AC durante BCrypt | HTTP `eightDifferentAccountsShareIpWithoutHoldingBudgetLocksDuringBcrypt` (2 casos): ocho cuentas, pool principal de ocho, barrera, observador independiente NOWAIT y ocho respuestas 200; también como runtime restringido |
| AP vence mientras espera admisión | SQL `pair_expires_while_admission_waits`: el intento ya admitido inicia ventana nueva y queda con un fallo; RED previo y GREEN posterior |
| Rollback posterior a crear sesión | HTTP `infrastructureFailureKeepsCommittedBudgetsButRollsBackPairAndSession`: fallo al invalidar continuidad restaura AP anterior, elimina sesión y conserva IP/AC confirmados |
| Precheck antes de BCrypt | HTTP `eachScopeRejectsBeforeBcryptWithSpanishProblemAndRetryAfter` (3 casos) y `burstCommitsFailuresAndLimitedAttemptsWithoutBcryptAndLogsOnlyRedactedFields`: spy real recibe cero llamadas matches en 429 |
| Desconocido mantiene trabajo BCrypt comparable | HTTP `unknownAndKnownWrongPasswordsUseSameBcryptAndBucketsIncludingCanonicalEmail`: exactamente dos matches reales para conocido erróneo/desconocido; después cero en ambos limitados. No se afirma equivalencia estadística de latencias |
| 429, Retry-After 1..3600, español, código estable, sin Set-Cookie | Los tres ámbitos HTTP, `assertLimited`: estado, content-type, header, código, título y detalle exactos; snapshot OpenAPI frente a backend real |
| Contadores sobreviven 401/403/429 en transacción Spring | HTTP `burst…`, `unverifiedAndDisabledAccountsKeepResponsesAndCannotBypassQuotas`; lecturas JDBC posteriores a respuesta, sin rollback global de prueba |
| Éxito limpia sólo fallos de pareja | HTTP `successfulLoginClearsOnlyPairFailureStateAndPreservesGlobalCounters`, SQL `pair_window_and_success`; contador de cuenta permanece |
| Sin pérdidas por concurrencia | SQL `many_ips`, `success_race(False/True)`: cuenta exacta, fallo→éxito termina en 0; éxito→fallo termina en 1 |
| Orden de locks con sesiones existentes | `auth_lock_race('registration',False/True)` observa espera de lock de usuario; refresh en ambos órdenes demuestra solapamiento con RowExclusiveLock real de sesión, sin exigir espera entre sesiones diferentes |
| Limpieza acotada y sin inversión de locks | `bounded_cleanup`: 1.005 filas, primera llamada borra 1.000 y siguiente drena; `cleanup_skips_locked`: bloqueo observado, otra fila expirada se elimina en <1 s de statement_timeout y la bloqueada se elimina después; HTTP `maintenanceCommitsBoundedCleanupThroughSpringProxy` verifica confirmación |
| Privilegios de runtime estricto | `privileges` dentro del runner de runtime: pliego_app sin superuser/CREATEDB/CREATEROLE/BYPASSRLS, sin membresía de propietario ni CREATE en esquema; cinco APIs pair_begin/admit/pair_reserve/success/cleanup, 16 casos nativos y 15 HTTP completos; sin ACL PUBLIC |
| Confianza en proxy | HTTP `tomcatTrustsForwardedAddressFromConfiguredLoopbackProxy`; `tomcatIgnoresSpoofedForwardedAddressFromUntrustedPeer` usa conexión real con origen 127.0.0.2 y XFF falso |
| CORS y recuperación independiente | HTTP `corsExposesRetryAfterAndPasswordRecoveryDoesNotUseLoginBuckets`: expone header y encola RESET_PASSWORD mientras login está limitado; suites existentes prueban consumo/reset |
| Observabilidad redactada | HTTP `burst…` con captura: evento LIMITED y código; no correo, IP, sus hashes ni contraseña; trace_id generado por servidor |
| Upgrade aditivo y regresión | `login_attempt_upgrade_gate.py`: Flyway empaquetado 98→99, pedido/pago/usuario/sesión/outbox poblados, comparación de todas las tablas anteriores y refresh todavía usable; arranques de suites y runner prueban 0→99 |

Comandos desde la raíz salvo Maven (`backend`) y npm (`frontend`). Maven siempre usa `--offline --batch-mode --no-transfer-progress -Dmaven.repo.local=/tmp/pliego-nov01/m2`. Variables de conexión están en un archivo local de permisos 0600 fuera del repositorio; bases `pliego_ppa05_*`, cluster propio en 55435.

| Ejecución | Resultado observado |
| --- | --- |
| `env -u PLIEGO_TEST_DISPOSABLE_DB mvn <flags> verify` | 574 nodos reportados, 553 ejecutados, 21 omitidos, 0 fallos/errores; `serialization-fix/maven-plain-v2.log` |
| `PLIEGO_TEST_DISPOSABLE_DB=1 mvn <flags> verify` | 640 nodos reportados, 639 ejecutados, 1 omitido (R2 externo), 0 fallos/errores; continuación 71/71, login 15/15; `serialization-fix/maven-db-v2.log` y XML guardados |
| `python3 backend/src/test/postgres18/login_attempt_gate.py` | 16/16 casos en runner principal y 16/16 bajo runtime estricto; `serialization-fix/full-gates-v2.log` |
| `python3 backend/src/test/postgres18/login_attempt_upgrade_gate.py` | 1/1; 61 tablas preexistentes idénticas; `serialization-fix/upgrade-v2.log` |
| `bash backend/src/test/postgres18/run_ci_gates.sh` | exit 0; 114 gates principales (52 SQL + 62 Python), 10 estrictos (8 SQL + 2 Python); 99/99 Flyway, limpieza canónica dos veces y reinicio sin privilegios de propietario; `serialization-fix/full-gates-v2.log` |
| `mvn <flags> -Dtest=LoginAttemptPostgresIntegrationTest test` con DB | 15/15 también bajo pliego_app restringido; `serialization-fix/strict-java-tests.log` |
| Histórico de contrato original: `npm run api:types` | exit 0; sólo añade login 429 a generated.ts |
| Histórico de contrato original: `npm run typecheck` | exit 0; `frontend-tsc.log` |
| Histórico de contrato original: `npm test -- src/shared/api` | 19 archivos, 255/255 pruebas; `frontend-vitest.log` |

La ejecución completa del runner SQL/HTTP/concurrencia/runtime y la verificación de integridad final se detallan en el informe externo. CI ejecuta ambas clases Java con DB después de provisionar; el nuevo gate entra al runner principal y al lifecycle estricto, y el upgrade dispone de un paso propio. No se realizaron pruebas visuales, de carga de producción ni de servicios externos. Register queda fuera del alcance PPA-05.


Corrección de revisión — serialización NAT durante BCrypt (2026-11-02): IP/AC se confirman ahora en una transacción Spring corta independiente y un pool de una conexión, antes de BCrypt. AP conserva reserva/limpieza atómicas con el resultado y la sesión. Orden y cambio de durabilidad ante fallos de infraestructura: ADR 0053 actualizado. Pruebas K=8 con/sin X-Forwarded-For demuestran entrada simultánea y cargos visibles/IP-AC desbloqueados mediante observador NOWAIT con pool principal de ocho; el original falla con siete pendientes. Resultados finales y comandos de esta revisión: /tmp/pliego-audit/ppa05/REPORT.md. No se modificaron UI, tipos API ni specs Playwright en esta corrección.
