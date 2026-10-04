-- ADR-0017. Physical logistics is independent of commercial and payment state.
CREATE TABLE pliego.pedido_entrega (
    pedido_id BIGINT PRIMARY KEY REFERENCES pliego.pedido(pedido_id),
    metodo VARCHAR(16) NOT NULL CHECK (metodo IN ('HOME_DELIVERY','STORE_PICKUP'))
);
CREATE TABLE pliego.envio (
    envio_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id BIGINT NOT NULL UNIQUE REFERENCES pliego.pedido_entrega(pedido_id),
    estado VARCHAR(32) NOT NULL CHECK (estado IN ('PENDING','PREPARING','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
    transportista VARCHAR(120),
    seguimiento_codigo VARCHAR(120),
    seguimiento_url VARCHAR(1000),
    entrega_estimada_desde TIMESTAMPTZ,
    entrega_estimada_hasta TIMESTAMPTZ,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_preparacion TIMESTAMPTZ,
    fecha_envio TIMESTAMPTZ,
    fecha_en_reparto TIMESTAMPTZ,
    fecha_entrega TIMESTAMPTZ,
    fecha_cancelacion TIMESTAMPTZ,
    CHECK (seguimiento_url IS NULL OR seguimiento_url ~ '^https://[^[:space:]]+$'),
    CHECK (seguimiento_codigo IS NULL OR transportista IS NOT NULL),
    CHECK (seguimiento_url IS NULL OR seguimiento_codigo IS NOT NULL),
    CHECK ((entrega_estimada_desde IS NULL AND entrega_estimada_hasta IS NULL)
        OR (entrega_estimada_desde IS NOT NULL AND entrega_estimada_hasta IS NOT NULL
            AND entrega_estimada_desde <= entrega_estimada_hasta))
);
CREATE TABLE pliego.envio_historial (
    envio_historial_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    envio_id BIGINT NOT NULL REFERENCES pliego.envio(envio_id),
    tipo VARCHAR(16) NOT NULL CHECK (tipo IN ('STATUS','TRACKING')),
    origen VARCHAR(16) NOT NULL CHECK (origen IN ('USER','SYSTEM','MIGRATION')),
    usuario_actor_id BIGINT REFERENCES pliego.usuario(usuario_id),
    estado_anterior VARCHAR(32),
    estado_nuevo VARCHAR(32) NOT NULL,
    transportista VARCHAR(120),
    seguimiento_codigo VARCHAR(120),
    seguimiento_url VARCHAR(1000),
    fecha TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (estado_anterior IS NULL OR estado_anterior IN ('PENDING','PREPARING','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
    CHECK (estado_nuevo IN ('PENDING','PREPARING','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
    CHECK ((origen='USER' AND usuario_actor_id IS NOT NULL) OR (origen IN ('SYSTEM','MIGRATION') AND usuario_actor_id IS NULL))
);
CREATE INDEX ix_envio_historial_envio ON pliego.envio_historial(envio_id,fecha,envio_historial_id);
CREATE TRIGGER trg_envio_historial_immutable BEFORE UPDATE OR DELETE ON pliego.envio_historial
FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

-- Do not infer physical delivery from today's catalog: purchased formats are authoritative.
INSERT INTO pliego.pedido_entrega(pedido_id,metodo)
SELECT p.pedido_id,'HOME_DELIVERY' FROM pliego.pedido p
WHERE EXISTS (SELECT 1 FROM pliego.pedido_item i WHERE i.pedido_id=p.pedido_id
    AND pliego.fn_is_physical_format(i.formato_snapshot));
INSERT INTO pliego.envio(pedido_id,estado,fecha_creacion,fecha_preparacion,fecha_envio,fecha_entrega,fecha_cancelacion)
SELECT p.pedido_id,CASE WHEN p.estado IN ('PENDING_PAYMENT','CONFIRMED') THEN 'PENDING' ELSE p.estado END,
    p.fecha_creacion,
    (SELECT min(h.fecha) FROM pliego.pedido_estado_historial h WHERE h.pedido_id=p.pedido_id AND h.estado_nuevo='PREPARING'),
    (SELECT min(h.fecha) FROM pliego.pedido_estado_historial h WHERE h.pedido_id=p.pedido_id AND h.estado_nuevo='SHIPPED'),
    (SELECT min(h.fecha) FROM pliego.pedido_estado_historial h WHERE h.pedido_id=p.pedido_id AND h.estado_nuevo='DELIVERED'),
    (SELECT min(h.fecha) FROM pliego.pedido_estado_historial h WHERE h.pedido_id=p.pedido_id AND h.estado_nuevo='CANCELLED')
FROM pliego.pedido p JOIN pliego.pedido_entrega f USING(pedido_id);
INSERT INTO pliego.envio_historial(envio_id,tipo,origen,estado_anterior,estado_nuevo,fecha)
SELECT e.envio_id,'STATUS','MIGRATION',
    CASE WHEN h.estado_anterior IN ('PENDING_PAYMENT','CONFIRMED') THEN 'PENDING' ELSE h.estado_anterior END,
    CASE WHEN h.estado_nuevo IN ('PENDING_PAYMENT','CONFIRMED') THEN 'PENDING' ELSE h.estado_nuevo END,h.fecha
FROM pliego.envio e JOIN pliego.pedido_estado_historial h USING(pedido_id)
ORDER BY h.fecha,h.pedido_estado_historial_id;

CREATE FUNCTION pliego.fn_order_purchase_state(p_state VARCHAR) RETURNS VARCHAR
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$
SELECT CASE WHEN p_state IN ('PREPARING','SHIPPED','DELIVERED') THEN 'CONFIRMED' ELSE p_state END::VARCHAR;
$$;

-- Internal delegates retain checkout's catalog/address locks and V032 physical-stock rules.
ALTER PROCEDURE pliego.sp_checkout(BIGINT,BIGINT,VARCHAR,VARCHAR) RENAME TO sp_checkout_internal_v032;
CREATE PROCEDURE pliego.sp_checkout(
    IN p_actor_user_id BIGINT, IN p_address_id BIGINT, IN p_payment_method VARCHAR, IN p_payment_outcome VARCHAR,
    OUT o_order_id BIGINT, OUT o_order_state VARCHAR, OUT o_payment_state VARCHAR,
    OUT o_total NUMERIC, OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_shipment BIGINT;
BEGIN
    CALL pliego.sp_checkout_internal_v032(p_actor_user_id,p_address_id,p_payment_method,p_payment_outcome,
        o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
    IF EXISTS (SELECT 1 FROM pliego.pedido_item i WHERE i.pedido_id=o_order_id
        AND pliego.fn_is_physical_format(i.formato_snapshot)) THEN
        INSERT INTO pliego.pedido_entrega VALUES(o_order_id,'HOME_DELIVERY');
        INSERT INTO pliego.envio(pedido_id,estado,fecha_cancelacion)
        VALUES(o_order_id,CASE WHEN o_order_state='CANCELLED' THEN 'CANCELLED' ELSE 'PENDING' END,
            CASE WHEN o_order_state='CANCELLED' THEN CURRENT_TIMESTAMP END) RETURNING envio_id INTO v_shipment;
        INSERT INTO pliego.envio_historial(envio_id,tipo,origen,estado_nuevo)
        VALUES(v_shipment,'STATUS','SYSTEM',CASE WHEN o_order_state='CANCELLED' THEN 'CANCELLED' ELSE 'PENDING' END);
    END IF;
END; $$;

ALTER PROCEDURE pliego.sp_order_cancel(BIGINT,BIGINT) RENAME TO sp_order_cancel_internal_v032;
CREATE PROCEDURE pliego.sp_order_cancel(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
    OUT o_order_id BIGINT,OUT o_previous_state VARCHAR,OUT o_order_state VARCHAR,
    OUT o_payment_state VARCHAR,OUT o_restored_units BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_shipment pliego.envio%ROWTYPE;
BEGIN
    -- Delegate locks and authenticates the order before exposing/mutating dependent entities.
    CALL pliego.sp_order_cancel_internal_v032(p_actor_user_id,p_order_id,
        o_order_id,o_previous_state,o_order_state,o_payment_state,o_restored_units);
    SELECT * INTO v_shipment FROM pliego.envio WHERE pedido_id=p_order_id FOR UPDATE;
    IF FOUND THEN
        IF v_shipment.estado NOT IN ('PENDING','PREPARING') THEN
            PERFORM pliego.fn_raise_domain_error('P5003','ORDER_NOT_CANCELLABLE');
        END IF;
        UPDATE pliego.envio SET estado='CANCELLED',fecha_cancelacion=CURRENT_TIMESTAMP WHERE pedido_id=p_order_id;
        INSERT INTO pliego.envio_historial(envio_id,tipo,origen,usuario_actor_id,estado_anterior,estado_nuevo)
        VALUES(v_shipment.envio_id,'STATUS','USER',p_actor_user_id,v_shipment.estado,'CANCELLED');
    END IF;
    -- Invoice issuance records and credit notes are independent, never updated by cancellation.
END; $$;

CREATE PROCEDURE pliego.sp_shipment_transition(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,IN p_target_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_order_state VARCHAR; v_overall VARCHAR; v_shipment pliego.envio%ROWTYPE;
BEGIN
    PERFORM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
    SELECT estado INTO v_order_state FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
    SELECT * INTO v_shipment FROM pliego.envio WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order_state='CANCELLED' OR p_target_state IS NULL OR NOT (
        (v_shipment.estado='PENDING' AND p_target_state='PREPARING') OR
        (v_shipment.estado='PREPARING' AND p_target_state='SHIPPED') OR
        (v_shipment.estado='SHIPPED' AND p_target_state IN ('OUT_FOR_DELIVERY','DELIVERED')) OR
        (v_shipment.estado='OUT_FOR_DELIVERY' AND p_target_state='DELIVERED')) THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pliego.pago WHERE pedido_id=p_order_id AND estado='APPROVED') THEN
        PERFORM pliego.fn_raise_domain_error('P5006','PAYMENT_STATE_INVALID');
    END IF;
    UPDATE pliego.envio SET estado=p_target_state,
        fecha_preparacion=CASE WHEN p_target_state='PREPARING' THEN CURRENT_TIMESTAMP ELSE fecha_preparacion END,
        fecha_envio=CASE WHEN p_target_state='SHIPPED' THEN CURRENT_TIMESTAMP ELSE fecha_envio END,
        fecha_en_reparto=CASE WHEN p_target_state='OUT_FOR_DELIVERY' THEN CURRENT_TIMESTAMP ELSE fecha_en_reparto END,
        fecha_entrega=CASE WHEN p_target_state='DELIVERED' THEN CURRENT_TIMESTAMP ELSE fecha_entrega END
    WHERE envio_id=v_shipment.envio_id;
    INSERT INTO pliego.envio_historial(envio_id,tipo,origen,usuario_actor_id,estado_anterior,estado_nuevo,
        transportista,seguimiento_codigo,seguimiento_url)
    VALUES(v_shipment.envio_id,'STATUS','USER',p_actor_user_id,v_shipment.estado,p_target_state,
        v_shipment.transportista,v_shipment.seguimiento_codigo,v_shipment.seguimiento_url);
    v_overall := CASE WHEN p_target_state='OUT_FOR_DELIVERY' THEN 'SHIPPED' ELSE p_target_state END;
    IF v_order_state<>v_overall THEN
        UPDATE pliego.pedido SET estado=v_overall WHERE pedido_id=p_order_id;
        INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo)
        VALUES(p_order_id,p_actor_user_id,'USER',v_order_state,v_overall);
    END IF;
END; $$;

-- Preserve the approved legacy transition command/response and direct SHIPPED → DELIVERED path.
CREATE OR REPLACE PROCEDURE pliego.sp_order_change_status(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
    IN p_new_state VARCHAR,OUT o_order_id BIGINT,OUT o_previous_state VARCHAR,OUT o_order_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    PERFORM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
    IF p_new_state IS NULL OR p_new_state NOT IN ('PREPARING','SHIPPED','DELIVERED') THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    SELECT estado INTO o_previous_state FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
    IF EXISTS (SELECT 1 FROM pliego.envio WHERE pedido_id=p_order_id) THEN
        CALL pliego.sp_shipment_transition(p_actor_user_id,p_order_id,p_new_state);
    ELSE
        -- Legacy digital workflow retained; this creates no physical fulfillment or entitlement.
        IF NOT ((o_previous_state='CONFIRMED' AND p_new_state='PREPARING') OR
            (o_previous_state='PREPARING' AND p_new_state='SHIPPED') OR
            (o_previous_state='SHIPPED' AND p_new_state='DELIVERED')) THEN
            PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
        END IF;
        UPDATE pliego.pedido SET estado=p_new_state WHERE pedido_id=p_order_id;
        INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo)
        VALUES(p_order_id,p_actor_user_id,'USER',o_previous_state,p_new_state);
    END IF;
    o_order_id:=p_order_id; o_order_state:=p_new_state;
END; $$;

CREATE PROCEDURE pliego.sp_shipment_update_tracking(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
    IN p_carrier VARCHAR,IN p_tracking_code VARCHAR,IN p_tracking_url VARCHAR,
    IN p_estimated_from TIMESTAMPTZ,IN p_estimated_to TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_shipment pliego.envio%ROWTYPE;
BEGIN
    PERFORM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
    PERFORM 1 FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
    SELECT * INTO v_shipment FROM pliego.envio WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND OR v_shipment.estado IN ('DELIVERED','CANCELLED') THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    p_carrier:=NULLIF(btrim(p_carrier),''); p_tracking_code:=NULLIF(btrim(p_tracking_code),'');
    p_tracking_url:=NULLIF(btrim(p_tracking_url),'');
    IF char_length(p_carrier)>120 OR char_length(p_tracking_code)>120 OR char_length(p_tracking_url)>1000
        OR (p_tracking_code IS NOT NULL AND p_carrier IS NULL)
        OR (p_tracking_url IS NOT NULL AND (p_tracking_code IS NULL OR p_tracking_url !~ '^https://[^[:space:]]+$'))
        OR ((p_estimated_from IS NULL)<>(p_estimated_to IS NULL)) OR p_estimated_from>p_estimated_to THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    UPDATE pliego.envio SET transportista=p_carrier,seguimiento_codigo=p_tracking_code,seguimiento_url=p_tracking_url,
        entrega_estimada_desde=p_estimated_from,entrega_estimada_hasta=p_estimated_to WHERE pedido_id=p_order_id;
    INSERT INTO pliego.envio_historial(envio_id,tipo,origen,usuario_actor_id,estado_anterior,estado_nuevo,
        transportista,seguimiento_codigo,seguimiento_url)
    VALUES(v_shipment.envio_id,'TRACKING','USER',p_actor_user_id,v_shipment.estado,v_shipment.estado,
        p_carrier,p_tracking_code,p_tracking_url);
END; $$;
