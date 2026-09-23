# PLIEGO — REST API Contract v1.0

**Documento:** RAC-PLIEGO-001  
**Versión:** 1.0  
**Estado:** BASELINE APROBADA  
**Fecha:** 2026-09-23  
**Proyecto:** PLIEGO  
**Tipo de documento:** Contrato REST / HTTP y seguridad de aplicación  
**Base path:** `/api/v1`  
**Backend:** Java 25 + Spring Boot + Spring Security  
**Persistencia:** PostgreSQL 18 mediante Database API  
**Frontend:** Fuera del alcance de implementación; este contrato constituye su interfaz futura.

**Documentos fuente:**
- `docs/requirements/use-case-baseline-v1.0.md` — v1.1 BASELINE
- `docs/domain/logical-erd-v1.0.md` — v1.1 BASELINE
- `docs/domain/data-dictionary-v1.0.md` — v1.1 BASELINE
- `docs/architecture/database-api-contract-v1.0.md` — v1.1 BASELINE
- `docs/database/physical-model-postgresql-v1.0.md` — v1.0 BASELINE
- `docs/database/db-routines-catalog-v1.0.md` — v1.0 BASELINE
- Flyway Baseline v1.0 — BASELINE APROBADA, PostgreSQL 18 smoke PASS

---

# 1. Propósito

Este documento define la interfaz HTTP pública de PLIEGO v1.

Su objetivo es traducir las operaciones aprobadas de la Database API a un contrato REST estable sin crear una segunda capa de lógica de negocio.

El contrato fija:

- rutas;
- métodos HTTP;
- autenticación;
- autorización;
- JWT;
- request DTOs;
- response DTOs;
- representación JSON;
- paginación;
- filtros;
- ordenamiento;
- códigos HTTP;
- Problem Details;
- traducción de SQLSTATE;
- reglas de retry y recovery;
- trazabilidad endpoint → caso de uso → rutina PostgreSQL;
- requisitos OpenAPI.

El contrato no autoriza a Controllers o Services a reimplementar reglas ya pertenecientes a PostgreSQL.

---

# 2. Principio de autoridad

La dirección arquitectónica obligatoria es:

```text
HTTP Request
    ↓
Controller
    ↓
Application Service
    ↓
Gateway JDBC
    ↓
Database API PostgreSQL
    ↓
SP / Function / Constraint / Trigger
```

## 2.1 Responsabilidad de Spring Boot

Spring Boot es responsable de:

- HTTP;
- serialización/deserialización JSON;
- autenticación JWT;
- autorización preventiva por rol;
- validación sintáctica del request;
- hash/verificación de contraseñas;
- demarcación transaccional;
- invocación JDBC de una rutina PostgreSQL;
- traducción SQLSTATE → error de aplicación → HTTP;
- OpenAPI;
- logging técnico;
- correlation/trace ID.

## 2.2 Responsabilidad de PostgreSQL

PostgreSQL sigue siendo autoridad sobre:

- unicidad;
- ownership;
- estado real del actor;
- asociaciones;
- inventario;
- carrito;
- checkout;
- snapshots;
- totales;
- transiciones;
- pago simulado;
- cancelación;
- historial;
- reglas multi-entidad.

## 2.3 Regla de una llamada

Un comando REST de negocio debe producir normalmente:

```text
1 endpoint
→ 1 Application Service
→ 1 Gateway
→ 1 Procedure PostgreSQL pública
```

No se permite orquestar varias operaciones de negocio desde Java para sustituir una Procedure aprobada.

---

# 3. Convenciones HTTP generales

## 3.1 Base path

```text
/api/v1
```

No se incluirá versión en header para v1.

## 3.2 JSON

Requests y responses normales:

```http
Content-Type: application/json
```

Errores:

```http
Content-Type: application/problem+json
```

Codificación:

```text
UTF-8
```

## 3.3 Naming JSON

Todos los atributos JSON utilizan:

```text
lowerCamelCase
```

Ejemplo:

```json
{
  "editionId": "42",
  "publicationDate": "2024-05-01",
  "currentPrice": "18.50"
}
```

Los nombres SQL `snake_case` no se exponen.

---

# 4. Representación de tipos

## 4.1 Identificadores

PostgreSQL utiliza `BIGINT`.

REST los serializa como **strings decimales positivos**:

```json
{
  "editionId": "922337203685477580"
}
```

Nunca como JSON `number`.

Razón: un futuro cliente JavaScript/TypeScript no debe perder precisión por el límite de enteros seguros de IEEE-754.

### Path parameters

Los IDs de ruta utilizan texto decimal:

```text
/api/v1/orders/123
```

y deben cumplir:

```text
^[1-9][0-9]*$
```

Spring convierte de forma segura a `Long`.

---

## 4.2 Dinero

Todos los montos se representan externamente como **strings decimales con exactamente dos posiciones**.

Ejemplo:

```json
{
  "price": "19.90",
  "total": "124.50"
}
```

Java usa:

```text
java.math.BigDecimal
```

No se usa:

```text
float
double
Float
Double
```

Esto protege precisión al interoperar con JavaScript y con `NUMERIC(30,2)`.

---

## 4.3 Cantidades

Cantidades y stock se exponen como JSON integer cuando pertenecen al rango de `INTEGER`.

Ejemplo:

```json
{
  "quantity": 3,
  "stockMinimum": 5
}
```

---

## 4.4 Fechas

Fecha civil:

```text
YYYY-MM-DD
```

Ejemplo:

```json
"publicationDate": "1949-06-08"
```

Instantes:

```text
RFC 3339 / ISO-8601 UTC
```

Ejemplo:

```json
"createdAt": "2026-09-23T19:15:23.481Z"
```

Responses usan UTC.

---

## 4.5 Booleanos

JSON boolean nativo:

```json
{
  "available": true
}
```

---

## 4.6 Null

Un valor opcional ausente se serializa como `null` cuando el atributo forma parte estable del DTO.

Ejemplo:

```json
{
  "isbn13": null
}
```

En requests `PUT`, la omisión de un atributo opcional y `null` tienen semántica equivalente:

```text
establecer ausencia
```

porque las Procedures de actualización son de reemplazo completo del conjunto mutable.

---

# 5. Paginación

## 5.1 Query parameters

```text
page
pageSize
```

Defaults:

```text
page = 0
pageSize = 20
```

Restricciones:

```text
page >= 0
1 <= pageSize <= 50
```

## 5.2 Response

```json
{
  "items": [],
  "page": 0,
  "pageSize": 20,
  "totalCount": "0"
}
```

`totalCount` se serializa como string porque PostgreSQL devuelve `BIGINT`.

No se incluye `totalPages`; el consumidor puede derivarlo.

## 5.3 Empty result

Un conjunto vacío es éxito:

```http
200 OK
```

No:

```http
404 Not Found
```

---

# 6. Ordenamiento

El consumidor solo envía códigos cerrados.

No se aceptan nombres arbitrarios de columnas.

