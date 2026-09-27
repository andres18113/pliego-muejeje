# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + TypeScript + Vite 8. Use React Router Data Mode for production routes and boundaries, TanStack Query for server state, and one OpenAPI-generated TypeScript client. Use React Hook Form + Zod for forms. Tailwind CSS 4 and shadcn/ui with Base UI provide the shared UI foundation; PLIEGO tokens remain the visual authority. Add TanStack Table only to ADMIN data grids. Use Motion only for interactions that benefit from animation and honor reduced motion. Validate with Vitest/Testing Library and Playwright.

## Users

- Guest and CUSTOMER readers browse book editions and decide what to purchase. Public discovery and CUSTOMER purchasing set the v1 experience priority.
- CUSTOMER account holders maintain their profile and delivery addresses, an active cart, and their own orders.
- ADMIN operators maintain customer access, catalog data, stock, orders, and sequential logistics states.

## Product Purpose

PLIEGO is a web bookstore experience. It supports public book discovery, CUSTOMER purchase and order tasks, and the ADMIN work needed to maintain the catalog, inventory, customer access, and order logistics. No population-level success metrics or research findings are approved.

## Positioning

No differentiated market position or commercial promise is approved. The v1 mechanism is an integrated public edition catalog, CUSTOMER cart and simulated checkout, and ADMIN catalog, inventory, and order operations. Do not invent claims about selection, service, delivery, or payment.

## Operating Context

People use a browser to discover a published edition and, as a CUSTOMER, manage delivery data, a cart, checkout, and personal orders. ADMIN users work in separate role-protected operational surfaces. Spanish is the project/API human-facing language. This is the academic v1 product, not a live payment service.

## Capabilities and Constraints

- The frozen backend is `backend-v1.0.0` at `8818ed5932af39c6192fa96520820d3423085e2d`; the frontend calls only its REST API under `/api/v1`.
- Guest can search and view public editions. Registration creates CUSTOMER only and does not sign in automatically.
- CUSTOMER can manage profile and addresses, cart, simulated checkout, orders, and cancellation only while the order is `CONFIRMED` or `PREPARING`.
- ADMIN can search/change customer status; manage authors, publishers, categories, books, and editions; inspect/update inventory; and manage orders and sequential logistics transitions.
- The backend owns authorization, validation, availability, stock, state transitions, and command outcomes. IDs and money remain strings at the JSON boundary; API pagination is zero-based.
- CARD checkout requires a transient Luhn-valid `cardNumber`, asks for no CVV/expiry, and never persists or returns the value. TRANSFER omits it. Checkout has an explicit academic `APPROVED`/`REJECTED` outcome; neither represents real payment.
- The JWT has no refresh or remote logout endpoint. The client architecture keeps it in memory; reload requires sign-in.
- Checkout, cancellation, inventory movements, and logistics transitions are non-idempotent commands. Unknown outcomes require a read of current state before another attempt.
- No real payment processing, shipping/tax calculation, carrier tracking, password recovery, password change, or customer email change is supported.

## Brand Commitments

- Product name: PLIEGO.
- Interface copy and human-facing errors are Spanish for v1.
- Use a PLIEGO-owned palette and design tokens with semantic HTML. Tailwind CSS 4 and shadcn/ui with Base UI support reusable components without changing the approved bookstore direction.
- Use Inter Variable for interface text and Literata Variable for editorial display text.
- The approved visual direction is a familiar, editorial bookstore: lead with catalog search, direct category navigation, book covers, and clear edition facts. Keep the storefront in bookstore vocabulary rather than generic SaaS framing.

## Evidence on Hand

- Approved use cases: `use-case-baseline-v1.0.md`.
- Approved REST contract: `rest-api-contract-v1.0.md`.
- Frontend behavior and role boundaries: `docs/frontend/product-design-and-ux-v1.0.md`.
- Backend handoff: `docs/frontend/backend-handoff-v1.0.md`.
- No user research, analytics, approved logo, photography, testimonials, or marketing claims are supplied.

## Product Principles

- Make finding a suitable edition and understanding its current availability easy.
- Keep customer purchasing and ADMIN operations clearly separated by role.
- Present backend-confirmed state and provide a current-state recovery path after uncertain commands.
- Explain the academic payment simulation without suggesting a real financial transaction.
- Do not collect or retain sensitive information beyond the v1 request requirement.
