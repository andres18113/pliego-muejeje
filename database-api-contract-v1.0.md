# PLIEGO — Database API Contract v1.0

**Documento:** DAC-PLIEGO-001  
**Versión:** 1.1  
**Estado:** BASELINE APROBADA  
**Fecha:** 2026-09-23  
**Proyecto:** PLIEGO  
**Tipo de documento:** Contrato de interfaz Spring Boot ↔ PostgreSQL  
**Documentos fuente:**  
- `docs/requirements/use-case-baseline-v1.0.md` — versión interna 1.1, BASELINE APROBADA  
- `docs/domain/logical-erd-v1.0.md` — versión interna 1.1, BASELINE APROBADA  
- `docs/domain/data-dictionary-v1.0.md` — versión interna 1.1, BASELINE APROBADA  

**Ámbito:** Database API pública consumida por el backend Spring Boot  
**Siguiente artefacto:** Modelo Físico PostgreSQL v1.0  

---

# 1. Propósito

Este documento define el contrato formal entre el backend Java/Spring Boot y PostgreSQL para PLIEGO v1.

Su objetivo es eliminar la ambigüedad restante antes de diseñar el modelo físico y antes de implementar Stored Procedures, Functions, Triggers, Constraints, Gateways Java y endpoints REST.

La Database API determina:

- qué rutinas PostgreSQL puede invocar Java;
- cuáles son comandos y cuáles consultas;
- parámetros lógicos de entrada;
- resultados lógicos;
- autoridad de actor y propiedad;
- comportamiento transaccional;
- reglas de concurrencia;
- orden de bloqueo;
- errores de dominio;
- semántica de idempotencia;
- entidades leídas y modificadas;
- invariantes que cada rutina debe preservar;
- trazabilidad a casos de uso;
- límites entre rutinas públicas e implementación interna.

Este documento **no define todavía**:

- tipos físicos PostgreSQL definitivos;
- nombres de tablas físicas definitivos;
- tamaños físicos de columnas;
- índices definitivos;
- DDL;
- sintaxis PL/pgSQL completa;
- mapping REST/HTTP definitivo;
- DTO Java definitivos;
- OpenAPI definitivo.

---

# 2. Resultado de la auditoría previa

Se revisaron de forma cruzada UCB v1.1, DER Lógico v1.1 y Diccionario de Datos v1.1.

## 2.1 Resultado general

No se encontraron defectos estructurales que obliguen a:

- agregar entidades;
- eliminar entidades;
- cambiar cardinalidades;
- modificar el alcance de PLIEGO v1;
- modificar las máquinas de estado aprobadas.

Las **19 entidades persistentes** permanecen estables.

La baseline puede avanzar al Database API Contract.

## 2.2 Hallazgos residuales

### DAC-AUD-001 — Rango lógico de `Idioma`

El Diccionario establece globalmente:

```text
ISO 639-1       -> 2 caracteres
ISO 639-2/T     -> 3 caracteres cuando no exista 639-1
```

pero la fila de `Edicion.Idioma` conserva la descripción antigua:

```text
Código idioma; 2 caracteres
```

### Resolución normativa

Este contrato fija:

```text
LanguageCode := código canónico de 2 o 3 letras minúsculas
```

con preferencia:

1. ISO 639-1 cuando exista;
2. ISO 639-2/T cuando no exista ISO 639-1.

`PedidoItem.Idioma_Snapshot` conserva exactamente el código canónico vigente en checkout.

**Impacto:** corrección editorial menor pendiente en el Diccionario. No cambia el DER.

---

### DAC-AUD-002 — Estado editorial obsoleto en DER §30

El DER v1.1 tiene cabecera `BASELINE APROBADA`, pero conserva una frase heredada:

```text
queda como candidato a baseline
```

### Resolución

La cabecera y el historial v1.1 son autoritativos.

**Estado válido:** `BASELINE APROBADA`.

No existe impacto funcional.

---

### DAC-AUD-003 — Consultas administrativas ausentes en la superficie preliminar

Los casos de uso administrativos incluyen `consultar`, mientras la superficie preliminar del UCB listaba principalmente rutinas de escritura para Autor, Editorial, Categoría, Libro y Edición.

### Resolución

La Database API incorpora Functions administrativas de consulta para:

- clientes;
- autores;
- editoriales;
- categorías;
- libros;
- ediciones.

No se añade alcance: estas Functions materializan operaciones ya aprobadas.

---

### DAC-AUD-004 — Estado inicial de maestros de catálogo no fijado uniformemente

El modelo exige `Estado`, pero los casos de creación no especifican uniformemente si el estado debe recibirse como parámetro.

### Resolución

Para reducir complejidad:

```text
Autor nuevo       -> ACTIVE
Editorial nueva   -> ACTIVE
Categoria nueva   -> ACTIVE
Libro nuevo       -> ACTIVE
Edicion nueva     -> ACTIVE
```

El estado no forma parte de los procedimientos `create`.

Para crear un registro y posteriormente dejarlo inactivo se utiliza su procedimiento `set_status`.

Esta decisión mantiene una sola vía para cambios de estado.

---

### DAC-AUD-005 — Semántica transaccional pendiente de concreción

La UCB establece que Spring demarca la transacción y PostgreSQL atomiza la operación, pero no fija el comportamiento exacto de las rutinas.

### Resolución

- Spring Boot inicia/confirma/revierte la transacción de cada comando.
- Cada comando de negocio llama **exactamente una Procedure pública**.
- Las Procedures públicas de PLIEGO **no ejecutan `COMMIT` ni `ROLLBACK`**.
- Una excepción de dominio aborta la operación y provoca rollback.
- Un pago simulado `REJECTED` es un **resultado comercial válido**, no una excepción; el Pedido `CANCELLED` y Pago `REJECTED` se confirman.

---

### DAC-AUD-006 — Semántica del filtro de categoría

La UCB define filtro por categoría, pero no especifica el comportamiento al filtrar por una categoría raíz.

### Resolución

En catálogo público:

- filtro por subcategoría → coincidencia exacta;
- filtro por categoría raíz → Libros asociados a esa raíz **o a cualquiera de sus subcategorías directas**.

La jerarquía máxima de dos niveles hace esta regla simple y determinista.

---

# 3. Principios vinculantes de la Database API

## 3.1 Única frontera de persistencia

Spring Boot no accede directamente a tablas.

La dirección válida es:

```text
Controller
    ↓
Service
    ↓
Gateway
    ↓
Procedure / Function PostgreSQL
    ↓
tablas y lógica interna
```

Queda prohibido en Java implementar SQL de negocio con:

- `SELECT` sobre tablas;
- `INSERT`;
- `UPDATE`;
- `DELETE`;
- joins de negocio;
- lógica de stock;
- lógica de pedido;
- transiciones de estado;
- cálculo de totales desde tablas.

El Gateway puede contener únicamente la infraestructura necesaria para invocar una rutina PostgreSQL nominalmente identificada.

---

## 3.2 Comandos y consultas

### Procedure

Una Procedure representa un **comando** que puede modificar estado.

Convención:

```text
sp_<dominio>_<accion>
```

Ejemplo:

```text
sp_cart_add_item
sp_checkout
sp_order_cancel
```

### Function

Una Function pública representa una **consulta** y no debe producir efectos persistentes.

Convención:

```text
fn_<dominio>_<consulta>
```

Ejemplo:

```text
fn_catalog_search
fn_cart_get
fn_customer_orders
```

---

## 3.3 Una operación de negocio = una llamada pública

Ejemplo correcto:

```text
POST /checkout
       ↓
sp_checkout(...)
```

Ejemplo prohibido:

```text
Java -> fn_stock(...)
Java -> fn_price(...)
Java -> sp_create_order(...)
Java -> sp_reduce_stock(...)
```

La orquestación del negocio debe permanecer en PostgreSQL.

---

## 3.4 Rutinas públicas versus internas

### Públicas

Son las únicas que Java puede invocar.

Este documento las define expresamente.

### Internas

PostgreSQL podrá implementar helpers internos para:

- normalización;
- checksum ISBN;
- validación de actor;
- cálculo de totales;
- simulación de pago;
- transición de estados;
- construcción de snapshots;
- actualización de timestamps;
- otras operaciones repetidas.

Las rutinas internas:

- no forman parte del contrato Java;
- no deben ser invocadas directamente por Gateways;
- pueden modificarse sin cambiar el contrato mientras conserven el comportamiento observable.

---

## 3.5 Seguridad de ejecución

PLIEGO v1 no introduce un modelo complejo de seguridad propia de PostgreSQL.

Regla:

```text
SECURITY INVOKER
```

es el comportamiento esperado de las rutinas.

`SECURITY DEFINER` **no se utilizará por defecto**.

Solo podrá incorporarse posteriormente si aparece una necesidad concreta y documentada.

---

# 4. Tipos lógicos del contrato

Los siguientes tipos son abstractos. El Modelo Físico PostgreSQL definirá su representación concreta.

