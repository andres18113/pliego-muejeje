# PLIEGO — Use Case Baseline v1.0

**Documento:** UCB-PLIEGO-001  
**Versión:** 1.1  
**Estado:** BASELINE APROBADA PARA DISEÑO LÓGICO  
**Fecha:** 2026-09-23  
**Proyecto:** PLIEGO  
**Tipo de documento:** Especificación de casos de uso y baseline funcional  
**Ámbito:** Backend, lógica de negocio y persistencia  
**Frontend:** Fuera del alcance de implementación de esta baseline; la API debe permitir su incorporación posterior.  

---

## 1. Propósito

Este documento establece la **baseline funcional de casos de uso de PLIEGO** y constituye la fuente de verdad para las siguientes etapas del ciclo de vida:

1. diseño del modelo lógico de datos;
2. elaboración del DER;
3. diccionario de datos;
4. definición de reglas de negocio;
5. diseño de la Database API de PostgreSQL;
6. definición de Stored Procedures, Functions, Triggers y Constraints;
7. diseño de la API REST;
8. diseño de pruebas;
9. implementación por Codex/Claude u otros agentes;
10. validación y mantenimiento posterior.

El propósito principal es reducir la ambigüedad funcional antes del diseño físico y de la implementación. Ninguna entidad, relación, transición de estado o regla de negocio crítica debería ser incorporada posteriormente sin estar justificada por esta baseline o por una solicitud formal de cambio.

---

## 2. Enfoque de Ingeniería de Software

La especificación adopta principios de Ingeniería de Requisitos consistentes con **ISO/IEC/IEEE 29148:2018** y utiliza terminología compatible con **UML 2.5.1** para actores y casos de uso.

La baseline sigue el proceso:

**Elicitación → Análisis → Especificación → Validación → Baseline → Trazabilidad → Gestión del cambio**

### 2.1 Criterios de calidad de los requisitos

Cada requisito y caso de uso deberá ser, en la medida aplicable:

- necesario;
- inequívoco;
- consistente;
- factible;
- verificable;
- trazable;
- suficientemente completo;
- independiente de decisiones de implementación que no sean arquitectónicamente obligatorias.

### 2.2 Lenguaje normativo

En este documento:

- **DEBERÁ** indica un requisito obligatorio.
- **NO DEBERÁ** indica una prohibición obligatoria.
- **PODRÁ** indica comportamiento permitido pero no obligatorio.
- **FUERA DE ALCANCE** indica comportamiento deliberadamente excluido de PLIEGO v1.

---

## 3. Contexto del sistema

PLIEGO es un sistema de comercio electrónico especializado en la venta de libros físicos.

La arquitectura aprobada es:

```text
Cliente API / Frontend futuro
            │
            │ HTTP + JSON
            ▼
       Spring Boot
            │
            │ Database API
            ▼
       PostgreSQL
            │
            ├── Stored Procedures
            ├── Functions
            ├── Triggers
            └── Constraints
```

### 3.1 Principios arquitectónicos vinculantes

- Backend: **Java 25 + Spring Boot**.
- Motor de datos: **PostgreSQL**.
- Evolución de la BD: **Flyway**.
- No se utilizará JPA ni Hibernate.
- Spring Boot accederá a operaciones de negocio mediante **Gateways JDBC**.
- La lógica de negocio autoritativa residirá en PostgreSQL.
- Controllers y Services no contendrán SQL de negocio.
- El backend expondrá una API REST versionada bajo `/api/v1`.
- No se implementará frontend en esta etapa.
- La arquitectura no deberá impedir que un frontend web o móvil consuma posteriormente la misma API.
- No se utilizará Docker.
- Git y GitHub serán utilizados para control de versiones y colaboración.

---

## 4. Alcance funcional de PLIEGO v1

### 4.1 Incluido

PLIEGO v1 incluye:

- registro y autenticación;
- roles `CUSTOMER` y `ADMIN`;
- perfil del cliente;
- direcciones;
- autores;
- editoriales;
- categorías y subcategorías;
- libros;
- ediciones;
- portadas y metadatos de licencia;
- inventario por edición;
- movimientos de inventario;
- carrito;
- checkout;
- pedidos;
- historial de estados;
- pago académico simulado;
- cancelación;
- devolución lógica del pago simulado;
- API REST;
- documentación OpenAPI;
- migraciones Flyway;
- auditoría funcional mínima mediante historiales;
- GitHub y CI.

### 4.2 Fuera de alcance

Quedan fuera de PLIEGO v1:

- frontend;
- aplicación móvil;
- múltiples sucursales;
- múltiples bodegas;
- proveedores y compras a proveedores;
- reservas de stock;
- eBooks;
- archivos digitales;
- recomendaciones mediante IA;
- wishlist;
- reseñas;
- ratings;
- cupones;
- promociones;
- impuestos configurables;
- cálculo de costos de envío;
- integración SRI;
- pasarela de pago real;
- transportistas;
- tracking logístico;
- marketplace;
- microservicios;
- Redis;
- Kafka/RabbitMQ;
- Docker;
- Kubernetes.

---

## 5. Decisiones de dominio congeladas

Estas decisiones forman parte de la baseline y no deben modificarse de forma implícita durante la implementación.

| Tema | Decisión PLIEGO v1 |
|---|---|
| Libro y edición | Son conceptos distintos |
| Unidad comercial | La **Edición** es el elemento que se vende |
| Precio | Pertenece a la Edición |
| ISBN | Pertenece a la Edición |
| SKU | Pertenece a la Edición |
| Editorial | Pertenece a la Edición |
| Autor | Se relaciona con Libro N:M |
| Categoría | Se relaciona con Libro N:M |
| Categorías | Máximo dos niveles |
| Inventario | Un inventario global por Edición |
| Carrito | Máximo un carrito `ACTIVE` por Cliente |
| Stock en carrito | No se reserva |
| Precio en carrito | Precio vigente |
| Precio en pedido | Snapshot |
| Dirección de pedido | Snapshot |
| Datos bibliográficos del pedido | Snapshot |
| Pago | Simulado y síncrono |
| Intentos de pago | Un Pago por Pedido en v1 |
| Moneda | USD |
| Descuentos | No existen en v1 |
| Impuestos adicionales | No se calculan en v1 |
| Costo de envío | 0 en v1 |
| Total | Igual al subtotal en v1 |
| Borrado de catálogo | Borrado lógico por estado |
| Movimientos de inventario | Inmutables |
| Historial de pedido | Obligatorio |
| Admin inicial | Aprovisionado mediante configuración/migración controlada con secretos por entorno (nunca en Git); no por registro público |

---

## 6. Actores

### ACT-01 — Visitante

Usuario no autenticado.

Puede:

- registrarse;
- autenticarse;
- consultar catálogo;
- buscar libros;
- consultar el detalle de una edición.

### ACT-02 — Cliente

Usuario autenticado con rol `CUSTOMER`.

Hereda las capacidades públicas del Visitante y además puede:

- gestionar su perfil;
- gestionar sus direcciones;
- gestionar su carrito;
- realizar checkout;
- consultar sus pedidos;
- cancelar pedidos permitidos.

### ACT-03 — Administrador

Usuario autenticado con rol `ADMIN`.

Puede:

- gestionar autores;
- gestionar editoriales;
- gestionar categorías;
- gestionar libros;
- gestionar ediciones;
- consultar inventario;
- registrar ajustes/entradas;
- definir stock mínimo;
- gestionar estados de pedidos;
- consultar pedidos;
- bloquear o desbloquear cuentas de clientes.

---

## 7. Catálogo de casos de uso

