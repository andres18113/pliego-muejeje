# Header global de PLIEGO

## Estudio de referencias locales

Se estudiaron el HTML completo `Explore the Google Pixel 11 Phones Family.html`, sus
84 recursos archivados y los tres pares HTML/CSS exportados `tzikte`, `ckufke` y `rivxse`.
Los dos últimos ZIP estaban disponibles sin el sufijo `(1)`. Se extrajeron exclusivamente
en `/tmp/pliego-header-references`; ningún recurso de Google se incorpora al frontend.

El documento completo contiene las reglas responsive; los CSS exportados representan
estilos calculados en una captura desktop de 1392px, no una implementación adaptable.
Se contrastaron estructura, semántica, estados, dimensiones, estilos y media queries.
Los archivos guardados no permiten certificar todos los eventos del sitio original ni
reproducen una búsqueda abierta. La búsqueda de PLIEGO se resuelve con sus propias
necesidades y APIs, sin atribuir al original comportamientos que la captura no demuestra.

| Evidencia de Google Store | Principio adoptado en PLIEGO |
|---|---|
| Marca a la izquierda, navegación de texto y acciones al extremo; texto funcional de 14–16px y peso 500 | Marca, Catálogo/Categorías y acciones claramente agrupadas; una sola fila y baja carga visual |
| Barra de 60px desktop/52px en otros tamaños; envolvente de 88/80px | Reserva de espacio estable de 76/64px, con objetivos táctiles de 44px |
| Superficie clara, radio 32px y sombras pequeñas en el estado fijo; margen superior de 12px | Superficie semántica del tema y elevación discreta al superar 8px de scroll; sin reducir ancho o desplazar controles |
| Navegación completa desde 1280px; botón de menú y vistas laterales en tamaños menores | Catálogo y Categorías visibles sobre 600px; botón de categorías en móvil, con búsqueda, carrito y cuenta siempre disponibles |
| Panel expandido con columnas, separación de 32px, encabezados y rutas a la categoría completa | Taxonomía real en columnas según contenido; panel hasta 960px, o 560px con pocas raíces; acceso al catálogo completo |
| Trays de productos, imágenes, promociones y enlaces editoriales | Se conserva la jerarquía de exploración. El catálogo de libros no necesita promociones ni imágenes adicionales dentro de su navegación |
| Estados de hover/focus, botones de expansión con `aria-expanded` y enlaces ocultos fuera del recorrido de Tab | Apertura explícita por click, touch o teclado; estado accesible; subcategorías cerradas fuera de Tab en móvil |
| Mezcla de enlaces de navegación, enlaces con `role=button` y disparadores secundarios | Botones para abrir paneles, enlaces reales para navegar; disclosure de categorías, menú de acciones de cuenta y modal de búsqueda |

No se copian clases internas, estructura de componentes ni valores de color de Google.

## Arquitectura y contratos de interacción

`ApplicationLayout` monta una sola instancia de `SiteHeader` bajo `SessionProvider`.
Permanece entre rutas de cliente; la frontera de errores raíz provee su propio Header de
recuperación. Home, Catálogo, detalle, autenticación y `PurchasePage` dejan de montar
copias locales. El resto de su contenido y sus flujos permanecen en sus módulos.
Mientras se restaura la sesión, el layout presenta el estado de comprobación o su
recuperación antes de montar el Header; la persistencia aplica al layout ya disponible.

`src/app/navigation` contiene `SiteHeader`, `CatalogNavigation`, `HeaderSearch`,
`HeaderAccount`/`HeaderCart` y un CSS Module. Usa el proveedor Mantine existente,
Material Symbols, roles `--pliego-*`, tipografía Roboto Flex y escalas del tema. Reutiliza
el cliente REST, claves de categorías/perfil/carrito, sesiones y URLs validadas.
La decisión se registra en [ADR-0013](../adr/0013-persistent-global-navigation.md).

