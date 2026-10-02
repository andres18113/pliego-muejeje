# StockStatus v1 — contrato PLIEGO

Estado: implementado en producción local tras la autorización de migración. StockStatus y su resolver son compartidos por las rutas reales y `/dev/theme#stockstatus-v1`. Fecha: 2026-10-01.

## Dominio y fuentes

StockStatus comunica **disponibilidad para compra según el contexto del dato**, no una cantidad de inventario. Hay dos estados principales: `available=true` y `available=false`. Las tres causas del carrito son explicaciones de `false`, no estados nuevos.

| Fuente | Significado real de `available` |
| --- | --- |
| Catálogo público / detalle | Edición y libro publicados activos; existe stock mayor que cero. Un libro sin stock puede seguir listado. |
| Favoritos | Edición y libro activos y stock mayor que cero; también puede listar asociaciones inactivas y no expone la causa de `false`. |
| Carrito / resumen checkout | Libro y edición activos y stock suficiente **para la cantidad de esa línea**. |

Fuentes: `CatalogEditionSummaryResponse`, `CatalogEditionDetailResponse`, `CartResponses.Item`, `shared/api/catalog.ts`, `favorites.ts`, `cart.ts`, `V013`/`V030` catálogo, `V029` favoritos y `V025` carrito (enmienda de códigos canónicos). PostgreSQL decide los predicados y la prioridad de causas: libro inactivo → edición inactiva → existencias insuficientes. No recalcularlos en React.

El API administrativo sí tiene cantidades/stock mínimo; no forman parte de este componente público. No introducir «pocas unidades», «reservado», fecha de reposición, entrega, preventa ni disponibilidad de pedidos. Un pedido histórico o la elegibilidad para cancelar no es disponibilidad de una edición.

## Inventario de producción e inconsistencias

| Ubicación inspeccionada | Tratamiento actual / hallazgo |
| --- | --- |
| `EditionCard` vía catálogo, homepage y favoritos | «Disponible» / «No disponible», punto y clases de color de la paleta anterior. Repite el booleano/label del detalle. |
| `EditionDetailPage` | Mismo indicador, pero `purchasingAvailable` también considera precio y un rechazo de comando. El indicador puede seguir «Disponible» mientras la compra está bloqueada; acceso, validación y feedback no son estados de stock. |
| `EditionCardActions` y compra del detalle | Botón «No disponible» y feedback de cambio de disponibilidad. Su política de habilitación y recuperación pertenece al contenedor, no a StockStatus. |
| `CartPage` / `purchaseText.unavailabilityText` | El label de `false` se sustituye por la causa; fallback «No está disponible por ahora». La interpretación de tres códigos ya está compartida con checkout, pero no con catálogo/detalle. |
| `CheckoutSummaryBody` | Sólo imprime las líneas indisponibles, con causa, sin el indicador usado por carrito. Banners de carrito/checkout agregan el conflicto y su recuperación. |
| `OrderPage`, `OrdersPage` | Reutilizan `edition-availability`, `is-available`, `is-unavailable` y el punto para estado de pedido/pago. No reutilizar StockStatus para esos estados ni para elegibilidad de cancelación. |
| Confirmación de cancelación en `OrderPage` | «Los libros vuelven a estar disponibles» deduce disponibilidad desde una devolución de existencias; los predicados también exigen publicación activa. Es feedback del pedido, no un dato suficiente para crear StockStatus. Se corrigió a «se devolvieron las existencias del pedido», sin prometer publicación activa. |

La búsqueda cubrió todas las superficies frontend existentes; el área administrativa actual es un placeholder, sin UI de inventario. Portadas, categorías, direcciones, permisos y servicios «no disponibles» quedan fuera del significado de StockStatus.

El ejemplo abstracto del Core System en `/dev/theme` usa un Badge rojo «Agotado». No es un uso de producción ni constituye un estado del DTO general. Se conserva la foundation; el diagnóstico de dominio precisa la interpretación aprobada por BookCard v1.