| Tipo lógico | Significado |
|---|---|
| `Id` | Identificador interno |
| `Text` | Texto UTF-8 |
| `Email` | Email de entrada |
| `EmailCanonical` | Email normalizado |
| `Phone` | Teléfono canónico |
| `Code` | Código controlado |
| `Slug` | Slug canónico |
| `SKU` | SKU canónico |
| `ISBN13` | ISBN-13 canónico |
| `LanguageCode` | ISO 639-1 o ISO 639-2/T canónico |
| `CountryCode` | ISO 3166-1 alpha-2 |
| `PositiveInt` | Entero > 0 |
| `NonNegativeInt` | Entero >= 0 |
| `MoneyUSD` | Decimal exacto USD, dos decimales |
| `Boolean` | verdadero/falso |
| `Date` | Fecha civil |
| `Instant` | Instante absoluto |
| `Url` | URL/URI |
| `StatusCode` | Valor de máquina de estados |
| `IdList` | Colección ordenada/no ordenada de IDs según contrato |
| `AuthorAssignmentList` | Colección de `(AuthorId, Order)` |
| `Record` | Resultado lógico compuesto |
| `RecordSet` | Conjunto ordenado de resultados |

La representación de `IdList`, `AuthorAssignmentList` y estructuras complejas será fijada por el Modelo Físico PostgreSQL.

---

# 5. Convenciones de parámetros

## 5.1 Prefijos

Parámetros de entrada:

```text
p_<nombre>
```

Parámetros/resultados de salida:

```text
o_<nombre>
```

---

## 5.2 Actor autenticado

Toda operación privada recibe:

```text
p_actor_user_id : Id
```

Este valor:

- procede de la identidad autenticada de Spring Security;
- **no** se acepta desde el body controlado por el cliente;
- corresponde a `Usuario.UsuarioId`.

PostgreSQL resuelve a partir de él:

- existencia;
- estado;
- rol;
- Cliente asociado;
- propiedad de recursos.

Esto evita que Java tenga que pasar `ClienteId` como fuente de autorización.

---

## 5.3 Parámetros opcionales

Un parámetro opcional `null` significa:

```text
criterio ausente
```

en Functions de búsqueda.

En Procedures de actualización se utiliza la semántica de **reemplazo completo del conjunto mutable**, no PATCH implícito.

Por tanto:

- `null` en un campo opcional significa “establecer ausencia”;
- no significa “mantener valor previo”.

El backend debe leer/enviar el estado completo de los atributos mutables cuando invoque una Procedure `update`. Toda `update` revalida las invariantes estructurales de su `create` correspondiente.

Esto elimina la ambigüedad entre:

```text
no modificar
```

y:

```text
establecer NULL
```

---

# 6. Convenciones de paginación

Functions que devuelven colecciones paginadas reciben:

```text
p_page      : NonNegativeInt
p_page_size : PositiveInt
```

Reglas:

```text
p_page >= 0
1 <= p_page_size <= 50
```

`p_page` es **base cero**.

Ejemplo:

```text
p_page = 0
p_page_size = 20
```

representa la primera página.

Toda fila de una consulta paginada incluye conceptualmente:

```text
total_count
```

para evitar una segunda consulta de conteo.

Cuando no existan resultados:

```text
RecordSet vacío
total_count = 0
```

El mapping físico exacto del total será definido en el Modelo Físico.

---

# 7. Convenciones de ordenamiento

Las Functions no reciben fragmentos SQL libres.

Reciben códigos cerrados.

Ejemplo de catálogo:

```text
TITLE_ASC
PRICE_ASC
PRICE_DESC
```

Cualquier código no reconocido produce:

```text
P1001 INVALID_ARGUMENT
```

Esto evita SQL dinámico controlado por el consumidor.

Si el consumidor no especifica sort, REST suministra `TITLE_ASC`.

---

# 8. Autoridad y autorización

## 8.1 Validación técnica en Spring

Spring Security puede bloquear previamente:

- ausencia de autenticación;
- endpoint administrativo sin rol esperado.

## 8.2 Autoridad definitiva en PostgreSQL

Las rutinas privadas vuelven a validar:

- existencia del actor;
- `Usuario.Estado = ACTIVE`;
- rol;
- asociación Cliente cuando corresponda;
- propiedad del recurso.

Incluye lectura y cancelación de pedidos propios: un `BLOCKED` no opera su carrito ni sus pedidos; la intervención pasa por ADMIN.

La validación en Spring no reemplaza a PostgreSQL.

---

# 9. Contrato transaccional

## 9.1 Procedures mutantes

Toda Procedure pública mutante debe ejecutarse dentro de una transacción iniciada por Spring.

Patrón:

```text
Spring BEGIN
    CALL pliego.sp_xxx(...)
Spring COMMIT
```

Si PostgreSQL genera una excepción:

```text
Spring ROLLBACK
```

## 9.2 Regla de las Procedures

Las Procedures públicas:

- no ejecutan `COMMIT`;
- no ejecutan `ROLLBACK`;
- no fragmentan una operación de negocio en varias transacciones.

La atomicidad se consigue porque toda su lógica ocurre dentro de la transacción del caller.

## 9.3 Functions de consulta

Las Functions públicas son de solo lectura.

No deben producir:

- inserts;
- updates;
- deletes;
- transiciones;
- efectos secundarios persistentes.

## 9.4 Excepción versus resultado comercial

### Excepción

Ejemplos:

- stock insuficiente;
- edición inexistente;
- actor no autorizado;
- dirección inválida;
- transición imposible.

Resultado:

```text
ROLLBACK
```

### Resultado comercial válido

Pago simulado rechazado:

```text
Pedido = CANCELLED
Pago = REJECTED
Carrito = ACTIVE
```

Resultado:

```text
COMMIT
```

No se lanza excepción por el rechazo simulado.

---

# 10. Modelo de errores de dominio

## 10.1 Regla general

Las rutinas públicas deben exponer errores esperados mediante SQLSTATE estable de cinco caracteres.

Formato recomendado:

```text
Pxxxx
```

El backend debe decidir por:

```text
SQLSTATE
```

y **no** por comparación de mensajes humanos.

El mensaje podrá incluir un código simbólico estable.

Ejemplo conceptual:

```text
SQLSTATE: P3002
MESSAGE:  INSUFFICIENT_STOCK
```

Errores inesperados de PostgreSQL que no formen parte de esta tabla se consideran fallos técnicos.

---

## 10.2 Catálogo de SQLSTATE de dominio

### Generales / actor

| SQLSTATE | Código simbólico | Semántica |
|---|---|---|
| P1001 | INVALID_ARGUMENT | Parámetro fuera del contrato |
| P1002 | ACTOR_NOT_FOUND | Usuario actor inexistente |
| P1003 | ACTOR_INACTIVE | Usuario actor no está ACTIVE |
| P1004 | ACTOR_NOT_ADMIN | Operación exige ADMIN |
| P1005 | ACTOR_NOT_CUSTOMER | Operación exige CUSTOMER |

### Identidad / cliente

| SQLSTATE | Código | Semántica |
|---|---|---|
| P1101 | EMAIL_ALREADY_EXISTS | Email normalizado ya registrado |
| P1102 | CUSTOMER_NOT_FOUND | Perfil CUSTOMER inexistente |
| P1103 | ADDRESS_NOT_FOUND | Dirección inexistente o no visible para el actor |

### Catálogo

| SQLSTATE | Código | Semántica |
|---|---|---|
| P2001 | AUTHOR_NOT_FOUND | Autor inexistente |
| P2002 | AUTHOR_INACTIVE | Autor nuevo en asociación está INACTIVE |
| P2011 | PUBLISHER_NOT_FOUND | Editorial inexistente |
| P2012 | PUBLISHER_INACTIVE | Editorial nueva/asignada está INACTIVE |
| P2021 | CATEGORY_NOT_FOUND | Categoría inexistente |
| P2022 | CATEGORY_INACTIVE | Categoría nueva en asociación está INACTIVE |
| P2023 | CATEGORY_INVALID_HIERARCHY | Padre/ciclo/profundidad inválidos |
| P2024 | CATEGORY_SLUG_EXISTS | Slug ya existente |
| P2031 | BOOK_NOT_FOUND | Libro inexistente |
| P2032 | BOOK_REQUIRES_AUTHOR | Libro ACTIVE quedaría sin autor |
| P2033 | BOOK_REQUIRES_CATEGORY | Libro ACTIVE quedaría sin categoría |
| P2034 | AUTHOR_ORDER_INVALID | Orden de autoría inválido/duplicado |
| P2041 | EDITION_NOT_FOUND | Edición inexistente |
| P2042 | EDITION_INACTIVE | Edición INACTIVE para operación comercial |
| P2043 | BOOK_INACTIVE | Libro INACTIVE para operación comercial |
| P2044 | SKU_ALREADY_EXISTS | SKU duplicado |
| P2045 | ISBN_ALREADY_EXISTS | ISBN duplicado |
| P2046 | ISBN_INVALID | Formato/checksum ISBN inválido |
| P2047 | COVER_METADATA_INVALID | Metadatos/licencia de portada incoherentes |
| P2048 | EDITION_DATA_INVALID | Datos de edición fuera de invariantes |

### Inventario

| SQLSTATE | Código | Semántica |
|---|---|---|
| P3001 | INVENTORY_NOT_FOUND | Inventario de Edición inexistente |
| P3002 | INSUFFICIENT_STOCK | Stock insuficiente |
| P3003 | STOCK_QUANTITY_INVALID | Cantidad de movimiento inválida |
| P3004 | STOCK_MINIMUM_INVALID | Stock mínimo inválido |
| P3005 | STOCK_MOVEMENT_DUPLICATE | SALE/CANCELLATION ya aplicado |
| P3006 | SALE_REQUIRED_FOR_CANCELLATION | CANCELLATION sin SALE previo |

