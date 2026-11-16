# Referencias públicas, retiro verificado y contexto de correcciones

Migraciones: **V088** (`public_order_references_and_correction_context`) y **V089** (`verified_store_pickup`). Arquitectura: [ADR-0047](../adr/0047-public-order-references-and-verified-pickup.md). Contrato completo: [enmienda REST](../api-amendments/2026-11-01-public-order-references-and-verified-pickup.md).

## Resultado y formas JSON

`orderId` sigue siendo string y conserva su valor. Listas/detalles del cliente y administrador, checkout e intento `CREATED` añaden `orderReference: "PL-0123-4567"`. La resolución conserva `{state, order}`; `order` es null en `PENDING`/`NOT_CREATED`. Los recibos repetidos proyectan la misma referencia. Se conservan todos los campos anteriores.

La proyección de retiro del cliente mantiene `{method:"STORE_PICKUP",pickup:{location,estimatedAt,readyAt,preparationMinutes,pickupCode},state,collectedAt}`. `state` admite `PENDING|READY|COLLECTED|CANCELLED`; la confirmación de checkout conserva su snapshot. El detalle administrativo omite el valor del código. Los retiros históricos sin ventana de cancelación siguen siendo elegibles al alcanzar su hora; no se inventa historial de finalización.

`PickupView`:

```json
{
  "orderId": "123", "orderReference": "PL-0123-4567",
  "state": "COLLECTED", "orderState": "DELIVERED", "paymentState": "APPROVED",
  "createdAt": "2026-11-01T10:00:00Z", "readyAt": "2026-11-01T10:25:00Z",
  "collectedAt": "2026-11-01T11:00:00Z",
  "collectedBy": {"userId":"5","email":"staff@example.invalid"}, "identityVerified": true,
  "location": {"id":"1","name":"PUCE · Sede matriz","address":"Dirección","city":"Quito"},
  "customer": {"customerId":"42","name":"Ana Pérez","email":"ana@example.invalid","identityType":"EC_CEDULA","identityNumber":"1710034065"},
  "items": [{"orderItemId":"321","title":"Libro","format":"PAPERBACK","quantity":2}],
  "unitCount": 2, "total": "18.00"
}
```

No contiene código. `collectedAt`, `collectedBy`, `identityVerified` son null antes de retirar; los dos nuevos campos de auditoría permanecen null en retiros históricos. `identityType`/`identityNumber` pueden ser null. Solo incluye unidades impresas. La página es `{items: PickupView[], page: number, pageSize: number, totalCount: string}`.

Cada elemento de la cola de correcciones añade `{customerHasBilledInvoices:boolean, decidedByEmail:string|null}`. La respuesta de decisión no cambia; acepta **APPROVE** o **REJECT**, y REJECT exige `decisionReason` no vacío.

## Endpoints

- Nuevos ADMIN: `POST /api/v1/admin/pickups/lookup` con `{code}`; `GET /api/v1/admin/pickups?state=&q=&page=0&pageSize=20` (máximo 50).
- Modificado ADMIN: `POST /api/v1/admin/orders/{orderId}/pickup/collect` con `{pickupCode,identityVerified:true}` → **200 PickupView**.
- `GET /api/v1/admin/orders` añade `q` para referencia normalizada y búsqueda de cliente; sus filtros anteriores continúan vigentes.
- Añaden referencia `POST /api/v1/checkout`, `POST /api/v1/checkout/attempts/{key}/resolve`, `GET /api/v1/orders`, `GET /api/v1/orders/{orderId}` y `GET /api/v1/admin/orders/{orderId}`, además de la lista administrativa anterior.
- `GET /api/v1/admin/billing-identity-corrections` añade contexto; `POST /api/v1/admin/billing-identity-corrections/{requestId}/decision` conserva el contrato de decisión.

## Errores nuevos

| SQLSTATE / dominio | HTTP | Título | Detalle |
| --- | --- | --- | --- |
| P5016 / PICKUP_NOT_FOUND | 404 | Retiro no encontrado | No encontramos un retiro con ese código. |
| P5017 / PICKUP_ALREADY_COLLECTED | 409 | Pedido ya retirado | Este pedido ya fue retirado. |
| P5018 / PICKUP_NOT_READY | 409 | Pedido aún no disponible para retiro | Este pedido aún no está listo para retiro. |

