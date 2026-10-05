-- ADR0024: PostgreSQL owns simulated HOME_DELIVERY; commercial and pickup states stay separate.
CREATE TABLE pliego.home_delivery_config (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 preparing_minutes INTEGER NOT NULL CHECK(preparing_minutes BETWEEN 1 AND 1440),
 in_transit_minutes INTEGER NOT NULL CHECK(in_transit_minutes BETWEEN 1 AND 1440),
 out_for_delivery_minutes INTEGER NOT NULL CHECK(out_for_delivery_minutes BETWEEN 1 AND 1440)
);
INSERT INTO pliego.home_delivery_config VALUES(TRUE,2,2,2);

CREATE PROCEDURE pliego.sp_home_delivery_configure(IN p_preparing INTEGER,IN p_in_transit INTEGER,IN p_out_for_delivery INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF p_preparing IS NULL OR p_preparing NOT BETWEEN 1 AND 1440
 OR p_in_transit IS NULL OR p_in_transit NOT BETWEEN 1 AND 1440
 OR p_out_for_delivery IS NULL OR p_out_for_delivery NOT BETWEEN 1 AND 1440 THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 UPDATE pliego.home_delivery_config SET preparing_minutes=p_preparing,in_transit_minutes=p_in_transit,
  out_for_delivery_minutes=p_out_for_delivery WHERE singleton;
END; $$;

-- Retain SHIPPED for historical immutable events and legacy administrative input.
ALTER TABLE pliego.envio DROP CONSTRAINT envio_estado_check;
ALTER TABLE pliego.envio ADD CONSTRAINT envio_estado_check CHECK(estado IN
 ('PENDING','PREPARING','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'));
ALTER TABLE pliego.envio_historial DROP CONSTRAINT envio_historial_estado_anterior_check;
ALTER TABLE pliego.envio_historial DROP CONSTRAINT envio_historial_estado_nuevo_check;
ALTER TABLE pliego.envio_historial ADD CONSTRAINT envio_historial_estado_anterior_check CHECK(estado_anterior IS NULL OR estado_anterior IN
 ('PENDING','PREPARING','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'));
ALTER TABLE pliego.envio_historial ADD CONSTRAINT envio_historial_estado_nuevo_check CHECK(estado_nuevo IN
 ('PENDING','PREPARING','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'));
ALTER TABLE pliego.envio ADD COLUMN fecha_confirmacion TIMESTAMPTZ,
 ADD COLUMN transito_desde TIMESTAMPTZ,ADD COLUMN reparto_desde TIMESTAMPTZ,ADD COLUMN entrega_desde TIMESTAMPTZ;
ALTER TABLE pliego.envio ADD CONSTRAINT ck_envio_simulation_deadlines CHECK(
 (fecha_confirmacion IS NULL AND transito_desde IS NULL AND reparto_desde IS NULL AND entrega_desde IS NULL)
 OR (fecha_confirmacion IS NOT NULL AND transito_desde IS NOT NULL AND reparto_desde IS NOT NULL AND entrega_desde IS NOT NULL
 AND fecha_confirmacion<transito_desde AND transito_desde<reparto_desde AND reparto_desde<entrega_desde));
CREATE INDEX ix_envio_simulation_due ON pliego.envio(pedido_id) WHERE fecha_confirmacion IS NOT NULL
 AND estado IN ('PENDING','PREPARING','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY');
CREATE UNIQUE INDEX uq_envio_simulation_event ON pliego.envio_historial(envio_id,estado_nuevo)
 WHERE tipo='STATUS' AND origen='SYSTEM' AND estado_nuevo IN ('PREPARING','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED');

CREATE FUNCTION pliego.fn_home_delivery_state_at(p_transit TIMESTAMPTZ,p_out TIMESTAMPTZ,p_delivered TIMESTAMPTZ,p_at TIMESTAMPTZ)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$
 SELECT CASE WHEN p_at>=p_delivered THEN 'DELIVERED' WHEN p_at>=p_out THEN 'OUT_FOR_DELIVERY'
 WHEN p_at>=p_transit THEN 'IN_TRANSIT' ELSE 'PREPARING' END::VARCHAR;
$$;

-- Checkout inserts shipment after confirmation history, so deadlines and its initial event are atomic.
CREATE FUNCTION pliego.fn_home_delivery_initialize() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE c pliego.home_delivery_config%ROWTYPE;
BEGIN
 IF NEW.estado='PENDING' AND EXISTS(SELECT FROM pliego.pedido_entrega WHERE pedido_id=NEW.pedido_id AND metodo='HOME_DELIVERY') THEN
  SELECT min(fecha) INTO NEW.fecha_confirmacion FROM pliego.pedido_estado_historial
   WHERE pedido_id=NEW.pedido_id AND estado_nuevo='CONFIRMED';
  IF NEW.fecha_confirmacion IS NOT NULL THEN
   SELECT * INTO STRICT c FROM pliego.home_delivery_config WHERE singleton FOR SHARE;
   NEW.transito_desde:=NEW.fecha_confirmacion+make_interval(mins=>c.preparing_minutes);
   NEW.reparto_desde:=NEW.transito_desde+make_interval(mins=>c.in_transit_minutes);
   NEW.entrega_desde:=NEW.reparto_desde+make_interval(mins=>c.out_for_delivery_minutes);
   NEW.estado:='PREPARING'; NEW.fecha_preparacion:=NEW.fecha_confirmacion;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_envio_home_delivery_initialize BEFORE INSERT ON pliego.envio
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_home_delivery_initialize();

-- Existing active shipments get snapshots; completed/cancelled shipments and immutable histories stay intact.
WITH confirmed AS (SELECT e.envio_id,min(h.fecha) AS at FROM pliego.envio e
 JOIN pliego.pedido_entrega f USING(pedido_id) JOIN pliego.pedido_estado_historial h USING(pedido_id)
 WHERE f.metodo='HOME_DELIVERY' AND e.estado IN ('PENDING','PREPARING','SHIPPED','OUT_FOR_DELIVERY')
 AND h.estado_nuevo='CONFIRMED' GROUP BY e.envio_id)
UPDATE pliego.envio e SET fecha_confirmacion=h.at,
 transito_desde=h.at+make_interval(mins=>c.preparing_minutes),
 reparto_desde=h.at+make_interval(mins=>c.preparing_minutes+c.in_transit_minutes),
 entrega_desde=h.at+make_interval(mins=>c.preparing_minutes+c.in_transit_minutes+c.out_for_delivery_minutes)
 FROM confirmed h CROSS JOIN pliego.home_delivery_config c WHERE e.envio_id=h.envio_id;

CREATE PROCEDURE pliego.sp_home_delivery_reconcile(IN p_order BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE e pliego.envio%ROWTYPE; at_time TIMESTAMPTZ; next_state VARCHAR; event_at TIMESTAMPTZ; target VARCHAR;
BEGIN
 -- All writers lock order then shipment, including cancel and legacy administrative commands.
 PERFORM 1 FROM pliego.pedido WHERE pedido_id=p_order FOR UPDATE;
 SELECT s.* INTO e FROM pliego.envio s JOIN pliego.pedido_entrega f USING(pedido_id)
  WHERE s.pedido_id=p_order AND f.metodo='HOME_DELIVERY' FOR UPDATE OF s;
 IF NOT FOUND OR e.fecha_confirmacion IS NULL OR e.estado IN ('DELIVERED','CANCELLED') THEN RETURN; END IF;
 IF NOT EXISTS(SELECT FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id)
  WHERE p.pedido_id=p_order AND pliego.fn_order_purchase_state(p.estado)='CONFIRMED' AND pa.estado='APPROVED') THEN RETURN; END IF;
 at_time:=clock_timestamp(); -- Sample after locks, never transaction-start or client time.
 target:=pliego.fn_home_delivery_state_at(e.transito_desde,e.reparto_desde,e.entrega_desde,at_time);
 LOOP
  IF e.estado='PENDING' THEN next_state:='PREPARING'; event_at:=e.fecha_confirmacion;
  ELSIF e.estado='SHIPPED' THEN next_state:='IN_TRANSIT'; event_at:=COALESCE(e.fecha_envio,e.transito_desde);
  ELSIF e.estado='PREPARING' AND target<>'PREPARING' THEN next_state:='IN_TRANSIT'; event_at:=e.transito_desde;
  ELSIF e.estado='IN_TRANSIT' AND target IN ('OUT_FOR_DELIVERY','DELIVERED') THEN next_state:='OUT_FOR_DELIVERY'; event_at:=e.reparto_desde;
  ELSIF e.estado='OUT_FOR_DELIVERY' AND target='DELIVERED' THEN next_state:='DELIVERED'; event_at:=e.entrega_desde;
  ELSE EXIT; END IF;
  UPDATE pliego.envio SET estado=next_state,
   fecha_preparacion=CASE WHEN next_state='PREPARING' THEN event_at ELSE fecha_preparacion END,
   fecha_envio=CASE WHEN next_state='IN_TRANSIT' THEN event_at ELSE fecha_envio END,
   fecha_en_reparto=CASE WHEN next_state='OUT_FOR_DELIVERY' THEN event_at ELSE fecha_en_reparto END,
   fecha_entrega=CASE WHEN next_state='DELIVERED' THEN event_at ELSE fecha_entrega END WHERE envio_id=e.envio_id;
  INSERT INTO pliego.envio_historial(envio_id,tipo,origen,estado_anterior,estado_nuevo,fecha,
   transportista,seguimiento_codigo,seguimiento_url)
   VALUES(e.envio_id,'STATUS','SYSTEM',e.estado,next_state,event_at,e.transportista,e.seguimiento_codigo,e.seguimiento_url)
   ON CONFLICT DO NOTHING;
  e.estado:=next_state;
 END LOOP;
END; $$;

CREATE PROCEDURE pliego.sp_home_delivery_advance_due(IN p_batch_size INTEGER DEFAULT 100)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE row_order RECORD;
BEGIN
 IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 -- Skip locked ORDERS first: never hold a shipment while waiting for its order.
 FOR row_order IN SELECT p.pedido_id FROM pliego.pedido p JOIN pliego.envio e USING(pedido_id)
  JOIN pliego.pedido_entrega f USING(pedido_id)
  WHERE f.metodo='HOME_DELIVERY' AND e.fecha_confirmacion IS NOT NULL AND
   (e.estado IN ('PENDING','SHIPPED') OR (e.estado='PREPARING' AND e.transito_desde<=clock_timestamp())
    OR (e.estado='IN_TRANSIT' AND e.reparto_desde<=clock_timestamp())
    OR (e.estado='OUT_FOR_DELIVERY' AND e.entrega_desde<=clock_timestamp()))
  ORDER BY p.pedido_id LIMIT p_batch_size FOR UPDATE OF p SKIP LOCKED
 LOOP CALL pliego.sp_home_delivery_reconcile(row_order.pedido_id); END LOOP;
END; $$;

-- Authenticate/authorize before reconciliation and use fresh snapshots after writing.
CREATE OR REPLACE FUNCTION pliego.fn_customer_order_detail(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id BIGINT,order_state VARCHAR,subtotal NUMERIC(30,2),total NUMERIC(30,2),created_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ,items JSONB,address JSONB,payment JSONB,state_history JSONB,
 purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 PERFORM 1 FROM pliego.fn_customer_order_detail_internal_v017(p_actor_user_id,p_order_id);
 CALL pliego.sp_home_delivery_reconcile(p_order_id);
 RETURN QUERY SELECT b.*,e.* FROM pliego.fn_customer_order_detail_internal_v017(p_actor_user_id,p_order_id) b
  CROSS JOIN LATERAL pliego.fn_order_post_purchase(b.order_id) e;
END; $$;
CREATE OR REPLACE FUNCTION pliego.fn_admin_order_detail(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id BIGINT,customer_id BIGINT,customer_email VARCHAR,customer_name VARCHAR,order_state VARCHAR,
 subtotal NUMERIC(30,2),total NUMERIC(30,2),created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,
 items JSONB,address JSONB,payment JSONB,state_history JSONB,inventory_movements JSONB,
 purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 PERFORM 1 FROM pliego.fn_admin_order_detail_internal_v017(p_actor_user_id,p_order_id);
 CALL pliego.sp_home_delivery_reconcile(p_order_id);
 RETURN QUERY SELECT b.*,e.* FROM pliego.fn_admin_order_detail_internal_v017(p_actor_user_id,p_order_id) b
  CROSS JOIN LATERAL pliego.fn_order_post_purchase(b.order_id) e;
END; $$;
ALTER FUNCTION pliego.fn_customer_order_detail_priced(BIGINT,BIGINT) VOLATILE;
ALTER FUNCTION pliego.fn_admin_order_detail_priced(BIGINT,BIGINT) VOLATILE;

ALTER PROCEDURE pliego.sp_order_cancel(BIGINT,BIGINT) RENAME TO sp_order_cancel_internal_v042;
CREATE PROCEDURE pliego.sp_order_cancel(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
 OUT o_order_id BIGINT,OUT o_previous_state VARCHAR,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_restored_units BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE actor RECORD; order_customer BIGINT; e pliego.envio%ROWTYPE;
BEGIN
 SELECT * INTO actor FROM pliego.fn_assert_actor(p_actor_user_id,NULL);
 SELECT cliente_id INTO order_customer FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
 IF NOT FOUND OR (actor.rol='CUSTOMER' AND actor.cliente_id IS DISTINCT FROM order_customer) THEN
  PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 CALL pliego.sp_home_delivery_reconcile(p_order_id);
 SELECT * INTO e FROM pliego.envio WHERE pedido_id=p_order_id FOR UPDATE;
 IF FOUND AND e.estado<>'PREPARING' THEN
  PERFORM pliego.fn_raise_domain_error('P5003','ORDER_NOT_CANCELLABLE'); END IF;
 CALL pliego.sp_order_cancel_internal_v042(p_actor_user_id,p_order_id,o_order_id,o_previous_state,o_order_state,o_payment_state,o_restored_units);
END; $$;

-- Managed simulation cannot be accelerated through the existing administrative endpoint.
ALTER PROCEDURE pliego.sp_shipment_transition(BIGINT,BIGINT,VARCHAR) RENAME TO sp_shipment_transition_internal_v042;
CREATE PROCEDURE pliego.sp_shipment_transition(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,IN p_target_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE e pliego.envio%ROWTYPE; normalized VARCHAR:=CASE WHEN p_target_state='SHIPPED' THEN 'IN_TRANSIT' ELSE p_target_state END;
BEGIN
 PERFORM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
 PERFORM 1 FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
 CALL pliego.sp_home_delivery_reconcile(p_order_id);
 SELECT * INTO e FROM pliego.envio WHERE pedido_id=p_order_id FOR UPDATE;
 IF FOUND AND e.fecha_confirmacion IS NOT NULL THEN
  IF normalized IS NULL OR normalized NOT IN ('PREPARING','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED')
   OR normalized<>e.estado THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 ELSE CALL pliego.sp_shipment_transition_internal_v042(p_actor_user_id,p_order_id,p_target_state);
 END IF;
END; $$;

CREATE OR REPLACE FUNCTION pliego.fn_order_post_purchase(p_order_id BIGINT)
RETURNS TABLE(purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
SELECT pliego.fn_order_purchase_state(p.estado),
    pliego.fn_order_fulfillment(p.pedido_id,FALSE),
    (SELECT jsonb_build_object('shipmentId',e.envio_id,'state',e.estado,'carrier',e.transportista,
        'trackingCode',e.seguimiento_codigo,'trackingUrl',e.seguimiento_url,
        'estimatedDeliveryFrom',e.entrega_estimada_desde,'estimatedDeliveryTo',e.entrega_estimada_hasta,
        'createdAt',e.fecha_creacion,'preparingAt',e.fecha_preparacion,'shippedAt',e.fecha_envio,
        'outForDeliveryAt',e.fecha_en_reparto,'deliveredAt',e.fecha_entrega,'canceledAt',e.fecha_cancelacion,
        'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('eventId',h.envio_historial_id,'type',h.tipo,
            'origin',h.origen,'actorUserId',h.usuario_actor_id,'previousState',h.estado_anterior,'newState',h.estado_nuevo,
            'carrier',h.transportista,'trackingCode',h.seguimiento_codigo,'trackingUrl',h.seguimiento_url,'at',h.fecha)
            ORDER BY h.fecha,h.envio_historial_id) FROM pliego.envio_historial h WHERE h.envio_id=e.envio_id),'[]'::JSONB))
        FROM pliego.envio e WHERE e.pedido_id=p.pedido_id),
    (SELECT jsonb_build_object('invoiceId',i.factura_id,'documentNumber',i.numero_documento,'state',i.estado,
        'buyerName',i.comprador_nombre,'identityType',i.identidad_tipo,'identityNumber',i.identidad_numero,
        'buyerEmail',i.comprador_email,'currency',i.moneda,'subtotal',i.subtotal,'taxRate',i.impuesto_tasa,'taxTotal',i.impuesto_total,'shippingAmount',i.envio_monto,'total',i.total,
        'issuedAt',i.fecha_emision,'billingAddress',(SELECT jsonb_build_object('line1',d.direccion_linea1,
            'line2',d.direccion_linea2,'city',d.ciudad,'province',d.provincia,'countryCode',d.pais_codigo,'postalCode',d.codigo_postal)
            FROM pliego.factura_direccion d WHERE d.factura_id=i.factura_id),
        'items',(SELECT jsonb_agg(jsonb_build_object('invoiceItemId',l.factura_item_id,'orderItemId',l.pedido_item_id,
            'description',l.descripcion,'quantity',l.cantidad,'unitPrice',l.precio_unitario,'subtotal',l.subtotal,
            'taxTreatment',l.tratamiento_impuesto,'taxRate',l.impuesto_tasa,'taxAmount',l.impuesto_monto,'total',l.total)
            ORDER BY l.factura_item_id) FROM pliego.factura_item l WHERE l.factura_id=i.factura_id),
        'electronicIssuance',(SELECT jsonb_build_object('provider',el.proveedor,'state',el.estado,
            'externalReference',el.referencia_externa,'submittedAt',el.fecha_presentacion,'authorizedAt',el.fecha_autorizacion)
            FROM pliego.factura_emision_electronica el WHERE el.factura_id=i.factura_id),
        'pdfAvailable',EXISTS(SELECT 1 FROM pliego.factura_archivo ar WHERE ar.factura_id=i.factura_id AND ar.tipo='PDF'),
        'xmlAvailable',EXISTS(SELECT 1 FROM pliego.factura_archivo ar WHERE ar.factura_id=i.factura_id AND ar.tipo='XML'))
        FROM pliego.factura i WHERE i.pedido_id=p.pedido_id AND i.estado='ISSUED'),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('creditNoteId',n.nota_credito_id,'invoiceId',n.factura_id,
        'documentNumber',n.numero_documento,'state',n.estado,'reason',n.motivo,'subtotal',n.subtotal,
        'taxRate',n.impuesto_tasa,'taxTotal',n.impuesto_total,'shippingAmount',n.envio_monto,'total',n.total,'issuedAt',n.fecha_emision) ORDER BY n.fecha_emision,n.nota_credito_id)
        FROM pliego.nota_credito n JOIN pliego.factura i USING(factura_id) WHERE i.pedido_id=p.pedido_id),'[]'::JSONB),
    jsonb_build_object('cancel',p.estado IN ('CONFIRMED','PREPARING') AND pa.estado='APPROVED'
        AND NOT EXISTS(SELECT 1 FROM pliego.envio e WHERE e.pedido_id=p.pedido_id AND e.estado<>'PREPARING'),
        'changeShippingAddress',FALSE)
FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) WHERE p.pedido_id=p_order_id;
$$;

-- Pickup must use collection, never the legacy digital/shipment fallback.
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
    IF EXISTS (SELECT 1 FROM pliego.pedido_entrega WHERE pedido_id=p_order_id AND metodo='STORE_PICKUP') THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
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
    o_order_id:=p_order_id; SELECT estado INTO o_order_state FROM pliego.pedido WHERE pedido_id=p_order_id;
END; $$;