## Catálogo

```text
TITLE_ASC
PRICE_ASC
PRICE_DESC
```

Default:

```text
TITLE_ASC
```

Cualquier otro valor:

```text
400 INVALID_ARGUMENT
```

Las búsquedas administrativas utilizan orden fijo definido por Database API y no exponen `sort` en v1.

---

# 7. Seguridad y autenticación

## 7.1 Modelo

PLIEGO v1 utiliza autenticación:

```text
stateless
Bearer JWT
sin sesión persistida
sin refresh token
```

No existe tabla de sesiones.

No existe endpoint de logout de servidor.

Logout significa eliminar el access token en el cliente.

## 7.2 Estándares

El token utiliza JWT firmado y se transmite exclusivamente mediante:

```http
Authorization: Bearer <token>
```

No se acepta token en:

- query string;
- URL;
- request body;
- cookie de autenticación de PLIEGO v1.

## 7.3 TLS

Fuera de desarrollo local, los Bearer tokens solo deben transmitirse por HTTPS.

---

# 8. JWT v1

## 8.1 Algoritmo

PLIEGO v1 utiliza:

```text
HS256
```

Spring Security debe configurar una allowlist explícita:

```text
alg = HS256
```

y rechazar:

- `none`;
- cualquier algoritmo distinto;
- firmas inválidas.

## 8.2 Secret

Variable de entorno:

```text
PLIEGO_JWT_SECRET
```

Debe contener al menos:

```text
32 bytes criptográficamente aleatorios
```

Nunca se almacena en Git.

No debe ser una contraseña humana.

## 8.3 Claims

Token:

```json
{
  "iss": "pliego",
  "aud": "pliego-api",
  "sub": "123",
  "role": "CUSTOMER",
  "iat": 1790180000,
  "exp": 1790181800,
  "jti": "uuid"
}
```

### `iss`

```text
pliego
```

### `aud`

```text
pliego-api
```

### `sub`

`UsuarioId` serializado como decimal string.

### `role`

```text
CUSTOMER
ADMIN
```

### `iat`

Issued at.

### `exp`

Expiration.

### `jti`

UUID aleatorio técnico.

No se persiste.

## 8.4 Vigencia

TTL v1:

```text
30 minutos
```

No existe refresh token.

Al expirar, el usuario se autentica nuevamente.

## 8.5 Validación

Spring Security debe validar:

- firma;
- algoritmo exacto;
- `iss`;
- `aud`;
- `exp`;
- `sub`;
- role reconocido.

El role del JWT sirve para autorización preventiva.

PostgreSQL vuelve a validar el rol/estado real mediante `fn_assert_actor`.

Por tanto, alterar un claim firmado no permite saltarse las reglas de BD.

## 8.6 Usuario bloqueado

Un JWT firmado aún no expirado no habilita a un usuario que posteriormente pasó a `BLOCKED`.

La Database API responde:

```text
P1003 ACTOR_INACTIVE
```

y REST lo traduce a:

```http
401 Unauthorized
```

---

# 9. Contraseñas

## 9.1 Hash

Spring Security utiliza:

```text
BCrypt
strength = 12
```

PostgreSQL recibe únicamente:

```text
passwordHash
```

Nunca recibe la contraseña original.

## 9.2 Política v1

Password de registro:

```text
mínimo 8 caracteres
máximo 72 bytes UTF-8
```

No se exige artificialmente:

- mayúscula;
- símbolo;
- número;

como requisito separado.

No se permiten strings vacíos.

## 9.3 Fuera de alcance

PLIEGO v1 no incorpora:

- cambio de contraseña;
- recuperación de contraseña;
- MFA;
- email verification.

---

# 10. Roles

## Público

No requiere token:

- registro;
- login;
- catálogo;
- detalle público de edición.

## CUSTOMER

Requiere:

```text
JWT role=CUSTOMER
```

para:

- perfil;
- direcciones;
- carrito;
- checkout;
- pedidos propios;
- cancelación propia.

## ADMIN

Requiere:

```text
JWT role=ADMIN
```

para:

- usuarios;
- catálogo administrativo;
- inventario;
- pedidos administrativos.

Spring aplica autorización preventiva y PostgreSQL la repite como autoridad.

---

# 11. Registro

## POST `/api/v1/auth/register`

**Auth:** público  
**CU:** CU-AUTH-01  
**DB:** `sp_customer_register`

### Request

```json
{
  "email": "usuario@example.com",
  "password": "password-segura",
  "firstNames": "Ana María",
  "lastNames": "Pérez López",
  "phone": "+59325550134"
}
```

`phone` opcional.

### Spring

1. valida estructura;
2. valida policy password;
3. genera BCrypt hash;
4. llama una vez a `sp_customer_register`.

### Response

```http
201 Created
```

```json
{
  "userId": "100",
  "customerId": "87",
  "state": "ACTIVE"
}
```

### Errors

- `400` request inválido;
- `409 P1101 EMAIL_ALREADY_EXISTS`.

No inicia sesión automáticamente.

---

# 12. Login

## POST `/api/v1/auth/login`

**Auth:** público  
**CU:** CU-AUTH-02  
**DB:** `fn_user_auth_data`

### Request

```json
{
  "email": "usuario@example.com",
  "password": "password-segura"
}
```

### Flujo

1. Spring llama `fn_user_auth_data(email)`.
2. Si no existe → auth inválida.
3. Si state != ACTIVE → auth inválida.
4. Spring verifica BCrypt.
5. Genera JWT.

### Response

```http
200 OK
```

```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresInSeconds": 1800,
  "user": {
    "userId": "100",
    "email": "usuario@example.com",
    "role": "CUSTOMER"
  }
}
```

### Error

Usuario inexistente, blocked o password incorrecto producen el mismo error externo:

```http
401 Unauthorized
```

```text
AUTH_INVALID_CREDENTIALS
```

No se revela cuál condición falló.

---

# 13. Perfil CUSTOMER

## GET `/api/v1/me`

**Auth:** CUSTOMER  
**DB:** `fn_customer_profile`

### Response

```json
{
  "customerId": "87",
  "email": "usuario@example.com",
  "firstNames": "Ana María",
  "lastNames": "Pérez López",
  "phone": "+59325550134",
  "state": "ACTIVE"
}
```

---

## PUT `/api/v1/me`

**Auth:** CUSTOMER  
**DB:** `sp_customer_update`

PUT representa reemplazo completo de los atributos mutables.

### Request

```json
{
  "firstNames": "Ana María",
  "lastNames": "Pérez López",
  "phone": null
}
```

### Response

```http
204 No Content
```

Email no puede modificarse.

---

# 14. Direcciones

## GET `/api/v1/me/addresses`

**Auth:** CUSTOMER  
**DB:** `fn_address_list`

```http
200 OK
```

Response:

