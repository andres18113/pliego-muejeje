# Reconstrucción de la storefront pública de PLIEGO

La composición pública se reconstruyó desde las capturas y medidas de Google Store.
La entrega usa React/Mantine, Roboto Flex, Material Symbols, la paleta PLIEGO vigente
y datos reales del catálogo. No hubo commit, push ni deploy.

## Superficies reconstruidas

- Header: cápsula de 1392 px como máximo, 60/52 px de alto, 12 px desde el borde superior,
  breakpoint de navegación en 1280 px y sombra que aparece con scroll.
- Categorías: mega-menú de enlaces con cuatro portadas, grupos y un destino de categoría;
  hover con demora, click y teclado en escritorio. Menú con nivel de retroceso en compacto.
- Búsqueda: reemplaza temporalmente la navegación del header; una sola consulta global,
  sugerencias reales con debounce, flechas, Enter, Escape y foco restaurado.
- Home: hero editorial con tres portadas reales, una acción hacia catálogo, rail de ocho
  ediciones y entradas visuales a las categorías. No se atribuyen popularidad ni novedades
  a datos que el servidor solamente ordena por título.
- Catálogo: tres columnas desde 600 px, dos por debajo; productos inmediatamente después
  del título y herramientas útiles. Superficies rectangulares para catálogo y retratos
  redondeados para el rail. Gaps de 24 px, portadas contenidas y precio/stock reales.
- Facetas: lateral plegable desde 1024 px, selección inmediata para categoría/formato/idioma;
  precio validado con acción explícita. Drawer con borrador y cancelación en compacto.
  Orden visible si aporta una diferencia real o debe recuperar un criterio de la URL.

## Simplificación y eliminación

Se retiró `CategoryDirectory.tsx` y su listado textual de temas. Se sustituyeron la
introducción textual anterior, los estilos completos del header y la composición de
`exploration.module.css`. Se eliminaron las variantes CSS `showcase` y siete reglas
obsoletas de búsqueda, filtros y resultados en `styles.css`. La ruta activa usa color
en la navegación; no una cápsula pequeña añadida para señalarla. El criterio mostrado
como título tiene su acción para quitarlo al lado y no se vuelve a escribir como etiqueta.

El BookCard público tiene una presentación propia, con los mismos controladores de
favoritos/carrito y el mismo modelo de disponibilidad. El ojo decorativo, subrayado
permanente, bordes de favoritos y badges de stock de la presentación anterior no se
trasladaron al listado nuevo. Esa presentación se conserva en favoritos y diagnóstico.

## Patrones de Google y diferencias justificadas

Se reprodujeron la cápsula, proporciones y radios del header, la transición de sombra,
la sustitución por búsqueda, la geometría del panel, el menú compacto por niveles,
la escala de títulos 60/68 y 48/56 en escritorio y 32/40 y 28/34 en compacto, el hero
comercial, los rails horizontales y la separación entre facetas y productos.

Las portadas sustituyen las fotos/vídeos de dispositivos. Solo se muestran categorías
reales, con los destinos disponibles; no se inventaron columnas comerciales para llenar
el panel. Los filtros son de selección única porque ese es el contrato existente.
Título/precio mantienen su orden soportado; no se simulan Featured/Newest, swatches,
promociones, popularidad ni densidades que no aporta el dominio. El tema oscuro adapta
los colores semánticos de PLIEGO; no existe una referencia Google oscura emparejada para
cada pantalla del paquete. Detalle, carrito y checkout conservan su composición, con
la integración del header global. No cambiaron APIs ni reglas de negocio.

## Fuentes

Se consultaron la destilación DOCX disponible, el ZIP de evidencias `(1)`, el otro ZIP,
las capturas de Home, header antes/después de scroll, búsqueda, menús desktop/compacto,
Accessories y producto, los cinco ZIP de HTML/CSS de navegación y las páginas HTML
Google guardadas. [Inventario con nombres y huellas SHA-256](sources.json).
El DOCX presente en Downloads no tiene el sufijo `(1)` del nombre solicitado.
Las medidas observadas no se presentan como mediciones de viewports ausentes: el paquete
incluye 1440, 1180, 768 y 390 CSS px; 390 procede de zoom al 150 %. Nuestra matriz añade
320, 375, 1024 y 1920 para comprobar la adaptación y el límite de ancho.

## Resultados de verificación

