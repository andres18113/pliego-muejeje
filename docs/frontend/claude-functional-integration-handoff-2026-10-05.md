# Claude handoff: functional integration

This pass completes functional integration using the existing components. The final PLIEGO visual redesign remains yours. Use the supplied Google Store references for composition, including centered intro, applicable filter chips, offer count, sorting, product grid, validity and discount treatments. Do not copy trade-in mechanics or invent conditional promotions.

## Offers

- `/ofertas` has backend-driven product-type/category filters, sort options, total count, pagination, loading/error/retry/empty states, existing favorite/cart controls and edition navigation that preserves filters.
- Home's Offers destination now reads real offers. Catalog cards and edition detail show the effective and previous prices supplied by the server.
- `GET /api/v1/catalog/offers`: `productType=PHYSICAL|EBOOK|AUDIOBOOK`, `category`, `sort=RELEVANCE|ENDING_SOON|PRICE_ASC|PRICE_DESC`, `page`, `pageSize`. Results use the existing edition-summary/page envelope. Optional edition `format` remains supported.
- `GET /api/v1/catalog/offers/filter-options` supplies applicable `productTypes[{code,label,count}]`, `categories[{slug,name,count}]`, `sorts[{code,label}]`, global `totalCount`, `timezone`, `endingSoonDays`. Counts are decimal strings. Page `totalCount` is the count for the current filters.
- ADMIN: `PUT/DELETE /api/v1/admin/editions/{editionId}/offer`. PUT accepts `offerPrice`, `startsAt`, `endsAt`, optional `offerCopy`, optional `terms`. No customer authoring flow.
- Catalog/offer/detail `offer` is nullable. An active object supplies `offerId`, `originalPrice`, `effectivePrice`, `savingsAmount`, `savingsPercent`, compatibility `discountAmount`, `startsAt`, `endsAt`, `daysRemaining`, `endingSoon`, optional nullable `offerCopy`, `terms`. Monetary values and percentage are decimal strings; remaining days are integer. `price` is the authoritative effective edition price.
- `getPublicOffers`, `getOffersFilterOptions` live in `shared/api/catalog.ts`; `useOffers`, `useOffersFilterOptions` in `offersQuery.ts`; URL state in `offersUrl.ts`; `toOfferViewModel` in `offersViewModel.ts`; existing `toBookCardData` includes the offer model. No text or terms are fabricated when absent.
- The model includes price labels, server savings percentage, remaining-days label, `endingSoon`, end timestamp/label and copy/terms. Format the supplied date/offset; do not calculate expiration or remaining days from a browser clock.

## eBooks and audiobooks

- `/catalog?format=EBOOK` and `/catalog?format=AUDIOBOOK` reuse existing catalog routes, filters, clients and states. Physical edition formats remain `PAPERBACK`/`HARDCOVER`; `PHYSICAL` is the Offers product-type grouping.
- `/catalog/editions/:editionId` renders supplied EPUB/PDF metadata or audiobook duration and ordered narrators. Missing fields remain absent. `formatAudioDuration` in `features/catalog/formatters.ts` is a presentation helper.
- `/favorites`, `/cart`, `/checkout` and `/orders/:orderId` retain edition-format identity. Digital quantities remain one. Cart/checkout show format labels.
- Digital-only checkout disables physical pickup and resets stale pickup selection after cart changes. The existing simulated checkout still requires an address; physical and mixed checkout keep existing behavior.
- No files, download links, streaming player or entitlement/library API exists. Do not introduce these in styling.

## Email

| Route | Existing backend action | State/behavior |
| --- | --- | --- |
| `/verificar-correo#token=…` | `POST /api/v1/auth/verify-email` | Explicit confirmation; pending, success, invalid/missing/used token, uncertain outcome |
| `/reenviar-verificacion` | `POST /api/v1/auth/resend-verification` | Validation, neutral accepted response, pending/error/uncertain outcome |
| `/recuperar-contrasena` | `POST /api/v1/auth/forgot-password` | Same neutral request behavior |
| `/restablecer-contrasena#token=…` | `POST /api/v1/auth/reset-password` | Password form; clears local session after success |

