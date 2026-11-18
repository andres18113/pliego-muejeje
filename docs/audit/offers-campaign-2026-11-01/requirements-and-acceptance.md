# Campaña finita de ofertas: requisitos y aceptación

Alcance autorizado: preparar herramientas, candidatos y evidencia local. No se accede a producción, no se renuevan las 23 ofertas anteriores y no se publican cambios. Los artefactos aprobados, las migraciones anteriores, catálogo, inventario, precios base y portadas se preservan.

| ID | Requisito | Criterio y evidencia |
|---|---|---|
| O1 | Identificar la causa antes de cambiar precios o código de vigencia | Trazar `fn_edition_offer`, búsqueda/facetas REST y las fechas del plan del 6/10. Reproducir oferta vencida con precio base y ausencia de oferta pública. |
| O2 | Campaña nueva de 18–24 ediciones equilibradas | Siete por tipo: PHYSICAL, EBOOK y AUDIOBOOK; selector permite 6–8 por tipo. Plan histórico concreto de 21 filas y ensayo local separado. |
| O3 | Excluir campaña anterior y cualquier fila de oferta | Excluir tanto IDs como SKU del plan anterior; exigir `offerRowExists == false` desde ruta ADMIN existente. Una fila vencida o inactiva también impide escribir. Campo ausente falla de forma cerrada. |
| O4 | Elegibilidad pública | Estado ACTIVE, detalle público disponible, SKU canónico, portada HTTPS del CDN. Edición física con stock positivo; digital disponible. Falta de candidatos provoca error. |
| O5 | Mantener política de descuentos aprobada | Físico/AUDIOBOOK: base <15 →10 %, <25 →15 %, ≥25 →20 %. EBOOK: <10 →15 %, <18 →20 %, ≥18 →25 %. Precio a centavos con ROUND_HALF_UP; verificar porcentaje efectivo de PostgreSQL. |
| O6 | Cambiar duración, conservar vencimiento | Solo 3, 5 o 7 días; cada tipo contiene 3 y 7 días. Fechas no persistidas en el plan: calcular un inicio común al aplicar en America/Guayaquil. Seis de 21 ofertas terminan en ≤3 días; nueve duran 7 días. |
| O7 | Preflight completo y visible | Antes del primer PUT, validar cada edición y mostrar ID, SKU, formato, stock, base, oferta, porcentaje solicitado, inicio y fin. Revalidar inmediatamente antes de cada PUT. Cambios de base/stock/identidad/portada o fila de oferta provocan error. |
| O8 | Aplicación exclusivamente por API existente | Herramienta no importa drivers SQL ni ejecuta psql; usa GET `/admin/editions`, detalle/ofertas públicos y PUT `/admin/editions/{id}/offer`. El ensayo SQL queda exclusivamente en el harness local. |
| O9 | Secuencia segura por defecto | `run` es dry-run por defecto. Aplicar exige `--apply`, diario nuevo, informe nuevo y reconocimiento de ventana exclusiva. Todas las escrituras usan las tres condiciones del modo create-only en el PUT existente. |
| O10 | Concurrencia y fallos parciales | Mantener upsert sin cabeceras; modo protegido verifica ausencia y precio/stock bajo bloqueos de PostgreSQL. Dos creadores: uno crea, otro P1001/400; cambios concurrentes de base/stock rechazan sin fila nueva. No hay transacción de toda la campaña. Diario durable, sin reintento ni rollback ciego. |
| O11 | Seguridad | ADMIN requerido en API y rutina; CUSTOMER →403, sin token →401. Rutina exige actor ADMIN; PUBLIC sin EXECUTE. URL local por defecto, producción solo canónica con referencia de autorización. Sin credenciales en URL, redirecciones ni proxy heredado. Token solo por entorno, nunca artefactos. |
| O12 | Verificación comercial | Detalles, precios, ahorro, fechas, días, endingSoon y lista pública; 12 combinaciones de tipo/orden y facetas. Carrito real fixture con 21 precios, vacío al terminar; sin checkout. |
| O13 | Regresión y preservación | Hashes de ediciones/inventario/movimientos idénticos antes/después; filas previas intactas; rerun rechazado. Gate SQL BEGIN/ROLLBACK vence las 21 ofertas, verifica retorno al precio base y restaura filas y fechas exactas. |
| O14 | Evidencia honesta | Candidatos reales proceden de snapshots archivados: estado actual de ofertas, stock y disponibilidad desconocido hasta preflight autorizado. Catálogo sintético local identificado como fixture. Sin afirmar comprobaciones actuales de producción ni garantía atómica de creación. |

Pruebas de comportamiento de la herramienta: `python3 -m unittest discover -s scripts/ops/offers-campaign -p 'test_*.py'`. Gates con PostgreSQL 18 real: `offers_campaign_gate.sql` y `offers_campaign_http_gate.py`; regresión de ofertas existente a cargo de la ejecución conjunta del repositorio.