| ID | Caso de uso | Actor principal |
|---|---|---|
| CU-AUTH-01 | Registrar cliente | Visitante |
| CU-AUTH-02 | Autenticar usuario | Visitante |
| CU-ADM-SEC-01 | Gestionar estado de cliente | Administrador |
| CU-CUS-01 | Gestionar perfil | Cliente |
| CU-CUS-02 | Gestionar direcciones | Cliente |
| CU-CAT-01 | Consultar y buscar catálogo | Visitante / Cliente |
| CU-CAT-02 | Consultar detalle de edición | Visitante / Cliente |
| CU-ADM-CAT-01 | Gestionar autores | Administrador |
| CU-ADM-CAT-02 | Gestionar editoriales | Administrador |
| CU-ADM-CAT-03 | Gestionar categorías | Administrador |
| CU-ADM-CAT-04 | Gestionar libros | Administrador |
| CU-ADM-CAT-05 | Gestionar ediciones | Administrador |
| CU-INV-01 | Consultar inventario | Administrador |
| CU-INV-02 | Registrar movimiento administrativo de inventario | Administrador |
| CU-INV-03 | Configurar stock mínimo | Administrador |
| CU-CART-01 | Consultar carrito | Cliente |
| CU-CART-02 | Agregar edición al carrito | Cliente |
| CU-CART-03 | Modificar cantidad de item | Cliente |
| CU-CART-04 | Eliminar item del carrito | Cliente |
| CU-SAL-01 | Realizar checkout | Cliente |
| CU-PAY-01 | Procesar pago simulado | Sistema |
| CU-SAL-02 | Consultar pedidos propios | Cliente |
| CU-SAL-03 | Cancelar pedido | Cliente |
| CU-ADM-SAL-01 | Gestionar pedidos | Administrador |

**Total: 24 casos de uso.**

---

# 8. Especificación detallada de casos de uso

## CU-AUTH-01 — Registrar cliente

**Objetivo:** Crear una cuenta de cliente válida para PLIEGO.  
**Actor principal:** Visitante.  
**Disparador:** El visitante solicita crear una cuenta.

### Datos de entrada

- email;
- password;
- nombres;
- apellidos;
- teléfono opcional.

### Precondiciones

- El actor no necesita estar autenticado.
- El correo debe tener un formato sintácticamente válido.
- La contraseña debe cumplir la política técnica definida por el backend.

### Flujo principal

1. El Visitante envía la solicitud de registro.
2. Spring Boot valida estructura y formato del request.
3. Spring Security genera un hash seguro de la contraseña.
4. PostgreSQL normaliza el email.
5. PostgreSQL verifica que no exista otro Usuario con el mismo email normalizado.
6. PostgreSQL crea el Usuario con rol `CUSTOMER`.
7. PostgreSQL crea exactamente un Cliente asociado al Usuario.
8. Usuario y Cliente se confirman dentro de la misma transacción.
9. El sistema devuelve confirmación de registro.

### Flujos alternativos

**A1 — Email existente**

1. PostgreSQL detecta un email ya registrado.
2. La operación se rechaza.
3. No se crea Usuario.
4. No se crea Cliente.

Resultado de dominio: `EMAIL_ALREADY_EXISTS`.

**A2 — Datos inválidos**

La operación se rechaza sin persistencia parcial.

### Postcondiciones de éxito

- Existe un Usuario.
- Existe exactamente un Cliente asociado.
- El Usuario posee rol `CUSTOMER`.
- El Usuario queda en estado `ACTIVE`.
- La contraseña nunca se almacena en texto plano.

### Reglas relacionadas

- BR-SEC-001
- BR-SEC-002
- BR-CUS-001

### Entidades afectadas

- Usuario
- Cliente

### Criterios de aceptación

- No pueden existir dos usuarios con el mismo email normalizado.
- Nunca puede existir un Cliente creado por este caso sin su Usuario correspondiente.
- Si falla la creación de Cliente, también debe revertirse la creación de Usuario.

---

## CU-AUTH-02 — Autenticar usuario

**Objetivo:** Autenticar a un Usuario registrado y habilitado.  
**Actor principal:** Visitante.

### Entrada

- email;
- password.

### Flujo principal

1. El Visitante proporciona credenciales.
2. PostgreSQL localiza al Usuario mediante email normalizado.
3. PostgreSQL verifica que el Usuario esté `ACTIVE`.
4. Spring Security verifica la contraseña recibida contra el hash almacenado.
5. Si la contraseña es válida, Spring Boot genera el mecanismo de autenticación stateless de la aplicación (token firmado, p. ej. JWT; el REST/Security contract definirá formato, claims y expiración).
6. La respuesta identifica el rol del Usuario.

### Flujos alternativos

- Usuario inexistente.
- Contraseña incorrecta.
- Usuario bloqueado.

Externamente estos escenarios podrán producir una respuesta de autenticación inválida sin revelar detalles innecesarios.

### Postcondiciones

No se modifica el dominio comercial.

### Entidades

- Usuario

---

## CU-ADM-SEC-01 — Gestionar estado de cliente

**Objetivo:** Permitir que un Administrador bloquee o reactive el acceso de una cuenta de cliente.  
**Actor:** Administrador.

### Precondiciones

- Administrador autenticado.
- El Usuario objetivo debe existir.
- El Usuario objetivo debe tener rol `CUSTOMER`.

### Flujo principal — Bloquear

1. El Administrador selecciona un Cliente.
2. El sistema identifica el Usuario asociado.
3. PostgreSQL cambia `Usuario.estado` de `ACTIVE` a `BLOCKED`.
4. Se confirma la operación.

### Flujo principal — Reactivar

1. El Administrador selecciona una cuenta `BLOCKED`.
2. PostgreSQL cambia su estado a `ACTIVE`.
3. Se confirma la operación.

### Reglas

- Un Cliente bloqueado no puede autenticarse.
- El bloqueo no elimina datos históricos.
- El bloqueo no elimina carrito ni pedidos.

### Entidades

- Usuario
- Cliente

---

## CU-CUS-01 — Gestionar perfil

**Objetivo:** Consultar o modificar los datos básicos del Cliente autenticado.  
**Actor:** Cliente.

### Precondiciones

- Usuario autenticado.
- Usuario con rol `CUSTOMER`.
- Cliente asociado.

### Operaciones permitidas

- consultar nombres;
- consultar apellidos;
- consultar teléfono;
- actualizar nombres;
- actualizar apellidos;
- actualizar teléfono.

### Fuera de alcance

El cambio de email y el cambio de contraseña no forman parte de PLIEGO v1.

### Regla de autorización

Un Cliente solo puede acceder a su propio perfil.

### Entidades

- Usuario
- Cliente

---

## CU-CUS-02 — Gestionar direcciones

**Objetivo:** Administrar las direcciones de entrega del Cliente.  
**Actor:** Cliente.

### Operaciones

- listar;
- crear;
- actualizar;
- eliminar;
- definir como principal.

### Datos mínimos de una dirección

- alias;
- destinatario;
- dirección línea 1;
- ciudad;
- provincia;
- país (`PaisCodigo` ISO 3166-1 alpha-2, p. ej. `EC`);
- teléfono.

### Datos opcionales

- dirección línea 2;
- código postal;
- referencia.

### Reglas

1. Un Cliente puede tener cero o más Direcciones.
2. Como máximo una Dirección puede ser principal.
3. Un Cliente puede no tener dirección principal.
4. Una Dirección solo puede ser modificada por su propietario.
5. Establecer una Dirección como principal debe desmarcar la anterior dentro de la misma transacción.
6. Eliminar una Dirección no modifica pedidos históricos.
7. La Dirección puede eliminarse físicamente porque los pedidos utilizan snapshots independientes.
8. Si la Dirección seleccionada no existe o no pertenece al Cliente en el instante transaccional del checkout, el checkout se rechaza con error de dominio.

### Entidades

- Cliente
- Direccion

---

## CU-CAT-01 — Consultar y buscar catálogo

**Objetivo:** Permitir el descubrimiento de libros y ediciones comercialmente disponibles.  
**Actores:** Visitante, Cliente.  
**Autenticación:** No requerida.

### Parámetros de búsqueda

- texto de título;
- autor;
- ISBN;
- categoría.

### Filtros

- categoría;
- precio mínimo;
- precio máximo;
- idioma;
- formato.

### Ordenamiento

- título ascendente;
- precio ascendente;
- precio descendente.

### Paginación

- tamaño por defecto: 20;
- tamaño máximo: 50.

### Flujo principal