## Mapeo único de significado y presentación

| Entrada | Texto principal | Símbolo | Explicación adicional |
| --- | --- | --- | --- |
| `true` | Disponible | `check_circle` | Ninguna |
| `false`, causa ausente/null | No disponible | `block` | Ninguna; no inferir motivo ni duración |
| `false`, `P3002` | No disponible | `block` | No hay existencias suficientes para esta cantidad. |
| `false`, `P2042` | No disponible | `block` | Esta edición ya no está a la venta. |
| `false`, `P2043` | No disponible | `block` | Este libro ya no está a la venta. |

Se preservan los tres textos específicos del flujo de compra actual. El texto principal siempre aparece y nunca es «Agotado». Una causa residual con `true` no cambia el booleano: se omite su explicación. El cliente actual normaliza una causa desconocida a null; el resultado visual es el genérico de `false`.

**Tono neutral en ambos estados y tamaños:** texto/símbolo `--pliego-text`; explicación `--pliego-text-muted`. La disponibilidad informativa no es éxito de un comando ni un error de validación. No usar verde/rojo, Badge, Pill, fondo tonal o contraste reducido de un control disabled para representar `false`. BookCard v1 ya aprobó este tratamiento neutral.

Material Symbols Outlined compartidos, decorativos, misma familia/peso; símbolos distintos más texto permiten reconocimiento sin color. No permitir a consumidores elegir label, icon, tone o una causa inventada.

## Compact y normal

| Presentación | Tipografía / símbolo | Uso |
| --- | --- | --- |
| `compact` | Roboto Flex `xs`, 12/16, peso 400; símbolo 16px | BookCard y resúmenes compactos |
| `normal` (default) | Roboto Flex `sm`, 14/20, peso 400; símbolo 20px | Detalle, línea de carrito y superficies mayores |

Ambos tamaños conservan **exactamente** el significado, label y explicación recibida. La explicación no se oculta en compact, ni se sustituye por tooltip. Gap icono/label `2xs` (4px), alineación con la primera línea; explicación debajo, indentada al texto, con separación `2xs`. No truncar ni fijar una altura máxima. Texto largo/enlargement envuelve; icono mantiene su caja sin estirarse. No hay hover, active, selección ni animación propios.

StockStatus ocupa el espacio disponible; `min-width:0`, texto con wrapping y sin nowrap. A 320px, el BookCard aprobado mide 136px y tiene 110px interiores: ambos labels caben con símbolo de 16px. Conserva grid, shell, tipografía y reserva de dos líneas de la región de disponibilidad del BookCard; esa reserva pertenece a **BookCard**, no al indicador reutilizable. Con texto al 200% puede ocupar más líneas sin clipping ni solapamiento. En normal no hay una caja fija o target interactivo.

## Semántica, accesibilidad y actualización

- Raíz `span` mediante Mantine `Text`: válida dentro de párrafos, descripciones y enlaces de BookCard. Contenido textual visible, no un botón, enlace, tooltip ni widget con rol.
- No `tabIndex`, `aria-disabled`, `aria-pressed`, `role=status`, `role=alert` o `aria-live` por instancia. Un indicador estático no necesita una parada de teclado ni un anuncio al cargar cada libro.
- Símbolo `aria-hidden=true`; label y explicación permanecen en el árbol accesible. No añadir un `aria-label` redundante que oculte o duplique la explicación.
- `id` opcional permite que el contenedor use `aria-describedby` para relacionar el indicador con el enlace o el control pertinente. En BookCard se conserva la referencia aprobada del enlace al bloque de disponibilidad. En carrito el título/cantidad de la línea proporciona el contexto.
- Si una acción o lectura cambia un estado importante, el contenedor posee un único anuncio contextual, por ejemplo «Cien años de soledad: No disponible», y mantiene el foco en la tarea. No convertir todas las tarjetas en live regions.
- Contraste de texto ≥4.5:1 y símbolo significativo ≥3:1 en fondos aprobados, incluidos light, dark y hover del BookCard. El componente consume variables semánticas; Auto lo resuelve mediante el proveedor existente.

