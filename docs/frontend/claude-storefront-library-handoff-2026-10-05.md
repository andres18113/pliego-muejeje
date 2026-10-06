# Claude handoff: storefront, Help and Mi biblioteca

The functional contracts are ready for PLIEGO presentation. Keep business decisions in PostgreSQL and consume the typed adapters/hooks. Reference images were inspected at `/mnt/c/Users/Andres/Downloads/google-your-devices.png`, `google-your-devices-buds.png`, `google-your-devices-pixel.png` and `google-sin-dispositivos.png`: collection → filters → owned detail, metadata, purchase information and relevant actions. Hardware add/remove/repair controls have no equivalent in this scope.

## Storefront
`GET /api/v1/storefront/navigation` returns `sections` ordered PHYSICAL / EBOOK / AUDIOBOOK / OFFERS / HELP, labelled Libros / eBooks / Audiolibros / Ofertas / Ayuda. Media sections carry `href`, `allHref`, `bestSellingHref`, optional `offersHref`, `activeOfferCount`, up to three `featured` products and relevant active `categories`. Products include IDs, title/authors, cover, format/productType, price, real offer metadata and detail href. Counts, IDs and amounts follow the existing string contracts.

Use `useStorefrontNavigation` and `storefrontNavigationQueryKey` from `features/storefront/storefrontQuery.ts`, with typed loading/error/empty/ready states from `shared/api/readViewState.ts`. The final mega-menu is intentionally absent. Existing Catalog `/catalog` and Offers `/ofertas` remain authoritative. Catalog API now supports `productType=PHYSICAL|EBOOK|AUDIOBOOK` and `sort=BEST_SELLING`; URL parsing, criteria and generated types are updated.

The live SiteHeader consumes that hook for desktop/mobile links, including Ayuda, with functional loading/error/retry states. HomeNextReading uses `features/storefront/storefrontReadingView.ts` to derive Catalog/Offers preview criteria from the same server hrefs. The old `shared/navigation/storefrontDestinations.ts` has been removed. Navigation uses productType destinations; legacy format filters remain supported catalog inputs, not a competing navigation source. BEST_SELLING is validated by the backend/OpenAPI pattern; the generated query type remains string because patterns do not generate enums. The finite frontend union is intentional and contract-tested; no unrelated type rewrite is needed.

BEST_SELLING ranks purchased quantities for approved, noncancelled orders first confirmed in the last 30 days, scoped by media. Confirmation history provides the stable timestamp; future, rejected and refunded sales are excluded. Ties and insufficient sales use edition creation descending, then edition ID ascending. Featured candidates require active book/edition, valid commercial availability, and an active relevant category/parent. Price, offers, expiration and discounts come from the Offers Database API. Audiobooks use “Más vendidos”; listening telemetry does not exist.

## Help
Public APIs: `GET /api/v1/help/categories`, `GET /api/v1/help/articles?que=...&category=...&applicability=...&page=0&pageSize=20`, and `GET /api/v1/help/articles/{slug}`. Only published articles within published categories are exposed. Search covers title, summary and body; applicability filters include GENERAL articles. Slugs and ordering are stable. Unknown/draft detail returns 404.

Eight seeded topics cover eBooks, audiolibros, compras, entrega-a-domicilio, retiro, pagos, cancelaciones-y-reembolsos and cuenta-y-correo. API adapters live in `shared/api/help.ts`; hooks/query keys in `features/help/helpQuery.ts`, typed read states in `shared/api/readViewState.ts` and semantic routes in `features/help/HelpRoutes.tsx`. Real routes: `/ayuda` and `/ayuda/:slug`. Article body is plain text; do not treat it as HTML.

## Mi biblioteca
Authenticated CUSTOMER APIs: `GET /api/v1/me/library?productType=EBOOK|AUDIOBOOK&page=0&pageSize=20` and `GET /api/v1/me/library/{ownedItemId}`. Omit productType for Todos. The list retains revoked acquisitions with their state; it does not imply revoked items remain owned. IDs belong to ownership records, independently of edition IDs.

Each item exposes cover, title, authors, media, acquisition date, bibliographic metadata (ISBN/publisher/language/publication/pages/EPUB or PDF/duration/narrators as applicable), `sourcePurchases` with order/item/date/payment/order/grant state, `ownershipState=OWNED|REVOKED`, `accessState=OWNERSHIP_ONLY|REVOKED`, `contentAccessSupported=false`, and authoritative `availableActions`. Only VIEW_ORDER (“Ver pedido”) and HELP (“Ayuda”) exist. Use action labels/hrefs from the server. Another valid purchase preserves ownership when one source is refunded; inactive editions remain inspectable using purchased snapshots. A foreign or missing ownership ID gives the same 404.