1. El actor solicita el catálogo con cero o más filtros.
2. PostgreSQL obtiene Libros y Ediciones que cumplan los criterios.
3. Solo se consideran comercialmente publicables cuando `Libro.estado = ACTIVE` y `Edicion.estado = ACTIVE`. Un Autor, Editorial o Categoría `INACTIVE` no oculta ni invalida ediciones ya existentes; solo impide nuevas asociaciones.
4. Se determina disponibilidad a partir de Inventario.
5. Se aplica ordenamiento.
6. Se aplica paginación.
7. El sistema devuelve la página solicitada.

### Regla de disponibilidad

Una Edición con `stock_actual = 0` puede aparecer en catálogo, pero debe informarse como no disponible.

### Resultado mínimo

- editionId;
- bookId;
- título;
- autores;
- editorial;
- ISBN cuando exista;
- precio;
- portada;
- formato;
- idioma;
- disponibilidad.

### Entidades

- Libro
- Edicion
- Autor
- LibroAutor
- Categoria
- LibroCategoria
- Editorial
- Inventario

---

## CU-CAT-02 — Consultar detalle de edición

**Objetivo:** Mostrar información bibliográfica y comercial detallada de una Edición.  
**Actores:** Visitante, Cliente.  
**Autenticación:** No requerida.

### Entrada

- identificador de Edición.

### Resultado

- título;
- subtítulo;
- sinopsis;
- autores ordenados;
- categorías;
- editorial;
- ISBN;
- SKU;
- idioma;
- formato;
- número de páginas;
- fecha de publicación;
- precio actual;
- portada;
- licencia de portada;
- fuente de portada;
- atribución cuando aplique;
- disponibilidad.

### Regla

Información administrativa de inventario no debe exponerse como parte del detalle público.

### Entidades

- Libro
- Edicion
- Autor
- LibroAutor
- Categoria
- LibroCategoria
- Editorial
- Inventario

---

## CU-ADM-CAT-01 — Gestionar autores

**Objetivo:** Mantener el catálogo de Autores.  
**Actor:** Administrador.

### Operaciones

- crear;
- consultar;
- actualizar;
- desactivar;
- reactivar.

### Datos

- nombre obligatorio;
- biografía opcional;
- estado.

### Reglas

1. El nombre del Autor no es una clave única.
2. Dos autores distintos pueden compartir nombre.
3. No se realiza DELETE físico.
4. Un Autor `INACTIVE` no puede asociarse a nuevos Libros.
5. Desactivar un Autor no elimina relaciones históricas `LibroAutor`.

### Entidades

- Autor
- LibroAutor

---

## CU-ADM-CAT-02 — Gestionar editoriales

**Objetivo:** Mantener el catálogo de Editoriales.  
**Actor:** Administrador.

### Operaciones

- crear;
- consultar;
- actualizar;
- desactivar;
- reactivar.

### Reglas

1. Nombre obligatorio.
2. No se realiza DELETE físico.
3. Una Editorial `INACTIVE` no puede asignarse a nuevas Ediciones.
4. Desactivar una Editorial no elimina Ediciones ya existentes.

### Entidades

- Editorial
- Edicion

---

## CU-ADM-CAT-03 — Gestionar categorías

**Objetivo:** Mantener la clasificación temática de los Libros.  
**Actor:** Administrador.

### Modelo jerárquico

PLIEGO v1 admite máximo dos niveles:

```text
Categoría raíz
└── Subcategoría
```

### Datos

- nombre;
- slug;
- descripción opcional;
- parent_id opcional;
- estado.

### Reglas

1. Una categoría raíz posee `parent_id = NULL`.
2. Una subcategoría debe apuntar a una categoría raíz.
3. Una subcategoría no puede poseer hijos.
4. No pueden existir ciclos.
5. `slug` debe ser único.
6. No existe DELETE físico.
7. Una Categoría `INACTIVE` no puede asignarse a nuevos Libros.
8. Desactivar una categoría no elimina `LibroCategoria`.

### Entidades

- Categoria
- LibroCategoria

---

## CU-ADM-CAT-04 — Gestionar libros

**Objetivo:** Mantener las obras intelectuales disponibles en el catálogo.  
**Actor:** Administrador.

### Datos obligatorios para creación

- título;
- al menos un Autor;
- al menos una Categoría.

### Datos opcionales

- subtítulo;
- sinopsis.

### Flujo de creación

1. El Administrador proporciona datos del Libro.
2. PostgreSQL valida que todos los Autores existan y estén `ACTIVE`.
3. PostgreSQL valida que todas las Categorías existan y estén `ACTIVE`.
4. PostgreSQL crea el Libro.
5. PostgreSQL crea las asociaciones `LibroAutor`.
6. PostgreSQL registra el orden de autoría.
7. PostgreSQL crea las asociaciones `LibroCategoria`.
8. Toda la operación se confirma de forma atómica.

### Operaciones posteriores

- actualizar metadatos;
- modificar autores;
- modificar orden de autoría;
- modificar categorías;
- desactivar;
- reactivar.

### Reglas

1. Un Libro `ACTIVE` debe poseer al menos un Autor.
2. Un Libro `ACTIVE` debe poseer al menos una Categoría.
3. No existe DELETE físico.
4. Desactivar el Libro no elimina Ediciones.
5. Si el Libro está `INACTIVE`, ninguna de sus Ediciones puede publicarse comercialmente aunque la Edición esté `ACTIVE`.

### Entidades

- Libro
- Autor
- LibroAutor
- Categoria
- LibroCategoria

---

## CU-ADM-CAT-05 — Gestionar ediciones

**Objetivo:** Mantener las versiones comerciales concretas de los Libros.  
**Actor:** Administrador.

### Datos obligatorios

- Libro;
- Editorial;
- SKU;
- idioma;
- formato;
- número de páginas;
- precio.

### Datos opcionales

- ISBN-13;
- fecha de publicación;
- portada y metadatos asociados.

### Formatos permitidos

- `PAPERBACK`;
- `HARDCOVER`.

### Reglas de ISBN

Si se proporciona ISBN:

1. debe contener 13 dígitos;
2. debe tener checksum ISBN-13 válido;
3. debe ser único entre Ediciones.

### Reglas de SKU

- obligatorio;
- único;
- estable después de la creación.

### Reglas comerciales

- precio > 0;
- número de páginas > 0;
- la Editorial debe estar `ACTIVE` al crear la Edición y al reasignarla;
- el Libro debe existir (puede estar `INACTIVE`; la publicabilidad exige ambos `ACTIVE` según BR-CAT-010);
- la Edición utiliza moneda USD.

### Portada

Cuando existe portada se podrán registrar:

- `cover_url`;
- `cover_license`;
- `cover_source_url`;
- `cover_attribution`.

Si se registra una portada, su licencia y fuente deben quedar identificadas.

### Creación de inventario

Al crear una Edición:

1. PostgreSQL crea la Edición.
2. PostgreSQL crea automáticamente su Inventario.
3. `stock_actual = 0`.
4. `stock_minimo = 0`.
5. Edición e Inventario forman una operación atómica.

### Operaciones posteriores

- corregir metadatos;
- cambiar precio;
- actualizar portada;
- desactivar;
- reactivar.

### Identidad estable

Después de creada:

- la asociación con Libro no se cambia;
- el SKU no se cambia.

Si se requiere representar otra edición comercial, se crea una Edición distinta.

### Entidades

- Libro
- Editorial
- Edicion
- Inventario

---

## CU-INV-01 — Consultar inventario

**Objetivo:** Permitir al Administrador conocer existencias y trazabilidad.  
**Actor:** Administrador.

### Información resumida

- Edición;
- SKU;
- ISBN;
- título;
- stock actual;
- stock mínimo;
- indicador de bajo stock;
- estado de Edición.

### Definición de bajo stock

`bajo_stock = stock_minimo > 0 AND stock_actual <= stock_minimo`

(`stock_minimo = 0` significa "sin umbral": una edición recién creada con `0/0` no nace en bajo stock.)

### Filtros

- edición;
- título;
- SKU;
- solo bajo stock.

### Historial

El Administrador podrá consultar los Movimientos de Inventario asociados a una Edición.

### Entidades

