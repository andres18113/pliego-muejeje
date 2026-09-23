# PLIEGO — Diccionario de Datos v1.0

**Documento:** DD-PLIEGO-001  
**Versión:** 1.1  
**Estado:** BASELINE APROBADA  
**Fecha:** 2026-09-23  
**Proyecto:** PLIEGO  
**Tipo de documento:** Diccionario de datos lógico y especificación semántica de atributos  
**Documentos fuente:**

- `docs/requirements/use-case-baseline-v1.0.md`
- `docs/domain/logical-erd-v1.0.md`

**Ámbito:** Dominio persistente de PLIEGO v1  
**Siguiente artefacto:** Database API Contract v1.0 / Modelo físico PostgreSQL

---

# 1. Propósito

Este documento fija el significado, dominio, obligatoriedad, mutabilidad, sensibilidad y reglas de validación de los datos persistentes de **PLIEGO v1**.

El Diccionario de Datos constituye la tercera fuente estructural del diseño, después de la *Use Case Baseline v1.0* y del *DER Lógico v1.0*. Su función es eliminar ambigüedades antes de seleccionar tipos físicos de PostgreSQL y antes de definir Stored Procedures, Functions, Triggers, Constraints e índices.

Este documento deberá permitir que dos implementadores distintos construyan el mismo modelo físico sin tener que reinterpretar:

- qué significa cada atributo;
- cuándo puede ser nulo;
- cuál es su fuente de verdad;
- qué valores son válidos;
- qué datos son históricos;
- qué datos pueden modificarse;
- qué valores deben ser únicos;
- qué campos son derivados;
- qué reglas requieren validación inter-entidad.

---

# 2. Metodología de derivación

El diccionario se obtiene mediante:

```text
Use Case Baseline v1.0
        ↓
DER Lógico v1.0
        ↓
Auditoría de consistencia
        ↓
Resolución de defectos
        ↓
Definición semántica de datos
        ↓
Diccionario de Datos v1.0
```

Se aplican los siguientes principios de Ingeniería de Software:

1. **Trazabilidad:** todo atributo debe justificar su existencia por una necesidad del dominio, una regla o un caso de uso.
2. **Unicidad semántica:** un mismo concepto mutable no debe tener dos fuentes autoritativas.
3. **Normalización:** los datos maestros permanecen normalizados; solo se permiten snapshots históricos expresamente justificados.
4. **Verificabilidad:** toda regla de atributo debe poder convertirse posteriormente en una prueba o constraint.
5. **Mínima complejidad suficiente:** no se agregan catálogos o entidades que PLIEGO v1 no necesita.
6. **Historia estable:** los hechos comerciales confirmados no se reescriben a partir de datos maestros actuales.
7. **Separación lógica/física:** todavía no se fijan `BIGINT`, `VARCHAR`, `NUMERIC`, `TIMESTAMPTZ`, índices ni sintaxis PostgreSQL definitiva.

---

# 3. Resultado de la auditoría de consistencia

Antes de definir los atributos se auditó la coherencia entre la Use Case Baseline y el DER lógico. Se encontraron los siguientes defectos, omisiones o ambigüedades.

## 3.1 Correcciones normativas

| ID | Hallazgo | Resolución para PLIEGO v1 | Impacto |
|---|---|---|---|
| DD-COR-001 | `Direccion` y `PedidoDireccion` no identificaban país. Esto deja ambiguo el significado de provincia/ciudad y limita evolución futura. | Se incorpora `PaisCodigo` obligatorio en ambas entidades, usando código ISO de país. | DER lógico deberá reflejar el atributo en su siguiente revisión. |
| DD-COR-002 | `PedidoItem` preservaba formato, ISBN y editorial, pero no el idioma de la Edición aunque `Edicion.Idioma` puede corregirse. | Se incorpora `IdiomaSnapshot` obligatorio. | DER lógico deberá reflejar el atributo. |
| DD-COR-003 | `Carrito.CANCELLED` estaba modelado aunque ningún caso de uso v1 produce ese estado y la propia baseline lo reservaba para futuro. | Se elimina `CANCELLED` del dominio de Carrito v1. Estados: `ACTIVE`, `CHECKED_OUT`. | Corrección de UCB/DER en siguiente revisión. Reduce estado muerto. |
| DD-COR-004 | DER permitía `Pedido.Subtotal >= 0` y `Pago.Monto >= 0`, pero todo Pedido tiene al menos un item, con cantidad y precio positivos. | `Pedido.Subtotal > 0`, `Pedido.Total > 0` y `Pago.Monto > 0`. | Corrige invariantes numéricas. |
| DD-COR-005 | No se declaró unicidad de una Edición dentro de Pedido, aunque Pedido se deriva de un Carrito donde la Edición es única. | `PedidoId + EdicionId` es clave alternativa en `PedidoItem`. | Evita líneas duplicadas para la misma edición. |
| DD-COR-006 | La relación Pedido–Pago estaba definida, pero no la compatibilidad completa de sus estados. | Se fija una matriz válida Pedido/Pago. | Regla inter-entidad obligatoria. |
| DD-COR-007 | `MovimientoInventario` no fijaba protección contra duplicar `SALE` o `CANCELLATION` de la misma Edición en un Pedido. | Para movimientos de Pedido, `(PedidoId, EdicionId, Tipo)` debe ser único. | Refuerza trazabilidad e idempotencia lógica. |
| DD-COR-008 | `MovimientoInventario.Motivo` era ambiguo para movimientos administrativos. | `Motivo` es obligatorio en `ENTRY`, `ADJUSTMENT_IN` y `ADJUSTMENT_OUT`; no es obligatorio en movimientos automáticos. | Mejora auditoría. |
| DD-COR-009 | No estaba definida la semántica de entidades maestras inactivas ya relacionadas. | Inactivar Autor/Editorial/Categoría impide nuevas asociaciones, pero no borra ni oculta automáticamente relaciones históricas existentes. | Evita efectos cascada no deseados. |
| DD-COR-010 | No se había definido normalización de email, SKU y códigos. | Se fijan representaciones canónicas lógicas. | Elimina ambigüedad de unicidad. |
| DD-COR-011 | `Pago.Referencia` carecía de semántica de duplicados. | Si existe, debe identificar de forma única el resultado de pago simulado. | Añade clave alternativa condicional. |
| DD-COR-012 | `AutoresSnapshot` podía interpretarse como lista multivaluada no atómica. | Se define como **cadena de presentación histórica atómica**, construida en orden de autoría y separada de forma determinista. | Mantiene la excepción histórica compatible con el modelo relacional. |

Estas correcciones no amplían el alcance funcional del proyecto; cierran ambigüedades necesarias para que el modelo físico pueda derivarse sin interpretación adicional.

## 3.2 Decisiones revisadas y mantenidas

Los siguientes puntos fueron revisados y **no se consideran defectos**:

- `Autor.Nombre` no es único: dos autores reales pueden compartir nombre.
- `Libro.Titulo` no es único: distintas obras o versiones bibliográficas pueden compartir título.
- `Editorial.Nombre` no se declara único en el modelo lógico; la identidad oficial de una editorial no debe inferirse exclusivamente de su nombre.
- `Carrito` no reserva stock: la disponibilidad se revalida en checkout.
- Pedido no requiere FK a Carrito: un intento rechazado puede dejar el Carrito activo para un nuevo checkout.
- `PedidoDireccion` no referencia la Dirección original: el snapshot debe ser independiente.
- `PedidoItem` conserva FK histórica a Edición porque Edición no se elimina físicamente.
- La moneda no requiere entidad propia en v1 porque todo el sistema opera en USD.

---

# 4. Convenciones del diccionario

## 4.1 Obligatoriedad

