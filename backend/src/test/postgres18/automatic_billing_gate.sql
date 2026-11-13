BEGIN;
CREATE FUNCTION pg_temp.fail_invoice_test() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('pliego.test_fail_invoice',TRUE)='on' THEN RAISE EXCEPTION 'INJECTED_INVOICE_FAILURE' USING ERRCODE='XX000'; END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER trg_invoice_test_failure AFTER INSERT ON pliego.factura FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_invoice_test();
DO $gate$
DECLARE
v_admin BIGINT; v_author BIGINT; v_publisher BIGINT; v_category BIGINT; v_book BIGINT;
v_edition1 BIGINT; v_edition2 BIGINT; v_movement BIGINT; v_before INTEGER; v_after INTEGER;
v_user BIGINT; v_customer BIGINT; v_user_state VARCHAR; v_address BIGINT; v_cart BIGINT; v_item BIGINT; v_quantity INTEGER;
v_order BIGINT; v_order_state VARCHAR; v_payment_state VARCHAR; v_total NUMERIC; v_reference VARCHAR;
v_invoice BIGINT; v_snapshot JSONB; v_key UUID:=uuidv4(); v_pending BIGINT; v_credit BIGINT; v_other BIGINT; v_other_customer BIGINT; v_count BIGINT;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES ('billing-core-gate-admin@pliego.local','fixture-hash','ADMIN','ACTIVE')
    RETURNING usuario_id INTO v_admin;

    CALL pliego.sp_author_create(v_admin,'Autor I8',NULL,v_author);
    CALL pliego.sp_publisher_create(v_admin,'Editorial I8',NULL,v_publisher);
    CALL pliego.sp_category_create(v_admin,'Categoría I8','billing-core-gate-category',NULL,NULL,v_category);
    CALL pliego.sp_book_create(v_admin,'Libro I8',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',v_author,'order',1)),
        jsonb_build_array(v_category),v_book);
    CALL pliego.sp_edition_create(v_admin,v_book,v_publisher,'BILLING-CORE-1','9780306406157',
        'es','PAPERBACK',100,NULL,15.50,NULL,NULL,NULL,NULL,v_edition1);
    CALL pliego.sp_edition_create(v_admin,v_book,v_publisher,'BILLING-CORE-2',NULL,
        'es','HARDCOVER',100,NULL,12.35,NULL,NULL,NULL,NULL,v_edition2);
    CALL pliego.sp_inventory_entry(v_admin,v_edition1,5,'fixture',v_movement,v_before,v_after);
    CALL pliego.sp_inventory_entry(v_admin,v_edition2,5,'fixture',v_movement,v_before,v_after);
    CALL pliego.sp_customer_register('billing-core-gate-customer@pliego.local','fixture-hash',
        'Cliente','Prueba',NULL,v_user,v_customer,v_user_state);
    CALL pliego.sp_address_create(v_user,'Casa','Cliente Prueba','Calle I8',NULL,
        'Quito','Pichincha','EC',NULL,'Referencia I8','+59325550134',TRUE,v_address);
    CALL pliego.sp_cart_add_item(v_user,v_edition1,2,v_cart,v_item,v_quantity);
    CALL pliego.sp_cart_add_item(v_user,v_edition2,1,v_cart,v_item,v_quantity);