- Inventario
- MovimientoInventario
- Edicion
- Libro

---

## CU-INV-02 — Registrar movimiento administrativo de inventario

**Objetivo:** Modificar existencias de manera explícita y trazable.  
**Actor:** Administrador.

### Tipos administrativos permitidos

- `ENTRY`;
- `ADJUSTMENT_IN`;
- `ADJUSTMENT_OUT`.

### Tipos reservados al sistema

- `SALE`;
- `CANCELLATION`.

### Datos del movimiento

- Inventario;
- tipo;
- cantidad;
- stock anterior;
- stock posterior;
- motivo;
- fecha;
- usuario responsable cuando aplique.

### Reglas

1. `cantidad` se almacena como valor positivo.
2. El Tipo determina si la operación suma o resta.
3. El stock posterior nunca puede ser negativo.
4. Todo cambio confirmado de stock debe poseer MovimientoInventario.
5. MovimientoInventario es inmutable.
6. No se edita ni elimina un movimiento confirmado.
7. Los errores se corrigen mediante un movimiento compensatorio.

### Entidades

- Inventario
- MovimientoInventario
- Usuario

---

## CU-INV-03 — Configurar stock mínimo

**Objetivo:** Definir el umbral de bajo inventario de una Edición.  
**Actor:** Administrador.

### Entrada

- Edición;
- nuevo `stock_minimo`.

### Reglas

- `stock_minimo >= 0`.
- Cambiar stock mínimo no modifica stock actual.
- No genera MovimientoInventario porque no representa una variación de existencias.

### Entidades

- Inventario

---

## CU-CART-01 — Consultar carrito

**Objetivo:** Consultar el carrito activo del Cliente.  
**Actor:** Cliente.

### Precondiciones

Cliente autenticado y habilitado.

### Reglas

1. Un Cliente puede poseer múltiples Carritos históricos.
2. Como máximo uno puede estar `ACTIVE`.
3. Si no existe carrito activo, se devuelve conceptualmente un carrito vacío sin crear necesariamente una fila física.
4. Los precios mostrados corresponden al precio vigente de cada Edición.
5. El carrito no constituye una reserva de inventario.
6. Los items cuya Edición o Libro hayan pasado a `INACTIVE` se siguen mostrando, marcados como no disponibles; el checkout los rechaza.
7. Agregar direcciona por `editionId`; modificar/eliminar direccionan por identificador de item dentro del carrito del Cliente.

### Resultado

- items;
- cantidad;
- precio vigente;
- subtotal por item;
- total actual.

### Entidades

- Cliente
- Carrito
- CarritoItem
- Edicion

---

## CU-CART-02 — Agregar edición al carrito

**Objetivo:** Agregar una Edición comercializable al carrito activo.  
**Actor:** Cliente.

### Entrada

- editionId;
- cantidad.

### Precondiciones

- Cliente `ACTIVE`;
- cantidad > 0.

### Flujo principal

1. PostgreSQL localiza el Carrito `ACTIVE`.
2. Si no existe, lo crea.
3. PostgreSQL verifica la existencia de la Edición.
4. Verifica `Edicion.estado = ACTIVE`.
5. Verifica `Libro.estado = ACTIVE`.
6. Consulta Inventario.
7. Valida que la cantidad total solicitada no exceda `stock_actual`.
8. Si la Edición no existe en el carrito, crea un CarritoItem.
9. Si ya existe, incrementa su cantidad.
10. Confirma la operación.

### Reglas

- Una misma Edición aparece una única vez por Carrito.
- Restricción conceptual: `UNIQUE(carrito_id, edicion_id)`.
- Agregar al carrito no reserva stock.
- La disponibilidad se valida nuevamente durante checkout.

### Alternativas

- Edición inexistente.
- Libro inactivo.
- Edición inactiva.
- Cantidad inválida.
- Stock insuficiente.

### Entidades

- Carrito
- CarritoItem
- Libro
- Edicion
- Inventario

---

## CU-CART-03 — Modificar cantidad de item

**Objetivo:** Cambiar la cantidad solicitada para una Edición ya existente en el carrito.  
**Actor:** Cliente.

### Entrada

- identificador de CarritoItem;
- nueva cantidad.

### Reglas

- nueva cantidad > 0;
- nueva cantidad <= stock_actual;
- el Carrito debe estar `ACTIVE`;
- el Carrito debe pertenecer al Cliente autenticado.

Cantidad cero **no** significa eliminación. La eliminación utiliza CU-CART-04.

### Entidades

- Carrito
- CarritoItem
- Inventario

---

## CU-CART-04 — Eliminar item del carrito

**Objetivo:** Retirar una Edición del carrito activo.  
**Actor:** Cliente.

### Reglas

- el Carrito debe pertenecer al Cliente;
- el Carrito debe estar `ACTIVE`;
- el CarritoItem puede eliminarse físicamente;
- eliminar el último item no elimina el Carrito;
- el Carrito continúa `ACTIVE` y vacío.

### Entidades

- Carrito
- CarritoItem

---

## CU-SAL-01 — Realizar checkout

**Objetivo:** Convertir un Carrito activo en una compra consistente.  
**Actor:** Cliente.  
**Caso incluido:** `<<include>> CU-PAY-01 Procesar pago simulado`.

### Entrada

- identificador de Dirección;
- método de pago soportado.

### Precondiciones

- Cliente autenticado;
- Cliente `ACTIVE`;
- Carrito `ACTIVE`;
- Carrito con al menos un item;
- Dirección existente;
- Dirección perteneciente al Cliente.

### Flujo principal

1. PostgreSQL obtiene el Carrito `ACTIVE` del Cliente.
2. PostgreSQL bloquea los recursos necesarios para evitar checkout concurrente inconsistente.
3. Verifica que el carrito contenga al menos un CarritoItem.
4. Obtiene todas las Ediciones involucradas.
5. Valida nuevamente que cada Libro esté `ACTIVE`.
6. Valida nuevamente que cada Edición esté `ACTIVE`.
7. Obtiene los precios vigentes.
8. Obtiene y bloquea los Inventarios involucrados.
9. Verifica stock suficiente para cada item.
10. Calcula el subtotal de cada item.
11. Calcula el subtotal del Pedido.
12. Define `total = subtotal`.
13. Crea el Pedido en estado `PENDING_PAYMENT`.
14. Registra el primer PedidoEstadoHistorial.
15. Crea PedidoItem para cada item del carrito.
16. Copia snapshots comerciales a PedidoItem.
17. Copia la Dirección seleccionada a PedidoDireccion.
18. Crea un Pago `PENDING`.
19. Incluye CU-PAY-01.

### Resultado si el pago es aprobado

20. Pago cambia a `APPROVED`.
21. PostgreSQL descuenta Inventario.
22. Por cada modificación se registra MovimientoInventario `SALE`.
23. Pedido cambia a `CONFIRMED`.
24. Se registra PedidoEstadoHistorial.
25. Carrito cambia a `CHECKED_OUT`.
26. La transacción se confirma.

### Resultado si el pago es rechazado

20. Pago cambia a `REJECTED`.
21. Pedido cambia a `CANCELLED`.
22. Se registra PedidoEstadoHistorial.
23. No se descuenta Inventario.
24. Carrito permanece `ACTIVE`.
25. La transacción confirma el resultado comercial rechazado.

### Fallo técnico

Si ocurre un error técnico que impide producir un estado comercial consistente, toda la operación se revierte.

### Reglas de atomicidad

Nunca debe existir un resultado confirmado con:

- Pedido `CONFIRMED` sin descuento de stock;
- stock descontado sin Pedido `CONFIRMED`;
- MovimientoInventario `SALE` sin su disminución de stock;
- Pedido sin PedidoItem;
- Pedido sin PedidoDireccion;
- Pedido sin Pago.

### Regla de concurrencia

Cuando dos checkouts compiten por las últimas unidades, solo aquellos para los que exista stock suficiente pueden confirmar. El stock nunca puede volverse negativo.

El Database API Contract definirá el orden de bloqueo (carrito/pedido e inventarios por `EdicionId` ordenado) y el código de error de dominio del perdedor. La demarcación transaccional vive en Spring Boot (Service/Gateway); la atomicidad de negocio vive en la rutina PostgreSQL, que ejecuta cada operación en una única transacción.

