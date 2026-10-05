# Auditoría e integración local del lote digital procesado

El ZIP `PLIEGO-Digital-Covers-Processed.zip` se reconstruyó por concatenación binaria de las tres partes, siguiendo `UNIR-WINDOWS.cmd`: 27.117.484 bytes, SHA-256 `b66027e6aabcb73ee387c84b34265786a7800da4f3c8e063ea79906a85567493`. Se verificaron los hashes de las tres partes, CRC de los cuatro ZIP y tamaño/hash de los 864 archivos enumerados en el manifiesto de entrega. El ZIP reconstruido queda en `/tmp/pliego-processed-audit/PLIEGO-Digital-Covers-Processed.zip`.

Se incorporan 259 WebP pendientes: 142 EBOOK y 117 AUDIOBOOK, estáticos RGB de 720 × 1080, sin padding ni EXIF/ICC/XMP, hasta 115.538 bytes. Sus rutas permanecen bajo `covers/generated/digital-batch/pending-images/`, fuera de staging y de los manifiestos publicables. Los 450 JPG originales, inventarios operativos y seis reportes se copian sin alterar sus bytes. Se preservan los 55 registros históricos, 56 asignaciones SKU y siguiente secuencia 57, incluido el SKU reservado/excluido `PLG-BK-000042`.

La extensión suministrada se incorpora únicamente en `scripts/cover_images.py` y `scripts/process-digital-covers.py`, con `scripts/test_reviewed_crop.py`. Exige caja explícita 2:3 en coordenadas de la imagen orientada por EXIF, motivo y SHA-256 de los bytes exactos del archivo original; conserva protección explícita, rechazo de perspectiva, máximo 4× y codificación oficial. Los 19 overrides (11 EBOOK, 8 AUDIOBOOK) se reprodujeron y coinciden exactamente con los hashes de salida. Ninguno de los 191 retenidos tiene override aplicado.

Los documentos originales del ZIP se conservan en [evidence/](evidence/); `PACKAGE-MANIFEST.txt` y `VALIDATION-RESULTS.json` describen el paquete inicial, no la entrega final. La nueva inscripción del lote es `covers/generated/digital-batch/batch-manifest.json`; no sustituye ni modifica `manifest.json`, `manifest-normalized.json` o `sku-registry.json`.

## Fuentes que requieren reemplazo o resolución visual

[fuentes-alternativas-191.csv](fuentes-alternativas-191.csv) contiene una fila por portada, con formato, inventario/fila, título, autor, categoría, URL existente, archivo original, SHA-256, identificador de revisión y motivo visual individual documentado por el lote. No propone ni inventa una fuente alternativa.

Son 83 EBOOK y 108 AUDIOBOOK: 190 `impossible` y un `hold`. El caso retenido, revisión visual 140, **La antropología y el derecho — Léonce Manouvrier (AUDIOBOOK)**, es conservador: el crop propuesto eliminaría parte del suavizado del apellido vertical. Requiere fuente con margen adicional o revisión visual explícita; no se presenta como imposibilidad definitiva. Los otros motivos explican qué texto, sello, borde o elemento protegido perdería cada recorte. El motivo automático agrupa 190 casos sin crop seguro y uno con margen exterior superior al 5 %; la decisión visual individual es la evidencia más precisa.

## Metadatos e importabilidad

El análisis por registro usa `inventory_records` y `metadata_errors` del pipeline actual, y contrasta `AdminCatalogRequests.EditionCreate`, `V032__digital_editions.sql`, ADR-0016 y `load_catalog_seeds`. Los dos CSV conservan exactamente títulos, autores y fuentes de la evidencia.

