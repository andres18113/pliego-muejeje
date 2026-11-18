# Data reset — V095 / 53e062a

## Alcance y estado

Ensayo local del 2026-11-01, PostgreSQL 18.6 y JAR real de Java 25. No se accedió
al VPS, R2, Mailtrap ni otro proveedor; no hay cambios Java, migraciones nuevas,
commits o pushes. Los archivos añadidos se limitan a `scripts/ops/` y esta sección
de `docs/testing/`. Se leyeron AGENTS.md, runbook §§3/5/7/10 y notas R2,
privilegios de billing y ADR 0038, 0046–0049.

**Bloqueo para producción:** no se puede garantizar la no reutilización absoluta
de referencias públicas después de borrar pedidos con V095. V088 genera ocho
dígitos aleatorios y consulta únicamente `pedido` para evitar colisiones;
no existe una reserva histórica independiente. Además, las entradas ADMIN
`sp_invoice_issue` y `sp_credit_note_issue` aceptan números manuales y su unicidad
solo consulta las filas vivas. Preservar los contadores protege la numeración
automática, pero no todos los números manuales históricos. El ensayo comprueba
que su nueva referencia no coincide con las anteriores; **eso no demuestra una
garantía futura**. V089 también compara los códigos aleatorios de retiro solo
contra filas vivas; conservar la secuencia antigua no reserva esos códigos.
No se han alterado rutinas, creado reservas permanentes,
conservado clientes ficticios ni debilitado ese requisito.

El usuario debe decidir si autoriza un cambio separado que reserve referencias y
números manuales (y códigos de retiro, si la garantía incluye esas credenciales),
con sus comprobaciones en la Database API. Si exige la garantía
actual, no ejecutar el COMMIT de producción hasta resolverlo. Los comandos de
producción de abajo son una receta preparada, no autorización para ignorar el
bloqueo. Una aceptación explícita de la limitación cambiaría el requisito original.

## Plan y contrato de la implementación

1. Inventariar tablas, FKs, triggers y reglas en V095; clasificar cada tabla y
   reconocer los enlaces sin FK de correo, recibos e inventario.
2. Implementar un único script psql: locks, objetivos congelados, fingerprints,
   21 excepciones de trigger, DELETEs explícitos y aserciones, rollback por defecto.
3. Restaurar un custom dump en un cluster nuevo con roles de producción, verificar
   rollback/fallo/commit/repetición/ACL, y ejecutar el flujo HTTP real sin correo/R2.
4. Revisar el resultado y registrar requisito → evidencia sin publicar datos.

El reset ejecuta `BEGIN; SET LOCAL ROLE pliego_owner`. `pliego_owner` debe ser
NOLOGIN, sin privilegios elevados y dueño de las tablas/secuencias de aplicación
y Flyway. El operador se conecta administrativamente como `postgres` y asume ese
rol solo en esta conexión de mantenimiento. No se concede membresía al runtime ni
se ejecuta `SET ROLE` en un pool. El dueño puede deshabilitar los triggers de
inmutabilidad; `pliego_app` no puede hacerlo. Se conservan roles, ACL, ownership,
credenciales ADMIN y default privileges; se comparan antes/después.

Se toma un advisory lock transaccional y `ACCESS EXCLUSIVE` sobre las 58 tablas y
Flyway, en orden estable, antes de congelar objetivos y huellas. Es mantenimiento
con el servicio, workers e ingreso webhook detenidos. Los locks tienen timeout de
10 s; cada sentencia 10 min; sesión ociosa en transacción 15 min. Un error debe
terminar la conexión psql; `ON_ERROR_STOP=1` evita continuar o confirmar.

Cada tabla tiene conteos before/after/targeted en una tabla temporal. Para cada
fila conservada se representa **cada columna**, incluidas PK, precios, stock,
fechas, URLs, metadatos digitales, bytes y credenciales, en JSON canónico, ordenado
por todo su contenido con collation C y encuadre de longitud. Se compara count +
md5 sin imprimir las huellas. No se cambia una fecha ni se repone/recalcula stock.
Los 58 conjuntos de supervivientes y Flyway se verifican en la transacción;
el harness vuelve a verificar las huellas independientemente después del COMMIT.

El contrato de esquema acepta solo dos firmas verificadas de V095: instalación
por Flyway y esa instalación después de `pg_dump`/`pg_restore` de PG18. El roundtrip
redistribuye casts de arrays varchar a sus elementos en algunos CHECKs. Las firmas
incluyen columnas/defaults, todas las restricciones, definiciones y funciones de
triggers, y reglas; no dependen de OIDs/owners ni del estado NOT VALID. Una tabla
nueva, trigger modificado o esquema diferente hace fallar el procedimiento.
También se rechaza cualquier RLS flag/policy en pliego o Flyway antes de leer
objetivos: el dueño no tiene BYPASSRLS y un filtro no debe ocultar clientes.

## Clasificación de todas las tablas

Son **17 preserve, 28 clear y 13 conditional**. Los conteos son exclusivamente del
fixture sintético restaurado, no observaciones de producción. «Después» es el
primer reset confirmado; la posterior prueba HTTP se limpia de nuevo sin bajar
sus secuencias/contadores. `factura_archivo` incluye dos filas R2 ficticias y dos
DATABASE; no se crearon ni consultaron objetos externos.