### Entidades

- Cliente
- Direccion
- Carrito
- CarritoItem
- Libro
- Edicion
- Inventario
- MovimientoInventario
- Pedido
- PedidoItem
- PedidoDireccion
- PedidoEstadoHistorial
- Pago

---

## CU-PAY-01 — Procesar pago simulado

**Objetivo:** Permitir cerrar académicamente el ciclo de compra sin integrar una pasarela externa.  
**Actor:** Sistema.  
**Actor iniciador:** CU-SAL-01.

### Precondiciones

- existe Pedido `PENDING_PAYMENT`;
- existe Pago `PENDING`;
- monto del Pago = total del Pedido.

### Métodos soportados en v1

- `CARD`;
- `TRANSFER`.

### Flujo principal — Aprobado

1. El simulador procesa el intento académico.
2. Produce resultado `APPROVED`.
3. Se asigna una referencia de pago simulada.
4. El control retorna al checkout.

### Flujo alternativo — Rechazado

1. El simulador produce `REJECTED`.
2. Se registra la referencia o motivo académico correspondiente.
3. El control retorna al checkout.

### Reglas

- No se almacena CVV.
- No se almacena número completo de tarjeta.
- El simulador no representa una pasarela financiera real.
- El importe procesado debe coincidir con el total del Pedido.
- El resultado (`APPROVED`/`REJECTED`) debe ser determinista y controlable desde el checkout con fines académicos y de prueba (el Database API Contract definirá el parámetro); nunca aleatorio sin semilla.

### Entidades

- Pedido
- Pago

---

## CU-SAL-02 — Consultar pedidos propios

**Objetivo:** Permitir al Cliente consultar su historial comercial.  
**Actor:** Cliente.

### Operaciones

- listar pedidos;
- consultar detalle.

### Resumen mínimo

- orderId;
- fecha;
- estado;
- total;
- estado de pago.

### Detalle mínimo

- items con snapshot;
- dirección snapshot;
- Pago;
- historial de estados.

### Regla de autorización

Un Cliente únicamente puede consultar sus propios Pedidos.

### Entidades

- Pedido
- PedidoItem
- PedidoDireccion
- Pago
- PedidoEstadoHistorial

---

## CU-SAL-03 — Cancelar pedido

**Objetivo:** Cancelar un Pedido cuando su estado todavía permite reversión comercial.  
**Actor:** Cliente propietario.

### Estados cancelables

- `CONFIRMED`;
- `PREPARING`.

### Estados no cancelables

- `PENDING_PAYMENT` (ningún Pedido observable post-commit está en este estado; la guarda existe por completitud);
- `SHIPPED`;
- `DELIVERED`;
- `CANCELLED`.

### Flujo principal

1. PostgreSQL bloquea el Pedido.
2. Verifica propiedad.
3. Verifica que el estado sea cancelable.
4. Cambia Pedido a `CANCELLED`.
5. Por cada PedidoItem restaura al Inventario la cantidad comprada.
6. Por cada restauración crea MovimientoInventario `CANCELLATION`.
7. Si Pago está `APPROVED`, cambia a `REFUNDED`.
8. Registra PedidoEstadoHistorial.
9. Confirma la transacción.

### Reglas

- No se elimina el Pedido.
- No se elimina el Pago.
- No se eliminan PedidoItem.
- La devolución de inventario y el cambio a `CANCELLED` son atómicos.
- La devolución del pago es simulada en v1.

### Entidades

- Pedido
- PedidoItem
- Pago
- Inventario
- MovimientoInventario
- PedidoEstadoHistorial

---

## CU-ADM-SAL-01 — Gestionar pedidos

**Objetivo:** Permitir al Administrador consultar y avanzar el flujo logístico de los Pedidos.  
**Actor:** Administrador.

### Consultas

- todos los pedidos;
- por estado;
- por rango de fecha;
- por cliente;
- detalle;
- historial.

### Transiciones administrativas permitidas

```text
CONFIRMED -> PREPARING
PREPARING -> SHIPPED
SHIPPED -> DELIVERED

CONFIRMED -> CANCELLED
PREPARING -> CANCELLED
```

### Transiciones prohibidas

Ejemplos:

```text
CONFIRMED -> DELIVERED
SHIPPED -> PREPARING
DELIVERED -> CANCELLED
CANCELLED -> CONFIRMED
```

### Regla de historial

Toda transición confirmada genera PedidoEstadoHistorial con:

- pedido;
- estado anterior;
- estado nuevo;
- fecha;
- origen (`USER` o `SYSTEM`);
- Usuario actor cuando el origen es `USER` (ausente en transiciones automáticas del checkout, p. ej. resolución del pago).

### Cancelación administrativa

Cuando el Administrador lleva un Pedido de `CONFIRMED` o `PREPARING` a `CANCELLED`, deben aplicarse las mismas reglas de restauración de inventario y refund simulado definidas en CU-SAL-03.

La transición a `CANCELLED` con efectos (restauración + refund) pertenece a una única rutina (`sp_order_cancel`); `sp_order_change_status` no implementa `CANCELLED` y la rechaza.

### Entidades

- Pedido
- PedidoEstadoHistorial
- PedidoItem
- Inventario
- MovimientoInventario
- Pago
- Usuario

---

# 9. Reglas de negocio consolidadas

## 9.1 Seguridad e identidad

| ID | Regla |
|---|---|
| BR-SEC-001 | El email normalizado de Usuario debe ser único. |
| BR-SEC-002 | La contraseña nunca debe persistirse en texto plano. |
| BR-SEC-003 | Solo un Usuario `ACTIVE` puede autenticarse. |
| BR-SEC-004 | Solo ADMIN puede ejecutar operaciones administrativas. |
| BR-SEC-005 | Un CUSTOMER solo puede operar sobre recursos propios. |

## 9.2 Cliente

| ID | Regla |
|---|---|
| BR-CUS-001 | Todo Usuario con rol CUSTOMER debe poseer exactamente un Cliente. |
| BR-CUS-002 | Un Cliente puede tener cero o más Direcciones. |
| BR-CUS-003 | Como máximo una Dirección por Cliente puede ser principal. |

## 9.3 Catálogo

| ID | Regla |
|---|---|
| BR-CAT-001 | Todo Libro debe tener título. |
| BR-CAT-002 | Un Libro ACTIVE debe tener al menos un Autor. |
| BR-CAT-003 | Un Libro ACTIVE debe tener al menos una Categoría. |
| BR-CAT-004 | Una Edición pertenece exactamente a un Libro. |
| BR-CAT-005 | Una Edición pertenece exactamente a una Editorial. |
| BR-CAT-006 | SKU es obligatorio y único. |
| BR-CAT-007 | ISBN-13, cuando exista, debe ser válido y único. |
| BR-CAT-008 | Precio de Edición > 0. |
| BR-CAT-009 | Número de páginas > 0. |
| BR-CAT-010 | Una Edición solo es publicable si Libro y Edición están ACTIVE. |
| BR-CAT-011 | Un Libro se relaciona N:M con Autor. |
| BR-CAT-012 | Un Libro se relaciona N:M con Categoría. |
| BR-CAT-013 | Las categorías poseen máximo dos niveles. |
| BR-CAT-014 | Una subcategoría no puede tener descendientes. |
| BR-CAT-015 | El orden de autoría debe conservarse. |

## 9.4 Inventario

| ID | Regla |
|---|---|
| BR-INV-001 | Cada Edición posee exactamente un Inventario en v1. |
| BR-INV-002 | stock_actual >= 0 siempre. |
| BR-INV-003 | stock_minimo >= 0. |
| BR-INV-004 | Todo cambio confirmado de stock genera MovimientoInventario. |
| BR-INV-005 | MovimientoInventario es inmutable. |
| BR-INV-006 | SALE solo puede ser generado por el proceso de checkout. |
| BR-INV-007 | CANCELLATION solo puede ser generado por cancelación de un Pedido previamente confirmado. |

## 9.5 Carrito

