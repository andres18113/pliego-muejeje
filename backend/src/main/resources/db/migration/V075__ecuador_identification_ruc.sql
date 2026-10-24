-- Ecuadorian identification for billing: the full cédula algorithm and the RUC (ADR 0041).
-- Algorithm validity only: no claim of existence, registration status or ownership.
--  Cédula: 10 digits, not all equal, province 01-24 or 30, third digit 0-5, modulo 10.
--  RUC (13 digits, same provinces):
--   third digit 0-5  natural person: a valid cédula + establishment 001-999;
--   third digit 6    public sector: modulo 11 (3,2,7,6,5,4,3,2) check at digit 9 + establishment 0001-9999;
--   third digit 9    private company: modulo 11 (4,3,2,7,6,5,4,3,2) check at digit 10 + establishment 001-999.
-- Only ASCII external spaces are trimmed. fn_is_valid_ec_cedula (V071) stays unchanged for history.
CREATE FUNCTION pliego.fn_is_valid_ec_identification(p_type TEXT,p_number TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER AS $$
DECLARE value TEXT:=btrim(p_number,' '); province INTEGER; third INTEGER; total INTEGER:=0; digit INTEGER; i INTEGER; check_digit INTEGER;
 natural_weights INTEGER[]:=ARRAY[2,1,2,1,2,1,2,1,2];
 public_weights INTEGER[]:=ARRAY[3,2,7,6,5,4,3,2];
 private_weights INTEGER[]:=ARRAY[4,3,2,7,6,5,4,3,2];
BEGIN
 IF p_type IS NULL OR value IS NULL OR p_type NOT IN ('EC_CEDULA','EC_RUC') THEN RETURN FALSE; END IF;
 IF (p_type='EC_CEDULA' AND value !~ '^[0-9]{10}$') OR (p_type='EC_RUC' AND value !~ '^[0-9]{13}$') THEN RETURN FALSE; END IF;
 province:=substr(value,1,2)::INTEGER; third:=substr(value,3,1)::INTEGER;
 IF NOT (province BETWEEN 1 AND 24 OR province=30) THEN RETURN FALSE; END IF;
 IF third<6 THEN
  IF substr(value,1,10) ~ '^([0-9])\1{9}$' THEN RETURN FALSE; END IF;
  FOR i IN 1..9 LOOP
   digit:=substr(value,i,1)::INTEGER*natural_weights[i];
   total:=total+CASE WHEN digit>9 THEN digit-9 ELSE digit END;
  END LOOP;
  IF (10-total%10)%10<>substr(value,10,1)::INTEGER THEN RETURN FALSE; END IF;
  RETURN p_type='EC_CEDULA' OR substr(value,11,3)<>'000';
 END IF;
 IF p_type<>'EC_RUC' THEN RETURN FALSE; END IF;
 IF third=6 THEN
  FOR i IN 1..8 LOOP total:=total+substr(value,i,1)::INTEGER*public_weights[i]; END LOOP;
  check_digit:=CASE 11-total%11 WHEN 11 THEN 0 ELSE 11-total%11 END;
  RETURN check_digit<10 AND check_digit=substr(value,9,1)::INTEGER AND substr(value,10,4)<>'0000';
 ELSIF third=9 THEN
  FOR i IN 1..9 LOOP total:=total+substr(value,i,1)::INTEGER*private_weights[i]; END LOOP;
  check_digit:=CASE 11-total%11 WHEN 11 THEN 0 ELSE 11-total%11 END;
  RETURN check_digit<10 AND check_digit=substr(value,10,1)::INTEGER AND substr(value,11,3)<>'000';
 END IF;
 RETURN FALSE;
END; $$;

-- The profile holds a cédula or a RUC. Rows stored before V075 keep their V071/V074 validity (NOT VALID);
-- every new or corrected value satisfies the full algorithm.
ALTER TABLE pliego.cliente_identificacion
 DROP CONSTRAINT cliente_identificacion_identidad_tipo_check,
 DROP CONSTRAINT cliente_identificacion_identidad_numero_check,
 ALTER COLUMN identidad_numero TYPE VARCHAR(13);
ALTER TABLE pliego.cliente_identificacion
 ADD CONSTRAINT ck_cliente_identificacion_tipo CHECK(identidad_tipo IN ('EC_CEDULA','EC_RUC')),
 ADD CONSTRAINT ck_cliente_identificacion_numero CHECK(identidad_numero=btrim(identidad_numero) AND pliego.fn_is_valid_ec_identification(identidad_tipo,identidad_numero)) NOT VALID;

-- A correction may change the kind of identification too; the audit keeps both kinds.
ALTER TABLE pliego.cliente_identificacion_evento
 DROP CONSTRAINT cliente_identificacion_evento_identidad_tipo_check,
 DROP CONSTRAINT cliente_identificacion_evento_numero_anterior_check,
 DROP CONSTRAINT cliente_identificacion_evento_numero_nuevo_check,
 ALTER COLUMN numero_anterior TYPE VARCHAR(13),
 ALTER COLUMN numero_nuevo TYPE VARCHAR(13),
 ADD COLUMN identidad_tipo_anterior VARCHAR(16);
ALTER TABLE pliego.cliente_identificacion_evento
 ADD CONSTRAINT ck_cliente_identificacion_evento_tipo CHECK(identidad_tipo IN ('EC_CEDULA','EC_RUC')),
 ADD CONSTRAINT ck_cliente_identificacion_evento_tipo_anterior CHECK(identidad_tipo_anterior IS NULL OR identidad_tipo_anterior IN ('EC_CEDULA','EC_RUC')),
 ADD CONSTRAINT ck_cliente_identificacion_evento_anterior CHECK(numero_anterior IS NULL OR numero_anterior ~ '^([0-9]{10}|[0-9]{13})$'),
 ADD CONSTRAINT ck_cliente_identificacion_evento_nuevo CHECK(pliego.fn_is_valid_ec_identification(identidad_tipo,numero_nuevo)) NOT VALID;
UPDATE pliego.cliente_identificacion_evento SET identidad_tipo_anterior='EC_CEDULA' WHERE accion='CORRECTED';
ALTER TABLE pliego.cliente_identificacion_evento
 ADD CONSTRAINT ck_cliente_identificacion_evento_tipo_anterior_presente CHECK((accion='CORRECTED')=(identidad_tipo_anterior IS NOT NULL)) NOT VALID;

CREATE OR REPLACE PROCEDURE pliego.sp_customer_identity_claim(IN p_customer BIGINT,IN p_type VARCHAR,IN p_number VARCHAR,IN p_origin VARCHAR,OUT o_matches BOOLEAN)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE value TEXT:=btrim(p_number,' '); stored_type TEXT; stored TEXT; inserted INTEGER;
BEGIN
 IF NOT pliego.fn_is_valid_ec_identification(p_type,p_number) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 INSERT INTO pliego.cliente_identificacion(cliente_id,identidad_tipo,identidad_numero) VALUES(p_customer,p_type,value)
 ON CONFLICT(cliente_id) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=1 THEN
  INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo,numero_nuevo)
  VALUES(p_customer,'REGISTERED',p_origin,p_type,value);
  o_matches:=TRUE; RETURN;
 END IF;
 SELECT identidad_tipo,identidad_numero INTO stored_type,stored FROM pliego.cliente_identificacion WHERE cliente_id=p_customer FOR SHARE;
 o_matches:=stored_type=p_type AND stored=value;
