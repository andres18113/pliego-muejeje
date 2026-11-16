-- Disposable PostgreSQL 18 only. Literal boundary expectations catch extra preparation,
-- closed-hour readiness, cancellation drift and missing/duplicate transition events.
\set ON_ERROR_STOP on
BEGIN;
DO $timing$
DECLARE actual TIMESTAMPTZ;
BEGIN
 actual:=pliego.fn_pickup_ready_at('2026-11-01 10:00:00-05','2026-11-01 10:06:00-05','America/Guayaquil','09:00','17:00');
 IF actual IS DISTINCT FROM '2026-11-01 10:10:00-05'::TIMESTAMPTZ THEN RAISE EXCEPTION 'open: expected approval+10, got %',actual; END IF;
 actual:=pliego.fn_pickup_ready_at('2026-11-01 16:49:59-05','2026-11-01 16:55:59-05','America/Guayaquil','09:00','17:00');
 IF actual IS DISTINCT FROM '2026-11-01 16:59:59-05'::TIMESTAMPTZ THEN RAISE EXCEPTION 'near close: %',actual; END IF;
 actual:=pliego.fn_pickup_ready_at('2026-11-01 16:50:00-05','2026-11-01 16:56:00-05','America/Guayaquil','09:00','17:00');
 IF actual IS DISTINCT FROM '2026-11-02 09:00:00-05'::TIMESTAMPTZ THEN RAISE EXCEPTION 'close exclusive: %',actual; END IF;
 actual:=pliego.fn_pickup_ready_at('2026-11-01 19:22:00-05','2026-11-01 19:28:00-05','America/Guayaquil','09:00','17:00');
 IF actual IS DISTINCT FROM '2026-11-02 09:00:00-05'::TIMESTAMPTZ THEN RAISE EXCEPTION 'closed: %',actual; END IF;
 actual:=pliego.fn_pickup_ready_at('2026-11-01 08:50:00-05','2026-11-01 08:56:00-05','America/Guayaquil','09:00','17:00');
 IF actual IS DISTINCT FROM '2026-11-01 09:00:00-05'::TIMESTAMPTZ THEN RAISE EXCEPTION 'open inclusive: %',actual; END IF;
 actual:=pliego.fn_pickup_ready_at('2026-11-01 10:00:00-05','2026-11-01 10:12:00-05','America/Guayaquil','09:00','17:00');
 IF actual IS DISTINCT FROM '2026-11-01 10:12:00-05'::TIMESTAMPTZ THEN RAISE EXCEPTION 'deadline floor: %',actual; END IF;
 actual:=pliego.fn_pickup_ready_at('2026-11-01 22:55:00-05',NULL,'America/Guayaquil','22:00','06:00');
 IF actual IS DISTINCT FROM '2026-11-01 23:05:00-05'::TIMESTAMPTZ THEN RAISE EXCEPTION 'overnight open: %',actual; END IF;
 actual:=pliego.fn_pickup_ready_at('2026-11-01 05:50:00-05',NULL,'America/Guayaquil','22:00','06:00');
 IF actual IS DISTINCT FROM '2026-11-01 22:00:00-05'::TIMESTAMPTZ THEN RAISE EXCEPTION 'overnight close: %',actual; END IF;
END $timing$;

