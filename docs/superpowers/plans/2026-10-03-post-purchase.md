# Post-purchase backend implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline; use a fresh final reviewer. The user authorizes implementation and forbids commits, pushes, deployment and frontend changes.

**Goal:** Supply coherent historical order, delivery and document data for future account screens.

**Architecture:** Extend PostgreSQL's public Database API and existing sales projections. Separate shipment and billing documents; keep established checkout/cancellation routines as internal delegates. Spring owns transactions; JDBC contains routine calls and mapping only.

**Tech Stack:** Java 25, Spring Boot, Spring JDBC, PostgreSQL 18, Flyway.

**Spec:** `docs/adr/0017-post-purchase-lifecycle-and-documents.md` and the user's detailed task.

## Global constraints

- Preserve approved root baselines and all existing migrations, including uncommitted V032.
- No frontend changes, credentials, new production dependencies, generic JSON business storage, JPA, Docker, commits, pushes or deployment.
- Preserve SQLSTATE mappings; use existing P1001/P5001/P5002/P5003/P5006 for new routine validation/conflicts and Spanish REST feedback.
- Customer route remains `/api/v1/orders`; extend existing fields additively.

## Review focus

- Digital-only purchases must never acquire physical shipments.
- Concurrent cancellation/issuance/shipping must lock the same order first.
- Lost command responses must be recoverable through authoritative detail; repeated issuance must conflict.
- Invoice lines and document amounts must equal their purchased snapshots, even after catalog edits.
- Existing historical orders must be backfilled without invented timestamps or documents.

### Task 1: Relational lifecycle and documents

**Files:** Add `backend/src/main/resources/db/migration/V033__order_fulfillment_and_shipments.sql`, `backend/src/main/resources/db/migration/V034__invoices_and_post_purchase_projections.sql`, `backend/src/test/postgres18/post_purchase_gate.sql`; retain existing migration files.

**Interfaces:** Existing checkout/cancel/status signatures remain. Add `sp_shipment_transition`, `sp_shipment_update_tracking`, `sp_invoice_issue`, `sp_credit_note_issue`. Append `purchase_state`, `fulfillment`, `shipment`, `invoice`, `credit_notes`, `available_actions` to customer detail, and compact fulfillment/item/invoice summaries to list. Expose the same extensions on admin detail.

- [x] Write snapshot/state/document SQL assertions with public routine fixtures.
- [x] Run against V032; expect the new purchase/shipment projection assertion to fail.
- [x] Implement V033/V034 schema, backfill, immutable guards, routines and projections.
- [x] Run targeted PostgreSQL tests; expect no assertion failures.

### Task 2: REST/JDBC contracts

**Files:** Extend existing sales models/controllers/gateways; add shared typed post-purchase records/mapper and ADMIN commands under sales. Add `backend/src/test/postgres18/post_purchase_http_gate.py`.

**Interfaces:** Existing IDs/money remain strings, quantities numbers. Detail adds purchaseState, fulfillment, shipment/history, invoice/billing/lines, creditNotes and availableActions; list adds compact item and delivery/document summaries. ADMIN endpoints update tracking/transition shipments/issue invoices/issue full credit notes.

- [x] Write live HTTP assertions for the new fields/routes and command validation.
- [x] Run against existing REST implementation; expect missing projections/routes.
- [x] Implement typed API records and routine-only gateways, one transaction per command.
- [x] Run targeted HTTP gate and Maven sales tests; expect success.

### Task 3: Gate, documentation and final review

**Files:** Extend `backend/src/test/postgres18/run_ci_gates.sh`, `backend/README.md`, ADR index; add `docs/api-amendments/0008-post-purchase-v1.0.8.md` and audit evidence. Do not edit frontend OpenAPI export; runtime backend OpenAPI is authoritative.

- [x] Document exact states, extension signatures/fields, backfill and deferred integrations.
- [x] Run Maven clean verify and complete PostgreSQL 18 gate against a disposable database.
- [x] Verify a V032 populated-database upgrade and immutable baseline migrations.
- [x] Request fresh code review; fix material findings with RED/GREEN tests.
- [x] Report changes/evidence/deferred integrations without committing.