CALL pliego.sp_checkout_billed_quoted(v_user,v_key,v_address,'CARD','APPROVED',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0912345675','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
IF v_order_state<>'CONFIRMED' OR v_payment_state<>'APPROVED' OR v_invoice IS NULL THEN RAISE EXCEPTION 'approved invoice missing'; END IF;
v_snapshot:=pliego.fn_invoice_snapshot(v_user,v_order);
IF v_snapshot->>'state'<>'ISSUED' OR v_snapshot->>'provenance'<>'SIMULATED' OR v_snapshot->'billingAddress'->>'line1'<>'Direccion Fiscal' THEN RAISE EXCEPTION 'snapshot mismatch'; END IF;
IF (SELECT total FROM pliego.factura WHERE factura_id=v_invoice)<>v_total THEN RAISE EXCEPTION 'invoice monetary drift'; END IF;
CALL pliego.sp_checkout_billed_quoted(v_user,v_key,v_address,'CARD','APPROVED',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0912345675','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
IF (SELECT count(*) FROM pliego.factura WHERE pedido_id=v_order)<>1 THEN RAISE EXCEPTION 'duplicate invoice'; END IF;
-- The first billed purchase binds its validated cédula to the customer, once and audited.
IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(v_user) WHERE identity_number='0912345675')
 OR (SELECT count(*) FROM pliego.cliente_identificacion_evento WHERE cliente_id=v_customer AND accion='REGISTERED' AND origen='CHECKOUT')<>1 THEN
 RAISE EXCEPTION 'checkout did not bind the customer cedula'; END IF;
BEGIN
CALL pliego.sp_checkout_billed_quoted(v_user,v_key,v_address,'CARD','APPROVED',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0912345675','Otro Comprador','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
RAISE EXCEPTION 'fiscal conflict accepted'; EXCEPTION WHEN SQLSTATE 'P1010' THEN NULL; END;
CALL pliego.sp_customer_register('billing-other@pliego.local','fixture-hash','Otro','Cliente',NULL,v_other,v_other_customer,v_user_state);
BEGIN
 PERFORM pliego.fn_invoice_snapshot(v_other,v_order); RAISE EXCEPTION 'cross-owner read allowed';
EXCEPTION WHEN SQLSTATE 'P5001' THEN NULL; END;
BEGIN
 UPDATE pliego.factura SET comprador_nombre='Alterado' WHERE factura_id=v_invoice;
 RAISE EXCEPTION 'issued invoice mutated'; EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
BEGIN
 CALL pliego.sp_checkout_quoted(v_user,v_key,v_address,'CARD','APPROVED',v_cart,'HOME_DELIVERY',NULL,NULL,v_order,v_order_state,v_payment_state,v_total,v_reference);
 RAISE EXCEPTION 'legacy replay omitted fiscal payload'; EXCEPTION WHEN SQLSTATE 'P1010' THEN NULL; END;
BEGIN
 CALL pliego.sp_checkout_idempotent(v_user,v_key,v_address,'CARD','APPROVED',v_cart,'HOME_DELIVERY',NULL,v_order,v_order_state,v_payment_state,v_total,v_reference);
 RAISE EXCEPTION 'legacy idempotent fulfillment omitted fiscal payload'; EXCEPTION WHEN SQLSTATE 'P1010' THEN NULL; END;
BEGIN
 CALL pliego.sp_checkout_idempotent(v_user,v_key,v_address,'CARD','APPROVED',v_cart,v_order,v_order_state,v_payment_state,v_total,v_reference);
 RAISE EXCEPTION 'legacy idempotent omitted fiscal payload'; EXCEPTION WHEN SQLSTATE 'P1010' THEN NULL; END;
IF to_regprocedure('pliego.sp_checkout_quoted_internal_v065(bigint,uuid,bigint,character varying,character varying,bigint,character varying,bigint,character varying)') IS NOT NULL THEN RAISE EXCEPTION 'unprotected quoted helper still public'; END IF;
CALL pliego.sp_order_cancel(v_user,v_order,v_pending,v_order_state,v_payment_state,v_user_state,v_movement);
IF (SELECT count(*) FROM pliego.nota_credito WHERE factura_id=v_invoice)<>1 THEN RAISE EXCEPTION 'credit missing'; END IF;
CALL pliego.sp_invoice_credit_after_refund(v_user,v_order,'Cancelacion',v_credit);
IF (SELECT count(*) FROM pliego.nota_credito WHERE factura_id=v_invoice)<>1 THEN RAISE EXCEPTION 'duplicate credit'; END IF;
CALL pliego.sp_cart_add_item(v_user,v_edition1,1,v_cart,v_item,v_quantity);
v_key:=uuidv4();
CALL pliego.sp_checkout_billed_quoted(v_user,v_key,v_address,'TRANSFER','PENDING',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0912345675','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_pending,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
IF v_order_state<>'PENDING_PAYMENT' OR v_payment_state<>'PENDING' OR (SELECT estado FROM pliego.factura WHERE factura_id=v_invoice)<>'DRAFT' THEN RAISE EXCEPTION 'pending draft mismatch'; END IF;
CALL pliego.sp_billed_order_approve(v_admin,v_pending);
IF (SELECT estado FROM pliego.factura WHERE factura_id=v_invoice)<>'ISSUED' THEN RAISE EXCEPTION 'approval did not issue'; END IF;
CALL pliego.sp_billed_order_approve(v_admin,v_pending);
-- Pending cancellation invalidates a draft without stock restoration or credit.
v_key:=uuidv4();
CALL pliego.sp_cart_add_item(v_user,v_edition1,1,v_cart,v_item,v_quantity);
CALL pliego.sp_checkout_billed_quoted(v_user,v_key,v_address,'TRANSFER','PENDING',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0912345675','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
IF NOT EXISTS(SELECT FROM pliego.fn_order_post_purchase(v_order) WHERE
 (available_actions->>'canCancel')::BOOLEAN AND (available_actions->>'cancel')::BOOLEAN
 AND available_actions->>'lifecycleState'='PENDING_PAYMENT' AND available_actions->>'cancellationDeadline' IS NULL) THEN RAISE EXCEPTION 'pending cancellation hidden from projection'; END IF;
SELECT stock_actual INTO v_before FROM pliego.inventario WHERE edicion_id=v_edition1;
CALL pliego.sp_order_cancel(v_user,v_order,v_pending,v_order_state,v_payment_state,v_user_state,v_movement);
IF (SELECT estado FROM pliego.factura WHERE factura_id=v_invoice)<>'VOID' OR v_movement<>0 OR
 (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_edition1)<>v_before OR
 EXISTS(SELECT FROM pliego.nota_credito WHERE factura_id=v_invoice) THEN RAISE EXCEPTION 'pending cancellation mutated fiscal/stock history'; END IF;
-- Immutable receipt remains the original accepted result; detail is authoritative now.
CALL pliego.sp_checkout_billed_quoted(v_user,v_key,v_address,'TRANSFER','PENDING',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0912345675','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
IF v_order_state<>'PENDING_PAYMENT' OR v_payment_state<>'PENDING' OR
 (SELECT estado FROM pliego.pedido WHERE pedido_id=v_order)<>'CANCELLED' OR
 (SELECT estado FROM pliego.factura WHERE factura_id=v_invoice)<>'VOID' THEN RAISE EXCEPTION 'cancelled pending replay rewrote receipt'; END IF;
-- Invalid fiscal identity cannot create any business effects.
CALL pliego.sp_cart_add_item(v_user,v_edition1,1,v_cart,v_item,v_quantity);
SELECT count(*) INTO v_count FROM pliego.pedido WHERE cliente_id=v_customer;
BEGIN
CALL pliego.sp_checkout_billed_quoted(v_user,uuidv4(),v_address,'TRANSFER','APPROVED',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0012345670','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
RAISE EXCEPTION 'invalid fiscal identity accepted'; EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
IF (SELECT count(*) FROM pliego.pedido WHERE cliente_id=v_customer)<>v_count THEN RAISE EXCEPTION 'invalid billing created order'; END IF;
CALL pliego.sp_checkout_billed_quoted(v_user,uuidv4(),v_address,'TRANSFER','REJECTED',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0912345675','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
IF v_invoice IS NOT NULL OR EXISTS(SELECT FROM pliego.factura WHERE pedido_id=v_order) THEN RAISE EXCEPTION 'rejected payment issued document'; END IF;
SELECT count(*) INTO v_count FROM pliego.pedido WHERE cliente_id=v_customer;
SELECT stock_actual INTO v_before FROM pliego.inventario WHERE edicion_id=v_edition1;
PERFORM set_config('pliego.test_fail_invoice','on',TRUE);
BEGIN
CALL pliego.sp_checkout_billed_quoted(v_user,uuidv4(),v_address,'TRANSFER','APPROVED',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0912345675','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
RAISE EXCEPTION 'failure injection did not run'; EXCEPTION WHEN internal_error THEN NULL; END;
PERFORM set_config('pliego.test_fail_invoice','off',TRUE);
IF (SELECT count(*) FROM pliego.pedido WHERE cliente_id=v_customer)<>v_count OR
 (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_edition1)<>v_before OR
 (SELECT estado FROM pliego.carrito WHERE carrito_id=v_cart)<>'ACTIVE' THEN RAISE EXCEPTION 'invoice failure left partial checkout effects'; END IF;

-- A later purchase cannot invoice another cédula; nothing is created.
SELECT count(*) INTO v_count FROM pliego.pedido WHERE cliente_id=v_customer;
BEGIN
CALL pliego.sp_checkout_billed_quoted(v_user,uuidv4(),v_address,'TRANSFER','APPROVED',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','1710034065','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
RAISE EXCEPTION 'foreign cedula invoiced'; EXCEPTION WHEN SQLSTATE 'P1106' THEN NULL; END;
IF (SELECT count(*) FROM pliego.pedido WHERE cliente_id=v_customer)<>v_count
 OR NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(v_user) WHERE identity_number='0912345675') THEN
 RAISE EXCEPTION 'mismatched cedula left effects'; END IF;

-- Legacy receipt cannot be upgraded into a billed purchase under its original key.
v_key:=uuidv4();
CALL pliego.sp_checkout_quoted(v_user,v_key,v_address,'TRANSFER','APPROVED',v_cart,'HOME_DELIVERY',NULL,NULL,v_order,v_order_state,v_payment_state,v_total,v_reference);
BEGIN
CALL pliego.sp_checkout_billed_quoted(v_user,v_key,v_address,'TRANSFER','APPROVED',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0912345675','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
RAISE EXCEPTION 'legacy receipt retroactively billed'; EXCEPTION WHEN SQLSTATE 'P1010' THEN NULL; END;
IF EXISTS(SELECT FROM pliego.factura WHERE pedido_id=v_order) THEN RAISE EXCEPTION 'legacy receipt invented invoice'; END IF;
-- An absence fence remains terminal for the expanded command as for legacy checkout.
v_key:=uuidv4();
PERFORM pliego.fn_checkout_resolve(v_user,v_key);
BEGIN
CALL pliego.sp_checkout_billed_quoted(v_user,v_key,v_address,'TRANSFER','APPROVED',v_cart,'HOME_DELIVERY',NULL,NULL,
'EC_CEDULA','0912345675','Comprador Fiscal','Direccion Fiscal',NULL,'Quito','Pichincha','EC',NULL,
v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
RAISE EXCEPTION 'terminal checkout fence ignored'; EXCEPTION WHEN SQLSTATE 'P1011' THEN NULL; END;
-- A used identity now requires review for an arbitrary change; no profile or invoice snapshot changes.
BEGIN
 CALL pliego.sp_customer_billing_identity_correct(v_user,'EC_CEDULA','0912345675','1710034065');
 RAISE EXCEPTION 'used arbitrary correction was applied directly';
EXCEPTION WHEN SQLSTATE 'P1107' THEN NULL; END;
IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(v_user) WHERE identity_number='0912345675')
 OR EXISTS(SELECT FROM pliego.factura f JOIN pliego.pedido p USING(pedido_id)
   WHERE p.cliente_id=v_customer AND f.identidad_numero<>'0912345675') THEN
 RAISE EXCEPTION 'review-required correction changed the account or an issued invoice'; END IF;
END; $gate$;
ROLLBACK;
