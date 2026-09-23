# ADR-0001: Spring JDBC modular monolith foundation

## Status

Accepted from the approved project baselines.

## Date

2026-09-23

## Context

PLIEGO's approved use-case and REST contracts require Java 25, Spring Boot, PostgreSQL, Flyway, JDBC Gateways, and PostgreSQL-owned business invariants. Spring demarcates transactions. The initial implementation must leave room for vertical slices without implementing them prematurely.

## Decision

- Build one Spring Boot deployable with feature packages under `com.pliego.modules` and cross-cutting infrastructure under `com.pliego.foundation`.
- Use Spring JDBC only for the PostgreSQL Database API. Do not use JPA/Hibernate or Docker.
- Use Spring Boot 4.1.1, a stable release compatible with Java 25, and Springdoc 3.1.1 for Boot 4 OpenAPI support.
- Keep Flyway migrations under `classpath:db/migration` and preserve the approved V001–V019 SQL byte-for-byte.
- Centralize database SQLSTATE translation. Gateways do not decide HTTP responses; the API layer will later render the translated application error as Problem Details.

## Consequences

- New business behavior is added as complete vertical slices within its context package.
- PostgreSQL and Spring transactions remain the authorities for data invariants and command atomicity.
- SQLSTATE-to-HTTP mapping is implemented once and can be used by the future Problem Details handler.
- Dependency upgrades must retain Java 25 compatibility and Spring Boot 4 compatibility for Springdoc.

## Validation

- Maven package and tests pass on Java 25.
- Dependency inspection shows JDBC/Flyway and no JPA or Hibernate ORM.
- Extracted V001–V019 files match the approved archive.
- On PostgreSQL 18, Flyway migrates and validates the schema from empty and PostgreSQL 18's `uuidv4()` is available.