- Sign-in links to resend/recovery. Registration directs customers to verify. Account links to resend and uses existing `PUT /api/v1/me/email`, re-verification and refresh-session revocation.
- API client: `shared/api/emailActions.ts`; hooks: `features/auth/emailActionHooks.ts`; pages: `EmailActionPages.tsx`. Fragments are scrubbed; tokens remain in memory and are consumed only after confirmation. New fragment links on an already-mounted route replace the old token.
- Commands have pending/error/success states, no automatic retries and explicit uncertain-outcome recovery. Session profile updates cannot restore a session cleared/replaced during an email command.
- Order confirmation is enqueued by backend checkout; the existing purchase confirmation/order views show the committed purchase. Do not send a second email from React or promise delivery when only enqueuing is known.
- Mailtrap credentials, provider transport, token generation, templates, outbox and retries remain backend-only. Customer UI uses Spanish domain feedback.

## Business authority: preserve

PostgreSQL owns timed offer eligibility, original/effective prices, savings/percentage, filtering/sorting, facets/counts, Ecuador calendar-day calculation and the single three-day ending-soon policy. Validity is `[startsAt, endsAt)`. RELEVANCE orders savings amount descending, end time ascending, edition ID ascending. Expired/inactive offers and offers above a lowered base price fall back to normal prices.

Cart, checkout quote, tax, checkout and immutable order price snapshots use the same effective price. Offer changes lock editions with checkout; later offer changes do not rewrite orders or command replays. No coupon stacking or trade-in offers. Do not duplicate these rules in React.

PostgreSQL also owns digital quantity/availability, inventory movement only for physical items, pickup eligibility, shipping/taxes, purchase actions, email verification and single-use token rules. Keep uncertain command outcomes, authentication and server validation intact when changing markup.

## Exact frontend surfaces safe to style

Change markup and styles while preserving props, data attributes used by tests, accessible names/focus behavior, query state and command handlers:

- `frontend/src/features/catalog/OffersPage.tsx`
- `frontend/src/features/catalog/BookCard.tsx`, `BookCard.module.css`, `EditionGrid.tsx`, `catalogLayout.module.css`
- `frontend/src/features/catalog/HomeNextReading.tsx`, `HomeReadingScene.tsx`, `homeNextReading.module.css`
- `frontend/src/features/catalog/EditionDetailPage.tsx`, `editionDetail.module.css`
- `frontend/src/features/purchase/CartPage.tsx`, `cart.module.css`, `CheckoutPage.tsx`, `FulfillmentTabs.tsx`, `pickup.module.css`, `purchaseFlow.module.css`
- `frontend/src/features/auth/EmailActionPages.tsx`, `AuthPages.tsx`, `frontend/src/features/account/AccountPage.tsx`, `profile.module.css`

Treat `shared/api/*`, generated types, session handling, hooks, view-model calculations, URL normalization and migrations as functional contracts. Add presentation wrappers/CSS if needed; preserve their interfaces. Exported OpenAPI is `frontend/openapi/openapi.json`; generated types are `frontend/src/shared/api/generated.ts`. Backend contract and decisions: `docs/backend/offers-api.md`, ADR-0025.

## Verification

- Java 25 `mvn verify`: 153 tests, no failures/errors/skips. PostgreSQL 18.6: Flyway `44:44`; all 18 SQL and 24 concurrency/HTTP components passed. The remaining authentication/session gate passed separately with Secure cookies enabled. The combined runner initially failed that final cookie assertion because local browser settings explicitly disabled Secure; domain components had passed and were not repeated.
- Transactional-email integration passed with a local provider stub: verification/reset, BCrypt, refresh revocation, concurrent single use, order outbox, retry and delivery. Real Mailtrap delivery was not exercised.
- Frontend: 440 tests across 51 files passed; typecheck and production build passed. Eight integrated Playwright tests passed: live physical/digital catalog, metadata, favorites/cart, offers filters/sorting/prices/validity/terms, and mocked email action routes. Initial live-test proxy misconfiguration and offer-layout/rapid-filter regressions were corrected; final run has zero failures.
- Independent review findings were fixed and re-reviewed: email/logout session race, RFC3339 seconds and category-facet eligibility. Historical migrations V001–V043 were hash-checked unchanged. Only V044 was added; no commit, push or deployment.

Complete logs are preserved under `/tmp/pliego-integration/logs/` and `/tmp/pliego-integration-{offers,email,digital}/`. The integration test backend used port 18445; `PLIEGO_API_PROXY_TARGET=http://127.0.0.1:18445` allows the Vite proxy to target an alternate local backend while preserving default port 8080. Keep test credentials/private environment files outside Git.
