-- Run with psql -X -v ON_ERROR_STOP=1 after Flyway applies V001-V020 to PostgreSQL 18.
-- Setup and commands use only the approved public Database API; direct reads assert persisted effects.
BEGIN;
DO $gate$
DECLARE
    v_admin BIGINT; v_second_admin BIGINT; v_author BIGINT; v_publisher BIGINT;
    v_category BIGINT; v_book BIGINT; v_edition BIGINT; v_movement BIGINT;
    v_before INTEGER; v_after INTEGER; v_user BIGINT; v_customer BIGINT; v_user_state VARCHAR;
    v_address BIGINT; v_cart BIGINT; v_item BIGINT; v_quantity INTEGER;
    v_logistics_order BIGINT; v_cancel_order BIGINT; v_shipped_order BIGINT;
    v_order_state VARCHAR; v_payment_state VARCHAR; v_total NUMERIC; v_reference VARCHAR;
    v_page RECORD; v_detail RECORD; v_previous VARCHAR; v_transition_state VARCHAR;
    v_transition_order BIGINT; v_cancelled_order BIGINT; v_cancel_previous VARCHAR;
    v_cancel_state VARCHAR; v_refund_state VARCHAR; v_restored BIGINT;
    v_created TIMESTAMPTZ; v_stock INTEGER;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES ('i10-gate-admin@pliego.local','fixture-hash','ADMIN','ACTIVE')
    RETURNING usuario_id INTO v_admin;
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES ('i10-gate-admin-second@pliego.local','fixture-hash','ADMIN','ACTIVE')
    RETURNING usuario_id INTO v_second_admin;
    CALL pliego.sp_author_create(v_admin,'Autor I10',NULL,v_author);
    CALL pliego.sp_publisher_create(v_admin,'Editorial I10',NULL,v_publisher);
    CALL pliego.sp_category_create(v_admin,'Categoría I10','i10-gate-category',NULL,NULL,v_category);
    CALL pliego.sp_book_create(v_admin,'Libro I10',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',v_author,'order',1)),
        jsonb_build_array(v_category),v_book);
    CALL pliego.sp_edition_create(v_admin,v_book,v_publisher,'I10-GATE-1','9780306406157',
        'es','PAPERBACK',100,NULL,19.90,NULL,NULL,NULL,NULL,v_edition);
    CALL pliego.sp_inventory_entry(v_admin,v_edition,10,'fixture I10',v_movement,v_before,v_after);
    CALL pliego.sp_customer_register('i10-gate-customer@pliego.local','fixture-hash',
        'Cliente','I10',NULL,v_user,v_customer,v_user_state);
    CALL pliego.sp_address_create(v_user,'Casa','Cliente I10','Calle snapshot I10',NULL,
        'Quito','Pichincha','EC',NULL,'Referencia I10','+59325550134',TRUE,v_address);

    IF EXISTS (SELECT 1 FROM pliego.fn_admin_orders(v_admin,NULL,NULL,NULL,9223372036854775807,0,20)) THEN
        RAISE EXCEPTION 'admin empty search unexpectedly returned rows';
    END IF;

    CALL pliego.sp_cart_add_item(v_user,v_edition,2,v_cart,v_item,v_quantity);
    CALL pliego.sp_checkout(v_user,v_address,'CARD','APPROVED',
        v_logistics_order,v_order_state,v_payment_state,v_total,v_reference);
    SELECT fecha_creacion INTO v_created FROM pliego.pedido WHERE pedido_id=v_logistics_order;

    SELECT * INTO v_page FROM pliego.fn_admin_orders(v_admin,'CONFIRMED',
        v_created,v_created,v_customer,0,20);
    IF v_page.order_id IS DISTINCT FROM v_logistics_order OR v_page.customer_id IS DISTINCT FROM v_customer
       OR v_page.customer_name <> 'Cliente I10' OR v_page.order_state <> 'CONFIRMED'
       OR v_page.payment_state <> 'APPROVED' OR v_page.total <> 39.80 OR v_page.total_count <> 1 THEN
        RAISE EXCEPTION 'admin filtered search result mismatch';
    END IF;
    IF EXISTS (SELECT 1 FROM pliego.fn_admin_orders(v_admin,'SHIPPED',NULL,NULL,v_customer,0,20))
       OR EXISTS (SELECT 1 FROM pliego.fn_admin_orders(v_admin,'CONFIRMED',v_created + interval '1 day',
            v_created + interval '2 days',v_customer,0,20))
       OR EXISTS (SELECT 1 FROM pliego.fn_admin_orders(v_admin,'CONFIRMED',NULL,NULL,v_customer + 1000,0,20)) THEN
        RAISE EXCEPTION 'admin state/date/customer filter was ignored';
    END IF;

    SELECT * INTO v_detail FROM pliego.fn_admin_order_detail(v_admin,v_logistics_order);
    IF v_detail.customer_id IS DISTINCT FROM v_customer OR v_detail.customer_email <> 'i10-gate-customer@pliego.local'
       OR v_detail.customer_name <> 'Cliente I10' OR v_detail.order_state <> 'CONFIRMED'
       OR v_detail.subtotal <> 39.80 OR v_detail.total <> 39.80
       OR jsonb_array_length(v_detail.items) <> 1
       OR v_detail.items->0->>'sku_snapshot' <> 'I10-GATE-1'
       OR v_detail.items->0->>'titulo_snapshot' <> 'Libro I10'
       OR v_detail.items->0->>'autores_snapshot' <> 'Autor I10'
       OR v_detail.items->0->>'editorial_snapshot' <> 'Editorial I10'
       OR (v_detail.items->0->>'precio_unitario')::NUMERIC <> 19.90
       OR v_detail.address->>'destinatario' <> 'Cliente I10'
       OR v_detail.address->>'direccion_linea1' <> 'Calle snapshot I10'
       OR v_detail.payment->>'estado' <> 'APPROVED'
       OR (v_detail.payment->>'monto')::NUMERIC <> 39.80
       OR jsonb_array_length(v_detail.state_history) <> 2
       OR jsonb_array_length(v_detail.inventory_movements) <> 1
       OR v_detail.inventory_movements->0->>'tipo' <> 'SALE' THEN
        RAISE EXCEPTION 'admin detail identity or stored snapshots mismatch';
    END IF;

    BEGIN
        CALL pliego.sp_order_change_status(v_admin,v_logistics_order,'SHIPPED',
            v_transition_order,v_previous,v_transition_state);
        RAISE EXCEPTION 'skipped logistics transition succeeded';
    EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL;
    END;
    IF (SELECT estado FROM pliego.pedido WHERE pedido_id=v_logistics_order) <> 'CONFIRMED'
       OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=v_logistics_order) <> 2 THEN
        RAISE EXCEPTION 'invalid transition changed the order';
    END IF;

    CALL pliego.sp_order_change_status(v_admin,v_logistics_order,'PREPARING',
        v_transition_order,v_previous,v_transition_state);
    IF v_previous <> 'CONFIRMED' OR v_transition_state <> 'PREPARING' THEN
        RAISE EXCEPTION 'CONFIRMED to PREPARING response mismatch';
    END IF;
    BEGIN
        CALL pliego.sp_order_change_status(v_admin,v_logistics_order,'PREPARING',
            v_transition_order,v_previous,v_transition_state);
        RAISE EXCEPTION 'same-state transition succeeded';
    EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL;
    END;
    IF (SELECT estado FROM pliego.pedido WHERE pedido_id=v_logistics_order) <> 'PREPARING'
       OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=v_logistics_order) <> 3 THEN
        RAISE EXCEPTION 'same-state transition changed the order';
    END IF;
    CALL pliego.sp_order_change_status(v_admin,v_logistics_order,'SHIPPED',
        v_transition_order,v_previous,v_transition_state);
    BEGIN
        CALL pliego.sp_order_change_status(v_admin,v_logistics_order,'PREPARING',
            v_transition_order,v_previous,v_transition_state);
        RAISE EXCEPTION 'backwards logistics transition succeeded';
    EXCEPTION WHEN SQLSTATE 'P5002' THEN NULL;
    END;
    CALL pliego.sp_order_change_status(v_admin,v_logistics_order,'DELIVERED',
        v_transition_order,v_previous,v_transition_state);
    BEGIN
        CALL pliego.sp_order_change_status(v_admin,v_logistics_order,'CANCELLED',
            v_transition_order,v_previous,v_transition_state);
        RAISE EXCEPTION 'logistics endpoint accepted CANCELLED';
    EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL;
    END;
    IF (SELECT estado FROM pliego.pedido WHERE pedido_id=v_logistics_order) <> 'DELIVERED'
       OR (SELECT count(*) FROM pliego.pedido_estado_historial
           WHERE pedido_id=v_logistics_order AND origen='USER' AND usuario_actor_id=v_admin
             AND (estado_anterior,estado_nuevo) IN
                 (('CONFIRMED','PREPARING'),('PREPARING','SHIPPED'),('SHIPPED','DELIVERED'))) <> 3
       OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=v_logistics_order
           AND usuario_actor_id=v_admin AND estado_anterior='CONFIRMED' AND estado_nuevo='PREPARING') <> 1
       OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=v_logistics_order
           AND usuario_actor_id=v_admin AND estado_anterior='PREPARING' AND estado_nuevo='SHIPPED') <> 1
       OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=v_logistics_order
           AND usuario_actor_id=v_admin AND estado_anterior='SHIPPED' AND estado_nuevo='DELIVERED') <> 1
       OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=v_logistics_order) <> 5 THEN
        RAISE EXCEPTION 'logistics history was not recorded exactly once per successful transition';
    END IF;
    BEGIN
        CALL pliego.sp_order_cancel(v_admin,v_logistics_order,v_cancelled_order,v_cancel_previous,
            v_cancel_state,v_refund_state,v_restored);
        RAISE EXCEPTION 'DELIVERED order was cancelled';
    EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL;
    END;

    -- This order belongs to the CUSTOMER, but a different ADMIN actor cancels it.
    CALL pliego.sp_cart_add_item(v_user,v_edition,3,v_cart,v_item,v_quantity);
    CALL pliego.sp_checkout(v_user,v_address,'TRANSFER','APPROVED',
        v_cancel_order,v_order_state,v_payment_state,v_total,v_reference);
    CALL pliego.sp_order_cancel(v_second_admin,v_cancel_order,v_cancelled_order,v_cancel_previous,
        v_cancel_state,v_refund_state,v_restored);
    IF v_cancelled_order IS DISTINCT FROM v_cancel_order OR v_cancel_previous <> 'CONFIRMED'
       OR v_cancel_state <> 'CANCELLED' OR v_refund_state <> 'REFUNDED' OR v_restored <> 3
       OR (SELECT estado FROM pliego.pedido WHERE pedido_id=v_cancel_order) <> 'CANCELLED'
       OR (SELECT estado FROM pliego.pago WHERE pedido_id=v_cancel_order) <> 'REFUNDED'
       OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_edition) <> 8
       OR (SELECT count(*) FROM pliego.movimiento_inventario
           WHERE pedido_id=v_cancel_order AND edicion_id=v_edition AND tipo='CANCELLATION') <> 1
       OR (SELECT count(*) FROM pliego.pedido_estado_historial
           WHERE pedido_id=v_cancel_order AND origen='USER' AND usuario_actor_id=v_second_admin
             AND estado_anterior='CONFIRMED' AND estado_nuevo='CANCELLED') <> 1 THEN
        RAISE EXCEPTION 'admin cancellation effects or actor history mismatch';
    END IF;
    BEGIN
        CALL pliego.sp_order_cancel(v_second_admin,v_cancel_order,v_cancelled_order,v_cancel_previous,
            v_cancel_state,v_refund_state,v_restored);
        RAISE EXCEPTION 'second admin cancellation succeeded';
    EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL;
    END;
    IF (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_edition) <> 8
       OR (SELECT count(*) FROM pliego.movimiento_inventario
           WHERE pedido_id=v_cancel_order AND tipo='CANCELLATION') <> 1 THEN
        RAISE EXCEPTION 'repeated cancellation restored inventory again';
    END IF;

    CALL pliego.sp_cart_add_item(v_user,v_edition,1,v_cart,v_item,v_quantity);
    CALL pliego.sp_checkout(v_user,v_address,'TRANSFER','APPROVED',
        v_shipped_order,v_order_state,v_payment_state,v_total,v_reference);
    CALL pliego.sp_order_change_status(v_admin,v_shipped_order,'PREPARING',
        v_transition_order,v_previous,v_transition_state);
    CALL pliego.sp_order_change_status(v_admin,v_shipped_order,'SHIPPED',
        v_transition_order,v_previous,v_transition_state);
    BEGIN
        CALL pliego.sp_order_cancel(v_second_admin,v_shipped_order,v_cancelled_order,v_cancel_previous,
            v_cancel_state,v_refund_state,v_restored);
        RAISE EXCEPTION 'SHIPPED order was cancelled';
    EXCEPTION WHEN SQLSTATE 'P5003' THEN NULL;
    END;
    SELECT stock_actual INTO v_stock FROM pliego.inventario WHERE edicion_id=v_edition;
    IF (SELECT estado FROM pliego.pedido WHERE pedido_id=v_shipped_order) <> 'SHIPPED'
       OR v_stock <> 7
       OR (SELECT count(*) FROM pliego.movimiento_inventario
           WHERE pedido_id=v_shipped_order AND tipo='CANCELLATION') <> 0 THEN
        RAISE EXCEPTION 'SHIPPED cancellation changed the order or stock';
    END IF;
END;
$gate$;
ROLLBACK;
