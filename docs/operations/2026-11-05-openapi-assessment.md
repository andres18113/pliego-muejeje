# Public OpenAPI assessment and candidate — 2026-11-05

Status: **local, uncommitted candidate; production unchanged**. Evidence root:
`<evidence> = .release-evidence/2026-11-05-next/ws4/`. The previous audit,
ADR 0059 and its evidence were read only. No production requests, Cloudflare
API calls, provider credentials, Docker, commit, push or deployment were used.

## Decision and risk

Recommend disabling springdoc API documentation and Swagger UI in the application
default, with an explicit `contract` profile for development, CI and static export.
The accepted audit measured anonymous production disclosure of **104 paths, 41
administrative paths**; this work did not recheck production. Disclosure makes
route discovery, input/schema enumeration and capability reconnaissance easier.
It does not establish authentication bypass, privilege escalation or leakage of
stored customer/invoice data. Severity: **Low–Medium information exposure**;
priority: complete in the next reviewed backend release, after the backup priority.

| Option | Benefit | Cost / remaining risk | Decision |
| --- | --- | --- | --- |
| Keep public | Anonymous developer reference; no pipeline changes | Full administrative surface remains indexed/discoverable; unnecessary for deployed frontend | Reject unless owner explicitly intends a public API reference |
| Disabled by default; explicit development/CI profile | Removes runtime document and UI routes; existing security policy untouched | Local/CI callers must opt in; an accidental production profile/property override can re-enable docs | **Recommended candidate** |
| Require ADMIN | Staff can browse running production schema | Requires changing security rules; Swagger browser authentication needs a supported admin session; document still exists | Unnecessary operational surface here |
| Restrict at Nginx / Cloudflare | Edge ACL or private-network control | Origin/backend exposure remains possible unless every path is covered; extra rules, ownership and drift | Possible additional boundary, no infrastructure change proposed |

