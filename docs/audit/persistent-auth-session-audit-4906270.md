# Independent security and correctness audit: persistent authentication sessions (commit `4906270`)

- **Date:** 2026-09-28
- **Scope:** persistent authentication/session implementation introduced in commit `4906270`
  (`feat: complete ecommerce flows and persist sessions`), covering migrations V026–V028,
  auth controllers/services/gateways, refresh-token lifecycle, JWT issuance/validation,
  cookies, PostgreSQL routines/constraints/indexes, OpenAPI + ADR docs, frontend session
  behavior, and Nginx/Cloudflare-relevant assumptions.
- **Method:** independent re-verification. The implementation report and previous test results
  were not trusted. Every file, migration, and routine cited below was re-read, the backend
  was rebuilt from the audited commit, and all gates were executed against live PostgreSQL 18
  + Spring. No production code was modified during the audit.
- **Decision: ACCEPT WITH FIXES** (see §6).

## Verification performed

| Gate | Command / action | Result |
|---|---|---|
| Full backend suite | `mvn test` (backend rebuilt from `4906270`) | 115 run, 1 failure (`OpenApiCoverageTest` count only); `AuthApiIntegrationTest` 13/13, `SensitiveDataToStringTest` pass |
| Live DB objects | `psql`: `\d pliego.sesion_autenticacion`, `pg_indexes`, `pg_get_functiondef` (PG 18.6, Flyway 28:28) | Match V026+V027+V028 exactly |
| Existing auth HTTP gate | `auth_session_http_gate.py` vs live backend :18080 | PASS (login, reload/reopen restore, rotation, same-credential retry, out-of-window reject, logout-via-previous, expiry clear) |
| Adversarial probes | `/tmp/pliego_audit_probes.py` (38 checks, throwaway, kept for review) | 38/38 pass |
| Frontend unit suite | `npx vitest run` | 143/143 pass |
| Live browser spec | `PLIEGO_E2E_LIVE=1 npx playwright test tests/e2e/session.live.spec.ts` (real Chromium, HTTP backend :8080 with `PLIEGO_AUTH_COOKIE_SECURE=false`, required because browsers ignore `Secure` cookies over HTTP) | PASS (login → reload → reopen → cross-tab logout → reload stays out; zero web-storage use) |

Adversarial cases exercised live: 10× simultaneous refresh (converged to one replacement,
one row, unchanged absolute expiry); malformed/random/SQL-injection cookies (all 204 +
cleared, no echo, never 500); missing marker header (403 `ACCESS_DENIED`); missing cookie
(204); grandparent-after-two-rotations rejected (204) while parent still retries inside the
window; post-logout current/previous/grandparent refresh (all 204); idempotent logout;
`BLOCKED` account refresh (204); role flip re-read from DB (no stale role); hash-only
storage (`^[0-9a-f]{64}$`, raw values absent); JWT tamper (401); `iss`/`aud`/exact-1800s
shape. Index usage confirmed with measured plans (`enable_seqscan=off` shows the unique
index scan and BitmapOr over both digest indexes; plain `EXPLAIN` seqscans are the correct
plan at 35 rows).

## Findings

### F1 — CI red: endpoint-count assertion stale (Medium)

- **Location:** `backend/src/test/java/com/pliego/modules/catalog/api/OpenApiCoverageTest.java:61`
- **Evidence:** `expected: 52 but was: 54`. Commit `4906270` adds `CountryReferenceController`
  and `TransferReferenceController` (2 endpoints) without updating the count.
- **Impact:** `mvn test` / `verify` fails on this commit. Unrelated to auth correctness, but
  blocks any green-CI acceptance.
- **Fix:** bump to 54 (or scope the assertion) in a normal commit.

### F2 — CI script asserts Flyway `25:25` and never runs the auth gate (Medium)

- **Location:** `backend/src/test/postgres18/run_ci_gates.sh:67` and gate loops L73–88
- **Evidence:** live baseline is V028 (`28:28`), so the script fails its own check; and
  `auth_session_http_gate.py` exists but is absent from all three gate loops (it also needs
  `PLIEGO_TEST_API_BASE_URL`, which the script never sets — it only requires
  `CHECKOUT_BASE_URL`).
- **Impact:** the live auth coverage is one `run_ci_gates.sh` execution away from silently
  not existing in CI.
