# PLIEGO — Catálogo de Stored Procedures, Functions y Triggers v1.0

**Documento:** DBR-PLIEGO-001  
**Versión:** 1.0  
**Estado:** BASELINE APROBADA  
**Fecha:** 2026-09-23  
**Proyecto:** PLIEGO  
**Tipo de documento:** Catálogo definitivo de rutinas PostgreSQL  
**Motor objetivo:** PostgreSQL 18.x  
**Schema:** `pliego`  

**Documentos fuente:**  
- `docs/requirements/use-case-baseline-v1.0.md` — v1.1 BASELINE  
- `docs/domain/logical-erd-v1.0.md` — v1.1 BASELINE  
- `docs/domain/data-dictionary-v1.0.md` — v1.1 BASELINE  
- `docs/architecture/database-api-contract-v1.0.md` — v1.1 candidato  
- `docs/database/physical-model-postgresql-v1.0.md` — v1.0 BASELINE APROBADA  

**Siguiente artefacto:** Flyway SQL Baseline / REST API Contract v1.0

---

# 1. Propósito

Este documento define el catálogo normativo de rutinas PostgreSQL de PLIEGO v1.

El objetivo es que la implementación posterior en Flyway pueda transcribir contratos ya cerrados, sin tener que volver a decidir:

- qué Procedure o Function corresponde a cada caso de uso;
- firmas SQL;
- tipos físicos de parámetros;
- columnas de retorno;
- reglas de autorización;
- SQLSTATE;
- orden de locking;
- algoritmo transaccional;
- helpers internos;
- generación `SIM-<UUIDv4>`;
- triggers;
- mutabilidad;
- responsabilidades entre rutinas públicas e internas.

El catálogo contiene:

- **49 rutinas públicas**;
- helpers internos requeridos;
- 3 funciones de trigger compartidas;
- 18 triggers físicos;
- matriz rutina → SQLSTATE;
- algoritmos normativos de cuerpo.

Los cuerpos descritos son **normativos**. El artefacto Flyway posterior contendrá el SQL ejecutable final.

---

# 2. Resultado de auditoría de entrada

## 2.1 Artefactos aceptados

Se toman como autoridad:

1. UCB v1.1;
2. DER v1.1;
3. Diccionario v1.1;
4. DAC v1.1 con B1–B9;
5. Modelo Físico v1.0 con PM-01–PM-07.

No se introducen nuevas entidades.

## 2.2 Resoluciones asumidas

- `Idioma` admite 2 o 3 letras canónicas.
- PostgreSQL objetivo: 18.x.
- `REJECTED` siempre deja `Pago.Referencia = NULL`.
- `APPROVED` genera `SIM-<UUIDv4>`.
- importes agregados usan `NUMERIC(30,2)`.
- Country code se valida mediante un helper único.
- Usuario `BLOCKED` no ejecuta rutinas privadas.
- slug de categoría inexistente en búsqueda pública produce conjunto vacío.
- valores cerrados inválidos producen `P1001`.
- todas las búsquedas tienen orden determinista.
- Java representa dinero exclusivamente con `BigDecimal`.
- retries posteriores a timeout quedan bajo política del REST Contract.

## 2.3 Nota de `Autores_Snapshot`

`pedido_item.autores_snapshot` conserva el límite conceptual aprobado de 1.000 caracteres.

La Database API:

- construye la cadena completa;
- nunca trunca;
- si excede 1.000 caracteres, genera `P1001 INVALID_ARGUMENT`.

Esto evita pérdida silenciosa de información histórica.

---

# 3. Reglas globales de implementación

## 3.1 Visibilidad

### Rutinas públicas

Pueden ser invocadas desde Gateways Spring.

### Rutinas internas

Solo son usadas por otras rutinas/triggers PostgreSQL.

Java no debe invocarlas directamente.

## 3.2 Seguridad

Todas las rutinas usan:

```sql
SECURITY INVOKER
```

salvo una revisión arquitectónica futura explícita.

## 3.3 Transacciones

Las Procedures:

- no ejecutan `COMMIT`;
- no ejecutan `ROLLBACK`;
- participan en la transacción demarcada por Spring.

## 3.4 Functions públicas

Son de solo lectura y se declaran:

```sql
STABLE
SECURITY INVOKER
```

No producen DML.

## 3.5 Helpers puros

Cuando corresponda:

```sql
IMMUTABLE
STRICT
```

## 3.6 Errors

Todos los errores de dominio usan:

```sql
RAISE EXCEPTION
USING ERRCODE = 'Pxxxx',
      MESSAGE = '<CODIGO_SIMBOLICO>';
```

La aplicación decide por SQLSTATE, no por texto.

Ningún `CHECK` provocado por parámetros válidamente alcanzables desde una rutina pública deberá escapar como SQLSTATE PostgreSQL `23514`. Toda rutina debe prevalidar las invariantes y emitir el SQLSTATE de dominio correspondiente.

---

# 4. Catálogo de SQLSTATE

| SQLSTATE | Código |
|---|---|
| P1001 | INVALID_ARGUMENT |
| P1002 | ACTOR_NOT_FOUND |
| P1003 | ACTOR_INACTIVE |
| P1004 | ACTOR_NOT_ADMIN |
| P1005 | ACTOR_NOT_CUSTOMER |
| P1101 | EMAIL_ALREADY_EXISTS |
| P1102 | CUSTOMER_NOT_FOUND |
| P1103 | ADDRESS_NOT_FOUND |
| P2001 | AUTHOR_NOT_FOUND |
| P2002 | AUTHOR_INACTIVE |
| P2011 | PUBLISHER_NOT_FOUND |
| P2012 | PUBLISHER_INACTIVE |
| P2021 | CATEGORY_NOT_FOUND |
| P2022 | CATEGORY_INACTIVE |
| P2023 | CATEGORY_INVALID_HIERARCHY |
| P2024 | CATEGORY_SLUG_EXISTS |
| P2031 | BOOK_NOT_FOUND |
| P2032 | BOOK_REQUIRES_AUTHOR |
| P2033 | BOOK_REQUIRES_CATEGORY |
| P2034 | AUTHOR_ORDER_INVALID |
| P2041 | EDITION_NOT_FOUND |
| P2042 | EDITION_INACTIVE |
| P2043 | BOOK_INACTIVE |
| P2044 | SKU_ALREADY_EXISTS |
| P2045 | ISBN_ALREADY_EXISTS |
| P2046 | ISBN_INVALID |
| P2047 | COVER_METADATA_INVALID |
| P2048 | EDITION_DATA_INVALID |
| P3001 | INVENTORY_NOT_FOUND |
| P3002 | INSUFFICIENT_STOCK |
| P3003 | STOCK_QUANTITY_INVALID |
| P3004 | STOCK_MINIMUM_INVALID |
| P3005 | STOCK_MOVEMENT_DUPLICATE |
| P3006 | SALE_REQUIRED_FOR_CANCELLATION |
| P4001 | CART_NOT_ACTIVE |
| P4002 | CART_EMPTY |
| P4003 | CART_ITEM_NOT_FOUND |
| P4004 | CART_QUANTITY_INVALID |
| P5001 | ORDER_NOT_FOUND |
| P5002 | ORDER_INVALID_TRANSITION |
| P5003 | ORDER_NOT_CANCELLABLE |
| P5004 | CHECKOUT_ADDRESS_INVALID |
| P5005 | PAYMENT_OUTCOME_INVALID |
| P5006 | PAYMENT_STATE_INVALID |
| P5007 | PAYMENT_REFERENCE_CONFLICT |
| P9001 | IMMUTABLE_HISTORY_VIOLATION |

---

# 5. Blanket de actor

Toda rutina privada debe llamar al helper `fn_assert_actor`.

Reglas:

```text
no existe             -> P1002
BLOCKED               -> P1003
rol ADMIN requerido   -> P1004
rol CUSTOMER requerido-> P1005
```

La validación ocurre al inicio.

Si el actor es bloqueado concurrentemente después de esta validación, la invocación ya iniciada puede terminar.

---

# 6. Helpers internos

## 6.1 `fn_raise_domain_error`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_raise_domain_error(
    p_sqlstate CHAR(5),
    p_code     TEXT,
    p_detail   TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER;