| Tabla pliego | Clase | Antes | Después | Razón |
|---|---|---:|---:|---|
| `academic_document_counter` | preserve | 2 | 2 | Conservar 01/04 y sus high-water marks byte por byte. |
| `address_create_attempt` | conditional | 1 | 0 | Borrar recibos del actor CUSTOMER; conservar recibos ajenos. |
| `autor` | preserve | 1 | 1 | Catálogo bibliográfico/geográfico y sus relaciones: conservar todas las columnas. |
| `ayuda_articulo` | preserve | 9 | 9 | Contenido operativo de ayuda. |
| `ayuda_categoria` | preserve | 9 | 9 | Navegación operativa de ayuda. |
| `carrito` | clear | 5 | 0 | Todos los carritos históricos/activos de clientes. |
| `carrito_item` | clear | 5 | 0 | Líneas de carritos. |
| `categoria` | preserve | 1 | 1 | Catálogo bibliográfico/geográfico y sus relaciones: conservar todas las columnas. |
| `checkout_attempt` | conditional | 4 | 0 | Borrar actor CUSTOMER o recibo con pedido; conservar ADMIN NOT_CREATED ajeno. |
| `checkout_billing_attempt` | conditional | 2 | 0 | Borrar los recibos dependientes de checkout eliminado. |
| `ciudad` | preserve | 1171 | 1171 | Catálogo bibliográfico/geográfico y sus relaciones: conservar todas las columnas. |
| `ciudad_alias` | preserve | 278 | 278 | Catálogo bibliográfico/geográfico y sus relaciones: conservar todas las columnas. |
| `cliente` | clear | 4 | 0 | Perfil de CUSTOMER; abortar si un cliente pertenece a otro rol. |
| `cliente_favorito` | clear | 1 | 0 | Favoritos de clientes. |
| `cliente_guardado_despues` | clear | 1 | 0 | Guardados para después. |
| `cliente_identificacion` | clear | 1 | 0 | Identidad de facturación del cliente. |
| `cliente_identificacion_evento` | clear | 1 | 0 | Auditoría de cambios de identidad. |
| `cliente_identificacion_solicitud_correccion` | clear | 1 | 0 | Solicitud/revisión, incluido ADMIN que decidió; borrar la solicitud, conservar ADMIN. |
| `correo_cambio` | conditional | 1 | 0 | Borrar solicitudes históricas/pendientes del cliente; conservar ADMIN. |
| `correo_cambio_token` | conditional | 2 | 0 | Borrar credenciales de solicitudes eliminadas; conservar ADMIN. |
| `correo_destinatario_entrega` | conditional | 4 | 2 | Borrar direcciones actuales/anteriores/pendientes conocidas del cliente; conservar compartidas con ADMIN o desconocidas. |
| `correo_evento_proveedor` | conditional | 6 | 1 | Borrar por correo_id o message_id de outbox eliminada, incluso sin proyectar; conservar desconocidos/ADMIN. |
| `correo_limite` | conditional | 5 | 2 | Borrar buckets USER/EMAIL_CHANGE/EMAIL_CHANGE_RESEND y EMAIL atribuibles al cliente; conservar IP/ADMIN/desconocidos. |
| `correo_outbox` | conditional | 16 | 1 | Borrar por usuario CUSTOMER, incluso destinatarios anteriores; conservar correo ADMIN. |
| `correo_token` | conditional | 4 | 1 | Borrar VERIFY_EMAIL/RESET_PASSWORD de CUSTOMER; conservar ADMIN. |
| `digital_grant` | clear | 2 | 0 | Fuentes de compra, activas y revocadas. |
| `digital_ownership` | clear | 2 | 0 | Entradas de biblioteca y propiedad digital. |
| `direccion` | clear | 2 | 0 | Direcciones de clientes. |
| `edicion` | preserve | 425 | 425 | Precio, URLs de portada, formatos y metadatos digitales exactos. |
| `edicion_oferta` | preserve | 2 | 2 | Promociones, condiciones y fechas originales exactas. |
| `editorial` | preserve | 1 | 1 | Catálogo bibliográfico/geográfico y sus relaciones: conservar todas las columnas. |
| `envio` | clear | 1 | 0 | Envíos y tracking. |
| `envio_historial` | clear | 1 | 0 | Auditoría append-only del envío. |
| `factura` | clear | 3 | 0 | Documentos académicos y snapshots; contadores se conservan aparte. |
| `factura_archivo` | clear | 4 | 0 | Metadatos de PDF/XML, incluido R2; ningún DELETE externo. |
| `factura_archivo_contenido` | clear | 2 | 0 | Bytes y checksum históricos en PostgreSQL. |
| `factura_archivo_trabajo` | clear | 4 | 0 | Trabajos, leases y reintentos de render. |
| `factura_direccion` | clear | 3 | 0 | Snapshot de facturación. |
| `factura_emision_electronica` | clear | 1 | 0 | Registro comercial de emisión; revisar cualquier autorización fiscal real. |
| `factura_item` | clear | 3 | 0 | Snapshot de ítems de factura. |
| `home_delivery_config` | preserve | 1 | 1 | Configuración operativa de entregas. |
| `inventario` | preserve | 423 | 423 | Stock actual/mínimo y timestamps exactos; no reponer ventas. |
| `libro` | preserve | 425 | 425 | Catálogo bibliográfico/geográfico y sus relaciones: conservar todas las columnas. |
| `libro_autor` | preserve | 425 | 425 | Catálogo bibliográfico/geográfico y sus relaciones: conservar todas las columnas. |
| `libro_categoria` | preserve | 425 | 425 | Catálogo bibliográfico/geográfico y sus relaciones: conservar todas las columnas. |
| `movimiento_inventario` | conditional | 426 | 424 | Borrar movimientos con pedido o actor CUSTOMER; conservar ENTRY/ADJUSTMENT de ADMIN, sin modificar inventario. |
| `nota_credito` | clear | 1 | 0 | Créditos académicos; contador 04 permanece. |
| `pago` | clear | 4 | 0 | Pagos simulados y datos de transferencia. |
| `pedido` | clear | 4 | 0 | Pedidos de clientes; id y referencia salen del DB. |
| `pedido_direccion` | clear | 1 | 0 | Snapshot de entrega. |
| `pedido_entrega` | clear | 2 | 0 | Método de entrega. |
| `pedido_estado_historial` | clear | 10 | 0 | Auditoría de estados, incluso actores ADMIN. |
| `pedido_item` | clear | 4 | 0 | Snapshot de líneas y ofertas de la compra. |
| `pedido_retiro` | clear | 1 | 0 | Credencial/snapshot y auditoría del retiro. |
| `provincia` | preserve | 24 | 24 | Catálogo bibliográfico/geográfico y sus relaciones: conservar todas las columnas. |
| `sesion_autenticacion` | conditional | 3 | 1 | Borrar refresh/sesiones de CUSTOMER, incluso revocadas; conservar ADMIN. |
| `ubicacion_retiro` | preserve | 1 | 1 | Configuración operativa de ubicaciones. |
| `usuario` | conditional | 6 | 2 | Borrar solo CUSTOMER; conservar todas las columnas ADMIN. |

Fuera de pliego: `public.flyway_schema_history`, 95 → 95, huella exacta conservada.

Los enlaces sin FK se resuelven antes de borrar: IDs y recibos de correo, emails
actuales/de snapshots/cambios pendientes y claves de rate limit. No se imprimen.
Las condiciones de supervivencia usan `IS NOT TRUE`,
incluyendo el caso SQL NULL de eventos con FK nullable.
No se puede atribuir un evento de proveedor sin recibo conocido, ni un bucket IP
compartido, a un cliente; se retienen. Un destinatario también conocido de ADMIN
conserva su estado global aunque su antiguo snapshot CUSTOMER desaparezca.

## Auditoría, triggers y retención

Se eliminan expresamente las auditorías de identidad/correcciones, estados de
pedido, envío, retiro, recibos idempotentes de checkout/dirección, propiedad digital,
artefactos, créditos y los movimientos del ledger asociados a pedidos/clientes.
Se conserva la procedencia de movimientos manuales ADMIN. El ledger deja de ser
un historial completo de ventas; no se reconstruye stock a partir de él.