-- Public checkout exercises the real API wrapper even while the legacy seed is 25.
DO $checkout$
DECLARE a BIGINT; u BIGINT; c BIGINT; state VARCHAR; author_id BIGINT; pub BIGINT; cat BIGINT;
 book BIGINT; edition BIGINT; mov BIGINT; stock_before INTEGER; stock_after INTEGER; cart BIGINT; item BIGINT; qty INTEGER;
 location BIGINT; o BIGINT; deferred BIGINT; pay VARCHAR; total NUMERIC; ref VARCHAR; invoice BIGINT;
 approved TIMESTAMPTZ; ready TIMESTAMPTZ; estimated TIMESTAMPTZ; deadline TIMESTAMPTZ; code VARCHAR; original JSONB;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('pickup-timing-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
 CALL pliego.sp_customer_register('pickup-timing-customer@example.invalid','fixture','Ana','Pérez',NULL,u,c,state);
 CALL pliego.sp_customer_billing_identity_register(u,'EC_CEDULA','1710034065');
 CALL pliego.sp_author_create(a,'Autora horarios',NULL,author_id);
 CALL pliego.sp_publisher_create(a,'Editorial horarios',NULL,pub);
 CALL pliego.sp_category_create(a,'Horarios','pickup-timing-gate',NULL,NULL,cat);
 CALL pliego.sp_book_create(a,'Libro horarios',NULL,NULL,jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(cat),book);
 CALL pliego.sp_edition_create(a,book,pub,'PICKUP-TIMING-GATE',NULL,'es','PAPERBACK',100,NULL,7.25,NULL,NULL,NULL,NULL,edition);
 CALL pliego.sp_inventory_entry(a,edition,10,'fixture',mov,stock_before,stock_after);
 INSERT INTO pliego.ubicacion_retiro(nombre,direccion,ciudad,provincia,pais_codigo,latitud,longitud,zona_horaria,apertura,cierre,preparacion_minutos)
 VALUES('Horario de prueba','Principal','Quito','Pichincha','EC',0,0,'UTC',
  (clock_timestamp() AT TIME ZONE 'UTC')::TIME-INTERVAL '1 hour',(clock_timestamp() AT TIME ZONE 'UTC')::TIME+INTERVAL '1 hour',25)
 RETURNING ubicacion_retiro_id INTO location;
 CALL pliego.sp_cart_add_item(u,edition,1,cart,item,qty);
 CALL pliego.sp_checkout_quoted(u,uuidv4(),NULL,'CARD','APPROVED',cart,'STORE_PICKUP',location,NULL,o,state,pay,total,ref);
 SELECT pa.fecha_aprobacion,p.cancelacion_hasta,r.listo_desde,r.estimado_desde INTO approved,deadline,ready,estimated
 FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) JOIN pliego.pedido_retiro r USING(pedido_id) WHERE p.pedido_id=o;
 IF ready IS DISTINCT FROM approved+INTERVAL '10 minutes' OR deadline IS DISTINCT FROM approved+INTERVAL '6 minutes'
  OR estimated IS DISTINCT FROM approved OR (SELECT preparacion_minutos<>10 FROM pliego.pedido_retiro WHERE pedido_id=o)
 THEN RAISE EXCEPTION 'checkout did not use approval+10 / exact6 / coherent snapshot'; END IF;
 original:=pliego.fn_order_fulfillment(o,TRUE);
 IF (SELECT datos->'pickup' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o) IS DISTINCT FROM original->'pickup'
 THEN RAISE EXCEPTION 'confirmation disagrees with customer timing'; END IF;
 IF pliego.fn_admin_pickup_detail(a,o)->>'readyAt' IS NULL OR pliego.fn_pickup_state(o)<>'PENDING'
 THEN RAISE EXCEPTION 'admin projection missing authoritative readiness'; END IF;
 CALL pliego.sp_pickup_notifications_advance_due(100);
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:'||o||':STORE_PICKUP:READY')
 THEN RAISE EXCEPTION 'READY before +10'; END IF;
 -- No routine may alter an approved schedule later.
 BEGIN UPDATE pliego.pedido_retiro SET listo_desde=listo_desde+INTERVAL '1 minute',estimado_desde=estimado_desde+INTERVAL '1 minute' WHERE pedido_id=o;
  RAISE EXCEPTION 'approved snapshot mutable'; EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 CALL pliego.sp_cart_add_item(u,edition,1,cart,item,qty);
 CALL pliego.sp_checkout_billed_quoted(u,uuidv4(),NULL,'TRANSFER','PENDING',cart,'STORE_PICKUP',location,NULL,
  'EC_CEDULA','1710034065','Ana Pérez','Principal',NULL,'Quito','Pichincha','EC',NULL,
  deferred,state,pay,total,ref,invoice);
 IF pay<>'PENDING' THEN RAISE EXCEPTION 'deferred fixture not pending'; END IF;
 CALL pliego.sp_billed_order_approve(a,deferred);
 SELECT pa.fecha_aprobacion,p.cancelacion_hasta,r.listo_desde,r.estimado_desde INTO approved,deadline,ready,estimated
 FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) JOIN pliego.pedido_retiro r USING(pedido_id) WHERE p.pedido_id=deferred;
 IF ready IS DISTINCT FROM approved+INTERVAL '10 minutes' OR deadline IS DISTINCT FROM approved+INTERVAL '6 minutes'
  OR estimated IS DISTINCT FROM approved THEN RAISE EXCEPTION 'deferred approval failed to reanchor exact10/exact6'; END IF;
 original:=pliego.fn_order_fulfillment(deferred,TRUE);
 CALL pliego.sp_billed_order_approve(a,deferred);
 IF pliego.fn_order_fulfillment(deferred,TRUE) IS DISTINCT FROM original THEN RAISE EXCEPTION 'repeat approval moved schedule'; END IF;