```json
[
  {
    "addressId": "15",
    "alias": "Casa",
    "recipient": "Ana Pérez",
    "line1": "Av. Principal 123",
    "line2": null,
    "city": "Quito",
    "province": "Pichincha",
    "countryCode": "EC",
    "postalCode": null,
    "reference": "Frente al parque",
    "phone": "+59325550134",
    "primary": true
  }
]
```

---

## POST `/api/v1/me/addresses`

**Auth:** CUSTOMER  
**DB:** `sp_address_create`

### Request

```json
{
  "alias": "Casa",
  "recipient": "Ana Pérez",
  "line1": "Av. Principal 123",
  "line2": null,
  "city": "Quito",
  "province": "Pichincha",
  "countryCode": "EC",
  "postalCode": null,
  "reference": "Frente al parque",
  "phone": "+59325550134",
  "makePrimary": true
}
```

### Response

```http
201 Created
```

```json
{
  "addressId": "15"
}
```

---

## PUT `/api/v1/me/addresses/{addressId}`

**Auth:** CUSTOMER  
**DB:** `sp_address_update`

Mismo conjunto de dirección excepto `makePrimary`.

```http
204 No Content
```

---

## DELETE `/api/v1/me/addresses/{addressId}`

**Auth:** CUSTOMER  
**DB:** `sp_address_delete`

```http
204 No Content
```

Segundo DELETE puede producir:

```http
404 ADDRESS_NOT_FOUND
```

---

## PUT `/api/v1/me/addresses/{addressId}/primary`

**Auth:** CUSTOMER  
**DB:** `sp_address_set_primary`

Idempotente.

```http
204 No Content
```

---

# 15. Catálogo público

## GET `/api/v1/catalog/editions`

**Auth:** público  
**DB:** `fn_catalog_search`

### Query parameters

```text
title
author
isbn13
category
minPrice
maxPrice
language
format
sort=TITLE_ASC
page=0
pageSize=20
```

### Ejemplo

```text
GET /api/v1/catalog/editions?category=literatura&language=es&page=0&pageSize=20
```

### Categoría inexistente

Slug sintácticamente válido pero desconocido:

```http
200 OK
```

con página vacía.

### Item

```json
{
  "editionId": "250",
  "bookId": "80",
  "title": "Don Quijote de la Mancha",
  "authors": "Miguel de Cervantes",
  "publisher": "Editorial Ejemplo",
  "isbn13": "9780306406157",
  "price": "18.50",
  "coverUrl": "https://...",
  "coverLicense": "PUBLIC_DOMAIN",
  "coverAttribution": null,
  "format": "PAPERBACK",
  "language": "es",
  "available": true
}
```

### Response

`PageResponse<CatalogEditionSummary>`.

---

## GET `/api/v1/catalog/editions/{editionId}`

**Auth:** público  
**DB:** `fn_edition_detail`

### Response

Incluye:

```json
{
  "editionId": "250",
  "bookId": "80",
  "title": "Don Quijote de la Mancha",
  "subtitle": null,
  "synopsis": "...",
  "authors": [
    {
      "authorId": "12",
      "name": "Miguel de Cervantes",
      "order": 1
    }
  ],
  "categories": [
    {
      "categoryId": "2",
      "name": "Literatura",
      "slug": "literatura",
      "parentCategoryId": null
    }
  ],
  "publisher": {
    "publisherId": "7",
    "name": "Editorial Ejemplo"
  },
  "isbn13": "9780306406157",
  "sku": "PLG-LIT-001",
  "language": "es",
  "format": "PAPERBACK",
  "pageCount": 560,
  "publicationDate": "2024-01-01",
  "price": "18.50",
  "coverUrl": "https://...",
  "coverLicense": "PUBLIC_DOMAIN",
  "coverSourceUrl": "https://...",
  "coverAttribution": null,
  "available": true
}
```

Edición no publicable/inexistente:

```http
404 Not Found
```

El Controller transforma cero filas de la Function en 404.

---

# 16. Administración de Clientes

## GET `/api/v1/admin/customers`

**Auth:** ADMIN  
**DB:** `fn_admin_customer_search`

Query:

```text
query
state
page
pageSize
```

Response:

`PageResponse<AdminCustomerSummary>`.

---

## PUT `/api/v1/admin/customers/{customerId}/status`

**Auth:** ADMIN  
**DB:** `sp_customer_set_status`

Request:

```json
{
  "state": "BLOCKED"
}
```

Allowed:

```text
ACTIVE
BLOCKED
```

Same-state es idempotente.

Response:

```http
204 No Content
```

---

# 17. Administración de Autores

## GET `/api/v1/admin/authors`

→ `fn_admin_author_search`

Query:

```text
query
state
page
pageSize
```

## POST `/api/v1/admin/authors`

→ `sp_author_create`

Request:

```json
{
  "name": "George Orwell",
  "biography": "..."
}
```

Response:

```http
201 Created
```

```json
{
  "authorId": "15"
}
```

## PUT `/api/v1/admin/authors/{authorId}`

→ `sp_author_update`

```http
204 No Content
```

## PUT `/api/v1/admin/authors/{authorId}/status`

→ `sp_author_set_status`

Request:

```json
{
  "state": "INACTIVE"
}
```

Same-state idempotente.

```http
204 No Content
```

---

# 18. Administración de Editoriales

## GET `/api/v1/admin/publishers`

→ `fn_admin_publisher_search`

## POST `/api/v1/admin/publishers`

→ `sp_publisher_create`

Request:

```json
{
  "name": "Penguin Books",
  "description": null
}
```

Response:

```json
{
  "publisherId": "8"
}
```

Status:

```http
201 Created
```

## PUT `/api/v1/admin/publishers/{publisherId}`

→ `sp_publisher_update`

```http
204 No Content
```

## PUT `/api/v1/admin/publishers/{publisherId}/status`

→ `sp_publisher_set_status`

```http
204 No Content
```

---

# 19. Administración de Categorías

## GET `/api/v1/admin/categories`

→ `fn_admin_category_search`

## POST `/api/v1/admin/categories`

→ `sp_category_create`

Request:

```json
{
  "name": "Ciencia ficción",
  "slug": "ciencia-ficcion",
  "description": null,
  "parentCategoryId": "2"
}
```

Response:

```http
201 Created
```

```json
{
  "categoryId": "22"
}
```

## PUT `/api/v1/admin/categories/{categoryId}`

→ `sp_category_update`

Request de reemplazo:

```json
{
  "name": "Ciencia ficción",
  "slug": "ciencia-ficcion",
  "description": null,
  "parentCategoryId": "2"
}
```

```http
204 No Content
```

## PUT `/api/v1/admin/categories/{categoryId}/status`

→ `sp_category_set_status`

```http
204 No Content
```

---

# 20. Administración de Libros

## GET `/api/v1/admin/books`

→ `fn_admin_book_search`

Query:

```text
query
state
page
pageSize
```

---

## POST `/api/v1/admin/books`

→ `sp_book_create`

### Request