Use of `springdoc.api-docs.enabled=false` and
`springdoc.swagger-ui.enabled=false` follows the [springdoc feature reference](https://springdoc.org/features.html)
and [Swagger UI property reference](https://springdoc.org/ui-properties.html).
These properties disable registration of documentation routes; the existing
`permitAll` matchers do not create those routes. No security-rule change is required.

## Actual consumers and generation provenance

`<evidence>/consumer-inventory.log` records the repository-wide search, excluding
Git internals, node_modules, generated JSON/types, build output and prior evidence.
Source inspection distinguishes actual execution from prose references:

| Consumer | Actual behavior / environment | Candidate compatibility |
| --- | --- | --- |
| Frontend runtime (`frontend/src/shared/api/client.ts`, `catalog.ts`, other API wrappers) | Uses `openapi-fetch` and type-only imports from `generated.ts`; sends business API requests; no runtime fetch of docs/UI found | Unaffected |
| Frontend build (`frontend/package.json`) | `build` runs typecheck + Vite. `api:types` separately runs `openapi-typescript openapi/openapi.json -o src/shared/api/generated.ts`; no curl/live schema download or prebuild generation | Unaffected; regenerate from local profile when intentionally updating contract |
| Frontend test `src/shared/api/catalog.test.ts` | Imports static `frontend/openapi/openapi.json` for contract assertions | Unaffected |
| CI frontend job | Installs, audits, builds, runs Vitest/Playwright against checked-in sources; does not regenerate static contract | Unaffected |
| Java contract tests | `BillingIdentityApiIntegrationTest`, `CustomerApiIntegrationTest`, `CatalogApiIntegrationTest`, `CartApiIntegrationTest`, `CustomerOrderApiIntegrationTest`, `AdminPickupApiIntegrationTest`, `AuthApiIntegrationTest` call `/v3/api-docs` using local Spring MockMvc | Test-only `application.properties` includes `contract` |
| CI live gate entrypoints | `backend/src/test/postgres18/run_ci_gates.sh`, `run_runtime_privileges_ci_gate.sh`, `run_live_browser_gates.sh` probe docs on disposable loopback backend processes | Live CI step includes `contract`; child processes inherit it |
| Local developer stack | `scripts/dev.sh` readiness checks docs and PLIEGO API title; starts `scripts/start-backend.sh` | Local startup script appends `contract` to profile includes, retaining existing includes/active profiles |
| Operational reset rehearsal (`scripts/ops/rehearse-reset.py`) | Starts a disposable local backend and probes docs for readiness | Manual invocation now needs explicit profile include |
| Local SSE capacity tool (`scripts/load/sse_capacity.py`) | Starts a local backend and probes docs for readiness | Manual invocation now needs explicit profile include |
| Optional frontend registration E2E (`frontend/tests/e2e/registration-return.spec.ts`) | Probes fixture backend `127.0.0.1:18088/v3/api-docs`; fixture must already run | Inherits live CI include; manual fixture startup must opt in |
| k6 (`perf/k6`) | Contract reference is static; measured journeys do not fetch docs/UI | Unaffected |
| Swagger UI | No executable application/build/test/ops consumer of UI found; manual developer documentation only | Available in `contract` profile |

The PostgreSQL HTTP/schema/upgrade scripts also fetch live **local** docs. Complete
matched list under `backend/src/test/postgres18/`:

- Schema assertions: `numeric_validation_http_gate.py`, `library_checkout_http_gate.py`,
  `post_purchase_digital_access_http_gate.py`, `cart_saved_for_later_http_gate.py`,
  `digital_single_copy_http_gate.py`, `digital_editions_http_gate.py`.
- Fixture readiness: `pending_email_change_http_gate.py`, `mail_deliverability_http_gate.py`,
  `registration_return_http_gate.py`, `password_profile_http_gate.py`,
  `transactional_email_http_gate.py`.
- Historical upgrade readiness: `ecuador_tax_upgrade_gate.py`, `monetary_upgrade_gate.py`,
  `geo_upgrade_gate.py`, `billing_identity_upgrade_gate.py`,
  `automatic_billing_upgrade_gate.py`.

Additional consumers use the same readiness helpers indirectly:
`order_reference_upgrade_gate.py` imports `billing_identity_upgrade_gate.start`,
and `ecuador_contact_upgrade_gate.py` imports `ecuador_tax_upgrade_gate.start`.
Their standalone CI steps also include the profile. Local/historical runners
`home_delivery_upgrade_gate.py`, `pickup_timing_upgrade_gate.py`,
`digital_single_copy_upgrade_gate.py`, `digital_ownership_upgrade_gate.py`,
`transactional_email_lifecycle_upgrade_gate.py` import `monetary_upgrade_gate.start`;
`mail_deliverability_upgrade_gate.py` and `release_pending_upgrade_gate.py` import
`billing_identity_upgrade_gate.start`. Their documented manual invocation must
also include `contract`; those invoked by `run_ci_gates.sh` inherit its include.

These scripts inherit `os.environ` when starting child backends. CI includes the
profile in the live SQL/HTTP/browser step and the eight standalone historical/email
steps that fetch docs; ordinary Maven tests include
it through test resources. External/manual invocations of any of the above must
add `SPRING_PROFILES_INCLUDE=contract` (append to existing includes if present).
No claim is made that undocumented third-party consumers do not exist: owner
confirmation remains part of release review.

The checked-in contract contains a generated server URL of
`http://127.0.0.1:18081`, **104 paths and 41 administrative paths**. Existing test
reports (`docs/testing/2026-11-01-registration-continuation.md` and
`2026-11-04-offer-expiration.md`) explicitly describe exporting a running local
backend and then running `npm run api:types`. Together with source inspection,
this supports local runtime generation, not dependency on public production.
There is no checked-in automatic refresh pipeline for the JSON snapshot; export
is an intentional developer/release operation. This candidate exported the real
controllers again over loopback HTTP in an integration test; its generated URL
contains the test's ephemeral local port. It did not replace the approved static
frontend contract or generated types.

## Candidate implementation

- `backend/src/main/resources/application.yml`: both springdoc switches false.
- `backend/src/main/resources/application-contract.yml`: both switches true.
  The profile does not enable monitoring or change JVM, Tomcat, JDBC or Hikari.
- `backend/src/test/resources/application.properties`: include `contract` for
  existing schema tests, preserving background-worker settings.
- `scripts/start-backend.sh`: local development entrypoint appends `contract`
  to `SPRING_PROFILES_INCLUDE`, preserving caller active profiles and arguments.
- `.github/workflows/ci.yml`: the existing live SQL/HTTP/browser step and
  eight standalone historical/email gate steps set `SPRING_PROFILES_INCLUDE: contract`. It does not replace active profiles or
  enable the profile in deployment.
- Three dedicated test sources under
  `backend/src/test/java/com/pliego/foundation/openapi/` provide HTTP support,
  default-denial tests and profile/export tests.

The production-default test explicitly loads shipped `application.yml`, excluding
test-only `application.properties`. An initial attempt to set a blank profile
include did not isolate it: Spring includes are additive across config documents.
The failed attempt is retained in `<evidence>/green-openapi.log`; the corrected
run is `<evidence>/green-openapi-isolated-config.log`. This is a test isolation
correction, not a production fallback or a hidden passing assertion.

For a local export, start the candidate against a disposable/local configured DB:

```bash
SPRING_PROFILES_INCLUDE=contract java -jar /path/to/candidate.jar --server.address=127.0.0.1 --server.port=18084
# In another shell, export locally and regenerate only when updating the contract:
curl --noproxy '*' --fail --silent --show-error http://127.0.0.1:18084/v3/api-docs -o frontend/openapi/openapi.json
(cd frontend && npm run api:types)
```

These are instructions, not executed production commands. This work's export and
TypeScript outputs are confined to evidence. Existing includes must be appended
instead of overwritten when invoking the first command in a configured session.

## Verification and exact evidence

All exact commands, timestamps and process exit statuses are in
`<evidence>/commands.jsonl`; verbose output stays in the referenced log files.
Maven used a copied writable dependency cache and copied backend source tree under
`<evidence>`, leaving prior audit evidence and shared `backend/target` untouched.
Tests ran on the host's Ubuntu OpenJDK **25.0.4.1**, normal JIT, with no JVM flags,
Tomcat thread/pool changes or database required. This is not a production JDK
parity/soak test. HTTP uses loopback random ports with real Tomcat/Spring/security;
only the catalog gateway/transaction manager are mocked to avoid DB access.

| Check | Result and evidence |
| --- | --- |
| Red proof before candidate config | `red-default.log`, exit 1: 8 tests, 5 expected failures; docs returned 200 and UI redirect 302 |
| First green attempt | `green-openapi.log`, exit 1: 10 tests, 6 failures due to additive test profile inclusion; retained and corrected |
| Dedicated final HTTP tests | `green-openapi-isolated-config.log`, exit 0: **10 tests, zero failures/errors/skips** |
| Default documentation paths | 404 for `/v3/api-docs`, `/v3/api-docs/swagger-config`, `/swagger-ui.html`, `/swagger-ui/index.html`, `/swagger-ui/swagger-initializer.js` |
| Explicit contract profile | Docs and UI/config return 200; live JSON has catalog/admin paths and schemas; raw export `openapi-contract.json` |
| Public catalog and Spanish auth | Default catalog categories returns 200 with mocked DB result; `/api/v1/me` remains 401 with `AUTH_REQUIRED`, `Autenticación requerida`, and original Spanish detail |
| Monitoring | Default test asserts `management.server.port=-1` and no local management port |
| Local developer activation | `dev-entrypoint.log`, exit 0: stub Maven verifies default profile include, preservation of existing `observability` include/`local` active profile, arguments; `bash -n` succeeds |
| CI profile wiring | `ci-profiles.log`, exit 0: YAML parsed; all nine live/direct/transitive docs consumer steps include `contract`, active profiles untouched; Java default-denial step remains free of global include |
| Type generation | `generate-types.log`, exit 0: installed repository `openapi-typescript` generates `generated.ts` from exported HTTP contract using the same CLI as `api:types` |
| Generated TypeScript | `generated-types-typecheck.log`, exit 0: installed `tsc --noEmit --strict --skipLibCheck --target ES2022 --moduleResolution Bundler --module ESNext` on evidence output |
| Complete Maven regression | `full-backend-tests.log`, exit 0: **795 total, 756 executed, 39 skipped, zero failures/errors**, 1 min 39 s; optional DB/live tests remained opt-in |
| Preservation | `preservation-final.log`, `verification-summary.json`; SHA-256 verifies security configuration, original dirty pom, frontend contract/types unchanged; diff retained in `candidate.patch` |

## Release approval, rollback and limits

This is an uncommitted candidate, not authorization to deploy. Owner approval is
needed for the policy choice to remove anonymous production docs, acceptance of
any external consumer impact and the normal pinned-artifact backend release
through `docs/deployment/production-runbook.md`. Before activation verify that
production has no `contract` profile or `SPRINGDOC_*_ENABLED=true` overrides.
After an authorized deployment, independently verify anonymous docs/UI 404/401
through the public proxy, catalog/auth behavior and production profile values.
No live result is claimed here. No Nginx/Cloudflare change is required.

Rollback is application/configuration-only; no migration or data rollback. Prefer
restoring the recorded compatible backend artifact under the production runbook.
An emergency reviewed configuration override can restore the two springdoc flags,
with a backend restart and the accepted disclosure risk; do not activate unrelated
development profiles in production.

Not executed: full PostgreSQL historical/SQL/browser gate matrix or dev stack
startup against a real DB (outside this schema-exposure change); tests exercise
real HTTP profile behavior and existing Java schema regressions instead. No
production tests, auth bypass probing, external client telemetry, infrastructure
rules or production migration were attempted. No native crash occurred in these runs. Existing context tests emitted database/worker
warning logs while using fake or unavailable datasources; the test results remained
zero failures/errors. These warnings are retained in the full log.

The raw exported contract SHA-256 is
`e91c8dd5cbefb0dbb76b49a2efcf2e1635168798f91b3ba16c765fde37f2ac39`.
Its path set and schema components exactly equal the checked-in static contract;
the generated TypeScript is **byte-identical** to the existing frontend types:
`c4e88b67c61a8ebbb0b65246ee4dff7da135aae13b3a22870bf43fd18be32d41`.
The JSON contains the test server URL; byte-for-byte JSON equality is not claimed.
