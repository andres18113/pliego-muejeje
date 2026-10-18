# Validación: cédula, facturación académica y retorno seguro

Fecha: 2026-10-17. Plan aprobado: [implementación](../superpowers/plans/2026-10-17-cedula-facturacion-navegacion.md).

## Resultado funcional

- Cédula como atributo privado, nunca PK/JWT/URL: PostgreSQL valida diez dígitos ASCII, módulo10 y valores repetidos; Java/React comparten32casos. No verifica existencia ni titularidad ni añade restricciones territoriales no acreditadas.
- Perfil opcional y recursos propios GET/PUT/DELETE; nuevo checkout exige captura nominativa independiente de entrega. Legacy preservado durante transición.
- Factura/borrador, emisión tras confirmar pago/pedido, aprobación ADMIN, cancelación pendiente sin devolución de stock/crédito, reembolso con crédito total idempotente. Snapshots y recibos históricos no se recalculan.
- PDF/XML privados derivados, encolados en la transacción de emisión; workers con lease, fencing y cinco intentos. Estado de archivos separado del pago y de la procedencia SIMULATED/LEGACY. No hay SRI, firma ni validez fiscal.
- Flecha global en cabeceras pública/compra/error; historial interno autorizado, filtros agrupados, fallback, autoridad de sesión y rutas consumidas. Regresar no cancela ni reenvía comandos.

## Evidencia ejecutada

| Verificación | Resultado | Registro completo local |
|---|---|---|
| Maven verify final |283 pruebas,0 fallos,0 errores|`/tmp/pliego-implementation-logs/backend-final-verify4.log`|
| Frontend completo tras fixes sesión/pedido/auth |860 pruebas en83 archivos, todas aprobadas|`/tmp/pliego-implementation-logs/frontend-auth-final-tests.log`|
| Regresión cliente API tras regenerar OpenAPI |146 pruebas en15 archivos, todas aprobadas|`/tmp/pliego-implementation-logs/frontend-final-api-regression.log`|
| Build/TypeScript final |salida 0|`/tmp/pliego-implementation-logs/frontend-delivery-build.log`|
| Chromium: navegación, facturación, carrito y dos pestañas |54 pruebas aprobadas|`/tmp/pliego-implementation-logs/browser-acceptance.log`|
| Navegador live ampliado: exploración y dos compras completas |4 E2E aprobadas, tarjeta y transferencia con cancelación|`/tmp/pliego-implementation-logs/final-live-browser-expanded.log`|
| Upgrade real Flyway 66→70→73 |aprobado; historial al 15 %, recibos y archivos conservados; nuevas compras físicas/retiro/digital/mixtas|`/tmp/pliego-implementation-logs/billing-upgrade-green.log`|
| HTTP real de factura, perfil, replay, ADMIN y archivos |aprobado, incluido comprador Unicode y dirección compuesta máxima|`/tmp/pliego-implementation-logs/billing-boundary-http-green.log`|
| Dos trabajadores/conexiones independientes |claims distintos, propietario, publicación única y SHA256 aprobados|`/tmp/pliego-implementation-logs/artifacts-concurrency.log`|
| Rol runtime de prueba sin privilegios elevados |aprobado, grants/rol revierten en transacción|`/tmp/pliego-implementation-logs/runtime-privileges.log`|
| Runner completo PostgreSQL18/HTTP/browser congelado |aprobado, salida 0; 34 gates SQL + 34 scripts de concurrencia/HTTP, autenticación adicional y 2 E2E live|`/tmp/pliego-implementation-logs/verified-postgres-http-browser.log`|

Carga local:20 checkouts concurrentes por flujo,20 resultados correctos; p95 legacy 84,12 ms frente a facturado 75,79 ms. Incluye arranque de procesos/conexiones, no representa capacidad de producción ni certificación ISO. No superó umbral de regresión del 20 % del plan.

## Revisiones y regresiones incorporadas

Agentes nativos implementaron áreas independientes y revisaron identidad, artefactos, navegación e integración. La revisión final independiente declaró atendidos todos los hallazgos acotados (`final-acceptance-review.md`). Una revisión posterior (`navigation-last-review.md`) confirmó el retorno a checkout no consumido y la preservación de la clave auth activa durante el cambio de sesión. Los informes están en el directorio local de logs.

