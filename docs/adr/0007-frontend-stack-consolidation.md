# ADR-0007: Consolidate the frontend on the approved React stack

## Status

Accepted for the frontend implementation.

## Date

2026-09-25

## Context

The first production frontend contains only the public catalog and edition detail. An approved IHC/UX audit identified broken identity links, missing route-level error handling, fragile pagination count parsing, duplicate result labels, locale-inflexible prices, and inconsistent edition detail chrome. The identity endpoints and fields are already part of the SpringDoc OpenAPI contract and the approved UX baseline.

The product direction remains **Catálogo familiar**. The implementation needs a coherent route, server-state, form, API, and UI foundation without replacing working catalog behavior or moving backend-owned business rules into the client.

## Decision

- Keep the independently built React 19 + TypeScript single-page application and move to Vite 8.
- Use React Router Data Mode for production route resolution, navigation, scroll restoration, and route error boundaries.
- Use TanStack Query for remote catalog/category/edition reads. Keep URL query parameters authoritative for catalog search, filters, sorting, and pagination.
- Use one `openapi-fetch` client and generate TypeScript contracts from the checked-in SpringDoc snapshot with `openapi-typescript`. The generated file is not edited by hand.
- Use React Hook Form + Zod for search, catalog filters, registration, and sign-in. Keep native input/select semantics and validate user-facing values in Spanish.
- Establish Tailwind CSS 4 and shadcn/ui with Base UI as the reusable UI foundation. Keep the existing PLIEGO CSS tokens and custom catalog styling as the visual authority; shared primitives must preserve the approved bookstore presentation.
- Use Inter Variable for interface text, Literata Variable for editorial display text, and Lucide React for interface icons.
- Use Vitest + Testing Library for component and behavior coverage and Playwright for the critical public catalog flow.
- Defer TanStack Table until an ADMIN data grid exists. Defer Motion until an interaction benefits from authored animation; current public catalog behavior does not need it.

## API typing boundary

The OpenAPI snapshot is generated from the backend's public SpringDoc document. The SpringDoc response schema represents catalog `PageResponse.items` as `unknown[]` because the generic response loses its item type. The client therefore takes the generated envelope type and validates the public catalog display projection at runtime with Zod before placing it in Query state. This is a narrow response-validation boundary, not a second source of backend business rules. No backend API capability is missing.

Regenerate API types with `npm run api:types` after refreshing `frontend/openapi/openapi.json` from the approved backend contract.

## Consequences

- The catalog keeps its existing URL semantics and P2022 category-inactive recovery behavior.
- Access tokens remain in memory only. A reload returns to Guest, matching the backend's lack of refresh and logout endpoints.
- Registration uses the supported CUSTOMER-only operation and finishes with an explicit sign-in action. Login routing follows the API role; ADMIN is never sent into customer purchasing.
- Shared Base UI controls are introduced incrementally. Existing visual work is retained, and TanStack Table, Motion, and non-catalog feature surfaces wait for a real responsibility.
- The currently implemented ADMIN destination is an honest placeholder because no ADMIN task surface exists in this frontend yet.

## Validation

- `npm run typecheck` and `npm run build` validate the Vite 8 application.
- Vitest + Testing Library cover total-count validation, locale decimal submission, focus retention while reads are pending, and auth route states.
- Playwright covers public catalog search, edition detail, and return-context navigation when a browser runtime is available.
- Impeccable `polish`, `critique`, and `audit` run against the production catalog and edition surfaces.

## References

- [React Router Data Mode](https://reactrouter.com/start/modes)
- [Tailwind CSS installation with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [shadcn/ui manual installation](https://ui.shadcn.com/docs/installation/manual)
- [Frontend technical architecture](../frontend/frontend-technical-architecture-v1.0.md)
- [Approved product behavior](../frontend/product-design-and-ux-v1.0.md)
