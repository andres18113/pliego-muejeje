# Plan de implementación: cédula ecuatoriana, facturación simulada y navegación atrás

> Para ejecutores: usar `superpowers:subagent-driven-development` o `superpowers:executing-plans`, con tareas verificables y revisión independiente. Método preferido por el usuario: subagentes nativos de Codex; investigación y revisión en paralelo cuando no compartan dependencias ni escrituras.

**Fecha:** 2026-10-17. **Estado:** aprobado por el usuario el 2026-10-17 para ejecución; la evidencia de resultados se registra por separado.

**Objetivo:** validar cédulas en PostgreSQL y reflejar la regla en backend/frontend; emitir automáticamente documentos académicos por pedido; proporcionar retorno seguro en toda la navegación.

**Arquitectura:** monolito modular, Controller → Application Service transaccional → JDBC Gateway → Database API pública. PostgreSQL conserva las invariantes; React presenta resultados autoritativos.

**Tecnologías:** Java 25, Spring Boot, Spring JDBC, PostgreSQL 18, Flyway; React, TypeScript, React Router, TanStack Query y Mantine existentes. Sin JPA/Hibernate, Docker ni integración real con SRI.

**Especificación de partida:** solicitud y decisiones de este documento, aprobadas por el usuario. Los ajustes concretos de ejecución y sus límites se registran en los ADR y el informe de validación.

## 1. Evidencia del repositorio y alcance

- `V002`: `usuario_id` y `cliente_id` ya son claves internas BIGINT IDENTITY. Mantenerlas; no reemplazarlas por cédula ni migrarlas a UUID sin necesidad.
- `V034__invoices_and_post_purchase_projections.sql` y ADR-0017: ya existen `factura`, `factura_direccion`, `factura_item`, `factura_emision_electronica`, `factura_archivo`, `nota_credito` y emisión manual ADMIN. `pedido_id` ya es único en factura.
- ADR-0022 y ADR-0033/V067: monetarios autoritativos e históricos; catálogo configurado al 0 %. Cero actual puede conservar `NOT_ASSESSED`: no equivale automáticamente a clasificación tributaria validada.
- ADR-0030: `sp_checkout_quoted`, fingerprint de cotización y recibo inmutable de idempotencia. ADR-0031: autoridad de sesión y vida de la vista protegen continuaciones.
- ADR-0013 y `frontend/src/app/App.tsx`: layout global y política de foco; `BackToCatalogLink.tsx` ya permite retorno contextual y, opcionalmente, `navigate(-1)`.
- El árbol contiene cambios locales y V066–V070 sin consolidar. No sobrescribirlos; determinar el siguiente número Flyway libre al ejecutar. Los nombres de migraciones siguientes son descriptivos, no versiones reservadas.

**Fuera de alcance:** autenticación por cédula, consulta al Registro Civil, biometría, firma .p12, envío a SRI, autorización fiscal, devoluciones parciales y motor tributario multinacional. El servicio de facturación será un módulo del monolito, no un microservicio.

## 2. Revisión normativa concisa