```

### Cuerpo normativo

```plpgsql
BEGIN
    RAISE EXCEPTION
        USING ERRCODE = p_sqlstate,
              MESSAGE = p_code,
              DETAIL  = p_detail;
END;
```

---

## 6.2 `fn_normalize_email`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_normalize_email(
    p_value TEXT
)
RETURNS VARCHAR
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER;
```

Cuerpo:

```sql
SELECT lower(btrim(p_value));
```

---

## 6.3 `fn_normalize_phone`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_normalize_phone(
    p_value TEXT
)
RETURNS VARCHAR
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER;
```

Semántica:

1. `btrim`;
2. conserva `+` inicial;
3. elimina espacios, `.`, `-`, `(`, `)`;
4. el resultado debe cumplir `^\+?[0-9]{7,19}$`.

La Procedure llamadora genera `P1001` si el resultado no cumple el patrón.

---

## 6.4 `fn_normalize_sku`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_normalize_sku(
    p_value TEXT
)
RETURNS VARCHAR
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER;
```

```sql
SELECT upper(btrim(p_value));
```

---

## 6.5 `fn_normalize_slug`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_normalize_slug(
    p_value TEXT
)
RETURNS VARCHAR
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER;
```

Semántica:

```text
trim
lowercase
una o más posiciones whitespace -> "-"
```

No translitera caracteres arbitrariamente.

El resultado final debe cumplir el constraint físico del slug.

---

## 6.6 `fn_normalize_language`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_normalize_language(
    p_value TEXT
)
RETURNS VARCHAR
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER;
```

```sql
SELECT lower(btrim(p_value));
```

Validez sintáctica:

```text
^[a-z]{2,3}$
```

---

## 6.7 `fn_normalize_country_code`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_normalize_country_code(
    p_value TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER;
```

```sql
SELECT upper(btrim(p_value));
```

Sin cast a `CHAR(2)`: un cast explícito podría truncar silenciosamente un valor demasiado largo. Longitud exactamente 2 y `fn_is_valid_country_code(...)` se verifican antes de insertar (`P1001` si no).

---

## 6.8 `fn_is_valid_country_code`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_is_valid_country_code(
    p_value TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER;
```

Cuerpo normativo:

```sql
SELECT upper(btrim(p_value)) = ANY (
    ARRAY[
        'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
    ]::TEXT[]
);
```

La misma Function debe ser consumida por ambos `CHECK`:

```text
direccion.pais_codigo
pedido_direccion.pais_codigo
```

La whitelist no se duplica.

Si la lista cambia, Flyway debe:

1. reemplazar helper;
2. recrear/revalidar ambos constraints en la misma migración.

---

## 6.9 `fn_is_valid_isbn13`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_is_valid_isbn13(
    p_isbn TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER;
```

### Cuerpo normativo

```plpgsql
DECLARE
    v_sum INTEGER := 0;
    v_digit INTEGER;
    i INTEGER;
BEGIN
    IF p_isbn !~ '^[0-9]{13}$' THEN
        RETURN FALSE;
    END IF;

    FOR i IN 1..12 LOOP
        v_digit := substr(p_isbn, i, 1)::INTEGER;

        IF (i % 2) = 1 THEN
            v_sum := v_sum + v_digit;
        ELSE
            v_sum := v_sum + (v_digit * 3);
        END IF;
    END LOOP;

    v_digit := (10 - (v_sum % 10)) % 10;

    RETURN v_digit = substr(p_isbn, 13, 1)::INTEGER;
END;
```

---

## 6.10 `fn_generate_payment_reference`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_generate_payment_reference()
RETURNS VARCHAR
LANGUAGE sql
VOLATILE
SECURITY INVOKER;
```

Cuerpo:

```sql
SELECT ('SIM-' || uuidv4()::TEXT)::VARCHAR;
```

Resultado:

```text
SIM-xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx
```

Se invoca únicamente para resultado `APPROVED`.

`REJECTED` conserva `referencia = NULL`.

---

## 6.11 `fn_assert_actor`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_assert_actor(
    p_actor_user_id BIGINT,
    p_required_role VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    usuario_id BIGINT,
    cliente_id BIGINT,
    rol        VARCHAR
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER;
```

### Algoritmo

1. localizar Usuario;
2. si no existe → `P1002`;
3. si estado != `ACTIVE` → `P1003`;
4. si `p_required_role = 'ADMIN'` y rol distinto → `P1004`;
5. si `p_required_role = 'CUSTOMER'` y rol distinto → `P1005`;
6. si CUSTOMER, resolver Cliente;
7. si CUSTOMER sin Cliente → `P1102`;
8. retornar IDs + rol.

---

## 6.12 `fn_assert_pagination`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_assert_pagination(
    p_page      INTEGER,
    p_page_size INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER;
```

Valida:

```text
p_page >= 0
1 <= p_page_size <= 50
```

Si no:

```text
P1001
```

---

## 6.13 `fn_build_authors_snapshot`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_build_authors_snapshot(
    p_book_id BIGINT
)
RETURNS VARCHAR
LANGUAGE plpgsql
STABLE
SECURITY INVOKER;
```

Algoritmo:

```sql
string_agg(
    autor.nombre,
    '; '
    ORDER BY libro_autor.orden_autoria
)
```

Si:

```text
resultado NULL
```

→ inconsistencia técnica/negocio.

Si longitud > 1000:

```text
P1001 INVALID_ARGUMENT
```

Nunca trunca.

---

## 6.14 `fn_validate_cover_metadata`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_validate_cover_metadata(
    p_cover_url         TEXT,
    p_cover_license     TEXT,
    p_cover_source_url  TEXT,
    p_cover_attribution TEXT
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER;
```

Reglas:

### Sin portada

Todos deben ser NULL.

### Con portada

URL + licencia + fuente obligatorias.

Licencias:

```text
PUBLIC_DOMAIN
CC0
CC_BY
CC_BY_SA
OWNED
```

`CC_BY` / `CC_BY_SA` requieren atribución no vacía.

Error:

```text
P2047 COVER_METADATA_INVALID
```

---

# 7. Rutinas públicas — Identity

## 7.1 `sp_customer_register`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_customer_register(
    IN  p_email         VARCHAR,
    IN  p_password_hash VARCHAR,
    IN  p_first_names   VARCHAR,
    IN  p_last_names    VARCHAR,
    IN  p_phone         VARCHAR,
    OUT o_user_id       BIGINT,
    OUT o_customer_id   BIGINT,
    OUT o_user_state    VARCHAR
)
LANGUAGE plpgsql
SECURITY INVOKER;
```

### Cuerpo normativo

1. validar parámetros;
2. canonicalizar email;
3. normalizar teléfono si existe;
4. intentar INSERT Usuario `CUSTOMER/ACTIVE`;
5. capturar `uq_usuario_email` → `P1101`;
6. INSERT Cliente;
7. retornar IDs + `ACTIVE`.

### SQLSTATE

```text
P1001
P1101
```

---

## 7.2 `fn_user_auth_data`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_user_auth_data(
    p_email VARCHAR
)
RETURNS TABLE (
    user_id         BIGINT,
    email_canonical VARCHAR,
    password_hash   VARCHAR,
    role            VARCHAR,
    state           VARCHAR
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER;
```

Cero o una fila.

No verifica password.

No genera JWT.

---