Una lectura pendiente/fallida o datos stale son estados de consulta/página; no coercionar `undefined` a false ni presentar «No disponible» como error de red. Renderizar sólo con un booleano confirmado; skeleton, error/retry y aviso de datos anteriores permanecen en el contenedor. No pasar un código de cualquier comando directamente como disponibilidad; usar la lectura/reconciliación del contexto correspondiente. En particular, P3002 de una línea con varias unidades no vuelve indisponible la edición individual del catálogo.

## API y límite de componente

API implementada:

```ts
type StockUnavailabilityReason = 'P2043' | 'P2042' | 'P3002';

interface StockStatusProps {
  available: boolean;
  unavailabilityReason?: StockUnavailabilityReason | null;
  size?: 'compact' | 'normal'; // default normal
  id?: string;
  className?: string; // integración de layout; no reinterpretar tono/significado
}
```

Uso: `<StockStatus available={edition.available} size="compact" />`; en carrito `<StockStatus available={line.available} unavailabilityReason={line.unavailabilityReason} />`. El padre pasa los campos del API, no una combinación de decisiones visuales. El input no contiene título, cantidad, stock, permisos, booleano de compra habilitada, callbacks, query keys o estado de pedido.

Un resolver puro centralizado traduce la entrada a `{state, label, icon, explanation, tone}`. La vista lo consume y compone Mantine Text + MaterialSymbol con CSS Modules y tokens aprobados. No necesita factory, registro global, un nuevo theme ni Styles API propio. Ubicación: componente de dominio de catálogo con su resolver, reutilizado por favoritos y compra; no componente genérico de `components/ui`. El módulo shared/API conserva los tipos y validación de entrada.

La DB/API conserva stock, activos y conflictos; los contenedores conservan consultas, autorización, habilitación de comandos, recuperación y anuncios. `purchaseText.unavailabilityText` fue eliminada y las interpretaciones duplicadas de catálogo/detalle fueron sustituidas; la migración ya usa el resolver único en catálogo, homepage, favoritos, detalle, carrito y checkout. El diagnóstico BookCard también consume el componente real.

## Validación y archivos

El diagnóstico contiene las dos disponibilidades dentro de 12 BookCards con bibliografía y portadas reales, los cinco inputs significativos en ambos tamaños y una superficie normal con cambio simulado y anuncio del contenedor. Disponibilidad alternada, causas y cambios son fixtures rotulados; no se consultan ni escriben datos de compra.

Comandos: `npm run build`; `npm test -- --reporter=dot`; `npm run test:e2e -- tests/e2e/stockstatus-diagnostic.spec.ts tests/e2e/bookcard-diagnostic.spec.ts --workers=2`, desde `frontend`.

El diagnóstico consume el componente real; sus pruebas pasan junto con las de BookCard. Las pruebas verifican light/dark a 320/375/390/768/1024/1200/1440/1920px, tamaños y símbolos, razones completas, contraste, reflow, nombres/descripciones accesibles, exclusión del orden Tab y un único anuncio externo. La suite BookCard anterior se mantiene como comprobación de integración.

La prueba de 200% se limita a StockStatus y su sección, igual que en BookCard: otras partes preexistentes de `/dev/theme` desbordan con esa ampliación y no se modifican. La evidencia es Chromium/árbol accesible; no una sesión de lectores de pantalla reales ni una declaración de conformidad WCAG.

Archivos de diagnóstico: `StockStatusDiagnostic.tsx` y su CSS, integración en `ThemeInspectionPage.tsx`/`BookCardDiagnostic.tsx`, aliases `StockStatusSpecimen.tsx`/`stockStatusModel.ts` hacia producción y `stockstatus-diagnostic.spec.ts`. El modelo, estilos y pruebas del prototipo fueron promovidos a catálogo; no se conserva una implementación paralela. Los archivos de producción y sus consumidores están detallados a continuación.

