# Implementación de ediciones digitales — 2026-10-03

## Resultado

PLIEGO admite PAPERBACK, HARDCOVER, EBOOK y AUDIOBOOK en PostgreSQL, Database API,
backend, REST/OpenAPI, administración, descubrimiento, facetas, favoritos, carrito
y compra simulada. No se modificó el frontend ni se hizo commit, push o deploy.
Las categorías siguen siendo temáticas; una obra puede tener los cuatro formatos.

## Modelo y reglas

V032 añade a `pliego.edicion` campos tipados: `ebook_formato VARCHAR(8)`,
`audio_duracion_segundos INTEGER`, `audio_narradores TEXT[]`. No se almacena JSON
arbitrario de metadatos. Narradores son nombres ordenados sin identidad separada.

- Físicas: páginas obligatorias, sin metadatos digitales, inventario existente.
- EBOOK: páginas opcionales y tipo EPUB/PDF opcional; sin duración ni narradores.
- AUDIOBOOK: páginas/tipo eBook ausentes; duración positiva y 1–32 narradores.
- Digitales: sin inventario, disponibles con obra y edición ACTIVE, cantidad uno.
- ADMIN devuelve stockActual null para digitales. Inventario digital devuelve P3001.
- Validación de coherencia: P2048; cantidad digital inválida: P4004. Mapeos estables.
- Cambiar entre física y digital requiere otra edición; no se altera el historial.
- Checkout y cancelación mueven/reponen solo stock físico. restoredUnits cuenta
  unidades físicas. Las instantáneas de pedido conservan el formato comprado.

La [enmienda REST](../api-amendments/0007-digital-editions-v1.0.7.md) documenta
campos, endpoints, ejemplos y compatibilidad SQL; [ADR-0016](../adr/0016-digital-editions-and-stockless-availability.md)
registra la decisión. Los endpoints siguen bajo `/api/v1`; OpenAPI se genera en
`/v3/api-docs`. No se regeneraron contratos ni clientes dentro del frontend.

## Archivos de esta implementación

No se incluyen aquí cambios previos del árbol de trabajo.

### Migración y soporte JDBC

- `backend/src/main/resources/db/migration/V032__digital_editions.sql`
- `backend/src/main/java/com/pliego/foundation/database/JdbcArrays.java`

### Catálogo y administración

Bajo `backend/src/main/java/com/pliego/modules/catalog/`:

- `api/AdminCatalogController.java`
- `api/AdminCatalogRequests.java`
- `api/AdminCatalogResponses.java`
- `api/CatalogController.java`
- `api/CatalogEditionDetailResponse.java`
- `api/CatalogEditionSummaryResponse.java`
- `api/PublicCatalogFilterOptionsResponse.java`
- `application/AdminCatalogModels.java`
- `application/CatalogEditionDetail.java`
- `application/CatalogEditionSummary.java`
- `gateway/JdbcAdminCatalogGateway.java`
- `gateway/JdbcCatalogGateway.java`

### Carrito

Bajo `backend/src/main/java/com/pliego/modules/cart/`:

- `api/CartController.java`
- `api/CartResponses.java`
- `application/CartModels.java`
- `gateway/JdbcCartGateway.java`

### Pruebas y runner

- `backend/src/test/java/com/pliego/modules/catalog/api/AdminCatalogApiIntegrationTest.java`
- `backend/src/test/java/com/pliego/modules/catalog/api/CatalogApiIntegrationTest.java`
- `backend/src/test/java/com/pliego/modules/cart/api/CartApiIntegrationTest.java`
- `backend/src/test/postgres18/digital_editions_gate.sql`
- `backend/src/test/postgres18/digital_editions_http_gate.py`
- `backend/src/test/postgres18/run_ci_gates.sh`

### Seeds y portadas

- `scripts/prepare-covers.py`
- `scripts/seed-development-catalog.py`
- `scripts/test_prepare_covers.py`
- `scripts/test_seed_cover_sync.py`
- `covers/README.md`

### Documentación

- `backend/README.md`
- `docs/adr/README.md`
- `docs/adr/0016-digital-editions-and-stockless-availability.md`
- `docs/api-amendments/0007-digital-editions-v1.0.7.md`
- `docs/audit/digital-editions-2026-10-03.md`

## Verificación ejecutada

Entorno: Java 25.0.4.1, PostgreSQL 18.6 nativo. Bases desechables en un cluster
privado bajo `/tmp`; no se migró la BD de la aplicación existente ni se desplegó.

| Verificación | Resultado |
|---|---|
| `mvn -B -f backend/pom.xml verify` | 123 pruebas, cero fallos/errores/omisiones |
| `backend/src/test/postgres18/run_ci_gates.sh` en una BD vacía | 10 gates SQL, 5 de concurrencia, 6 HTTP: todos pasan |
| Flyway desde una BD vacía | 32 migraciones aplicadas y validadas |
| Upgrade V031 → V032 con una edición física preexistente | Conserva PAPERBACK, 123 páginas, USD 12.00, URL y stock 7 |
| Comparación de V001–V019 contra ZIP aprobado | 19 archivos idénticos byte por byte |
| `python3 scripts/test_prepare_covers.py` | 4 pruebas pasan |
| `python3 scripts/test_seed_cover_sync.py` | 7 pruebas pasan |
| `python3 scripts/test_upload_r2_covers.py` | 3 pruebas pasan |
| `git diff --check` en archivos de esta tarea | Sin errores |

El gate HTTP digital usa JDBC y PostgreSQL reales: alta/actualización de los cuatro
formatos, stockActual nullable, búsqueda por obra/autor, filtros públicos y ADMIN,
metadatos ordenados, validaciones españolas, favoritos, retirada/reactivación,
carrito, compra/cancelación y serialización OpenAPI. El gate SQL también cubre
ISBN digital, compra mixta, pago rechazado y protecciones frente a escritura directa.
Los gates previos de inventario, compra, cancelación y concurrencia física pasan.

El runner requiere una base desechable vacía: sus fixtures HTTP quedan persistidos.
Una repetición sobre esa misma BD falla en el gate de categorías por esos fixtures;
la ejecución final se realizó en otra BD limpia y terminó con éxito.

## Fuera de alcance

Frontend y sus clientes generados; almacenamiento de EPUB/PDF o audio; DRM,
streaming/reproductor; progreso de lectura/escucha; entrega y derechos digitales.
El checkout conserva el requisito de dirección y los estados logísticos actuales
como simulación. Ninguna compra digital supone entrega real. Portadas, objetos CDN,
manifiestos existentes y asignaciones SKU se conservan; no se subieron imágenes.
