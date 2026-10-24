-- Isolated, rollback-only regression across all public catalog signatures.
BEGIN;
DO $gate$
DECLARE
    admin_id BIGINT; author_id BIGINT; publisher_id BIGINT; category_id BIGINT;
    book_id BIGINT; edition_id BIGINT; ids BIGINT[] := ARRAY[]::BIGINT[];
    actual BIGINT[]; expected BIGINT[]; titles TEXT[] := ARRAY[
        'Anestesiología y medicina perioperatoria','Análisis matemático','50 experimentos',
        '10 lecciones','2 lecciones','Álgebra','algebra','¡ÁLGEBRA!',
        'Nube','Ñandú','Oceano','Ana-lisis matematico','Árbol'];
    title TEXT; ordinal INTEGER := 0; sort_order VARCHAR; page_number INTEGER;
    from_pages BIGINT[]; page_ids BIGINT[]; page_total BIGINT;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES('catalog-spanish-gate-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO admin_id;
    CALL pliego.sp_author_create(admin_id,'Autora orden español gate',NULL,author_id);
    CALL pliego.sp_publisher_create(admin_id,'Editorial orden español gate',NULL,publisher_id);
    CALL pliego.sp_category_create(admin_id,'Orden español','catalog-spanish-gate-fixture',NULL,NULL,category_id);
    FOREACH title IN ARRAY titles LOOP
        ordinal := ordinal + 1;
        CALL pliego.sp_book_create(admin_id,title,NULL,'Fixture local',
            jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category_id),book_id);
        CALL pliego.sp_edition_create(admin_id,book_id,publisher_id,'SPANISH-GATE-'||ordinal,NULL,'es','EBOOK',NULL,NULL,
            10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],edition_id);
        ids := array_append(ids,edition_id);
    END LOOP;
    expected := ARRAY[ids[5],ids[4],ids[3],ids[6],ids[7],ids[8],ids[2],ids[12],ids[1],ids[13],ids[9],ids[10],ids[11]];
    SELECT array_agg(s.edition_id) INTO actual FROM pliego.fn_catalog_search(NULL,NULL,NULL,
        'catalog-spanish-gate-fixture',NULL,NULL,'es','EBOOK','TITLE_ASC',0,50,'EBOOK') s;
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Spanish title ASC order failed: % expected %',actual,expected; END IF;
    FOREACH sort_order IN ARRAY ARRAY['TITLE_ASC','TITLE_DESC']::VARCHAR[] LOOP
        IF sort_order='TITLE_DESC' THEN
            expected := ARRAY[ids[11],ids[10],ids[9],ids[13],ids[1],ids[2],ids[12],ids[6],ids[7],ids[8],ids[3],ids[4],ids[5]];
        END IF;
        from_pages := ARRAY[]::BIGINT[];
        FOR page_number IN 0..6 LOOP
            SELECT array_agg(s.edition_id), min(s.total_count) INTO page_ids,page_total
            FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-spanish-gate-fixture',10,10,'es','EBOOK',sort_order,page_number,2,'EBOOK') s;
            IF page_total IS DISTINCT FROM 13::BIGINT THEN RAISE EXCEPTION 'Filtered page count incorrect: %',page_total; END IF;
            from_pages := from_pages || page_ids;
            SELECT array_agg(s.edition_id) INTO actual FROM pliego.fn_catalog_search_global('Autora orden español gate',
                'catalog-spanish-gate-fixture',10,10,'es','EBOOK',sort_order,page_number,2,'EBOOK') s;
            IF actual IS DISTINCT FROM page_ids THEN RAISE EXCEPTION 'Global search/listing diverged on page %',page_number; END IF;
            SELECT array_agg(s.edition_id) INTO actual FROM pliego.fn_catalog_search(NULL,NULL,NULL,
                'catalog-spanish-gate-fixture',10,10,'es','EBOOK',sort_order,page_number,2) s;
            IF actual IS DISTINCT FROM page_ids THEN RAISE EXCEPTION 'Legacy listing diverged on page %',page_number; END IF;
            SELECT array_agg(s.edition_id) INTO actual FROM pliego.fn_catalog_search_global('Autora orden español gate',
                'catalog-spanish-gate-fixture',10,10,'es','EBOOK',sort_order,page_number,2) s;
            IF actual IS DISTINCT FROM page_ids THEN RAISE EXCEPTION 'Legacy search diverged on page %',page_number; END IF;
        END LOOP;
        IF from_pages IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Complete % pagination order failed: % expected %',sort_order,from_pages,expected; END IF;
        IF (SELECT count(DISTINCT value) FROM unnest(from_pages) value) <> 13 THEN RAISE EXCEPTION 'Duplicate or missing page identities'; END IF;
    END LOOP;
    IF EXISTS(SELECT FROM pliego.fn_catalog_search(NULL,NULL,NULL,'catalog-spanish-gate-fixture',NULL,NULL,NULL,NULL,'TITLE_DESC',7,2,'EBOOK')) THEN
        RAISE EXCEPTION 'Past-end page must be empty';
    END IF;
END $gate$;
ROLLBACK;