El campo REST `code` usa SQLSTATE. P5013/PICKUP_CODE_INVALID sigue en 400; P5002/ORDER_INVALID_TRANSITION sigue en 409. No se reutilizan P5014/P5015 (geografía). Verificación ausente/null/false devuelve 400 VALIDATION_ERROR, con los mensajes «Debes confirmar la verificación de identidad.» / «Debes verificar la identidad del cliente antes de confirmar el retiro.».

## API compartido

- `orders.ts`: esquemas existentes de checkout/lista/detalle añaden `orderReference: z.string().nullish()`; el esquema de checkout también cubre replay. Los tipos existentes `CheckoutResult`, `OrderSummary`, `OrderDetail` admiten string/null/ausencia de referencia.
- `pickup.ts`: `pickupStateSchema`, `PickupState`.
- `adminPickups.ts`: funciones `lookupAdminPickup`, `listAdminPickups`, `collectAdminPickup`; esquemas `adminPickupViewSchema`, `adminPickupPageSchema`, `adminPickupSearchSchema`, `adminPickupLookupRequestSchema`, `adminPickupCollectRequestSchema`; tipos `AdminPickupView`, `AdminPickupPage`, `AdminPickupSearch`, `AdminPickupLookupRequest`, `AdminPickupCollectRequest`.
- `adminBillingIdentityCorrections.ts`: funciones `listAdminBillingIdentityCorrections`, `decideAdminBillingIdentityCorrection`; esquemas `adminBillingIdentityCorrectionStatusSchema`, `adminBillingIdentityCorrectionSchema`, `adminBillingIdentityCorrectionPageSchema`, `adminBillingIdentityCorrectionSearchSchema`, `adminBillingIdentityCorrectionDecisionRequestSchema`, `adminBillingIdentityCorrectionDecisionSchema`; tipos `AdminBillingIdentityCorrectionStatus`, `AdminBillingIdentityCorrection`, `AdminBillingIdentityCorrectionPage`, `AdminBillingIdentityCorrectionSearch`, `AdminBillingIdentityCorrectionDecisionRequest`, `AdminBillingIdentityCorrectionDecision`.

OpenAPI se actualizó desde el backend local preservando las enmiendas documentales y nombres existentes ajenos a este cambio. Se regeneró `generated.ts`; los modelos de retiro tienen nombres distintos para conservar los campos del detalle administrativo previo.

## Verificación

- `cd backend && mvn -o -Dmaven.repo.local=/tmp/pliego-task/m2 --batch-mode --no-transfer-progress verify`: **464 pruebas: 463 aprobadas, 0 fallos/errores, 1 omitida** (`R2LiveSmokeTest`, requiere R2 real).
- Flyway sobre una base PostgreSQL 18.6 vacía: **89/89 migraciones**, validación y arranque correctos.
- `python3 backend/src/test/postgres18/order_reference_upgrade_gate.py` en otra base desechable: **aprobado**, actualización V087→V089. Compara pedidos, facturas, líneas, archivos/metadatos/bytes, historial, outbox y recibos anteriores; verifica códigos históricos, backfill único y replay.
- `python3 backend/src/test/postgres18/customer_query_plan_gate.py --output …`: **54/54 consultas**, 0 fallos, sin JIT.
- `bash backend/src/test/postgres18/run_runtime_privileges_ci_gate.sh`: **aprobado**; migración como pliego_app, limpieza canónica aplicada dos veces, reinicio restringido, gate ACL y comportamiento completo de retiros con membresía de propietario retirada.
- `psql … -f backend/src/test/postgres18/billing_runtime_privileges_gate.sql`: **aprobado**, rol temporal sin privilegios elevados.
- `cd frontend && npm run api:types`: **aprobado**.
- `cd frontend && npx vitest run src/shared`: **395/395 pruebas, 26 archivos**, 0 fallos (41 nuevas en tres archivos).
- `cd frontend && npx tsc --noEmit -p tsconfig.json`: **exit 2**, 17 errores en features ajenos al alcance; **0 errores de shared/api**.
- `git diff --check` en los archivos de esta tarea: **aprobado**.

- `bash backend/src/test/postgres18/run_ci_gates.sh`: **aprobado, exit 0** en base vacía con el entorno local equivalente a CI: 46 gates SQL, 20 DB/concurrencia, 28 HTTP, 2 de autenticación, 54/54 planes y ciclo ACL restringido; **0 fallos**. Se habilitó el worker académico con almacenamiento local DATABASE, sin R2 ni correo externo. Los intentos iniciales detectaron configuración local distinta de CI y entradas nuevas ausentes del registro del gate de planes; se corrigieron y la ejecución completa final pasó.

