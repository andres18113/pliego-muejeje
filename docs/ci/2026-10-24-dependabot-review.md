# Dependabot CI review — October 24, 2026

Baseline: `007b60d55b9058cc35e8e217df2494d85f3bae44`. Review covers open Dependabot PRs #3 and #5–#14. Dependency upgrades stay in their individual PRs; none was merged by this review.

## Confirmed failures

- **#13 React DOM:** npm ERESOLVE because react-dom 19.3.1 requires react ^19.3.1 while the application pins 19.3.0. The PR branch now also pins React 19.3.1, with a regenerated lockfile. No force or legacy-peer-deps flag. Clean install, zero audit findings, build/typecheck and 87 files / 1,015 unit tests passed locally. Fix commit: `45db0605c0706e270a2426e31452a15b3bd2ef2d`.
- **#5/#6/#7/#8/#11/#14 browser gates:** failures recur across unrelated Maven, Python, root font and frontend changes. They involve account-menu keyboard focus, catalog-pagination focus or back navigation. Main passed these assertions, and 20 additional repetitions of the unchanged account-menu scenario passed with four workers. The exact intermittent scheduling/focus cause is not proven. A controlled delayed-module probe also passed and is not presented as a reproduction.
- **#9/#14 backend gates:** both hit the same 10-second socket timeout at `full_journey_http_gate.py:234`, GET `/api/v1/cart`, after successful item creation and quantity update. This is not an HTTP error or business assertion failure. The unchanged full native gate passed locally; three additional cart reads took 0.413s, 0.357s and 0.364s. Two additional complete journeys passed; a third later encountered a separate disposable PostgreSQL MultiXact error during checkout. Neither that later error nor local JIT timing proves the original CI timeout's cause. No schema, application, timeout or command-retry change was made.

## CI maintenance changes

- Run the full frontend browser suite with one worker, matching the successful 328-test acceptance run and keeping its assertions intact. This reduces cross-test resource and focus contention; it is not a claim that an intermittent product timing issue has been fixed.
- Group React and React DOM updates so Dependabot proposes their coupled runtime versions together. Independent type-package versions remain unchanged.
- Retain frontend traces and backend gate logs on failure using a commit-pinned upload-artifact v7.0.2 action, with five-day retention. Include only synthetic test artifacts and application diagnostics, not environment/credential files or database dumps.
- Preserve the backend JVM thread dump before stopping a failed gate, bounded to ten seconds. Existing request timeouts and assertions remain unchanged. Local cleanup probes verify success, failure, diagnostic-command failure and preservation of the original exit status.

## Verification and interpretation

Workflow syntax is checked with actionlint; gate shell syntax and staged whitespace checks pass. React PR tests and unchanged integration reproduction logs are under `/tmp/pliego-dependabot-review/`. The first #9 backend timeout receives one unchanged retry after local reproduction passed; repeated retries are not used as a substitute for diagnosis. Hosted checks for the updated PR heads and common CI changes are monitored and reported with the review handoff.

At initial inspection, #3, #10 and #12 were green. Their green status is not an automatic approval to merge. In particular, the major updates in #5 (Plexus), #7 (Motion) and #10 (resolvers) remain separate compatibility/release decisions; this review does not silently adopt them on main. PR #3 was behind main and should be refreshed before eventual merge.

Remaining limits: other dependency interactions are only tested individually, not as an all-upgrades combination; CI green does not certify unchanged animation semantics after a major Motion upgrade. The original integration timeout and the earlier high-concurrency focus failures remain documented until diagnostic evidence establishes a precise cause.
