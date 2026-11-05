-- Disposable PostgreSQL 18 only. All fixtures/effects are rolled back.
\set ON_ERROR_STOP on
BEGIN;
DO $gate$
DECLARE code TEXT;
BEGIN
 FOR n IN 1..128 LOOP
  code:=pliego.fn_generate_pickup_code();
  IF code !~ '^P-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$' THEN
   RAISE EXCEPTION 'pickup codes must have eight CSPRNG alphabet characters, got %',code;
  END IF;
 END LOOP;
END $gate$;

-- Seed lifecycle timestamps on insertion instead of weakening immutable snapshots
-- or waiting for real preparation/cancellation windows to elapse.
CREATE FUNCTION pg_temp.pickup_fixture(p_customer BIGINT,p_edition BIGINT,p_ready INTERVAL,
 p_deadline INTERVAL,p_code VARCHAR DEFAULT NULL,p_digital BIGINT DEFAULT NULL) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE o BIGINT; now_at TIMESTAMPTZ:=clock_timestamp(); location pliego.ubicacion_retiro%ROWTYPE; amount NUMERIC;
BEGIN
 SELECT * INTO location FROM pliego.ubicacion_retiro ORDER BY ubicacion_retiro_id LIMIT 1;
 amount:=2*(SELECT precio FROM pliego.edicion WHERE edicion_id=p_edition)
  +COALESCE((SELECT precio FROM pliego.edicion WHERE edicion_id=p_digital),0);
 INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total) VALUES(p_customer,'PENDING_PAYMENT',amount,amount) RETURNING pedido_id INTO o;
 INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,
  formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
 SELECT o,e.edicion_id,e.sku,l.titulo,'Autora verificada','Editorial verificada',e.formato,e.idioma,e.precio,
  CASE WHEN e.edicion_id=p_edition THEN 2 ELSE 1 END,e.precio*CASE WHEN e.edicion_id=p_edition THEN 2 ELSE 1 END
 FROM pliego.edicion e JOIN pliego.libro l USING(libro_id) WHERE e.edicion_id IN(p_edition,p_digital);
 INSERT INTO pliego.pago(pedido_id,metodo,estado,monto,referencia,fecha_aprobacion)
 VALUES(o,'CARD','APPROVED',amount,pliego.fn_generate_payment_reference(),now_at+p_deadline-INTERVAL '6 minutes');
 UPDATE pliego.pedido SET estado='CONFIRMED' WHERE pedido_id=o;
 INSERT INTO pliego.pedido_entrega(pedido_id,metodo) VALUES(o,'STORE_PICKUP');
 INSERT INTO pliego.pedido_retiro(pedido_id,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,
  codigo_postal,latitud,longitud,zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,codigo)
 VALUES(o,location.ubicacion_retiro_id,location.nombre,location.direccion,location.ciudad,location.provincia,location.pais_codigo,
  location.codigo_postal,location.latitud,location.longitud,location.zona_horaria,location.apertura,location.cierre,
  location.preparacion_minutos,now_at+p_ready-make_interval(mins=>location.preparacion_minutos),now_at+p_ready,
  COALESCE(p_code,pliego.fn_generate_pickup_code()));
 RETURN o;
END $$;