```json
{
  "title": "1984",
  "subtitle": null,
  "synopsis": "...",
  "authors": [
    {
      "authorId": "15",
      "order": 1
    }
  ],
  "categoryIds": [
    "2",
    "7"
  ]
}
```

Response:

```http
201 Created
```

```json
{
  "bookId": "90"
}
```

---

## PUT `/api/v1/admin/books/{bookId}`

→ `sp_book_update`

Request completo con el mismo shape de create.

`authors` y `categoryIds` reemplazan completamente asociaciones actuales.

```http
204 No Content
```

---

## PUT `/api/v1/admin/books/{bookId}/status`

→ `sp_book_set_status`

```json
{
  "state": "INACTIVE"
}
```

```http
204 No Content
```

---

# 21. Administración de Ediciones

## GET `/api/v1/admin/editions`

→ `fn_admin_edition_search`

Query:

```text
query
state
bookId
page
pageSize
```

---

## POST `/api/v1/admin/editions`

→ `sp_edition_create`

### Request

```json
{
  "bookId": "90",
  "publisherId": "8",
  "sku": "PLG-LIT-001",
  "isbn13": "9780306406157",
  "language": "es",
  "format": "PAPERBACK",
  "pageCount": 328,
  "publicationDate": "2024-01-15",
  "price": "18.50",
  "coverUrl": "https://...",
  "coverLicense": "CC_BY",
  "coverSourceUrl": "https://...",
  "coverAttribution": "..."
}
```

Response:

```http
201 Created
```

```json
{
  "editionId": "250"
}
```

---

## PUT `/api/v1/admin/editions/{editionId}`

→ `sp_edition_update`

No acepta:

```text
bookId
sku
```

porque son inmutables.

Request:

```json
{
  "publisherId": "8",
  "isbn13": "9780306406157",
  "language": "es",
  "format": "PAPERBACK",
  "pageCount": 328,
  "publicationDate": "2024-01-15",
  "price": "19.90",
  "coverUrl": null,
  "coverLicense": null,
  "coverSourceUrl": null,
  "coverAttribution": null
}
```

Response:

```http
204 No Content
```

---

## PUT `/api/v1/admin/editions/{editionId}/status`

→ `sp_edition_set_status`

```http
204 No Content
```

---

# 22. Inventario

Todos requieren ADMIN.

## GET `/api/v1/admin/inventory`

→ `fn_inventory_search`

Query:

```text
editionId
title
sku
lowStockOnly
page
pageSize
```

Item:

```json
{
  "editionId": "250",
  "bookId": "90",
  "title": "1984",
  "sku": "PLG-LIT-001",
  "isbn13": "9780306406157",
  "editionState": "ACTIVE",
  "stockActual": 12,
  "stockMinimum": 5,
  "lowStock": false,
  "updatedAt": "2026-09-23T19:30:00Z"
}
```

---

## GET `/api/v1/admin/inventory/{editionId}/movements`

→ `fn_inventory_movements`

Query:

```text
type
page
pageSize
```

---

## POST `/api/v1/admin/inventory/{editionId}/entries`

→ `sp_inventory_entry`

Request:

```json
{
  "quantity": 20,
  "reason": "Ingreso de inventario"
}
```

Response:

```http
201 Created
```

```json
{
  "movementId": "450",
  "stockBefore": 12,
  "stockAfter": 32
}
```

---

## POST `/api/v1/admin/inventory/{editionId}/adjustments`

→ `sp_inventory_adjust`

Request:

```json
{
  "type": "ADJUSTMENT_OUT",
  "quantity": 2,
  "reason": "Corrección de conteo físico"
}
```

Allowed:

```text
ADJUSTMENT_IN
ADJUSTMENT_OUT
```

Response:

```http
201 Created
```

```json
{
  "movementId": "451",
  "stockBefore": 32,
  "stockAfter": 30
}
```

---

## PUT `/api/v1/admin/inventory/{editionId}/minimum`

→ `sp_inventory_set_minimum`

Request:

```json
{
  "stockMinimum": 5
}
```

Same value es idempotente.

```http
204 No Content
```

---

# 23. Carrito

CUSTOMER.

## GET `/api/v1/cart`

→ `fn_cart_get`

Siempre:

```http
200 OK
```

Sin carrito físico:

```json
{
  "cartId": null,
  "state": null,
  "items": [],
  "totalCurrent": "0.00"
}
```

Con carrito:

```json
{
  "cartId": "40",
  "state": "ACTIVE",
  "items": [
    {
      "cartItemId": "100",
      "editionId": "250",
      "title": "1984",
      "authors": "George Orwell",
      "sku": "PLG-LIT-001",
      "coverUrl": null,
      "quantity": 2,
      "currentPrice": "19.90",
      "currentSubtotal": "39.80",
      "available": true,
      "unavailabilityReason": null
    }
  ],
  "totalCurrent": "39.80"
}
```

---

## POST `/api/v1/cart/items`

→ `sp_cart_add_item`

Request:

```json
{
  "editionId": "250",
  "quantity": 2
}
```

La operación puede:

- crear item;
- incrementar item existente.

Por ello retorna:

```http
200 OK
```

no se intenta distinguir `201`/`200`.

Response:

```json
{
  "cartId": "40",
  "cartItemId": "100",
  "quantity": 2
}
```

---

## PUT `/api/v1/cart/items/{cartItemId}`

→ `sp_cart_update_item`

Request:

```json
{
  "quantity": 3
}
```

Response:

```http
200 OK
```

```json
{
  "cartId": "40",
  "cartItemId": "100",
  "quantity": 3
}
```

---

## DELETE `/api/v1/cart/items/{cartItemId}`

→ `sp_cart_remove_item`

```http
204 No Content
```

---

# 24. Checkout

## POST `/api/v1/checkout`

**Auth:** CUSTOMER  
**DB:** `sp_checkout`

### Request v1 académico

```json
{
  "addressId": "15",
  "paymentMethod": "CARD",
  "simulationOutcome": "APPROVED"
}
```

Allowed payment methods:

```text
CARD
TRANSFER
```

Allowed simulation outcomes:

```text
APPROVED
REJECTED
```

## 24.1 Consideración académica

`simulationOutcome` existe exclusivamente porque PLIEGO v1 implementa un pago académico determinista.

Un consumidor puede forzar `APPROVED`.

Por tanto esta interfaz:

> NO representa autorización financiera real.

Si se incorpora una pasarela real en una versión futura, este parámetro deberá desaparecer del contrato público.

## 24.2 APPROVED

Response:

```http
201 Created
Location: /api/v1/orders/{orderId}
```

```json
{
  "orderId": "700",
  "orderState": "CONFIRMED",
  "paymentState": "APPROVED",
  "total": "39.80",
  "paymentReference": "SIM-550e8400-e29b-41d4-a716-446655440000"
}
```

## 24.3 REJECTED

El rechazo es un **resultado comercial válido**, no un error HTTP.

También:

```http
201 Created
Location: /api/v1/orders/{orderId}
```