| ID | Regla |
|---|---|
| BR-CART-001 | Un Cliente puede tener como máximo un Carrito ACTIVE. |
| BR-CART-002 | La cantidad de CarritoItem debe ser > 0. |
| BR-CART-003 | La pareja (Carrito, Edición) es única. |
| BR-CART-004 | Una Edición no comercializable no puede agregarse. |
| BR-CART-005 | Agregar al carrito no reserva stock. |
| BR-CART-006 | El checkout vuelve a validar stock y precio. |

## 9.6 Pedido

| ID | Regla |
|---|---|
| BR-ORD-001 | El checkout solo opera sobre Carrito ACTIVE no vacío. |
| BR-ORD-002 | Pedido persistido debe poseer al menos un PedidoItem. |
| BR-ORD-003 | Pedido posee exactamente un PedidoDireccion en v1. |
| BR-ORD-004 | Pedido posee exactamente un Pago en v1. |
| BR-ORD-005 | PedidoItem conserva snapshots comerciales. |
| BR-ORD-006 | PedidoDireccion conserva snapshot independiente. |
| BR-ORD-007 | Checkout confirmado y descuento de inventario son atómicos. |
| BR-ORD-008 | Toda transición de Pedido genera historial. |
| BR-ORD-009 | Solo se permiten transiciones definidas por la máquina de estados. |
| BR-ORD-010 | total = subtotal en PLIEGO v1. |
| BR-ORD-011 | La moneda de PLIEGO v1 es USD. |

## 9.7 Pago

| ID | Regla |
|---|---|
| BR-PAY-001 | Monto del Pago debe ser igual al total del Pedido. |
| BR-PAY-002 | Pedido no puede quedar CONFIRMED sin Pago APPROVED. |
| BR-PAY-003 | Pago APPROVED puede pasar únicamente a REFUNDED. |
| BR-PAY-004 | Un Pedido cancelado después de aprobación debe reflejar Pago REFUNDED. |
| BR-PAY-005 | PLIEGO no persiste CVV ni número completo de tarjeta. |

---

# 10. Máquinas de estado

## 10.1 Usuario

```text
ACTIVE <-> BLOCKED
```

No se define borrado físico de Usuario en v1.

## 10.2 Libro, Edición, Autor, Editorial y Categoría

```text
ACTIVE <-> INACTIVE
```

## 10.3 Carrito

```text
ACTIVE -> CHECKED_OUT
```

`CHECKED_OUT` es final en v1.

`CANCELLED` queda fuera del dominio de Carrito en PLIEGO v1 (DD-COR-003): ningún caso de uso lo produce.

## 10.4 Pedido

```text
PENDING_PAYMENT
      │
      ├──> CONFIRMED -> PREPARING -> SHIPPED -> DELIVERED
      │         │           │
      │         └──────────> CANCELLED
      │                     ▲
      │                     │
      └--------------------> CANCELLED
```

| Estado actual | Estado siguiente permitido |
|---|---|
| PENDING_PAYMENT | CONFIRMED, CANCELLED |
| CONFIRMED | PREPARING, CANCELLED |
| PREPARING | SHIPPED, CANCELLED |
| SHIPPED | DELIVERED |
| DELIVERED | Ninguno |
| CANCELLED | Ninguno |

`PENDING_PAYMENT` es transitorio e intra-transaccional dentro de CU-SAL-01: se crea y se resuelve a `CONFIRMED` o `CANCELLED` en la misma transacción, por lo que ningún Pedido observable post-commit permanece en `PENDING_PAYMENT`. Cada checkout confirmado persiste dos registros de historial: el inicial (`NULL -> PENDING_PAYMENT`, `SYSTEM`) y el terminal (`PENDING_PAYMENT -> CONFIRMED` o `PENDING_PAYMENT -> CANCELLED`, `SYSTEM`).

## 10.5 Pago

```text
PENDING -> APPROVED -> REFUNDED
       \-> REJECTED
```

`REJECTED` y `REFUNDED` son finales.

---

# 11. Política de borrado

| Entidad | Política |
|---|---|
| Usuario | No se elimina físicamente |
| Cliente | No se elimina físicamente |
| Direccion | DELETE físico permitido |
| Autor | Estado ACTIVE/INACTIVE |
| Editorial | Estado ACTIVE/INACTIVE |
| Categoria | Estado ACTIVE/INACTIVE |
| Libro | Estado ACTIVE/INACTIVE |
| LibroAutor | Asociación actualizable; DELETE de relación permitido |
| LibroCategoria | Asociación actualizable; DELETE de relación permitido |
| Edicion | Estado ACTIVE/INACTIVE |
| Inventario | No se elimina |
| MovimientoInventario | Nunca se elimina |
| Carrito | No se elimina |
| CarritoItem | DELETE físico permitido |
| Pedido | Nunca se elimina |
| PedidoItem | Nunca se elimina |
| PedidoDireccion | Nunca se elimina |
| Pago | Nunca se elimina |
| PedidoEstadoHistorial | Nunca se elimina |

---

# 12. Entidades de dominio derivadas

La baseline justifica las siguientes entidades persistentes:

1. Usuario
2. Cliente
3. Direccion
4. Autor
5. Editorial
6. Categoria
7. Libro
8. LibroAutor
9. LibroCategoria
10. Edicion
11. Inventario
12. MovimientoInventario
13. Carrito
14. CarritoItem
15. Pedido
16. PedidoItem
17. PedidoDireccion
18. Pago
19. PedidoEstadoHistorial

No se autoriza añadir una nueva entidad persistente al DER sin caso de uso, requisito, regla de negocio o cambio formal que la justifique.

---

# 13. Cardinalidades conceptuales derivadas

```text
Usuario 1 -------- 0..1 Cliente
Cliente 1 -------- 0..N Direccion

Libro N ---------- M Autor
Libro N ---------- M Categoria

Categoria 0..1 --- 0..N Categoria
(profundidad máxima = 2)

Libro 1 ----------- 0..N Edicion
Editorial 1 ------- 0..N Edicion

Edicion 1 --------- 1 Inventario
Inventario 1 ------ 0..N MovimientoInventario

Cliente 1 --------- 0..N Carrito
Carrito 1 --------- 0..N CarritoItem
Edicion 1 --------- 0..N CarritoItem

Cliente 1 --------- 0..N Pedido
Pedido 1 ---------- 1..N PedidoItem
Edicion 1 --------- 0..N PedidoItem

Pedido 1 ---------- 1 PedidoDireccion
Pedido 1 ---------- 1 Pago
Pedido 1 ---------- 1..N PedidoEstadoHistorial
```

### Restricciones adicionales

- Usuario CUSTOMER → exactamente 1 Cliente.
- Máximo un Carrito ACTIVE por Cliente.
- `UNIQUE(Carrito, Edicion)`.
- Edición → exactamente 1 Inventario.
- Pedido generado por checkout → exactamente 1 Pago.
- Todo Pedido debe registrar al menos su estado inicial en PedidoEstadoHistorial.
- `Pedido.Subtotal > 0` y `Pedido.Total > 0` (derivado: al menos un item con cantidad y precio > 0).
- `Pago.Monto > 0` (derivado: `Monto = Total`).
- `UNIQUE(Pedido, Edicion)` en PedidoItem.

---

# 14. Snapshots obligatorios

## 14.1 PedidoItem

Debe conservar como mínimo:

- `edicion_id` como referencia histórica;
- `sku_snapshot`;
- `isbn_snapshot`;
- `titulo_snapshot`;
- `autores_snapshot`;
- `editorial_snapshot`;
- `formato_snapshot`;
- `idioma_snapshot` (idioma de la Edición al checkout);
- `precio_unitario`;
- `cantidad`;
- `subtotal`.

Los snapshots son fuente histórica del Pedido. Cambios posteriores del catálogo no pueden alterar el contenido histórico.

## 14.2 PedidoDireccion

Debe conservar como mínimo:

- destinatario;
- dirección línea 1;
- dirección línea 2;
- ciudad;
- provincia;
- país (`PaisCodigo` ISO 3166-1 alpha-2);
- código postal cuando exista;
- referencia;
- teléfono.

