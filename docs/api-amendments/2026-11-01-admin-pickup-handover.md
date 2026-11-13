# Detalle y verificación de retiro administrativo — V091

Fecha: 2026-11-01. Cambio aditivo de ADR-0047. Todos los endpoints requieren JWT ADMIN; anónimo recibe 401 y cliente 403. Las rutinas PostgreSQL verifican nuevamente ADMIN.

`GET /api/v1/admin/pickups/{orderId}` responde 200 `AdminPickupDetail`. Incluye todos los campos existentes de `PickupView`, más `paymentMethod: string | null` y `availableActions: { cancel: boolean, cancellationDeadline: string | null }`. IDs y dinero siguen siendo strings; fechas REST en UTC. Los artículos incluyen solo formatos físicos y la identidad del cliente conserva tipo/número o null.

```json
{
  "orderId": "700",
  "orderReference": "PL-0123-4567",
  "state": "READY",
  "orderState": "PREPARING",
  "paymentState": "APPROVED",
  "createdAt": "2026-11-01T14:00:00Z",
  "readyAt": "2026-11-01T15:00:00Z",
  "collectedAt": null,
  "collectedBy": null,
  "identityVerified": null,
  "location": { "id": "1", "name": "Centro", "address": "Principal", "city": "Quito" },
  "customer": { "customerId": "42", "name": "Ana Pérez", "email": "ana@example.invalid", "identityType": null, "identityNumber": null },
  "items": [{ "orderItemId": "800", "title": "Impreso", "format": "PAPERBACK", "quantity": 2 }],
  "unitCount": 2,
  "total": "39.80",
  "paymentMethod": "CARD",
  "availableActions": { "cancel": false, "cancellationDeadline": "2026-11-01T14:06:00Z" }
}
```

El GET reconcilia el ciclo de compra antes de proyectar READY. La disponibilidad reutiliza `fn_order_post_purchase`, con las reglas de `sp_order_cancel`: pago aprobado y estado CONFIRMED/PREPARING dentro del plazo si existe; o pago PENDING con factura simulada DRAFT, sin plazo. Los pedidos anteriores a la ventana conservan las reglas históricas. La decisión sigue siendo una instantánea: el comando vuelve a comprobar el plazo y el estado bajo bloqueo si transcurre tiempo o hay una operación concurrente.

`POST /api/v1/admin/pickups/{orderId}/verify-code`, cuerpo `{ "code": "p-ab234567" }`, responde 200 con el mismo `AdminPickupDetail`. Acepta los formatos normalizados existentes (espacios, guiones, minúsculas, prefijo opcional y códigos históricos). No escribe filas ni reconcilia; no entrega una autorización persistida. Collect vuelve a verificar el código, el estado READY y `identityVerified: true` atómicamente.

| Situación | HTTP | Código estable | Nombre de dominio |
|---|---|---|---|
| Pedido inexistente o sin retiro (detalle/verificación) | 404 | P5016 | PICKUP_NOT_FOUND |
| Código incorrecto o válido de otro pedido | 400 | P5013 | PICKUP_CODE_INVALID |
| Cuerpo inválido / identidad sin confirmar | 400 | VALIDATION_ERROR | Validación REST |
| Segundo retiro | 409 | P5017 | PICKUP_ALREADY_COLLECTED |
| Retiro antes de READY | 409 | P5018 | PICKUP_NOT_READY |
| Retiro cancelado o sin pago aprobado | 409 | P5002 | ORDER_INVALID_TRANSITION |
| Cancelación fuera de ventana / estado no permitido | 409 | P5003 | ORDER_NOT_CANCELLABLE |

Los errores conservan los mensajes humanos en español y los SQLSTATE existentes. Ninguna respuesta administrativa contiene el código de retiro. No se modifican los contratos de listado, lookup ni collect.

`POST /api/v1/admin/orders/{orderId}/cancel` mantiene su respuesta:

```json
{ "orderId": "700", "previousState": "CONFIRMED", "orderState": "CANCELLED", "paymentState": "REFUNDED", "restoredUnits": 2 }
```

Para pago pendiente: `previousState: "PENDING_PAYMENT"`, `paymentState: "REJECTED"`, `restoredUnits: 0`. Su gateway usa la nueva entrada ADMIN `sp_admin_order_cancel`, que delega al mismo comando de negocio.

Clientes compartidos: `adminPickupDetailSchema`, `AdminPickupDetail`, `getAdminPickup(orderId, signal?)`, `verifyAdminPickupCode(orderId, code)` en `adminPickups.ts`; `adminOrderCancellationSchema`, `AdminOrderCancellation`, `cancelAdminOrder(orderId)` en `adminOrders.ts`. Las lecturas y los comandos administrativos usan `cache: "no-store"`; los códigos solo viajan en cuerpos POST. OpenAPI se genera desde el backend y sus tipos con `npm run api:types`.
