# PLIEGO BookCard v1 — contrato de diseño

Estado: contrato aprobado e implementado en producción local tras la autorización de migración. Se conserva el contrato de diseño siguiente; el registro de implementación y validación aparece al final. Fecha: 2026-10-01.

## Alcance y evidencia

El objeto representado es **una edición**, identificada por `editionId`; dos ediciones de un mismo libro son dos tarjetas. Sirve para decidir qué edición consultar, guardar o agregar al carrito. Conserva Color, Typography, Foundations, Layout y Core Component System v1 de `/dev/theme`, Material Symbols y Light/Dark/Auto. La implementación actual de producción es evidencia funcional, no autoridad visual para reemplazar las foundations aprobadas.

Fuentes inspeccionadas: `shared/api/catalog.ts`, tipos OpenAPI, `CatalogEditionSummaryResponse`, `EditionCard`, `EditionCardActions`, `EditionGrid`, `BookCover`, `CatalogHomePage`, `FavoritesPage`, formatters, rutinas públicas de catálogo y favoritos, staging bibliográfico, manifest CDN normalizado y seed de desarrollo.

- `EditionSummary` contiene título, autores como **un string ya ordenado**, editorial, formato, idioma, precio decimal string, disponibilidad booleana y metadatos de portada. No ofrece descuentos, precio anterior, promociones, fecha de novedad, valoración ni cantidad de stock.
- Catálogo y homepage usan `EditionGrid`/`EditionCard`; favoritos reutiliza la tarjeta, pero fabrica un `EditionSummary` con `isbn13: null`. El futuro adaptador debe consumir el subconjunto común y evitar esa fabricación.
- La tarjeta actual tiene dos enlaces al mismo destino. Las acciones se revelan sobre la portada por hover/focus y se reubican para punteros táctiles. Precio, idioma y formato ya tienen formatters compartidos; deben seguir siendo la única fuente de formato.
- `BookCover` reserva 2:3, carga lazy, controla errores y limita las URLs a HTTPS público sin credenciales. Su ajuste permite hasta 4% de recorte por borde y los estilos usan la paleta anterior. El contrato nuevo conserva la política de URL y reserva geométrica, y elige `contain` para preservar el arte completo.
- El catálogo público devuelve ediciones activas; `available` deriva del stock. Favoritos también puede devolver ediciones o libros inactivos. Por ello `false` significa **«No disponible»**, sin inferir «Agotado», fecha de reposición o causa.
- El precio PostgreSQL es `NUMERIC(11,2)`, mayor que cero y hasta `999999999.99`. El mínimo representable es `0.01`. IDs y dinero siguen siendo strings; no convertir dinero a `Number`.
- La navegación existente preserva `?from=`, `catalogReturn`, `coverPreview` y la posición del catálogo. Autenticación, intención diferida, favoritos, carrito y recuperación del resultado incierto pertenecen a los flujos actuales, no a la vista de la tarjeta.

## Anatomía y presentación

`li` del grid → `Paper component="article"` → un `Anchor component={Link}` con portada y contenido → acciones hermanas → feedback y créditos opcionales.