Las regresiones incluyen generación/normalización, referencias con dígitos 0/1 en todos los correos, correo de factura, orden real de la lista con WITH ORDINALITY, preservación histórica, transiciones temporales y legado sin ventana, auditoría inmutable, colección simultánea exactamente una vez, aislamiento de clientes, permisos ADMIN y código ausente en vistas de personal.

La comprobación TypeScript no puede pasar sin modificar `frontend/src/features/**`, expresamente excluido. Los 17 errores actuales proceden de `adminQueries` ausente en AdminArea/AdminCorrectionsPage/AdminPickupsPage y sus tipos implícitos, más variables `orderReference`/`orderRef` ausentes en InvoiceDocumentPage/OrdersPage. Esos archivos no fueron editados por esta tarea; se observaron cambios concurrentes de interfaz y se conservaron. No se ejecutó R2 real ni pruebas de navegador de la interfaz.

No se hicieron commits, push, despliegues ni accesos a producción/VPS. Los archivos sucios protegidos `.agents/skills/pliego-deploy/SKILL.md`, runbook y ADR0038/0046 conservaron sus bytes iniciales. Se verificó también que el contenido previo de backend/README.md se conserva íntegro. V001–V087 permanecen intactas.

## Archivos modificados por esta tarea

- `.github/workflows/ci.yml`
- `backend/README.md`
- `backend/src/main/java/com/pliego/foundation/database/DatabaseError.java`
- `backend/src/main/java/com/pliego/foundation/web/ApiExceptionHandler.java`
- `backend/src/main/java/com/pliego/modules/billing/application/AcademicInvoicePdf.java`
- `backend/src/main/java/com/pliego/modules/customer/api/AdminBillingIdentityCorrectionResponses.java`
- `backend/src/main/java/com/pliego/modules/customer/application/AdminBillingIdentityCorrection.java`
- `backend/src/main/java/com/pliego/modules/customer/gateway/JdbcBillingIdentityCorrectionGateway.java`
- `backend/src/main/java/com/pliego/modules/notifications/application/MailTemplates.java`
- `backend/src/main/java/com/pliego/modules/sales/api/AdminOrderController.java`
- `backend/src/main/java/com/pliego/modules/sales/api/AdminOrderResponses.java`
- `backend/src/main/java/com/pliego/modules/sales/api/AdminPickupController.java`
- `backend/src/main/java/com/pliego/modules/sales/api/AdminPickupResponses.java`
- `backend/src/main/java/com/pliego/modules/sales/api/CheckoutController.java`
- `backend/src/main/java/com/pliego/modules/sales/api/CheckoutResponse.java`
- `backend/src/main/java/com/pliego/modules/sales/api/CustomerOrderController.java`
- `backend/src/main/java/com/pliego/modules/sales/api/CustomerOrderResponses.java`
- `backend/src/main/java/com/pliego/modules/sales/application/AdminOrderModels.java`
- `backend/src/main/java/com/pliego/modules/sales/application/CheckoutResult.java`
- `backend/src/main/java/com/pliego/modules/sales/application/OrderModels.java`
- `backend/src/main/java/com/pliego/modules/sales/application/PickupModels.java`
- `backend/src/main/java/com/pliego/modules/sales/application/PickupService.java`
- `backend/src/main/java/com/pliego/modules/sales/gateway/JdbcAdminOrderGateway.java`
- `backend/src/main/java/com/pliego/modules/sales/gateway/JdbcCheckoutGateway.java`
- `backend/src/main/java/com/pliego/modules/sales/gateway/JdbcCustomerOrderGateway.java`
- `backend/src/main/java/com/pliego/modules/sales/gateway/JdbcPickupLocationGateway.java`
- `backend/src/main/java/com/pliego/modules/sales/gateway/PickupLocationGateway.java`
- `backend/src/main/resources/db/migration/V088__public_order_references_and_correction_context.sql`
- `backend/src/main/resources/db/migration/V089__verified_store_pickup.sql`
- `backend/src/test/java/com/pliego/foundation/database/DatabaseExceptionTranslatorTest.java`
- `backend/src/test/java/com/pliego/modules/billing/InvoiceRendererTest.java`
- `backend/src/test/java/com/pliego/modules/catalog/api/OpenApiCoverageTest.java`
- `backend/src/test/java/com/pliego/modules/customer/api/BillingIdentityCorrectionApiIntegrationTest.java`
- `backend/src/test/java/com/pliego/modules/notifications/TransactionalMailTest.java`
- `backend/src/test/java/com/pliego/modules/sales/api/AdminOrderApiIntegrationTest.java`
- `backend/src/test/java/com/pliego/modules/sales/api/AdminPickupApiIntegrationTest.java`
- `backend/src/test/java/com/pliego/modules/sales/api/CheckoutApiIntegrationTest.java`
- `backend/src/test/java/com/pliego/modules/sales/api/CustomerOrderApiIntegrationTest.java`
- `backend/src/test/java/com/pliego/modules/sales/application/PickupServiceTest.java`
- `backend/src/test/java/com/pliego/modules/sales/gateway/CheckoutReferenceGatewayTest.java`
- `backend/src/test/java/com/pliego/modules/sales/gateway/HistoricalOrderPricingGatewayTest.java`
- `backend/src/test/java/com/pliego/modules/sales/gateway/PickupGatewayTest.java`
- `backend/src/test/postgres18/billing_identity_corrections_gate.sql`
- `backend/src/test/postgres18/billing_identity_corrections_http_gate.py`
- `backend/src/test/postgres18/customer_query_plan_gate.py`
- `backend/src/test/postgres18/invoice_artifacts_gate.sql`
- `backend/src/test/postgres18/order_reference_gate.sql`
- `backend/src/test/postgres18/order_reference_upgrade_gate.py`
- `backend/src/test/postgres18/run_ci_gates.sh`
- `backend/src/test/postgres18/run_runtime_privileges_ci_gate.sh`
- `backend/src/test/postgres18/store_pickup_concurrency.py`
- `backend/src/test/postgres18/store_pickup_gate.sql`
- `backend/src/test/postgres18/store_pickup_http_gate.py`
- `backend/src/test/postgres18/verified_pickup_concurrency.py`
- `backend/src/test/postgres18/verified_pickup_gate.sql`
- `backend/src/test/postgres18/verified_pickup_privileges_gate.sql`
- `docs/adr/0047-public-order-references-and-verified-pickup.md`
- `docs/adr/README.md`
- `docs/api-amendments/2026-11-01-public-order-references-and-verified-pickup.md`
- `docs/backend/store-pickup-and-pricing.md`
- `docs/testing/public-order-reference-and-pickup-report.md`
- `frontend/openapi/openapi.json`
- `frontend/src/shared/api/adminBillingIdentityCorrections.test.ts`
- `frontend/src/shared/api/adminBillingIdentityCorrections.ts`
- `frontend/src/shared/api/adminPickups.test.ts`
- `frontend/src/shared/api/adminPickups.ts`
- `frontend/src/shared/api/generated.ts`
- `frontend/src/shared/api/orderReferences.test.ts`
- `frontend/src/shared/api/orders.ts`
- `frontend/src/shared/api/pickup.ts`