### Carrito

| SQLSTATE | Código | Semántica |
|---|---|---|
| P4001 | CART_NOT_ACTIVE | No existe/ya no está activo el carrito requerido |
| P4002 | CART_EMPTY | Checkout sobre carrito vacío |
| P4003 | CART_ITEM_NOT_FOUND | Item inexistente o no perteneciente al actor |
| P4004 | CART_QUANTITY_INVALID | Cantidad <= 0 o fuera del contrato |

### Pedido / pago

| SQLSTATE | Código | Semántica |
|---|---|---|
| P5001 | ORDER_NOT_FOUND | Pedido inexistente o no visible al CUSTOMER |
| P5002 | ORDER_INVALID_TRANSITION | Transición logística no permitida |
| P5003 | ORDER_NOT_CANCELLABLE | Estado actual no admite cancelación |
| P5004 | CHECKOUT_ADDRESS_INVALID | Dirección inexistente/no pertenece al Cliente |
| P5005 | PAYMENT_OUTCOME_INVALID | Resultado del simulador no reconocido |
| P5006 | PAYMENT_STATE_INVALID | Estado de Pago incompatible |
| P5007 | PAYMENT_REFERENCE_CONFLICT | Referencia de Pago duplicada |

---

## 10.3 Normalización de errores de constraint

Si una carrera concurrente produce una violación de constraint estándar para una regla que posee código de dominio, la rutina deberá normalizarla al SQLSTATE de dominio correspondiente según el mapa obligatorio:

```text
email duplicado                    -> P1101
SKU duplicado                      -> P2044
ISBN duplicado                     -> P2045
slug duplicado                     -> P2024
referencia de pago duplicada       -> P5007
SALE/CANCELLATION duplicado        -> P3005
segundo Carrito ACTIVE             -> releer el existente; si no puede, P4001
segunda dirección principal        -> serializar/desmarcar; P1001 solo si no puede cumplir
historial inicial duplicado        -> fallo técnico (no expuesto por API válida)
```

## 10.4 Matriz rutina → SQLSTATE

Códigos aplicables por rutina o grupo (más blanket de actor §8.2 donde corresponda):

| Rutina / grupo | Códigos aplicables |
|---|---|
| `sp_customer_register` | P1001, P1101 |
| `fn_user_auth_data` | ninguno (vacío por diseño) |
| Searches administrativas | P1001, P1002, P1003, P1004 |
| `sp_customer_set_status` | P1001, P1002, P1003, P1004, P1102 |
| `fn_customer_profile`, `fn_address_list`, `fn_cart_get` | P1002, P1003, P1005 |
| `sp_customer_update` | P1001, P1002, P1003, P1005, P1102 |
| Address create/update/delete/set_primary | P1001, P1103 |
| `fn_catalog_search`, `fn_edition_detail` | P1001 (sort/enum); slug desconocido → 0 filas |
| Admin catálogo create/update/set_status | blanket ADMIN, NOT_FOUND de su entidad, unicidades, invariantes de create también en update |
| Inventory entry/adjust/set_minimum | P2041, P3001 defensivo, P3003, P3002 (adjust-out), P3004 |
| Cart add/update/remove | P2041, P2042, P2043, P3002, P4001, P4003, P4004 |
| `sp_checkout` | P1001, P4001, P4002, P5004, P2042, P2043, P3002, P5005 |
| `sp_order_cancel` | P5001, P5003, P3005, P3006, P5006 (CUSTOMER propietario o ADMIN) |
| `sp_order_change_status` | P5001, P5002 |
| Order queries (customer/admin) | P1002, P1003, P1004/P1005 según rol; P5001 en detalle ajeno/inexistente |

## 10.5 Error técnico de integridad

| SQLSTATE | Código | Clasificación |
|---|---|---|
| P9001 | IMMUTABLE_HISTORY_VIOLATION | TECHNICAL_INTEGRITY_ERROR |

No es error de dominio. HTTP futuro: 500. Un endpoint correcto nunca lo produce; `DatabaseExceptionTranslator` debe conocerlo.

---

# 11. Concurrencia y orden de bloqueo

## 11.1 Principio

Toda operación que modifique recursos compartidos debe:

1. validar el recurso;
2. adquirir locks en un orden determinista;
3. realizar cambios;
4. preservar invariantes;
5. terminar sin depender de locks externos a la transacción.

El estado del actor se valida al inicio; un bloqueo concurrente posterior no aborta la operación en curso (aplica a nuevas invocaciones).

---

## 11.2 Carrito

Las Procedures:

- `sp_cart_add_item`;
- `sp_cart_update_item`;
- `sp_cart_remove_item`;
- `sp_checkout`;

deben serializar modificaciones concurrentes al mismo Carrito.

Regla:

```text
primero: Carrito ACTIVE del Cliente -> FOR UPDATE
```

Si no existe al agregar:

- la creación debe ser segura ante dos solicitudes concurrentes;
- la restricción de “máximo un ACTIVE” es la defensa final;
- la rutina debe resolver el conflicto dejando exactamente un Carrito ACTIVE.

---

## 11.3 Checkout

Orden lógico de locking:

```text
1. Usuario/Cliente actor validado
2. Carrito ACTIVE                     FOR UPDATE
3. Dirección seleccionada             lock de lectura que impida DELETE durante snapshot
4. Items del carrito
5. Inventarios, ordenados por EdicionId ASC   FOR UPDATE
6. crear Pedido/Pago/snapshots/movimientos
```

Los Inventarios **siempre** se bloquean en `EdicionId` ascendente para reducir riesgo de deadlock entre checkouts que comparten varias Ediciones.

Una vez adquiridos:

- se revalida stock;
- se actualiza el inventario;
- se crean los movimientos correspondientes.

---

## 11.4 Inventario administrativo

`sp_inventory_entry` y `sp_inventory_adjust`:

```text
Inventario objetivo -> FOR UPDATE
```

antes de calcular `StockAnterior` y `StockPosterior`.

---

## 11.5 Cancelación

`sp_order_cancel`:

```text
1. Pedido                         FOR UPDATE
2. Pago asociado
3. Inventarios de PedidoItem,
   ordenados por EdicionId ASC    FOR UPDATE
4. restauración + movimientos
5. refund simulado
6. historial
```

Dos cancelaciones concurrentes no pueden restaurar dos veces el mismo stock.

La unicidad de `(PedidoId, EdicionId, CANCELLATION)` constituye defensa adicional.

---

## 11.6 Dirección principal

Operaciones que puedan cambiar la dirección principal serializan sobre el Cliente propietario antes de modificar flags de sus Direcciones.

Así se preserva:

```text
COUNT(Direccion WHERE EsPrincipal) <= 1
```

---

## 11.7 Libro y relaciones

`sp_book_update` bloquea el Libro antes de reemplazar:

- metadatos;
- autorías;
- categorías.

El reemplazo completo ocurre en una única transacción.

---

# 12. Idempotencia

PLIEGO v1 no incorpora infraestructura general de `Idempotency-Key`.

## 12.1 Operaciones naturalmente idempotentes

Son idempotentes respecto al estado final:

- `sp_customer_set_status`;
- `sp_author_set_status`;
- `sp_publisher_set_status`;
- `sp_category_set_status`;
- `sp_book_set_status`;
- `sp_edition_set_status`;
- `sp_inventory_set_minimum`;
- `sp_address_set_primary`.

Solicitar nuevamente el mismo estado válido produce éxito sin efectos adicionales.

## 12.2 Operaciones no idempotentes

Ejemplos:

- registrar cliente;
- crear autor/editorial/categoría/libro/edición;
- entrada de inventario;
- ajuste de inventario;
- agregar unidades al carrito;
- checkout rechazado.

El caller no debe reintentarlas automáticamente como si fueran idempotentes.

## 12.3 Checkout aprobado

Una vez que el checkout de un Carrito termina `APPROVED`:

```text
Carrito -> CHECKED_OUT
```

por lo que una segunda llamada no puede generar otra compra desde el mismo carrito.

## 12.4 Checkout rechazado

Pago `REJECTED` mantiene el Carrito `ACTIVE`.

Una nueva llamada representa **un nuevo intento comercial** y puede generar otro Pedido `CANCELLED`.

Esto es comportamiento intencional de v1.

## 12.5 Retry tras timeout

La política de retry/recovery tras timeout o resultado desconocido pertenece al REST API Contract: prohibido reejecutar comandos no idempotentes a ciegas después de perder la respuesta.

---

# 13. Contrato del simulador de pago

## 13.1 Alcance

No existe pasarela externa.

La simulación ocurre dentro del flujo de `sp_checkout`.

## 13.2 Parámetro determinista

`sp_checkout` recibe:

```text
p_payment_outcome : Code
```

Valores admitidos:

```text
APPROVED
REJECTED
```

No se permite resultado aleatorio.

Este parámetro es **técnico/académico** y no representa autorización financiera real.

El REST/Security Contract decidirá si se expone directamente en ambientes académicos o si Spring lo obtiene de configuración de prueba.

## 13.3 Resultado APPROVED

Debe producir:

