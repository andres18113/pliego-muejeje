# ADR 0022 — Totales monetarios autoritativos, IVA configurado 15%

Fecha: 2026-10-04. Estado: aceptado por la ampliación solicitada durante STORE_PICKUP.

La API actual expone `cart.totalCurrent`, pedido subtotal/total iguales, pago monto y facturas NOT_ASSESSED con impuestos cero. V006 restringe total=subtotal. V034 ya tiene impuestos tipados por línea, header, factura y nota de crédito; se extienden, no se crea otro modelo. No hay cálculo ni tarifa de transporte real: shippingAmount permanece autoritativamente 0.00 en ambos métodos.

V041 aplica la tasa porcentual 15.00 solicitada a compras nuevas, en PostgreSQL. Precios de catálogo se tratan como netos; subtotal suma precio*cantidad. Impuesto se redondea por línea NUMERIC a dos decimales y se suma: carrito, pedido y líneas de factura usan la misma regla, incluso en límites de centavos. Total=subtotal+taxAmount+shippingAmount. No recalcular compras antiguas: snapshots existentes se mantienen con tasa/impuesto/envío cero y total original. TaxRate se expresa como porcentaje 15.00, no fracción0.15.

Agregar columnas tipadas a pedido/pedido_item para snapshots de IVA y envío; facturas/nota_crédito reutilizan sus columnas de impuesto y añaden tasa/envío. Constraints e inmutabilidad protegen monetarios; invoice issue copia snapshots sin consultar tasas/precios actuales. Crédito total copia importes facturados. Pago y receipt registran grand total, con precision30,2 para no perder consistencia. Executor de checkout conserva locks existentes, calcula importes antes de INSERT de pedido/pago y publica los importes finales en la misma outbox.

Nueva proyección fn_cart_quote entrega cinco importes autoritativos y totalCurrent como alias de total. fn_cart_get legacy mantiene su contrato para consumidores SQL existentes. REST cart/checkout/order detail añade subtotal/taxRate/taxAmount/shippingAmount/total como strings decimales. Funciones priced customer/admin conservan funciones legacy y autorización. Listas siguen mostrando total autoritativo persistido. Confirmación/email incluye desglose, sin cálculos del frontend.

RED: combinación de líneas pequeñas que diferencia suma de impuestos redondeados de redondeo agregado, carrito→checkout→pago→invoice→crédito, JSON/API/outbox, snapshots tras cambiar precio, replay, órdenes antiguas y manipulación de importes. Ejecutar afectadas y luego Maven y todos los gates reales.

Diferidos: cálculo de tarifas de envío, clasificación fiscal/exenciones por producto y proveedor fiscal. Se implementa la configuración de IVA pedida, sin introducir lógica fiscal en Java o frontend.