La autorización posterior incorporó implementación y migración de producción. Los apartados siguientes registran sus resultados. No se alteraron backend, migrations, foundations ni el contrato visual de BookCard. No commit/push/deploy.

## Implementación y validación en rutas de producción

- Componente y resolver: `frontend/src/features/catalog/StockStatus.tsx`, `StockStatus.module.css`, `stockStatusModel.ts`; no imports desde `/dev` en producción.
- Tipo de API: `shared/api/availability.ts`, derivado de `CartItem`; `cart.ts` comparte el tuple de causas. `catalog.ts` exige el booleano en el detalle y conserva strings para IDs/dinero.
- Consumidores: `EditionCard` (incluye homepage/favoritos), `EditionDetailPage`, `CartPage`, `CheckoutSummaryBody`. Permisos, flujo de carrito y restricciones de cantidad permanecen en sus contenedores.
- Feedback de comandos: `availabilityConflictMessage` centraliza P2041/P2042/P2043/P3001/P3002, reutilizado por acciones del catálogo, detalle y checkout. P3002 habla de la cantidad del carrito; no transforma la disponibilidad general del detalle.
- Temas: `availabilitySurface.module.css` aplica los tokens aprobados localmente a las áreas legacy que contienen el indicador. StockStatus sigue sin fondo/badge propios; no se migró la UI restante ni se cambiaron foundations.
- Accesibilidad: el stepper del carrito referencia tanto StockStatus como su feedback; el DOM conserva un espacio real entre estado y explicación para el cálculo de descripciones, incluso sin CSS. `/dev/theme` reutiliza exactamente el componente y resolver reales.
- Pruebas: resolver, componente, datos corruptos de detalle, separación de conflicto por cantidad y fixtures de pedido actualizados al contrato. Los helpers de render usan el proveedor Mantine ya presente en producción y un matchMedia de jsdom.
- Pruebas heredadas de navegador: sesión guest explícita para escenarios autónomos, nombre correcto de Roboto Flex Variable, espera de fuentes antes de medir y recorrido de registro a través del enlace de sign-in vigente. No se modificaron páginas de auth/admin para hacer pasar esas pruebas.
- Arquitectura: [ADR-0011](../adr/0011-canonical-edition-availability-presentation.md).

La suite `stockstatus-production.spec.ts` usa las rutas reales `/`, `/catalog`, `/favorites`, `/catalog/editions/:id`, `/cart` y `/checkout` con fixtures del contrato REST. Verifica ambos temas a 320/390/768/1440/1920px, todas las causas, contraste, overflow, compra deshabilitada, descripción de cantidad, texto ampliado y conflicto P3002 sin invalidar el stock general. Son pantallas de producción local; no una validación contra una tienda desplegada ni una afirmación de conformidad completa con lectores de pantalla.

Resultados finales: build/typecheck aprobados; Vitest **170 passed / 2 failed** (las mismas dos fallas conocidas de EditionDetailPage, sin fallas adicionales); **49 E2E passed** en catálogo, compra, favoritos y ambos diagnósticos, incluyendo las cuatro pruebas nuevas de producción. Tras el último ajuste de contraste de enlaces/hover se repitieron esas cuatro pruebas de producción: **4 passed**.

La matriz de producción cubre 70 combinaciones de ruta, ancho y tema, con estados/causas del contrato. Labels, explicaciones y enlaces de las áreas migradas cumplen contraste ≥4.5:1 en sus fondos reales. Teclado y texto al 200% pasan; no hay clipping del indicador ni overflow en los anchos normales. Capturas inspeccionadas en `/tmp/pliego-stockstatus-production-{catalog,detail,cart}-{light,dark}.png`.

Los enlaces de las áreas adaptadas conservan contraste neutral y subrayado, incluido hover en carrito. La comprobación de hashes confirma que backend y foundations aprobadas siguen intactos. No se afirma una migración global de temas de la UI legacy restante ni conformidad completa con lectores de pantalla reales. No quedan bloqueos de esta implementación.
