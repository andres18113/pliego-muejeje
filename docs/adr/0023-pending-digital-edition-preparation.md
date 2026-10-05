# ADR-0023: Preparación pendiente de ediciones digitales con identidad verificable

## Status

Accepted para la preparación local solicitada — 2026-10-04. No autoriza importación ni publicación.

## Decision Drivers

- Preparar 142 EBOOK y 117 AUDIOBOOK sin modificar catálogo, SKUs existentes o los 55 registros históricos.
- Distinguir metadatos reales, ausencia de evidencia y demostraciones académicas.
- El seed de desarrollo usa un precio constante y no consume referencias explícitas de obra ni provenance DEMO.

## Considered Options

1. Introducir candidatos incompletos en staging activo y ejecutar el preparador sobre el registro SKU principal.
2. Mantener borradores pendientes fuera del descubrimiento activo y proponer SKUs con el asignador existente en una copia desechable.

## Decision Outcome

Se utiliza la segunda opción. `covers/generated/digital-batch/editions/` conserva staging con `libros`, metadatos de `preparacion`, manifiestos pendientes y registro SKU propuesto independiente. Las propuestas no reservan identidades. El asignador actual determina los nuevos `PLG-BK-*`; sus 56 asignaciones anteriores se conservan exactamente. Las propuestas mantienen su SKU por clave de fuente al actualizar metadatos.

La identidad de obra utiliza una instantánea completa de todos los estados, obtenida mediante el Database API en transacciones de solo lectura. Solo se acepta igualdad de título, subtítulo y autoría ordenada tras normalización NFC, mayúsculas/espacios e inversión literal `Apellidos, Nombres`. Una semejanza ortográfica puede retener un candidato, nunca fusionarlo. La ausencia de título en esa instantánea permite proponer una obra nueva; debe revalidarse contra el catálogo antes de crearla. Los homónimos de título y correspondencias no únicas permanecen pendientes.

Cada campo conserva su procedencia. Editorial necesita evidencia bibliográfica; idioma se verifica o se infiere únicamente a partir de contenido inequívoco, nunca del título aislado. No se heredan datos de una edición distinta sin corroboración. El usuario amplió expresamente el alcance para permitir precio académico `SIMULATED/DEMO` en USD, sin necesitar precios comerciales. Los precios y los valores AUDIOBOOK de demostración requieren habilitación explícita, son deterministas y se marcan `SIMULATED/DEMO` en staging y auditoría. La importación futura debe conservar esas marcas y la presentación pública debe diferenciarlos de datos bibliográficos y precios comerciales reales. V032 conserva su contrato tipado; no se añaden columnas ni inventario digital.

El seed de desarrollo rechaza este staging pendiente antes de construir seeds, para evitar sustituir precios deterministas con `20.00` o perder identidad/provenance. La futura importación necesita un ejecutor que respete `bookId`, creación de obras confirmadas y los precios/valores DEMO autorizados; debe utilizar los comandos existentes del Database API a través de servicios Spring. Esta fase prepara los datos y no implementa ni ejecuta ese importador.

## Validation

Pruebas de correspondencia exacta, retención de homónimos/variantes, conservación de autores, asignación SKU nativa en copia, estabilidad de propuestas, falta de precio/fuente, DEMO opt-in y rechazo del seed pendiente. Gates de hashes, manifiestos, separación de los 191 encuadres y validación V032 de solo lectura. Los metadatos faltantes son bloqueos de publicación explícitos.
