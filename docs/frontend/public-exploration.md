# Exploración pública de PLIEGO — composición corregida

## Referencias y alcance

Se contrastaron el DOCX local `Google_Store_PLIEGO_Destilacion_UX_UI.docx`, el paquete
`Google_Store_PLIEGO_Evidencias (1).zip` y las referencias HTML/CSS de Google Store
estudiadas en el refactor del Header. Los archivos viven exclusivamente en `/tmp`.
H01/H02 muestran descubrimiento como una fila de productos, con siguiente visible y
anterior disponible después de avanzar. Accessories 02/43/44 separa el título y las
herramientas del listado. Se reproduce esa estructura cuando encaja con la librería;
BookCard, StockStatus, portadas y tokens Mantine siguen siendo autoridad de PLIEGO.

La corrección retira el formulario de búsqueda permanente añadido a Catálogo, la barra
de categorías antes de los resultados, el sidebar de filtros y el límite estrecho de Home.
No se añaden capacidades de API, recomendaciones, novedades ni filtros de disponibilidad.
La metadata de formatos de V031 ya estaba implementada antes de esta corrección.

## Responsabilidades y comportamiento

- Header: navegación global, única búsqueda general, carrito y cuenta. No se rediseña.
- Home: introducción editorial, rail de hasta ocho ediciones reales y temas como enlaces de
  navegación. Sin un CTA genérico que repita el destino global del Header. El rail adapta
  sus tracks con `clamp(208px, 19vw, 224px)` y gaps de 24px en una grilla de flujo por
  columnas, sin columnas explícitas del catálogo. Usa scroll horizontal nativo y snap
  de proximidad; el siguiente producto parcial indica continuidad cuando cabe. Mantiene
  los seis tracks compartidos de BookCard mediante subgrid donde el navegador lo soporta.
  Los controles de 48px solo existen cuando hay desbordamiento: desde 48em están en los
  bordes del rail, con 56px de margen interior para los libros; por debajo están junto al
  título. Anterior se oculta al inicio y siguiente queda inactivo al final. No hay
  autorrotación, controles de densidad ni un segundo paginador.
- Catálogo: una fila de título, contador y herramientas; libros inmediatamente después.
  Mantiene la grilla compartida y la paginación. Consulta/tema/filtros aplicados se expresan
  en una línea textual removible, sin cajas o chips decorativos.
- Filtros: Drawer solo bajo demanda en todos los tamaños. Tema es un grupo de radios de
  selección única, con «Todos los libros» y la jerarquía real de categorías;
  formato/idioma/precio aparecen con variedad útil o para recuperar criterios existentes.
  Tema y formato cambian el mismo borrador, sin navegar hasta «Aplicar filtros»; cerrar
  o Escape lo descarta y reabrir recupera la URL aplicada. «Restablecer filtros» aplica
  inmediatamente la eliminación de tema/formato/idioma/precio, conserva consulta y orden
  y vuelve a la primera página. Aplicar/restablecer cierra el Drawer y devuelve el foco
  a Filtros. El acordeón abre inicialmente Formato cuando existe o el primer grupo útil.
  Las filas de radio tienen 44px de alto mínimo y alineación vertical centrada; el contorno
  sin selección usa `--pliego-control-border`. No se prometen facetas dependientes ni
  conteos por opción.

La búsqueda global conserva el contrato `que` y su destino global. Las URLs antiguas
siguen restaurando query, category, format, language, price, sort, page y pageSize. Cambiar
criterios reinicia page; paginar orienta a resultados sin ocultar el foco tras el Header.
La consulta del Header parte del catálogo general; los criterios aplicados son removibles
en Catálogo, pero no crean otro buscador. La ficha conserva el origen Home mediante
`from`, y el rail guarda `scrollLeft` en `pliegoHomeRailScrollLeft` de la misma entrada
de historial y lo recupera al volver con POP. La restauración vertical existente se
conserva, sin añadir almacenamiento de credenciales ni estado de negocio.

## Comparación explícita antes de entregar

| Pregunta | Resultado en la composición corregida |
|---|---|
| ¿Hay controles repetidos? | No hay buscador en Home/Catálogo: la búsqueda general pertenece al Header. Tampoco se repite el CTA genérico de catálogo en Home. |
| ¿Hay algo visible que no sea necesario todavía? | Los filtros se encuentran dentro del Drawer bajo demanda. No se muestran idioma/precio únicos ni orden de precio sin variedad útil, salvo recuperación de criterios de una URL anterior. |
| ¿Los productos son protagonistas? | Home tiene una fila amplia y continua; Catálogo lleva directamente de título/herramientas a portadas. |
| ¿Home parece descubrimiento y Catálogo exploración? | Rail editorial de muestra frente a grilla densa paginada. Temas son destinos en Home y criterios de selección en filtrado. |
| ¿Se puede quitar algo más sin perder capacidad? | Se retiraron buscador, tabs, sidebar y CTA repetido; quedan orientación, contenido, acceso bajo demanda y recuperación del estado aplicado. |

## Evidencia y límites

Capturas reales: `.impeccable/review/correction` para 320, 375, 768, 1024, 1440 y
1920px en ambos temas, más rail avanzado. El contrato se contrastó con CatalogHomePage,
HomeDiscoveryRail, CatalogControls, CatalogFilters, CatalogPage, EditionGrid,
catalogLayout y exploration CSS, además de HeaderSearch y catalogFacets. La cobertura
automatizada incluye foco, flechas, Tab, Escape, URL/historial y los flujos existentes
de BookCard. El gesto horizontal nativo se cubre mediante emulación touch/CDP; no es una
prueba en dispositivo físico. Este documento no certifica el resultado del rerun final
ni una evaluación humana de lectores de pantalla o de toda la aplicación.
Los baselines aprobados y el Header/BookCard no se reescriben como parte de esta corrección.

Arquitectura y contrato: [ADR-0014](../adr/0014-public-exploration-and-real-catalog-facets.md).

## Verificación final de la corrección

- Build y typecheck correctos; 192 pruebas unitarias en 27 archivos.
- Suite final: 94 E2E aprobadas, sin omisiones, con API/PostgreSQL locales.
- Radios: contorno 3,32:1 light / 3,53:1 dark; centros alineados (0px),
  siete opciones en los seis anchos. Revisión independiente: hallazgo resuelto.
- Touch: eventos de contacto/desplazamiento en Chromium emulado, además de taps,
  navegación por flechas/Tab y retorno desde ficha; no prueba de dispositivo físico.
- Se retiraron el buscador permanente, tabs superiores, sidebar/MQ asociado y CTA
  genérico de Home. Se reutilizaron los seis tracks y controles de BookCard.
- Archivos principales: CatalogHomePage, HomeDiscoveryRail, CatalogControls,
  CatalogFilters, CatalogPage, EditionGrid, catalogLayout.module.css y
  exploration.module.css; pruebas de Home/filtros/exploración/BookCard y
  favorites.live, este documento y ADR-0014. Sin cambios adicionales del API.
