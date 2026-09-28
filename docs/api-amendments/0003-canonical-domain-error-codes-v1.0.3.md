# Canonical Domain Error Codes — API Amendment v1.0.3

**Status:** Active amendment to the approved PLIEGO v1 contracts; it establishes the working standard for error codes

**Applies to:** backend-v1.0.0 REST base path `/api/v1` and every client

**Source baselines:** [REST API Contract v1.0](../../rest-api-contract-v1.0.md) §28–§30, [Database API Contract v1.0](../../database-api-contract-v1.0.md) §10, [DB Routines Catalog v1.0](../../db-routines-catalog-v1.0.md)

The approved baselines already make the PostgreSQL SQLSTATE the decision key (Database API §10.1) and publish it as the Problem Details `code` (REST §28.1: `"type": "urn:pliego:problem:P3002"`, `"code": "P3002"`). REST §30 and Database API §10.2 also list each SQLSTATE beside a symbolic name in a column labelled “Código”. That label was read as the wire value: frontend code and tests branched on names such as `INSUFFICIENT_STOCK` that the API never emits, and `fn_cart_get` reported cart unavailability with symbolic names while the same conditions surface elsewhere as SQLSTATEs. This amendment removes that ambiguity. It leaves the baseline documents and migrations V001–V024 unchanged.

## Standard

1. **PostgreSQL owns every business/domain condition.** Each condition has exactly one canonical identifier: its custom SQLSTATE (`Pxxxx`), raised through `pliego.fn_raise_domain_error` or, for `P9001`, the immutable-history trigger.
2. **The symbolic name is a label, not a code.** It travels only as the PostgreSQL `MESSAGE`, in `DatabaseError`, and in documentation. No client may send, receive, or branch on it.
3. **Spring passes the SQLSTATE through unchanged.** `DatabaseExceptionTranslator` resolves the SQLSTATE to `DatabaseError`; `ApiExceptionHandler` publishes `code = <SQLSTATE>`, `type = urn:pliego:problem:<SQLSTATE>`, the approved HTTP status, and a Spanish title/detail. Spring never invents an alternate name for a database condition.
4. **Data fields that name a domain condition use the same SQLSTATE.** `CartItem.unavailabilityReason` is the only such field in v1 (see below).
5. **REST-layer failures stay in Spring with symbolic codes.** HTTP, authentication, JSON binding, Bean Validation, and the transient card check never reach PostgreSQL and are not given SQLSTATEs.
6. **Clients consume the canonical code directly.** Branch on `code` (and `status` where the contract says so), never on `title`/`detail` text, and never through a client-side alias or normalization table.

## Canonical domain catalog

Every row is raised by the current Database API and mapped one-to-one in `com.pliego.foundation.database.DatabaseError`; no SQLSTATE has two names and no name has two SQLSTATEs.

