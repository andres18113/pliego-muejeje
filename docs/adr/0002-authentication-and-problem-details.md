# ADR-0002: Stateless JWT authentication and centralized Problem Details

## Status

Accepted as implementation of REST API Contract v1.0.

## Date

2026-09-23

## Decision Drivers

- Preserve the approved authentication, JWT, and HTTP error contract.
- Keep identity persistence behind the approved PostgreSQL Database API routines.
- Give later vertical slices one safe SQLSTATE-to-ProblemDetail path.

## Decision Outcome

Use Spring Security's OAuth2 Resource Server support and Nimbus JOSE for HS256 token issuance and validation. Nimbus's compact JWS payload is used for issuance so the `aud` claim keeps the scalar representation shown by the approved contract; Spring Security's decoder validates it. BCrypt strength 12 hashes registration passwords before the identity Gateway invokes `sp_customer_register`; login reads only `fn_user_auth_data`, verifies the hash in Spring, then issues a stateless 30-minute token. A shared ProblemDetail layer maps database/application errors without exposing database messages, while a request filter attaches a generated trace ID.

The architecture remains Controller → Application Service → JDBC Gateway → approved PostgreSQL routine. JWT issuer, audience, claims, role set, lifetime, password rules, public routes, and HTTP mappings remain those in the approved REST baseline.

## Consequences

- No token/session persistence or JPA is introduced.
- New feature errors use `DatabaseExceptionTranslator` and `ApiExceptionHandler` rather than translating SQLSTATE in controllers.
- Deployment supplies a cryptographically random `PLIEGO_JWT_SECRET` of at least 32 UTF-8 bytes and an optional exact CORS origin allowlist.
- Unknown, blocked, and bad-password login attempts all receive the same response; unknown users also incur a BCrypt verification against a per-process dummy hash.

## Validation

- MVC tests exercise both auth endpoints, JWT validation/roles, ProblemDetail responses, and SQLSTATE mappings.
- `mvn clean verify`, dependency inspection, migration hash verification, and PostgreSQL 18 smoke checks validate the increment.