```text
Pago.Estado   = APPROVED
Pedido.Estado = CONFIRMED
Carrito       = CHECKED_OUT
stock         = descontado
SALE          = creado por item
```

`Pago.Referencia` es obligatoria y única. Formato: `SIM-<UUIDv4>` (generado por PostgreSQL).

## 13.4 Resultado REJECTED

Debe producir:

```text
Pago.Estado   = REJECTED
Pedido.Estado = CANCELLED
Carrito       = ACTIVE
stock         = sin cambios
SALE          = ninguno
```

Puede registrar `DetalleResultado`. Referencia = NULL en v1 (exigido por CHECK).

## 13.5 Refund

No existe operación de pago pública independiente.

`REFUNDED` solo se produce desde:

```text
sp_order_cancel
```

cuando el Pedido tenía Pago `APPROVED`.

---

# 14. Database API — Identity / Security

## 14.1 `sp_customer_register`

### Tipo

Procedure pública.

### Caso de uso

CU-AUTH-01.

### Firma lógica

```text
sp_customer_register(
    p_email         : Email,
    p_password_hash : Text,
    p_first_names   : Text,
    p_last_names    : Text,
    p_phone         : Phone?
)
->
    o_user_id       : Id,
    o_customer_id   : Id,
    o_user_state    : StatusCode
```

### Autoridad

Pública; no requiere actor autenticado.

### Responsabilidades

1. normalizar email;
2. comprobar unicidad;
3. validar valores no vacíos;
4. crear Usuario:
   - rol `CUSTOMER`;
   - estado `ACTIVE`;
5. crear Cliente;
6. preservar relación 1:1;
7. confirmar ambas inserciones atómicamente.

### No hace

- hashing de password;
- envío de correo;
- creación de sesión/token.

El hash llega desde Spring Security.

### Errores

- P1001 INVALID_ARGUMENT
- P1101 EMAIL_ALREADY_EXISTS

### Escrituras

- Usuario
- Cliente

---

## 14.2 `fn_user_auth_data`

### Tipo

Function pública de consulta.

### Caso de uso

CU-AUTH-02.

### Firma lógica

```text
fn_user_auth_data(
    p_email : Email
)
-> UserAuthRecord?
```

### Resultado

```text
user_id
email_canonical
password_hash
role
state
```

### Semántica

- normaliza email;
- si no existe, devuelve cero resultados;
- no genera error `USER_NOT_FOUND`;
- no verifica contraseña;
- no genera token.

Spring Security:

1. obtiene el record;
2. valida `state`;
3. verifica password contra hash;
4. genera token stateless.

### Lecturas

- Usuario

---

## 14.3 `fn_admin_customer_search`

### Tipo

Function administrativa.

### Caso de uso

CU-ADM-SEC-01.

### Firma lógica

```text
fn_admin_customer_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : StatusCode?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<CustomerAdminSummary>
```

### Filtros

`p_query` puede coincidir con:

- email;
- nombres;
- apellidos.

### Resultado mínimo

```text
user_id
customer_id
email
first_names
last_names
phone
state
created_at
total_count
```

### Autoridad

Actor `ACTIVE` + `ADMIN`.

### Errores

- P1001
- P1002
- P1003
- P1004

---

## 14.4 `sp_customer_set_status`

### Tipo

Procedure administrativa.

### Caso de uso

CU-ADM-SEC-01.

### Firma lógica

```text
sp_customer_set_status(
    p_actor_user_id  : Id,
    p_customer_id    : Id,
    p_new_state      : UsuarioEstado
)
->
    o_customer_id    : Id,
    o_user_id        : Id,
    o_effective_state: UsuarioEstado
```

### Reglas

- actor ADMIN ACTIVE;
- target debe existir;
- target debe ser CUSTOMER;
- estados válidos: ACTIVE/BLOCKED;
- no borra carrito;
- no altera pedidos;
- solicitar el mismo estado es éxito idempotente.

### Errores

- P1001
- P1002
- P1003
- P1004
- P1102

### Escrituras

- Usuario

---

# 15. Database API — Customer

## 15.1 `fn_customer_profile`

```text
fn_customer_profile(
    p_actor_user_id : Id
)
-> CustomerProfile
```

Resultado:

```text
customer_id
email
first_names
last_names
phone
state
```

Actor:

```text
ACTIVE + CUSTOMER
```

---

## 15.2 `sp_customer_update`

```text
sp_customer_update(
    p_actor_user_id : Id,
    p_first_names   : Text,
    p_last_names    : Text,
    p_phone         : Phone?
)
-> CustomerProfile
```

Semántica:

- reemplaza el conjunto mutable del perfil;
- no modifica email;
- no modifica rol;
- no modifica estado.

Errores:

- P1001
- P1002
- P1003
- P1005
- P1102

---

## 15.3 `fn_address_list`

```text
fn_address_list(
    p_actor_user_id : Id
)
-> RecordSet<AddressRecord>
```

Resultado:

```text
address_id
alias
recipient
line1
line2
city
province
country_code
postal_code
reference
phone
is_primary
```

Orden recomendado:

1. principal primero;
2. creación ascendente o alias como criterio estable definido en modelo físico.

---

## 15.4 `sp_address_create`

```text
sp_address_create(
    p_actor_user_id : Id,
    p_alias         : Text,
    p_recipient     : Text,
    p_line1         : Text,
    p_line2         : Text?,
    p_city          : Text,
    p_province      : Text,
    p_country_code  : CountryCode,
    p_postal_code   : Text?,
    p_reference     : Text?,
    p_phone         : Phone,
    p_make_primary  : Boolean
)
->
    o_address_id    : Id
```

Si `p_make_primary = true`:

- desmarca la principal anterior;
- marca la nueva;
- todo en una transacción.

---

## 15.5 `sp_address_update`

```text
sp_address_update(
    p_actor_user_id : Id,
    p_address_id    : Id,
    p_alias         : Text,
    p_recipient     : Text,
    p_line1         : Text,
    p_line2         : Text?,
    p_city          : Text,
    p_province      : Text,
    p_country_code  : CountryCode,
    p_postal_code   : Text?,
    p_reference     : Text?,
    p_phone         : Phone
)
```

`EsPrincipal` no se modifica aquí.

Se usa `sp_address_set_primary`.

Si la dirección no pertenece al actor, la rutina responde:

```text
P1103 ADDRESS_NOT_FOUND
```

para no exponer propiedad ajena.

---

## 15.6 `sp_address_delete`

```text
sp_address_delete(
    p_actor_user_id : Id,
    p_address_id    : Id
)
```

Reglas:

- solo propietario;
- DELETE físico permitido;
- si era principal, es válido quedar con cero principales;
- no altera PedidoDireccion.

Errores:

- P1103 ADDRESS_NOT_FOUND

---

## 15.7 `sp_address_set_primary`

```text
sp_address_set_primary(
    p_actor_user_id : Id,
    p_address_id    : Id
)
```

Reglas:

- solo propietario;
- serializa cambios de direcciones principales del Cliente;
- deja exactamente esa Dirección como principal;
- repetir sobre la principal actual es éxito idempotente.

---

# 16. Database API — Catálogo público

## 16.1 `fn_catalog_search`

### Tipo

Function pública.

### Casos de uso

CU-CAT-01.

### Firma lógica

```text
fn_catalog_search(
    p_title_query    : Text?,
    p_author_query   : Text?,
    p_isbn13         : ISBN13?,
    p_category_slug  : Slug?,
    p_price_min      : MoneyUSD?,
    p_price_max      : MoneyUSD?,
    p_language       : LanguageCode?,
    p_format         : FormatoEdicion?,
    p_sort           : Code,
    p_page           : NonNegativeInt,
    p_page_size      : PositiveInt
)
-> RecordSet<CatalogEditionSummary>
```

### Semántica de filtros

Todos los filtros suministrados se combinan mediante AND.

#### Título

Coincidencia parcial, insensible a mayúsculas/minúsculas.

#### Autor

Coincidencia parcial sobre `Autor.Nombre`, insensible a mayúsculas/minúsculas.

#### ISBN

Coincidencia exacta canónica.

#### Categoría

Si slug identifica:

- subcategoría → asociación exacta;
- raíz → asociación a la raíz o a cualquier subcategoría directa.

Slug desconocido → 0 filas, sin error.

#### Precio

```text
p_price_min <= Edicion.Precio <= p_price_max
```

cuando correspondan.

### Publicabilidad

Solo devuelve:

```text
Libro ACTIVE
AND Edicion ACTIVE
```

Autor/Editorial/Categoria inactivos previamente asociados no ocultan la edición.

### Disponibilidad

```text
available = StockActual > 0
```

Stock cero no elimina el resultado.

### Resultado mínimo

```text
edition_id
book_id
title
authors_ordered
publisher_name
isbn13
price
cover_url
cover_license
cover_attribution
format
language
available
total_count
```

No expone `StockActual` exacto en la API pública.

---

## 16.2 `fn_edition_detail`

```text
fn_edition_detail(
    p_edition_id : Id
)
-> EditionPublicDetail?
```

Solo devuelve una Edición publicable.

Si:

- no existe;
- Libro INACTIVE;
- Edicion INACTIVE;

devuelve cero resultados.

Resultado:

