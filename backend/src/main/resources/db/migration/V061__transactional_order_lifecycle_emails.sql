-- Extend the existing PostgreSQL outbox with customer order-lifecycle events.
ALTER TABLE pliego.correo_outbox DROP CONSTRAINT IF EXISTS correo_outbox_tipo_check;
ALTER TABLE pliego.correo_outbox ADD CONSTRAINT ck_correo_outbox_tipo
 CHECK(tipo IN ('VERIFY_EMAIL','RESET_PASSWORD','ORDER_CONFIRMED','ORDER_STATUS','ORDER_CANCELLED'));

CREATE FUNCTION pliego.fn_order_mail_snapshot(
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
  'quantity',i.cantidad,'unitPrice',i.precio_unitario::TEXT,'subtotal',i.subtotal::TEXT,
  'originalPrice',i.precio_original_snapshot::TEXT,'unitSavings',i.ahorro_unitario_snapshot::TEXT,
  'originalSubtotal',i.subtotal_original_snapshot::TEXT,'lineSavings',i.ahorro_linea_snapshot::TEXT,
  'pricingSnapshotAvailable',i.precio_original_snapshot IS NOT NULL
   AND i.ahorro_unitario_snapshot IS NOT NULL AND i.subtotal_original_snapshot IS NOT NULL
   AND i.ahorro_linea_snapshot IS NOT NULL
 ) ORDER BY i.pedido_item_id),'[]'::JSONB)
 INTO v_items FROM pliego.pedido_item i WHERE i.pedido_id=p_order;

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

CREATE FUNCTION pliego.fn_order_mail_enqueue(
 p_order BIGINT,p_kind VARCHAR,p_state VARCHAR,p_event_at TIMESTAMPTZ,p_actor_user_id BIGINT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE
 v_order RECORD;
 v_method VARCHAR;
 v_event_key VARCHAR(160);
 v_data JSONB;
 v_actor RECORD;
 v_valid BOOLEAN:=FALSE;
BEGIN
 SELECT p.cliente_id,p.estado,pa.estado AS payment_state,COALESCE(f.metodo,'DIGITAL') AS method
 INTO v_order FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id)
 LEFT JOIN pliego.pedido_entrega f USING(pedido_id) WHERE p.pedido_id=p_order;
 IF NOT FOUND THEN RETURN; END IF;
 v_method:=v_order.method;

 IF p_kind='ORDER_CONFIRMED' THEN
  IF v_order.estado IS DISTINCT FROM 'CONFIRMED' OR v_order.payment_state IS DISTINCT FROM 'APPROVED'
   OR p_state IS DISTINCT FROM 'CONFIRMED' THEN RETURN; END IF;
  v_event_key:='ORDER_CONFIRMED:'||p_order;
 ELSIF p_kind='ORDER_STATUS' THEN
  IF v_order.payment_state IS DISTINCT FROM 'APPROVED' THEN RETURN; END IF;
  IF v_method='HOME_DELIVERY' THEN
   v_valid:=p_state IN ('PREPARING','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED')
    AND EXISTS(SELECT FROM pliego.envio e WHERE e.pedido_id=p_order AND e.estado=p_state);
  ELSIF v_method='STORE_PICKUP' THEN
   v_valid:=(p_state='PREPARING' AND v_order.estado='PREPARING'
      AND EXISTS(SELECT FROM pliego.pedido_retiro r WHERE r.pedido_id=p_order AND r.fecha_retiro IS NULL))
    OR (p_state='COLLECTED' AND v_order.estado='DELIVERED'
      AND EXISTS(SELECT FROM pliego.pedido_retiro r WHERE r.pedido_id=p_order AND r.fecha_retiro IS NOT NULL));
  ELSIF v_method='DIGITAL' THEN
   v_valid:=p_state='COMPLETED' AND EXISTS(SELECT FROM pliego.pedido p
    WHERE p.pedido_id=p_order AND p.finalizado_en IS NOT NULL
     AND NOT EXISTS(SELECT FROM pliego.pedido_item i WHERE i.pedido_id=p_order AND pliego.fn_is_physical_format(i.formato_snapshot)));
  END IF;
  IF NOT v_valid THEN RETURN; END IF;
  v_event_key:='ORDER_STATUS:'||p_order||':'||v_method||':'||p_state;
 ELSIF p_kind='ORDER_CANCELLED' THEN
  IF p_state IS DISTINCT FROM 'CANCELLED' OR v_order.estado IS DISTINCT FROM 'CANCELLED'
   OR v_order.payment_state IS DISTINCT FROM 'REFUNDED' OR p_actor_user_id IS NULL THEN RETURN; END IF;
  SELECT u.rol,c.cliente_id INTO v_actor FROM pliego.usuario u LEFT JOIN pliego.cliente c USING(usuario_id)
   WHERE u.usuario_id=p_actor_user_id AND u.estado='ACTIVE';
  IF NOT FOUND OR v_actor.rol<>'CUSTOMER' OR v_actor.cliente_id IS DISTINCT FROM v_order.cliente_id THEN RETURN; END IF;
  v_event_key:='ORDER_CANCELLED:'||p_order;
 ELSE
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;

 v_data:=pliego.fn_order_mail_snapshot(p_order,v_method,p_state,p_event_at,p_kind='ORDER_CONFIRMED');
 IF v_data IS NULL THEN RETURN; END IF;
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 SELECT v_event_key,p_kind,u.usuario_id,u.email_normalizado,v_data
 FROM pliego.cliente c JOIN pliego.usuario u USING(usuario_id)
 WHERE c.cliente_id=v_order.cliente_id
 ON CONFLICT(evento_clave) DO NOTHING;
