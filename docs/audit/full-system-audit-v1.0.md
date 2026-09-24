# PLIEGO v1 — Full-System Integration & Contract Audit (I12 + I13)

Date: 2026-09-23. Auditor: automated I12/I13 gate (multi-agent sweep + independent
parent verification). Source of truth: approved root baselines,
`pliego-flyway-v1.0.zip`, worktree source, migrations, tests, OpenAPI, Git history.

## 1. Gate decision

**I12_I13_GATE_PASS_WITH_LOW_RISK_FINDINGS**

The implementation faithfully materializes the approved design after one
P0 database correction (V021, additive, body-only). All builds, suites, and
live PostgreSQL 18 gates are green. Remaining findings are low-risk
follow-ups (see §7); no new business requirements were invented and no
contract ambiguity was silently resolved.

## 2. Method

- 5-slice parallel audit (baselines/Flyway, coverage matrix,
  architecture/transactions, security/errors/CARD, E2E/concurrency readiness)
  with adversarial critic + gap follow-up + synthesis.
- Parent independently re-verified every material claim: byte comparisons,
  counts, static scans, fresh builds, and live gates on disposable
  PostgreSQL 18.6 databases (TCP 127.0.0.1:5544, no H2, no Docker).
- Live HTTP gates ran against the real Spring Boot jar with Flyway as the
  migration path (validating checksums through the production path).

## 3. Coverage (verified by auditor)

| Dimension | Contract | Implementation | Verdict |
|---|---|---|---|
| Use cases | 24 (`use-case-baseline-v1.0.md`) | 24/24 traced (REST §47) | match |
| REST endpoints | 50 (`rest-api-contract-v1.0.md:2078`) | 50 `@Mapping`, 10 controllers | match |
| DB public routines | 49 (DB contract §§14–20) | 49 distinct (18 `fn_` + 31 `sp_`) | match |
| Java DB ops | 50 (sp_order_cancel ×2) | 50 gateway calls | match |
| `@Transactional` | services only, 1 routine/tx | 50, services only, readOnly⇔fn_* | match |
| DB objects (live) | 19 tables / 31 procs / 35 funcs / 18 triggers / 0 views | 19 / 31 / 35 / 18 / 0 | match |
| Migrations | V001–V019 authoritative | V001–V019 byte-identical to zip; V020+V021 additive | match |
| Live OpenAPI | 3.1.2, bearerJwt | 3.1.2, 50/50 operations summarized | match |

Supporting evidence: `FROM pliego.` scan in Java returns only `fn_*` reads
(no direct table access); zero cross-module imports (only foundation importing
two module exception types, its sanctioned role); no JPA/Hibernate/Docker
artefacts; `SET CONSTRAINTS`/`DEFERRABLE` single-occurrence analysis in §5.

## 4. Verification results (all green, this session)

- `mvn verify`: **104 tests, 0 failures/errors/skips** (13 classes), jar rebuilt.
- Approved baseline tests **T001–T007**: 7/7 pass on a fresh PG18 DB.
- SQL E2E gates: `checkout`, `customer_orders`, `admin_orders` — 3/3 pass.
- Concurrency duels (two-psql races): last-unit (loser P3002, stock 0, no
  negatives), double-cancel (loser P5003, single restoration), admin
  transition-vs-cancel (losers conflict), **new** address-primary race
  (V020 serialized, exactly one primary, idempotent) — 4/4 pass.
- Flyway through the real app: **V001–V021, 21/21 success**, validate-on-migrate.
- Live HTTP: admin BCrypt login, CARD/APPROVED/REJECTED checkout, customer +
  admin order flows, admin customers block/reactivate, and the **new**
  `full_journey_http_gate.py` (register→login→profile→addresses→catalog→
  inventory→cart→checkout→snapshots→transitions→ownership→Spanish errors) —
  5/5 pass.
- Transactionality/snapshots: invalid CARD persists nothing; order/address
  snapshots immutable across later catalog edits and state transitions;
  REJECTED leaves stock and SALE movements untouched; append-only triggers
  intact (T006).
- CARD/Luhn: 12–19-digit Luhn gate in `CardNumberValidator`; PAN never leaves
  the controller (gateway/routine signatures take no card data; `pago` has no
  PAN column); invalid numbers fail before any DB call; PAN absent from
  bodies/logs in all HTTP gates.