```text
edition_id
book_id
title
subtitle
synopsis
authors_ordered
categories
publisher
isbn13
sku
language
format
page_count
publication_date
price
cover_url
cover_license
cover_source_url
cover_attribution
available
```

---

# 17. Database API — Administración de catálogo

## 17.1 Consultas administrativas

Todas requieren:

```text
p_actor_user_id -> ACTIVE ADMIN
```

y soportan paginación cuando el conjunto puede crecer.

### `fn_admin_author_search`

```text
fn_admin_author_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : EstadoCatalogo?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<AuthorAdminRecord>
```

### `fn_admin_publisher_search`

```text
fn_admin_publisher_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : EstadoCatalogo?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<PublisherAdminRecord>
```

### `fn_admin_category_search`

```text
fn_admin_category_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : EstadoCatalogo?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<CategoryAdminRecord>
```

Debe incluir información del padre cuando exista.

### `fn_admin_book_search`

```text
fn_admin_book_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : EstadoCatalogo?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<BookAdminRecord>
```

Cada BookAdminRecord debe incluir:

- datos del Libro;
- autores con IDs y `OrdenAutoria`;
- categorías con IDs;
- estado.

### `fn_admin_edition_search`

```text
fn_admin_edition_search(
    p_actor_user_id : Id,
    p_query         : Text?,
    p_state         : EstadoCatalogo?,
    p_book_id       : Id?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<EditionAdminRecord>
```

`p_query` puede coincidir con:

- SKU;
- ISBN;
- título.

Debe devolver los campos mutables necesarios para administración.

---

## 17.2 Autor

### `sp_author_create`

```text
sp_author_create(
    p_actor_user_id : Id,
    p_name          : Text,
    p_biography     : Text?
)
->
    o_author_id     : Id
```

Estado inicial:

```text
ACTIVE
```

### `sp_author_update`

```text
sp_author_update(
    p_actor_user_id : Id,
    p_author_id     : Id,
    p_name          : Text,
    p_biography     : Text?
)
```

### `sp_author_set_status`

```text
sp_author_set_status(
    p_actor_user_id : Id,
    p_author_id     : Id,
    p_new_state     : EstadoCatalogo
)
```

Reglas:

- no elimina LibroAutor;
- inactivar no oculta automáticamente Libros;
- mismo estado = éxito idempotente.

---

## 17.3 Editorial / Publisher

### `sp_publisher_create`

```text
sp_publisher_create(
    p_actor_user_id : Id,
    p_name          : Text,
    p_description   : Text?
)
->
    o_publisher_id  : Id
```

Estado inicial `ACTIVE`.

### `sp_publisher_update`

```text
sp_publisher_update(
    p_actor_user_id : Id,
    p_publisher_id  : Id,
    p_name          : Text,
    p_description   : Text?
)
```

### `sp_publisher_set_status`

```text
sp_publisher_set_status(
    p_actor_user_id : Id,
    p_publisher_id  : Id,
    p_new_state     : EstadoCatalogo
)
```

No modifica automáticamente Ediciones existentes.

---

## 17.4 Categoría

### `sp_category_create`

```text
sp_category_create(
    p_actor_user_id    : Id,
    p_name             : Text,
    p_slug             : Slug,
    p_description      : Text?,
    p_parent_category_id : Id?
)
->
    o_category_id      : Id
```

Estado inicial `ACTIVE`.

Valida:

- slug global;
- padre existente;
- padre raíz;
- no profundidad > 2.

### `sp_category_update`

```text
sp_category_update(
    p_actor_user_id      : Id,
    p_category_id        : Id,
    p_name               : Text,
    p_slug               : Slug,
    p_description        : Text?,
    p_parent_category_id : Id?
)
```

Si una categoría raíz posee hijos no puede convertirse en subcategoría, porque crearía profundidad inválida.

### `sp_category_set_status`

```text
sp_category_set_status(
    p_actor_user_id : Id,
    p_category_id   : Id,
    p_new_state     : EstadoCatalogo
)
```

No elimina LibroCategoria.

---

## 17.5 Libro

### AuthorAssignmentList

Cada entrada contiene:

```text
author_id
order
```

Reglas:

- IDs no repetidos;
- `order > 0`;
- order no repetido;
- orden no necesita ser contiguo.

### `sp_book_create`

```text
sp_book_create(
    p_actor_user_id : Id,
    p_title         : Text,
    p_subtitle      : Text?,
    p_synopsis      : Text?,
    p_authors       : AuthorAssignmentList,
    p_category_ids  : IdList
)
->
    o_book_id       : Id
```

Estado inicial `ACTIVE`.

Requiere:

```text
>= 1 author
>= 1 category
```

Todos los Autores y Categorías introducidos deben estar `ACTIVE`.

Crea atómicamente:

- Libro;
- LibroAutor;
- LibroCategoria.

### `sp_book_update`

```text
sp_book_update(
    p_actor_user_id : Id,
    p_book_id       : Id,
    p_title         : Text,
    p_subtitle      : Text?,
    p_synopsis      : Text?,
    p_authors       : AuthorAssignmentList,
    p_category_ids  : IdList
)
```

Semántica:

- reemplaza el conjunto actual de autores y categorías;
- reordena autoría dentro de una transacción;
- una asociación INACTIVE ya existente puede conservarse;
- un Autor/Categoría INACTIVE que no estaba previamente asociado no puede introducirse;
- si Libro está `ACTIVE`, la lista final debe conservar al menos un Autor y una Categoría.

### `sp_book_set_status`

```text
sp_book_set_status(
    p_actor_user_id : Id,
    p_book_id       : Id,
    p_new_state     : EstadoCatalogo
)
```

Para pasar a `ACTIVE`:

```text
>= 1 LibroAutor
>= 1 LibroCategoria
```

No cambia estado de Ediciones.

---

## 17.6 Edición

### `sp_edition_create`

```text
sp_edition_create(
    p_actor_user_id        : Id,
    p_book_id              : Id,
    p_publisher_id         : Id,
    p_sku                  : SKU,
    p_isbn13               : ISBN13?,
    p_language             : LanguageCode,
    p_format               : FormatoEdicion,
    p_page_count           : PositiveInt,
    p_publication_date     : Date?,
    p_price                : MoneyUSD,
    p_cover_url            : Url?,
    p_cover_license        : LicenciaPortada?,
    p_cover_source_url     : Url?,
    p_cover_attribution    : Text?
)
->
    o_edition_id           : Id
```

Estado inicial:

```text
ACTIVE
```

Reglas:

- Libro debe existir; puede estar INACTIVE.
- Editorial debe estar ACTIVE.
- SKU único.
- ISBN opcional válido y único.
- LanguageCode 2 o 3 letras canónicas.
- precio > 0.
- páginas > 0.
- portada cumple matriz de licencia.

Crea en una misma transacción:

```text
Edicion
Inventario(StockActual=0, StockMinimo=0)
```

### `sp_edition_update`

```text
sp_edition_update(
    p_actor_user_id        : Id,
    p_edition_id           : Id,
    p_publisher_id         : Id,
    p_isbn13               : ISBN13?,
    p_language             : LanguageCode,
    p_format               : FormatoEdicion,
    p_page_count           : PositiveInt,
    p_publication_date     : Date?,
    p_price                : MoneyUSD,
    p_cover_url            : Url?,
    p_cover_license        : LicenciaPortada?,
    p_cover_source_url     : Url?,
    p_cover_attribution    : Text?
)
```

No puede modificar:

- LibroId;
- SKU.

Si cambia `PublisherId`, el nuevo Publisher debe estar ACTIVE.

Si conserva el Publisher actual aunque éste esté INACTIVE, la actualización de otros metadatos sigue siendo válida.

### `sp_edition_set_status`

```text
sp_edition_set_status(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_new_state     : EstadoCatalogo
)
```

No cambia Libro.

---

# 18. Database API — Inventario

## 18.1 `fn_inventory_search`

```text
fn_inventory_search(
    p_actor_user_id : Id,
    p_edition_id    : Id?,
    p_title_query   : Text?,
    p_sku           : SKU?,
    p_low_stock_only: Boolean?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<InventorySummary>
```

Actor: ADMIN ACTIVE.

Resultado:

```text
edition_id
book_id
title
sku
isbn13
edition_state
stock_actual
stock_minimo
low_stock
updated_at
total_count
```

`low_stock`:

```text
StockMinimo > 0
AND StockActual <= StockMinimo
```

---

## 18.2 `fn_inventory_movements`

```text
fn_inventory_movements(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_type          : TipoMovimientoInventario?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<InventoryMovementRecord>
```

Orden:

```text
Fecha DESC
```

con criterio secundario estable por ID.

---

## 18.3 `sp_inventory_entry`

```text
sp_inventory_entry(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_quantity      : PositiveInt,
    p_reason        : Text
)
->
    o_movement_id   : Id,
    o_stock_before  : NonNegativeInt,
    o_stock_after   : NonNegativeInt
```

Actor ADMIN.

Tipo generado:

```text
ENTRY
```

Lock:

```text
Inventario FOR UPDATE
```

---

## 18.4 `sp_inventory_adjust`

```text
sp_inventory_adjust(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_adjustment_type : Code,
    p_quantity      : PositiveInt,
    p_reason        : Text
)
->
    o_movement_id   : Id,
    o_stock_before  : NonNegativeInt,
    o_stock_after   : NonNegativeInt
```