Hay **70 triggers de usuario, 21 con DELETE, cero reglas**. Los 21 guards con DELETE
rechazan borrados o implementan protección de identidad/snapshots, incluidos dos
triggers distintos sobre pedido_item. Cada uno tiene un `DISABLE TRIGGER <nombre>`
explícito, su DELETE revisado y un `ENABLE TRIGGER <nombre>` explícito **dentro de
la misma transacción**. Las FKs internas y el guard diferido de almacenamiento
READY permanecen habilitados. Se ejecuta `SET CONSTRAINTS ALL IMMEDIATE` antes de
las aserciones finales y COMMIT.

`ALTER TABLE ... DISABLE TRIGGER` no es una propiedad intrínsecamente local de
sesión: cambiaría el catálogo para otras sesiones si se confirmase así. Aquí los
locks excluyen escritores, el re-enable precede al COMMIT y cualquier error o
pérdida de conexión revierte también el DDL. El ensayo inyecta un fallo después
de un DELETE, con los guards deshabilitados, y prueba su recuperación completa.
No se usa DISABLE TRIGGER ALL, session_replication_role, DROP, TRUNCATE, un DELETE
CASCADE ni una operación GRANT/REVOKE en el reset.

ADR 0038 y la nota de privilegios declaran facturas académicas, sin autorización
SRI y sin obligación fiscal indefinida implícita. Este borrado excepcional se basa
en ese alcance y en la autorización dada. `factura_emision_electronica` tiene
campos/estados que parecen fiscales; cualquier evidencia de documentos legales
reales invalidaría esa premisa y exigiría revisión antes de ejecutar. La numeración,
los enlaces ya enviados y los objetos R2 siguen teniendo alcance externo aunque
los documentos sean académicos. Las filas de outbox se borran, pero correos ya
aceptados por el proveedor no se retiran. ADR 0048 exige conservar deduplicación
mientras pueda reintentarse: se preservan eventos desconocidos/ADMIN. Un webhook
tardío para correo borrado puede crear un evento desconocido nuevo; no encontrará
la antigua outbox y no restituirá clientes/documentos. Detener ingreso webhook
durante la operación y conservar la política de retención de esos eventos.

## Reglas de secuencias, contadores y R2

No hay `setval`, `RESTART`, reasignación ni reset de numeración. Se comprueban las
33 secuencias (last_value + is_called), incremento 1 y NO CYCLE; el siguiente ID
debe superar los IDs existentes antes del borrado. Un high-water mark atrasado
hace abortar; no se corrige silenciosamente. Las secuencias son no transaccionales:
el reset no las consume, ni siquiera en dry run. Los contadores 01/04 se guardan
como configuración preservada, también en el segundo reset.

| Secuencia/contador | Regla y motivo |
|---|---|
| `autor_autor_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `ayuda_articulo_articulo_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `ayuda_categoria_categoria_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `carrito_carrito_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `carrito_item_carrito_item_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `categoria_categoria_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `ciudad_alias_ciudad_alias_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `ciudad_ciudad_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `cliente_cliente_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `cliente_guardado_despues_guardado_despues_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `cliente_identificacion_evento_evento_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `cliente_identificacion_solicitud_correccion_solicitud_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `correo_outbox_correo_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `digital_ownership_owned_item_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `direccion_direccion_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `edicion_edicion_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `edicion_oferta_oferta_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `editorial_editorial_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `envio_envio_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `envio_historial_envio_historial_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `factura_factura_id_seq` | Conservar; invoiceId es el namespace R2, además de un ID expuesto. |
| `factura_item_factura_item_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `libro_libro_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `movimiento_inventario_movimiento_inventario_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `nota_credito_nota_credito_id_seq` | Conservar IDs de créditos; no es el número comercial del documento. |
| `pago_pago_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `pedido_estado_historial_pedido_estado_historial_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `pedido_item_pedido_item_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `pedido_pedido_id_seq` | Conservar; número interno/orderId aparece en REST, enlaces y correos. |
| `provincia_provincia_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `retiro_codigo_seq` | Conservar; numeraba códigos históricos externos. V089 usa nuevos códigos aleatorios. |
| `ubicacion_retiro_ubicacion_retiro_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `usuario_usuario_id_seq` | Conservar last_value/is_called; no reutilizar IDs de filas borradas o conservadas. |
| `academic_document_counter`, `01` | Conservar factura automática `999-999-NNNNNNNNN`; no es una secuencia PG. |
| `academic_document_counter`, `04` | Conservar numeración automática de créditos, independiente del tipo 01. |
| `pedido.referencia_publica` | Aleatoria, sin secuencia; garantía histórica imposible con V095 sin reservas. |
| Números manuales ADMIN | Entrada libre; no los protege el contador. Requieren reserva histórica para garantía absoluta. |

Se comprueba que 01 no esté por debajo de secuenciales ni números académicos
reconocibles en factura (también LEGACY), y 04 no por debajo de créditos académicos.
No se toca ningún contador aunque las tablas transaccionales queden vacías.
La prueba HTTP compara nuevos pedido_id/factura_id y secuencial con los anteriores.

La clave real de R2 es **`invoices/<invoiceId>/<sha256>.pdf|xml`**, no el número
comercial de factura. `R2InvoiceObjectKey.forArtifact` y
`R2InvoiceDocumentStore.prepare` lo confirman. Al preservar la secuencia de factura,
un invoiceId futuro usa otro namespace y no puede pisar un objeto huérfano anterior,
aunque sus bytes/checksum sean idénticos. No se prueban llamadas R2 reales.

`R2ObjectClient` sí contiene una primitiva `deleteObject`; sus únicos call sites
son pruebas (`R2ObjectClientTest`, cleanup de `R2LiveSmokeTest`). Ningún worker,
servicio de facturación, DELETE trigger o script de reset la llama. El reset es
SQL local y no inicia el backend. El harness deshabilita R2 y arranca el backend
solo después de eliminar las referencias R2 de la copia. Los objetos reales R2
quedan intactos y privados, sin filas que permitan descargarlos mediante la API;
no se lista, elimina ni aplica lifecycle a `invoices/` ni a portadas.
En producción no se cambia la configuración R2 habilitada del servicio.

## Trazabilidad: requisito → evidencia

