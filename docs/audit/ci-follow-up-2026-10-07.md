# CI follow-up — 2026-10-07

Scope: publish the academic release and verify PLIEGO CI. SonarQube is excluded as requested; its checks and configuration are unchanged.

The first published release, `3cd2f00`, passed Maven/PostgreSQL and Python, but [its frontend job failed](https://github.com/andres18113/pliego-muejeje/actions/runs/37574428569) in four Playwright cases. These failures were investigated and corrected rather than ignored.

| Cause | Correction | Executed evidence |
|---|---|---|
| Address recipient recovery attempted focus before React mounted the hidden field. At 6× CPU throttling the field mounted 67 ms after the animation-frame callback. | Queue the invalid field and focus after its DOM commit, once enabled, retaining the issuing session/view guard. | Deterministic before-commit regression; 2/2 actual validation journeys and 8/8 throttled reproductions pass. |
| CDP rounded transformed button corners during search-opening animation: protocol height 43.99999809265137 while CSS and DOM height were 44. | Wait for the settled search dialog, assert CSS height, and retain every original 44 px bounding-box minimum. | Both originally failed browser cases pass; six repeated executions pass. No minimum was reduced. |
| Two real-backend browser contracts ran in the mock-only frontend job, including an assumed personal credential file. | Use the existing live-suite opt-in and execute both contracts in the native PostgreSQL job. Register and verify a fresh synthetic customer; remove the home-directory credential dependency. | Fresh 65-migration database: all 58 SQL/concurrency/HTTP gates pass; both live browser contracts pass in 23.6 seconds. |

The live runner binds its API and Vite to loopback, owns and cleans up only its child processes and temporary directory, disables external email, and prepares at most six bounded physical inventory fixtures through the approved Database API. Secure-cookie authentication gates run before the separate HTTP-only browser fixture. No Docker, new application infrastructure, historic migration edits or test disabling was introduced. The default frontend job retains all mock-based browser cases; real-backend cases run with `PLIEGO_E2E_LIVE=1` in the PostgreSQL job.

Local final verification: **631 frontend tests in 67 files**, production build/typecheck, targeted browser repetitions, fresh database gates, live browser contracts, workflow YAML and shell syntax, and staged whitespace checks. The preceding release's Java source is unchanged.

Complete diagnostic logs remain local under `/tmp/pliego-final-audit/`. GitHub Actions retains the published runs; the final remote result must be checked against the exact follow-up commit, independently of SonarQube.