Una unión `categories | search | account | null` permite un solo panel activo. Las rutas
cierran paneles sin trasladar el foco de vuelta al Header. Escape y cierres explícitos
devuelven el foco al disparador; fuera del panel, el foco sigue al control seleccionado.
El enlace inicial «Saltar al contenido» revela y enfoca el main con margen para la barra.

Categorías usa `Popover` no modal y navegación HTML normal: Tab/Shift+Tab, Enter y
Escape. Desktop muestra la jerarquía en columnas; hasta 600px, cada raíz mantiene su
enlace y un botón independiente para desplegar descendientes. Se conservan niveles
profundos y categorías huérfanas, con recuperación finita ante ciclos. Carga, lista vacía
y error mantienen la salida al catálogo completo. La consulta se activa al abrir.
Los enlaces de categoría conservan los criterios del catálogo y reinician la página;
«Explorar catálogo completo» elimina la categoría y conserva esos otros criterios.

Búsqueda usa `Modal` con nombre, cierre visible, foco inicial en `TextInput`, contención
de Tab y Shift+Tab, y retorno al disparador. El campo tiene texto de 16px y un botón
«Buscar» explícito. El formulario cabe en 320px; en móvil el botón ocupa una fila propia.
Las sugerencias debounced 220ms consultan títulos/autores/ISBN con el parámetro aprobado
`que`; usan enlaces reales, Tab y flechas opcionales. Resultados, carga, vacío y error
tienen textos en español. El envío y los enlaces sugeridos comparten búsqueda global sin
filtros heredados; el detalle conserva esa búsqueda en `from`. El fallo de sugerencias no
impide enviar una búsqueda. Los reads obsoletos reciben la cancelación del QueryClient.

Carrito es directo para invitados y CUSTOMER. El invitado recibe el gate existente. El
CUSTOMER ve unidades confirmadas; mientras se consultan o fallan, el nombre accesible
lo explica sin inventar cero. El contador visual muestra hasta `99+`, mientras el nombre
conserva las unidades reales. ADMIN conserva su área administrativa y no tiene carrito.

Cuenta usa `Menu`: Enter/Space y flechas abren; flechas recorren acciones; Escape
restaura el disparador. CUSTOMER tiene cuenta, pedidos y favoritos. Identidad se consulta
al abrir y tolera fallo de perfil. Logout bloquea envío duplicado, mantiene la sesión ante
fallo y permite reintentar. Persistencia y revocación siguen bajo el controlador existente.

## Responsive, scroll y temas

Se verifica 320, 375, 768, 1024, 1440 y 1920px. Desktop/tablet usan barra de 76px y
frame máximo de 1440px; móvil hasta 600px usa 64px y solo el icono de categorías.
Buscar, carrito y cuenta conservan objetivos de 44×44px. La barra permanece sticky
al avanzar o retroceder; mantiene geometría y agrega la sombra del tema tras 8px.
Los paneles respetan el viewport; categorías y búsqueda limitan su altura y permiten
scroll interno para contenido largo.

Light/dark resuelven superficies, texto, bordes y foco desde el tema existente. En dark,
los acentos usan el rol claro y el foco usa `pliego[3]`, evitando texto azul oscuro sobre
superficies oscuras. Forced colors conserva bordes y foco del sistema; los paneles no
dependen de animación. Este trabajo no convierte a dark todas las superficies legacy
de negocio ni reescribe los baselines de diseño aprobados.

`PRODUCT.md` y `DESIGN.md` conservan referencias anteriores a Tailwind/shadcn/Base UI,
la paleta pine/paper y el `CatalogHeader` con variantes compactas. Esas referencias ya
diferían del proveedor Mantine y sus roles actuales antes de este reemplazo local.
Se registra la divergencia sin actualizar esos archivos ni `.impeccable/design.json`;
este documento y ADR-0013 describen únicamente el contrato del Header implementado.

## Retirada de legacy y alcance de evidencia

