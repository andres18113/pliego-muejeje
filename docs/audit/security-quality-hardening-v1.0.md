# PLIEGO v1 — Security & Quality Hardening (I14)

Date: 2026-09-23. Reviewer: Codex. Source of truth: approved root baselines,
`pliego-flyway-v1.0.zip`, the current implementation, I12/I13 full-system audit,
repository instructions, migrations, tests, and CI.

## Decision

**I14_HARDENING_PASS_WITH_LOW_RISK_FINDINGS**

No approved business behavior changed. V001–V021 are preserved; I14 adds no
database migration, endpoint, entity, state, authentication mechanism, or
business rule.

## Defects fixed

1. **PAN in diagnostic representation.** `CheckoutRequest` is a Java record;
   its generated `toString()` included `cardNumber`. It now redacts the card
   number, its OpenAPI field is write-only, and a regression test verifies the
   PAN is absent. Existing HTTP tests also verify the PAN is absent from the
   response and captured application output.
2. **Authentication diagnostics exposed identity data.** Authentication
   request/result/auth-data `toString()` methods now redact the submitted
   email, names, phone, user ID, password/hash, and JWT. A regression test
   covers registration, login, login results/responses, and gateway auth data.
3. **Database concurrency coverage omitted duplicate registration.** Added a
   two-session PostgreSQL race proving one registration commits, the competing
   registration waits and receives `P1101`, and only one user/customer pair
   persists.
4. **CI omitted PostgreSQL 18.** CI now provisions PostgreSQL 18 natively from
   the official PGDG repository, verifies the repository signing-key
   fingerprint, creates a disposable database with runtime-generated masked
   credentials, then starts the built jar and runs the live SQL, concurrency,
   HTTP, and Flyway gates. No Docker dependency was added. The runner also
   bypasses inherited HTTP proxies for loopback tests.
5. **CI action references were stale.** Replaced deprecated major-version
   references with full-SHA pins for `actions/checkout` v7.0.1 and
   `actions/setup-java` v6.0.1. Added weekly Dependabot updates for Maven and
   GitHub Actions. The action maintainers mark setup-java v1–v4 deprecated;
   the pinned releases are documented at [checkout v7.0.1](https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1)
   and [setup-java v6.0.1](https://github.com/actions/setup-java/commit/de7274f081f381c8f8158605e0321c36c376e2e6).

## Security and quality review

- **Credentials and sensitive payment data:** registration hashes passwords
  with BCrypt cost 12; login uses a dummy hash for unknown users; password
  length/UTF-8 limits are validated. JWTs are never included in diagnostic
  strings. CARD values are Luhn-validated in the controller and are not passed
  to an application service, JDBC gateway, or database routine. No PAN field
  exists in the payment table. Captured-output HTTP assertions remain green.
- **JWT and role enforcement:** HS256 is fixed; the configured key must contain
  at least 32 UTF-8 bytes. Decoder validation requires issuer, exact audience,
  positive numeric subject, approved role, UUID `jti`, valid `iat`/`exp`, and
  the 1,800-second lifetime. HTTP route rules distinguish ADMIN and CUSTOMER;
  PostgreSQL routines also check the current actor and state. Tests cover
  missing, malformed, expired, wrong-signature, wrong-algorithm, issuer and
  audience tokens, plus cross-role access.
- **Errors and ownership:** gateway translation uses SQLSTATE only; unknown
  states map to the generic internal error. Human-facing feedback remains
  Spanish and server stack traces/messages remain disabled in HTTP errors.
  Cross-account order/address/customer access returns the approved safe 404.
- **Validation and OpenAPI:** request validation and error mapping tests pass;
  unknown JSON properties are rejected. OpenAPI coverage still asserts all 50
  endpoint summaries, all 10 tags, and the public/secured controller split.
  The PAN field is marked write-only without changing request handling.
- **Transactions and SQL:** services own transaction boundaries and each
  command calls its approved database routine. Static scan found no business
  table SQL in Java. JDBC calls use prepared statements. Existing row locks and
  constraints are exercised by checkout last-unit, double-cancel,
  address-primary, and admin transition/cancel races; I14 adds the registration
  uniqueness race.
- **Logging and configuration:** no application request-body logger was found.
  Trace IDs are server-generated. Runtime database/JWT/admin-seed values are
  environment-backed. The credential-pattern scan found only deterministic
  test fixtures and the CI SQL variable for a generated disposable password;
  no private key or non-example local environment file is present.
  `server.error.include-message` and `include-stacktrace` are both `never`.

## Dependency and configuration findings

- Maven dependency tree resolves the intended Spring MVC, validation,
  security/resource-server, JDBC, Flyway/PostgreSQL, PostgreSQL JDBC, OpenAPI,
  and test components. It contains no JPA/Hibernate ORM, Docker, or
  Testcontainers dependency. `hibernate-validator` is Bean Validation, not an
  ORM dependency. No application library version was changed in I14.
- Spring Boot 4.1.1 manages the Spring dependency set; springdoc is explicitly
  versioned at 3.1.1 and the PostgreSQL driver is runtime-scoped. The official
  [PostgreSQL Ubuntu install guidance](https://www.postgresql.org/download/linux/ubuntu/)
  is used for the native CI package source; CI verifies PGDG key fingerprint
  `B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8` before trusting it.
- `ci.yml` parses as YAML; every embedded shell block and the gate runner pass
  `bash -n`. All PostgreSQL gate Python files pass `py_compile`. GitHub-hosted
  execution itself was not triggered from this workspace; the same CI runner
  completed locally against PostgreSQL 18.6.

## Verification evidence

- **Maven:** `mvn -B -Dmaven.repo.local=/tmp/pliego-m2 clean verify` — BUILD
  SUCCESS; 106 tests, 0 failures, 0 errors, 0 skipped; Java 25.0.4.1.
- **Live PostgreSQL:** server version `180006` (PostgreSQL 18.6). `run_ci_gates.sh`
  passed 3 SQL suites, 5 concurrency suites, and 5 HTTP suites. The approved
  `/tmp/pliego-dbtests/T001__smoke_schema.sql` through `T008__admin_orders.sql`
  also passed 8/8.
- **Flyway:** 21/21 successful versioned migrations through V021; application
  startup with `validate-on-migrate=true` passed on initial migration and
  revalidation. Independent archive comparison confirmed V001–V019 are
  byte-identical to the approved zip (19/19). Existing additive V020/V021 were
  left untouched.
- **Dependencies/static inspection:** dependency tree saved at
  `/tmp/pliego-dependency-tree.txt`; unwanted ORM/Docker/Testcontainers scans
  returned no matches; Java scan found no direct access to approved business
  tables. `git diff --check` passed.

## Accepted low-risk residuals

1. No login rate limiter or token revocation mechanism was added; the approved
   stateless 30-minute JWT contract remains. Database actor checks enforce
   current role/state on business calls, but tokens expire rather than being
   centrally revoked.
2. Dependabot weekly update PRs are enabled, but CI does not yet run a
   dependency vulnerability scanner or block builds on advisory results.
3. Some field-level OpenAPI descriptions outside sensitive/authentication
   fields remain sparse; operation coverage and security annotations are
   complete. Concurrent cart-add versus checkout and inventory-adjust versus
   checkout were reviewed against shared row locks but not added as separate
   duels; broad load/fuzz testing remains for release validation.
4. The GitHub-hosted workflow has not yet run remotely. The local end-to-end
   runner passed; the first hosted run should confirm PGDG availability on the
   selected Ubuntu image.

These are release-readiness follow-ups, not evidence of an implementation
failure. No database correction was required, so no V022 migration was added.