`p_adjustment_type` únicamente:

```text
ADJUSTMENT_IN
ADJUSTMENT_OUT
```

No admite:

- ENTRY;
- SALE;
- CANCELLATION.

`ADJUSTMENT_OUT` nunca deja stock negativo.

---

## 18.5 `sp_inventory_set_minimum`

```text
sp_inventory_set_minimum(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_stock_minimum : NonNegativeInt
)
->
    o_stock_minimum : NonNegativeInt
```

No genera MovimientoInventario.

`0` significa:

```text
sin umbral de bajo stock
```

---

# 19. Database API — Carrito

## 19.1 `fn_cart_get`

```text
fn_cart_get(
    p_actor_user_id : Id
)
-> CartView
```

Actor ACTIVE CUSTOMER.

### Si existe Carrito ACTIVE

Devuelve:

```text
cart_id
state = ACTIVE
items[]
total_current
```

Cada item incluye:

```text
cart_item_id
edition_id
title
authors
sku
cover
quantity
current_price
current_subtotal
available
unavailability_reason?
```

### Si no existe Carrito ACTIVE

Devuelve conceptualmente:

```text
cart_id = null
state = null
items = []
total_current = 0
```

No crea un Carrito.

### Item inactivado

Si Libro o Edición pasó a INACTIVE:

- el item no se oculta;
- `available = false`;
- checkout lo rechazará.

---

## 19.2 `sp_cart_add_item`

```text
sp_cart_add_item(
    p_actor_user_id : Id,
    p_edition_id    : Id,
    p_quantity      : PositiveInt
)
->
    o_cart_id       : Id,
    o_cart_item_id  : Id,
    o_quantity      : PositiveInt
```

Flujo:

1. actor CUSTOMER ACTIVE;
2. obtiene/crea Carrito ACTIVE;
3. bloquea Carrito;
4. valida Libro ACTIVE;
5. valida Edicion ACTIVE;
6. valida stock actual;
7. inserta item o incrementa cantidad;
8. valida cantidad total <= stock actual.

No reserva stock.

Errores relevantes:

- P2041
- P2042
- P2043
- P3002
- P4004

---

## 19.3 `sp_cart_update_item`

```text
sp_cart_update_item(
    p_actor_user_id : Id,
    p_cart_item_id  : Id,
    p_quantity      : PositiveInt
)
->
    o_cart_id       : Id,
    o_cart_item_id  : Id,
    o_quantity      : PositiveInt
```

Reglas:

- item pertenece al Carrito ACTIVE del actor;
- cantidad > 0;
- cantidad <= stock actual;
- no reserva stock.

Si item ajeno/inexistente:

```text
P4003 CART_ITEM_NOT_FOUND
```

---

## 19.4 `sp_cart_remove_item`

```text
sp_cart_remove_item(
    p_actor_user_id : Id,
    p_cart_item_id  : Id
)
```

Reglas:

- solo Carrito ACTIVE propio;
- DELETE físico del item;
- si queda vacío, Carrito continúa ACTIVE.

---

# 20. Database API — Sales / Orders

## 20.1 `sp_checkout`

### Tipo

Procedure crítica.

### Casos de uso

- CU-SAL-01
- incluye CU-PAY-01

### Firma lógica

```text
sp_checkout(
    p_actor_user_id  : Id,
    p_address_id     : Id,
    p_payment_method : MetodoPago,
    p_payment_outcome: Code
)
->
    o_order_id       : Id,
    o_order_state    : EstadoPedido,
    o_payment_state  : EstadoPago,
    o_total          : MoneyUSD,
    o_payment_reference : Text?
```

### Precondiciones

- actor ACTIVE CUSTOMER;
- Dirección existe y pertenece al actor;
- Carrito ACTIVE;
- Carrito no vacío.

### Bloqueo

1. Carrito FOR UPDATE.
2. Dirección protegida contra DELETE durante snapshot.
3. Inventarios por `EdicionId ASC` FOR UPDATE.

### Revalidaciones

Para cada item:

```text
Libro ACTIVE
Edicion ACTIVE
Cantidad > 0
StockActual >= Cantidad
Precio actual > 0
```

### Snapshots

Cada PedidoItem copia:

- SKU;
- ISBN;
- título;
- autores en orden;
- editorial;
- formato;
- idioma;
- precio unitario;
- cantidad;
- subtotal.

PedidoDireccion copia:

- destinatario;
- dirección 1/2;
- ciudad;
- provincia;
- país;
- código postal;
- referencia;
- teléfono.

No copia Alias.

### Historial

Siempre crea:

```text
NULL -> PENDING_PAYMENT
Origen = SYSTEM
```

Luego, en la misma transacción:

#### APPROVED

```text
PENDING_PAYMENT -> CONFIRMED
Origen = SYSTEM
```

#### REJECTED

```text
PENDING_PAYMENT -> CANCELLED
Origen = SYSTEM
```

### APPROVED

- Pago APPROVED;
- Referencia obligatoria y única;
- un SALE por PedidoItem;
- stock descontado;
- Pedido CONFIRMED;
- Carrito CHECKED_OUT.

### REJECTED

- Pago REJECTED;
- Pedido CANCELLED;
- sin SALE;
- stock sin cambios;
- Carrito ACTIVE.

### Errores

Entre otros:

- P4001 CART_NOT_ACTIVE
- P4002 CART_EMPTY
- P5004 CHECKOUT_ADDRESS_INVALID
- P2042 EDITION_INACTIVE
- P2043 BOOK_INACTIVE
- P3002 INSUFFICIENT_STOCK
- P5005 PAYMENT_OUTCOME_INVALID

### Atomicidad

Cualquier error de dominio/técnico antes del resultado final provoca rollback total.

---

## 20.2 `fn_customer_orders`

```text
fn_customer_orders(
    p_actor_user_id : Id,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<CustomerOrderSummary>
```

Orden predeterminado:

```text
FechaCreacion DESC
```

Resultado:

```text
order_id
created_at
order_state
total
payment_state
total_count
```

Incluye pedidos:

- confirmados;
- en logística;
- entregados;
- cancelados por rechazo;
- cancelados posteriormente.

Nunca devuelve pedidos de otro Cliente.

---

## 20.3 `fn_customer_order_detail`

```text
fn_customer_order_detail(
    p_actor_user_id : Id,
    p_order_id      : Id
)
-> CustomerOrderDetail?
```

Resultado:

```text
order header
items snapshots
address snapshot
payment
state history
```

Pedido inexistente o ajeno:

```text
P5001 ORDER_NOT_FOUND
```

No se distingue externamente la existencia de un pedido ajeno.

---

## 20.4 `sp_order_cancel`

### Propósito

Única rutina pública propietaria de la transición hacia `CANCELLED` después de un pago aprobado.

### Firma

```text
sp_order_cancel(
    p_actor_user_id : Id,
    p_order_id      : Id
)
->
    o_order_id      : Id,
    o_previous_state: EstadoPedido,
    o_order_state   : EstadoPedido,
    o_payment_state : EstadoPago,
    o_restored_units: NonNegativeInt
```

### Actores admitidos

#### CUSTOMER

- debe ser propietario del Pedido.

#### ADMIN

- puede cancelar cualquier Pedido permitido.

### Estados de origen

```text
CONFIRMED
PREPARING
```

### Procedimiento

1. bloquear Pedido;
2. validar actor;
3. validar estado;
4. obtener PedidoItems;
5. bloquear Inventarios por EdicionId ASC;
6. verificar que exista SALE previo por cada item;
7. restaurar stock;
8. crear CANCELLATION por item;
9. Pago APPROVED -> REFUNDED;
10. Pedido -> CANCELLED;
11. crear historial:
    - Origen USER;
    - UsuarioActorId = actor;
12. confirmar.

### Defensa contra duplicado

Para cada Edición:

```text
máximo 1 CANCELLATION por Pedido
```

### Errores

- P5001 ORDER_NOT_FOUND
- P5003 ORDER_NOT_CANCELLABLE
- P3005 STOCK_MOVEMENT_DUPLICATE
- P3006 SALE_REQUIRED_FOR_CANCELLATION
- P5006 PAYMENT_STATE_INVALID

---

## 20.5 `fn_admin_orders`

```text
fn_admin_orders(
    p_actor_user_id : Id,
    p_state         : EstadoPedido?,
    p_date_from     : Instant?,
    p_date_to       : Instant?,
    p_customer_id   : Id?,
    p_page          : NonNegativeInt,
    p_page_size     : PositiveInt
)
-> RecordSet<AdminOrderSummary>
```

Actor ADMIN.

Orden predeterminado:

```text
FechaCreacion DESC
```

---

## 20.6 `fn_admin_order_detail`

```text
fn_admin_order_detail(
    p_actor_user_id : Id,
    p_order_id      : Id
)
-> AdminOrderDetail?
```

Incluye:

- Cliente básico;
- Pedido;
- snapshots;
- Pago;
- historial;
- movimientos SALE/CANCELLATION asociados.

---

## 20.7 `sp_order_change_status`

### Propósito

Avance logístico únicamente.

### Firma

```text
sp_order_change_status(
    p_actor_user_id : Id,
    p_order_id      : Id,
    p_new_state     : EstadoPedido
)
->
    o_order_id      : Id,
    o_previous_state: EstadoPedido,
    o_order_state   : EstadoPedido
```