- **M:** obligatorio; no puede carecer de valor.
- **O:** opcional; puede estar ausente.
- **C:** condicional; obligatorio únicamente cuando se cumple una condición especificada.
- **D:** derivado; se obtiene de otros datos y no es fuente primaria de verdad.

## 4.2 Mutabilidad

- **I:** inmutable después de creada la entidad.
- **M:** mutable mediante un caso de uso autorizado.
- **R:** mutable de forma restringida por máquina de estados o procedimiento específico.
- **S:** administrado automáticamente por el sistema.
- **A:** append-only; una vez creado no se modifica ni elimina.
- **D:** derivado; no se actualiza de manera independiente.

## 4.3 Clasificación de sensibilidad

- **PUB:** dato público de catálogo.
- **INT:** dato interno no sensible.
- **PER:** dato personal del Cliente.
- **AUT:** credencial o material de autenticación sensible.
- **COM:** dato histórico/comercial interno.

La clasificación orienta exposición en APIs y logs; no constituye todavía un modelo completo de seguridad.

## 4.4 Dominios lógicos de tipo

| Dominio lógico | Significado |
|---|---|
| Identificador | Identidad interna sin significado comercial |
| Texto corto | Cadena breve controlada |
| Texto medio | Cadena descriptiva moderada |
| Texto largo | Texto narrativo |
| Código | Valor canónico de conjunto controlado |
| Email | Dirección de correo normalizada |
| Teléfono | Número de contacto representado como texto canónico |
| Entero no negativo | 0 o mayor |
| Entero positivo | 1 o mayor |
| Importe USD | Valor monetario decimal exacto con máximo 2 decimales |
| Booleano | verdadero/falso |
| Fecha | Fecha civil sin hora |
| Instante | Fecha y hora absoluta de evento; semánticamente UTC |
| URL/URI | Referencia a recurso externo o servido por la aplicación |

No se deducen todavía tipos PostgreSQL de estos dominios.

---

# 5. Reglas globales de representación

## 5.1 Strings

- Los valores obligatorios no pueden ser `null`, vacíos ni contener únicamente espacios.
- Los valores de entrada deben eliminar espacios exteriores antes de persistirse.
- Para campos opcionales, una cadena vacía se interpreta como ausencia y debe normalizarse a `null`.
- Los textos de presentación conservan mayúsculas/minúsculas del usuario salvo campos con representación canónica.

## 5.2 Email

`EmailNormalizado` se obtiene mediante:

1. eliminación de espacios exteriores;
2. conversión a minúsculas.

No se intentará reescribir semánticamente el dominio ni la parte local más allá de esta normalización en v1.

Ejemplo:

```text
Entrada:  Usuario@Ejemplo.COM
Canon:    usuario@ejemplo.com
```

## 5.3 SKU

Representación canónica:

- sin espacios exteriores;
- mayúsculas;
- longitud conceptual: 1–64 caracteres;
- caracteres permitidos: letras ASCII, dígitos, punto, guion y guion bajo;
- debe iniciar con letra o dígito.

Ejemplo válido:

```text
PLG-LIT-000042
```

## 5.4 ISBN-13

Cuando exista:

- exactamente 13 dígitos;
- se conserva como texto para no perder ceros iniciales;
- debe superar el checksum ISBN-13;
- es único globalmente entre Ediciones.

## 5.5 Idioma

Se representa mediante código ISO 639-1 en minúsculas; si el idioma carece de código 639-1, se usa ISO 639-2/T en minúsculas.

Ejemplos:

```text
es
en
fr
```

## 5.6 País

`PaisCodigo` usa código ISO 3166-1 alpha-2 en mayúsculas. La lista válida es cerrada y vive en el constraint/check del modelo físico; ampliarla requiere cambio formal.

Ejemplos:

```text
EC
CO
PE
```

## 5.7 Dinero

- PLIEGO v1 opera en USD.
- Los importes son decimales exactos.
- Máximo dos posiciones decimales.
- No se utilizan `float`/`double` como fuente monetaria.

## 5.8 Timestamps

Todos los atributos `FechaCreacion`, `FechaActualizacion` y fechas de eventos representan un instante absoluto.

Semánticamente se manejan en UTC; conversión a zona horaria de interfaz es responsabilidad de la capa de presentación futura.

## 5.9 Fechas civiles

`FechaPublicacion` representa una fecha editorial, no un instante. No se aplica conversión de zona horaria.

## 5.10 Teléfono

Representación canónica:

1. eliminar espacios exteriores y separadores de presentación (`espacios`, `-`, `.`, `(`, `)`);
2. conservar `+` inicial cuando corresponda;
3. conservar el resto como dígitos.

Ejemplo:

```text
Entrada:  +593 (2) 555-0134
Canon:    +59325550134
```

El teléfono es dato de contacto, no clave de identidad: no impone unicidad.

---

# 6. Dominios controlados

## 6.1 UsuarioRol

```text
CUSTOMER
ADMIN
```

## 6.2 UsuarioEstado

```text
ACTIVE
BLOCKED
```

## 6.3 EstadoCatalogo

Aplica a Autor, Editorial, Categoria, Libro y Edicion.

```text
ACTIVE
INACTIVE
```

## 6.4 FormatoEdicion

```text
PAPERBACK
HARDCOVER
```

## 6.5 LicenciaPortada

PLIEGO v1 admite portadas cuya reutilización esté documentada mediante uno de los siguientes códigos:

```text
PUBLIC_DOMAIN
CC0
CC_BY
CC_BY_SA
OWNED
```

No se incorporan licencias incompatibles con el uso previsto del e-commerce sin modificar previamente este dominio y revisar sus condiciones.

## 6.6 TipoMovimientoInventario

```text
ENTRY
ADJUSTMENT_IN
ADJUSTMENT_OUT
SALE
CANCELLATION
```

## 6.7 EstadoCarrito

**Corrección DD-COR-003:**

```text
ACTIVE
CHECKED_OUT
```

`CANCELLED` queda fuera de PLIEGO v1 porque no existe caso de uso que lo produzca.

## 6.8 EstadoPedido

```text
PENDING_PAYMENT
CONFIRMED
PREPARING
SHIPPED
DELIVERED
CANCELLED
```

## 6.9 MetodoPago

```text
CARD
TRANSFER
```

## 6.10 EstadoPago

```text
PENDING
APPROVED
REJECTED
REFUNDED
```

## 6.11 OrigenTransicionPedido

```text
USER
SYSTEM
```

---

# 7. Entidad Usuario

## 7.1 Definición

Identidad autenticable dentro de PLIEGO.

## 7.2 Claves

- PK lógica: `UsuarioId`.
- AK: `EmailNormalizado`.

## 7.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| UsuarioId | M | Identificador | I | INT | Identificador interno. No posee significado de negocio. |
| EmailNormalizado | M | Email; 3–254 caracteres | I v1 | PER | Identidad de acceso. Debe ser única tras normalización trim + lowercase. No existe cambio de email en v1. |
| PasswordHash | M | Texto técnico no vacío | I v1 | AUT | Resultado de algoritmo de password hashing administrado por Spring Security. Nunca contiene password en claro. No se expone en APIs. |
| Rol | M | UsuarioRol | I | INT | Define `CUSTOMER` o `ADMIN`. No existe cambio de rol en v1. |
| Estado | M | UsuarioEstado | R | INT | `ACTIVE` al crear; ADMIN puede alternar Cliente entre `ACTIVE` y `BLOCKED`. |
| FechaCreacion | M | Instante | S | INT | Momento en que se creó el Usuario. Inmutable. |
| FechaActualizacion | M | Instante | S | INT | Momento del último cambio persistente del Usuario. |

## 7.4 Invariantes

- `EmailNormalizado` único.
- Usuario `CUSTOMER` debe tener exactamente un Cliente.
- Usuario `ADMIN` no posee Cliente en PLIEGO v1.
- `BLOCKED` impide autenticación, pero no elimina historia comercial.

