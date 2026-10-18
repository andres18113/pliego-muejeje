# ADR-0038: Emisión automática de documentos académicos

Fecha: 2026-10-17. Estado: aceptado por aprobación del plan de implementación.

Se amplía el modelo de factura/ítems/dirección/créditos existente; no se crea otro libro de ventas. El checkout ampliado captura identidad fiscal independiente del destinatario y participa en el mismo comando/transacción que pedido, pago, inventario y recibo. El payload fiscal forma parte de la comparación idempotente; los contratos antiguos permanecen disponibles durante la transición.

Pago pendiente conserva borrador; pago aprobado y pedido confirmado emiten una sola factura. Rechazo no emite. Los números académicos pertenecen a una serie aislada y se asignan en PostgreSQL. Cancelación conserva originales y genera un crédito total una sola vez después del reembolso. No se fabrican documentos para compras históricas. `LEGACY` y `SIMULATED` expresan procedencia; ningún documento simulado afirma autorización SRI.

`modules.billing` consulta y descarga documentos autenticados y genera derivados fuera de la transacción de compra. Una cola tipada insertada al emitir usa `FOR UPDATE SKIP LOCKED`, propietario UUID, lease de 60 segundos, máximo de cinco intentos y backoff limitado. Publicación y disponibilidad se confirman atómicamente, con rechazo de propietarios/leases obsoletos. Un fallo al generar no repite una compra.

Decisión de almacenamiento: para el alcance académico, archivos privados de hasta 10 MiB se almacenan como `bytea` inmutable con checksum SHA-256 y MIME. La Database API oculta el almacenamiento; esta elección evita inconsistencias entre filesystem y commit y permite varias instancias del backend. Una futura migración a almacenamiento de objetos exige preservar publicación y autorización; no exponer claves privadas a React. Esta variante concreta el requisito de artefactos recuperables del plan.

Los precios, descuentos y tributos vienen del snapshot PostgreSQL. XML sin firma y PDF incluyen «SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA». El esquema XSD y su procedencia se registran junto al renderer. La ficha SRI y la versión XML son referencias diferentes. No hay credenciales, certificado ni llamadas a SRI, tampoco al ambiente de pruebas.

Evidencia requerida: rollback inyectado, replay con carrito vacío y perfil cambiado, conflictos P1010, compras/concurrencia, emisión/crédito únicos, leases y recuperación, autorización propietario/ADMIN, upgrade sin cambios históricos y validación de artefactos.

Representación documental: XML conserva Unicode y todos los componentes de dirección en campos adicionales separados, sin truncar una dirección compuesta al límite. PDF usa WinAnsi; caracteres fuera de esa fuente se muestran explícitamente como `[U+HEX]`, con nota visible y texto original UTF-16BE en ActualText y XML. Esta representación reversible evita perder información o dejar una compra válida sin archivo, sin introducir una dependencia de fuentes de sistema. Es un límite visual declarado: lectores PDF difieren en soporte de copia/ActualText; una fuente Unicode embebida completa queda como mejora posterior.
