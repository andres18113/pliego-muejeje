# Referencias públicas y retiros verificados (V088–V089)

Este contrato amplía las proyecciones de pedidos y sustituye la colección de retiro descrita en 0013. Véase [ADR-0047](../adr/0047-public-order-references-and-verified-pickup.md).

`orderId` conserva su valor y tipo string. `orderReference` es un string `PL-NNNN-NNNN`, aleatorio, único e inmutable, también para pedidos anteriores. Se devuelve en checkout, intentos `CREATED` y respuestas repetidas, lista/detalle del cliente y lista/detalle administrativo. Los intentos `PENDING`/`NOT_CREATED` mantienen `order:null`. `GET /api/v1/admin/orders` añade `q`, que admite referencias con/sin PL, guiones, espacios y mayúsculas. Los otros filtros permanecen vigentes.

Los correos nuevos llevan la referencia y muestran `Pedido #PL-…`; los eventos históricos sin referencia muestran `Pedido #<orderId>`. Solo los PDF generados a partir del cambio incorporan la referencia. No cambian números de factura, filas emitidas ni archivos almacenados.

Los códigos de retiro nuevos tienen `P-` y ocho caracteres de `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, generados criptográficamente; los anteriores permanecen válidos. Comparación/búsqueda admite mayúsculas/minúsculas, espacios, guiones y omitir el prefijo. El código permanece en las proyecciones del cliente; las vistas administrativas no lo exponen.

`fulfillment.state` para retiro es `PENDING`, `READY`, `COLLECTED` o `CANCELLED`. `READY` exige pago `APPROVED`, pedido vigente, ventana de seis minutos finalizada y reloj posterior o igual a `readyAt`. La Database API reconcilia el estado al leer. Los retiros históricos anteriores a la ventana, con plazo null, conservan su elegibilidad cuando se aprueba el pago y llega `readyAt`; no se inventa una finalización histórica. Se conservan `readyAt`, `collectedAt` y el código en las vistas del cliente. La confirmación de checkout sigue siendo el snapshot inmutable del recibo.

Todos los endpoints siguientes requieren ADMIN tanto en Spring Security como en PostgreSQL:

| Método y ruta | Entrada | Respuesta |
| --- | --- | --- |
| `POST /api/v1/admin/pickups/lookup` | `{"code":"P-ABCDEFGH"}` en el cuerpo | `200 PickupView` |
| `GET /api/v1/admin/pickups` | `state?`, `q?`, `page=0`, `pageSize=20` (máximo 50) | `200 {items: PickupView[], page, pageSize, totalCount: string}` |
| `POST /api/v1/admin/orders/{orderId}/pickup/collect` | `{"pickupCode":"P-ABCDEFGH","identityVerified":true}` | `200 PickupView` |

`q` de retiros busca referencia normalizada, nombre o correo del cliente. `state` admite `PENDING|READY|COLLECTED|CANCELLED`. READY/PENDING ordenan por `readyAt` ascendente; COLLECTED por `collectedAt` descendente; CANCELLED por creación descendente. Sin filtro: READY, PENDING, COLLECTED, CANCELLED; el identificador resuelve empates. Las páginas vacías conservan `totalCount`.

```json
{
  "orderId": "123",
  "orderReference": "PL-1234-5678",
  "state": "COLLECTED",
  "orderState": "DELIVERED",
  "paymentState": "APPROVED",
  "createdAt": "2026-11-01T10:00:00Z",
  "readyAt": "2026-11-01T10:25:00Z",
  "collectedAt": "2026-11-01T11:00:00Z",
  "collectedBy": {"userId":"5","email":"staff@example.invalid"},
  "identityVerified": true,
  "location": {"id":"1","name":"PUCE · Sede matriz","address":"Dirección del punto","city":"Quito"},
  "customer": {"customerId":"42","name":"Ana Pérez","email":"ana@example.invalid","identityType":"EC_CEDULA","identityNumber":"1710034065"},
  "items": [{"orderItemId":"321","title":"Libro","format":"PAPERBACK","quantity":2}],
  "unitCount": 2,
  "total": "18.00"
}
```

`collectedAt`, `collectedBy` e `identityVerified` son null antes del retiro. Los retiros históricos sin auditoría conservan null en los nuevos campos. `identityType`/`identityNumber` son null si la cuenta no tiene identidad registrada; son la identidad completa de cuenta, disponible solo al personal. `items`/`unitCount` incluyen exclusivamente libros impresos. Ningún nivel de `PickupView` contiene el código.

La colección solo procede desde READY. Bloquea pedido y retiro; exactamente un administrador puede confirmar. Registra `retirado_por`, `identidad_verificada=true`, `fecha_retiro` e historial DELIVERED en la misma transacción. El registro se fija una sola vez. Repetir devuelve conflicto; se debe consultar la cola para verificar el resultado.

| SQLSTATE / dominio | HTTP | Título | Detalle |
| --- | --- | --- | --- |
| `P5016 / PICKUP_NOT_FOUND` | 404 | Retiro no encontrado | No encontramos un retiro con ese código. |
| `P5017 / PICKUP_ALREADY_COLLECTED` | 409 | Pedido ya retirado | Este pedido ya fue retirado. |
| `P5018 / PICKUP_NOT_READY` | 409 | Pedido aún no disponible para retiro | Este pedido aún no está listo para retiro. |

El campo REST `code` conserva la convención SQLSTATE (`P5016`, etc.). `P5013 / PICKUP_CODE_INVALID` conserva su HTTP 400 y texto existente. Cancelado, impago o no retiro devuelve `P5002 / ORDER_INVALID_TRANSITION` (409). `identityVerified` ausente/null/false devuelve 400 `VALIDATION_ERROR`, con mensaje de verificación en español. P5014/P5015 siguen reservados para geografía.

`GET /api/v1/admin/billing-identity-corrections` mantiene su página y campos, y añade en cada elemento:

```json
{"customerHasBilledInvoices": true, "decidedByEmail": "staff@example.invalid"}
```

`decidedByEmail` puede ser null. `customerHasBilledInvoices` procede de `fn_customer_has_account_billed_invoice`. `POST /api/v1/admin/billing-identity-corrections/{requestId}/decision` sigue aceptando solo `{"decision":"APPROVE"}` o `{"decision":"REJECT","decisionReason":"Motivo en español"}`. Se conservan pendiente obligatorio, comprobación de conflictos, auditoría e inmutabilidad de facturas; no se añaden campos a la respuesta de decisión.

Clientes compartidos: `lookupAdminPickup`, `listAdminPickups`, `collectAdminPickup`, `listAdminBillingIdentityCorrections`, `decideAdminBillingIdentityCorrection`. Sus esquemas Zod y tipos se exportan desde `adminPickups.ts` y `adminBillingIdentityCorrections.ts`. Las referencias de `orders.ts` son `z.string().nullish()` para tolerar respuestas anteriores.
