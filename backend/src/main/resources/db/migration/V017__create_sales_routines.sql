-- PLIEGO V017 — Checkout / Orders public Database API

CREATE OR REPLACE PROCEDURE pliego.sp_checkout(
    IN p_actor_user_id BIGINT,
    IN p_address_id BIGINT,
    IN p_payment_method VARCHAR,
    IN p_payment_outcome VARCHAR,
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
    v_customer_id BIGINT;
    v_cart_id BIGINT;
    v_address pliego.direccion%ROWTYPE;
    v_item RECORD;
    v_before INTEGER;
    v_after INTEGER;
    v_payment_id BIGINT;
    v_reference VARCHAR;
    v_constraint TEXT;
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

    SELECT d.*
      INTO v_address
      FROM pliego.direccion d
     WHERE d.direccion_id = p_address_id
       AND d.cliente_id = v_customer_id
     FOR SHARE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P5004', 'CHECKOUT_ADDRESS_INVALID');
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
               e.precio
          FROM pliego.carrito_item ci
          JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
          JOIN pliego.libro l ON l.libro_id = e.libro_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY ci.edicion_id
    LOOP
        IF v_item.edition_state <> 'ACTIVE' THEN
            PERFORM pliego.fn_raise_domain_error('P2042', 'EDITION_INACTIVE');
        END IF;
        IF v_item.book_state <> 'ACTIVE' THEN
            PERFORM pliego.fn_raise_domain_error('P2043', 'BOOK_INACTIVE');
        END IF;
        IF v_item.precio <= 0 THEN
            PERFORM pliego.fn_raise_domain_error('P2048', 'EDITION_DATA_INVALID');
        END IF;
    END LOOP;

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
      INTO o_total
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
     WHERE ci.carrito_id = v_cart_id;

    IF o_total IS NULL OR o_total <= 0 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid order total');
    END IF;

    INSERT INTO pliego.pedido(cliente_id, estado, subtotal, total)
    VALUES (v_customer_id, 'PENDING_PAYMENT', o_total, o_total)
    RETURNING pedido_id INTO o_order_id;

    INSERT INTO pliego.pedido_estado_historial(
        pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
    ) VALUES (
        o_order_id, NULL, 'SYSTEM', NULL, 'PENDING_PAYMENT'
    );

    INSERT INTO pliego.pedido_item(
        pedido_id, edicion_id, sku_snapshot, isbn_snapshot, titulo_snapshot,
        autores_snapshot, editorial_snapshot, formato_snapshot, idioma_snapshot,
        precio_unitario, cantidad, subtotal
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
           (e.precio * ci.cantidad)::NUMERIC(30,2)
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
      JOIN pliego.libro l ON l.libro_id = e.libro_id
      JOIN pliego.editorial pub ON pub.editorial_id = e.editorial_id
     WHERE ci.carrito_id = v_cart_id
     ORDER BY e.edicion_id;

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
             WHERE ci.carrito_id = v_cart_id
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

CREATE OR REPLACE FUNCTION pliego.fn_customer_orders(
    p_actor_user_id BIGINT,
    p_page INTEGER,
    p_page_size INTEGER
)
RETURNS TABLE (
    order_id BIGINT,
    created_at TIMESTAMPTZ,
    order_state VARCHAR,
    total NUMERIC(30,2),
    payment_state VARCHAR,
    total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
    v_customer_id BIGINT;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);

    RETURN QUERY
    SELECT p.pedido_id,
           p.fecha_creacion,
           p.estado,
           p.total,
           pa.estado,
           count(*) OVER()::BIGINT
      FROM pliego.pedido p
      JOIN pliego.pago pa ON pa.pedido_id = p.pedido_id
     WHERE p.cliente_id = v_customer_id
     ORDER BY p.fecha_creacion DESC, p.pedido_id DESC
     LIMIT p_page_size
    OFFSET p_page * p_page_size;
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_customer_order_detail(
    p_actor_user_id BIGINT,
    p_order_id BIGINT
)
RETURNS TABLE (
    order_id BIGINT,
    order_state VARCHAR,
    subtotal NUMERIC(30,2),
    total NUMERIC(30,2),
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    items JSONB,
    address JSONB,
    payment JSONB,
    state_history JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
    v_customer_id BIGINT;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    IF NOT EXISTS (
        SELECT 1
          FROM pliego.pedido p
         WHERE p.pedido_id = p_order_id
           AND p.cliente_id = v_customer_id
    ) THEN
        PERFORM pliego.fn_raise_domain_error('P5001', 'ORDER_NOT_FOUND');
    END IF;

    RETURN QUERY
    SELECT p.pedido_id,
           p.estado,
           p.subtotal,
           p.total,
           p.fecha_creacion,
           p.fecha_actualizacion,
           COALESCE((
               SELECT jsonb_agg(
                   jsonb_build_object(
                       'orderItemId', pi.pedido_item_id,
                       'editionId', pi.edicion_id,
                       'sku', pi.sku_snapshot,
                       'isbn', pi.isbn_snapshot,
                       'title', pi.titulo_snapshot,
                       'authors', pi.autores_snapshot,
                       'publisher', pi.editorial_snapshot,
                       'format', pi.formato_snapshot,
                       'language', pi.idioma_snapshot,
                       'unitPrice', pi.precio_unitario,
                       'quantity', pi.cantidad,
                       'subtotal', pi.subtotal
                   ) ORDER BY pi.pedido_item_id
               )
               FROM pliego.pedido_item pi
               WHERE pi.pedido_id = p.pedido_id
           ), '[]'::JSONB),
           (SELECT to_jsonb(pd) - 'pedido_id'
              FROM pliego.pedido_direccion pd
             WHERE pd.pedido_id = p.pedido_id),
           (SELECT jsonb_build_object(
                       'paymentId', pa.pago_id,
                       'method', pa.metodo,
                       'state', pa.estado,
                       'amount', pa.monto,
                       'reference', pa.referencia,
                       'resultDetail', pa.detalle_resultado,
                       'createdAt', pa.fecha_creacion,
                       'updatedAt', pa.fecha_actualizacion
                   )
              FROM pliego.pago pa
             WHERE pa.pedido_id = p.pedido_id),
           COALESCE((
               SELECT jsonb_agg(
                   jsonb_build_object(
                       'historyId', h.pedido_estado_historial_id,
                       'actorUserId', h.usuario_actor_id,
                       'origin', h.origen,
                       'previousState', h.estado_anterior,
                       'newState', h.estado_nuevo,
                       'at', h.fecha
                   ) ORDER BY h.fecha, h.pedido_estado_historial_id
               )
               FROM pliego.pedido_estado_historial h
               WHERE h.pedido_id = p.pedido_id
           ), '[]'::JSONB)
      FROM pliego.pedido p
     WHERE p.pedido_id = p_order_id
       AND p.cliente_id = v_customer_id;
END;
$$;

CREATE OR REPLACE PROCEDURE pliego.sp_order_cancel(
    IN p_actor_user_id BIGINT,
    IN p_order_id BIGINT,
    OUT o_order_id BIGINT,
    OUT o_previous_state VARCHAR,
    OUT o_order_state VARCHAR,
    OUT o_payment_state VARCHAR,
    OUT o_restored_units BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_actor RECORD;
    v_order_customer BIGINT;
    v_payment_state VARCHAR;
    v_item RECORD;
    v_before INTEGER;
    v_after INTEGER;
    v_constraint TEXT;
BEGIN
    SELECT * INTO v_actor
      FROM pliego.fn_assert_actor(p_actor_user_id, NULL);

    -- RC-07: existence/ownership must be checked before exposing state/payment details.
    SELECT p.cliente_id, p.estado
      INTO v_order_customer, o_previous_state
      FROM pliego.pedido p
     WHERE p.pedido_id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P5001', 'ORDER_NOT_FOUND');
    END IF;

    IF v_actor.rol = 'CUSTOMER' AND v_order_customer <> v_actor.cliente_id THEN
        PERFORM pliego.fn_raise_domain_error('P5001', 'ORDER_NOT_FOUND');
    ELSIF v_actor.rol NOT IN ('CUSTOMER', 'ADMIN') THEN
        PERFORM pliego.fn_raise_domain_error('P5001', 'ORDER_NOT_FOUND');
    END IF;

    IF o_previous_state NOT IN ('CONFIRMED', 'PREPARING') THEN
        PERFORM pliego.fn_raise_domain_error('P5003', 'ORDER_NOT_CANCELLABLE');
    END IF;

    SELECT pa.estado
      INTO v_payment_state
      FROM pliego.pago pa
     WHERE pa.pedido_id = p_order_id;

    IF NOT FOUND OR v_payment_state <> 'APPROVED' THEN
        PERFORM pliego.fn_raise_domain_error('P5006', 'PAYMENT_STATE_INVALID');
    END IF;

    FOR v_item IN
        SELECT pi.edicion_id, pi.cantidad, i.stock_actual
          FROM pliego.pedido_item pi
          JOIN pliego.inventario i ON i.edicion_id = pi.edicion_id
         WHERE pi.pedido_id = p_order_id
         ORDER BY pi.edicion_id
         FOR UPDATE OF i
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pliego.movimiento_inventario m
             WHERE m.pedido_id = p_order_id
               AND m.edicion_id = v_item.edicion_id
               AND m.tipo = 'SALE'
        ) THEN
            PERFORM pliego.fn_raise_domain_error('P3006', 'SALE_REQUIRED_FOR_CANCELLATION');
        END IF;

        IF EXISTS (
            SELECT 1
              FROM pliego.movimiento_inventario m
             WHERE m.pedido_id = p_order_id
               AND m.edicion_id = v_item.edicion_id
               AND m.tipo = 'CANCELLATION'
        ) THEN
            PERFORM pliego.fn_raise_domain_error('P3005', 'STOCK_MOVEMENT_DUPLICATE');
        END IF;

        v_before := v_item.stock_actual;
        v_after := v_before + v_item.cantidad;

        UPDATE pliego.inventario
           SET stock_actual = v_after
         WHERE edicion_id = v_item.edicion_id;

        BEGIN
            INSERT INTO pliego.movimiento_inventario(
                edicion_id, pedido_id, usuario_actor_id, tipo, cantidad,
                stock_anterior, stock_posterior, motivo
            ) VALUES (
                v_item.edicion_id, p_order_id, NULL, 'CANCELLATION', v_item.cantidad,
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

    UPDATE pliego.pago
       SET estado = 'REFUNDED'
     WHERE pedido_id = p_order_id
       AND estado = 'APPROVED';

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P5006', 'PAYMENT_STATE_INVALID');
    END IF;

    UPDATE pliego.pedido
       SET estado = 'CANCELLED'
     WHERE pedido_id = p_order_id;

    INSERT INTO pliego.pedido_estado_historial(
        pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
    ) VALUES (
        p_order_id, p_actor_user_id, 'USER', o_previous_state, 'CANCELLED'
    );

    SELECT COALESCE(sum(pi.cantidad), 0)::BIGINT
      INTO o_restored_units
      FROM pliego.pedido_item pi
     WHERE pi.pedido_id = p_order_id;

    o_order_id := p_order_id;
    o_order_state := 'CANCELLED';
    o_payment_state := 'REFUNDED';
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_admin_orders(
    p_actor_user_id BIGINT,
    p_state VARCHAR,
    p_date_from TIMESTAMPTZ,
    p_date_to TIMESTAMPTZ,
    p_customer_id BIGINT,
    p_page INTEGER,
    p_page_size INTEGER
)
RETURNS TABLE (
    order_id BIGINT,
    customer_id BIGINT,
    customer_name VARCHAR,
    created_at TIMESTAMPTZ,
    order_state VARCHAR,
    total NUMERIC(30,2),
    payment_state VARCHAR,
    total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
    PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id, 'ADMIN');
    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);

    IF (p_state IS NOT NULL AND p_state NOT IN (
            'PENDING_PAYMENT','CONFIRMED','PREPARING','SHIPPED','DELIVERED','CANCELLED'
        ))
       OR (p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to) THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT');
    END IF;

    RETURN QUERY
    SELECT p.pedido_id,
           c.cliente_id,
           (c.nombres || ' ' || c.apellidos)::VARCHAR,
           p.fecha_creacion,
           p.estado,
           p.total,
           pa.estado,
           count(*) OVER()::BIGINT
      FROM pliego.pedido p
      JOIN pliego.cliente c ON c.cliente_id = p.cliente_id
      JOIN pliego.pago pa ON pa.pedido_id = p.pedido_id
     WHERE (p_state IS NULL OR p.estado = p_state)
       AND (p_date_from IS NULL OR p.fecha_creacion >= p_date_from)
       AND (p_date_to IS NULL OR p.fecha_creacion <= p_date_to)
       AND (p_customer_id IS NULL OR p.cliente_id = p_customer_id)
     ORDER BY p.fecha_creacion DESC, p.pedido_id DESC
     LIMIT p_page_size
    OFFSET p_page * p_page_size;
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_admin_order_detail(
    p_actor_user_id BIGINT,
    p_order_id BIGINT
)
RETURNS TABLE (
    order_id BIGINT,
    customer_id BIGINT,
    customer_email VARCHAR,
    customer_name VARCHAR,
    order_state VARCHAR,
    subtotal NUMERIC(30,2),
    total NUMERIC(30,2),
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    items JSONB,
    address JSONB,
    payment JSONB,
    state_history JSONB,
    inventory_movements JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
    PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id, 'ADMIN');

    IF NOT EXISTS (SELECT 1 FROM pliego.pedido p WHERE p.pedido_id = p_order_id) THEN
        PERFORM pliego.fn_raise_domain_error('P5001', 'ORDER_NOT_FOUND');
    END IF;

    RETURN QUERY
    SELECT p.pedido_id,
           c.cliente_id,
           u.email_normalizado,
           (c.nombres || ' ' || c.apellidos)::VARCHAR,
           p.estado,
           p.subtotal,
           p.total,
           p.fecha_creacion,
           p.fecha_actualizacion,
           COALESCE((
               SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.pedido_item_id)
                 FROM pliego.pedido_item pi
                WHERE pi.pedido_id = p.pedido_id
           ), '[]'::JSONB),
           (SELECT to_jsonb(pd) - 'pedido_id'
              FROM pliego.pedido_direccion pd
             WHERE pd.pedido_id = p.pedido_id),
           (SELECT to_jsonb(pa) - 'pedido_id'
              FROM pliego.pago pa
             WHERE pa.pedido_id = p.pedido_id),
           COALESCE((
               SELECT jsonb_agg(to_jsonb(h) ORDER BY h.fecha, h.pedido_estado_historial_id)
                 FROM pliego.pedido_estado_historial h
                WHERE h.pedido_id = p.pedido_id
           ), '[]'::JSONB),
           COALESCE((
               SELECT jsonb_agg(to_jsonb(m) ORDER BY m.fecha, m.movimiento_inventario_id)
                 FROM pliego.movimiento_inventario m
                WHERE m.pedido_id = p.pedido_id
           ), '[]'::JSONB)
      FROM pliego.pedido p
      JOIN pliego.cliente c ON c.cliente_id = p.cliente_id
      JOIN pliego.usuario u ON u.usuario_id = c.usuario_id
     WHERE p.pedido_id = p_order_id;
END;
$$;

CREATE OR REPLACE PROCEDURE pliego.sp_order_change_status(
    IN p_actor_user_id BIGINT,
    IN p_order_id BIGINT,
    IN p_new_state VARCHAR,
    OUT o_order_id BIGINT,
    OUT o_previous_state VARCHAR,
    OUT o_order_state VARCHAR
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
    PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id, 'ADMIN');

    IF p_new_state NOT IN ('PREPARING', 'SHIPPED', 'DELIVERED') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT');
    END IF;

    SELECT p.estado
      INTO o_previous_state
      FROM pliego.pedido p
     WHERE p.pedido_id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P5001', 'ORDER_NOT_FOUND');
    END IF;

    IF NOT (
        (o_previous_state = 'CONFIRMED' AND p_new_state = 'PREPARING')
        OR (o_previous_state = 'PREPARING' AND p_new_state = 'SHIPPED')
        OR (o_previous_state = 'SHIPPED' AND p_new_state = 'DELIVERED')
    ) THEN
        PERFORM pliego.fn_raise_domain_error('P5002', 'ORDER_INVALID_TRANSITION');
    END IF;

    UPDATE pliego.pedido
       SET estado = p_new_state
     WHERE pedido_id = p_order_id;

    INSERT INTO pliego.pedido_estado_historial(
        pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
    ) VALUES (
        p_order_id, p_actor_user_id, 'USER', o_previous_state, p_new_state
    );

    o_order_id := p_order_id;
    o_order_state := p_new_state;
END;
$$;
