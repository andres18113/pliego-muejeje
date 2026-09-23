# PLIEGO contributor guidance

- Approved root-level baselines and the contents of `pliego-flyway-v1.0.zip` are authoritative. Do not edit approved artifacts or extracted migrations; add a new migration for later schema changes.
- The backend uses Java 25, Spring Boot, PostgreSQL 18, Flyway, and Spring JDBC. Do not add JPA/Hibernate or Docker.
- Keep a modular monolith under `com.pliego.modules.<context>`. Feature code follows Controller → Application Service → JDBC Gateway; modules call PostgreSQL's public Database API, which owns business invariants. Do not put business SQL in Controllers or Services.
- Spring owns transaction boundaries. Keep each business command aligned with its approved PostgreSQL routine.
- Keep cross-cutting database and error handling in `com.pliego.foundation`. Record material architecture changes in `docs/adr/`.
- Human-facing REST error titles, details, validation messages, and authentication feedback are in Spanish; keep machine-readable codes and approved SQLSTATE mappings stable.
- Never commit credentials, real passwords, or local environment files.