El alias no se copia al snapshot (etiqueta de conveniencia del Cliente). Modificar o eliminar una Dirección del Cliente no altera PedidoDireccion.

---

# 15. Requisitos funcionales consolidados

## Identidad y clientes

- RF-AUTH-001 Registrar una cuenta CUSTOMER.
- RF-AUTH-002 Impedir emails duplicados.
- RF-AUTH-003 Autenticar usuarios.
- RF-AUTH-004 Diferenciar CUSTOMER y ADMIN.
- RF-SEC-001 Permitir a ADMIN bloquear/reactivar Clientes.
- RF-CUS-001 Consultar/modificar perfil propio.
- RF-CUS-002 Administrar direcciones propias.

## Catálogo

- RF-CAT-001 Consultar catálogo público.
- RF-CAT-002 Buscar por título.
- RF-CAT-003 Buscar por autor.
- RF-CAT-004 Buscar por ISBN.
- RF-CAT-005 Filtrar por categoría.
- RF-CAT-006 Filtrar por precio, idioma y formato.
- RF-CAT-007 Paginar resultados.
- RF-CAT-008 Consultar detalle de Edición.
- RF-CAT-009 Administrar Autores.
- RF-CAT-010 Administrar Editoriales.
- RF-CAT-011 Administrar Categorías.
- RF-CAT-012 Administrar Libros.
- RF-CAT-013 Administrar Ediciones.

## Inventario

- RF-INV-001 Mantener inventario independiente por Edición.
- RF-INV-002 Consultar inventario.
- RF-INV-003 Registrar entradas.
- RF-INV-004 Registrar ajustes.
- RF-INV-005 Impedir stock negativo.
- RF-INV-006 Mantener historial de movimientos.
- RF-INV-007 Configurar stock mínimo.

## Carrito

- RF-CART-001 Consultar carrito activo.
- RF-CART-002 Agregar Edición.
- RF-CART-003 Modificar cantidad.
- RF-CART-004 Eliminar item.
- RF-CART-005 Mantener máximo un carrito ACTIVE por Cliente.

## Venta y pedidos

- RF-ORD-001 Realizar checkout.
- RF-ORD-002 Revalidar estado, precio y stock durante checkout.
- RF-ORD-003 Descontar stock de forma transaccional.
- RF-ORD-004 Conservar snapshots de compra.
- RF-ORD-005 Consultar historial de pedidos propios.
- RF-ORD-006 Consultar detalle de pedido.
- RF-ORD-007 Controlar transiciones de estado.
- RF-ORD-008 Permitir gestión logística administrativa.
- RF-ORD-009 Permitir cancelación en estados válidos.
- RF-ORD-010 Restaurar inventario durante cancelación válida.
- RF-ORD-011 Mantener historial de estados.

## Pago

- RF-PAY-001 Crear Pago asociado al Pedido.
- RF-PAY-002 Procesar resultado académico APPROVED/REJECTED.
- RF-PAY-003 Reflejar REFUNDED en una cancelación posterior a aprobación.
- RF-PAY-004 No almacenar datos sensibles de tarjeta.
- RF-PAY-005 Mantener exactamente un Pago por Pedido en v1.

---

# 16. Requisitos no funcionales vinculantes

| ID | Categoría | Requisito |
|---|---|---|
| RNF-001 | Integridad | Una operación transaccional no debe dejar persistencia parcial. |
| RNF-002 | Concurrencia | Checkouts concurrentes no pueden producir stock negativo ni sobreventa. |
| RNF-003 | Seguridad | Passwords nunca en texto plano. |
| RNF-004 | Seguridad | Operaciones administrativas requieren ADMIN. |
| RNF-005 | Autorización | CUSTOMER no accede a recursos de otro Cliente. |
| RNF-006 | Mantenibilidad | Cambios de BD mediante Flyway. |
| RNF-007 | Arquitectura | Separación Controller -> Service -> Gateway. |
| RNF-008 | Arquitectura | Sin JPA/Hibernate. |
| RNF-009 | Arquitectura | Controllers/Services sin SQL de negocio. |
| RNF-010 | Interoperabilidad | API REST con JSON. |
| RNF-011 | Evolución | Backend independiente del futuro frontend. |
| RNF-012 | Trazabilidad | Todo cambio de stock posee MovimientoInventario. |
| RNF-013 | Testabilidad | SP/functions críticos deben probar caminos exitosos y fallidos. |
| RNF-014 | Configuración | Secretos no se almacenan en Git. |
| RNF-015 | Rendimiento | Catálogo siempre paginado. |
| RNF-016 | Exactitud | Dinero usa tipos decimales exactos. |
| RNF-017 | Trazabilidad | Toda transición de Pedido posee historial. |

---

# 17. Relación entre casos de uso

### `<<include>>`

- CU-SAL-01 **incluye** CU-PAY-01.

### Reutilización de reglas

- CU-SAL-03 y la cancelación administrativa de CU-ADM-SAL-01 utilizan las mismas reglas de reversión de inventario y refund simulado.
- CU-CART-02 y CU-CART-03 utilizan la misma autoridad de disponibilidad: Inventario.
- CU-CAT-01 y CU-CAT-02 utilizan la misma condición de publicación comercial.

No se introducen relaciones `<<extend>>` en v1 porque no aportan claridad adicional al dominio actual.

---

# 18. Matriz caso de uso → entidades

| Caso de uso | Entidades principales |
|---|---|
| CU-AUTH-01 | Usuario, Cliente |
| CU-AUTH-02 | Usuario |
| CU-ADM-SEC-01 | Usuario, Cliente |
| CU-CUS-01 | Usuario, Cliente |
| CU-CUS-02 | Cliente, Direccion |
| CU-CAT-01 | Libro, Edicion, Autor, LibroAutor, Categoria, LibroCategoria, Editorial, Inventario |
| CU-CAT-02 | Libro, Edicion, Autor, LibroAutor, Categoria, LibroCategoria, Editorial, Inventario |
| CU-ADM-CAT-01 | Autor, LibroAutor |
| CU-ADM-CAT-02 | Editorial, Edicion |
| CU-ADM-CAT-03 | Categoria, LibroCategoria |
| CU-ADM-CAT-04 | Libro, Autor, LibroAutor, Categoria, LibroCategoria |
| CU-ADM-CAT-05 | Libro, Editorial, Edicion, Inventario |
| CU-INV-01 | Inventario, MovimientoInventario, Edicion, Libro |
| CU-INV-02 | Inventario, MovimientoInventario, Usuario |
| CU-INV-03 | Inventario |
| CU-CART-01 | Cliente, Carrito, CarritoItem, Edicion |
| CU-CART-02 | Carrito, CarritoItem, Libro, Edicion, Inventario |
| CU-CART-03 | Carrito, CarritoItem, Inventario |
| CU-CART-04 | Carrito, CarritoItem |
| CU-SAL-01 | Cliente, Direccion, Carrito, CarritoItem, Libro, Edicion, Inventario, MovimientoInventario, Pedido, PedidoItem, PedidoDireccion, Pago, PedidoEstadoHistorial |
| CU-PAY-01 | Pedido, Pago |
| CU-SAL-02 | Pedido, PedidoItem, PedidoDireccion, Pago, PedidoEstadoHistorial |
| CU-SAL-03 | Pedido, PedidoItem, Pago, Inventario, MovimientoInventario, PedidoEstadoHistorial |
| CU-ADM-SAL-01 | Pedido, PedidoItem, Pago, Inventario, MovimientoInventario, PedidoEstadoHistorial, Usuario |

---

# 19. Matriz principal de trazabilidad

