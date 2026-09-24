# PLIEGO Backend

Java 25 / Spring Boot backend for the approved PLIEGO REST and PostgreSQL Database API contracts.

## Architecture

This is one deployable with modules grouped by business context. Add implementation as vertical slices; do not add placeholder Controllers or Services.

```text
com.pliego
├── PliegoApplication
├── foundation
│   └── database       shared JDBC support and SQLSTATE translation
└── modules
    ├── identity
    ├── customer
    ├── catalog
    ├── inventory
    ├── cart
    └── sales
```

Each feature follows `Controller → Application Service → JDBC Gateway`. Gateways call public `pliego` Procedures and Functions through Spring JDBC. Services own transaction demarcation; PostgreSQL owns business invariants and command atomicity. Do not issue business-table SQL from application code or add JPA/Hibernate.

Spring Boot auto-configures `JdbcTemplate`, `NamedParameterJdbcTemplate`, the PostgreSQL `DataSource`, and JDBC transaction management. Feature Gateways can extend `JdbcGatewaySupport` to apply the shared SQLSTATE translator. `DatabaseError` holds the approved SQLSTATE-to-application-code/HTTP mapping; the shared RFC 9457 handler renders it as Problem Details.

The backend uses the stable Spring Boot 4.1.1 line, which supports Java 25, and Springdoc 3.1.1 for Spring Boot 4 OpenAPI support.

## Configuration

Supply connection credentials and the approved initial admin seed values through the environment. The seed migration accepts a BCrypt hash, never a plaintext password. Keep these values out of Git and local logs.

```text
PLIEGO_DB_URL=jdbc:postgresql://localhost:5432/pliego
PLIEGO_DB_USERNAME=pliego
PLIEGO_DB_PASSWORD=<database password>
PLIEGO_ADMIN_EMAIL=<initial admin email>
PLIEGO_ADMIN_PASSWORD_HASH=<BCrypt hash>
PLIEGO_JWT_SECRET=<at least 32 random bytes; never commit>
PLIEGO_CORS_ALLOWED_ORIGINS=<comma-separated exact origins; optional>
```

For example, generate a development secret with `openssl rand -hex 32` and export the result as `PLIEGO_JWT_SECRET`. The application interprets its UTF-8 bytes as the HS256 key and rejects values shorter than 32 bytes.

Authentication is available at `POST /api/v1/auth/register` and `POST /api/v1/auth/login`. The authenticated CUSTOMER profile and address routes are `GET/PUT /api/v1/me`, `GET/POST /api/v1/me/addresses`, `PUT/DELETE /api/v1/me/addresses/{addressId}`, and `PUT /api/v1/me/addresses/{addressId}/primary`. These operations derive the actor from the verified JWT and delegate business rules to the approved Database API routines. Human-facing REST errors and validation feedback are in Spanish; machine-readable codes stay stable.

`POST /api/v1/checkout` creates a Pedido for either simulated payment outcome. CARD requests require a 12–19 digit number that passes Luhn; TRANSFER requests omit it. The number is validated only in the API and is never sent to PostgreSQL. The endpoint makes one `sp_checkout` call inside a Spring transaction and returns `201 Created` with a Location for both APPROVED and REJECTED. If the response is lost, clients must query orders before making another checkout attempt; they must not automatically retry this non-idempotent command. A `P5007` reference collision rolls back the transaction, so a new attempt after that explicit error is safe.

CUSTOMER order routes are `GET /api/v1/orders`, `GET /api/v1/orders/{orderId}`, and `POST /api/v1/orders/{orderId}/cancel`. The Functions return only the authenticated customer's orders and stored checkout snapshots. Cancellation uses one `sp_order_cancel` call in a Spring transaction. A repeated cancellation returns a conflict. After an unknown cancellation response, query that order's detail first; `CANCELLED` with payment `REFUNDED` means the cancellation completed.

ADMIN order routes are `GET /api/v1/admin/orders`, `GET /api/v1/admin/orders/{orderId}`, `POST /api/v1/admin/orders/{orderId}/transitions`, and `POST /api/v1/admin/orders/{orderId}/cancel`. After a timeout or unknown POST result, do not retry blindly; query the administrative detail and inspect its current state and history before choosing another action.

OpenAPI is served at `/v3/api-docs` and `/swagger-ui/index.html`. CORS has no allowed origins unless an exact comma-separated environment allowlist is supplied; configure localhost only for development.

The [frontend handoff](../docs/frontend/backend-handoff-v1.0.md) summarizes roles, API conventions, supported screens, navigation, and UI-relevant order states. OpenAPI is the executable endpoint/schema reference.

Flyway runs `classpath:db/migration` on startup. It keeps its history in PostgreSQL's existing `public` schema; V001 creates the application `pliego` schema. SQL initialization outside Flyway is disabled. A fresh database user needs permission to create the `pliego` schema and its objects.

## Verification

Run the complete PostgreSQL 18 CI-equivalent gate from a disposable PostgreSQL 18 database after building the app with `mvn verify`. The `src/test/postgres18/run_ci_gates.sh` runner checks the required environment, starts the application, verifies Flyway, runs SQL and concurrency checks, then exercises the live HTTP API. GitHub Actions also runs this PostgreSQL 18 gate on pushes and pull requests to `main`; it uses the native PostgreSQL packages and does not use Docker. H2 is not a substitute for PostgreSQL verification.

## Build and run

From this directory, with Java 25 and Maven installed:

```bash
mvn clean verify
mvn spring-boot:run
```

PostgreSQL 18.x is the approved database baseline. Migrations V001–V019 remain byte-for-byte identical to the approved archive; V020 onward contain additive corrections. The handoff and OpenAPI links are also available from the [repository README](../README.md).
