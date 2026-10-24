# Five remaining browser failures — controlled comparison

Date: 2026-10-24. Scope: the remaining five failures from frozen security-patched UI suite (323 passed, 87 opt-in skipped, 5 failed). No application UI, backend, approved baseline, or migration edits.

| Controlled run | Catalog 1440/light | Catalog 1920/light | P2 text / zoom / reflow | Result |
|---|---|---|---|---|
| Original HEAD app + original dependencies + original tests | PASS | PASS | PASS / PASS / PASS | 5 passed, 24.7s |
| Frozen security app + patched dependencies + original tests | PASS | PASS | FAIL / FAIL / FAIL | 2 passed, 3 failed, 38.9s |
| Frozen security app + patched dependencies + corrected P2 fixture | PASS | PASS | PASS / PASS / PASS | 5 passed, 24.1s |

## Catalog focus failures

Both original full-suite failures were `exploration.spec.ts:99`, expecting the Resultados region to receive focus after Siguiente navigation. Both pass on baseline and the exact security snapshot with one worker. Five additional repetitions of each exact security test passed: **10/10**, 28.5s. These are intermittent full-suite failures; no deterministic security regression is established. The exact competing focus/timing cause remains unproven. Their original traces contain no console errors or failed HTTP responses; the earlier unrelated optimize-dependency 504 diagnosis does not explain these two failures.

## Profile draft failures and narrow fixture correction

All three original P2 failures reliably occur at the old line 122: after reload and a second explicit login, the Nombres editor no longer exists. Baseline passes the same assertions. The old shared fixture permanently returns HTTP 204 for `/auth/refresh`, including after login. Therefore its reload represents an absent/invalid session, followed by a new login, rather than successful restoration of an authenticated cookie.

The security app correctly handles that 204 through `acceptRestoredSession(null)` → `forgetSession()` → `forgetPrivateData()` → `clearProfileDrafts(undefined)`, discarding the prior session's private unsaved draft. This is a real changed behavior relative to baseline, required by the privacy fix. Successful initial customer refresh instead preserves only drafts whose original customer email matches the authenticated response. The old P2 assertion conflated these two boundaries.

Only `frontend/tests/e2e/p2-audit.spec.ts` was edited in the main repository, after verifying that file had no concurrent diff. Within the three adaptation tests, a local auth interceptor now starts unauthenticated (refresh 204), becomes authenticated on login, returns the same customer's valid refresh DTO thereafter, and clears its state on logout. The reload asserts Mi perfil and the original Ana María draft directly, with no second manual login. All accessibility, keyboard, adaptation, draft navigation, and reflow assertions remain. The file was mirrored into the frozen patched snapshot; application source was not changed. This corrects the fixture's modeled scenario without restoring private data across invalid-session or logout boundaries.

The corrected five-test run passed with exit 0. Main and snapshot corrected spec SHA-256: `74b8561307d48369c2df6b10b60e882f1fa0c4ae7c2cd8702a9cff1a7d065ed3`. `git diff --check -- frontend/tests/e2e/p2-audit.spec.ts` passed. Separate existing session security tests cover draft cleanup; their comprehensive execution remains part of the parent verification work.

## Reproduction and artifacts

Both snapshots use Node v24.22.1 and independent node_modules/default Vite caches. Baseline served loopback port 5188; patched served 5189. Each shell starts its own server, waits for readiness, runs tests, and stops the server with an EXIT trap. All API proxy targets are closed loopback `http://127.0.0.1:9`; selected tests supply fake API routes. No production mutation, subagent spawning, or commits.

Run from the relevant snapshot's frontend directory, with `PATH=/tmp/pliego-security/runtime/node-v24.22.1-linux-x64/bin:$PATH`, `PLIEGO_API_PROXY_TARGET=http://127.0.0.1:9`, `PLIEGO_E2E_BASE_URL=http://127.0.0.1:5188` or `:5189`, and no `PLIEGO_VITE_CACHE_DIR` override:

```sh
npm run dev -- --host 127.0.0.1 --port 5189 --strictPort
npx playwright test tests/e2e/exploration.spec.ts tests/e2e/p2-audit.spec.ts --grep 'hierarchy, real facets, keyboard and enlarged text (1440|1920)px / light|P2 controls retain keyboard operation and readability at' --workers=1
```

Evidence:

- Original baseline: `/tmp/pliego-security/browser-baseline/five.log`, `five-vite.log`.
- Patched original-tests failures: `/tmp/pliego-security/browser-current/five.log`, `five-results/` retained traces and error contexts.
- Patched focus repetitions: `/tmp/pliego-security/browser-current/focus-repeat.log`.
- Patched corrected-tests verification: `/tmp/pliego-security/browser-current/five-corrected.log`, `five-corrected-results/`, `five-corrected-vite.log`.
- Trace network/console summary: `/tmp/pliego-security/browser-five-trace-evidence.json` (includes expected unimplemented mock-route 404s in P2; no Vite optimizer 504s).

Remaining limits: this correction and five-test pass do not themselves certify the entire updated 415-test suite, concurrent Claude UI changes, production authentication, or a resolved cause for full-suite catalog focus flakiness. The 87 opt-in tests were not exercised by the earlier full run.
