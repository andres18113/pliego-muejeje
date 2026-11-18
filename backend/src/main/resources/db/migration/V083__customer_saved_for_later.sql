-- ADR-0045: Saved for Later is independent from customer favorites and active cart.
CREATE TABLE pliego.cliente_guardado_despues (
    guardado_despues_id BIGINT GENERATED ALWAYS AS IDENTITY,
    cliente_id BIGINT NOT NULL,
    edicion_id BIGINT NOT NULL,
    cantidad INTEGER NOT NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_cliente_guardado_despues PRIMARY KEY (guardado_despues_id),
    CONSTRAINT uq_cliente_guardado_despues_edicion UNIQUE (cliente_id, edicion_id),
    CONSTRAINT fk_cliente_guardado_despues_cliente FOREIGN KEY (cliente_id)
        REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT,
    CONSTRAINT fk_cliente_guardado_despues_edicion FOREIGN KEY (edicion_id)
        REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT,
    CONSTRAINT ck_cliente_guardado_despues_cantidad CHECK (cantidad > 0)
);

CREATE INDEX idx_cliente_guardado_despues_reciente
    ON pliego.cliente_guardado_despues(cliente_id, fecha_actualizacion DESC, guardado_despues_id DESC);
-- Keep edition FK enforcement efficient when an edition is restricted/deleted.
CREATE INDEX idx_cliente_guardado_despues_edicion
    ON pliego.cliente_guardado_despues(edicion_id);

CREATE FUNCTION pliego.fn_guard_customer_saved_quantity() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE edition_format VARCHAR;
BEGIN
    SELECT formato INTO edition_format FROM pliego.edicion WHERE edicion_id = NEW.edicion_id;
    IF FOUND AND NOT pliego.fn_is_physical_format(edition_format) AND NEW.cantidad <> 1 THEN
        PERFORM pliego.fn_raise_domain_error('P4004', 'CART_QUANTITY_INVALID');
    END IF;
    IF TG_OP = 'UPDATE' THEN
        NEW.fecha_actualizacion := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cliente_guardado_despues_quantity
    BEFORE INSERT OR UPDATE OF edicion_id, cantidad ON pliego.cliente_guardado_despues
    FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_customer_saved_quantity();

CREATE PROCEDURE pliego.sp_cart_save_for_later(IN p_actor_user_id BIGINT, IN p_cart_item_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    customer BIGINT;
    active_cart BIGINT;
    edition BIGINT;
    saved_quantity INTEGER;
    deleted_count INTEGER;
BEGIN
    SELECT a.cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;
    -- Match add/checkout order: digital customer lock precedes the cart row lock.
    PERFORM pliego.fn_lock_digital_customer(customer);

    SELECT carrito_id INTO active_cart FROM pliego.carrito
     WHERE cliente_id = customer AND estado = 'ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4001', 'CART_NOT_ACTIVE'); END IF;

    SELECT edicion_id, cantidad INTO edition, saved_quantity FROM pliego.carrito_item
     WHERE carrito_id = active_cart AND carrito_item_id = p_cart_item_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4003', 'CART_ITEM_NOT_FOUND'); END IF;

    -- Latest cart quantity wins; keep the existing saved row and creation time.
    INSERT INTO pliego.cliente_guardado_despues(cliente_id, edicion_id, cantidad)
    VALUES (customer, edition, saved_quantity)
    ON CONFLICT (cliente_id, edicion_id) DO UPDATE
       SET cantidad = EXCLUDED.cantidad,
           fecha_actualizacion = CURRENT_TIMESTAMP;

    DELETE FROM pliego.carrito_item
     WHERE carrito_id = active_cart AND carrito_item_id = p_cart_item_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    IF deleted_count <> 1 THEN PERFORM pliego.fn_raise_domain_error('P4003', 'CART_ITEM_NOT_FOUND'); END IF;
END;
$$;

CREATE PROCEDURE pliego.sp_cart_saved_move_to_cart(IN p_actor_user_id BIGINT, IN p_saved_item_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    customer BIGINT;
    active_cart BIGINT;
    edition BIGINT;
    saved_quantity INTEGER;
    added_cart BIGINT;
    added_cart_item BIGINT;
    added_quantity INTEGER;
    deleted_count INTEGER;
BEGIN
    SELECT a.cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;
    -- Serialize moves for the customer and match sp_cart_add_item's lock order.
    PERFORM pliego.fn_lock_digital_customer(customer);

    SELECT edicion_id, cantidad INTO edition, saved_quantity
      FROM pliego.cliente_guardado_despues
     WHERE cliente_id = customer AND guardado_despues_id = p_saved_item_id;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4006', 'SAVED_ITEM_NOT_FOUND'); END IF;

    INSERT INTO pliego.carrito(cliente_id, estado)
    VALUES (customer, 'ACTIVE')
    ON CONFLICT (cliente_id) WHERE estado = 'ACTIVE' DO NOTHING;
    SELECT carrito_id INTO active_cart FROM pliego.carrito
     WHERE cliente_id = customer AND estado = 'ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4001', 'CART_NOT_ACTIVE'); END IF;

    -- The cart lock is always acquired before this row lock, matching save-for-later.
    SELECT edicion_id, cantidad INTO edition, saved_quantity
      FROM pliego.cliente_guardado_despues
     WHERE cliente_id = customer AND guardado_despues_id = p_saved_item_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4006', 'SAVED_ITEM_NOT_FOUND'); END IF;

    -- Reuse all cart validation and digital one-copy behavior. Any error rolls back
    -- both the cart mutation and the saved row; DELETE runs only after success.
    CALL pliego.sp_cart_add_item(p_actor_user_id, edition, saved_quantity,
                                 added_cart, added_cart_item, added_quantity);
    DELETE FROM pliego.cliente_guardado_despues
     WHERE cliente_id = customer AND guardado_despues_id = p_saved_item_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    IF deleted_count <> 1 THEN PERFORM pliego.fn_raise_domain_error('P4006', 'SAVED_ITEM_NOT_FOUND'); END IF;