| Requisito | Caso(s) de uso |
|---|---|
| RF-AUTH-001 | CU-AUTH-01 |
| RF-AUTH-002 | CU-AUTH-01 |
| RF-AUTH-003 | CU-AUTH-02 |
| RF-AUTH-004 | CU-AUTH-01, CU-AUTH-02 |
| RF-SEC-001 | CU-ADM-SEC-01 |
| RF-CUS-001 | CU-CUS-01 |
| RF-CUS-002 | CU-CUS-02 |
| RF-CAT-001..008 | CU-CAT-01, CU-CAT-02 |
| RF-CAT-009 | CU-ADM-CAT-01 |
| RF-CAT-010 | CU-ADM-CAT-02 |
| RF-CAT-011 | CU-ADM-CAT-03 |
| RF-CAT-012 | CU-ADM-CAT-04 |
| RF-CAT-013 | CU-ADM-CAT-05 |
| RF-INV-001..007 | CU-INV-01, CU-INV-02, CU-INV-03, CU-SAL-01, CU-SAL-03 |
| RF-CART-001 | CU-CART-01 |
| RF-CART-002 | CU-CART-02 |
| RF-CART-003 | CU-CART-03 |
| RF-CART-004 | CU-CART-04 |
| RF-CART-005 | CU-CART-01, CU-CART-02 |
| RF-ORD-001..004 | CU-SAL-01 |
| RF-ORD-005..006 | CU-SAL-02 |
| RF-ORD-007 | CU-SAL-03, CU-ADM-SAL-01 |
| RF-ORD-008 | CU-ADM-SAL-01 |
| RF-ORD-009..010 | CU-SAL-03, CU-ADM-SAL-01 |
| RF-ORD-011 | CU-SAL-01, CU-SAL-03, CU-ADM-SAL-01 |
| RF-PAY-001..005 | CU-SAL-01, CU-PAY-01, CU-SAL-03, CU-ADM-SAL-01 |

---

# 20. Superficie funcional preliminar de Database API

Esta sección **no define todavía firmas SQL**. Su propósito es demostrar que los casos de uso son implementables y preparar la siguiente etapa.

```text
AUTH
  sp_customer_register
  fn_user_auth_data
  sp_customer_set_status

CUSTOMER
  fn_customer_profile
  sp_customer_update
  fn_address_list
  sp_address_create
  sp_address_update
  sp_address_delete
  sp_address_set_primary

CATALOG
  fn_catalog_search
  fn_edition_detail

ADMIN CATALOG
  sp_author_create
  sp_author_update
  sp_author_set_status

  sp_publisher_create
  sp_publisher_update
  sp_publisher_set_status

  sp_category_create
  sp_category_update
  sp_category_set_status

  sp_book_create
  sp_book_update
  sp_book_set_status

  sp_edition_create
  sp_edition_update
  sp_edition_set_status

INVENTORY
  fn_inventory_search
  fn_inventory_movements
  sp_inventory_entry
  sp_inventory_adjust
  sp_inventory_set_minimum

CART
  fn_cart_get
  sp_cart_add_item
  sp_cart_update_item
  sp_cart_remove_item

SALES
  sp_checkout
  fn_customer_orders
  fn_customer_order_detail
  sp_order_cancel
  fn_admin_orders
  fn_admin_order_detail
  sp_order_change_status
```

`sp_order_cancel` es la única rutina que transiciona a `CANCELLED` con efectos; `sp_order_change_status` cubre solo el avance logístico (`CONFIRMED -> PREPARING -> SHIPPED -> DELIVERED`) y `sp_inventory_adjust` cubre `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` (la entrada inicial usa `sp_inventory_entry`).

La definición de parámetros, retornos, SQLSTATE y contratos transaccionales pertenece al documento **Database API Contract** posterior al DER lógico.

---

# 21. Entidades explícitamente excluidas del DER v1

El DER v1 no deberá incluir sin aprobación formal:

- Bodega;
- Sucursal;
- Proveedor;
- CompraProveedor;
- ReservaStock;
- Wishlist;
- Reseña;
- Rating;
- Cupon;
- Promocion;
- Impuesto;
- Envio;
- Transportista;
- FacturaSRI;
- ArchivoDigital;
- Ebook;
- MarketplaceSeller;
- Outbox;
- Sesion;
- RefreshToken persistido;
- PrecioHistorico.

La ausencia es deliberada y evita sobre-modelado.

---

# 22. Definition of Ready para implementación

Un caso de uso solo podrá entregarse a Codex/Claude cuando existan:

1. ID de caso de uso;
2. requisitos asociados;
3. reglas de negocio;
4. entidades afectadas;
5. precondiciones;
6. flujo principal;
7. flujos alternativos relevantes;
8. postcondiciones;
9. Database API definida;
10. endpoint REST definido cuando aplique;
11. criterios de aceptación;
12. pruebas esperadas.

No se deberá solicitar a un agente simplemente “implementar carrito” o “hacer checkout” sin estos contratos.

---

# 23. Definition of Done

Una funcionalidad se considera terminada cuando, cuando aplique, estén sincronizados:

```text
Caso de uso
    ↓
Requisito
    ↓
Regla de negocio
    ↓
Flyway
    ↓
SP / Function / Trigger / Constraint
    ↓
Java Gateway
    ↓
Application Service
    ↓
Controller REST
    ↓
OpenAPI
    ↓
Pruebas
    ↓
Documentación
```

---

# 24. Gestión del cambio

Esta baseline no debe editarse informalmente para adaptar el documento a una implementación ya realizada.

Si durante DER, Database API o implementación aparece una necesidad que contradiga esta baseline:

1. identificar el caso de uso afectado;
2. identificar requisitos y reglas afectadas;
3. documentar el motivo;
4. evaluar impacto en DER, BD, API y pruebas;
5. aprobar el cambio;
6. incrementar versión del documento;
7. actualizar trazabilidad antes de implementar.

Ejemplos:

- `v1.0 -> v1.1` para correcciones compatibles;
- `v1.x -> v2.0` para cambios relevantes de alcance o comportamiento.

---

# 25. Criterio de cierre de la baseline

La baseline se considera suficientemente cerrada para iniciar el DER cuando:

- no existen actores críticos sin identificar;
- no existen funcionalidades v1 sin caso de uso;
- no existen entidades persistentes sin justificación funcional;
- las cardinalidades críticas pueden derivarse;
- los estados de las entidades transaccionales están definidos;
- las transiciones permitidas están definidas;
- las reglas de inventario están definidas;
- el checkout está definido transaccionalmente;
- el historial comercial utiliza snapshots;
- el pago académico está delimitado;
- las exclusiones de alcance están explícitas;
- no existen decisiones críticas marcadas como `TBD`.

**Resultado:** esta baseline cumple las condiciones anteriores y queda habilitada para derivar el **DER lógico de PLIEGO**.

---

# 26. Próxima etapa autorizada

La siguiente etapa del ciclo de vida será:

```text
Use Case Baseline v1.0
        ↓
DER lógico
        ↓
Diccionario de datos
        ↓
Database API Contract
        ↓
Modelo físico PostgreSQL
        ↓
Catálogo definitivo de SP / Functions / Triggers
        ↓
Contratos REST
        ↓
Work Orders de implementación
```

No deberán definirse tipos físicos PostgreSQL, índices ni firmas finales de Stored Procedures antes de validar el DER lógico.

---

## Historial del documento

| Versión | Fecha | Estado | Descripción |
|---|---|---|---|
| 1.0 | 2026-09-23 | BASELINE | Primera baseline formal de casos de uso de PLIEGO. Consolida alcance, actores, reglas, estados, cardinalidades conceptuales y trazabilidad para permitir el diseño del DER sin ambigüedad material. |
| 1.1 | 2026-09-23 | BASELINE | Revisión arquitectónica: retroalimenta DD-COR-001/002 (país e idioma), elimina Carrito.CANCELLED, fija invariantes > 0 y unicidad Pedido/Edición, define PENDING_PAYMENT transitorio, origen USER/SYSTEM del historial, simulador determinista, auth stateless, dueño transaccional y de cancelación, visibilidad con maestros INACTIVE y bajo-stock con umbral. |

---

## Referencias metodológicas

- ISO/IEC/IEEE 29148:2018 — Systems and software engineering — Life cycle processes — Requirements engineering.
- OMG Unified Modeling Language (UML), Version 2.5.1.
- Arquitectura aprobada del proyecto PLIEGO: Java 25, Spring Boot, PostgreSQL, Flyway, lógica de negocio centrada en BD y API REST desacoplada del futuro frontend.
