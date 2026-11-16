-- ADR0058: precise checkout expiration and durable offer refresh.
-- Scratch SQL fragment for parent assembly into a new migration. No historical
-- migration is modified and no historical order is repriced or backfilled.
-- Read projections retain a single statement clock. Checkout captures an
-- explicit wall-clock instant after its locks and uses it for every paid value.

CREATE FUNCTION pliego.fn_edition_offer_at(p_edition BIGINT,p_at TIMESTAMPTZ)
RETURNS TABLE(price NUMERIC(11,2),offer_id BIGINT,original_price NUMERIC(11,2),discount_amount NUMERIC(11,2),starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,days_remaining INTEGER,ending_soon BOOLEAN,offer_copy VARCHAR,terms VARCHAR,savings_percent NUMERIC(7,2))
LANGUAGE sql STABLE SECURITY INVOKER ROWS 1 AS $$
 SELECT COALESCE(o.precio_oferta,e.precio)::NUMERIC(11,2),o.oferta_id,e.precio,
 (e.precio-COALESCE(o.precio_oferta,e.precio))::NUMERIC(11,2),o.inicio,o.fin,
 CASE WHEN o.oferta_id IS NOT NULL THEN pliego.fn_offer_days_remaining(o.fin,p_at) END,
 CASE WHEN o.oferta_id IS NOT NULL THEN pliego.fn_offer_ending_soon(pliego.fn_offer_days_remaining(o.fin,p_at)) END,
 o.oferta_texto,o.condiciones,round((e.precio-COALESCE(o.precio_oferta,e.precio))*100/e.precio,2)::NUMERIC(7,2)
 FROM pliego.edicion e LEFT JOIN pliego.edicion_oferta o ON o.edicion_id=e.edicion_id
 AND o.estado='ACTIVE' AND o.inicio<=p_at AND o.fin>p_at AND o.precio_oferta<e.precio
 WHERE e.edicion_id=p_edition;
$$;

CREATE FUNCTION pliego.fn_edition_price_at(p_edition BIGINT,p_at TIMESTAMPTZ)
RETURNS NUMERIC(11,2) LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT price FROM pliego.fn_edition_offer_at(p_edition,p_at);
$$;


CREATE OR REPLACE FUNCTION pliego.fn_edition_offer(p_edition BIGINT)
RETURNS TABLE(price NUMERIC(11,2),offer_id BIGINT,original_price NUMERIC(11,2),discount_amount NUMERIC(11,2),starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,days_remaining INTEGER,ending_soon BOOLEAN,offer_copy VARCHAR,terms VARCHAR,savings_percent NUMERIC(7,2))
LANGUAGE sql STABLE SECURITY INVOKER ROWS 1 AS $$
 SELECT * FROM pliego.fn_edition_offer_at(p_edition,statement_timestamp());
$$;

-- Legacy orders deliberately retain NULL: their original pricing instant is
-- unknown. The timestamp is part of a new order's immutable financial snapshot.
ALTER TABLE pliego.pedido ADD COLUMN pricing_evaluated_at TIMESTAMPTZ,
 ADD CONSTRAINT ck_pedido_pricing_instant_finite
 CHECK(pricing_evaluated_at IS NULL OR isfinite(pricing_evaluated_at));

