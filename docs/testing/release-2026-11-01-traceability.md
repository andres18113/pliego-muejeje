# Trazabilidad de release — 2026-11-01

Alcance local: backend Java 25, PostgreSQL 18.6 descartable en loopback, Flyway y
generación de contrato React. Producción V087/release 4100391 es información del
usuario; no se consultó. Sin commits, pushes, deploys, Docker, Mailtrap API ni
correo real. Los transportes HTTP son stubs loopback. Se preservaron V001–V093,
las portadas JPEG, logo y demás cambios previos; mis cambios frontend se limitan a export/tipos.

Contrato: [amendment del cambio pendiente](../api-amendments/2026-11-01-pending-email-change.md),
[ADR 0049](../adr/0049-pending-email-change.md), [entregabilidad](../api-amendments/2026-11-01-email-delivery-status.md).

## Matriz de requisitos a pruebas

| Requisito | Evidencia automatizada | Responsable/resultado |
|---|---|---|
| PUT reautentica; 400 de contraseña/validación y 409 P1101 previos | CustomerApiIntegrationTest; pending_email_change_http_gate.py | Backend, pasa |
| PUT 202 exacto con email actual y pendingEmail solo address/expiresAt | CustomerApiIntegrationTest; pending_email_change_http_gate.py | Backend, pasa |
| Mismo correo normalizado: 400 EMAIL_CHANGE_SAME_ADDRESS y mensaje exacto | pending_email_change_gate.sql; CustomerApiIntegrationTest; HTTP | Backend, pasa |
| Normalización existente y unicidad al solicitar, sin reserva | pending_email_change_gate.sql; HTTP uppercase address | Backend, pasa |
| Solicitud conserva login, verificación y todos los refresh | SQL; HTTP login viejo/nuevo, fecha de verificación y sesiones | Backend, pasa |
| Pedidos y facturas durante pendiente siguen al correo actual | HTTP checkout, PDF completado, outbox ORDER_CONFIRMED/INVOICE_ISSUED y stub | Backend, pasa |
| Reemplazo versionado invalida confirmación y cancelación antiguas | SQL; HTTP; pending_email_change_concurrency.py | Backend, pasa |
| GET pendingEmail null o address/expiresAt/delivery; vencido null | SQL; CustomerApiIntegrationTest; HTTP | Backend, pasa |
| Confirmación 24 h; token inválido/usado/vencido/sustituido/cancelado distinguible | SQL; CustomerApiIntegrationTest; HTTP | Backend, pasa |
| Reenvío autenticado 202; rota confirmación, conserva cancelación/vencimiento | SQL; HTTP; EmailChangeServiceTest | Backend, pasa |
| Reenvío sin pendiente/vencido:404; cooldown 1 min y 5/h:429 estable | SQL (incluye sexto reenvío); CustomerApiIntegrationTest; HTTP | Backend, pasa |
| Solicitudes 5/h por usuario; sexta 429 estable sin cambiar pendiente | SQL; HTTP; CustomerApiIntegrationTest | Backend, pasa |
| DELETE autenticado 204 idempotente; invalida credenciales | SQL; CustomerApiIntegrationTest; HTTP | Backend, pasa |
| Confirmar/cancelar públicos, sin JWT y sin revelar existencia de cuenta | CustomerApiIntegrationTest; EmailChangeServiceTest; HTTP | Backend, pasa |
| Confirmar promueve atómicamente, verifica y limpia indicador de cuenta | SQL; HTTP con cuenta actual UNDELIVERABLE | Backend, pasa |
| Confirmar revoca todos los refresh; access JWT conserva TTL vigente | SQL/HTTP verifican refresh revocados; contrato documenta TTL 30 min existente | Backend, pasa |
| Dirección tomada entretanto:409 P1101 y rollback de consumo/sesiones/avisos | SQL; HTTP; carrera real de índice único | Backend, pasa |
| Doble confirmación: un ganador, P1125 y exactamente un aviso final | pending_email_change_concurrency.py | Backend, pasa |
| Confirmación frente a cancelación, ambos órdenes de commit | pending_email_change_concurrency.py | Backend, pasa |
| Cancelación repetida éxito; tras confirmar410 EMAIL_CHANGE_ALREADY_CONFIRMED/Ayuda | SQL; HTTP; CustomerApiIntegrationTest | Backend, pasa |
| Propósitos HMAC separados, credencial no persistida/logueada, comparación constante | EmailChangeMailTest; EmailChangeServiceTest; tablas guardan hash/nonce; DTO redacted | Backend, pasa |
| Login obsoleto no crea refresh después de confirmar | AuthIdentityConsistencyTest; JdbcIdentitySessionGatewayTest; pending_email_change_security_gate.sql/concurrency.py | Backend, pasa |
| Recuperar contraseña cancela pendiente; ADMIN conserva recuperación previa | pending_email_change_security_gate.sql; security_concurrency.py (reset/confirm ambos órdenes) | Backend, pasa |
| EMAIL_CHANGE_CONFIRM texto exacto, sin correo anterior, fragmento correcto | EmailChangeMailTest; HTTP stub; TransactionalEmailPreviewsTest | Backend, pasa |
| EMAIL_CHANGE_REQUESTED destinatario actual, máscara y cancelación independiente | EmailChangeMailTest; SQL; HTTP stub/previews | Backend, pasa |
| EMAIL_CHANGED destinatario anterior y /ayuda, sin reset-password | EmailChangeMailTest; SQL; HTTP stub/previews | Backend, pasa |
| MailLayout y escape de contenido en los tres avisos | EmailChangeMailTest; TransactionalMailTest; previews | Backend, pasa |
| Hard bounce/suppression confirmación solo a pendiente; no cuenta/bloqueo global | pending_email_change_gate.sql; pending_email_change_http_gate.py | Backend, pasa |
| Eventos atrasados/reemplazados no contaminan sucesor ni cuenta promovida | SQL; HTTP; mail_deliverability_gate.sql | Backend, pasa |
| Avisos a correo actual/anterior respetan HELD; nunca requeue FAILED/HELD | SQL preflight; HTTP avisos HELD y orden retenida tras confirmación | Backend, pasa |
| Claim/preflight cercan tokens ya reclamados, vencidos o sustituidos | pending_email_change_gate.sql; SQL de entregabilidad existente | Backend, pasa |
| SENT conserva aceptación; recibo correlacionado, eventos antes de recibo | mail_deliverability_gate.sql/http_gate.py/concurrency.py; TransactionalMailTest | Backend, pasa |
| Orden temporal/empates, suppression vs fallo temporal, A→B→A | mail_deliverability_gate.sql; MailtrapWebhookTest | Backend, pasa |
| Firma ausente/malformada/incorrecta/secreto equivocado/cuerpo alterado:401 | MailtrapWebhookTest; MailtrapWebhookApiIntegrationTest; probe local webhook_security_gate.py | Backend, pasa |
| Sin secreto:404; recepción con envíos apagados | MailtrapWebhookDisabledIntegrationTest; probe local HTTP/JDBC | Backend, pasa |
| Replay event_id idempotente; conflicto409 y rollback completo | API integration; mail_deliverability SQL/concurrency/HTTP; probe HTTP/JDBC | Backend, pasa |
| Lote500 persistido/ACK; JSONL rechazado; bulk ignorado | MailtrapWebhookApiIntegrationTest; probe local HTTP/JDBC | Backend, pasa |
| Portadas snapshot permitido en todos los correos de pedido; históricos intactos | order_email_covers_gate.sql; EmailCoverMappingTest; upgrade fixture V087 | Backend, pasa |
| JPEG baseline RGB proporcional y metadata limpia; mapa/publicación optativa | scripts/test_email_covers.py (4); scripts/test_upload_r2_covers.py (12) offline | Backend, pasa |
| Mapeo JPEG conserva fallback y rechaza URLs privadas/firmadas/traversal | EmailCoverMappingTest; TransactionalMailTest; order_email_covers_gate.sql | Backend, pasa |
| Logo email PNG válido/inalterado, ruta pública en HTML, alt y dimensiones | Pillow verify local 376×112 RGBA; TransactionalMailTest; EmailChangeMailTest | Backend, pasa; disponibilidad pública pendiente de despliegue autorizado |
| OpenAPI export vivo desde BD95 y tipos regenerados sin edición manual | CustomerApiIntegrationTest; npm run api:types; esquema anyOf objeto/null | Backend, pasa (export vivo V095 y unión TS verificada) |
| Upgrade exacto V087 con datos realistas a V095 | release_pending_upgrade_gate.py + evidencia privada v087-evidence.json | Backend, pasa |
| Instalación limpia V001→V095, todos los gates pendientes y regresiones | run_ci_gates.sh hasta planes; planes/ACL completados aparte tras registrar nuevas consultas; HTTP standalone + upgrades heredados | Backend, pasa |
| Planes de las lecturas reales y comandos solo planificados, sin JIT | customer_query_plan_gate.py:63/63; nuevas consultas registradas y worker de eventos fuera del presupuesto de lecturas cliente | Backend, pasa |
| ACL runtime sin owner/CREATE; geo solo lectura; comandos nuevos operativos | run_runtime_privileges_ci_gate.sh; cleanup runbook dos veces; gates como pliego_app | Backend, pasa |
| UI solicitud, pendiente, entrega, reenvío, cancelación y errores | AccountPage.test.tsx: solicitud con contraseña (400/409/202) que conserva el correo en uso y su verificación; chip «Por confirmar»; reenvío 202 y 429 con texto del servidor; cancelación 204 que retira el estado; pendiente `UNDELIVERABLE` solo con Editar/cancelar; `emailDelivery` OK/ausente/UNDELIVERABLE. ProfileDraft.test.tsx y ProfileFeedback.test.tsx (borrador, aviso y divulgación de seguridad) | Claude, pasa |
| UI /confirmar-correo, /cancelar-cambio-correo, Ayuda y login posterior | EmailChangePages.test.tsx: token solo del fragmento y retirado de la URL; una confirmación bajo Strict Mode; éxito que cierra la sesión local y lleva a Iniciar sesión; enlace vencido (410) con texto del servidor; sin token o en query nunca se envía; cancelar exige pulsar (un escáner no cancela); éxito lleva a Cambiar contraseña; `EMAIL_CHANGE_ALREADY_CONFIRMED` (410) lleva a Ayuda | Claude, pasa |
| UI accesibilidad/responsive y regresión visual | tests/e2e/email-change.spec.ts: axe WCAG 2.2 AA sin violaciones y sin desbordamiento horizontal a 375 y 1280 px en perfil pendiente, pendiente no entregable, confirmación y cancelación (antes/después). Capturas revisadas: chip sobre la frase en teléfono, dirección completa sin cortes. Correos EMAIL_CHANGE_* revisados en claro/oscuro: enlaces con `#token`, dirección nueva enmascarada, sin el correo anterior; el enlace de respaldo ya no parte palabras (MailLayout) | Claude, pasa |
| Logo de correo publicado por el frontend que las plantillas nombran; logo previo conservado | emailBrandAssets.test.ts (falla si falta el archivo: verificado moviéndolo) ; runbook: comprobación `image/png` tras activar | Claude, pasa |
| Estabilidad Playwright: portadas tardías y comparación oscuro/claro | covers.ts (espera que vuelve eager las portadas que aparecen después; diagnóstico adjunto); light-appearance.ts (claro–oscuro–claro, reintento acotado); 127/127 bajo carga | Claude, pasa |
| Estabilidad Playwright: menú de cuenta tras iniciar sesión | catalog-header.spec.ts: `signIn` espera el foco de ruta en el h1 de destino; reproducido 1/60 y 1/240 antes, 240/240 después bajo 8–10 workers | Claude, pasa |

