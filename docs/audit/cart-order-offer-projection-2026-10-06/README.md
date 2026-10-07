# Proyección autoritativa de ofertas en carrito y pedidos

Validación local del 6 de octubre de 2026. Sin commit, push ni deploy. No se rediseñaron CartPage, CheckoutPage, confirmación, Mis pedidos ni detalle de pedido. No se modificaron portadas, R2, SKUs, inventario ni las 23 ofertas existentes.

## Contrato de carrito

Cada línea conserva `currentPrice` y `currentSubtotal` y añade `originalPrice`, `unitSavings`, `originalSubtotal` y `lineSavings`. El resumen añade `originalSubtotal`, `savingsTotal` y `currentSubtotal`; el campo anterior `subtotal` sigue representando mercancía con descuentos. `totalCurrent` conserva el significado anterior de total con impuestos. Los campos nuevos proceden de PostgreSQL, sin cálculo de elegibilidad, ahorros o impuestos en Java/React.

V051 incorpora `fn_cart_offer_quote`, envolviendo las rutinas existentes `fn_cart_quote` y `fn_edition_offer`. Reutiliza el snapshot de la sentencia, preserva orden y valores previos de las líneas, y no persiste cálculos promocionales. Ofertas vencidas, futuras, desactivadas o suprimidas por una reducción del precio base dejan de aportar ahorro automáticamente.

## Snapshot de compra

V052 agrega cuatro columnas nullable a `pedido_item`: `precio_original_snapshot`, `ahorro_unitario_snapshot`, `subtotal_original_snapshot` y `ahorro_linea_snapshot`. El trigger de captura usa la oferta autoritativa durante la inserción del checkout y comprueba que el precio pagado coincide. Los campos pagados existentes y el encabezado monetario permanecen intactos. Las restricciones validan las identidades de precios y cantidades. Los snapshots de líneas tienen las protecciones de UPDATE/DELETE ya existentes.

V053 impide anexar líneas cuando ya existe un pago. V054 bloquea primero el pedido con FOR UPDATE, serializando esa comprobación con el bloqueo de la FK del pago concurrente. Ambas son migraciones hacia delante; V052 conserva exactamente su checksum aplicado.

`fn_order_offer_pricing` resume únicamente líneas históricas almacenadas y el subtotal pagado del pedido. `fn_order_item_offer_snapshots` enriquece los JSON de detalle después de sus comprobaciones de identidad/propiedad. Ninguna función reconstruye historia consultando ofertas o precios actuales del catálogo.

Checkout/resolución, listado de pedidos, recientes y detalle exponen `originalSubtotal`, `savingsTotal`, `currentSubtotal` y `pricingSnapshotAvailable`. El listado también entrega el desglose histórico `subtotal`, `taxRate`, `taxAmount` y `shippingAmount`. El detalle añade a cada ítem `originalPrice`, `unitSavings`, `originalSubtotal`, `lineSavings` y `pricingSnapshotAvailable`, manteniendo `unitPrice` y `subtotal` como importes pagados.

Los 138 ítems históricos anteriores a este pase mantienen todos sus valores existentes. Sus nuevas columnas son NULL; el contrato distingue la ausencia de evidencia con `pricingSnapshotAvailable=false`. No se inventa un precio original ni se supone un ahorro histórico cero. El subtotal efectivamente pagado, impuestos, envío y total continúan disponibles.

## Integración frontend

OpenAPI se obtuvo del backend actualizado y se regeneraron los tipos. Ninguna ruta, campo ni tipo anterior se eliminó. Los adaptadores de carrito/pedidos conservan los campos monetarios originales y admiten respuestas anteriores que omiten las adiciones. Los nuevos importes suministrados se validan estrictamente; la ausencia histórica permanece explícita.

