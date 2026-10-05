-- ADR0022: apply requested Ecuador pricing configuration to NEW purchases only.
CREATE FUNCTION pliego.fn_checkout_tax_rate() RETURNS NUMERIC
LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$ SELECT 15.00::NUMERIC; $$;
ALTER TABLE pliego.pedido DROP CONSTRAINT ck_pedido_total_v1;
ALTER TABLE pliego.pedido ADD COLUMN impuesto_tasa NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK(impuesto_tasa BETWEEN 0 AND 100),
 ADD COLUMN impuesto_monto NUMERIC(30,2) NOT NULL DEFAULT 0 CHECK(impuesto_monto>=0),
 ADD COLUMN envio_monto NUMERIC(30,2) NOT NULL DEFAULT 0 CHECK(envio_monto>=0),
 ADD CONSTRAINT ck_pedido_monetary_total CHECK(total=subtotal+impuesto_monto+envio_monto);
ALTER TABLE pliego.pedido_item ADD COLUMN impuesto_tasa NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK(impuesto_tasa BETWEEN 0 AND 100),
 ADD COLUMN impuesto_monto NUMERIC(30,2) NOT NULL DEFAULT 0 CHECK(impuesto_monto=round(subtotal*impuesto_tasa/100,2));
ALTER TABLE pliego.checkout_attempt ALTER COLUMN total TYPE NUMERIC(30,2);
ALTER TABLE pliego.factura DROP CONSTRAINT factura_check;
ALTER TABLE pliego.factura ADD COLUMN impuesto_tasa NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK(impuesto_tasa BETWEEN 0 AND 100),
 ADD COLUMN envio_monto NUMERIC(30,2) NOT NULL DEFAULT 0 CHECK(envio_monto>=0),
 ADD CONSTRAINT ck_factura_total CHECK(total=subtotal+impuesto_total+envio_monto);
ALTER TABLE pliego.nota_credito DROP CONSTRAINT nota_credito_check;
ALTER TABLE pliego.nota_credito ADD COLUMN impuesto_tasa NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK(impuesto_tasa BETWEEN 0 AND 100),
 ADD COLUMN envio_monto NUMERIC(30,2) NOT NULL DEFAULT 0 CHECK(envio_monto>=0),
 ADD CONSTRAINT ck_nota_credito_total CHECK(total=subtotal+impuesto_total+envio_monto);

CREATE FUNCTION pliego.fn_guard_order_money() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF ROW(NEW.subtotal,NEW.impuesto_tasa,NEW.impuesto_monto,NEW.envio_monto,NEW.total) IS DISTINCT FROM
 ROW(OLD.subtotal,OLD.impuesto_tasa,OLD.impuesto_monto,OLD.envio_monto,OLD.total) THEN
  PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION'); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pedido_money_immutable BEFORE UPDATE ON pliego.pedido FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_order_money();
CREATE TRIGGER trg_pedido_item_immutable BEFORE UPDATE OR DELETE ON pliego.pedido_item FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