END; $$;

-- Confirmation is enqueued before the initial HOME_DELIVERY PREPARING status.
CREATE OR REPLACE FUNCTION pliego.fn_order_confirmation_enqueue(p_order BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE shipment pliego.envio%ROWTYPE;
BEGIN
 PERFORM pliego.fn_order_mail_enqueue(p_order,'ORDER_CONFIRMED','CONFIRMED',NULL,NULL);
 SELECT * INTO shipment FROM pliego.envio WHERE pedido_id=p_order;
 IF FOUND AND shipment.estado='PREPARING'
  AND EXISTS(SELECT FROM pliego.pedido_entrega f WHERE f.pedido_id=p_order AND f.metodo='HOME_DELIVERY') THEN
  PERFORM pliego.fn_order_mail_enqueue(p_order,'ORDER_STATUS','PREPARING',
   COALESCE(shipment.fecha_preparacion,shipment.fecha_confirmacion),NULL);
 END IF;
END; $$;

CREATE FUNCTION pliego.fn_order_mail_home_delivery_transition() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE event_at TIMESTAMPTZ;
BEGIN
 IF OLD.estado IS NOT DISTINCT FROM NEW.estado OR NEW.estado NOT IN ('PREPARING','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED')
  OR NOT EXISTS(SELECT FROM pliego.pedido_entrega f WHERE f.pedido_id=NEW.pedido_id AND f.metodo='HOME_DELIVERY') THEN
  RETURN NEW;
 END IF;
 event_at:=CASE NEW.estado
  WHEN 'PREPARING' THEN COALESCE(NEW.fecha_preparacion,NEW.fecha_confirmacion,NEW.fecha_creacion)
  WHEN 'IN_TRANSIT' THEN COALESCE(NEW.fecha_envio,NEW.transito_desde,NEW.fecha_creacion)
  WHEN 'OUT_FOR_DELIVERY' THEN COALESCE(NEW.fecha_en_reparto,NEW.reparto_desde,NEW.fecha_creacion)
  WHEN 'DELIVERED' THEN COALESCE(NEW.fecha_entrega,NEW.entrega_desde,NEW.fecha_creacion)
 END;
 PERFORM pliego.fn_order_mail_enqueue(NEW.pedido_id,'ORDER_STATUS',NEW.estado,event_at,NULL);
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_envio_lifecycle_email_update AFTER UPDATE OF estado ON pliego.envio
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_order_mail_home_delivery_transition();

CREATE FUNCTION pliego.fn_order_mail_pickup_transition() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE pickup_at TIMESTAMPTZ;
BEGIN
 IF OLD.estado IS NOT DISTINCT FROM NEW.estado
  OR NOT EXISTS(SELECT FROM pliego.pedido_entrega f WHERE f.pedido_id=NEW.pedido_id AND f.metodo='STORE_PICKUP') THEN
  RETURN NEW;
 END IF;
 IF OLD.estado='CONFIRMED' AND NEW.estado='PREPARING' AND NEW.finalizado_en IS NOT NULL THEN
  PERFORM pliego.fn_order_mail_enqueue(NEW.pedido_id,'ORDER_STATUS','PREPARING',NEW.finalizado_en,NULL);
 ELSIF NEW.estado='DELIVERED' AND EXISTS(SELECT FROM pliego.pedido_retiro r
       WHERE r.pedido_id=NEW.pedido_id AND r.fecha_retiro IS NOT NULL) THEN
  SELECT fecha_retiro INTO pickup_at FROM pliego.pedido_retiro WHERE pedido_id=NEW.pedido_id;
  PERFORM pliego.fn_order_mail_enqueue(NEW.pedido_id,'ORDER_STATUS','COLLECTED',pickup_at,NULL);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pedido_pickup_lifecycle_email AFTER UPDATE OF estado ON pliego.pedido
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_order_mail_pickup_transition();

CREATE FUNCTION pliego.fn_order_mail_digital_finalized() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF OLD.finalizado_en IS NULL AND NEW.finalizado_en IS NOT NULL
  AND pliego.fn_order_starts_cancel_window(NEW.pedido_id)
  AND NOT EXISTS(SELECT FROM pliego.pedido_entrega f WHERE f.pedido_id=NEW.pedido_id)
  AND NOT EXISTS(SELECT FROM pliego.pedido_item i WHERE i.pedido_id=NEW.pedido_id AND pliego.fn_is_physical_format(i.formato_snapshot)) THEN
  PERFORM pliego.fn_order_mail_enqueue(NEW.pedido_id,'ORDER_STATUS','COMPLETED',NEW.finalizado_en,NULL);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pedido_digital_finalized_email AFTER UPDATE OF finalizado_en ON pliego.pedido
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_order_mail_digital_finalized();

-- The status history is written only after the customer cancellation/refund transaction succeeds.
CREATE FUNCTION pliego.fn_order_mail_customer_cancellation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.estado_anterior IS DISTINCT FROM 'CANCELLED' AND NEW.estado_nuevo='CANCELLED'
  AND EXISTS(SELECT FROM pliego.usuario u WHERE u.usuario_id=NEW.usuario_actor_id AND u.rol='CUSTOMER') THEN
  PERFORM pliego.fn_order_mail_enqueue(NEW.pedido_id,'ORDER_CANCELLED','CANCELLED',NEW.fecha,NEW.usuario_actor_id);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pedido_customer_cancelled_email AFTER INSERT ON pliego.pedido_estado_historial
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_order_mail_customer_cancellation();
