-- Prove rollback AFTER approved payment, digital grant and email were produced.
BEGIN;
DO $gate$
DECLARE a BIGINT; au BIGINT; pub BIGINT; cat BIGINT; book BIGINT; ebook BIGINT; physical BIGINT;
 u BIGINT; c BIGINT; st VARCHAR; addr BIGINT; cart BIGINT; item BIGINT; qty INTEGER;
 movement BIGINT; stock_before INTEGER; stock_after INTEGER; o BIGINT; os VARCHAR; ps VARCHAR; total NUMERIC; ref VARCHAR;
 key UUID:=gen_random_uuid(); fingerprint VARCHAR;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('rollback-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
 CALL pliego.sp_author_create(a,'Autora Rollback',NULL,au);
 CALL pliego.sp_publisher_create(a,'Editorial Rollback',NULL,pub);
 CALL pliego.sp_category_create(a,'Rollback','mixed-rollback-gate',NULL,NULL,cat);
 CALL pliego.sp_book_create(a,'Título Rollback',NULL,'Fixture',jsonb_build_array(jsonb_build_object('authorId',au,'order',1)),jsonb_build_array(cat),book);
 CALL pliego.sp_edition_create(a,book,pub,'ROLLBACK-EBOOK',NULL,'es','EBOOK',120,NULL,10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],ebook);
 CALL pliego.sp_edition_create(a,book,pub,'ROLLBACK-PAPER',NULL,'es','PAPERBACK',120,NULL,20,NULL,NULL,NULL,NULL,physical);
 CALL pliego.sp_inventory_entry(a,physical,10,'fixture',movement,stock_before,stock_after);
 CALL pliego.sp_customer_register('rollback-user@example.invalid','fixture','Cliente','Rollback',NULL,u,c,st);
 CALL pliego.sp_address_create(u,'Casa','Cliente Rollback','Calle',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,addr);
 CALL pliego.sp_cart_add_item(u,ebook,1,cart,item,qty);
 CALL pliego.sp_cart_add_item(u,physical,1,cart,item,qty);
 SELECT quote_fingerprint INTO fingerprint FROM pliego.fn_cart_checkout_quote(u);
 BEGIN
  CALL pliego.sp_checkout_quoted(u,key,addr,'TRANSFER','APPROVED',cart,'HOME_DELIVERY',NULL,fingerprint,o,os,ps,total,ref);
  IF ps<>'APPROVED' OR NOT EXISTS(SELECT FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.pedido_id=o)
   OR NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)
   OR NOT EXISTS(SELECT FROM pliego.checkout_attempt WHERE actor_user_id=u AND attempt_key=key)
   THEN RAISE EXCEPTION 'test did not reach post-payment effects'; END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Injected failure after business effects';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
 IF EXISTS(SELECT FROM pliego.pedido WHERE pedido_id=o)
 OR EXISTS(SELECT FROM pliego.pago WHERE pedido_id=o)
 OR EXISTS(SELECT FROM pliego.checkout_attempt WHERE actor_user_id=u AND attempt_key=key)
 OR EXISTS(SELECT FROM pliego.digital_ownership WHERE cliente_id=c)
 OR EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)
 OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>10
 OR (SELECT estado FROM pliego.carrito WHERE carrito_id=cart)<>'ACTIVE'
 OR (SELECT count(*) FROM pliego.carrito_item WHERE carrito_id=cart)<>2
 THEN RAISE EXCEPTION 'mixed rollback leaked a business effect'; END IF;
END $gate$;
ROLLBACK;
