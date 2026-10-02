# Architecture Decision Records

| ADR | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-backend-foundation.md) | Spring JDBC modular monolith foundation | Accepted from approved baselines | 2026-09-23 |
| [0002](0002-authentication-and-problem-details.md) | Stateless JWT authentication and centralized Problem Details | Accepted as REST contract implementation | 2026-09-23 |
| [0003](0003-spanish-rest-error-feedback.md) | Spanish REST error feedback | Accepted for implementation from I3 onward | 2026-09-23 |
| [0004](0004-address-primary-procedure-correction.md) | Correct primary address replacement in PostgreSQL | Accepted as forward-only routine correction | 2026-09-23 |
| [0005](0005-book-update-deferred-constraint-correction.md) | Correct PostgreSQL book update under deferred constraints | Accepted as forward-only routine correction | 2026-09-23 |
| [0006](0006-frontend-client-architecture.md) | Standalone React client for the PLIEGO frontend | Accepted for frontend implementation | 2026-09-23 |
| [0007](0007-frontend-stack-consolidation.md) | Consolidate the frontend on the approved React stack | Accepted for frontend implementation | 2026-09-25 |
| [0008](0008-cover-delivery-and-unresolved-provenance.md) | Keep cover delivery URLs separate from unresolved licensing provenance | Accepted for cover CDN integration | 2026-09-27 |
| [0009](0009-canonical-domain-error-codes.md) | PostgreSQL SQLSTATEs are the only wire codes for domain conditions | Accepted as error-contract standard | 2026-09-27 |
| [0010](0010-persistent-revocable-auth-sessions.md) | Persistent and revocable authentication sessions | Accepted; supersedes session-persistence decisions in 0002 and 0006 | 2026-09-28 |
| [0011](0011-canonical-edition-availability-presentation.md) | One domain component and resolver for edition availability | Accepted for StockStatus production implementation | 2026-10-01 |
| [0012](0012-controlled-bookcard-and-catalog-controllers.md) | Controlled BookCard, shared edition projection and separate action controllers | Accepted for BookCard v1 production migration | 2026-10-01 |
| [0013](0013-persistent-global-navigation.md) | Persistent global navigation in the application layout | Accepted for Header production refactor | 2026-10-02 |
| [0014](0014-public-exploration-and-real-catalog-facets.md) | One catalog entry and real public facets | Accepted for exploration refactor | 2026-10-02 |
