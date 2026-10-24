# Identidad fiscal y facturación académica — ampliación de API

Se conservan contratos anteriores durante transición. Los IDs de negocio siguen siendo internos y se serializan como strings; cédula no aparece en URLs ni claves de idempotencia.

- `GET /api/v1/me/billing-identity`: CUSTOMER propio, 200 `{type:"EC_CEDULA",number:string}` o 204 ausente.
- `PUT /api/v1/me/billing-identity`: reemplaza con el mismo objeto validado, 204. No cambia `/me` ni el registro.
- `DELETE /api/v1/me/billing-identity`: elimina atributo mutable propio, 204; conserva snapshots históricos.
- `POST /api/v1/checkout`: extensión opcional `billingIdentity:{type,number}`, `buyerName`, `billingAddress:{line1,line2?,city,province,countryCode,postalCode?}`. Los tres forman una intención indivisible; datos inválidos no crean pedido. Nuevo frontend exige esta captura; clientes antiguos omiten el conjunto y conservan contrato legacy. No se infiere del destinatario de entrega.
- `GET /api/v1/orders/{orderId}/invoice`: propietario/ADMIN, 200 `{invoiceId,orderId,state,provenance,documentNumber,files:[{type,state}]}`. Procedencia `LEGACY|SIMULATED`; borrador sin número definitivo; ausencia 404. Respuesta sin cédula ni caché pública.
- `GET /api/v1/orders/{orderId}/invoice/files/{PDF|XML}`: bytes autenticados con Content-Disposition attachment y no-store. Ausencia histórica: 404 `INVOICE_FILE_UNAVAILABLE`, estado `UNAVAILABLE`; no se regenera. Archivo pendiente: 409 `INVOICE_FILE_NOT_READY`, no un motivo para repetir compra.

`POST /api/v1/admin/orders/{orderId}/approve-payment`: ADMIN, 204; aprueba el pago pendiente y confirma/emite atómicamente. Repetir una aprobación completada conserva el resultado sin duplicar factura, inventario ni derechos. Las lecturas/descargas de factura también tienen alias bajo `/api/v1/admin/orders/{orderId}/invoice`.

Las ampliaciones conservan SQLSTATE existentes, especialmente `P1010` para reutilización de clave con intención distinta. Errores humanos en español. Idempotencia incluye datos fiscales normalizados y conserva el resultado del intento original; cambios de perfil o carrito no recotizan replay. Los documentos simulados no son comprobantes autorizados por SRI.