## 7.3 `fn_admin_customer_search`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_customer_search(
    p_actor_user_id BIGINT,
    p_query         VARCHAR,
    p_state         VARCHAR,
    p_page          INTEGER,
    p_page_size     INTEGER
)
RETURNS TABLE (
    user_id      BIGINT,
    customer_id  BIGINT,
    email        VARCHAR,
    first_names  VARCHAR,
    last_names   VARCHAR,
    phone        VARCHAR,
    state        VARCHAR,
    created_at   TIMESTAMPTZ,
    total_count  BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER;
```

Orden:

```text
usuario.fecha_creacion DESC,
usuario.usuario_id DESC
```

SQLSTATE:

```text
P1001 P1002 P1003 P1004
```

Si 0 filas, Gateway interpreta:

```text
items=[]
totalCount=0
```

---

## 7.4 `sp_customer_set_status`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_customer_set_status(
    IN  p_actor_user_id   BIGINT,
    IN  p_customer_id     BIGINT,
    IN  p_new_state       VARCHAR,
    OUT o_customer_id     BIGINT,
    OUT o_user_id         BIGINT,
    OUT o_effective_state VARCHAR
)
LANGUAGE plpgsql
SECURITY INVOKER;
```

Estados:

```text
ACTIVE
BLOCKED
```

Same-state:

```text
éxito idempotente
```

SQLSTATE:

```text
P1001 P1002 P1003 P1004 P1102
```

---

# 8. Rutinas públicas — Customer

## 8.1 `fn_customer_profile`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_customer_profile(
    p_actor_user_id BIGINT
)
RETURNS TABLE (
    customer_id BIGINT,
    email       VARCHAR,
    first_names VARCHAR,
    last_names  VARCHAR,
    phone       VARCHAR,
    state       VARCHAR
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER;
```

SQLSTATE:

```text
P1002 P1003 P1005 P1102
```

---

## 8.2 `sp_customer_update`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_customer_update(
    IN p_actor_user_id BIGINT,
    IN p_first_names   VARCHAR,
    IN p_last_names    VARCHAR,
    IN p_phone         VARCHAR
)
LANGUAGE plpgsql
SECURITY INVOKER;
```

Reemplazo completo del conjunto mutable.

SQLSTATE:

```text
P1001 P1002 P1003 P1005 P1102
```

---

## 8.3 `fn_address_list`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_address_list(
    p_actor_user_id BIGINT
)
RETURNS TABLE (
    address_id    BIGINT,
    alias         VARCHAR,
    recipient     VARCHAR,
    line1         VARCHAR,
    line2         VARCHAR,
    city          VARCHAR,
    province      VARCHAR,
    country_code  CHAR(2),
    postal_code   VARCHAR,
    reference     VARCHAR,
    phone         VARCHAR,
    is_primary    BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER;
```

Orden:

```text
es_principal DESC,
fecha_creacion ASC,
direccion_id ASC
```

SQLSTATE:

```text
P1002 P1003 P1005
```

---

## 8.4 `sp_address_create`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_address_create(
    IN  p_actor_user_id BIGINT,
    IN  p_alias         VARCHAR,
    IN  p_recipient     VARCHAR,
    IN  p_line1         VARCHAR,
    IN  p_line2         VARCHAR,
    IN  p_city          VARCHAR,
    IN  p_province      VARCHAR,
    IN  p_country_code  VARCHAR,
    IN  p_postal_code   VARCHAR,
    IN  p_reference     VARCHAR,
    IN  p_phone         VARCHAR,
    IN  p_make_primary  BOOLEAN,
    OUT o_address_id    BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER;
```

Si principal:

1. lock Cliente;
2. UPDATE principal previa a false;
3. insertar nueva true.

SQLSTATE:

```text
P1001 P1002 P1003 P1005
```

---

## 8.5 `sp_address_update`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_address_update(
    IN p_actor_user_id BIGINT,
    IN p_address_id    BIGINT,
    IN p_alias         VARCHAR,
    IN p_recipient     VARCHAR,
    IN p_line1         VARCHAR,
    IN p_line2         VARCHAR,
    IN p_city          VARCHAR,
    IN p_province      VARCHAR,
    IN p_country_code  VARCHAR,
    IN p_postal_code   VARCHAR,
    IN p_reference     VARCHAR,
    IN p_phone         VARCHAR
)
LANGUAGE plpgsql
SECURITY INVOKER;
```

No modifica `es_principal`.

SQLSTATE:

```text
P1001 P1002 P1003 P1005 P1103
```

---

## 8.6 `sp_address_delete`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_address_delete(
    IN p_actor_user_id BIGINT,
    IN p_address_id    BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER;
```

SQLSTATE:

```text
P1002 P1003 P1005 P1103
```

---

## 8.7 `sp_address_set_primary`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_address_set_primary(
    IN p_actor_user_id BIGINT,
    IN p_address_id    BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER;
```

Lock Cliente.

Same-primary:

```text
éxito idempotente
```

SQLSTATE:

```text
P1002 P1003 P1005 P1103
```

---

# 9. Rutinas públicas — Catalog

## 9.1 `fn_catalog_search`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_catalog_search(
    p_title_query   VARCHAR,
    p_author_query  VARCHAR,
    p_isbn13        VARCHAR,
    p_category_slug VARCHAR,
    p_price_min     NUMERIC,
    p_price_max     NUMERIC,
    p_language      VARCHAR,
    p_format        VARCHAR,
    p_sort          VARCHAR,
    p_page          INTEGER,
    p_page_size     INTEGER
)
RETURNS TABLE (
    edition_id       BIGINT,
    book_id          BIGINT,
    title            VARCHAR,
    authors_ordered  VARCHAR,
    publisher_name   VARCHAR,
    isbn13           CHAR(13),
    price            NUMERIC(11,2),
    cover_url        VARCHAR,
    cover_license    VARCHAR,
    cover_attribution VARCHAR,
    format           VARCHAR,
    language         VARCHAR,
    available        BOOLEAN,
    total_count      BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER;
```

Sort:

```text
TITLE_ASC
PRICE_ASC
PRICE_DESC
```

Default debe ser pasado por Spring como:

```text
TITLE_ASC
```

Categoría válida pero inexistente:

```text
0 filas
```

Código/sort inválido:

```text
P1001
```

No devuelve stock exacto.

---

