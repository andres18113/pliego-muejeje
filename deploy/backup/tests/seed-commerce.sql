-- Additional synthetic commerce fixture; callable only in WS1 disposable source.
\set ON_ERROR_STOP on
DO $guard$
BEGIN
 IF current_database()<>'pliego_benchmark' OR current_setting('port')<>'55481'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('server_version_num')::integer NOT BETWEEN 180000 AND 189999 THEN
  RAISE EXCEPTION 'Disposable WS1 source PG18 only'; END IF;
END $guard$;
DO $fixture$
DECLARE u bigint; addr bigint; edition bigint; cart bigint; item bigint; qty integer;
 ord bigint; ord_state varchar; pay_state varchar; total numeric; reference varchar; invoice bigint;
 admin bigint; job record; n integer;
BEGIN
 SELECT min(usuario_id) INTO admin FROM pliego.usuario WHERE rol='ADMIN';
 SELECT min(edicion_id) INTO edition FROM pliego.inventario;
 FOR n IN 1..6 LOOP
  SELECT usuario_id INTO u FROM pliego.usuario WHERE email_normalizado='perf-customer-'||lpad(n::text,3,'0')||'@example.invalid';
  SELECT min(direccion_id) INTO addr FROM pliego.direccion d JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id=u;
  CALL pliego.sp_cart_add_item(u,edition,1,cart,item,qty);
  CALL pliego.sp_checkout_billed_quoted(u,uuidv4(),addr,'TRANSFER','PENDING',cart,'HOME_DELIVERY',NULL,NULL,
   'OTHER','EC_CEDULA','1710034065','Comprador sintético','Dirección sintética',NULL,'Quito','Pichincha','EC',NULL,
   ord,ord_state,pay_state,total,reference,invoice);
  IF n<=4 THEN CALL pliego.sp_billed_order_approve(admin,ord); END IF;
  COMMIT;
 END LOOP;
 -- Persist synthetic bytea documents to prove dump restores invoice file content.
 FOR n IN 1..8 LOOP
  SELECT * INTO job FROM pliego.fn_invoice_artifact_claim();
  IF job.invoice_id IS NOT NULL THEN
   IF NOT pliego.fn_invoice_artifact_complete(job.invoice_id,job.file_type,job.lease_owner,
      convert_to('SYNTHETIC-ONLY-'||job.invoice_id||'-'||job.file_type,'UTF8')) THEN
    RAISE EXCEPTION 'Synthetic artifact completion failed'; END IF;
  END IF;
  COMMIT;
 END LOOP;
END $fixture$;
SELECT jsonb_build_object('orders',(SELECT count(*) FROM pliego.pedido),
 'invoices',(SELECT count(*) FROM pliego.factura),'issuedInvoices',(SELECT count(*) FROM pliego.factura WHERE estado='ISSUED'),
 'invoiceBytea',(SELECT count(*) FROM pliego.factura_archivo_contenido));
