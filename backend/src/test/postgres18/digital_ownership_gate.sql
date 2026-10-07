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
 IF (SELECT requires_physical_fulfillment FROM pliego.fn_cart_checkout_requirements(u)) OR
 (SELECT digital_item_count FROM pliego.fn_cart_checkout_requirements(u))<>1 THEN RAISE EXCEPTION 'Digital cart requirements incorrect'; END IF;
 CALL pliego.sp_checkout_idempotent(u,key,NULL,'TRANSFER','APPROVED',cart,'DIGITAL_ONLY',NULL,o,os,ps,total,ref);
 IF os<>'CONFIRMED' OR ps<>'APPROVED' THEN RAISE EXCEPTION 'Digital purchase unsuccessful'; END IF;
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)<>1
 OR (SELECT datos->>'customerName' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)<>'Cliente Biblioteca'
 OR (SELECT datos->>'customerEmail' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)<>'ownership-user@example.invalid'
 THEN RAISE EXCEPTION 'digital confirmation mail snapshot missing customer identity'; END IF;
 SELECT d.available_actions INTO window_payload FROM pliego.fn_customer_order_detail(u,o) d;
 SELECT p.cancelacion_hasta INTO deadline FROM pliego.pedido p WHERE pedido_id=o;
 IF deadline IS NULL OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+INTERVAL '6 minutes'
    OR deadline<>(SELECT fecha_aprobacion+INTERVAL '6 minutes' FROM pliego.pago WHERE pedido_id=o)
    OR window_payload->>'canCancel'<>'true' OR window_payload->>'lifecycleState'<>'CANCELLATION_WINDOW'
    OR window_payload->>'cancellationDeadline' IS NULL THEN RAISE EXCEPTION 'Digital six-minute window not projected: deadline %, actions %',deadline,window_payload; END IF;
 IF EXISTS(SELECT FROM pliego.pedido_direccion WHERE pedido_id=o) OR EXISTS(SELECT FROM pliego.pedido_entrega WHERE pedido_id=o)
 OR EXISTS(SELECT FROM pliego.envio WHERE pedido_id=o) OR EXISTS(SELECT FROM pliego.pedido_retiro WHERE pedido_id=o)
 THEN RAISE EXCEPTION 'Digital order has physical fulfillment records'; END IF;
 BEGIN CALL pliego.sp_order_change_status(a,o,'PREPARING',o2,previous,st);
 RAISE EXCEPTION 'Digital order entered physical lifecycle'; EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 SELECT lib.owned_item_id,lib.item INTO own,payload FROM pliego.fn_customer_library(u,NULL,0,20) lib;
 IF own IS NULL OR payload->>'ownershipState'<>'OWNED' OR payload->>'contentAccessSupported'<>'false'
 OR payload->>'productType'<>'EBOOK' OR jsonb_array_length(payload->'sourcePurchases')<>1 THEN RAISE EXCEPTION 'Ownership projection incorrect'; END IF;
 CALL pliego.sp_checkout_idempotent(u,key,NULL,'TRANSFER','APPROVED',cart,'DIGITAL_ONLY',NULL,o2,os,ps,total,ref);
 IF o2<>o OR (SELECT count(*) FROM pliego.digital_grant WHERE pedido_item_id IN(SELECT pedido_item_id FROM pliego.pedido_item WHERE pedido_id=o))<>1 THEN RAISE EXCEPTION 'Retry duplicated grant'; END IF;
 BEGIN PERFORM pliego.fn_customer_library_detail(u2,own); RAISE EXCEPTION 'Other user sees entitlement'; EXCEPTION WHEN SQLSTATE 'P6001' THEN NULL; END;
 IF EXISTS(SELECT FROM pliego.fn_customer_library(u2,NULL,0,20)) THEN RAISE EXCEPTION 'Library leaked'; END IF;
 CALL pliego.sp_cart_add_item(u,ebook,1,cart,item,qty);
 CALL pliego.sp_checkout(u,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,o2,os,ps,total,ref);
 IF (SELECT count(*) FROM pliego.fn_customer_library(u,NULL,0,20))<>1 OR (SELECT count(*) FROM pliego.digital_grant WHERE owned_item_id=own)<>2 THEN RAISE EXCEPTION 'Duplicate ownership not consolidated'; END IF;
 -- Invoice billing details are independent from absent physical delivery.
 IF (SELECT address FROM pliego.fn_customer_order_detail(u,o)) IS NOT NULL OR
 (SELECT address FROM pliego.fn_admin_order_detail(a,o)) IS NOT NULL THEN RAISE EXCEPTION 'Digital detail fabricated address'; END IF;
 CALL pliego.sp_invoice_issue(a,o,'LIBRARY-INVOICE','Cliente Biblioteca','OTHER','FIXTURE',NULL,'Dirección fiscal real',NULL,'Quito','Pichincha','EC',NULL,invoice);
 IF (SELECT count(*) FROM pliego.factura_item WHERE factura_id=invoice)<>1 THEN RAISE EXCEPTION 'Digital invoice missing commercial line'; END IF;
 BEGIN UPDATE pliego.edicion SET formato='AUDIOBOOK',numero_paginas=NULL,ebook_formato=NULL,audio_duracion_segundos=100,audio_narradores=ARRAY['Voz'] WHERE edicion_id=ebook;
 RAISE EXCEPTION 'Owned ebook changed media identity'; EXCEPTION WHEN SQLSTATE 'P2048' THEN NULL; END;
 CALL pliego.sp_order_cancel(u,o,o,previous,os,ps,restored);
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CANCELLED:'||o AND tipo='ORDER_CANCELLED')<>1
 OR (SELECT datos->>'paymentState' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CANCELLED:'||o)<>'REFUNDED'
 OR (SELECT datos->>'refundAmount' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CANCELLED:'||o) IS NULL
 OR EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave='ORDER_CANCELLED:'||o
   AND (datos ? 'inventory' OR datos ? 'grant' OR datos ? 'restoredUnits'))
 THEN RAISE EXCEPTION 'customer cancellation/refund email is missing or exposes internals'; END IF;
 CALL pliego.sp_credit_note_issue(a,o,'LIBRARY-CREDIT','Reembolso de fixture',credit);
 IF credit IS NULL THEN RAISE EXCEPTION 'Digital refund missing credit note'; END IF;
 IF (pliego.fn_customer_library_detail(u,own)->>'ownershipState')<>'OWNED' THEN RAISE EXCEPTION 'Refund revoked another valid grant'; END IF;
 BEGIN UPDATE pliego.digital_grant SET metadata_snapshot='{}'::JSONB WHERE owned_item_id=own;
 RAISE EXCEPTION 'Acquisition snapshot can be rewritten'; EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN UPDATE pliego.digital_ownership SET cliente_id=c2 WHERE owned_item_id=own;
 RAISE EXCEPTION 'Ownership can be reassigned'; EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 CALL pliego.sp_order_cancel(u,o2,o2,previous,os,ps,restored);
 IF (pliego.fn_customer_library_detail(u,own)->>'ownershipState')<>'REVOKED' THEN RAISE EXCEPTION 'Refund failed to revoke'; END IF;
 CALL pliego.sp_cart_add_item(u,audio,1,cart,item,qty);
 CALL pliego.sp_checkout(u,NULL,'TRANSFER','REJECTED','DIGITAL_ONLY',NULL,o,os,ps,total,ref);
 IF EXISTS(SELECT FROM pliego.digital_ownership WHERE cliente_id=c AND edicion_id=audio) THEN RAISE EXCEPTION 'Rejected payment grants ownership'; END IF;
 CALL pliego.sp_checkout(u,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,o,os,ps,total,ref);
 UPDATE pliego.edicion SET estado='INACTIVE' WHERE edicion_id=audio;
 IF (SELECT count(*) FROM pliego.fn_customer_library(u,'AUDIOBOOK',0,20))<>1 OR
 (SELECT lib.item->>'ownershipState' FROM pliego.fn_customer_library(u,'AUDIOBOOK',0,20) lib)<>'OWNED' THEN RAISE EXCEPTION 'Inactive edition lost ownership'; END IF;
 -- A missed deadline is recovered by the same database batch used by the scheduler.
 CALL pliego.sp_cart_add_item(u,ebook,1,cart,item,qty);
 CALL pliego.sp_checkout(u,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,o,os,ps,total,ref);
 UPDATE pliego.pedido SET cancelacion_hasta=clock_timestamp()-INTERVAL '1 second' WHERE pedido_id=o;
 CALL pliego.sp_home_delivery_advance_due(100);
 SELECT finalizado_en INTO finalized FROM pliego.pedido WHERE pedido_id=o;
 SELECT d.available_actions INTO window_payload FROM pliego.fn_customer_order_detail(u,o) d;
 IF finalized IS NULL OR (SELECT purchase_state FROM pliego.fn_customer_order_detail(u,o))<>'COMPLETED'
    OR window_payload->>'canCancel'<>'false' OR window_payload->>'lifecycleState'<>'COMPLETED'
    OR window_payload->>'libraryAccessState'<>'OWNERSHIP_ONLY'
    OR (SELECT lib.item->>'ownershipState' FROM pliego.fn_customer_library(u,'EBOOK',0,20) lib)<>'OWNED'
 THEN RAISE EXCEPTION 'Digital order did not finalize with library ownership'; END IF;
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:'||o||':DIGITAL:COMPLETED' AND tipo='ORDER_STATUS')<>1
 OR (SELECT (datos->>'method')||'|'||(datos->>'state')||'|'||(datos->>'actionPath')
     FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:'||o||':DIGITAL:COMPLETED')<>'DIGITAL|COMPLETED|/orders/'||o::TEXT
 OR (SELECT datos->'items'->0->>'originalPrice' FROM pliego.correo_outbox
     WHERE evento_clave='ORDER_STATUS:'||o||':DIGITAL:COMPLETED') IS DISTINCT FROM
    (SELECT precio_original_snapshot::TEXT FROM pliego.pedido_item WHERE pedido_id=o LIMIT 1)
 THEN RAISE EXCEPTION 'digital completion email lacks its authoritative snapshot'; END IF;
 CALL pliego.sp_home_delivery_advance_due(100);
 IF (SELECT finalizado_en FROM pliego.pedido WHERE pedido_id=o) IS DISTINCT FROM finalized
    OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=o AND estado_nuevo='PREPARING')<>0
    OR (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:'||o||':DIGITAL:COMPLETED')<>1
 THEN RAISE EXCEPTION 'Digital finalization retry was not idempotent'; END IF;
 BEGIN CALL pliego.sp_order_cancel(u,o,o,previous,os,ps,restored);
  RAISE EXCEPTION 'Digital order cancelled after deadline'; EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL; END;
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave='ORDER_CANCELLED:'||o)
 THEN RAISE EXCEPTION 'rejected late digital cancellation emitted a notification'; END IF;
 CALL pliego.sp_cart_add_item(u,physical,1,cart,item,qty);
 BEGIN CALL pliego.sp_checkout(u,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,o,os,ps,total,ref);
 RAISE EXCEPTION 'Physical cart accepted digital-only checkout'; EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 CALL pliego.sp_cart_add_item(u,ebook,1,cart,item,qty);
 CALL pliego.sp_checkout(u,addr,'TRANSFER','APPROVED','HOME_DELIVERY',NULL,o,os,ps,total,ref);
 IF (SELECT count(*) FROM pliego.pedido_item WHERE pedido_id=o)<>2 OR (SELECT count(*) FROM pliego.envio WHERE pedido_id=o)<>1 OR
 (SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id=o AND tipo='SALE')<>1 THEN RAISE EXCEPTION 'Mixed checkout not scoped to physical'; END IF;
 CALL pliego.sp_cart_add_item(u,physical,1,cart,item,qty);
 CALL pliego.sp_checkout(u,addr,'TRANSFER','APPROVED','HOME_DELIVERY',NULL,o,os,ps,total,ref);
 IF (SELECT count(*) FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.pedido_id=o)<>0 THEN RAISE EXCEPTION 'Physical purchase granted digital'; END IF;
 -- An unavailable mixed cart must be rejected before payment/grant creation.
 SELECT count(*) INTO grant_count FROM pliego.digital_grant WHERE owned_item_id=own;
 CALL pliego.sp_cart_add_item(u,physical,1,cart,item,qty);
 CALL pliego.sp_cart_add_item(u,ebook,1,cart,item,qty);
 SELECT stock_actual INTO before_stock FROM pliego.inventario WHERE edicion_id=physical;
 CALL pliego.sp_inventory_adjust(a,physical,'ADJUSTMENT_OUT',before_stock,'Simular agotamiento',movement,before_stock,after_stock);
 BEGIN CALL pliego.sp_checkout(u,addr,'TRANSFER','APPROVED','HOME_DELIVERY',NULL,o,os,ps,total,ref);
 RAISE EXCEPTION 'Mixed checkout accepted missing stock'; EXCEPTION WHEN SQLSTATE 'P3002' THEN NULL; END;
 IF (SELECT count(*) FROM pliego.digital_grant WHERE owned_item_id=own)<>grant_count THEN RAISE EXCEPTION 'Failed mixed command leaked entitlement'; END IF;
END $gate$;
ROLLBACK;