- Build y typecheck: pasan. Registro local `build-complete.log`.
- Unitarios: 192 pasan en 27 archivos. Registro local `unit-complete.log`.
- E2E general: 91 pasan. La ejecución por defecto omite 17: 12 casos visuales que se
  ejecutaron por separado y 5 flujos autenticados contra API real que no se activaron.
  Registro local `e2e-complete.log`.
- Visual con API local y portadas CDN reales: 12 casos pasan, seis anchos en ambos temas;
  cada caso captura Home, Catálogo, scroll, búsqueda y categorías. Registro `visual-complete.log`.
- Chromium: comprobados Tab, Shift+Tab, flechas, Enter, Space y Escape; retorno de foco,
  ausencia de trampas en el disclosure, exclusión de capas, navegación e historial,
  filtros, cancelación de borradores, rango monetario, compra/favoritos con recuperación,
  touch emulado, movimiento reducido y texto al 200 %.
- Reflow: sin overflow horizontal de documento en ninguno de los seis anchos.
  El rail conserva su desplazamiento horizontal deliberado y sus controles por teclado.
- Contraste de muestras de título, autor, disponibilidad y CTA: mínimo 6,93:1 en claro
  y 4,91:1 en oscuro. La revisión automatizada no constituye certificación WCAG ni
  una prueba con lector de pantalla. No se probó hardware táctil ni otros navegadores.

## Evaluación visual explícita

| Aspecto | Resultado observado |
|---|---|
| Proporciones | Header 60/52 px y máximo 1392 px; mega-menú desktop de cuatro columnas de producto, 8 px de gap y columnas de 664/292 px cuando aplican. |
| Tamaño de texto | Hero 60/68 desktop y 32/40 compacto; títulos editoriales 48/56 y 28/34; producto 16/22 y 14/20 compacto. |
| Densidad | Tres productos por fila en escritorio, dos en móvil; separación vertical/horizontal de 24 px, con 16 px horizontal en móvil. |
| Alineación | Portadas centradas sin recorte; títulos, precios, stock y acciones alineados por fila, incluyendo títulos/autores largos. |
| Espacio vacío | Hero amplio, contenido editorial limitado a 1136 px y respiración entre secciones. Catálogo omite el hero y el bloque introductorio. |
| Jerarquía | Una acción global en hero; productos, título/autor, precio, disponibilidad y acción en ese orden. |
| Controles visibles | Sin búsqueda ni pared de selects en catálogo; solo facetas útiles, selección bajo disclosure, orden condicionado por datos. |
| Carga visual | Sin chips de navegación activa, títulos/criterios duplicados, ojo sobre portada o badges coloreados de stock en storefront. |

Se detectaron y corrigieron un menú compacto con ancho desktop, un glifo no incluido en
la fuente, solapamiento de texto/portadas a 1024 px, controles del header afectados por
texto ampliado, exceso de separación vertical en catálogo y la franja clara en tema
oscuro. Las capturas de catálogo se tomaron explícitamente desde scroll 0; se guardó
por separado el estado con scroll.

## Capturas finales

| Ancho CSS | Claro | Oscuro |
|---|---|---|
| 320 | [Home](home-light-320.png) · [Catálogo](catalog-light-320.png) | [Home](home-dark-320.png) · [Catálogo](catalog-dark-320.png) |
| 375 | [Home](home-light-375.png) · [Catálogo](catalog-light-375.png) | [Home](home-dark-375.png) · [Catálogo](catalog-dark-375.png) |
| 768 | [Home](home-light-768.png) · [Catálogo](catalog-light-768.png) | [Home](home-dark-768.png) · [Catálogo](catalog-dark-768.png) |
| 1024 | [Home](home-light-1024.png) · [Catálogo](catalog-light-1024.png) | [Home](home-dark-1024.png) · [Catálogo](catalog-dark-1024.png) |
| 1440 | [Home](home-light-1440.png) · [Catálogo](catalog-light-1440.png) | [Home](home-dark-1440.png) · [Catálogo](catalog-dark-1440.png) |
| 1920 | [Home](home-light-1920.png) · [Catálogo](catalog-light-1920.png) | [Home](home-dark-1920.png) · [Catálogo](catalog-dark-1920.png) |

Cada captura tiene una versión `-full.png` con la página completa y una `-scroll.png`.
También se guardan `search-<tema>-<ancho>.png`, `categories-<tema>-<ancho>.png` y
`measurements-<tema>-<ancho>.json`. Los montajes `comparison-*.png` reúnen los seis
anchos de cada tema del mismo recorrido para lectura visual. Los logs están ignorados por Git.

La decisión se registra en [ADR-0015](../../adr/0015-google-store-public-storefront.md).
