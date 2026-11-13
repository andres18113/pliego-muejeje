-- Ownership grants, isolation, digital/physical/mixed commercial semantics. Rolled back.
BEGIN;
DO $gate$
DECLARE a BIGINT; au BIGINT; pub BIGINT; cat BIGINT; book BIGINT; ebook BIGINT; audio BIGINT; physical BIGINT;
 u BIGINT; c BIGINT; u2 BIGINT; c2 BIGINT; st VARCHAR; addr BIGINT; cart BIGINT; item BIGINT; qty INTEGER;
 movement BIGINT; before_stock INTEGER; after_stock INTEGER; o BIGINT; o2 BIGINT; os VARCHAR; ps VARCHAR; total NUMERIC; ref VARCHAR;
 own BIGINT; grant_count BIGINT; invoice BIGINT; credit BIGINT; payload JSONB; window_payload JSONB;
 deadline TIMESTAMPTZ; finalized TIMESTAMPTZ; previous VARCHAR; restored BIGINT; key UUID:=gen_random_uuid();
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('ownership-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
 CALL pliego.sp_author_create(a,'Autora Biblioteca',NULL,au);
 CALL pliego.sp_publisher_create(a,'Editorial Biblioteca',NULL,pub);
 CALL pliego.sp_category_create(a,'Biblioteca','ownership-gate',NULL,NULL,cat);
 CALL pliego.sp_book_create(a,'Título Biblioteca',NULL,'Fixture',jsonb_build_array(jsonb_build_object('authorId',au,'order',1)),jsonb_build_array(cat),book);
 CALL pliego.sp_edition_create(a,book,pub,'OWN-EBOOK',NULL,'es','EBOOK',120,NULL,10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],ebook);
 CALL pliego.sp_edition_create(a,book,pub,'OWN-AUDIO',NULL,'es','AUDIOBOOK',NULL,NULL,15,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Narradora'],audio);
 CALL pliego.sp_edition_create(a,book,pub,'OWN-PAPER',NULL,'es','PAPERBACK',120,NULL,20,NULL,NULL,NULL,NULL,physical);
 CALL pliego.sp_inventory_entry(a,physical,10,'fixture',movement,before_stock,after_stock);
 CALL pliego.sp_customer_register('ownership-user@example.invalid','fixture','Cliente','Biblioteca',NULL,u,c,st);
 CALL pliego.sp_customer_register('ownership-other@example.invalid','fixture','Otro','Cliente',NULL,u2,c2,st);
 CALL pliego.sp_address_create(u,'Casa','Cliente Biblioteca','Calle',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,addr);
 CALL pliego.sp_cart_add_item(u,ebook,1,cart,item,qty);
 CALL pliego.sp_cart_add_item(u,ebook,1,cart,item,qty);
 BEGIN CALL pliego.sp_cart_add_item(u,ebook,2,cart,item,qty);
 RAISE EXCEPTION 'invalid digital quantity accepted on repeat'; EXCEPTION WHEN SQLSTATE 'P4004' THEN NULL; END;
 IF qty<>1 OR (SELECT count(*) FROM pliego.carrito_item WHERE carrito_id=cart)<>1 THEN RAISE EXCEPTION 'digital add must remain one'; END IF;
 IF NOT (SELECT in_cart AND purchasable AND NOT owned AND NOT pending_order AND pending_order_id IS NULL FROM pliego.fn_customer_digital_eligibility(u,ARRAY[ebook])) THEN RAISE EXCEPTION 'in-cart eligibility wrong'; END IF;
 CALL pliego.sp_checkout(u,NULL,'TRANSFER','PENDING','DIGITAL_ONLY',NULL,o,os,ps,total,ref);
 IF NOT (SELECT pending_order AND pending_order_id=o AND NOT purchasable AND NOT owned FROM pliego.fn_customer_digital_eligibility(u,ARRAY[ebook])) THEN RAISE EXCEPTION 'pending eligibility wrong'; END IF;
 BEGIN CALL pliego.sp_cart_add_item(u,ebook,1,cart,item,qty);
 RAISE EXCEPTION 'pending add allowed'; EXCEPTION WHEN SQLSTATE 'P6003' THEN NULL; END;
 -- Trusted fixture: a stale cart can predate ownership or pending order creation.
 INSERT INTO pliego.carrito(cliente_id,estado) VALUES(c,'ACTIVE') RETURNING carrito_id INTO cart;
 INSERT INTO pliego.carrito_item(carrito_id,edicion_id,cantidad) VALUES(cart,ebook,1) RETURNING carrito_item_id INTO item;
 IF (SELECT items->0->>'unavailabilityReason' FROM pliego.fn_cart_checkout_quote(u))<>'P6003' THEN RAISE EXCEPTION 'pending line missing reason'; END IF;
 SELECT count(*) INTO grant_count FROM pliego.pedido WHERE cliente_id=c;
 BEGIN CALL pliego.sp_checkout(u,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,o2,os,ps,total,ref);
 RAISE EXCEPTION 'pending checkout allowed'; EXCEPTION WHEN SQLSTATE 'P6003' THEN NULL; END;
 IF (SELECT count(*) FROM pliego.pedido WHERE cliente_id=c)<>grant_count THEN RAISE EXCEPTION 'pending checkout leaked order'; END IF;
 UPDATE pliego.pago SET estado='APPROVED',referencia=pliego.fn_generate_payment_reference() WHERE pedido_id=o;
 UPDATE pliego.pedido SET estado='CONFIRMED' WHERE pedido_id=o;
 SELECT owned_item_id INTO own FROM pliego.digital_ownership WHERE cliente_id=c AND edicion_id=ebook;
 CALL pliego.sp_digital_ownership_reconcile(o);
 CALL pliego.sp_digital_ownership_reconcile(o);
 IF (SELECT count(*) FROM pliego.digital_grant WHERE owned_item_id=own)<>1 THEN RAISE EXCEPTION 'same item grant not idempotent'; END IF;
 IF NOT (SELECT owned AND owned_item_id=own AND pending_order_id=o AND NOT purchasable FROM pliego.fn_customer_digital_eligibility(u,ARRAY[ebook])) THEN RAISE EXCEPTION 'owned eligibility wrong'; END IF;
 IF (SELECT owned FROM pliego.fn_customer_digital_eligibility(u2,ARRAY[ebook])) THEN RAISE EXCEPTION 'eligibility leaks ownership'; END IF;
 IF (SELECT count(*) FROM pliego.fn_customer_digital_eligibility(u,ARRAY[ebook,physical,ebook,9223372036854775807]))<>3 THEN RAISE EXCEPTION 'batch dedup wrong'; END IF;
 IF (SELECT purchasable FROM pliego.fn_customer_digital_eligibility(u,ARRAY[physical])) THEN RAISE EXCEPTION 'physical digitally purchasable'; END IF;
 BEGIN CALL pliego.sp_cart_add_item(u,ebook,1,cart,item,qty);
 RAISE EXCEPTION 'owned add allowed'; EXCEPTION WHEN SQLSTATE 'P6002' THEN NULL; END;
 IF (SELECT items->0->>'unavailabilityReason' FROM pliego.fn_cart_checkout_quote(u))<>'P6002'
 OR (SELECT (items->0->>'available')::BOOLEAN FROM pliego.fn_cart_checkout_quote(u)) THEN RAISE EXCEPTION 'owned cart availability wrong'; END IF;
 BEGIN CALL pliego.sp_checkout_quoted(u,gen_random_uuid(),NULL,'TRANSFER','APPROVED',cart,'DIGITAL_ONLY',NULL,NULL,o2,os,ps,total,ref);
 RAISE EXCEPTION 'owned quote acceptance allowed'; EXCEPTION WHEN SQLSTATE 'P6002' THEN NULL; END;
 BEGIN CALL pliego.sp_checkout_execute(u,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,o2,os,ps,total,ref);
 RAISE EXCEPTION 'owned order creation allowed'; EXCEPTION WHEN SQLSTATE 'P6002' THEN NULL; END;
 IF (SELECT count(*) FROM pliego.pedido WHERE cliente_id=c)<>grant_count OR
 (SELECT count(*) FROM pliego.pago pa JOIN pliego.pedido p USING(pedido_id) WHERE p.cliente_id=c)<>grant_count THEN RAISE EXCEPTION 'owned checkout leaked effects'; END IF;
 -- A new source cannot charge/grant the same edition even through direct DML.
 BEGIN
  INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total,impuesto_tasa,impuesto_monto,envio_monto) VALUES(c,'PENDING_PAYMENT',10,10,0,0,0) RETURNING pedido_id INTO o2;
  INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal,impuesto_tasa,impuesto_monto)
  SELECT o2,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal,impuesto_tasa,impuesto_monto FROM pliego.pedido_item WHERE pedido_id=o;
  RAISE EXCEPTION 'owned direct order item allowed';
 EXCEPTION WHEN SQLSTATE 'P6002' THEN NULL; END;
 CALL pliego.sp_order_cancel(u,o,o,previous,os,ps,restored);
 IF (SELECT state FROM pliego.digital_grant WHERE owned_item_id=own)<>'REVOKED' THEN RAISE EXCEPTION 'cancellation did not revoke'; END IF;
 IF NOT (SELECT purchasable AND NOT owned AND owned_item_id IS NULL AND NOT pending_order AND pending_order_id IS NULL FROM pliego.fn_customer_digital_eligibility(u,ARRAY[ebook])) THEN RAISE EXCEPTION 'revoked cannot repurchase'; END IF;
 CALL pliego.sp_checkout(u,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,o2,os,ps,total,ref);
 IF (SELECT count(*) FROM pliego.digital_ownership WHERE cliente_id=c AND edicion_id=ebook)<>1 OR
 (SELECT count(*) FROM pliego.digital_grant WHERE owned_item_id=own AND state='ACTIVE')<>1 OR
 (SELECT count(*) FROM pliego.digital_grant WHERE owned_item_id=own)<>2 THEN RAISE EXCEPTION 'repurchase identity/history wrong'; END IF;
 -- A valid source can be reactivated when no other ACTIVE source exists.
 UPDATE pliego.digital_grant SET state='REVOKED' WHERE pedido_item_id IN(SELECT pedido_item_id FROM pliego.pedido_item WHERE pedido_id=o2);
 CALL pliego.sp_digital_ownership_reconcile(o2);
 IF (SELECT count(*) FROM pliego.digital_grant WHERE owned_item_id=own AND state='ACTIVE')<>1 THEN RAISE EXCEPTION 'valid source failed to reactivate'; END IF;
 -- Reactivating a different old source must also fail at the grant boundary.
 BEGIN UPDATE pliego.digital_grant SET state='ACTIVE' WHERE owned_item_id=own AND state='REVOKED';
 RAISE EXCEPTION 'old refunded grant reactivated'; EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 CALL pliego.sp_cart_add_item(u,physical,2,cart,item,qty);
 CALL pliego.sp_cart_add_item(u,physical,1,cart,item,qty);
 IF qty<>3 THEN RAISE EXCEPTION 'physical quantity changed'; END IF;
 CALL pliego.sp_checkout(u,addr,'TRANSFER','APPROVED','HOME_DELIVERY',NULL,o,os,ps,total,ref);
 IF (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>7 THEN RAISE EXCEPTION 'physical stock wrong'; END IF;
END $gate$;
ROLLBACK;
