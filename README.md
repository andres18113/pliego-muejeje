# PLIEGO

PLIEGO is a modular-monolith backend for the approved v1 use cases. Its approved use-case, logical data, dictionary, REST, Database API, and PostgreSQL migration artifacts are kept at the repository root.

## Backend

The backend uses Java 25, Spring Boot, Spring JDBC, Flyway, and PostgreSQL 18. Feature code follows Controller → Application Service → JDBC Gateway; PostgreSQL routines remain authoritative for business rules. JPA/Hibernate ORM and Docker are not used.

Implemented v1 vertical slices:

- Authentication with BCrypt and stateless JWT, plus centralized RFC 9457 ProblemDetail responses.
- Authenticated CUSTOMER profile and address operations.
- Public catalog search and edition detail backed by the approved PostgreSQL Functions.
- ADMIN author, publisher, category, book, and edition management backed by the approved PostgreSQL Database API.
- ADMIN inventory search, movement history, entries, adjustments, and minimum-stock updates backed by the approved PostgreSQL Database API.
- CUSTOMER cart, checkout, and order history/cancellation; ADMIN customer management and order/logistics operations.

Human-facing REST error and validation feedback is in Spanish. Machine-readable error codes remain stable. See the [frontend handoff](docs/frontend/backend-handoff-v1.0.md) for the supported screens, navigation, and API conventions.

## Build and run

Install Java 25, Maven, Node.js/npm, curl, and PostgreSQL 18. To start the local database, backend, and frontend together, use the idempotent stack script:

```bash
cd frontend && npm ci
cd ..
./scripts/dev.sh up       # starts the services that are not already ready
./scripts/dev.sh status
./scripts/dev.sh logs     # Ctrl+C stops following logs, not the services
./scripts/dev.sh down     # stops only backend/frontend started by the script
```

The local PostgreSQL 18 service remains running after `down`; stop it separately with `./scripts/local-db.sh stop`. The web app is at `http://127.0.0.1:5173` and the API at `http://127.0.0.1:8080`. To use database credentials already exported in the current shell, set `PLIEGO_USE_LOCAL_DB=0` when running the script.

For an externally managed database, export the connection, initial admin seed, and JWT signing key described in [backend/README.md](backend/README.md), then run `PLIEGO_USE_LOCAL_DB=0 ./scripts/dev.sh up` in that shell. To start services manually instead:

```bash
# Terminal 1
cd backend
mvn clean verify
mvn spring-boot:run

# Terminal 2
cd frontend
npm run dev -- --host 127.0.0.1
```

Backend configuration/startup is documented in [backend/README.md](backend/README.md). With the backend running, OpenAPI is served at `/v3/api-docs` and Swagger UI at `/swagger-ui/index.html`.

## Approved artifacts

- [Use-case baseline](use-case-baseline-v1.0.md)
- [Logical ERD](logical-erd-v1.0.md)
- [Data dictionary](data-dictionary-v1.0.md)
- [REST API contract](rest-api-contract-v1.0.md)
- [Database API contract](database-api-contract-v1.0.md)
- [Approved Flyway archive](pliego-flyway-v1.0.zip)

Flyway migrations V001–V019 match the approved archive byte-for-byte. V020 and V021 are additive corrections that preserve the approved public contract and behavior.