| Requisito | Evidencia ejecutada |
|---|---|
| V095, catálogo realista y cobertura de todas las tablas | Fixture V087 del gate existente → JAR/Flyway V095 + fixture adicional: 425 obras/ediciones; todas las 58 tablas con filas. Bytes DATABASE + metadatos R2 ficticios, créditos, corrección, mail y eventos sin proyectar. |
| Inventario sin PII | `inventory-before.log` y `inventory-after.log`: counts de todas las tablas, ADMIN/CUSTOMER, storage kind, triggers, FKs, reglas y constraints no validados. |
| Esquema desconocido/guard inactivo abortan | `unclassified-table.log`, `disabled-trigger.log`; cambios inyectados y revertidos sin DROP. |
| RLS forzado no puede ocultar clientes | `forced-rls.log`; fallo antes de derivar objetivos; flags y policy inyectados se revierten. |
| Eventos desconocidos quedan dentro de la huella | `unknown-event-corruption.log`: un UPDATE inyectado sobre un evento con correo_id NULL debe abortar y revertir todo. |
| Runtime no puede asumir owner | `runtime-reset-refused.log`; estado completo/ACL sin cambios. |
| Contador atrasado aborta | `stale-invoice-counter.log`; no corrección oculta de numeración. |
| Dry run único con rollback por defecto | `reset-rollback.log`; snapshot exacto de 58 tablas, Flyway, 33 secuencias y metadata igual antes/después. |
| Error a mitad de DELETE revierte datos y DDL | `reset-mid-delete-failure.log`; ON_ERROR_STOP termina conexión; snapshot/trigger flags exactos recuperados. |
| Commit elimina solo objetivos y preserva todo lo demás | `reset-commit.log`; 59 fingerprints, huellas independientes post-commit, secuencias/roles/ownership/ACL intactos. |
| Repetibilidad inmediata | `reset-second-commit.log`: todos los DELETE 0; snapshot exacto, incluso secuencias y contadores. |
| Integridad real, también FKs ya marcadas válidas | 69 anti-joins FK, 247 escaneos CHECK y 376 columnas NOT NULL; `constraints.log` ejecuta ALTER TABLE VALIDATE sobre cada FK/CHECK/NOT NULL de PG18. Índices válidos y constraints no validados = 0. |
| ADMIN y configuración | Huellas de filas completas; sesiones y tokens ADMIN conservados; geografías sin DML app. |
| Backend real como pliego_app | Registro → HMAC local del gate de verificación → login → carrito → checkout TRANSFER APPROVED → PDF/XML DATABASE READY → download `%PDF-` → biblioteca OWNED. |
| Aislamiento del entorno de los helpers | Entorno de proceso reemplazado, PGHOSTADDR/PGSERVICE/PGOPTIONS y proxies excluidos; opener HTTP sin proxies. Prueba de herencia con variables hostiles y ensayo con entorno contaminado. |
| Receta de producción fail-fast | Prueba con stubs de lock/backup/dry run/drain: cada fallo impide llegar a COMMIT; caso nominal sí llega. Ningún comando real de servidor ejecutado. |
| No correo/R2, histórico Flyway intacto | Mail/R2 false explícitos, secreto webhook vacío, sin env heredado del operador; estado SENT no crece, metadata de storage DATABASE, Flyway exacto tras arranque normal. |
| Limpieza de la identidad HTTP y otra repetición | `reset-after-http.log`, `reset-final-noop.log`; nuevamente cero clientes/transacciones, contadores nuevos conservados. |
| Garantía histórica de referencias/números manuales | **Bloqueada en V095** por el diseño actual; evidencia estática de V088 y rutinas ADMIN, no se presenta como prueba aprobada. |

No se ejecutó Maven test: no se cambió Java. Las verificaciones son PostgreSQL 18,
restauración, JAR real y HTTP; no hay sustitutos de la base de datos.

## Ejecución exacta para Claude

Desde la raíz local del repositorio, como usuario OS sin privilegios root, con
PostgreSQL 18, Java 25, Python 3 y el JAR V095 ya construido. El harness congela
el JAR y guarda su SHA-256 junto con el del dump y scripts. No consume PGHOST,
PGSERVICE, variables PLIEGO, secretos R2, opciones JVM o URI del operador.
Crea su propio cluster y puertos de loopback; recrea `pliego_owner NOLOGIN` y
`pliego_app LOGIN` sin privilegios elevados; restaura ownership y ACL del dump.
Una copia que no cumpla esos roles/ACL hace fallar el ensayo, no se normaliza
ocultamente. El fixture ficticio aplica el cleanup exacto del runbook al prepararse.

```bash
python3 -B scripts/ops/test-reset-safety.py

# Fixture de prueba reproducible, sin datos ni servicios de producción:
scripts/ops/rehearse-reset.sh --make-fixture /tmp/pliego-reset-v095-fixture.dump
scripts/ops/rehearse-reset.sh /tmp/pliego-reset-v095-fixture.dump
scripts/ops/rehearse-reset.sh /tmp/pliego-reset-v095-fixture.dump

# Ensayo obligatorio sobre un custom dump autorizado, ya restaurable con V095:
# Si el backup es V087, primero ensayar el upgrade normal con el JAR95 y el ciclo
# ACL del runbook en otra copia local; obtener de allí un nuevo custom dump V095.
scripts/ops/rehearse-reset.sh /ruta/local/privada/produccion-v095.dump \
  --jar /ruta/local/al/JAR-verificado-de-53e062a.jar
```

Cada ejecución hace inventario → rollback → commit → segundo commit → HTTP →
limpieza → otro no-op. Usa /tmp con modo 0700/0600; los logs pueden contener errores
de una copia con datos reales, por lo que son privados y no deben adjuntarse.
Detiene backend y cluster al salir y elimina los datafiles por defecto; conserva
logs/huellas y evidencia. `--keep-cluster` conserva una copia parada sensible.
Eliminar esa evidencia según la política local cuando ya no sea necesaria.

**Receta preparada para el servidor, solo después de resolver el bloqueo** y de
ensayar el dump real de V095. Tras entrar por el acceso autorizado del runbook,
como operador privilegiado en una sola sesión; scripts revisados y privados en
`/opt/pliego/deployment/data-reset/`, working directory igual. No se ejecutó nada
de este bloque en esta tarea. Mantener el servicio parado si cualquier paso falla.

```bash
(
set -euo pipefail
umask 077
exec 9>/run/lock/pliego-deploy.lock
flock -n 9
cd /opt/pliego/deployment/data-reset

# Inventario de solo lectura antes de mantenimiento, sin identidades:
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d pliego \
  < reset-customer-data-inventory.sql > inventory-preflight.log 2>&1

# Detener/drain y bloquear temporalmente entrada del webhook por el mecanismo
# operativo ya aprobado. Sin ese aislamiento no comenzar el reset.
systemctl stop pliego.service || true
systemctl show pliego.service --property=ActiveState,Result,MainPID
test "$(systemctl show pliego.service --property=MainPID --value)" = 0
case "$(systemctl show pliego.service --property=ActiveState --value)" in
  inactive|failed) ;;  # exit 143 conocido es válido si MainPID=0
  *) exit 1 ;;
esac

# Backup fresco privado: el shell privilegiado abre el archivo, postgres escribe.
runuser -u postgres -- pg_dump --format=custom -d pliego > before-reset.dump 2> backup.log
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d pliego \
  < reset-customer-data-inventory.sql > inventory-before.log 2>&1

# Ensayo SQL sobre el servidor: siempre termina en ROLLBACK.
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d pliego \
  < reset-customer-data.sql > reset-rollback.log 2>&1

# DESTRUIRÁ los datos CUSTOMER; no ejecutar mientras siga el bloqueo de V095.
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -v confirm=RESET -d pliego \
  < reset-customer-data.sql > reset-commit.log 2>&1
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d pliego \
  < reset-customer-data-inventory.sql > inventory-after.log 2>&1

# Revisar conteos/aserciones y postflight de privilegios de runbook §7.
# NO ejecutar reset-customer-data-validate.sql ni los probes con escrituras en producción.
systemctl reset-failed pliego.service
systemctl start pliego.service
# Restablecer ingreso webhook; comprobaciones read-only y journal de runbook §9.
# No inventar compras/cuentas o envíos de correo para el smoke de producción.
)
```