---

# 8. Entidad Cliente

## 8.1 Definición

Perfil comercial de un Usuario con rol `CUSTOMER`.

## 8.2 Claves

- PK: `ClienteId`.
- AK: `UsuarioId`.

## 8.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| ClienteId | M | Identificador | I | INT | Identificador interno del perfil. |
| UsuarioId | M | FK Usuario | I | INT | Debe apuntar a Usuario con rol `CUSTOMER`. Único. |
| Nombres | M | Texto corto; 1–120 | M | PER | Nombres del Cliente. No puede quedar en blanco. |
| Apellidos | M | Texto corto; 1–120 | M | PER | Apellidos del Cliente. No puede quedar en blanco. |
| Telefono | O | Teléfono; 7–20 | M | PER | Contacto general. Si existe, se normaliza eliminando separadores de presentación no significativos y conservando `+` inicial cuando corresponda. |
| FechaCreacion | M | Instante | S | INT | Creación del perfil. |
| FechaActualizacion | M | Instante | S | INT | Última actualización del perfil. |

## 8.4 Invariantes

- `UsuarioId` no puede compartirse entre Clientes.
- Los nombres y apellidos son datos de presentación, no claves de identidad.

---

# 9. Entidad Direccion

## 9.1 Definición

Dirección reutilizable registrada por un Cliente para seleccionar durante checkout.

## 9.2 Claves

- PK: `DireccionId`.

## 9.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| DireccionId | M | Identificador | I | INT | Identificador interno. |
| ClienteId | M | FK Cliente | I | INT | Propietario de la Dirección. |
| Alias | M | Texto corto; 1–80 | M | PER | Etiqueta de conveniencia, p. ej. `Casa` o `Trabajo`. No es única. |
| Destinatario | M | Texto corto; 1–200 | M | PER | Persona que recibirá el pedido. |
| DireccionLinea1 | M | Texto medio; 1–200 | M | PER | Dirección principal de entrega. |
| DireccionLinea2 | O | Texto medio; máx. 200 | M | PER | Complemento de dirección. |
| Ciudad | M | Texto corto; 1–100 | M | PER | Ciudad/localidad. |
| Provincia | M | Texto corto; 1–100 | M | PER | Provincia/estado/región administrativa. |
| PaisCodigo | M | Código ISO país; 2 caracteres | M | PER | **Incorporado por DD-COR-001.** Código ISO 3166-1 alpha-2. |
| CodigoPostal | O | Texto corto; máx. 20 | M | PER | Código postal cuando aplique. Se trata como texto. |
| Referencia | O | Texto medio; máx. 300 | M | PER | Indicaciones adicionales para localizar la dirección. |
| Telefono | M | Teléfono; 7–20 | M | PER | Teléfono de contacto de entrega. |
| EsPrincipal | M | Booleano | M | INT | Indica si es la dirección principal actual. |
| FechaCreacion | M | Instante | S | INT | Creación. |
| FechaActualizacion | M | Instante | S | INT | Última modificación. |

## 9.4 Invariantes

- Una Dirección pertenece exactamente a un Cliente.
- Por Cliente, como máximo una Dirección tiene `EsPrincipal = true`.
- Es válido que un Cliente no tenga Dirección principal.
- Eliminar una Dirección no afecta pedidos previos.

---

# 10. Entidad Autor

## 10.1 Definición

Persona o identidad autoral asociable a uno o más Libros.

## 10.2 Claves

- PK: `AutorId`.
- El nombre **no** es clave alternativa.

## 10.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| AutorId | M | Identificador | I | PUB | Identificador interno. |
| Nombre | M | Texto corto; 1–200 | M | PUB | Nombre de presentación del Autor. Puede repetirse entre autores distintos. |
| Biografia | O | Texto largo; máx. conceptual 5.000 | M | PUB | Reseña biográfica. |
| Estado | M | EstadoCatalogo | R | PUB | `ACTIVE` o `INACTIVE`. |
| FechaCreacion | M | Instante | S | INT | Creación del registro. |
| FechaActualizacion | M | Instante | S | INT | Última modificación. |

## 10.4 Semántica de inactivación

Un Autor `INACTIVE`:

- no puede añadirse a una nueva relación `LibroAutor`;
- conserva sus relaciones existentes;
- puede seguir siendo mostrado como autor de un Libro ya relacionado;
- no elimina ni inactiva automáticamente Libros.

---

# 11. Entidad Editorial

## 11.1 Definición

Organización editorial responsable de una Edición.

## 11.2 Claves

- PK: `EditorialId`.
- `Nombre` no se considera clave única en v1.

## 11.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| EditorialId | M | Identificador | I | PUB | Identificador interno. |
| Nombre | M | Texto corto; 1–200 | M | PUB | Nombre de la Editorial. |
| Descripcion | O | Texto medio; máx. 2.000 | M | PUB | Descripción opcional. |
| Estado | M | EstadoCatalogo | R | PUB | `ACTIVE` o `INACTIVE`. |
| FechaCreacion | M | Instante | S | INT | Creación. |
| FechaActualizacion | M | Instante | S | INT | Última modificación. |

## 11.4 Semántica de inactivación

Una Editorial `INACTIVE`:

- no puede asignarse a nuevas Ediciones;
- conserva Ediciones ya relacionadas;
- su nombre puede seguir mostrándose en Ediciones existentes;
- no hace que una Edición existente pase automáticamente a `INACTIVE`.

---

# 12. Entidad Categoria

## 12.1 Definición

Clasificación temática de Libros con jerarquía máxima de dos niveles.

## 12.2 Claves

- PK: `CategoriaId`.
- AK: `Slug`.

## 12.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| CategoriaId | M | Identificador | I | PUB | Identificador interno. |
| CategoriaPadreId | O | FK Categoria | R | INT | Ausente para categoría raíz; presente para subcategoría. |
| Nombre | M | Texto corto; 1–120 | M | PUB | Nombre visible. |
| Slug | M | Código textual; 1–140 | M | PUB | Identificador legible único. Se normaliza a minúsculas, sin espacios exteriores y con separador `-`. |
| Descripcion | O | Texto medio; máx. 1.000 | M | PUB | Descripción temática. |
| Estado | M | EstadoCatalogo | R | PUB | `ACTIVE` o `INACTIVE`. |
| FechaCreacion | M | Instante | S | INT | Creación. |
| FechaActualizacion | M | Instante | S | INT | Última modificación. |

## 12.4 Invariantes

- `Slug` único globalmente.
- Categoría raíz: `CategoriaPadreId = null`.
- Subcategoría: `CategoriaPadreId != null` y el padre debe ser raíz.
- Una subcategoría no puede poseer hijos.
- No puede referenciarse a sí misma.
- No pueden existir ciclos.
- Profundidad máxima: 2.

## 12.5 Semántica de inactivación

- No puede incorporarse a nuevas asociaciones `LibroCategoria`.
- Asociaciones existentes permanecen.
- La inactivación no desactiva automáticamente Libros.
- La categoría inactiva no debe ofrecerse como opción de clasificación nueva en interfaces administrativas futuras.

---

# 13. Entidad Libro

## 13.1 Definición

Obra bibliográfica abstracta, independiente de sus versiones comerciales.

## 13.2 Claves

- PK: `LibroId`.
- Título no es único.

## 13.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| LibroId | M | Identificador | I | PUB | Identificador interno de la obra. |
| Titulo | M | Texto medio; 1–300 | M | PUB | Título principal de la obra. |
| Subtitulo | O | Texto medio; máx. 300 | M | PUB | Subtítulo, cuando exista. |
| Sinopsis | O | Texto largo; máx. conceptual 10.000 | M | PUB | Descripción/resumen de la obra. |
| Estado | M | EstadoCatalogo | R | PUB | Control de disponibilidad comercial a nivel de obra. |
| FechaCreacion | M | Instante | S | INT | Creación. |
| FechaActualizacion | M | Instante | S | INT | Último cambio. |

