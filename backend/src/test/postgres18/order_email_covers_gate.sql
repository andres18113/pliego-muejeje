-- Disposable PostgreSQL 18 only. Real checkout/lifecycle payloads; all effects roll back.
\set ON_ERROR_STOP on
BEGIN;
CREATE PROCEDURE pg_temp.assert_mail_covers(p_order BIGINT, p_kind TEXT, p_state TEXT)
LANGUAGE plpgsql AS $$
DECLARE payload JSONB;
BEGIN
 SELECT datos INTO STRICT payload FROM pliego.correo_outbox
 WHERE datos->>'orderId'=p_order::TEXT AND tipo=p_kind AND datos->>'state'=p_state;
 IF jsonb_array_length(payload->'items')<>(SELECT count(*) FROM pliego.pedido_item WHERE pedido_id=p_order)
 OR EXISTS(SELECT FROM jsonb_array_elements(payload->'items') m
   LEFT JOIN pliego.pedido_item i ON i.pedido_item_id::TEXT=m->>'orderItemId' AND i.pedido_id=p_order
   LEFT JOIN pliego.edicion e USING(edicion_id)
   WHERE NOT (m ? 'coverUrl') OR m->>'coverUrl' IS DISTINCT FROM e.portada_url)
 THEN RAISE EXCEPTION 'Missing/wrong edition cover in % / % / %',p_order,p_kind,p_state; END IF;
END; $$;

DO $gate$
DECLARE
 admin_id BIGINT; actor BIGINT; customer BIGINT; author_id BIGINT; publisher BIGINT; category BIGINT; book BIGINT;
 physical BIGINT; digital BIGINT; cart BIGINT; cart_item BIGINT; quantity INTEGER; location BIGINT; address_id BIGINT;
 movement BIGINT; before_stock INTEGER; after_stock INTEGER;
 home BIGINT; pickup BIGINT; digital_order BIGINT; cancelled BIGINT; order_result BIGINT;
 state VARCHAR; payment VARCHAR; reference VARCHAR; previous VARCHAR; total NUMERIC; restored BIGINT;
 cover TEXT:='https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000390-d2c065f3dcad.webp';
 digital_cover TEXT:='https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000057-be83a24f55ad.webp';
 unsafe TEXT; snapshot JSONB; confirmation JSONB; pickup_code VARCHAR;