El bloque corre en un subshell con `set -euo pipefail`: un lock, backup,
inventario o dry run fallido detiene el flujo antes del COMMIT. El drain se exige
por MainPID y ActiveState. Los SQL root-only se abren mediante stdin del shell
privilegiado, sin dar a postgres acceso al directorio 0700. El lock dura hasta
salir del subshell; un fallo posterior a stop deja el servicio parado para revisión.
Las comprobaciones del SQL se ejecutan antes de confirmar, sin depender del log.
Un COMMIT no tiene rollback posterior: restaurar el dump requeriría una decisión
de recuperación separada (§10), nunca una restauración automática ni reset de
Flyway. No hay cambios de grants ni membresía temporal de runtime en esta operación.

## Evidencia observada

La revisión independiente encontró y se corrigieron cuatro problemas importantes:
receta que continuaba tras un fallo, RLS no rechazado, semántica NULL al tomar
huellas de eventos desconocidos y entorno de helpers parcialmente heredado.
Cada caso se reprodujo antes de corregirlo (RED) y se volvió a ejecutar (GREEN).
Las pruebas persistentes son `test-reset-safety.py` (entorno y receta) y los
casos `forced-rls.log`/`unknown-event-corruption.log` del harness. La revisión
no autorizó cambios de producción ni de contrato de numeración.

| Ejecución final | Resultado observado | Evidencia privada |
|---|---|---|
| Fixture V087→V095 + datos adicionales | 58 tablas pobladas, 425 obras/ediciones, 4 CUSTOMER, 4 pedidos, 3 facturas, 2 artefactos R2 + 2 DATABASE | `/tmp/pliego-reset-rehearsal-_8ndsd1m/fixture-upgrade.log`, `fixture-extra.log` |
| Ensayo completo 1 | Rollback + fallo intermedio + commit: 120 filas eliminadas; segunda ejecución 0. 59 huellas/33 secuencias intactas; 69 FKs/247 CHECKs/376 NOT NULL; HTTP completo correcto | `/tmp/pliego-reset-rehearsal-thgx8nb1` |
| Ensayo completo 2, PGHOSTADDR/PGSERVICE/PGOPTIONS/proxies contaminados | Mismos conteos y todos los gates correctos; segundo reset y no-op final eliminan 0 | `/tmp/pliego-reset-rehearsal-gsdizj9k` |
| Seguridad de receta y entorno | 2/2 tests, 5 escenarios de receta; solo stubs locales | `/tmp/pliego-data-reset-work/safety-tests-final.log` |
| Revisión independiente | 4 hallazgos importantes reproducidos y corregidos; ninguno diferido. Limitación de numeración documentada como bloqueo del contrato | Casos de regresión anteriores y `test-reset-safety.py` |

JAR SHA-256 `e221f139dd3fc4fb31162d6d664c1669e05c148ebb4595e341fe9d36fbd63c21`; dump sintético SHA-256 `69afd670389dce00fc07d355dc6a17dfe99e0c31c23675abc94ad2fac27e4ab4`.
Los 95 archivos de migración dentro del JAR coinciden byte por byte con source.
Runtime observado: OpenJDK 25.0.4.1 y PostgreSQL 18.6. Ambos `result.json` registran
SHA-256 de cada script y los mismos conteos before/final; se cotejaron con los
archivos finales del repositorio. Los datafiles de esos ensayos se eliminaron
tras detener cada cluster; los logs son privados. La copia real de producción
todavía debe ensayarla Claude: aquí solo se usaron datos sintéticos.

Los primeros intentos se conservaron como diagnóstico local: fixture que intentaba
insertar inventario ya creado por la rutina y OUT params literales dentro de DO;
cast de CASE en una aserción PL/pgSQL; diferencias textuales CHECK tras restore;
y comparación str/int en el probe SENT. Se corrigió soporte de ensayo, sin
cambiar Java, migraciones ni expectativas del producto. Los casos RED de la
revisión demostraron el defecto antes de cada corrección; los dos ensayos finales
incluyen las cuatro correcciones y no reutilizan una base parcialmente limpiada.

## Grafo FK completo derivado de pg_catalog

Cada fila es una FK, incluidas las referencias ADMIN y catálogos. No se depende
de sus acciones de borrado; `correo_token` y sesiones se eliminan explícitamente
antes de usuario, aunque sus FKs históricas declaren CASCADE.