END;
$$;

CREATE PROCEDURE pliego.sp_cart_saved_remove(IN p_actor_user_id BIGINT, IN p_saved_item_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    customer BIGINT;
    deleted_count INTEGER;
BEGIN
    SELECT a.cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;
    PERFORM pliego.fn_lock_digital_customer(customer);
    DELETE FROM pliego.cliente_guardado_despues
     WHERE cliente_id = customer AND guardado_despues_id = p_saved_item_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    IF deleted_count <> 1 THEN PERFORM pliego.fn_raise_domain_error('P4006', 'SAVED_ITEM_NOT_FOUND'); END IF;
END;
$$;

CREATE FUNCTION pliego.fn_customer_saved_for_later(p_actor_user_id BIGINT)
RETURNS TABLE(items JSONB, total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    customer BIGINT;
BEGIN
    SELECT a.cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;
    RETURN QUERY
    WITH projected AS (
        SELECT s.guardado_despues_id,
               s.fecha_actualizacion,
               jsonb_build_object(
                   'savedItemId', s.guardado_despues_id,
                   'editionId', e.edicion_id,
                   'title', l.titulo,
                   'authors', pliego.fn_build_authors_snapshot(l.libro_id),
                   'sku', e.sku,
                   'coverUrl', e.portada_url,
                   'format', e.formato,
                   'quantity', s.cantidad,
                   'currentPrice', offer.price,
                   'currentSubtotal', (s.cantidad * offer.price)::NUMERIC(30,2),
                   'originalPrice', offer.original_price,
                   'unitSavings', offer.discount_amount,
                   'originalSubtotal', (s.cantidad * offer.original_price)::NUMERIC(30,2),
                   'lineSavings', (s.cantidad * offer.discount_amount)::NUMERIC(30,2),
                   'available', (
                       pliego.fn_edition_available(e.formato, l.estado, e.estado, inventory.stock_actual, s.cantidad)
                       AND (pliego.fn_is_physical_format(e.formato)
                            OR pliego.fn_digital_purchase_reason(customer, e.edicion_id) IS NULL)
                   ),
                   'unavailabilityReason', CASE
                       WHEN e.formato IN ('EBOOK','AUDIOBOOK')
                            AND pliego.fn_digital_purchase_reason(customer, e.edicion_id) IS NOT NULL
                           THEN pliego.fn_digital_purchase_reason(customer, e.edicion_id)
                       WHEN l.estado <> 'ACTIVE' THEN 'P2043'
                       WHEN e.estado <> 'ACTIVE' THEN 'P2042'
                       WHEN NOT pliego.fn_is_physical_format(e.formato) AND s.cantidad <> 1 THEN 'P4004'
                       WHEN pliego.fn_is_physical_format(e.formato)
                            AND COALESCE(inventory.stock_actual, 0) < s.cantidad THEN 'P3002'
                       ELSE NULL
                   END,
                   'savedAt', s.fecha_creacion,
                   'updatedAt', s.fecha_actualizacion
               ) AS item
          FROM pliego.cliente_guardado_despues s
          JOIN pliego.edicion e ON e.edicion_id = s.edicion_id
          JOIN pliego.libro l ON l.libro_id = e.libro_id
          LEFT JOIN pliego.inventario inventory ON inventory.edicion_id = e.edicion_id
          CROSS JOIN LATERAL pliego.fn_edition_offer(e.edicion_id) offer
         WHERE s.cliente_id = customer
    )
    SELECT pliego.fn_purchase_item_capabilities(
               COALESCE(jsonb_agg(projected.item ORDER BY projected.fecha_actualizacion DESC,
                                  projected.guardado_despues_id DESC), '[]'::JSONB)),
           count(*)::BIGINT
      FROM projected;
END;
$$;

COMMENT ON TABLE pliego.cliente_guardado_despues IS
    'Customer-owned Saved for Later items; separate from customer favorites and excluded from cart checkout.';
COMMENT ON PROCEDURE pliego.sp_cart_save_for_later(BIGINT, BIGINT) IS
    'Atomically removes an active cart line and upserts its quantity into Saved for Later; latest cart quantity wins.';
COMMENT ON PROCEDURE pliego.sp_cart_saved_move_to_cart(BIGINT, BIGINT) IS
    'Atomically restores a saved quantity through sp_cart_add_item; saved state is deleted only after cart validation succeeds.';
COMMENT ON FUNCTION pliego.fn_customer_saved_for_later(BIGINT) IS
    'Customer-only Saved for Later projection using the live cart commercial fields, offers, availability, and fulfillment capabilities.';

-- The app needs row-level DML and sequence USAGE for identity inserts; no bulk or DDL privileges.
REVOKE ALL PRIVILEGES ON TABLE pliego.cliente_guardado_despues FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SEQUENCE pliego.cliente_guardado_despues_guardado_despues_id_seq FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pliego_app') THEN
        REVOKE ALL PRIVILEGES ON TABLE pliego.cliente_guardado_despues FROM pliego_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pliego.cliente_guardado_despues TO pliego_app;
        REVOKE ALL PRIVILEGES ON SEQUENCE pliego.cliente_guardado_despues_guardado_despues_id_seq FROM pliego_app;
        GRANT USAGE ON SEQUENCE pliego.cliente_guardado_despues_guardado_despues_id_seq TO pliego_app;
    END IF;
END;
$$;
