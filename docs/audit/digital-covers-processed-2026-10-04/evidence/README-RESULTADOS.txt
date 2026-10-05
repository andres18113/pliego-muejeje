PLIEGO — resultado final del procesamiento digital (2026-10-04)

450 originales procesados. Se generaron 259 WebP nuevos, todavía pendientes
por metadatos: 142 EBOOK y 117 AUDIOBOOK. Quedan 191 casos de encuadre.
La ejecución oficial terminó con código 2 (pendientes), sin errores de ejecución.
Las 69 pruebas pasaron: 49 originales y 20 de la extensión de recortes revisados.
La auditoría final independiente pasó sus 7479 comprobaciones.

ESTADOS EXCLUYENTES POR FORMATO
EBOOK: 225 originales; ACEPTADO 0; METADATOS_PENDIENTES 142;
REVISION_ENCUADRE 83; FUENTE_INSUFICIENTE 0; PESO_EXCEDIDO 0; ARCHIVO_INVALIDO 0.
AUDIOBOOK: 225 originales; ACEPTADO 0; METADATOS_PENDIENTES 117;
REVISION_ENCUADRE 108; FUENTE_INSUFICIENTE 0; PESO_EXCEDIDO 0; ARCHIVO_INVALIDO 0.

Todos los 259 WebP nuevos son estáticos, de 720 x 1080, sin padding y de
como máximo 204800 bytes. Están en covers/generated/digital-batch/pending-images/.
Los 55 WebP históricos normalizados conservan sus 600 x 900 originales.

REVISIÓN VISUAL Y RECORTES AUTORIZADOS
La primera ejecución produjo 240 WebP y dejó 210 casos visuales. Se revisaron
individualmente los 210 originales. El resultado final fue: 19 recortes seguros
aprobados (11 EBOOK y 8 AUDIOBOOK), 190 casos sin solución segura verificada
y 1 caso retenido por precaución. Los 19 aprobados se incorporaron mediante
la extensión mínima autorizada del pipeline, con caja exacta, motivo y SHA-256
vinculado a cada original. Así se pasó de 240 a 259 imágenes y de 210 a 191
pendientes de encuadre. Las imágenes originales no se alteraron.

El caso ID 140, La antropología y el derecho (Léonce Manouvrier, AUDIOBOOK),
es una retención conservadora: el recorte propuesto eliminaría parte del
suavizado de los trazos del apellido vertical. No se cuenta como imposible
confirmado. El CSV archivos-irresolubles.csv contiene los 191 sin salida:
190 visual_decision=impossible y 1 visual_decision=hold, separados expresamente.

METADATOS Y PUBLICACIÓN
Faltan editorial e idioma en los 450 registros. En AUDIOBOOK también faltan
duración y narradores. Esto afecta a los casos REVISION_ENCUADRE igualmente,
aunque su estado principal muestre primero el problema visual. No se inventaron
metadatos. Ninguna de las 450 ediciones está lista para seed o publicación.

SKUs nuevos: 0. Registro histórico: 56 asignaciones; siguiente secuencia: 57.
El manifiesto normalizado conserva 55 registros y sus 55 objetos v2.
PLG-BK-000042 sigue reservado y excluido del manifiesto normalizado.
No hay staging digital aceptado. Los 259 registros con imagen están en
pending_records del reporte, separados de los 55 registros históricos.

ARCHIVOS PRINCIPALES
covers/generated/digital-batch/reports/normalization-report.json y .csv:
  reporte oficial con los 450 estados, geometría, pesos, hashes y metadatos.
covers/generated/digital-batch/reports/revision-manual.csv:
  lista actualizada de 450 pendientes con título, autor, fuente y motivos.
covers/generated/digital-batch/reports/archivos-irresolubles.csv:
  191 casos de encuadre; distingue 190 imposibles y 1 retención conservadora.
covers/generated/digital-batch/reports/overrides-revisados.json:
  19 recortes ya aplicados, con caja exacta, motivo y SHA-256 del original.
covers/generated/digital-batch/reports/decisiones-visuales-210.json:
  las 210 decisiones visuales finales, con motivos individuales y hashes.
patch/reviewed-crop.patch y patch/README-PATCH.txt:
  cambio mínimo, ya aplicado, y documentación de uso y pruebas.
VALIDATION-PROCESSED.json, FINAL-AUDIT-PORTABLE.json y TESTS-69.txt:
  verificaciones del procesamiento final, auditoría independiente y 69 pruebas.

INTEGRIDAD Y ESTRUCTURA
Los 450 JPG originales están intactos bajo covers/Ebook/ y covers/Audiolibros/:
225 por formato, nueve categorías de 25. Se incluyen una sola vez.
Los inventarios operativos conservan título, autor, Archivo y Fuente; sus rutas
son relativas al inventario y añaden los tres campos de recorte revisado.
Ebook/Fuente se recuperó por unión exacta con fuentes.csv del lote original.
Los cuatro archivos de procedencia están en provenance/Ebook/ y
provenance/Audiolibros/, sin duplicar las imágenes originales.

Se conservan los 136 archivos del paquete original, con únicamente las tres
modificaciones autorizadas: README-DOTS.md y los dos scripts de producción.
Se añade test_reviewed_crop.py. PACKAGE-MANIFEST.txt y VALIDATION-RESULTS.json
se conservan como documentos HISTÓRICOS del paquete inicial (136 archivos,
49 pruebas); no describen todo este ZIP. DELIVERY-MANIFEST.json enumera y
calcula los hashes SHA-256 de la entrega actual, excepto el propio manifiesto.

El ZIP contiene 370 WebP: 56 fuentes físicas históricas + 55 normalizados
históricos + 259 digitales pendientes. Se omiten .venv, cachés, locks,
contact sheets y las 56 copias redundantes generated/r2 creadas por el pipeline,
que no existían en el paquete recibido. generated/manifest.json sigue siendo
el manifiesto histórico, conservado sin cambios; no es una lista de publicación.
La autoridad histórica de publicación es covers/generated/manifest-normalized.json
y r2-normalized/. Las 259 imágenes nuevas aún no son publicables.

No se realizó subida a R2, seed, acceso a BD, cambio de backend/frontend,
commit, push ni deploy. Este ZIP contiene únicamente resultados locales.
Para extraer, usa una ruta corta; el pipeline requiere Python 3.12+ en Linux/WSL.