- **Fix:** assert `28:28`; add the auth gate to the HTTP loop with the mapped env var.

### F3 — Two docs still claim there is no refresh/logout (Low)

- **Location:** `docs/frontend/backend-handoff-v1.0.md:31`
  ("There is no refresh-token or logout endpoint") and
  `docs/adr/0007-frontend-stack-consolidation.md:38`
  ("A reload returns to Guest, matching the backend's lack of refresh and logout endpoints").
  ADR-0010 supersedes 0002/0006 but these were missed.
- **Impact:** docs only (code is correct); integrators/operators get wrong security behavior.
- **Fix:** one-line superseded-by-ADR-0010 notes in each. (`frontend-technical-architecture`
  L112 remains accurate — the access JWT *is* memory-only.)

### F4 — Login-path stale-session cleanup is an unindexed full scan in the login transaction (Low)

- **Location:** `pliego.fn_auth_session_create`
  (`backend/src/main/resources/db/migration/V026__persistent_revocable_auth_sessions.sql:35`)
- **Evidence:** `DELETE … WHERE fecha_expiracion < … OR fecha_revocacion < …` matches no
  index (`ix_…_usuario_activa` is partial on un-revoked rows).
- **Impact:** each login scans the session table; ms-scale at realistic sizes, growing with
  ~60 days of retained rows; minor lock contention under concurrent logins.
- **Fix (backlog):** partial index on expiry/revocation for old rows, or move cleanup out of
  the login path. Fine as-is for the 2 vCPU VPS at expected scale.

### F5 — JWT-signing secret doubles as the rotation-HMAC key (Low)

- **Location:** `backend/src/main/java/com/pliego/modules/identity/application/AuthSessionCredentialService.java:21`
  + `backend/src/main/java/com/pliego/foundation/security/JwtConfiguration.java:34`
- **Evidence:** same `pliegoJwtSecretKey` signs JWTs and derives `replacementFor()`
  (mitigated by the `PLIEGO:auth-session-refresh:v1:` purpose prefix).
- **Impact:** marginal — secret compromise already forges arbitrary JWTs, so the rotation
  chain adds no new attacker capability; still unhygienic (secret rotation also breaks
  in-flight 5-minute retries).
- **Fix (backlog):** separate `PLIEGO_SESSION_ROTATION_SECRET`.

### F6 — No guard against `cookie-secure=false` in production (Low)

- **Location:** `backend/src/main/java/com/pliego/modules/identity/api/AuthSessionCookie.java:19`
  (default `true`)
- **Evidence:** the live browser run required `false` (real browsers ignore `Secure` cookies
  over HTTP — expected, documented in ADR-0010).
- **Impact:** a prod misconfiguration would send refresh credentials over plaintext; the
  default is safe, so this is purely a config-footgun risk.
- **Fix:** deployment checklist item (optionally a startup log warning when `false`).

### F7 — Test fake diverges from the DB retry contract (Low)

- **Location:** `backend/src/test/java/com/pliego/modules/identity/api/AuthApiIntegrationTest.java:527`
- **Evidence:** `FakeIdentityGateway.refreshSession` accepts any previous-digest retry without
  enforcing the exact-replacement-digest match that `fn_auth_session_refresh` requires
  (`token = replacement` conjunct, V027 L43).
- **Impact:** the MockMvc retry test is weaker than production; the real gate is verified
  only by throwaway probes + `auth_session_http_gate.py`.
- **Fix:** make the fake require the replacement match.

### F8 — `UserSessionData.toString` redaction is untested (Low)

- **Location:** `backend/src/main/java/com/pliego/modules/identity/gateway/UserSessionData.java:9`
  vs `backend/src/test/java/com/pliego/foundation/security/SensitiveDataToStringTest.java`
- **Evidence:** the test covers six sibling types, not this one (the implementation itself is
  correctly redacted).
- **Fix:** add it to the diagnostics array.

Out-of-scope observations (pre-existing, not from `4906270`, no action required for this
decision): no login rate-limiting; SpringDoc `/v3/api-docs` + Swagger UI enabled and
`permitAll` (flagged by Spring warnings in every boot log).

## 1. Confirmed design strengths

