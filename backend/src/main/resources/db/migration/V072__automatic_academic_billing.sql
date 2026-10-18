-- Academic documents: immutable snapshots, no SRI integration or authority claim.
ALTER TABLE pliego.factura ADD COLUMN procedencia VARCHAR(16) NOT NULL DEFAULT 'LEGACY' CHECK(procedencia IN('LEGACY','SIMULATED')),
 ADD COLUMN emisor_nombre VARCHAR(240), ADD COLUMN emisor_identificacion VARCHAR(80), ADD COLUMN emisor_direccion VARCHAR(300),
 ADD COLUMN establecimiento CHAR(3), ADD COLUMN punto_emision CHAR(3), ADD COLUMN secuencial BIGINT;
ALTER TABLE pliego.factura DROP CONSTRAINT factura_estado_check, DROP CONSTRAINT factura_check1;
ALTER TABLE pliego.factura ADD CONSTRAINT ck_factura_estado_v072 CHECK(estado IN('DRAFT','ISSUED','VOID')),
 ADD CONSTRAINT ck_factura_fecha_v072 CHECK((estado IN('DRAFT','VOID') AND fecha_emision IS NULL) OR (estado='ISSUED' AND fecha_emision IS NOT NULL)),
 ADD CONSTRAINT ck_factura_simulated_snapshot CHECK(procedencia='LEGACY' OR
 (emisor_nombre IS NOT NULL AND emisor_identificacion IS NOT NULL AND emisor_direccion IS NOT NULL AND establecimiento='999' AND punto_emision='999')),
 ADD CONSTRAINT ck_factura_simulated_number CHECK(procedencia='LEGACY' OR (estado<>'ISSUED' AND secuencial IS NULL) OR (estado='ISSUED' AND secuencial BETWEEN 1 AND 999999999));
CREATE UNIQUE INDEX uq_factura_academic_sequence ON pliego.factura(procedencia,establecimiento,punto_emision,secuencial) WHERE secuencial IS NOT NULL;
CREATE TABLE pliego.academic_document_counter (
 document_type VARCHAR(2) PRIMARY KEY CHECK(document_type IN('01','04')),
 last_value BIGINT NOT NULL CHECK(last_value BETWEEN 0 AND 999999999)
);
INSERT INTO pliego.academic_document_counter VALUES('01',0),('04',0);
CREATE FUNCTION pliego.fn_academic_document_number(p_type VARCHAR) RETURNS VARCHAR
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE value BIGINT;
BEGIN
 UPDATE pliego.academic_document_counter SET last_value=last_value+1 WHERE document_type=p_type AND last_value<999999999 RETURNING last_value INTO value;
 IF value IS NULL THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 RETURN '999-999-'||lpad(value::TEXT,9,'0');
END; $$;

-- New NATIONAL_ID writes validate the Ecuador algorithm; existing documents remain untouched.
CREATE FUNCTION pliego.fn_invoice_identity_validate() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.identidad_tipo='NATIONAL_ID' AND NOT pliego.fn_is_valid_ec_cedula(NEW.identidad_numero) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN NEW;
END; $$;
ALTER TABLE pliego.factura ADD CONSTRAINT ck_factura_identity_new CHECK(identidad_tipo<>'NATIONAL_ID' OR pliego.fn_is_valid_ec_cedula(identidad_numero)) NOT VALID;
CREATE TRIGGER trg_factura_identity_new BEFORE INSERT ON pliego.factura FOR EACH ROW EXECUTE FUNCTION pliego.fn_invoice_identity_validate();
CREATE OR REPLACE FUNCTION pliego.fn_guard_invoice_immutable() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF OLD.estado IN('ISSUED','VOID') THEN PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION'); END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;