| Región | Contrato |
| --- | --- |
| Superficie | `--pliego-surface`, borde 1px `--pliego-border`, radio `md` (12px), padding `sm` (12px), sin sombra. |
| Portada | Marco 2:3 de ancho completo, radio `xs`; `object-fit: contain`, centrada, fondo neutral. Sin estirar, recortar ni overlay de acciones/promociones. |
| Título | Roboto Flex `sm` 14/20, peso 600, hasta dos líneas; reserva dos líneas aun con título corto. |
| Autores | `xs` 12/16, peso 400, `--pliego-text-muted`, hasta dos líneas reservadas. Conservar el string completo; no separar nombres por comas ni inventar «et al.». |
| Editorial | `xs` 12/16, muted, hasta dos líneas reservadas. Identifica ediciones con títulos iguales. |
| Formato/idioma | `xs` 12/16, muted; etiquetas existentes («Rústica», «Tapa dura», idioma español localizado), separadas por «·». Mínimo dos líneas; permite crecer sin ocultar datos. |
| Precio | `md` 16/24, peso 600, numerales tabulares, `formatUsd` compartido. Texto exacto, sin redondeo, abreviatura, tachado ni precio «desde». Permite envolver el máximo legal. |
| Disponibilidad | `xs` 12/16, texto «Disponible» o «No disponible» + `check_circle`/`block` decorativo. Color neutral; ni color ni icono son la única información. |
| Acciones | Favorito secundario (`ActionIcon`, default/light) y carrito primario (`Button`, filled PLIEGO), ambos visibles y con targets mínimos 44×44px. Radio `sm`. |
| Créditos | Atribución y licencia recibidas, completas, `xs`, debajo de acciones con regla. No inventar derechos ni truncar atribución; se conservan también en el detalle. |
| Feedback | Mensaje español debajo de acciones, sin overlay ni desaparición obligatoria por temporizador; success `role=status`, error `role=alert`. Recuperación visible cuando corresponda. |

Cada fila del grid estira sus tarjetas a igual altura. El enlace flexible empuja el bloque comercial al final y reserva las líneas de identificación: portadas, títulos, precios y acciones se alinean en las filas ordinarias. Créditos o feedback extensos pueden aumentar la altura y modificar la alineación del bloque comercial; nunca mueven la portada ni superponen texto. No fijar una altura total que recorte contenido.

El truncamiento es exclusivamente visual, mediante CSS. El DOM, el nombre accesible y la vista de detalle mantienen los textos completos. La edición se identifica con título + editorial + formato/idioma; no depender únicamente de un título truncado. No se agrega un tooltip obligatorio para leer información esencial.

## Responsive e interacción

La tarjeta no decide columnas ni añade un modo de catálogo paralelo. Ocupa el ancho de su celda, con `min-width: 0` y wrapping de palabras largas.

| Rango CSS | Columnas | Gutter del shell |
| --- | --- | --- |
| <768px | 2 | 16px |
| 768–991px | 3 | 24px |
| 992–1199px | 4 | 24px |
| 1200–1407px | 5 | 32px |
| ≥1408px | 6 | 32px |

Shell máximo 1440px; gap 16px. A 320px la celda mide 136px y su contenido 110px. No reducir tipografía bajo las foundations para acomodarla.

- Favorito conserva un icono de 44px. Carrito ocupa el resto; muestra icono + «Agregar» cuando el contenido de la tarjeta alcanza `11rem` (176px con raíz de 16px). Bajo ese ancho, muestra icono de carrito, nombre accesible completo y tooltip de hover/focus. «Agregado» y «Agregando…» conservan la misma altura.
- Cuando el contenido cae por debajo de 104px, por ejemplo al ampliar texto al 200% a 320px, apilar las dos acciones a ancho completo y conservar 44px de altura mínima. La cantidad de columnas no cambia.
- Hover del enlace: superficie `surface-hover`, borde `control-border`, título subrayado. Sin desplazamiento, escala, elevación ni contenido revelado necesario para actuar.
- Foco real: el anillo aprobado de 3px y offset 3px de Mantine/PLIEGO; PLIEGO 8 en light y PLIEGO 3 en dark. Foco del enlace subraya el título. No añadir tabindex al artículo ni estado «seleccionado» a la navegación.
- Orden Tab: enlace → favorito habilitado → carrito habilitado → recuperación opcional. Enter abre el enlace; Space/Enter activa botones. Las acciones no navegan a la edición ni propagan un click artificial del artículo.
- Usar un Link real: conserva Ctrl/Cmd-click, nueva pestaña y URL copiable. El padre proporciona destino, estado y callback de navegación; el callback de scroll respeta eventos modificados como actualmente.
- En producción, apertura lleva a `/catalog/editions/:editionId?from=…`; retorno mantiene criterios, página y scroll. La vista de desarrollo usa IDs ficticios y una vista completa local, explícitamente rotulada.
- La thumbnail dentro del enlace tiene `alt=""`; no repite el título accesible. La ausencia de imagen tiene texto visible «Portada no disponible». Los Material Symbols son decorativos.
- `aria-labelledby` referencia título, editorial y formato/idioma; `aria-describedby` referencia autores, precio y disponibilidad. Encabezado `h3` en catálogo bajo `h2`; permitir `h4` si el contexto realmente requiere esa profundidad.

