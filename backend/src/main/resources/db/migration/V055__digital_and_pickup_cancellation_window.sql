-- ADR-0029: paid digital and store pickup orders have a database-owned six-minute cancellation window.
ALTER TABLE pliego.pedido
    ADD COLUMN cancelacion_hasta TIMESTAMPTZ,
    ADD COLUMN finalizado_en TIMESTAMPTZ,
    ADD CONSTRAINT ck_pedido_cancel_window CHECK (
        (cancelacion_hasta IS NULL AND finalizado_en IS NULL) OR
        (cancelacion_hasta IS NOT NULL AND finalizado_en IS NULL) OR
        (cancelacion_hasta IS NOT NULL AND finalizado_en >= cancelacion_hasta)
    );
CREATE INDEX ix_pedido_cancel_window_due ON pliego.pedido(pedido_id)
    WHERE cancelacion_hasta IS NOT NULL AND finalizado_en IS NULL;

CREATE FUNCTION pliego.fn_order_starts_cancel_window(p_order BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT EXISTS (SELECT FROM pliego.pedido_item i WHERE i.pedido_id=p_order)
    AND (EXISTS (SELECT FROM pliego.pedido_entrega f WHERE f.pedido_id=p_order AND f.metodo='STORE_PICKUP')
      OR NOT EXISTS (SELECT FROM pliego.pedido_item i WHERE i.pedido_id=p_order AND pliego.fn_is_physical_format(i.formato_snapshot)));
$$;

CREATE FUNCTION pliego.fn_set_paid_order_cancel_deadline() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.estado='APPROVED' AND (TG_OP='INSERT' OR OLD.estado IS DISTINCT FROM NEW.estado)
    AND pliego.fn_order_starts_cancel_window(NEW.pedido_id) THEN
  UPDATE pliego.pedido SET cancelacion_hasta=clock_timestamp()+INTERVAL '6 minutes'
   WHERE pedido_id=NEW.pedido_id AND cancelacion_hasta IS NULL AND estado='CONFIRMED';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_paid_order_cancel_deadline AFTER INSERT OR UPDATE OF estado ON pliego.pago
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_paid_order_cancel_deadline();

CREATE PROCEDURE pliego.sp_purchase_lifecycle_reconcile(IN p_order BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE order_row pliego.pedido%ROWTYPE; method VARCHAR; at_time TIMESTAMPTZ;
BEGIN
 SELECT * INTO order_row FROM pliego.pedido WHERE pedido_id=p_order FOR UPDATE;
 IF NOT FOUND OR order_row.cancelacion_hasta IS NULL OR order_row.finalizado_en IS NOT NULL THEN RETURN; END IF;
 at_time:=clock_timestamp();
 IF at_time<order_row.cancelacion_hasta THEN RETURN; END IF;
 IF NOT EXISTS(SELECT FROM pliego.pago WHERE pedido_id=p_order AND estado='APPROVED') THEN RETURN; END IF;
 SELECT metodo INTO method FROM pliego.pedido_entrega WHERE pedido_id=p_order;
 IF method='STORE_PICKUP' AND order_row.estado='CONFIRMED' THEN
  UPDATE pliego.pedido SET estado='PREPARING',finalizado_en=at_time WHERE pedido_id=p_order;
  INSERT INTO pliego.pedido_estado_historial(pedido_id,usuario_actor_id,origen,estado_anterior,estado_nuevo,fecha)
   VALUES(p_order,NULL,'SYSTEM','CONFIRMED','PREPARING',at_time)
   ON CONFLICT DO NOTHING;
 ELSE
  UPDATE pliego.pedido SET finalizado_en=at_time WHERE pedido_id=p_order AND estado='CONFIRMED';
 END IF;
END; $$;

CREATE PROCEDURE pliego.sp_purchase_lifecycle_advance_due(IN p_batch_size INTEGER DEFAULT 100)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE row_order RECORD;
BEGIN
 IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 FOR row_order IN SELECT pedido_id FROM pliego.pedido
  WHERE cancelacion_hasta<=clock_timestamp() AND finalizado_en IS NULL AND estado='CONFIRMED'
  ORDER BY pedido_id LIMIT p_batch_size FOR UPDATE SKIP LOCKED
 LOOP CALL pliego.sp_purchase_lifecycle_reconcile(row_order.pedido_id); END LOOP;
END; $$;

-- Keep the existing scheduled worker; it now advances both database-owned lifecycles.
ALTER PROCEDURE pliego.sp_home_delivery_advance_due(INTEGER) RENAME TO sp_home_delivery_advance_due_internal_v043;
CREATE PROCEDURE pliego.sp_home_delivery_advance_due(IN p_batch_size INTEGER DEFAULT 100)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 CALL pliego.sp_home_delivery_advance_due_internal_v043(p_batch_size);
 CALL pliego.sp_purchase_lifecycle_advance_due(p_batch_size);
END; $$;

-- The detail/list reads recover a missed deadline before returning authoritative capabilities.
ALTER FUNCTION pliego.fn_order_post_purchase(BIGINT) RENAME TO fn_order_post_purchase_internal_v043;
CREATE FUNCTION pliego.fn_order_post_purchase(p_order_id BIGINT)
RETURNS TABLE(purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT CASE WHEN p.finalizado_en IS NOT NULL AND pliego.fn_order_starts_cancel_window(p.pedido_id)
              AND NOT EXISTS(SELECT FROM pliego.pedido_entrega f WHERE f.pedido_id=p.pedido_id AND f.metodo='STORE_PICKUP')
             THEN 'COMPLETED'::VARCHAR ELSE base.purchase_state END,
  base.fulfillment,base.shipment,base.invoice,base.credit_notes,
  base.available_actions || jsonb_build_object(
   'canCancel',base.available_actions->'cancel',
   'cancellationDeadline',CASE WHEN p.cancelacion_hasta IS NULL THEN NULL ELSE to_char(p.cancelacion_hasta AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
   'lifecycleState',CASE WHEN p.estado='CANCELLED' THEN 'CANCELLED'
      WHEN p.cancelacion_hasta IS NOT NULL AND p.finalizado_en IS NULL THEN 'CANCELLATION_WINDOW'
      WHEN p.finalizado_en IS NOT NULL AND NOT EXISTS(SELECT FROM pliego.pedido_entrega f WHERE f.pedido_id=p.pedido_id AND f.metodo='STORE_PICKUP') THEN 'COMPLETED'
      WHEN p.finalizado_en IS NOT NULL THEN 'PICKUP'
      ELSE base.purchase_state END,
   'libraryAccessState',CASE WHEN EXISTS(SELECT FROM pliego.pedido_item i JOIN pliego.digital_grant g USING(pedido_item_id)
       WHERE i.pedido_id=p.pedido_id AND i.formato_snapshot IN('EBOOK','AUDIOBOOK') AND g.state='ACTIVE')
      THEN 'OWNERSHIP_ONLY' ELSE 'NOT_APPLICABLE' END,
   'cancel',COALESCE((base.available_actions->>'cancel')::BOOLEAN,FALSE)
      AND (p.cancelacion_hasta IS NULL OR (p.finalizado_en IS NULL AND clock_timestamp()<p.cancelacion_hasta)),
   'canCancel',COALESCE((base.available_actions->>'cancel')::BOOLEAN,FALSE)
      AND (p.cancelacion_hasta IS NULL OR (p.finalizado_en IS NULL AND clock_timestamp()<p.cancelacion_hasta)))
 FROM pliego.pedido p CROSS JOIN LATERAL pliego.fn_order_post_purchase_internal_v043(p.pedido_id) base
 WHERE p.pedido_id=p_order_id;
$$;

ALTER FUNCTION pliego.fn_customer_order_detail(BIGINT,BIGINT) RENAME TO fn_customer_order_detail_internal_v043;
CREATE FUNCTION pliego.fn_customer_order_detail(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id BIGINT,order_state VARCHAR,subtotal NUMERIC(30,2),total NUMERIC(30,2),created_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ,items JSONB,address JSONB,payment JSONB,state_history JSONB,
 purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 PERFORM 1 FROM pliego.fn_customer_order_detail_internal_v017(p_actor_user_id,p_order_id);
 CALL pliego.sp_purchase_lifecycle_reconcile(p_order_id);
 CALL pliego.sp_home_delivery_reconcile(p_order_id);
 RETURN QUERY SELECT b.*,e.* FROM pliego.fn_customer_order_detail_internal_v017(p_actor_user_id,p_order_id) b
  CROSS JOIN LATERAL pliego.fn_order_post_purchase(b.order_id) e;
END; $$;

ALTER FUNCTION pliego.fn_admin_order_detail(BIGINT,BIGINT) RENAME TO fn_admin_order_detail_internal_v043;
CREATE FUNCTION pliego.fn_admin_order_detail(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id BIGINT,customer_id BIGINT,customer_email VARCHAR,customer_name VARCHAR,
 order_state VARCHAR,subtotal NUMERIC(30,2),total NUMERIC(30,2),created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,
 items JSONB,address JSONB,payment JSONB,state_history JSONB,inventory_movements JSONB,
 purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 PERFORM 1 FROM pliego.fn_admin_order_detail_internal_v017(p_actor_user_id,p_order_id);
 CALL pliego.sp_purchase_lifecycle_reconcile(p_order_id);
 CALL pliego.sp_home_delivery_reconcile(p_order_id);
 RETURN QUERY SELECT b.*,e.* FROM pliego.fn_admin_order_detail_internal_v017(p_actor_user_id,p_order_id) b
  CROSS JOIN LATERAL pliego.fn_order_post_purchase(b.order_id) e;
END; $$;

ALTER PROCEDURE pliego.sp_order_cancel(BIGINT,BIGINT) RENAME TO sp_order_cancel_internal_v043;
CREATE PROCEDURE pliego.sp_order_cancel(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
 OUT o_order_id BIGINT,OUT o_previous_state VARCHAR,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_restored_units BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE actor RECORD; order_row pliego.pedido%ROWTYPE;
BEGIN
 SELECT * INTO actor FROM pliego.fn_assert_actor(p_actor_user_id,NULL);
 SELECT * INTO order_row FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
 IF NOT FOUND OR (actor.rol='CUSTOMER' AND actor.cliente_id IS DISTINCT FROM order_row.cliente_id) THEN
  PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND');
 END IF;
 IF actor.rol NOT IN('CUSTOMER','ADMIN') THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 IF order_row.cancelacion_hasta IS NOT NULL AND
    (order_row.finalizado_en IS NOT NULL OR clock_timestamp()>=order_row.cancelacion_hasta) THEN
  PERFORM pliego.fn_raise_domain_error('P5003','ORDER_NOT_CANCELLABLE');
 END IF;
 CALL pliego.sp_order_cancel_internal_v043(p_actor_user_id,p_order_id,o_order_id,o_previous_state,o_order_state,o_payment_state,o_restored_units);
END; $$;

-- Extend the current summary Function with read-through reconciliation and completed digital state.
ALTER FUNCTION pliego.fn_customer_orders(BIGINT,INTEGER,INTEGER) RENAME TO fn_customer_orders_internal_v043;
CREATE FUNCTION pliego.fn_customer_orders(p_actor_user_id BIGINT,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(order_id BIGINT,created_at TIMESTAMPTZ,order_state VARCHAR,total NUMERIC(30,2),payment_state VARCHAR,total_count BIGINT,
 purchase_state VARCHAR,fulfillment_method VARCHAR,shipment_state VARCHAR,estimated_delivery_from TIMESTAMPTZ,
 estimated_delivery_to TIMESTAMPTZ,item_count BIGINT,unit_count BIGINT,item_summary JSONB,invoice_state VARCHAR,
 invoice_pdf_available BOOLEAN,invoice_xml_available BOOLEAN)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE row_order RECORD;
BEGIN
 FOR row_order IN SELECT order_id FROM pliego.fn_customer_orders_internal_v043(p_actor_user_id,p_page,p_page_size)
 LOOP CALL pliego.sp_purchase_lifecycle_reconcile(row_order.order_id); END LOOP;
 RETURN QUERY SELECT b.order_id,b.created_at,b.order_state,b.total,b.payment_state,b.total_count,
  CASE WHEN p.finalizado_en IS NOT NULL AND pliego.fn_order_starts_cancel_window(p.pedido_id)
       AND f.metodo IS DISTINCT FROM 'STORE_PICKUP' THEN 'COMPLETED'::VARCHAR
       ELSE pliego.fn_order_purchase_state(b.order_state) END,
  f.metodo,s.estado,s.entrega_estimada_desde,s.entrega_estimada_hasta,
  b.item_count,b.unit_count,b.item_summary,b.invoice_state,b.invoice_pdf_available,b.invoice_xml_available
 FROM pliego.fn_customer_orders_internal_v043(p_actor_user_id,p_page,p_page_size) b
 JOIN pliego.pedido p ON p.pedido_id=b.order_id
 LEFT JOIN pliego.pedido_entrega f ON f.pedido_id=b.order_id LEFT JOIN pliego.envio s ON s.pedido_id=b.order_id
 ORDER BY b.created_at DESC,b.order_id DESC;
END; $$;
