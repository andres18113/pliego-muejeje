-- Add the current edition public cover to NEW order-event snapshots only.
-- V088 renamed the V061 builder and delegates to it while adding orderReference.
-- CREATE OR REPLACE retains its owner, invoker security and existing runtime ACL.
-- No queued/sent payload, purchase snapshot or private invoice artifact is changed.
-- Match the public asset contract enforced by MailTemplates: HTTPS CDN only,
-- no signed query strings, fragments, traversal or authenticated store paths.
CREATE OR REPLACE FUNCTION pliego.fn_order_mail_snapshot_internal_v088(
 p_order BIGINT,p_method VARCHAR,p_state VARCHAR,p_event_at TIMESTAMPTZ,p_confirmation BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
 v_order RECORD;
 v_items JSONB;
 v_delivery JSONB;
 v_fulfillment JSONB;
 v_pickup JSONB;
 v_offer RECORD;
 v_carrier VARCHAR;
 v_tracking_code VARCHAR;
 v_tracking_url VARCHAR;
 v_shipment_state VARCHAR;
 v_refund JSONB;
BEGIN
 SELECT p.pedido_id,p.cliente_id,p.estado AS order_state,p.fecha_creacion,p.cancelacion_hasta,p.finalizado_en,
  p.subtotal,p.impuesto_tasa,p.impuesto_monto,p.envio_monto,p.total,
  c.nombres,c.apellidos,u.email_normalizado,
  pa.estado AS payment_state,pa.monto AS payment_amount,pa.fecha_actualizacion AS payment_updated_at
 INTO v_order
 FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id)
 JOIN pliego.usuario u USING(usuario_id) JOIN pliego.pago pa USING(pedido_id)
 WHERE p.pedido_id=p_order;
 IF NOT FOUND THEN RETURN NULL; END IF;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'orderItemId',i.pedido_item_id::TEXT,'sku',i.sku_snapshot,'title',i.titulo_snapshot,'authors',i.autores_snapshot,
  'publisher',i.editorial_snapshot,'format',i.formato_snapshot,'isbn',i.isbn_snapshot,
  'coverUrl',CASE WHEN e.portada_url ~ '^https://covers\.pliegolibros\.com/covers/editions/([A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$'
   THEN e.portada_url ELSE NULL END,
  'quantity',i.cantidad,'unitPrice',i.precio_unitario::TEXT,'subtotal',i.subtotal::TEXT,
  'originalPrice',i.precio_original_snapshot::TEXT,'unitSavings',i.ahorro_unitario_snapshot::TEXT,
  'originalSubtotal',i.subtotal_original_snapshot::TEXT,'lineSavings',i.ahorro_linea_snapshot::TEXT,
  'pricingSnapshotAvailable',i.precio_original_snapshot IS NOT NULL
   AND i.ahorro_unitario_snapshot IS NOT NULL AND i.subtotal_original_snapshot IS NOT NULL
   AND i.ahorro_linea_snapshot IS NOT NULL
 ) ORDER BY i.pedido_item_id),'[]'::JSONB)
 INTO v_items FROM pliego.pedido_item i
 LEFT JOIN pliego.edicion e ON e.edicion_id=i.edicion_id
 WHERE i.pedido_id=p_order;

 SELECT jsonb_build_object('recipient',d.destinatario,'line1',d.direccion_linea1,
  'line2',d.direccion_linea2,'city',d.ciudad,'province',d.provincia,
  'country',d.pais_codigo,'postalCode',d.codigo_postal,'reference',d.referencia)
 INTO v_delivery
 FROM pliego.pedido_direccion d JOIN pliego.pedido_entrega f USING(pedido_id)
 WHERE d.pedido_id=p_order AND f.metodo='HOME_DELIVERY';

 v_fulfillment:=pliego.fn_order_fulfillment(p_order,p_confirmation);
 v_pickup:=v_fulfillment->'pickup';
 IF p_state IN ('CANCELLED','COLLECTED') AND v_pickup IS NOT NULL THEN
  v_pickup:=v_pickup-'pickupCode';
  v_fulfillment:=jsonb_set(v_fulfillment,'{pickup}',v_pickup,TRUE);
 END IF;
 SELECT e.transportista,e.seguimiento_codigo,e.seguimiento_url
 INTO v_carrier,v_tracking_code,v_tracking_url FROM pliego.envio e WHERE e.pedido_id=p_order;
 SELECT e.estado INTO v_shipment_state FROM pliego.envio e WHERE e.pedido_id=p_order;
 SELECT original_subtotal,savings_total INTO v_offer FROM pliego.fn_order_offer_pricing(p_order);

 IF v_order.payment_state='REFUNDED' THEN
  v_refund:=jsonb_build_object('state','REFUNDED','amount',v_order.payment_amount::TEXT,
   'refundedAt',to_char(v_order.payment_updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 END IF;

 RETURN jsonb_build_object(
  'orderId',v_order.pedido_id::TEXT,'orderNumber',v_order.pedido_id::TEXT,
  'customerId',v_order.cliente_id::TEXT,'customerName',btrim(v_order.nombres||' '||v_order.apellidos),
  'customerEmail',v_order.email_normalizado,
  'date',to_char(v_order.fecha_creacion AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'eventAt',to_char(COALESCE(p_event_at,v_order.fecha_creacion) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'method',p_method,'fulfillmentMethod',p_method,'state',p_state,
  'fulfillmentState',CASE
   WHEN p_confirmation AND p_method='HOME_DELIVERY' THEN v_shipment_state
   WHEN p_confirmation AND p_method='STORE_PICKUP' THEN 'PENDING'
   WHEN p_method='DIGITAL' THEN NULL
   ELSE p_state END,
  'lifecycleState',CASE WHEN p_state='CANCELLED' THEN 'CANCELLED'
   WHEN p_method='DIGITAL' AND v_order.finalizado_en IS NOT NULL THEN 'COMPLETED'
   WHEN p_method='DIGITAL' AND v_order.cancelacion_hasta IS NOT NULL THEN 'CANCELLATION_WINDOW'
   ELSE p_state END,
  'shipmentState',v_shipment_state,
  'orderState',v_order.order_state,
  'purchaseState',CASE WHEN p_method='DIGITAL' AND v_order.finalizado_en IS NOT NULL
    THEN 'COMPLETED' ELSE pliego.fn_order_purchase_state(v_order.order_state) END,
  'items',v_items,'subtotal',v_order.subtotal::TEXT,
  'originalSubtotal',v_offer.original_subtotal::TEXT,'savingsTotal',v_offer.savings_total::TEXT,
  'taxRate',to_char(v_order.impuesto_tasa,'FM990.00'),'taxAmount',v_order.impuesto_monto::TEXT,
  'shippingAmount',v_order.envio_monto::TEXT,'total',v_order.total::TEXT,
  'paymentState',v_order.payment_state,
  'refundAmount',CASE WHEN v_order.payment_state='REFUNDED' THEN v_order.payment_amount::TEXT END,
  'refund',v_refund,'cancellationAt',CASE WHEN p_state='CANCELLED'
    THEN to_char(COALESCE(p_event_at,v_order.payment_updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
  'delivery',v_delivery,'fulfillment',v_fulfillment,'pickup',v_pickup,
  'carrier',v_carrier,'trackingCode',v_tracking_code,'trackingUrl',v_tracking_url,
  'actionPath','/orders/'||v_order.pedido_id::TEXT,'libraryPath','/biblioteca'
 );
END; $$;
