-- Source-specific digital access and mixed-order lifecycle compatibility. Rolled back.
BEGIN;

CREATE FUNCTION pg_temp.assert_purchase_access(
 p_actor BIGINT,p_order BIGINT,p_edition BIGINT,p_state TEXT,p_owned BIGINT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE direct_items JSONB; priced_items JSONB; line JSONB; source_owned BIGINT;
BEGIN
 SELECT items INTO STRICT direct_items FROM pliego.fn_customer_order_detail(p_actor,p_order);
 SELECT items INTO STRICT priced_items FROM pliego.fn_customer_order_detail_priced(p_actor,p_order);
 IF direct_items IS DISTINCT FROM priced_items THEN
  RAISE EXCEPTION 'Canonical/priced item projection differs for order %',p_order;
 END IF;
 SELECT value INTO STRICT line FROM jsonb_array_elements(direct_items)
  WHERE value->>'editionId'=p_edition::TEXT;
 IF NOT line ? 'digitalAccess' OR NOT line ? 'requiresPhysicalFulfillment' THEN
  RAISE EXCEPTION 'Missing canonical purchased-line capabilities: %',line;
 END IF;
 IF p_state IS NULL THEN
  IF line->'digitalAccess' IS DISTINCT FROM 'null'::JSONB
   OR line->'requiresPhysicalFulfillment' IS DISTINCT FROM 'true'::JSONB THEN
   RAISE EXCEPTION 'Physical line acquired digital capabilities: %',line;
  END IF;
 ELSE
  IF line->'requiresPhysicalFulfillment' IS DISTINCT FROM 'false'::JSONB
   OR line->'digitalAccess'->>'state' IS DISTINCT FROM p_state
   OR NOT (line->'digitalAccess' ? 'ownedItemId')
   OR line->'digitalAccess'->>'ownedItemId' IS DISTINCT FROM p_owned::TEXT THEN
   RAISE EXCEPTION 'Unexpected source access, wanted % / %, received %',p_state,p_owned,line;
  END IF;
  IF p_state='AVAILABLE' THEN
   SELECT g.owned_item_id INTO source_owned FROM pliego.digital_grant g
    WHERE g.pedido_item_id=(line->>'orderItemId')::BIGINT AND g.state='ACTIVE';
   IF p_owned IS NULL OR source_owned IS DISTINCT FROM p_owned
    OR jsonb_typeof(line->'digitalAccess'->'ownedItemId') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Library link is not the exact active purchase source: %',line;
   END IF;
  ELSIF line->'digitalAccess'->'ownedItemId' IS DISTINCT FROM 'null'::JSONB THEN
   RAISE EXCEPTION 'Unavailable source exposes a library link: %',line;
  END IF;
 END IF;
END; $$;

DO $gate$
DECLARE
 admin BIGINT; author_id BIGINT; publisher_id BIGINT; category_id BIGINT; book_id BIGINT;
 ebook BIGINT; audio BIGINT; physical BIGINT; actor BIGINT; customer BIGINT; other_actor BIGINT; other_customer BIGINT;
 address_id BIGINT; pickup_id BIGINT; cart BIGINT; item BIGINT; quantity INTEGER; user_state VARCHAR;
 movement BIGINT; stock_before INTEGER; stock_after INTEGER; stock_checkpoint INTEGER;
 purchase BIGINT; old_purchase BIGINT; replacement BIGINT; cancelled BIGINT; invoice_id BIGINT;
 order_state VARCHAR; payment_state VARCHAR; previous_state VARCHAR; total NUMERIC; reference VARCHAR; restored BIGINT;
 owned BIGINT; ebook_owned BIGINT; actions JSONB; source_item BIGINT;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('purchase-access-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO admin;
 CALL pliego.sp_author_create(admin,'Autora Acceso',NULL,author_id);
 CALL pliego.sp_publisher_create(admin,'Editorial Acceso',NULL,publisher_id);
 CALL pliego.sp_category_create(admin,'Acceso','purchase-digital-access-gate',NULL,NULL,category_id);
 CALL pliego.sp_book_create(admin,'Libro Acceso',NULL,'Fixture',
  jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category_id),book_id);
 CALL pliego.sp_edition_create(admin,book_id,publisher_id,'ACCESS-EBOOK',NULL,'es','EBOOK',120,NULL,10,
  NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],ebook);
 CALL pliego.sp_edition_create(admin,book_id,publisher_id,'ACCESS-AUDIO',NULL,'es','AUDIOBOOK',NULL,NULL,15,
  NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Narradora'],audio);
 CALL pliego.sp_edition_create(admin,book_id,publisher_id,'ACCESS-PAPER',NULL,'es','PAPERBACK',120,NULL,20,
  NULL,NULL,NULL,NULL,physical);
 CALL pliego.sp_inventory_entry(admin,physical,20,'fixture',movement,stock_before,stock_after);
 CALL pliego.sp_customer_register('purchase-access-user@example.invalid','fixture','Cliente','Acceso',NULL,actor,customer,user_state);
 CALL pliego.sp_customer_register('purchase-access-other@example.invalid','fixture','Otro','Acceso',NULL,other_actor,other_customer,user_state);
 CALL pliego.sp_address_create(actor,'Casa','Cliente Acceso','Calle',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,address_id);
 SELECT ubicacion_retiro_id INTO STRICT pickup_id FROM pliego.ubicacion_retiro WHERE activo ORDER BY ubicacion_retiro_id LIMIT 1;

 -- Physical-only detail has an explicit null digital capability, through both readers.
 CALL pliego.sp_cart_add_item(actor,physical,1,cart,item,quantity);
 CALL pliego.sp_checkout(actor,address_id,'TRANSFER','APPROVED','HOME_DELIVERY',NULL,purchase,order_state,payment_state,total,reference);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,physical,NULL);
 IF EXISTS(SELECT FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.pedido_id=purchase) THEN
  RAISE EXCEPTION 'Physical-only order created a digital grant';
 END IF;
 CALL pliego.sp_order_cancel(actor,purchase,cancelled,previous_state,order_state,payment_state,restored);

 -- Digital approval grants ownership immediately, while cancellation is still available.
 CALL pliego.sp_cart_add_item(actor,ebook,1,cart,item,quantity);
 CALL pliego.sp_checkout(actor,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,purchase,order_state,payment_state,total,reference);
 SELECT g.owned_item_id INTO STRICT ebook_owned FROM pliego.digital_grant g
  JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.pedido_id=purchase;
 PERFORM pg_temp.assert_purchase_access(actor,purchase,ebook,'AVAILABLE',ebook_owned);
 SELECT available_actions INTO actions FROM pliego.fn_customer_order_detail(actor,purchase);
 IF actions->>'canCancel' IS DISTINCT FROM 'true'
  OR actions->>'lifecycleState' IS DISTINCT FROM 'CANCELLATION_WINDOW'
  OR actions->>'libraryAccessState' IS DISTINCT FROM 'OWNERSHIP_ONLY'
  OR EXISTS(SELECT FROM pliego.pedido_entrega WHERE pedido_id=purchase)
  OR EXISTS(SELECT FROM pliego.envio WHERE pedido_id=purchase) THEN
  RAISE EXCEPTION 'Immediate digital ownership changed the commercial/physical lifecycle: %',actions;
 END IF;
 -- Age only the fixture deadline; the public detail read performs real reconciliation.
 UPDATE pliego.pedido SET cancelacion_hasta=clock_timestamp()-INTERVAL '1 second' WHERE pedido_id=purchase;
 PERFORM pg_temp.assert_purchase_access(actor,purchase,ebook,'AVAILABLE',ebook_owned);
 SELECT available_actions INTO actions FROM pliego.fn_customer_order_detail_priced(actor,purchase);
 IF (SELECT purchase_state FROM pliego.fn_customer_order_detail(actor,purchase)) IS DISTINCT FROM 'COMPLETED'
  OR actions->>'canCancel' IS DISTINCT FROM 'false' OR actions->>'lifecycleState' IS DISTINCT FROM 'COMPLETED'
  OR actions->>'libraryAccessState' IS DISTINCT FROM 'OWNERSHIP_ONLY' THEN
  RAISE EXCEPTION 'Finalization removed ownership or failed to close cancellation: %',actions;
 END IF;
 BEGIN
  PERFORM * FROM pliego.fn_customer_order_detail(other_actor,purchase);
  RAISE EXCEPTION 'Another customer read canonical digital access';
 EXCEPTION WHEN SQLSTATE 'P5001' THEN NULL; END;
 BEGIN
  PERFORM * FROM pliego.fn_customer_order_detail_priced(other_actor,purchase);
  RAISE EXCEPTION 'Another customer read priced digital access';
 EXCEPTION WHEN SQLSTATE 'P5001' THEN NULL; END;

 -- HOME_DELIVERY mixed purchase has one physical shipment and immediate digital access.
 SELECT stock_actual INTO stock_checkpoint FROM pliego.inventario WHERE edicion_id=physical;
 CALL pliego.sp_cart_add_item(actor,physical,2,cart,item,quantity);
 CALL pliego.sp_cart_add_item(actor,audio,1,cart,item,quantity);
 CALL pliego.sp_checkout(actor,address_id,'TRANSFER','APPROVED','HOME_DELIVERY',NULL,purchase,order_state,payment_state,total,reference);
 old_purchase:=purchase;
 SELECT g.owned_item_id INTO STRICT owned FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.pedido_id=purchase;
 PERFORM pg_temp.assert_purchase_access(actor,purchase,physical,NULL);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,audio,'AVAILABLE',owned);
 IF (SELECT count(*) FROM pliego.envio WHERE pedido_id=purchase)<>1
  OR EXISTS(SELECT FROM pliego.pedido_retiro WHERE pedido_id=purchase)
  OR (SELECT metodo FROM pliego.pedido_entrega WHERE pedido_id=purchase) IS DISTINCT FROM 'HOME_DELIVERY'
  OR (SELECT cancelacion_hasta FROM pliego.pedido WHERE pedido_id=purchase) IS NOT NULL
  OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>stock_checkpoint-2 THEN
  RAISE EXCEPTION 'Mixed home delivery fabricated digital logistics or changed stock/deadline rules';
 END IF;
 CALL pliego.sp_order_cancel(actor,purchase,cancelled,previous_state,order_state,payment_state,restored);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,audio,'REVOKED');
 IF order_state<>'CANCELLED' OR payment_state<>'REFUNDED' OR restored<>2
  OR (SELECT monto FROM pliego.pago WHERE pedido_id=purchase)<>total
  OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>stock_checkpoint
  OR (SELECT estado FROM pliego.envio WHERE pedido_id=purchase) IS DISTINCT FROM 'CANCELLED'
  OR (SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id=purchase AND tipo='CANCELLATION')<>1
  OR (pliego.fn_customer_library_detail(actor,owned)->>'ownershipState') IS DISTINCT FROM 'REVOKED' THEN
  RAISE EXCEPTION 'Customer mixed cancellation failed full refund, source revocation or physical restoration';
 END IF;

 -- Repurchase reuses the identity but the cancelled source must never borrow its link.
 CALL pliego.sp_cart_add_item(actor,physical,1,cart,item,quantity);
 CALL pliego.sp_cart_add_item(actor,audio,1,cart,item,quantity);
 CALL pliego.sp_checkout(actor,NULL,'TRANSFER','APPROVED','STORE_PICKUP',pickup_id,replacement,order_state,payment_state,total,reference);
 PERFORM pg_temp.assert_purchase_access(actor,replacement,physical,NULL);
 PERFORM pg_temp.assert_purchase_access(actor,replacement,audio,'AVAILABLE',owned);
 PERFORM pg_temp.assert_purchase_access(actor,old_purchase,audio,'REVOKED');
 SELECT available_actions INTO actions FROM pliego.fn_customer_order_detail(actor,replacement);
 IF (SELECT count(*) FROM pliego.pedido_retiro WHERE pedido_id=replacement)<>1
  OR EXISTS(SELECT FROM pliego.envio WHERE pedido_id=replacement)
  OR EXISTS(SELECT FROM pliego.pedido_direccion WHERE pedido_id=replacement)
  OR (SELECT metodo FROM pliego.pedido_entrega WHERE pedido_id=replacement) IS DISTINCT FROM 'STORE_PICKUP'
  OR actions->>'lifecycleState' IS DISTINCT FROM 'CANCELLATION_WINDOW'
  OR actions->>'canCancel' IS DISTINCT FROM 'true'
  OR (pliego.fn_customer_library_detail(actor,owned)->>'ownershipState') IS DISTINCT FROM 'OWNED' THEN
  RAISE EXCEPTION 'Mixed pickup or retained ownership identity changed: %',actions;
 END IF;
 CALL pliego.sp_order_cancel(admin,replacement,cancelled,previous_state,order_state,payment_state,restored);
 PERFORM pg_temp.assert_purchase_access(actor,replacement,audio,'REVOKED');
 IF order_state<>'CANCELLED' OR payment_state<>'REFUNDED' OR restored<>1
  OR (SELECT monto FROM pliego.pago WHERE pedido_id=replacement)<>total
  OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>stock_checkpoint
  OR (SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id=replacement AND tipo='CANCELLATION')<>1
  OR (pliego.fn_customer_library_detail(actor,owned)->>'ownershipState') IS DISTINCT FROM 'REVOKED' THEN
  RAISE EXCEPTION 'Admin mixed cancellation failed full refund, source revocation or physical restoration';
 END IF;

 -- A pending mixed transfer has no grant or SALE; admin capture creates both atomically.
 CALL pliego.sp_cart_add_item(actor,physical,1,cart,item,quantity);
 CALL pliego.sp_cart_add_item(actor,audio,1,cart,item,quantity);
 CALL pliego.sp_checkout_billed_quoted(actor,gen_random_uuid(),address_id,'TRANSFER','PENDING',cart,'HOME_DELIVERY',NULL,NULL,
  'EC_CEDULA','0912345675','Cliente Acceso','Calle Fiscal',NULL,'Quito','Pichincha','EC',NULL,
  purchase,order_state,payment_state,total,reference,invoice_id);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,physical,NULL);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,audio,'PENDING_PAYMENT');
 IF EXISTS(SELECT FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.pedido_id=purchase)
  OR EXISTS(SELECT FROM pliego.movimiento_inventario WHERE pedido_id=purchase)
  OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>stock_checkpoint THEN
  RAISE EXCEPTION 'Pending mixed transfer granted ownership or consumed physical stock';
 END IF;
 CALL pliego.sp_billed_order_approve(admin,purchase);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,audio,'AVAILABLE',owned);
 IF (SELECT estado FROM pliego.pago WHERE pedido_id=purchase) IS DISTINCT FROM 'APPROVED'
  OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>stock_checkpoint-1 THEN
  RAISE EXCEPTION 'Deferred mixed approval did not capture payment and physical sale';
 END IF;
 CALL pliego.sp_order_cancel(admin,purchase,cancelled,previous_state,order_state,payment_state,restored);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,audio,'REVOKED');

 -- Cancel a new pending source while an old revoked identity exists: no invented grant/link.
 CALL pliego.sp_cart_add_item(actor,physical,1,cart,item,quantity);
 CALL pliego.sp_cart_add_item(actor,audio,1,cart,item,quantity);
 CALL pliego.sp_checkout_billed_quoted(actor,gen_random_uuid(),address_id,'TRANSFER','PENDING',cart,'HOME_DELIVERY',NULL,NULL,
  'EC_CEDULA','0912345675','Cliente Acceso','Calle Fiscal',NULL,'Quito','Pichincha','EC',NULL,
  purchase,order_state,payment_state,total,reference,invoice_id);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,audio,'PENDING_PAYMENT');
 CALL pliego.sp_order_cancel(actor,purchase,cancelled,previous_state,order_state,payment_state,restored);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,audio,'UNAVAILABLE');
 IF order_state<>'CANCELLED' OR payment_state<>'REJECTED' OR restored<>0
  OR EXISTS(SELECT FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.pedido_id=purchase)
  OR EXISTS(SELECT FROM pliego.movimiento_inventario WHERE pedido_id=purchase)
  OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>stock_checkpoint THEN
  RAISE EXCEPTION 'Pending cancellation fabricated acquisition, refund or restoration';
 END IF;

 -- Rejected purchase is unavailable, although an unrelated retained ownership row exists.
 CALL pliego.sp_cart_add_item(actor,audio,1,cart,item,quantity);
 CALL pliego.sp_checkout(actor,NULL,'TRANSFER','REJECTED','DIGITAL_ONLY',NULL,purchase,order_state,payment_state,total,reference);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,audio,'UNAVAILABLE');
 SELECT pedido_item_id INTO STRICT source_item FROM pliego.pedido_item WHERE pedido_id=purchase;
 IF EXISTS(SELECT FROM pliego.digital_grant WHERE pedido_item_id=source_item) THEN
  RAISE EXCEPTION 'Rejected payment created an acquisition';
 END IF;
 -- Rejected checkout retains its active cart, allowing another successful attempt.
 CALL pliego.sp_checkout(actor,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,replacement,order_state,payment_state,total,reference);
 PERFORM pg_temp.assert_purchase_access(actor,replacement,audio,'AVAILABLE',owned);
 PERFORM pg_temp.assert_purchase_access(actor,purchase,audio,'UNAVAILABLE');
 PERFORM pg_temp.assert_purchase_access(actor,old_purchase,audio,'REVOKED');
END $gate$;
ROLLBACK;