## 13.4 Invariantes

Para `Libro.Estado = ACTIVE`:

- debe existir al menos un `LibroAutor`;
- debe existir al menos un `LibroCategoria`.

La inactivación del Libro hace que ninguna de sus Ediciones sea publicable, sin modificar el estado individual de esas Ediciones.

---

# 14. Entidad LibroAutor

## 14.1 Definición

Asociación N:M entre Libro y Autor, incluyendo orden de presentación autoral.

## 14.2 Claves

- PK compuesta: `(LibroId, AutorId)`.
- AK: `(LibroId, OrdenAutoria)`.

## 14.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| LibroId | M | FK Libro | I en la relación | PUB | Libro participante. |
| AutorId | M | FK Autor | I en la relación | PUB | Autor participante. |
| OrdenAutoria | M | Entero positivo | M | PUB | Posición usada para mostrar autores. Valores únicos dentro del Libro. |

## 14.4 Reglas

- No puede existir dos veces la misma pareja Libro/Autor.
- `OrdenAutoria > 0`.
- No pueden repetirse posiciones dentro de un Libro.
- No se exige que la secuencia sea contigua; el orden relativo se obtiene ascendentemente.
- Un Autor nuevo en la relación debe estar `ACTIVE`.

---

# 15. Entidad LibroCategoria

## 15.1 Definición

Asociación N:M entre Libro y Categoria.

## 15.2 Claves

- PK compuesta: `(LibroId, CategoriaId)`.

## 15.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| LibroId | M | FK Libro | I en la relación | PUB | Libro clasificado. |
| CategoriaId | M | FK Categoria | I en la relación | PUB | Categoría asignada. |

## 15.4 Reglas

- No se duplica la misma asociación.
- Una Categoría incorporada a una nueva asociación debe estar `ACTIVE`.

---

# 16. Entidad Edicion

## 16.1 Definición

Versión comercial física concreta de un Libro. Es la unidad que PLIEGO vende, valora e inventaría.

## 16.2 Claves

- PK: `EdicionId`.
- AK: `SKU`.
- AK condicional: `ISBN13` cuando exista.

## 16.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| EdicionId | M | Identificador | I | PUB | Identificador interno. |
| LibroId | M | FK Libro | I | PUB | Obra a la que pertenece. No puede cambiar después de crear la Edición. |
| EditorialId | M | FK Editorial | M | PUB | Editorial actual de la Edición. Editorial nueva debe estar `ACTIVE`. |
| SKU | M | Código SKU; 1–64 | I | PUB | Identificador comercial interno, canónico y único. |
| ISBN13 | O | 13 dígitos | M restringida | PUB | ISBN de la Edición. Si existe, checksum válido y único. Puede corregirse administrativamente. |
| Idioma | M | LanguageCode; 2 o 3 caracteres | M | PUB | Idioma principal del contenido. Canon en minúsculas (ISO 639-1 o 639-2/T). |
| Formato | M | FormatoEdicion | M | PUB | `PAPERBACK` o `HARDCOVER`. |
| NumeroPaginas | M | Entero positivo; rango conceptual 1–100.000 | M | PUB | Número de páginas de la Edición. |
| FechaPublicacion | O | Fecha | M | PUB | Fecha editorial. No determina por sí sola disponibilidad comercial en v1. |
| Precio | M | Importe USD; 0.01–999,999,999.99 | M | PUB | Precio vigente. Fuente de verdad del carrito activo. |
| PortadaUrl | O | URL/URI; máx. conceptual 2.048 | M | PUB | Localización de la imagen de portada. No contiene binario. |
| PortadaLicencia | C | LicenciaPortada | M | PUB | Obligatoria si existe `PortadaUrl`. |
| PortadaFuenteUrl | C | URL/URI; máx. 2.048 | M | PUB | Obligatoria si existe `PortadaUrl`; identifica procedencia documentada. |
| PortadaAtribucion | O | Texto medio; máx. 500 | M | PUB | Texto de atribución cuando la licencia o fuente lo requiera. |
| Estado | M | EstadoCatalogo | R | PUB | `ACTIVE` o `INACTIVE`. |
| FechaCreacion | M | Instante | S | INT | Creación. |
| FechaActualizacion | M | Instante | S | INT | Último cambio. |

## 16.4 Reglas condicionales de portada

```text
PortadaUrl IS NULL
=> PortadaLicencia, PortadaFuenteUrl y PortadaAtribucion pueden ser null

PortadaUrl IS NOT NULL
=> PortadaLicencia obligatorio
=> PortadaFuenteUrl obligatorio
```

`PortadaAtribucion` es obligatoria con `CC_BY` y `CC_BY_SA`; opcional con `PUBLIC_DOMAIN`, `CC0` y `OWNED` (recomendada cuando la fuente la proporcione). Eliminar `PortadaUrl` obliga a nulificar `PortadaLicencia`, `PortadaFuenteUrl` y `PortadaAtribucion`.

## 16.5 Publicabilidad

Una Edición es publicable cuando:

```text
Edicion.Estado = ACTIVE
AND Libro.Estado = ACTIVE
```

La disponibilidad de compra requiere adicionalmente:

```text
Inventario.StockActual > 0
```

---

# 17. Entidad Inventario

## 17.1 Definición

Fuente única de verdad del stock actual de una Edición en PLIEGO v1.

## 17.2 Claves

- PK lógica compartida: `EdicionId`.
- FK: `EdicionId -> Edicion`.

## 17.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| EdicionId | M | FK/identificador | I | INT | Identifica a la Edición cuyo inventario representa. |
| StockActual | M | Entero no negativo | R | INT | Unidades existentes actualmente. Solo cambia por operaciones autorizadas de inventario, venta o cancelación. |
| StockMinimo | M | Entero no negativo | M | INT | Umbral administrativo para indicador de bajo stock. |
| FechaActualizacion | M | Instante | S | INT | Último cambio de `StockActual` o `StockMinimo`. |

## 17.4 Valores iniciales

Al crear Edicion:

```text
StockActual = 0
StockMinimo = 0
```

## 17.5 Dato derivado

```text
BajoStock = StockMinimo > 0 AND StockActual <= StockMinimo
```

`BajoStock` no requiere almacenamiento independiente. (`StockMinimo = 0` significa "sin umbral".)

---

# 18. Entidad MovimientoInventario

## 18.1 Definición

Evento inmutable que explica cada cambio confirmado en `Inventario.StockActual`.

## 18.2 Claves

- PK: `MovimientoInventarioId`.
- AK condicional para movimientos de Pedido: `(PedidoId, EdicionId, Tipo)`.

## 18.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| MovimientoInventarioId | M | Identificador | I | COM | Identificador del evento. |
| EdicionId | M | FK Inventario/Edicion | A | COM | Inventario afectado. |
| PedidoId | C | FK Pedido | A | COM | Obligatorio para `SALE` y `CANCELLATION`; ausente para movimientos administrativos. |
| UsuarioActorId | C | FK Usuario | A | INT | Obligatorio para movimientos administrativos; debe corresponder a ADMIN. Ausente en movimientos automáticos de venta/cancelación. |
| Tipo | M | TipoMovimientoInventario | A | COM | Naturaleza del cambio. |
| Cantidad | M | Entero positivo | A | COM | Magnitud absoluta del movimiento; nunca se almacena negativa. |
| StockAnterior | M | Entero no negativo | A | COM | Stock inmediatamente anterior al evento. |
| StockPosterior | M | Entero no negativo | A | COM | Stock inmediatamente posterior. |
| Motivo | C | Texto medio; 1–500 | A | COM | Obligatorio en `ENTRY`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`. Opcional en movimientos automáticos. |
| Fecha | M | Instante | A | COM | Momento en que el movimiento fue confirmado. |

## 18.4 Reglas por tipo

| Tipo | PedidoId | UsuarioActorId | Motivo | Efecto |
|---|---|---|---|---|
| ENTRY | null | obligatorio ADMIN | obligatorio | suma |
| ADJUSTMENT_IN | null | obligatorio ADMIN | obligatorio | suma |
| ADJUSTMENT_OUT | null | obligatorio ADMIN | obligatorio | resta |
| SALE | obligatorio | null | opcional | resta |
| CANCELLATION | obligatorio | null | opcional | suma |

## 18.5 Invariantes aritméticas

```text
ENTRY / ADJUSTMENT_IN / CANCELLATION:
StockPosterior = StockAnterior + Cantidad

