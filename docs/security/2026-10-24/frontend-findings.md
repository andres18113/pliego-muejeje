# Frontend and root npm security findings

Assessment cutoff: 2026-10-24. Sources: npm registry audit plus the 25 official GitHub Advisory Database records saved beside this report. This is an as-of assessment; it does not claim coverage of future October disclosures or unpublished vulnerabilities.

## Result

- Frontend: 12 vulnerable package entries (7 high, 5 moderate) to 0, across 25 unique advisories. Counts include meta-vulnerabilities such as shadcn and vitest, so they are not a count of 12 independent CVEs.
- Root: material-symbols 0.47.5 unchanged; before and after audit report 0 findings.
- Root and frontend require Node >=24.22.1 <25. Commands ran with the official SHASUMS-verified Node 24.22.1 and bundled npm 11.19.1 in /tmp/pliego-security/runtime/node-v24.22.1-linux-x64/bin.
- Four frontend manifest floors changed: Zod ^4.6.6, Vite ^8.3.3, Vitest ^5.0.3, shadcn ^4.22.0. Actual lock versions are below; no force, major direct upgrades, overrides or audit suppression.
- Lock refresh also resolves compatible transitive fixes and the dependencies selected by the four direct updates. shadcn 4.22 removes its vulnerable Zod 3 subtree. npm 11 records bundled optional Tailwind WASM contents in the lock; those are package-manager metadata additions, not new direct dependencies.
- Only root/frontend package.json and package-lock.json were edited by this task; source, UX and application architecture unchanged.

## Package evidence and exposure

| Package | Before | After | Severity before | Exposure assessment |
| --- | --- | --- | --- | --- |
| @modelcontextprotocol/sdk | 1.30.1 | 1.32.2 | high | Development CLI (shadcn MCP); no application MCP server found. |
| @vitest/mocker | 5.0.2 | 5.0.5 | moderate | Test tooling; affected mocking HTTP endpoint must be exposed/reachable. |
| body-parser | 2.3.0 | 2.4.0 | high | Development CLI MCP/Express HTTP server; compressed request DoS. |
| fast-uri | 3.1.8 | 3.1.9 | moderate | CLI/OpenAPI schema URI handling; URI normalization and scheme confusion. |
| hono | 4.13.9 | 4.13.13 | moderate | Development CLI MCP HTTP server static route handling. |
| ip-address | 10.7.2 | 10.7.4 | moderate | Development CLI proxy/network parsing; long IPv6 zone input DoS. |
| shadcn | 4.21.0 | 4.22.1 | high | Development CLI; brings vulnerable Zod 3, requiring the Zod 4 compatible CLI update. |
| source-map-js | 1.2.1 | 1.2.2 | high | Build/CSS tooling reading attacker-controlled source maps; not application business logic. |
| undici | 7.30.0, 8.11.2 | 7.30.1, 8.12.3 | high | CLI/test network client; EventSource DoS, integrity bypass, excessive encoding crash. |
| vite | 8.3.1 | 8.3.5 | high | Development server. dev script binds 0.0.0.0; Linux fs allowlist leaks, middleware XSS, Windows/WSL editor injection are conditional on advisory prerequisites. |
| vitest | 5.0.2 | 5.0.5 | moderate | Test tooling; inherited @vitest/mocker findings. |
| zod | 3.25.76, 4.6.5 | 4.6.7 | high | Browser runtime validates library API responses. Existing library schemas do not show the oversized constrained collection pattern; vulnerable implementation is removed regardless. |

Exposure is an assessment of repository usage, not an exploit demonstration. Vite/Vitest/CLI vulnerabilities do not imply the generated static production site runs those Node servers. Zod is imported by browser application code; updating it also protects application validation. All identified advisory version ranges are absent from the resulting resolved tree. Final source-specific results and concurrent UI-work boundaries are recorded in README.md and application-findings.md.

## Advisory/CVE evidence