END $checkout$;

CREATE FUNCTION pg_temp.pickup_event_fixture(p_customer BIGINT,p_edition BIGINT,p_approval INTERVAL,
 p_opens TIME,p_closes TIME) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE o BIGINT; anchor TIMESTAMPTZ:=clock_timestamp(); location pliego.ubicacion_retiro%ROWTYPE; stock_before INTEGER;
BEGIN
 SELECT * INTO location FROM pliego.ubicacion_retiro ORDER BY ubicacion_retiro_id LIMIT 1;
 INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total) VALUES(p_customer,'PENDING_PAYMENT',7.25,7.25) RETURNING pedido_id INTO o;
 INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,
  formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
 SELECT o,edicion_id,sku,'Libro eventos','Autora','Editorial',formato,idioma,precio,1,precio FROM pliego.edicion WHERE edicion_id=p_edition;
 SELECT stock_actual INTO stock_before FROM pliego.inventario WHERE edicion_id=p_edition FOR UPDATE;
 UPDATE pliego.inventario SET stock_actual=stock_before-1 WHERE edicion_id=p_edition;
 INSERT INTO pliego.movimiento_inventario(edicion_id,pedido_id,usuario_actor_id,tipo,cantidad,stock_anterior,stock_posterior,motivo)
 VALUES(p_edition,o,NULL,'SALE',1,stock_before,stock_before-1,NULL);
 INSERT INTO pliego.pago(pedido_id,metodo,estado,monto,referencia,fecha_aprobacion)
 VALUES(o,'CARD','APPROVED',7.25,pliego.fn_generate_payment_reference(),anchor+p_approval);
 UPDATE pliego.pedido SET estado='CONFIRMED' WHERE pedido_id=o;
 INSERT INTO pliego.pedido_entrega(pedido_id,metodo) VALUES(o,'STORE_PICKUP');
 INSERT INTO pliego.pedido_retiro(pedido_id,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,
  codigo_postal,latitud,longitud,zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,codigo,programacion_version)
 VALUES(o,location.ubicacion_retiro_id,location.nombre,location.direccion,location.ciudad,location.provincia,location.pais_codigo,
  location.codigo_postal,location.latitud,location.longitud,'UTC',p_opens,p_closes,10,anchor,anchor+INTERVAL '10 minutes',pliego.fn_generate_pickup_code(),1);
 RETURN o;
END $$;

DO $events$
DECLARE a BIGINT; u BIGINT; c BIGINT; edition BIGINT; at_time TIME:=(clock_timestamp() AT TIME ZONE 'UTC')::TIME;
 opens TIME; closes TIME; early BIGINT; ready BIGINT; counter BIGINT; cancelled BIGINT; expired BIGINT; closed BIGINT;
 code VARCHAR; previous VARCHAR; result_state VARCHAR; payment VARCHAR; restored BIGINT; result_order BIGINT;