ADJUSTMENT_OUT / SALE:
StockPosterior = StockAnterior - Cantidad
```

Siempre:

```text
Cantidad > 0
StockAnterior >= 0
StockPosterior >= 0
```

## 18.6 Inmutabilidad

Todos los atributos son append-only. Un MovimientoInventario confirmado no se modifica ni elimina.

---

# 19. Entidad Carrito

## 19.1 Definición

Agrupador temporal de intención de compra de un Cliente.

## 19.2 Claves

- PK: `CarritoId`.
- Regla de unicidad condicional: como máximo un Carrito `ACTIVE` por Cliente.

## 19.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| CarritoId | M | Identificador | I | INT | Identificador interno. |
| ClienteId | M | FK Cliente | I | INT | Propietario. |
| Estado | M | EstadoCarrito | R | INT | `ACTIVE` o `CHECKED_OUT`. |
| FechaCreacion | M | Instante | S | INT | Creación física del Carrito. |
| FechaActualizacion | M | Instante | S | INT | Última modificación de estado o contenido relevante. |

## 19.4 Estados

```text
ACTIVE -> CHECKED_OUT
```

`CHECKED_OUT` es final.

Un checkout rechazado por pago **no** cambia el Carrito; permanece `ACTIVE`.

---

# 20. Entidad CarritoItem

## 20.1 Definición

Una Edición seleccionada y su cantidad dentro de un Carrito.

## 20.2 Claves

- PK: `CarritoItemId`.
- AK: `(CarritoId, EdicionId)`.

## 20.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| CarritoItemId | M | Identificador | I | INT | Identificador del item. |
| CarritoId | M | FK Carrito | I | INT | Carrito propietario. |
| EdicionId | M | FK Edicion | I | PUB | Edición solicitada. |
| Cantidad | M | Entero positivo | M | INT | Unidades solicitadas. Debe ser > 0. |
| FechaCreacion | M | Instante | S | INT | Primera incorporación del item. |
| FechaActualizacion | M | Instante | S | INT | Último cambio de cantidad. |

## 20.4 Reglas

- Un CarritoItem solo puede modificarse mientras su Carrito está `ACTIVE`.
- Al agregar/modificar se valida `Cantidad <= StockActual` en ese instante.
- Esta condición no garantiza stock hasta checkout.
- No almacena precio como fuente de verdad.

## 20.5 Datos derivados en consulta

```text
PrecioActual = Edicion.Precio
SubtotalActual = Cantidad × PrecioActual
```

---

# 21. Entidad Pedido

## 21.1 Definición

Transacción comercial persistida creada durante checkout.

## 21.2 Claves

- PK: `PedidoId`.

## 21.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| PedidoId | M | Identificador | I | COM | Identificador interno del Pedido. |
| ClienteId | M | FK Cliente | I | COM | Cliente propietario. |
| Estado | M | EstadoPedido | R | COM | Estado actual según máquina de estados. |
| Subtotal | M | Importe USD > 0 | I | COM | Suma histórica de subtotales de PedidoItem. |
| Total | M | Importe USD > 0 | I | COM | Total comercial. En v1 debe ser igual a Subtotal. |
| FechaCreacion | M | Instante | S | COM | Instante de creación del Pedido en checkout. |
| FechaActualizacion | M | Instante | S | COM | Último cambio de estado del Pedido. |

## 21.4 Invariantes

- Debe tener al menos un PedidoItem.
- Debe tener exactamente un PedidoDireccion.
- Debe tener exactamente un Pago.
- Debe tener al menos un PedidoEstadoHistorial.
- `Subtotal > 0`.
- `Total > 0`.
- `Total = Subtotal` en v1.
- Moneda implícita: USD.

## 21.5 Estados permitidos

```text
PENDING_PAYMENT
CONFIRMED
PREPARING
SHIPPED
DELIVERED
CANCELLED
```

Las transiciones están definidas en la Use Case Baseline y en la sección de reglas inter-entidad de este documento.

---

# 22. Entidad PedidoItem

## 22.1 Definición

Línea comercial inmutable de un Pedido. Mantiene referencia a Edicion y snapshots suficientes para preservar qué fue comprado aunque el catálogo cambie.

## 22.2 Claves

- PK: `PedidoItemId`.
- **AK incorporada por DD-COR-005:** `(PedidoId, EdicionId)`.

## 22.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| PedidoItemId | M | Identificador | I | COM | Identificador interno. |
| PedidoId | M | FK Pedido | A | COM | Pedido propietario. |
| EdicionId | M | FK Edicion | A | COM | Referencia histórica a la Edición adquirida. |
| SKU_Snapshot | M | Código SKU | A | COM | Copia exacta del SKU al checkout. |
| ISBN_Snapshot | O | 13 dígitos | A | COM | Copia del ISBN; null si la Edición no poseía ISBN. |
| Titulo_Snapshot | M | Texto medio; 1–300 | A | COM | Título mostrado al momento de compra. |
| Autores_Snapshot | M | Texto medio; 1–1.000 | A | COM | Cadena histórica de autores, ordenada por `OrdenAutoria` y separada de forma determinista por `; `. |
| Editorial_Snapshot | M | Texto corto; 1–200 | A | COM | Nombre de Editorial al checkout. |
| Formato_Snapshot | M | FormatoEdicion | A | COM | Formato comprado. |
| Idioma_Snapshot | M | Código idioma | A | COM | **Incorporado por DD-COR-002.** Idioma comprado. |
| PrecioUnitario | M | Importe USD > 0 | A | COM | Precio de una unidad al checkout. |
| Cantidad | M | Entero positivo | A | COM | Unidades compradas. |
| Subtotal | M | Importe USD > 0 | A | COM | `PrecioUnitario × Cantidad`. |

## 22.4 Invariantes

```text
Cantidad > 0
PrecioUnitario > 0
Subtotal = PrecioUnitario × Cantidad
```

Una Edición aparece como máximo una vez dentro del mismo Pedido.

## 22.5 Semántica de snapshots

Los snapshots:

- se obtienen dentro de la misma operación de checkout;
- no se recalculan posteriormente;
- no son fuente de verdad del catálogo;
- son fuente de verdad histórica del Pedido.

No se considera necesario capturar `NumeroPaginas`, `FechaPublicacion` o `PortadaUrl` para la verdad transaccional de v1.

---

# 23. Entidad PedidoDireccion

## 23.1 Definición

Snapshot inmutable de la Dirección seleccionada durante checkout.

## 23.2 Claves

- PK/FK lógica compartida: `PedidoId`.

## 23.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| PedidoId | M | FK Pedido | A | COM | Pedido al que pertenece el snapshot. |
| Destinatario | M | Texto corto; 1–200 | A | PER/COM | Copia de destinatario. |
| DireccionLinea1 | M | Texto medio; 1–200 | A | PER/COM | Copia de dirección principal. |
| DireccionLinea2 | O | Texto medio; máx. 200 | A | PER/COM | Copia de complemento. |
| Ciudad | M | Texto corto; 1–100 | A | PER/COM | Copia de ciudad. |
| Provincia | M | Texto corto; 1–100 | A | PER/COM | Copia de provincia/región. |
| PaisCodigo | M | Código ISO país; 2 caracteres | A | PER/COM | **Incorporado por DD-COR-001.** País de entrega al checkout. |
| CodigoPostal | O | Texto corto; máx. 20 | A | PER/COM | Copia de código postal. |
| Referencia | O | Texto medio; máx. 300 | A | PER/COM | Copia de referencia. |
| Telefono | M | Teléfono; 7–20 | A | PER/COM | Teléfono de contacto de entrega. |

## 23.4 Reglas

- No existe FK hacia Direccion.
- Se genera a partir de una Dirección que pertenece al Cliente del Pedido.
- Después del checkout no se modifica.
- Borrar o editar la Dirección original no afecta este snapshot.

---

# 24. Entidad Pago

## 24.1 Definición

Resultado del único intento de pago simulado asociado a un Pedido en PLIEGO v1.

## 24.2 Claves

- PK: `PagoId`.
- AK: `PedidoId`.
- AK condicional: `Referencia` cuando exista.

## 24.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| PagoId | M | Identificador | I | COM | Identificador del Pago. |
| PedidoId | M | FK Pedido | I | COM | Debe ser único: un Pago por Pedido. |
| Metodo | M | MetodoPago | I | COM | `CARD` o `TRANSFER`. |
| Estado | M | EstadoPago | R | COM | Estado del intento de pago. |
| Monto | M | Importe USD > 0 | I | COM | Debe ser exactamente igual a Pedido.Total. |
| Referencia | O | Texto corto; 1–100 | R | COM | Referencia generada por el simulador. Si existe, es única. |
| DetalleResultado | O | Texto medio; máx. 500 | R | COM | Explicación académica del resultado, sin datos sensibles de tarjeta. |
| FechaCreacion | M | Instante | S | COM | Creación como `PENDING`. |
| FechaActualizacion | M | Instante | S | COM | Último cambio de estado. |

## 24.4 Máquina de estados

```text
PENDING -> APPROVED -> REFUNDED
       \-> REJECTED