```json
{
  "orderId": "701",
  "orderState": "CANCELLED",
  "paymentState": "REJECTED",
  "total": "39.80",
  "paymentReference": null
}
```

No se utiliza `402 Payment Required`.

---

# 25. Pedidos CUSTOMER

## GET `/api/v1/orders`

→ `fn_customer_orders`

Query:

```text
page
pageSize
```

Response `PageResponse<CustomerOrderSummary>`.

Item:

```json
{
  "orderId": "700",
  "createdAt": "2026-09-23T19:30:00Z",
  "orderState": "CONFIRMED",
  "total": "39.80",
  "paymentState": "APPROVED"
}
```

---

## GET `/api/v1/orders/{orderId}`

→ `fn_customer_order_detail`

Incluye:

- cabecera;
- snapshots de items;
- dirección snapshot;
- pago;
- historial.

Pedido ajeno e inexistente:

```http
404
P5001 ORDER_NOT_FOUND
```

mismo resultado, para no revelar existencia.

---

## POST `/api/v1/orders/{orderId}/cancel`

→ `sp_order_cancel`

Request body:

```text
vacío
```

Response:

```http
200 OK
```

```json
{
  "orderId": "700",
  "previousState": "CONFIRMED",
  "orderState": "CANCELLED",
  "paymentState": "REFUNDED",
  "restoredUnits": 2
}
```

No es operación idempotente por respuesta.

Después de una cancelación confirmada, repetir produce conflicto.

---

# 26. Pedidos ADMIN

## GET `/api/v1/admin/orders`

→ `fn_admin_orders`

Query:

```text
state
dateFrom
dateTo
customerId
page
pageSize
```

`dateFrom` / `dateTo` usan RFC3339.

---

## GET `/api/v1/admin/orders/{orderId}`

→ `fn_admin_order_detail`

Incluye además movimientos de inventario relacionados.

---

## POST `/api/v1/admin/orders/{orderId}/transitions`

→ `sp_order_change_status`

Se usa `POST`, no `PUT`, porque la transición logística aprobada **no es same-state idempotente**.

Request:

```json
{
  "targetState": "PREPARING"
}
```

Allowed transitions:

```text
CONFIRMED -> PREPARING
PREPARING -> SHIPPED
SHIPPED -> DELIVERED
```

Response:

```http
200 OK
```

```json
{
  "orderId": "700",
  "previousState": "CONFIRMED",
  "orderState": "PREPARING"
}
```

`CANCELLED` no se acepta aquí.

---

## POST `/api/v1/admin/orders/{orderId}/cancel`

→ `sp_order_cancel`

Mismo response de cancelación.

ADMIN puede cancelar pedidos permitidos sin ownership.

---

# 27. Resumen de endpoints

| Método | Path | Auth | Database API |
|---|---|---|---|
| POST | `/auth/register` | Público | sp_customer_register |
| POST | `/auth/login` | Público | fn_user_auth_data |
| GET | `/me` | CUSTOMER | fn_customer_profile |
| PUT | `/me` | CUSTOMER | sp_customer_update |
| GET | `/me/addresses` | CUSTOMER | fn_address_list |
| POST | `/me/addresses` | CUSTOMER | sp_address_create |
| PUT | `/me/addresses/{id}` | CUSTOMER | sp_address_update |
| DELETE | `/me/addresses/{id}` | CUSTOMER | sp_address_delete |
| PUT | `/me/addresses/{id}/primary` | CUSTOMER | sp_address_set_primary |
| GET | `/catalog/editions` | Público | fn_catalog_search |
| GET | `/catalog/editions/{id}` | Público | fn_edition_detail |
| GET | `/admin/customers` | ADMIN | fn_admin_customer_search |
| PUT | `/admin/customers/{id}/status` | ADMIN | sp_customer_set_status |
| GET | `/admin/authors` | ADMIN | fn_admin_author_search |
| POST | `/admin/authors` | ADMIN | sp_author_create |
| PUT | `/admin/authors/{id}` | ADMIN | sp_author_update |
| PUT | `/admin/authors/{id}/status` | ADMIN | sp_author_set_status |
| GET | `/admin/publishers` | ADMIN | fn_admin_publisher_search |
| POST | `/admin/publishers` | ADMIN | sp_publisher_create |
| PUT | `/admin/publishers/{id}` | ADMIN | sp_publisher_update |
| PUT | `/admin/publishers/{id}/status` | ADMIN | sp_publisher_set_status |
| GET | `/admin/categories` | ADMIN | fn_admin_category_search |
| POST | `/admin/categories` | ADMIN | sp_category_create |
| PUT | `/admin/categories/{id}` | ADMIN | sp_category_update |
| PUT | `/admin/categories/{id}/status` | ADMIN | sp_category_set_status |
| GET | `/admin/books` | ADMIN | fn_admin_book_search |
| POST | `/admin/books` | ADMIN | sp_book_create |
| PUT | `/admin/books/{id}` | ADMIN | sp_book_update |
| PUT | `/admin/books/{id}/status` | ADMIN | sp_book_set_status |
| GET | `/admin/editions` | ADMIN | fn_admin_edition_search |
| POST | `/admin/editions` | ADMIN | sp_edition_create |
| PUT | `/admin/editions/{id}` | ADMIN | sp_edition_update |
| PUT | `/admin/editions/{id}/status` | ADMIN | sp_edition_set_status |
| GET | `/admin/inventory` | ADMIN | fn_inventory_search |
| GET | `/admin/inventory/{id}/movements` | ADMIN | fn_inventory_movements |
| POST | `/admin/inventory/{id}/entries` | ADMIN | sp_inventory_entry |
| POST | `/admin/inventory/{id}/adjustments` | ADMIN | sp_inventory_adjust |
| PUT | `/admin/inventory/{id}/minimum` | ADMIN | sp_inventory_set_minimum |
| GET | `/cart` | CUSTOMER | fn_cart_get |
| POST | `/cart/items` | CUSTOMER | sp_cart_add_item |
| PUT | `/cart/items/{id}` | CUSTOMER | sp_cart_update_item |
| DELETE | `/cart/items/{id}` | CUSTOMER | sp_cart_remove_item |
| POST | `/checkout` | CUSTOMER | sp_checkout |
| GET | `/orders` | CUSTOMER | fn_customer_orders |
| GET | `/orders/{id}` | CUSTOMER | fn_customer_order_detail |
| POST | `/orders/{id}/cancel` | CUSTOMER | sp_order_cancel |
| GET | `/admin/orders` | ADMIN | fn_admin_orders |
| GET | `/admin/orders/{id}` | ADMIN | fn_admin_order_detail |
| POST | `/admin/orders/{id}/transitions` | ADMIN | sp_order_change_status |
| POST | `/admin/orders/{id}/cancel` | ADMIN | sp_order_cancel |

**Total endpoints v1: 50.**

La diferencia respecto de las 49 rutinas públicas se debe a que:

