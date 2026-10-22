-- One validated cédula per customer account, required to buy (ADR 0040).
-- PLIEGO checks format and check digit only, never ownership, so a typo can pass validation:
-- the number is not freely editable and cannot be removed, but it can be corrected through an
-- explicit, re-authenticated and audited command. Issued invoices keep their own snapshot.

CREATE TABLE pliego.cliente_identificacion_evento (
 evento_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_id BIGINT NOT NULL REFERENCES pliego.cliente(cliente_id),
 accion VARCHAR(16) NOT NULL CHECK(accion IN ('REGISTERED','CORRECTED')),
 origen VARCHAR(16) NOT NULL CHECK(origen IN ('PROFILE','CHECKOUT','MIGRATION')),
 identidad_tipo VARCHAR(16) NOT NULL CHECK(identidad_tipo='EC_CEDULA'),
 numero_anterior VARCHAR(10) CHECK(numero_anterior IS NULL OR pliego.fn_is_valid_ec_cedula(numero_anterior)),
 numero_nuevo VARCHAR(10) NOT NULL CHECK(pliego.fn_is_valid_ec_cedula(numero_nuevo)),
 creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK((accion='REGISTERED') = (numero_anterior IS NULL)),
 CHECK(numero_anterior IS DISTINCT FROM numero_nuevo)
);
CREATE INDEX ix_cliente_identificacion_evento_cliente ON pliego.cliente_identificacion_evento(cliente_id,evento_id);
CREATE TRIGGER trg_cliente_identificacion_evento_immutable BEFORE UPDATE OR DELETE ON pliego.cliente_identificacion_evento
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo,numero_nuevo)
SELECT cliente_id,'REGISTERED','MIGRATION',identidad_tipo,identidad_numero FROM pliego.cliente_identificacion ORDER BY cliente_id;

-- The stored cédula is never deleted, and changes only inside the correction command, which marks
-- its own transaction for the one customer it corrects.
CREATE FUNCTION pliego.fn_guard_customer_identity() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
  OR current_setting('pliego.identity_correction',true) IS DISTINCT FROM OLD.cliente_id::TEXT THEN
  RAISE EXCEPTION USING ERRCODE='P9001', MESSAGE='IMMUTABLE_HISTORY_VIOLATION';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_cliente_identificacion_guard BEFORE UPDATE OR DELETE ON pliego.cliente_identificacion
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_customer_identity();

-- Internal: bind the first cédula to a customer, or report whether the stored one matches.
-- Concurrent first registrations serialize on the primary key; FOR SHARE keeps a concurrent
-- correction waiting until the caller's transaction (e.g. an invoice snapshot) commits.
CREATE PROCEDURE pliego.sp_customer_identity_claim(IN p_customer BIGINT,IN p_type VARCHAR,IN p_number VARCHAR,IN p_origin VARCHAR,OUT o_matches BOOLEAN)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE value TEXT:=btrim(p_number); stored TEXT; inserted INTEGER;
BEGIN
 IF p_type IS DISTINCT FROM 'EC_CEDULA' OR NOT pliego.fn_is_valid_ec_cedula(value) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 INSERT INTO pliego.cliente_identificacion(cliente_id,identidad_tipo,identidad_numero) VALUES(p_customer,p_type,value)
 ON CONFLICT(cliente_id) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=1 THEN
  INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo,numero_nuevo)
  VALUES(p_customer,'REGISTERED',p_origin,p_type,value);
  o_matches:=TRUE; RETURN;
 END IF;
 SELECT identidad_numero INTO stored FROM pliego.cliente_identificacion WHERE cliente_id=p_customer FOR SHARE;
 o_matches:=stored=value;
END; $$;

-- The free upsert and the removal of V071 are retired: neither may change a stored cédula.
DROP PROCEDURE pliego.sp_customer_billing_identity_remove(BIGINT);
DROP PROCEDURE pliego.sp_customer_billing_identity_set(BIGINT,VARCHAR,VARCHAR);