| Wire `code` (SQLSTATE) | Documentation label | HTTP |
|---|---|---|
| `P1001` | INVALID_ARGUMENT | 400 |
| `P1002` | ACTOR_NOT_FOUND | 401 |
| `P1003` | ACTOR_INACTIVE | 401 |
| `P1004` | ACTOR_NOT_ADMIN | 403 |
| `P1005` | ACTOR_NOT_CUSTOMER | 403 |
| `P1101` | EMAIL_ALREADY_EXISTS | 409 |
| `P1102` | CUSTOMER_NOT_FOUND | 404 |
| `P1103` | ADDRESS_NOT_FOUND | 404 |
| `P2001` | AUTHOR_NOT_FOUND | 404 |
| `P2002` | AUTHOR_INACTIVE | 409 |
| `P2011` | PUBLISHER_NOT_FOUND | 404 |
| `P2012` | PUBLISHER_INACTIVE | 409 |
| `P2021` | CATEGORY_NOT_FOUND | 404 |
| `P2022` | CATEGORY_INACTIVE | 409 |
| `P2023` | CATEGORY_INVALID_HIERARCHY | 409 |
| `P2024` | CATEGORY_SLUG_EXISTS | 409 |
| `P2031` | BOOK_NOT_FOUND | 404 |
| `P2032` | BOOK_REQUIRES_AUTHOR | 409 |
| `P2033` | BOOK_REQUIRES_CATEGORY | 409 |
| `P2034` | AUTHOR_ORDER_INVALID | 400 |
| `P2041` | EDITION_NOT_FOUND | 404 |
| `P2042` | EDITION_INACTIVE | 409 |
| `P2043` | BOOK_INACTIVE | 409 |
| `P2044` | SKU_ALREADY_EXISTS | 409 |
| `P2045` | ISBN_ALREADY_EXISTS | 409 |
| `P2046` | ISBN_INVALID | 400 |
| `P2047` | COVER_METADATA_INVALID | 400 |
| `P2048` | EDITION_DATA_INVALID | 400 |
| `P3001` | INVENTORY_NOT_FOUND | 404 |
| `P3002` | INSUFFICIENT_STOCK | 409 |
| `P3003` | STOCK_QUANTITY_INVALID | 400 |
| `P3004` | STOCK_MINIMUM_INVALID | 400 |
| `P3005` | STOCK_MOVEMENT_DUPLICATE | 409 |
| `P3006` | SALE_REQUIRED_FOR_CANCELLATION | 409 |
| `P4001` | CART_NOT_ACTIVE | 409 |
| `P4002` | CART_EMPTY | 409 |
| `P4003` | CART_ITEM_NOT_FOUND | 404 |
| `P4004` | CART_QUANTITY_INVALID | 400 |
| `P5001` | ORDER_NOT_FOUND | 404 |
| `P5002` | ORDER_INVALID_TRANSITION | 409 |
| `P5003` | ORDER_NOT_CANCELLABLE | 409 |
| `P5004` | CHECKOUT_ADDRESS_INVALID | 404 |
| `P5005` | PAYMENT_OUTCOME_INVALID | 400 |
| `P5006` | PAYMENT_STATE_INVALID | 409 |
| `P5007` | PAYMENT_REFERENCE_CONFLICT | 500 |
| `P9001` | IMMUTABLE_HISTORY_VIOLATION | 500 |

`P5007` and `P9001` are server-side integrity failures (500). After `P5007` the checkout transaction rolled back completely, so a new deliberate checkout is safe (REST §33.4). Any other 5xx from a non-idempotent command is an unknown outcome.

## REST-layer codes (not database conditions)

| Wire `code` | HTTP | Origin |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Bean Validation / strict request binding |
| `MALFORMED_JSON` | 400 | Unreadable JSON body |
| `INVALID_CARD_NUMBER` | 400 | Transient CARD number check in `CheckoutController`; the number never reaches PostgreSQL |
| `AUTH_INVALID_CREDENTIALS` | 401 | Login failure, including blocked accounts |
| `AUTH_REQUIRED` | 401 | Missing bearer token |
| `AUTH_INVALID_TOKEN` | 401 | Invalid or expired bearer token |
| `ACCESS_DENIED` | 403 | Spring Security role check |
| `NOT_FOUND` | 404 | Unknown route |
| `DATABASE_CONTRACT_VIOLATION` | 500 | Unexpected `23514` check violation (technical) |
| `INTERNAL_SERVER_ERROR` | 500 | Unmapped technical failure |

## Database API amendment

### `fn_cart_get(p_actor_user_id)` — `unavailabilityReason`

Signature, ordering, and every other field are unchanged. The per-item reason now reports the canonical SQLSTATE of the condition that currently prevents purchase, evaluated in this order:

| Condition | Before (V016) | Now (V025) |
|---|---|---|
| Book inactive | `BOOK_INACTIVE` | `P2043` |
| Edition inactive | `EDITION_INACTIVE` | `P2042` |
| Stock below the cart quantity | `INSUFFICIENT_STOCK` | `P3002` |
| Purchasable | `null` | `null` |

These are the SQLSTATEs the cart and checkout commands raise for the same conditions, so a client can explain a checkout conflict and the refreshed cart with a single vocabulary.

## Implementation mapping

- Flyway: `V025__canonical_cart_unavailability_codes.sql` replaces `fn_cart_get`; released migrations are unchanged.
- Spring: `CartResponses.Item.unavailabilityReason` documents the allowed values; `ProblemResponse.code` documents SQLSTATE vs REST-layer codes. Translation logic is unchanged because it already publishes the SQLSTATE.
- OpenAPI: `CartItem.unavailabilityReason` publishes `enum: [P2043, P2042, P3002]`; `ProblemDetail.code` carries the rule above. The frontend regenerates its types from the checked-in `openapi.json`.
- Frontend: purchase and catalog surfaces branch on the wire SQLSTATE (for example `P3002`, `P5004`) with no alias table.
