# Catálogo físico de 180 libros y pruebas Python

Se importaron **180 ediciones PAPERBACK nuevas y 180 obras nuevas**, sin reutilizar ni modificar obras anteriores: 30 libros por cada categoría solicitada. Los SKUs permanentes son **PLG-BK-000316–PLG-BK-000495**. Se conservaron las 315 asignaciones anteriores y la exclusión de PLG-BK-000042.

Los 128 PRINT ISBN observados se conservaron; los 52 identificadores DEMO se guardaron con `isbn13=null` y la identidad fallback del asignador oficial. Precio, encuadernación, idioma, páginas y existencias académicas llevan procedencia SIMULATED/DEMO explícita. Las descripciones públicas incluyen esta condición. Los originales y toda la procedencia están en `covers/Fisicos180/`.

Se publicaron **180 WebP de 720×1080** con hash en `covers/editions/v2/`. El pipeline oficial requirió 84 decisiones de encuadre vinculadas al hash original. Las miniaturas de origen son de 220×320; algunas ya contienen texto junto al borde o cortado en origen. Se preservaron íntegros los originales, sin reconstruir texto. Las hojas de contacto muestran originales y salidas finales. R2 y CDN verificaron los 180 objetos; los 314 objetos anteriores pasaron las comprobaciones de preservación.

El manifiesto normalizado final contiene **494 registros: 235 físicos, 142 EBOOK y 117 AUDIOBOOK**. Sus 55 registros físicos históricos y los 259 digitales permanecen idénticos. El catálogo ADMIN conserva las 324 ediciones y 321 obras anteriores, más las 180 nuevas; también conserva autores, editoriales, categorías y stock anteriores.

- [Recibos de importación](import-receipts.json), [asignaciones SKU](sku-assignment-report.json), [R2](r2-upload.json) y [CDN](cdn-verification.json).
- [Verificación de detalles](detail-verification.json): 180 formatos, ISBN, metadatos, categorías, disponibilidad y stock comprobados.
- [Carrito](cart-verification.json): agregar, actualizar y eliminar en seis categorías; carrito previo restaurado e inventario preservado.
- [Pruebas físicas](focused-physical-final.log): **20 aprobadas**. [Suite Python global](global-python-final.log): **115 aprobadas**. CI instala `scripts/requirements-covers.txt` en un entorno aislado y ejecuta descubrimiento global. Las pruebas comparan identidades/SKUs y preservación, con fixtures sintéticos aislados y rechazo del staging digital especializado por el seed físico genérico.
- [Preservación del trabajo concurrente](concurrent-preservation.json): ningún archivo protegido fue editado por esta tarea; 17 de los 81 archivos capturados avanzaron por trabajo concurrente.

**Bloqueo existente de integración:** las seis verificaciones HTTP de búsqueda/filtro devuelven 500. El backend usa llamadas JDBC de 12/10 argumentos y la base está en Flyway 044, con firmas de 11/9 argumentos. Ambas rutinas anteriores funcionan directamente. La adaptación corresponde a `JdbcCatalogGateway.java` y `V046__storefront_navigation_and_help.sql`, archivos del trabajo concurrente que no se editaron. [Diagnóstico y reproducciones de solo lectura](existing-backend-integration/integration-issue.json).

El usuario observó dos arranques: primero fallido y segundo exitoso. El log disponible conserva el segundo, exitoso; no permite atribuir el primer error a la causa del HTTP 500. Un log separado registra un error sintáctico anterior en V046, ya corregido en el código concurrente, sin demostrar que fuera aquel arranque.

La primera verificación R2 encontró un TypeError del cliente Python 3.14. La revalidación aislada con Python 3.13 aprobó R2/CDN; ese proceso terminó después de 113 recibos de importación. La fase ADMIN se reanudó idempotentemente desde los recibos de portadas exactos y completó los 180, con preservación posterior verificada. Estos fallos locales quedaron recuperados y sus logs están conservados.

No se hizo commit, push, despliegue de aplicación ni cambios frontend, de migraciones o del trabajo de navegación/biblioteca digital.