DO $gate$
DECLARE a BIGINT; other_admin BIGINT; u BIGINT; c BIGINT; state VARCHAR; author_id BIGINT; pub BIGINT; cat BIGINT;
 book BIGINT; edition BIGINT; digital BIGINT; early BIGINT; preparing BIGINT; ready BIGINT; ready2 BIGINT; cancelled BIGINT;
 unpaid BIGINT; no_pickup BIGINT; legacy BIGINT; code VARCHAR; case_code VARCHAR; view JSONB; confirmation JSONB; finalization TIMESTAMPTZ;
 cancel_id BIGINT; cancel_previous VARCHAR; cancel_state VARCHAR; cancel_payment VARCHAR; cancel_units BIGINT;
 row_data RECORD; snapshot_before JSONB; snapshot_after JSONB; detail JSONB; other_code TEXT; err TEXT; before_sequence BIGINT; after_sequence BIGINT; n INTEGER; previous_state TEXT;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('verified-pickup-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('verified-pickup-admin-2@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO other_admin;
 CALL pliego.sp_customer_register('verified-pickup-customer@example.invalid','fixture','Ana','Pérez',NULL,u,c,state);
 CALL pliego.sp_customer_billing_identity_register(u,'EC_CEDULA','1710034065');
 CALL pliego.sp_author_create(a,'Autora verificada',NULL,author_id);
 CALL pliego.sp_publisher_create(a,'Editorial verificada',NULL,pub);
 CALL pliego.sp_category_create(a,'Retiro verificado','verified-pickup-gate',NULL,NULL,cat);
 CALL pliego.sp_book_create(a,'Libro verificado',NULL,NULL,jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(cat),book);
 CALL pliego.sp_edition_create(a,book,pub,'VERIFIED-PICKUP-GATE',NULL,'es','PAPERBACK',100,NULL,7.25,NULL,NULL,NULL,NULL,edition);
 CALL pliego.sp_edition_create(a,book,pub,'VERIFIED-PICKUP-DIGITAL',NULL,'es','EBOOK',NULL,NULL,3.50,NULL,NULL,NULL,NULL,digital);

 SELECT last_value INTO before_sequence FROM pliego.retiro_codigo_seq;
 FOR n IN 1..64 LOOP PERFORM pliego.fn_generate_pickup_code(); END LOOP;
 SELECT last_value INTO after_sequence FROM pliego.retiro_codigo_seq;
 IF before_sequence<>after_sequence THEN RAISE EXCEPTION 'CSPRNG generation still consumes the public sequence'; END IF;

 early:=pg_temp.pickup_fixture(c,edition,INTERVAL '-1 minute',INTERVAL '5 minutes');
 preparing:=pg_temp.pickup_fixture(c,edition,INTERVAL '20 minutes',INTERVAL '-1 minute');
 ready:=pg_temp.pickup_fixture(c,edition,INTERVAL '-2 minutes',INTERVAL '-1 minute',NULL,digital);
 ready2:=pg_temp.pickup_fixture(c,edition,INTERVAL '-1 minute',INTERVAL '-1 minute');
 cancelled:=pg_temp.pickup_fixture(c,edition,INTERVAL '-1 minute',INTERVAL '-1 minute');
 UPDATE pliego.pedido SET estado='CANCELLED' WHERE pedido_id=cancelled;
 unpaid:=pg_temp.pickup_fixture(c,edition,INTERVAL '-1 minute',INTERVAL '-1 minute');
 UPDATE pliego.pago SET estado='REJECTED',referencia=NULL WHERE pedido_id=unpaid;
 INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total) VALUES(c,'CONFIRMED',7.25,7.25) RETURNING pedido_id INTO no_pickup;
 legacy:=pg_temp.pickup_fixture(c,edition,INTERVAL '-1 minute',INTERVAL '-1 minute','P-22222A');


 -- AC-3.2 AC-3.3: verify a due but unreconciled order; no tuple in its lifecycle may change.
 SELECT codigo INTO code FROM pliego.pedido_retiro WHERE pedido_id=ready;
 SELECT codigo INTO other_code FROM pliego.pedido_retiro WHERE pedido_id=early;
 SELECT jsonb_build_array(to_jsonb(p),to_jsonb(r),
  (SELECT jsonb_agg(to_jsonb(h)) FROM pliego.pedido_estado_historial h WHERE pedido_id=ready),
  (SELECT jsonb_agg(to_jsonb(o)) FROM pliego.correo_outbox o WHERE usuario_id=u))
 INTO snapshot_before FROM pliego.pedido p JOIN pliego.pedido_retiro r USING(pedido_id) WHERE pedido_id=ready;
 FOREACH case_code IN ARRAY ARRAY[code,lower(substr(code,3)),lower(' p - '||substr(code,3))] LOOP
  detail:=pliego.fn_admin_pickup_verify_code(a,ready,case_code);
  IF detail->>'orderState'<>'CONFIRMED' OR detail->>'state'<>'PENDING'
   OR detail->>'paymentMethod'<>'CARD' OR detail->'availableActions'->>'cancel'<>'false'
   OR detail::TEXT LIKE '%'||code||'%' OR jsonb_path_exists(detail,'strict $.**.pickupCode') THEN
   RAISE EXCEPTION 'verification changed state or exposed credentials: %',detail; END IF;
 END LOOP;
 FOREACH case_code IN ARRAY ARRAY['wrong',other_code] LOOP
  BEGIN PERFORM pliego.fn_admin_pickup_verify_code(a,ready,case_code); RAISE EXCEPTION 'wrong/other order code accepted';
  EXCEPTION WHEN SQLSTATE 'P5013' THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err<>'PICKUP_CODE_INVALID' THEN RAISE EXCEPTION 'verification distinguishes wrong/other code'; END IF;
  END;
 END LOOP;
 SELECT jsonb_build_array(to_jsonb(p),to_jsonb(r),
  (SELECT jsonb_agg(to_jsonb(h)) FROM pliego.pedido_estado_historial h WHERE pedido_id=ready),
  (SELECT jsonb_agg(to_jsonb(o)) FROM pliego.correo_outbox o WHERE usuario_id=u))
 INTO snapshot_after FROM pliego.pedido p JOIN pliego.pedido_retiro r USING(pedido_id) WHERE pedido_id=ready;
 IF snapshot_before IS DISTINCT FROM snapshot_after THEN RAISE EXCEPTION 'verification wrote lifecycle rows'; END IF;
 -- AC-2.1 AC-2.4 AC-8.1: detail reconciles; deadline and availability reuse the existing DB projection.
 detail:=pliego.fn_admin_pickup_handover_detail(a,ready);
 IF detail->>'state'<>'READY' OR detail->>'orderState'<>'PREPARING'
  OR detail->'availableActions'->>'cancel'<>'false' THEN RAISE EXCEPTION 'detail did not reconcile READY'; END IF;
 detail:=pliego.fn_admin_pickup_handover_detail(a,early);
 IF detail->'availableActions'->>'cancel'<>'true' OR detail->'availableActions'->>'cancellationDeadline' IS NULL
  OR (detail->'availableActions'->>'cancellationDeadline')::TIMESTAMPTZ IS DISTINCT FROM
    (SELECT fecha_aprobacion+INTERVAL '6 minutes' FROM pliego.pago WHERE pedido_id=early) THEN
  RAISE EXCEPTION 'six-minute cancellation capability missing'; END IF;
 -- AC-2.5: existence precedes the code check, including non-pickup orders.
 FOREACH before_sequence IN ARRAY ARRAY[no_pickup,9223372036854775807::BIGINT] LOOP
  BEGIN PERFORM pliego.fn_admin_pickup_handover_detail(a,before_sequence); RAISE EXCEPTION 'missing/nonpickup detail accepted';
  EXCEPTION WHEN SQLSTATE 'P5016' THEN NULL; END;
  BEGIN PERFORM pliego.fn_admin_pickup_verify_code(a,before_sequence,'wrong'); RAISE EXCEPTION 'missing/nonpickup verify accepted';
  EXCEPTION WHEN SQLSTATE 'P5016' THEN NULL; END;
 END LOOP;
 -- AC-7.1: every new routine enforces ADMIN, independent of HTTP security.
 BEGIN PERFORM pliego.fn_admin_pickup_handover_view(u,ready); RAISE EXCEPTION 'customer handover view accepted';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 BEGIN PERFORM pliego.fn_admin_pickup_handover_detail(u,ready); RAISE EXCEPTION 'customer handover detail accepted';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 BEGIN PERFORM pliego.fn_admin_pickup_verify_code(u,ready,code); RAISE EXCEPTION 'customer verify accepted';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 BEGIN CALL pliego.sp_admin_order_cancel(u,early,cancel_id,cancel_previous,cancel_state,cancel_payment,cancel_units); RAISE EXCEPTION 'customer admin cancel accepted';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 -- AC-8.2: READY and CANCELLED are refused by the unchanged business command.
 BEGIN CALL pliego.sp_admin_order_cancel(a,ready,cancel_id,cancel_previous,cancel_state,cancel_payment,cancel_units); RAISE EXCEPTION 'expired cancellation accepted';
 EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL; END;
 BEGIN CALL pliego.sp_admin_order_cancel(a,cancelled,cancel_id,cancel_previous,cancel_state,cancel_payment,cancel_units); RAISE EXCEPTION 'cancelled cancellation accepted';
 EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL; END;
 SELECT codigo INTO code FROM pliego.pedido_retiro WHERE pedido_id=ready;
 confirmation:=pliego.fn_order_fulfillment(ready,TRUE);
 SELECT d.fulfillment INTO view FROM pliego.fn_admin_order_detail(a,ready) d;
 IF view->'pickup' ? 'pickupCode' THEN RAISE EXCEPTION 'generic admin order detail exposed the customer pickup code'; END IF;
 SELECT d.fulfillment INTO view FROM pliego.fn_admin_order_detail_priced(a,ready) d;
 IF view->'pickup' ? 'pickupCode' THEN RAISE EXCEPTION 'priced admin order detail exposed the customer pickup code'; END IF;
 SELECT d.fulfillment INTO view FROM pliego.fn_customer_order_detail(u,ready) d;
 IF view->'pickup'->>'pickupCode' IS DISTINCT FROM code THEN
  RAISE EXCEPTION 'customer detail lost their pickup code'; END IF;
 IF pliego.fn_admin_pickup_detail(a,early)->>'state'<>'PENDING'
  OR pliego.fn_order_fulfillment(early,FALSE)->>'state'<>'PENDING' THEN
  RAISE EXCEPTION 'pickup ready before six-minute cancellation window finalized'; END IF;
 view:=pliego.fn_admin_pickup_detail(a,preparing);
 IF view->>'state'<>'PENDING'
  OR (SELECT finalizado_en IS NULL FROM pliego.pedido WHERE pedido_id=preparing) THEN
  RAISE EXCEPTION 'pickup not reconciled or marked ready before listo_desde'; END IF;
 view:=pliego.fn_admin_pickup_detail(a,ready);
 IF view->>'state'<>'READY' OR view->>'orderState'<>'PREPARING' OR view->>'paymentState'<>'APPROVED'
  OR view->>'orderReference' IS NULL OR view->'customer'->>'identityNumber'<>'1710034065'
  OR view->'customer'->>'identityType'<>'EC_CEDULA' OR view->'customer'->>'name'<>'Ana Pérez'
  OR jsonb_array_length(view->'items')<>1 OR view->'items'->0->>'format'<>'PAPERBACK'
  OR (view->>'unitCount')::INTEGER<>2 OR (view->>'total')::NUMERIC<>18.00
  OR view->'collectedBy'<>'null'::JSONB OR view->'identityVerified'<>'null'::JSONB
  OR jsonb_path_exists(view,'strict $.**.pickupCode') OR jsonb_path_exists(view,'strict $.**.codigo') THEN
  RAISE EXCEPTION 'code-free PickupView or registered full identity/printed items projection is incorrect: %',view; END IF;
 SELECT finalizado_en INTO finalization FROM pliego.pedido WHERE pedido_id=ready;
 PERFORM pliego.fn_admin_pickup_detail(a,ready);
 IF (SELECT finalizado_en FROM pliego.pedido WHERE pedido_id=ready) IS DISTINCT FROM finalization
  OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=ready AND estado_nuevo='PREPARING')<>1 THEN
  RAISE EXCEPTION 'read-through reconciliation duplicated lifecycle history'; END IF;
 IF pliego.fn_admin_pickup_lookup(a,lower(' p - '||substr(code,3,4)||' - '||substr(code,7))) IS DISTINCT FROM view
  OR pliego.fn_admin_pickup_lookup(a,lower(substr(code,3))) IS DISTINCT FROM view
  OR pliego.fn_admin_pickup_lookup(a,' 2 2-2 2 2a ')->>'orderId'<>legacy::TEXT THEN
  RAISE EXCEPTION 'normalized or legacy pickup code lookup failed'; END IF;

 BEGIN PERFORM pliego.fn_admin_pickup_lookup(a,'unknown'); RAISE EXCEPTION 'unknown pickup lookup accepted';
 EXCEPTION WHEN SQLSTATE 'P5016' THEN NULL; END;
 BEGIN PERFORM pliego.fn_admin_pickup_detail(a,no_pickup); RAISE EXCEPTION 'nonpickup detail accepted';
 EXCEPTION WHEN SQLSTATE 'P5016' THEN NULL; END;
 BEGIN PERFORM pliego.fn_admin_pickup_lookup(u,code); RAISE EXCEPTION 'customer lookup accepted';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 BEGIN PERFORM pliego.fn_admin_pickup_detail(u,ready); RAISE EXCEPTION 'customer detail accepted';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 BEGIN PERFORM * FROM pliego.fn_admin_pickups(u); RAISE EXCEPTION 'customer list accepted';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 BEGIN CALL pliego.sp_pickup_collect(u,ready,code,TRUE); RAISE EXCEPTION 'customer collection accepted';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 BEGIN CALL pliego.sp_pickup_collect(a,ready,code,FALSE); RAISE EXCEPTION 'unverified collection accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN CALL pliego.sp_pickup_collect(a,ready,code,NULL); RAISE EXCEPTION 'missing verification accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN CALL pliego.sp_pickup_collect(a,ready,'P-WRONG',TRUE); RAISE EXCEPTION 'wrong code accepted';
 EXCEPTION WHEN SQLSTATE 'P5013' THEN NULL; END;
 SELECT codigo INTO case_code FROM pliego.pedido_retiro WHERE pedido_id=early;
 BEGIN CALL pliego.sp_pickup_collect(a,early,case_code,TRUE);
  RAISE EXCEPTION 'pickup collection before cancellation cutoff accepted'; EXCEPTION WHEN SQLSTATE 'P5018' THEN NULL; END;
 SELECT codigo INTO case_code FROM pliego.pedido_retiro WHERE pedido_id=preparing;
 BEGIN CALL pliego.sp_pickup_collect(a,preparing,case_code,TRUE);
  RAISE EXCEPTION 'pickup collection before readyAt accepted'; EXCEPTION WHEN SQLSTATE 'P5018' THEN NULL; END;
 SELECT codigo INTO case_code FROM pliego.pedido_retiro WHERE pedido_id=cancelled;
 BEGIN CALL pliego.sp_pickup_collect(a,cancelled,case_code,TRUE);
  RAISE EXCEPTION 'cancelled collection accepted'; EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 SELECT codigo INTO case_code FROM pliego.pedido_retiro WHERE pedido_id=unpaid;
 BEGIN CALL pliego.sp_pickup_collect(a,unpaid,case_code,TRUE);
  RAISE EXCEPTION 'unpaid collection accepted'; EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 BEGIN CALL pliego.sp_pickup_collect(a,no_pickup,code,TRUE); RAISE EXCEPTION 'nonpickup collection accepted';
 EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;

 -- AC-4.3 AC-5.2 AC-6.2 AC-6.3: identity, single audit, duplicate and state guards.
 CALL pliego.sp_pickup_collect(a,ready,lower(substr(code,3)),TRUE);
 view:=pliego.fn_admin_pickup_detail(a,ready);
 IF view->>'state'<>'COLLECTED' OR view->>'orderState'<>'DELIVERED'
  OR view->'collectedBy'->>'userId'<>a::TEXT OR view->'collectedBy'->>'email'<>'verified-pickup-admin@example.invalid'
  OR view->>'identityVerified'<>'true' OR view->>'collectedAt' IS NULL
  OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=ready AND estado_nuevo='DELIVERED')<>1
  OR (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:'||ready||':STORE_PICKUP:COLLECTED')<>1 THEN
  RAISE EXCEPTION 'collection audit/history/outbox is not atomic and exactly once'; END IF;
 BEGIN CALL pliego.sp_pickup_collect(other_admin,ready,code,TRUE); RAISE EXCEPTION 'duplicate collection accepted';
 EXCEPTION WHEN SQLSTATE 'P5017' THEN NULL; END;
 IF pliego.fn_order_fulfillment(ready,TRUE) IS DISTINCT FROM confirmation THEN
  RAISE EXCEPTION 'collection mutated immutable checkout confirmation'; END IF;
 BEGIN UPDATE pliego.pedido_retiro SET retirado_por=other_admin WHERE pedido_id=ready;
  RAISE EXCEPTION 'collection actor overwritten'; EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 BEGIN UPDATE pliego.pedido_retiro SET fecha_retiro=clock_timestamp() WHERE pedido_id=ready;
  RAISE EXCEPTION 'collection timestamp overwritten'; EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 BEGIN UPDATE pliego.pedido_retiro SET identidad_verificada=FALSE WHERE pedido_id=ready;
  RAISE EXCEPTION 'verification overwritten'; EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 BEGIN UPDATE pliego.pedido_retiro SET retirado_por=a,identidad_verificada=TRUE WHERE pedido_id=early;
  RAISE EXCEPTION 'audit changed without collection'; EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 BEGIN UPDATE pliego.pedido_retiro SET fecha_retiro=clock_timestamp() WHERE pedido_id=early;
  RAISE EXCEPTION 'collection changed without audit'; EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 BEGIN UPDATE pliego.pedido_retiro SET codigo='P-ABCDEFGH' WHERE pedido_id=early;
  RAISE EXCEPTION 'immutable code overwritten'; EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;

 SELECT * INTO row_data FROM pliego.fn_admin_pickups(a,'READY',' ANA PEREZ ',0,1);
 IF row_data.pickup->>'orderId'<>ready2::TEXT OR row_data.total_count<>2 THEN
  RAISE EXCEPTION 'pickup READY ordering/count/filter incorrect: %',row_data; END IF;
 SELECT * INTO row_data FROM pliego.fn_admin_pickups(a,'READY',NULL,1,1);
 IF row_data.pickup->>'orderId'<>legacy::TEXT OR row_data.total_count<>2 THEN
  RAISE EXCEPTION 'pickup paging lost count or deterministic readyAt order'; END IF;
 SELECT * INTO row_data FROM pliego.fn_admin_pickups(a,NULL,lower(replace(view->>'orderReference','-',' ')),0,20);
 IF row_data.pickup IS DISTINCT FROM view OR row_data.total_count<>1 THEN
  RAISE EXCEPTION 'normalized order-reference search failed'; END IF;
 previous_state:='READY';
 FOR row_data IN SELECT * FROM pliego.fn_admin_pickups(a,NULL,'verified-pickup-customer',0,50) LOOP
  IF previous_state='PENDING' AND row_data.pickup->>'state'='READY' THEN RAISE EXCEPTION 'READY rows not first'; END IF;
  IF previous_state IN('COLLECTED','CANCELLED') AND row_data.pickup->>'state' IN('READY','PENDING') THEN
   RAISE EXCEPTION 'active pickups not first'; END IF;
  previous_state:=row_data.pickup->>'state';
 END LOOP;
 BEGIN PERFORM * FROM pliego.fn_admin_pickups(a,NULL,NULL,0,51); RAISE EXCEPTION 'page size > 50 accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN PERFORM * FROM pliego.fn_admin_pickups(a,'BROKEN'); RAISE EXCEPTION 'invalid state accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 IF EXISTS(SELECT FROM pliego.fn_admin_pickups(a,NULL,'does-not-match-anything',0,20)) THEN
  RAISE EXCEPTION 'empty pickup search returned results'; END IF;
 -- A payload may start with P. Optional-prefix handling must retain that first
 -- random character, while legacy seven-character payloads still resolve.
 legacy:=pg_temp.pickup_fixture(c,edition,INTERVAL '-1 minute',INTERVAL '-1 minute','P-P2345678');
 IF pliego.fn_admin_pickup_lookup(a,'p2 34-5678')->>'orderId'<>legacy::TEXT THEN
  RAISE EXCEPTION 'bare code starting with P lost a payload character'; END IF;
 legacy:=pg_temp.pickup_fixture(c,edition,INTERVAL '-1 minute',INTERVAL '-1 minute','P-2345679');
 IF pliego.fn_admin_pickup_lookup(a,' p - 234 5679 ')->>'orderId'<>legacy::TEXT THEN
  RAISE EXCEPTION 'legacy seven-character prefixed code did not resolve'; END IF;
 -- Pickups created before V055 have no cancellation-window metadata. Preserve
 -- their immutable snapshot and history while allowing an approved ready pickup.
 legacy:=pg_temp.pickup_fixture(c,edition,INTERVAL '-1 minute',INTERVAL '-1 minute');
 UPDATE pliego.pedido SET cancelacion_hasta=NULL WHERE pedido_id=legacy;
 view:=pliego.fn_admin_pickup_detail(a,legacy);
 IF view->>'state'<>'READY' OR view->>'orderState'<>'CONFIRMED'
  OR (SELECT finalizado_en IS NOT NULL FROM pliego.pedido WHERE pedido_id=legacy) THEN
  RAISE EXCEPTION 'legacy pickup without cancellation metadata must become READY without invented finalization'; END IF;
 SELECT codigo INTO case_code FROM pliego.pedido_retiro WHERE pedido_id=legacy;
 CALL pliego.sp_pickup_collect(a,legacy,case_code,TRUE);
 view:=pliego.fn_admin_pickup_detail(a,legacy);
 IF view->>'state'<>'COLLECTED' OR view->'collectedBy'->>'userId'<>a::TEXT
  OR view->>'identityVerified'<>'true' OR view->>'collectedAt' IS NULL THEN
  RAISE EXCEPTION 'legacy pickup without cancellation metadata cannot collect with audit'; END IF;
 legacy:=pg_temp.pickup_fixture(c,edition,INTERVAL '20 minutes',INTERVAL '-1 minute');
 UPDATE pliego.pedido SET cancelacion_hasta=NULL WHERE pedido_id=legacy;
 IF pliego.fn_admin_pickup_detail(a,legacy)->>'state'<>'PENDING' THEN
  RAISE EXCEPTION 'legacy pickup marked READY before its immutable readyAt'; END IF;
 SELECT codigo INTO case_code FROM pliego.pedido_retiro WHERE pedido_id=legacy;
 BEGIN CALL pliego.sp_pickup_collect(a,legacy,case_code,TRUE);
  RAISE EXCEPTION 'legacy pickup collection before readyAt accepted'; EXCEPTION WHEN SQLSTATE 'P5018' THEN NULL; END;
END $gate$;
ROLLBACK;
