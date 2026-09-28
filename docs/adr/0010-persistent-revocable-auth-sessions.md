# ADR-0010: Persistent and revocable authentication sessions

## Status

Accepted; supersedes the session-persistence decisions in ADR-0002 and ADR-0006.

## Date

2026-09-28

## Decision Drivers

- A normal reload or reopening of the ecommerce must recover the CUSTOMER or ADMIN session.
- Do not store passwords or bearer access tokens in browser persistence.
- Logout and backend invalidation must revoke the persistent session.
- Keep the existing Spring JDBC modular monolith and PostgreSQL Database API.
- Avoid Redis and additional persistent services for the current VPS.
- Keep the access-token security lifetime defined by the REST contract.

## Considered Options

1. Persist the bearer JWT in `localStorage` or `sessionStorage`.
2. Issue a long-lived bearer JWT and keep it stateless.
3. Keep short-lived bearer JWTs in memory and use a persistent, opaque, revocable refresh credential in an `HttpOnly` cookie backed by PostgreSQL.

## Decision Outcome

**Chosen option**: option 3. Login establishes a 30-day absolute authentication session. The backend generates a random 256-bit refresh credential and sends it only in a host-only `HttpOnly`, `Secure`, `SameSite=Strict` cookie scoped to `/api/v1/auth`. PostgreSQL stores only refresh credential SHA-256 digests, user, timestamps, and revocation state through the identity Database API routines. The raw refresh credential and 30-minute bearer JWT are never stored in browser-readable persistence; the bearer JWT remains in memory.

`POST /api/v1/auth/refresh` atomically rotates the refresh digest and issues a new 30-minute bearer JWT while keeping the original absolute session expiry. A purpose-separated HMAC derives the replacement credential from the prior one, so a retry after a lost response during the five-minute recovery window returns the same replacement cookie. Missing, invalid, revoked, expired, or inactive sessions return `204` and expire the cookie. `POST /api/v1/auth/logout` revokes the session by either its current or immediately prior refresh digest, then expires the cookie. Both cookie-authenticated operations require a fixed custom request header and exact-origin credentialed CORS, so browser form posts cannot mutate the session. The frontend waits for restoration before showing Guest or role-specific navigation, refreshes before access-token expiry, and retries restoration when the tab becomes visible or connectivity returns.

The flow remains Controller → Application Service → JDBC Gateway → PostgreSQL Database API. Session rules live in a forward-only Flyway migration; no new service or database is introduced. Credentialed CORS remains limited to configured exact origins.

## Consequences

### Positive

- Browser reloads and normal application restarts recover CUSTOMER and ADMIN identity without a password prompt.
- A stolen database snapshot contains only a one-way refresh-token digest.
- Logout and PostgreSQL session invalidation stop future refreshes; the browser receives a cookie deletion response.
- Existing authorization continues to use signed bearer JWTs and server-side role checks, with the existing 30-minute JWT lifetime.
- PostgreSQL remains the only persistent session store and owns session creation, rotation, expiry, and revocation.

### Negative

- A persistent session row is created for each login and retained until expiry or cleanup on later logins.
- Session restoration and rotation require PostgreSQL availability.
- Local plain-HTTP development must explicitly set `PLIEGO_AUTH_COOKIE_SECURE=false`; deployed HTTPS environments must keep it `true`.
- A revoked refresh session cannot renew its bearer JWT; an already issued stateless JWT retains its existing maximum 30-minute lifetime.

## Validation

- Backend tests cover cookie attributes, CUSTOMER/ADMIN token roles, rotation, logout revocation, expired credential cleanup, and response redaction.
- PostgreSQL 18 HTTP gates cover login, restoration/rotation, logout, and forced expiry against a live backend and database.
- Frontend tests cover restoration loading (no Guest flash), CUSTOMER/ADMIN recovery, backend logout, and invalid-session return to Guest.
- OpenAPI documents the cookie scheme, refresh/logout operations, and the 30-day absolute session expiry.
