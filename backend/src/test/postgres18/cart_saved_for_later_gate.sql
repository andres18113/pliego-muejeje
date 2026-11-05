-- PostgreSQL 18. Saved-for-later routines run atomically with cart operations.
-- All fixture rows and mutations roll back.
BEGIN;
DO $gate$
DECLARE
    admin BIGINT; author BIGINT; publisher BIGINT; category BIGINT; book BIGINT;
    physical BIGINT; digital BIGINT; movement BIGINT; before_stock INTEGER; after_stock INTEGER;
    user_id BIGINT; customer BIGINT; customer_state VARCHAR; cart BIGINT; cart_item BIGINT; quantity INTEGER;
    saved_id BIGINT; saved JSONB; quote RECORD; favorites_before BIGINT;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES('saved-later-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO admin;
    CALL pliego.sp_author_create(admin,'Autora Guardado',NULL,author);
    CALL pliego.sp_publisher_create(admin,'Editorial Guardado',NULL,publisher);
    CALL pliego.sp_category_create(admin,'Tema Guardado','saved-later-gate',NULL,NULL,category);
    CALL pliego.sp_book_create(admin,'Libro Guardado',NULL,'Fixture de guardado',
        jsonb_build_array(jsonb_build_object('authorId',author,'order',1)),jsonb_build_array(category),book);
    CALL pliego.sp_edition_create(admin,book,publisher,'SAVED-LATER-PHYSICAL',NULL,'es','PAPERBACK',120,NULL,7.25,
        NULL,NULL,NULL,NULL,physical);
    CALL pliego.sp_edition_create(admin,book,publisher,'SAVED-LATER-DIGITAL',NULL,'es','EBOOK',NULL,NULL,12.00,
        'https://covers.pliegolibros.com/covers/editions/v2/SAVED-LATER.webp',NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],digital);
    CALL pliego.sp_inventory_entry(admin,physical,5,'saved-for-later fixture',movement,before_stock,after_stock);
    CALL pliego.sp_customer_register('saved-later-customer@example.invalid','fixture','Cliente','Guardado',NULL,
        user_id,customer,customer_state);
    CALL pliego.sp_customer_favorite_add(user_id,physical);
    CALL pliego.sp_customer_favorite_add(user_id,digital);
    SELECT count(*) INTO favorites_before FROM pliego.cliente_favorito WHERE cliente_id=customer;

    -- Cart -> saved preserves quantity and removes the line from totals.
    CALL pliego.sp_cart_add_item(user_id,physical,3,cart,cart_item,quantity);
    CALL pliego.sp_cart_save_for_later(user_id,cart_item);
    SELECT s.items->0 INTO saved FROM pliego.fn_customer_saved_for_later(user_id) s;
    IF saved->>'quantity'<>'3' OR saved->>'format'<>'PAPERBACK'
        OR saved->>'editionId'<>physical::TEXT OR saved->>'savedItemId' IS NULL THEN
        RAISE EXCEPTION 'Saved list did not project the moved physical cart line: %',saved;
    END IF;
    IF jsonb_array_length((SELECT q.items FROM pliego.fn_cart_checkout_quote(user_id) q))<>0
        OR (SELECT total_current FROM pliego.fn_cart_get(user_id))<>0 THEN
        RAISE EXCEPTION 'Saved item remained in cart projection or totals';
    END IF;

    -- Re-saving the same edition is unique and latest cart quantity replaces the saved quantity.
    CALL pliego.sp_cart_add_item(user_id,physical,2,cart,cart_item,quantity);
    CALL pliego.sp_cart_save_for_later(user_id,cart_item);
    IF (SELECT count(*) FROM pliego.cliente_guardado_despues WHERE cliente_id=customer AND edicion_id=physical)<>1
        OR (SELECT cantidad FROM pliego.cliente_guardado_despues WHERE cliente_id=customer AND edicion_id=physical)<>2 THEN
        RAISE EXCEPTION 'Latest cart quantity did not replace the saved quantity';
    END IF;

    -- Saved -> cart restores the quantity and clears saved state in one call.
    SELECT guardado_despues_id INTO saved_id FROM pliego.cliente_guardado_despues
     WHERE cliente_id=customer AND edicion_id=physical;
    CALL pliego.sp_cart_saved_move_to_cart(user_id,saved_id);
    IF (SELECT ci.cantidad FROM pliego.carrito c JOIN pliego.carrito_item ci USING(carrito_id)
        WHERE c.cliente_id=customer AND c.estado='ACTIVE' AND ci.edicion_id=physical)<>2
        OR EXISTS(SELECT FROM pliego.cliente_guardado_despues WHERE guardado_despues_id=saved_id) THEN
        RAISE EXCEPTION 'Saved physical item was not restored exactly once';
    END IF;

    -- A digital edition already in the cart remains one unit and is not duplicated.
    CALL pliego.sp_cart_add_item(user_id,digital,1,cart,cart_item,quantity);
    CALL pliego.sp_cart_save_for_later(user_id,cart_item);
    BEGIN
        UPDATE pliego.cliente_guardado_despues SET cantidad=2
         WHERE cliente_id=customer AND edicion_id=digital;
        RAISE EXCEPTION 'Digital saved quantity two was accepted';
    EXCEPTION WHEN SQLSTATE 'P4004' THEN NULL;
    END;
    SELECT guardado_despues_id INTO saved_id FROM pliego.cliente_guardado_despues
     WHERE cliente_id=customer AND edicion_id=digital;
    CALL pliego.sp_cart_add_item(user_id,digital,1,cart,cart_item,quantity);
    CALL pliego.sp_cart_saved_move_to_cart(user_id,saved_id);
    IF (SELECT count(*) FROM pliego.carrito c JOIN pliego.carrito_item ci USING(carrito_id)
        WHERE c.cliente_id=customer AND c.estado='ACTIVE' AND ci.edicion_id=digital)<>1
        OR (SELECT ci.cantidad FROM pliego.carrito c JOIN pliego.carrito_item ci USING(carrito_id)
        WHERE c.cliente_id=customer AND c.estado='ACTIVE' AND ci.edicion_id=digital)<>1 THEN
        RAISE EXCEPTION 'Moving a digital item already in cart created a second unit';
    END IF;

    -- Saved rows never affect totals or checkout quote line counts.
    CALL pliego.sp_cart_add_item(user_id,physical,3,cart,cart_item,quantity);
    CALL pliego.sp_cart_save_for_later(user_id,cart_item);
    SELECT * INTO quote FROM pliego.fn_cart_checkout_quote(user_id);
    IF jsonb_array_length(quote.items)<>1 OR quote.items->0->>'editionId'<>digital::TEXT
        OR (SELECT total_current FROM pliego.fn_cart_get(user_id))<>12.00 THEN
        RAISE EXCEPTION 'Saved physical item affected cart quote or totals: %',quote.items;
    END IF;

    -- A stock failure rolls back the attempted add and retains the saved row and cart.
    CALL pliego.sp_inventory_adjust(admin,physical,'ADJUSTMENT_OUT',4,'saved-for-later stock reduction',movement,before_stock,after_stock);
    SELECT guardado_despues_id INTO saved_id FROM pliego.cliente_guardado_despues
     WHERE cliente_id=customer AND edicion_id=physical;
    BEGIN
        CALL pliego.sp_cart_saved_move_to_cart(user_id,saved_id);
        RAISE EXCEPTION 'Saved physical item moved to cart despite insufficient stock';
    EXCEPTION WHEN SQLSTATE 'P3002' THEN NULL;
    END;
    IF NOT EXISTS(SELECT FROM pliego.cliente_guardado_despues WHERE guardado_despues_id=saved_id AND cantidad=5)
        OR (SELECT count(*) FROM pliego.carrito c JOIN pliego.carrito_item ci USING(carrito_id)
            WHERE c.cliente_id=customer AND c.estado='ACTIVE')<>1
        OR (SELECT total_current FROM pliego.fn_cart_get(user_id))<>12.00 THEN
        RAISE EXCEPTION 'Stock failure changed saved or cart state';
    END IF;

    IF (SELECT count(*) FROM pliego.cliente_favorito WHERE cliente_id=customer)<>favorites_before
        OR NOT EXISTS(SELECT FROM pliego.cliente_favorito WHERE cliente_id=customer AND edicion_id=physical)
        OR NOT EXISTS(SELECT FROM pliego.cliente_favorito WHERE cliente_id=customer AND edicion_id=digital) THEN
        RAISE EXCEPTION 'Saved-for-later operations changed favorites';
    END IF;

    BEGIN
        CALL pliego.sp_cart_save_for_later(user_id,9223372036854775807);
        RAISE EXCEPTION 'Missing cart line was silently saved';
    EXCEPTION WHEN SQLSTATE 'P4003' THEN NULL;
    END;

    -- A concurrent/repeated move after success reports clean absence without creating state.
    DELETE FROM pliego.carrito_item WHERE carrito_id=cart AND edicion_id=digital;
    SELECT guardado_despues_id INTO saved_id FROM pliego.cliente_guardado_despues WHERE cliente_id=customer AND edicion_id=physical;
    CALL pliego.sp_cart_saved_remove(user_id,saved_id);
    BEGIN
        CALL pliego.sp_cart_saved_remove(user_id,saved_id);
        RAISE EXCEPTION 'Missing saved item was silently removed';
    EXCEPTION WHEN SQLSTATE 'P4006' THEN NULL;
    END;