| Tabla hija | FK | Definición V095 |
|---|---|---|
| `address_create_attempt` | `address_create_attempt_actor_user_id_fkey` | `FOREIGN KEY (actor_user_id) REFERENCES pliego.usuario(usuario_id)` |
| `ayuda_articulo` | `ayuda_articulo_categoria_id_fkey` | `FOREIGN KEY (categoria_id) REFERENCES pliego.ayuda_categoria(categoria_id)` |
| `carrito_item` | `fk_carrito_item_carrito` | `FOREIGN KEY (carrito_id) REFERENCES pliego.carrito(carrito_id) ON DELETE RESTRICT` |
| `carrito_item` | `fk_carrito_item_edicion` | `FOREIGN KEY (edicion_id) REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT` |
| `carrito` | `fk_carrito_cliente` | `FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT` |
| `categoria` | `fk_categoria_padre` | `FOREIGN KEY (categoria_padre_id) REFERENCES pliego.categoria(categoria_id) ON DELETE RESTRICT` |
| `checkout_attempt` | `checkout_attempt_actor_user_id_fkey` | `FOREIGN KEY (actor_user_id) REFERENCES pliego.usuario(usuario_id)` |
| `checkout_attempt` | `checkout_attempt_order_id_fkey` | `FOREIGN KEY (order_id) REFERENCES pliego.pedido(pedido_id)` |
| `checkout_billing_attempt` | `checkout_billing_attempt_actor_user_id_attempt_key_fkey` | `FOREIGN KEY (actor_user_id, attempt_key) REFERENCES pliego.checkout_attempt(actor_user_id, attempt_key)` |
| `ciudad_alias` | `fk_ciudad_alias_target` | `FOREIGN KEY (provincia_id, ciudad_id) REFERENCES pliego.ciudad(provincia_id, ciudad_id) ON DELETE RESTRICT` |
| `ciudad` | `ciudad_provincia_id_fkey` | `FOREIGN KEY (provincia_id) REFERENCES pliego.provincia(provincia_id) ON DELETE RESTRICT` |
| `cliente_favorito` | `fk_cliente_favorito_cliente` | `FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT` |
| `cliente_favorito` | `fk_cliente_favorito_edicion` | `FOREIGN KEY (edicion_id) REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT` |
| `cliente_guardado_despues` | `fk_cliente_guardado_despues_cliente` | `FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT` |
| `cliente_guardado_despues` | `fk_cliente_guardado_despues_edicion` | `FOREIGN KEY (edicion_id) REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT` |
| `cliente_identificacion_evento` | `cliente_identificacion_evento_cliente_id_fkey` | `FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id)` |
| `cliente_identificacion_solicitud_correccion` | `cliente_identificacion_solicitud_correccion_cliente_id_fkey` | `FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id)` |
| `cliente_identificacion_solicitud_correccion` | `cliente_identificacion_solicitud_correccion_decidido_por_fkey` | `FOREIGN KEY (decidido_por) REFERENCES pliego.usuario(usuario_id)` |
| `cliente_identificacion` | `cliente_identificacion_cliente_id_fkey` | `FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id)` |
| `cliente` | `fk_cliente_usuario` | `FOREIGN KEY (usuario_id) REFERENCES pliego.usuario(usuario_id) ON DELETE RESTRICT` |
| `correo_cambio_token` | `correo_cambio_token_cambio_id_fkey` | `FOREIGN KEY (cambio_id) REFERENCES pliego.correo_cambio(cambio_id)` |
| `correo_cambio` | `correo_cambio_usuario_id_fkey` | `FOREIGN KEY (usuario_id) REFERENCES pliego.usuario(usuario_id)` |
| `correo_evento_proveedor` | `correo_evento_proveedor_correo_id_fkey` | `FOREIGN KEY (correo_id) REFERENCES pliego.correo_outbox(correo_id)` |
| `correo_outbox` | `correo_outbox_usuario_id_fkey` | `FOREIGN KEY (usuario_id) REFERENCES pliego.usuario(usuario_id)` |
| `correo_token` | `correo_token_usuario_id_fkey` | `FOREIGN KEY (usuario_id) REFERENCES pliego.usuario(usuario_id) ON DELETE CASCADE` |
| `digital_grant` | `digital_grant_owned_item_id_fkey` | `FOREIGN KEY (owned_item_id) REFERENCES pliego.digital_ownership(owned_item_id) ON DELETE RESTRICT` |
| `digital_grant` | `digital_grant_pedido_item_id_fkey` | `FOREIGN KEY (pedido_item_id) REFERENCES pliego.pedido_item(pedido_item_id) ON DELETE RESTRICT` |
| `digital_ownership` | `digital_ownership_cliente_id_fkey` | `FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT` |
| `digital_ownership` | `digital_ownership_edicion_id_fkey` | `FOREIGN KEY (edicion_id) REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT` |
| `direccion` | `fk_direccion_cliente` | `FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT` |
| `direccion` | `fk_direccion_provincia_ciudad` | `FOREIGN KEY (provincia_id, ciudad_id) REFERENCES pliego.ciudad(provincia_id, ciudad_id) ON DELETE RESTRICT` |
| `edicion_oferta` | `edicion_oferta_edicion_id_fkey` | `FOREIGN KEY (edicion_id) REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT` |
| `edicion` | `fk_edicion_editorial` | `FOREIGN KEY (editorial_id) REFERENCES pliego.editorial(editorial_id) ON DELETE RESTRICT` |
| `edicion` | `fk_edicion_libro` | `FOREIGN KEY (libro_id) REFERENCES pliego.libro(libro_id) ON DELETE RESTRICT` |
| `envio_historial` | `envio_historial_envio_id_fkey` | `FOREIGN KEY (envio_id) REFERENCES pliego.envio(envio_id)` |
| `envio_historial` | `envio_historial_usuario_actor_id_fkey` | `FOREIGN KEY (usuario_actor_id) REFERENCES pliego.usuario(usuario_id)` |
| `envio` | `envio_pedido_id_fkey` | `FOREIGN KEY (pedido_id) REFERENCES pliego.pedido_entrega(pedido_id)` |
| `factura_archivo_contenido` | `factura_archivo_contenido_factura_id_tipo_fkey` | `FOREIGN KEY (factura_id, tipo) REFERENCES pliego.factura_archivo_trabajo(factura_id, tipo)` |
| `factura_archivo_trabajo` | `factura_archivo_trabajo_factura_id_fkey` | `FOREIGN KEY (factura_id) REFERENCES pliego.factura(factura_id)` |
| `factura_archivo` | `factura_archivo_factura_id_fkey` | `FOREIGN KEY (factura_id) REFERENCES pliego.factura(factura_id)` |
| `factura_direccion` | `factura_direccion_factura_id_fkey` | `FOREIGN KEY (factura_id) REFERENCES pliego.factura(factura_id)` |
| `factura_emision_electronica` | `factura_emision_electronica_factura_id_fkey` | `FOREIGN KEY (factura_id) REFERENCES pliego.factura(factura_id)` |
| `factura_item` | `factura_item_factura_id_fkey` | `FOREIGN KEY (factura_id) REFERENCES pliego.factura(factura_id)` |
| `factura_item` | `factura_item_pedido_item_id_fkey` | `FOREIGN KEY (pedido_item_id) REFERENCES pliego.pedido_item(pedido_item_id)` |
| `factura` | `factura_pedido_id_fkey` | `FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id)` |
| `factura` | `factura_usuario_emisor_id_fkey` | `FOREIGN KEY (usuario_emisor_id) REFERENCES pliego.usuario(usuario_id)` |
| `inventario` | `fk_inventario_edicion` | `FOREIGN KEY (edicion_id) REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT` |
| `libro_autor` | `fk_libro_autor_autor` | `FOREIGN KEY (autor_id) REFERENCES pliego.autor(autor_id) ON DELETE RESTRICT` |
| `libro_autor` | `fk_libro_autor_libro` | `FOREIGN KEY (libro_id) REFERENCES pliego.libro(libro_id) ON DELETE RESTRICT` |
| `libro_categoria` | `fk_libro_categoria_categoria` | `FOREIGN KEY (categoria_id) REFERENCES pliego.categoria(categoria_id) ON DELETE RESTRICT` |
| `libro_categoria` | `fk_libro_categoria_libro` | `FOREIGN KEY (libro_id) REFERENCES pliego.libro(libro_id) ON DELETE RESTRICT` |
| `movimiento_inventario` | `fk_movimiento_inventario_edicion` | `FOREIGN KEY (edicion_id) REFERENCES pliego.inventario(edicion_id) ON DELETE RESTRICT` |
| `movimiento_inventario` | `fk_movimiento_inventario_pedido` | `FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id) ON DELETE RESTRICT` |
| `movimiento_inventario` | `fk_movimiento_inventario_usuario` | `FOREIGN KEY (usuario_actor_id) REFERENCES pliego.usuario(usuario_id) ON DELETE RESTRICT` |
| `nota_credito` | `nota_credito_factura_id_fkey` | `FOREIGN KEY (factura_id) REFERENCES pliego.factura(factura_id)` |
| `nota_credito` | `nota_credito_usuario_emisor_id_fkey` | `FOREIGN KEY (usuario_emisor_id) REFERENCES pliego.usuario(usuario_id)` |
| `pago` | `fk_pago_pedido` | `FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id) ON DELETE RESTRICT` |
| `pedido_direccion` | `fk_pedido_direccion_pedido` | `FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id) ON DELETE RESTRICT` |
| `pedido_entrega` | `pedido_entrega_pedido_id_fkey` | `FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id)` |
| `pedido_estado_historial` | `fk_pedido_estado_historial_pedido` | `FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id) ON DELETE RESTRICT` |
| `pedido_estado_historial` | `fk_pedido_estado_historial_usuario` | `FOREIGN KEY (usuario_actor_id) REFERENCES pliego.usuario(usuario_id) ON DELETE RESTRICT` |
| `pedido_item` | `fk_pedido_item_edicion` | `FOREIGN KEY (edicion_id) REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT` |
| `pedido_item` | `fk_pedido_item_pedido` | `FOREIGN KEY (pedido_id) REFERENCES pliego.pedido(pedido_id) ON DELETE RESTRICT` |
| `pedido_retiro` | `pedido_retiro_pedido_id_fkey` | `FOREIGN KEY (pedido_id) REFERENCES pliego.pedido_entrega(pedido_id)` |
| `pedido_retiro` | `pedido_retiro_retirado_por_fkey` | `FOREIGN KEY (retirado_por) REFERENCES pliego.usuario(usuario_id) ON DELETE RESTRICT` |
| `pedido_retiro` | `pedido_retiro_ubicacion_retiro_id_fkey` | `FOREIGN KEY (ubicacion_retiro_id) REFERENCES pliego.ubicacion_retiro(ubicacion_retiro_id)` |
| `pedido` | `fk_pedido_cliente` | `FOREIGN KEY (cliente_id) REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT` |
| `sesion_autenticacion` | `fk_sesion_autenticacion_usuario` | `FOREIGN KEY (usuario_id) REFERENCES pliego.usuario(usuario_id) ON DELETE CASCADE` |
| `ubicacion_retiro` | `fk_ubicacion_retiro_provincia_ciudad` | `FOREIGN KEY (provincia_id, ciudad_id) REFERENCES pliego.ciudad(provincia_id, ciudad_id) ON DELETE RESTRICT` |