CREATE FUNCTION pliego.fn_order_pricing(p_order BIGINT)
RETURNS TABLE(subtotal NUMERIC(30,2),tax_rate NUMERIC(7,4),tax_amount NUMERIC(30,2),shipping_amount NUMERIC(30,2),total NUMERIC(30,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT subtotal,impuesto_tasa,impuesto_monto,envio_monto,total FROM pliego.pedido WHERE pedido_id=p_order;
$$;
CREATE FUNCTION pliego.fn_cart_quote(p_actor BIGINT)
RETURNS TABLE(cart_id BIGINT,state VARCHAR,items JSONB,total_current NUMERIC(30,2),subtotal NUMERIC(30,2),tax_rate NUMERIC(7,4),tax_amount NUMERIC(30,2),shipping_amount NUMERIC(30,2),total NUMERIC(30,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT b.cart_id,b.state,b.items,(b.total_current+t.amount)::NUMERIC(30,2),b.total_current,pliego.fn_checkout_tax_rate()::NUMERIC(7,4),
 t.amount,0.00::NUMERIC(30,2),(b.total_current+t.amount)::NUMERIC(30,2)
 FROM pliego.fn_cart_get(p_actor) b CROSS JOIN LATERAL (
  SELECT COALESCE(sum(round(ci.cantidad*e.precio*pliego.fn_checkout_tax_rate()/100,2)),0.00)::NUMERIC(30,2) AS amount
  FROM pliego.carrito_item ci JOIN pliego.edicion e USING(edicion_id) WHERE ci.carrito_id=b.cart_id
 ) t;
$$;

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

    IF p_payment_outcome NOT IN ('APPROVED', 'REJECTED') THEN
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
               e.precio, e.formato
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

    SELECT sum(ci.cantidad * e.precio)::NUMERIC(30,2)
      INTO v_subtotal
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
     WHERE ci.carrito_id = v_cart_id;

    IF v_subtotal IS NULL OR v_subtotal <= 0 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid order total');
    END IF;

    SELECT sum(round(ci.cantidad*e.precio*v_rate/100,2))::NUMERIC(30,2)
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
           e.precio,
           ci.cantidad,
           (e.precio * ci.cantidad)::NUMERIC(30,2), v_rate, round(e.precio*ci.cantidad*v_rate/100,2)
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

CREATE OR REPLACE PROCEDURE pliego.sp_invoice_issue(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
    IN p_document_number VARCHAR,IN p_buyer_name VARCHAR,IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,
    IN p_buyer_email VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,
    IN p_country_code VARCHAR,IN p_postal_code VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_order pliego.pedido%ROWTYPE; v_country VARCHAR;
BEGIN
    PERFORM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
    SELECT * INTO v_order FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
    IF EXISTS (SELECT 1 FROM pliego.factura WHERE pedido_id=p_order_id) THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    IF v_order.estado IN ('PENDING_PAYMENT','CANCELLED') OR NOT EXISTS (
        SELECT 1 FROM pliego.pago WHERE pedido_id=p_order_id AND estado='APPROVED') THEN
        PERFORM pliego.fn_raise_domain_error('P5006','PAYMENT_STATE_INVALID');
    END IF;
    v_country:=pliego.fn_normalize_country_code(p_country_code);
    IF p_document_number IS NULL OR char_length(btrim(p_document_number)) NOT BETWEEN 1 AND 80
        OR p_buyer_name IS NULL OR char_length(btrim(p_buyer_name)) NOT BETWEEN 1 AND 240
        OR p_identity_type IS NULL OR p_identity_type NOT IN ('NATIONAL_ID','TAX_ID','PASSPORT','OTHER')
        OR p_identity_number IS NULL OR char_length(btrim(p_identity_number)) NOT BETWEEN 1 AND 80
        OR (p_buyer_email IS NOT NULL AND (char_length(p_buyer_email)>254 OR p_buyer_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
        OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200 OR char_length(p_line2)>200
        OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 1 AND 100
        OR p_province IS NULL OR char_length(btrim(p_province)) NOT BETWEEN 1 AND 100
        OR v_country IS NULL OR NOT pliego.fn_is_valid_country_code(v_country) OR char_length(p_postal_code)>20 THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pliego.pedido_item WHERE pedido_id=p_order_id)
        OR (SELECT sum(subtotal) FROM pliego.pedido_item WHERE pedido_id=p_order_id)<>v_order.subtotal THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    BEGIN
        INSERT INTO pliego.factura(pedido_id,numero_documento,estado,comprador_nombre,identidad_tipo,identidad_numero,
            comprador_email,subtotal,impuesto_total,total,usuario_emisor_id,impuesto_tasa,envio_monto)
        VALUES(p_order_id,btrim(p_document_number),'DRAFT',btrim(p_buyer_name),p_identity_type,btrim(p_identity_number),
            p_buyer_email,v_order.subtotal,v_order.impuesto_monto,v_order.total,p_actor_user_id,v_order.impuesto_tasa,v_order.envio_monto) RETURNING factura_id INTO o_invoice_id;
    EXCEPTION WHEN unique_violation THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END;
    INSERT INTO pliego.factura_direccion VALUES(o_invoice_id,btrim(p_line1),NULLIF(btrim(p_line2),''),
        btrim(p_city),btrim(p_province),v_country,NULLIF(btrim(p_postal_code),''));
    INSERT INTO pliego.factura_item(factura_id,pedido_item_id,descripcion,cantidad,precio_unitario,subtotal,
        tratamiento_impuesto,impuesto_tasa,impuesto_monto,total)
    SELECT o_invoice_id,pedido_item_id,titulo_snapshot,cantidad,precio_unitario,subtotal,CASE WHEN impuesto_tasa=0 THEN 'NOT_ASSESSED' ELSE 'ASSESSED' END,
        CASE WHEN impuesto_tasa=0 THEN NULL ELSE impuesto_tasa END,impuesto_monto,subtotal+impuesto_monto
    FROM pliego.pedido_item WHERE pedido_id=p_order_id ORDER BY pedido_item_id;
    UPDATE pliego.factura SET estado='ISSUED',fecha_emision=CURRENT_TIMESTAMP WHERE factura_id=o_invoice_id;
END; $$;

CREATE OR REPLACE PROCEDURE pliego.sp_credit_note_issue(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
    IN p_document_number VARCHAR,IN p_reason VARCHAR,OUT o_credit_note_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_invoice pliego.factura%ROWTYPE;
BEGIN
    PERFORM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
    PERFORM 1 FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pliego.pago WHERE pedido_id=p_order_id AND estado='REFUNDED') THEN
        PERFORM pliego.fn_raise_domain_error('P5006','PAYMENT_STATE_INVALID');
    END IF;
    SELECT * INTO v_invoice FROM pliego.factura WHERE pedido_id=p_order_id AND estado='ISSUED';
    IF NOT FOUND OR EXISTS (SELECT 1 FROM pliego.nota_credito WHERE factura_id=v_invoice.factura_id) THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    IF p_document_number IS NULL OR char_length(btrim(p_document_number)) NOT BETWEEN 1 AND 80
        OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    BEGIN
        INSERT INTO pliego.nota_credito(factura_id,numero_documento,motivo,subtotal,impuesto_total,total,usuario_emisor_id,impuesto_tasa,envio_monto)
        VALUES(v_invoice.factura_id,btrim(p_document_number),btrim(p_reason),v_invoice.subtotal,
            v_invoice.impuesto_total,v_invoice.total,p_actor_user_id,v_invoice.impuesto_tasa,v_invoice.envio_monto) RETURNING nota_credito_id INTO o_credit_note_id;
    EXCEPTION WHEN unique_violation THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END;
END; $$;

CREATE OR REPLACE FUNCTION pliego.fn_order_post_purchase(p_order_id BIGINT)
RETURNS TABLE(purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
SELECT pliego.fn_order_purchase_state(p.estado),
    pliego.fn_order_fulfillment(p.pedido_id,FALSE),
    (SELECT jsonb_build_object('shipmentId',e.envio_id,'state',e.estado,'carrier',e.transportista,
        'trackingCode',e.seguimiento_codigo,'trackingUrl',e.seguimiento_url,
        'estimatedDeliveryFrom',e.entrega_estimada_desde,'estimatedDeliveryTo',e.entrega_estimada_hasta,
        'createdAt',e.fecha_creacion,'preparingAt',e.fecha_preparacion,'shippedAt',e.fecha_envio,
        'outForDeliveryAt',e.fecha_en_reparto,'deliveredAt',e.fecha_entrega,'canceledAt',e.fecha_cancelacion,
        'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('eventId',h.envio_historial_id,'type',h.tipo,
            'origin',h.origen,'actorUserId',h.usuario_actor_id,'previousState',h.estado_anterior,'newState',h.estado_nuevo,
            'carrier',h.transportista,'trackingCode',h.seguimiento_codigo,'trackingUrl',h.seguimiento_url,'at',h.fecha)
            ORDER BY h.fecha,h.envio_historial_id) FROM pliego.envio_historial h WHERE h.envio_id=e.envio_id),'[]'::JSONB))
        FROM pliego.envio e WHERE e.pedido_id=p.pedido_id),
    (SELECT jsonb_build_object('invoiceId',i.factura_id,'documentNumber',i.numero_documento,'state',i.estado,
        'buyerName',i.comprador_nombre,'identityType',i.identidad_tipo,'identityNumber',i.identidad_numero,
        'buyerEmail',i.comprador_email,'currency',i.moneda,'subtotal',i.subtotal,'taxRate',i.impuesto_tasa,'taxTotal',i.impuesto_total,'shippingAmount',i.envio_monto,'total',i.total,
        'issuedAt',i.fecha_emision,'billingAddress',(SELECT jsonb_build_object('line1',d.direccion_linea1,
            'line2',d.direccion_linea2,'city',d.ciudad,'province',d.provincia,'countryCode',d.pais_codigo,'postalCode',d.codigo_postal)
            FROM pliego.factura_direccion d WHERE d.factura_id=i.factura_id),
        'items',(SELECT jsonb_agg(jsonb_build_object('invoiceItemId',l.factura_item_id,'orderItemId',l.pedido_item_id,
            'description',l.descripcion,'quantity',l.cantidad,'unitPrice',l.precio_unitario,'subtotal',l.subtotal,
            'taxTreatment',l.tratamiento_impuesto,'taxRate',l.impuesto_tasa,'taxAmount',l.impuesto_monto,'total',l.total)
            ORDER BY l.factura_item_id) FROM pliego.factura_item l WHERE l.factura_id=i.factura_id),
        'electronicIssuance',(SELECT jsonb_build_object('provider',el.proveedor,'state',el.estado,
            'externalReference',el.referencia_externa,'submittedAt',el.fecha_presentacion,'authorizedAt',el.fecha_autorizacion)
            FROM pliego.factura_emision_electronica el WHERE el.factura_id=i.factura_id),
        'pdfAvailable',EXISTS(SELECT 1 FROM pliego.factura_archivo ar WHERE ar.factura_id=i.factura_id AND ar.tipo='PDF'),
        'xmlAvailable',EXISTS(SELECT 1 FROM pliego.factura_archivo ar WHERE ar.factura_id=i.factura_id AND ar.tipo='XML'))
        FROM pliego.factura i WHERE i.pedido_id=p.pedido_id AND i.estado='ISSUED'),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('creditNoteId',n.nota_credito_id,'invoiceId',n.factura_id,
        'documentNumber',n.numero_documento,'state',n.estado,'reason',n.motivo,'subtotal',n.subtotal,
        'taxRate',n.impuesto_tasa,'taxTotal',n.impuesto_total,'shippingAmount',n.envio_monto,'total',n.total,'issuedAt',n.fecha_emision) ORDER BY n.fecha_emision,n.nota_credito_id)
        FROM pliego.nota_credito n JOIN pliego.factura i USING(factura_id) WHERE i.pedido_id=p.pedido_id),'[]'::JSONB),
    jsonb_build_object('cancel',p.estado IN ('CONFIRMED','PREPARING') AND pa.estado='APPROVED'
        AND NOT EXISTS(SELECT 1 FROM pliego.envio e WHERE e.pedido_id=p.pedido_id AND e.estado NOT IN ('PENDING','PREPARING')),
        'changeShippingAddress',FALSE)
FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) WHERE p.pedido_id=p_order_id;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_order_confirmation_enqueue(p_order BIGINT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 SELECT 'ORDER_CONFIRMED:'||p.pedido_id,'ORDER_CONFIRMED',u.usuario_id,u.email_normalizado,
 jsonb_build_object('orderId',p.pedido_id::TEXT,'date',p.fecha_creacion,'subtotal',p.subtotal::TEXT,'taxRate',to_char(p.impuesto_tasa,'FM990.00'),'taxAmount',p.impuesto_monto::TEXT,'shippingAmount',p.envio_monto::TEXT,'total',p.total::TEXT,
 'items',(SELECT jsonb_agg(jsonb_build_object('title',i.titulo_snapshot,'quantity',i.cantidad,'unitPrice',i.precio_unitario::TEXT,'subtotal',i.subtotal::TEXT) ORDER BY i.pedido_item_id)
  FROM pliego.pedido_item i WHERE i.pedido_id=p.pedido_id),
 'delivery',(SELECT jsonb_build_object('recipient',d.destinatario,'line1',d.direccion_linea1,'line2',d.direccion_linea2,'city',d.ciudad,'province',d.provincia,'country',d.pais_codigo,'postalCode',d.codigo_postal)
  FROM pliego.pedido_direccion d JOIN pliego.pedido_entrega f USING(pedido_id) WHERE d.pedido_id=p.pedido_id AND f.metodo='HOME_DELIVERY'),
 'pickup',pliego.fn_order_fulfillment(p.pedido_id,TRUE)->'pickup')
 FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id)
 WHERE p.pedido_id=p_order AND p.estado='CONFIRMED' ON CONFLICT(evento_clave) DO NOTHING;
