# Campaña de ofertas — 1 de noviembre de 2026

La campaña anterior terminó por sus fechas aprobadas: las 23 filas del [plan del 6/10](../demonstration-offers-2026-10-06/plan.json) vencían el 9, 13 o 21 de octubre de 2026 a las 23:59:59 de America/Guayaquil. El estado almacenado ACTIVE no convierte una oferta vencida en vigente. No se renovaron ni editaron esas filas.

`fn_edition_offer` de V044 aplica la ventana semiabierta `[inicio, fin)`, estado ACTIVE y precio inferior al precio base. Después de `fin` devuelve el precio base y `offer_id = NULL`. La búsqueda de ofertas vigente en V078 y `fn_offers_filter_options` requieren un `offer_id` proyectado; catálogo y carrito reutilizan ese precio. Esta ruta explica la desaparición esperada de las ofertas al vencer. Los gates locales reproducen ese comportamiento. No se consultó producción: no se afirma una inspección actual de sus filas o reloj; la explicación parte de las fechas preservadas y del contrato aprobado.

El [plan candidato](candidate-plan.json) contiene **21 ediciones reales distintas: siete físicas, siete EBOOK y siete AUDIOBOOK**. Procede de los artefactos versionados del catálogo del 4–5/10, con hashes de fuentes y verificación pública histórica. La fuente final contiene estados de la limpieza y se filtra también por verificación pública archivada. Se excluyen ambos, ID y SKU, del plan anterior, además del SKU protegido PLG-BK-000042. Es un borrador histórico revisable: el stock, disponibilidad y presencia de otras ofertas actuales son desconocidos hasta un preflight autorizado. No es evidencia de elegibilidad actual de producción.

La política de descuentos por formato y tramo de precio permanece idéntica a la [autorización anterior](../demonstration-offers-2026-10-06/README.md). Solo se cambian duraciones: 3, 5 y 7 días. Cada tipo contiene dos ofertas de 3 días, dos de 5 y tres de 7; seis ofertas quedan en el umbral endingSoon ≤3 días y nueve duran 7 días. No se guardan fechas fijas en el plan: se calculan al aplicar con un inicio común en America/Guayaquil y fin = inicio + duración. El redondeo a centavos puede cambiar ligeramente el porcentaje efectivo mostrado por PostgreSQL.

## Implementación y garantías

La [herramienta](../../../scripts/ops/offers-campaign/README.md) usa únicamente rutas existentes de la API. `run` consulta por defecto, imprime ID/SKU/formato/stock/precio base/precio oferta/porcentaje/inicio/fin y guarda un informe opcional. Preflight de toda la campaña antes de escribir y segunda comprobación por fila. Rechaza filas de oferta existentes, incluso vencidas o inactivas, falta del nuevo campo ADMIN, cambios de base o stock y ediciones que no son públicas, disponibles o con portada CDN.

V098 y [ADR 0052](../../adr/0052-conditional-creation-for-edition-offers.md) añaden `offerRowExists` a la búsqueda ADMIN existente y un modo protegido al PUT existente. La herramienta siempre envía las tres condiciones: `If-None-Match: *`, `X-Expected-Base-Price` y `X-Expected-Stock`. PostgreSQL bloquea edición, libro e inventario físico; exige ausencia de cualquier fila, base/stock iguales, estado público y portada CDN. Una carrera de creación o de modificación de base/stock se rechaza sin sustituir una oferta. Las precondiciones fallidas conservan **P1001/HTTP 400**. Sin cabeceras, el PUT mantiene el upsert original.

La garantía es por comando, no por toda la campaña. Cada PUT confirma separadamente y una falla posterior puede dejar una aplicación parcial. Un administrador aún puede editar legítimamente una oferta después de su creación mediante el upsert existente. El lock local y la coordinación de operadores son medidas adicionales; no se presentan como bloqueo global. El diario durable registra intento antes de escribir y confirmación/verificación después. No hay reintentos automáticos ni rollback ciego; un timeout puede corresponder a una escritura ya confirmada.

## Evidencia local