END;
$gate$;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_indexes
         WHERE schemaname='pliego'
           AND indexname='idx_cliente_guardado_despues_edicion'
           AND indexdef ILIKE '%USING btree (edicion_id)%'
    ) THEN
        RAISE EXCEPTION 'Saved for Later edition foreign key must have a referencing-side index';
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname='pliego_app') AND (
        NOT has_table_privilege('pliego_app','pliego.cliente_guardado_despues','SELECT')
        OR NOT has_table_privilege('pliego_app','pliego.cliente_guardado_despues','INSERT')
        OR NOT has_table_privilege('pliego_app','pliego.cliente_guardado_despues','UPDATE')
        OR NOT has_table_privilege('pliego_app','pliego.cliente_guardado_despues','DELETE')
        OR has_table_privilege('pliego_app','pliego.cliente_guardado_despues','TRUNCATE')
        OR has_table_privilege('pliego_app','pliego.cliente_guardado_despues','TRIGGER')
        OR NOT has_sequence_privilege('pliego_app','pliego.cliente_guardado_despues_guardado_despues_id_seq','USAGE')
        OR has_sequence_privilege('pliego_app','pliego.cliente_guardado_despues_guardado_despues_id_seq','UPDATE')
    ) THEN
        RAISE EXCEPTION 'Saved for Later runtime privileges are not limited to required row DML and sequence USAGE';
    END IF;
END;
$$;
ROLLBACK;
