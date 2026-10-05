# ADR0025 — Edition offers and authoritative current pricing

Status: accepted for the functional integration pass.

PLIEGO had a single edition price and authoritative PostgreSQL tax, checkout and historical monetary snapshots, but no offer domain. V044 adds one replaceable, scheduled fixed-price offer per edition, across physical, eBook and audiobook formats. No coupons, stacking, trade-in conditions, digital entitlement or fulfillment capabilities are introduced.

The public Database API owns offer eligibility, scheduling, savings, catalog filtering, ordering, facets, cart quotes and checkout prices. An offer applies only while active, within `[startsAt, endsAt)`, and below the current base price. Reducing a base price below an offer suppresses that offer. The same effective unit price drives existing line tax rounding and immutable order/payment/invoice values. Existing checkout idempotency replays the original order without repricing.

Offer writes require ADMIN and acquire the edition master lock already used by checkout, preventing an offer mutation from racing an order snapshot. Spring retains transaction boundaries; Java controllers/services contain no business SQL.

Days remaining use calendar dates in `America/Guayaquil`, calculated by the database from the current statement time and end time, clamped to zero. `endingSoon` means three or fewer calendar days; `fn_offer_ending_soon_days` is the single threshold source, also exposed with the timezone in public facets. Public timestamps use the Ecuador offset. Date counting is never delegated to browser clocks.

Offers use server pagination, type/category filters and deterministic ordering. `RELEVANCE` orders by savings amount descending, then end time and edition ID ascending. `ENDING_SOON` orders by end time then edition ID. Price sorts use the effective price then edition ID. Public facets include only types/categories backed by current public active offers, with distinct edition counts and existing parent categories.

Base/current/savings amounts and percentages remain two-decimal strings in REST. `offer.effectivePrice` equals edition `price`; `savingsAmount` aliases existing `discountAmount`. The database rounds savings percentage to two decimals. Optional `offerCopy` and `terms` are authored data; clients must not fabricate promotional claims or duplicate price/eligibility/calendar calculations.

V001–V043 and approved baselines remain immutable. V044 explicitly updates existing query/checkout routines while retaining the approved physical/digital and monetary behavior.
