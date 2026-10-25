-- ADR-0042: one active digital copy per customer; preserve historical acquisitions.
-- No destructive deduplication and no new uniqueness constraint over legacy grants.
-- Existing duplicate ACTIVE sources remain refundable and visible for audit.
DO $$ DECLARE identities BIGINT; sources BIGINT; BEGIN
 SELECT count(*),COALESCE(sum(n-1),0) INTO identities,sources FROM (
  SELECT owned_item_id,count(*) n FROM pliego.digital_grant WHERE state='ACTIVE'
  GROUP BY owned_item_id HAVING count(*)>1) duplicates;
 RAISE NOTICE 'Digital ownership preflight: % identities with duplicate ACTIVE grants; % excess sources retained',identities,sources;
END $$;

CREATE INDEX ix_digital_grant_active_ownership ON pliego.digital_grant(owned_item_id,pedido_item_id) WHERE state='ACTIVE';
CREATE INDEX ix_pedido_open_digital_customer ON pliego.pedido(cliente_id,pedido_id)
 WHERE estado<>'CANCELLED' AND finalizado_en IS NULL;

-- Acquire before cart/order/master locks. Reentrant; released by Spring's commit/rollback.
CREATE FUNCTION pliego.fn_lock_digital_customer(p_customer BIGINT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 SELECT pg_advisory_xact_lock(hashtextextended('digital-purchase:'||p_customer,0));
$$;

CREATE FUNCTION pliego.fn_digital_purchase_reason(p_customer BIGINT,p_edition BIGINT,p_order BIGINT DEFAULT NULL)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT CASE WHEN EXISTS(
  SELECT FROM pliego.digital_ownership o JOIN pliego.digital_grant g USING(owned_item_id)
  WHERE o.cliente_id=p_customer AND o.edicion_id=p_edition AND g.state='ACTIVE'
  AND (p_order IS NULL OR NOT EXISTS(SELECT FROM pliego.pedido_item i WHERE i.pedido_item_id=g.pedido_item_id AND i.pedido_id=p_order)))
 THEN 'P6002' WHEN EXISTS(
  SELECT FROM pliego.pedido p JOIN pliego.pedido_item i USING(pedido_id) JOIN pliego.pago pa USING(pedido_id)
  WHERE p.cliente_id=p_customer AND i.edicion_id=p_edition AND i.formato_snapshot IN('EBOOK','AUDIOBOOK')
  AND p.estado<>'CANCELLED' AND p.finalizado_en IS NULL AND pa.estado IN('PENDING','APPROVED')
  AND (p_order IS NULL OR p.pedido_id<>p_order)) THEN 'P6003' END;
$$;

CREATE FUNCTION pliego.fn_assert_digital_purchase(p_customer BIGINT,p_edition BIGINT,p_order BIGINT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE reason TEXT;
BEGIN
 PERFORM pliego.fn_lock_digital_customer(p_customer);
 -- Separate post-lock statement: READ COMMITTED sees the preceding winner's commit.
 reason:=pliego.fn_digital_purchase_reason(p_customer,p_edition,p_order);
 IF reason='P6002' THEN PERFORM pliego.fn_raise_domain_error('P6002','DIGITAL_ALREADY_OWNED'); END IF;
 IF reason='P6003' THEN PERFORM pliego.fn_raise_domain_error('P6003','DIGITAL_PURCHASE_PENDING'); END IF;
END; $$;

CREATE FUNCTION pliego.fn_assert_cart_digital_purchase(p_customer BIGINT,p_cart BIGINT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE line RECORD;
BEGIN
 PERFORM pliego.fn_lock_digital_customer(p_customer);
 FOR line IN SELECT ci.edicion_id FROM pliego.carrito c JOIN pliego.carrito_item ci USING(carrito_id)
 JOIN pliego.edicion e USING(edicion_id) WHERE c.cliente_id=p_customer
 AND ((p_cart IS NULL AND c.estado='ACTIVE') OR c.carrito_id=p_cart)
 AND e.formato IN('EBOOK','AUDIOBOOK') ORDER BY ci.edicion_id LOOP
  PERFORM pliego.fn_assert_digital_purchase(p_customer,line.edicion_id);
 END LOOP;
END; $$;

-- Checks also protect routine callers that create items or capture deferred payment directly.
CREATE FUNCTION pliego.fn_guard_digital_order_item() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE customer BIGINT; BEGIN
 IF NEW.formato_snapshot IN('EBOOK','AUDIOBOOK') THEN
  SELECT cliente_id INTO customer FROM pliego.pedido WHERE pedido_id=NEW.pedido_id;
  PERFORM pliego.fn_assert_digital_purchase(customer,NEW.edicion_id,NEW.pedido_id);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_order_item_digital_purchase BEFORE INSERT ON pliego.pedido_item
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_digital_order_item();

CREATE FUNCTION pliego.fn_guard_digital_payment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$ DECLARE customer BIGINT; line RECORD; BEGIN
 IF NEW.estado IN('PENDING','APPROVED') THEN
  SELECT cliente_id INTO customer FROM pliego.pedido WHERE pedido_id=NEW.pedido_id;
  FOR line IN SELECT edicion_id FROM pliego.pedido_item WHERE pedido_id=NEW.pedido_id
   AND formato_snapshot IN('EBOOK','AUDIOBOOK') ORDER BY edicion_id LOOP
   PERFORM pliego.fn_assert_digital_purchase(customer,line.edicion_id,NEW.pedido_id);
  END LOOP;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_payment_digital_purchase BEFORE INSERT OR UPDATE OF estado ON pliego.pago
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_digital_payment();


CREATE OR REPLACE PROCEDURE pliego.sp_cart_add_item(IN p_actor_user_id BIGINT,IN p_edition_id BIGINT,IN p_quantity INTEGER,OUT o_cart_id BIGINT,OUT o_cart_item_id BIGINT,OUT o_quantity INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_book_state VARCHAR;v_edition_state VARCHAR;v_stock INTEGER;v_current INTEGER;v_format VARCHAR;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;PERFORM pliego.fn_lock_digital_customer(v_customer_id);IF p_quantity IS NULL OR p_quantity<=0 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID');END IF;
 SELECT l.estado,e.estado,e.formato INTO v_book_state,v_edition_state,v_format FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id WHERE e.edicion_id=p_edition_id;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND');END IF;IF v_edition_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P2042','EDITION_INACTIVE');END IF;IF v_book_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P2043','BOOK_INACTIVE');END IF;
 IF NOT pliego.fn_is_physical_format(v_format) THEN
  IF p_quantity<>1 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID'); END IF;
  PERFORM pliego.fn_assert_digital_purchase(v_customer_id,p_edition_id);
 END IF;
 IF pliego.fn_is_physical_format(v_format) THEN SELECT i.stock_actual INTO v_stock FROM pliego.inventario i WHERE i.edicion_id=p_edition_id;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');END IF; END IF;
 INSERT INTO pliego.carrito(cliente_id,estado)VALUES(v_customer_id,'ACTIVE')ON CONFLICT(cliente_id)WHERE estado='ACTIVE' DO NOTHING;
 SELECT c.carrito_id INTO o_cart_id FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE' FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE');END IF;
 SELECT ci.cantidad,ci.carrito_item_id INTO v_current,o_cart_item_id FROM pliego.carrito_item ci WHERE ci.carrito_id=o_cart_id AND ci.edicion_id=p_edition_id;
 IF FOUND THEN o_quantity:=CASE WHEN pliego.fn_is_physical_format(v_format) THEN v_current+p_quantity ELSE 1 END;IF NOT pliego.fn_is_physical_format(v_format) AND o_quantity<>1 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID'); END IF;IF pliego.fn_is_physical_format(v_format) AND o_quantity>v_stock THEN PERFORM pliego.fn_raise_domain_error('P3002','INSUFFICIENT_STOCK');END IF;UPDATE pliego.carrito_item SET cantidad=o_quantity WHERE carrito_item_id=o_cart_item_id;
 ELSE o_quantity:=p_quantity;IF NOT pliego.fn_is_physical_format(v_format) AND o_quantity<>1 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID'); END IF;IF pliego.fn_is_physical_format(v_format) AND o_quantity>v_stock THEN PERFORM pliego.fn_raise_domain_error('P3002','INSUFFICIENT_STOCK');END IF;INSERT INTO pliego.carrito_item(carrito_id,edicion_id,cantidad)VALUES(o_cart_id,p_edition_id,o_quantity)RETURNING carrito_item_id INTO o_cart_item_id;END IF;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_cart_get(p_actor_user_id BIGINT)
RETURNS TABLE(cart_id BIGINT,state VARCHAR,items JSONB,total_current NUMERIC(30,2))
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_cart_id BIGINT;v_state VARCHAR;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;SELECT c.carrito_id,c.estado INTO v_cart_id,v_state FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE';
 IF NOT FOUND THEN RETURN QUERY SELECT NULL::BIGINT,NULL::VARCHAR,'[]'::JSONB,0.00::NUMERIC(30,2);RETURN;END IF;
 RETURN QUERY SELECT v_cart_id,v_state,COALESCE((SELECT jsonb_agg(jsonb_build_object('cartItemId',ci.carrito_item_id,'editionId',e.edicion_id,'title',l.titulo,'authors',pliego.fn_build_authors_snapshot(l.libro_id),'sku',e.sku,'format',e.formato,'coverUrl',e.portada_url,'quantity',ci.cantidad,'currentPrice',pliego.fn_edition_price(e.edicion_id),'currentSubtotal',(ci.cantidad*pliego.fn_edition_price(e.edicion_id)),'available',(pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual,ci.cantidad) AND (pliego.fn_is_physical_format(e.formato) OR pliego.fn_digital_purchase_reason(v_customer_id,e.edicion_id) IS NULL)),'unavailabilityReason',CASE WHEN e.formato IN('EBOOK','AUDIOBOOK') AND pliego.fn_digital_purchase_reason(v_customer_id,e.edicion_id) IS NOT NULL THEN pliego.fn_digital_purchase_reason(v_customer_id,e.edicion_id) WHEN l.estado<>'ACTIVE' THEN 'P2043' WHEN e.estado<>'ACTIVE' THEN 'P2042' WHEN NOT pliego.fn_is_physical_format(e.formato) AND ci.cantidad<>1 THEN 'P4004' WHEN pliego.fn_is_physical_format(e.formato) AND COALESCE(i.stock_actual,0)<ci.cantidad THEN 'P3002' ELSE NULL END)ORDER BY ci.fecha_creacion,ci.carrito_item_id) FROM pliego.carrito_item ci JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id JOIN pliego.libro l ON l.libro_id=e.libro_id LEFT JOIN pliego.inventario i ON i.edicion_id=e.edicion_id WHERE ci.carrito_id=v_cart_id),'[]'::JSONB),COALESCE((SELECT sum(ci.cantidad*pliego.fn_edition_price(e.edicion_id))::NUMERIC(30,2) FROM pliego.carrito_item ci JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id WHERE ci.carrito_id=v_cart_id),0.00::NUMERIC(30,2));
END;$$;

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

    PERFORM pliego.fn_assert_cart_digital_purchase(v_customer_id);

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

CREATE OR REPLACE PROCEDURE pliego.sp_checkout(IN p_actor BIGINT,IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE location pliego.ubicacion_retiro%ROWTYPE; mode VARCHAR:=COALESCE(p_fulfillment,'HOME_DELIVERY'); now_at TIMESTAMPTZ; customer BIGINT; cart BIGINT; has_physical BOOLEAN;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 PERFORM pliego.fn_assert_cart_digital_purchase(customer);
 SELECT carrito_id INTO cart FROM pliego.carrito WHERE cliente_id=customer AND estado='ACTIVE' FOR UPDATE;
 IF cart IS NULL THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE'); END IF;
 IF NOT EXISTS(SELECT FROM pliego.carrito_item WHERE carrito_id=cart) THEN PERFORM pliego.fn_raise_domain_error('P4002','CART_EMPTY'); END IF;
 SELECT EXISTS(SELECT FROM pliego.carrito_item ci JOIN pliego.edicion e USING(edicion_id) WHERE ci.carrito_id=cart AND pliego.fn_is_physical_format(e.formato)) INTO has_physical;
 IF mode='STORE_PICKUP' AND NOT has_physical THEN PERFORM pliego.fn_raise_domain_error('P5012','PICKUP_REQUIRES_PHYSICAL'); END IF;
 IF mode NOT IN ('HOME_DELIVERY','STORE_PICKUP','DIGITAL_ONLY') OR
 (mode='DIGITAL_ONLY' AND (has_physical OR p_address IS NOT NULL OR p_pickup IS NOT NULL)) OR
 (mode<>'DIGITAL_ONLY' AND NOT has_physical) OR
 (mode='HOME_DELIVERY' AND (p_address IS NULL OR p_pickup IS NOT NULL)) OR
 (mode='STORE_PICKUP' AND (p_address IS NOT NULL OR p_pickup IS NULL)) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF mode='STORE_PICKUP' THEN
  SELECT * INTO location FROM pliego.ubicacion_retiro WHERE ubicacion_retiro_id=p_pickup FOR SHARE;
  IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5010','PICKUP_LOCATION_NOT_FOUND'); END IF;
  IF NOT location.activo THEN PERFORM pliego.fn_raise_domain_error('P5011','PICKUP_LOCATION_INACTIVE'); END IF;
 END IF;
 CALL pliego.sp_checkout_execute(p_actor,p_address,p_method,p_outcome,mode,p_pickup,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 IF EXISTS(SELECT FROM pliego.pedido_item i WHERE i.pedido_id=o_order_id AND pliego.fn_is_physical_format(i.formato_snapshot)) THEN
  INSERT INTO pliego.pedido_entrega(pedido_id,metodo) VALUES(o_order_id,mode);
  IF mode='HOME_DELIVERY' THEN
   WITH shipment AS (
    INSERT INTO pliego.envio(pedido_id,estado,fecha_cancelacion) VALUES(o_order_id,CASE WHEN o_order_state='CANCELLED' THEN 'CANCELLED' ELSE 'PENDING' END,
     CASE WHEN o_order_state='CANCELLED' THEN CURRENT_TIMESTAMP END) RETURNING envio_id,estado)
   INSERT INTO pliego.envio_historial(envio_id,tipo,origen,estado_nuevo) SELECT envio_id,'STATUS','SYSTEM',estado FROM shipment;
  ELSE
   now_at:=clock_timestamp();
   INSERT INTO pliego.pedido_retiro(pedido_id,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,codigo_postal,latitud,longitud,
    zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,codigo)
   VALUES(o_order_id,location.ubicacion_retiro_id,location.nombre,location.direccion,location.ciudad,location.provincia,location.pais_codigo,location.codigo_postal,
    location.latitud,location.longitud,location.zona_horaria,location.apertura,location.cierre,location.preparacion_minutos,
    now_at,now_at+make_interval(mins=>location.preparacion_minutos),pliego.fn_generate_pickup_code());
  END IF;
 END IF;
 PERFORM pliego.fn_order_confirmation_enqueue(o_order_id);
END; $$;

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
 PERFORM pliego.fn_lock_digital_customer(customer);
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
 PERFORM pliego.fn_assert_cart_digital_purchase(customer,p_cart);
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

CREATE OR REPLACE PROCEDURE pliego.sp_checkout_idempotent(IN p_actor BIGINT,IN p_key UUID,IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,IN p_cart BIGINT,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE receipt pliego.checkout_attempt%ROWTYPE; customer_id BIGINT; cart_id BIGINT; mode VARCHAR:=COALESCE(p_fulfillment,'HOME_DELIVERY');
BEGIN
 SELECT a.cliente_id INTO customer_id FROM pliego.fn_assert_actor(p_actor,'CUSTOMER') a;
 PERFORM pliego.fn_lock_digital_customer(customer_id);
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
 PERFORM pliego.fn_assert_cart_digital_purchase(customer_id,p_cart);
 IF p_cart IS NOT NULL THEN
  SELECT carrito_id INTO cart_id FROM pliego.carrito WHERE cliente_id=customer_id AND estado='ACTIVE' FOR UPDATE;
  IF cart_id IS DISTINCT FROM p_cart THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE'); END IF;
 END IF;
 CALL pliego.sp_checkout(p_actor,p_address,p_method,p_outcome,mode,p_pickup,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 INSERT INTO pliego.checkout_attempt(actor_user_id,attempt_key,state,address_id,cart_id,payment_method,simulation_outcome,order_id,order_state,payment_state,total,payment_reference,fulfillment_method,pickup_location_id)
 VALUES(p_actor,p_key,'CREATED',p_address,p_cart,p_method,p_outcome,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference,mode,p_pickup);
END; $$;

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
 PERFORM pliego.fn_lock_digital_customer(customer);
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
 PERFORM pliego.fn_assert_cart_digital_purchase(customer,p_cart);
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

CREATE OR REPLACE PROCEDURE pliego.sp_billed_order_approve(IN p_actor BIGINT,IN p_order_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE purchase pliego.pedido%ROWTYPE; line RECORD; invoice BIGINT; before_stock INTEGER;
BEGIN
 PERFORM pliego.fn_assert_actor(p_actor,'ADMIN');
 PERFORM pliego.fn_lock_digital_customer((SELECT cliente_id FROM pliego.pedido WHERE pedido_id=p_order_id));
 SELECT * INTO purchase FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 IF NOT EXISTS(SELECT FROM pliego.factura WHERE pedido_id=p_order_id AND procedencia='SIMULATED') THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 IF EXISTS(SELECT FROM pliego.pago WHERE pedido_id=p_order_id AND estado='APPROVED') AND purchase.estado<>'CANCELLED' THEN
  CALL pliego.sp_invoice_finalize_for_order(p_actor,p_order_id,invoice); RETURN; END IF;
 IF purchase.estado<>'PENDING_PAYMENT' OR NOT EXISTS(SELECT FROM pliego.pago WHERE pedido_id=p_order_id AND estado='PENDING') THEN PERFORM pliego.fn_raise_domain_error('P5006','PAYMENT_STATE_INVALID'); END IF;
 FOR line IN SELECT edicion_id FROM pliego.pedido_item WHERE pedido_id=p_order_id AND formato_snapshot IN('EBOOK','AUDIOBOOK') ORDER BY edicion_id LOOP
  PERFORM pliego.fn_assert_digital_purchase(purchase.cliente_id,line.edicion_id,p_order_id);
 END LOOP;
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

CREATE OR REPLACE PROCEDURE pliego.sp_digital_ownership_reconcile(IN p_order BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE purchase RECORD; line RECORD; owned BIGINT; grant_state VARCHAR;
BEGIN
 SELECT p.cliente_id,p.estado,pa.estado AS payment_state,p.fecha_creacion INTO purchase
 FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) WHERE p.pedido_id=p_order;
 IF NOT FOUND THEN RETURN; END IF;
 IF purchase.payment_state NOT IN ('APPROVED','REFUNDED') THEN RETURN; END IF;
 grant_state:=CASE WHEN purchase.payment_state='APPROVED' AND purchase.estado<>'CANCELLED' THEN 'ACTIVE' ELSE 'REVOKED' END;
 FOR line IN SELECT * FROM pliego.pedido_item WHERE pedido_id=p_order AND formato_snapshot IN ('EBOOK','AUDIOBOOK') ORDER BY edicion_id LOOP
  IF EXISTS(SELECT FROM pliego.digital_grant WHERE pedido_item_id=line.pedido_item_id AND state=grant_state) THEN CONTINUE; END IF;
  IF grant_state='ACTIVE' THEN
   PERFORM pliego.fn_assert_digital_purchase(purchase.cliente_id,line.edicion_id,p_order);
  END IF;
  SELECT owned_item_id INTO owned FROM pliego.digital_ownership WHERE cliente_id=purchase.cliente_id AND edicion_id=line.edicion_id;
  IF owned IS NULL THEN
   -- ACTIVE creation is serialized above. REVOKED historical creation uses the
   -- same identity lock, without changing existing grants or acquisition snapshots.
   PERFORM pliego.fn_lock_digital_customer(purchase.cliente_id);
   SELECT owned_item_id INTO owned FROM pliego.digital_ownership WHERE cliente_id=purchase.cliente_id AND edicion_id=line.edicion_id;
   IF owned IS NULL THEN
    INSERT INTO pliego.digital_ownership(cliente_id,edicion_id) VALUES(purchase.cliente_id,line.edicion_id) RETURNING owned_item_id INTO owned;
   END IF;
  END IF;
  INSERT INTO pliego.digital_grant(pedido_item_id,owned_item_id,acquired_at,state,metadata_snapshot)
  VALUES(line.pedido_item_id,owned,purchase.fecha_creacion,grant_state,pliego.fn_digital_metadata_snapshot(line.edicion_id))
  ON CONFLICT(pedido_item_id) DO UPDATE SET state=EXCLUDED.state;
 END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION pliego.fn_guard_digital_grant() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT; edition BIGINT;
BEGIN
 IF TG_OP='DELETE' THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF TG_OP='UPDATE' AND (NEW.pedido_item_id IS DISTINCT FROM OLD.pedido_item_id OR
 NEW.owned_item_id IS DISTINCT FROM OLD.owned_item_id OR NEW.acquired_at IS DISTINCT FROM OLD.acquired_at OR
 NEW.metadata_snapshot IS DISTINCT FROM OLD.metadata_snapshot) THEN
 PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF NOT EXISTS(SELECT FROM pliego.digital_ownership o JOIN pliego.pedido_item i ON i.pedido_item_id=NEW.pedido_item_id
 JOIN pliego.pedido p USING(pedido_id) JOIN pliego.pago pa USING(pedido_id)
 WHERE o.owned_item_id=NEW.owned_item_id AND o.cliente_id=p.cliente_id AND o.edicion_id=i.edicion_id
 AND i.formato_snapshot IN('EBOOK','AUDIOBOOK') AND pa.estado IN('APPROVED','REFUNDED')
 AND (NEW.state='REVOKED' OR (pa.estado='APPROVED' AND p.estado<>'CANCELLED'))) THEN
 PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF NEW.state='ACTIVE' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
  SELECT cliente_id,edicion_id INTO customer,edition FROM pliego.digital_ownership WHERE owned_item_id=NEW.owned_item_id;
  PERFORM pliego.fn_lock_digital_customer(customer);
  IF EXISTS(SELECT FROM pliego.digital_grant WHERE owned_item_id=NEW.owned_item_id AND state='ACTIVE' AND pedido_item_id<>NEW.pedido_item_id) THEN
   PERFORM pliego.fn_raise_domain_error('P6002','DIGITAL_ALREADY_OWNED'); END IF;
 END IF;
 RETURN NEW;
END; $$;

-- Advisory read only: checkout always revalidates under its transaction lock.
-- Missing, inactive and physical IDs return purchasable=false; input order is retained,
-- duplicate IDs collapse to their first occurrence. Validation matches favorites batches.
CREATE FUNCTION pliego.fn_customer_digital_eligibility(p_actor BIGINT,p_editions BIGINT[])
RETURNS TABLE(edition_id BIGINT,owned BOOLEAN,owned_item_id BIGINT,pending_order BOOLEAN,pending_order_id BIGINT,in_cart BOOLEAN,purchasable BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$ DECLARE customer BIGINT; BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF p_editions IS NULL OR cardinality(p_editions) NOT BETWEEN 1 AND 50 OR EXISTS(SELECT FROM unnest(p_editions) id WHERE id IS NULL OR id<=0) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY WITH ids AS (SELECT id,min(pos) pos FROM unnest(p_editions) WITH ORDINALITY t(id,pos) GROUP BY id)
 SELECT ids.id,active.owned_id IS NOT NULL,active.owned_id,
 pending.order_id IS NOT NULL,pending.order_id,
 EXISTS(SELECT FROM pliego.carrito c JOIN pliego.carrito_item ci USING(carrito_id) WHERE c.cliente_id=customer AND c.estado='ACTIVE' AND ci.edicion_id=ids.id),
 COALESCE(e.formato IN('EBOOK','AUDIOBOOK') AND e.estado='ACTIVE' AND l.estado='ACTIVE'
  AND pliego.fn_digital_purchase_reason(customer,ids.id) IS NULL,FALSE)
 FROM ids LEFT JOIN LATERAL (SELECT min(p.pedido_id) order_id
  FROM pliego.pedido p JOIN pliego.pedido_item i USING(pedido_id) JOIN pliego.pago pa USING(pedido_id)
  WHERE p.cliente_id=customer AND i.edicion_id=ids.id AND i.formato_snapshot IN('EBOOK','AUDIOBOOK')
  AND p.estado<>'CANCELLED' AND p.finalizado_en IS NULL AND pa.estado IN('PENDING','APPROVED')) pending ON TRUE
 LEFT JOIN pliego.edicion e ON e.edicion_id=ids.id LEFT JOIN pliego.libro l USING(libro_id)
 LEFT JOIN LATERAL (SELECT o.owned_item_id owned_id FROM pliego.digital_ownership o WHERE o.cliente_id=customer AND o.edicion_id=ids.id
  AND EXISTS(SELECT FROM pliego.digital_grant g WHERE g.owned_item_id=o.owned_item_id AND g.state='ACTIVE')) active ON TRUE
 ORDER BY ids.pos;
END; $$;


-- Fresh eligibility projection after the same customer lock used by acceptance.
CREATE OR REPLACE FUNCTION pliego.fn_cart_checkout_quote(p_actor BIGINT)
RETURNS TABLE(cart_id BIGINT,state VARCHAR,items JSONB,total_current NUMERIC(30,2),
 subtotal NUMERIC(30,2),tax_rate NUMERIC(7,4),tax_amount NUMERIC(30,2),
 shipping_amount NUMERIC(30,2),total NUMERIC(30,2),original_subtotal NUMERIC(30,2),
 savings_total NUMERIC(30,2),current_subtotal NUMERIC(30,2),quote_fingerprint TEXT)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE customer BIGINT;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 PERFORM pliego.fn_lock_digital_customer(customer);
 -- Keep unavailable cart lines visible; acceptance raises their domain conflict.
 RETURN QUERY WITH q AS MATERIALIZED (SELECT * FROM pliego.fn_cart_offer_quote(p_actor))
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
END;
$$;
