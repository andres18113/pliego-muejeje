# ADR 0033 — IVA cero para el catálogo ecuatoriano

Fecha: 2026-10-10. Estado: aceptado para el alcance solicitado.

## Contexto

El alcance de PLIEGO se limita a Ecuador y a libros físicos, eBooks y audiolibros. El usuario corrigió la política del catálogo a IVA 0 %. La función central `fn_checkout_tax_rate()` introducida por V041 devolvía 15 %; cotización y checkout la reutilizan. Los pedidos y documentos emitidos guardan importes históricos inmutables.

## Decisión

V067 sustituye únicamente la política central con 0 %. No modifica migraciones anteriores, precios base ni ofertas, inventario, portadas o datos de pedidos. La Database API calcula los importes; Java y React presentan esos importes sin recalcular IVA.

Los carritos abiertos reciben tasa e importe cero. Su fingerprint incluye el desglose tributario, por lo que una aceptación anterior al cambio se rechaza con el mismo `CART_QUOTE_CHANGED` hasta revisar la nueva cotización. Los nuevos pedidos, pagos, facturas y notas de crédito guardan los importes de la nueva política. La generación de facturas conserva el tratamiento existente `NOT_ASSESSED` cuando la tasa es cero. Los recibos idempotentes, pedidos, facturas, créditos y payloads de correo de compras anteriores conservan sus snapshots de 15 %; no se recotiza el historial.

## Consecuencias y validación

Este cambio configura el alcance aprobado del producto; no crea un motor tributario para otros países o productos. Agregar otros productos o jurisdicciones requerirá una decisión nueva.

Las pruebas PostgreSQL usan comandos reales para un carrito mixto, ofertas, checkout, pago, factura, cancelación, crédito y replay. La prueba de actualización Flyway V066→V067 conserva compras anteriores al 15 %, incluso facturas emitidas después del cambio; rechaza el fingerprint anterior de un carrito abierto y verifica nuevos importes cero. Los gates REST y de correo actuales esperan los importes cero y siguen verificando descuentos, idempotencia y snapshots. La prueba histórica V040→V041 permanece con su contrato original.
