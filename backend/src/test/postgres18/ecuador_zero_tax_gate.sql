-- Disposable PostgreSQL gate: real mixed-format commands, not a mocked tax function.
BEGIN;
DO $gate$
DECLARE
 a BIGINT; u BIGINT; customer BIGINT; author_id BIGINT; pub BIGINT; cat BIGINT; book BIGINT;
 edition BIGINT; physical BIGINT; offer BIGINT; movement BIGINT; before_stock INTEGER; after_stock INTEGER;
 cart BIGINT; item BIGINT; qty INTEGER; location BIGINT; o BIGINT; replay BIGINT; invoice BIGINT; note BIGINT;
 state VARCHAR; pay VARCHAR; previous VARCHAR; restored BIGINT; total NUMERIC; ref VARCHAR;
 key UUID:=uuidv4(); quote RECORD; detail RECORD; n INTEGER;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('ecuador-tax-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
 CALL pliego.sp_author_create(a,'Autora tributaria',NULL,author_id);
 CALL pliego.sp_publisher_create(a,'Editorial tributaria',NULL,pub);
 CALL pliego.sp_category_create(a,'Tributaria','ecuador-tax-gate',NULL,NULL,cat);
 CALL pliego.sp_book_create(a,'Libro tributario',NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(cat),book);
 CALL pliego.sp_customer_register('ecuador-tax-customer@example.invalid','fixture','Ana','Pérez',NULL,u,customer,state);
 FOR n IN 1..3 LOOP
  CALL pliego.sp_edition_create(a,book,pub,('ECUADOR-TAX-'||n)::VARCHAR,NULL,'es',
   CASE n WHEN 1 THEN 'PAPERBACK' WHEN 2 THEN 'EBOOK' ELSE 'AUDIOBOOK' END,
   CASE WHEN n=1 THEN 100 ELSE NULL END,NULL,
   CASE n WHEN 1 THEN 10.00 WHEN 2 THEN 5.00 ELSE 7.00 END,NULL,NULL,NULL,NULL,NULL,
   CASE WHEN n=3 THEN 3600 ELSE NULL END,CASE WHEN n=3 THEN ARRAY['Narradora tributaria'] ELSE NULL END,edition);
  IF n=1 THEN
   physical:=edition;
   CALL pliego.sp_inventory_entry(a,edition,10,'fixture',movement,before_stock,after_stock);
  END IF;
  CALL pliego.sp_edition_offer_set(a,edition,
   CASE n WHEN 1 THEN 8.00 WHEN 2 THEN 4.00 ELSE 6.00 END,
   statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '1 day',offer);
  CALL pliego.sp_cart_add_item(u,edition,CASE WHEN n=1 THEN 2 ELSE 1 END,cart,item,qty);
 END LOOP;
 SELECT * INTO quote FROM pliego.fn_cart_checkout_quote(u);
 IF quote.original_subtotal<>32.00 OR quote.savings_total<>6.00 OR quote.current_subtotal<>26.00
 OR quote.subtotal<>26.00 OR quote.tax_rate<>0 OR quote.tax_amount<>0 OR quote.shipping_amount<>0
 OR quote.total<>26.00 OR quote.total_current<>26.00 OR jsonb_array_length(quote.items)<>3
 THEN RAISE EXCEPTION 'RED: Ecuador mixed-format quote must preserve discounts and charge zero IVA'; END IF;
 SELECT pickup_location_id INTO location FROM pliego.fn_pickup_locations() LIMIT 1;
 CALL pliego.sp_checkout_quoted(u,key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',location,
  quote.quote_fingerprint::VARCHAR,o,state,pay,total,ref);
 IF total<>26.00 OR (SELECT monto FROM pliego.pago WHERE pedido_id=o)<>26.00
 OR EXISTS(SELECT FROM pliego.pedido_item WHERE pedido_id=o AND (impuesto_tasa<>0 OR impuesto_monto<>0))
 OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>8
 THEN RAISE EXCEPTION 'zero-IVA checkout/payment/line snapshots or inventory invalid'; END IF;
 CALL pliego.sp_invoice_issue(a,o,'ECUADOR-TAX-INVOICE','Ana Pérez','OTHER','fixture',
  'ecuador-tax-customer@example.invalid','Fiscal',NULL,'Quito','Pichincha','EC',NULL,invoice);
 SELECT * INTO detail FROM pliego.fn_customer_order_detail_priced(u,o);
 IF detail.tax_rate<>0 OR detail.tax_amount<>0 OR detail.total<>26.00
 OR (detail.invoice->>'taxTotal')::NUMERIC<>0 OR (detail.invoice->>'total')::NUMERIC<>26.00
 OR EXISTS(SELECT FROM pliego.factura_item WHERE factura_id=invoice
  AND (tratamiento_impuesto<>'NOT_ASSESSED' OR impuesto_tasa IS NOT NULL OR impuesto_monto<>0))
 OR (SELECT datos->>'taxRate' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)<>'0.00'
 OR (SELECT datos->>'taxAmount' FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:'||o)<>'0.00'
 THEN RAISE EXCEPTION 'order/invoice/outbox do not expose authoritative zero IVA'; END IF;
 CALL pliego.sp_order_cancel(u,o,replay,previous,state,pay,restored);
 CALL pliego.sp_credit_note_issue(a,o,'ECUADOR-TAX-CREDIT','Cancelación',note);
 IF (SELECT nc.impuesto_total FROM pliego.nota_credito nc WHERE nc.nota_credito_id=note)<>0
 OR (SELECT nc.total FROM pliego.nota_credito nc WHERE nc.nota_credito_id=note)<>26.00
 THEN RAISE EXCEPTION 'credit note changed zero-IVA snapshots'; END IF;
 CALL pliego.sp_checkout_quoted(u,key,NULL,'TRANSFER','APPROVED',cart,'STORE_PICKUP',location,
  quote.quote_fingerprint::VARCHAR,replay,state,pay,total,ref);
 IF replay<>o OR total<>26.00 THEN RAISE EXCEPTION 'zero-IVA receipt replay changed'; END IF;
END $gate$;
ROLLBACK;
