# Admin pickup handover — V-Model specification and verification

Scope: the administrator can open a store-pickup order from **Retiros en tienda**, review it, verify the customer's
pickup code and identity, and confirm the handover (order → **Retirado**), plus the actions the existing business rules
already allow. Builds on ADR-0047 (public references, verified pickup). Backend: Codex. Frontend/UX: Claude.

Left side (requirements → acceptance criteria) is fixed before implementation; right side (tests) is filled with the
evidence of each level. Test IDs are referenced from test names/comments.

## Requirements and acceptance criteria

| ID | Requirement | Acceptance criteria |
|---|---|---|
| **REQ-1** | Open a pickup order from the admin list. | AC-1.1 Every queue row is one link to `/admin/retiros/{orderId}` whose accessible name includes the order reference and customer. AC-1.2 A successful code lookup at the counter opens the same page with the code already verified (kept in memory only, never in the URL or browser history). AC-1.3 The page has the trail "Inicio \| Administración \| Retiros en tienda \| Pedido #PL-…". |
| **REQ-2** | Review order details, items, customer and pickup status. | AC-2.1 Shows reference, created date, total, units, payment state, server pickup state (Listo para retirar / En preparación / Retirado / Cancelado), location, ready time, and — once collected — when, by whom, and that identity was verified. AC-2.2 Shows each purchased printed item (title, format, quantity). AC-2.3 Shows customer name, email and registered identity (type + number, or "No registrada"). AC-2.4 The pickup code is never returned by the API nor rendered. AC-2.5 An unknown order or a non-pickup order shows a not-found state, not an error dump. |
| **REQ-3** | Verify the customer's code against *this* order before any handover. | AC-3.1 On a READY order the handover starts with a code step; identity and confirmation are locked until the server verifies the code for this order. AC-3.2 A wrong code — including another order's valid code — yields the same "El código no corresponde a este pedido" error and changes nothing. AC-3.3 Verification never changes order state. |
| **REQ-4** | Verify the customer's identity before confirming. | AC-4.1 After the code, the page shows the registered name and identification number large enough to compare with a document. AC-4.2 "Confirmar entrega" stays unavailable until the "Verifiqué el documento de identidad de {nombre}" check is ticked. AC-4.3 The server rejects a collection without `identityVerified: true`. |
| **REQ-5** | Confirm the handover → Retirado. | AC-5.1 Confirming calls collect with the verified code and `identityVerified: true`; on success the page shows "Retirado", the time and the confirming admin, and the queue reflects it. AC-5.2 The server records the collecting admin, time and identity verification exactly once. |
| **REQ-6** | Prevent accidental confirmations and duplicate pickups. | AC-6.1 The confirm button is disabled while the request is in flight (no double submit). AC-6.2 A second collection (same or another admin, sequential or concurrent) gets 409 `PICKUP_ALREADY_COLLECTED`; the page re-reads and shows who collected it, with no confirm action. AC-6.3 Collection before READY gets 409 `PICKUP_NOT_READY`; cancelled/unpaid gets 409 `ORDER_INVALID_TRANSITION`. AC-6.4 After a refusal the UI shows the server's current state. |
| **REQ-7** | Prevent unauthorized status changes. | AC-7.1 Every endpoint (detail, verify, collect, cancel) is ADMIN-only: anonymous → 401, customer → 403; routines assert ADMIN again. AC-7.2 A customer visiting `/admin/retiros/{id}` sees "Esta área no está disponible para tu cuenta." and no admin request is made. |
| **REQ-8** | Additional actions justified by existing rules. | AC-8.1 "Cancelar pedido" appears only when the server says the order can still be cancelled (inside the six-minute window or payment pending; ADR-0029/0042), behind a destructive confirmation stating the refund; it uses the existing admin cancel command. AC-8.2 When not cancellable (READY after the window, COLLECTED, CANCELLED) no cancel action exists and the server refuses one (409). |

## Verification plan and evidence (right side of the V)

| Level | ID | Test | Covers | Result |
|---|---|---|---|---|
| Unit (backend) | UT-B | Service/gateway tests for detail projection, code verification, cancel availability | AC-2.4, 3.2, 3.3, 8.1 | **Pass** — part of `mvn verify`: 471 passed, 0 failed, 1 skipped (live R2 smoke). Per-AC counts in `admin-pickup-handover-backend-report.md`. |
| Integration (DB) | IT-DB | SQL gates: verify-code has no side effects; collect once/concurrently; not-ready; cancelled; ADMIN assertions; no code in projections | AC-3.3, 5.2, 6.2, 6.3, 7.1 | **Pass** — clean Flyway 91/91; 46 SQL + 20 concurrency gates; strict runtime ACL gate; 56 query plans. |
| Integration (API) | IT-API | REST tests: detail 200/404, verify 200/400 (wrong & other order's code), collect 200/409s, 401/403 for each endpoint, admin cancel 200/409 by state | AC-2.*, 3.*, 4.3, 6.*, 7.1, 8.* | **Pass** — 29 HTTP + 2 authentication gates; AC-7.1 8/8, AC-8.2 6/6 (backend report). |
| Component (frontend) | UT-F | Vitest/RTL on the admin pages with stubbed API | AC-1.1–1.3, 2.1–2.5, 3.1–3.2, 4.1–4.2, 5.1, 6.1–6.4, 7.2, 8.1–8.2 | **Pass** — `features/admin/Admin.test.tsx` 17/17 (12 named by AC; stubs use the real P-codes); full suite 1,228/1,228; typecheck and build clean; mocked Playwright regressions 60/60. |
| System | ST | Running review environment (real backend + DB): full READY → Retirado handover in the browser, wrong code, duplicate attempt, customer denied, phone width | All | **Pass** on the local stack (V091 applied with the strict privilege lifecycle; fresh orders #PL-9988-9532 and #PL-4944-0743). Customer: page denied, 403 on detail/verify/collect/cancel; anonymous 401. Preparing order: opened from the queue, no handover, no code, cancel offered; #PL-4944-0743 cancelled through the dialog. Home-delivery order 5 → not found. READY: another order's valid code refused like a wrong one (400 P5013, nothing changed); real code (typed lowercase with a space) verified; identity checked; confirmed once → COLLECTED by admin@pliego.local, identityVerified true. Second collect → 409 P5017; collect with `identityVerified:false` → 400. Desktop 1440 and phone 390, no horizontal overflow. |
| Acceptance | AT | Walk through each AC with screenshots (desktop and phone) | All | **Pass** — screenshots reviewed: queue, preparing order with cancel, cancel dialog, READY before handover (desktop/phone), steps completed, collected. |

## Defects found by verification and fixed

- **System test, AC-3.2:** domain errors arrive with the database code (`P5013`, `P5017`…), not the symbolic name the
  component stubs used, so the page fell back to generic wording. Fixed with one matcher over the approved SQLSTATE
  mapping (`isDomainError` in `adminModels.ts`); component stubs now send the real codes.
- **Acceptance, AC-2.1:** a preparing order inside its cancellation window showed the stored preparation time as its
  expected ready time, earlier than the server's READY. The page now states the later of the two server times
  (preparation and window end) — presentation only; READY remains the server's.
- **Component, AC-1.2:** a code carried from the counter stayed in memory after leaving the order's page. It is now
  forgotten when the page unmounts.

## Known limitation

The queue's "Listo desde" uses the list projection's `readyAt` (preparation time), which has no cancellation deadline;
for an order that became ready at its window's end it can read up to six minutes early. The order page is exact.