## Estados y propiedad de comportamiento

| Estado | Comportamiento |
| --- | --- |
| Portada válida | Lazy + decoding async; dimensiones reservadas desde el primer render. |
| Portada lenta | Skeleton después de 120ms, decorativo, sin shimmer; `aria-busy` en el marco. El resto de la tarjeta sigue operativo. |
| Portada ausente, URL rechazada o error HTTP/decodificación | Mismo marco con fallback neutral; sin error de compra ni cambio de disponibilidad. Un nuevo URL reinicia el estado de imagen. |
| Disponible | Navegación, favorito y carrito según permisos. |
| No disponible | Navegación y favorito permanecen; carrito nativamente disabled y descrito por el estado visible. |
| Invitado | Acciones disponibles, conducen al sign-in existente con return URL e intención diferida; la tarjeta no solicita credenciales. |
| ADMIN | Lectura normal; acciones de cliente deshabilitadas con explicación visible. |
| Favoritos sin confirmar | Favorito disabled; omitir `aria-pressed` para no anunciar falsamente «no guardado». Error de lectura explicado en la lista. Carrito independiente. |
| Comando pendiente | Deshabilitar sólo la acción implicada; `aria-busy`, nombre «Guardando…»/«Agregando…», sin doble envío. Navegación y la otra acción permanecen disponibles. |
| Favorito guardado | `aria-pressed=true`, icono filled, nombre «Quitar de favoritos: [título]». Optimismo/rollback e invalidación son responsabilidad del contenedor actual. |
| Carrito confirmado | Feedback «Agregado al carrito» o cantidad confirmada, sin promesa de reserva de stock. |
| Rechazo por disponibilidad | Contenedor actualiza la disponibilidad efectiva/refresca datos; deshabilita compra, conserva lectura y favorito, explica el rechazo. |
| Resultado incierto de carrito | Contenedor consulta el carrito según el flujo existente antes de habilitar otro intento; si no confirma, acción bloqueada y enlace «Consultar carrito». No retry automático de comandos. |

La simulación local del diagnóstico no realiza solicitudes al API. Los escenarios de pending activan ambas acciones para exponer visualmente sus estados; la implementación de producción debe controlarlas **independientemente**.

## Límite de datos y API recomendada

Ubicación futura: componente del dominio catálogo, junto a su adaptador de presentación y cover; no en `components/ui` como componente genérico. No usa `factory`, componentes compound o registro global: no existe una necesidad de un nuevo Styles API. Componer Mantine `Paper`, `Anchor`, `Text`, `ActionIcon`, `Button`, `Tooltip` y `Skeleton`; CSS Modules utiliza tokens aprobados. `Card.Section` no añade valor frente a `Paper` en esta anatomía.

`EditionSummary`/`FavoriteEdition` → adaptador puro de catálogo → `BookCardData` → vista controlada. El adaptador usa los formatters existentes y no convierte IDs/dinero a números; el contenedor conserva la entidad/API para sus comandos. Sólo los datos necesarios entran a la vista: no `bookId`, ISBN, query keys, session, cliente HTTP ni objetos de respuesta completos. El adaptador de favoritos consume el subconjunto común sin inventar ISBN.

API propuesta; **sólo especificación, no código de producción**:

