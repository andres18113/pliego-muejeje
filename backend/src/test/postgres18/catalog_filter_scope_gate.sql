-- V050 scoped discovery: literal fixture expectations; all effects roll back.
BEGIN;
DO $signatures$
BEGIN
    IF to_regprocedure('pliego.fn_public_category_list(character varying)') IS NULL
       OR to_regprocedure('pliego.fn_public_catalog_filter_facets(character varying)') IS NULL THEN
        RAISE EXCEPTION 'Scoped category and facet discovery contracts are missing';
    END IF;
END $signatures$;

DO $gate$
DECLARE
    actor BIGINT; author_id BIGINT; publisher_id BIGINT;
    root_id BIGINT; physical_category BIGINT; ebook_category BIGINT; audio_category BIGINT;
    hidden_root BIGINT; hidden_child BIGINT; inactive_child BIGINT; empty_category BIGINT;
    book_id BIGINT; physical_book BIGINT; ebook_book BIGINT; audio_book BIGINT;
    paper_id BIGINT; hard_id BIGINT; ebook_id BIGINT; audio_id BIGINT; unlisted_id BIGINT;
    offer_id BIGINT; scope VARCHAR; category_slugs TEXT[]; metadata RECORD;
    invalid_scope VARCHAR;
BEGIN
    -- Isolate metadata expectations even when this gate runs against a seeded fixture database.
    UPDATE pliego.libro SET estado='INACTIVE';
    INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
    VALUES('scope-gate-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO actor;
    CALL pliego.sp_author_create(actor,'Autor alcance',NULL,author_id);
    CALL pliego.sp_publisher_create(actor,'Editorial alcance',NULL,publisher_id);
    CALL pliego.sp_category_create(actor,'Raíz alcance','scope-root',NULL,NULL,root_id);
    CALL pliego.sp_category_create(actor,'Físico alcance','scope-physical',NULL,root_id,physical_category);
    CALL pliego.sp_category_create(actor,'eBook alcance','scope-ebook',NULL,root_id,ebook_category);
    CALL pliego.sp_category_create(actor,'Audio alcance','scope-audio',NULL,NULL,audio_category);
    CALL pliego.sp_category_create(actor,'Padre oculto','scope-hidden-root',NULL,NULL,hidden_root);
    CALL pliego.sp_category_create(actor,'Hijo oculto','scope-hidden-child',NULL,hidden_root,hidden_child);
    CALL pliego.sp_category_create(actor,'Hijo inactivo','scope-inactive-child',NULL,root_id,inactive_child);
    CALL pliego.sp_category_create(actor,'Vacío','scope-empty',NULL,NULL,empty_category);

    CALL pliego.sp_book_create(actor,'Físico alcance',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),
        jsonb_build_array(physical_category),physical_book);
    CALL pliego.sp_edition_create(actor,physical_book,publisher_id,'SCOPE-PAPER',NULL,'es','PAPERBACK',100,NULL,
        20,NULL,NULL,NULL,NULL,paper_id);
    CALL pliego.sp_edition_create(actor,physical_book,publisher_id,'SCOPE-HARD',NULL,'en','HARDCOVER',100,NULL,
        30,NULL,NULL,NULL,NULL,hard_id);
    -- Zero-stock physical editions remain visible. Effective offer bounds must be used.
    CALL pliego.sp_edition_offer_set(actor,paper_id,12,statement_timestamp()-INTERVAL '1 day',
        statement_timestamp()+INTERVAL '1 day','Oferta fixture',NULL,offer_id);
    CALL pliego.sp_book_create(actor,'eBook alcance',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),
        jsonb_build_array(ebook_category),ebook_book);
    CALL pliego.sp_edition_create(actor,ebook_book,publisher_id,'SCOPE-EBOOK',NULL,'fr','EBOOK',NULL,NULL,
        8,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],ebook_id);
    CALL pliego.sp_book_create(actor,'Audio alcance',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),
        jsonb_build_array(audio_category),audio_book);
    CALL pliego.sp_edition_create(actor,audio_book,publisher_id,'SCOPE-AUDIO',NULL,'de','AUDIOBOOK',NULL,NULL,
        40,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Voz fixture'],audio_id);

    -- Active editions under inactive category branches must not expose those branches.
    CALL pliego.sp_book_create(actor,'Oculto padre',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),
        jsonb_build_array(hidden_child,inactive_child),book_id);
    CALL pliego.sp_edition_create(actor,book_id,publisher_id,'SCOPE-HIDDEN',NULL,'fr','EBOOK',NULL,NULL,
        8,NULL,NULL,NULL,NULL,NULL,NULL,ARRAY[]::TEXT[],unlisted_id);
    CALL pliego.sp_category_set_status(actor,hidden_root,'INACTIVE');
    CALL pliego.sp_category_set_status(actor,inactive_child,'INACTIVE');
    -- Category status hides categories, but does not hide editions from unfiltered search/facets.
    -- Inactive editions, inactive books and missing inventory each have unique extreme metadata.
    CALL pliego.sp_edition_create(actor,ebook_book,publisher_id,'SCOPE-INACTIVE-EDITION',NULL,'it','EBOOK',NULL,NULL,
        7,NULL,NULL,NULL,NULL,NULL,NULL,ARRAY[]::TEXT[],unlisted_id);
    CALL pliego.sp_edition_set_status(actor,unlisted_id,'INACTIVE');
    CALL pliego.sp_book_create(actor,'Libro inactivo',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),
        jsonb_build_array(empty_category),book_id);
    CALL pliego.sp_edition_create(actor,book_id,publisher_id,'SCOPE-INACTIVE-BOOK',NULL,'pt','AUDIOBOOK',NULL,NULL,
        90,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Voz fixture'],unlisted_id);
    CALL pliego.sp_book_set_status(actor,book_id,'INACTIVE');
    CALL pliego.sp_book_create(actor,'Sin inventario',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),
        jsonb_build_array(empty_category),book_id);
    CALL pliego.sp_edition_create(actor,book_id,publisher_id,'SCOPE-NO-INVENTORY',NULL,'ja','PAPERBACK',100,NULL,
        100,NULL,NULL,NULL,NULL,unlisted_id);
    DELETE FROM pliego.inventario WHERE edicion_id=unlisted_id;

    FOREACH scope IN ARRAY ARRAY['GLOBAL','PHYSICAL','EBOOK','AUDIOBOOK']::VARCHAR[] LOOP
        SELECT array_agg(category_slug::TEXT ORDER BY category_slug) INTO category_slugs
        FROM pliego.fn_public_category_list(scope);
        IF category_slugs IS DISTINCT FROM (CASE scope
            WHEN 'GLOBAL' THEN ARRAY['scope-audio','scope-ebook','scope-physical','scope-root']
            WHEN 'PHYSICAL' THEN ARRAY['scope-physical','scope-root']
            WHEN 'EBOOK' THEN ARRAY['scope-ebook','scope-root']
            ELSE ARRAY['scope-audio'] END) THEN
            RAISE EXCEPTION 'Categories leaked or lost scoped hierarchy for %: %',scope,category_slugs;
        END IF;
        SELECT * INTO metadata FROM pliego.fn_public_catalog_filter_facets(scope);
        IF metadata.languages IS DISTINCT FROM (CASE scope
            WHEN 'GLOBAL' THEN '["de","en","es","fr"]'::JSONB
            WHEN 'PHYSICAL' THEN '["en","es"]'::JSONB
            WHEN 'EBOOK' THEN '["fr"]'::JSONB ELSE '["de"]'::JSONB END)
           OR metadata.formats IS DISTINCT FROM (CASE scope
            WHEN 'GLOBAL' THEN '["AUDIOBOOK","EBOOK","HARDCOVER","PAPERBACK"]'::JSONB
            WHEN 'PHYSICAL' THEN '["HARDCOVER","PAPERBACK"]'::JSONB
            WHEN 'EBOOK' THEN '["EBOOK"]'::JSONB ELSE '["AUDIOBOOK"]'::JSONB END)
           OR metadata.minimum_price IS DISTINCT FROM (CASE scope
            WHEN 'GLOBAL' THEN 8 WHEN 'PHYSICAL' THEN 12 WHEN 'EBOOK' THEN 8 ELSE 40 END)
           OR metadata.maximum_price IS DISTINCT FROM (CASE scope
            WHEN 'GLOBAL' THEN 40 WHEN 'PHYSICAL' THEN 30 WHEN 'EBOOK' THEN 8 ELSE 40 END) THEN
            RAISE EXCEPTION 'Facet types, languages or effective bounds differ for %: %',scope,metadata;
        END IF;
    END LOOP;
    IF EXISTS(SELECT * FROM pliego.fn_public_category_list() EXCEPT SELECT * FROM pliego.fn_public_category_list('GLOBAL'::VARCHAR))
       OR EXISTS(SELECT * FROM pliego.fn_public_category_list('GLOBAL'::VARCHAR) EXCEPT SELECT * FROM pliego.fn_public_category_list())
       OR (SELECT row_to_json(f)::JSONB FROM pliego.fn_public_catalog_filter_facets() f)
          IS DISTINCT FROM (SELECT row_to_json(f)::JSONB FROM pliego.fn_public_catalog_filter_facets('GLOBAL'::VARCHAR) f) THEN
        RAISE EXCEPTION 'No-argument discovery must preserve GLOBAL behavior';
    END IF;
    -- Category eligibility requires the active parent relationship to be preserved.
    IF NOT EXISTS(SELECT 1 FROM pliego.fn_public_category_list('PHYSICAL'::VARCHAR)
        WHERE category_slug='scope-physical' AND parent_category_slug='scope-root') THEN
        RAISE EXCEPTION 'Scoped categories lost their parent relationship';
    END IF;
    -- Inactive publisher/author and absent cover do not change existing catalog eligibility.
    CALL pliego.sp_publisher_set_status(actor,publisher_id,'INACTIVE');
    CALL pliego.sp_author_set_status(actor,author_id,'INACTIVE');
    IF (SELECT formats FROM pliego.fn_public_catalog_filter_facets('PHYSICAL'::VARCHAR))
       <> '["HARDCOVER","PAPERBACK"]'::JSONB THEN
        RAISE EXCEPTION 'Publisher, author or cover restrictions changed existing eligibility';
    END IF;
    FOREACH invalid_scope IN ARRAY ARRAY[NULL,'','UNKNOWN','physical',' GLOBAL ']::VARCHAR[] LOOP
        BEGIN
            PERFORM * FROM pliego.fn_public_category_list(invalid_scope);
            RAISE EXCEPTION 'Category scope must reject %',invalid_scope;
        EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL;
        END;
        BEGIN
            PERFORM * FROM pliego.fn_public_catalog_filter_facets(invalid_scope);
            RAISE EXCEPTION 'Facet scope must reject %',invalid_scope;
        EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL;
        END;
    END LOOP;
    CALL pliego.sp_edition_set_status(actor,audio_id,'INACTIVE');
    SELECT * INTO metadata FROM pliego.fn_public_catalog_filter_facets('AUDIOBOOK'::VARCHAR);
    IF metadata.languages <> '[]'::JSONB OR metadata.formats <> '[]'::JSONB
       OR metadata.minimum_price IS NOT NULL OR metadata.maximum_price IS NOT NULL
       OR EXISTS(SELECT 1 FROM pliego.fn_public_category_list('AUDIOBOOK'::VARCHAR)) THEN
        RAISE EXCEPTION 'Empty scope must return empty categories/facets and NULL price bounds';
    END IF;
    -- Direct association to a root also qualifies without a child association.
    INSERT INTO pliego.libro_categoria(libro_id,categoria_id) VALUES(ebook_book,root_id);
    DELETE FROM pliego.libro_categoria WHERE libro_id=ebook_book AND categoria_id=ebook_category;
    SELECT array_agg(category_slug::TEXT ORDER BY category_slug) INTO category_slugs
    FROM pliego.fn_public_category_list('EBOOK'::VARCHAR);
    IF category_slugs IS DISTINCT FROM ARRAY['scope-root'] THEN
        RAISE EXCEPTION 'Direct root association lost or empty child remained: %',category_slugs;
    END IF;
    -- Legacy options retain base prices even while scoped facets use an effective offer.
    UPDATE pliego.edicion SET estado='INACTIVE' WHERE formato IN ('EBOOK','AUDIOBOOK');
    IF (SELECT min(minimum_price) FROM pliego.fn_public_catalog_filter_options()) <> 20
       OR (SELECT minimum_price FROM pliego.fn_public_catalog_filter_facets()) <> 12 THEN
        RAISE EXCEPTION 'Legacy base-price or public effective-price contract changed';
    END IF;
END $gate$;
ROLLBACK;
