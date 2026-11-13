-- All effects roll back; run after Flyway V089.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL enable_hashjoin=off;
SET LOCAL enable_nestloop=off;
SET LOCAL jit=off;
DO $gate$
DECLARE actor BIGINT; customer BIGINT; admin BIGINT; state VARCHAR; order_id BIGINT; first_reference VARCHAR;
 other_actor BIGINT; other_customer BIGINT; row_ref VARCHAR; result JSONB; n INTEGER;
BEGIN
 CALL pliego.sp_customer_register('reference-gate@example.invalid','fixture','Ana','Referencia',NULL,actor,customer,state);
 CALL pliego.sp_customer_register('reference-other@example.invalid','fixture','Otra','Persona',NULL,other_actor,other_customer,state);
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('reference-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO admin;
 FOR n IN 1..200 LOOP
  INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total) VALUES(customer,'PENDING_PAYMENT',1,1) RETURNING pedido_id,referencia_publica INTO order_id,row_ref;
  IF row_ref !~ '^PL-[0-9]{4}-[0-9]{4}$' THEN RAISE EXCEPTION 'reference format invalid: %',row_ref; END IF;
  INSERT INTO pliego.pago(pedido_id,metodo,estado,monto) VALUES(order_id,'TRANSFER','PENDING',1);
 END LOOP;
 first_reference:=row_ref;
 IF (SELECT count(*)<>count(DISTINCT referencia_publica) FROM pliego.pedido) THEN RAISE EXCEPTION 'references not unique'; END IF;
 IF pliego.fn_order_reference(order_id)<>first_reference THEN RAISE EXCEPTION 'checkout reference helper mismatches'; END IF;
 BEGIN
  UPDATE pliego.pedido SET referencia_publica='PL-0000-0000' WHERE pedido_id=order_id;
  RAISE EXCEPTION 'reference mutated';
 EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL; END;
 IF NOT EXISTS(SELECT FROM pliego.fn_admin_orders(admin,NULL,NULL,NULL,NULL,0,20,replace(lower(first_reference),'pl-','')) o WHERE o.order_reference=first_reference) THEN RAISE EXCEPTION 'normalized reference admin search failed'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_admin_orders(admin,NULL,NULL,NULL,NULL,0,20,'  '||replace(lower(first_reference),'-',' ')||'  ') o WHERE o.order_reference=first_reference) THEN RAISE EXCEPTION 'spaced reference admin search failed'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_orders(actor,0,20) o WHERE o.order_reference=first_reference) THEN RAISE EXCEPTION 'customer list missing reference'; END IF;
 IF (SELECT order_reference FROM pliego.fn_customer_order_detail(actor,order_id))<>first_reference THEN RAISE EXCEPTION 'customer detail missing reference'; END IF;
 BEGIN
  PERFORM * FROM pliego.fn_customer_order_detail(other_actor,order_id);
  RAISE EXCEPTION 'foreign customer order leaked';
 EXCEPTION WHEN SQLSTATE 'P5001' THEN NULL; END;
 IF (SELECT order_reference FROM pliego.fn_customer_order_detail_priced(actor,order_id))<>first_reference THEN RAISE EXCEPTION 'priced detail missing reference'; END IF;
 IF (SELECT order_reference FROM pliego.fn_admin_order_detail_priced(admin,order_id))<>first_reference THEN RAISE EXCEPTION 'admin detail missing reference'; END IF;
 SET LOCAL enable_hashjoin=off;
 IF (SELECT array_agg(o.order_id ORDER BY o.ordinality) IS DISTINCT FROM array_agg(o.order_id ORDER BY o.created_at DESC,o.order_id DESC)
     FROM pliego.fn_customer_orders(actor,0,20) WITH ORDINALITY o) THEN
  RAISE EXCEPTION 'customer order reference wrapper lost newest-first ordering'; END IF;
 result:=pliego.fn_order_mail_snapshot(order_id,'DIGITAL','PENDING_PAYMENT',clock_timestamp(),TRUE);
 IF result->>'orderReference'<>first_reference THEN RAISE EXCEPTION 'mail snapshot missing reference'; END IF;
END; $gate$;
ROLLBACK;
\echo 'Order public reference gate passed (format, uniqueness, immutability, normalized search, scoped projections, mail).'
