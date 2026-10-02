-- Run after Flyway through V030 on PostgreSQL 18. All fixtures roll back.
BEGIN;
DO $gate$
DECLARE
    v_admin BIGINT;
    v_author BIGINT;
    v_publisher BIGINT;
    v_category BIGINT;
    v_book BIGINT;
    v_edition BIGINT;
    v_count INTEGER;
    v_isbn TEXT;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado, password_hash, rol, estado)
    VALUES ('v30-global-search-gate-admin@pliego.local', 'fixture-hash', 'ADMIN', 'ACTIVE')
    RETURNING usuario_id INTO v_admin;

    CALL pliego.sp_author_create(v_admin, 'Autor Global V030', NULL, v_author);
    CALL pliego.sp_publisher_create(v_admin, 'Editorial Global V030', NULL, v_publisher);
    CALL pliego.sp_category_create(v_admin, 'Categoría Global V030', 'v30-global-search', NULL, NULL, v_category);

    CALL pliego.sp_book_create(v_admin, 'Libro Título global V030', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)),
        jsonb_build_array(v_category), v_book);
    CALL pliego.sp_edition_create(v_admin, v_book, v_publisher, 'V030-GLOBAL-ISBN', '9780000000309',
        'es', 'PAPERBACK', 120, NULL, 18.50, NULL, NULL, NULL, NULL, v_edition);

    CALL pliego.sp_book_create(v_admin, 'Otra obra global V030', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)),
        jsonb_build_array(v_category), v_book);
    CALL pliego.sp_edition_create(v_admin, v_book, v_publisher, 'V030-GLOBAL-AUTHOR', NULL,
        'es', 'PAPERBACK', 160, NULL, 20.00, NULL, NULL, NULL, NULL, v_edition);

    SELECT count(*) INTO v_count
    FROM pliego.fn_catalog_search_global('Libro Título global', NULL, NULL, NULL, NULL, NULL,
        'TITLE_ASC', 0, 20);
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Title search should return one matching edition; found %', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM pliego.fn_catalog_search_global('Autor Global V030', NULL, NULL, NULL, NULL, NULL,
        'TITLE_ASC', 0, 20);
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'Author search should return both authored works; found %', v_count;
    END IF;

    SELECT count(*), min(isbn13::TEXT) INTO v_count, v_isbn
    FROM pliego.fn_catalog_search_global('978-000-000-0309', NULL, NULL, NULL, NULL, NULL,
        'TITLE_ASC', 0, 20);
    IF v_count <> 1 OR v_isbn <> '9780000000309' THEN
        RAISE EXCEPTION 'Formatted ISBN search should return its exact edition; found % / %', v_count, v_isbn;
    END IF;

    SELECT count(*) INTO v_count
    FROM pliego.fn_catalog_search_global('V030', NULL, NULL, NULL, NULL, NULL,
        'TITLE_ASC', 0, 20);
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'Title and author matches should not duplicate editions; found %', v_count;
    END IF;
END;
$gate$;
ROLLBACK;