La cédula es un dato personal. La LOPDP exige una base legitimadora (art. 7), finalidad, minimización, proporcionalidad, conservación limitada y confidencialidad (art. 10), información al titular (art. 12), seguridad y protección desde el diseño (arts. 37 y 39). No se identificó una prohibición literal de usarla como clave primaria: mantener una clave interna es una decisión de privacidad que reduce exposición y acoplamiento, no una cita textual de la ley. Un ID interno tampoco anonimiza los registros vinculados. Para PLIEGO: pedir la cédula al facturar, no para explorar; documentar finalidad/base jurídica y retención; restringir acceso y permitir rectificación del perfil sin alterar documentos históricos legítimamente conservados. El consentimiento comercial debe ser independiente. [LOPDP, texto publicado por entidad pública](https://www.finanzaspopulares.gob.ec/wp-content/uploads/2021/07/ley_organica_de_proteccion_de_datos_personales.pdf).

El SRI publica la ficha técnica offline **2.34, julio de 2026**. Referencia para la simulación: factura `01`, identificación cédula `05`, emisor/RUC, establecimiento y punto de emisión, secuencial, fecha, comprador, detalles, descuentos, impuestos, total y pagos. Separar tipo tributario y tipo interno. La simulación producirá XML sin firma y PDF con leyenda **«SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA»**; jamás una autorización SRI. Los campos condicionales y códigos se verificarán contra el XSD de factura seleccionado, no solo contra ejemplos. [Portal oficial y ficha vigente](https://www.sri.gob.ec/facturacion-electronica).

La ficha contempla otros tipos de identificación; el primer incremento habilitará cédula, conservando documentos y tipos históricos. Consumidor final, RUC y pasaporte nuevos requieren reglas propias; no aplicarles el validador de cédula ni habilitarlos por accidente.

## 3. Decisiones de arquitectura propuestas

Se recomienda ampliar el modelo existente. Crear otro subsistema de facturas duplicaría snapshots y autorizaciones; separar un microservicio introduciría consistencia distribuida sin beneficio académico inmediato.

1. Mantener claves internas y relaciones existentes. Guardar identificación facturable como atributo protegido y mutable del perfil; copiarla al documento al emitir.
2. Añadir `com.pliego.modules.billing` para consultas/descargas y generación de artefactos. `sales` conserva checkout y cancelación. Un comando público PostgreSQL orquesta la operación completa; ningún servicio Java escribe SQL de negocio ni invoca controladores de otro módulo.
3. Pedido y documento académico se crean juntos. Pago aprobado: factura `ISSUED`; pago pendiente: factura `DRAFT` con identidad/líneas fijadas y sin número definitivo; pago rechazado: ninguna factura emitida. Si el flujo actual no persiste pedido rechazado, no inventarlo.
4. Aprobación posterior emite el mismo documento una sola vez. Cancelación antes de emisión invalida el borrador con transición tipada nueva; después de emisión conserva factura y genera nota de crédito total al confirmar el reembolso, no al solicitarlo.
5. La validez fiscal es una dimensión explícita: `SIMULATED`, separada de `DRAFT/ISSUED` y de estados del proveedor. No usar `AUTHORIZED` para una simulación. Documentos antiguos sin esa procedencia permanecen `LEGACY`, sin afirmar origen o cumplimiento retroactivo.
6. PDF/XML son derivados regenerables del snapshot; fallo del generador no deshace una compra confirmada. Una cola tipada propia de facturación permite reintentos, reclamo por trabajador y reconciliación. No reutilizar la outbox de correo con otra semántica.

Publicar ADR nuevos propuestos para identidad/privacidad, emisión automática y retorno seguro; añadirlos al índice al aceptarlos. No reescribir decisiones históricas ni baselines aprobados.

## 4. Entrega A: cédula en las tres capas

**Archivos existentes:** `shared/validation/person-rules.json`, `person-cases.json`, `scripts/generate-person-validation-rules.mjs`; `foundation/validation/PersonRules.java`; `modules/customer/{api,application,gateway}`; `frontend/src/shared/validation/person.ts`, `features/account/AccountPage.tsx`, `features/purchase/CheckoutPage.tsx`.

**Nuevos:** migración `ecuador_billing_identity`; `foundation/validation/EcuadorianCedula.java`; `frontend/src/shared/ui/EcuadorianCedulaInput.tsx`; fixtures compartidos sin datos de personas reales.

Interfaz propuesta: `pliego.fn_is_valid_ec_cedula(text) RETURNS boolean`, pura, determinista, `IMMUTABLE`; `NULL`/vacío devuelve false. Actualización del perfil mediante una rutina pública autorizada por actor, no DML desde Java. Campo REST `billingIdentity: { type: "EC_CEDULA", number: string }`; la omisión conserva el valor existente, borrarlo es una operación explícita y no borra snapshots.

- [x] A1. Definir contratos, finalidad y acceso. Cédula opcional para cuentas existentes y registro; obligatoria al nuevo checkout con factura nominativa. No convertirla en usuario, JWT subject, URL, FK ni clave de caché. No imponer unicidad global entre cuentas sin prueba de titularidad: conocer un número no acredita identidad.
- [x] A2. Fijar casos compartidos y pruebas fallidas: longitud distinta de 10, espacios internos, signo, decimales, letras, dígitos Unicode, ceros iniciales, verificador erróneo, entrada nula y acceso cruzado. Conservar ceros iniciales como texto; solo recortar espacios externos de manera consistente.
- [x] A3. Implementar en BD formato `[0-9]{10}` y módulo 10 sobre las nueve primeras posiciones, coeficientes `2,1,2,1,2,1,2,1,2`, restando 9 a productos mayores de 9; último dígito `(10 - suma % 10) % 10`. Rechazar secuencias evidentemente inválidas, incluido todo ceros.
- [x] A4. Verificar con documentación primaria el rango de prefijos y excepciones de NUI antes de imponer provincia/tercer dígito como rechazo definitivo. No asumir que un algoritmo divulgado en blogs acredita todos los documentos vigentes. Hasta resolverlo, denominar el resultado «formato y dígito verificador válidos», nunca identidad verificada.
- [x] A5. Proteger todas las escrituras nuevas con CHECK/función y rutinas, incluidas emisión manual nueva e importaciones permitidas. No invalidar documentos históricos ni normalizarlos retroactivamente. Aplicar la regla a nuevos atributos/versiones sin debilitar las restricciones anteriores.
- [x] A6. Reflejar el mismo contrato en Java y React. Backend rechaza antes de JDBC para feedback; BD vuelve a validar sin depender de Java. Frontend usa texto, `inputMode="numeric"`, etiqueta Cédula y error accesible. Mensaje: «Ingresa una cédula ecuatoriana válida de 10 dígitos».
- [x] A7. Exponer número completo únicamente en edición propia y documentos autorizados; en listados usar máscara. Excluirlo de logs, trazas, analítica, URLs y errores. Proteger backups y conexión; si el análisis de riesgo requiere cifrado de campo, resolver validación y gestión de claves en ADR antes de implementarlo; un hash simple no protege un espacio de 10 dígitos.

**Aceptación:** PostgreSQL rechaza entradas inválidas por todas las rutas nuevas; Java/React coinciden con fixtures; cambiar cédula no cambia IDs, pedidos ni facturas anteriores; clientes sin cédula pueden navegar y completar su perfil.

## 5. Entrega B: facturación automática y documentos académicos

**Modificar:** `modules/sales/application/CheckoutService.java`, `gateway/JdbcCheckoutGateway.java`, `api/CheckoutController.java`, DTO de checkout, `PostPurchaseModels.java`, `PostPurchaseRequests.java`; cancelación/aprobación administrativa y proyecciones correspondientes; `frontend/src/features/purchase/{CheckoutPage,OrderPage,SuccessfulOrderConfirmation}.tsx` y cliente `shared/api/orders.ts`.

**Crear:** migraciones `automatic_academic_billing` y `academic_billing_artifacts`; `modules/billing/api/BillingController.java`, `application/BillingService.java`, `application/InvoiceArtifactWorker.java`, `gateway/BillingGateway.java`, `gateway/JdbcBillingGateway.java`; en frontend `features/purchase/BillingIdentityForm.tsx`.

**Modelo:** extender `factura`/líneas existentes; agregar procedencia, emisor histórico, serie/secuencia, códigos tributarios y estado de borrador invalidado donde falten; conservar tabla de dirección y archivos. Añadir numerador por emisor/establecimiento/punto/tipo y trabajo de artefactos con unicidad `(factura_id,tipo,version)`, intentos y lease. No almacenar negocio en JSON; JSON solo para proyecciones de lectura existentes.

**Interfaces propuestas:** `sp_checkout_billed_quoted` recibe actor, clave idempotente, parámetros actuales, fingerprint y datos de facturación tipados; devuelve pedido y referencia de documento. `sp_invoice_finalize_for_order(actor, order_id)` y `sp_invoice_credit_after_refund(actor, order_id, reason)` son idempotentes y verifican permisos/estado. Sus firmas SQL completas y permisos se fijarán en la enmienda API antes del primer gateway. No dar a CUSTOMER permiso genérico para emitir como ADMIN.

- [x] B1. Añadir contrato de checkout ampliado y enmienda en `docs/api-amendments/`. Datos fiscales independientes del destinatario y dirección de entrega, también en retiro y compras digitales. El comprador confirma nombre/cédula/dirección antes de enviar. El servidor resuelve el snapshot y su versión sin una lectura/escritura vulnerable a cambios concurrentes.
- [x] B2. Pruebas PostgreSQL fallidas de compra física, digital, mixta y retiro, pendiente/aprobada/rechazada; identidad inválida; cancelación; documento duplicado; descuentos y centavos; cero tributario y pedidos históricos al 15 %.
- [x] B3. Implementar el nuevo comando como una sola operación de negocio bajo la transacción Spring. Reusar locks y lógica de checkout autorizada. Pedido, pago, inventario, derechos digitales, recibo, documento y trabajos de generación confirman o revierten juntos. Emitir después de completar tanto la aprobación del pago como la confirmación del pedido; no mediante trigger al insertar el pago, que inicialmente nace pendiente. Inyectar fallo tras crear factura y probar rollback completo.
- [x] B4. Incluir identidad y dirección de facturación normalizadas en la huella del comando idempotente; mantener separado el fingerprint de precios. Igual actor/clave/payload devuelve los mismos IDs; payload diferente conserva `P1010`. Resolver replay antes de consultar carrito vaciado, perfil actual o configuración vigente. No actualizar recibos históricos inmutables después de insertarlos.
- [x] B5. Copiar precios, descuentos, cantidades, impuestos y envío del pedido. Modelar descuentos del comprobante sin descontarlos dos veces: si el pedido solo conserva precio neto, registrar también bases/descuentos necesarios para el nuevo documento. No recalcular desde catálogo, ofertas ni tasa actual. Añadir tratamiento/código tributario explícito para nuevas emisiones: cero, exento y no objeto son conceptos distintos. No reclasificar retrospectivamente `NOT_ASSESSED`.
- [x] B6. Asignar número `establecimiento-punto-secuencial` al emitir, con 3/3/9 dígitos, unicidad y serialización del numerador en BD. Probar dos compras y dos aprobaciones concurrentes; error claro al agotar secuencia. No reutilizar números emitidos o corregidos. Emisor académico y contador aislados de cualquier futuro ambiente real.
- [x] B7. Integrar la transición de pago pendiente→aprobado y reembolso→nota de crédito con los comandos existentes. Borradores pueden actualizarse únicamente por transiciones autorizadas; emisión congela identidad, dirección, emisor, líneas y totales. Conservar documento original, no borrarlo ni editarlo para cancelar. Probar carrera emisión/cancelación y reembolso de pedido legacy sin factura: no inventar factura ni crédito para ese historial.
- [x] B8. Generar XML sin firma y PDF legible con la leyenda académica. Seleccionar una versión XSD de factura publicada por SRI y registrar versión/hash de referencia; la versión de ficha 2.34 no es la versión XML. Validar estructura/códigos; campos como clave de acceso de 49 dígitos, si se incluyen, deben ser sintéticos, identificados y jamás presentados como autorización. No almacenar credenciales ni llamar a entornos SRI, incluido pruebas.
- [x] B9. Generador con leasing, número máximo de intentos, reintento con backoff y recuperación de trabajos huérfanos; publicación atómica e idempotente de artefactos. Persistir checksum, MIME, tamaño y clave privada. No marcar disponible antes de existir el archivo. Probar caída antes/después de publicar y doble trabajador.
- [x] B10. Lecturas propuestas: `GET /api/v1/orders/{orderId}/invoice` y `GET /api/v1/orders/{orderId}/invoice/files/{PDF|XML}`. Validar propietario/ADMIN en Database API y API; descarga autenticada, sin rutas públicas y con caché privada/no-store para PII. Estados visibles: borrador, emitida, documento en preparación o error recuperable. Generación fallida no invita a repetir compra.
- [x] B11. Coexistencia: preservar rutinas legacy y DTO actuales; el frontend nuevo usa el comando ampliado. Clientes antiguos siguen el contrato anterior durante transición explícita, sin inventar cédula. Al activar obligatoriedad global, versionar/rechazar contratos antiguos con error español que pida completar datos; no romperlos silenciosamente. Emisión ADMIN sobre pedido ya facturado devuelve el documento o conflicto tipado, nunca una segunda factura.
- [x] B12. Verificar upgrade desde el último esquema efectivo con pedidos/documentos previos: no facturar retrospectivamente ni alterar tasas, IDs, números o PDFs. Retirada funcional mediante configuración del nuevo flujo y corrección hacia adelante; no borrar facturas ni hacer downgrade destructivo.

**Aceptación:** cada pedido nuevo del flujo ampliado tiene documento; solo pago aprobado emite factura; concurrencia/replay no duplican emisión/crédito; historial inmutable; documento accesible solo por roles autorizados; fallos de PDF/XML se recuperan sin nueva compra.

**Seguridad previa a publicación:** revisar permisos efectivos del rol runtime y acceso directo a tablas. Las rutinas examinadas usan `SECURITY INVOKER`; no asumir que el nombre de la rutina constituye aislamiento. Probar actor autorizado/no autorizado y definir permisos mínimos mediante migración nueva, sin suplantar actor ADMIN. La revisión estática no acredita privilegios de una instalación activa.

## 6. Entrega C: flecha global para volver atrás

**Modificar:** `frontend/src/app/App.tsx`, `app/navigation/SiteHeader.tsx`, `app/navigation/PurchaseHeader.tsx`, `shared/ui/BackToCatalogLink.tsx`; retornos de auth y páginas que hoy generan acciones duplicadas. `ApplicationLayout` usa PurchaseHeader en carrito/checkout; `RouteErrorBoundary` tiene una cabecera propia: los tres casos deben compartir política y evitar proveedores inconsistentes.

**Crear:** `app/navigation/BackNavigationProvider.tsx`, `useBackNavigation.ts`, `BackButton.tsx` y pruebas. Integrar con `features/auth/authLocation.ts`, `app/sessionOperation.ts` y el comportamiento de ADR-0036, sin volver a implementar sus listas de destinos seguros.

Interfaz: `useBackNavigation(): { canGoBack: boolean; fallback: string; goBack(): void }`. Una sola flecha por shell; etiqueta accesible «Volver atrás». No agregar botón adelante. Conservar enlaces contextuales que tengan otra finalidad y evitar dos acciones idénticas.

- [x] C1. Definir historial de visitas internas por `location.key`, ruta y autoridad de sesión; seguir PUSH/REPLACE/POP sin duplicar entradas. Agrupar cambios de filtros de una misma pantalla para que atrás regrese a la pantalla anterior. Conservar query de origen, scroll y paginación.
- [x] C2. Usar `navigate(-1)` solo si se conoce un predecesor interno permitido. `history.length`, `document.referrer` y `from` arbitrario no acreditan un destino seguro. Permitir únicamente rutas relativas conocidas; rechazar URLs externas, protocol-relative y parámetros sensibles de acciones de correo.
- [x] C3. Acceso directo/recarga/nueva pestaña sin predecesor conocido: fallback jerárquico con `replace`: edición→catálogo, pedido→pedidos, documento→pedido, checkout→carrito, carrito→catálogo, dirección→direcciones, artículo→ayuda, vistas ADMIN→`/admin`, privadas sin sesión→ruta pública segura. En raíz sin predecesor ocultar/deshabilitar la flecha, nunca crear un bucle ni salir de PLIEGO. No crear ruta de factura solo para disponer de un destino: actualmente no existe y el documento puede descargarse desde el pedido.
- [x] C4. Al cerrar sesión/cambiar usuario invalidar retornos privados anteriores. Al completar login, recuperación o verificación, reemplazar rutas efímeras y excluir tokens del historial propio. La flecha no debe volver a un formulario consumido ni revelar datos de otra cuenta.
- [x] C5. Tras checkout confirmado, evitar regreso a una pantalla que permita repetir el pago: reemplazar entrada de checkout y reconciliar carrito/pedido; nunca repetir comandos por POP o remontaje. En incertidumbre de red conservar clave idempotente y reconciliar con el pedido antes de ofrecer reintento.
- [x] C6. Atrás no deshace carrito, compra, pago, stock, factura ni reembolso. Navegar durante un comando enviado no lo cancela en BD; invalidar continuaciones visuales y recuperar estado al regresar. Preguntar por cambios locales sin guardar solo cuando realmente se perderían; no interceptar navegación ordinaria sin motivo.
- [x] C7. Modal/panel abierto: la acción cierra primero la capa actual si representa navegación local; siguiente activación vuelve de pantalla. Escape mantiene su comportamiento. Integrar foco de destino y `ScrollRestoration`, teclado, tamaño táctil y ambos temas.
- [x] C8. Probar tabla de rutas públicas, privadas, compra y administración, incluyendo 404/error, acceso directo, recarga, nueva pestaña, origen externo, POP del navegador, A→B→A y respuestas tardías. Verificar a 320/375/768/1440 px. No es posible controlar el historial externo del navegador; la garantía de permanecer dentro aplica a la flecha de PLIEGO.

**Aceptación:** retorno consistente y seguro en todos los shells, sin reenvío de comandos, fuga de sesión, pérdida de filtros ni salidas externas; sin predecesor, fallback verificable.

## 7. Calidad y principios ISO convertidos en evidencia

ISO/IEC 25010:2023 aporta un modelo de calidad de producto; se usarán objetivos verificables de adecuación funcional, fiabilidad, seguridad, mantenibilidad, compatibilidad y eficiencia, sin afirmar certificación. [ISO](https://www.iso.org/standard/78176.html).

ISO/IEC 27001:2022 orienta la gestión de riesgos proporcional al contexto; aquí se concreta en inventario de PII, mínimos privilegios, trazabilidad sin cédulas y recuperación probada. No implica implantar ni certificar un sistema de gestión completo. [ISO](https://www.iso.org/standard/27001).

| Propiedad | Evidencia de aceptación propuesta |
|---|---|
| Integridad/fiabilidad | Rollback inyectado y reintentos concurrentes: cero pedidos/facturas/créditos duplicados y sin efectos parciales |
| Privacidad/seguridad | Matriz propietario/otro cliente/ADMIN/anónimo; logs y cachés sin número completo; prueba de cambio de sesión |
| Compatibilidad/coexistencia | Upgrade con fixtures legacy y contrato antiguo; ningún snapshot histórico modificado |
| Mantenibilidad | Módulos sin ciclos, SQL de negocio solo en Database API, ADR/enmiendas y reglas de validación compartidas |
| Escalabilidad | Numeración serializa solo su serie; trabajadores con lease; consultas paginadas e índices por pedido/propietario/estado de trabajo |
| Eficiencia | Medir antes/después en el mismo entorno con 20 checkouts concurrentes; investigar regresión p95 >20 % y medir esperas de locks; umbral de proyecto, no requisito ISO |
| Usabilidad | Flecha con teclado y foco correcto; error de cédula comprensible; estado de artefacto pendiente distinguible de compra fallida |

## 8. Orden, pruebas y coordinación de agentes

1. **Contrato y decisiones:** aprobar semántica de borrador/emisión y privacidad; escribir ADR como propuestos y enmienda API; inventariar migraciones efectivas y registrar estado inicial sin modificar cambios ajenos.
2. **Identidad A:** pruebas compartidas → migración/rutinas → Java → UI. Entregable independiente: perfil y checkout capaces de validar cédula.
3. **Facturación B:** pruebas reales → emisión transaccional/replay → aprobación/reembolso → lecturas → trabajadores/artefactos → UI. Separar revisión de invariantes de revisión de documentos.
4. **Navegación C:** puede desarrollarse en paralelo con BD/backend, pero coordinar ediciones de CheckoutPage/OrderPage; asignar propietario de esos archivos y fusionar secuencialmente.
5. **Integración:** upgrade, regresiones, revisión independiente y evidencia. No ejecutar agentes que escriban simultáneamente la misma migración, DTO, cliente generado o fixture.

`code-investigator` produce mapa de rutinas, permisos y rutas; `code-review` revisa transacciones, idempotencia, privacidad y navegación sobre entregables concretos. El implementador integra y verifica observaciones; no aceptar recomendaciones sin contrastarlas con el código. No crear commits ni alterar ramas automáticamente durante la planificación.

**Comandos de aceptación en ejecución:**

```bash
# Desde backend; entorno PostgreSQL 18 desechable y variables configuradas fuera de Git.
mvn verify
bash src/test/postgres18/run_ci_gates.sh
# Desde frontend.
npm test
npm run build
npm run test:e2e -- tests/e2e/billing.spec.ts tests/e2e/back-navigation.spec.ts
```

Añadir gates a `backend/src/test/postgres18/`: `ecuador_cedula_gate.sql`, `automatic_billing_gate.sql`, `automatic_billing_concurrency.py`, `automatic_billing_http_gate.py`, `automatic_billing_upgrade_gate.py`; incluirlos en el runner/CI. Tests frontend nuevos: validador/input, formulario fiscal, estados de documento, BackButton/provider y los E2E indicados. Tests de rollback deben fallar por el motivo previsto antes de introducir la solución. PostgreSQL real es obligatorio para invariantes, permisos, locks y upgrade; mocks no sustituyen esos gates.

Registrar salida completa en archivos y mostrar solo resumen, estado y fallos. En este trabajo de planificación no se ejecutan builds/gates ni se afirma que la aplicación pasa esas pruebas.

## 9. Decisiones que debe confirmar la revisión del plan

- Aceptar borrador automático para pedido pendiente y emisión al aprobar pago; exigir factura emitida también sin pago cambiaría expresamente esta política y requiere revisar consecuencias.
- Confirmar primera versión nominativa con cédula, sin exigirla para crear cuenta. Ampliar nuevos tipos de documento es otra entrega; conservar los históricos desde el inicio.
- Resolver evidencia primaria de prefijos/NUI antes de activar restricciones territoriales definitivas; la validación algorítmica no prueba existencia ni titularidad.
- Fijar emisor sintético, plantilla/XSD objetivo y política académica de retención/borrado. No justificar retención fiscal obligatoria para documentos que solo son simulados.
- Aceptar semántica de retorno seguro con fallback cuando no hay historial, agrupación de filtros y protección frente a repetición de compra.

Estas decisiones delimitan la ejecución posterior; no impiden revisar o ajustar el plan completo ahora.

**Ejecución concluida:** resultados, revisiones y límites en [el informe de validación](../../audit/2026-10-17-billing-navigation-validation.md). Las bases persistentes del usuario y las migraciones V001–V070 permanecieron intactas.
