-- Qualify the table output to avoid collision with the Function's OUT order_id variable.
CREATE OR REPLACE FUNCTION pliego.fn_customer_orders(p_actor_user_id BIGINT,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(order_id BIGINT,created_at TIMESTAMPTZ,order_state VARCHAR,total NUMERIC(30,2),payment_state VARCHAR,total_count BIGINT,
 purchase_state VARCHAR,fulfillment_method VARCHAR,shipment_state VARCHAR,estimated_delivery_from TIMESTAMPTZ,
 estimated_delivery_to TIMESTAMPTZ,item_count BIGINT,unit_count BIGINT,item_summary JSONB,invoice_state VARCHAR,
 invoice_pdf_available BOOLEAN,invoice_xml_available BOOLEAN)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE row_order RECORD;
BEGIN
 FOR row_order IN SELECT o.order_id
  FROM pliego.fn_customer_orders_internal_v043(p_actor_user_id,p_page,p_page_size) o
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
