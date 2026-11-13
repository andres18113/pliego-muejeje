-- Read projection only: digital access belongs to this purchased source, not to
-- another purchase of the same edition. Preserve reconciliation and authorization.
ALTER FUNCTION pliego.fn_customer_order_detail(BIGINT,BIGINT)
 RENAME TO fn_customer_order_detail_internal_v055;

CREATE FUNCTION pliego.fn_customer_order_detail(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id BIGINT,order_state VARCHAR,subtotal NUMERIC(30,2),total NUMERIC(30,2),created_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ,items JSONB,address JSONB,payment JSONB,state_history JSONB,
 purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE b RECORD;
BEGIN
 -- The authorized reader may wait behind payment approval while reconciling the
 -- order. Finish that statement first so the grant lookup uses its committed
 -- snapshot too. The reconciler's order lock is retained by Spring's transaction.
 SELECT * INTO STRICT b FROM pliego.fn_customer_order_detail_internal_v055(p_actor_user_id,p_order_id);
 RETURN QUERY
 SELECT b.order_id,b.order_state,b.subtotal,b.total,b.created_at,b.updated_at,
  COALESCE((SELECT jsonb_agg(line.item || jsonb_build_object(
    'requiresPhysicalFulfillment',pliego.fn_is_physical_format(line.item->>'format'),
    'digitalAccess',CASE WHEN pliego.fn_is_physical_format(line.item->>'format') THEN NULL
      ELSE jsonb_build_object('state',access.state,
       'ownedItemId',CASE WHEN access.state='AVAILABLE' THEN g.owned_item_id::TEXT ELSE NULL END) END
   ) ORDER BY line.position)
   FROM jsonb_array_elements(b.items) WITH ORDINALITY AS line(item,position)
   LEFT JOIN pliego.digital_grant g ON g.pedido_item_id=(line.item->>'orderItemId')::BIGINT
   CROSS JOIN LATERAL (SELECT CASE
    WHEN g.state='REVOKED' OR b.payment->>'state'='REFUNDED' THEN 'REVOKED'
    WHEN b.order_state='CANCELLED' OR b.payment->>'state'='REJECTED' THEN 'UNAVAILABLE'
    WHEN g.state='ACTIVE' AND b.payment->>'state'='APPROVED' THEN 'AVAILABLE'
    WHEN b.payment->>'state'='PENDING' THEN 'PENDING_PAYMENT'
    ELSE 'UNAVAILABLE' END AS state) access),'[]'::JSONB),
  b.address,b.payment,b.state_history,b.purchase_state,b.fulfillment,b.shipment,b.invoice,b.credit_notes,b.available_actions;
END; $$;

COMMENT ON FUNCTION pliego.fn_customer_order_detail(BIGINT,BIGINT) IS
 'Public customer Database API: authorized historical order with source-specific digital ownership. AVAILABLE is ownership only, not content delivery; physical digitalAccess is null.';
