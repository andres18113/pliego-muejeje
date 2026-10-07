-- Checkout receipts are append-only. Capture the accepted quote on INSERT,
-- rather than completing it with UPDATE after the business command.
CREATE OR REPLACE PROCEDURE pliego.sp_checkout_quoted(IN p_actor BIGINT,IN p_key UUID,
 IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,IN p_quote VARCHAR,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,
 OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT; active_cart BIGINT; accepted VARCHAR;
 receipt pliego.checkout_attempt%ROWTYPE; mode VARCHAR:=COALESCE(p_fulfillment,'HOME_DELIVERY');
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF p_quote IS NOT NULL AND p_quote !~ '^[0-9a-f]{64}$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('checkout:'||p_actor||':'||p_key,0));
 SELECT * INTO receipt FROM pliego.checkout_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
 IF FOUND THEN
  IF receipt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
  IF receipt.quote_fingerprint IS DISTINCT FROM p_quote
  OR receipt.address_id IS DISTINCT FROM p_address OR receipt.payment_method IS DISTINCT FROM p_method
  OR receipt.simulation_outcome IS DISTINCT FROM p_outcome OR receipt.cart_id IS DISTINCT FROM p_cart
  OR receipt.fulfillment_method IS DISTINCT FROM mode OR receipt.pickup_location_id IS DISTINCT FROM p_pickup THEN
   PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;
  o_order_id:=receipt.order_id; o_order_state:=receipt.order_state;
  o_payment_state:=receipt.payment_state; o_total:=receipt.total; o_payment_reference:=receipt.payment_reference;
  RETURN;
 END IF;
 IF p_cart IS NOT NULL OR p_quote IS NOT NULL THEN
  SELECT carrito_id INTO active_cart FROM pliego.carrito
   WHERE cliente_id=customer AND estado='ACTIVE' FOR UPDATE;
  IF active_cart IS NULL OR (p_cart IS NOT NULL AND active_cart<>p_cart) THEN
   PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE'); END IF;
 END IF;
 IF p_quote IS NOT NULL THEN
  PERFORM e.edicion_id FROM pliego.carrito_item ci
   JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id
   JOIN pliego.libro l ON l.libro_id=e.libro_id
   WHERE ci.carrito_id=active_cart ORDER BY e.edicion_id FOR SHARE OF e,l;
  SELECT quote_fingerprint INTO accepted FROM pliego.fn_cart_checkout_quote(p_actor);
  IF accepted IS DISTINCT FROM p_quote THEN
   PERFORM pliego.fn_raise_domain_error('P4005','CART_QUOTE_CHANGED'); END IF;
 END IF;
 CALL pliego.sp_checkout(p_actor,p_address,p_method,p_outcome,mode,p_pickup,
  o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 INSERT INTO pliego.checkout_attempt(actor_user_id,attempt_key,state,address_id,cart_id,
  payment_method,simulation_outcome,order_id,order_state,payment_state,total,payment_reference,
  fulfillment_method,pickup_location_id,quote_fingerprint)
 VALUES(p_actor,p_key,'CREATED',p_address,p_cart,p_method,p_outcome,o_order_id,
  o_order_state,o_payment_state,o_total,o_payment_reference,mode,p_pickup,p_quote);
END;
$$;
