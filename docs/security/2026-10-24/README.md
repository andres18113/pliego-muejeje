# Security audit and dependency update — October 24, 2026

Assessment cutoff: **2026-10-24**. This report covers published vendor advisories, CVE records, resolved dependencies, source exposure and executed checks. It does not claim knowledge of later October disclosures or unpublished vulnerabilities.

## Implemented changes

| Component | Previous | Updated / verified |
| --- | --- | --- |
| Java build/test runtime | Ubuntu OpenJDK 25.0.4.1 | Checksum-verified Temurin 25.0.5+8; `.java-version` and CI pin 25.0.5; trust-store check passes |
| Production Java | Temurin 25.0.4.1+1 | Native package 25.0.5.0.0+8-1; actual running JVM verified as 25.0.5+8 |
| Node.js build/test runtime | 24.21.0 | Checksum-verified 24.22.1; `.nvmrc`, package engines and CI updated |
| Spring Boot | 4.1.1 | 4.1.2, with compatible BOM updates |
| Spring Framework / Security | 7.0.9 / 7.1.1 | 7.0.10 / 7.1.2 |
| Tomcat / pgJDBC | 11.0.24 / 42.7.13 | 11.0.27 / 42.7.14 |
| Jackson 2 / 3 core and databind | 2.21.5 / 3.1.5 | 2.21.7 / 3.1.7 |
| Vite / Vitest | 8.3.1 / 5.0.2 | 8.3.5 / 5.0.5 |
| Zod / shadcn | 4.6.5 / 4.21.0 | 4.6.7 / 4.22.1; vulnerable Zod 3 subtree removed |
| Pillow cover tooling | 12.3.0 | 13.0.0; necessary security major, no published patched 12.x version |

React, Mantine, the modular monolith, Spring JDBC, database-owned business rules and the native deployment architecture remain in place. Maven 3.9.12 and PostgreSQL 18.6 were already suitable. No Docker configuration exists or was introduced. The development host's system-wide binaries were not replaced: verification explicitly selected the downloaded patched runtimes. CI/version-manager configuration now selects those versions.

Compatible Maven plugin upgrades and plugin-only dependency fixes reduce the inherited build graph's exposure. Both npm lockfiles were regenerated and clean-installed. No `npm audit fix --force`, vulnerability suppression, JPA addition, baseline edit or migration change was used.

The application review also fixed private profile drafts surviving logout, session expiry or account replacement. Same-customer draft recovery after navigation/reload remains supported, including independent customer/user IDs and React StrictMode. Regression tests cover invalid-session cleanup and late completion of an old account's save. The P2 browser fixture now models a real authenticated refresh rather than incorrectly returning 204 after login.

## Audit results and exposure

- **npm:** frontend 12 vulnerable package entries (7 high, 5 moderate), covering 25 unique advisories, reduced to **0**. Root remained **0**. Several findings concern development/test/MCP tooling; Zod also runs in browser validation. They do not imply a deployed Node server.
- **Maven OSV:** 317 baseline GAVs / 60 coordinate-advisory matches reduced to 260 GAVs / **4 indexed matches**, all dormant Maven Site Jetty dependencies. All **118 project dependencies including test scope** have zero indexed matches. The packaged application has 77 libraries and no Jetty.
- **Vendor cross-check:** pgJDBC and Tomcat advisories missed by OSV are covered by the selected versions. Jetty vendor advisories still affect its dormant site-preview graph; these are explicitly **not** counted as resolved. CVE-2025-11143 remains a vendor finding despite disappearing from the final OSV response.
- **Auxiliary Python:** full 36-package scanner environment has **0** known vulnerabilities after Pillow remediation and updating the temporary scanner's pip; CI also pins pip 26.2.2 before dependency installation. All 37 Pillow advisories were published by the cutoff. Eight representative image inputs preserve identical pixels, encoded WebP bytes and normalization reports.
- **Runtime CVEs:** every requested Node/Java CVE is assessed in the [applicability matrix](runtime-applicability.md). Node 26-only ZIP/permission defects and legacy Java Plugin/JavaFX issues are not reported as project exposure. Java 25 is outside the listed affected ranges for CVE-2026-91382 and CVE-2026-91395. The additional Java certificate alert CVE-2026-91403 was checked separately from the CPU version.

Complete source-linked findings: [npm](frontend-findings.md), [Maven](backend-findings.md), [application controls](application-findings.md), [Python](python-findings.md). [CVE record metadata](runtime-cve-records.tsv) contains 20 fetched published runtime records; [Maven advisory dispositions](maven-advisory-disposition.tsv) include severity and baseline coordinates. Full direct/transitive before/after inventories are the adjacent Maven CSV and root/frontend TSV files.

## Verification

Complete logs are retained privately under `/tmp/pliego-security/`. Test assertions were not disabled to obtain passing results. Historical failed runs are retained and distinguished from final checks.

