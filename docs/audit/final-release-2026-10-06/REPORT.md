# PLIEGO final academic release audit

2026-10-06. Release verdict: **READY for the tested academic production baseline**. All 17 finding groups below are corrected and regression-verified; no reproduced P0/P1 or significant actionable IHC defect remains unresolved. No deployment, commit, external email or payment was performed. Existing uncommitted work and approved visual design were preserved.

## Findings, fixes and regressions

| Finding | Priority | Root cause and correction | Executed regression evidence |
|---|---|---|---|
| Expired bearer blocked refresh/logout | P1 | Public auth transport carried an expired access token; omit bearer there, retain protected-route authorization, serialize credential login with cookie rotation/logout. | Actual transport red/green; protected bearer still present. |
| A private cache survived establishing B | P1 | Shared private query keys lacked identity eviction; remove/cancel `authRequired` queries at identity replacement. | Cached A profile removed, pending read aborted, public catalog retained. |
| Late session restoration revived cleared/replaced identity | P1 | Async restoration had no generation fence; guard manual, expiry and proactive completions/failures. | Clear/replacement/late failure regressions. |
| Same-user rotation defeated successful logout | P1 | Token rotation changed the generation used by logout; distinguish authority changes from token refresh. | Pending refresh then logout ends Guest; independently reproduced and rechecked. |
| Disposed provider overwrote a newer token | P1 | Async callbacks and retry timers survived unmount; invalidate both generations during teardown. | Late response preserves token B; independent actual-source recheck. |
| Login identity changes did not synchronize tabs | P2 | Only logout/expiry were broadcast; broadcast a data-free change and restore through the cookie. Use the listening channel to avoid self-echo. | Other-tab identity replacement removes A data; native live session persistence/logout coverage. |
| Checkout bought a quantity/price changed after review | P1 | Client re-read did not protect GET→POST gap; DB-owned fingerprint and ordered cart/master locks reject `P4005` before effects. Immutable receipt captures/replays accepted fingerprint. | Real HTTP quantity/price/identical-total substitution; concurrent duplicate; lost response; actor/payload separation; contested master lock; real offer expiry. |
| Unknown undo outcome offered an additive POST replay | P1 | Lost undo response plus failed reconciliation retained a write retry; recovery now only reads the cart. | Committed POST/response loss/failed GET/recovery produces exactly one POST. |
| Library 401 repeated retry without sign-in recovery | P1 | Library hooks did not restore/expire authority; align list/detail with private-session recovery. | Both list/detail offer sign-in preserving destination and remove retry loop. |
| Read failures obscured cause and allowed busy retry | P2 | Generic connection copy covered permissions/throttling/service failure; share safe Spanish status recovery and guard pending clicks without losing focus. | 403/404/429/500/503, pending focused button, and pre-confirmation 403/429/503 with zero checkout POSTs. |
| Async detail navigation lost reading focus | P2 | Route effect ran before h1 arrived; observe delayed heading, respecting intentional user focus. | Six Chromium regressions at 375/768/1280; library/Help independent checks. |
| Card input lost caret/focus ownership | P1 | Older animation frames moved the cursor after newer digits, corrupting expiry; supersede/cancel caret frames and guard current value/focus/connection before advancing card fields. Validate the normalized expiry, including pasted digits. | Held-frame expiry and corrected PAN/CVV regressions, existing fast keyboard progression and independent before/after recheck. |
| Stale mail completion logged persisted success | P2 | Void DB completion silently rejected stale owner/state; Boolean fenced completion logs `STALE_COMPLETION` with provider ID. | Wrong owner, reaped lease, terminal replay, valid receipt and worker log red/green. |
| Pending private commands crossed identity boundaries | P1 | Await continuations and mutable mutation options used later credentials/callbacks. Capture authority/view and command intent, guard each continuation, reset private subtrees and evict private mutation records; profile drafts verify their customer. | Held cart preflight, checkout cache publication, favorite/cart/order late 401s, blocked address lock, profile save/draft, A→B→A, resource A→B→A permanent retirement and private mutation eviction regressions. |
| Public auth completions replaced or cleared newer credentials | P1 | Pending sign-in, delayed navigation and password-reset completion lacked authority/view guards. Scope accepted responses and navigation; clear only the reset's original authority. | Three pending sign-in/route departure regressions and a held reset response after account replacement. Approved success feedback retained. |
| Obsolete 401 cleared renewed same-user credentials | P1 | Expiry handlers treated a denied old bearer as failure of the current token. Transport compares the actual sent bearer with the installed bearer and exposes safe renewal recovery without expiring it. | Observed accepted refresh followed by old favorite 401, transport replacement regression, genuine current/private and public credential 401 semantics retained. |
| Closed choice control omitted required ARIA state | P2 | Manual combobox role used Mantine Target without expanded-state support. Enable the library's maintained expanded state and popup relationship. | Actual axe failure at 375/768/1280; unit red/green proves collapsed/open/controlled listbox, keyboard selection and retained focus. Final Chromium/axe recheck passes sort and quantity at all three widths. |

