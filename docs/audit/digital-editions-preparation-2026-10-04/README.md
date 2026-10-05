# Preparación completa de 259 ediciones digitales

Los **259 candidatos tienen datos completos para futura importación/publicación**: 142 EBOOK y 117 AUDIOBOOK, editorial documentada, idioma verificado o inferido inequívocamente, precio DEMO autorizado, identidad resuelta e imagen válida. No quedan bloqueos de datos. Todas las entradas conservan `publication_status=PENDING`: no se crearon registros en BD, no se reservaron SKUs, no se ejecutó seed, no se subió a R2, no se publicó ni se hizo commit, push o deploy.

La disponibilidad de datos para una futura publicación no significa que los objetos estén subidos o las ediciones ya existan en el catálogo. La ejecución posterior debe respetar estas propuestas, revalidar el catálogo y conservar las marcas DEMO; queda fuera de esta fase.

## Identidad de obras y SKUs

[catalog-snapshot-completion.json](catalog-snapshot-completion.json) captura de nuevo el catálogo completo, incluidos estados inactivos, mediante el Database API en una transacción de solo lectura: 63 obras, 65 ediciones físicas, 38 editoriales, 62 autores y 11 categorías. Todas las páginas se contrastaron con los totales. No se utilizó el catálogo público filtrado para declarar ausencia.

Se reutiliza una obra: `bookId=72`, *Matemática estructural*, Andrés Forero Cuervo. Título, subtítulo y autoría coinciden; la inversión literal `Forero Cuervo, Andrés` conserva todos los componentes del nombre. Se preparan **258 propuestas de obras nuevas**, ausentes de la instantánea completa. Ninguna fue creada en BD y su ausencia debe revalidarse antes de la futura creación.

Los dos homónimos *Análisis matemático* quedan resueltos como obras distintas de la de Tom M. Apostol (`bookId=60`): la publicación de Roca Martínez/Jornet/Montesinos está acreditada por el currículo bibliográfico del coautor en la Real Academia de Ciencias y el registro eLibro exacto de UNS; la de Yu Takeuchi, por el catálogo de Editorial UNAL y su registro eLibro exacto. Las fuentes se conservan por candidato en [verified-metadata.json](verified-metadata.json). No se hicieron fusiones aproximadas ni se reutilizó la obra de Apostol.

Se conservan los **259 SKUs propuestos**, `PLG-BK-000057`–`PLG-BK-000315`. El asignador actual solo se ejecuta en una copia temporal; las claves de fuente mantienen la propuesta al completar metadatos. El registro propuesto contiene las 56 asignaciones previas intactas y 259 propuestas; el registro activo conserva secuencia 57. No se reservó ninguna identidad. Las listas de autores provienen literalmente de los inventarios y mantienen su texto original y orden; las referencias exactas de Andrés Forero Cuervo y Jane Austen conservan sus identidades existentes.

## Editorial e idioma

Se consultaron primero inventarios y URLs originales. Estas URLs institucionales requieren autenticación, pero se localizaron catálogos públicos de bibliotecas, editoriales y proveedores de las mismas obras. **239 candidatos** tienen evidencia de metadatos en registros UNS vinculados mediante el ID eLibro exacto. Los restantes se completan con editoriales legibles en la portada original y fichas o muestras públicas cotejadas por título, autoría, editor y cubierta. No se transfieren datos de un libro homónimo ni se asignan ISBN de presentaciones distintas.

Las **259 editoriales** tienen fuente documentada. Los **254 idiomas verificados** tienen campo bibliográfico explícito o MARC; los **cinco idiomas inferidos inequívocamente** se sustentan en texto interior o índice suficientemente explícito de muestras editoriales de la misma obra, nunca en el título aislado. Véase [metadata-research-summary.json](metadata-research-summary.json).

La evidencia por campo conserva URL o ruta original, extracto, fundamento y hash de captura. Los hashes de respuestas HTML se diferencian de los hashes de capturas JSON de herramientas. Los cuerpos completos consultados permanecen bajo `/tmp/pliego-digital-completion/`; el repositorio conserva los datos bibliográficos pertinentes y sus referencias, sin duplicar publicaciones completas.