END; $$;

CREATE OR REPLACE PROCEDURE pliego.sp_customer_billing_identity_correct(IN p_actor BIGINT,IN p_type VARCHAR,IN p_expected_number VARCHAR,IN p_number VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT; value TEXT:=btrim(p_number,' '); stored_type TEXT; stored TEXT;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF NOT pliego.fn_is_valid_ec_identification(p_type,p_number) OR p_expected_number IS NULL THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 SELECT identidad_tipo,identidad_numero INTO stored_type,stored FROM pliego.cliente_identificacion WHERE cliente_id=customer FOR UPDATE;
 IF stored IS NULL OR stored<>btrim(p_expected_number,' ') THEN
  PERFORM pliego.fn_raise_domain_error('P1105','BILLING_IDENTITY_CONFLICT'); END IF;
 IF stored=value THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 PERFORM set_config('pliego.identity_correction',customer::TEXT,true);
 UPDATE pliego.cliente_identificacion SET identidad_tipo=p_type,identidad_numero=value WHERE cliente_id=customer;
 PERFORM set_config('pliego.identity_correction','',true);
 INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo_anterior,identidad_tipo,numero_anterior,numero_nuevo)
 VALUES(customer,'CORRECTED','PROFILE',stored_type,p_type,stored,value);
END; $$;

-- Forward definition of V074: a cédula or a RUC; the invoice records TAX_ID for a RUC.
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
 IF NOT pliego.fn_is_valid_ec_identification(p_identity_type,p_identity_number)
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
 SELECT p.pedido_id,'DRAFT-'||p.pedido_id,'DRAFT',btrim(p_buyer_name),CASE p_identity_type WHEN 'EC_RUC' THEN 'TAX_ID' ELSE 'NATIONAL_ID' END,btrim(p_identity_number),email,
 p.subtotal,p.impuesto_monto,p.total,p_actor,p.impuesto_tasa,p.envio_monto,'SIMULATED','PLIEGO - EMISOR ACADEMICO','9999999999001','Entorno academico sin validez tributaria','999','999'
 FROM pliego.pedido p WHERE pedido_id=o_order_id RETURNING factura_id INTO o_invoice_id;
 INSERT INTO pliego.factura_direccion VALUES(o_invoice_id,btrim(p_line1),NULLIF(btrim(p_line2),''),btrim(p_city),btrim(p_province),upper(btrim(p_country)),NULLIF(btrim(p_postal),''));
 INSERT INTO pliego.factura_item(factura_id,pedido_item_id,descripcion,cantidad,precio_unitario,subtotal,tratamiento_impuesto,impuesto_tasa,impuesto_monto,total)
 SELECT o_invoice_id,pedido_item_id,titulo_snapshot,cantidad,precio_unitario,subtotal,'ASSESSED',impuesto_tasa,impuesto_monto,subtotal+impuesto_monto
 FROM pliego.pedido_item WHERE pedido_id=o_order_id ORDER BY pedido_item_id;
 CALL pliego.sp_invoice_finalize_for_order(p_actor,o_order_id,o_invoice_id);
END; $$;
