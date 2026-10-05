# Publicación e importación del lote digital

Se publicaron **259 objetos R2 nuevos** y se importaron **142 EBOOK + 117 AUDIOBOOK** mediante los endpoints ADMIN existentes. El manifiesto activo contiene **314 registros**: 55 históricos intactos más 259 digitales. El registro SKU conserva sus 56 asignaciones anteriores, incluida `PLG-BK-000042`, y añade `PLG-BK-000057`–`PLG-BK-000315`; siguiente secuencia 316.

## Preflight y ejecución

El preflight local decodificó los 259 WebP, verificó tamaño 720 × 1080, RGB estático, límite de peso, hashes, staging, valores DEMO, unicidad de SKUs y correspondencia con el manifiesto. El preflight remoto encontró exactamente los 55 objetos históricos, cero claves nuevas existentes y cero colisiones de los nuevos SKUs en la API ADMIN. `PLG-BK-000042` estaba reservado y excluido, sin edición en BD, y permanece así.

El uploader existente recibió únicamente los 259 assets seleccionados. Su verificación permite las 55 claves históricas explícitas bajo el prefijo compartido, sin subirlas, sobrescribirlas ni eliminarlas. Los 259 objetos nuevos tienen metadato `sha256`, `Content-Type: image/webp` y `Cache-Control: public, max-age=31536000, immutable`. Sus URLs públicas responden 200 y sus bytes coinciden con los archivos locales. Las cabeceras/metadatos/ETag/fecha de los 55 históricos se compararon antes y después.

La primera comprobación pública encontró el error Cloudflare 1010 para el User-Agent predeterminado de Python, tanto en imágenes nuevas como históricas. Se detuvo la importación. Una petición normal de navegador devolvió 200 con hash y cabeceras correctos. Se ajustó únicamente el verificador HTTP y se añadió una prueba RED→GREEN. La reejecución omitió los 259 objetos ya correctos y verificó el lote completo; no se cambió Cloudflare ni la aplicación. [r2-first-upload.json](r2-first-upload.json) registra 259 altas; [r2-upload.json](r2-upload.json) registra la revalidación con 259 omisiones y 259 verificaciones.

Se aprovisionó un ADMIN dedicado con el mecanismo original V010, sin editar esa migración. Sus credenciales se guardan fuera del repositorio en `/home/andres18123/.config/pliego/digital-admin.env`, modo 0600. La contraseña nunca se registró en estos reportes. Después se autenticó mediante `/api/v1/auth/login`.

`scripts/publish_digital_editions.py` adapta el flujo REST existente, conserva el precio de staging y sus campos digitales, respeta la referencia de obra reutilizada y vuelve a comprobar identidades antes de crear. No ejecuta el seed de desarrollo, no usa su precio constante, no retira fixtures, no reactiva registros ajenos y no llama a inventario. Los recibos se guardan por SKU después de cada comando. Un SKU coincidente se omite; una discrepancia aborta sin sobrescribirlo.

## Datos conservados

Los 259 precios y las 117 duraciones/listas de narradores conservan exactamente sus valores DEMO. Las marcas `SIMULATED/DEMO`, fuentes, algoritmos y límites se mantienen en staging activo, manifiesto y [import-receipts.json](import-receipts.json). Los campos numéricos de la API conservan los valores; la provenance permanece vinculada por SKU en estos artefactos. Su presentación futura debe conservar el rótulo DEMO. No se añadieron campos al contrato REST ni se modificó el frontend.

Los nuevos staging y sus imágenes se activaron bajo `covers/Ebook/` y `covers/Audiolibros/`, usando las claves de fuente previstas. El pipeline descubre ahora 21 archivos de staging, 315 registros fuente y 315 imágenes, sin huérfanos ni conflictos; el registro histórico excluido sigue fuera del manifiesto publicable. Se materializan los objetos versionados bajo `covers/generated/r2-normalized/`. No se alteraron los originales JPG, los 191 `REVISION_ENCUADRE`, los reportes originales ni los assets históricos.

## Validación posterior

- **259 detalles y búsquedas API**, valores, formatos, disponibilidad y URLs concordantes.
- **Filtro EBOOK: 142; AUDIOBOOK: 117**. Catálogo público total: 314.
- **259 operaciones de carrito** con cantidad 1, precio y portada correctos; disponibilidad positiva y sin logística física. Se probó rechazo de cantidad 2 para ambos formatos. Cada artículo se eliminó del carrito de la cuenta sintética dedicada; el carrito final queda vacío. No hubo checkout ni cambios de stock.
- **Cero filas de inventario digital**, confirmado mediante consulta de solo lectura.
- **55 registros históricos y 56 asignaciones SKU previas conservados**, con `PLG-BK-000042` aún reservado/excluido.
- **93 pruebas de scripts aprobadas**, incluidos precio/identidad, ausencia de inventario, idempotencia y preservación de objetos históricos.

Los resultados se encuentran en [gates.json](gates.json), [api-verification.json](api-verification.json), [cdn-verification.json](cdn-verification.json) y `verification/`. No quedan bloqueos. No se hizo commit, push ni deploy de la aplicación.