## Triggers completos y reglas

Fuente: `pg_trigger` con `NOT tgisinternal`; las FKs internas se inventarían aparte.
Todos parten en estado O y deben quedar O. «Excepción» identifica los 21 únicos
triggers suspendidos/reanudados por nombre. El guard READY y todo trigger sin
DELETE siguen activos. Reglas de `pg_rules` en pliego: **0**.

| Tabla | Trigger | Función | Eventos | Excepción DELETE |
|---|---|---|---|---|
| `address_create_attempt` | `trg_address_attempt_immutable` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `autor` | `trg_autor_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `carrito` | `trg_carrito_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `carrito_item` | `trg_carrito_item_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `categoria` | `trg_categoria_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `categoria` | `trg_categoria_validate_hierarchy` | `fn_validate_category_hierarchy` | INSERT/UPDATE | No |
| `checkout_attempt` | `trg_checkout_attempt_immutable` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `checkout_billing_attempt` | `trg_checkout_billing_immutable` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `ciudad` | `trg_city_alias_collision_guard` | `fn_geo_guard_city_alias_collisions` | INSERT/UPDATE | No |
| `ciudad_alias` | `trg_ciudad_alias_validate` | `fn_geo_validate_city_alias` | INSERT/UPDATE | No |
| `cliente` | `trg_cliente_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `cliente` | `trg_customer_ec_phone_validation` | `fn_validate_ec_customer_phone` | INSERT/UPDATE | No |
| `cliente` | `trg_customer_names_validation` | `fn_validate_customer_names` | INSERT/UPDATE | No |
| `cliente` | `trg_customer_profile_version` | `fn_customer_profile_version` | UPDATE | No |
| `cliente_guardado_despues` | `trg_cliente_guardado_despues_quantity` | `fn_guard_customer_saved_quantity` | INSERT/UPDATE | No |
| `cliente_identificacion` | `trg_cliente_identificacion_guard` | `fn_guard_customer_identity` | UPDATE/DELETE | Sí; mismo TX |
| `cliente_identificacion_evento` | `trg_cliente_identificacion_evento_immutable` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `cliente_identificacion_solicitud_correccion` | `trg_cliente_identificacion_solicitud_correccion_due_at` | `fn_set_customer_identity_correction_due_at` | INSERT | No |
| `cliente_identificacion_solicitud_correccion` | `trg_cliente_identificacion_solicitud_correccion_immutable` | `fn_guard_customer_identity_correction_request` | UPDATE/DELETE | Sí; mismo TX |
| `correo_outbox` | `trg_order_mail_public_reference` | `fn_order_mail_public_reference` | INSERT | No |
| `digital_grant` | `trg_digital_grant_guard` | `fn_guard_digital_grant` | INSERT/UPDATE/DELETE | Sí; mismo TX |
| `digital_ownership` | `trg_digital_ownership_identity` | `fn_guard_digital_ownership_identity` | UPDATE/DELETE | Sí; mismo TX |
| `direccion` | `trg_address_ec_contact_validation` | `fn_validate_ec_delivery_contact` | INSERT/UPDATE | No |
| `direccion` | `trg_direccion_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `edicion` | `trg_edicion_owned_media` | `fn_guard_owned_digital_format` | UPDATE | No |
| `edicion` | `trg_edicion_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `edicion` | `trg_edicion_validate_fulfillment` | `fn_validate_edition_fulfillment` | UPDATE | No |
| `editorial` | `trg_editorial_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `envio` | `trg_envio_home_delivery_initialize` | `fn_home_delivery_initialize` | INSERT | No |
| `envio` | `trg_envio_lifecycle_email_update` | `fn_order_mail_home_delivery_transition` | UPDATE | No |
| `envio_historial` | `trg_envio_historial_immutable` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `factura` | `trg_factura_identity_new` | `fn_invoice_identity_validate` | INSERT | No |
| `factura` | `trg_factura_immutable` | `fn_guard_invoice_immutable` | UPDATE/DELETE | Sí; mismo TX |
| `factura` | `trg_invoice_artifact_enqueue` | `fn_invoice_artifact_enqueue` | INSERT/UPDATE | No |
| `factura_archivo` | `trg_factura_archivo_immutable` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `factura_archivo_contenido` | `trg_invoice_artifact_bytes_immutable` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `factura_archivo_trabajo` | `trg_invoice_artifact_ready_storage_guard` | `fn_invoice_artifact_ready_storage_guard` | INSERT/UPDATE | No |
| `factura_direccion` | `trg_factura_direccion_immutable` | `fn_guard_invoice_child_immutable` | INSERT/UPDATE/DELETE | Sí; mismo TX |
| `factura_item` | `trg_factura_item_immutable` | `fn_guard_invoice_child_immutable` | INSERT/UPDATE/DELETE | Sí; mismo TX |
| `inventario` | `trg_inventario_physical_only` | `fn_validate_physical_inventory` | INSERT/UPDATE | No |
| `inventario` | `trg_inventario_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `libro` | `trg_libro_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `movimiento_inventario` | `trg_movimiento_inventario_append_only` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `nota_credito` | `trg_nota_credito_immutable` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `pago` | `trg_pago_capture_approval_time` | `fn_capture_payment_approval_time` | INSERT/UPDATE | No |
| `pago` | `trg_pago_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `pago` | `trg_payment_digital_ownership` | `fn_sync_digital_ownership` | INSERT/UPDATE | No |
| `pago` | `trg_payment_digital_purchase` | `fn_guard_digital_payment` | INSERT/UPDATE | No |
| `pedido` | `trg_confirmed_order_cancel_deadline` | `fn_confirmed_order_cancel_deadline` | UPDATE | No |
| `pedido` | `trg_order_digital_ownership` | `fn_sync_digital_ownership` | UPDATE | No |
| `pedido` | `trg_pedido_digital_finalized_email` | `fn_order_mail_digital_finalized` | UPDATE | No |
| `pedido` | `trg_pedido_money_immutable` | `fn_guard_order_money` | UPDATE | No |
| `pedido` | `trg_pedido_pickup_lifecycle_email` | `fn_order_mail_pickup_transition` | UPDATE | No |
| `pedido` | `trg_pedido_public_reference` | `fn_guard_order_reference` | INSERT/UPDATE | No |
| `pedido` | `trg_pedido_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `pedido_direccion` | `trg_order_address_ec_contact_validation` | `fn_validate_ec_delivery_contact` | INSERT | No |
| `pedido_direccion` | `trg_pedido_direccion_append_only` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `pedido_entrega` | `trg_pickup_cancel_deadline` | `fn_pickup_cancel_deadline` | INSERT | No |
| `pedido_estado_historial` | `trg_pedido_customer_cancelled_email` | `fn_order_mail_customer_cancellation` | INSERT | No |
| `pedido_estado_historial` | `trg_pedido_estado_historial_append_only` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `pedido_item` | `trg_order_item_digital_purchase` | `fn_guard_digital_order_item` | INSERT | No |
| `pedido_item` | `trg_pedido_item_00_offer_history_lock` | `fn_lock_order_offer_snapshot_capture` | INSERT | No |
| `pedido_item` | `trg_pedido_item_append_only` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `pedido_item` | `trg_pedido_item_immutable` | `fn_prevent_update_delete` | UPDATE/DELETE | Sí; mismo TX |
| `pedido_item` | `trg_pedido_item_offer_snapshot` | `fn_capture_order_item_offer_snapshot` | INSERT | No |
| `pedido_retiro` | `trg_pedido_retiro_new_audit` | `fn_guard_pickup_snapshot` | INSERT | No |
| `pedido_retiro` | `trg_pedido_retiro_snapshot` | `fn_guard_pickup_snapshot` | UPDATE/DELETE | Sí; mismo TX |
| `ubicacion_retiro` | `trg_ubicacion_retiro_updated` | `fn_set_fecha_actualizacion` | UPDATE | No |
| `usuario` | `trg_usuario_email_verification` | `fn_invalidate_changed_email` | UPDATE | No |
| `usuario` | `trg_usuario_set_updated_at` | `fn_set_fecha_actualizacion` | UPDATE | No |


