# Revisión de compras digitales duplicadas

`find-duplicate-active-digital-purchases.sql` es de solo lectura. Lista cada fuente ACTIVE de las identidades cliente/edición con más de una fuente, sus pedidos, pagos, fechas e importes. Distingue el importe de la línea digital del pago completo: un pedido mixto también contiene productos físicos. No consulta datos personales de contacto ni modifica derechos, pedidos o pagos.

Ejecutar con las variables PostgreSQL del entorno autorizado:

```bash
psql -X -v ON_ERROR_STOP=1 -f docs/audit/digital-duplicates/find-duplicate-active-digital-purchases.sql
```

V076 conserva las fuentes históricas duplicadas y sus snapshots; informa su número y bloquea nuevas adquisiciones. No borra, revoca ni reembolsa compras históricas automáticamente. V077 únicamente agrega la proyección de acceso por línea. V078 modifica la búsqueda de catálogo.

Si el negocio decide corregir un duplicado, un administrador debe revisar primero ambos pedidos y sus facturas mediante `GET /api/v1/admin/orders/{orderId}` y decidir qué compra conservar. Para cada pedido elegible que se quiera cancelar, el comando existente es `POST /api/v1/admin/orders/{orderId}/cancel`, autenticado como ADMIN. Este comando cancela el **pedido completo**, reembolsa el pago aprobado, restaura sus unidades físicas y revoca las fuentes digitales de ese pedido; la facturación conserva el rastro y la nota de crédito aplicable. No es un reembolso parcial de la línea duplicada. Conviene examinar con especial cuidado los pedidos mixtos y todas sus otras líneas.

El comando respeta las transiciones y ventanas vigentes: pedidos finalizados, entregados o fuera de plazo pueden devolver P5003 y no permiten esta resolución. En ese caso hace falta una decisión/proceso de negocio posterior; este trabajo no introduce excepciones ni cambios directos de estado. Después de una cancelación autorizada, volver a leer el pedido y ejecutar el audit; conservar la evidencia de la decisión. Cancelar una fuente deja activa la otra y conserva la misma identidad de biblioteca.

Este trabajo no ejecutó ninguna cancelación ni reembolso sobre datos del usuario. Las pruebas usaron exclusivamente bases desechables nuevas en :55476; la base de desarrollo en :55432 quedó fuera de alcance.