```ts
interface BookCardData {
  id: string; // editionId, sin coerción numérica
  title: string;
  authors: string;
  publisher: string;
  editionLabel: string; // formatEdition + formatLanguage compartidos
  priceLabel: string;   // formatUsd sobre el decimal string original
  available: boolean;  // estado efectivo confirmado por el contenedor
  cover: { url: string | null; license: string | null; attribution: string | null };
}

type FavoriteControl =
  | { state: 'ready'; selected: boolean; onPress: () => void }
  | { state: 'pending'; selected: boolean }
  | { state: 'unconfirmed' | 'restricted'; reason: string };
type CartControl =
  | { state: 'ready' | 'success'; onPress: () => void }
  | { state: 'pending' }
  | { state: 'restricted'; reason: string }
  | { state: 'uncertain'; recoveryTo: To };

interface BookCardProps {
  book: BookCardData;
  to: To; // React Router; incluye from cuando corresponde
  navigationState?: { catalogReturn?: boolean; coverPreview?: CoverPreview };
  onNavigate?: MouseEventHandler<HTMLAnchorElement>;
  favorite: FavoriteControl;
  cart: CartControl;
  feedback?: { kind: 'success' | 'error'; message: string };
  headingOrder?: 3 | 4; // default 3
  className?: string;
}
```

`To` y `MouseEventHandler` son tipos estándar de React Router/React. `CoverPreview` es el snapshot ya utilizado por el catálogo (`editionId`, `url`, `license`, `attribution`, `title`). No crear un modelo de navegación distinto. `book.available=false` siempre domina la habilitación del carrito. `selected` pertenece al favorito; jamás representa selección de tarjeta. El feedback representa el último resultado local y se reemplaza en la siguiente acción.

El cover posee solamente carga/decodificación/fallback y comparte la política de URLs del cover existente; la duplicación del guard en el prototipo debe desaparecer al implementar ese cover. El grid posee lista, columnas, skeletons de consulta y mensajes globales; los contenedores poseen sesión, batching de favoritos, query keys, mutation, stock/error mappings, recuperación y navegación. No hay cambios a API, backend ni boundaries de arquitectura; no se introduce un patrón de estado o UI paralelo.

## Decisiones y alternativas revisadas

1. **Un enlace + botones hermanos**, frente a dos enlaces o un artículo clicable: elimina la parada Tab duplicada y conserva semántica, nueva pestaña y acciones independientes.
2. **Acciones permanentes debajo de la información**, frente al overlay actual o menú de acciones: mantiene la portada legible y la misma capacidad con ratón/tacto/teclado; evita hover como requisito y el paso adicional de un menú.
3. **Dos líneas reservadas por campo**, frente a texto ilimitado o tamaños distintos por breakpoint: los títulos largos de ecuaciones diferenciales y los tres autores reales prueban el límite; reserva geometría sin comprimir tipografía. La consulta completa permanece a un enlace.
4. **Contain permanente**, frente al recorte de hasta 4%: portadas reales con proporciones distintas mantienen todas sus letras y arte; el marco común estabiliza filas.
5. **Disponibilidad neutral textual**, frente a rojo «Agotado» o badges comerciales: favoritos permite otras causas de indisponibilidad; no atribuir una causa que el DTO no distingue.
6. **Precio actual único**, frente a promocionales: ningún contrato público suministra una promoción. No añadir props especulativas de descuento/ratings/novedad a v1.
7. **Vista controlada con adaptador pequeño**, frente a fusionar datos, sesión y mutations: permite reutilizar catálogo/homepage/favoritos sin repetir presentaciones ni trasladar reglas comerciales al componente.

## Validación y límites

Reproducción: `npm run build`, `npm test -- --reporter=dot`, `npm run test:e2e -- tests/e2e/bookcard-diagnostic.spec.ts --workers=2`, desde `frontend`.

