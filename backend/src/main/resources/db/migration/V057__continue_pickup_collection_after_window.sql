-- Preserve collection when pickup enters PREPARING at the cancellation deadline.
CREATE OR REPLACE PROCEDURE pliego.sp_pickup_collect(IN p_actor BIGINT,IN p_order BIGINT,IN p_code VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE order_state VARCHAR; pickup pliego.pedido_retiro%ROWTYPE;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 CALL pliego.sp_purchase_lifecycle_reconcile(p_order);
 SELECT estado INTO order_state FROM pliego.pedido WHERE pedido_id=p_order FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 SELECT * INTO pickup FROM pliego.pedido_retiro WHERE pedido_id=p_order FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 IF p_code IS NULL OR p_code<>pickup.codigo THEN PERFORM pliego.fn_raise_domain_error('P5013','PICKUP_CODE_INVALID'); END IF;
 IF pickup.fecha_retiro IS NOT NULL AND order_state='DELIVERED' THEN RETURN; END IF;
 IF order_state NOT IN('CONFIRMED','PREPARING') OR NOT EXISTS(
  SELECT FROM pliego.pago WHERE pedido_id=p_order AND estado='APPROVED') THEN
  PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
 END IF;
 UPDATE pliego.pedido_retiro SET fecha_retiro=clock_timestamp() WHERE pedido_id=p_order;
 UPDATE pliego.pedido SET estado='DELIVERED' WHERE pedido_id=p_order;
 INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo)
  VALUES(p_order,p_actor,'USER',order_state,'DELIVERED');
END; $$;