## 9.2 `fn_edition_detail`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_edition_detail(
    p_edition_id BIGINT
)
RETURNS TABLE (
    edition_id          BIGINT,
    book_id             BIGINT,
    title               VARCHAR,
    subtitle            VARCHAR,
    synopsis            VARCHAR,
    authors_json        JSONB,
    categories_json     JSONB,
    publisher_id        BIGINT,
    publisher_name      VARCHAR,
    isbn13              CHAR(13),
    sku                 VARCHAR,
    language            VARCHAR,
    format              VARCHAR,
    page_count          INTEGER,
    publication_date    DATE,
    price               NUMERIC(11,2),
    cover_url           VARCHAR,
    cover_license       VARCHAR,
    cover_source_url    VARCHAR,
    cover_attribution   VARCHAR,
    available           BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER;
```

Cero filas si:

- inexistente;
- Libro INACTIVE;
- Edicion INACTIVE.

JSONB solo es formato transitorio de salida.

---

# 10. Rutinas públicas — Admin Catalog Queries

Todas validan:

```text
ACTIVE ADMIN
```

## 10.1 `fn_admin_author_search`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_author_search(
    p_actor_user_id BIGINT,
    p_query         VARCHAR,
    p_state         VARCHAR,
    p_page          INTEGER,
    p_page_size     INTEGER
)
RETURNS TABLE (
    author_id   BIGINT,
    name        VARCHAR,
    biography   VARCHAR,
    state       VARCHAR,
    created_at  TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ,
    total_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

SQLSTATE:

```text
P1001 P1002 P1003 P1004
```

## 10.2 `fn_admin_publisher_search`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_publisher_search(
    p_actor_user_id BIGINT,
    p_query         VARCHAR,
    p_state         VARCHAR,
    p_page          INTEGER,
    p_page_size     INTEGER
)
RETURNS TABLE (
    publisher_id BIGINT,
    name         VARCHAR,
    description  VARCHAR,
    state        VARCHAR,
    created_at   TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ,
    total_count  BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

SQLSTATE blanket ADMIN + `P1001`.

## 10.3 `fn_admin_category_search`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_category_search(
    p_actor_user_id BIGINT,
    p_query         VARCHAR,
    p_state         VARCHAR,
    p_page          INTEGER,
    p_page_size     INTEGER
)
RETURNS TABLE (
    category_id       BIGINT,
    parent_category_id BIGINT,
    parent_name       VARCHAR,
    name              VARCHAR,
    slug              VARCHAR,
    description       VARCHAR,
    state             VARCHAR,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ,
    total_count       BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

## 10.4 `fn_admin_book_search`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_book_search(
    p_actor_user_id BIGINT,
    p_query         VARCHAR,
    p_state         VARCHAR,
    p_page          INTEGER,
    p_page_size     INTEGER
)
RETURNS TABLE (
    book_id       BIGINT,
    title         VARCHAR,
    subtitle      VARCHAR,
    synopsis      VARCHAR,
    state         VARCHAR,
    authors_json  JSONB,
    categories_json JSONB,
    created_at    TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ,
    total_count   BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

## 10.5 `fn_admin_edition_search`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_edition_search(
    p_actor_user_id BIGINT,
    p_query         VARCHAR,
    p_state         VARCHAR,
    p_book_id       BIGINT,
    p_page          INTEGER,
    p_page_size     INTEGER
)
RETURNS TABLE (
    edition_id        BIGINT,
    book_id           BIGINT,
    book_title        VARCHAR,
    publisher_id      BIGINT,
    publisher_name    VARCHAR,
    sku               VARCHAR,
    isbn13            CHAR(13),
    language          VARCHAR,
    format            VARCHAR,
    page_count        INTEGER,
    publication_date  DATE,
    price             NUMERIC(11,2),
    cover_url         VARCHAR,
    cover_license     VARCHAR,
    cover_source_url  VARCHAR,
    cover_attribution VARCHAR,
    state             VARCHAR,
    stock_actual      INTEGER,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ,
    total_count       BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

---

# 11. Rutinas públicas — Admin Catalog Commands

## 11.1 Autor

### `sp_author_create`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_author_create(
    IN  p_actor_user_id BIGINT,
    IN  p_name          VARCHAR,
    IN  p_biography     VARCHAR,
    OUT o_author_id     BIGINT
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Estado inicial `ACTIVE`.

Errors:

```text
P1001 P1002 P1003 P1004
```

### `sp_author_update`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_author_update(
    IN p_actor_user_id BIGINT,
    IN p_author_id     BIGINT,
    IN p_name          VARCHAR,
    IN p_biography     VARCHAR
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Revalida invariantes de create.

Antes de confirmar, para cada Libro asociado reconstruye `autores_snapshot`; si supera 1000 caracteres → `P1001`, ROLLBACK.

Errors:

```text
P1001 P1002 P1003 P1004 P2001
```

### `sp_author_set_status`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_author_set_status(
    IN p_actor_user_id BIGINT,
    IN p_author_id     BIGINT,
    IN p_new_state     VARCHAR
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Same-state idempotente.

Errors:

```text
P1001 P1002 P1003 P1004 P2001
```

---

## 11.2 Editorial

### `sp_publisher_create`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_publisher_create(
    IN  p_actor_user_id BIGINT,
    IN  p_name          VARCHAR,
    IN  p_description   VARCHAR,
    OUT o_publisher_id  BIGINT
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Errors blanket ADMIN + `P1001`.

### `sp_publisher_update`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_publisher_update(
    IN p_actor_user_id BIGINT,
    IN p_publisher_id  BIGINT,
    IN p_name          VARCHAR,
    IN p_description   VARCHAR
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Errors:

```text
P1001 P1002 P1003 P1004 P2011
```

### `sp_publisher_set_status`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_publisher_set_status(
    IN p_actor_user_id BIGINT,
    IN p_publisher_id  BIGINT,
    IN p_new_state     VARCHAR
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Same-state idempotente.

---

## 11.3 Categoría

### `sp_category_create`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_category_create(
    IN  p_actor_user_id      BIGINT,
    IN  p_name               VARCHAR,
    IN  p_slug               VARCHAR,
    IN  p_description        VARCHAR,
    IN  p_parent_category_id BIGINT,
    OUT o_category_id        BIGINT
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Algoritmo:

1. assert ADMIN;
2. normalize slug;
3. validate parent if non-null;
4. parent must be root;
5. insert ACTIVE;
6. unique violation slug -> `P2024`.

Errors:

```text
P1001 P1002 P1003 P1004
P2021 P2023 P2024
```

### `sp_category_update`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_category_update(
    IN p_actor_user_id      BIGINT,
    IN p_category_id        BIGINT,
    IN p_name               VARCHAR,
    IN p_slug               VARCHAR,
    IN p_description        VARCHAR,
    IN p_parent_category_id BIGINT
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Revalida todo create.

Si categoría raíz tiene hijos:

```text
no puede convertirse en subcategoría -> P2023
```

### `sp_category_set_status`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_category_set_status(
    IN p_actor_user_id BIGINT,
    IN p_category_id   BIGINT,
    IN p_new_state     VARCHAR
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Same-state idempotente.

---

## 11.4 Libro

### Formato JSONB `p_authors`

```json
[
  {"authorId": 10, "order": 1},
  {"authorId": 22, "order": 2}
]
```

### Formato JSONB `p_category_ids`

```json
[3, 8, 10]
```

La Procedure debe rechazar:

- JSON que no sea array;
- objetos incompletos;
- IDs repetidos;
- order <= 0;
- order repetido;
- lista vacía.

### `sp_book_create`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_book_create(
    IN  p_actor_user_id BIGINT,
    IN  p_title         VARCHAR,
    IN  p_subtitle      VARCHAR,
    IN  p_synopsis      VARCHAR,
    IN  p_authors       JSONB,
    IN  p_category_ids  JSONB,
    OUT o_book_id       BIGINT
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Algoritmo:

1. assert ADMIN;
2. validar título;
3. parsear autores;
4. `>=1`;
5. parsear categorías;
6. `>=1`;
7. todos autores deben existir ACTIVE;
8. todas categorías deben existir ACTIVE;
9. validar orden;
10. insertar Libro ACTIVE;
11. insertar LibroAutor;
12. insertar LibroCategoria;
13. validar que snapshot potencial de autores <=1000.

Errors:

```text
P1001 P1002 P1003 P1004
P2001 P2002
P2021 P2022
P2032 P2033 P2034
```

### `sp_book_update`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_book_update(
    IN p_actor_user_id BIGINT,
    IN p_book_id       BIGINT,
    IN p_title         VARCHAR,
    IN p_subtitle      VARCHAR,
    IN p_synopsis      VARCHAR,
    IN p_authors       JSONB,
    IN p_category_ids  JSONB
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Algoritmo:

1. assert ADMIN;
2. lock Libro `FOR UPDATE`;
3. validate existence;
4. parse + validate complete replacement;
5. new inactive Author/Category not previously associated -> P2002/P2022;
6. existing inactive relation may remain;
7. `SET CONSTRAINTS uq_libro_autor_orden DEFERRED`;
8. replace associations;
9. update metadata;
10. if Libro ACTIVE final lists remain nonempty;
11. validate authors snapshot <=1000.

### `sp_book_set_status`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_book_set_status(
    IN p_actor_user_id BIGINT,
    IN p_book_id       BIGINT,
    IN p_new_state     VARCHAR
)
LANGUAGE plpgsql SECURITY INVOKER;
```

To ACTIVE:

```text
>=1 LibroAutor
>=1 LibroCategoria
```

Same-state idempotente.

---

## 11.5 Edición

### `sp_edition_create`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_edition_create(
    IN  p_actor_user_id     BIGINT,
    IN  p_book_id           BIGINT,
    IN  p_publisher_id      BIGINT,
    IN  p_sku               VARCHAR,
    IN  p_isbn13            VARCHAR,
    IN  p_language          VARCHAR,
    IN  p_format            VARCHAR,
    IN  p_page_count        INTEGER,
    IN  p_publication_date  DATE,
    IN  p_price             NUMERIC,
    IN  p_cover_url         VARCHAR,
    IN  p_cover_license     VARCHAR,
    IN  p_cover_source_url  VARCHAR,
    IN  p_cover_attribution VARCHAR,
    OUT o_edition_id        BIGINT
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Algoritmo:

1. assert ADMIN;
2. Libro must exist;
3. Publisher must exist ACTIVE;
4. canonical SKU;
5. canonical language;
6. validate format/pages/price;
7. ISBN null or checksum valid;
8. validate cover metadata;
9. insert Edicion ACTIVE;
10. insert Inventario 0/0;
11. normalize unique violation:
    - SKU -> P2044;
    - ISBN -> P2045.

Errors:

```text
P1001 P1002 P1003 P1004
P2011 P2012
P2031
P2044 P2045 P2046 P2047 P2048
```

### `sp_edition_update`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_edition_update(
    IN p_actor_user_id     BIGINT,
    IN p_edition_id        BIGINT,
    IN p_publisher_id      BIGINT,
    IN p_isbn13            VARCHAR,
    IN p_language          VARCHAR,
    IN p_format            VARCHAR,
    IN p_page_count        INTEGER,
    IN p_publication_date  DATE,
    IN p_price             NUMERIC,
    IN p_cover_url         VARCHAR,
    IN p_cover_license     VARCHAR,
    IN p_cover_source_url  VARCHAR,
    IN p_cover_attribution VARCHAR
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Revalida create.

Publisher:

- same current publisher allowed even if INACTIVE;
- new publisher must ACTIVE.

Cannot change:

```text
libro_id
sku
```

Frontera de errores de Edición:

```text
P1001 → estructura del parámetro/API (null obligatorio, blank, JSON mal
formado, pagination, sort, country/phone sintácticamente inválido)
P2046 → ISBN
P2047 → portada/licencia/atribución
P2048 → invariantes propias de Edición (SKU formato, LanguageCode,
formato, páginas, precio)
```

### `sp_edition_set_status`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_edition_set_status(
    IN p_actor_user_id BIGINT,
    IN p_edition_id    BIGINT,
    IN p_new_state     VARCHAR
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Same-state idempotente.

---

# 12. Rutinas públicas — Inventory

## 12.1 `fn_inventory_search`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_inventory_search(
    p_actor_user_id  BIGINT,
    p_edition_id     BIGINT,
    p_title_query    VARCHAR,
    p_sku            VARCHAR,
    p_low_stock_only BOOLEAN,
    p_page           INTEGER,
    p_page_size      INTEGER
)
RETURNS TABLE (
    edition_id     BIGINT,
    book_id        BIGINT,
    title          VARCHAR,
    sku            VARCHAR,
    isbn13         CHAR(13),
    edition_state  VARCHAR,
    stock_actual   INTEGER,
    stock_minimo   INTEGER,
    low_stock      BOOLEAN,
    updated_at     TIMESTAMPTZ,
    total_count    BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

Specific `edition_id` filter not found:

```text
0 rows
```

SQLSTATE blanket ADMIN + P1001.

---

## 12.2 `fn_inventory_movements`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_inventory_movements(
    p_actor_user_id BIGINT,
    p_edition_id    BIGINT,
    p_type          VARCHAR,
    p_page          INTEGER,
    p_page_size     INTEGER
)
RETURNS TABLE (
    movement_id    BIGINT,
    edition_id     BIGINT,
    order_id       BIGINT,
    actor_user_id  BIGINT,
    type           VARCHAR,
    quantity       INTEGER,
    stock_before   INTEGER,
    stock_after    INTEGER,
    reason         VARCHAR,
    event_at       TIMESTAMPTZ,
    total_count    BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

Si Inventario no existe:

```text
P3001
```

Orden:

```text
fecha DESC, id DESC
```

---

## 12.3 `sp_inventory_entry`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_inventory_entry(
    IN  p_actor_user_id BIGINT,
    IN  p_edition_id    BIGINT,
    IN  p_quantity      INTEGER,
    IN  p_reason        VARCHAR,
    OUT o_movement_id   BIGINT,
    OUT o_stock_before  INTEGER,
    OUT o_stock_after   INTEGER
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Algoritmo:

1. assert ADMIN;
2. quantity >0;
3. reason nonblank;
4. inventory FOR UPDATE;
5. before = current;
6. after = before + quantity;
7. update inventory;
8. insert ENTRY;
9. return.

Errors:

```text
P1001 P1002 P1003 P1004
P3001 P3003
```

---

## 12.4 `sp_inventory_adjust`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_inventory_adjust(
    IN  p_actor_user_id   BIGINT,
    IN  p_edition_id      BIGINT,
    IN  p_adjustment_type VARCHAR,
    IN  p_quantity        INTEGER,
    IN  p_reason          VARCHAR,
    OUT o_movement_id     BIGINT,
    OUT o_stock_before    INTEGER,
    OUT o_stock_after     INTEGER
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Allowed types only:

```text
ADJUSTMENT_IN
ADJUSTMENT_OUT
```

OUT insufficient -> P3002.

Other invalid -> P3003/P1001.

---

## 12.5 `sp_inventory_set_minimum`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_inventory_set_minimum(
    IN  p_actor_user_id BIGINT,
    IN  p_edition_id    BIGINT,
    IN  p_stock_minimum INTEGER,
    OUT o_stock_minimum INTEGER
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Same value idempotent.

No movement.

Errors:

```text
P1001 P1002 P1003 P1004
P3001 P3004
```

---

# 13. Rutinas públicas — Cart

## 13.1 `fn_cart_get`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_cart_get(
    p_actor_user_id BIGINT
)
RETURNS TABLE (
    cart_id       BIGINT,
    state         VARCHAR,
    items         JSONB,
    total_current NUMERIC(30,2)
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

Siempre retorna exactamente una fila.

Sin carrito:

```text
cart_id = NULL
state = NULL
items = []
total_current = 0.00
```

Cada item JSON:

```json
{
  "cartItemId": 1,
  "editionId": 4,
  "title": "Libro",
  "authors": "Autor A; Autor B",
  "sku": "PLG-001",
  "coverUrl": null,
  "quantity": 2,
  "currentPrice": 10.00,
  "currentSubtotal": 20.00,
  "available": true,
  "unavailabilityReason": null
}
```

SQLSTATE:

```text
P1002 P1003 P1005
```

---

## 13.2 `sp_cart_add_item`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_cart_add_item(
    IN  p_actor_user_id BIGINT,
    IN  p_edition_id    BIGINT,
    IN  p_quantity      INTEGER,
    OUT o_cart_id       BIGINT,
    OUT o_cart_item_id  BIGINT,
    OUT o_quantity      INTEGER
)
LANGUAGE plpgsql SECURITY INVOKER;
```

### Creación concurrente de carrito

1. buscar ACTIVE `FOR UPDATE`;
2. si no existe, intentar INSERT;
3. si `uqx_carrito_cliente_active` colisiona:
   - capturar constraint name;
   - reconsultar ACTIVE `FOR UPDATE`;
4. continuar.

### Item existente

Si existe:

```text
new quantity = old + input
```

validar contra stock.

Errors:

```text
P1001 P1002 P1003 P1005
P2041 P2042 P2043
P3001 P3002
P4004
```

---

## 13.3 `sp_cart_update_item`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_cart_update_item(
    IN  p_actor_user_id BIGINT,
    IN  p_cart_item_id  BIGINT,
    IN  p_quantity      INTEGER,
    OUT o_cart_id       BIGINT,
    OUT o_cart_item_id  BIGINT,
    OUT o_quantity      INTEGER
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Locks cart.

If item ajeno/inexistente:

```text
P4003
```

Errors:

```text
P1001 P1002 P1003 P1005
P3002
P4001 P4003 P4004
```

---

## 13.4 `sp_cart_remove_item`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_cart_remove_item(
    IN p_actor_user_id BIGINT,
    IN p_cart_item_id  BIGINT
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Errors:

```text
P1002 P1003 P1005
P4001 P4003
```

DELETE item.

Carrito remains ACTIVE.

---

# 14. Rutinas públicas — Checkout / Orders

## 14.1 `sp_checkout`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_checkout(
    IN  p_actor_user_id       BIGINT,
    IN  p_address_id          BIGINT,
    IN  p_payment_method      VARCHAR,
    IN  p_payment_outcome     VARCHAR,
    OUT o_order_id            BIGINT,
    OUT o_order_state         VARCHAR,
    OUT o_payment_state       VARCHAR,
    OUT o_total               NUMERIC,
    OUT o_payment_reference   VARCHAR
)
LANGUAGE plpgsql
SECURITY INVOKER;
```

