# ADR-0047: Referencias públicas de pedidos y retiro verificado

## Estado

Aceptado — 2026-11-01.

## Contexto

El identificador interno del pedido sigue siendo la clave de persistencia y `orderId` de REST. Una referencia pública aleatoria facilita la atención sin mostrar una secuencia. Los códigos de retiro anteriores eran predecibles y confirmar un retiro no exigía verificar identidad ni esperar la preparación.

## Decisión

PostgreSQL genera y conserva `referencia_publica` (`PL-NNNN-NNNN`) desde bytes criptográficos de `gen_random_uuid()`, con comprobación de colisiones y bloqueo transaccional por candidato. V088 asigna referencias a todos los pedidos existentes sin cambiar claves, recibos idempotentes, facturas, documentos ni historial. Un trigger impide modificar la referencia. Se añade `orderReference` a las proyecciones públicas, administrativas y de checkout; las referencias nunca sustituyen la autorización por propietario.

V089 genera códigos nuevos de retiro con ocho caracteres criptográficos. Los códigos históricos permanecen válidos. La comparación normaliza mayúsculas, espacios, guiones y prefijo opcional. Los pedidos históricos sin ventana conservan su preparación sin inventar fechas de finalización. La preparación se resuelve en la Database API al consultar, siguiendo la reconciliación existente: pago aprobado, ventana de cancelación finalizada y fecha de preparación alcanzada producen `READY`. La entrega exige código e identidad verificada. El bloqueo pedido → retiro serializa confirmaciones; solo una registra administrador, verificación, fecha e historial `DELIVERED`.

La cola y búsqueda administrativa devuelven `PickupView`, una proyección explícita sin código de retiro. Incluye la identidad de facturación registrada para que el administrador pueda cotejarla con el documento presentado. La búsqueda del código usa POST con cuerpo. Se conserva Controller → Service → JDBC Gateway y Spring controla las transacciones. Las rutinas administrativas también exigen ADMIN.

La cola de correcciones añade el uso de identidad en facturas de cuenta y el correo del administrador que decidió. `APPROVE`/`REJECT`, las reglas de revisión y las facturas históricas permanecen vigentes.

Un trigger de inserción enriquece también el evento `INVOICE_ISSUED`, cuyo productor no usa el snapshot general. Los nuevos eventos de correo llevan la referencia; las plantillas admiten los eventos antiguos sin ella. Solo los PDF generados a partir de ahora muestran la referencia. No se regeneran archivos ya almacenados ni se actualizan filas de factura.

## Alternativas consideradas

- Mantener identificadores/códigos secuenciales: no satisface la referencia aleatoria ni la protección del código.
- Calcular preparación y confirmar en Java: dividiría las invariantes y no resolvería carreras entre administradores.
- Reglas y proyecciones en PostgreSQL: elegida por coherencia con el monolito y por permitir bloqueos, auditoría y validación atómicos.

## Consecuencias y validación

Las referencias tienen un espacio finito de cien millones; una colisión genera otro candidato. No constituyen credenciales. Los códigos siguen siendo credenciales presentadas por el cliente y no aparecen en las vistas de personal. Se añaden errores de dominio sin reutilizar SQLSTATE existentes. Las pruebas cubren migración desde V087, invariantes, aislamiento por cliente, transición temporal, concurrencia, contratos REST, correo/PDF y permisos de ejecución con el rol restringido.

Seguimiento V090: la lista y el detalle de Mi biblioteca añaden `orderReference` junto a `orderId` en cada elemento de `sourcePurchases`, incluidos los grants revocados y las recompras. La referencia se lee de `pedido.referencia_publica` en `fn_library_item`, conservando la firma, los permisos de ejecución y el orden de compra existentes. OpenAPI y el contrato compartido reflejan el campo; Zod admite su ausencia o null por compatibilidad.

## Seguimiento V091 — detalle y verificación por pedido (2026-11-01)

`GET /api/v1/admin/pickups/{orderId}` añade el detalle completo para la entrega, con `paymentMethod` y `availableActions { cancel, cancellationDeadline }`. Reutiliza la reconciliación de V089 y la proyección de cancelación de `fn_order_post_purchase` (V043/V055/V059/V072), incluidas la ventana de seis minutos desde aprobación y la cancelación del pago pendiente con factura simulada DRAFT. Java no calcula disponibilidad ni plazos.

`POST /api/v1/admin/pickups/{orderId}/verify-code` recibe `{ code }`, normaliza con `fn_normalize_pickup_code` y compara exclusivamente con el pedido solicitado. Devuelve el mismo detalle sin credenciales. La función es STABLE y la transacción Spring es de solo lectura: no reconcilia ni registra verificaciones; el GET posterior obtiene el estado reconciliado. Un código ajeno y uno incorrecto producen el mismo P5013; un pedido inexistente o sin retiro produce P5016.

La nueva entrada `sp_admin_order_cancel` exige ADMIN antes de delegar a `sp_order_cancel`, conservando las reglas y los resultados del comando compartido con clientes. Spring Security protege `/api/v1/admin/**`; las rutinas nuevas vuelven a exigir ADMIN y cuentan con permisos explícitos para `pliego_app`, sin EXECUTE público. Listado, lookup y collect conservan sus contratos. No existe un mecanismo general de limitación de abuso administrativo que aplicar; no se introduce infraestructura nueva. La evidencia por AC se registra en `docs/testing/admin-pickup-handover-backend-report.md`.