- **Entropy and storage:** 256-bit `SecureRandom` refresh credentials; DB holds only SHA-256
  hex digests (verified live); deterministic purpose-separated HMAC rotation for the 5-minute
  lost-response window.
- **Rotation atomicity:** single-statement `UPDATE … WHERE current` + row lock; 10 concurrent
  refreshes converged to one replacement, one row, unchanged absolute expiry — no
  double-mint, no second session.
- **Revocation:** logout kills current *and* previous digests (V028), idempotent;
  revoked/expired/`BLOCKED`/role-changed sessions all return identical `204` + cleared
  cookie; identity and role are re-read from PostgreSQL on every rotation, never from stale
  client state.
- **Cookie/CORS/CSRF:** host-only `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`;
  clear uses identical attributes + `Max-Age=0`; exact-origin credentialed CORS with safe
  empty default; `X-PLIEGO-SESSION-REQUEST: 1` marker blocks cross-site form posts.
- **JWT:** HS256 pinned, ≥32-byte secret floor, `iss`/`aud`/zero-skew/`sub`/`role`/`jti`/
  exact-1800s validation; tampered/wrong-issuer tokens rejected.
- **Frontend:** memory-only JWT, zero `localStorage`/`sessionStorage` use (grep-clean and
  asserted live), `restoring` gate with no Guest flash, single-flight + cross-tab Web Locks,
  `BroadcastChannel` logout propagation, proactive/visibility/online refresh, allowlisted
  return-intent (live `?from=/account` round-trip passed).
- **30-day absolute lifetime** enforced in DB and never touched by rotation — verified
  invariant across chained rotations.

## 2. Vulnerabilities / correctness defects

None Critical or High. F5 and F6 are Low hardening/config items; the delivery-blocking
items (F1–F3) are CI/docs, not runtime defects. Deliberate, documented tradeoffs accepted:
≤30-minute stateless JWT survival after logout (ADR-0010), per-session (not per-user)
logout, 5-minute retry bound after which a lost response means re-login.

## 3. Migration / DB concerns

V026–V028 are forward-only, respect the approved-baseline rule, and the live routines are
faithful to the files. Lookup/revocation predicates use the two unique digest indexes
(measured BitmapOr plan). Concerns are F4 (cleanup scan) and the absence of a covering
index for the FK cascade to revoked rows — both negligible at expected scale. No background
jobs, polling, or new infrastructure introduced.

## 4. VPS / operational concerns

Suitable for the 2 vCPU / 3.8 GiB PostgreSQL 18 target: single-row indexed auth queries,
short Spring-managed transactions, stateless app, table growth bounded to ~60 days of login
rows with login-triggered cleanup. Deployment must keep: HTTPS +
`PLIEGO_AUTH_COOKIE_SECURE=true`, exact `PLIEGO_CORS_ALLOWED_ORIGINS`, and a **same-site**
frontend/API topology (`SameSite=Strict` breaks cross-site deployments — no Nginx/Cloudflare
config exists in-repo to verify, so this is a checklist item). Audit-environment note:
`scripts/local-db.sh start` could not create its socket dir in this sandbox and port 55432
is held by a `/tmp/pliego-pgdata` instance predating the audit run; that process was left
untouched and verification ran against it.

## 5. Tests missing or insufficient

Committed suites are green except F1, but these verified behaviors have no committed
regression test: concurrent-refresh convergence, grandparent-after-two-rotations rejection,
`BLOCKED`/role-change-during-session refresh, malformed-cookie matrix; and the live
browser spec runs only with manual env (`PLIEGO_E2E_LIVE=1` + HTTP backend +
`cookie-secure=false`). F2 (auth gate not in CI) and F7/F8 compound this. Recommend
promoting the concurrency/retry/downgrade probes into committed tests.

## 6. Final acceptance decision

**ACCEPT WITH FIXES.** Required before sign-off: fix the `52→54` assertion (F1), update
`run_ci_gates.sh` to `28:28` and wire in `auth_session_http_gate.py` (F2), and correct the
two stale doc lines (F3). F4–F8 and §5 are backlog-grade and do not block acceptance.

---
*Audit artifacts: throwaway probes at `/tmp/pliego_audit_probes.py`, backend logs at
`/tmp/pliego-audit-backend*.log`. Audit backends were stopped; no code was modified;
nothing was committed, pushed, or deployed.*
