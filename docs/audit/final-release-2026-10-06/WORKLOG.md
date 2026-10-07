# Final release audit — 2026-10-06

User scope: academic e-commerce robustness, Nielsen 10/10 and POUR; preserve architecture and approved visual design. Root integrates all fixes. Three GPT-6.1 Sol/HIGH agents investigate auth, commerce/email, and IHC read-only. Existing dirty worktree is preserved; starting diff/status are captured in `/tmp/pliego-final-audit/`.

## Execution checklist

- [x] Inspect contributor guidance, existing audit evidence, tests, stack scripts and relevant skills.
- [x] Capture initial worktree and run frontend baseline: 585 tests / 61 files passed.
- [x] Investigate auth expiry, identity cache boundaries and stale session completions; reproduce, add regression, fix, narrow recheck.
- [x] Investigate accepted checkout state, inventory/idempotency/rollback and mail lease/retry outcomes on isolated PostgreSQL 18.
- [x] Audit browser journeys, invalid inputs, error recovery, keyboard/focus and mobile/tablet/desktop.
- [x] Integrate every reproduced in-scope defect with meaningful regression evidence.
- [x] Run final frontend/backend/database/browser suites, type/build and existing lint/static checks.
- [x] Complete Nielsen/POUR evidence matrix and release verdict; distinguish executed, inspected, skipped and external limitations.

## Environment and evidence

Full local logs: `/tmp/pliego-final-audit/`. Durable summaries/artifacts: `evidence/` in this directory. Never copy secrets, session tokens or real credentials into evidence.

Java 25.0.4.1, Maven 3.9.12; PostgreSQL 18 cluster isolated under `/tmp/pliego-final-audit/pgdata` on loopback port 55440. Existing development DB is untouched. Initial Maven command used an absent `/tmp/pliego-m2` cache and failed DNS resolution; rerun uses populated default cache offline. Sandbox requires escalation for loopback servers/browser processes.

## Initial findings (resolved; final details in REPORT.md)

| ID | Severity | Evidence/root cause | Planned correction |
|---|---|---|---|
| AUTH-01 | P1 | Actual auth transport sends expired access bearer to cookie-auth refresh/logout; resource-server rejects before controllers. | Omit bearer on public auth commands; preserve protected endpoint bearer. |
| AUTH-02 | P1 | Actual SessionProvider preserves authRequired A cache when establish(B) occurs, and delayed restore after clear resurrects A. | Purge/cancel private queries on identity replacement and fence asynchronous session completions. |
| CHECKOUT-01 | Investigating | Checkout binds cart ID but no accepted quantities/prices; concurrent changes may be silently purchased. | Reproduce against isolated database before selecting smallest fix. |
| LIBRARY-01 | Investigating | Library 401 only offers retry while other private hooks restore/expire session. | Add equivalent recovery if reproduced. |

Final findings, red/green evidence, CI results and limitations are maintained in REPORT.md. Final gate passed: frontend 630/67, backend 194, PostgreSQL 58 gates/65 migrations, browser 208 passed/70 configuration skips, production build/typecheck and focused IHC. Final verdict: ready for the tested academic baseline.

Final cleanup: stopped only audit Vite5174, API18080 and PostgreSQL55440. Preserved the original PostgreSQL18 main process322 (configured5433), API8080 and frontend5173. No deployment or commit. Final source hashes (92 files), report consistency and git diff --check passed.
