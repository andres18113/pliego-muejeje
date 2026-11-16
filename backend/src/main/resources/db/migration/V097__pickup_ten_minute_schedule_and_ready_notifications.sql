-- ADR0051: future checkout snapshots use ten TOTAL minutes from approval.
-- Historical snapshots retain their original timing and immutable confirmation mail.
ALTER TABLE pliego.pedido_retiro
 ADD COLUMN programacion_version SMALLINT CHECK(programacion_version=1),
 ADD COLUMN aprobacion_programada_en TIMESTAMPTZ;

-- The location API advertises the effective policy used by future checkout;
-- keep legacy stored configuration intact for existing snapshots/audit.
CREATE OR REPLACE FUNCTION pliego.fn_pickup_locations()
RETURNS TABLE(pickup_location_id BIGINT,name VARCHAR,address VARCHAR,city VARCHAR,province VARCHAR,province_id BIGINT,city_id BIGINT,country_code CHAR(2),
 postal_code VARCHAR,latitude NUMERIC,longitude NUMERIC,timezone VARCHAR,opens_at TIME,closes_at TIME,active BOOLEAN,preparation_minutes INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT ubicacion_retiro_id,nombre,direccion,ciudad,provincia,provincia_id,ciudad_id,pais_codigo,codigo_postal,latitud,longitud,zona_horaria,apertura,cierre,activo,10
 FROM pliego.ubicacion_retiro WHERE activo ORDER BY nombre,ubicacion_retiro_id;
$$;

CREATE FUNCTION pliego.fn_pickup_is_open_at(p_at TIMESTAMPTZ,p_timezone TEXT,p_opens TIME,p_closes TIME)
RETURNS BOOLEAN LANGUAGE sql STABLE STRICT SECURITY INVOKER AS $$
 SELECT CASE WHEN p_opens<p_closes THEN
  (p_at AT TIME ZONE p_timezone)::TIME>=p_opens AND (p_at AT TIME ZONE p_timezone)::TIME<p_closes
 ELSE (p_at AT TIME ZONE p_timezone)::TIME>=p_opens OR (p_at AT TIME ZONE p_timezone)::TIME<p_closes END;
$$;

CREATE FUNCTION pliego.fn_pickup_ready_at(p_approval TIMESTAMPTZ,p_deadline TIMESTAMPTZ,
 p_timezone TEXT,p_opens TIME,p_closes TIME) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE candidate TIMESTAMPTZ; local_at TIMESTAMP;
BEGIN
 IF p_approval IS NULL OR NOT isfinite(p_approval) OR p_timezone IS NULL
  OR NOT pliego.fn_pickup_timezone_valid(p_timezone) OR p_opens IS NULL OR p_closes IS NULL
  OR p_opens=p_closes OR (p_deadline IS NOT NULL AND NOT isfinite(p_deadline)) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 candidate:=GREATEST(p_approval+INTERVAL '10 minutes',p_deadline);
 local_at:=candidate AT TIME ZONE p_timezone;
 -- Daily opening hours are the existing contract; do not invent weekdays/holidays.
 -- Opening is inclusive and closing exclusive. Overnight locations are supported.
 IF p_opens<p_closes THEN
  IF local_at::TIME<p_opens THEN RETURN (local_at::DATE+p_opens) AT TIME ZONE p_timezone; END IF;
  IF local_at::TIME>=p_closes THEN RETURN ((local_at::DATE+1)+p_opens) AT TIME ZONE p_timezone; END IF;
 ELSIF local_at::TIME>=p_closes AND local_at::TIME<p_opens THEN
  RETURN (local_at::DATE+p_opens) AT TIME ZONE p_timezone;
 END IF;
 RETURN candidate;
END; $$;

CREATE FUNCTION pliego.fn_pickup_capture_schedule() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE approved TIMESTAMPTZ; deadline TIMESTAMPTZ; anchor TIMESTAMPTZ;
BEGIN
 IF NEW.programacion_version IS DISTINCT FROM 1 THEN RETURN NEW; END IF;
 SELECT pa.fecha_aprobacion,p.cancelacion_hasta INTO approved,deadline
 FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) WHERE p.pedido_id=NEW.pedido_id;
 -- Pending-payment checkout has a provisional estimate. Only its first real
 -- approval may replace it; no historical or already-approved schedule is moved.
 anchor:=COALESCE(approved,clock_timestamp());
 NEW.aprobacion_programada_en:=approved;
 NEW.preparacion_minutos:=10;
 NEW.listo_desde:=pliego.fn_pickup_ready_at(anchor,deadline,NEW.zona_horaria,NEW.apertura,NEW.cierre);
 NEW.estimado_desde:=NEW.listo_desde-INTERVAL '10 minutes';
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pedido_retiro_capture_schedule BEFORE INSERT ON pliego.pedido_retiro
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_pickup_capture_schedule();

