# October 2026 security update implementation plan

> **For agentic workers:** Use the existing parallel audit assignments and verification-before-completion. Execute the authorized repository changes directly.

**Goal:** Patch exposed runtimes and dependencies, preserve application behavior, and document verified and unresolved exposure through October 24, 2026.

**Architecture:** Preserve Java 25, Spring JDBC, PostgreSQL 18, the modular monolith and static React frontend. Use compatible patch releases and isolated native PostgreSQL fixtures. Production access started read-only. The user subsequently authorized the JVM package upgrade and supplied interactive sudo authentication; the live JVM upgrade and verification completed.

**Tech stack:** Java 25, Maven, Spring Boot 4.1, Node.js 24, React 19, Vite 8, PostgreSQL 18.

**Spec:** User security audit request and explicit October 2026 Node.js/Java CVE lists in this session.

## Global constraints

- Preserve UI, UX, APIs, business behavior and all pre-existing user changes.
- Never edit approved baselines or extracted/applied migrations; never introduce Docker or JPA.
- Use official advisories and CVE records; distinguish installed versions, configured versions and live process verification.
- Never expose or change production credentials; use synthetic disposable test identities.
- Write documentation, reports and new comments in English. Do not commit or publish without authorization.
- Keep full logs private on disk; inspect only summaries and relevant failures.

## Review focus

- Login/logout/session identity changes must clear private client data while preserving drafts during same-user navigation.
- XML billing and outbound HTTPS require both parser hardening and a patched JVM/trust store.
- Static frontend delivery does not imply a production Node.js server.
- Database fixtures must never target production or an existing development database.
- A clean vulnerability database scan does not replace vendor advisories or prove a deployed runtime was patched.

## Tasks

- [x] Inventory local and deployed runtimes, direct/transitive packages, build plugins and CI. Preserve baseline logs under `/tmp/pliego-security`.
- [x] Patch vulnerable npm packages and locks within compatible lines; require Node 24.22.1. Run clean installs, audits, build and unit tests.
- [x] Patch Spring Boot and affected build-plugin dependencies; inventory and scan the resolved graph. Run Maven verify under patched Java 25.
- [x] Pin CI/runtime versions, add reproducible certificate verification, and extend dependency update coverage. Verify the actual deployment separately.
- [x] Fix confirmed private profile draft retention with a failing regression test and minimal session-boundary cleanup.
- [x] Run full browser, SQL, concurrency, HTTP, privilege and upgrade gates against a fresh disposable PostgreSQL 18 cluster. Investigate every failure.
- [x] Write the version/CVE applicability matrices, changed-file summary, verification evidence and unresolved production risks. Review the final diff independently.

## Execution decisions

The user explicitly requested direct implementation; no design approval checkpoint or worktree/commit workflow will delay the authorized updates in this repository. Independent dependency investigations use separate agents with non-overlapping file ownership. Verification logs and downloaded tooling stay outside tracked sources.

## Verification ledger

- Backend: patched Java 25.0.5+8, Maven clean verify, 291 tests passed. Resolved application/test graph has zero indexed OSV findings; dormant site-plugin Jetty risk remains documented.
- npm/Python: clean installs and zero final known findings; Pillow 13 is the only necessary library major upgrade and eight image-output comparisons preserve bytes.
- Frontend: final shared-tree production build/typecheck and 1,015 unit tests passed. Complete browser acceptance results are recorded in the security report; earlier failures are retained with their diagnoses.
- Database: complete native PostgreSQL 18.6 gate passed through V075, including SQL, concurrency, HTTP/auth and four live browser purchase journeys. Separate restricted-role and seven upgrade/provider gates passed.
- Production: JVM-only native package update verified using jcmd and service-user certificate check. Package rollback was exercised after a checker source permission failure, then corrected update succeeded. Artifacts, credentials, configuration, Flyway73 and role privileges unchanged.
- Ruling: preserve Claude's concurrent UI work. Verify original UI plus security changes separately, then verify the final shared tree after Claude completes. Application dependency deployment remains the separate pinned-CI release process.
- Ruling: keep stable compatible Maven Site plugin; do not introduce an incompatible Jetty major or claim dormant vendor findings are fixed.
- Ruling: correct the P2 mock to represent a valid authenticated cookie refresh; preserve real logout/invalid-session draft erasure.
- The user later authorized push to main and exact-commit hosted CI verification. Application artifact deployment remains separate.

Final acceptance: shared-tree build/typecheck and 1,015 unit tests passed; complete Playwright run 328 passed / 87 opt-in skipped / 0 failed. Five live PostgreSQL-backed browser journeys passed separately. All required authorized repository work and the explicitly authorized production JVM-only update are complete; application artifact deployment is a separate release.