```text
sp_order_cancel
```

se expone en un endpoint CUSTOMER y otro ADMIN.

---

# 28. Problem Details

PLIEGO utiliza Problem Details compatible con RFC 9457.

## 28.1 Shape

```json
{
  "type": "urn:pliego:problem:P3002",
  "title": "INSUFFICIENT_STOCK",
  "status": 409,
  "detail": "The requested quantity is not currently available.",
  "instance": "/api/v1/checkout",
  "code": "P3002",
  "traceId": "d66ab35e..."
}
```

Campos estándar:

```text
type
title
status
detail
instance
```

Extensiones PLIEGO:

```text
code
traceId
```

## 28.2 Regla de seguridad

Nunca incluir:

- SQL;
- constraint name;
- stack trace;
- password hash;
- datos internos no necesarios;
- detalles de recursos ajenos.

---

# 29. Errores HTTP propios de la capa REST

No todos los errores nacen en PostgreSQL.

## 29.1 Request inválido

```text
VALIDATION_ERROR
```

HTTP:

```text
400
```

Campos desconocidos se rechazan (strict JSON binding normativo).

Puede incluir:

```json
{
  "violations": [
    {
      "field": "quantity",
      "message": "must be greater than 0"
    }
  ]
}
```

La validación Spring es preventiva.

La BD sigue siendo autoridad de negocio.

## 29.2 JSON inválido

```text
MALFORMED_JSON
HTTP 400
```

## 29.3 Credenciales

```text
AUTH_INVALID_CREDENTIALS
HTTP 401
```

## 29.4 Token ausente

```text
AUTH_REQUIRED
HTTP 401
```

Header:

```http
WWW-Authenticate: Bearer
```

## 29.5 Token inválido/expirado

```text
AUTH_INVALID_TOKEN
HTTP 401
```

## 29.6 Acceso preventivamente denegado

```text
ACCESS_DENIED
HTTP 403
```

La BD vuelve a comprobar el rol.

---

# 30. Mapeo SQLSTATE → HTTP

## 30.1 400 Bad Request

| SQLSTATE | Código |
|---|---|
| P1001 | INVALID_ARGUMENT |
| P2034 | AUTHOR_ORDER_INVALID |
| P2046 | ISBN_INVALID |
| P2047 | COVER_METADATA_INVALID |
| P2048 | EDITION_DATA_INVALID |
| P3003 | STOCK_QUANTITY_INVALID |
| P3004 | STOCK_MINIMUM_INVALID |
| P4004 | CART_QUANTITY_INVALID |
| P5005 | PAYMENT_OUTCOME_INVALID |

---

## 30.2 401 Unauthorized

| SQLSTATE | Código |
|---|---|
| P1002 | ACTOR_NOT_FOUND |
| P1003 | ACTOR_INACTIVE |

Para endpoints autenticados ambos invalidan el contexto de autenticación.

---

## 30.3 403 Forbidden

| SQLSTATE | Código |
|---|---|
| P1004 | ACTOR_NOT_ADMIN |
| P1005 | ACTOR_NOT_CUSTOMER |

---

## 30.4 404 Not Found

| SQLSTATE | Código |
|---|---|
| P1102 | CUSTOMER_NOT_FOUND |
| P1103 | ADDRESS_NOT_FOUND |
| P2001 | AUTHOR_NOT_FOUND |
| P2011 | PUBLISHER_NOT_FOUND |
| P2021 | CATEGORY_NOT_FOUND |
| P2031 | BOOK_NOT_FOUND |
| P2041 | EDITION_NOT_FOUND |
| P3001 | INVENTORY_NOT_FOUND |
| P4003 | CART_ITEM_NOT_FOUND |
| P5001 | ORDER_NOT_FOUND |
| P5004 | CHECKOUT_ADDRESS_INVALID |

`CHECKOUT_ADDRESS_INVALID` utiliza 404 porque representa una dirección inexistente o no perteneciente al usuario sin revelar ownership.

---

## 30.5 409 Conflict

| SQLSTATE | Código |
|---|---|
| P1101 | EMAIL_ALREADY_EXISTS |
| P2002 | AUTHOR_INACTIVE |
| P2012 | PUBLISHER_INACTIVE |
| P2022 | CATEGORY_INACTIVE |
| P2023 | CATEGORY_INVALID_HIERARCHY |
| P2024 | CATEGORY_SLUG_EXISTS |
| P2032 | BOOK_REQUIRES_AUTHOR |
| P2033 | BOOK_REQUIRES_CATEGORY |
| P2042 | EDITION_INACTIVE |
| P2043 | BOOK_INACTIVE |
| P2044 | SKU_ALREADY_EXISTS |
| P2045 | ISBN_ALREADY_EXISTS |
| P3002 | INSUFFICIENT_STOCK |
| P3005 | STOCK_MOVEMENT_DUPLICATE |
| P3006 | SALE_REQUIRED_FOR_CANCELLATION |
| P4001 | CART_NOT_ACTIVE |
| P4002 | CART_EMPTY |
| P5002 | ORDER_INVALID_TRANSITION |
| P5003 | ORDER_NOT_CANCELLABLE |
| P5006 | PAYMENT_STATE_INVALID |

---

## 30.6 500 Internal Server Error

### P5007

```text
PAYMENT_REFERENCE_CONFLICT
```

Una colisión de referencia `SIM-UUID` no es una decisión que el cliente pueda corregir.

HTTP:

```text
500
```

### P9001

```text
IMMUTABLE_HISTORY_VIOLATION
```

Clasificación:

```text
TECHNICAL_INTEGRITY_ERROR
```

HTTP:

```text
500
```

Nunca debería ocurrir mediante una llamada REST válida.

### PostgreSQL 23514

Si un `CHECK` escapa pese a la prevalidación:

```text
DatabaseContractViolationException
HTTP 500
```

No se convierte a `P1001`.

### Otros SQLSTATE inesperados

```text
InternalServerError
HTTP 500
```

No se filtra el mensaje PostgreSQL al consumidor.

---

# 31. DatabaseExceptionTranslator

Debe existir una única traducción central:

```text
SQLException
    ↓
SQLSTATE
    ↓
ApplicationException
    ↓
ProblemDetail
```

Controllers no inspeccionan SQLSTATE.

Gateways no deciden HTTP.

---

# 32. Validación HTTP

Spring puede validar únicamente aspectos sintácticos/contractuales:

- requeridos;
- string no vacío;
- longitudes;
- formatos básicos;
- cantidad positiva;
- formato enum;
- estructura email;
- estructura JSON;
- IDs positivos;
- paginación.

No debe decidir como autoridad:

```text
if stock < quantity
if order.status == ...
if publisher inactive
if cart belongs to customer
```

Esas reglas permanecen en PostgreSQL.

---

# 33. Retry / Recovery

## 33.1 GET

Los GET son safe/read-only y pueden reintentarse normalmente.

## 33.2 PUT idempotentes

