# Entregabilidad de correo — informe local 2026-11-01

Alcance: backend, V093, script de lectura y documentación. Sin commits, pushes,
deploys, acceso a producción, escrituras Mailtrap ni reenvíos reales. No se editó
frontend. Se conservaron los cambios previos del árbol y se comprobaron los hashes
originales de V088–V092; V001–V087 no se modificaron.

## Hallazgos precisos

| Punto | Evidencia y comportamiento |
|---|---|
| Alta | `backend/src/main/java/com/pliego/modules/identity/application/AuthService.java:50` registra con token de verificación en una transacción. `backend/src/main/resources/db/migration/V039__transactional_email.sql:75` devuelve PENDING_VERIFICATION. `email_verificado_en` es NULL para cuentas nuevas; las anteriores a V039 se marcaron verificadas (`:2`). |
| Login | `AuthService.java:67` rechaza UNVERIFIED tras validar contraseña, con EMAIL_NOT_VERIFIED. `V039__transactional_email.sql:89` proyecta ese estado y `:100` vuelve a comprobar verificación al crear la sesión. Un alta sin verificar no obtiene normalmente un JWT y no puede comprar por REST. |
| Consumo | `V039__transactional_email.sql:139` exige token vigente, no consumido y vinculado al email actual; `:153` establece la verificación. El token se invalida al cambiar email. |
| Cambio inmediato | `backend/src/main/java/com/pliego/modules/customer/application/CustomerService.java:61` reautentica, cambia email y después solicita verificación del nuevo en la misma transacción (`:69`). `V039__transactional_email.sql:164` borra verificación, tokens y revoca refresh; V093 conserva esas acciones. No invalida inmediatamente los JWT existentes. |
| Checkout tras cambio | `backend/src/main/java/com/pliego/foundation/security/SecurityConfiguration.java:92` autoriza por rol CUSTOMER. `backend/src/main/resources/db/migration/V011__create_internal_helpers.sql:40` comprueba actor/estado/rol, sin exigir verificación; checkout usa ese helper (`V072__automatic_academic_billing.sql:172`, `:464`). Un JWT emitido antes del cambio permite checkout hasta expirar: TTL 1800 segundos (`AuthService.java:27`). No se añadió un requisito nuevo de checkout. |
| VERIFY_EMAIL / RESET_PASSWORD | El destinatario se toma del `usuario.email_normalizado` vigente al encolar, bajo lock: `V039__transactional_email.sql:64` y `:72`. Reenvío y cambio usan la misma rutina. El cambio invalida acciones PENDING anteriores; no retargetea correos de negocio ya encolados. |
| ORDER_CONFIRMED / ORDER_STATUS / ORDER_CANCELLED | `backend/src/main/resources/db/migration/V061__transactional_order_lifecycle_emails.sql:152` encola desde el email actual del usuario asociado al cliente del pedido. Cada transición puede tomar un email distinto del que existía al comprar. Es un snapshot de outbox, no el destinatario postal ni `datos.customerEmail`. Los wrappers posteriores conservan esta inserción. |
| INVOICE_ISSUED | `backend/src/main/resources/db/migration/V085__activate_private_r2_invoice_storage.sql:112` encola al completar el PDF desde el email actual del usuario del pedido. No usa la identidad fiscal ni una dirección congelada al crear el pedido. |
| Destinatario efectivo | `backend/src/main/java/com/pliego/modules/notifications/gateway/JdbcMailOutboxGateway.java:15` lee `destinatario` de la fila reclamada; `application/MailOutboxWorker.java:36` lo pasa al transporte. No vuelve a resolver el email del perfil al enviar. |
| Recibo ya existente | `backend/src/main/java/com/pliego/modules/notifications/application/MailDeliveryReceipt.java:4` contiene solo providerMessageId validado (1–128 caracteres). `provider/MailtrapMailSender.java:42` exige success y exactamente un message_ids. V060 (`:3`, `:8`, `:27`) ya guarda el ID único por outbox. No se guarda el cuerpo de respuesta. El envío incluye `custom_variables.pliego_outbox_id`, pero el webhook correlaciona únicamente por message_id. |
| Worker antes de este cambio | `provider/MailtrapMailSender.java:37` interpreta HTTP 200 como aceptación; 429/5xx produce RETRY, otros HTTP FAILED; IO/interrupt o recibo inválido produce AMBIGUOUS_DELIVERY. `V039__transactional_email.sql:207` reclama con SKIP LOCKED, lease y límite de cinco intentos; `V060__persist_mail_provider_receipt.sql:22` completa con backoff. `V064__observable_mail_completion.sql:3` cerca completados obsoletos con UUID. SENT no significaba entrega, y no había consumidor de rebotes. |