Corregidos y reproducidos antes de la solución: bypass de replay fiscal por firmas SQL legacy; horario/deadline al aprobar pendientes; cancelación y acciones de borrador; disponibilidad histórica y ruta ADMIN; retorno `/checkout/`; pointerdown del menú seguido de click; login consumido antes de completar el retorno a edición; PII fiscal innecesaria en almacenamiento del navegador; modal/mensajes de cancelación que atravesaban pedidos A→B→A; direcciones compuestas y Unicode capaces de impedir artefactos; inventario OpenAPI desactualizado. RED/GREEN específicos permanecen en los logs y handoffs locales.

## Límites y decisiones explícitas

- Solo migraciones nuevas V071–V073. No se editaron V001–V070 ni baselines aprobados. Trabajo sobre cambios locales preexistentes, sin commit, push, despliegue ni actualización de la BD persistente del usuario. Las pruebas usaron bases/clúster desechables.
- Almacenamiento académico privado bytea de hasta 10 MiB permite publicación atómica y varias instancias sin filesystem compartido; una migración a object storage requerirá preservar esas garantías.
- PDF usa WinAnsi: caracteres fuera de la fuente muestran notación reversible `[U+HEX]` y nota visible; original conservado en ActualText y XML. No se afirma soporte visual Unicode completo ni PDF/UA. XML valida offline contra XSD SRI 1.1.0 con origen/hash fijados.
- El modelo SECURITY INVOKER confía en credenciales del intermediario backend. El probe no acredita ACLs de una instalación externa ni aislamiento frente a quien posea esas credenciales. [Límites y aprovisionamiento](../deployment/billing-runtime-privileges.md).
- Retención y borrado se fijan por entorno académico; no se inventa una obligación fiscal para conservar simulaciones. Principios de calidad, minimización, trazabilidad, compatibilidad y recuperación se materializan en contratos/tests/ADR, sin afirmar certificación.
- 54 E2E usan navegador real con transporte simulado. El runner live usa PostgreSQL/JDBC/backend reales: sus 2 E2E se aprobaron y se registran por separado. Las 3 pruebas adicionales de registro con fixture Mailtrap especial se omitieron por su precondición explícita y no se cuentan como aprobadas.

## Observaciones del entorno de verificación

La primera repetición del runner se interrumpió al modificarse el archivo shell durante su ejecución; la sintaxis del archivo final es válida. Una ejecución posterior sufrió un 500 al reemplazarse el JAR bajo un classloader activo: el mismo gate pasó al reiniciar con JARestable. El runner ahora usa copia privada inmutable y permite conservar su log con `PLIEGO_GATE_LOG_DIR`. Una dirección sintética de prueba tenía 201 caracteres y fue correctamente rechazada; se corrigió el fixture a 200, sin relajar validación. Estos incidentes no se contabilizan como suites aprobadas.

## Decisiones de ejecución registradas

1. Trabajar en el árbol actual con propiedad de archivos por agente para conservar los cambios locales preexistentes; no crear otra rama ni commit automático. Revisar conjuntamente cambios previos y nuevos requiere el estado inicial registrado.
2. Usar el plan expresamente aprobado como especificación; las decisiones concretas de implementación se documentan en ADR nuevos. Un cambio de alcance posterior requerirá revisar estos contratos.
3. Archivos privados como bytea de hasta 10 MiB para publicación atómica; un despliegue de archivos de mayor escala requerirá migración de almacenamiento.
4. PDF con representación Unicode reversible declarada, original en ActualText/XML; una representación visual completa requiere una fuente Unicode embebida posterior.

La última corrección de auth se reprodujo con SessionProvider/SignInPage reales: preserva espera y guards de autoridad/vista, consume rutas anteriores y retira la activa al salir. Las dos compras completas pasaron contra API real. Los ajustes de fixtures mantuvieron todas las aserciones: selectores Ciudad/Provincia exactos, mismo teléfono canónico sin el 0 nacional y un titular sintético sin dígitos según la regla ya vigente.