## Seguimiento V090 — Mi biblioteca

V090 añade `sourcePurchases[].orderReference` en lista y detalle, leído de `pedido.referencia_publica`; conserva `orderId`, enlaces, historial revocado, recompras y ACL. Se actualizan el record Java, OpenAPI, los tipos regenerados y Zod (`z.string().nullish()`). V001–V089 permanecen intactas.

- `mvn -o -Dmaven.repo.local=/tmp/pliego-task/m2 --batch-mode --no-transfer-progress verify`: **466 pruebas, 465 aprobadas, 1 omitida** (`R2LiveSmokeTest`), 0 fallos/errores; incluye dos regresiones JDBC nuevas.
- `run_ci_gates.sh` en PostgreSQL 18.6 local desechable: **90/90 migraciones**, 46 gates SQL, 20 DB/concurrencia, 28 HTTP y 2 de autenticación; **54/54 planes**, sin JIT, incluidos lista/detalle de biblioteca. Ciclo ACL restringido aprobado, limpieza doble y fixture de biblioteca ejecutado como `pliego_app`.
- `npm run api:types` y `npx vitest run src/shared`: **399/399 pruebas, 26 archivos**. El esquema `LibrarySourcePurchase` coincide con OpenAPI del backend en ejecución.

Revisión focalizada sin hallazgos. Solo se añaden notas a este informe y ADR-0047; se preservan los cambios concurrentes en rutas protegidas. Sin commits, push, despliegues ni acceso a producción. No se ejecutó R2 real.
