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

Each implemented feature follows `Controller → Application Service → JDBC Gateway`. Gateways call public `pliego` Procedures and Functions through Spring JDBC. Services own transaction demarcation; PostgreSQL owns business invariants and command atomicity. Do not issue business-table SQL from application code or add JPA/Hibernate.

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

OpenAPI is served at `/v3/api-docs` and `/swagger-ui/index.html`. CORS has no allowed origins unless an exact comma-separated environment allowlist is supplied; configure localhost only for development.

Flyway runs `classpath:db/migration` on startup. It keeps its history in PostgreSQL's existing `public` schema; V001 creates the application `pliego` schema. SQL initialization outside Flyway is disabled. A fresh database user needs permission to create the `pliego` schema and its objects.

## Build and run

From this directory, with Java 25 and Maven installed:

```bash
mvn clean verify
mvn spring-boot:run
```

PostgreSQL 18.x is the approved database baseline. The bundled SQL tests and concurrency scenarios are in `pliego-flyway-v1.0.zip`; the extracted V001–V019 migration files must remain byte-for-byte identical to that approved archive.
