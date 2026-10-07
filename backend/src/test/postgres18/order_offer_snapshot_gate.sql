\set ON_ERROR_STOP on
BEGIN;
DO $gate$
DECLARE
 actor BIGINT; buyer BIGINT; customer BIGINT; author BIGINT; publisher BIGINT; book BIGINT; category BIGINT;
 physical BIGINT; ebook BIGINT; audio BIGINT; regular BIGINT; additional BIGINT; offer BIGINT;
 movement BIGINT; stock_before INTEGER; stock_after INTEGER; cart BIGINT; checkout_cart BIGINT; item BIGINT; quantity INTEGER;
 order_id BIGINT; replay BIGINT; legacy_order BIGINT; pickup BIGINT; state VARCHAR; pay VARCHAR; previous VARCHAR;
 total NUMERIC; reference VARCHAR; restored BIGINT; key UUID:=uuidv4(); pricing RECORD; quote RECORD;
 detail RECORD; raw_detail RECORD; enriched JSONB; snapshots JSONB; line JSONB;
BEGIN
 IF to_regprocedure('pliego.fn_order_offer_pricing(bigint)') IS NULL
 OR to_regprocedure('pliego.fn_order_item_offer_snapshots(jsonb)') IS NULL
 THEN RAISE EXCEPTION 'RED: immutable historical offer projection is unavailable'; END IF;
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('order-offer-snapshot-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO actor;
 CALL pliego.sp_author_create(actor,'Autora historial de ofertas',NULL,author);
 CALL pliego.sp_publisher_create(actor,'Editorial historial de ofertas',NULL,publisher);
 CALL pliego.sp_category_create(actor,'Historial de ofertas','order-offer-snapshot',NULL,NULL,category);
 CALL pliego.sp_book_create(actor,'Libro historial de ofertas',NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author,'order',1)),jsonb_build_array(category),book);
 CALL pliego.sp_customer_register('order-offer-snapshot@example.invalid','fixture','Ana','Pérez',NULL,buyer,customer,state);
 CALL pliego.sp_edition_create(actor,book,publisher,'ORDER-OFFER-PHYSICAL',NULL,'es','PAPERBACK',100,NULL,79.95,NULL,NULL,NULL,NULL,physical);
 CALL pliego.sp_inventory_entry(actor,physical,10,'fixture',movement,stock_before,stock_after);
 CALL pliego.sp_edition_create(actor,book,publisher,'ORDER-OFFER-EBOOK',NULL,'es','EBOOK',NULL,NULL,15.99,NULL,NULL,NULL,NULL,NULL,NULL,NULL,ebook);
 CALL pliego.sp_edition_create(actor,book,publisher,'ORDER-OFFER-AUDIO',NULL,'es','AUDIOBOOK',NULL,NULL,28.99,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Narrador DEMO'],audio);
 CALL pliego.sp_edition_create(actor,book,publisher,'ORDER-OFFER-REGULAR',NULL,'es','HARDCOVER',100,NULL,10.00,NULL,NULL,NULL,NULL,regular);
 CALL pliego.sp_inventory_entry(actor,regular,10,'fixture',movement,stock_before,stock_after);
 CALL pliego.sp_edition_offer_set(actor,physical,63.96,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '3 days',offer);
 CALL pliego.sp_edition_offer_set(actor,ebook,12.79,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '7 days',offer);
 CALL pliego.sp_edition_offer_set(actor,audio,23.19,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '15 days',offer);
 CALL pliego.sp_cart_add_item(buyer,physical,2,cart,item,quantity);
 CALL pliego.sp_cart_add_item(buyer,ebook,1,cart,item,quantity);
 CALL pliego.sp_cart_add_item(buyer,audio,1,cart,item,quantity);
 CALL pliego.sp_cart_add_item(buyer,regular,1,cart,item,quantity);
 checkout_cart:=cart;
 SELECT pickup_location_id INTO pickup FROM pliego.fn_pickup_locations() LIMIT 1;
 CALL pliego.sp_checkout_idempotent(buyer,key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',pickup,order_id,state,pay,total,reference);
 SELECT * INTO pricing FROM pliego.fn_order_offer_pricing(order_id);
 IF pricing.original_subtotal IS DISTINCT FROM 214.88 OR pricing.savings_total IS DISTINCT FROM 40.98
 OR pricing.current_subtotal IS DISTINCT FROM 173.90 OR pricing.pricing_snapshot_available IS DISTINCT FROM TRUE
 OR total IS DISTINCT FROM 199.99 THEN RAISE EXCEPTION 'Stored order offer totals incorrect'; END IF;
 SELECT * INTO detail FROM pliego.fn_customer_order_detail_priced(buyer,order_id);
 enriched:=pliego.fn_order_item_offer_snapshots(detail.items);
 IF jsonb_array_length(enriched) IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'Historical projection dropped items'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(enriched) WITH ORDINALITY e(value,position)
 JOIN jsonb_array_elements(detail.items) WITH ORDINALITY d(value,position) USING(position)
 WHERE e.value-ARRAY['originalPrice','unitSavings','originalSubtotal','lineSavings','pricingSnapshotAvailable'] IS DISTINCT FROM d.value)
 THEN RAISE EXCEPTION 'Historical projection changed paid item values or ordering'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(enriched) LOOP
  IF (line->>'pricingSnapshotAvailable')::BOOLEAN IS DISTINCT FROM TRUE
  OR (line->>'originalPrice')::NUMERIC-(line->>'unitSavings')::NUMERIC IS DISTINCT FROM (line->>'unitPrice')::NUMERIC
  OR (line->>'originalSubtotal')::NUMERIC-(line->>'lineSavings')::NUMERIC IS DISTINCT FROM (line->>'subtotal')::NUMERIC
  THEN RAISE EXCEPTION 'Stored offer line invariant incorrect'; END IF;
  IF (line->>'editionId')::BIGINT=physical AND ((line->>'originalPrice')::NUMERIC IS DISTINCT FROM 79.95
   OR (line->>'unitSavings')::NUMERIC IS DISTINCT FROM 15.99 OR (line->>'originalSubtotal')::NUMERIC IS DISTINCT FROM 159.90
   OR (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 31.98)
  THEN RAISE EXCEPTION 'Physical quantity snapshot incorrect'; END IF;
  IF (line->>'editionId')::BIGINT=ebook AND (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 3.20
  THEN RAISE EXCEPTION 'Ebook snapshot incorrect'; END IF;
  IF (line->>'editionId')::BIGINT=audio AND (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 5.80
  THEN RAISE EXCEPTION 'Audiobook snapshot incorrect'; END IF;
  IF (line->>'editionId')::BIGINT=regular AND (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 0
  THEN RAISE EXCEPTION 'Regular snapshot incorrect'; END IF;
 END LOOP;
 SELECT * INTO raw_detail FROM pliego.fn_admin_order_detail_priced(actor,order_id);
 IF (pliego.fn_order_item_offer_snapshots(raw_detail.items)->0->>'pricingSnapshotAvailable')::BOOLEAN IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'Admin raw item identifiers were not enriched'; END IF;
 snapshots:=enriched;
 CALL pliego.sp_edition_offer_set(actor,physical,63.96,statement_timestamp()-INTERVAL '2 days',statement_timestamp(),offer);
 CALL pliego.sp_cart_add_item(buyer,physical,2,cart,item,quantity);
 SELECT * INTO quote FROM pliego.fn_cart_offer_quote(buyer);
 IF quote.current_subtotal IS DISTINCT FROM 159.90 OR quote.savings_total IS DISTINCT FROM 0
 THEN RAISE EXCEPTION 'New cart retained expired savings'; END IF;
 CALL pliego.sp_edition_offer_clear(actor,ebook);
 UPDATE pliego.edicion SET precio=99.95 WHERE edicion_id=physical;
 SELECT * INTO detail FROM pliego.fn_customer_order_detail_priced(buyer,order_id);
 IF pliego.fn_order_item_offer_snapshots(detail.items) IS DISTINCT FROM snapshots
 THEN RAISE EXCEPTION 'Catalog/offer mutations repriced historical item snapshots'; END IF;
 SELECT * INTO pricing FROM pliego.fn_order_offer_pricing(order_id);
 IF pricing.original_subtotal IS DISTINCT FROM 214.88 OR pricing.savings_total IS DISTINCT FROM 40.98
 OR pricing.current_subtotal IS DISTINCT FROM 173.90 THEN RAISE EXCEPTION 'Catalog mutations repriced historical order summary'; END IF;
 CALL pliego.sp_checkout_idempotent(buyer,key,NULL,'TRANSFER','APPROVED',checkout_cart,'STORE_PICKUP',pickup,replay,state,pay,total,reference);
 IF replay IS DISTINCT FROM order_id OR total IS DISTINCT FROM 199.99 THEN RAISE EXCEPTION 'Replay repriced historical order'; END IF;
 BEGIN
  UPDATE pliego.pedido_item SET precio_original_snapshot=100 WHERE pedido_id=order_id;
  RAISE EXCEPTION 'Historical offer snapshot accepted an update';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 CALL pliego.sp_edition_create(actor,book,publisher,'ORDER-OFFER-APPEND',NULL,'es','HARDCOVER',100,NULL,10.00,NULL,NULL,NULL,NULL,additional);
 BEGIN
  INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,
   formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
  VALUES(order_id,additional,'APPENDED-OFFER','Libro añadido','Autora','Editorial','HARDCOVER','es',10,1,10);
  RAISE EXCEPTION 'Historical order accepted an appended line';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 CALL pliego.sp_order_cancel(buyer,order_id,replay,previous,state,pay,restored);
 SELECT * INTO detail FROM pliego.fn_customer_order_detail_priced(buyer,order_id);
 IF pay IS DISTINCT FROM 'REFUNDED' OR pliego.fn_order_item_offer_snapshots(detail.items) IS DISTINCT FROM snapshots
 THEN RAISE EXCEPTION 'Cancellation/refund changed historical item savings'; END IF;
 SELECT * INTO pricing FROM pliego.fn_order_offer_pricing(order_id);
 IF pricing.original_subtotal IS DISTINCT FROM 214.88 OR pricing.savings_total IS DISTINCT FROM 40.98
 OR pricing.current_subtotal IS DISTINCT FROM 173.90 THEN RAISE EXCEPTION 'Cancellation/refund changed historical order summary'; END IF;
 BEGIN
  INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total)
  VALUES(customer,'PENDING_PAYMENT',0.05,0.05) RETURNING pedido_id INTO legacy_order;
  INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,
   formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
  VALUES(legacy_order,regular,'MISMATCH-OFFER','Libro','Autora','Editorial','HARDCOVER','es',0.05,1,0.05);
  RAISE EXCEPTION 'Snapshot accepted a paid price different from authoritative offer';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 -- Simulate a pre-V052 row without updating any immutable history. Only this
 -- new capture trigger is suspended inside the rolled-back fixture transaction.
 ALTER TABLE pliego.pedido_item DISABLE TRIGGER trg_pedido_item_offer_snapshot;
 INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total,impuesto_tasa,impuesto_monto,envio_monto)
 VALUES(customer,'CONFIRMED',10,11.50,15,1.50,0) RETURNING pedido_id INTO legacy_order;
 INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,
  formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal,impuesto_tasa,impuesto_monto)
 VALUES(legacy_order,regular,'LEGACY-ORDER-OFFER','Libro anterior','Autora anterior','Editorial anterior','HARDCOVER','es',10,1,10,15,1.50)
 RETURNING pedido_item_id INTO item;
 ALTER TABLE pliego.pedido_item ENABLE TRIGGER trg_pedido_item_offer_snapshot;
 SELECT * INTO pricing FROM pliego.fn_order_offer_pricing(legacy_order);
 line:=pliego.fn_order_item_offer_snapshots(jsonb_build_array(jsonb_build_object('orderItemId',item,'unitPrice',10,'subtotal',10)))->0;
 IF pricing.original_subtotal IS NOT NULL OR pricing.savings_total IS NOT NULL
 OR pricing.current_subtotal IS DISTINCT FROM 10 OR pricing.pricing_snapshot_available IS DISTINCT FROM FALSE
 OR line->'originalPrice' IS DISTINCT FROM 'null'::JSONB OR line->'unitSavings' IS DISTINCT FROM 'null'::JSONB
 OR line->'originalSubtotal' IS DISTINCT FROM 'null'::JSONB OR line->'lineSavings' IS DISTINCT FROM 'null'::JSONB
 OR (line->>'pricingSnapshotAvailable')::BOOLEAN IS DISTINCT FROM FALSE
 THEN RAISE EXCEPTION 'Legacy order fabricated original prices or savings'; END IF;
 IF pliego.fn_order_item_offer_snapshots('[]'::JSONB) IS DISTINCT FROM '[]'::JSONB
 THEN RAISE EXCEPTION 'Empty historical items changed'; END IF;
END $gate$;
ROLLBACK;
SELECT 'PASS: immutable order offer snapshots, formats, quantity, catalog mutations, replay, refund and unknown legacy originals';
