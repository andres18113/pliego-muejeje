-- PostgreSQL 18, Flyway through V032. All test data and effects roll back.
BEGIN;
CREATE FUNCTION pg_temp.invalid_edition(a BIGINT,b BIGINT,p BIGINT,f VARCHAR,pages INTEGER,
    ebook VARCHAR,seconds INTEGER,narrators TEXT[]) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE e BIGINT;
BEGIN
    BEGIN
        CALL pliego.sp_edition_create(a,b,p,'V032-INVALID',NULL,'es',f,pages,NULL,
            9.00,NULL,NULL,NULL,NULL,ebook,seconds,narrators,e);
        RAISE EXCEPTION 'Expected P2048 for invalid metadata';
    EXCEPTION WHEN SQLSTATE 'P2048' THEN NULL;
    END;
END $$;
DO $gate$
DECLARE
    a BIGINT; author BIGINT; publisher BIGINT; category BIGINT; book BIGINT;
    physical BIGINT; ebook BIGINT; audio BIGINT; user_id BIGINT; customer BIGINT; state VARCHAR;
    address BIGINT; cart BIGINT; item BIGINT; quantity INTEGER; movement BIGINT;
    stock_before INTEGER; stock_after INTEGER; order_id BIGINT; order_state VARCHAR;
    payment_state VARCHAR; total NUMERIC; reference VARCHAR; previous_state VARCHAR; restored BIGINT;
    items JSONB; metadata RECORD;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES('v032-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
    CALL pliego.sp_author_create(a,'Autora Digital',NULL,author);
    CALL pliego.sp_publisher_create(a,'Editorial Digital',NULL,publisher);
    CALL pliego.sp_category_create(a,'Tema Digital','v032-tema',NULL,NULL,category);
    CALL pliego.sp_book_create(a,'Obra V032',NULL,'Obra con ediciones múltiples',
        jsonb_build_array(jsonb_build_object('authorId',author,'order',1)),jsonb_build_array(category),book);
    -- Legacy signature remains valid and physical stock starts at zero.
    CALL pliego.sp_edition_create(a,book,publisher,'V032-PHYSICAL',NULL,'es','PAPERBACK',123,NULL,
        12.00,NULL,NULL,NULL,NULL,physical);
    CALL pliego.sp_edition_create(a,book,publisher,'V032-EBOOK','9780306406157','es','EBOOK',NULL,NULL,
        9.00,'https://covers.pliegolibros.com/covers/editions/v2/V032.webp',NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],ebook);
    CALL pliego.sp_edition_create(a,book,publisher,'V032-AUDIO',NULL,'es','AUDIOBOOK',NULL,NULL,
        15.00,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Narradora Uno','Narrador Dos'],audio);
    IF EXISTS(SELECT 1 FROM pliego.inventario WHERE edicion_id IN(ebook,audio)) THEN
        RAISE EXCEPTION 'Digital editions have physical inventory'; END IF;
    IF (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical) IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'Legacy physical inventory changed'; END IF;
    IF (SELECT available FROM pliego.fn_edition_detail(ebook)) IS DISTINCT FROM TRUE
        OR (SELECT available FROM pliego.fn_edition_detail(audio)) IS DISTINCT FROM TRUE
        OR (SELECT available FROM pliego.fn_edition_detail(physical)) IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Incorrect initial availability'; END IF;
    -- Cover delivery is retained, and narrator order is stable.
    SELECT * INTO metadata FROM pliego.fn_edition_detail(audio);
    IF metadata.audio_duration_seconds<>3600 OR metadata.narrators<>ARRAY['Narradora Uno','Narrador Dos']
        OR metadata.page_count IS NOT NULL THEN RAISE EXCEPTION 'Audio metadata lost'; END IF;
    IF (SELECT cover_url FROM pliego.fn_edition_detail(ebook)) IS DISTINCT FROM
        'https://covers.pliegolibros.com/covers/editions/v2/V032.webp' THEN RAISE EXCEPTION 'Cover changed'; END IF;
    IF (SELECT count(*) FROM pliego.fn_catalog_search('Obra V032',NULL,NULL,'v032-tema',NULL,NULL,'es','EBOOK','TITLE_ASC',0,50))<>1
        OR (SELECT count(*) FROM pliego.fn_catalog_search_global('Autora Digital','v032-tema',NULL,NULL,'es','AUDIOBOOK','TITLE_ASC',0,50))<>1
        OR (SELECT count(*) FROM pliego.fn_catalog_search_global('9780306406157',NULL,NULL,NULL,NULL,'EBOOK','TITLE_ASC',0,50))<>1 THEN
        RAISE EXCEPTION 'Search/format/category filters omit digital'; END IF;
    IF NOT EXISTS(SELECT 1 FROM pliego.fn_public_catalog_filter_facets() WHERE formats ? 'EBOOK' AND formats ? 'AUDIOBOOK') THEN
        RAISE EXCEPTION 'Digital formats missing from facets'; END IF;
    IF NOT EXISTS(SELECT 1 FROM pliego.fn_admin_edition_search(a,'V032-AUDIO',NULL,NULL,0,50)
        WHERE stock_actual IS NULL AND audio_duration_seconds=3600) THEN RAISE EXCEPTION 'Admin digital stock is not null'; END IF;
    -- Typed metadata validation: both public command and relational checks.
    PERFORM pg_temp.invalid_edition(a,book,publisher,'PAPERBACK',NULL,NULL,NULL,ARRAY[]::TEXT[]);
    PERFORM pg_temp.invalid_edition(a,book,publisher,'PAPERBACK',123,'EPUB',NULL,ARRAY[]::TEXT[]);
    PERFORM pg_temp.invalid_edition(a,book,publisher,'EBOOK',NULL,'MOBI',NULL,ARRAY[]::TEXT[]);
    PERFORM pg_temp.invalid_edition(a,book,publisher,'EBOOK',NULL,'EPUB',100,ARRAY['Narrador']);
    PERFORM pg_temp.invalid_edition(a,book,publisher,'AUDIOBOOK',100,NULL,100,ARRAY['Narrador']);
    PERFORM pg_temp.invalid_edition(a,book,publisher,'AUDIOBOOK',NULL,'PDF',100,ARRAY['Narrador']);
    PERFORM pg_temp.invalid_edition(a,book,publisher,'AUDIOBOOK',NULL,NULL,0,ARRAY['Narrador']);
    PERFORM pg_temp.invalid_edition(a,book,publisher,'AUDIOBOOK',NULL,NULL,100,ARRAY[]::TEXT[]);
    PERFORM pg_temp.invalid_edition(a,book,publisher,'AUDIOBOOK',NULL,NULL,100,ARRAY[' ']);
    PERFORM pg_temp.invalid_edition(a,book,publisher,'AUDIOBOOK',NULL,NULL,100,ARRAY[NULL]::TEXT[]);
    PERFORM pg_temp.invalid_edition(a,book,publisher,'AUDIOBOOK',NULL,NULL,100,array_fill('Nombre'::TEXT,ARRAY[33]));
    BEGIN UPDATE pliego.edicion SET audio_duracion_segundos=0 WHERE edicion_id=audio;
        RAISE EXCEPTION 'Direct invalid metadata accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN CALL pliego.sp_edition_update(a,physical,publisher,NULL,'es','EBOOK',NULL,NULL,12.00,NULL,NULL,NULL,NULL,'PDF',NULL,ARRAY[]::TEXT[]);
        RAISE EXCEPTION 'Fulfillment conversion accepted'; EXCEPTION WHEN SQLSTATE 'P2048' THEN NULL; END;
    BEGIN INSERT INTO pliego.inventario(edicion_id,stock_actual,stock_minimo) VALUES(ebook,999,0);
        RAISE EXCEPTION 'Direct digital inventory accepted'; EXCEPTION WHEN SQLSTATE 'P3001' THEN NULL; END;
    BEGIN CALL pliego.sp_inventory_entry(a,ebook,1,'Invalid digital entry',movement,stock_before,stock_after);
        RAISE EXCEPTION 'Digital inventory entry accepted'; EXCEPTION WHEN SQLSTATE 'P3001' THEN NULL; END;
    BEGIN CALL pliego.sp_inventory_adjust(a,audio,'ADJUSTMENT_IN',1,'Invalid digital adjustment',movement,stock_before,stock_after);
        RAISE EXCEPTION 'Digital inventory adjustment accepted'; EXCEPTION WHEN SQLSTATE 'P3001' THEN NULL; END;
    BEGIN CALL pliego.sp_inventory_set_minimum(a,ebook,1,stock_after);
        RAISE EXCEPTION 'Digital minimum stock accepted'; EXCEPTION WHEN SQLSTATE 'P3001' THEN NULL; END;
    CALL pliego.sp_edition_update(a,ebook,publisher,'9780306406157','es','EBOOK',94,NULL,10.00,
        NULL,NULL,NULL,NULL,'PDF',NULL,ARRAY[]::TEXT[]);
    CALL pliego.sp_edition_update(a,audio,publisher,NULL,'es','AUDIOBOOK',NULL,NULL,15.00,
        NULL,NULL,NULL,NULL,NULL,7200,ARRAY['Narrador Dos','Narradora Uno']);
    IF (SELECT ebook_file_format FROM pliego.fn_edition_detail(ebook)) IS DISTINCT FROM 'PDF'
        OR (SELECT narrators FROM pliego.fn_edition_detail(audio))<>ARRAY['Narrador Dos','Narradora Uno'] THEN
        RAISE EXCEPTION 'Updated metadata lost'; END IF;
    CALL pliego.sp_customer_register('v032-customer@example.invalid','fixture','Cliente','Digital',NULL,user_id,customer,state);
    CALL pliego.sp_address_create(user_id,'Casa','Cliente Digital','Calle Digital',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,address);
    CALL pliego.sp_customer_favorite_add(user_id,ebook);
    IF NOT EXISTS(SELECT 1 FROM pliego.fn_customer_favorites(user_id,0,50) WHERE edition_id=ebook AND available) THEN
        RAISE EXCEPTION 'Digital favorite unavailable'; END IF;
    CALL pliego.sp_cart_add_item(user_id,ebook,1,cart,item,quantity);
    BEGIN CALL pliego.sp_cart_add_item(user_id,ebook,1,cart,item,quantity);
        RAISE EXCEPTION 'Duplicate digital quantity accepted'; EXCEPTION WHEN SQLSTATE 'P4004' THEN NULL; END;
    BEGIN CALL pliego.sp_cart_update_item(user_id,item,2,cart,item,quantity);
        RAISE EXCEPTION 'Digital quantity two accepted'; EXCEPTION WHEN SQLSTATE 'P4004' THEN NULL; END;
    CALL pliego.sp_edition_set_status(a,ebook,'INACTIVE');
    SELECT c.items INTO items FROM pliego.fn_cart_get(user_id)c;
    IF items->0->>'unavailabilityReason' IS DISTINCT FROM 'P2042' OR (items->0->>'available')::BOOLEAN IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Inactive digital cart availability wrong'; END IF;
    CALL pliego.sp_edition_set_status(a,ebook,'ACTIVE');
    CALL pliego.sp_book_set_status(a,book,'INACTIVE');
    SELECT c.items INTO items FROM pliego.fn_cart_get(user_id)c;
    IF items->0->>'unavailabilityReason' IS DISTINCT FROM 'P2043' THEN RAISE EXCEPTION 'Inactive work not reflected'; END IF;
    CALL pliego.sp_book_set_status(a,book,'ACTIVE');
    -- Digital-only checkout: no stock or movement, retained format snapshot, cancellation restores zero.
    CALL pliego.sp_checkout(user_id,address,'TRANSFER','APPROVED',order_id,order_state,payment_state,total,reference);
    IF total<>10.00 OR order_state<>'CONFIRMED' OR EXISTS(SELECT 1 FROM pliego.movimiento_inventario WHERE pedido_id=order_id)
        OR NOT EXISTS(SELECT 1 FROM pliego.pedido_item WHERE pedido_id=order_id AND formato_snapshot='EBOOK') THEN
        RAISE EXCEPTION 'Digital-only checkout wrong'; END IF;
    CALL pliego.sp_order_cancel(user_id,order_id,order_id,previous_state,order_state,payment_state,restored);
    IF restored<>0 OR payment_state<>'REFUNDED' THEN RAISE EXCEPTION 'Digital cancellation restored stock'; END IF;
    -- Same work, mixed purchase: only two physical units are deducted and restored.
    CALL pliego.sp_inventory_entry(a,physical,5,'Physical fixture',movement,stock_before,stock_after);
    CALL pliego.sp_cart_add_item(user_id,physical,2,cart,item,quantity);
    CALL pliego.sp_cart_add_item(user_id,ebook,1,cart,item,quantity);
    CALL pliego.sp_cart_add_item(user_id,audio,1,cart,item,quantity);
    SELECT c.items INTO items FROM pliego.fn_cart_get(user_id)c;
    IF jsonb_array_length(items)<>3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(items)x WHERE (x->>'available')::BOOLEAN IS NOT TRUE) THEN
        RAISE EXCEPTION 'Mixed cart unavailable'; END IF;
    CALL pliego.sp_checkout(user_id,address,'TRANSFER','APPROVED',order_id,order_state,payment_state,total,reference);
    IF total<>49.00 OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>3
        OR (SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id=order_id)<>1 THEN
        RAISE EXCEPTION 'Mixed checkout touched digital stock'; END IF;
    CALL pliego.sp_order_cancel(a,order_id,order_id,previous_state,order_state,payment_state,restored);
    IF restored<>2 OR (SELECT stock_actual FROM pliego.inventario WHERE edicion_id=physical)<>5
        OR (SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id=order_id)<>2 THEN
        RAISE EXCEPTION 'Mixed cancellation stock wrong'; END IF;
    -- Removing physical edition from public view leaves the theme discoverable using digital alone.
    CALL pliego.sp_edition_set_status(a,physical,'INACTIVE');
    IF NOT EXISTS(SELECT 1 FROM pliego.fn_public_category_list() WHERE category_slug='v032-tema') THEN
        RAISE EXCEPTION 'Digital-only theme missing'; END IF;
    CALL pliego.sp_cart_add_item(user_id,audio,1,cart,item,quantity);
    CALL pliego.sp_checkout(user_id,address,'TRANSFER','REJECTED',order_id,order_state,payment_state,total,reference);
    IF payment_state<>'REJECTED' OR EXISTS(SELECT 1 FROM pliego.movimiento_inventario WHERE pedido_id=order_id)
        OR (SELECT c.state FROM pliego.fn_cart_get(user_id)c) IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Rejected digital payment mutated cart/stock'; END IF;
END;
$gate$;
ROLLBACK;
