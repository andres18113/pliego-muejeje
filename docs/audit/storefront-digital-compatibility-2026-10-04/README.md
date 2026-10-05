# Compatibilidad del storefront físico y digital

Validación local del 4 de octubre de 2026. Sin commit, push ni deploy; sin nuevas ediciones físicas, cambios de portadas ni escrituras en R2. No se procesaron los 191 REVISION_ENCUADRE.

## Causa y corrección

El backend V032 devuelve PAPERBACK, HARDCOVER, EBOOK y AUDIOBOOK, también en las facetas globales de una búsqueda de libros físicos. Los esquemas del cliente admitían solo los dos formatos físicos y rechazaban la respuesta completa. Se amplió el contrato compartido de formatos en catálogo, facetas, favoritos y carrito, conservando campos digitales cuando están presentes. Duración y narradores se validan para AUDIOBOOK; las respuestas físicas anteriores pueden omitir los campos digitales. El detalle conserva su etiqueta previa para formatos futuros no reconocidos.

Los filtros y URLs preservan EBOOK/AUDIOBOOK. Detalle y tarjetas consultan el carrito y evitan una segunda unidad digital; el carrito muestra cantidad 1 y conserva los selectores físicos. P4004 se reconoce como motivo de disponibilidad, pero los errores de comando conservan título/detalle del servidor: un error de cantidad física no recibe un mensaje digital.

## Navegación acordada

Cabecera desktop centrada con exactamente Libros, eBooks, Audiolibros y Ofertas; sin categorías temáticas. Logo a la izquierda, búsqueda/carrito/cuenta a la derecha. Menú compacto con los mismos destinos, cierre y recuperación del foco mediante teclado.

Libros abre /catalog sin filtro de formato. eBooks y Audiolibros aplican EBOOK y AUDIOBOOK. Ofertas abre /ofertas y comunica que todavía no existen promociones; los precios DEMO no se presentan como descuentos. Tu próxima lectura comparte esos cuatro destinos, consultas por formato y estado vacío de ofertas. Las categorías del catálogo siguen disponibles en sus filtros.

## Verificación

- 45 archivos / 397 pruebas unitarias aprobadas.
- npm run build: typecheck y build Vite aprobados.
- 38 pruebas de navegador aprobadas para catálogo y cabecera, con dos workers: Home, paginación, detalle, búsqueda, filtros, autenticación, carrito, navegación, foco y anchos 320–1920 px en temas claro y oscuro.
- Dos pruebas con la API real: catálogo/búsqueda/filtro/detalle de los cuatro formatos; Home, Tu próxima lectura y Ofertas; compra mediante carrito físico/EBOOK/AUDIOBOOK, segunda adición digital idempotente y limpieza de los artículos de la cuenta fixture.
- Inspección visual desktop 1440 px y móvil 390 px: cuatro destinos correctos y scrollWidth igual al viewport.
- git diff --check en los archivos modificados por este alcance: aprobado.
- Revisión independiente: sin fallos concretos ni bloqueos; resultado en review.txt.

La primera ejecución masiva con 16 workers cerró sesiones de Chromium; la ejecución completa con dos workers aprobó las 38 pruebas. Se corrigieron las aserciones antiguas de Catálogo/breakpoint y se verificó el mensaje de error físico P4004. Las aserciones antiguas de pedido, ajenas a este alcance, ya coincidían con la pantalla actual al repetir la suite unitaria.

El detector Impeccable se ejecutó una vez y devolvió tres advertencias de CSS previo: transición de altura/margen del sticky header, transición de ancho de los puntos del carrusel y un selector sin uso del antiguo menú temático. Se conservaron los comportamientos previos del sticky header y carrusel; las capturas finales verifican el resultado visible.

## Portadas físicas

Auditoría completa: ../physical-cover-reuse-2026-10-04/README.md y physical-cover-reuse-mapping.json/csv. 65 ediciones físicas inspeccionadas, 259 digitales comparadas: una coincidencia inequívoca de obra y cero sustituciones recomendadas. Matemática estructural comparte bookId 72; la portada física PLG-BK-000046 es más nítida que la digital PLG-BK-000063, por lo que se conserva. Dos coincidencias de título Análisis matemático se rechazan por distinta autoría/obra. Cualquier copia futura exige identidad exacta, mejora comprobable y clave CDN del SKU físico. Se preservan los 55 registros históricos y PLG-BK-000042.

Los logs completos y capturas quedan junto a este documento. No hay bloqueos restantes para este alcance local.