Se eliminan `CatalogHeader.tsx`, `CategoryNavigation.tsx` y 236 selectores obsoletos de
masthead, búsqueda, cuenta, carrito y mega-menu global. Se retiran variantes compactas
del Header, lógica de dialog manual y sus reglas responsive/animación. El parser CSS
preserva todas las declaraciones de las reglas conservadas, incluido el footer.
`PurchasePage` conserva su prop `compact` por compatibilidad con sus páginas actuales.

La validación está en `catalog-header.spec.ts`, pruebas unitarias de jerarquía/recuperación
y la suite frontend existente. Se incluyen rutas reales, ambos temas, scroll, teclado,
touch, fallos recuperables, logout, navegación persistente y flujos de API real local.
Las capturas del Header están en `.impeccable/review/header` (artefactos ignorados por git).
La evidencia de teclado y semántica no equivale a una certificación de lectores de pantalla
ni de conformidad WCAG de todo el sitio; no se ejecutó un lector de pantalla humano.

La revisión independiente encontró y confirmó resuelto un caso de categorías seleccionadas:
su expansión inicial sigue la selección, pero una decisión explícita del usuario puede
contraerlas y volver a abrirlas. Se verificó con selecciones inmediatas y profundas a
320/375px, incluyendo `aria-expanded` y salida de los descendientes del recorrido de Tab.

Los componentes se contrastaron con las APIs oficiales de [Mantine Popover](https://mantine.dev/core/popover/),
[Modal](https://mantine.dev/core/modal/) y [Menu](https://mantine.dev/core/menu/) de la
versión instalada 9.6.3.

## Resultado de validación final

- `npm run build`: correcto, incluido `tsc --noEmit`.
- `npm test`: 192 pruebas correctas en 27 archivos.
- `PLIEGO_E2E_LIVE=1 PLIEGO_API_BASE_URL=http://127.0.0.1:8080 npm run test:e2e -- --workers=4`:
  85 pruebas correctas, sin fallos ni omisiones, incluida la API local con PostgreSQL.
- Detector Impeccable sobre navegación: sin hallazgos. `git diff --check`: correcto.
- Revisión independiente: hallazgo de expansión móvil corregido y confirmado; veredicto
  de la corrección `ship`, limitado a ese hallazgo.
- Contraste medido en la barra: texto/acciones 15,43:1 en light y 8,20:1 en dark.
- Se conservaron los cambios previos y los baselines. No se hizo commit, push ni deploy.

## Archivos del refactor

- Nuevos: `frontend/src/app/navigation/SiteHeader.tsx`, `CatalogNavigation.tsx`,
  `HeaderSearch.tsx`, `HeaderAccount.tsx`, `SiteHeader.module.css` y
  `CatalogNavigation.test.ts`.
- Layout: `frontend/src/app/App.tsx` y `RouteErrorBoundary.test.tsx`.
- Integración mínima: `frontend/src/features/catalog/CatalogHomePage.tsx`,
  `CatalogPage.tsx`, `EditionDetailPage.tsx`, sus pruebas `CatalogPage.test.tsx` y
  `EditionDetailPage.test.tsx`; `frontend/src/features/auth/AuthPages.tsx` y
  `frontend/src/features/purchase/PurchaseChrome.tsx`.
- Estilos e iconos: `frontend/src/styles.css`, `frontend/index.html` y
  `frontend/src/shared/ui/MaterialSymbol.tsx`.
- E2E: `frontend/tests/e2e/catalog-header.spec.ts`, `catalog.spec.ts`, `purchase.spec.ts`,
  `session.live.spec.ts`, `account.live.spec.ts` y `favorites.live.spec.ts`. Las dos últimas
  corrigen aserciones anteriores ajenas al Header: transición existente de 120ms y
  selectores vigentes de StockStatus/feedback, sin cambios en sus interfaces de negocio.
- Documentación: este archivo, `docs/adr/0013-persistent-global-navigation.md` y el índice
  `docs/adr/README.md`.
- Eliminados: `frontend/src/features/catalog/CatalogHeader.tsx` y `CategoryNavigation.tsx`.