## 14.1.1 Validación inicial

1. assert ACTIVE CUSTOMER;
2. method in CARD/TRANSFER else P1001;
3. outcome in APPROVED/REJECTED else P5005;
4. select ACTIVE cart FOR UPDATE;
5. no cart -> P4001;
6. no items -> P4002;
7. select address belonging to customer FOR SHARE;
8. not found -> P5004.

## 14.1.2 Snapshot de catálogo

Obtener en una sola fase lógica para cada item:

- Edicion;
- Libro;
- Editorial;
- authors snapshot;
- precio;
- format;
- language;
- ISBN;
- SKU.

Si Libro inactive -> P2043.

Si Edicion inactive -> P2042.

Libro/Edición se bloquean `FOR SHARE` (ordenados por `EdicionId`) antes de capturar snapshots; estado, precio y stock se validan después de adquirir todos los locks. Así una actualización administrativa concurrente no puede cambiar precio/estado entre lectura e inserción.

## 14.1.3 Inventario

IDs:

```text
ORDER BY edicion_id ASC
FOR UPDATE
```

Por cada item:

```text
stock >= quantity
```

si no:

```text
P3002
```

## 14.1.4 Totales

Para cada line:

```text
subtotal = price * quantity
```

Acumulación:

```text
NUMERIC(30,2)
```

