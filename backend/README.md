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

### Reproducible local PostgreSQL 18

From the repository root, use `scripts/local-db.sh` with native PostgreSQL 18,
OpenSSL, Java 25, and Maven installed. It creates a private cluster and generated
credentials under ignored `.local-db/`, binds PostgreSQL to `127.0.0.1:55432`,
creates the `pliego` role/database, and checks that the server is version 18.
No system PostgreSQL role, Docker container, or tracked secret is needed. Set
`PLIEGO_PG18_BIN` if the version 18 binaries are elsewhere, and set
`PLIEGO_LOCAL_PG_PORT` before the first run if port 55432 is occupied.

```bash
./scripts/local-db.sh migrate   # create/start the cluster and run all Flyway migrations
./scripts/local-db.sh backend   # start the API; Flyway validates at startup
./scripts/local-db.sh stop      # stop the private database when finished
```

`backend` runs in the foreground. The generated `.local-db/backend.env` is a
shell-readable local configuration for the backend and `psql`; source it in a
shell for manual database commands. It contains an unusable ADMIN hash by
default. To sign in as the local ADMIN, set `PLIEGO_ADMIN_PASSWORD_HASH` in that
file to a BCrypt hash **before the first migration**; `scripts/generate-admin-bcrypt.sh`
can create one from an interactively entered password. CUSTOMER registration
does not depend on ADMIN sign-in.

`./scripts/local-db.sh recreate` drops only this private `pliego` database,
creates it again, and migrates it from V001 through the current version. It
deletes local PLIEGO data, while retaining the private cluster and credentials.
Use `status` to inspect the database and `start` to start it without migrating.
The generated local configuration is ignored by Git and must never be committed.

Supply connection credentials and the approved initial admin seed values through the environment. The seed migration accepts a BCrypt hash, never a plaintext password. Keep these values out of Git and local logs.

```text
PLIEGO_DB_URL=jdbc:postgresql://localhost:5432/pliego
PLIEGO_DB_USERNAME=pliego
PLIEGO_DB_PASSWORD=<database password>
PLIEGO_ADMIN_EMAIL=<initial admin email>
PLIEGO_ADMIN_PASSWORD_HASH=<BCrypt hash>
PLIEGO_JWT_SECRET=<at least 32 random bytes; never commit>
PLIEGO_CORS_ALLOWED_ORIGINS=<comma-separated exact origins; optional>
PLIEGO_AUTH_COOKIE_SECURE=true
PLIEGO_TRANSFER_BANK=<bank shown at checkout; optional>
PLIEGO_TRANSFER_BENEFICIARY=<account holder; optional>
PLIEGO_TRANSFER_ACCOUNT_TYPE=<account type; optional>
PLIEGO_TRANSFER_ACCOUNT_NUMBER=<account number; optional>
PLIEGO_TRANSFER_IDENTIFICATION=<RUC or identification; optional>
```

For example, generate a development secret with `openssl rand -hex 32` and export the result as `PLIEGO_JWT_SECRET`. The application interprets its UTF-8 bytes as the HS256 key and rejects values shorter than 32 bytes.

The public `GET /api/v1/reference/countries` endpoint serves ISO country codes with Spanish names from the Java locale reference. `GET /api/v1/reference/transfer-details` serves the transfer instructions from the configuration above. Local defaults are demonstration values; set all five transfer variables for any non-demo deployment.

Authentication is available at `POST /api/v1/auth/register` and `POST /api/v1/auth/login`. Login returns a 30-minute bearer JWT and sets a host-only, `HttpOnly`, `Secure`, `SameSite=Strict` refresh cookie. `POST /api/v1/auth/refresh` restores and rotates the cookie-backed session; the session expires absolutely after 30 days. `POST /api/v1/auth/logout` revokes the session and expires the cookie. PostgreSQL stores only a SHA-256 digest of the opaque refresh credential. Keep `PLIEGO_AUTH_COOKIE_SECURE=true` in deployed HTTPS environments; set it to `false` only for local plain-HTTP development. If the frontend uses a separate origin, list its exact origin in `PLIEGO_CORS_ALLOWED_ORIGINS`; credentialed CORS does not allow wildcard origins. The authenticated CUSTOMER profile and address routes are `GET/PUT /api/v1/me`, `GET/POST /api/v1/me/addresses`, `PUT/DELETE /api/v1/me/addresses/{addressId}`, and `PUT /api/v1/me/addresses/{addressId}/primary`. These operations derive the actor from the verified JWT and delegate business rules to the approved Database API routines. Human-facing REST errors and validation feedback are in Spanish; machine-readable codes stay stable.

The public catalog routes are `GET /api/v1/catalog/categories`, `GET /api/v1/catalog/editions`, and `GET /api/v1/catalog/editions/{editionId}`. The category index includes only active categories with publicly listed editions and returns each category's slug, display name, and optional parent slug. A known inactive category used as an edition-search filter returns `409` with wire code `P2022` (symbolic mapping `CATEGORY_INACTIVE`); a syntactically valid unknown slug retains the documented empty-page response. See the [public catalog API amendment](../docs/api-amendments/0001-public-catalog-categories-v1.0.1.md) for the complete contract.

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

PostgreSQL 18.x is the approved database baseline. Migrations V001–V019 remain byte-for-byte identical to the approved archive; V020 onward contain additive corrections and contract amendments, including V024's separation of cover delivery URLs from unresolved licensing metadata. V025 makes cart-item `unavailabilityReason` report the canonical SQLSTATE (`P2043`, `P2042`, `P3002`). Domain errors publish the PostgreSQL SQLSTATE as the Problem Details `code`; symbolic names are documentation labels only. See the [canonical domain error codes amendment](../docs/api-amendments/0003-canonical-domain-error-codes-v1.0.3.md). The handoff and OpenAPI links are also available from the [repository README](../README.md).