```

## 24.5 Restricciones

- No almacena CVV.
- No almacena PAN/número completo de tarjeta.
- `Monto > 0`.
- `Monto = Pedido.Total`.
- `Referencia` es obligatoria en `APPROVED`, opcional en `REJECTED` (el motivo vive en `DetalleResultado`); nace `null` en `PENDING` y queda inmutable tras la resolución; `REFUNDED` no la modifica.
- `APPROVED` puede cambiar únicamente a `REFUNDED`.
- `REJECTED` y `REFUNDED` son finales.

---

# 25. Entidad PedidoEstadoHistorial

## 25.1 Definición

Registro append-only de creación y transiciones de estado de Pedido.

## 25.2 Claves

- PK: `PedidoEstadoHistorialId`.

## 25.3 Atributos

| Atributo | Obl. | Dominio / rango conceptual | Mut. | Sens. | Definición y reglas |
|---|---:|---|---|---|---|
| PedidoEstadoHistorialId | M | Identificador | I | COM | Identificador del evento histórico. |
| PedidoId | M | FK Pedido | A | COM | Pedido afectado. |
| UsuarioActorId | C | FK Usuario | A | INT | Obligatorio cuando `Origen = USER`; ausente cuando `Origen = SYSTEM`. |
| Origen | M | OrigenTransicionPedido | A | COM | Indica si la transición fue causada por usuario o sistema. |
| EstadoAnterior | O/C | EstadoPedido | A | COM | `null` exclusivamente para el primer registro del Pedido. |
| EstadoNuevo | M | EstadoPedido | A | COM | Estado establecido por el evento. |
| Fecha | M | Instante | A | COM | Momento de la transición. |

## 25.4 Reglas

### Registro inicial

```text
EstadoAnterior = null
EstadoNuevo = PENDING_PAYMENT
Origen = SYSTEM
UsuarioActorId = null
```

### Transición automática de pago aprobado

```text
PENDING_PAYMENT -> CONFIRMED
Origen = SYSTEM
UsuarioActorId = null
```

### Transición automática de pago rechazado

```text
PENDING_PAYMENT -> CANCELLED
Origen = SYSTEM
UsuarioActorId = null
```

### Transiciones administrativas

```text
Origen = USER
UsuarioActorId = ADMIN que realizó la operación
```

### Cancelación por Cliente

```text
Origen = USER
UsuarioActorId = Usuario CUSTOMER propietario del Pedido
```

Todo registro es inmutable.

---

# 26. Matriz de compatibilidad Pedido–Pago

La combinación de estados debe ser coherente.

| Estado Pedido | Estados de Pago compatibles | Observación |
|---|---|---|
| PENDING_PAYMENT | PENDING | Estado transitorio intra-transaccional dentro de checkout; nunca observable post-commit |
| CONFIRMED | APPROVED | Compra confirmada |
| PREPARING | APPROVED | Pedido pagado en preparación |
| SHIPPED | APPROVED | Pedido pagado enviado |
| DELIVERED | APPROVED | Pedido pagado entregado |
| CANCELLED | REJECTED, REFUNDED | Rechazo inicial o cancelación posterior a pago aprobado |

No son válidos, entre otros:

```text
CONFIRMED + PENDING
CONFIRMED + REJECTED
SHIPPED + REFUNDED
DELIVERED + REJECTED
CANCELLED + APPROVED
CANCELLED + PENDING
```

La transición de cancelación desde `CONFIRMED`/`PREPARING` debe actualizar Pago a `REFUNDED` dentro de la misma operación de negocio.

---

# 27. Reglas de consistencia entre Pedido y sus dependencias

Para todo Pedido persistido al completar la operación de checkout debe cumplirse:

```text
COUNT(PedidoItem) >= 1
COUNT(PedidoDireccion) = 1
COUNT(Pago) = 1
COUNT(PedidoEstadoHistorial) >= 1
```

Además:

```text
Pedido.Subtotal = SUM(PedidoItem.Subtotal)
Pedido.Total = Pedido.Subtotal
Pago.Monto = Pedido.Total
```

Para cada PedidoItem:

```text
PedidoItem.Subtotal = PedidoItem.PrecioUnitario × PedidoItem.Cantidad
```

---

# 28. Reglas de consistencia de inventario

## 28.1 Fuente de verdad

`Inventario.StockActual` es el estado presente.

`MovimientoInventario` explica la historia de variaciones confirmadas.

No debe existir otro atributo `Stock` en:

- Libro;
- Edicion;
- CarritoItem;
- PedidoItem.

## 28.2 Operación administrativa

Cambio de stock y MovimientoInventario deben producirse en una misma transacción.

## 28.3 Venta

Por cada PedidoItem confirmado se produce exactamente un movimiento `SALE` para la misma Edicion.

## 28.4 Cancelación

Por cada PedidoItem de un Pedido cancelado después de aprobación se produce exactamente un movimiento `CANCELLATION` para la misma Edicion. Cada `CANCELLATION` requiere el `SALE` previo del mismo `(PedidoId, EdicionId)`; los pedidos `CANCELLED` por rechazo inicial (sin `SALE`) no generan `CANCELLATION`.

## 28.5 Identidad de movimientos de pedido

Para el mismo Pedido y Edicion:

- máximo un `SALE`;
- máximo un `CANCELLATION`.

Esto evita aplicar dos veces la misma salida o restauración.

---

# 29. Reglas de consistencia de catálogo

## 29.1 Libro activo

Un Libro `ACTIVE` debe conservar:

```text
>= 1 LibroAutor
>= 1 LibroCategoria
```

El estado `INACTIVE` de un Autor o Categoria asociado no elimina esa asociación ni obliga a desactivar el Libro.

## 29.2 Edición publicable

```text
Libro.Estado = ACTIVE
AND Edicion.Estado = ACTIVE
```

## 29.3 Edición comprable

```text
Libro.Estado = ACTIVE
AND Edicion.Estado = ACTIVE
AND Inventario.StockActual > 0
```

## 29.4 Editorial inactiva

Una Editorial inactiva:

- no puede asociarse a una nueva Edición;
- no invalida automáticamente Ediciones ya existentes.

---

# 30. Datos derivados y no persistentes como fuente de verdad

| Dato | Derivación |
|---|---|
| Libro disponible para una Edición | Libro ACTIVE + Edicion ACTIVE + StockActual > 0 |
| Bajo stock | StockMinimo > 0 AND StockActual <= StockMinimo |
| Precio actual de CarritoItem | Edicion.Precio |
| Subtotal actual de CarritoItem | Cantidad × Edicion.Precio |
| Total actual de Carrito | suma de subtotales actuales |
| Nombre completo Cliente | Nombres + Apellidos |
| Total Pedido | suma de PedidoItem.Subtotal; en v1 coincide con Subtotal |

Estos datos pueden devolverse desde Functions/queries de la Database API, pero no deben convertirse en fuentes duplicadas de verdad sin una decisión posterior explícita.

---

# 31. Atributos históricos versus datos maestros

| Concepto actual | Fuente maestra | Snapshot histórico |
|---|---|---|
| Título | Libro.Titulo | PedidoItem.Titulo_Snapshot |
| Autores | Autor + LibroAutor | PedidoItem.Autores_Snapshot |
| Editorial | Editorial.Nombre | PedidoItem.Editorial_Snapshot |
| SKU | Edicion.SKU | PedidoItem.SKU_Snapshot |
| ISBN | Edicion.ISBN13 | PedidoItem.ISBN_Snapshot |
| Formato | Edicion.Formato | PedidoItem.Formato_Snapshot |
| Idioma | Edicion.Idioma | PedidoItem.Idioma_Snapshot |
| Precio | Edicion.Precio | PedidoItem.PrecioUnitario |
| Dirección | Direccion | PedidoDireccion |
| Estado de Pedido | Pedido.Estado | PedidoEstadoHistorial |
| Stock | Inventario.StockActual | MovimientoInventario antes/después |

Los snapshots no deben sincronizarse cuando cambia la fuente maestra.

---

# 32. Nulabilidad consolidada

## Nunca nulos

Entre otros:

- identificadores PK;
- referencias obligatorias;
- Usuario.EmailNormalizado;
- Usuario.PasswordHash;
- Cliente.Nombres/Apellidos;
- Autor.Nombre;
- Editorial.Nombre;
- Categoria.Nombre/Slug;
- Libro.Titulo;
- Edicion.SKU/Idioma/Formato/NumeroPaginas/Precio;
- Inventario.StockActual/StockMinimo;
- Carrito.Estado;
- CarritoItem.Cantidad;
- Pedido.Estado/Subtotal/Total;
- PedidoItem snapshots obligatorios;
- PedidoDireccion datos mínimos;
- Pago.Metodo/Estado/Monto;
- PedidoEstadoHistorial.Origen/EstadoNuevo/Fecha.

## Nulos permitidos por naturaleza

- Cliente.Telefono;
- Direccion.Linea2;
- Direccion.CodigoPostal;
- Direccion.Referencia;
- Autor.Biografia;
- Editorial.Descripcion;
- Categoria.CategoriaPadreId;
- Categoria.Descripcion;
- Libro.Subtitulo;
- Libro.Sinopsis;
- Edicion.ISBN13;
- Edicion.FechaPublicacion;
- Portada* cuando no existe portada;
- PedidoItem.ISBN_Snapshot;
- PedidoDireccion.Linea2/CodigoPostal/Referencia;
- Pago.Referencia antes del resultado;
- Pago.DetalleResultado;
- PedidoEstadoHistorial.EstadoAnterior solo para primer evento.

## Nulos condicionales

- MovimientoInventario.PedidoId;
- MovimientoInventario.UsuarioActorId;
- MovimientoInventario.Motivo;
- Edicion.PortadaLicencia;
- Edicion.PortadaFuenteUrl;
- PedidoEstadoHistorial.UsuarioActorId.

Las condiciones están definidas en las entidades correspondientes.

---

# 33. Mutabilidad consolidada

## Inmutables o históricos

- IDs;
- Usuario.Rol;
- Edicion.LibroId;
- Edicion.SKU;
- todo MovimientoInventario confirmado;
- Pedido.ClienteId;
- Pedido.Subtotal/Total;
- todo PedidoItem;
- todo PedidoDireccion;
- Pago.PedidoId/Metodo/Monto;
- todo PedidoEstadoHistorial.

## Mutables controlados

- Usuario.Estado;
- datos de Cliente;
- Direccion;
- Autor;
- Editorial;
- Categoria;
- Libro;
- metadatos permitidos de Edicion;
- Edicion.Precio;
- Inventario.StockMinimo;
- CarritoItem.Cantidad;
- estados de Carrito, Pedido y Pago según sus máquinas.

## Mutabilidad operativa de stock

`Inventario.StockActual` no se edita como dato maestro; cambia únicamente como efecto de procedimientos de inventario/venta/cancelación que generen MovimientoInventario.

---

# 34. Validaciones de formato versus reglas de negocio

## 34.1 Validaciones de formato

Pueden existir también en Spring Boot para proteger el contrato HTTP:

- string no vacío;
- longitud máxima;
- estructura básica de email;
- entero positivo;
- formato de código.

## 34.2 Autoridad de negocio

PostgreSQL sigue siendo autoridad sobre:

- unicidad de email/SKU/ISBN/slug;
- checksum ISBN;
- estado de entidades;
- asociaciones válidas;
- stock;
- propiedad de carrito/pedido/direcciones;
- totales;
- transiciones;
- snapshots;
- movimientos;
- compatibilidad Pedido/Pago.

Una validación equivalente en frontend o Java es únicamente preventiva y no sustituye la regla del motor.

---

# 35. Datos que nunca deben exponerse en respuestas públicas

- `PasswordHash`;
- identificadores internos de autenticación que no sean necesarios;
- datos personales de otro Cliente;
- direcciones de otro Cliente;
- PedidoDireccion de otro Cliente;
- motivos internos de movimientos administrativos salvo endpoint administrativo;
- información técnica no necesaria del simulador de pago.

Los datos de catálogo clasificados `PUB` pueden formar parte de APIs públicas según el caso de uso.

---

# 36. Datos que no se modelan en PLIEGO v1

El diccionario confirma la ausencia deliberada de:

- `BodegaId`;
- `SucursalId`;
- proveedor;
- costo de adquisición;
- stock reservado;
- impuesto;
- descuento;
- cupón;
- costo de envío;
- tracking;
- factura fiscal;
- archivo eBook;
- reseña/rating;
- wishlist;
- refresh token persistido;
- sesión de usuario;
- tarjeta bancaria completa;
- CVV.

Su ausencia no debe ser compensada con columnas improvisadas durante implementación.

---

# 37. Matriz de claves lógicas revisada

| Entidad | PK | AK / unicidad |
|---|---|---|
| Usuario | UsuarioId | EmailNormalizado |
| Cliente | ClienteId | UsuarioId |
| Direccion | DireccionId | máximo una principal por Cliente |
| Autor | AutorId | — |
| Editorial | EditorialId | — |
| Categoria | CategoriaId | Slug |
| Libro | LibroId | — |
| LibroAutor | LibroId + AutorId | LibroId + OrdenAutoria |
| LibroCategoria | LibroId + CategoriaId | — |
| Edicion | EdicionId | SKU; ISBN13 si existe |
| Inventario | EdicionId | — |
| MovimientoInventario | MovimientoInventarioId | PedidoId + EdicionId + Tipo para SALE/CANCELLATION |
| Carrito | CarritoId | máximo un ACTIVE por Cliente |
| CarritoItem | CarritoItemId | CarritoId + EdicionId |
| Pedido | PedidoId | — |
| PedidoItem | PedidoItemId | PedidoId + EdicionId |
| PedidoDireccion | PedidoId | — |
| Pago | PagoId | PedidoId; Referencia si existe |
| PedidoEstadoHistorial | PedidoEstadoHistorialId | — |

---

# 38. Matriz de responsabilidad sobre cambios

| Dato | Operación autorizada |
|---|---|
| Usuario.Estado | Gestión administrativa de cliente |
| Cliente.* | Gestión de perfil |
| Direccion.* | Gestión de direcciones |
| Autor/Editorial/Categoria/Libro/Edicion | Gestión administrativa de catálogo |
| Inventario.StockMinimo | Configurar stock mínimo |
| Inventario.StockActual | SP de entrada/ajuste/checkout/cancelación |
| MovimientoInventario | Solo creación dentro de operación que cambia stock |
| Carrito | Gestión de carrito / checkout |
| CarritoItem | Gestión de carrito |
| Pedido.Estado | Checkout / cancelación / gestión administrativa |
| PedidoItem | Solo creación en checkout |
| PedidoDireccion | Solo creación en checkout |
| Pago | Checkout / cancelación posterior |
| PedidoEstadoHistorial | Solo append por transición de Pedido |

---

# 39. Reglas para el futuro modelo físico

El modelo físico deberá preservar como mínimo:

1. unicidad de EmailNormalizado;
2. unicidad de SKU;
3. unicidad condicional de ISBN13;
4. unicidad de Categoria.Slug;
5. unicidad Libro/Autor;
6. unicidad Libro/OrdenAutoria;
7. unicidad Libro/Categoria;
8. relación 1:1 Edicion/Inventario;
9. máximo un Carrito ACTIVE por Cliente;
10. unicidad Carrito/Edicion;
11. unicidad Pedido/Edicion en PedidoItem;
12. relación 1:1 Pedido/PedidoDireccion;
13. relación 1:1 Pedido/Pago;
14. unicidad de Referencia de Pago cuando exista;
15. unicidad Pedido/Edicion/Tipo para movimientos `SALE` y `CANCELLATION`;
16. cantidades enteras positivas donde corresponda;
17. stock no negativo;
18. precios y montos positivos;
19. categorías con máximo dos niveles;
20. transiciones de estado válidas;
21. compatibilidad Pedido/Pago;
22. condiciones de nulabilidad establecidas en este diccionario.

La técnica física concreta (`UNIQUE`, `CHECK`, índice parcial, trigger, Function o SP) se decidirá en el Modelo Físico / Database API Contract.

---

# 40. Trazabilidad de correcciones hacia artefactos anteriores

La revisión v1.1 incorpora lo siguiente (trazabilidad de correcciones hacia artefactos anteriores):

| Corrección | UCB | DER |
|---|---|---|
| PaisCodigo en Direccion/PedidoDireccion | actualización menor | sí |
| IdiomaSnapshot en PedidoItem | actualización menor | sí |
| Quitar Carrito.CANCELLED de v1 | sí | sí |
| Totales/montos estrictamente > 0 | sí, si aparece >= 0 | sí |
| AK PedidoId+EdicionId | no funcional | sí |
| Matriz Pedido/Pago | aclaración | sí |
| AK movimientos SALE/CANCELLATION | no funcional | sí |
| Motivo obligatorio en movimientos administrativos | aclaración | sí |
| Semántica de inactivación de maestros | aclaración | sí |
| Normalización de email/SKU/códigos | aclaración | sí |
| Referencia Pago única si existe | no funcional | sí |
| AutoresSnapshot como cadena histórica atómica y ordenada | aclaración | sí |

Estas modificaciones son compatibles con el alcance v1 y no requieren nuevas entidades. Los rangos conceptuales superiores (p. ej. precio máximo, páginas, longitudes) son guardas técnicas aceptadas en esta baseline.

---

# 41. Validación de completitud del diccionario

| Pregunta | Resultado |
|---|---|
| ¿Las 19 entidades del DER poseen definición? | Sí |
| ¿Todo atributo posee significado inequívoco? | Sí |
| ¿Se distingue obligatorio/opcional/condicional? | Sí |
| ¿Se fijaron rangos conceptuales relevantes? | Sí |
| ¿Se fijó mutabilidad? | Sí |
| ¿Se identificaron datos sensibles? | Sí |
| ¿Se fijó normalización de identificadores comerciales? | Sí |
| ¿Se preserva historial comercial? | Sí |
| ¿Se resolvió país en direcciones? | Sí |
| ¿Se resolvió idioma histórico de PedidoItem? | Sí |
| ¿Pedido y Pago poseen compatibilidad de estados? | Sí |
| ¿Se evita duplicar una Edición en Pedido? | Sí |
| ¿Se evita aplicar dos veces SALE/CANCELLATION? | Sí |
| ¿Se eliminó un estado de Carrito no sustentado por caso de uso? | Sí |
| ¿Se introdujeron nuevas entidades fuera del alcance? | No |
| ¿Se seleccionaron prematuramente tipos PostgreSQL? | No |
| ¿Quedan TBD críticos de semántica de datos? | No |

---

# 42. Criterio de aprobación

El Diccionario de Datos v1.1 pasa a estado **BASELINE APROBADA**: las correcciones `DD-COR-001` a `DD-COR-012` quedan aceptadas y retroalimentadas a la revisión v1.1 de:

- Use Case Baseline;
- DER Lógico.

Una vez aprobadas, la semántica de los datos no deberá modificarse durante la implementación para adaptarla al código. Cualquier cambio deberá seguir gestión de cambio y trazabilidad.

---

# 43. Próxima etapa

Con el Diccionario de Datos validado, la secuencia recomendada es:

```text
Use Case Baseline
        ↓
