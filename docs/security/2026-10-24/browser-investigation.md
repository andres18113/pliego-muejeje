# Browser failure comparison — 2026-10-24

## Result

The two sampled failures do **not** reproduce on either clean baseline or clean patched code/dependencies. They are not demonstrated pre-existing application defects and not demonstrated security-patch regressions. The initial full run was affected by Vite dependency-cache invalidation.

| Scenario | Desktop address editing | Shared header, 320px/light | Log |
|---|---|---|---|
| HEAD app source + original package/lock | PASS (10.1s) | PASS (11.7s) | `/tmp/pliego-security/browser-baseline/representative.log` |
| HEAD app source + current session/draft source + patched package/lock | PASS (9.9s) | PASS (11.5s) | `/tmp/pliego-security/browser-current/representative.log` |

Both executions used Node v24.22.1, Chromium, 2 Playwright workers, unmodified committed E2E tests, isolated fresh node_modules installs, and separate loopback Vite servers. Baseline used port 5183 and patched used 5184. Both test commands completed with exit 0, 2/2 passed. API proxy target was forced to closed loopback `http://127.0.0.1:9`; selected tests install fake API routes and never depend on a production backend.

## Exact initial failure mechanism

The original desktop address trace records HTTP **504 (Outdated Optimize Dep)** loading `react-hook-form.js?v=b233e1af` and `@hookform_resolvers_zod.js?v=b233e1af` from the dev-server optimized-dependency directory. Its snapshot shows the root route error fallback, heading “No pudimos mostrar esta página.” Therefore the missing main-content “Iniciar sesión” link is a downstream symptom of failed lazy-module loading, not proof the auth gate itself changed.

The original shared-header test reaches `/checkout` after several navigation checks but fails expecting “Finalizar Compra”. Its trace records the same HTTP 504 optimized imports. The clean baseline and clean patched test complete the entire exact test, including checkout/header expectations. This invalidates the earlier tentative interpretation that the test had an existing guest-auth fixture mismatch.

All **20** inspected, completed initial traces in the `addresses-*`, `billing-*`, and `catalog-header-shared-Head-*` output families contain the same optimizer-504 error. Full console excerpts and originating URLs are saved in `/tmp/pliego-security/browser-baseline/main-initial-trace-errors.json`. Original desktop-address and header320 trace/error-context artifacts were copied alongside that file before the parent could reset main test output.

The shared optimized-dependency cache being invalidated by concurrent Vite servers is consistent with this evidence. The exact process that invalidated it is not established by these two reruns; the established failing boundary is the development server’s optimized import response.

## Reproduction and scope

Baseline files were extracted using `git archive HEAD frontend shared` at commit `2383344f23176b00d6bae956a74da6a1fd805723`, then package files restored from the audit’s `frontend-package-before.json` and `frontend-package-lock-before.json`. Baseline Vite was 8.3.1. Patched files were a separate archive with current `session.tsx`, `profileDraft.ts`, `package.json`, and `package-lock.json` copied in; patched Vite is 8.3.3. Source and lock digests are retained in `comparison-sha256.json`.

Commands in each frontend directory:

```sh
export PATH=/tmp/pliego-security/runtime/node-v24.22.1-linux-x64/bin:$PATH
npm ci --cache /tmp/pliego-security/npm-cache
export PLIEGO_API_PROXY_TARGET=http://127.0.0.1:9
# Set PLIEGO_E2E_BASE_URL and --port to 5183 for baseline, 5184 for patched.
npm run dev -- --host 127.0.0.1 --port 5183 --strictPort
npx playwright test tests/e2e/addresses.spec.ts:73 tests/e2e/catalog-header.spec.ts --grep 'address editing opens over|shared Header entry, search and stable scroll at 320px / light' --workers=2
```

Actual execution started the Vite process and tests within the same shell, waited for readiness, then terminated Vite with an EXIT trap. No app UI/UX, E2E tests, approved artifacts, or migrations were changed in the workspace. An initial misdirected `npm ci --ignore-scripts` ran in the repository root; it refreshed only the root node_modules set and did not modify tracked files or frontend node_modules.

These are **two representative tests**, not a baseline classification of all 415 tests. A complete controlled current-suite rerun remains the parent task’s responsibility. Retrying with isolated Vite caches or no competing Vite process is justified by the observed 504s; changing application UI or weakening assertions is not justified by this evidence.