| Registros con imagen | Campos de staging que faltan | Regla real |
| --- | --- | --- |
| [142 EBOOK](metadatos-pendientes-ebook.csv) | `edicion.editorial`, `edicion.idioma` | Editorial: texto no vacío, hasta 200 caracteres; idioma: 2–3 letras minúsculas para el preflight |
| [117 AUDIOBOOK](metadatos-pendientes-audiobook.csv) | `edicion.editorial`, `edicion.idioma`, `edicion.audioDurationSeconds`, `edicion.narrators` | Duración: entero 1–2.147.483.647; narradores: lista ordenada de 1–32 nombres no vacíos, hasta 200 caracteres cada uno |

`AUDIOBOOK.paginas` ya es null, como exige el esquema. ISBN y fecha son opcionales; EBOOK también permite páginas y `ebookFileFormat` nulos. No se deduce PDF/EPUB de una portada ni se convierte autor en narrador. Editorial e idioma faltan también en las 191 portadas retenidas; sus AUDIOBOOK además necesitan duración y narradores. No se completó ningún campo.

**Importabilidad del catálogo:** completar el preflight bibliográfico no basta. Ninguno de los 259 registros tiene asignación SKU en el registro local, staging aceptado ni entrada digital en el manifiesto normalizado. El importador exige estos vínculos. La API requiere además `bookId`, `publisherId`, SKU e importe positivo hasta 999.999.999,99; los IDs se resuelven contra entidades verificadas, no se deducen del texto. El importador de desarrollo utiliza la constante existente `20.00`: no es precio verificado del lote ni se incorporó al inventario. Para una importación real debe existir precio verificado o una decisión comercial explícita. Licencia/atribución pueden permanecer nulas coherentemente según ADR-0008; la URL de procedencia no demuestra licencia.

Esta auditoría no consultó la BD ni afirma que existan ediciones digitales equivalentes. El registro local no permite relacionar este lote con SKUs existentes. Con la restricción de cero SKUs/ediciones nuevos, todo el lote permanece pendiente: no se puede crear un catálogo digital nuevo simplemente completando sus metadatos.

## Verificación y evidencia

- [reconstruction-verification.json](reconstruction-verification.json): reconstrucción, tamaño y hashes.
- [integration-audit.json](integration-audit.json): hashes de entrega/archivos instalados, decodificación completa, procedencia, coherencia de reportes y reproducción de los 19 overrides.
- [gates.json](gates.json): resultados de la suite de 69 pruebas, replay completo en copia desechable y preservación del estado previo.
- [protected-before.json](protected-before.json): hashes previos de archivos raíz, pipeline y assets existentes; se permite únicamente la actualización documentada de los dos scripts.
- [verify_batch.py](verify_batch.py): gate reproducible de solo lectura sobre paquete y pipeline. Ejemplo con el ZIP extraído fuera del repositorio: `python verify_batch.py --batch-root /tmp/pliego-processed-audit/extracted --pipeline-root /home/andres18123/PLIEGO --output /tmp/pliego-processed-audit/recheck`.

Los logs completos están en `verification/`. Las pruebas de sincronización usan fixtures/mocks; no se ejecutaron los CLI de seed ni upload. La reproducción del procesador se realiza exclusivamente en `/tmp`, manteniendo intactos los resultados y reportes integrados. El código 2 del procesador indica pendientes, no fallo de ejecución. La verificación de decisiones y hashes no sustituye una nueva inspección visual humana. Los hashes de los ZIP de origen son evidencia del lote; no se compararon con archivos de origen no suministrados.

## Siguiente paso

Recabar editorial/idioma para los 450 originales y duración/narradores para los 225 AUDIOBOOK, utilizando los CSV por portada para priorizar los 259 que ya tienen imagen. Obtener fuentes alternativas verificables para los 190 casos imposibles y resolver explícitamente el caso 140. Después verificar la correspondencia con ediciones digitales y SKUs **ya existentes**, así como editorial e importe reales. Si no existen esas ediciones, se necesita ampliar expresamente el alcance para crearlas y asignar identidades: la restricción actual impide esa acción. Con datos y vínculos verificados se podrá preparar staging y repetir gates antes de una futura importación autorizada. No se publicó, subió a R2, ejecutó seed, hizo commit, push ni deploy.
