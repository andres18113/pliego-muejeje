BEGIN;
DO $gate$
DECLARE a BIGINT; u BIGINT; customer BIGINT; author_id BIGINT; pub BIGINT; cat BIGINT; book BIGINT;
 edition BIGINT; movement BIGINT; before_stock INTEGER; after_stock INTEGER; cart BIGINT; item BIGINT; qty INTEGER;
 o BIGINT; replay BIGINT; invoice BIGINT; note BIGINT; location BIGINT; n INTEGER; state VARCHAR; pay VARCHAR; previous VARCHAR;
 total NUMERIC; ref VARCHAR; restored BIGINT; key UUID:=uuidv4(); quote RECORD; detail RECORD; money RECORD;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('money-gate-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
 CALL pliego.sp_author_create(a,'Autora monetaria',NULL,author_id);
 CALL pliego.sp_publisher_create(a,'Editorial monetaria',NULL,pub);
 CALL pliego.sp_category_create(a,'Monetaria','money-gate',NULL,NULL,cat);
 CALL pliego.sp_book_create(a,'Libro monetario',NULL,NULL,jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(cat),book);
 CALL pliego.sp_customer_register('money-gate@example.invalid','fixture','Ana','Pérez',NULL,u,customer,state);
 FOR n IN 1..4 LOOP
  CALL pliego.sp_edition_create(a,book,pub,('MONEY-GATE-'||n)::VARCHAR,NULL,'es','PAPERBACK',100,NULL,
   CASE WHEN n=4 THEN 7.25 ELSE 0.03 END,NULL,NULL,NULL,NULL,edition);
  CALL pliego.sp_inventory_entry(a,edition,10,'fixture',movement,before_stock,after_stock);
  CALL pliego.sp_cart_add_item(u,edition,CASE WHEN n=4 THEN 2 ELSE 1 END,cart,item,qty);
 END LOOP;
 SELECT * INTO quote FROM pliego.fn_cart_quote(u);
 IF quote.subtotal<>14.59 OR quote.tax_rate<>0.00 OR quote.tax_amount<>0.00 OR quote.shipping_amount<>0.00 OR quote.total<>14.59 OR quote.total_current<>14.59
 THEN RAISE EXCEPTION 'RED: cart monetary projection/line rounding incorrect'; END IF;
 SELECT pickup_location_id INTO location FROM pliego.fn_pickup_locations() LIMIT 1;
 CALL pliego.sp_checkout_idempotent(u,key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',location,o,state,pay,total,ref);
 SELECT * INTO money FROM pliego.fn_order_pricing(o);
 IF total<>14.59 OR money.subtotal<>14.59 OR money.tax_rate<>0.00 OR money.tax_amount<>0.00 OR money.shipping_amount<>0.00 OR money.total<>14.59
 OR (SELECT monto FROM pliego.pago WHERE pedido_id=o)<>14.59 THEN RAISE EXCEPTION 'checkout/order/payment mismatch'; END IF;
 IF (SELECT datos->>'taxRate' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)<>'0.00'
 OR (SELECT datos->>'taxAmount' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)<>'0.00'
 OR (SELECT datos->>'total' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)<>'14.59' THEN RAISE EXCEPTION 'mail omitted authoritative totals'; END IF;
 UPDATE pliego.edicion SET precio=99.00 WHERE edicion_id=edition;
 CALL pliego.sp_checkout_idempotent(u,key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',location,replay,state,pay,total,ref);
 IF replay<>o OR total<>14.59 THEN RAISE EXCEPTION 'replay repriced order'; END IF;
 CALL pliego.sp_invoice_issue(a,o,'MONEY-INVOICE','Ana Pérez','OTHER','fixture','money-gate@example.invalid','Fiscal',NULL,'Quito','Pichincha','EC',NULL,invoice);
 SELECT * INTO detail FROM pliego.fn_customer_order_detail_priced(u,o);
 IF detail.tax_rate<>0.00 OR detail.tax_amount<>0.00 OR detail.shipping_amount<>0.00
 OR (detail.invoice->>'subtotal')::NUMERIC<>14.59 OR (detail.invoice->>'taxTotal')::NUMERIC<>0.00 OR (detail.invoice->>'total')::NUMERIC<>14.59
 OR (SELECT sum(fi.total) FROM pliego.factura_item fi WHERE fi.factura_id=invoice)<>14.59 THEN RAISE EXCEPTION 'order/invoice header/line mismatch'; END IF;
 IF EXISTS(SELECT FROM pliego.factura_item WHERE factura_id=invoice AND tratamiento_impuesto<>'NOT_ASSESSED') THEN RAISE EXCEPTION 'zero-rated invoice reported assessed tax'; END IF;
 BEGIN
  UPDATE pliego.pedido p SET envio_monto=1,total=p.total+1 WHERE pedido_id=o;
  RAISE EXCEPTION 'historical money mutable';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 CALL pliego.sp_order_cancel(u,o,replay,previous,state,pay,restored);
 CALL pliego.sp_credit_note_issue(a,o,'MONEY-CREDIT','Cancelación',note);
 IF (SELECT nc.total FROM pliego.nota_credito nc WHERE nc.nota_credito_id=note)<>14.59 OR (SELECT nc.impuesto_total FROM pliego.nota_credito nc WHERE nc.nota_credito_id=note)<>0.00 THEN
  RAISE EXCEPTION 'credit did not preserve invoice amounts'; END IF;
 SELECT * INTO quote FROM pliego.fn_cart_quote(u);
 IF quote.subtotal<>0 OR quote.tax_amount<>0 OR quote.shipping_amount<>0 OR quote.total<>0 THEN RAISE EXCEPTION 'empty cart charged money'; END IF;
END $gate$;
ROLLBACK;
