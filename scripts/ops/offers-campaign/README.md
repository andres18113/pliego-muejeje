# Operación de campaña finita

`campaign.py` prepara candidatos y utiliza exclusivamente las rutas HTTP existentes para preflight y aplicación. Requiere Python 3.11+ y el nuevo campo ADMIN `offerRowExists` incorporado por V098. Una versión anterior de la API falla de forma cerrada: no interpreta la ausencia de ese campo como ausencia de oferta.

```bash
python3 scripts/ops/offers-campaign/campaign.py draft \
  --base-url https://api.pliegolibros.com --target production \
  --plan /tmp/pliego-candidatos-historicos.json
```

`draft` solo lee tres artefactos versionados del 4–5 de octubre: no usa red ni token. Produce candidatos de catálogo real con advertencia de antigüedad y hashes de fuentes. Nunca demuestra el stock ni la ausencia de otras ofertas actuales.

Para una API local ya iniciada, proporcionar un token ADMIN en `OFFER_ADMIN_TOKEN`, sin colocarlo en argumentos ni archivos versionados:

```bash
python3 scripts/ops/offers-campaign/campaign.py plan \
  --base-url http://127.0.0.1:18081 --plan /tmp/pliego-campana-local.json
python3 scripts/ops/offers-campaign/campaign.py run \
  --base-url http://127.0.0.1:18081 --plan /tmp/pliego-campana-local.json \
  --report /tmp/pliego-preflight-local.json
python3 scripts/ops/offers-campaign/campaign.py run \
  --base-url http://127.0.0.1:18081 --plan /tmp/pliego-campana-local.json \
  --report /tmp/pliego-aplicada-local.json --journal /tmp/pliego-escrituras-local.jsonl \
  --exclusive-writer-window --apply
```

Sin `--apply`, la ejecución solo consulta y muestra las 21 filas del preflight. El plan contiene duraciones, no fechas fijas. El inicio se calcula nuevamente después del preflight completo, al aplicar; cada fin es inicio más duración. Los informes muestran fechas, precios y porcentajes efectivos verificados. Los archivos nuevos se crean con permisos 0600 y no se sobrescriben.

El PUT sin condiciones conserva su **upsert**. La herramienta siempre envía `If-None-Match: *`, `X-Expected-Base-Price` y `X-Expected-Stock` (o `NONE` para digital): V098 bloquea edición, libro e inventario físico y rechaza atómicamente cualquier fila de oferta existente o un cambio de precio/stock. La API devuelve P1001/HTTP 400 si falla una condición; no se cambian los mapeos aprobados. Un competidor que cree la oferta entre GET y PUT hace que el PUT protegido falle, sin sustituirlo.

La campaña completa sigue siendo una secuencia de transacciones individuales. El lock local y `--exclusive-writer-window` ayudan a coordinar operadores; no impiden procesos remotos, compras ni futuras ediciones administrativas mediante el upsert legítimo. No se promete una transacción de las 21 escrituras ni inmutabilidad posterior de una oferta.

El diario registra y sincroniza a disco un `attempt` antes del PUT, `http-204` después de confirmación y `public-verified` tras verificar el detalle. Un timeout puede haber dejado una escritura confirmada en el servidor: detenerse y revisar el diario y los detalles, sin reintentar ciegamente. Una campaña parcialmente aplicada permanece parcial. No existe rollback automático que pueda borrar una oferta concurrente. Un rerun rechaza las filas que ya existen.

Si se autoriza posteriormente retirar una campaña, la API DELETE de oferta marca filas INACTIVE; no elimina el historial y un futuro plan las seguirá excluyendo. Antes de retirar cualquier fila debe comprobarse que pertenece exactamente a la campaña y coordinar escritores. Si ya venció, el detalle público no permite probar su contenido: hace falta una inspección administrativa autorizada; no ejecutar eliminaciones ciegas desde el diario.

El comando exacto de futura aplicación en producción y sus condiciones se mantienen en [el informe de auditoría](../../../docs/audit/offers-campaign-2026-11-01/README.md). No fue ejecutado.
