-- Planner metadata only. Do not change bodies, volatility, security, transaction
-- boundaries or the digital-purchase/reconciliation locks introduced in V076/077.
-- A TABLE return type does not imply 1000 rows: these lookups/projections return
-- one row (or no row for a missing identity), including their internal wrappers.
-- Keep the default function COST; correcting cardinality removes the artificial
-- cross-product that otherwise crosses PostgreSQL's default JIT thresholds.
ALTER FUNCTION pliego.fn_assert_actor(BIGINT, VARCHAR) ROWS 1;
ALTER FUNCTION pliego.fn_cart_get(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_cart_quote(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_cart_offer_quote(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_cart_checkout_quote(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_cart_checkout_requirements(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_cart_delivery_window(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_delivery_window_at(TIMESTAMPTZ) ROWS 1;
ALTER FUNCTION pliego.fn_edition_detail(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_edition_offer(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_order_pricing(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_order_offer_pricing(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_order_post_purchase(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_order_post_purchase_internal_v043(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_order_post_purchase_internal_v055(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_customer_order_detail(BIGINT, BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_customer_order_detail_priced(BIGINT, BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_customer_order_detail_internal_v017(BIGINT, BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_customer_order_detail_internal_v043(BIGINT, BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_customer_order_detail_internal_v055(BIGINT, BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_checkout_resolve(BIGINT, UUID) ROWS 1;
ALTER FUNCTION pliego.fn_address_create_resolve(BIGINT, UUID) ROWS 1;
ALTER FUNCTION pliego.fn_customer_profile(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_customer_profile_versioned(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_customer_profile_verified(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_customer_billing_identity(BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_user_auth_data(VARCHAR) ROWS 1;
ALTER FUNCTION pliego.fn_auth_session_refresh(VARCHAR, VARCHAR) ROWS 1;
ALTER FUNCTION pliego.fn_invoice_artifact_download(BIGINT, BIGINT, VARCHAR) ROWS 1;
ALTER FUNCTION pliego.fn_help_article(VARCHAR) ROWS 1;
ALTER FUNCTION pliego.fn_public_catalog_filter_facets() ROWS 1;
ALTER FUNCTION pliego.fn_public_catalog_filter_facets(VARCHAR) ROWS 1;

-- Pagination and eligibility/favorite batches are bounded to 50 by the Database
-- API. Use that conservative bound, not a singleton estimate for multirow data.
ALTER FUNCTION pliego.fn_customer_digital_eligibility(BIGINT, BIGINT[]) ROWS 50;
ALTER FUNCTION pliego.fn_customer_favorite_status(BIGINT, BIGINT[]) ROWS 50;
ALTER FUNCTION pliego.fn_customer_favorites(BIGINT, INTEGER, INTEGER) ROWS 50;
ALTER FUNCTION pliego.fn_customer_library(BIGINT, VARCHAR, INTEGER, INTEGER) ROWS 50;
ALTER FUNCTION pliego.fn_help_search(VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER) ROWS 50;

-- Keep existing estimates for the multirow catalog and order-list SRFs. Their
-- joined gateway plans are already below the JIT budget. Reducing those estimates
-- can reverse a hash join and disturb the order supplied by the paged reader;
-- that requires a separate explicit-order gateway change, outside this repair.
