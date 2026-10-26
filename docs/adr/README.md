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
| [0026](0026-storefront-help-and-digital-ownership.md) | Domain-owned storefront/Help projections and purchase-grant digital ownership with physical-only fulfillment | Accepted for requested architecture implementation | 2026-10-05 |
| [0027](0027-scoped-public-catalog-filters.md) | Scope existing public categories and facets with PostgreSQL-owned product eligibility | Accepted for requested catalog integration | 2026-10-05 |
| [0028](0028-authoritative-cart-offer-projection.md) | Additive live cart base/effective prices and savings owned by PostgreSQL | Accepted for requested cart projection | 2026-10-06 |
| [0029](0029-digital-and-pickup-cancellation-window.md) | Persisted six-minute digital and pickup cancellation window with restart-safe finalization | Accepted for requested order-lifecycle adjustment | 2026-10-06 |
| [0030](0030-accepted-checkout-quotes-and-mail-completion.md) | Accepted cart snapshot protection, immutable replay and observable fenced mail completion | Accepted for final robustness audit | 2026-10-06 |
| [0031](0031-client-command-authority-and-view-lifetime.md) | Issuing authority, credential and view boundaries for asynchronous client commands | Accepted for final robustness audit | 2026-10-06 |
| [0032](0032-current-email-verification-profile-read.md) | Explicit database-owned current-email verification in the additive profile read contract | Accepted for requested production corrections | 2026-10-07 |

- [0033 — IVA cero del catálogo de Ecuador](0033-ecuador-catalog-zero-iva.md)
- [0034 — Contacto y entrega restringidos a Ecuador](0034-ecuador-contact-and-delivery-scope.md)

- [0035 — Orden español estable de los títulos del catálogo](0035-spanish-catalog-title-ordering.md)
- [0036 — Conservación del origen en acciones de correo](0036-email-action-return-context.md)
- [0037 — Cédula como atributo privado de facturación](0037-ecuador-billing-identity.md)
- [0038 — Facturación académica automática](0038-automatic-academic-billing.md)
- [0039 — Safe internal back navigation](0039-safe-back-navigation.md)
- [0040 — Identification required to buy, not editable, correctable with re-authentication](0040-required-correctable-cedula.md)
- [0041 — Full cédula and RUC algorithm, validated live](0041-ecuador-cedula-ruc-algorithm.md)

- [0042 — One active digital copy per customer account](0042-single-digital-copy-per-customer.md)
- [0043 — Tiered billing identity corrections and separate invoice recipients](0043-tiered-billing-identity-and-invoice-recipients.md)
- [0044 — INEC geographic catalog for editable Ecuadorian addresses](0044-ecuador-geographic-address-catalog.md)
- [0045 — Saved for Later independiente de favoritos y del carrito activo](0045-customer-saved-for-later.md)
