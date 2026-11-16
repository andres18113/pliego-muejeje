-- Real business mutations must produce durable, scoped invalidation hints.
-- Synthetic fn_realtime_enqueue calls are covered separately. All fixtures roll back.
BEGIN;
DO $gate$
DECLARE admin BIGINT; actor BIGINT; customer BIGINT; state VARCHAR; author_id BIGINT; publisher_id BIGINT;
 category_id BIGINT; book BIGINT; edition BIGINT; physical BIGINT; movement BIGINT; stock_before INTEGER; stock_after INTEGER;
 request_id BIGINT; decided TIMESTAMPTZ; decided_by BIGINT; reason TEXT;
 cart BIGINT; item BIGINT; quantity INTEGER; purchase BIGINT; old_purchase BIGINT; owned BIGINT;
 order_state VARCHAR; payment_state VARCHAR; total NUMERIC; reference VARCHAR; cancelled BIGINT; previous VARCHAR; restored BIGINT;
 anchor TIMESTAMPTZ:=clock_timestamp()-INTERVAL '11 minutes'; location pliego.ubicacion_retiro%ROWTYPE; pickup BIGINT;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('realtime-resource-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO admin;
 CALL pliego.sp_customer_register('realtime-resource-owner@example.invalid','fixture','Cliente','Eventos',NULL,actor,customer,state);
 CALL pliego.sp_customer_billing_identity_register(actor,'EC_CEDULA','0912345675');
 INSERT INTO pliego.cliente_identificacion_solicitud_correccion(cliente_id,tipo_actual,numero_actual,
  tipo_propuesto,numero_propuesto,codigo_motivo,estado,clave_idempotencia,huella_payload)
 VALUES(customer,'EC_CEDULA','0912345675','EC_CEDULA','1710034065','DOCUMENT_TYPO','PENDING',uuidv4(),repeat('d',64))
 RETURNING solicitud_id INTO request_id;
 IF (SELECT count(*) FROM pliego.realtime_event WHERE resource_id=request_id::TEXT AND resource_type='billingIdentity'
  AND event_name='identity.correction.created' AND user_id=actor AND NOT admin_scope)<>1
  OR (SELECT count(*) FROM pliego.realtime_event WHERE resource_id=request_id::TEXT AND resource_type='billingIdentity'
  AND event_name='identity.correction.created' AND user_id IS NULL AND admin_scope)<>1 THEN
  RAISE EXCEPTION 'correction creation did not invalidate owner and administrative queue'; END IF;
 CALL pliego.sp_admin_billing_identity_correction_decide(admin,request_id,'REJECT','No permite confirmar el cambio.',state,decided,decided_by,reason);
 CALL pliego.sp_customer_billing_identity_correction_request_acknowledge(actor,request_id);
 CALL pliego.sp_customer_billing_identity_correction_request_acknowledge(actor,request_id);
 IF (SELECT count(*) FROM pliego.realtime_event WHERE resource_id=request_id::TEXT AND resource_type='billingIdentity'
  AND event_name='identity.correction.decided')<>2
  OR (SELECT count(*) FROM pliego.realtime_event WHERE resource_id=request_id::TEXT AND resource_type='billingIdentity'
  AND event_name='identity.correction.acknowledged' AND user_id=actor AND NOT admin_scope)<>1
  OR EXISTS(SELECT FROM pliego.realtime_event WHERE event_name='identity.correction.acknowledged' AND admin_scope) THEN
  RAISE EXCEPTION 'decision/ack scope or acknowledgment replay emitted duplicate hints'; END IF;
 BEGIN
  INSERT INTO pliego.cliente_identificacion_solicitud_correccion(cliente_id,tipo_actual,numero_actual,
   tipo_propuesto,numero_propuesto,codigo_motivo,estado,clave_idempotencia,huella_payload)
  VALUES(customer,'EC_CEDULA','0912345675','EC_CEDULA','1710034065','DOCUMENT_TYPO','PENDING',uuidv4(),repeat('e',64))
  RETURNING solicitud_id INTO request_id;
  CALL pliego.sp_admin_billing_identity_correction_decide(admin,request_id,'APPROVE',NULL,state,decided,decided_by,reason);
  RAISE EXCEPTION USING ERRCODE='Z1040',MESSAGE='rollback business mutation';
 EXCEPTION WHEN SQLSTATE 'Z1040' THEN NULL; END;
 IF EXISTS(SELECT FROM pliego.realtime_event WHERE resource_type='billingIdentity' AND resource_id=request_id::TEXT)
  OR EXISTS(SELECT FROM pliego.correo_outbox WHERE tipo='BILLING_IDENTITY_DECIDED' AND datos->>'requestId'=request_id::TEXT) THEN
  RAISE EXCEPTION 'rolled-back decision escaped into durable hints or notification outbox'; END IF;

 CALL pliego.sp_author_create(admin,'Autora Eventos',NULL,author_id);
 CALL pliego.sp_publisher_create(admin,'Editorial Eventos',NULL,publisher_id);
 CALL pliego.sp_category_create(admin,'Eventos','realtime-resource-gate',NULL,NULL,category_id);
 CALL pliego.sp_book_create(admin,'Libro Eventos',NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category_id),book);
 CALL pliego.sp_edition_create(admin,book,publisher_id,'REALTIME-RESOURCE-EBOOK',NULL,'es','EBOOK',100,NULL,7.25,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],edition);
 CALL pliego.sp_edition_create(admin,book,publisher_id,'REALTIME-RESOURCE-PAPER',NULL,'es','PAPERBACK',100,NULL,7.25,NULL,NULL,NULL,NULL,physical);
 CALL pliego.sp_inventory_entry(admin,physical,10,'fixture',movement,stock_before,stock_after);
 CALL pliego.sp_cart_add_item(actor,edition,1,cart,item,quantity);
 CALL pliego.sp_checkout(actor,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,purchase,order_state,payment_state,total,reference);
 SELECT owned_item_id INTO owned FROM pliego.digital_ownership WHERE cliente_id=customer AND edicion_id=edition;
 IF (SELECT count(*) FROM pliego.realtime_event WHERE event_name='library.changed' AND resource_id=owned::TEXT AND user_id=actor AND NOT admin_scope)<>1
  OR NOT EXISTS(SELECT FROM pliego.realtime_event WHERE event_name='order.changed' AND resource_id=purchase::TEXT AND user_id=actor AND NOT admin_scope)
  OR NOT EXISTS(SELECT FROM pliego.realtime_event WHERE event_name='order.changed' AND resource_id=purchase::TEXT AND admin_scope) THEN
  RAISE EXCEPTION 'purchase did not invalidate owner library and owner/admin order'; END IF;
 old_purchase:=purchase;
 CALL pliego.sp_order_cancel(actor,purchase,cancelled,previous,order_state,payment_state,restored);
 IF (SELECT count(*) FROM pliego.realtime_event WHERE event_name='library.changed' AND resource_id=owned::TEXT AND user_id=actor)<>2 THEN
  RAISE EXCEPTION 'revocation did not invalidate library'; END IF;
 CALL pliego.sp_cart_add_item(actor,edition,1,cart,item,quantity);
 CALL pliego.sp_checkout(actor,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,purchase,order_state,payment_state,total,reference);
 IF (SELECT count(*) FROM pliego.realtime_event WHERE event_name='library.changed' AND resource_id=owned::TEXT AND user_id=actor)<>3 THEN
  RAISE EXCEPTION 'reacquisition did not invalidate retained library identity'; END IF;
 UPDATE pliego.pedido SET cancelacion_hasta=clock_timestamp()-INTERVAL '1 second' WHERE pedido_id=purchase;
 CALL pliego.sp_home_delivery_advance_due(100);
 CALL pliego.sp_home_delivery_advance_due(100);
 IF (SELECT count(*) FROM pliego.realtime_event WHERE event_name='order.cancellation-window.expired' AND resource_id=purchase::TEXT AND user_id=actor AND NOT admin_scope)<>1
  OR (SELECT count(*) FROM pliego.realtime_event WHERE event_name='order.cancellation-window.expired' AND resource_id=purchase::TEXT AND admin_scope)<>1 THEN
  RAISE EXCEPTION 'database-owned deadline did not emit exactly one owner/admin invalidation'; END IF;

 -- Use an aged approval as the timing gate does; the production readiness routine
 -- owns every transition and emits the real durable READY notification.
 SELECT * INTO location FROM pliego.ubicacion_retiro ORDER BY ubicacion_retiro_id LIMIT 1;
 INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total) VALUES(customer,'PENDING_PAYMENT',7.25,7.25) RETURNING pedido_id INTO pickup;
 INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,
  formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
 SELECT pickup,edicion_id,sku,'Libro eventos','Autora','Editorial',formato,idioma,precio,1,precio FROM pliego.edicion WHERE edicion_id=physical;
 SELECT stock_actual INTO stock_before FROM pliego.inventario WHERE edicion_id=physical FOR UPDATE;
 UPDATE pliego.inventario SET stock_actual=stock_before-1 WHERE edicion_id=physical;
 INSERT INTO pliego.movimiento_inventario(edicion_id,pedido_id,tipo,cantidad,stock_anterior,stock_posterior)
 VALUES(physical,pickup,'SALE',1,stock_before,stock_before-1);
 INSERT INTO pliego.pago(pedido_id,metodo,estado,monto,referencia,fecha_aprobacion)
 VALUES(pickup,'CARD','APPROVED',7.25,pliego.fn_generate_payment_reference(),anchor);
 UPDATE pliego.pedido SET estado='CONFIRMED' WHERE pedido_id=pickup;
 INSERT INTO pliego.pedido_entrega(pedido_id,metodo) VALUES(pickup,'STORE_PICKUP');
 INSERT INTO pliego.pedido_retiro(pedido_id,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,
  codigo_postal,latitud,longitud,zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,codigo,programacion_version)
 VALUES(pickup,location.ubicacion_retiro_id,location.nombre,location.direccion,location.ciudad,location.provincia,location.pais_codigo,
  location.codigo_postal,location.latitud,location.longitud,'UTC',
  (clock_timestamp() AT TIME ZONE 'UTC')::TIME-INTERVAL '1 hour',(clock_timestamp() AT TIME ZONE 'UTC')::TIME+INTERVAL '1 hour',
  10,anchor,anchor+INTERVAL '10 minutes',pliego.fn_generate_pickup_code(),1);
 CALL pliego.sp_home_delivery_advance_due(100);
 CALL pliego.sp_home_delivery_advance_due(100);
 IF (SELECT count(*) FROM pliego.realtime_event WHERE event_name='pickup.ready' AND resource_id=pickup::TEXT AND user_id=actor AND NOT admin_scope)<>1
  OR (SELECT count(*) FROM pliego.realtime_event WHERE event_name='pickup.ready' AND resource_id=pickup::TEXT AND admin_scope)<>1 THEN
  RAISE EXCEPTION 'actual READY outbox did not invalidate owner/admin exactly once'; END IF;
 IF EXISTS(SELECT FROM pliego.realtime_event WHERE resource_type='library' AND admin_scope)
  OR EXISTS(SELECT FROM pliego.realtime_event WHERE user_id=actor AND admin_scope)
  OR EXISTS(SELECT FROM pliego.realtime_event WHERE user_id=actor AND
   (resource_id !~ '^[1-9][0-9]*$' OR event_name LIKE '%1710034065%' OR resource_type NOT IN('order','library','billingIdentity'))) THEN
  RAISE EXCEPTION 'private hints leaked administrative scope or noncanonical payload'; END IF;
