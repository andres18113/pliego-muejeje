# ADR-0026: Storefront projections, published Help and digital ownership

## Status
Accepted for the requested architecture implementation, 2026-10-05.
Supersedes ADR-0016's temporary address requirement for digital-only checkout.

## Decision drivers
Prepare functional contracts for storefront navigation, Help and Mi biblioteca without implementing their final visual interfaces or digital content delivery. Preserve the modular monolith, Spring transaction boundaries and public PostgreSQL Database API.

## Considered options
1. Extend the existing commercial order and isolate physical fulfillment from digital ownership.
2. Split mixed carts into separate physical and digital orders.

## Decision
Choose option 1. Existing orders snapshot all purchased lines and already move stock only for physical editions. Add an explicit DIGITAL_ONLY checkout discriminator, validated against cart composition in PostgreSQL. Digital-only orders have no address, pickup or shipment; mixed orders retain one payment and physical fulfillment. Expose authoritative cart checkout requirements so React does not decide fulfillment rules.

Digital ownership has a stable customer/edition identity and purchase grants unique by order item. Approved payment creates grants atomically, including successful historical purchases. Refunded/cancelled sources are revoked; another valid source preserves ownership. Retain immutable acquisition metadata and source references even if the catalog edition becomes inactive. Authenticated list/detail functions isolate customers. Access states explicitly describe ownership only; available actions are purchase/order and relevant Help links. Readers, players, files, streaming, downloads, DRM, progress and bookmarks are out of scope. A future content service may reference ownership identity without changing purchase grants.

Ownership identities, grant sources, acquisition timestamps and metadata snapshots cannot be reassigned or deleted. Grants must match the paid order's customer and digital edition. Digital-only orders reject legacy physical preparation/shipping/delivery commands; commercial confirmation and cancellation remain independent. Implemented through forward-only migrations V045–V048.

Functional alignment: SiteHeader and HomeNextReading consume the same storefront projection. Reading previews derive Catalog/Offers query criteria from the server hrefs; Help is a normal section. Navigation exposes loading and error/retry states without hardcoded destination fallbacks. V049 projects line-level requiresPhysicalFulfillment and quantityEditable through the public Database API for cart/checkout/customer-order views. React consumes these capabilities and required cart counts rather than interpreting display formats. Source-purchase labels are projected in the library view model using the existing Spanish purchase labels; raw order/payment/grant states remain unchanged. Catalog's finite frontend sort union is regression-checked against the authoritative OpenAPI pattern, including BEST_SELLING; generated string typing is intentional.

Catalog owns BEST_SELLING and media filters. Rank eligible editions by quantities from approved, non-cancelled purchases confirmed during the last 30 days. Use stable confirmation history rather than mutable update timestamps. Resolve ties and insufficient sales by recent active editions and stable edition IDs. Storefront is a compact read projection of Catalog, Offers and Help; it does not calculate prices. Exclude inactive categories and inactive ancestors. Help owns published categories/articles with stable slugs, ordering, search and GENERAL/PHYSICAL/EBOOK/AUDIOBOOK applicability; no public draft access or authoring REST API.

## Consequences
No extra order/payment orchestration or duplicate digital shipment records. New forward-only migrations extend existing routines while preserving approved signatures. Full-order refunds remain the existing financial capability; partial refunds/content delivery are not introduced. Frontend receives typed adapters, hooks, query keys, routes and state models, leaving visual presentation to Claude.

## Validation
PostgreSQL gates cover ranking window/fallback, media/category eligibility, published Help search, all checkout compositions, grant retries/refunds/duplicate sources and isolation. HTTP/OpenAPI and frontend contract checks verify matching public contracts. Existing physical checkout and fulfillment gates guard compatibility.