Meaningful additions: **45 frontend tests**, **2 backend tests**, **9 browser focus/caret tests**, and new accepted-quote, post-payment mixed rollback, mail-completion and invalid-auth-input gates. Existing browser fixtures were repaired for archived cover paths, required email verification, configured origin, edition identity, and approved purchase/Help layouts. Tests and validation were not disabled or weakened. The existing “post-payment rollback” stock test actually failed before payment; its description was corrected and a new test proves the later failure stage.

V063–V065 are additive. The immutable-history trigger rejected an intermediate receipt UPDATE; V065 captures the fingerprint on INSERT. Historical migrations and triggers remain intact. [ADR-0030](../../adr/0030-accepted-checkout-quotes-and-mail-completion.md) records the contracts and compatibility boundary.

## Nielsen 10/10

[ADR-0031](../../adr/0031-client-command-authority-and-view-lifetime.md) records client command authority, credential and view lifetimes, including Guest and ordinary token renewal.

The framework follows [Nielsen’s official heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/); the application observations below come from repository and execution evidence.

| Heuristic | Concrete PLIEGO evidence |
|---|---|
| 1. Visibility of system status | Initial session-check gate; cart command/quantity feedback, checkout checking/submitting/unknown-result states, orders refresh/stale notices and library loading states. |
| 2. Match to the real world | Spanish account/error language; books/authors/media, local dates/currency, delivery/pickup and human payment/ownership labels. |
| 3. User control and freedom | Cart undo, read-only uncertain recovery, cancel-or-keep order dialog, address discard confirmation and logout. |
| 4. Consistency and standards | Shared form/choice/confirmation controls; library/session/read failures now follow the other private surfaces; state labels remain human-facing. |
| 5. Error prevention | Required/trimmed/bounded inputs, unavailable stock, confirmed card/address choice, submit locks, accepted quote guard and immutable idempotency receipts. |
| 6. Recognition rather than recall | Book covers/title/author/medium, saved address objects, visible cart totals and acquired-title source purchases; no need to remember IDs or payment details. |
| 7. Flexibility and efficiency | Keyboard quantity/disclosure controls, header search shortcut, URL-backed filters/pagination and responsive workflows. |
| 8. Aesthetic and minimalist design | Approved catalog/account/purchase composition preserved; buying remains on edition detail; Help exposes published resources directly. |
| 9. Error recognition, diagnosis and recovery | Associated Spanish field errors; permission/throttle/service recovery; library sign-in, stock/quote re-read and exact-attempt unknown checkout resolution. |
| 10. Help and documentation | Header Ayuda, published ebook/audiobook/cancellation articles, library Help/purchase links and order next-action feedback. |

## POUR