BEGIN
 SELECT usuario_id INTO admin_id FROM pliego.usuario WHERE rol='ADMIN' LIMIT 1;
 CALL pliego.sp_author_create(admin_id,'Autora email covers',NULL,author_id);
 CALL pliego.sp_publisher_create(admin_id,'Editorial email covers',NULL,publisher);
 CALL pliego.sp_category_create(admin_id,'Email covers','email-covers-gate',NULL,NULL,category);
 CALL pliego.sp_book_create(admin_id,'Portadas del pedido',NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category),book);
 CALL pliego.sp_edition_create(admin_id,book,publisher,'EMAIL-COVER-PRINT',NULL,'es','PAPERBACK',100,NULL,
  17.95,cover,NULL,NULL,NULL,physical);
 CALL pliego.sp_edition_create(admin_id,book,publisher,'EMAIL-COVER-EBOOK',NULL,'es','EBOOK',NULL,NULL,
  12.00,digital_cover,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],digital);
 CALL pliego.sp_inventory_entry(admin_id,physical,20,'email covers fixture',movement,before_stock,after_stock);
 CALL pliego.sp_customer_register('email-covers-gate@example.invalid','fixture','Ana','Pérez',NULL,actor,customer,state);
 CALL pliego.sp_address_create(actor,'Casa','Ana Pérez','Calle cliente',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,address_id);
 SELECT pickup_location_id INTO location FROM pliego.fn_pickup_locations() LIMIT 1;

 -- Home delivery and mixed digital/printed items use the edition relation, not a SKU guess.
 CALL pliego.sp_cart_add_item(actor,physical,2,cart,cart_item,quantity);
 CALL pliego.sp_cart_add_item(actor,digital,1,cart,cart_item,quantity);
 CALL pliego.sp_checkout_idempotent(actor,uuidv4(),address_id,'TRANSFER','APPROVED',cart,'HOME_DELIVERY',NULL,home,state,payment,total,reference);
 CALL pg_temp.assert_mail_covers(home,'ORDER_CONFIRMED','CONFIRMED');
 CALL pg_temp.assert_mail_covers(home,'ORDER_STATUS','PREPARING');
 SELECT datos INTO confirmation FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||home;
 IF confirmation->>'orderReference' IS NULL OR confirmation->'items'->0->>'quantity'<>'2' THEN
  RAISE EXCEPTION 'Reference or item order/quantity lost'; END IF;

 -- The current edition cover is captured at event creation; past messages never change.
 UPDATE pliego.edicion SET portada_url=digital_cover WHERE edicion_id=physical;
 snapshot:=pliego.fn_order_mail_snapshot(home,'HOME_DELIVERY','IN_TRANSIT',clock_timestamp(),FALSE);
 IF snapshot->'items'->0->>'coverUrl' IS DISTINCT FROM digital_cover
 OR (SELECT datos FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||home) IS DISTINCT FROM confirmation
 THEN RAISE EXCEPTION 'Current cover not captured or queued snapshot mutated'; END IF;

 -- Both SQL and Java must reject private/unsigned paths even when catalog metadata contains them.
 FOREACH unsafe IN ARRAY ARRAY[
  NULL,'','http://covers.pliegolibros.com/covers/editions/v2/book.webp',
  '//covers.pliegolibros.com/covers/editions/v2/book.webp','/orders/42/invoice','invoices/secret.pdf',
  'https://private.r2.cloudflarestorage.com/invoices/secret.pdf?X-Amz-Signature=secret',
  'https://private.r2.dev/invoices/secret.pdf','https://pliegolibros.com/orders/42/invoice',
  'https://covers.pliegolibros.com/invoices/secret.webp',cover||'?X-Amz-Signature=secret',cover||'#secret',
  'https://covers.pliegolibros.com.evil.test/covers/editions/v2/book.webp',
  'https://covers.pliegolibros.com/covers/editions/../invoices/secret.webp',
  'https://covers.pliegolibros.com/covers/editions/v2/%2e%2e/secret.webp',cover||E'\n'] LOOP
  UPDATE pliego.edicion SET portada_url=unsafe WHERE edicion_id=physical;
  snapshot:=pliego.fn_order_mail_snapshot(home,'HOME_DELIVERY','PREPARING',NULL,FALSE);
  IF NOT (snapshot->'items'->0 ? 'coverUrl') OR snapshot->'items'->0->>'coverUrl' IS NOT NULL
  OR jsonb_array_length(snapshot->'items')<>2 OR snapshot->'items'->1->>'coverUrl' IS DISTINCT FROM digital_cover
  THEN RAISE EXCEPTION 'Unsafe/missing cover leaked or item lost: %',unsafe; END IF;
 END LOOP;
 UPDATE pliego.edicion SET portada_url=cover WHERE edicion_id=physical;

 UPDATE pliego.envio SET fecha_confirmacion=clock_timestamp()-INTERVAL '10 minutes',
  transito_desde=clock_timestamp()-INTERVAL '8 minutes',reparto_desde=clock_timestamp()-INTERVAL '6 minutes',
  entrega_desde=clock_timestamp()-INTERVAL '4 minutes' WHERE pedido_id=home;
 CALL pliego.sp_home_delivery_advance_due(100);
 CALL pg_temp.assert_mail_covers(home,'ORDER_STATUS','IN_TRANSIT');
 CALL pg_temp.assert_mail_covers(home,'ORDER_STATUS','OUT_FOR_DELIVERY');
 CALL pg_temp.assert_mail_covers(home,'ORDER_STATUS','DELIVERED');

 CALL pliego.sp_cart_add_item(actor,physical,1,cart,cart_item,quantity);
 CALL pliego.sp_checkout_idempotent(actor,uuidv4(),NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',location,pickup,state,payment,total,reference);
 CALL pg_temp.assert_mail_covers(pickup,'ORDER_CONFIRMED','CONFIRMED');
 ALTER TABLE pliego.pedido_retiro DISABLE TRIGGER trg_pedido_retiro_snapshot;
 UPDATE pliego.pedido_retiro SET estimado_desde=estimado_desde-INTERVAL '1 day',listo_desde=listo_desde-INTERVAL '1 day' WHERE pedido_id=pickup;
 ALTER TABLE pliego.pedido_retiro ENABLE TRIGGER trg_pedido_retiro_snapshot;
 UPDATE pliego.pedido SET cancelacion_hasta=clock_timestamp()-INTERVAL '1 second' WHERE pedido_id=pickup;
 CALL pliego.sp_home_delivery_advance_due(100);
 CALL pg_temp.assert_mail_covers(pickup,'ORDER_STATUS','PREPARING');
 SELECT codigo INTO pickup_code FROM pliego.pedido_retiro WHERE pedido_id=pickup;
 CALL pliego.sp_pickup_collect(admin_id,pickup,pickup_code,TRUE);
 CALL pg_temp.assert_mail_covers(pickup,'ORDER_STATUS','COLLECTED');

 CALL pliego.sp_cart_add_item(actor,physical,1,cart,cart_item,quantity);
 CALL pliego.sp_checkout_idempotent(actor,uuidv4(),NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',location,cancelled,state,payment,total,reference);
 CALL pliego.sp_order_cancel(actor,cancelled,order_result,previous,state,payment,restored);
 CALL pg_temp.assert_mail_covers(cancelled,'ORDER_CANCELLED','CANCELLED');

 -- A second customer can buy the same digital edition independently.
 CALL pliego.sp_customer_register('email-digital-gate@example.invalid','fixture','Luz','Pérez',NULL,actor,customer,state);
 CALL pliego.sp_cart_add_item(actor,digital,1,cart,cart_item,quantity);
 CALL pliego.sp_checkout_idempotent(actor,uuidv4(),NULL,'TRANSFER','APPROVED',cart,'DIGITAL_ONLY',NULL,digital_order,state,payment,total,reference);
 CALL pg_temp.assert_mail_covers(digital_order,'ORDER_CONFIRMED','CONFIRMED');
 UPDATE pliego.pedido SET cancelacion_hasta=clock_timestamp()-INTERVAL '1 second' WHERE pedido_id=digital_order;
 CALL pliego.sp_home_delivery_advance_due(100);
 CALL pg_temp.assert_mail_covers(digital_order,'ORDER_STATUS','COMPLETED');
END $gate$;
ROLLBACK;
\echo 'Order email public cover gate passed (confirmation, home/pickup/digital lifecycle, cancellation, unsafe URLs).'