### Actor

ADMIN ACTIVE.

### Transiciones permitidas

```text
CONFIRMED -> PREPARING
PREPARING -> SHIPPED
SHIPPED -> DELIVERED
```

### Prohibición explícita

No admite:

```text
CANCELLED
```

Para cancelar se utiliza exclusivamente:

```text
sp_order_cancel
```

### Historial

Cada éxito añade:

```text
Origen = USER
UsuarioActorId = p_actor_user_id
```

### Errores

- P5001
- P5002

---

# 21. Database API — Pago

PLIEGO v1 **no expone Procedures públicas específicas de Pago**.

Justificación:

- `PENDING -> APPROVED/REJECTED` pertenece a `sp_checkout`;
- `APPROVED -> REFUNDED` pertenece a `sp_order_cancel`;
- ningún caso de uso permite alterar Pago de forma independiente.

Esta decisión evita un segundo escritor de la máquina de estados de Pago.

Las operaciones de Pago internas de PostgreSQL no forman parte del contrato Java.

---

# 22. Matriz actor → rutinas

| Grupo | Público | CUSTOMER | ADMIN |
|---|---:|---:|---:|
| Registro | Sí | — | — |
| Auth data | Sí | — | — |
| Catálogo público | Sí | Sí | Sí |
| Perfil Cliente | — | Sí | — |
| Direcciones | — | Sí | — |
| Admin clientes | — | — | Sí |
| Admin catálogo | — | — | Sí |
| Inventario | — | — | Sí |
| Carrito | — | Sí | — |
| Checkout | — | Sí | — |
| Pedidos propios | — | Sí | — |
| Cancelar pedido propio | — | Sí | — |
| Cancelar pedido administrativo | — | — | Sí |
| Gestión logística | — | — | Sí |

---

# 23. Matriz caso de uso → Database API

| Caso de uso | Rutina(s) pública(s) |
|---|---|
| CU-AUTH-01 | `sp_customer_register` |
| CU-AUTH-02 | `fn_user_auth_data` |
| CU-ADM-SEC-01 | `fn_admin_customer_search`, `sp_customer_set_status` |
| CU-CUS-01 | `fn_customer_profile`, `sp_customer_update` |
| CU-CUS-02 | `fn_address_list`, `sp_address_create`, `sp_address_update`, `sp_address_delete`, `sp_address_set_primary` |
| CU-CAT-01 | `fn_catalog_search` |
| CU-CAT-02 | `fn_edition_detail` |
| CU-ADM-CAT-01 | `fn_admin_author_search`, `sp_author_create`, `sp_author_update`, `sp_author_set_status` |
| CU-ADM-CAT-02 | `fn_admin_publisher_search`, `sp_publisher_create`, `sp_publisher_update`, `sp_publisher_set_status` |
| CU-ADM-CAT-03 | `fn_admin_category_search`, `sp_category_create`, `sp_category_update`, `sp_category_set_status` |
| CU-ADM-CAT-04 | `fn_admin_book_search`, `sp_book_create`, `sp_book_update`, `sp_book_set_status` |
| CU-ADM-CAT-05 | `fn_admin_edition_search`, `sp_edition_create`, `sp_edition_update`, `sp_edition_set_status` |
| CU-INV-01 | `fn_inventory_search`, `fn_inventory_movements` |
| CU-INV-02 | `sp_inventory_entry`, `sp_inventory_adjust` |
| CU-INV-03 | `sp_inventory_set_minimum` |
| CU-CART-01 | `fn_cart_get` |
| CU-CART-02 | `sp_cart_add_item` |
| CU-CART-03 | `sp_cart_update_item` |
| CU-CART-04 | `sp_cart_remove_item` |
| CU-SAL-01 | `sp_checkout` |
| CU-PAY-01 | Interno a `sp_checkout`; sin rutina pública independiente |
| CU-SAL-02 | `fn_customer_orders`, `fn_customer_order_detail` |
| CU-SAL-03 | `sp_order_cancel` |
| CU-ADM-SAL-01 | `fn_admin_orders`, `fn_admin_order_detail`, `sp_order_change_status`, `sp_order_cancel` |

Todos los 24 casos de uso tienen cobertura de Database API.

---

# 24. Matriz de rutinas → entidades

| Rutina / grupo | Lee | Escribe |
|---|---|---|
| `sp_customer_register` | Usuario | Usuario, Cliente |
| `fn_user_auth_data` | Usuario | — |
| `fn_admin_customer_search` | Usuario, Cliente | — |
| `sp_customer_set_status` | Usuario, Cliente | Usuario |
| `fn_customer_profile` | Usuario, Cliente | — |
| `sp_customer_update` | Usuario, Cliente | Cliente |
| Address API | Usuario, Cliente, Direccion | Direccion |
| `fn_catalog_search` | Libro, Autor, LibroAutor, Categoria, LibroCategoria, Editorial, Edicion, Inventario | — |
| `fn_edition_detail` | catálogo + Inventario | — |
| Admin Author | Usuario, Autor | Autor |
| Admin Publisher | Usuario, Editorial | Editorial |
| Admin Category | Usuario, Categoria | Categoria |
| Admin Book | Usuario, Libro, Autor, LibroAutor, Categoria, LibroCategoria | Libro, LibroAutor, LibroCategoria |
| Admin Edition | Usuario, Libro, Editorial, Edicion, Inventario | Edicion, Inventario al crear |
| Inventory query | Usuario, Libro, Edicion, Inventario, MovimientoInventario | — |
| Inventory commands | Usuario, Inventario | Inventario, MovimientoInventario |
| Cart query | Usuario, Cliente, Carrito, CarritoItem, Libro, Edicion, Inventario | — |
| Cart commands | Usuario, Cliente, Carrito, CarritoItem, Libro, Edicion, Inventario | Carrito, CarritoItem |
| `sp_checkout` | Usuario, Cliente, Direccion, Carrito, CarritoItem, Libro, Edicion, Editorial, Autor, LibroAutor, Inventario | Pedido, PedidoItem, PedidoDireccion, Pago, PedidoEstadoHistorial, Inventario, MovimientoInventario, Carrito |
| Order queries | Pedido y dependencias | — |
| `sp_order_cancel` | Usuario, Pedido, PedidoItem, Pago, Inventario, MovimientoInventario | Pedido, Pago, Inventario, MovimientoInventario, PedidoEstadoHistorial |
| `sp_order_change_status` | Usuario, Pedido | Pedido, PedidoEstadoHistorial |

---

# 25. Invariantes por técnica preferida

La técnica definitiva se fijará en el Modelo Físico, pero este contrato asigna responsabilidad.

## 25.1 Constraints

Preferidos para:

- PK;
- FK;
- NOT NULL;
- unicidad;
- cantidades positivas;
- stock no negativo;
- precios/montos positivos;
- valores de dominio simples.

## 25.2 Procedures

Autoridad para:

- reglas multi-entidad;
- ownership;
- estados;
- carrito;
- checkout;
- inventario;
- cancelación;
- snapshots;
- creación atómica de Edicion + Inventario;
- reemplazo de asociaciones de Libro.

## 25.3 Functions

Autoridad para:

- búsqueda;
- vistas compuestas;
- cálculos de lectura;
- disponibilidad;
- totales de visualización.

## 25.4 Triggers

Solo se utilizarán cuando aporten una garantía transversal clara.

Candidatos aceptables:

- `FechaActualizacion`;
- protección de invariantes imposibles de expresar mediante CHECK;
- protección de estructuras append-only si el modelo físico la considera necesaria.

No se utilizarán cadenas complejas de triggers para implementar checkout o cancelación.

---

# 26. Reglas de implementación Java

## 26.1 Gateway

Cada módulo Java tendrá Gateways específicos.

Ejemplos:

```text
CustomerDbGateway
CatalogDbGateway
InventoryDbGateway
CartDbGateway
OrderDbGateway
```

## 26.2 Permitido

- `SimpleJdbcCall`;
- `CallableStatement`;
- infraestructura equivalente para invocar Functions/Procedures;
- mapping de resultados a records/DTOs Java;
- traducción de SQLSTATE a excepciones de aplicación.

## 26.3 Prohibido

- `JpaRepository`;
- `EntityManager`;
- entidades JPA;
- Hibernate;
- SQL contra tablas;
- lógica de joins en Java;
- recalcular reglas de negocio como autoridad;
- `float`/`double`/`Float`/`Double` para dinero (usar `java.math.BigDecimal` ↔ `NUMERIC`).

## 26.4 Transaction boundary

Las operaciones de comando deben ejecutarse con demarcación transaccional Spring.

Una operación de negocio pública debe realizar una sola llamada Database API.

---

# 27. Traducción de errores en Java

Se implementará un componente único, conceptualmente:

```text
DatabaseExceptionTranslator
```

Responsabilidad:

```text
SQLException
   ↓
SQLSTATE
   ↓
Domain/Application Exception
```

Ejemplo:

```text
P3002
   ↓
InsufficientStockException
```

Controllers no deben inspeccionar directamente SQLException.

Un `23514 CHECK_VIOLATION` que llegue al Gateway se traduce a `DatabaseContractViolationException` (fallo técnico / HTTP 500). No se traduce automáticamente a `P1001` para no ocultar bugs internos.

