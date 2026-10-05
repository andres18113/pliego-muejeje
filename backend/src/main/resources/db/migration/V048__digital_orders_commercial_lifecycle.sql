-- Digital-only orders have no physical lifecycle; commercial cancellation stays unchanged.
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
    IF NOT EXISTS(SELECT 1 FROM pliego.pedido_item WHERE pedido_id=p_order_id AND pliego.fn_is_physical_format(formato_snapshot)) THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    IF EXISTS (SELECT 1 FROM pliego.pedido_entrega WHERE pedido_id=p_order_id AND metodo='STORE_PICKUP') THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    IF EXISTS (SELECT 1 FROM pliego.envio WHERE pedido_id=p_order_id) THEN
        CALL pliego.sp_shipment_transition(p_actor_user_id,p_order_id,p_new_state);
    ELSE
        -- Preserve any historical physical order without a shipment record.
        IF NOT ((o_previous_state='CONFIRMED' AND p_new_state='PREPARING') OR
            (o_previous_state='PREPARING' AND p_new_state='SHIPPED') OR
            (o_previous_state='SHIPPED' AND p_new_state='DELIVERED')) THEN
            PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
        END IF;
        UPDATE pliego.pedido SET estado=p_new_state WHERE pedido_id=p_order_id;
        INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo)
        VALUES(p_order_id,p_actor_user_id,'USER',o_previous_state,p_new_state);
    END IF;
    o_order_id:=p_order_id; SELECT estado INTO o_order_state FROM pliego.pedido WHERE pedido_id=p_order_id;
END; $$;