CREATE FUNCTION pliego.fn_guard_order_pricing_instant() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.pricing_evaluated_at IS DISTINCT FROM OLD.pricing_evaluated_at THEN
  PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION'); END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER trg_pedido_pricing_instant_immutable BEFORE UPDATE ON pliego.pedido
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_order_pricing_instant();


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
    v_priced_at TIMESTAMPTZ;
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
               e.precio AS precio, e.formato
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

    -- Offer time cannot be frozen at the start of a CALL that waited on locks.
    -- Reuse this single post-lock instant for the header, every item and its
    -- original/savings trigger, even if the wall clock crosses an offer end later.
    v_priced_at:=clock_timestamp();

    SELECT sum(ci.cantidad * pliego.fn_edition_price_at(e.edicion_id,v_priced_at))::NUMERIC(30,2)
      INTO v_subtotal
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
     WHERE ci.carrito_id = v_cart_id;

    IF v_subtotal IS NULL OR v_subtotal <= 0 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid order total');
    END IF;

    SELECT sum(round(ci.cantidad*pliego.fn_edition_price_at(e.edicion_id,v_priced_at)*v_rate/100,2))::NUMERIC(30,2)
      INTO v_tax FROM pliego.carrito_item ci JOIN pliego.edicion e USING(edicion_id) WHERE ci.carrito_id=v_cart_id;
    o_total:=v_subtotal+v_tax;
    INSERT INTO pliego.pedido(cliente_id, estado, subtotal, total, impuesto_tasa, impuesto_monto, envio_monto, pricing_evaluated_at)
    VALUES (v_customer_id, 'PENDING_PAYMENT', v_subtotal, o_total, v_rate, v_tax, 0.00, v_priced_at)
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
           pliego.fn_edition_price_at(e.edicion_id,v_priced_at),
           ci.cantidad,
           (pliego.fn_edition_price_at(e.edicion_id,v_priced_at) * ci.cantidad)::NUMERIC(30,2), v_rate, round(pliego.fn_edition_price_at(e.edicion_id,v_priced_at)*ci.cantidad*v_rate/100,2)
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

CREATE OR REPLACE FUNCTION pliego.fn_capture_order_item_offer_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE pricing RECORD; priced_at TIMESTAMPTZ;
BEGIN
 IF EXISTS(SELECT 1 FROM pliego.pago WHERE pedido_id=NEW.pedido_id) THEN
  PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION');
 END IF;
 PERFORM 1 FROM pliego.edicion WHERE edicion_id=NEW.edicion_id FOR SHARE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND'); END IF;
 -- V054 already holds the parent lock before this trigger. The executor
 -- supplies its post-lock instant; direct Database API insert paths use wall
 -- time only after this trigger has acquired their edition lock.
 SELECT pricing_evaluated_at INTO priced_at FROM pliego.pedido WHERE pedido_id=NEW.pedido_id;
 SELECT * INTO pricing FROM pliego.fn_edition_offer_at(NEW.edicion_id,COALESCE(priced_at,clock_timestamp()));
 IF pricing.price IS DISTINCT FROM NEW.precio_unitario THEN
  PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION');
 END IF;
 NEW.precio_original_snapshot:=pricing.original_price;
 NEW.ahorro_unitario_snapshot:=pricing.discount_amount;
 NEW.subtotal_original_snapshot:=(pricing.original_price*NEW.cantidad)::NUMERIC(30,2);
 NEW.ahorro_linea_snapshot:=(pricing.discount_amount*NEW.cantidad)::NUMERIC(30,2);
 RETURN NEW;
END;
$$;

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
 -- The precheck cannot predict an expiry during a later address/pickup or
 -- inventory lock wait. Compare the accepted fingerprint to the exact created
 -- order, never to the now-checked-out cart or a second wall-clock evaluation.
 -- A mismatch raises within the caller's transaction and rolls back the order,
 -- payment, stock movements, ownership and transactional mail together.
 IF p_quote IS NOT NULL THEN
  SELECT encode(sha256(convert_to(jsonb_build_object(
   'version',1,'actor',p_actor,'cartId',active_cart,
   'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'editionId',i.edicion_id,'format',i.formato_snapshot,
    'quantity',i.cantidad,'price',i.precio_unitario::NUMERIC(11,2),
    'subtotal',i.subtotal::NUMERIC(30,2),
    'originalPrice',i.precio_original_snapshot::NUMERIC(11,2),
    'unitSavings',i.ahorro_unitario_snapshot::NUMERIC(11,2),
    'originalSubtotal',i.subtotal_original_snapshot::NUMERIC(30,2),
    'lineSavings',i.ahorro_linea_snapshot::NUMERIC(30,2)) ORDER BY i.edicion_id)
    FROM pliego.pedido_item i WHERE i.pedido_id=o_order_id),'[]'::JSONB),
   'subtotal',p.subtotal::NUMERIC(30,2),'taxRate',p.impuesto_tasa::NUMERIC(7,4),
   'taxAmount',p.impuesto_monto::NUMERIC(30,2),
   'shippingAmount',p.envio_monto::NUMERIC(30,2),'total',p.total::NUMERIC(30,2),
   'originalSubtotal',(SELECT COALESCE(sum(i.subtotal_original_snapshot),0.00)::NUMERIC(30,2)
     FROM pliego.pedido_item i WHERE i.pedido_id=o_order_id),
   'savingsTotal',(SELECT COALESCE(sum(i.ahorro_linea_snapshot),0.00)::NUMERIC(30,2)
     FROM pliego.pedido_item i WHERE i.pedido_id=o_order_id)
  )::TEXT,'UTF8')),'hex') INTO accepted
  FROM pliego.pedido p WHERE p.pedido_id=o_order_id;
  IF accepted IS DISTINCT FROM p_quote THEN
   PERFORM pliego.fn_raise_domain_error('P4005','CART_QUOTE_CHANGED'); END IF;
 END IF;
 INSERT INTO pliego.checkout_attempt(actor_user_id,attempt_key,state,address_id,cart_id,
  payment_method,simulation_outcome,order_id,order_state,payment_state,total,payment_reference,
  fulfillment_method,pickup_location_id,quote_fingerprint)
 VALUES(p_actor,p_key,'CREATED',p_address,p_cart,p_method,p_outcome,o_order_id,
  o_order_state,o_payment_state,o_total,o_payment_reference,mode,p_pickup,p_quote);