Pueden reintentarse si el cliente perdió la respuesta:

- `/me`;
- address update;
- set primary;
- status de CUSTOMER/Autor/Editorial/Categoría/Libro/Edición;
- stock minimum;
- PUT `/cart/items/{id}` (cantidad absoluta: mismo estado final);
- DELETEs (idempotentes en efecto; el segundo retorna 404).

La operación produce el mismo estado final.

## 33.3 POST no idempotentes

No deben reintentarse ciegamente tras timeout:

- register;
- create catálogo;
- inventory entry;
- inventory adjustment;
- cart add;
- checkout;
- cancel;
- order transition.

## 33.4 Recovery checkout

Si el consumidor pierde la respuesta de:

```text
POST /checkout
```

no debe volver a ejecutar el mismo POST automáticamente.

Debe consultar:

```text
GET /orders
```

para resolver si apareció un nuevo Pedido.

Una mejora futura podría añadir Idempotency-Key, pero está fuera de v1.

Tras `P5007` (colisión de referencia, con rollback total) reintentar checkout es seguro: crea otro Pedido sin duplicar efectos.

## 33.5 Checkout rechazado

Un nuevo POST después de un resultado `REJECTED` representa un intento comercial nuevo y puede crear otro Pedido `CANCELLED`.

## 33.6 Transición logística

Después de un timeout en:

```text
POST /admin/orders/{id}/transitions
```

ADMIN debe recuperar:

```text
GET /admin/orders/{id}
```

antes de decidir repetir.

## 33.7 Riesgos aceptados v1

- Login puede permitir enumeración de usuarios por timing (sin verificación bcrypt dummy).
- El límite de password se valida por bytes UTF-8, no por caracteres.
- `jti` sirve solo a correlación de logs; no existe revocación en v1.
- Sin rate limiting, el login acepta riesgo de fuerza bruta online (mitigación futura en proxy, §45).
- La dirección completa solo se registra con flag de debug explícito y redacción.

---

# 34. CORS

CORS pertenece a configuración de deployment.

Reglas v1:

- allowlist explícita por environment;
- no `*` indiscriminado para deployment autenticado;
- permitir `Authorization`;
- métodos según endpoints;
- localhost permitido solamente en desarrollo.

No existe origen frontend congelado todavía.

---

# 35. Logging

Cada request debe tener:

```text
traceId
```

Se registra:

- HTTP method;
- path template;
- status;
- duración;
- principal userId cuando existe;
- Database routine;
- SQLSTATE si falla.

No registrar:

- password;
- JWT completo;
- PasswordHash;
- CVV/PAN;
- dirección completa salvo necesidad de diagnóstico controlado.

---

# 36. OpenAPI

## 36.1 Versión objetivo

PLIEGO documentará la API en:

```text
OpenAPI 3.1.2
```

Aunque existan versiones OpenAPI posteriores, se fija 3.1.2 como baseline de interoperabilidad para el toolchain Spring de PLIEGO v1.

Cambiar a una minor posterior es una decisión técnica compatible si el tooling lo permite y el contrato observable no cambia.

## 36.2 Documento

Debe describir:

- 50 endpoints;
- Bearer JWT scheme;
- request schemas;
- response schemas;
- enum values;
- paginación;
- ProblemDetail;
- ejemplos;
- status codes;
- roles en description;
- formatos de ID/money.

## 36.3 URLs de desarrollo

Recomendadas:

```text
/v3/api-docs
/swagger-ui/index.html
```

La ruta exacta puede ajustarse por configuración sin cambiar la API `/api/v1`.

---

# 37. DTOs compartidos

## 37.1 `PageResponse<T>`

```json
{
  "items": [],
  "page": 0,
  "pageSize": 20,
  "totalCount": "0"
}
```

## 37.2 `StatusUpdateRequest`

```json
{
  "state": "ACTIVE"
}
```

## 37.3 `AuthorAssignmentRequest`

```json
{
  "authorId": "15",
  "order": 1
}
```

## 37.4 `ProblemResponse`

Compatible con RFC 9457.

---

# 38. Convenciones Java DTO

Se recomiendan Java records para DTOs inmutables de transporte:

```java
record RegisterRequest(...)
record LoginRequest(...)
record PageResponse<T>(...)
```

Los IDs recibidos por JSON pueden modelarse como `String` en DTO y convertirse mediante un parser común a `long`, o exponerse mediante serialización configurada de `Long`.

Regla observable:

> JSON siempre presenta IDs como strings.

Los montos se convierten:

```text
JSON string ↔ BigDecimal
```

mediante serialización explícita.

---

# 39. Controllers por feature

Estructura recomendada:

```text
auth/
  AuthController

customer/
  ProfileController
  AddressController

catalog/
  CatalogController
  AdminAuthorController
  AdminPublisherController
  AdminCategoryController
  AdminBookController
  AdminEditionController

inventory/
  AdminInventoryController

cart/
  CartController

order/
  CheckoutController
  OrderController
  AdminOrderController
```

No se crea un `AdminController` monolítico.

---

# 40. Gateways

Cada Controller llega a un Service, y cada Service a un Gateway específico.

Ejemplo:

```text
CheckoutController
    ↓
CheckoutService
    ↓
OrderDbGateway
    ↓
sp_checkout
```

No se permite:

```text
CheckoutService
→ InventoryDbGateway
→ CartDbGateway
→ PaymentDbGateway
```

para orquestar checkout en Java.

---

# 41. Demarcación transaccional

Los comandos que llaman Procedures se ejecutan dentro de una transacción Spring.

Ejemplo conceptual:

```java
@Transactional
public CheckoutResponse checkout(...) {
    return orderDbGateway.checkout(...);
}
```

Una llamada:

```text
Service → Gateway → CALL
```

Las Functions de lectura no requieren transacción de escritura.

---

# 42. Response Location

Los POST que crean un recurso principal deben incluir `Location` cuando existe una URI REST natural.

Ejemplos:

### Register

No se expone endpoint `/users/{id}` público, por tanto `Location` no es obligatorio.

### Create admin author

Sin GET individual en v1, se omite `Location`.

### Checkout

Sí existe GET individual:

```http
Location: /api/v1/orders/{orderId}
```

Debe incluirse.

---

# 43. HTTP cache

PLIEGO v1 no define caching HTTP avanzado.

Defaults:

- auth/customer/cart/order/admin → `Cache-Control: no-store`;
- catálogo público puede utilizar caching futuro;
- no se introducen ETag en v1.

Esto evita complejidad no requerida.

---

# 44. Content limits

## JSON body

Configurar un tamaño máximo razonable a nivel de servidor.

Recomendación v1:

```text
1 MiB
```

No existen uploads binarios.

Las portadas son URL, no archivos.

## Arrays Book

La Database API valida reglas de autores/categorías.

REST debe rechazar arrays no válidos sintácticamente, pero no imponer límites arbitrarios no existentes en baseline.

---

# 45. Rate limiting

