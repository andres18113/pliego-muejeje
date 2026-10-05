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
| [0015](0015-google-store-public-storefront.md) | Rebuild public storefront from measured Google Store evidence | Accepted for authorized visual replacement | 2026-10-02 |
| [0016](0016-digital-editions-and-stockless-availability.md) | Typed digital editions and availability without physical inventory | Accepted for digital-format extension | 2026-10-03 |
| [0017](0017-post-purchase-lifecycle-and-documents.md) | Separate fulfillment/shipment and immutable commercial invoice/credit-note records | Accepted for post-purchase backend extension | 2026-10-03 |
| [0018](0018-command-outcomes-and-profile-concurrency.md) | Durable command receipts, transaction-safe outcome resolution and optimistic profile writes | Accepted for confirmed P1 integrity corrections | 2026-10-04 |
| [0019](0019-shared-person-validation-and-safe-numeric-input.md) | Shared Unicode/phone validation, compatible recipients and exact numeric boundaries | Accepted for confirmed validation/error-handling corrections | 2026-10-04 |
| [0020](0020-transactional-email-and-account-verification.md) | PostgreSQL email outbox, account verification and password recovery through Mailtrap | Accepted for requested implementation | 2026-10-04 |
| [0021](0021-basic-store-pickup.md) | Extend existing fulfillment with typed pickup locations, snapshots and collection | Accepted for requested implementation | 2026-10-04 |
| [0022](0022-authoritative-ecuador-monetary-projections.md) | Database-owned 15% IVA pricing and coherent order/payment/invoice snapshots | Accepted for requested implementation | 2026-10-04 |
| [0023](0023-pending-digital-edition-preparation.md) | Pending digital staging, exact work identity and non-mutating SKU proposals | Accepted for local preparation only | 2026-10-04 |
| [0024](0024-authoritative-home-delivery-simulation.md) | Database-owned home delivery simulation, persisted deadlines and idempotent catch-up | Accepted for requested backend implementation | 2026-10-04 |
| [0025](0025-edition-offers.md) | Edition offers with database-owned pricing, calendar timing, filtering and monetary snapshots | Accepted for functional integration | 2026-10-05 |