END; $gate$;
DO $session_expiry$
DECLARE actor BIGINT; customer BIGINT; user_state VARCHAR; connection UUID:=uuidv4();
 hash VARCHAR:=repeat('4',64); result JSONB; invalid_limit INTEGER;
BEGIN
 CALL pliego.sp_customer_register('realtime-expired-session@example.invalid','fixture','Cliente','Vencido',NULL,actor,customer,user_state);
 UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id=actor;
 IF NOT pliego.fn_auth_session_create_checked(actor,hash,clock_timestamp()+INTERVAL '1 day','fixture') THEN
  RAISE EXCEPTION 'expiry fixture did not create a valid authenticated family'; END IF;
 result:=pliego.fn_realtime_connect(hash,connection);
 IF result->>'state'<>'CONNECTED' OR pliego.fn_realtime_read(connection,NULL)->>'state'<>'OPEN' THEN
  RAISE EXCEPTION 'valid session could not open before expiry'; END IF;
 -- Backdate the complete historical interval to respect the established session
 -- creation/expiry/renewal constraints while reproducing absolute expiry.
 UPDATE pliego.sesion_autenticacion SET fecha_creacion=clock_timestamp()-INTERVAL '2 days',
  fecha_renovacion=clock_timestamp()-INTERVAL '2 days',fecha_expiracion=clock_timestamp()-INTERVAL '1 day'
 WHERE token_refresco_hash=hash;
 IF pliego.fn_realtime_read(connection,0)->>'state'<>'CLOSED'
  OR pliego.fn_realtime_connect(hash,uuidv4())->>'state'<>'UNAUTHORIZED' THEN
  RAISE EXCEPTION 'expired authentication family retained stream access or reconnected'; END IF;
 FOREACH invalid_limit IN ARRAY ARRAY[NULL,0,1001]::INTEGER[] LOOP
  BEGIN
   PERFORM pliego.fn_realtime_publish(invalid_limit);
   RAISE EXCEPTION 'invalid publisher limit accepted: %',invalid_limit;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 END LOOP;
END; $session_expiry$;
ROLLBACK;
\echo 'Realtime real-resource gate passed: owner/admin scopes, decision/ack rollback/idempotency, grant revocation/reacquisition, deadline expiry, actual READY, absolute session expiry and bounded publisher inputs.'