CREATE PROCEDURE pliego.sp_invoice_finalize_for_order(IN p_actor BIGINT,IN p_order_id BIGINT,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE actor RECORD; purchase pliego.pedido%ROWTYPE; invoice pliego.factura%ROWTYPE; number VARCHAR;
BEGIN
 SELECT * INTO actor FROM pliego.fn_assert_actor(p_actor,NULL);
 SELECT * INTO purchase FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
 IF NOT FOUND OR (actor.rol='CUSTOMER' AND actor.cliente_id<>purchase.cliente_id) THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 SELECT * INTO invoice FROM pliego.factura WHERE pedido_id=p_order_id;
 o_invoice_id:=invoice.factura_id;
 IF NOT FOUND OR invoice.procedencia<>'SIMULATED' OR invoice.estado IN('ISSUED','VOID') THEN RETURN; END IF;
 IF purchase.estado IN('PENDING_PAYMENT','CANCELLED') OR NOT EXISTS(SELECT FROM pliego.pago WHERE pedido_id=p_order_id AND estado='APPROVED') THEN RETURN; END IF;
 number:=pliego.fn_academic_document_number('01');
 UPDATE pliego.factura SET estado='ISSUED',numero_documento=number,secuencial=right(number,9)::BIGINT,fecha_emision=CURRENT_TIMESTAMP WHERE factura_id=o_invoice_id;
END; $$;
CREATE PROCEDURE pliego.sp_invoice_credit_after_refund(IN p_actor BIGINT,IN p_order_id BIGINT,IN p_reason VARCHAR,OUT o_credit_note_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE actor RECORD; purchase pliego.pedido%ROWTYPE; invoice pliego.factura%ROWTYPE;
BEGIN
 SELECT * INTO actor FROM pliego.fn_assert_actor(p_actor,NULL);
 SELECT * INTO purchase FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
 IF NOT FOUND OR (actor.rol='CUSTOMER' AND actor.cliente_id<>purchase.cliente_id) THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 SELECT * INTO invoice FROM pliego.factura WHERE pedido_id=p_order_id;
 IF NOT FOUND OR invoice.procedencia<>'SIMULATED' THEN RETURN; END IF;
 IF purchase.estado='CANCELLED' AND invoice.estado='DRAFT' THEN UPDATE pliego.factura SET estado='VOID' WHERE factura_id=invoice.factura_id; RETURN; END IF;
 SELECT nota_credito_id INTO o_credit_note_id FROM pliego.nota_credito WHERE factura_id=invoice.factura_id;
 IF FOUND THEN RETURN; END IF;
 IF invoice.estado<>'ISSUED' OR NOT EXISTS(SELECT FROM pliego.pago WHERE pedido_id=p_order_id AND estado='REFUNDED') THEN RETURN; END IF;
 IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 INSERT INTO pliego.nota_credito(factura_id,numero_documento,motivo,subtotal,impuesto_total,total,usuario_emisor_id,impuesto_tasa,envio_monto)
 VALUES(invoice.factura_id,pliego.fn_academic_document_number('04'),btrim(p_reason),invoice.subtotal,invoice.impuesto_total,invoice.total,p_actor,invoice.impuesto_tasa,invoice.envio_monto)
 RETURNING nota_credito_id INTO o_credit_note_id;
END; $$;

CREATE TABLE pliego.checkout_billing_attempt (
 actor_user_id BIGINT NOT NULL, attempt_key UUID NOT NULL, payload_fingerprint VARCHAR(64) NOT NULL,
 PRIMARY KEY(actor_user_id,attempt_key), FOREIGN KEY(actor_user_id,attempt_key) REFERENCES pliego.checkout_attempt(actor_user_id,attempt_key),
 CHECK(payload_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER trg_checkout_billing_immutable BEFORE UPDATE OR DELETE ON pliego.checkout_billing_attempt FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

CREATE PROCEDURE pliego.sp_checkout_billed_quoted(IN p_actor BIGINT,IN p_key UUID,
 IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,IN p_quote VARCHAR,
 IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,IN p_buyer_name VARCHAR,
 IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,IN p_country VARCHAR,IN p_postal VARCHAR,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE fingerprint VARCHAR; previous VARCHAR; email VARCHAR; receipt_exists BOOLEAN; receipt pliego.checkout_attempt%ROWTYPE;
BEGIN
 PERFORM pliego.fn_assert_actor(p_actor,'CUSTOMER');
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
 IF NOT receipt_exists THEN
  IF p_identity_type IS DISTINCT FROM 'EC_CEDULA' OR NOT pliego.fn_is_valid_ec_cedula(p_identity_number)
   OR p_buyer_name IS NULL OR char_length(btrim(p_buyer_name)) NOT BETWEEN 1 AND 240
   OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200 OR char_length(p_line2)>200
   OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 1 AND 100
   OR p_province IS NULL OR char_length(btrim(p_province)) NOT BETWEEN 1 AND 100
   OR p_country IS NULL OR NOT pliego.fn_is_valid_country_code(upper(btrim(p_country))) OR char_length(p_postal)>20 THEN
    PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 END IF;
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

-- Forward definition extends V045 without touching its approved source.
CREATE OR REPLACE PROCEDURE pliego.sp_checkout_execute(
    IN p_actor_user_id BIGINT,
    IN p_address_id BIGINT,
    IN p_payment_method VARCHAR,
    IN p_payment_outcome VARCHAR,
    IN p_fulfillment_method VARCHAR,
    IN p_pickup_location_id BIGINT,
    OUT o_order_id BIGINT,
    OUT o_order_state VARCHAR,
    OUT o_payment_state VARCHAR,
    OUT o_total NUMERIC,
    OUT o_payment_reference VARCHAR
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_subtotal NUMERIC(30,2);
    v_tax NUMERIC(30,2);
    v_rate NUMERIC(7,4):=pliego.fn_checkout_tax_rate();
    v_customer_id BIGINT;
    v_cart_id BIGINT;
    v_address pliego.direccion%ROWTYPE;
    v_item RECORD;
    v_before INTEGER;
    v_after INTEGER;
    v_payment_id BIGINT;
    v_reference VARCHAR;
    v_constraint TEXT;
    v_has_physical BOOLEAN:=FALSE;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    IF p_payment_method NOT IN ('CARD', 'TRANSFER') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid payment method');
    END IF;

    IF p_payment_outcome NOT IN ('APPROVED', 'REJECTED', 'PENDING') THEN
        PERFORM pliego.fn_raise_domain_error('P5005', 'PAYMENT_OUTCOME_INVALID');
    END IF;

    SELECT c.carrito_id
      INTO v_cart_id
      FROM pliego.carrito c
     WHERE c.cliente_id = v_customer_id
       AND c.estado = 'ACTIVE'
     FOR UPDATE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P4001', 'CART_NOT_ACTIVE');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pliego.carrito_item ci WHERE ci.carrito_id = v_cart_id
    ) THEN
        PERFORM pliego.fn_raise_domain_error('P4002', 'CART_EMPTY');
    END IF;

    IF p_fulfillment_method='HOME_DELIVERY' THEN
    SELECT d.*
      INTO v_address
      FROM pliego.direccion d
     WHERE d.direccion_id = p_address_id
       AND d.cliente_id = v_customer_id
     FOR SHARE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P5004', 'CHECKOUT_ADDRESS_INVALID');
    END IF;

    END IF;

    -- RC-01: lock masters whose state/price become order snapshots.
    -- Deterministic order reduces deadlock risk with administrative writers.
    FOR v_item IN
        SELECT e.edicion_id
          FROM pliego.carrito_item ci
          JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
          JOIN pliego.libro l ON l.libro_id = e.libro_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY e.edicion_id
         FOR SHARE OF e, l
    LOOP
        NULL;
    END LOOP;

    -- Post-lock freshness check: state and price cannot change until this transaction ends.
    FOR v_item IN
        SELECT ci.edicion_id,
               ci.cantidad,
               e.estado AS edition_state,
               l.estado AS book_state,
               pliego.fn_edition_price(e.edicion_id) AS precio, e.formato
          FROM pliego.carrito_item ci
          JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
          JOIN pliego.libro l ON l.libro_id = e.libro_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY ci.edicion_id
    LOOP
        IF pliego.fn_is_physical_format(v_item.formato) THEN v_has_physical:=TRUE; END IF;
        IF v_item.edition_state <> 'ACTIVE' THEN
            PERFORM pliego.fn_raise_domain_error('P2042', 'EDITION_INACTIVE');
        END IF;
        IF v_item.book_state <> 'ACTIVE' THEN
            PERFORM pliego.fn_raise_domain_error('P2043', 'BOOK_INACTIVE');
        END IF;
        IF NOT pliego.fn_is_physical_format(v_item.formato) AND v_item.cantidad <> 1 THEN
            PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID');
        END IF;
        IF pliego.fn_is_physical_format(v_item.formato) AND NOT EXISTS (SELECT 1 FROM pliego.inventario i WHERE i.edicion_id=v_item.edicion_id) THEN
            PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');
        END IF;
        IF v_item.precio <= 0 THEN
            PERFORM pliego.fn_raise_domain_error('P2048', 'EDITION_DATA_INVALID');
        END IF;
    END LOOP;

    IF (p_fulfillment_method='DIGITAL_ONLY') IS DISTINCT FROM (NOT v_has_physical) THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;

    IF p_fulfillment_method='STORE_PICKUP' AND NOT v_has_physical THEN
        PERFORM pliego.fn_raise_domain_error('P5012','PICKUP_NOT_APPLICABLE');
    END IF;

    -- Lock inventories in deterministic EdicionId order and revalidate stock.
    FOR v_item IN
        SELECT i.edicion_id, i.stock_actual, ci.cantidad
          FROM pliego.carrito_item ci
          JOIN pliego.inventario i ON i.edicion_id = ci.edicion_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY i.edicion_id
         FOR UPDATE OF i
    LOOP
        IF v_item.stock_actual < v_item.cantidad THEN
            PERFORM pliego.fn_raise_domain_error('P3002', 'INSUFFICIENT_STOCK');
        END IF;
    END LOOP;

    SELECT sum(ci.cantidad * pliego.fn_edition_price(e.edicion_id))::NUMERIC(30,2)
      INTO v_subtotal
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
     WHERE ci.carrito_id = v_cart_id;

    IF v_subtotal IS NULL OR v_subtotal <= 0 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid order total');
    END IF;

    SELECT sum(round(ci.cantidad*pliego.fn_edition_price(e.edicion_id)*v_rate/100,2))::NUMERIC(30,2)
      INTO v_tax FROM pliego.carrito_item ci JOIN pliego.edicion e USING(edicion_id) WHERE ci.carrito_id=v_cart_id;
    o_total:=v_subtotal+v_tax;
    INSERT INTO pliego.pedido(cliente_id, estado, subtotal, total, impuesto_tasa, impuesto_monto, envio_monto)
    VALUES (v_customer_id, 'PENDING_PAYMENT', v_subtotal, o_total, v_rate, v_tax, 0.00)
    RETURNING pedido_id INTO o_order_id;

    INSERT INTO pliego.pedido_estado_historial(
        pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
    ) VALUES (
        o_order_id, NULL, 'SYSTEM', NULL, 'PENDING_PAYMENT'
    );

    INSERT INTO pliego.pedido_item(
        pedido_id, edicion_id, sku_snapshot, isbn_snapshot, titulo_snapshot,
        autores_snapshot, editorial_snapshot, formato_snapshot, idioma_snapshot,
        precio_unitario, cantidad, subtotal, impuesto_tasa, impuesto_monto
    )
    SELECT o_order_id,
           e.edicion_id,
           e.sku,
           e.isbn13,
           l.titulo,
           pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre,
           e.formato,
           e.idioma,
           pliego.fn_edition_price(e.edicion_id),
           ci.cantidad,
           (pliego.fn_edition_price(e.edicion_id) * ci.cantidad)::NUMERIC(30,2), v_rate, round(pliego.fn_edition_price(e.edicion_id)*ci.cantidad*v_rate/100,2)
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
      JOIN pliego.libro l ON l.libro_id = e.libro_id
      JOIN pliego.editorial pub ON pub.editorial_id = e.editorial_id
     WHERE ci.carrito_id = v_cart_id
     ORDER BY e.edicion_id;

    IF p_fulfillment_method='HOME_DELIVERY' THEN
    INSERT INTO pliego.pedido_direccion(
        pedido_id, destinatario, direccion_linea1, direccion_linea2,
        ciudad, provincia, pais_codigo, codigo_postal, referencia, telefono
    ) VALUES (
        o_order_id,
        v_address.destinatario,
        v_address.direccion_linea1,
        v_address.direccion_linea2,
        v_address.ciudad,
        v_address.provincia,
        v_address.pais_codigo,
        v_address.codigo_postal,
        v_address.referencia,
        v_address.telefono
    );

    END IF;

    INSERT INTO pliego.pago(
        pedido_id, metodo, estado, monto, referencia, detalle_resultado
    ) VALUES (
        o_order_id, p_payment_method, 'PENDING', o_total, NULL, NULL
    )
    RETURNING pago_id INTO v_payment_id;

    IF p_payment_outcome = 'APPROVED' THEN
        v_reference := pliego.fn_generate_payment_reference();

        BEGIN
            UPDATE pliego.pago
               SET estado = 'APPROVED',
                   referencia = v_reference,
                   detalle_resultado = NULL
             WHERE pago_id = v_payment_id;
        EXCEPTION WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            IF v_constraint = 'uq_pago_referencia' THEN
                PERFORM pliego.fn_raise_domain_error('P5007', 'PAYMENT_REFERENCE_CONFLICT');
            END IF;
            RAISE;
        END;

        FOR v_item IN
            SELECT ci.edicion_id, ci.cantidad
              FROM pliego.carrito_item ci
              JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id
             WHERE ci.carrito_id = v_cart_id AND pliego.fn_is_physical_format(e.formato)
             ORDER BY ci.edicion_id
        LOOP
            SELECT i.stock_actual
              INTO v_before
              FROM pliego.inventario i
             WHERE i.edicion_id = v_item.edicion_id;

            v_after := v_before - v_item.cantidad;
            IF v_after < 0 THEN
                PERFORM pliego.fn_raise_domain_error('P3002', 'INSUFFICIENT_STOCK');
            END IF;

            UPDATE pliego.inventario
               SET stock_actual = v_after
             WHERE edicion_id = v_item.edicion_id;

            BEGIN
                INSERT INTO pliego.movimiento_inventario(
                    edicion_id, pedido_id, usuario_actor_id, tipo, cantidad,
                    stock_anterior, stock_posterior, motivo
                ) VALUES (
                    v_item.edicion_id, o_order_id, NULL, 'SALE', v_item.cantidad,
                    v_before, v_after, NULL
                );
            EXCEPTION WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
                IF v_constraint = 'uqx_movimiento_pedido_edicion_tipo' THEN
                    PERFORM pliego.fn_raise_domain_error('P3005', 'STOCK_MOVEMENT_DUPLICATE');
                END IF;
                RAISE;
            END;
        END LOOP;

        UPDATE pliego.pedido
           SET estado = 'CONFIRMED'
         WHERE pedido_id = o_order_id;

        INSERT INTO pliego.pedido_estado_historial(
            pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
        ) VALUES (
            o_order_id, NULL, 'SYSTEM', 'PENDING_PAYMENT', 'CONFIRMED'
        );

        UPDATE pliego.carrito
           SET estado = 'CHECKED_OUT'
         WHERE carrito_id = v_cart_id;

        o_order_state := 'CONFIRMED';
        o_payment_state := 'APPROVED';
        o_payment_reference := v_reference;
    ELSIF p_payment_outcome='PENDING' THEN
        UPDATE pliego.carrito SET estado='CHECKED_OUT' WHERE carrito_id=v_cart_id;
        o_order_state:='PENDING_PAYMENT'; o_payment_state:='PENDING'; o_payment_reference:=NULL;
    ELSE
        UPDATE pliego.pago
           SET estado = 'REJECTED',
               referencia = NULL,
               detalle_resultado = 'SIMULATED_REJECTION'
         WHERE pago_id = v_payment_id;

        UPDATE pliego.pedido
           SET estado = 'CANCELLED'
         WHERE pedido_id = o_order_id;

        INSERT INTO pliego.pedido_estado_historial(
            pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
        ) VALUES (
            o_order_id, NULL, 'SYSTEM', 'PENDING_PAYMENT', 'CANCELLED'
        );

        o_order_state := 'CANCELLED';
        o_payment_state := 'REJECTED';
        o_payment_reference := NULL;
    END IF;
END;
$$;



-- Preserve all legacy quoted semantics; dropping fiscal payload is a conflict.
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
 IF EXISTS(SELECT FROM pliego.checkout_billing_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key) THEN
  PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;

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

CREATE PROCEDURE pliego.sp_billed_order_approve(IN p_actor BIGINT,IN p_order_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE purchase pliego.pedido%ROWTYPE; line RECORD; invoice BIGINT; before_stock INTEGER;
BEGIN
 PERFORM pliego.fn_assert_actor(p_actor,'ADMIN');
 SELECT * INTO purchase FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 IF NOT EXISTS(SELECT FROM pliego.factura WHERE pedido_id=p_order_id AND procedencia='SIMULATED') THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 IF EXISTS(SELECT FROM pliego.pago WHERE pedido_id=p_order_id AND estado='APPROVED') AND purchase.estado<>'CANCELLED' THEN
  CALL pliego.sp_invoice_finalize_for_order(p_actor,p_order_id,invoice); RETURN; END IF;
 IF purchase.estado<>'PENDING_PAYMENT' OR NOT EXISTS(SELECT FROM pliego.pago WHERE pedido_id=p_order_id AND estado='PENDING') THEN PERFORM pliego.fn_raise_domain_error('P5006','PAYMENT_STATE_INVALID'); END IF;
 FOR line IN SELECT * FROM pliego.pedido_item WHERE pedido_id=p_order_id AND pliego.fn_is_physical_format(formato_snapshot) ORDER BY edicion_id LOOP
  SELECT stock_actual INTO before_stock FROM pliego.inventario WHERE edicion_id=line.edicion_id FOR UPDATE;
  IF before_stock IS NULL OR before_stock<line.cantidad THEN PERFORM pliego.fn_raise_domain_error('P3002','INSUFFICIENT_STOCK'); END IF;
  UPDATE pliego.inventario SET stock_actual=before_stock-line.cantidad WHERE edicion_id=line.edicion_id;
  INSERT INTO pliego.movimiento_inventario(edicion_id,pedido_id,usuario_actor_id,tipo,cantidad,stock_anterior,stock_posterior,motivo)
  VALUES(line.edicion_id,p_order_id,NULL,'SALE',line.cantidad,before_stock,before_stock-line.cantidad,NULL);
 END LOOP;
 UPDATE pliego.pago SET estado='APPROVED',referencia=pliego.fn_generate_payment_reference(),detalle_resultado=NULL WHERE pedido_id=p_order_id;
 UPDATE pliego.pedido SET estado='CONFIRMED' WHERE pedido_id=p_order_id;
 INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo) VALUES(p_order_id,p_actor,'USER','PENDING_PAYMENT','CONFIRMED');
 -- Deferred payments have no shipment confirmation event at checkout time.
 -- Initialize its schedule only after this command confirms the order.
 UPDATE pliego.envio e SET fecha_confirmacion=pa.fecha_aprobacion,
  transito_desde=pa.fecha_aprobacion+make_interval(mins=>c.preparing_minutes),
  reparto_desde=pa.fecha_aprobacion+make_interval(mins=>c.preparing_minutes+c.in_transit_minutes),
  entrega_desde=pa.fecha_aprobacion+make_interval(mins=>c.preparing_minutes+c.in_transit_minutes+c.out_for_delivery_minutes),
  estado='PREPARING',fecha_preparacion=pa.fecha_aprobacion
 FROM pliego.home_delivery_config c,pliego.pago pa
 WHERE e.pedido_id=p_order_id AND pa.pedido_id=e.pedido_id AND c.singleton AND e.estado='PENDING' AND e.fecha_confirmacion IS NULL;
 INSERT INTO pliego.envio_historial(envio_id,tipo,origen,estado_anterior,estado_nuevo,fecha)
 SELECT envio_id,'STATUS','SYSTEM','PENDING','PREPARING',fecha_confirmacion FROM pliego.envio
 WHERE pedido_id=p_order_id AND estado='PREPARING' ON CONFLICT DO NOTHING;
 PERFORM pliego.fn_assign_order_cancel_deadline(p_order_id);
 CALL pliego.sp_purchase_lifecycle_reconcile(p_order_id);
 PERFORM pliego.fn_order_confirmation_enqueue(p_order_id);
 CALL pliego.sp_invoice_finalize_for_order(p_actor,p_order_id,invoice);
END; $$;

ALTER PROCEDURE pliego.sp_order_cancel(BIGINT,BIGINT) RENAME TO sp_order_cancel_internal_v055;
CREATE PROCEDURE pliego.sp_order_cancel(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
 OUT o_order_id BIGINT,OUT o_previous_state VARCHAR,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_restored_units BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE credit BIGINT; actor RECORD; purchase pliego.pedido%ROWTYPE;
BEGIN
 SELECT * INTO actor FROM pliego.fn_assert_actor(p_actor_user_id,NULL);
 SELECT * INTO purchase FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
 IF NOT FOUND OR (actor.rol='CUSTOMER' AND actor.cliente_id<>purchase.cliente_id) THEN
  PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 IF purchase.estado='PENDING_PAYMENT' AND EXISTS(SELECT FROM pliego.factura WHERE pedido_id=p_order_id AND procedencia='SIMULATED' AND estado='DRAFT') THEN
  IF NOT EXISTS(SELECT FROM pliego.pago WHERE pedido_id=p_order_id AND estado='PENDING') THEN PERFORM pliego.fn_raise_domain_error('P5006','PAYMENT_STATE_INVALID'); END IF;
  -- No approval/sale occurred. Terminate the simulated pending payment without refund.
  UPDATE pliego.pago SET estado='REJECTED',detalle_resultado='SIMULATED_CANCELLATION' WHERE pedido_id=p_order_id;
  UPDATE pliego.pedido SET estado='CANCELLED' WHERE pedido_id=p_order_id;
  UPDATE pliego.envio SET estado='CANCELLED',fecha_cancelacion=clock_timestamp() WHERE pedido_id=p_order_id;
  INSERT INTO pliego.envio_historial(envio_id,tipo,origen,estado_anterior,estado_nuevo)
  SELECT envio_id,'STATUS','SYSTEM','PENDING','CANCELLED' FROM pliego.envio WHERE pedido_id=p_order_id;
  INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo)
  VALUES(p_order_id,p_actor_user_id,'USER','PENDING_PAYMENT','CANCELLED');
  CALL pliego.sp_invoice_credit_after_refund(p_actor_user_id,p_order_id,'Cancelación de pago pendiente',credit);
  o_order_id:=p_order_id; o_previous_state:='PENDING_PAYMENT'; o_order_state:='CANCELLED'; o_payment_state:='REJECTED'; o_restored_units:=0;
  RETURN;
 END IF;
 CALL pliego.sp_order_cancel_internal_v055(p_actor_user_id,p_order_id,o_order_id,o_previous_state,o_order_state,o_payment_state,o_restored_units);
 CALL pliego.sp_invoice_credit_after_refund(p_actor_user_id,p_order_id,'Cancelación del pedido',credit);
END; $$;

-- Internal trusted worker projection; INVOKER, no privilege escalation. HTTP uses authorized wrapper below.
CREATE FUNCTION pliego.fn_invoice_snapshot_data(p_invoice_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$ DECLARE result JSONB; BEGIN
 SELECT jsonb_build_object('invoiceId',f.factura_id::TEXT,'orderId',f.pedido_id::TEXT,'documentNumber',f.numero_documento,'state',f.estado,
 'provenance',f.procedencia,'buyerName',f.comprador_nombre,'identityType',f.identidad_tipo,'identityNumber',f.identidad_numero,
 'buyerEmail',f.comprador_email,'currency',f.moneda,'subtotal',f.subtotal,'taxRate',f.impuesto_tasa,'taxTotal',f.impuesto_total,'shippingAmount',f.envio_monto,'total',f.total,'issuedAt',f.fecha_emision,
 'totalDiscount',(SELECT COALESCE(sum(i.ahorro_unitario_snapshot*i.cantidad),0) FROM pliego.pedido_item i WHERE i.pedido_id=f.pedido_id),
 'taxes',(SELECT jsonb_agg(t.value ORDER BY t.rate) FROM (SELECT l.impuesto_tasa AS rate,jsonb_build_object('taxCode','2','taxPercentageCode',CASE WHEN l.impuesto_tasa=0 THEN '0' WHEN l.impuesto_tasa=15 THEN '4' END,'taxableBase',sum(l.subtotal),'taxAmount',sum(l.impuesto_monto)) AS value FROM pliego.factura_item l WHERE l.factura_id=f.factura_id GROUP BY l.impuesto_tasa) t),
 'issuer',jsonb_build_object('name',f.emisor_nombre,'identification',f.emisor_identificacion,'address',f.emisor_direccion,'establishment',f.establecimiento,'emissionPoint',f.punto_emision),
 'billingAddress',(SELECT jsonb_build_object('line1',d.direccion_linea1,'line2',d.direccion_linea2,'city',d.ciudad,'province',d.provincia,'countryCode',d.pais_codigo,'postalCode',d.codigo_postal) FROM pliego.factura_direccion d WHERE d.factura_id=f.factura_id),
 'items',(SELECT jsonb_agg(jsonb_build_object('invoiceItemId',l.factura_item_id::TEXT,'orderItemId',l.pedido_item_id::TEXT,'description',l.descripcion,'quantity',l.cantidad,'unitPrice',l.precio_unitario,'subtotal',l.subtotal,'taxTreatment',l.tratamiento_impuesto,
 'taxRate',l.impuesto_tasa,'taxAmount',l.impuesto_monto,'total',l.total,'originalUnitPrice',i.precio_original_snapshot,'discountAmount',i.ahorro_unitario_snapshot*i.cantidad,
 'taxCode',CASE WHEN f.procedencia='SIMULATED' THEN '2' END,'taxPercentageCode',CASE WHEN f.procedencia='SIMULATED' THEN CASE WHEN l.impuesto_tasa=0 THEN '0' WHEN l.impuesto_tasa=15 THEN '4' ELSE NULL END END) ORDER BY l.factura_item_id)
 FROM pliego.factura_item l JOIN pliego.pedido_item i USING(pedido_item_id) WHERE l.factura_id=f.factura_id)) INTO result FROM pliego.factura f WHERE f.factura_id=p_invoice_id;
 RETURN result;
END; $$;
CREATE FUNCTION pliego.fn_invoice_snapshot(p_actor BIGINT,p_order_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE actor RECORD; customer BIGINT; result JSONB;
BEGIN
 SELECT * INTO actor FROM pliego.fn_assert_actor(p_actor,NULL);
 SELECT cliente_id INTO customer FROM pliego.pedido WHERE pedido_id=p_order_id;
 IF NOT FOUND OR (actor.rol='CUSTOMER' AND actor.cliente_id<>customer) THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 RETURN pliego.fn_invoice_snapshot_data((SELECT factura_id FROM pliego.factura WHERE pedido_id=p_order_id));
END; $$;

-- A voided draft is historical too; children cannot be appended after invalidation.
CREATE OR REPLACE FUNCTION pliego.fn_guard_invoice_child_immutable() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE state VARCHAR;
BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION'); END IF;
 SELECT estado INTO state FROM pliego.factura WHERE factura_id=NEW.factura_id FOR SHARE;
 IF state IN('ISSUED','VOID') THEN PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION'); END IF;
 RETURN NEW;
END; $$;

-- Expose exactly the newly authorized pending cancellation to both order projections.
ALTER FUNCTION pliego.fn_order_post_purchase(BIGINT) RENAME TO fn_order_post_purchase_internal_v055;
CREATE FUNCTION pliego.fn_order_post_purchase(p_order_id BIGINT)
RETURNS TABLE(purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT base.purchase_state,base.fulfillment,base.shipment,base.invoice,base.credit_notes,
 base.available_actions || CASE WHEN p.estado='PENDING_PAYMENT'
  AND EXISTS(SELECT FROM pliego.pago pa WHERE pa.pedido_id=p.pedido_id AND pa.estado='PENDING')
  AND EXISTS(SELECT FROM pliego.factura f WHERE f.pedido_id=p.pedido_id AND f.procedencia='SIMULATED' AND f.estado='DRAFT')
 THEN jsonb_build_object('cancel',TRUE,'canCancel',TRUE,'cancellationDeadline',NULL,'lifecycleState','PENDING_PAYMENT','libraryAccessState','NOT_APPLICABLE')
 ELSE '{}'::JSONB END
 FROM pliego.pedido p CROSS JOIN LATERAL pliego.fn_order_post_purchase_internal_v055(p.pedido_id) base
 WHERE p.pedido_id=p_order_id;
$$;

-- Guard both legacy idempotent interfaces under the same actor/key lock.
CREATE OR REPLACE PROCEDURE pliego.sp_checkout_idempotent(IN p_actor BIGINT,IN p_key UUID,IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE receipt pliego.checkout_attempt%ROWTYPE; customer_id BIGINT; cart_id BIGINT; mode VARCHAR:=COALESCE(p_fulfillment,'HOME_DELIVERY');
BEGIN
 SELECT a.cliente_id INTO customer_id FROM pliego.fn_assert_actor(p_actor,'CUSTOMER') a;
 IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('checkout:'||p_actor||':'||p_key,0));
 IF EXISTS(SELECT FROM pliego.checkout_billing_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key) THEN
  PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;

 SELECT * INTO receipt FROM pliego.checkout_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
 IF FOUND THEN
  IF receipt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
  IF receipt.address_id IS DISTINCT FROM p_address OR receipt.payment_method IS DISTINCT FROM p_method OR receipt.simulation_outcome IS DISTINCT FROM p_outcome
  OR receipt.cart_id IS DISTINCT FROM p_cart OR receipt.fulfillment_method IS DISTINCT FROM mode OR receipt.pickup_location_id IS DISTINCT FROM p_pickup THEN
   PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;
  o_order_id:=receipt.order_id; o_order_state:=receipt.order_state; o_payment_state:=receipt.payment_state; o_total:=receipt.total; o_payment_reference:=receipt.payment_reference;
  RETURN;
 END IF;
 IF p_cart IS NOT NULL THEN
  SELECT carrito_id INTO cart_id FROM pliego.carrito WHERE cliente_id=customer_id AND estado='ACTIVE' FOR UPDATE;
  IF cart_id IS DISTINCT FROM p_cart THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE'); END IF;
 END IF;
 CALL pliego.sp_checkout(p_actor,p_address,p_method,p_outcome,mode,p_pickup,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 INSERT INTO pliego.checkout_attempt(actor_user_id,attempt_key,state,address_id,cart_id,payment_method,simulation_outcome,order_id,order_state,payment_state,total,payment_reference,fulfillment_method,pickup_location_id)
 VALUES(p_actor,p_key,'CREATED',p_address,p_cart,p_method,p_outcome,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference,mode,p_pickup);
END; $$;
CREATE OR REPLACE PROCEDURE pliego.sp_checkout_idempotent(IN p_actor BIGINT,IN p_key UUID,IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 CALL pliego.sp_checkout_idempotent(p_actor,p_key,p_address,p_method,p_outcome,p_cart,'HOME_DELIVERY',NULL,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
END; $$;