CREATE OR REPLACE FUNCTION pliego.fn_guard_pickup_snapshot() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE approved TIMESTAMPTZ; deadline TIMESTAMPTZ; expected TIMESTAMPTZ;
BEGIN
 IF TG_OP='DELETE' THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.fecha_retiro IS NOT NULL OR NEW.retirado_por IS NOT NULL OR NEW.identidad_verificada IS NOT NULL THEN
   PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.programacion_version=1 AND OLD.aprobacion_programada_en IS NULL
  AND NEW.aprobacion_programada_en IS NOT NULL AND OLD.fecha_retiro IS NULL THEN
  SELECT pa.fecha_aprobacion,p.cancelacion_hasta INTO approved,deadline
  FROM pliego.pago pa JOIN pliego.pedido p USING(pedido_id)
  WHERE pa.pedido_id=OLD.pedido_id AND pa.estado='APPROVED' AND p.estado='PENDING_PAYMENT';
  IF approved IS NULL THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END IF;
  expected:=pliego.fn_pickup_ready_at(approved,deadline,OLD.zona_horaria,OLD.apertura,OLD.cierre);
  IF NEW.aprobacion_programada_en IS NOT DISTINCT FROM approved AND NEW.preparacion_minutos=10
   AND NEW.listo_desde=expected AND NEW.estimado_desde=expected-INTERVAL '10 minutes'
   AND (to_jsonb(NEW)-ARRAY['estimado_desde','listo_desde','aprobacion_programada_en'])
    IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['estimado_desde','listo_desde','aprobacion_programada_en']) THEN
   RETURN NEW;
  END IF;
  PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
 END IF;
 IF (to_jsonb(NEW)-ARRAY['fecha_retiro','retirado_por','identidad_verificada'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['fecha_retiro','retirado_por','identidad_verificada']) THEN
  PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
 END IF;
 IF ROW(NEW.fecha_retiro,NEW.retirado_por,NEW.identidad_verificada)
    IS DISTINCT FROM ROW(OLD.fecha_retiro,OLD.retirado_por,OLD.identidad_verificada) THEN
  IF OLD.fecha_retiro IS NOT NULL OR NEW.fecha_retiro IS NULL
     OR NEW.retirado_por IS NULL OR NEW.identidad_verificada IS DISTINCT FROM TRUE THEN
   PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
  END IF;
  PERFORM * FROM pliego.fn_assert_actor(NEW.retirado_por,'ADMIN');
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION pliego.fn_pickup_anchor_approved_payment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.estado='APPROVED' AND OLD.estado IS DISTINCT FROM NEW.estado THEN
  UPDATE pliego.pedido_retiro r SET aprobacion_programada_en=NEW.fecha_aprobacion,
   listo_desde=pliego.fn_pickup_ready_at(NEW.fecha_aprobacion,p.cancelacion_hasta,r.zona_horaria,r.apertura,r.cierre),
   estimado_desde=pliego.fn_pickup_ready_at(NEW.fecha_aprobacion,p.cancelacion_hasta,r.zona_horaria,r.apertura,r.cierre)-INTERVAL '10 minutes'
  FROM pliego.pedido p WHERE p.pedido_id=NEW.pedido_id AND r.pedido_id=p.pedido_id
   AND r.programacion_version=1 AND r.aprobacion_programada_en IS NULL AND p.estado='PENDING_PAYMENT';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pago_pickup_approval_schedule AFTER UPDATE OF estado ON pliego.pago
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_pickup_anchor_approved_payment();

-- READY and collection stay unavailable while closed, including a later night
-- after the original readyAt. Legacy rows preserve their previously approved state.
ALTER FUNCTION pliego.fn_pickup_state(BIGINT) RENAME TO fn_pickup_state_internal_v097;
CREATE FUNCTION pliego.fn_pickup_state(p_order BIGINT) RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT CASE WHEN state.value='READY' AND r.programacion_version=1
   AND NOT pliego.fn_pickup_is_open_at(clock_timestamp(),r.zona_horaria,r.apertura,r.cierre)
  THEN 'PENDING'::VARCHAR ELSE state.value END
 FROM pliego.pedido_retiro r CROSS JOIN LATERAL (SELECT pliego.fn_pickup_state_internal_v097(p_order) AS value) state
 WHERE r.pedido_id=p_order;
$$;

CREATE OR REPLACE PROCEDURE pliego.sp_checkout(IN p_actor BIGINT,IN p_address BIGINT,IN p_method VARCHAR,IN p_outcome VARCHAR,
 IN p_fulfillment VARCHAR,IN p_pickup BIGINT,OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE location pliego.ubicacion_retiro%ROWTYPE; mode VARCHAR:=COALESCE(p_fulfillment,'HOME_DELIVERY'); now_at TIMESTAMPTZ; customer BIGINT; cart BIGINT; has_physical BOOLEAN;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 PERFORM pliego.fn_assert_cart_digital_purchase(customer);
 SELECT carrito_id INTO cart FROM pliego.carrito WHERE cliente_id=customer AND estado='ACTIVE' FOR UPDATE;
 IF cart IS NULL THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE'); END IF;
 IF NOT EXISTS(SELECT FROM pliego.carrito_item WHERE carrito_id=cart) THEN PERFORM pliego.fn_raise_domain_error('P4002','CART_EMPTY'); END IF;
 SELECT EXISTS(SELECT FROM pliego.carrito_item ci JOIN pliego.edicion e USING(edicion_id) WHERE ci.carrito_id=cart AND pliego.fn_is_physical_format(e.formato)) INTO has_physical;
 IF mode='STORE_PICKUP' AND NOT has_physical THEN PERFORM pliego.fn_raise_domain_error('P5012','PICKUP_REQUIRES_PHYSICAL'); END IF;
 IF mode NOT IN ('HOME_DELIVERY','STORE_PICKUP','DIGITAL_ONLY') OR
 (mode='DIGITAL_ONLY' AND (has_physical OR p_address IS NOT NULL OR p_pickup IS NOT NULL)) OR
 (mode<>'DIGITAL_ONLY' AND NOT has_physical) OR
 (mode='HOME_DELIVERY' AND (p_address IS NULL OR p_pickup IS NOT NULL)) OR
 (mode='STORE_PICKUP' AND (p_address IS NOT NULL OR p_pickup IS NULL)) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF mode='STORE_PICKUP' THEN
  SELECT * INTO location FROM pliego.ubicacion_retiro WHERE ubicacion_retiro_id=p_pickup FOR SHARE;
  IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5010','PICKUP_LOCATION_NOT_FOUND'); END IF;
  IF NOT location.activo THEN PERFORM pliego.fn_raise_domain_error('P5011','PICKUP_LOCATION_INACTIVE'); END IF;
 END IF;
 CALL pliego.sp_checkout_execute(p_actor,p_address,p_method,p_outcome,mode,p_pickup,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 IF EXISTS(SELECT FROM pliego.pedido_item i WHERE i.pedido_id=o_order_id AND pliego.fn_is_physical_format(i.formato_snapshot)) THEN
  INSERT INTO pliego.pedido_entrega(pedido_id,metodo) VALUES(o_order_id,mode);
  IF mode='HOME_DELIVERY' THEN
   WITH shipment AS (
    INSERT INTO pliego.envio(pedido_id,estado,fecha_cancelacion) VALUES(o_order_id,CASE WHEN o_order_state='CANCELLED' THEN 'CANCELLED' ELSE 'PENDING' END,
     CASE WHEN o_order_state='CANCELLED' THEN CURRENT_TIMESTAMP END) RETURNING envio_id,estado)
   INSERT INTO pliego.envio_historial(envio_id,tipo,origen,estado_nuevo) SELECT envio_id,'STATUS','SYSTEM',estado FROM shipment;
  ELSE
   now_at:=clock_timestamp();
   INSERT INTO pliego.pedido_retiro(pedido_id,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,codigo_postal,latitud,longitud,
    zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,codigo,programacion_version)
   VALUES(o_order_id,location.ubicacion_retiro_id,location.nombre,location.direccion,location.ciudad,location.provincia,location.pais_codigo,location.codigo_postal,
    location.latitud,location.longitud,location.zona_horaria,location.apertura,location.cierre,location.preparacion_minutos,
    now_at,now_at+make_interval(mins=>location.preparacion_minutos),pliego.fn_generate_pickup_code(),1);
  END IF;
 END IF;
 PERFORM pliego.fn_order_confirmation_enqueue(o_order_id);
END; $$;

-- Durable observation is separate from the immutable pickup snapshot. A completed
-- marker may mean a historical baseline (no email) or an atomically enqueued READY.
CREATE TABLE pliego.pedido_retiro_aviso (
 pedido_id BIGINT PRIMARY KEY REFERENCES pliego.pedido_retiro(pedido_id) ON DELETE RESTRICT,
 listo_procesado_en TIMESTAMPTZ,
 listo_omitido_historico BOOLEAN NOT NULL DEFAULT FALSE,
 CHECK(NOT listo_omitido_historico OR listo_procesado_en IS NOT NULL)
);
CREATE INDEX ix_pedido_retiro_aviso_pending ON pliego.pedido_retiro_aviso(pedido_id) WHERE listo_procesado_en IS NULL;
-- No historical-ready/collected/cancelled backlog is sent when this migration runs.
INSERT INTO pliego.pedido_retiro_aviso(pedido_id,listo_procesado_en,listo_omitido_historico)
 SELECT baseline.pedido_id,CASE WHEN baseline.omit THEN CURRENT_TIMESTAMP END,baseline.omit
 FROM (
  SELECT r.pedido_id,r.fecha_retiro IS NOT NULL OR p.estado='CANCELLED'
   OR (p.estado IN('CONFIRMED','PREPARING') AND COALESCE(pa.estado='APPROVED',FALSE) AND r.listo_desde<=CURRENT_TIMESTAMP
    AND (p.cancelacion_hasta IS NULL OR p.cancelacion_hasta<=CURRENT_TIMESTAMP)) AS omit
  FROM pliego.pedido_retiro r JOIN pliego.pedido p USING(pedido_id) LEFT JOIN pliego.pago pa USING(pedido_id)
 ) baseline;

CREATE FUNCTION pliego.fn_pickup_notification_register() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 INSERT INTO pliego.pedido_retiro_aviso(pedido_id) VALUES(NEW.pedido_id);
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pedido_retiro_notification_register AFTER INSERT ON pliego.pedido_retiro
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_pickup_notification_register();

-- Keep the established lifecycle enqueuer/renderer, covers and event keys intact.
ALTER FUNCTION pliego.fn_order_mail_enqueue(BIGINT,VARCHAR,VARCHAR,TIMESTAMPTZ,BIGINT)
 RENAME TO fn_order_mail_enqueue_internal_v097;
CREATE FUNCTION pliego.fn_order_mail_enqueue(p_order BIGINT,p_kind VARCHAR,p_state VARCHAR,
 p_event_at TIMESTAMPTZ,p_actor_user_id BIGINT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 IF p_kind='ORDER_STATUS' AND p_state='READY' THEN
  IF pliego.fn_pickup_state(p_order) IS DISTINCT FROM 'READY' OR NOT EXISTS(
   SELECT FROM pliego.pedido_retiro_aviso WHERE pedido_id=p_order AND listo_procesado_en IS NULL) THEN RETURN; END IF;
  INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
  SELECT 'ORDER_STATUS:'||p_order||':STORE_PICKUP:READY','ORDER_STATUS',u.usuario_id,u.email_normalizado,
   pliego.fn_order_mail_snapshot(p_order,'STORE_PICKUP','READY',p_event_at,FALSE)
  FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id)
  WHERE p.pedido_id=p_order ON CONFLICT(evento_clave) DO NOTHING;
 ELSE
  PERFORM pliego.fn_order_mail_enqueue_internal_v097(p_order,p_kind,p_state,p_event_at,p_actor_user_id);
 END IF;
END; $$;

CREATE FUNCTION pliego.fn_pickup_ready_mail_enqueue(p_order BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE ready_at TIMESTAMPTZ;
BEGIN
 -- All competing cancellation, collection and readiness paths lock order first.
 PERFORM 1 FROM pliego.pedido WHERE pedido_id=p_order FOR UPDATE;
 IF NOT EXISTS(SELECT FROM pliego.pedido_retiro_aviso WHERE pedido_id=p_order AND listo_procesado_en IS NULL) THEN RETURN; END IF;
 CALL pliego.sp_purchase_lifecycle_reconcile(p_order);
 IF pliego.fn_pickup_state(p_order) IS DISTINCT FROM 'READY' THEN RETURN; END IF;
 SELECT listo_desde INTO ready_at FROM pliego.pedido_retiro WHERE pedido_id=p_order;
 PERFORM pliego.fn_order_mail_enqueue(p_order,'ORDER_STATUS','READY',ready_at,NULL);
 -- The nested enqueuer rechecks opening hours. If closing won that race, leave
 -- observation pending for the next opening. An existing deduplicated event is
 -- durable completion too; never record completion without its outbox row.
 UPDATE pliego.pedido_retiro_aviso SET listo_procesado_en=clock_timestamp()
 WHERE pedido_id=p_order AND EXISTS(SELECT FROM pliego.correo_outbox
  WHERE evento_clave='ORDER_STATUS:'||p_order||':STORE_PICKUP:READY');
END; $$;

CREATE PROCEDURE pliego.sp_pickup_notifications_advance_due(IN p_batch_size INTEGER DEFAULT 100)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE row_order RECORD;
BEGIN
 IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 FOR row_order IN SELECT p.pedido_id FROM pliego.pedido p JOIN pliego.pedido_retiro r USING(pedido_id)
  JOIN pliego.pedido_retiro_aviso a USING(pedido_id) JOIN pliego.pago pa USING(pedido_id)
  WHERE a.listo_procesado_en IS NULL AND r.listo_desde<=clock_timestamp() AND r.fecha_retiro IS NULL
   AND p.estado IN('CONFIRMED','PREPARING') AND pa.estado='APPROVED'
   AND (r.programacion_version IS NULL OR pliego.fn_pickup_is_open_at(clock_timestamp(),r.zona_horaria,r.apertura,r.cierre))
  ORDER BY r.listo_desde,p.pedido_id LIMIT p_batch_size FOR UPDATE OF p SKIP LOCKED
 LOOP PERFORM pliego.fn_pickup_ready_mail_enqueue(row_order.pedido_id); END LOOP;
END; $$;

-- Reuse the existing lifecycle scheduler; missed sweeps are recoverable from
-- durable markers on the next invocation or after application restart.
ALTER PROCEDURE pliego.sp_home_delivery_advance_due(INTEGER) RENAME TO sp_home_delivery_advance_due_internal_v097;
CREATE PROCEDURE pliego.sp_home_delivery_advance_due(IN p_batch_size INTEGER DEFAULT 100)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 CALL pliego.sp_home_delivery_advance_due_internal_v097(p_batch_size);
 CALL pliego.sp_pickup_notifications_advance_due(p_batch_size);
END; $$;

-- A counter handover may beat the periodic sweep. Persist the READY transition
-- before the same transaction writes collection and the existing COLLECTED email.
CREATE FUNCTION pliego.fn_pickup_mail_before_collection() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF OLD.fecha_retiro IS NULL AND NEW.fecha_retiro IS NOT NULL THEN
  PERFORM pliego.fn_pickup_ready_mail_enqueue(NEW.pedido_id);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pedido_retiro_mail_before_collection BEFORE UPDATE OF fecha_retiro ON pliego.pedido_retiro
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_pickup_mail_before_collection();

REVOKE ALL ON TABLE pliego.pedido_retiro_aviso FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_pickup_ready_at(TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TIME,TIME),
 pliego.fn_pickup_is_open_at(TIMESTAMPTZ,TEXT,TIME,TIME),pliego.fn_pickup_state(BIGINT),
 pliego.fn_pickup_capture_schedule(),pliego.fn_pickup_anchor_approved_payment(),
 pliego.fn_pickup_notification_register(),pliego.fn_pickup_ready_mail_enqueue(BIGINT),
 pliego.fn_pickup_mail_before_collection(),pliego.fn_order_mail_enqueue(BIGINT,VARCHAR,VARCHAR,TIMESTAMPTZ,BIGINT) FROM PUBLIC;
REVOKE ALL ON PROCEDURE pliego.sp_pickup_notifications_advance_due(INTEGER),pliego.sp_home_delivery_advance_due(INTEGER) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT SELECT,INSERT,UPDATE ON TABLE pliego.pedido_retiro_aviso TO pliego_app;
  GRANT EXECUTE ON FUNCTION pliego.fn_pickup_ready_at(TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TIME,TIME),
   pliego.fn_pickup_is_open_at(TIMESTAMPTZ,TEXT,TIME,TIME),pliego.fn_pickup_state(BIGINT),
   pliego.fn_pickup_capture_schedule(),pliego.fn_pickup_anchor_approved_payment(),
   pliego.fn_pickup_notification_register(),pliego.fn_pickup_ready_mail_enqueue(BIGINT),
   pliego.fn_pickup_mail_before_collection(),pliego.fn_order_mail_enqueue(BIGINT,VARCHAR,VARCHAR,TIMESTAMPTZ,BIGINT) TO pliego_app;
  GRANT EXECUTE ON PROCEDURE pliego.sp_pickup_notifications_advance_due(INTEGER),pliego.sp_home_delivery_advance_due(INTEGER) TO pliego_app;
 END IF;
END $grants$;

-- Published help is served by the backend. Preserve unpublished/editorial rows.
UPDATE pliego.ayuda_articulo SET cuerpo=$body$## Cómo pedirlo

1. Al finalizar la compra, elige Retiro en tienda.
2. Elige un punto de la lista: verás su dirección y su horario de atención.
3. Selecciona Hacer pedido.

El retiro es para libros impresos. Si el pedido también tiene eBooks o audiolibros, esos aparecen en [Mi biblioteca](/biblioteca).

## Cuándo y cómo recogerlo

Los pedidos nuevos están listos 10 minutos después de aprobarse el pago: 6 minutos para cancelar y 4 minutos adicionales de preparación. Si el punto está cerrado al cumplirse ese plazo, puedes retirarlo desde la próxima apertura. El retiro solo está disponible dentro del horario del punto.

En el detalle del pedido, en [Mis pedidos](/orders), ves la hora de retiro y tu código, que empieza con P-. Te avisamos por correo cuando está listo. Los pedidos anteriores conservan la hora indicada en su detalle.

Ve al punto dentro de su horario de atención y presenta el código y tu documento de identidad. Cuando lo recoges, el pedido pasa a Retirado y recibes una confirmación por correo.

## Cancelar

Tienes 6 minutos desde que se aprueba el pago para cancelarlo, desde su detalle en Mis pedidos.$body$
WHERE slug='retiro' AND estado='PUBLISHED'
 AND categoria_id=(SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug='retiro');
UPDATE pliego.ayuda_articulo SET cuerpo=replace(cuerpo,
 'durante los primeros 6 minutos después de hacer el pedido.',
 'durante los primeros 6 minutos desde que se aprueba el pago.')
WHERE slug='cancelaciones-y-reembolsos' AND estado='PUBLISHED'
 AND categoria_id=(SELECT categoria_id FROM pliego.ayuda_categoria WHERE slug='cancelaciones-y-reembolsos');
