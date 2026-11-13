-- Separate account billing identity from the invoice recipient snapshot (ADR-0043).
-- Add nullable first so historical invoices stay NULL; only future inserts use the default.
ALTER TABLE pliego.factura ADD COLUMN destinatario_tipo VARCHAR(8);
ALTER TABLE pliego.factura
 ADD CONSTRAINT ck_factura_destinatario_tipo CHECK(destinatario_tipo IS NULL OR destinatario_tipo IN('ACCOUNT','OTHER'));
ALTER TABLE pliego.factura ALTER COLUMN destinatario_tipo SET DEFAULT 'ACCOUNT';
CREATE INDEX ix_factura_account_recipient_pedido ON pliego.factura(pedido_id)
 WHERE destinatario_tipo IS NULL OR destinatario_tipo='ACCOUNT';

-- Usage follows the account across identity changes. OTHER-only invoices do not count.
CREATE OR REPLACE FUNCTION pliego.fn_customer_has_account_billed_invoice(p_customer BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT EXISTS (
  SELECT 1 FROM pliego.pedido p JOIN pliego.factura f ON f.pedido_id=p.pedido_id
  WHERE p.cliente_id=p_customer AND (f.destinatario_tipo='ACCOUNT' OR f.destinatario_tipo IS NULL)
 );
$$;

CREATE OR REPLACE PROCEDURE pliego.sp_checkout_billed_quoted(IN p_actor BIGINT,IN p_key UUID,
 IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,IN p_quote VARCHAR,IN p_recipient_kind VARCHAR,
 IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,IN p_buyer_name VARCHAR,
 IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,IN p_country VARCHAR,IN p_postal VARCHAR,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,
 OUT o_payment_reference VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE fingerprint VARCHAR; legacy_fingerprint VARCHAR; previous VARCHAR; email VARCHAR;
 receipt_exists BOOLEAN; receipt pliego.checkout_attempt%ROWTYPE; customer BIGINT; identity_matches BOOLEAN;
 recipient_kind TEXT:=COALESCE(p_recipient_kind,'ACCOUNT');
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF recipient_kind NOT IN('ACCOUNT','OTHER') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('checkout:'||p_actor||':'||p_key,0));
 legacy_fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_identity_type,btrim(p_identity_number),
  btrim(p_buyer_name),btrim(p_line1),NULLIF(btrim(p_line2),''),btrim(p_city),btrim(p_province),
  upper(btrim(p_country)),NULLIF(btrim(p_postal),''))::TEXT,'UTF8')),'hex');
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(recipient_kind,p_identity_type,btrim(p_identity_number),
  btrim(p_buyer_name),btrim(p_line1),NULLIF(btrim(p_line2),''),btrim(p_city),btrim(p_province),
  upper(btrim(p_country)),NULLIF(btrim(p_postal),''))::TEXT,'UTF8')),'hex');
 SELECT * INTO receipt FROM pliego.checkout_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
 receipt_exists:=FOUND;
 SELECT payload_fingerprint INTO previous FROM pliego.checkout_billing_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
 IF receipt_exists AND previous IS DISTINCT FROM fingerprint
  AND NOT(recipient_kind='ACCOUNT' AND previous IS NOT DISTINCT FROM legacy_fingerprint)
  AND NOT EXISTS(SELECT FROM pliego.checkout_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key AND state='NOT_CREATED') THEN
  PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;
 IF receipt_exists THEN
  IF receipt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
  IF receipt.quote_fingerprint IS DISTINCT FROM p_quote OR receipt.address_id IS DISTINCT FROM p_address
   OR receipt.payment_method IS DISTINCT FROM p_method OR receipt.simulation_outcome IS DISTINCT FROM p_outcome
   OR receipt.cart_id IS DISTINCT FROM p_cart OR receipt.fulfillment_method IS DISTINCT FROM COALESCE(p_fulfillment,'HOME_DELIVERY')
   OR receipt.pickup_location_id IS DISTINCT FROM p_pickup THEN PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;
  o_order_id:=receipt.order_id;o_order_state:=receipt.order_state;o_payment_state:=receipt.payment_state;
  o_total:=receipt.total;o_payment_reference:=receipt.payment_reference;
  SELECT factura_id INTO o_invoice_id FROM pliego.factura WHERE pedido_id=o_order_id;
  RETURN;
 END IF;
 IF NOT pliego.fn_is_valid_ec_identification(p_identity_type,p_identity_number)
  OR p_buyer_name IS NULL OR char_length(btrim(p_buyer_name)) NOT BETWEEN 1 AND 240
  OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200 OR char_length(p_line2)>200
  OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 1 AND 100
  OR p_province IS NULL OR char_length(btrim(p_province)) NOT BETWEEN 1 AND 100
  OR p_country IS NULL OR NOT pliego.fn_is_valid_country_code(upper(btrim(p_country))) OR char_length(p_postal)>20 THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF recipient_kind='ACCOUNT' THEN
  CALL pliego.sp_customer_identity_claim(customer,p_identity_type,p_identity_number,'CHECKOUT',identity_matches);
  IF NOT identity_matches THEN PERFORM pliego.fn_raise_domain_error('P1106','BILLING_IDENTITY_MISMATCH'); END IF;
 END IF;
 CALL pliego.sp_checkout_quoted(p_actor,p_key,p_address,p_method,p_outcome,p_cart,p_fulfillment,p_pickup,p_quote,
  o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 INSERT INTO pliego.checkout_billing_attempt VALUES(p_actor,p_key,fingerprint);
 IF o_payment_state='REJECTED' THEN RETURN; END IF;
 SELECT email_normalizado INTO email FROM pliego.usuario WHERE usuario_id=p_actor;
 INSERT INTO pliego.factura(pedido_id,numero_documento,estado,comprador_nombre,identidad_tipo,identidad_numero,comprador_email,
  subtotal,impuesto_total,total,usuario_emisor_id,impuesto_tasa,envio_monto,destinatario_tipo,procedencia,emisor_nombre,
  emisor_identificacion,emisor_direccion,establecimiento,punto_emision)
 SELECT p.pedido_id,'DRAFT-'||p.pedido_id,'DRAFT',btrim(p_buyer_name),
  CASE p_identity_type WHEN 'EC_RUC' THEN 'TAX_ID' ELSE 'NATIONAL_ID' END,btrim(p_identity_number),email,
  p.subtotal,p.impuesto_monto,p.total,p_actor,p.impuesto_tasa,p.envio_monto,recipient_kind,'SIMULATED',
  'PLIEGO - EMISOR ACADEMICO','9999999999001','Entorno academico sin validez tributaria','999','999'
 FROM pliego.pedido p WHERE p.pedido_id=o_order_id RETURNING factura_id INTO o_invoice_id;
 INSERT INTO pliego.factura_direccion VALUES(o_invoice_id,btrim(p_line1),NULLIF(btrim(p_line2),''),
  btrim(p_city),btrim(p_province),upper(btrim(p_country)),NULLIF(btrim(p_postal),''));
 INSERT INTO pliego.factura_item(factura_id,pedido_item_id,descripcion,cantidad,precio_unitario,subtotal,
  tratamiento_impuesto,impuesto_tasa,impuesto_monto,total)
 SELECT o_invoice_id,pedido_item_id,titulo_snapshot,cantidad,precio_unitario,subtotal,'ASSESSED',
  impuesto_tasa,impuesto_monto,subtotal+impuesto_monto
 FROM pliego.pedido_item WHERE pedido_id=o_order_id ORDER BY pedido_item_id;
 CALL pliego.sp_invoice_finalize_for_order(p_actor,o_order_id,o_invoice_id);
END; $$;
-- Retain the existing 18-input Database API signature for V079 callers and old gates.
-- It delegates to the new atomic command with ACCOUNT semantics.
CREATE OR REPLACE PROCEDURE pliego.sp_checkout_billed_quoted(IN p_actor BIGINT,IN p_key UUID,
 IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,IN p_quote VARCHAR,
 IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,IN p_buyer_name VARCHAR,
 IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,IN p_country VARCHAR,IN p_postal VARCHAR,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,
 OUT o_payment_reference VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 CALL pliego.sp_checkout_billed_quoted(p_actor,p_key,p_address,p_method,p_outcome,p_cart,p_fulfillment,p_pickup,p_quote,
  'ACCOUNT',p_identity_type,p_identity_number,p_buyer_name,p_line1,p_line2,p_city,p_province,p_country,p_postal,
  o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference,o_invoice_id);
END; $$;
