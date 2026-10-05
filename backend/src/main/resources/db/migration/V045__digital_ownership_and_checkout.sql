-- Separate commercial digital ownership from physical fulfillment; see ADR-0026.
ALTER TABLE pliego.checkout_attempt DROP CONSTRAINT ck_checkout_fulfillment;
ALTER TABLE pliego.checkout_attempt ADD CONSTRAINT ck_checkout_fulfillment CHECK (
 fulfillment_method IN ('HOME_DELIVERY','STORE_PICKUP','DIGITAL_ONLY') AND (state='NOT_CREATED' OR
 (fulfillment_method='HOME_DELIVERY' AND address_id IS NOT NULL AND pickup_location_id IS NULL) OR
 (fulfillment_method='STORE_PICKUP' AND address_id IS NULL AND pickup_location_id IS NOT NULL) OR
 (fulfillment_method='DIGITAL_ONLY' AND address_id IS NULL AND pickup_location_id IS NULL)));

CREATE TABLE pliego.digital_ownership (
 owned_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_id BIGINT NOT NULL REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT,
 edicion_id BIGINT NOT NULL REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT,
 UNIQUE(cliente_id,edicion_id)
);
CREATE TABLE pliego.digital_grant (
 pedido_item_id BIGINT PRIMARY KEY REFERENCES pliego.pedido_item(pedido_item_id) ON DELETE RESTRICT,
 owned_item_id BIGINT NOT NULL REFERENCES pliego.digital_ownership(owned_item_id) ON DELETE RESTRICT,
 acquired_at TIMESTAMPTZ NOT NULL,
 state VARCHAR(16) NOT NULL CHECK(state IN ('ACTIVE','REVOKED')),
 metadata_snapshot JSONB NOT NULL,
 CHECK(jsonb_typeof(metadata_snapshot)='object')
);
CREATE INDEX ix_digital_grant_ownership ON pliego.digital_grant(owned_item_id,acquired_at,pedido_item_id);

