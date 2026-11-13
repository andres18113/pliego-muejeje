# Evidencia: análisis automático axe-core (WCAG 2.0/2.1/2.2 A y AA)

Fecha: 2026-11-02. Herramienta: @axe-core/playwright (versión del proyecto) sobre Chromium/Playwright 1.63.
Etiquetas: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa. 'prod' = https://pliegolibros.com; 'local' = entorno local con cuenta ficticia.
Un análisis automático no equivale a una auditoría de conformidad WCAG.

```
prod 1440 /                        violaciones: 0  | reglas aprobadas: 26 | incompletas: 0
prod 1440 /catalog                 violaciones: 0  | reglas aprobadas: 26 | incompletas: 0
prod 1440 /catalog/editions/373    violaciones: 0  | reglas aprobadas: 24 | incompletas: 0
prod 1440 /ofertas                 violaciones: 0  | reglas aprobadas: 25 | incompletas: 0
prod 1440 /ayuda                   violaciones: 0  | reglas aprobadas: 21 | incompletas: 0
prod 1440 /ayuda/ebooks            violaciones: 0  | reglas aprobadas: 22 | incompletas: 0
prod 1440 /sign-in                 violaciones: 0  | reglas aprobadas: 25 | incompletas: 0
prod 1440 /register                violaciones: 0  | reglas aprobadas: 24 | incompletas: 0
prod 390 /                         violaciones: 0  | reglas aprobadas: 26 | incompletas: 0
prod 390 /catalog                  violaciones: 0  | reglas aprobadas: 26 | incompletas: 0
prod 390 /catalog/editions/373     violaciones: 0  | reglas aprobadas: 24 | incompletas: 0
prod 390 /ofertas                  violaciones: 0  | reglas aprobadas: 25 | incompletas: 0
prod 390 /ayuda                    violaciones: 0  | reglas aprobadas: 21 | incompletas: 0
prod 390 /ayuda/ebooks             violaciones: 0  | reglas aprobadas: 22 | incompletas: 0
prod 390 /sign-in                  violaciones: 0  | reglas aprobadas: 23 | incompletas: 0
prod 390 /register                 violaciones: 0  | reglas aprobadas: 22 | incompletas: 0
local 1440 /cart                   violaciones: 0  | reglas aprobadas: 20 | incompletas: 0
local 1440 /checkout               violaciones: 0  | reglas aprobadas: 17 | incompletas: 0
local 1440 /orders                 violaciones: 0  | reglas aprobadas: 22 | incompletas: 0
local 1440 /orders/10              violaciones: 0  | reglas aprobadas: 28 | incompletas: 1
local 1440 /account                violaciones: 0  | reglas aprobadas: 20 | incompletas: 0
local 1440 /favorites              violaciones: 0  | reglas aprobadas: 25 | incompletas: 0
local 1440 /biblioteca             violaciones: 0  | reglas aprobadas: 24 | incompletas: 0
local 1440 /account/addresses      violaciones: 0  | reglas aprobadas: 24 | incompletas: 0
```

Nota: en el primer pase, /favorites y /biblioteca se analizaron antes de terminar de cargar (5 reglas evaluadas); se repitió el análisis con mayor espera y esos son los resultados que se registran.

## Desbordamiento horizontal (producción, 2026-11-02)

Medida: `document.documentElement.scrollWidth - window.innerWidth` (0 = sin desplazamiento horizontal).

```
320  / 0 · /catalog 0 · /catalog/editions/373 0 · /ofertas 0 · /ayuda 0 · /sign-in 0 · /register 0
390  / 0 · /catalog 0 · /catalog/editions/373 0   (además /cart en local: 0)
768  / 0 · /catalog 0 · /catalog/editions/373 0 · /ofertas 0 · /ayuda 0 · /sign-in 0 · /register 0
1024 / 0 · /catalog 0 · /catalog/editions/373 0 · /ofertas 0 · /ayuda 0 · /sign-in 0 · /register 0
```

## Contraste de la paleta (cálculo de luminancia relativa WCAG)

```
Tinta #252740 sobre papel #f6f5f0        13.3:1
Ultramar #283da8 sobre papel #f6f5f0      8.3:1
Blanco sobre ultramar #283da8             9.0:1
Tinta sobre amarillo #f3df83             10.9:1
Tinta sobre lavanda #e4def4              11.1:1
```

## Arquitectura de documentos

Las rutas `/`, `/catalog`, `/ofertas`, `/ayuda`, `/cart` y una ruta inexistente devuelven el mismo documento HTML
(hash SHA-256 idéntico `b52f3dec5315…`): PLIEGO es una aplicación de página única (SPA).

## Revisión del resultado «incompleta» en `/orders/10`

La regla incompleta es `color-contrast` (WCAG 1.4.3), con 5 nodos. No es un fallo: axe no pudo identificar el color de fondo y dejó esos nodos para revisión manual.

- 4 nodos (`bgOverlap`): la fecha de retiro, el párrafo de instrucciones, «Ver ubicación en el mapa» y el título del libro. Las teselas del mapa OpenStreetMap se posicionan fuera de su marco y el marco las recorta (`overflow: hidden`). Aunque no se ven, sus rectángulos se superponen al texto cercano y axe los cuenta como superposición.
- 1 nodo (`imgNode`): la atribución «© OpenStreetMap», que está encima de la imagen del mapa.

Revisión manual (contraste calculado): fecha 13,9:1 · párrafo 6,5:1 · enlace 8,7:1 · título 14,6:1 · atribución entre 9,5:1 (peor caso, tesela negra bajo un fondo blanco al 82 %) y 14,2:1. Todos superan el mínimo de 4,5:1.