El diagnóstico contiene 12 ediciones con bibliografía y CDN reales de los archivos aprobados. IDs 9xxxxxx/8xxxxxx son ficticios; precio USD 20,00 y disponibilidad inicial corresponden a los defaults del seed de desarrollo, **no a una lectura de una tienda en vivo**. Los 12 casos límite rotulan cambios de precio, disponibilidad, carga, URL y créditos. Los textos de licencia son ejemplos técnicos y no certifican derechos.

La suite de navegador usa los WEBP reales del repositorio, servidos bajo las URLs del manifest para eliminar dependencia de red. Inspección adicional con el CDN confirmó carga de las 12 portadas. Pruebas incluyen temas light/dark, límites 767/768, 991/992, 1199/1200 y 1407/1408, y anchos 320, 375, 390, 576, 1024, 1440 y 1920; ambas fuentes de datos. Comprueban overflow, targets, geometría 2:3, dos líneas de título, alineación de filas ordinarias y contraste de texto/botón habilitado.

También prueban teclado, nombres/descripciones accesibles sin truncar, toggle de favoritos, navegación a contenido completo, Auto, tacto, texto al 200%, título técnico de 300 caracteres sin espacios, reduced motion, placeholders, error real de imagen, carga retardada sin saltos, edición no disponible, acceso de invitado/ADMIN, favoritos sin confirmar, pending, rechazo y recuperación incierta.

La comprobación de 200% se limita al BookCard y su sección: otras secciones preexistentes de `/dev/theme` desbordan con la raíz de fuente al 200% y están fuera del cambio autorizado. No se afirma conformidad WCAG completa; no se realizó una sesión con lectores de pantalla/usuarios ni pruebas con Firefox/Safari. Eso limita la evidencia de accesibilidad, no deja una decisión de producto pendiente.

Resultados finales: build y typecheck aprobados; Vitest **151 passed / 2 failed**, exactamente las dos fallas preexistentes de `EditionDetailPage` (loading/success y retryable error), reproducidas antes y después; Playwright **6 passed**, incluyendo 60 combinaciones de tema/dataset/ancho. Contraste de texto y botón primario habilitado ≥4.5:1 en ambos temas. Overflow horizontal cero en todos los anchos normales; BookCard y su sección también pasan la prueba de texto al 200%. La reserva geométrica de portada/título permanece igual tras carga y fallo de imagen.

La revisión visual final confirma las decisiones en light y dark a 320/1440px y con los casos límite. Capturas en `/tmp/pliego-bookcard-final-{light,dark}-{320,1440}.png` y `/tmp/pliego-bookcard-final-edges-{light,dark}.png`; medidas adicionales 320/375/390/768/1024/1200/1440/1920 en `/tmp/pliego-bookcard-review.json`. Ninguna decisión de producto queda pendiente. Lectores de pantalla reales, otros motores de navegador y conexión de comandos reales corresponden a la validación de la implementación posterior.

Archivos de este trabajo: `frontend/src/dev/ThemeInspectionPage.tsx` (import y sección); `frontend/src/dev/BookCardDiagnostic.tsx`; `frontend/src/dev/BookCardDiagnostic.module.css`; `frontend/src/dev/bookCardFixtures.ts`; `frontend/tests/e2e/bookcard-diagnostic.spec.ts`; este documento. No se modificaron foundations, catálogo/API/backend de producción ni se hicieron commit/push.

## Registro de implementación de producción

