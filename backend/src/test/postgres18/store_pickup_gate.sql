-- PostgreSQL18 behavior assertions; fixtures and all effects roll back.
BEGIN;
DO $gate$
DECLARE
 a BIGINT; u BIGINT; customer BIGINT; address_id BIGINT; author_id BIGINT; pub BIGINT; cat BIGINT; book BIGINT;
 edition BIGINT; digital BIGINT; movement BIGINT; before_stock INTEGER; after_stock INTEGER;
 cart BIGINT; item BIGINT; qty INTEGER; pickup BIGINT; other_location BIGINT;
 o BIGINT; replay BIGINT; home BIGINT; cancelled BIGINT; state VARCHAR; pay VARCHAR; total NUMERIC; ref VARCHAR;
 key UUID:=uuidv4(); invalid_key UUID:=uuidv4(); d RECORD; snapshot JSONB; confirmation JSONB;
 previous VARCHAR; restored BIGINT; code VARCHAR; first_code VARCHAR;
BEGIN
 SELECT pickup_location_id INTO pickup FROM pliego.fn_pickup_locations() WHERE name LIKE '%PUCE%';
 IF pickup IS NULL THEN RAISE EXCEPTION 'RED: active real pickup location not listed'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_pickup_locations() WHERE pickup_location_id=pickup
  AND latitude=-0.210000 AND longitude=-78.491400 AND timezone='America/Guayaquil'
  AND opens_at='09:00'::TIME AND closes_at='17:00'::TIME AND preparation_minutes=25)
 THEN RAISE EXCEPTION 'location contract not typed or seed incorrect'; END IF;
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('pickup-gate-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
 CALL pliego.sp_author_create(a,'Autora Pickup',NULL,author_id);
 CALL pliego.sp_publisher_create(a,'Editorial Pickup',NULL,pub);
 CALL pliego.sp_category_create(a,'Pickup','pickup-gate',NULL,NULL,cat);
 CALL pliego.sp_book_create(a,'Libro pickup',NULL,NULL,jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(cat),book);
 CALL pliego.sp_edition_create(a,book,pub,'PICKUP-GATE',NULL,'es','PAPERBACK',100,NULL,7.25,NULL,NULL,NULL,NULL,edition);
 CALL pliego.sp_inventory_entry(a,edition,20,'fixture',movement,before_stock,after_stock);
 CALL pliego.sp_customer_register('pickup-gate-customer@example.invalid','fixture','Ana','Pérez',NULL,u,customer,state);
 CALL pliego.sp_address_create(u,'Casa','Ana Pérez','Calle cliente',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,address_id);
 CALL pliego.sp_cart_add_item(u,edition,1,cart,item,qty);
 BEGIN
  CALL pliego.sp_checkout_idempotent(u,invalid_key,NULL,'TRANSFER','APPROVED',cart,'HOME_DELIVERY',NULL,o,state,pay,total,ref);
  RAISE EXCEPTION 'missing home address accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_checkout_idempotent(u,invalid_key,address_id,'TRANSFER','APPROVED',cart,'STORE_PICKUP',pickup,o,state,pay,total,ref);
  RAISE EXCEPTION 'both address and location accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_checkout_idempotent(u,invalid_key,address_id,'TRANSFER','APPROVED',cart,'HOME_DELIVERY',pickup,o,state,pay,total,ref);
  RAISE EXCEPTION 'home accepted pickup location';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_checkout_idempotent(u,invalid_key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',NULL,o,state,pay,total,ref);
  RAISE EXCEPTION 'missing pickup location accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_checkout_idempotent(u,invalid_key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',9223372036854775807,o,state,pay,total,ref);
  RAISE EXCEPTION 'unknown pickup location accepted';
 EXCEPTION WHEN SQLSTATE 'P5010' THEN NULL; END;
 UPDATE pliego.ubicacion_retiro SET activo=FALSE WHERE ubicacion_retiro_id=pickup;
 IF EXISTS(SELECT FROM pliego.fn_pickup_locations() WHERE pickup_location_id=pickup) THEN RAISE EXCEPTION 'inactive location listed'; END IF;
 BEGIN
  CALL pliego.sp_checkout_idempotent(u,invalid_key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',pickup,o,state,pay,total,ref);
  RAISE EXCEPTION 'inactive pickup accepted';
 EXCEPTION WHEN SQLSTATE 'P5011' THEN NULL; END;
 UPDATE pliego.ubicacion_retiro SET activo=TRUE WHERE ubicacion_retiro_id=pickup;
 CALL pliego.sp_checkout_idempotent(u,key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',pickup,o,state,pay,total,ref);
 IF state<>'CONFIRMED' OR pay<>'APPROVED' THEN RAISE EXCEPTION 'valid pickup not confirmed'; END IF;
 SELECT * INTO d FROM pliego.fn_customer_order_detail(u,o);
 IF d.fulfillment->>'method'<>'STORE_PICKUP' OR d.shipment IS NOT NULL OR d.address IS NOT NULL
 OR EXISTS(SELECT FROM pliego.envio WHERE pedido_id=o) OR EXISTS(SELECT FROM pliego.pedido_direccion WHERE pedido_id=o)
 THEN RAISE EXCEPTION 'pickup created fictitious shipping/contact'; END IF;
 snapshot:=d.fulfillment; confirmation:=pliego.fn_order_fulfillment(o,TRUE);
 code:=snapshot->'pickup'->>'pickupCode'; first_code:=code;
 IF code !~ '^P-[2-9A-HJ-NP-Z]{6,8}$' THEN RAISE EXCEPTION 'pickup code not human friendly'; END IF;
 IF (snapshot->'pickup'->>'readyAt')::TIMESTAMPTZ-(snapshot->'pickup'->>'estimatedAt')::TIMESTAMPTZ<>INTERVAL '25 minutes'
 OR (snapshot->'pickup'->>'estimatedAt')::TIMESTAMPTZ>clock_timestamp()
 OR snapshot->'pickup'->'location'->>'timezone'<>'America/Guayaquil'
 THEN RAISE EXCEPTION 'readyAt not authoritative, timezone missing'; END IF;
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)<>1
 OR (SELECT datos->'pickup' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o) IS DISTINCT FROM snapshot->'pickup'
 THEN RAISE EXCEPTION 'pickup confirmation not atomic or wrong snapshot'; END IF;
 CALL pliego.sp_pickup_location_update(a,pickup,'Nombre editado','Nueva dirección','Otra ciudad','Otra provincia','EC','170525',1,2,
  'UTC','10:00'::TIME,'16:00'::TIME,FALSE,45);
 SELECT * INTO d FROM pliego.fn_customer_order_detail(u,o);
 IF d.fulfillment IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'location edit changed history'; END IF;
 CALL pliego.sp_checkout_idempotent(u,key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',pickup,replay,state,pay,total,ref);
 IF replay<>o OR pliego.fn_order_fulfillment(replay,TRUE) IS DISTINCT FROM confirmation THEN RAISE EXCEPTION 'replay changed receipt'; END IF;
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)<>1 THEN RAISE EXCEPTION 'replay duplicated mail'; END IF;
 BEGIN
  CALL pliego.sp_checkout_idempotent(u,key,address_id,'TRANSFER','APPROVED',cart,'HOME_DELIVERY',NULL,replay,state,pay,total,ref);
  RAISE EXCEPTION 'fulfillment changed under same idempotency key';
 EXCEPTION WHEN SQLSTATE 'P1010' THEN NULL; END;
 BEGIN
  UPDATE pliego.pedido_retiro SET nombre='corrupt' WHERE pedido_id=o;
  RAISE EXCEPTION 'pickup snapshot mutable';
 EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 BEGIN
  CALL pliego.sp_shipment_transition(a,o,'PREPARING');
  RAISE EXCEPTION 'pickup carrier transition accepted';
 EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 BEGIN
  CALL pliego.sp_order_change_status(a,o,'PREPARING',replay,previous,state);
  RAISE EXCEPTION 'legacy admin transition bypassed pickup collection';
 EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 BEGIN
  CALL pliego.sp_pickup_collect(a,o,'P-WRONG');
  RAISE EXCEPTION 'wrong code accepted';
 EXCEPTION WHEN SQLSTATE 'P5013' THEN NULL; END;
 CALL pliego.sp_pickup_collect(a,o,code);
 CALL pliego.sp_pickup_collect(a,o,code);
 SELECT * INTO d FROM pliego.fn_customer_order_detail(u,o);
 IF d.order_state<>'DELIVERED' OR d.fulfillment->>'state'<>'COLLECTED' OR d.fulfillment->>'collectedAt' IS NULL
 OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=o AND estado_nuevo='DELIVERED')<>1
 THEN RAISE EXCEPTION 'collection not idempotent or not terminal'; END IF;
 IF pliego.fn_order_fulfillment(o,TRUE) IS DISTINCT FROM confirmation THEN RAISE EXCEPTION 'collection changed checkout confirmation'; END IF;
 BEGIN
  CALL pliego.sp_order_cancel(u,o,replay,previous,state,pay,restored);
  RAISE EXCEPTION 'collected pickup cancelled';
 EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL; END;
 -- Existing HOME_DELIVERY still works with the legacy SQL signature.
 CALL pliego.sp_cart_add_item(u,edition,1,cart,item,qty);
 CALL pliego.sp_checkout_idempotent(u,uuidv4(),address_id,'CARD','APPROVED',cart,home,state,pay,total,ref);
 SELECT * INTO d FROM pliego.fn_customer_order_detail(u,home);
 IF d.fulfillment->>'method'<>'HOME_DELIVERY' OR d.shipment->>'state'<>'PREPARING' OR d.address IS NULL THEN RAISE EXCEPTION 'legacy home regression'; END IF;
 -- Another store is legal; rejected pickup is cancelled, no notification/stock decrement.
 INSERT INTO pliego.ubicacion_retiro(nombre,direccion,ciudad,provincia,pais_codigo,latitud,longitud,zona_horaria,apertura,cierre)
 VALUES('Segundo punto','Otra dirección','Quito','Pichincha','EC',0,0,'America/Guayaquil','09:00','17:00') RETURNING ubicacion_retiro_id INTO other_location;
 CALL pliego.sp_cart_add_item(u,edition,1,cart,item,qty);
 CALL pliego.sp_checkout_idempotent(u,uuidv4(),NULL,'CARD','REJECTED',cart,'STORE_PICKUP',other_location,cancelled,state,pay,total,ref);
 SELECT * INTO d FROM pliego.fn_customer_order_detail(u,cancelled);
 IF state<>'CANCELLED' OR d.fulfillment->>'state'<>'CANCELLED' OR d.shipment IS NOT NULL THEN RAISE EXCEPTION 'rejected pickup not cancelled'; END IF;
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||cancelled) THEN RAISE EXCEPTION 'rejected pickup mailed'; END IF;
 -- Rejected payment leaves cart active: same item can later succeed under a new key.
 CALL pliego.sp_checkout_idempotent(u,uuidv4(),NULL,'CARD','APPROVED',cart,'STORE_PICKUP',other_location,replay,state,pay,total,ref);
 IF (SELECT codigo FROM pliego.pedido_retiro WHERE pedido_id=replay)=first_code THEN RAISE EXCEPTION 'pickup code repeated'; END IF;
 CALL pliego.sp_order_cancel(u,replay,home,previous,state,pay,restored);
 IF pliego.fn_order_fulfillment(replay,FALSE)->>'state'<>'CANCELLED' THEN RAISE EXCEPTION 'pickup cancellation not projected'; END IF;
 -- Digital-only cannot invent physical pickup; mixed cart can.
 CALL pliego.sp_edition_create(a,book,pub,'PICKUP-DIGITAL',NULL,'es','EBOOK',NULL,NULL,5.00,NULL,NULL,NULL,NULL,digital);
 CALL pliego.sp_cart_add_item(u,digital,1,cart,item,qty);
 BEGIN
  CALL pliego.sp_checkout_idempotent(u,uuidv4(),NULL,'CARD','APPROVED',cart,'STORE_PICKUP',other_location,replay,state,pay,total,ref);
  RAISE EXCEPTION 'digital-only pickup accepted';
 EXCEPTION WHEN SQLSTATE 'P5012' THEN NULL; END;
 CALL pliego.sp_cart_add_item(u,edition,1,cart,item,qty);
 CALL pliego.sp_checkout_idempotent(u,uuidv4(),NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',other_location,replay,state,pay,total,ref);
 IF (SELECT count(*) FROM pliego.pedido_item WHERE pedido_id=replay)<>2 OR EXISTS(SELECT FROM pliego.envio WHERE pedido_id=replay) THEN RAISE EXCEPTION 'mixed pickup incorrect'; END IF;
END $gate$;
ROLLBACK;