| Package | CVE | Advisory | Published UTC | First patched version(s) |
| --- | --- | --- | --- | --- |
| @modelcontextprotocol/sdk | CVE-2026-111767 | [GHSA-22jm-h49p-29qw](https://github.com/advisories/GHSA-22jm-h49p-29qw) | 2026-10-20T18:26:54Z | 1.32.0 |
| body-parser | CVE-2026-111181 | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) | 2026-10-23T20:53:11Z | 1.20.9, 2.4.0 |
| fast-uri | CVE-2026-110725 | [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) | 2026-10-23T21:36:40Z | 2.4.8, 3.1.9, 4.2.3 |
| @modelcontextprotocol/sdk, @modelcontextprotocol/server | CVE-2026-111768 | [GHSA-46jr-4wx8-v453](https://github.com/advisories/GHSA-46jr-4wx8-v453) | 2026-10-20T20:06:35Z | 1.32.0, 2.3.0 |
| undici | CVE-2026-109924 | [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) | 2026-10-23T22:13:29Z | 6.29.1, 7.30.1, 8.12.2 |
| launch-editor, vite, vite-plus | CVE-2026-112942 | [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | 2026-10-20T19:48:25Z | 1.1.0, 2.14.2, 6.4.4, 7.3.7, 8.1.6, 8.2.4, 8.3.3 |
| hono | CVE-2026-111757 | [GHSA-5r4p-p66f-jhc7](https://github.com/advisories/GHSA-5r4p-p66f-jhc7) | 2026-10-20T14:36:11Z | 4.13.11 |
| source-map-js | CVE-2026-93749 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | 2026-09-18T18:31:44Z | 1.2.2 |
| launch-editor, vite, vite-plus | CVE-2026-112943 | [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | 2026-10-20T18:30:24Z | 1.1.0, 2.14.2, 6.4.4, 7.3.7, 8.1.6, 8.2.4, 8.3.3 |
| @modelcontextprotocol/client, @modelcontextprotocol/sdk | CVE-2026-111769 | [GHSA-6prh-2h8m-c8cw](https://github.com/advisories/GHSA-6prh-2h8m-c8cw) | 2026-10-20T18:26:30Z | 1.32.0, 2.3.0 |
| @modelcontextprotocol/client, @modelcontextprotocol/sdk | CVE-2026-104850 | [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) | 2026-10-06T15:35:44Z | 1.31.0, 2.2.0 |
| vite, vite-plus | CVE-2026-112945 | [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | 2026-10-21T16:48:14Z | 1.1.0, 6.4.4, 7.3.7, 8.1.6, 8.2.4, 8.3.3 |
| undici | CVE-2026-109841 | [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472) | 2026-10-23T22:12:57Z | 7.30.1, 8.12.2 |
| zod | CVE-2023-54404 | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | 2026-10-01T18:32:46Z | 4.6.6 |
| @vitest/mocker | CVE-2026-112949 | [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) | 2026-10-21T19:54:26Z | 4.1.12, 5.0.3 |
| launch-editor, vite, vite-plus | CVE-2026-112944 | [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) | 2026-10-20T19:51:52Z | 1.1.0, 2.14.2, 6.4.4, 7.3.7, 8.1.6, 8.2.4, 8.3.3 |
| vite, vite-plus | CVE-2026-112946 | [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | 2026-10-21T16:47:42Z | 1.1.0, 6.4.4, 7.3.7, 8.1.6, 8.2.4, 8.3.3 |
| @modelcontextprotocol/express, @modelcontextprotocol/sdk, @modelcontextprotocol/server, @modelcontextprotocol/server-legacy | CVE-2026-111771 | [GHSA-rvq5-wwqv-78pq](https://github.com/advisories/GHSA-rvq5-wwqv-78pq) | 2026-10-20T19:43:36Z | 1.32.0, 2.0.2, 2.3.0, 2.3.1 |
| ip-address | CVE-2026-111997 | [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) | 2026-10-22T16:19:39Z | 10.7.4 |
| vite, vite-plus | CVE-2026-112947 | [GHSA-vfpm-58rq-9qcg](https://github.com/advisories/GHSA-vfpm-58rq-9qcg) | 2026-10-21T16:47:15Z | 1.1.0, 8.2.4, 8.3.3 |
| fast-uri | CVE-2026-110306 | [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) | 2026-10-23T21:41:36Z | 2.4.8, 3.1.9, 4.2.3 |
| fast-uri | CVE-2026-110180 | [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr) | 2026-10-23T21:37:59Z | 2.4.8, 3.1.9, 4.2.3 |
| fast-uri | CVE-2026-110095 | [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h) | 2026-10-23T21:39:34Z | 2.4.8, 3.1.9, 4.2.3 |
| undici | CVE-2026-109869 | [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) | 2026-10-23T22:14:31Z | 6.29.1, 7.30.1, 8.12.2 |
| @vitest/mocker | CVE-2026-112950 | [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp) | 2026-10-21T19:48:38Z | 4.1.12, 5.0.3 |

## Commands and verification

All npm commands used --cache /tmp/pliego-security/npm-cache; PATH selected the patched runtime above. Full output is saved under /tmp/pliego-security/frontend/.

| Command | Working directory | Result | Evidence |
| --- | --- | --- | --- |
| npm install --package-lock-only --ignore-scripts | root and frontend | Exit 0; consistent engine metadata and dependency floors | root-update-lock.log, frontend-update-lock.log |
| npm audit fix --package-lock-only --ignore-scripts | frontend | Exit 0; 0 vulnerabilities | frontend-audit-fix.log |
| npm ci | root and frontend | Exit 0; clean install | root-ci.log, frontend-ci.log |
| npm audit --json | root and frontend | Exit 0; all severity counts 0 | root-audit-after.json, frontend-audit-after.json |
| npm ls --all --json | root and frontend | Exit 0; complete installed trees | root-inventory-after.json, frontend-inventory-after.json |
| npm run build | frontend | Exit 0; includes tsc --noEmit and Vite production build | frontend-build.log |
| npm test | frontend | Exit 0; 87 test files and 1007 tests passed before the profile-privacy change; the final privacy suite passed 1015 tests | frontend-tests.log |
| git diff --check -- package.json package-lock.json frontend/package.json frontend/package-lock.json | root | Exit 0 | verified in session |

The normal test command passed using the repository's existing --no-concurrent-recompilation worker setting. No new runtime workaround or skipped tests was introduced. jsdom printed its known navigation/scrollTo not-implemented notices without test failures.

## Inventory and provenance

- Full lock inventories: frontend-lock-inventory-before.tsv (539 resolved entries), frontend-lock-inventory-after.tsv (537), root-lock-inventory-before.tsv and root-lock-inventory-after.tsv (1 each). They include path, package name, version, dev/optional classification, registry URL and integrity.
- Full installed trees: root-inventory-before.json, frontend-inventory-before.json and corresponding *-after.json files. Optional packages unsupported by Linux x64 may appear as empty entries in npm ls; the lock TSVs preserve all platform dependencies.
- Original audit inputs: root-audit-before.json, frontend-audit-before.json. Original manifests and locks are preserved in the same evidence directory.
- Direct release dates were verified from https://registry.npmjs.org/{package}: Vite 8.3.5 published 2026-10-21, Vitest 5.0.5 2026-10-15, Zod 4.6.7 2026-10-12, shadcn 4.22.1 2026-10-18. Minimal JSON proof is saved as {package}-release-evidence.json.

## Tooling issue and limits

The pre-existing npm 12.2.0 dry run failed with EALLOWREMOTE for a same-registry @tailwindcss/oxide-wasm32-wasi tarball. Local npm definitions document allow-remote=none with same-registry exemptions, and Arborist reify implements the exemption; the optional bundled tarball path failed during audit reification. This is consistent with a tooling exemption gap, not a package advisory. Switching to the official patched Node distribution's bundled npm 11.19.1 fixed installation without weakening project policy or enabling arbitrary remote URLs. Original failure: audit-fix-dry-run.json and npm-cache/_logs/2026-10-24T16_23_35_921Z-debug-0.log.

No production deployment or production access was performed. Browser E2E, backend, DB and production runtime checks are outside this frontend-only verification. npm audit covers known registry advisories rather than proving the absence of all vulnerabilities. Local work does not establish which Node/dependency artifacts production currently runs.