El mapeo final a HTTP pertenece al REST API Contract.

---

# 28. Observabilidad mínima

Cada Gateway debe registrar de forma segura:

- nombre de rutina;
- duración;
- éxito/fallo;
- SQLSTATE cuando falle;
- correlation/request ID si existe.

No debe registrar:

- PasswordHash;
- contraseña;
- datos completos de dirección sin necesidad;
- datos sensibles inexistentes de tarjeta.

No se requiere infraestructura adicional.

---

# 29. Reglas de evolución del contrato

## 29.1 Cambio compatible

Ejemplos:

- agregar un campo de salida opcional;
- agregar Function administrativa nueva;
- optimizar implementación interna.

Puede mantenerse versión 1.x.

## 29.2 Cambio incompatible

Ejemplos:

- eliminar parámetro obligatorio;
- cambiar significado de un parámetro;
- cambiar regla de atomicidad;
- cambiar máquina de estados;
- cambiar cardinalidad persistente.

Requiere:

1. gestión de cambio;
2. revisión de UCB/DER/DD;
3. nueva versión de contrato;
4. migración compatible.

## 29.3 Rutinas internas

Pueden cambiar libremente si preservan el contrato observable de las rutinas públicas.

---

# 30. Criterios mínimos de prueba por rutina

## 30.1 Functions

Cada Function debe probar:

- resultado esperado;
- filtros;
- paginación;
- vacío;
- actor inválido cuando aplique;
- ownership cuando aplique.

## 30.2 Procedures CRUD

Deben probar:

- éxito;
- entidad inexistente;
- actor incorrecto;
- datos inválidos;
- unicidad;
- rollback.

## 30.3 Inventario

Debe probar:

- entrada;
- ajuste in;
- ajuste out;
- stock insuficiente;
- movimiento creado;
- concurrencia.

## 30.4 Carrito

Debe probar:

- creación implícita del carrito;
- item nuevo;
- incremento del mismo item;
- cantidad inválida;
- stock insuficiente;
- item inactivado;
- ownership;
- dos solicitudes concurrentes de creación de carrito.

## 30.5 Checkout

Obligatorio probar:

1. APPROVED;
2. REJECTED;
3. carrito vacío;
4. edición inactiva;
5. libro inactivo;
6. dirección inexistente;
7. dirección ajena;
8. stock insuficiente;
9. precio vigente usado;
10. snapshots correctos;
11. dos historiales;
12. SALE por item solo en APPROVED;
13. Carrito CHECKED_OUT solo en APPROVED;
14. concurrencia por última unidad;
15. rollback ante fallo técnico.

## 30.6 Cancelación

Obligatorio probar:

- CUSTOMER propietario;
- CUSTOMER ajeno;
- ADMIN;
- CONFIRMED;
- PREPARING;
- SHIPPED rechazado;
- DELIVERED rechazado;
- restauración exacta;
- un CANCELLATION por item;
- REFUNDED;
- segundo intento no duplica stock.

---

# 31. Pruebas de concurrencia obligatorias

## 31.1 Última unidad

```text
Stock = 1

Checkout A: cantidad 1
Checkout B: cantidad 1
```

Resultado requerido:

```text
exactamente uno CONFIRMED
el otro -> P3002 INSUFFICIENT_STOCK
Stock final = 0
```

Nunca:

```text
Stock < 0
```

## 31.2 Dos altas de carrito

Dos llamadas concurrentes de `sp_cart_add_item` para Cliente sin Carrito.

Resultado:

```text
exactamente un Carrito ACTIVE
```

## 31.3 Doble cancelación

Dos llamadas concurrentes de `sp_order_cancel`.

Resultado:

```text
stock restaurado una sola vez
un CANCELLATION por Edición
```

## 31.4 Ajustes concurrentes

Dos ajustes sobre el mismo Inventario deben serializarse y cada Movimiento debe reflejar un par correcto:

```text
StockAnterior -> StockPosterior
```

---

# 32. Reglas que el Modelo Físico deberá resolver

El siguiente artefacto debe convertir este contrato a decisiones PostgreSQL concretas.

Debe fijar:

1. tipos de ID;
2. tipos de dinero;
3. representación de dominios;
4. tipo físico de LanguageCode 2/3;
5. arrays/JSON/composite types para colecciones de entrada;
6. representación de resultados compuestos;
7. índices;
8. índices parciales;
9. constraints;
10. FKs y `ON DELETE`;
11. timestamps;
12. naming físico;
13. procedimiento para unicidad de dirección principal;
14. máximo un Carrito ACTIVE;
15. unicidad condicional ISBN;
16. unicidad condicional Pago.Referencia;
17. unicidad SALE/CANCELLATION;
18. locks concretos;
19. funciones auxiliares;
20. triggers mínimos;
21. Flyway layout.

---

# 33. Decisiones explícitamente no tomadas aquí

Este contrato no determina todavía:

- `BIGINT` versus UUID;
- `VARCHAR(n)` exacto;
- PostgreSQL ENUM versus CHECK;
- JSONB versus arrays/composite types para listas;
- implementación exacta de búsqueda textual;
- índices trigram/full-text;
- nombres físicos de constraints;
- detalles OpenAPI;
- expiración/claims del JWT;
- algoritmos exactos de password hashing;
- CORS;
- frontend.

---

# 34. Validación de completitud

| Pregunta | Resultado |
|---|---|
| ¿Los 24 casos de uso tienen Database API? | Sí |
| ¿Las consultas administrativas faltantes fueron cubiertas? | Sí |
| ¿Existe un único escritor público de CANCELLED post-pago? | Sí: `sp_order_cancel` |
| ¿Existe un único escritor público del avance logístico? | Sí: `sp_order_change_status` |
| ¿Pago tiene writers públicos independientes? | No |
| ¿Checkout es una sola llamada? | Sí |
| ¿Las reglas de stock permanecen en PostgreSQL? | Sí |
| ¿Se define locking determinista? | Sí |
| ¿Pago simulado es determinista? | Sí |
| ¿Se diferencia rechazo comercial de fallo técnico? | Sí |
| ¿Los errores tienen contrato estable? | Sí |
| ¿Java necesita SQL de negocio contra tablas? | No |
| ¿Se requiere SECURITY DEFINER? | No |
| ¿Se incorporaron nuevas entidades? | No |
| ¿Se introdujo frontend? | No |
| ¿Quedan decisiones estructurales críticas TBD? | No |

---

# 35. Definition of Ready para Modelo Físico

El Modelo Físico PostgreSQL puede comenzar cuando este contrato sea aprobado.

Debe recibir como entradas:

```text
UCB v1.1
DER v1.1
DD v1.1
Database API Contract v1.0
```

No podrá alterar silenciosamente:

- firma semántica de rutinas;
- máquinas de estado;
- errores;
- ownership;
- locking lógico;
- atomicidad;
- resultados comerciales.

Si una limitación física exige cambiar estos puntos, se debe volver a este contrato mediante gestión de cambio.

---

# 36. Correcciones menores recomendadas a artefactos previos

Antes o durante la aprobación formal de este contrato se recomienda aplicar dos erratas editoriales:

### DD v1.1

Cambiar:

```text
Edicion.Idioma — Código idioma; 2 caracteres
```

por:

```text
Edicion.Idioma — LanguageCode; 2 o 3 caracteres
```

de acuerdo con §5.5.

### DER v1.1

Cambiar en §30:

```text
queda como candidato a baseline
```

por:

```text
permanece como BASELINE APROBADA
```

Estas correcciones no justifican versión mayor ni modifican comportamiento.

---

# 37. Historial del documento

| Versión | Fecha | Estado | Descripción |
|---|---|---|---|
| 1.0 | 2026-09-23 | CANDIDATO A BASELINE | Primer contrato formal de Database API. Audita UCB/DER/DD v1.1, fija autoridad Spring↔PostgreSQL, Procedures/Functions públicas, transacciones, locking, SQLSTATE, simulador de pago y trazabilidad completa a casos de uso. |
| 1.1 | 2026-09-23 | BASELINE APROBADA | Absorbe B1–B9: matriz rutina→SQLSTATE (§10.4), mapa de normalización obligatorio, blanket explícito para bloqueados, slug desconocido → vacío, update revalida create, BigDecimal, SIM-UUID y REJECTED NULL, retry diferido al REST, carrera de bloqueo aceptada, default TITLE_ASC. Añade P9001 técnico y política 23514. |

---

# 38. Referencias

## Artefactos PLIEGO

- `docs/requirements/use-case-baseline-v1.0.md` — versión interna 1.1.
- `docs/domain/logical-erd-v1.0.md` — versión interna 1.1.
- `docs/domain/data-dictionary-v1.0.md` — versión interna 1.1.

## Referencias técnicas

- PostgreSQL 18 — PL/pgSQL Errors and Messages (`RAISE`, SQLSTATE).
- PostgreSQL 18 — PL/pgSQL Transaction Management.
- PostgreSQL 18 — Data Consistency Checks at the Application Level / row locking.
- PostgreSQL 18 — `CREATE PROCEDURE`.
- Arquitectura aprobada de PLIEGO: Java 25 + Spring Boot + PostgreSQL + Flyway; sin ORM; lógica de negocio autoritativa en PostgreSQL; frontend posterior.
