-- Mixed catalog contract used by JdbcCatalogGateway. Isolated fixtures; all effects roll back.
BEGIN;
DO $signatures$
BEGIN
    IF to_regprocedure('pliego.fn_catalog_search(character varying,character varying,character varying,character varying,numeric,numeric,character varying,character varying,character varying,integer,integer,character varying)') IS NULL
        OR to_regprocedure('pliego.fn_catalog_search_global(character varying,character varying,numeric,numeric,character varying,character varying,character varying,integer,integer,character varying)') IS NULL THEN
        RAISE EXCEPTION 'Catalog JDBC productType contract is missing: apply pending Flyway migrations before serving catalog requests';
    END IF;
END $signatures$;

DO $gate$
DECLARE
    admin_id BIGINT; author_id BIGINT; publisher_id BIGINT; category_id BIGINT;
    book_id BIGINT; retired_book_id BIGINT; paper_id BIGINT; hard_id BIGINT;
    ebook_id BIGINT; audio_id BIGINT; retired_id BIGINT;
    movement_id BIGINT; stock_before INTEGER; stock_after INTEGER;
    customer_user BIGINT; customer_id BIGINT; customer_state VARCHAR;
    cart_id BIGINT; item_id BIGINT; item_quantity INTEGER; offer_id BIGINT;
    ids BIGINT[]; count_rows BIGINT; total_rows BIGINT; product VARCHAR;
    expected BIGINT[]; sort_order VARCHAR; current_id BIGINT; item_data JSONB;
    metadata RECORD;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES('catalog-contract-admin@example.invalid','fixture','ADMIN','ACTIVE')
    RETURNING usuario_id INTO admin_id;
    CALL pliego.sp_author_create(admin_id,'Autora contrato mixto',NULL,author_id);
    CALL pliego.sp_publisher_create(admin_id,'Editorial contrato mixto',NULL,publisher_id);
    CALL pliego.sp_category_create(admin_id,'Contrato mixto','catalog-contract-fixture',NULL,NULL,category_id);
    CALL pliego.sp_book_create(admin_id,'Obra contrato mixto',NULL,'Fixture aislado',
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),
        jsonb_build_array(category_id),book_id);
    CALL pliego.sp_edition_create(admin_id,book_id,publisher_id,'CONTRACT-PAPER',NULL,'es','PAPERBACK',120,NULL,
        20,NULL,NULL,NULL,NULL,paper_id);
    CALL pliego.sp_edition_create(admin_id,book_id,publisher_id,'CONTRACT-HARD',NULL,'es','HARDCOVER',160,NULL,
        30,NULL,NULL,NULL,NULL,hard_id);
    CALL pliego.sp_edition_create(admin_id,book_id,publisher_id,'CONTRACT-EBOOK',NULL,'es','EBOOK',NULL,NULL,
        10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],ebook_id);
    CALL pliego.sp_edition_create(admin_id,book_id,publisher_id,'CONTRACT-AUDIO',NULL,'es','AUDIOBOOK',NULL,NULL,
        40,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Voz contrato'],audio_id);
    CALL pliego.sp_inventory_entry(admin_id,paper_id,5,'Fixture contrato',movement_id,stock_before,stock_after);
    CALL pliego.sp_inventory_entry(admin_id,hard_id,5,'Fixture contrato',movement_id,stock_before,stock_after);

    CALL pliego.sp_book_create(admin_id,'Obra retirada contrato mixto',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),
        jsonb_build_array(category_id),retired_book_id);
    CALL pliego.sp_edition_create(admin_id,retired_book_id,publisher_id,'CONTRACT-RETIRED',NULL,'es','PAPERBACK',100,NULL,
        1,NULL,NULL,NULL,NULL,retired_id);
    CALL pliego.sp_edition_set_status(admin_id,retired_id,'INACTIVE');

    -- Both search signatures return the same mixed identities, with retired editions excluded.
    SELECT array_agg(edition_id ORDER BY edition_id),min(total_count)
    INTO ids,total_rows FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,NULL,NULL,'TITLE_ASC',0,20,NULL);
    IF ids IS DISTINCT FROM ARRAY[paper_id,hard_id,ebook_id,audio_id] OR total_rows<>4 THEN
        RAISE EXCEPTION 'Mixed listing identity/count/retirement contract failed: % / %',ids,total_rows;
    END IF;
    SELECT array_agg(edition_id ORDER BY edition_id) INTO ids
    FROM pliego.fn_catalog_search_global('Autora contrato mixto','catalog-contract-fixture',NULL,NULL,NULL,NULL,'TITLE_ASC',0,20,NULL);
    IF ids IS DISTINCT FROM ARRAY[paper_id,hard_id,ebook_id,audio_id] THEN
        RAISE EXCEPTION 'Mixed author search identity/retirement contract failed: %',ids;
    END IF;

    FOREACH product IN ARRAY ARRAY['PHYSICAL','EBOOK','AUDIOBOOK']::VARCHAR[] LOOP
        expected:=CASE product WHEN 'PHYSICAL' THEN ARRAY[paper_id,hard_id]
            WHEN 'EBOOK' THEN ARRAY[ebook_id] ELSE ARRAY[audio_id] END;
        SELECT array_agg(edition_id ORDER BY edition_id),min(total_count) INTO ids,total_rows
        FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,'es',NULL,'TITLE_ASC',0,20,product);
        IF ids IS DISTINCT FROM expected OR total_rows IS DISTINCT FROM cardinality(expected)::BIGINT THEN
            RAISE EXCEPTION 'Scoped listing % failed: % / %',product,ids,total_rows;
        END IF;
        SELECT array_agg(edition_id ORDER BY edition_id),min(total_count) INTO ids,total_rows
        FROM pliego.fn_catalog_search_global('Obra contrato mixto','catalog-contract-fixture',NULL,NULL,'es',NULL,'TITLE_ASC',0,20,product);
        IF ids IS DISTINCT FROM expected OR total_rows IS DISTINCT FROM cardinality(expected)::BIGINT THEN
            RAISE EXCEPTION 'Scoped text search % failed: % / %',product,ids,total_rows;
        END IF;
        FOREACH sort_order IN ARRAY ARRAY['TITLE_ASC','PRICE_ASC','PRICE_DESC','BEST_SELLING']::VARCHAR[] LOOP
            SELECT array_agg(edition_id ORDER BY edition_id) INTO ids
            FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,NULL,NULL,sort_order,0,20,product);
            IF ids IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Listing sort % / % dropped identities',product,sort_order; END IF;
            SELECT array_agg(edition_id ORDER BY edition_id) INTO ids
            FROM pliego.fn_catalog_search_global('contrato mixto','catalog-contract-fixture',NULL,NULL,NULL,NULL,sort_order,0,20,product);
            IF ids IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Search sort % / % dropped identities',product,sort_order; END IF;
        END LOOP;
    END LOOP;

    SELECT array_agg(edition_id),min(total_count) INTO ids,total_rows
    FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,NULL,NULL,'PRICE_ASC',0,1,'PHYSICAL');
    IF ids IS DISTINCT FROM ARRAY[paper_id] OR total_rows<>2 THEN
        RAISE EXCEPTION 'Product filter must run before sorting, window count and pagination: % / %',ids,total_rows;
    END IF;
    SELECT array_agg(edition_id),min(total_count) INTO ids,total_rows
    FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,NULL,NULL,'PRICE_ASC',1,1,'PHYSICAL');
    IF ids IS DISTINCT FROM ARRAY[hard_id] OR total_rows<>2 THEN RAISE EXCEPTION 'Second physical page failed'; END IF;
    SELECT array_agg(edition_id),min(total_count) INTO ids,total_rows
    FROM pliego.fn_catalog_search_global('contrato mixto','catalog-contract-fixture',NULL,NULL,NULL,NULL,'PRICE_DESC',0,1,'PHYSICAL');
    IF ids IS DISTINCT FROM ARRAY[hard_id] OR total_rows<>2 THEN RAISE EXCEPTION 'Global sorted first page failed'; END IF;
    SELECT array_agg(edition_id),min(total_count) INTO ids,total_rows
    FROM pliego.fn_catalog_search_global('contrato mixto','catalog-contract-fixture',NULL,NULL,NULL,NULL,'PRICE_DESC',1,1,'PHYSICAL');
    IF ids IS DISTINCT FROM ARRAY[paper_id] OR total_rows<>2 THEN RAISE EXCEPTION 'Global sorted second page failed'; END IF;
    IF EXISTS(SELECT 1 FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,NULL,NULL,'TITLE_ASC',2,1,'PHYSICAL'))
        OR EXISTS(SELECT 1 FROM pliego.fn_catalog_search_global('contrato mixto','catalog-contract-fixture',NULL,NULL,NULL,NULL,'TITLE_ASC',2,1,'PHYSICAL')) THEN
        RAISE EXCEPTION 'Out-of-range pages must be empty';
    END IF;

    FOREACH current_id IN ARRAY ARRAY[paper_id,hard_id,ebook_id,audio_id] LOOP
        SELECT * INTO metadata FROM pliego.fn_edition_detail(current_id);
        IF NOT FOUND OR metadata.available IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Missing/incorrect available detail: %',current_id; END IF;
        SELECT array_agg(edition_id) INTO ids FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,NULL,metadata.format,'TITLE_ASC',0,20,NULL);
        IF ids IS DISTINCT FROM ARRAY[current_id] THEN RAISE EXCEPTION 'Format filter failed for %',metadata.format; END IF;
        SELECT array_agg(edition_id) INTO ids FROM pliego.fn_catalog_search_global('contrato mixto','catalog-contract-fixture',NULL,NULL,NULL,metadata.format,'TITLE_ASC',0,20,NULL);
        IF ids IS DISTINCT FROM ARRAY[current_id] THEN RAISE EXCEPTION 'Global format filter failed for %',metadata.format; END IF;
    END LOOP;
    IF (SELECT ebook_file_format FROM pliego.fn_edition_detail(ebook_id)) IS DISTINCT FROM 'EPUB'
        OR (SELECT audio_duration_seconds FROM pliego.fn_edition_detail(audio_id)) IS DISTINCT FROM 3600
        OR (SELECT narrators FROM pliego.fn_edition_detail(audio_id)) IS DISTINCT FROM ARRAY['Voz contrato']::TEXT[] THEN
        RAISE EXCEPTION 'Digital metadata changed across catalog contract';
    END IF;
    IF EXISTS(SELECT 1 FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,NULL,'EBOOK','TITLE_ASC',0,20,'PHYSICAL'))
        OR EXISTS(SELECT 1 FROM pliego.fn_catalog_search_global('contrato mixto','catalog-contract-fixture',NULL,NULL,NULL,'PAPERBACK','TITLE_ASC',0,20,'AUDIOBOOK'))
        OR EXISTS(SELECT 1 FROM pliego.fn_edition_detail(retired_id)) THEN
        RAISE EXCEPTION 'Contradictory format/media filters or retired detail leaked';
    END IF;
    SELECT array_agg(edition_id) INTO ids FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',15,25,'es',NULL,'TITLE_ASC',0,20,'PHYSICAL');
    IF ids IS DISTINCT FROM ARRAY[paper_id] THEN RAISE EXCEPTION 'Price range filter failed'; END IF;

    -- Offers retain their own existing productType argument position and effective prices.
    CALL pliego.sp_edition_offer_set(admin_id,paper_id,18,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '1 day',offer_id);
    CALL pliego.sp_edition_offer_set(admin_id,ebook_id,8,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '1 day',offer_id);
    SELECT array_agg(edition_id) INTO ids
    FROM pliego.fn_catalog_search_offers(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,NULL,NULL,'PHYSICAL','PRICE_ASC',0,20);
    IF ids IS DISTINCT FROM ARRAY[paper_id] THEN RAISE EXCEPTION 'Offers physical scope failed'; END IF;
    IF (SELECT price FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,NULL,'EBOOK','TITLE_ASC',0,20,'EBOOK')) IS DISTINCT FROM 8::NUMERIC THEN
        RAISE EXCEPTION 'Scoped catalog lost effective offer price';
    END IF;

    CALL pliego.sp_customer_register('catalog-contract-customer@example.invalid','fixture','Cliente','Contrato',NULL,customer_user,customer_id,customer_state);
    CALL pliego.sp_cart_add_item(customer_user,paper_id,1,cart_id,item_id,item_quantity);
    CALL pliego.sp_cart_add_item(customer_user,ebook_id,1,cart_id,item_id,item_quantity);
    CALL pliego.sp_cart_add_item(customer_user,audio_id,1,cart_id,item_id,item_quantity);
    SELECT items INTO item_data FROM pliego.fn_cart_get(customer_user);
    SELECT array_agg((value->>'editionId')::BIGINT ORDER BY (value->>'editionId')::BIGINT)
    INTO ids FROM jsonb_array_elements(item_data);
    IF ids IS DISTINCT FROM ARRAY[paper_id,ebook_id,audio_id] THEN RAISE EXCEPTION 'Mixed cart identities failed: %',ids; END IF;

    BEGIN
        PERFORM * FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-contract-fixture',NULL,NULL,NULL,NULL,'TITLE_ASC',0,20,'INVALID');
        RAISE EXCEPTION 'Invalid productType should be rejected';
    EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
    BEGIN
        PERFORM * FROM pliego.fn_catalog_search_global('contrato mixto','catalog-contract-fixture',NULL,NULL,NULL,NULL,'TITLE_ASC',0,20,'INVALID');
        RAISE EXCEPTION 'Invalid global productType should be rejected';
    EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
END $gate$;
ROLLBACK;