-- Registering the same number again is a no-op, so a lost reply can be retried safely.
-- A different stored number is a conflict: changing it is a correction.
CREATE PROCEDURE pliego.sp_customer_billing_identity_register(IN p_actor BIGINT,IN p_type VARCHAR,IN p_number VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT; matches BOOLEAN;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 CALL pliego.sp_customer_identity_claim(customer,p_type,p_number,'PROFILE',matches);
 IF NOT matches THEN PERFORM pliego.fn_raise_domain_error('P1105','BILLING_IDENTITY_CONFLICT'); END IF;
END; $$;

-- Compare-and-set against the number the customer saw. The backend re-authenticates the
-- customer before calling; every correction is recorded with the previous number.
CREATE PROCEDURE pliego.sp_customer_billing_identity_correct(IN p_actor BIGINT,IN p_type VARCHAR,IN p_expected_number VARCHAR,IN p_number VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT; value TEXT:=btrim(p_number); stored TEXT;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF p_type IS DISTINCT FROM 'EC_CEDULA' OR NOT pliego.fn_is_valid_ec_cedula(value) OR p_expected_number IS NULL THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 SELECT identidad_numero INTO stored FROM pliego.cliente_identificacion WHERE cliente_id=customer FOR UPDATE;
 IF stored IS NULL OR stored<>btrim(p_expected_number) THEN
  PERFORM pliego.fn_raise_domain_error('P1105','BILLING_IDENTITY_CONFLICT'); END IF;
 IF stored=value THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 PERFORM set_config('pliego.identity_correction',customer::TEXT,true);
 UPDATE pliego.cliente_identificacion SET identidad_tipo=p_type,identidad_numero=value WHERE cliente_id=customer;
 PERFORM set_config('pliego.identity_correction','',true);
 INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo,numero_anterior,numero_nuevo)
 VALUES(customer,'CORRECTED','PROFILE',p_type,stored,value);
END; $$;

-- Forward definition of V072: a new billed purchase must use the customer's own cédula.
-- Without one, the validated number typed at checkout becomes it, in the same transaction.
CREATE OR REPLACE PROCEDURE pliego.sp_checkout_billed_quoted(IN p_actor BIGINT,IN p_key UUID,
 IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,IN p_quote VARCHAR,
 IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,IN p_buyer_name VARCHAR,
 IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,IN p_country VARCHAR,IN p_postal VARCHAR,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE fingerprint VARCHAR; previous VARCHAR; email VARCHAR; receipt_exists BOOLEAN; receipt pliego.checkout_attempt%ROWTYPE;
 customer BIGINT; identity_matches BOOLEAN;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('checkout:'||p_actor||':'||p_key,0));
 -- Typed normalized fiscal values participate in idempotency independently of quote prices.
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_identity_type,btrim(p_identity_number),btrim(p_buyer_name),btrim(p_line1),NULLIF(btrim(p_line2),''),btrim(p_city),btrim(p_province),upper(btrim(p_country)),NULLIF(btrim(p_postal),''))::TEXT,'UTF8')),'hex');
 SELECT * INTO receipt FROM pliego.checkout_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
 receipt_exists:=FOUND;
 SELECT payload_fingerprint INTO previous FROM pliego.checkout_billing_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
 IF receipt_exists AND previous IS DISTINCT FROM fingerprint AND NOT EXISTS(SELECT FROM pliego.checkout_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key AND state='NOT_CREATED') THEN
  PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;
 IF receipt_exists THEN
  IF receipt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
  IF receipt.quote_fingerprint IS DISTINCT FROM p_quote OR receipt.address_id IS DISTINCT FROM p_address
   OR receipt.payment_method IS DISTINCT FROM p_method OR receipt.simulation_outcome IS DISTINCT FROM p_outcome
   OR receipt.cart_id IS DISTINCT FROM p_cart OR receipt.fulfillment_method IS DISTINCT FROM COALESCE(p_fulfillment,'HOME_DELIVERY')
   OR receipt.pickup_location_id IS DISTINCT FROM p_pickup THEN PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;
  o_order_id:=receipt.order_id; o_order_state:=receipt.order_state; o_payment_state:=receipt.payment_state;
  o_total:=receipt.total; o_payment_reference:=receipt.payment_reference;
  SELECT factura_id INTO o_invoice_id FROM pliego.factura WHERE pedido_id=o_order_id;
  RETURN;
 END IF;
 IF p_identity_type IS DISTINCT FROM 'EC_CEDULA' OR NOT pliego.fn_is_valid_ec_cedula(p_identity_number)
  OR p_buyer_name IS NULL OR char_length(btrim(p_buyer_name)) NOT BETWEEN 1 AND 240
  OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200 OR char_length(p_line2)>200
  OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 1 AND 100
  OR p_province IS NULL OR char_length(btrim(p_province)) NOT BETWEEN 1 AND 100
  OR p_country IS NULL OR NOT pliego.fn_is_valid_country_code(upper(btrim(p_country))) OR char_length(p_postal)>20 THEN
   PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 CALL pliego.sp_customer_identity_claim(customer,p_identity_type,p_identity_number,'CHECKOUT',identity_matches);
 IF NOT identity_matches THEN PERFORM pliego.fn_raise_domain_error('P1106','BILLING_IDENTITY_MISMATCH'); END IF;
 CALL pliego.sp_checkout_quoted(p_actor,p_key,p_address,p_method,p_outcome,p_cart,p_fulfillment,p_pickup,p_quote,
 o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 INSERT INTO pliego.checkout_billing_attempt VALUES(p_actor,p_key,fingerprint);
 IF o_payment_state='REJECTED' THEN RETURN; END IF;
 SELECT email_normalizado INTO email FROM pliego.usuario WHERE usuario_id=p_actor;
 INSERT INTO pliego.factura(pedido_id,numero_documento,estado,comprador_nombre,identidad_tipo,identidad_numero,comprador_email,
 subtotal,impuesto_total,total,usuario_emisor_id,impuesto_tasa,envio_monto,procedencia,emisor_nombre,emisor_identificacion,emisor_direccion,establecimiento,punto_emision)
 SELECT p.pedido_id,'DRAFT-'||p.pedido_id,'DRAFT',btrim(p_buyer_name),'NATIONAL_ID',btrim(p_identity_number),email,
 p.subtotal,p.impuesto_monto,p.total,p_actor,p.impuesto_tasa,p.envio_monto,'SIMULATED','PLIEGO - EMISOR ACADEMICO','9999999999001','Entorno academico sin validez tributaria','999','999'
 FROM pliego.pedido p WHERE pedido_id=o_order_id RETURNING factura_id INTO o_invoice_id;
 INSERT INTO pliego.factura_direccion VALUES(o_invoice_id,btrim(p_line1),NULLIF(btrim(p_line2),''),btrim(p_city),btrim(p_province),upper(btrim(p_country)),NULLIF(btrim(p_postal),''));
 INSERT INTO pliego.factura_item(factura_id,pedido_item_id,descripcion,cantidad,precio_unitario,subtotal,tratamiento_impuesto,impuesto_tasa,impuesto_monto,total)
 SELECT o_invoice_id,pedido_item_id,titulo_snapshot,cantidad,precio_unitario,subtotal,'ASSESSED',impuesto_tasa,impuesto_monto,subtotal+impuesto_monto
 FROM pliego.pedido_item WHERE pedido_id=o_order_id ORDER BY pedido_item_id;
 CALL pliego.sp_invoice_finalize_for_order(p_actor,o_order_id,o_invoice_id);
END; $$;