La evidencia de producción aportada por el usuario es consistente con este flujo:
la aceptación de Mailtrap se guardó como SENT; el rechazo por supresión ocurrió
después. No se verificó ni consultó producción durante esta tarea.

## Implementado

Se reutiliza la persistencia del recibo existente, con cobertura Java/SQL/HTTP.
V093 añade inbox idempotente, proyección de eventos y bloqueo por destinatario.
Webhook autenticado por HMAC-SHA256 sobre bytes crudos, según la
[documentación oficial](https://docs.mailtrap.io/email-api-smtp/advanced/webhooks),
desactivado sin `PLIEGO_MAILTRAP_WEBHOOK_SECRET`. ACK solo tras commit; el
procesamiento posterior conserva eventos anteriores al recibo. No persiste SMTP,
direcciones del webhook, payloads ni credenciales.

Solo bounce permanente y reject/suspension por suppression bloquean. El estado
temporal/rechazo de dominio se registra sin invalidar la dirección. Se ordenan
eventos por fecha, prioridad e ID, con proyección independiente para el perfil
actual y para la dirección histórica. Entrega posterior limpia; cambio de email
limpia el indicador de cuenta. Los snapshots nuevos identifican su generación
para proteger eventos del mismo segundo y cambios A→B→A.

El preflight del worker usa `fn_mail_outbox_prepare_send`: no llama al proveedor
y deja HELD/EMAIL_UNDELIVERABLE cuando ya conoce el fallo. Nunca reencola FAILED
ni HELD. No retargetea snapshots ni elimina supresiones. El perfil añade
`emailDelivery: {status: OK|UNDELIVERABLE, since}`; since es el último fallo
permanente autoritativo, sin motivo SMTP para el cliente. Ver el
[amendment](../api-amendments/2026-11-01-email-delivery-status.md).

No se implementó email pendiente: contradice el cambio inmediato de ADR 0020 y
requiere decisiones sobre unicidad, reserva, recuperación y contratos de tokens.
La recomendación en [ADR 0048](../adr/0048-mailtrap-delivery-outcomes.md) es mantener
el email verificado, validar el nuevo y promoverlo atómicamente en un trabajo posterior.

El script `scripts/mailtrap-deliverability.py` hace solo GET, rechaza redirecciones,
usa User-Agent explícito, token exclusivamente desde PLIEGO_MAILTRAP_API_TOKEN y
salida permitida con hashes SHA-256. Pruebas con transporte falso exclusivamente.

## Archivos de esta tarea

- Backend nuevo, bajo `backend/src/main/java/com/pliego/modules/notifications/`:
  `api/MailtrapWebhookController.java`, `provider/MailtrapWebhook.java`,
  `application/{MailtrapWebhookProperties,MailProviderEvent,MailEventService,MailEventWorker}.java`,
  `gateway/{MailEventGateway,JdbcMailEventGateway}.java`.
- Backend modificado: notifications `application/{MailConfiguration,MailOutboxService,MailOutboxWorker}.java`,
  `gateway/{MailOutboxGateway,JdbcMailOutboxGateway}.java`; customer
  `application/{CustomerProfile,CustomerService}.java`,
  `gateway/{CustomerGateway,JdbcCustomerGateway}.java`,
  `api/{CustomerController,CustomerProfileResponse}.java`;
  `foundation/security/SecurityConfiguration.java` y `src/main/resources/application.yml`.
- Única migración nueva: `backend/src/main/resources/db/migration/V093__mail_delivery_outcomes.sql`.
- Pruebas Java nuevas: `MailtrapWebhookTest`, `MailtrapWebhookApiIntegrationTest`,
  `MailtrapWebhookDisabledIntegrationTest`; ampliadas `TransactionalMailTest` y
  `CustomerApiIntegrationTest`.
- PostgreSQL 18: nuevos `mail_deliverability_gate.sql`,
  `mail_deliverability_concurrency.py`, `mail_deliverability_http_gate.py`,
  `mail_deliverability_upgrade_gate.py`; ampliados `run_ci_gates.sh` y
  `run_runtime_privileges_ci_gate.sh` (V093 y gate bajo rol restringido).
- Scripts: `scripts/{mailtrap-deliverability.py,test_mailtrap_deliverability.py}`.
- Docs: ADR 0048 e índice, amendment citado, `docs/backend/transactional-email.md`,
  `docs/deployment/production-runbook.md`, plan
  `docs/superpowers/plans/2026-11-01-mail-deliverability.md` y este informe.

## Verificación

PostgreSQL 18.6 descartable en loopback, directorio `/tmp`; BD distintas para HTTP,
upgrade y privilegios. Credenciales ficticias; sin Docker ni servicios externos.

| Comprobación | Resultado / log íntegro |
|---|---|
| `cd backend && mvn -q test` | 492 pruebas, 0 fallos, 0 errores, 1 omitida: R2LiveSmokeTest (requiere servicio real). `/tmp/pliego-deliverability-mvn-test.log` |
| Package local | Correcto. `/tmp/pliego-deliverability-package.log` |
| Script de operaciones | 3 pruebas correctas, transporte falso. `/tmp/pliego-deliverability-script-tests.log` |
| SQL | mail_deliverability, customer_email_change, customer_profile_verification, transactional_email, mail_completion y email_action_return_context correctos. `/tmp/pliego-deliverability-sql-gates.log` |
| Concurrencia nueva | Ocho replays simultáneos, proyección concurrente y rollback correctos. `/tmp/pliego-deliverability-concurrency.log` |
| Concurrencia existente | Claims y cambio de email frente a reset correctos. `/tmp/pliego-deliverability-existing-concurrency.log` |
| HTTP nuevo | Firma/replay/conflicto → JDBC → proyección → perfil y worker HELD correctos; ningún envío al destinatario bloqueado, solo stub. `/tmp/pliego-deliverability-http.log` |
| Upgrade V092→V093 | Correcto: recibo/destinatario/payload histórico conservados y recibo legado correlacionado. `/tmp/pliego-deliverability-upgrade.log` |
| Privilegios | Ciclo de migración/limpieza repetida/reinicio restringido y nuevo gate como pliego_app correctos. `/tmp/pliego-deliverability-runtime-privileges.log` |
| Gate HTTP existente | Falla en `backend/src/test/postgres18/transactional_email_http_gate.py:194`: espera asunto `Pedido N.º <id>: en preparación`; las plantillas del trabajo previo ya usan referencia pública (`MailTemplates.java:149`). El diff inicial confirma que el cambio de asunto precedía esta tarea. No se modificó esa expectativa ni la plantilla. El gate se detiene allí, por lo que sus pasos posteriores no se ejecutaron. `/tmp/pliego-deliverability-existing-http.log` |

`git diff --check` y sintaxis de runners correctos. Los fallos nuevos de las fases
RED se corrigieron; la revisión independiente final no encontró defectos importantes.
No se ejecutó el runner completo de todos los módulos: se ejecutaron los gates
pertinentes anteriores. Los nuevos gates HTTP/upgrade están documentados para
ejecución independiente; SQL y concurrencia se añadieron al runner existente.

## Operación pendiente y autorización

El [runbook](../deployment/production-runbook.md#mailtrap-webhook-activation-and-deliverability)
describe activación, nombre de configuración y consultas agregadas sin identidades.
Requieren autorización separada: desplegar V093/backend, configurar y activar el
webhook en Mailtrap, y retirar una supresión solo después de corregir/verificar el
email. Cualquier requeue/reenvío necesita revisión y autorización; no hay endpoint
de reenvío en el repositorio y no se añadió uno.

La activación no importa rebotes históricos. Los SENT anteriores seguirán sin
resultado conocido salvo eventos recibidos/correlacionados después. La proyección
tiene una ventana de cinco segundos más procesamiento y no puede retirar un envío
HTTP ya iniciado. Ninguna acción operativa pendiente se realizó.
