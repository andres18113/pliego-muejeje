-- Additive accepted-quote contract. Historical routines and receipts remain valid.
ALTER TABLE pliego.checkout_attempt ADD COLUMN quote_fingerprint VARCHAR(64)
 CHECK (quote_fingerprint IS NULL OR quote_fingerprint ~ '^[0-9a-f]{64}$');

CREATE FUNCTION pliego.fn_cart_checkout_quote(p_actor BIGINT)
RETURNS TABLE(cart_id BIGINT,state VARCHAR,items JSONB,total_current NUMERIC(30,2),
 subtotal NUMERIC(30,2),tax_rate NUMERIC(7,4),tax_amount NUMERIC(30,2),
 shipping_amount NUMERIC(30,2),total NUMERIC(30,2),original_subtotal NUMERIC(30,2),
 savings_total NUMERIC(30,2),current_subtotal NUMERIC(30,2),quote_fingerprint TEXT)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 WITH q AS MATERIALIZED (SELECT * FROM pliego.fn_cart_offer_quote(p_actor))
 SELECT q.*,encode(sha256(convert_to(jsonb_build_object(
  'version',1,'actor',p_actor,'cartId',q.cart_id,
  'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'editionId',(item->>'editionId')::BIGINT,'format',item->>'format',
   'quantity',(item->>'quantity')::INTEGER,'price',(item->>'currentPrice')::NUMERIC(11,2),
   'subtotal',(item->>'currentSubtotal')::NUMERIC(30,2),
   'originalPrice',(item->>'originalPrice')::NUMERIC(11,2),
   'unitSavings',(item->>'unitSavings')::NUMERIC(11,2),
   'originalSubtotal',(item->>'originalSubtotal')::NUMERIC(30,2),
   'lineSavings',(item->>'lineSavings')::NUMERIC(30,2))
   ORDER BY (item->>'editionId')::BIGINT) FROM jsonb_array_elements(q.items) item),'[]'::JSONB),
  'subtotal',q.subtotal,'taxRate',q.tax_rate,'taxAmount',q.tax_amount,
  'shippingAmount',q.shipping_amount,'total',q.total,
  'originalSubtotal',q.original_subtotal,'savingsTotal',q.savings_total
 )::TEXT,'UTF8')),'hex') FROM q;
$$;

CREATE PROCEDURE pliego.sp_checkout_quoted(IN p_actor BIGINT,IN p_key UUID,
 IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,IN p_quote VARCHAR,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,
 OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT; active_cart BIGINT; accepted VARCHAR; receipt pliego.checkout_attempt%ROWTYPE;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF p_quote IS NOT NULL AND p_quote !~ '^[0-9a-f]{64}$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('checkout:'||p_actor||':'||p_key,0));
 SELECT * INTO receipt FROM pliego.checkout_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
 IF FOUND THEN
  IF receipt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
  IF receipt.quote_fingerprint IS DISTINCT FROM p_quote THEN
   PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;
 ELSIF p_quote IS NOT NULL THEN
  SELECT carrito_id INTO active_cart FROM pliego.carrito
   WHERE cliente_id=customer AND estado='ACTIVE' FOR UPDATE;
  IF active_cart IS NULL OR (p_cart IS NOT NULL AND active_cart<>p_cart) THEN
   PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE'); END IF;
  -- Cart mutations take this same cart lock. Offer/catalog writes take exclusive
  -- edition locks; retain ordered shared master locks through effect capture.
  PERFORM e.edicion_id FROM pliego.carrito_item ci
   JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id
   JOIN pliego.libro l ON l.libro_id=e.libro_id
   WHERE ci.carrito_id=active_cart ORDER BY e.edicion_id FOR SHARE OF e,l;
  SELECT quote_fingerprint INTO accepted FROM pliego.fn_cart_checkout_quote(p_actor);
  IF accepted IS DISTINCT FROM p_quote THEN
   PERFORM pliego.fn_raise_domain_error('P4005','CART_QUOTE_CHANGED'); END IF;
 END IF;
 CALL pliego.sp_checkout_idempotent(p_actor,p_key,p_address,p_method,p_outcome,p_cart,
  p_fulfillment,p_pickup,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 IF p_quote IS NOT NULL THEN
  UPDATE pliego.checkout_attempt SET quote_fingerprint=p_quote
   WHERE actor_user_id=p_actor AND attempt_key=p_key AND quote_fingerprint IS NULL;
 END IF;
END;
$$;
COMMENT ON PROCEDURE pliego.sp_checkout_quoted(BIGINT,UUID,BIGINT,VARCHAR,VARCHAR,BIGINT,VARCHAR,BIGINT,VARCHAR) IS
 'Checks DB-owned accepted quantities/prices under cart/master locks before effects. Replays compare the original accepted fingerprint without reading the live cart. Null fingerprint retains the historical current-quote contract.';