$$;

CREATE FUNCTION pliego.fn_customer_order_detail_priced(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id BIGINT,order_state VARCHAR,subtotal NUMERIC(30,2),total NUMERIC(30,2),created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,items JSONB,address JSONB,payment JSONB,state_history JSONB,
    purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB,tax_rate NUMERIC(7,4),tax_amount NUMERIC(30,2),shipping_amount NUMERIC(30,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
SELECT d.*,a.tax_rate,a.tax_amount,a.shipping_amount FROM pliego.fn_customer_order_detail(p_actor_user_id,p_order_id) d
CROSS JOIN LATERAL pliego.fn_order_pricing(d.order_id) a;
$$;

CREATE FUNCTION pliego.fn_admin_order_detail_priced(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id BIGINT,customer_id BIGINT,customer_email VARCHAR,customer_name VARCHAR,order_state VARCHAR,
    subtotal NUMERIC(30,2),total NUMERIC(30,2),created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,
    items JSONB,address JSONB,payment JSONB,state_history JSONB,inventory_movements JSONB,
    purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB,tax_rate NUMERIC(7,4),tax_amount NUMERIC(30,2),shipping_amount NUMERIC(30,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
SELECT d.*,a.tax_rate,a.tax_amount,a.shipping_amount FROM pliego.fn_admin_order_detail(p_actor_user_id,p_order_id) d
CROSS JOIN LATERAL pliego.fn_order_pricing(d.order_id) a;
$$;