## Evidencia y ejecución

Logs íntegros bajo `/tmp`; no se incorporan credenciales ni identidades reales.
Las vistas están en `/tmp/pliego-email-previews/` (23 HTML + 23 TXT). El fixture
V087 contiene clientes verificados y sin verificar, refresh, pedidos a domicilio
y retiro histórico, factura emitida con PDF y outbox PENDING/FAILED/SENT con recibo.
El snapshot exige identidad exacta de destinatario/payload/recibo/datos históricos;
solo excluye columnas aditivas previstas.

La revisión independiente encontró dos carreras de recuperación (login previo a
promoción y reset frente a enlace pendiente), corregidas con V095 y sus gates.
El contrato REST conserva los endpoints/estados solicitados. Las decisiones de
reenvío (sin extender fecha) y recuperación están documentadas en el amendment.

Los primeros intentos del runner amplio revelaron configuración de fixture:
owner CI debe llamarse `pliego`, cookie de sesión debe conservar Secure. Se
corrige el entorno descartable; no se cambian expectativas del producto.
Otro intento del runner amplio agotó el plazo de facturas por backlog del fixture
con el worker por defecto; se repite en otra BD con parámetros de polling/lote de
prueba rápidos, sin cambiar timeouts ni lógica de producto. CI ya usa un polling
rápido para este runner.
La regresión del nullable de OpenAPI fue RED→GREEN y no se parchean tipos a mano.
Pillow/NumPy se instalaron solo en un venv de `/tmp` para los checks de imágenes.