No forma parte de PLIEGO v1.

No se introducen Redis ni infraestructura adicional.

Puede añadirse posteriormente en reverse proxy/gateway sin modificar contratos de negocio.

---

# 46. Versionado

El contrato se identifica mediante:

```text
/api/v1
```

Cambios compatibles:

- añadir campo response opcional;
- añadir endpoint nuevo;
- añadir filtro opcional.

Cambios incompatibles:

- renombrar/eliminar campo obligatorio;
- cambiar semántica de endpoint;
- cambiar tipo observable;
- alterar máquina de estado;
- cambiar códigos de error existentes.

Un cambio incompatible requiere:

```text
/api/v2
```

o gestión explícita de compatibilidad.

---

# 47. Trazabilidad Endpoint → Caso de Uso

| Caso | Endpoint(s) |
|---|---|
| CU-AUTH-01 | POST `/auth/register` |
| CU-AUTH-02 | POST `/auth/login` |
| CU-ADM-SEC-01 | GET `/admin/customers`, PUT `/admin/customers/{id}/status` |
| CU-CUS-01 | GET/PUT `/me` |
| CU-CUS-02 | `/me/addresses...` |
| CU-CAT-01 | GET `/catalog/editions` |
| CU-CAT-02 | GET `/catalog/editions/{id}` |
| CU-ADM-CAT-01 | `/admin/authors...` |
| CU-ADM-CAT-02 | `/admin/publishers...` |
| CU-ADM-CAT-03 | `/admin/categories...` |
| CU-ADM-CAT-04 | `/admin/books...` |
| CU-ADM-CAT-05 | `/admin/editions...` |
| CU-INV-01 | GET inventory + movements |
| CU-INV-02 | POST entry/adjustment |
| CU-INV-03 | PUT minimum |
| CU-CART-01 | GET `/cart` |
| CU-CART-02 | POST `/cart/items` |
| CU-CART-03 | PUT `/cart/items/{id}` |
| CU-CART-04 | DELETE `/cart/items/{id}` |
| CU-SAL-01 | POST `/checkout` |
| CU-PAY-01 | incluido en `/checkout` |
| CU-SAL-02 | GET `/orders`, GET `/orders/{id}` |
| CU-SAL-03 | POST `/orders/{id}/cancel` |
| CU-ADM-SAL-01 | `/admin/orders...` |

Cobertura:

```text
24 / 24 casos de uso
```

---

# 48. Trazabilidad Endpoint → Database API

La tabla completa del §27 es normativa.

Regla:

> Ningún endpoint v1 de negocio puede acceder a tablas PostgreSQL directamente.

Una nueva ruta que requiera persistencia y no tenga rutina correspondiente debe detener la implementación y pasar por gestión de cambio.

---

# 49. Tests mínimos REST

## Auth

- registro éxito;
- email duplicado 409;
- login éxito;
- credenciales incorrectas 401;
- blocked 401;
- JWT expirado 401;
- JWT algoritmo incorrecto 401;
- CUSTOMER en admin 403;
- ADMIN en customer-only 403/DB defense.

## JSON / validation

- malformed JSON 400;
- unknown enum 400;
- ID inválido 400;
- pageSize > 50 400;
- campos desconocidos 400 (strict).

## Catalog

- público sin token;
- filters;
- category unknown → 200 empty;
- edition inactive → detail 404;
- money string;
- ID strings.

## Customer

- ownership de address;
- delete;
- primary idempotent.

## Inventory

- insufficient adjustment →409;
- entry returns movement.

## Cart

- add;
- increment same edition;
- update;
- remove;
- inactive item remains visible as unavailable.

## Checkout

- APPROVED → 201;
- REJECTED → 201;
- invalid simulationOutcome →400/P5005;
- insufficient stock →409/P3002;
- address ajena →404/P5004;
- Location header;
- money exact;
- no blind retry.

## Orders

- customer only own order;
- customer cancellation;
- admin cancellation;
- invalid transition 409;
- transition POST not PUT.

## Errors

- ProblemDetail structure;
- `traceId`;
- no SQL leakage;
- P9001 →500;
- raw `23514` →500 DatabaseContractViolation.

---

# 50. Criterio de aprobación

REST API Contract v1.0 pasa a `BASELINE APROBADA`. Condiciones cumplidas:

1. 50 rutas aceptadas;
2. JWT HS256 + claims + TTL aceptados;
3. password policy BCrypt aceptada;
4. IDs como strings aceptados;
5. money como strings aceptado;
6. Problem Details RFC 9457 aceptado;
7. SQLSTATE → HTTP aceptado;
8. retry/recovery aceptado;
9. OpenAPI 3.1.2 aceptado;
10. sin reglas de negocio nuevas en Java.

---

# 51. Definition of Ready para implementación Spring

Una feature puede entregarse a Codex/Claude cuando tenga:

- CU;
- endpoint;
- auth/role;
- DTO request;
- DTO response;
- Gateway routine;
- status codes;
- Problem mappings;
- acceptance tests.

Esto completa el Definition of Ready definido desde UCB.

---

# 52. Estado del ciclo de diseño

Con la aprobación de este documento:

```text
Use Case Baseline v1.1        BASELINE
        ↓
DER Lógico v1.1              BASELINE
        ↓
Diccionario v1.1             BASELINE
        ↓
Database API Contract v1.1   BASELINE
        ↓
Modelo Físico v1.0           BASELINE
        ↓
Catálogo Rutinas v1.0        BASELINE
        ↓
Flyway Baseline v1.0         BASELINE
        ↓
REST API Contract v1.0       BASELINE
        ↓
IMPLEMENTACIÓN
```

A partir de este punto, la implementación debe materializar contratos; no redefinir requisitos.

---

# 53. Historial

| Versión | Fecha | Estado | Descripción |
|---|---|---|---|
| 1.0 | 2026-09-23 | BASELINE APROBADA | Primer contrato REST completo de PLIEGO. Define 50 endpoints, JWT stateless, representación JSON exacta, DTOs, Problem Details, mapeo SQLSTATE→HTTP, retry/recovery, OpenAPI y trazabilidad 24/24 casos de uso hacia la Database API aprobada. Patch RT-01–RT-05 aplicado; RT-06–RT-10 como riesgos aceptados. |

---

# 54. Referencias

## Artefactos internos

- Use Case Baseline v1.1.
- DER Lógico v1.1.
- Diccionario de Datos v1.1.
- Database API Contract v1.1.
- Modelo Físico PostgreSQL v1.0.
- Catálogo de Stored Procedures / Functions / Triggers v1.0.
- Flyway Baseline v1.0.

## Estándares externos

- RFC 7519 — JSON Web Token (JWT).
- RFC 8725 / BCP 225 — JSON Web Token Best Current Practices.
- RFC 6750 — Bearer Token Usage.
- RFC 9457 — Problem Details for HTTP APIs.
- OpenAPI Specification 3.1.2 — baseline de documentación de PLIEGO v1.