BEGIN
 SELECT usuario_id INTO a FROM pliego.usuario WHERE email_normalizado='pickup-timing-admin@example.invalid';
 SELECT usuario_id,cliente_id INTO u,c FROM pliego.usuario JOIN pliego.cliente USING(usuario_id) WHERE email_normalizado='pickup-timing-customer@example.invalid';
 SELECT edicion_id INTO edition FROM pliego.edicion WHERE sku='PICKUP-TIMING-GATE';
 opens:=at_time-INTERVAL '1 hour'; closes:=at_time+INTERVAL '1 hour';
 early:=pg_temp.pickup_event_fixture(c,edition,-INTERVAL '9 minutes 59 seconds',opens,closes);
 CALL pliego.sp_purchase_lifecycle_reconcile(early);
 IF pliego.fn_pickup_state(early)<>'PENDING' THEN RAISE EXCEPTION '9:59 should remain pending'; END IF;
 ready:=pg_temp.pickup_event_fixture(c,edition,INTERVAL '-10 minutes',opens,closes);
 counter:=pg_temp.pickup_event_fixture(c,edition,INTERVAL '-10 minutes',opens,closes);
 cancelled:=pg_temp.pickup_event_fixture(c,edition,-INTERVAL '5 minutes 59 seconds',opens,closes);
 CALL pliego.sp_order_cancel(u,cancelled,result_order,previous,result_state,payment,restored);
 IF result_state<>'CANCELLED' OR payment<>'REFUNDED' THEN RAISE EXCEPTION '5:59 cancellation lost its six-minute window'; END IF;
 expired:=pg_temp.pickup_event_fixture(c,edition,-INTERVAL '6 minutes 1 second',opens,closes);
 BEGIN CALL pliego.sp_order_cancel(u,expired,result_order,previous,result_state,payment,restored);
  RAISE EXCEPTION '6:01 cancellation accepted'; EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL; END;

 -- Yesterday's availability cannot authorize collection or an email during today's closed hours.
 closed:=pg_temp.pickup_event_fixture(c,edition,-INTERVAL '1 day 90 minutes',at_time-INTERVAL '2 hours',at_time-INTERVAL '1 hour');
 CALL pliego.sp_purchase_lifecycle_reconcile(closed);
 IF pliego.fn_pickup_state(closed)<>'PENDING' THEN RAISE EXCEPTION 'closed point exposed READY after prior-day readiness'; END IF;
 SELECT codigo INTO code FROM pliego.pedido_retiro WHERE pedido_id=closed;
 BEGIN CALL pliego.sp_pickup_collect(a,closed,code,TRUE);
  RAISE EXCEPTION 'closed point accepted collection'; EXCEPTION WHEN SQLSTATE 'P5018' THEN NULL; END;

 -- A crash/rollback loses both the marker and outbox; retry recovers the event.
 BEGIN
  PERFORM pliego.fn_pickup_ready_mail_enqueue(ready);
  RAISE EXCEPTION USING ERRCODE='P1999',MESSAGE='simulated rollback';
 EXCEPTION WHEN SQLSTATE 'P1999' THEN NULL; END;
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:'||ready||':STORE_PICKUP:READY')
  OR (SELECT listo_procesado_en IS NOT NULL FROM pliego.pedido_retiro_aviso WHERE pedido_id=ready)
 THEN RAISE EXCEPTION 'rollback left a partial event/marker'; END IF;

 -- Counter handover before the first sweep still records both transitions atomically.
 SELECT codigo INTO code FROM pliego.pedido_retiro WHERE pedido_id=counter;
 CALL pliego.sp_pickup_collect(a,counter,code,TRUE);
 BEGIN CALL pliego.sp_pickup_collect(a,counter,code,TRUE);
  RAISE EXCEPTION 'duplicate collection accepted'; EXCEPTION WHEN SQLSTATE 'P5017' THEN NULL; END;
 CALL pliego.sp_home_delivery_advance_due(100);
 CALL pliego.sp_home_delivery_advance_due(100);
 IF pliego.fn_pickup_state(ready)<>'READY' THEN RAISE EXCEPTION 'exact10 did not become READY'; END IF;
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:'||ready||':STORE_PICKUP:READY')<>1
  OR (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:'||counter||':STORE_PICKUP:READY')<>1
  OR (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:'||counter||':STORE_PICKUP:COLLECTED')<>1
 THEN RAISE EXCEPTION 'READY/COLLECTED enqueue was missing or duplicated'; END IF;
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave IN(
  'ORDER_STATUS:'||cancelled||':STORE_PICKUP:READY','ORDER_STATUS:'||cancelled||':STORE_PICKUP:COLLECTED',
  'ORDER_STATUS:'||closed||':STORE_PICKUP:READY','ORDER_STATUS:'||early||':STORE_PICKUP:READY'))
 THEN RAISE EXCEPTION 'cancelled/closed/early pickup emitted READY/COLLECTED'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox o JOIN pliego.pedido_retiro r ON r.pedido_id=ready
  WHERE o.evento_clave='ORDER_STATUS:'||ready||':STORE_PICKUP:READY' AND o.tipo='ORDER_STATUS'
   AND o.datos->>'state'='READY' AND o.datos->'pickup'->>'pickupCode'=r.codigo
   AND (o.datos->>'eventAt')::TIMESTAMPTZ=r.listo_desde)
 THEN RAISE EXCEPTION 'READY payload lost authoritative code/time'; END IF;
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:'||counter||':STORE_PICKUP:COLLECTED'
  AND (datos->'pickup' ? 'pickupCode' OR datos->'fulfillment'->'pickup' ? 'pickupCode'))
 THEN RAISE EXCEPTION 'COLLECTED leaked pickup credential'; END IF;
END $events$;
ROLLBACK;
