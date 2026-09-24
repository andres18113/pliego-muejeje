-- Run with psql -X -v ON_ERROR_STOP=1 against a disposable Flyway V001–V020 PostgreSQL 18 database.
-- Public routines create and change business data; direct reads assert their persisted effects.
BEGIN;
DO $gate$
DECLARE
    v_admin BIGINT; v_author BIGINT; v_pub BIGINT; v_cat BIGINT; v_book BIGINT;
    v_ed1 BIGINT; v_ed2 BIGINT; v_mov BIGINT; v_before INTEGER; v_after INTEGER;
    v_a BIGINT; v_b BIGINT; v_customer BIGINT; v_a_customer BIGINT; v_state VARCHAR;
    v_address BIGINT; v_cart BIGINT; v_item BIGINT; v_qty INTEGER;
    v_order BIGINT; v_order_state VARCHAR; v_payment_state VARCHAR; v_total NUMERIC; v_ref VARCHAR;
    v_cancel_order BIGINT; v_previous VARCHAR; v_cancel_state VARCHAR;
    v_refund_state VARCHAR; v_restored BIGINT;
    v_preparing_order BIGINT; v_rejected_order BIGINT; v_shipped_order BIGINT; v_delivered_order BIGINT;
    v_transition_order BIGINT; v_transition_state VARCHAR;
    v_page RECORD; v_detail RECORD; v_after_detail RECORD;
    v_items JSONB; v_address_snapshot JSONB;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES ('i9-gate-admin@pliego.local','fixture-hash','ADMIN','ACTIVE')
    RETURNING usuario_id INTO v_admin;
    CALL pliego.sp_author_create(v_admin,'Autor I9',NULL,v_author);
    CALL pliego.sp_publisher_create(v_admin,'Editorial I9',NULL,v_pub);
    CALL pliego.sp_category_create(v_admin,'Categoría I9','i9-gate-category',NULL,NULL,v_cat);
    CALL pliego.sp_book_create(v_admin,'Libro I9',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',v_author,'order',1)),
        jsonb_build_array(v_cat),v_book);
    CALL pliego.sp_edition_create(v_admin,v_book,v_pub,'I9-GATE-1','9780306406157',
        'es','PAPERBACK',100,NULL,15.50,NULL,NULL,NULL,NULL,v_ed1);
    CALL pliego.sp_edition_create(v_admin,v_book,v_pub,'I9-GATE-2',NULL,
        'es','HARDCOVER',100,NULL,12.35,NULL,NULL,NULL,NULL,v_ed2);
    CALL pliego.sp_inventory_entry(v_admin,v_ed1,5,'fixture',v_mov,v_before,v_after);
    CALL pliego.sp_inventory_entry(v_admin,v_ed2,5,'fixture',v_mov,v_before,v_after);
    CALL pliego.sp_customer_register('i9-gate-a@pliego.local','fixture-hash',
        'Cliente','A',NULL,v_a,v_customer,v_state);
    v_a_customer := v_customer;
    CALL pliego.sp_customer_register('i9-gate-b@pliego.local','fixture-hash',
        'Cliente','B',NULL,v_b,v_customer,v_state);
    CALL pliego.sp_address_create(v_a,'Casa','Cliente A','Calle original',NULL,
        'Quito','Pichincha','EC',NULL,'Referencia original','+59325550134',TRUE,v_address);

    IF EXISTS (SELECT 1 FROM pliego.fn_customer_orders(v_a,0,20))
       OR EXISTS (SELECT 1 FROM pliego.fn_customer_orders(v_b,0,20)) THEN
        RAISE EXCEPTION 'empty customer list is not empty';
    END IF;

    CALL pliego.sp_cart_add_item(v_a,v_ed1,2,v_cart,v_item,v_qty);
    CALL pliego.sp_cart_add_item(v_a,v_ed2,1,v_cart,v_item,v_qty);
    CALL pliego.sp_checkout(v_a,v_address,'CARD','APPROVED',
        v_order,v_order_state,v_payment_state,v_total,v_ref);

    SELECT * INTO v_page FROM pliego.fn_customer_orders(v_a,0,1);
    IF v_page.order_id IS DISTINCT FROM v_order OR v_page.total_count <> 1
       OR v_page.total <> 43.35 OR v_page.payment_state <> 'APPROVED' THEN
        RAISE EXCEPTION 'own-order summary mismatch';
    END IF;
    IF EXISTS (SELECT 1 FROM pliego.fn_customer_orders(v_b,0,20)) THEN
        RAISE EXCEPTION 'other customer can list order';
    END IF;

    SELECT * INTO v_detail FROM pliego.fn_customer_order_detail(v_a,v_order);
    v_items := v_detail.items;
    v_address_snapshot := v_detail.address;
    IF v_detail.order_id IS DISTINCT FROM v_order OR v_detail.total <> 43.35
       OR jsonb_array_length(v_items) <> 2
       OR v_items->0->>'title' <> 'Libro I9'
       OR v_items->0->>'authors' <> 'Autor I9'
       OR v_items->0->>'publisher' <> 'Editorial I9'
       OR v_items->0->>'sku' <> 'I9-GATE-1'
       OR (v_items->0->>'unitPrice')::NUMERIC <> 15.50
       OR (v_items->0->>'subtotal')::NUMERIC <> 31.00
       OR v_items->1->>'sku' <> 'I9-GATE-2'
       OR (v_items->1->>'unitPrice')::NUMERIC <> 12.35
       OR v_address_snapshot->>'destinatario' <> 'Cliente A'
       OR v_address_snapshot->>'direccion_linea1' <> 'Calle original'
       OR v_detail.payment->>'state' <> 'APPROVED'
       OR (v_detail.payment->>'amount')::NUMERIC <> 43.35
       OR jsonb_array_length(v_detail.state_history) <> 2 THEN
        RAISE EXCEPTION 'own-order detail snapshot mismatch';
    END IF;

    BEGIN
        PERFORM * FROM pliego.fn_customer_order_detail(v_b,v_order);
        RAISE EXCEPTION 'foreign detail was visible';
    EXCEPTION WHEN SQLSTATE 'P5001' THEN NULL;
    END;
    BEGIN
        PERFORM * FROM pliego.fn_customer_order_detail(v_b,9223372036854775807);
        RAISE EXCEPTION 'missing detail was visible';
    EXCEPTION WHEN SQLSTATE 'P5001' THEN NULL;
    END;
    BEGIN
        CALL pliego.sp_order_cancel(v_b,v_order,v_cancel_order,v_previous,
            v_cancel_state,v_refund_state,v_restored);
        RAISE EXCEPTION 'foreign cancellation succeeded';
    EXCEPTION WHEN SQLSTATE 'P5001' THEN NULL;
    END;

    CALL pliego.sp_order_cancel(v_a,v_order,v_cancel_order,v_previous,
        v_cancel_state,v_refund_state,v_restored);
    IF v_cancel_order IS DISTINCT FROM v_order OR v_previous <> 'CONFIRMED'
       OR v_cancel_state <> 'CANCELLED' OR v_refund_state <> 'REFUNDED'
       OR v_restored <> 3
       OR (SELECT estado FROM pliego.pedido WHERE pedido_id=v_order) <> 'CANCELLED'
       OR (SELECT estado FROM pliego.pago WHERE pedido_id=v_order) <> 'REFUNDED'
       OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_ed1) <> 5
       OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_ed2) <> 5
       OR (SELECT count(*) FROM pliego.movimiento_inventario
           WHERE pedido_id=v_order AND tipo='CANCELLATION') <> 2
       OR (SELECT count(*) FROM pliego.movimiento_inventario
           WHERE pedido_id=v_order AND edicion_id=v_ed1 AND tipo='CANCELLATION') <> 1
       OR (SELECT count(*) FROM pliego.movimiento_inventario
           WHERE pedido_id=v_order AND edicion_id=v_ed2 AND tipo='CANCELLATION') <> 1
       OR (SELECT count(*) FROM pliego.pedido_estado_historial
           WHERE pedido_id=v_order AND origen='USER' AND usuario_actor_id=v_a
             AND estado_anterior='CONFIRMED' AND estado_nuevo='CANCELLED') <> 1 THEN
        RAISE EXCEPTION 'CONFIRMED cancellation effects mismatch';
    END IF;
    SELECT * INTO v_after_detail FROM pliego.fn_customer_order_detail(v_a,v_order);
    IF v_after_detail.items IS DISTINCT FROM v_items
       OR v_after_detail.address IS DISTINCT FROM v_address_snapshot
       OR jsonb_array_length(v_after_detail.state_history) <> 3
       OR v_after_detail.payment->>'state' <> 'REFUNDED' THEN
        RAISE EXCEPTION 'cancel changed snapshots or omitted history';
    END IF;
    BEGIN
        CALL pliego.sp_order_cancel(v_a,v_order,v_cancel_order,v_previous,
            v_cancel_state,v_refund_state,v_restored);
        RAISE EXCEPTION 'second cancellation succeeded';
    EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL;
    END;
    IF (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_ed1) <> 5
       OR (SELECT count(*) FROM pliego.movimiento_inventario
           WHERE pedido_id=v_order AND tipo='CANCELLATION') <> 2 THEN
        RAISE EXCEPTION 'second cancellation restored stock again';
    END IF;

    CALL pliego.sp_cart_add_item(v_a,v_ed1,1,v_cart,v_item,v_qty);
    CALL pliego.sp_checkout(v_a,v_address,'TRANSFER','APPROVED',
        v_preparing_order,v_order_state,v_payment_state,v_total,v_ref);
    CALL pliego.sp_order_change_status(v_admin,v_preparing_order,'PREPARING',
        v_transition_order,v_previous,v_transition_state);
    CALL pliego.sp_order_cancel(v_a,v_preparing_order,v_cancel_order,v_previous,
        v_cancel_state,v_refund_state,v_restored);
    IF v_previous <> 'PREPARING' OR v_cancel_state <> 'CANCELLED'
       OR v_refund_state <> 'REFUNDED' OR v_restored <> 1
       OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_ed1) <> 5 THEN
        RAISE EXCEPTION 'PREPARING cancellation effects mismatch';
    END IF;

    CALL pliego.sp_cart_add_item(v_a,v_ed1,1,v_cart,v_item,v_qty);
    CALL pliego.sp_checkout(v_a,v_address,'TRANSFER','REJECTED',
        v_rejected_order,v_order_state,v_payment_state,v_total,v_ref);
    BEGIN
        CALL pliego.sp_order_cancel(v_a,v_rejected_order,v_cancel_order,v_previous,
            v_cancel_state,v_refund_state,v_restored);
        RAISE EXCEPTION 'rejected-payment cancellation succeeded';
    EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL;
    END;

    SELECT * INTO v_page FROM pliego.fn_customer_orders(v_a,0,1);
    IF v_page.order_id IS DISTINCT FROM v_rejected_order OR v_page.total_count <> 3
       OR v_page.order_state <> 'CANCELLED' OR v_page.payment_state <> 'REJECTED'
       OR (SELECT count(*) FROM pliego.fn_customer_orders(v_a,3,1)) <> 0
       OR (SELECT count(*) FROM pliego.pedido WHERE cliente_id=v_a_customer) <> 3 THEN
        RAISE EXCEPTION 'customer pagination/order inclusion mismatch';
    END IF;

    -- Rejected checkout kept its cart ACTIVE; a new approved attempt checks it out.
    CALL pliego.sp_checkout(v_a,v_address,'TRANSFER','APPROVED',
        v_shipped_order,v_order_state,v_payment_state,v_total,v_ref);
    CALL pliego.sp_order_change_status(v_admin,v_shipped_order,'PREPARING',
        v_transition_order,v_previous,v_transition_state);
    CALL pliego.sp_order_change_status(v_admin,v_shipped_order,'SHIPPED',
        v_transition_order,v_previous,v_transition_state);
    BEGIN
        CALL pliego.sp_order_cancel(v_a,v_shipped_order,v_cancel_order,v_previous,
            v_cancel_state,v_refund_state,v_restored);
        RAISE EXCEPTION 'SHIPPED cancellation succeeded';
    EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL;
    END;

    CALL pliego.sp_cart_add_item(v_a,v_ed1,1,v_cart,v_item,v_qty);
    CALL pliego.sp_checkout(v_a,v_address,'TRANSFER','APPROVED',
        v_delivered_order,v_order_state,v_payment_state,v_total,v_ref);
    CALL pliego.sp_order_change_status(v_admin,v_delivered_order,'PREPARING',
        v_transition_order,v_previous,v_transition_state);
    CALL pliego.sp_order_change_status(v_admin,v_delivered_order,'SHIPPED',
        v_transition_order,v_previous,v_transition_state);
    CALL pliego.sp_order_change_status(v_admin,v_delivered_order,'DELIVERED',
        v_transition_order,v_previous,v_transition_state);
    BEGIN
        CALL pliego.sp_order_cancel(v_a,v_delivered_order,v_cancel_order,v_previous,
            v_cancel_state,v_refund_state,v_restored);
        RAISE EXCEPTION 'DELIVERED cancellation succeeded';
    EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL;
    END;
    IF (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_ed1) <> 3
       OR (SELECT count(*) FROM pliego.movimiento_inventario
           WHERE pedido_id IN (v_shipped_order,v_delivered_order) AND tipo='CANCELLATION') <> 0 THEN
        RAISE EXCEPTION 'noncancellable states changed inventory';
    END IF;
END;
$gate$;
ROLLBACK;