`cartPricingViewModel` formatea importes autoritativos y distingue la disponibilidad de la proyección. `orderPricingViewModel` hace lo mismo con snapshots históricos para confirmación/listado/detalle. `toMisPedidosOrder` añade opcionalmente `historicalPricing` y conserva la forma previa cuando no existe esa proyección. Los modelos no calculan descuentos ni impuestos ni consultan el catálogo actual. El resumen de pedidos conserva la tasa de IVA recibida.

La entrega para Claude está en [purchase-offer-pricing-handoff.md](../../frontend/purchase-offer-pricing-handoff.md). Los cambios de diseño quedan para ese pase.

## Correcciones durante validación

- Se cerró la carrera de anexar una línea frente a un pago concurrente mediante el bloqueo del pedido; la prueba de dos sesiones espera el pago y rechaza la inserción con P9001.
- El gate HTTP detectó que Mis pedidos no exponía el desglose histórico completo: se añadieron subtotal, tasa/importe de IVA y envío desde `fn_order_pricing`.
- El adaptador de resumen omitía `taxRate` y la descartaba: ahora la conserva y valida; los view models reciben la tasa autoritativa.
- Se preservaron constructores anteriores de DTO/modelos para no romper consumidores existentes.
- Se corrigió la expectativa del nuevo fixture HTTP de entrada de inventario: el contrato existente responde 201.
- Las aserciones SQL se endurecieron contra NULL/campos ausentes y pérdida de líneas. La ampliación del guard llegó durante la aplicación de V052: se restauró su checksum aplicado y se incorporó exclusivamente como V053 hacia delante; no se alteró una migración aplicada.

Algunas repeticiones del frontend desde el proceso raíz sufrieron fallos nativos de V8/SIGTRAP y una prueba de arranque sin JIT no podía cargar WebAssembly. No se modificaron dependencias, flags persistentes ni configuración para ocultarlos. Las repeticiones finales con el comando npm habitual, tras los tipos definitivos y el ajuste de taxRate, aprobaron toda la suite. Los logs de fallos nativos se conservan como evidencia.

## Pruebas y resultados

- PostgreSQL 18 real, base aislada nueva, Flyway V001–V054: runner completo aprobado, **53 gates** (**25 SQL, 16 HTTP, 12 de concurrencia/ciclo de vida**). Incluye los nuevos gates de carrito, snapshot histórico, concurrencia de pago y REST de compra completa.
- Backend: **184 pruebas completas** y **40 focalizadas** aprobadas; paquete construido.
- Frontend: **61 archivos / 562 pruebas completas** aprobadas, typecheck/build aprobados y tipos OpenAPI regenerados.
- API local real: carrito con dos unidades físicas, EBOOK y AUDIOBOOK; invariantes de unidad, línea y resumen correctos. Cuenta fixture vacía al terminar; no se realizaron compras en la base local de demostración.
- Preservación: **138 ítems históricos** idénticos en sus campos anteriores, **23 ofertas activas** conservadas; nuevas columnas históricas anteriores NULL.
- Revisión independiente y git diff --check completados; la observación de concurrencia se corrigió y probó.

Los tests cubren ofertas físicas/EBOOK/AUDIOBOOK, cantidad mayor que uno, múltiples ofertas, mezcla con líneas sin descuento, oferta vencida después de comprar, nuevo carrito a precio base, desactivación y reducción posterior de base, snapshots históricos inmutables, IVA calculado sobre mercancía rebajada, totales de checkout iguales a lo pagado, replay idempotente, cancelación/reembolso y compatibilidad de respuestas previas.

Caso mixto de prueba: subtotal original 214,88, ahorro 40,98, subtotal pagado 173,90, IVA 26,09, total pagado 199,99. El vencimiento y la cancelación mantienen esos importes en la compra histórica.

Los logs completos y los conteos están en este directorio, incluyendo gates.json y pruebas de preservación. La base aislada del runner queda identificada en native-postgres-result.json. No hay bloqueos funcionales restantes; los pedidos anteriores sin evidencia original conservan su limitación explícita y el diseño de las pantallas queda pendiente de Claude.