| Check | Result / scope |
| --- | --- |
| Root/frontend `npm ci` and `npm audit` | Passed; both final audits report zero findings |
| Maven `clean verify`, Java 25.0.5+8 | Passed: 291 tests, zero failures/errors/skips; executable JAR packaged |
| Frozen security snapshot build/typecheck and full unit suite | Passed: 87 files, 1,015 tests; worker cap resolves local worker-start resource contention |
| Final shared working-tree frontend checks | Passed after Claude finished: production build/typecheck; 87 unit-test files, 1,015 tests |
| Complete final shared-tree Playwright suite | Passed: 328 tests, 87 opt-in skips, zero failures; all 415 registered cases completed in 16.4 minutes |
| Extended live purchase/session browser gate | Passed: five real local PostgreSQL-backed journeys, including reload/reopen/logout |
| Python complete suite / `pip check` / `pip-audit` | Passed: 132 tests; no broken requirements; zero known findings |
| Image-output compatibility | Eight fixture comparisons passed, including identical encoded bytes |
| Native PostgreSQL integration | Complete native gate passed: 75 migrations; SQL, concurrency, HTTP/auth and four purchase journeys; extended live gate also passed all five purchase/session journeys |
| Separate database privilege and upgrade gates | Privilege gate plus billing, billing identity, transactional email/provider stub, monetary, Ecuador tax/contact and home-delivery upgrades passed |
| GitHub Actions syntax and action references | Actionlint passed; full action SHAs checked against official release tags; YAML parsed |
| JVM certificate checks | Old local Ubuntu JVM fails; patched test JVM and patched production JVM pass |
| Production JVM and public smoke | Running JVM 25.0.5+8, service active, public frontend/catalog 200, anonymous profile 401; hashes/Flyway/privileges unchanged |

Browser investigations are documented in [cache isolation](browser-investigation.md) and [controlled five-test comparison](browser-five-findings.md). Initial failures included stale Vite optimizer caches, an invalid-session fixture and intermittent catalog focus behavior. Test servers now have separate caches. The invoice artifact concurrency test pauses the competing application scheduler only during its two-worker database claim race, then resumes it; later HTTP/browser gates retain real scheduler coverage. Failure artifacts are retained when a private gate log directory is configured.

The original-UI security snapshot is isolated from concurrent Claude UI changes. Earlier whole-suite results are retained: 323 passed / 87 opt-in skipped / 5 failed; the corrected remaining five subsequently passed, and both catalog focus cases passed ten repetitions. These runs are not represented as one wholly passing 415-test run. The final shared-tree acceptance run completed after Claude finished and the fixture was corrected: **328 passed, 87 opt-in skipped, zero failed**. It used one worker, matching CI runner concurrency, and an isolated Vite cache. Five opt-in purchase/session cases passed separately against native PostgreSQL; other opt-in scenarios requiring their individual fixtures are not claimed as executed. Catalog focus flakiness under earlier heavy concurrency remains documented; no source fix for that intermittent timing was asserted.

## Production change and remaining risks

The authorized production change was **JVM-only**. `jcmd` as the service user verified PID 28272 running Temurin 25.0.5+8. The certificate check passes under the service account, with no custom trust-store override in allowlisted properties. Flyway remains 73/73 with identical history fingerprint; all four ownership/CREATE checks remain false. Backend/frontend release pointers remain `20261021-a298dc4`. Credential, unit, Nginx, JAR and HTML hashes are unchanged. The original package was retained and rollback was exercised after a checker file-permission failure; the subsequent corrected update succeeded. Private evidence: `/opt/pliego/deployment/runtime-security-20261024/`. See the [deployment record and repeatable procedure](../../deployment/2026-10-24-runtime-security-update.md).

The patched application dependencies are **not yet deployed**. They require the existing pinned-CI application release procedure; this audit did not publish the uncommitted security/UI working tree. Therefore live application-library exposure remains until that release, even though the live JVM is patched. Production authentication, purchases, email delivery and private invoice downloads were not exercised; write-heavy tests used disposable local data and stubs.

Remaining application risks include registration admission/email abuse controls, the approved absence of login throttling, and access-token validity for up to 30 minutes after refresh-session revocation. No new confirmed SQL injection, XSS, SSRF, XXE or authorization bypass was identified in the inspected code. This review is not a penetration-test or host-wide certification. Dormant `mvn site:run` remains vulnerable and must not be exposed publicly.

## Files changed by this audit

- Runtime/dependency configuration: `.java-version`, `.nvmrc`, root/frontend `package.json` and `package-lock.json`, `backend/pom.xml`, `scripts/requirements-covers.txt`.
- CI and operating guidance: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `README.md`, `scripts/security/CheckCerts.java`, the runtime deployment addendum.
- Private-draft fix/tests: `frontend/src/app/session.tsx`, `session.test.tsx`, `frontend/src/features/account/profileDraft.ts`, `AccountAuthorityBoundary.test.tsx`, `frontend/tests/e2e/p2-audit.spec.ts`.
- Verification isolation: `frontend/vite.config.ts`, `backend/src/test/postgres18/run_ci_gates.sh`, `run_live_browser_gates.sh`.
- Reports/inventories: this directory and `docs/superpowers/plans/2026-10-24-security-update.md`.

Existing contributor/deployment edits and Claude's navigation/catalog/account/checkout UI implementation were preserved; they are not attributed to this audit. The initial audit did not execute hosted GitHub Actions; the user subsequently authorized committing/pushing the completed work to main and verifying its exact hosted CI run. The corresponding pre-push local results and hosted run are recorded in the release/CI follow-up.

## Push-to-main verification follow-up

The pre-commit Maven verification passed all 291 tests and Python passed all 132 tests again. A normal Node 24.22.1 frontend rerun hit a native SIGSEGV in a WSL Vitest worker (BackButton.test.tsx), with no JavaScript assertion failures in the completed tests. The existing production-runbook local V8 workaround also encountered native aborts, including an internal parser assertion. A JIT-less diagnostic could not start because Vite requires WebAssembly. Native execution outside the sandbox also aborted in one worker (86 files and 1,007 completed tests passed). The application source/config fingerprints still match the earlier complete 1,015-test and 328-browser acceptance runs. These fresh native-runtime errors are documented rather than presented as passing tests; the pushed revision is verified on GitHub's Linux runner. This does not change production runtime flags, test assertions, or the CI command. Full logs remain in `/tmp/pliego-security/push/`.