Total > 0.

## 14.1.5 Creación base

Crear:

```text
Pedido PENDING_PAYMENT
Historial NULL -> PENDING_PAYMENT SYSTEM
PedidoItem[]
PedidoDireccion
Pago PENDING
```

## 14.1.6 APPROVED

1. `v_reference := fn_generate_payment_reference()`;
2. UPDATE Pago APPROVED + reference;
3. por cada item:
   - before = stock;
   - after = stock - qty;
   - UPDATE Inventario;
   - INSERT SALE;
4. UPDATE Pedido CONFIRMED;
5. INSERT historial PENDING_PAYMENT -> CONFIRMED SYSTEM;
6. UPDATE Carrito CHECKED_OUT;
7. outputs.

Si reference unique collision (extremadamente improbable):

```text
P5007
```

## 14.1.7 REJECTED

1. UPDATE Pago:
   - REJECTED;
   - referencia NULL;
   - detalle_resultado = valor académico;
2. UPDATE Pedido CANCELLED;
3. INSERT historial PENDING_PAYMENT -> CANCELLED SYSTEM;
4. no stock change;
5. no SALE;
6. Carrito remains ACTIVE;
7. outputs.

## 14.1.8 Errors

```text
P1001 P1002 P1003 P1005
P2041 P2042 P2043
P3001 P3002
P4001 P4002
P5004 P5005 P5007
```

---

## 14.2 `fn_customer_orders`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_customer_orders(
    p_actor_user_id BIGINT,
    p_page          INTEGER,
    p_page_size     INTEGER
)
RETURNS TABLE (
    order_id      BIGINT,
    created_at    TIMESTAMPTZ,
    order_state   VARCHAR,
    total         NUMERIC(30,2),
    payment_state VARCHAR,
    total_count   BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

Order:

```text
fecha_creacion DESC, pedido_id DESC
```

Errors blanket CUSTOMER + P1001 pagination.

---

## 14.3 `fn_customer_order_detail`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_customer_order_detail(
    p_actor_user_id BIGINT,
    p_order_id      BIGINT
)
RETURNS TABLE (
    order_id       BIGINT,
    order_state    VARCHAR,
    subtotal       NUMERIC(30,2),
    total          NUMERIC(30,2),
    created_at     TIMESTAMPTZ,
    updated_at     TIMESTAMPTZ,
    items          JSONB,
    address        JSONB,
    payment        JSONB,
    state_history  JSONB
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

Pedido ajeno e inexistente:

```text
P5001
```

---

## 14.4 `sp_order_cancel`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_order_cancel(
    IN  p_actor_user_id   BIGINT,
    IN  p_order_id        BIGINT,
    OUT o_order_id        BIGINT,
    OUT o_previous_state  VARCHAR,
    OUT o_order_state     VARCHAR,
    OUT o_payment_state   VARCHAR,
    OUT o_restored_units  BIGINT
)
LANGUAGE plpgsql SECURITY INVOKER;
```

### Actor

Acepta:

```text
CUSTOMER propietario
ADMIN
```

pero siempre ACTIVE.

### Orden normativo

```text
1. Pedido FOR UPDATE
2. comprobar existencia/visibilidad
3. comprobar ownership si CUSTOMER
4. comprobar estado cancelable
5. comprobar Pago
6. obtener items
7. bloquear Inventarios ASC
8. comprobar SALE
9. restaurar stock
10. crear CANCELLATION
11. Pago -> REFUNDED
12. Pedido -> CANCELLED
13. historial
```

Para CUSTOMER ajeno: `P5001` antes de revelar estado, pago o cualquier otro detalle.

### States

Allowed:

```text
CONFIRMED
PREPARING
```

Else:

```text
P5003
```

### Restore

For each PedidoItem:

1. find SALE same order+edition;
2. missing -> P3006;
3. ensure no CANCELLATION;
4. update inventory + qty;
5. insert CANCELLATION.

Pago must be APPROVED else P5006.

Then:

```text
Pago -> REFUNDED
Pedido -> CANCELLED
Historial USER + actor
```

Errors:

```text
P1002 P1003
P5001 P5003 P5006
P3005 P3006
```

For CUSTOMER ownership failure:

```text
P5001
```

not authorization-disclosing error.

---

## 14.5 `fn_admin_orders`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_orders(
    p_actor_user_id BIGINT,
    p_state         VARCHAR,
    p_date_from     TIMESTAMPTZ,
    p_date_to       TIMESTAMPTZ,
    p_customer_id   BIGINT,
    p_page          INTEGER,
    p_page_size     INTEGER
)
RETURNS TABLE (
    order_id       BIGINT,
    customer_id    BIGINT,
    customer_name  VARCHAR,
    created_at     TIMESTAMPTZ,
    order_state    VARCHAR,
    total          NUMERIC(30,2),
    payment_state  VARCHAR,
    total_count    BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

Validation:

```text
from <= to
state valid
pagination
```

Errors blanket ADMIN + P1001.

---

## 14.6 `fn_admin_order_detail`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_order_detail(
    p_actor_user_id BIGINT,
    p_order_id      BIGINT
)
RETURNS TABLE (
    order_id          BIGINT,
    customer_id       BIGINT,
    customer_email    VARCHAR,
    customer_name     VARCHAR,
    order_state       VARCHAR,
    subtotal          NUMERIC(30,2),
    total             NUMERIC(30,2),
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ,
    items             JSONB,
    address           JSONB,
    payment           JSONB,
    state_history     JSONB,
    inventory_movements JSONB
)
LANGUAGE plpgsql STABLE SECURITY INVOKER;
```

Errors:

```text
P1002 P1003 P1004
P5001
```

---

## 14.7 `sp_order_change_status`

```sql
CREATE OR REPLACE PROCEDURE pliego.sp_order_change_status(
    IN  p_actor_user_id  BIGINT,
    IN  p_order_id       BIGINT,
    IN  p_new_state      VARCHAR,
    OUT o_order_id       BIGINT,
    OUT o_previous_state VARCHAR,
    OUT o_order_state    VARCHAR
)
LANGUAGE plpgsql SECURITY INVOKER;
```

Only:

```text
CONFIRMED -> PREPARING
PREPARING -> SHIPPED
SHIPPED -> DELIVERED
```

`CANCELLED` never accepted.

Same-state is **not** idempotent here.

A retry after response loss must follow REST recovery policy.

Errors:

```text
P1001 P1002 P1003 P1004
P5001 P5002
```

---

# 15. Pago — ausencia deliberada de API pública independiente

No existen:

```text
sp_payment_approve
sp_payment_reject
sp_payment_refund
```

Responsabilidad:

```text
sp_checkout     -> PENDING -> APPROVED/REJECTED
sp_order_cancel -> APPROVED -> REFUNDED
```

Así existe un único escritor por transición.

---

# 16. Matriz rutina pública → SQLSTATE

Los blanket de actor se entienden incluidos en toda rutina privada.

