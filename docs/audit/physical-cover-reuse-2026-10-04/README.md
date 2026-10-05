# Reutilización de portadas digitales en ediciones físicas existentes

Auditoría de solo lectura del 4 de octubre de 2026 (fecha local): **65 ediciones físicas existentes** —55 del catálogo y 10 fixtures— comparadas con **259 ediciones digitales publicadas**. No se procesaron los 191 registros retenidos. No se crearon ediciones, no se alteró PostgreSQL y no se escribió en R2.

**Resultado: 1 coincidencia exacta de obra, 0 sustituciones recomendadas, 65 portadas conservadas.** Las diez fixtures no tienen portada y tampoco una fuente digital coincidente; conservar significa mantener su valor actual nulo.

La única pareja elegible por identidad es «Matemática estructural», Andrés Forero Cuervo:

| Campo | Física actual | Digital candidata |
|---|---|---|
| SKU | PLG-BK-000046 | PLG-BK-000063 |
| editionId | 72 | 254 |
| bookId | 72 | 72 |
| Dimensiones | 600 × 900 | 720 × 1080 |
| SHA-256 | 16e1f40ce870cec82ad24066d14e1fbd3cd5731e099f04babf0f21885fdf6171 | e67d4964b228d5d977646edaeea3a96fa94cd07a2305dec08aef94134feb5825 |
| Recomendación | KEEP_CURRENT | No copiar |

La inspección de ambas imágenes con `view_image` muestra que la física conserva letras más nítidas en título, autor y pie editorial. Ambas preservan título, autoría, Universidad de los Andes y márgenes; no hay una mejora de recorte que compense la menor claridad de la digital. El tamaño nominal mayor no implica más detalle.

Como evidencia complementaria, la varianza del Laplaciano de luminancia con ambas imágenes a 600 × 900 fue: título 1054,23 frente a 338,62; autor 1575,32 frente a 175,19; editorial 1843,65 frente a 90,55. Este indicador apoya la inspección visual y no decide por sí solo la calidad. Los dos objetos CDN respondieron 200, image/webp, caché immutable y bytes idénticos a sus espejos locales.

Una copia técnicamente posible conservaría los mismos bytes digitales y usaría **un objeto propio del SKU físico**:

`covers/editions/v2/PLG-BK-000046-e67d4964b228.webp`

`https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000046-e67d4964b228.webp`

Esta clave es hipotética y **no está recomendada, creada ni asignada**. Nunca se debe apuntar la edición física al objeto `PLG-BK-000063` de la edición digital.

Se rechazan dos parejas con el título «Análisis matemático»: la física PLG-BK-000028 es de Tom M. Apostol; PLG-BK-000171 es de Alicia Roca Martínez, David Jornet y Vicente Montesinos Santalucia; PLG-BK-000200 es de Yu Takeuchi. Son autorías y bookId distintos.

Los metadatos y URLs de las 65 ediciones físicas coinciden con `editions-before.json`. Se observaron cambios ajenos a esta auditoría en stock: PLG-BK-000053, 4 → 2; PLG-BK-000011, 2 → 0. No afectan la identidad ni las portadas.

Archivos: [mapping JSON](physical-cover-reuse-mapping.json), [mapping CSV](physical-cover-reuse-mapping.csv), [colisiones rechazadas](rejected-title-collisions.json), [comprobación CDN y nitidez](candidate-cdn-and-sharpness.json). Las instantáneas de libros y ediciones obtenidas por ADMIN GET y `build-audit.py` permiten reproducir la comparación; no contienen credenciales ni tokens.