## Prerrequisitos de despliegue (solo nombres de configuración)

`PLIEGO_MAIL_ENABLED`, `PLIEGO_MAILTRAP_API_TOKEN`, `PLIEGO_MAILTRAP_WEBHOOK_SECRET`,
`PLIEGO_MAIL_FROM_ADDRESS`, `PLIEGO_MAIL_FROM_NAME`, `PLIEGO_APP_PUBLIC_URL`,
`PLIEGO_MAIL_TOKEN_SECRET`, `PLIEGO_JWT_SECRET`, `PLIEGO_MAIL_ENDPOINT`,
`PLIEGO_MAIL_POLL_INTERVAL`, `PLIEGO_MAIL_BATCH_SIZE`, `PLIEGO_MAIL_ALLOW_LOCAL_HTTP`.

Migración, activación del webhook y cualquier reconciliación/requeue operativa
quedan fuera de este trabajo local y requieren la autorización del usuario.
Las 494 portadas JPEG `covers/editions/email-v1/` ya están publicadas (subida autorizada, solo adición) y responden
`200 image/jpeg` públicamente; el logo de correo se publica con el `dist` del frontend y se comprueba como `image/png`
tras activar el frontend (runbook, sección 8). No se solicita ni ejecuta ninguna de ellas aquí.

