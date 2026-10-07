# ADR-0029: Six minute cancellation window for digital and pickup orders

## Status

Accepted

## Date

2026-10-06

## Context

Paid digital and STORE_PICKUP orders need the same short customer cancellation window. The deadline, cancellation decision, digital grant revocation, and pickup transition must survive restarts and remain consistent across API readers and scheduled processing.

## Decision

PostgreSQL stores the six minute deadline and finalization timestamp on the existing order. Checkout starts the deadline once payment approval and the authoritative order/fulfillment type are both recorded. The existing cancellation procedure checks the deadline while holding the order lock. The existing HOME_DELIVERY scheduler invokes a batch reconciler for due digital and pickup orders, and order reads reconcile individual due orders before projecting state.

Digital grants remain immediate and idempotent. Cancellation during the window uses the current refund and grant revocation transaction. After the deadline, digital purchases project as completed. STORE_PICKUP enters the existing PREPARING order state and retains its pickup snapshot and collection flow.

## Consequences

- Deadline enforcement and recovery remain database-owned and do not depend on browser timers.
- Mi biblioteca can show the purchased item immediately; a successful cancellation revokes that grant through existing triggers.
- The existing scheduled worker now advances two database-owned purchase lifecycles.
- Orders created before this migration have no new deadline and keep their existing cancellation behavior.

## Validation

PostgreSQL gates cover cancellation inside and after the window, grant and refund history, pickup preparation, restart-style batch reconciliation, and idempotent retries. HTTP/OpenAPI and frontend contract tests verify the projected lifecycle and capabilities.