| Rutina | SQLSTATE específicos adicionales |
|---|---|
| sp_customer_register | P1001, P1101 |
| fn_user_auth_data | — |
| fn_admin_customer_search | P1001 |
| sp_customer_set_status | P1001, P1102 |
| fn_customer_profile | P1102 |
| sp_customer_update | P1001, P1102 |
| fn_address_list | — |
| sp_address_create | P1001 |
| sp_address_update | P1001, P1103 |
| sp_address_delete | P1103 |
| sp_address_set_primary | P1103 |
| fn_catalog_search | P1001 |
| fn_edition_detail | — |
| fn_admin_author_search | P1001 |
| fn_admin_publisher_search | P1001 |
| fn_admin_category_search | P1001 |
| fn_admin_book_search | P1001 |
| fn_admin_edition_search | P1001 |
| sp_author_create | P1001 |
| sp_author_update | P1001, P2001 |
| sp_author_set_status | P1001, P2001 |
| sp_publisher_create | P1001 |
| sp_publisher_update | P1001, P2011 |
| sp_publisher_set_status | P1001, P2011 |
| sp_category_create | P1001, P2021, P2023, P2024 |
| sp_category_update | P1001, P2021, P2023, P2024 |
| sp_category_set_status | P1001, P2021 |
| sp_book_create | P1001, P2001, P2002, P2021, P2022, P2032, P2033, P2034 |
| sp_book_update | P1001, P2001, P2002, P2021, P2022, P2031, P2032, P2033, P2034 |
| sp_book_set_status | P1001, P2031, P2032, P2033 |
| sp_edition_create | P1001, P2011, P2012, P2031, P2044, P2045, P2046, P2047, P2048 |
| sp_edition_update | P1001, P2011, P2012, P2041, P2044, P2045, P2046, P2047, P2048 |
| sp_edition_set_status | P1001, P2041 |
| fn_inventory_search | P1001 |
| fn_inventory_movements | P1001, P3001 |
| sp_inventory_entry | P1001, P3001, P3003 |
| sp_inventory_adjust | P1001, P3001, P3002, P3003 |
| sp_inventory_set_minimum | P1001, P3001, P3004 |
| fn_cart_get | — |
| sp_cart_add_item | P1001, P2041, P2042, P2043, P3001, P3002, P4004 |
| sp_cart_update_item | P1001, P3002, P4001, P4003, P4004 |
| sp_cart_remove_item | P4001, P4003 |
| sp_checkout | P1001, P2041, P2042, P2043, P3001, P3002, P4001, P4002, P5004, P5005, P5007 |
| fn_customer_orders | P1001 |
| fn_customer_order_detail | P5001 |
| sp_order_cancel | P3005, P3006, P5001, P5003, P5006 |
| fn_admin_orders | P1001 |
| fn_admin_order_detail | P5001 |
| sp_order_change_status | P1001, P5001, P5002 |

Blanket adicional:

### CUSTOMER private

```text
P1002 P1003 P1005
```

### ADMIN private

```text
P1002 P1003 P1004
```

### `sp_order_cancel`

Por aceptar ambos roles:

```text
P1002 P1003
```

y valida rol/ownership internamente.

---

# 17. Normalización de unique violations

Las Procedures capturan `unique_violation` únicamente cuando pueden verificar el nombre del constraint.

Se debe utilizar:

```plpgsql
GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
```

Mapa obligatorio:

```text
uq_usuario_email                  -> P1101
uq_categoria_slug                 -> P2024
uq_edicion_sku                    -> P2044
uq_edicion_isbn                   -> P2045
uq_pago_referencia                -> P5007
uqx_movimiento_pedido_edicion_tipo-> P3005
```

### `uqx_carrito_cliente_active`

No se convierte directamente en error.

`sp_cart_add_item`:

1. captura conflicto;
2. relee el Carrito ACTIVE;
3. continúa con ese carrito.

### `uqx_direccion_cliente_principal`

No debería escapar porque las Procedures serializan sobre Cliente y desmarcan la anterior.

Si escapa por un camino no previsto:

```text
P1001
```

---

# 18. Trigger Functions

## 18.1 `fn_set_fecha_actualizacion`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_set_fecha_actualizacion()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER;
```

Cuerpo:

```plpgsql
BEGIN
    NEW.fecha_actualizacion := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
```

---

## 18.2 `fn_prevent_update_delete`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_prevent_update_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER;
```

Cuerpo:

```plpgsql
BEGIN
    RAISE EXCEPTION
        USING ERRCODE = 'P9001',
              MESSAGE = 'IMMUTABLE_HISTORY_VIOLATION';
END;
```

---

## 18.3 `fn_validate_category_hierarchy`

```sql
CREATE OR REPLACE FUNCTION pliego.fn_validate_category_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER;
```

Cuerpo normativo:

1. si parent NULL → RETURN NEW;
2. si parent=self → P2023;
3. localizar parent;
4. parent inexistente → P2021;
5. parent.categoria_padre_id debe ser NULL;
6. no puede producir ciclo;
7. RETURN NEW.

Es defensa final.

Las Procedures realizan la misma validación antes para controlar SQLSTATE.

---

# 19. Triggers físicos

## 19.1 `fecha_actualizacion` — 13 triggers

Se crean BEFORE UPDATE sobre:

1. usuario;
2. cliente;
3. direccion;
4. autor;
5. editorial;
6. categoria;
7. libro;
8. edicion;
9. inventario;
10. carrito;
11. carrito_item;
12. pedido;
13. pago.

Patrón:

```sql
CREATE TRIGGER trg_<tabla>_set_updated_at
BEFORE UPDATE ON pliego.<tabla>
FOR EACH ROW
EXECUTE FUNCTION pliego.fn_set_fecha_actualizacion();
```

---

## 19.2 Append-only — 4 triggers

Sobre:

1. movimiento_inventario;
2. pedido_item;
3. pedido_direccion;
4. pedido_estado_historial.

Patrón:

```sql
CREATE TRIGGER trg_<tabla>_append_only
BEFORE UPDATE OR DELETE ON pliego.<tabla>
FOR EACH ROW
EXECUTE FUNCTION pliego.fn_prevent_update_delete();
```

---

## 19.3 Categoría — 1 trigger

```sql
CREATE TRIGGER trg_categoria_validate_hierarchy
BEFORE INSERT OR UPDATE OF categoria_padre_id
ON pliego.categoria
FOR EACH ROW
EXECUTE FUNCTION pliego.fn_validate_category_hierarchy();
```

### Total triggers

```text
13 + 4 + 1 = 18
```

---

# 20. Rutinas que no deben existir

Para evitar bypass de la arquitectura, no crear rutinas públicas como:

```text
sp_set_stock
sp_payment_set_status
sp_order_set_cancelled
sp_insert_order_item
sp_insert_inventory_movement
sp_force_cart_checkout
```

Las operaciones sensibles pertenecen exclusivamente a sus casos de uso aprobados.

---

# 21. Orden de locking normativo

## Cart

```text
Carrito ACTIVE FOR UPDATE
```

## Checkout

```text
1. Carrito ACTIVE              FOR UPDATE
2. Dirección                   FOR SHARE
3. Libro/Edición involucrados  FOR SHARE, ORDER BY edicion_id ASC
4. Inventarios                 FOR UPDATE, ORDER BY edicion_id ASC
5. validar estado + precio + stock
6. crear Pedido
```

Como el pago es simulado y no existe llamada externa, la transacción es corta y el coste es razonable.

## Inventory admin

```text
Inventario FOR UPDATE
```

## Cancel

```text
1. Pedido                        FOR UPDATE
2. Pago
3. Inventarios                   ORDER BY edicion_id ASC FOR UPDATE
```

## Address primary

```text
Cliente propietario              FOR UPDATE
```

## Book update

```text
Libro                            FOR UPDATE
```

## Maestros referenciados por estado

```text
sp_book_create/update:
Autores     FOR SHARE, ORDER BY autor_id ASC
Categorías  FOR SHARE, ORDER BY categoria_id ASC

sp_edition_create/update:
Libro       FOR SHARE
Editorial   FOR SHARE
```

Así un `set_status` concurrente sobre maestros no puede invalidar la comprobación entre lectura e inserción.

No se modifica este orden dentro de la implementación sin revisar concurrencia.

---

# 22. Paginación

Funciones paginadas:

```text
page >= 0
1 <= page_size <= 50
```

Offset:

```text
OFFSET page * page_size
LIMIT page_size
```

Cada fila no vacía incluye:

```text
COUNT(*) OVER() AS total_count
```

Si no existen filas, el Gateway interpreta:

```text
totalCount = 0
```

Esto evita una segunda consulta.

---

