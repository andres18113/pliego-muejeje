\set ON_ERROR_STOP on
BEGIN;
DO $gate$
DECLARE
 actor BIGINT; buyer BIGINT; customer BIGINT; author BIGINT; publisher BIGINT; book BIGINT; category BIGINT;
 physical BIGINT; ebook BIGINT; audio BIGINT; regular BIGINT; offer BIGINT;
 movement BIGINT; stock_before INTEGER; stock_after INTEGER; cart BIGINT; item BIGINT; quantity INTEGER;
 order_id BIGINT; replay BIGINT; pickup BIGINT; state VARCHAR; pay VARCHAR; total NUMERIC; reference VARCHAR;
 key UUID:=uuidv4(); quote RECORD; legacy RECORD; line JSONB; pricing RECORD;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('cart-offer-projection-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO actor;
 CALL pliego.sp_author_create(actor,'Autora proyección de carrito',NULL,author);
 CALL pliego.sp_publisher_create(actor,'Editorial proyección de carrito',NULL,publisher);
 CALL pliego.sp_category_create(actor,'Proyección de carrito','cart-offer-projection',NULL,NULL,category);
 CALL pliego.sp_book_create(actor,'Libro de proyección de carrito',NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author,'order',1)),jsonb_build_array(category),book);
 CALL pliego.sp_customer_register('cart-offer-projection@example.invalid','fixture','Ana','Pérez',NULL,buyer,customer,state);
 SELECT * INTO quote FROM pliego.fn_cart_offer_quote(buyer);
 IF quote.original_subtotal IS DISTINCT FROM 0 OR quote.savings_total IS DISTINCT FROM 0 OR quote.current_subtotal IS DISTINCT FROM 0 OR quote.items IS DISTINCT FROM '[]'::JSONB
 THEN RAISE EXCEPTION 'Empty cart monetary projection incorrect'; END IF;
 CALL pliego.sp_edition_create(actor,book,publisher,'CART-OFFER-PHYSICAL',NULL,'es','PAPERBACK',100,NULL,79.95,NULL,NULL,NULL,NULL,physical);
 CALL pliego.sp_inventory_entry(actor,physical,10,'fixture',movement,stock_before,stock_after);
 CALL pliego.sp_edition_create(actor,book,publisher,'CART-OFFER-EBOOK',NULL,'es','EBOOK',NULL,NULL,15.99,NULL,NULL,NULL,NULL,NULL,NULL,NULL,ebook);
 CALL pliego.sp_edition_create(actor,book,publisher,'CART-OFFER-AUDIO',NULL,'es','AUDIOBOOK',NULL,NULL,28.99,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Narrador DEMO'],audio);
 CALL pliego.sp_edition_create(actor,book,publisher,'CART-OFFER-REGULAR',NULL,'es','HARDCOVER',100,NULL,10.00,NULL,NULL,NULL,NULL,regular);
 CALL pliego.sp_inventory_entry(actor,regular,10,'fixture',movement,stock_before,stock_after);
 CALL pliego.sp_edition_offer_set(actor,physical,63.96,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '3 days',offer);
 CALL pliego.sp_edition_offer_set(actor,ebook,12.79,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '7 days',offer);
 CALL pliego.sp_edition_offer_set(actor,audio,23.19,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '15 days',offer);
 CALL pliego.sp_cart_add_item(buyer,physical,2,cart,item,quantity);
 SELECT * INTO quote FROM pliego.fn_cart_offer_quote(buyer);
 line:=quote.items->0;
 IF (line->>'originalPrice')::NUMERIC IS DISTINCT FROM 79.95 OR (line->>'currentPrice')::NUMERIC IS DISTINCT FROM 63.96
 OR (line->>'unitSavings')::NUMERIC IS DISTINCT FROM 15.99 OR (line->>'originalSubtotal')::NUMERIC IS DISTINCT FROM 159.90
 OR (line->>'currentSubtotal')::NUMERIC IS DISTINCT FROM 127.92 OR (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 31.98
 THEN RAISE EXCEPTION 'Physical quantity > 1 offer projection incorrect'; END IF;
 CALL pliego.sp_cart_add_item(buyer,ebook,1,cart,item,quantity);
 CALL pliego.sp_cart_add_item(buyer,audio,1,cart,item,quantity);
 CALL pliego.sp_cart_add_item(buyer,regular,1,cart,item,quantity);
 SELECT * INTO quote FROM pliego.fn_cart_offer_quote(buyer);
 SELECT * INTO legacy FROM pliego.fn_cart_quote(buyer);
 IF jsonb_array_length(quote.items) IS DISTINCT FROM jsonb_array_length(legacy.items)
 THEN RAISE EXCEPTION 'Cart projection dropped existing lines'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(quote.items) WITH ORDINALITY AS q(value,position)
 JOIN jsonb_array_elements(legacy.items) WITH ORDINALITY AS l(value,position) USING(position)
 WHERE q.value - ARRAY['originalPrice','unitSavings','originalSubtotal','lineSavings']  IS DISTINCT FROM  l.value)
 THEN RAISE EXCEPTION 'Existing item values or ordering changed'; END IF;
 IF quote.original_subtotal IS DISTINCT FROM 214.88 OR quote.savings_total IS DISTINCT FROM 40.98 OR quote.current_subtotal IS DISTINCT FROM 173.90
 OR quote.tax_amount IS DISTINCT FROM 26.09 OR quote.total IS DISTINCT FROM 199.99 THEN RAISE EXCEPTION 'Mixed simultaneous-offer totals incorrect'; END IF;
 IF quote.original_subtotal-quote.savings_total IS DISTINCT FROM quote.current_subtotal
 OR quote.current_subtotal+quote.tax_amount+quote.shipping_amount IS DISTINCT FROM quote.total
 OR quote.current_subtotal IS DISTINCT FROM quote.subtotal OR quote.subtotal IS DISTINCT FROM legacy.subtotal
 OR quote.total IS DISTINCT FROM legacy.total OR quote.total_current IS DISTINCT FROM legacy.total_current
 OR quote.tax_amount IS DISTINCT FROM legacy.tax_amount THEN RAISE EXCEPTION 'Summary invariant or legacy contract changed'; END IF;
 IF quote.cart_id IS DISTINCT FROM legacy.cart_id OR quote.state IS DISTINCT FROM legacy.state
 OR quote.tax_rate IS DISTINCT FROM legacy.tax_rate OR quote.shipping_amount IS DISTINCT FROM legacy.shipping_amount
 THEN RAISE EXCEPTION 'Legacy quote identity, tax rate or shipping changed'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(quote.items) LOOP
  IF (line->>'originalSubtotal')::NUMERIC-(line->>'lineSavings')::NUMERIC IS DISTINCT FROM (line->>'currentSubtotal')::NUMERIC
  OR (line->>'originalPrice')::NUMERIC-(line->>'unitSavings')::NUMERIC IS DISTINCT FROM (line->>'currentPrice')::NUMERIC
  THEN RAISE EXCEPTION 'Line invariant incorrect'; END IF;
  IF (line->>'editionId')::BIGINT=ebook AND ((line->>'unitSavings')::NUMERIC IS DISTINCT FROM 3.20 OR (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 3.20)
  THEN RAISE EXCEPTION 'Ebook savings incorrect'; END IF;
  IF (line->>'editionId')::BIGINT=audio AND ((line->>'unitSavings')::NUMERIC IS DISTINCT FROM 5.80 OR (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 5.80)
  THEN RAISE EXCEPTION 'Audiobook savings incorrect'; END IF;
  IF (line->>'editionId')::BIGINT=regular AND ((line->>'unitSavings')::NUMERIC IS DISTINCT FROM 0 OR (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 0)
  THEN RAISE EXCEPTION 'Non-discounted item received savings'; END IF;
 END LOOP;
 CALL pliego.sp_edition_offer_set(actor,physical,63.96,statement_timestamp()-INTERVAL '2 days',statement_timestamp(),offer);
 SELECT * INTO quote FROM pliego.fn_cart_offer_quote(buyer);
 SELECT value INTO line FROM jsonb_array_elements(quote.items) WHERE (value->>'editionId')::BIGINT=physical;
 IF (line->>'currentPrice')::NUMERIC IS DISTINCT FROM 79.95 OR (line->>'unitSavings')::NUMERIC IS DISTINCT FROM 0
 OR (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 0 OR quote.savings_total IS DISTINCT FROM 9.00
 OR quote.current_subtotal IS DISTINCT FROM 205.88 OR quote.original_subtotal-quote.savings_total IS DISTINCT FROM quote.current_subtotal
 THEN RAISE EXCEPTION 'Expired offer retained stale cart savings'; END IF;
 CALL pliego.sp_edition_offer_set(actor,physical,63.96,statement_timestamp(),statement_timestamp()+INTERVAL '3 days',offer);
 CALL pliego.sp_edition_offer_clear(actor,ebook);
 SELECT value INTO line FROM pliego.fn_cart_offer_quote(buyer) q,
  LATERAL jsonb_array_elements(q.items) WHERE (value->>'editionId')::BIGINT=ebook;
 IF (line->>'currentPrice')::NUMERIC IS DISTINCT FROM 15.99
 OR (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Cleared offer retained stale savings'; END IF;
 CALL pliego.sp_edition_offer_set(actor,ebook,12.79,statement_timestamp(),statement_timestamp()+INTERVAL '7 days',offer);
 -- Existing base-price suppression, future offers, and deactivation also remove savings.
 CALL pliego.sp_edition_offer_set(actor,regular,8.00,statement_timestamp()+INTERVAL '1 day',statement_timestamp()+INTERVAL '2 days',offer);
 SELECT value INTO line FROM pliego.fn_cart_offer_quote(buyer) q,
  LATERAL jsonb_array_elements(q.items) WHERE (value->>'editionId')::BIGINT=regular;
 IF (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Future offer applied cart savings'; END IF;
 CALL pliego.sp_edition_offer_clear(actor,regular);
 UPDATE pliego.edicion SET precio=60.00 WHERE edicion_id=physical;
 SELECT value INTO line FROM pliego.fn_cart_offer_quote(buyer) q,
  LATERAL jsonb_array_elements(q.items) WHERE (value->>'editionId')::BIGINT=physical;
 IF (line->>'originalPrice')::NUMERIC IS DISTINCT FROM 60.00 OR (line->>'currentPrice')::NUMERIC IS DISTINCT FROM 60.00
 OR (line->>'lineSavings')::NUMERIC IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Suppressed offer increased price or savings'; END IF;
 UPDATE pliego.edicion SET precio=79.95 WHERE edicion_id=physical;
 SELECT * INTO quote FROM pliego.fn_cart_offer_quote(buyer);
 SELECT pickup_location_id INTO pickup FROM pliego.fn_pickup_locations() LIMIT 1;
 CALL pliego.sp_checkout_idempotent(buyer,key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',pickup,order_id,state,pay,total,reference);
 SELECT * INTO pricing FROM pliego.fn_order_pricing(order_id);
 IF total IS DISTINCT FROM 199.99 OR total IS DISTINCT FROM quote.total OR pricing.subtotal IS DISTINCT FROM 173.90 OR pricing.tax_amount IS DISTINCT FROM 26.09
 OR (SELECT sum(subtotal) FROM pliego.pedido_item WHERE pedido_id=order_id) IS DISTINCT FROM 173.90
 THEN RAISE EXCEPTION 'Checkout repriced authoritative offer totals'; END IF;
 CALL pliego.sp_edition_offer_clear(actor,physical);
 CALL pliego.sp_checkout_idempotent(buyer,key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',pickup,replay,state,pay,total,reference);
 IF replay IS DISTINCT FROM order_id OR total IS DISTINCT FROM 199.99 THEN RAISE EXCEPTION 'Offer mutation changed historical checkout replay'; END IF;
END $gate$;
ROLLBACK;
SELECT 'PASS: cart offer projection, quantity, formats, mixed offers, expiry, taxes, invariants and checkout compatibility';