Las discrepancias de investigación se conservan como `research_limitations`, no se ocultan ni se cuentan como bloqueo una vez corroborados los campos requeridos. Entre ellas: reimpresión frente a edición en *Filosofía de la ciencia*; registro audiovisual frente al libro en *Historia mínima de los feminismos*; idioma English contradictorio en UNS para *La geometría del universo*, resuelto con ficha de la misma edición en español, ISBN/cubierta/autor cotejados con Catarata; discrepancia de ISBN en el descubridor de *Revolución artificial*, sin transferir esos ISBN al staging. En este último caso el registro detallado enlaza el eLibro ID 298017 exacto y declara Español.

## Datos DEMO y contrato V032

Los **259 precios** son `SIMULATED/DEMO`, en USD, conforme a [demo-price-authorization.json](demo-price-authorization.json). El algoritmo usa SHA-256 del prefijo versionado, formato e identificador estable: EBOOK entre 4.99 y 24.99 USD; AUDIOBOOK entre 7.99 y 34.99 USD, siempre con dos decimales. No se presentan como precios comerciales ni se copia la constante `20.00` del seed de desarrollo. [price-demo.csv](../../../covers/generated/digital-batch/editions/audit/price-demo.csv) separa estos valores de los metadatos bibliográficos.

Se conservan exactamente la duración y los narradores DEMO de los **117 AUDIOBOOK**, autorizados en [demo-authorization.json](demo-authorization.json). Duración: `900 + int(SHA256(UTF8("PLIEGO-DEMO-AUDIO-v1" + salto_de_línea + candidate_id)).hexdigest()[:8], 16) % 6301`; narrador: `Narrador DEMO PLIEGO (sin identidad bibliográfica)`. No se afirma que los datos reales no existan tras la autenticación institucional. [audio-demo.csv](../../../covers/generated/digital-batch/editions/audit/audio-demo.csv) mantiene la auditoría separada. Toda entrada con precio o audio DEMO exige conservar el rótulo de demostración en una futura presentación pública.

ISBN y `ebookFileFormat` permanecen null cuando no están disponibles. EBOOK admite ambos campos y páginas null; AUDIOBOOK mantiene páginas y `ebookFileFormat` null. No se generan filas ni cantidades de stock digital. La comprobación V032 de solo lectura valida los 259 formatos, idioma, precio, editorial y unicidad de SKU; no ejecuta comandos de creación.

## Artefactos y verificación

- [manifest-pending.json](../../../covers/generated/digital-batch/editions/manifest-pending.json): 259 candidatos pendientes y 259 identificadores listos para futura importación/publicación.
- [staging](../../../covers/generated/digital-batch/editions/staging/): 18 grupos con `libros`, identidad, metadatos, provenance, marcas DEMO y referencia al WebP original.
- [sku-registry-proposed.json](../../../covers/generated/digital-batch/editions/sku-registry-proposed.json): propuestas sin reserva ni modificación del registro activo.
- [manifest-cover-proposed.json](../../../covers/generated/digital-batch/editions/manifest-cover-proposed.json): contrato v2/hash; URLs propuestas, sin objetos subidos ni publicados.
- [prepared-candidates.csv](../../../covers/generated/digital-batch/editions/audit/prepared-candidates.csv): datos y estado por edición.
- [blockers.csv](../../../covers/generated/digital-batch/editions/audit/blockers.csv) y [price-missing.csv](../../../covers/generated/digital-batch/editions/audit/price-missing.csv): solo cabecera, cero bloqueos y cero precios faltantes.
- [gates.json](gates.json): suite completa de 87 pruebas, V032 de solo lectura, coherencia de staging/manifiestos, precios deterministas, audio conservado, SKUs estables y preservación de baseline, originales y 55 registros históricos. Logs completos en `verification/`.

El staging y los manifiestos propuestos permanecen bajo `generated`, excluidos del descubrimiento activo. El seed de desarrollo rechaza staging pendiente o con `preparacion`, evitando perder referencias de obra, precios o marcas DEMO. La futura ejecución debe utilizar los comandos REST/Database API existentes con un importador que preserve esa información; no se implementa ni ejecuta en esta fase. Véase [ADR-0023](../../adr/0023-pending-digital-edition-preparation.md).

Los 191 `REVISION_ENCUADRE` no se procesaron ni modificaron. Los logs previos de otras fases se conservan como evidencia histórica; el gate `completion` describe el estado final vigente.
