# Ofertas para la demostración — 6 de octubre de 2026

23 ofertas guardadas en la base de datos local que atiende la API http://127.0.0.1:8080: **10 libros físicos, 6 EBOOK y 7 AUDIOBOOK**. Se utilizó exclusivamente PUT /api/v1/admin/editions/{editionId}/offer y el modelo V044 existente. No hay cambios de código, migraciones, frontend, seed, R2, commit, push ni deploy en este trabajo.

El usuario aclaró que «persistente» significa guardar las ofertas para la demostración del 7 de octubre; sí deben vencer. No se implementaron ofertas sin vencimiento. Los precios base permanecen intactos y el modelo restablece automáticamente su uso cuando la oferta deja de aplicar.

## Política de demostración

Descuentos distintos por formato y tramo del precio base. Esta es una política académica autorizada; no se atribuyen márgenes, demanda ni resultados comerciales a las ediciones.

| Formato | Precio base USD | Descuento solicitado |
|---|---|---|
| Físico | <15 / 15–<25 / ≥25 | 10 % / 15 % / 20 % |
| EBOOK | <10 / 10–<18 / ≥18 | 15 % / 20 % / 25 % |
| AUDIOBOOK | <15 / 15–<25 / ≥25 | 10 % / 15 % / 20 % |

El descuento mayor tiene la vigencia menor: 20–25 % durante 3 días, 15 % durante 7 días, 10 % durante 15 días. Se redondea el precio final a dos decimales; PostgreSQL calcula el porcentaje efectivo que muestra el storefront, que puede diferir ligeramente del solicitado por ese redondeo.

Las ofertas comienzan el 6/10/2026 a las 00:00, America/Guayaquil. Distribución: 12 terminan el **9/10 a las 23:59:59**, 6 el **13/10 a las 23:59:59**, 5 el **21/10 a las 23:59:59**. Todas estarán activas durante el 7/10. Se conservarán en la base de datos después de las pruebas; solo su vigencia terminará automáticamente.

Seleccionadas determinísticamente por SKU entre ediciones públicas disponibles con portada CDN. PLG-BK-000042 excluido. No existían ofertas previas, por lo que ninguna promoción fue reemplazada. Plan exacto de SKU, precio base, precio ofertado y fechas en plan.json.

## Verificación

- Preflight de las 23 ediciones: identidad, SKU, formato, disponibilidad, portada asociada, precio base y ausencia de oferta previa.
- Las 23 escrituras devolvieron HTTP 204.
- Detalle de cada edición: precio vigente, precio base, ahorro, porcentaje efectivo, días restantes, señal de terminación próxima y fechas exactas correctos.
- Facetas y 12 combinaciones de los tres filtros de producto y cuatro órdenes: conteos exactos 10/6/7, total 23.
- Carrito real de cuenta fixture: los 23 precios vigentes correctos con cantidad 1; cada artículo se retiró y la cuenta quedó vacía. No se realizó checkout ni se crearon compras.
- Prueba de navegador existente offers.live.spec.ts: 1 aprobada, filtro EBOOK, orden por vencimiento, precios original/actual, vigencia y enlace a detalle.
- Gate SQL de vencimiento con BEGIN/ROLLBACK: las 23 ofertas vencidas dejan de aplicar y cada edición usa su precio base; el rollback conservó íntegramente las 23 ofertas reales, precios y fechas.
- Comparación PostgreSQL antes/después/final: todas las filas de ediciones idénticas, inventario y movimientos idénticos, 23 ofertas nuevas y sin otras modificaciones del catálogo. Se preservan los SKUs, portadas, metadatos, valores DEMO/SIMULATED y registros históricos. La comparación final confirma que las pruebas no retiraron ni alteraron las ofertas guardadas.

Logs completos y resultados en este directorio. Los snapshots completos de verificación permanecen en /tmp/pliego-demo-offers-2026-10-06; gates.json conserva conteos y hashes de las filas de ediciones. Credenciales y tokens no se incluyen en los artefactos.

Estas ofertas están en la base local. Si el despliegue usa una base distinta, los 23 registros de plan.json deben aplicarse mediante la misma API administrativa; un deploy del código por sí solo no copia estos datos.