## Archivos de esta implementación

- Migraciones nuevas: `backend/src/main/resources/db/migration/V094__pending_email_change.sql`
  y `V095__email_change_recovery_and_session_fencing.sql`.
- Foundation: `database/DatabaseError.java`, `security/{SecurityConfiguration,InvalidEmailChangeTokenException}.java`,
  `web/ApiExceptionHandler.java`, `openapi/OpenApiConfiguration.java`.
- Customer: `api/{CustomerController,CustomerProfileResponse,EmailChangeRequest,EmailChangeResponse}.java`,
  `application/{CustomerService,CustomerProfile}.java`, `gateway/{CustomerGateway,JdbcCustomerGateway}.java`.
- Identity: `api/EmailChangeController.java`,
  `application/{AuthService,EmailActionTokens,EmailChangeService,EmailChangeResult,PendingEmailChange}.java`,
  `gateway/{IdentityGateway,JdbcIdentityGateway,EmailChangeGateway,JdbcEmailChangeGateway}.java`.
- Notifications: `application/MailTemplates.java`. Se conserva MailLayout y el mapa JPEG existente.
- Java tests: `CustomerApiIntegrationTest`, `OpenApiCoverageTest`, `EmailChangeServiceTest`,
  `EmailChangeDatabaseErrorTest`, `AuthIdentityConsistencyTest`, `JdbcIdentitySessionGatewayTest`,
  `EmailChangeMailTest`, `TransactionalEmailPreviewsTest`,
  `MailtrapWebhookTest`, `MailtrapWebhookApiIntegrationTest`; también se verificó la regresión de webhook deshabilitado.
- PostgreSQL: nuevos `pending_email_change_{gate.sql,concurrency.py,http_gate.py,security_gate.sql,security_concurrency.py}`
  y `release_pending_upgrade_gate.py`; actualizados `mail_deliverability_http_gate.py`,
  `run_ci_gates.sh`, `run_runtime_privileges_ci_gate.sh` y `customer_query_plan_gate.py`.
- Documentación: ADR 0049 e índice; amendment de cambio pendiente; guía transactional-email;
  plan de implementación y esta matriz.
- Mis únicos cambios frontend son `frontend/openapi/openapi.json` y
  `frontend/src/shared/api/generated.ts`. Otros cambios concurrentes de UI de Claude se conservaron.

## Resultados finales y logs íntegros

