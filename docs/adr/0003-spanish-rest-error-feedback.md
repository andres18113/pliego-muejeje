# ADR-0003: Spanish REST error feedback

## Status

Accepted for implementation from I3 onward.

## Date

2026-09-23

## Context

PLIEGO serves Spanish-speaking users. I3 requires Spanish titles, details, validation messages, and authentication feedback across its endpoints and existing I2 authentication routes. The approved machine-readable error codes and SQLSTATE-to-HTTP mappings must remain stable.

## Decision

Render all human-facing REST error and validation text in Spanish through the centralized ProblemDetail and Spring Security error layers. Preserve the approved `code`, SQLSTATE mappings, and non-disclosing behavior for authentication and resources outside the caller's account.

## Consequences

- Feature DTOs provide Spanish validation messages.
- The central handler uses safe Spanish titles and details and never returns database messages.
- Clients continue to branch on stable machine-readable codes rather than display text.

## Validation

- MVC tests check Spanish authentication, validation, not-found, blocked-account, and internal-error responses while asserting stable codes and `traceId`.