The four principles follow [W3C’s accessibility framework](https://www.w3.org/WAI/WCAG22/Understanding/intro#understanding-the-four-principles-of-accessibility). The checks below are scoped to the tested application surfaces.

| Principle | Verified evidence |
|---|---|
| Perceivable | Text stock/ownership/payment states, native labels and live status/error regions; representative light/dark/browser checks and library-light contrast scan (0 violations, 0 incomplete). |
| Operable | Real keyboard quantity and address disclosure/error recovery; route focus and preservation of deliberate focus; mobile/tablet/desktop plus relevant text at 200%. |
| Understandable | Invalid input retained for correction, first-invalid focus, Spanish status-specific feedback, accepted-price conflict explanation and explicit unknown-outcome recovery. |
| Robust | Semantic headings/main/navigation, accessible control names/states, Mantine controls, private cache cancellation, actor-scoped receipts and real Chromium/HTTP/PostgreSQL evidence. |

The catalog contrast alert was inspected in DOM/source: the unavailable “Anterior” placeholder has no link, handler or tab stop and is hidden from assistive technology. It falls under the inactive-component exception in [WCAG 2.2 SC 1.4.3](https://www.w3.org/TR/WCAG22/#contrast-minimum); no active control was exempted.

This is scoped evidence, not a blanket WCAG certification. [Final focused IHC matrix](evidence/ihc-final/README.md) and [independent IHC evidence](evidence/ihc/README.md) distinguishes executed checks from source inspection and records before/after screenshots.

## Journeys and adversarial recovery

Executed coverage combines real API/PostgreSQL, real live-browser journeys and explicitly intercepted browser failure cases:

- Registration → pending verification → verification → login/logout/reload/reopen/two-tab logout; password recovery/reset, wrong/expired/single-use token, BCrypt and session revocation.
- Account/profile, precise field edits, addresses, keyboard disclosure and server validation; identity A→B cache/read boundaries and stale callback disposal.
- Home/catalog/media search/filter/navigation/back/forward, detail, favorites persistence/reconciliation/touch, cart edits/remove/undo and unavailable items.
- Physical CARD and TRANSFER purchase, configured bank-copy controls, confirmation, orders and refund; digital-only/mixed API purchases and browser contract/ownership/library/Help flows.
- Missing/whitespace/overlong/invalid fields, double-@ email, numeric fractions/overflow/boundaries, invalid sessions, empty/withdrawn products and HTTP 400/401/403/404/409/429/500/503 recovery.
- Last-unit checkout, cancellation/address/admin/registration/offer/snapshot races; exact-key replay, delayed arrival, transaction fence, actor separation and post-payment mixed rollback.
- Local provider stub: 429/503 retries, timeout/IO ambiguity, durable restart recovery, verification/reset/order lifecycle email and stale owner/reaped worker completion. No external mail was sent.

## Verification

| Gate | Result |
|---|---|
| Frontend Vitest | PASS — 630 tests, 67 files. |
| Backend `mvn -B -o verify` | PASS — 194 tests, 0 failures/errors/skips; production jar built. |
| PostgreSQL 18.6 fresh CI gate | PASS — 65 Flyway migrations, 27 SQL + 12 concurrency + 17 business HTTP + 2 auth HTTP gates. |
| Accepted quote final adversarial gate | PASS — all five scenario groups, including master-lock wait and actual offer expiry. |
| Transactional email isolated HTTP gate | PASS — local provider, verification/reset/revocation/retries/restart/lifecycle. |
| Python catalog/tooling CI | PASS — 132 tests with existing dependencies in an isolated temporary environment. |
| Typecheck + frontend production build | PASS. |
| Chromium full frozen browser gate | PASS — 208 passed, 70 configuration-gated skipped, 0 failed (7.7 minutes), final frozen source. |
| Final focused IHC | PASS — Nielsen 10/10 and POUR evidenced at 375/768/1280; keyboard/focus/ARIA/503/404/validation, 41 public stage records, zero actionable findings. |
| Whitespace and approved archive | PASS — `git diff --check`; all 19 approved migration files byte-identical. |
| Dedicated lint | No lint script/checkstyle configuration exists; existing type/build, tests and diff checks were run. |

Complete logs and sensitive live traces remain local under `/tmp/pliego-final-audit/`. Durable sanitized summaries, evidence hashes and screenshots live in `evidence/`. Initial failures caused by sandbox sockets/JVM attachment, unavailable Maven cache, missing Python dependencies, shared Playwright output, temporary CDP touch emulation ownership, HMR context splitting and replacement of a running jar were diagnosed and recovered; they are not counted as passing product checks.

## Evidence-based conclusions and limits

1. **Recovery is integral to the interaction:** unknown results retain a read/reconciliation path; the undo regression proves this prevents accidental quantity duplication.
2. **Cognitive consistency improved:** private screens now agree on expired-session recovery and read failures explain the actual next step rather than treating every rejection as a connection problem.
3. **Acceptance has a transactional meaning:** quantity, price, changed pricing with an unchanged final amount, same-total substitution, expiry and lock-wait checks prove the shipped checkout guards what the user reviewed.
4. **Keyboard orientation is preserved:** delayed content receives reading focus, while an intentional move to another control remains untouched; corrected card fields are no longer advanced by stale frames at all three representative widths.
5. **Identity boundaries are explicit:** epoch, eviction and command-scope regressions prevent stale requests, private drafts, cached responses and public auth completions from sending or publishing under a later identity; old-token 401s cannot expire an accepted renewal.
6. **Visual quality was retained while robustness improved:** no CSS redesign was needed; the fixes concern feedback, focus, validation, authority and business effects.
7. **Email effects are bounded and observable:** uncertain acceptance is not blindly resent; stale completions do not claim a persisted success, and post-payment rollback removes queued email with the other effects.

Remaining limits: Chromium only; no real screen-reader speech/braille, physical-device or cross-engine certification, blanket full-page zoom/contrast claim, penetration test, large load or commercial payment-provider certification. The approved ADR-0020 access-JWT lifetime remains 30 minutes; refresh-cookie session revocation and frontend eviction were verified, without claiming immediate revocation of every previously issued access JWT. Real Mailtrap delivery requires external credentials and was intentionally replaced by the local provider stub. Legacy HTTP/DB callers omitting `expectedQuoteFingerprint` retain the documented current-cart contract; the shipped frontend sends the fingerprint. Environment-gated specialized visual/pickup/order fixture suites are reported as skipped rather than passed. No standalone Codex Security skill was installed; auth/session/authorization review used the available Spring security guidance, source review and executed gates. Subagents used GPT-6.1 Sol/HIGH; this root thread has no model-switch control.