DER Lógico
        ↓
Diccionario de Datos
        ↓
Database API Contract
        ↓
Modelo físico PostgreSQL
        ↓
Flyway
        ↓
SP / Functions / Triggers
        ↓
REST API Contract
        ↓
Implementación
```

El siguiente documento, **Database API Contract v1.0**, deberá definir por caso de uso:

- rutina pública de PostgreSQL;
- tipo: Procedure o Function;
- parámetros de entrada;
- resultado;
- códigos de error de dominio;
- transacción;
- tablas/entidades afectadas;
- invariantes ejecutadas;
- permisos funcionales esperados;
- idempotencia/concurrencia donde corresponda.

---

# 44. Historial del documento

| Versión | Fecha | Estado | Descripción |
|---|---|---|---|
| 1.0 | 2026-09-23 | CANDIDATO A BASELINE | Primer diccionario formal de PLIEGO. Audita UCB v1.0 y DER Lógico v1.0, define semántica de las 19 entidades y resuelve doce defectos/ambigüedades antes del modelo físico. |
| 1.1 | 2026-09-23 | BASELINE | Revisión arquitectónica: cierra teléfono/idioma/país canónicos, atribución de portada, ciclo de vida de Referencia, matriz CANCELLED+PENDING inválido, CANCELLATION exige SALE previo, bajo-stock con umbral y trazabilidad DD-COR-012; retroalimenta UCB/DER a v1.1. |

---

# 45. Referencias del proyecto

- `docs/requirements/use-case-baseline-v1.0.md`
- `docs/domain/logical-erd-v1.0.md`
- Architecture Baseline de PLIEGO: Java 25 + Spring Boot + PostgreSQL + Flyway; lógica de negocio centrada en PostgreSQL; sin ORM; frontend posterior y desacoplado.
- ISO/IEC/IEEE 29148:2018 — Requirements Engineering.
- OMG UML 2.5.1 — referencia de modelado conceptual.
