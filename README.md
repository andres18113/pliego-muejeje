# PLIEGO

PLIEGO is a modular-monolith backend for the approved v1 use cases. Its approved use-case, logical data, dictionary, REST, Database API, and PostgreSQL migration artifacts are kept at the repository root.

## Backend

The backend uses Java 25, Spring Boot, Spring JDBC, Flyway, and PostgreSQL 18. Feature code follows Controller → Application Service → JDBC Gateway; PostgreSQL routines remain authoritative for business rules. JPA/Hibernate ORM and Docker are not used.

Implemented vertical slices:

- Authentication with BCrypt and stateless JWT, plus centralized RFC 9457 ProblemDetail responses.
- Authenticated CUSTOMER profile and address operations.
- Public catalog search and edition detail backed by the approved PostgreSQL Functions.
- ADMIN author, publisher, category, book, and edition management backed by the approved PostgreSQL Database API.
- ADMIN inventory search, movement history, entries, adjustments, and minimum-stock updates backed by the approved PostgreSQL Database API.

Human-facing REST error and validation feedback is in Spanish. Machine-readable error codes remain stable. Further slices follow the approved REST and Database API contracts.

## Build and run

Install Java 25, Maven, and PostgreSQL 18. Configure the database connection, initial admin seed, and JWT signing key as described in [backend/README.md](backend/README.md), then run:

```bash
cd backend
mvn clean verify
mvn spring-boot:run
```

OpenAPI is served at `/v3/api-docs` and `/swagger-ui/index.html`.

## Approved artifacts

- [Use-case baseline](use-case-baseline-v1.0.md)
- [Logical ERD](logical-erd-v1.0.md)
- [Data dictionary](data-dictionary-v1.0.md)
- [REST API contract](rest-api-contract-v1.0.md)
- [Database API contract](database-api-contract-v1.0.md)
- [Approved Flyway archive](pliego-flyway-v1.0.zip)

Flyway migrations V001–V019 match the approved archive byte-for-byte. V020 is an additive correction to the primary-address routine that preserves its approved public contract and behavior.
