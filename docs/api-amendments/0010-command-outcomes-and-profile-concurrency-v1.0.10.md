# REST / Database API amendment v1.0.10 — P1 integrity

2026-10-04. Amends approved baselines and v1.0.9; authoritative artifacts and V001–V035 remain unchanged. See ADR-0018.

## Checkout and address creation

`POST /api/v1/checkout` and `POST /api/v1/me/addresses` now require an `Idempotency-Key` UUID header. Scope is authenticated JWT subject + operation + key. Missing/malformed keys return 400 with Spanish feedback; authentication/authorization remains unchanged. Clients generate and persist the key before sending, use exactly the same input for replay, and retain it after a lost response. Do not mint a new key while the result remains unresolved. The frontend serializes cross-tab claims with native Web Locks, rechecks pending metadata within the lock, and fails closed if coordination/storage is unavailable. Each UUID retains an independent recovery record; async callbacks never switch to another tab’s key.

The key, command fingerprint and original receipt commit atomically with business effects. Identical replay returns the original 201 body (and original checkout Location). It never creates another order, consumes another cart, repeats stock/payment/history changes, changes the primary address again, or recreates an address deleted after creation. Reuse with different business inputs returns P1010/409. Card numbers remain transient and are excluded from the stored fingerprint/result; CVV/expiry/cardholder are never sent to PostgreSQL. The address fingerprint is SHA-256 over the typed request values, including optional values and makePrimary.

Checkout accepts optional `expectedCartId` (decimal BIGINT string); the frontend supplies the reviewed cart ID. PostgreSQL locks and checks that this is still the active cart before executing, returning the existing P4001/409 otherwise. The existing stock, order snapshots, payment simulation, rejection/cancellation and fulfillment procedures remain delegates within the same Spring transaction.

Exact attempt resolution:

- `POST /api/v1/checkout/attempts/{key}/resolve` → 200 `{ "state": "PENDING|CREATED|NOT_CREATED", "order": null|<original CheckoutResponse> }`.
- `POST /api/v1/me/addresses/attempts/{key}/resolve` → 200 `{ "state": "PENDING|CREATED|NOT_CREATED", "addressId": null|"decimal ID" }`.

Resolution is a command because it can write a permanent fence. It uses the same transaction-scoped lock as execution. When that lock is held, PENDING is authoritative uncertainty, without declaring purchase failure or permitting a new attempt. When it acquires the lock, it reads the committed original receipt, or records NOT_CREATED. A delayed original command using a fenced key is rejected with P1011/409 and cannot later create an order/address. Errors, malformed resolution responses, lost resolution responses and session expiration retain the recovery key. Retry resolution; do not infer failure from an empty order/address list, age, amount, ID ordering or another recent order.

GET lists remain informational and are never outcome resolvers. Repeated resolutions are safe. An actor cannot see another actor's attempt; the same UUID has independent scope per actor. Ledgers and terminal fences have no expiry; pruning requires a future explicit replay/retention policy.

## Precise profile updates

`GET /api/v1/me` adds required `version`, a nonnegative decimal BIGINT string. A trigger increments this monotonic value whenever names/phone actually change, including legacy SQL routine calls. Email change retains its existing separate contract.

`PATCH /api/v1/me` accepts `{ "field": "firstNames|lastNames|phone", "value": "text"|null, "expectedVersion": "decimal version" }`, returning 204. All three properties are required; null clears only phone. Names must remain nonempty and within 120 characters; existing phone normalization/validation remains authoritative in PostgreSQL. The routine locks the customer row, compares the supplied version, then passes the selected field plus current locked values of untouched fields to the existing update procedure.

Replacement `PUT /api/v1/me` also requires `expectedVersion` alongside its existing fields and uses the same locked version check. Neither route silently overwrites a newer profile. Missing/invalid versions return 400; mismatches return P1104/409 with friendly Spanish feedback and no changes. Compare-and-set catches ABA changes as well as ordinary stale reads.

The editor captures the original profile/version when opened. Background refresh and conflict reconciliation cannot silently advance that version. Preserve the draft; require cancelling/reopening to review current state before a new save. After a lost response, a successful read matching the edited field with an advanced version confirms the current desired state; untouched fields are not compared or resent. A retry carrying the original version cannot overwrite a concurrent later write.

## Database API and migration

V036 adds typed immutable `pliego.checkout_attempt` and `pliego.address_create_attempt` ledgers, plus `cliente.profile_version` and its monotonic trigger. Public routines:

- `sp_checkout_idempotent(actor,key,address,method,outcome,expectedCartId,OUT original checkout fields)`.
- `fn_checkout_resolve(actor,key)`.
- `sp_address_create_idempotent(actor,key,existing address inputs,OUT addressId)`.
- `fn_address_create_resolve(actor,key)`.
- `fn_customer_profile_versioned(actor)`.
- `sp_customer_update_versioned(actor,expectedVersion,firstNames,lastNames,phone)`.
- `sp_customer_patch(actor,expectedVersion,field,value)`.

New SQLSTATE mappings: P1010 = idempotency conflict / 409, P1011 = fenced attempt / 409, P1104 = profile version conflict / 409. Approved mappings remain stable. Controllers/services contain no business SQL. Spring remains the transaction owner. CORS allows PATCH and Idempotency-Key.

## Development payment disclosure

Payment approval remains deterministic and simulated. Checkout visibly states that no real charge occurs, labels the action “Simular compra”, marks card inputs as test-only with simulated approval, disables payment autofill, and says not to transfer money. Existing validation and development/test CARD/TRANSFER behavior remains unchanged. These controls do not activate a payment processor.

## Regression evidence

Four RED component regressions reproduced false checkout absence, repeat address POST, stale field resubmission and missing simulation disclosure. RED live HTTP tests reproduced address duplication, stale replacement overwrites and unavailable checkout replay. Gates include open-transaction commit/rollback, early resolver fencing, actor isolation, concurrent replay, stock/payment effects, later-cart protection, deleted addresses, racing profile updates/ABA, browser recovery and preserved drafts. See the P1 plan and verification record for executed commands/results.
