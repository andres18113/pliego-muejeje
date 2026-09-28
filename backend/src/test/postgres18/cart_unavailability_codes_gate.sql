-- Run after Flyway through V025 on PostgreSQL 18. All fixtures roll back.
-- fn_cart_get must report the same canonical SQLSTATE that cart commands raise for each condition.
BEGIN;
DO $gate$
DECLARE
    v_admin BIGINT;
    v_author BIGINT; v_publisher BIGINT; v_category BIGINT;
    v_book_active BIGINT; v_book_retired BIGINT;
    v_available BIGINT; v_edition_retired BIGINT; v_short_stock BIGINT; v_in_retired_book BIGINT;
    v_movement BIGINT; v_before INTEGER; v_after INTEGER;
    v_user BIGINT; v_customer BIGINT; v_user_state VARCHAR;
    v_cart BIGINT; v_item BIGINT; v_short_item BIGINT; v_quantity INTEGER;
    v_items JSONB;
    v_raised TEXT;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado, password_hash, rol, estado)
    VALUES ('v25-cart-codes-admin@pliego.local', 'fixture-hash', 'ADMIN', 'ACTIVE')
    RETURNING usuario_id INTO v_admin;

    CALL pliego.sp_author_create(v_admin, 'Autor V25', NULL, v_author);
    CALL pliego.sp_publisher_create(v_admin, 'Editorial V25', NULL, v_publisher);
    CALL pliego.sp_category_create(v_admin, 'Categoría V25', 'v25-cart-codes', NULL, NULL, v_category);
    CALL pliego.sp_book_create(v_admin, 'Libro activo V25', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)),
        jsonb_build_array(v_category), v_book_active);
    CALL pliego.sp_book_create(v_admin, 'Libro retirado V25', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)),
        jsonb_build_array(v_category), v_book_retired);
    CALL pliego.sp_edition_create(v_admin, v_book_active, v_publisher, 'V25-AVAILABLE', NULL,
        'es', 'PAPERBACK', 100, NULL, 10.00, NULL, NULL, NULL, NULL, v_available);
    CALL pliego.sp_edition_create(v_admin, v_book_active, v_publisher, 'V25-EDITION-RETIRED', NULL,
        'es', 'HARDCOVER', 100, NULL, 11.00, NULL, NULL, NULL, NULL, v_edition_retired);
    CALL pliego.sp_edition_create(v_admin, v_book_active, v_publisher, 'V25-SHORT-STOCK', NULL,
        'en', 'PAPERBACK', 100, NULL, 12.00, NULL, NULL, NULL, NULL, v_short_stock);
    CALL pliego.sp_edition_create(v_admin, v_book_retired, v_publisher, 'V25-BOOK-RETIRED', NULL,
        'es', 'PAPERBACK', 100, NULL, 13.00, NULL, NULL, NULL, NULL, v_in_retired_book);
    CALL pliego.sp_inventory_entry(v_admin, v_available, 5, 'fixture', v_movement, v_before, v_after);
    CALL pliego.sp_inventory_entry(v_admin, v_edition_retired, 5, 'fixture', v_movement, v_before, v_after);
    CALL pliego.sp_inventory_entry(v_admin, v_short_stock, 2, 'fixture', v_movement, v_before, v_after);
    CALL pliego.sp_inventory_entry(v_admin, v_in_retired_book, 5, 'fixture', v_movement, v_before, v_after);

    CALL pliego.sp_customer_register('v25-cart-codes-customer@pliego.local', 'fixture-hash',
        'Cliente', 'V25', NULL, v_user, v_customer, v_user_state);
    CALL pliego.sp_cart_add_item(v_user, v_available, 1, v_cart, v_item, v_quantity);
    CALL pliego.sp_cart_add_item(v_user, v_edition_retired, 1, v_cart, v_item, v_quantity);
    CALL pliego.sp_cart_add_item(v_user, v_short_stock, 2, v_cart, v_short_item, v_quantity);
    CALL pliego.sp_cart_add_item(v_user, v_in_retired_book, 1, v_cart, v_item, v_quantity);

    CALL pliego.sp_edition_set_status(v_admin, v_edition_retired, 'INACTIVE');
    CALL pliego.sp_book_set_status(v_admin, v_book_retired, 'INACTIVE');
    CALL pliego.sp_inventory_adjust(v_admin, v_short_stock, 'ADJUSTMENT_OUT', 1, 'fixture',
        v_movement, v_before, v_after);

    SELECT items INTO v_items FROM pliego.fn_cart_get(v_user);

    IF (SELECT item->'unavailabilityReason' FROM jsonb_array_elements(v_items) item
            WHERE (item->>'editionId')::BIGINT = v_available) <> 'null'::JSONB THEN
        RAISE EXCEPTION 'A purchasable cart item must report a null unavailabilityReason';
    END IF;
    IF (SELECT item->>'unavailabilityReason' FROM jsonb_array_elements(v_items) item
            WHERE (item->>'editionId')::BIGINT = v_edition_retired) IS DISTINCT FROM 'P2042' THEN
        RAISE EXCEPTION 'An inactive edition must report P2042';
    END IF;
    IF (SELECT item->>'unavailabilityReason' FROM jsonb_array_elements(v_items) item
            WHERE (item->>'editionId')::BIGINT = v_short_stock) IS DISTINCT FROM 'P3002' THEN
        RAISE EXCEPTION 'Stock below the cart quantity must report P3002';
    END IF;
    IF (SELECT item->>'unavailabilityReason' FROM jsonb_array_elements(v_items) item
            WHERE (item->>'editionId')::BIGINT = v_in_retired_book) IS DISTINCT FROM 'P2043' THEN
        RAISE EXCEPTION 'An inactive book must report P2043';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) item
            WHERE item->>'unavailabilityReason' IS NOT NULL
              AND item->>'unavailabilityReason' NOT IN ('P2042', 'P2043', 'P3002')) THEN
        RAISE EXCEPTION 'unavailabilityReason must use only canonical SQLSTATEs';
    END IF;

    -- The reported reason matches the SQLSTATE a command raises for the same condition.
    BEGIN
        CALL pliego.sp_cart_update_item(v_user, v_short_item, 2, v_cart, v_item, v_quantity);
    EXCEPTION WHEN OTHERS THEN
        v_raised := SQLSTATE;
    END;
    IF v_raised IS DISTINCT FROM 'P3002' THEN
        RAISE EXCEPTION 'sp_cart_update_item raised % instead of P3002', v_raised;
    END IF;

    v_raised := NULL;
    BEGIN
        CALL pliego.sp_cart_add_item(v_user, v_edition_retired, 1, v_cart, v_item, v_quantity);
    EXCEPTION WHEN OTHERS THEN
        v_raised := SQLSTATE;
    END;
    IF v_raised IS DISTINCT FROM 'P2042' THEN
        RAISE EXCEPTION 'sp_cart_add_item raised % instead of P2042', v_raised;
    END IF;

    v_raised := NULL;
    BEGIN
        CALL pliego.sp_cart_add_item(v_user, v_in_retired_book, 1, v_cart, v_item, v_quantity);
    EXCEPTION WHEN OTHERS THEN
        v_raised := SQLSTATE;
    END;
    IF v_raised IS DISTINCT FROM 'P2043' THEN
        RAISE EXCEPTION 'sp_cart_add_item raised % instead of P2043', v_raised;
    END IF;
END;
$gate$;
ROLLBACK;