El [contrato y matriz de aceptación](requirements-and-acceptance.md) incluye seguridad, concurrencia y regresión. El ensayo utiliza PostgreSQL 18 nativo en una base desechable y el backend Java 25 real; no usa Docker ni producción. Se recrean localmente las 23 ofertas anteriores con sus SKU y fechas, con IDs de fixture propios; el nuevo catálogo de ensayo es sintético y se identifica por separado del plan real archivado.

El [resumen verificable](verification.json) registra PostgreSQL 18.6, Java 25, 98 migraciones aplicadas y comparación exacta de sus recursos con el JAR final revisado. La verificación Maven conjunta pasó 554 pruebas: cero fallos/errores y una omitida.

- [17 pruebas de comportamiento](unit-tests.txt) aprobadas.
- [Gate SQL](sql-gate.txt) aprobado: ausencia, filas vencidas/inactivas, permisos, precondiciones y elegibilidad.
- [Ensayo HTTP](local-gates.json): 21 ofertas nuevas (7/7/7), seis endingSoon, 12 combinaciones de filtros/órdenes y facetas exactas; 23 filas anteriores recreadas localmente y preservadas; 21 precios de carrito correctos, carrito vacío y cero pedidos. Catálogo, inventario y movimientos idénticos durante la campaña. Dry-run sin cambios y rerun rechazado.
- [Detalle público y preflight](local-applied.json), [tabla visible previa a escritura](local-preflight.txt), [diario](local-write-receipts.jsonl) y [precios de carrito](local-cart-prices.json) conservados sin tokens.
- [Gate de vencimiento](local-expiration-gate.sql) aprobado con BEGIN/ROLLBACK: 21 ofertas dejan de aplicar, vuelven al precio base y se restauran filas/fechas exactas.
- [Cuatro carreras nativas](concurrency-gate.txt) aprobadas: creación única, cambios de base/stock y comando real de inventario sin interbloqueo. La contención física falla de forma cerrada mediante NOWAIT/P1001. Además, dos PUT HTTP simultáneos producen 204 y P1001/400; seis combinaciones incompletas de cabeceras se rechazan.

Los logs extensos del backend y ejecución local permanecen en `/tmp/pliego-nov01/logs/`; los artefactos versionados no contienen credenciales. El [plan de fixture local](local-fixture-plan.json) se identifica como evidencia de ensayo y se distingue del plan candidato de catálogo real.

## Comandos futuros de producción: preparados, no ejecutados

Requieren una **autorización nueva y explícita del usuario** para acceder y escribir en producción, y que una publicación independiente autorizada haya instalado la API completa y V098. La autorización de pruebas locales no permite ejecutar estos comandos. El token ADMIN se proporciona solo por `OFFER_ADMIN_TOKEN`. La referencia siguiente identifica esa autorización futura; no la crea.

Primero, consultar el preflight actual del plan candidato sin escrituras:

```bash
python3 scripts/ops/offers-campaign/campaign.py run \
  --base-url https://api.pliegolibros.com --target production \
  --authorization-reference autorizacion-explicita-campana-ofertas-2026-11-01 \
  --plan docs/audit/offers-campaign-2026-11-01/candidate-plan.json \
  --report /tmp/pliego-ofertas-produccion-preflight-2026-11-01.json
```

Si cualquier candidato cambió, se detiene; no se fuerza ni se debilitan comprobaciones. Tras revisar un preflight válido y coordinar operadores, el comando de aplicación preparado es:

```bash
python3 scripts/ops/offers-campaign/campaign.py run \
  --base-url https://api.pliegolibros.com --target production \
  --authorization-reference autorizacion-explicita-campana-ofertas-2026-11-01 \
  --plan docs/audit/offers-campaign-2026-11-01/candidate-plan.json \
  --report /tmp/pliego-ofertas-produccion-aplicada-2026-11-01.json \
  --journal /tmp/pliego-ofertas-produccion-escrituras-2026-11-01.jsonl \
  --exclusive-writer-window --apply
```

Las fechas se calculan en el momento real de esa ejecución, aunque el nombre del archivo conserve la fecha de preparación. Ningún comando de producción, SSH, base/API productiva, commit, push o despliegue se ejecutó en este trabajo.