- Security/ownership/non-disclosure: stateless JWT HS256 (≥32 B, iss/aud/sub/
  role/jti/exp-iat=1800 validated), BCrypt-12 with dummy-hash login,
  actor-from-JWT only, fail-on-unknown-properties, cross-account safe 404s
  (P5001/P1102), SQLSTATE-only translation, unknown→INTERNAL, Spanish
  ProblemDetail + `X-Trace-Id` + `application/problem+json` asserted live.

## 5. Defects found and fixed (in scope)

1. **P0 — `sp_book_update` failed every call (SQLSTATE 42704).**
   Cause: unqualified `SET CONSTRAINTS uq_libro_autor_orden DEFERRED` cannot
   resolve a `pliego`-schema constraint while `search_path` excludes it.
   Observed as HTTP 500 (Spanish, non-disclosing — the correct surface for an
   unexpected error) and reproduced at SQL level. Fix: additive
   `V021__fix_book_update_deferred_constraint.sql` replacing only that
   statement with `SET CONSTRAINTS ALL DEFERRED` (the schema's sole
   `DEFERRABLE` constraint, so semantics are unchanged) + `docs/adr/0005`.
   Verified: direct CALL incl. multi-author reorder succeeds; duplicate order
   still rejected with P2034; journey gate passes. No contract surface changed.
2. **M1 — stale `OpenApiConfiguration` description** (auth/profile/addresses
   only) → extended to all six modules, in Spanish.
3. **M2 — 9/20 `AdminCatalogController` endpoints lacked `@Operation`** →
   added summaries matching file conventions (`Reemplazar…` /
   `Cambiar el estado de…`); locked by new `OpenApiCoverageTest`
   (50/50 operations, 10/10 tags, public-vs-secured split).
4. **Two English `@Schema` descriptions** (`RegisterRequest`, `ProblemResponse`)
   → translated to Spanish. All validation messages scanned: Spanish only.
5. **Coverage gaps closed with committed tests**: `address_primary_concurrency.py`
   (V020 race proof) and `full_journey_http_gate.py` (cross-slice journey incl.
   V020-live, snapshots, ownership, Spanish errors).

Corrections to prior counting: the JUnit suite is **104 tests** (was 101
before `OpenApiCoverageTest`), not 109; raw worktree `CREATE PROCEDURE` lines
are 32 only because V012+V020 share one routine name (31 distinct objects).

## 6. Contract drift and ambiguity

- **No drift**: Java calls exactly the 49 approved public routines; error codes
  and SQLSTATE mappings stable; V020/V021 are body-only corrections that keep
  signatures, actor checks, locks, and P-codes.
- **No genuine ambiguity encountered.** Two probe expectations were corrected
  from authoritative sources during gate authoring (`AUTH_INVALID_CREDENTIALS`,
  `MALFORMED_JSON` for unknown properties) — the implementation was faithful
  in both cases.

## 7. Low-risk findings and follow-ups (not fixed in this gate)

- **CI runs `mvn verify` only** — no PostgreSQL service, so the 19 live-DB
  checks run nowhere in CI. Recommend a PG18 CI job (I14 or release hardening).
- **Field-level `@Schema` is sparse** outside identity/customer DTOs
  (cart/catalog/inventory/sales records). Cosmetic — schemas still generate;
  descriptions would be subjective, so left untouched.
- **I1–I11 work is partly uncommitted** (2 commits + large uncommitted delta,
  including pre-existing `postgres18/` gates). Recommend committing before I14;
  this gate changed only: 4 doc-consistency files, V021, ADR-0005,
  `OpenApiCoverageTest`, 2 new gate scripts.
- **Concurrency model** relies on row locks + unique constraints (no
  SERIALIZABLE/advisory locks), per approved design; 4 duel tests verify the
  critical races. Untested races (register-email → P1101 backstop, cart-add
  TOCTOU settled at checkout, adjust-vs-checkout serialization, P5007 on
  random SIM refs) are assessed low-risk by code inspection.
- Sandbox proxy env (`http_proxy` + empty `no_proxy`) hijacks localhost HTTP
  clients; gates must bypass it. Environment-only, not a product defect.

## 8. Artefacts

- New migration: `backend/src/main/resources/db/migration/V021__fix_book_update_deferred_constraint.sql`
- New ADR: `docs/adr/0005-book-update-deferred-constraint-correction.md`
- New tests: `OpenApiCoverageTest.java`, `address_primary_concurrency.py`,
  `full_journey_http_gate.py`
- This report: `docs/audit/full-system-audit-v1.0.md`
