# Persistent Revocable Sessions — API Amendment v1.0.4

**Status:** Active amendment to the approved PLIEGO v1 REST contract

**Applies to:** backend-v1.0.0 base path `/api/v1` and browser clients

**Scope:** Add a persistent, revocable authentication session while retaining the 30-minute bearer access-token contract.

This amendment leaves the approved REST and Database API baselines and released migrations unchanged. It adds Flyway migration `V026__persistent_revocable_auth_sessions.sql` and documents the additive endpoints in `frontend/openapi/openapi.json`.

## Session lifetime and storage

- A successful `POST /api/v1/auth/login` still returns the approved 30-minute HS256 bearer JWT and authenticated `user` (`userId`, `email`, `role`). It also sets the `pliego_session` cookie.
- The cookie contains a cryptographically random, opaque 256-bit refresh credential. It is host-only, `HttpOnly`, `Secure`, `SameSite=Strict`, and scoped to `/api/v1/auth`. Production must use HTTPS and `PLIEGO_AUTH_COOKIE_SECURE=true`.
- Refresh and logout require the `X-PLIEGO-SESSION-REQUEST: 1` header. This fixed marker is not a credential; it makes browser requests use the exact-origin CORS preflight policy instead of allowing cross-site HTML form posts to mutate cookie-backed sessions.
- The absolute session expiry is 30 days from login. Refresh rotation does not extend that deadline.
- PostgreSQL persists only the SHA-256 digest of the refresh credential. Passwords and raw refresh credentials are never returned in JSON or persisted by the browser client.
- Frontend and API origins, when different, must remain same-site for the `SameSite=Strict` cookie and must use the exact-origin credentialed CORS allowlist.

## Added operations

### `POST /api/v1/auth/refresh`

The browser calls this at application startup and before the current access token expires. On a valid session, PostgreSQL atomically replaces the current token digest, and the API returns the same JSON shape as login with a new 30-minute access JWT and the same authenticated role. The response replaces the cookie without extending its absolute expiry. If the HTTP response is lost after the rotation commits, retrying with the prior cookie for five minutes derives and returns the same replacement credential; this avoids logging out a user after an unknown network outcome.

An absent, malformed, stale, revoked, expired, or inactive session returns `204 No Content` and expires the cookie. A network or server error remains an error; clients must not discard the cookie or treat an unknown response as confirmed session invalidation.

### `POST /api/v1/auth/logout`

Revokes the refresh session associated with the cookie and returns `204 No Content` with an expired cookie. Repeating the operation or calling it without a cookie is safe.

## PostgreSQL Database API additions

- `fn_auth_session_create(p_user_id, p_refresh_token_hash, p_expires_at)` creates a session only for an active actor.
- `fn_auth_session_refresh(p_current_refresh_token_hash, p_replacement_refresh_token_hash)` atomically rotates one valid session and returns current identity and absolute expiry. It accepts the previous digest for five minutes only when paired with the exact deterministic replacement digest for that rotation; a stale or invalid digest returns no rows.
- `fn_auth_session_revoke(p_refresh_token_hash)` revokes the matching session idempotently.

All three routines are invoked through the identity JDBC Gateway within Spring-managed transactions. Migration V026 adds the session table and routines; V027 adds the previous digest needed for idempotent refresh retries; V028 makes logout revoke by either the current or previous digest. The table has a foreign key to `pliego.usuario`, unique current and prior digests, expiry and revocation timestamps, and an index for active sessions. No Redis or other persistence service is required.

## Client behavior

The access JWT remains memory-only. On application start, the client shows a restoration state and withholds Guest navigation and protected routes until refresh confirms either a valid session or no session. A valid CUSTOMER or ADMIN role is restored from the backend response. Logout waits for backend revocation before clearing the in-memory token and protected query cache. A confirmed invalid or expired restoration clears local authenticated state; a network failure keeps the client in a retryable session-check state.

## Validation

The generated OpenAPI defines the `authSessionCookie` cookie scheme and required browser marker for refresh/logout, plus response shapes, status codes, cookie expiry, and security attributes. The implementation is verified with Spring MVC tests and live PostgreSQL 18 HTTP gates.