Use `shared/api/library.ts`, `useOwnedItems`, `useOwnedItem` and `libraryQueryKeys` in `features/library/libraryQuery.ts`; view models/filter labels/routes live in `libraryViewModel.ts`. Library keys include customer identity, queries are marked authenticated, and purchase/cancellation resolution invalidates them. Real routes: `/biblioteca` and `/biblioteca/:ownedItemId`.

Use `toLibrarySourcePurchaseViewModel` via `toOwnedItemViewModel` for each purchase's orderStateLabel, paymentStateLabel and grantStateLabel. This reuses existing Spanish order/payment labels and labels grants Vigente/Revocada. Raw states stay available as machine data; LibraryRoutes renders the projected labels. ISO dates and duration formatting remain presentation work for Claude.

**Scope boundary:** the academic simulation ends when a customer opens an owned eBook/audiobook detail and verifies ownership. Do not add a reader, player, streaming, downloads, DRM, files/content delivery, reading/listening progress, bookmarks, or Leer/Escuchar/Continuar actions. A future content service can use the existing stable ownership identity; it is outside this implementation.

## Checkout
Cart projections supply `requiresPhysicalFulfillment`, `physicalItemCount` and `digitalItemCount`. Consume them; React must not infer eligibility, calculate price/tax/discounts or authorize ownership.

Those cart capabilities/counts are required. Each cart line additionally carries requiresPhysicalFulfillment and quantityEditable; customer-order snapshot lines carry requiresPhysicalFulfillment. Use these fields for delivery lists, quantity controls and digital acquisition summaries; format is bibliographic/display metadata. V049 projects the capabilities using PostgreSQL's existing format invariant, including quantity correction for malformed digital cart lines. Checkout's stale-cart guard, idempotency keys and outcome recovery remain unchanged. Pagination waits for catalog reads to settle before aligning results, preserving media-filter context and existing scroll positions.

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

Contracts: `frontend/openapi/openapi.json` and `frontend/src/shared/api/generated.ts`. Architecture: ADR-0026. Forward-only migrations: V045 ownership/checkout, V046 navigation/Help, V047 ownership integrity, V048 digital-only lifecycle guard, V049 purchase line capabilities. Existing migrations and approved root artifacts remain unchanged.

Verification: backend 162 tests; frontend 462 tests plus typecheck/build; full PostgreSQL 18 SQL/concurrency/HTTP/session gates; real Flyway V044→V048 historical backfill; focused mocked purchase/pickup/library/Help browser checks and two real PostgreSQL/API browser checks. Independent review accepted. Full logs are retained under `/tmp/pliego-architecture-pass`. Required scope has no known unresolved gap; content delivery/progress and partial refunds remain outside existing capabilities. No commit, push or deployment.

Functional alignment verification: backend verify 162 tests, five focused PostgreSQL gates and live checkout/library/storefront/Help contracts passed. Historical verification used compiler-disabled workers (482 tests). Current frontend verification uses the supported default Node 24 runtime and plain npm test: vitest.config.ts explicitly passes --no-concurrent-recompilation to fork workers. This keeps JIT, optimization and WebAssembly enabled while avoiding observed background-compiler aborts. System Node 22.22.1 is below the installed jsdom version’s supported floor; do not use that previous alternative. Typecheck/build passed. Logs are in /tmp/pliego-architecture-alignment. CustomerOrderItem is a distinct OpenAPI schema; unrelated admin Item schemas and BEST_SELLING pattern typing were preserved. Final tabs/chips, ISO date/duration formatting, mega-menu and library/Help presentation remain Claude’s work.

Final focused browser coverage verified 58 distinct scenarios across runs, including all 16 header cases after transport fixture corrections; catalog pagination/detail-context regression also passed. Independent review has no open critical/important findings. See /tmp/pliego-architecture-alignment/files-modified.txt for the complete changed-file manifest.

V8 worker stability fix verified on Node 24.21.0: plain npm test passed 487 tests across 57 files, CheckoutPage.test.tsx passed all 27 tests through the normal command, and npm run typecheck passed. Vitest fork workers use --no-concurrent-recompilation from vitest.config.ts; no broad optimizer-disable flags or alternate unsupported runtime are needed. Full reproduction and verification logs: /tmp/pliego-v8-fix.
