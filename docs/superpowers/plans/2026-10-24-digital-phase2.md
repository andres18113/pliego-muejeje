# Digital single-copy Phase 2 implementation plan

Goal: complete the user's Phase 2 specification without commits or reverting prior work.
Architecture: retain ADR-0042 and V076 business invariants; extend its eligibility projection through JDBC and OpenAPI. React Query reads eligibility for authenticated customers; shared presentation resolves ownership, pending orders and cart state, with commands still authoritative.
Spec: user's Phase 2 request; docs/design/PLIEGO_FRONTEND_DESIGN_LANGUAGE.md.

Constraints: Spanish copy, existing components/pill/offer/payment behavior, physical quantities 1–10, no Docker/JPA, no production changes. Work in the existing dirty workspace as explicitly requested. Snapshot: /tmp/pliego-phase2-start.patch.

- [x] A: extend eligibility SQL with nullable pending_order_id (deterministic lowest blocking order ID), JDBC record/gateway, OpenAPI/types and Zod; verify real pending/owned/revoked/isolation links with Java and PostgreSQL tests. Amend V076 per explicit user instruction.
- [x] A verification: exact Maven verify and native PostgreSQL 18 gate runner from phase1-report, fresh empty database names; separate upgrade gate.
- [x] B: review started quantity copy; add shared eligibility query/presentation, stock conflict copy, cart/drawer recovery links; test digital and unavailable physical lines.
- [x] B: edition page and sticky bar mirror owned > pending > inCart; refresh after adds/cart invalidations; retain normal button while loading and guest/staff/physical behavior. Tests for states, invalidation and add conflicts.
- [x] B: checkout conflicts in existing problem area with recovery links; terminal attempt blocks repeated acceptance; preserve payment and unknown-outcome semantics.
- [x] Verification: tsc, full src Vitest, full non-live/non-visual Playwright with /tmp output; mocked desktop/360px screenshots; document counts, files, deviations.

Review focus: account/query isolation; owned+pending precedence; missing IDs/read failures use real fallback links; cart invalidations refresh eligibility; 409 never opens drawer or loops checkout; unavailable physical quantity label and 1–10 unchanged.

Evidence A: Maven 310/310, PostgreSQL gates 73/73 on pliego_digital_phase2_20261024_a, upgrade 1/1 on pliego_digital_phase2_upgrade_20261024. Targeted Playwright: 19/19.

Final review: independent read-only review found one Important focus regression. Fixed locally using useAvailabilityFocus; page and sticky regression tests RED→GREEN (11/11 edition tests), full Vitest 1052/1052, tsc exit 0. No critical findings or deferred minors.

Final evidence: tsc exit 0; Vitest 1052/1052; full Playwright 334 passed, 16 failed, 6 skipped, including digital19/19. Initial-tree full baseline 310 passed, 21 failed, 6 skipped reproduces 15 identical failures. Remaining unchanged account timing case passes in baseline and final isolated recheck 1/1. Evidence and deviations in docs/audit/digital-single-copy-2026-10-24/phase2-report.md. No commits, production actions, or unrelated working-tree reversions.