| Ejecución | Resultado | Log |
|---|---|---|
| `cd backend && mvn -q test` | 551 pruebas, 0 fallos, 0 errores, 1 omitida (`R2LiveSmokeTest`, servicio real fuera de alcance) | `/tmp/pliego-release-mvn-test.log` |
| Package final | Correcto; JAR congelado coincide byte a byte con V094/V095 de source | `/tmp/pliego-release-package.log` |
| SQL/concurrencia/HTTP amplios | Todos hasta autenticación y facturas correctos; runner se detuvo en registro incompleto de consultas nuevas. Se corrigió el gate y se completaron planes y ACL por separado; no se presenta ese intento como un exit0 del runner completo | `/tmp/pliego-release-postgres18-full.log` |
| Planes tras corregir registro | 63/63, 0 fallos, sin JIT; sin ejecutar comandos de identidad | `/tmp/pliego-release-query-plans.log` |
| ACL de runtime | V001→V095 como app con membresía temporal; cleanup canónico dos veces, revocación, reinicio y gates estrictos como app correctos | `/tmp/pliego-release-runtime-privileges.log` |
| Upgrade directo V087→V095 | 95 migraciones; verificados/no verificados, pedidos, retiro previo, factura/PDF, outbox/destinatarios/recibo preservados | `/tmp/pliego-release-20261101/release-upgrade-final95.log` |
| Seguridad SQL y carreras | Stale login, reset/confirm ambos órdenes, revocación y recuperación ADMIN correctos | `/tmp/pliego-release-20261101/email-security-{sql,concurrency}-final95.log` |
| Webhook HTTP/JDBC completo | Firmas, 404 deshabilitado, replay/conflicto,500,JSONL,bulk correctos | `/tmp/pliego-release-20261101/webhook-security-final95.log` |
| Entregabilidad HTTP/JDBC | Correcto; mail stub únicamente | `/tmp/pliego-release-20261101/mail-deliverability-http-final95.log` |
| Correo transaccional HTTP | Correcto, incluidos reset/reinicio/checkout/lifecycle/referencia pública | `/tmp/pliego-release-20261101/transactional-email-http-final95.log` |
| Cambio pendiente HTTP | Todos los escenarios del contrato correctos, incluidos recipients de pedido/factura | `/tmp/pliego-release-20261101/pending-email-http-final95.log` |
| Upgrades heredados de referencias/entregabilidad | Correctos con JAR basal congelado y BD separadas; además upgrade final directo87→95 | `/tmp/pliego-release-20261101/{order-reference,deliverability}-upgrade.log` |
| Export OpenAPI vivo y generación | Backend con95; `pendingEmail: PendingEmail \| null`; solo dos archivos generados | `/tmp/pliego-release-openapi-live.json`, `/tmp/pliego-release-api-types.log` |
| JPEG y uploader offline | 4 + 12 pruebas correctas | `/tmp/pliego-release-email-cover-tests.log`, `/tmp/pliego-release-cover-upload-tests.log` |
| Logo PNG local | Válido376×112 RGBA; bytes originales conservados | `/tmp/pliego-release-email-logo.log` |

La lectura de perfil nueva y los comandos del nuevo gateway no estaban registrados
en el gate de planes, que falla de forma cerrada ante un SELECT nuevo. Se añadieron
bindings revisados; los comandos de identidad siguen con EXPLAIN sin ANALYZE, y
el worker de eventos de correo se excluye del presupuesto de lecturas del cliente.
Ese fallo y el timeout previo por backlog quedan conservados en los logs; las
comprobaciones afectadas pasaron tras corregir soporte/configuración del fixture.

Los hashes iniciales/finales confirman V001–V093 intactas. Las verificaciones no
habilitan R2 real ni hacen HEAD/GET al CDN: logo y JPEG se validaron localmente.
La UI pendiente y su publicación pertenecen a Claude; desplegar, activar webhook,
publicar assets o reenviar correos necesita una instrucción posterior del usuario.

## Verificación final integrada (Claude, 2026-11-01)

| Suite | Resultado |
|---|---|
| Backend `mvn test` (incluye el ajuste de MailLayout: el enlace de respaldo ya no parte palabras) | 551 pruebas, 0 fallos, 0 errores, 1 omitida (`R2LiveSmokeTest`, requiere R2 real) |
| Frontend Vitest | 102 archivos, 1 244 pruebas, todas pasan; build de producción correcto |
| Playwright completo con `PLIEGO_VISUAL_LIVE=1` | 420 pasan, 0 fallan; 22 omitidas por gates que exigen backend/fixtures desechables (`PLIEGO_E2E_LIVE`, registro, biblioteca, orden del catálogo) |
| Correcciones de UI encontradas por la regresión | `useAvailabilityFocus` revela el aviso de stock enfocado si quedó fuera de pantalla (WCAG 2.4.11); la ruta «Mi cuenta › Pedidos» del checkout se ajusta a 200 % de texto en 320 px |
| Expectativas obsoletas actualizadas (sin debilitar) | título y encabezado del área de Administración (ADR 0047); escenario oscuro de `stockstatus-production` convertido a apariencia única (ignora preferencia guardada y del sistema); textos del editor de correo; `digital-single-copy` espera a que la edición se renderice antes de desplazarse |


## Data reset

Procedimiento local para V095/53e062a: [clasificación completa de 58 tablas,
auditorías, secuencias/R2, receta operativa y requisito → evidencia](data-reset.md).
El harness restaura un custom dump en PostgreSQL 18 nuevo, prueba rollback,
fallo intermedio, commit, repetición, constraints/ACL y el flujo HTTP real con
factura DATABASE y propiedad digital. No se cambió Java ni se accedió a producción.
La garantía de no reutilización histórica de referencias aleatorias y números
manuales queda bloqueada en V095; el informe explica la decisión necesaria antes
de cualquier COMMIT de producción.
