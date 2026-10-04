# Pasada visual de la storefront

Esta pasada conserva componentes, contratos, datos, navegación, búsqueda y capacidades.
Los únicos cambios de producción están en cinco archivos CSS. No hubo commit, push ni deploy.

## Defectos corregidos

- El ActionIcon de Mantine recortaba el badge del carrito por `overflow: hidden` y su radio.
  Header, acciones y contenido del icono permiten pintar badges, hover y focus completos.
  La capa de búsqueda permite pintar su anillo de foco fuera del borde de la cápsula.
- El viewport del rail necesitaba 6 px de espacio seguro para un anillo de foco de 5 px.
- Las imágenes decodificadas podían imponer su tamaño intrínseco a la grilla de la portada,
  agrandar la superficie del rail y pisar el título. Las pistas `minmax(0, 1fr)` mantienen
  el marco y la proporción estables tras la carga.
- La sombra aplicada a la imagen se cortaba dentro del wrapper. Ahora se pinta en la figura.
- El primer enlace de producto del catálogo podía quedar en y=0 al enfocarlo desde scroll.
  Sus márgenes de scroll mantienen el producto debajo del header sticky.

La franja blanca de «Así habló Zaratustra» pertenece al WebP original servido por el CDN
(PLG-BK-000016-d230fc853c6f.webp). Se inspeccionó esa respuesta original; no se recortó ni
retocó. Los wrappers tienen fondo transparente y todas las imágenes usan `contain`.

## Mejoras visuales

Hero y bloques de categorías usan superficies neutras claras/oscuras; el color se
concentra en portadas y acciones. El hero muestra libros mayores, con la portada central
más protagonista en compacto. Las categorías aumentan la escala de sus portadas.

Las portadas del rail a 1440 px pasan aproximadamente de 97×146 a 147×220 px dentro de
la misma superficie de 208×260 px. Se conservan los gaps de 24 px. Los títulos mantienen
48/56 px en escritorio con más peso; el precio también tiene más peso y el autor queda
secundario. Las flechas se alinean con el centro de la imagen. Se reduce la separación
entre secciones sin añadir elementos.

## Verificación

- Build/typecheck: aprobado; `build.log`.
- Unitarios: 192 aprobados en 27 archivos; `unit.log`.
- Suite E2E general: 91 aprobados; `e2e.log`. Sus 42 omisiones son 5 flujos autenticados
  live, 12 casos de la matriz visual anterior y 25 casos de esta pasada activados aparte.
- Pasada visual: 25 aprobados; `visual-fixed.log`. Incluye 24 combinaciones de ancho,
  tema y entrada, más una auditoría del catálogo completo de 55 portadas.
- Anchos: 320, 375, 768, 1024, 1440 y 1920 CSS px. Temas claro/oscuro y mouse/touch.
- En cada combinación se verifican Home/Catálogo inicial y con scroll, badge 99+ que
  representa 125 unidades, hover, foco del header, foco de producto, portadas completas,
  proporciones, dimensiones tras carga, ausencia de overflow y búsqueda sin clipping.
- El catálogo y el CDN son reales; autenticación, estado de favoritos y carrito son
  fixtures de lectura para inspeccionar el badge. No se realizaron compras ni mutaciones.
- `cover-audit.json` conserva dimensiones y URLs públicas de las 55 imágenes.
- Las matrices `matrix-*.html/png` reúnen los seis anchos por superficie, tema y entrada.
  Las capturas `*-header-focus`, `*-header-hover`, `*-scroll-*` y `*-product-focus` muestran
  los estados individuales. Chromium/touch emulado; no es una certificación WCAG ni
  una prueba de hardware táctil o lector de pantalla.
