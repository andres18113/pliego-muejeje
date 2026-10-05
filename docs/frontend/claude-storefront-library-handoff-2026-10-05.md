# Claude handoff: storefront, Help and Mi biblioteca

The functional contracts are ready for PLIEGO presentation. Keep business decisions in PostgreSQL and consume the typed adapters/hooks. Reference images were inspected at `/mnt/c/Users/Andres/Downloads/google-your-devices.png`, `google-your-devices-buds.png`, `google-your-devices-pixel.png` and `google-sin-dispositivos.png`: collection → filters → owned detail, metadata, purchase information and relevant actions. Hardware add/remove/repair controls have no equivalent in this scope.

## Storefront
`GET /api/v1/storefront/navigation` returns `sections` ordered PHYSICAL / EBOOK / AUDIOBOOK / OFFERS / HELP, labelled Libros / eBooks / Audiolibros / Ofertas / Ayuda. Media sections carry `href`, `allHref`, `bestSellingHref`, optional `offersHref`, `activeOfferCount`, up to three `featured` products and relevant active `categories`. Products include IDs, title/authors, cover, format/productType, price, real offer metadata and detail href. Counts, IDs and amounts follow the existing string contracts.

Use `useStorefrontNavigation` and `storefrontNavigationQueryKey` from `features/storefront/storefrontQuery.ts`, with typed loading/error/empty/ready states from `shared/api/readViewState.ts`. The final mega-menu is intentionally absent. Existing Catalog `/catalog` and Offers `/ofertas` remain authoritative. Catalog API now supports `productType=PHYSICAL|EBOOK|AUDIOBOOK` and `sort=BEST_SELLING`; URL parsing, criteria and generated types are updated.

BEST_SELLING ranks purchased quantities for approved, noncancelled orders first confirmed in the last 30 days, scoped by media. Confirmation history provides the stable timestamp; future, rejected and refunded sales are excluded. Ties and insufficient sales use edition creation descending, then edition ID ascending. Featured candidates require active book/edition, valid commercial availability, and an active relevant category/parent. Price, offers, expiration and discounts come from the Offers Database API. Audiobooks use “Más vendidos”; listening telemetry does not exist.

## Help
Public APIs: `GET /api/v1/help/categories`, `GET /api/v1/help/articles?que=...&category=...&applicability=...&page=0&pageSize=20`, and `GET /api/v1/help/articles/{slug}`. Only published articles within published categories are exposed. Search covers title, summary and body; applicability filters include GENERAL articles. Slugs and ordering are stable. Unknown/draft detail returns 404.

Eight seeded topics cover eBooks, audiolibros, compras, entrega-a-domicilio, retiro, pagos, cancelaciones-y-reembolsos and cuenta-y-correo. API adapters live in `shared/api/help.ts`; hooks/query keys in `features/help/helpQuery.ts`, typed read states in `shared/api/readViewState.ts` and semantic routes in `features/help/HelpRoutes.tsx`. Real routes: `/ayuda` and `/ayuda/:slug`. Article body is plain text; do not treat it as HTML.

## Mi biblioteca
Authenticated CUSTOMER APIs: `GET /api/v1/me/library?productType=EBOOK|AUDIOBOOK&page=0&pageSize=20` and `GET /api/v1/me/library/{ownedItemId}`. Omit productType for Todos. The list retains revoked acquisitions with their state; it does not imply revoked items remain owned. IDs belong to ownership records, independently of edition IDs.

Each item exposes cover, title, authors, media, acquisition date, bibliographic metadata (ISBN/publisher/language/publication/pages/EPUB or PDF/duration/narrators as applicable), `sourcePurchases` with order/item/date/payment/order/grant state, `ownershipState=OWNED|REVOKED`, `accessState=OWNERSHIP_ONLY|REVOKED`, `contentAccessSupported=false`, and authoritative `availableActions`. Only VIEW_ORDER (“Ver pedido”) and HELP (“Ayuda”) exist. Use action labels/hrefs from the server. Another valid purchase preserves ownership when one source is refunded; inactive editions remain inspectable using purchased snapshots. A foreign or missing ownership ID gives the same 404.

Use `shared/api/library.ts`, `useOwnedItems`, `useOwnedItem` and `libraryQueryKeys` in `features/library/libraryQuery.ts`; view models/filter labels/routes live in `libraryViewModel.ts`. Library keys include customer identity, queries are marked authenticated, and purchase/cancellation resolution invalidates them. Real routes: `/biblioteca` and `/biblioteca/:ownedItemId`.

**Scope boundary:** the academic simulation ends when a customer opens an owned eBook/audiobook detail and verifies ownership. Do not add a reader, player, streaming, downloads, DRM, files/content delivery, reading/listening progress, bookmarks, or Leer/Escuchar/Continuar actions. A future content service can use the existing stable ownership identity; it is outside this implementation.

## Checkout
Cart projections supply `requiresPhysicalFulfillment`, `physicalItemCount` and `digitalItemCount`. Consume them; React must not infer eligibility, calculate price/tax/discounts or authorize ownership.

- Physical-only: existing HOME_DELIVERY + address or STORE_PICKUP + enabled pickup location.
- Digital-only: send DIGITAL_ONLY and omit address/pickup. There is no order address, physical fulfillment, pickup or shipment; the order response has `fulfillment: null` (DIGITAL_ONLY is a request discriminator). Do not fetch destination lists or render maps.
- Mixed: one order/payment with all commercial line snapshots; delivery/pickup applies to physical lines only. Digital lines consume no stock and create no logistics records. Confirmation separates digital ownership from physical delivery.

Approved payment creates purchase grants in the same transaction. Rejected payment creates no entitlement. Existing idempotency-key/attempt APIs resolve retries without duplicate grants. Full cancellation/refund revokes that source; other valid sources survive. Physical shipment lifecycle does not change digital ownership. Financial documents retain existing explicit billing-address requirements, independently of delivery. Partial refunds are not an existing capability.

## Safe presentation files
Style or reshape these semantic scaffolds while retaining hook contracts, states, labels and genuine actions:

- `frontend/src/features/library/LibraryRoutes.tsx`
- `frontend/src/features/help/HelpRoutes.tsx`
- `frontend/src/features/storefront/storefrontQuery.ts` supplies typed navigation data and view states; create the mega-menu presentation consuming `useStorefrontNavigation`, without altering business rules.

Existing purchase presentation files with corrected functional semantics: `frontend/src/features/purchase/CheckoutPage.tsx` and `SuccessfulOrderConfirmation.tsx`. App route registration is `frontend/src/app/App.tsx`; account discoverability is `frontend/src/app/navigation/HeaderAccount.tsx`. Keep API adapters, query hooks, checkout transport/receipt recovery, generated types and backend/database routines functional. No final PLIEGO styling was added.

Contracts: `frontend/openapi/openapi.json` and `frontend/src/shared/api/generated.ts`. Architecture: ADR-0026. Forward-only migrations: V045 ownership/checkout, V046 navigation/Help, V047 ownership integrity, V048 digital-only lifecycle guard. Existing migrations and approved root artifacts remain unchanged.

Verification: backend 162 tests; frontend 462 tests plus typecheck/build; full PostgreSQL 18 SQL/concurrency/HTTP/session gates; real Flyway V044→V048 historical backfill; focused mocked purchase/pickup/library/Help browser checks and two real PostgreSQL/API browser checks. Independent review accepted. Full logs are retained under `/tmp/pliego-architecture-pass`. Required scope has no known unresolved gap; content delivery/progress and partial refunds remain outside existing capabilities. No commit, push or deployment.
