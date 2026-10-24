# PLIEGO production correction plan

Goal: fix all seven findings from the 2026-10-07 production audit plus Orders surface and verified-email UI, with regression reproduction and production validation.

Authority: user implementation request and `/mnt/c/Users/Andres/Downloads/PLIEGO_Auditoria_Produccion_2026-10-07.pdf` (25 pages, reproduction section19). Preserve the approved incumbent UI; no redesign, unrelated refactors, historical migrations or weakening validation/idempotency. No commit/push. Root coordinates shared checkout with exclusive file ownership; the user explicitly authorizes implementation and native subagents, so no additional design approval is required.

## Tasks and ownership

- [ ] Root: ACCT-01 cart focus/visibility convergence and accessible checkout review gate when reviewed quantity/pricing/totals changes, preserving backend fingerprints/idempotency. ACCT-02 distinguish unit price/quantity/line subtotal. ACCT-03 reliable focus after new address selection, Cancel/Escape preserved. Own purchase/cartQuery.ts, CartPage.tsx/cart.module.css, CheckoutPage.tsx and their tests. Do not modify agent-owned files.
- [ ] Catalog/navigation agent: PUB-01 visible format on mixed cards/search consistent with accessible name/PDP; MOB-02 generic catalog destinations and explicit contextual return labels. Own BookCard/CatalogBookCard/HeaderSearch/PDP/auth-return/SiteFooter and relevant tests; not Header sizing CSS, Account/Help/Orders or root purchase files.
- [ ] State/help agent: PUB-02 related help conditional on additional published resources; Orders only white surface token; Account resend prompt only explicit authoritative unverified state. Own HelpRoutes/Help tests, Orders CSS/tests, AccountPage/profile API types/tests. If profile verification not currently exposed, add only necessary backend read contract/public Database API and tests, never infer from ACTIVE or email text. Reserve migration V066 only for this task if needed; notify root before backend changes.
- [ ] Responsive agent: MOB-01 remove rigid sizing causing 320px CSS/200% zoom scrollbar overflow, preserving all header controls/navigation. Own global sizing/header CSS and targeted browser regressions; no card/Orders/cart styles.
- [ ] Root: reproduce each original scenario against baseline with meaningful failing regression tests; agents provide RED/GREEN evidence for their scope. Local disposable backend/database for states that cannot safely be mutated in production.
- [ ] Root: complete frontend tests/typecheck/build; backend tests and migration validation if contract changes. Browser/E2E each finding at320/390/768/1280, actual320 CSS zoom200 with classic scrollbar; two real tabs; verified/unverified state and Orders surface computed/visual checks.
- [ ] Independent code review: check requirements/race/focus/contract/accessibility/test validity and fix related regressions.
- [ ] Root: deploy corrected artifacts within existing authorized production layout after checks, preserve TLS/AOP/SSH/UFW/DB credentials/catalog/offers, normal Flyway only if additive migration required. Verify original scenarios, service/public health and rollback; leave source working diff reviewable without commit/push.
- [ ] Handoff: nine explicit PASS results only with reproduction evidence; files/tests/viewports/results/blockers.

## Review risks

Checkout background refetch must not silently approve a new amount; the review acknowledgement must be invalidated by subsequent material change. Tab refresh must not bypass session authority or trigger duplicate checkout commands. Address focus restoration must wait until the replacement control exists after the dialog disappears. Verification must come from the current email's database state and handle missing/rolling contract safely. Scrollbar width must reduce usable layout width without hiding controls or applying overflow suppression.

Evidence/logs: `/tmp/pliego-production-fixes-20261007/` (no secrets). Audit text extraction is reference evidence, not a second audit deliverable.