## Ejecución en producción (2026-11-01, supervisada por Claude)

**Decisión del usuario:** aceptó explícitamente el límite de no reutilización de V095 con una condición:
comprobar en producción que no existían números de documento manuales. Resultado: `factura` 5/5 automáticos
(`999-999-` + 9 dígitos ≤ contador 01 = 5) y `nota_credito` 0; condición cumplida. El residuo aceptado es la
probabilidad de que una referencia pública aleatoria futura coincida con una de las 8 borradas (~8/10⁸ por pedido).
Las claves R2 de facturas usan `invoiceId` (secuencia preservada) + SHA-256 del contenido: no pueden colisionar.

**Hallazgos del ensayo con la copia real V095 (corregidos antes de producción):**

| Hallazgo | Causa | Corrección |
|---|---|---|
| `permission denied for table ciudad` al bloquear | `LOCK … ACCESS EXCLUSIVE` exige UPDATE/DELETE/TRUNCATE de tabla; tras la limpieza ACL del runbook el owner solo tiene SELECT en provincia/ciudad/ciudad_alias | Tablas protegidas contra escritura se bloquean en `ACCESS SHARE` (solo SELECT); nadie puede escribirlas y las huellas preservadas fallan cerrado ante cualquier cambio |
| `permission denied for sequence cliente_guardado_despues_guardado_despues_id_seq` | `REASSIGN OWNED` dejó una ACL explícita sin SELECT para el owner (`pliego_owner=U`) | Lectura de estado con `pg_sequence_last_value()` + `pg_sequence.seqstart`, que solo requieren USAGE; mismo método antes y después |

El fixture sintético no reproducía esas ACL; la copia real sí. Tras las correcciones, el ensayo completo sobre
la copia real pasó: 5 rechazos fail-closed, rollback por defecto, fallo inyectado, commit y segundo commit sin
borrados, integridad (69 FK, 247 CHECK, 376 NOT NULL), 33 secuencias idénticas y flujo HTTP de cliente nuevo.

**Producción:** servicio detenido; backup previo root-only verificado (`pg_restore --list` 1 232 entradas);
dry run `ROLLBACK`; commit con `confirm=RESET`; **378 filas borradas**, 0 tablas preservadas cambiadas.
Estado final: 0 clientes, 0 pedidos, 0 facturas, 0 carritos, 0 propiedad digital, 1 ADMIN; 425 ediciones/libros
(425 con portada), 23 ofertas, 176 inventarios, 1 171 ciudades; contador de facturas 01 = 5; outbox sin
pendientes; Flyway 95; postflight de privilegios todo `t`; 0 registros ERROR. Ningún objeto R2 se tocó.
Evidencia privada root-only en `/opt/pliego/deployment/data-reset-20261101T234440Z/`.
