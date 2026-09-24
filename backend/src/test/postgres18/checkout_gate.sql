-- Run with psql -X -v ON_ERROR_STOP=1 against a Flyway V001–V020 PostgreSQL 18 database.
-- Uses public routines for setup and checkout; direct table reads assert persisted effects.
BEGIN;
DO $gate$
DECLARE
    v_admin BIGINT;
    v_author BIGINT; v_publisher BIGINT; v_category BIGINT; v_book BIGINT;
    v_edition1 BIGINT; v_edition2 BIGINT;
    v_movement BIGINT; v_before INTEGER; v_after INTEGER;
    v_user BIGINT; v_customer BIGINT; v_user_state VARCHAR;
    v_address BIGINT; v_cart BIGINT; v_item BIGINT; v_quantity INTEGER;
    v_order BIGINT; v_order_state VARCHAR; v_payment_state VARCHAR;
    v_total NUMERIC; v_reference VARCHAR;
    v_rejected_cart BIGINT; v_rejected_order BIGINT;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES ('i8-gate-admin@pliego.local','fixture-hash','ADMIN','ACTIVE')
    RETURNING usuario_id INTO v_admin;

    CALL pliego.sp_author_create(v_admin,'Autor I8',NULL,v_author);
    CALL pliego.sp_publisher_create(v_admin,'Editorial I8',NULL,v_publisher);
    CALL pliego.sp_category_create(v_admin,'Categoría I8','i8-gate-category',NULL,NULL,v_category);
    CALL pliego.sp_book_create(v_admin,'Libro I8',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',v_author,'order',1)),
        jsonb_build_array(v_category),v_book);
    CALL pliego.sp_edition_create(v_admin,v_book,v_publisher,'I8-GATE-1','9780306406157',
        'es','PAPERBACK',100,NULL,15.50,NULL,NULL,NULL,NULL,v_edition1);
    CALL pliego.sp_edition_create(v_admin,v_book,v_publisher,'I8-GATE-2',NULL,
        'es','HARDCOVER',100,NULL,12.35,NULL,NULL,NULL,NULL,v_edition2);
    CALL pliego.sp_inventory_entry(v_admin,v_edition1,5,'fixture',v_movement,v_before,v_after);
    CALL pliego.sp_inventory_entry(v_admin,v_edition2,5,'fixture',v_movement,v_before,v_after);
    CALL pliego.sp_customer_register('i8-gate-customer@pliego.local','fixture-hash',
        'Cliente','I8',NULL,v_user,v_customer,v_user_state);
    CALL pliego.sp_address_create(v_user,'Casa','Cliente I8','Calle I8',NULL,
        'Quito','Pichincha','EC',NULL,'Referencia I8','+59325550134',TRUE,v_address);
    CALL pliego.sp_cart_add_item(v_user,v_edition1,2,v_cart,v_item,v_quantity);
    CALL pliego.sp_cart_add_item(v_user,v_edition2,1,v_cart,v_item,v_quantity);

    CALL pliego.sp_checkout(v_user,v_address,'CARD','APPROVED',
        v_order,v_order_state,v_payment_state,v_total,v_reference);

    IF v_order_state <> 'CONFIRMED' OR v_payment_state <> 'APPROVED'
       OR v_total <> 43.35
       OR v_reference !~ '^SIM-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR (SELECT count(*) FROM pliego.pedido WHERE cliente_id=v_customer) <> 1
       OR (SELECT count(*) FROM pliego.pago WHERE pedido_id=v_order) <> 1
       OR (SELECT estado FROM pliego.pedido WHERE pedido_id=v_order) <> 'CONFIRMED'
       OR (SELECT estado FROM pliego.pago WHERE pedido_id=v_order) <> 'APPROVED'
       OR (SELECT referencia FROM pliego.pago WHERE pedido_id=v_order) <> v_reference
       OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=v_order) <> 2
       OR (SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id=v_order AND tipo='SALE') <> 2
       OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_edition1) <> 3
       OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_edition2) <> 4
       OR (SELECT estado FROM pliego.carrito WHERE carrito_id=v_cart) <> 'CHECKED_OUT'
       OR (SELECT count(*) FROM pliego.pedido_item WHERE pedido_id=v_order) <> 2
       OR (SELECT count(*) FROM pliego.pedido_item WHERE pedido_id=v_order
           AND sku_snapshot='I8-GATE-1' AND isbn_snapshot='9780306406157'
           AND titulo_snapshot='Libro I8' AND autores_snapshot='Autor I8'
           AND editorial_snapshot='Editorial I8' AND formato_snapshot='PAPERBACK'
           AND idioma_snapshot='es' AND precio_unitario=15.50 AND cantidad=2 AND subtotal=31.00) <> 1
       OR (SELECT count(*) FROM pliego.pedido_item WHERE pedido_id=v_order
           AND sku_snapshot='I8-GATE-2' AND isbn_snapshot IS NULL
           AND titulo_snapshot='Libro I8' AND autores_snapshot='Autor I8'
           AND editorial_snapshot='Editorial I8' AND formato_snapshot='HARDCOVER'
           AND idioma_snapshot='es' AND precio_unitario=12.35 AND cantidad=1 AND subtotal=12.35) <> 1
       OR (SELECT count(*) FROM pliego.pedido_direccion WHERE pedido_id=v_order
           AND destinatario='Cliente I8' AND direccion_linea1='Calle I8'
           AND ciudad='Quito' AND provincia='Pichincha' AND pais_codigo='EC'
           AND referencia='Referencia I8' AND telefono='+59325550134') <> 1 THEN
        RAISE EXCEPTION 'APPROVED checkout persisted effects do not match contract';
    END IF;

    CALL pliego.sp_cart_add_item(v_user,v_edition1,1,v_rejected_cart,v_item,v_quantity);
    CALL pliego.sp_checkout(v_user,v_address,'TRANSFER','REJECTED',
        v_rejected_order,v_order_state,v_payment_state,v_total,v_reference);

    IF v_order_state <> 'CANCELLED' OR v_payment_state <> 'REJECTED'
       OR v_reference IS NOT NULL OR v_total <> 15.50
       OR (SELECT count(*) FROM pliego.pedido WHERE cliente_id=v_customer) <> 2
       OR (SELECT count(*) FROM pliego.pago WHERE pedido_id=v_rejected_order) <> 1
       OR (SELECT estado FROM pliego.pedido WHERE pedido_id=v_rejected_order) <> 'CANCELLED'
       OR (SELECT estado FROM pliego.pago WHERE pedido_id=v_rejected_order) <> 'REJECTED'
       OR (SELECT referencia FROM pliego.pago WHERE pedido_id=v_rejected_order) IS NOT NULL
       OR (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=v_rejected_order) <> 2
       OR (SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id=v_rejected_order AND tipo='SALE') <> 0
       OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_edition1) <> 3
       OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=v_edition2) <> 4
       OR (SELECT estado FROM pliego.carrito WHERE carrito_id=v_rejected_cart) <> 'ACTIVE'
       OR (SELECT count(*) FROM pliego.pedido_item WHERE pedido_id=v_rejected_order
           AND sku_snapshot='I8-GATE-1' AND precio_unitario=15.50 AND cantidad=1 AND subtotal=15.50) <> 1
       OR (SELECT count(*) FROM pliego.pedido_direccion WHERE pedido_id=v_rejected_order
           AND destinatario='Cliente I8' AND direccion_linea1='Calle I8') <> 1 THEN
        RAISE EXCEPTION 'REJECTED checkout persisted effects do not match contract';
    END IF;
END;
$gate$;
ROLLBACK;
