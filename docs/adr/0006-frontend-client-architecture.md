# ADR-0006: Standalone React client for the PLIEGO frontend

## Status

Accepted for the frontend implementation.

## Date

2026-09-23

## Context

The approved PLIEGO backend is a Spring Boot REST API at `/api/v1`; the frontend UX baseline defines 12 goal-based surfaces for Guest, CUSTOMER, and ADMIN. The repository has no frontend build or runtime. Backend v1 uses bearer JWTs, exact-origin CORS, Spanish Problem Details, and no refresh or server logout endpoint. Business invariants remain owned by PostgreSQL routines and the backend.

The frontend must implement the approved flows without changing the frozen backend or duplicating its business rules. It also handles checkout card data that is accepted only for CARD and must remain transient.

## Decision drivers

- Keep frontend delivery independent from the frozen Spring backend.
- Support the approved role-aware route model and 12 surfaces.
- Keep API calls in one boundary and business rules authoritative in the backend.
- Minimize deployment/runtime complexity for the current single frontend and REST backend.
- Prevent bearer tokens and card numbers from being persisted by the browser client.

## Considered options

1. React + TypeScript + Vite static single-page client.
2. Server-rendered pages added to the existing Spring application.
3. React framework with server rendering and a Node runtime.

## Decision outcome

Use a separate `frontend/` React + TypeScript single-page application built with Vite. Serve its static build independently and call the existing REST API from the browser. React's official guidance supports a from-scratch client when a framework is not a fit; Vite provides a first-party React TypeScript template. A separate Node server or server-side rendering is not required by the approved behavior; public catalog discoverability/SEO is not yet a requirement.

Use feature folders aligned to user workflows and one shared API client. Use local form state and TanStack Query for server state; do not add a second business/domain rules layer. Route guards improve navigation only—the backend remains the authorization boundary.

Keep the access token in memory only. A reload therefore returns to Guest and requires sign-in; this is the selected security default because v1 cannot refresh or revoke tokens. On sign-out or any authoritative 401, clear the token and protected query cache.

For checkout, present both supported payment methods and an explicit, clearly academic `APPROVED`/`REJECTED` simulation choice. CARD requests include only a transient 12–19 digit Luhn-valid `cardNumber`; no CVV or expiration date. Never store, restore, log, or echo it. TRANSFER requests omit the property. The simulation is not represented as real payment.

Use Spanish for interface labels and user-facing errors, consistent with the project/API context. The simulator control is explicitly disclosed as test/demo behavior.

## Consequences

- Frontend artifacts, dependencies, and builds live under `frontend/`; backend code and database artifacts remain unchanged.
- Frontend hosting has a separate origin, so deployment must configure that exact origin in `PLIEGO_CORS_ALLOWED_ORIGINS`.
- Client route fallback must serve the SPA entry point for deep links.
- Browser refresh discards authentication. This avoids persisting JWTs but asks users to sign in again.
- Client validation improves feedback but never replaces API validation or database rules.
- The static client is not server-rendered; revisit if search indexing becomes an approved product requirement.

## Validation

- Frontend production build completes from its lockfile on the pinned Node LTS line.
- Route and API contract checks cover Guest, CUSTOMER, and ADMIN permissions and the approved UX acceptance criteria.
- Browser inspection confirms role-directed login, no automatic retries of non-idempotent commands, and the approved unknown-outcome recovery paths.
- Source review confirms access tokens remain in memory and checkout card data is absent from storage, logs, telemetry, and post-submit UI.

## References

- [React: Build a React app from scratch](https://react.dev/learn/build-a-react-app-from-scratch)
- [Vite: Getting Started](https://vite.dev/guide/)
- [PLIEGO Frontend UX Baseline v1.0](../frontend/product-design-and-ux-v1.0.md)