- `features/catalog/BookCard.tsx` es una vista controlada de edición, con Paper/Anchor/Text/ActionIcon/Button/Tooltip, StockStatus real y un único enlace de navegación. No importa consultas, sesión ni mutations.
- `bookCardModel.ts` contiene el adaptador puro del subconjunto común de catálogo/favoritos, tipos de controles y el snapshot de navegación existente. IDs y dinero no pasan por Number; no se fabrica ISBN ni bookId de presentación.
- `CatalogBookCard.tsx` conecta datos y `useBookCardActions.ts`; los contenedores mantienen autenticación, intención diferida, optimismo/rollback, invalidación y lectura del carrito para reconciliar resultados. El detalle reutiliza el controlador de favoritos mediante `FavoriteButton.tsx`.
- Carrito incierto: ningún retry de POST, lectura de confirmación y acción bloqueada si no puede confirmarse, con recuperación a `/cart`. Conflictos de cantidad se expresan como restricciones de la acción; no se inventa un booleano general de stock.
- `BookCover` comparte la política de URL/decode/cache existente. Su modo card fuerza contain, thumbnail decorativa, marco 2:3 y Skeleton sin shimmer. Detalle/compact mantienen su política existente.
- `catalogLayout.module.css` pertenece al grid y rutas: 2/3/4/5/6 columnas, gap 16 y shell/gutters aprobados. Inicio, resultados y favoritos aplican ese shell; BookCard no elige columnas. `EditionLoadingGrid` reserva la misma geometría mediante primitivas Mantine.
- Se retiraron EditionCard/EditionCardActions, markup duplicado del diagnóstico, guard de URL paralelo, overlay de acciones, CSS de tarjetas/skeletons antiguos y DTO fabricado de favoritos. Los aliases y clases de pruebas usan la anatomía real.
- El hover del carrito en dark usa pliego.7, de la escala aprobada, para preservar contraste del texto. Las reglas locales de composición tienen suficiente especificidad para funcionar tanto con carga eager como lazy sin alterar foundations ni el orden global de CSS.
- Arquitectura: [ADR-0012](../adr/0012-controlled-bookcard-and-catalog-controllers.md).

Pruebas nuevas: contrato puro de componente, adaptador/precisión/provenance, contain incluso con cache de ajuste previo, fallback/alt decorativa, matrix real en inicio/catálogo/favoritos, navegación/teclado, acciones independientes, resultados de carrito no confirmados y confirmados tras pérdida de respuesta sin doble POST. Los tests existentes fueron migrados de enlaces/markup antiguos a la semántica aprobada.

Las pruebas de producción usan las rutas reales con fixtures REST y WEBP del repositorio, en light/dark y 320/375/390/768/992/1024/1200/1408/1440/1920px. La validación de 200% y causas de control reutiliza el componente real en `/dev/theme`. No es una afirmación de conformidad con lectores de pantalla reales ni una prueba de una tienda desplegada.

Resultados de migración: build/typecheck aprobados; suite completa Vitest **181 passed / 2 failed** (las mismas dos fallas conocidas de EditionDetailPage; 11 pruebas nuevas aprobadas). Suite completa Playwright **59 passed / 5 skipped**, sin fallas: incluye las 49 comprobaciones del baseline, cinco pruebas nuevas de BookCard y cinco pruebas existentes de header. Los cinco skips requieren PLIEGO_E2E_LIVE y un backend dedicado; no se ejecutaron contra una tienda desplegada.

Las comprobaciones de producción incluyen 60 combinaciones de ruta/ancho/tema, portadas WEBP reales del repositorio, retorno con criterios/scroll, teclado, controles separados, targets de 44px, viewport 320px y desktop, cash exacto y ambos resultados de reconciliación de un POST perdido. El diagnóstico real también pasa texto al 200%, Auto, fallback/carga retardada y contraste.

Inspección visual final en `/tmp/pliego-bookcard-production-{catalog,home,favorites}-{light,dark}-{320,1440}.png`: misma anatomía aprobada, portadas completas, columnas y acciones alineadas. La ejecución de toda la suite también detectó un desajuste de 2px del panel de sugerencias móvil; se corrigió el ancho de su columna de marca sin cambiar la búsqueda ni debilitar su prueba de alineación.

No quedaron fallas adicionales ni bloqueos funcionales. No commit/push/deploy.