CREATE FUNCTION pliego.fn_digital_metadata_snapshot(p_edition BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT jsonb_build_object('coverUrl',e.portada_url,'pageCount',e.numero_paginas,'publicationDate',e.fecha_publicacion,
 'ebookFileFormat',e.ebook_formato,'audioDurationSeconds',e.audio_duracion_segundos,'narrators',to_jsonb(e.audio_narradores))
 FROM pliego.edicion e WHERE e.edicion_id=p_edition;
$$;

CREATE PROCEDURE pliego.sp_digital_ownership_reconcile(IN p_order BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE purchase RECORD; line RECORD; owned BIGINT; grant_state VARCHAR;
BEGIN
 SELECT p.cliente_id,p.estado,pa.estado AS payment_state,p.fecha_creacion INTO purchase
 FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) WHERE p.pedido_id=p_order;
 IF NOT FOUND THEN RETURN; END IF;
 IF purchase.payment_state NOT IN ('APPROVED','REFUNDED') THEN RETURN; END IF;
 grant_state:=CASE WHEN purchase.payment_state='APPROVED' AND purchase.estado<>'CANCELLED' THEN 'ACTIVE' ELSE 'REVOKED' END;
 FOR line IN SELECT * FROM pliego.pedido_item WHERE pedido_id=p_order AND formato_snapshot IN ('EBOOK','AUDIOBOOK') ORDER BY edicion_id LOOP
  INSERT INTO pliego.digital_ownership(cliente_id,edicion_id) VALUES(purchase.cliente_id,line.edicion_id)
  ON CONFLICT(cliente_id,edicion_id) DO NOTHING;
  SELECT owned_item_id INTO owned FROM pliego.digital_ownership WHERE cliente_id=purchase.cliente_id AND edicion_id=line.edicion_id;
  INSERT INTO pliego.digital_grant(pedido_item_id,owned_item_id,acquired_at,state,metadata_snapshot)
  VALUES(line.pedido_item_id,owned,purchase.fecha_creacion,grant_state,pliego.fn_digital_metadata_snapshot(line.edicion_id))
  ON CONFLICT(pedido_item_id) DO UPDATE SET state=EXCLUDED.state;
 END LOOP;
END; $$;
CREATE FUNCTION pliego.fn_sync_digital_ownership() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN CALL pliego.sp_digital_ownership_reconcile(NEW.pedido_id); RETURN NEW; END; $$;
CREATE TRIGGER trg_payment_digital_ownership AFTER INSERT OR UPDATE OF estado ON pliego.pago
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_sync_digital_ownership();
CREATE TRIGGER trg_order_digital_ownership AFTER UPDATE OF estado ON pliego.pedido
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_sync_digital_ownership();
-- Historical APPROVED and REFUNDED purchases are proof of acquisition; canceled grants stay revoked.
DO $$ DECLARE o RECORD; BEGIN
 FOR o IN SELECT pedido_id FROM pliego.pago WHERE estado IN('APPROVED','REFUNDED') ORDER BY pedido_id LOOP
 CALL pliego.sp_digital_ownership_reconcile(o.pedido_id); END LOOP;
END $$;

CREATE FUNCTION pliego.fn_library_item(p_owned BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT jsonb_build_object('ownedItemId',o.owned_item_id::TEXT,'editionId',o.edicion_id::TEXT,
 'coverUrl',g.metadata_snapshot->'coverUrl','title',i.titulo_snapshot,'authors',i.autores_snapshot,
 'productType',i.formato_snapshot,'acquiredAt',g.acquired_at,
 'ownershipState',CASE WHEN active.owned THEN 'OWNED' ELSE 'REVOKED' END,
 'accessState',CASE WHEN active.owned THEN 'OWNERSHIP_ONLY' ELSE 'REVOKED' END,'contentAccessSupported',FALSE,
 'metadata',jsonb_build_object('isbn',i.isbn_snapshot,'publisher',i.editorial_snapshot,'language',i.idioma_snapshot,
 'pageCount',g.metadata_snapshot->'pageCount','publicationDate',g.metadata_snapshot->'publicationDate',
 'ebookFileFormat',g.metadata_snapshot->'ebookFileFormat','audioDurationSeconds',g.metadata_snapshot->'audioDurationSeconds',
 'narrators',g.metadata_snapshot->'narrators'),
 'sourcePurchases',(SELECT jsonb_agg(jsonb_build_object('orderId',pi.pedido_id::TEXT,'orderItemId',gr.pedido_item_id::TEXT,
 'acquiredAt',gr.acquired_at,'paymentState',pa.estado,'orderState',p.estado,'grantState',gr.state) ORDER BY gr.acquired_at DESC,gr.pedido_item_id DESC)
 FROM pliego.digital_grant gr JOIN pliego.pedido_item pi USING(pedido_item_id) JOIN pliego.pedido p USING(pedido_id)
 JOIN pliego.pago pa USING(pedido_id) WHERE gr.owned_item_id=o.owned_item_id),
 'availableActions',jsonb_build_array(jsonb_build_object('type','VIEW_ORDER','label','Ver pedido','href','/orders/'||i.pedido_id),
 jsonb_build_object('type','HELP','label','Ayuda','href',CASE WHEN i.formato_snapshot='EBOOK' THEN '/ayuda/ebooks' ELSE '/ayuda/audiolibros' END)))
 FROM pliego.digital_ownership o
 CROSS JOIN LATERAL (SELECT EXISTS(SELECT FROM pliego.digital_grant gr WHERE gr.owned_item_id=o.owned_item_id AND gr.state='ACTIVE') AS owned) active
 JOIN LATERAL (SELECT gr.* FROM pliego.digital_grant gr WHERE gr.owned_item_id=o.owned_item_id
 ORDER BY gr.acquired_at,gr.pedido_item_id LIMIT 1) g ON TRUE
 JOIN pliego.pedido_item i USING(pedido_item_id) WHERE o.owned_item_id=p_owned;
$$;
CREATE FUNCTION pliego.fn_customer_library(p_actor BIGINT,p_product_type VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(owned_item_id BIGINT,item JSONB,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE customer BIGINT;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF (p_product_type IS NOT NULL AND p_product_type NOT IN ('EBOOK','AUDIOBOOK')) OR p_page<0 OR p_page_size NOT BETWEEN 1 AND 50
 OR p_page IS NULL OR p_page_size IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT o.owned_item_id,pliego.fn_library_item(o.owned_item_id),count(*) OVER()
 FROM pliego.digital_ownership o JOIN pliego.edicion e USING(edicion_id)
 WHERE o.cliente_id=customer AND (p_product_type IS NULL OR e.formato=p_product_type)
 ORDER BY (SELECT min(g.acquired_at) FROM pliego.digital_grant g WHERE g.owned_item_id=o.owned_item_id) DESC,o.owned_item_id DESC
 LIMIT p_page_size OFFSET p_page::BIGINT*p_page_size;
END; $$;
CREATE FUNCTION pliego.fn_customer_library_detail(p_actor BIGINT,p_owned BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE customer BIGINT; item JSONB;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 SELECT pliego.fn_library_item(o.owned_item_id) INTO item FROM pliego.digital_ownership o WHERE o.owned_item_id=p_owned AND o.cliente_id=customer;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P6001','LIBRARY_ITEM_NOT_FOUND'); END IF;
 RETURN item;
END; $$;
CREATE FUNCTION pliego.fn_cart_checkout_requirements(p_actor BIGINT)
RETURNS TABLE(requires_physical_fulfillment BOOLEAN,physical_item_count INTEGER,digital_item_count INTEGER)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE customer BIGINT;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 RETURN QUERY SELECT count(*) FILTER(WHERE pliego.fn_is_physical_format(e.formato))>0,
 (count(*) FILTER(WHERE pliego.fn_is_physical_format(e.formato)))::INTEGER,
 (count(*) FILTER(WHERE NOT pliego.fn_is_physical_format(e.formato)))::INTEGER
 FROM pliego.carrito c JOIN pliego.carrito_item ci USING(carrito_id) JOIN pliego.edicion e USING(edicion_id)
 WHERE c.cliente_id=customer AND c.estado='ACTIVE';
END; $$;

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


-- Global facets include only existing active public offers. Parent chips retain
-- catalog category navigation and count distinct matching editions.
CREATE OR REPLACE PROCEDURE pliego.sp_checkout(IN p_actor BIGINT,IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE location pliego.ubicacion_retiro%ROWTYPE; mode VARCHAR:=COALESCE(p_fulfillment,'HOME_DELIVERY'); now_at TIMESTAMPTZ; customer BIGINT; cart BIGINT; has_physical BOOLEAN;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
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

CREATE FUNCTION pliego.fn_guard_owned_digital_format() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.formato IS DISTINCT FROM OLD.formato AND EXISTS(SELECT FROM pliego.digital_ownership WHERE edicion_id=OLD.edicion_id) THEN
 PERFORM pliego.fn_raise_domain_error('P2048','EDITION_DATA_INVALID'); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_edicion_owned_media BEFORE UPDATE OF formato ON pliego.edicion
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_owned_digital_format();