END;
$$;

-- Existing public signatures keep their ACLs through CREATE OR REPLACE.
-- New internal helpers are executable only by the established runtime role.
REVOKE ALL ON FUNCTION pliego.fn_edition_offer_at(BIGINT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_edition_price_at(BIGINT,TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_guard_order_pricing_instant() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT EXECUTE ON FUNCTION pliego.fn_edition_offer_at(BIGINT,TIMESTAMPTZ) TO pliego_app;
  GRANT EXECUTE ON FUNCTION pliego.fn_edition_price_at(BIGINT,TIMESTAMPTZ) TO pliego_app;
  GRANT EXECUTE ON FUNCTION pliego.fn_guard_order_pricing_instant() TO pliego_app;
 END IF;
END $$;


-- ADR0058: public catalog hints are an explicit, narrowly allowlisted scope.
ALTER TABLE pliego.realtime_event ADD COLUMN public_scope BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pliego.realtime_event DROP CONSTRAINT realtime_event_check;
ALTER TABLE pliego.realtime_event ADD CONSTRAINT ck_realtime_event_scope CHECK (
 (NOT public_scope AND ((admin_scope AND user_id IS NULL) OR (NOT admin_scope AND user_id IS NOT NULL)))
 OR (public_scope AND NOT admin_scope AND user_id IS NULL
  AND event_name='catalog.offers.changed' AND resource_type='edition' AND resource_id ~ '^[1-9][0-9]*$'));
CREATE INDEX ix_realtime_event_public_cursor ON pliego.realtime_event(event_id) WHERE public_scope;

CREATE FUNCTION pliego.fn_offer_hint(p_edition BIGINT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 INSERT INTO pliego.realtime_event(user_id,admin_scope,public_scope,event_name,resource_type,resource_id)
 VALUES(NULL,FALSE,TRUE,'catalog.offers.changed','edition',p_edition::TEXT);
$$;

CREATE TABLE pliego.offer_transition (
 offer_id BIGINT PRIMARY KEY REFERENCES pliego.edicion_oferta(oferta_id) ON DELETE RESTRICT,
 next_transition_at TIMESTAMPTZ,
 last_observed_at TIMESTAMPTZ
);
CREATE INDEX ix_offer_transition_due ON pliego.offer_transition(next_transition_at,offer_id)
 WHERE next_transition_at IS NOT NULL;

CREATE FUNCTION pliego.fn_offer_transition_changed() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE observed_at TIMESTAMPTZ:=clock_timestamp(); next_at TIMESTAMPTZ;
BEGIN
 next_at:=CASE WHEN NEW.estado<>'ACTIVE' THEN NULL
  WHEN NEW.inicio>observed_at THEN NEW.inicio WHEN NEW.fin>observed_at THEN NEW.fin END;
 INSERT INTO pliego.offer_transition(offer_id,next_transition_at,last_observed_at)
 VALUES(NEW.oferta_id,next_at,observed_at)
 ON CONFLICT(offer_id) DO UPDATE SET next_transition_at=EXCLUDED.next_transition_at,
  last_observed_at=EXCLUDED.last_observed_at;
 PERFORM pliego.fn_offer_hint(NEW.edicion_id);
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_offer_transition_changed AFTER INSERT OR UPDATE ON pliego.edicion_oferta
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_offer_transition_changed();

-- Trigger installation holds its table lock through commit; seed afterwards so
-- concurrent admin writes cannot commit in a seed/trigger gap.
-- Catch up existing promotions once, including those already ended during downtime.
INSERT INTO pliego.offer_transition(offer_id,next_transition_at)
 SELECT oferta_id,CASE WHEN estado='ACTIVE' THEN inicio END FROM pliego.edicion_oferta;

CREATE TABLE pliego.offer_lifecycle_run (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 last_attempt_at TIMESTAMPTZ, last_success_at TIMESTAMPTZ, last_failure_at TIMESTAMPTZ,
 last_failure_code TEXT, success_count BIGINT NOT NULL DEFAULT 0,
 failure_count BIGINT NOT NULL DEFAULT 0, transition_count BIGINT NOT NULL DEFAULT 0,
 last_transition_count INTEGER NOT NULL DEFAULT 0,
 last_max_lag_seconds NUMERIC NOT NULL DEFAULT 0
);
INSERT INTO pliego.offer_lifecycle_run DEFAULT VALUES;

CREATE FUNCTION pliego.fn_offer_lifecycle_advance(p_limit INTEGER DEFAULT 1000) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE observed_at TIMESTAMPTZ; item RECORD; changed INTEGER:=0; max_lag NUMERIC:=0;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('offer-lifecycle',0)) THEN
  RETURN jsonb_build_object('state','SKIPPED','transitionCount',0,'maxLagSeconds',0); END IF;
 observed_at:=clock_timestamp();
 FOR item IN
  SELECT t.offer_id,t.next_transition_at,o.edicion_id,o.estado,o.inicio,o.fin
  FROM pliego.offer_transition t JOIN pliego.edicion_oferta o ON o.oferta_id=t.offer_id
  WHERE t.next_transition_at<=observed_at
  ORDER BY t.next_transition_at,t.offer_id LIMIT p_limit FOR UPDATE OF t SKIP LOCKED
 LOOP
  -- Do not lock edition/offer here: admin writers lock edition -> offer -> queue.
  PERFORM pliego.fn_offer_hint(item.edicion_id);
  UPDATE pliego.offer_transition SET next_transition_at=CASE
   WHEN item.estado<>'ACTIVE' THEN NULL WHEN item.inicio>observed_at THEN item.inicio
   WHEN item.fin>observed_at THEN item.fin END,last_observed_at=observed_at
   WHERE offer_id=item.offer_id;
  changed:=changed+1;
  max_lag:=greatest(max_lag,extract(epoch FROM observed_at-item.next_transition_at));
 END LOOP;
 UPDATE pliego.offer_lifecycle_run SET last_attempt_at=observed_at,last_success_at=clock_timestamp(),
  success_count=success_count+1,transition_count=transition_count+changed,
  last_transition_count=changed,last_max_lag_seconds=max_lag WHERE singleton;
 RETURN jsonb_build_object('state','OK','transitionCount',changed,'maxLagSeconds',max_lag);
END; $$;

CREATE FUNCTION pliego.fn_offer_lifecycle_failure(p_code TEXT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 UPDATE pliego.offer_lifecycle_run SET last_attempt_at=clock_timestamp(),last_failure_at=clock_timestamp(),
 last_failure_code='DATABASE_ERROR',failure_count=failure_count+1 WHERE singleton;
$$;

CREATE FUNCTION pliego.fn_offer_lifecycle_status() RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT jsonb_build_object('serverTime',statement_timestamp(),
  'lastAttemptAt',r.last_attempt_at,'lastSuccessAt',r.last_success_at,
  'lastFailureAt',r.last_failure_at,'lastFailureCode',r.last_failure_code,
  'successCount',r.success_count,'failureCount',r.failure_count,'transitionCount',r.transition_count,
  'lastTransitionCount',r.last_transition_count,'lastMaxLagSeconds',r.last_max_lag_seconds,
  'pendingCount',q.pending_count,'oldestPendingAt',q.oldest_at,
  'lagSeconds',greatest(0,extract(epoch FROM statement_timestamp()-q.oldest_at)),
  'nextTransitionAt',q.next_at)
 FROM pliego.offer_lifecycle_run r CROSS JOIN LATERAL (
  SELECT count(*) FILTER(WHERE next_transition_at<=statement_timestamp()) pending_count,
   min(next_transition_at) FILTER(WHERE next_transition_at<=statement_timestamp()) oldest_at,
   min(next_transition_at) next_at FROM pliego.offer_transition) q WHERE singleton;
$$;

CREATE INDEX ix_edition_offer_active_start ON pliego.edicion_oferta(inicio) WHERE estado='ACTIVE';
CREATE INDEX ix_edition_offer_active_end ON pliego.edicion_oferta(fin) WHERE estado='ACTIVE';
CREATE FUNCTION pliego.fn_offer_refresh_clock() RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT jsonb_build_object('serverTime',statement_timestamp(),'nextTransitionAt',(
  SELECT min(at) FROM (
   SELECT min(inicio) at FROM pliego.edicion_oferta WHERE estado='ACTIVE' AND inicio>statement_timestamp()
   UNION ALL SELECT min(fin) FROM pliego.edicion_oferta WHERE estado='ACTIVE' AND fin>statement_timestamp()
  ) instants),'revalidateAfterSeconds',60);
$$;

REVOKE ALL ON TABLE pliego.offer_transition,pliego.offer_lifecycle_run FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_offer_hint(BIGINT),pliego.fn_offer_transition_changed(),
 pliego.fn_offer_lifecycle_advance(INTEGER),pliego.fn_offer_lifecycle_failure(TEXT),
 pliego.fn_offer_lifecycle_status(),pliego.fn_offer_refresh_clock() FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
 GRANT SELECT,INSERT,UPDATE ON TABLE pliego.offer_transition,pliego.offer_lifecycle_run TO pliego_app;
 GRANT EXECUTE ON FUNCTION pliego.fn_offer_hint(BIGINT),pliego.fn_offer_transition_changed(),
  pliego.fn_offer_lifecycle_advance(INTEGER),pliego.fn_offer_lifecycle_failure(TEXT),
  pliego.fn_offer_lifecycle_status(),pliego.fn_offer_refresh_clock() TO pliego_app;
END IF; END; $$;

-- Existing session, replay, retention and snapshot semantics are unchanged.
CREATE OR REPLACE FUNCTION pliego.fn_realtime_read(p_connection UUID,p_after BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE c RECORD; h RECORD; events JSONB; next_cursor BIGINT;
BEGIN
 SELECT rc.* INTO c FROM pliego.realtime_connection rc
 JOIN pliego.sesion_autenticacion s ON s.sesion_id=rc.session_id
 JOIN pliego.usuario u ON u.usuario_id=rc.user_id
 WHERE rc.connection_id=p_connection AND rc.expires_at>clock_timestamp()
 AND s.fecha_expiracion>clock_timestamp() AND s.fecha_revocacion IS NULL
 AND u.estado='ACTIVE' AND u.rol=rc.role
 AND (u.rol='ADMIN' OR u.email_verificado_en IS NOT NULL);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','CLOSED'); END IF;
 SELECT head,retained_after INTO h FROM pliego.realtime_cursor WHERE singleton;
 IF p_after IS NULL OR p_after<h.retained_after OR p_after>h.head OR p_after<0 THEN
  RETURN jsonb_build_object('state','OPEN','cursor',h.head::TEXT,'resync',TRUE,'events','[]'::JSONB);
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.event_id::TEXT,'name',e.event_name,
  'resourceType',e.resource_type,'resourceId',e.resource_id) ORDER BY e.event_id),'[]'::JSONB),max(e.event_id)
 INTO events,next_cursor FROM (
  SELECT * FROM pliego.realtime_event WHERE event_id>p_after AND event_id<=h.head
   AND (public_scope OR (c.role='ADMIN' AND admin_scope) OR (c.role='CUSTOMER' AND NOT admin_scope AND user_id=c.user_id))
  ORDER BY event_id LIMIT 100
 ) e;
 RETURN jsonb_build_object('state','OPEN','cursor',
  (CASE WHEN jsonb_array_length(events)=100 THEN next_cursor ELSE h.head END)::TEXT,
  'resync',FALSE,'events',events);
END; $$;