# 23. Resultados JSONB

JSONB se permite únicamente como:

- parámetro transitorio;
- resultado compuesto transitorio.

No como almacenamiento persistente de dominio.

Usos:

```text
fn_edition_detail.authors_json
fn_edition_detail.categories_json
fn_admin_book_search.authors_json
fn_admin_book_search.categories_json
fn_cart_get.items
fn_customer_order_detail.*
fn_admin_order_detail.*
sp_book_create/update input lists
```

---

# 24. Retry y recovery

No se introduce `Idempotency-Key` general en v1.

El REST Contract debe documentar:

- no reejecutar ciegamente comandos no idempotentes después de timeout;
- consultar el estado del recurso cuando el resultado sea desconocido;
- `sp_order_change_status` no es same-state idempotente;
- un nuevo checkout tras `REJECTED` representa un nuevo intento comercial;
- checkout APPROVED queda protegido porque el Carrito termina `CHECKED_OUT`.

---

# 25. Criterios de prueba del catálogo

## 25.1 Helpers

- ISBN válido/inválido;
- country code válido/inválido;
- canonicalizers;
- cover rules;
- payment reference pattern;
- actor blanket;
- pagination.

## 25.2 Set-status

Para:

- customer;
- author;
- publisher;
- category;
- book;
- edition;

probar:

```text
same-state -> éxito
```

## 25.3 Payment outcome

```text
UNKNOWN -> P5005
```

## 25.4 MONEY

Probar un `PedidoItem.subtotal` superior al máximo de `NUMERIC(14,2)` y verificar que:

```text
NUMERIC(30,2)
```

lo almacena sin pérdida.

## 25.5 Search

- empty;
- default order;
- pagination;
- invalid sort;
- nonexistent valid category slug -> empty.

## 25.6 Checkout

- approved;
- rejected;
- insufficient stock;
- last unit concurrent;
- inactive edition;
- inactive book;
- invalid address;
- address deleted concurrently;
- snapshot country/language;
- payment reference approved;
- rejected reference null;
- exactly two history rows;
- no SALE on reject;
- rollback technical error.

## 25.7 Cancel

- CUSTOMER owner;
- CUSTOMER non-owner;
- ADMIN;
- invalid states;
- double cancel concurrent;
- SALE prerequisite;
- refund;
- exact stock restore.

## 25.8 CHECK

Para entradas de negocio inválidas:

```text
assert SQLSTATE LIKE 'P____'
```

---

# 26. Flyway grouping recomendado

El catálogo de rutinas puede implementarse tras las tablas:

```text
V011__create_internal_helpers.sql
V012__create_identity_customer_routines.sql
V013__create_catalog_query_functions.sql
V014__create_catalog_admin_routines.sql
V015__create_inventory_routines.sql
V016__create_cart_routines.sql
V017__create_sales_routines.sql
V018__create_trigger_functions.sql
V019__create_triggers.sql
```

No se obliga a usar exactamente estos números si el repositorio ya utiliza otra secuencia.

Las firmas públicas deben permanecer estables una vez consumidas por Java.

---

# 27. Trazabilidad a los 24 casos de uso

| Caso de uso | Rutina pública |
|---|---|
| CU-AUTH-01 | sp_customer_register |
| CU-AUTH-02 | fn_user_auth_data |
| CU-ADM-SEC-01 | fn_admin_customer_search, sp_customer_set_status |
| CU-CUS-01 | fn_customer_profile, sp_customer_update |
| CU-CUS-02 | fn_address_list, sp_address_create/update/delete/set_primary |
| CU-CAT-01 | fn_catalog_search |
| CU-CAT-02 | fn_edition_detail |
| CU-ADM-CAT-01 | fn_admin_author_search + sp_author_* |
| CU-ADM-CAT-02 | fn_admin_publisher_search + sp_publisher_* |
| CU-ADM-CAT-03 | fn_admin_category_search + sp_category_* |
| CU-ADM-CAT-04 | fn_admin_book_search + sp_book_* |
| CU-ADM-CAT-05 | fn_admin_edition_search + sp_edition_* |
| CU-INV-01 | fn_inventory_search, fn_inventory_movements |
| CU-INV-02 | sp_inventory_entry, sp_inventory_adjust |
| CU-INV-03 | sp_inventory_set_minimum |
| CU-CART-01 | fn_cart_get |
| CU-CART-02 | sp_cart_add_item |
| CU-CART-03 | sp_cart_update_item |
| CU-CART-04 | sp_cart_remove_item |
| CU-SAL-01 | sp_checkout |
| CU-PAY-01 | interno a sp_checkout |
| CU-SAL-02 | fn_customer_orders, fn_customer_order_detail |
| CU-SAL-03 | sp_order_cancel |
| CU-ADM-SAL-01 | fn_admin_orders, fn_admin_order_detail, sp_order_change_status, sp_order_cancel |

Cobertura:

```text
24 / 24
```

---

# 28. Conteo de rutinas públicas

## Identity / Customer

```text
11
```

## Catalog public/admin

```text
22
```

## Inventory

```text
5
```

## Cart

```text
4
```

## Sales

```text
7
```

Total:

```text
49
```

Pago no agrega writer público independiente.

---

# 29. Validación final

| Pregunta | Resultado |
|---|---|
| ¿Las 49 rutinas tienen firma física? | Sí |
| ¿Las 24 CU están cubiertas? | Sí |
| ¿Toda rutina privada valida actor? | Sí |
| ¿Los SQLSTATE están cerrados por rutina? | Sí |
| ¿Updates revalidan invariantes de create? | Sí |
| ¿Existe un único writer público de pago? | Sí, distribuido por transición aprobada |
| ¿Existe un único owner de CANCELLED post-pago? | Sí: sp_order_cancel |
| ¿Checkout es una sola llamada? | Sí |
| ¿Payment simulator es determinista? | Sí |
| ¿APPROVED genera SIM-UUID? | Sí |
| ¿REJECTED deja referencia NULL? | Sí |
| ¿Dinero usa NUMERIC/BigDecimal? | Sí |
| ¿Locks tienen orden determinista? | Sí |
| ¿JSONB se usa como almacenamiento persistente? | No |
| ¿Se requieren nuevas entidades? | No |
| ¿Se requieren extensiones PostgreSQL? | No |
| ¿Triggers implementan checkout? | No |
| ¿Frontend condiciona rutinas? | No |

---

# 30. Criterio de aprobación

El catálogo pasa a `BASELINE APROBADA`. Condiciones cumplidas:

1. DAC v1.1 aceptado (incluye P9001 técnico y política 23514);
2. Modelo Físico v1.0 aprobado con PM-01–PM-07;
3. sin nuevas reglas de negocio;
4. 49 firmas aceptadas;
5. JSONB transitorio aceptado;
6. 18 triggers técnicos aceptados;
7. matriz SQLSTATE completa;
8. patch RC-01–RC-09 aplicado.

Una vez aprobado, Codex/Claude no deberán inventar nuevas rutinas públicas ni cambiar firmas sin gestión de cambio.

---

# 31. Próxima etapa

```text
Catálogo SP / Functions / Triggers v1.0
        ↓
Flyway SQL ejecutable
        ↓
Pruebas PostgreSQL
        ↓
REST API Contract
        ↓
Spring Gateways
        ↓
Implementación integrada
```

---

# 32. Historial

| Versión | Fecha | Estado | Descripción |
|---|---|---|---|
| 1.0 | 2026-09-23 | BASELINE APROBADA | Primer catálogo definitivo de 49 rutinas públicas, helpers internos y 18 triggers. Fija firmas PostgreSQL, cuerpos normativos, SQLSTATE, locking, SIM-UUID, JSONB transitorio y trazabilidad completa a UCB/DER/DD/DAC/Modelo Físico. Patch RC-01–RC-09 aplicado. |

---

# 33. Referencias técnicas

- PostgreSQL 18 — `CREATE PROCEDURE`.
- PostgreSQL 18 — `CREATE FUNCTION` y `RETURNS TABLE`.
- PostgreSQL 18 — PL/pgSQL `RAISE` y SQLSTATE.
- PostgreSQL 18 — UUID nativo (`uuidv4()`).
- Artefactos PLIEGO enumerados en la cabecera.
