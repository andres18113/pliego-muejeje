-- Run after Flyway through V024 on PostgreSQL 18. All fixtures roll back.
BEGIN;
DO $gate$
DECLARE
    v_admin BIGINT;
    v_author BIGINT;
    v_publisher BIGINT;
    v_category BIGINT;
    v_book BIGINT;
    v_edition BIGINT;
    v_sku TEXT := 'V24-COVER-DELIVERY-GATE';
    v_cover_url TEXT := 'https://covers.pliegolibros.com/covers/editions/V24-COVER-DELIVERY-GATE.webp';
    v_search_url TEXT;
    v_detail_url TEXT;
    v_license TEXT;
    v_source_url TEXT;
    v_attribution TEXT;
    v_rejected BOOLEAN := FALSE;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado, password_hash, rol, estado)
    VALUES ('v24-cover-delivery-gate-admin@pliego.local', 'fixture-hash', 'ADMIN', 'ACTIVE')
    RETURNING usuario_id INTO v_admin;

    CALL pliego.sp_author_create(v_admin, 'Autor V24', NULL, v_author);
    CALL pliego.sp_publisher_create(v_admin, 'Editorial V24', NULL, v_publisher);
    CALL pliego.sp_category_create(v_admin, 'Categoría V24', 'v24-covers', NULL, NULL, v_category);
    CALL pliego.sp_book_create(v_admin, 'Libro con portada V24', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)),
        jsonb_build_array(v_category), v_book);
    CALL pliego.sp_edition_create(v_admin, v_book, v_publisher, v_sku, NULL,
        'es', 'PAPERBACK', 120, NULL, 18.50, v_cover_url, NULL, NULL, NULL, v_edition);
    CALL pliego.sp_edition_update(v_admin, v_edition, v_publisher, NULL,
        'es', 'PAPERBACK', 120, NULL, 18.50, v_cover_url, NULL, NULL, NULL);

    SELECT cover_url, cover_license, cover_attribution
    INTO v_search_url, v_license, v_attribution
    FROM pliego.fn_catalog_search(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        'TITLE_ASC', 0, 20)
    WHERE edition_id = v_edition;
    IF v_search_url IS DISTINCT FROM v_cover_url OR v_license IS NOT NULL OR v_attribution IS NOT NULL THEN
        RAISE EXCEPTION 'Catalog search did not preserve the delivery URL and unresolved metadata';
    END IF;

    SELECT cover_url, cover_license, cover_source_url, cover_attribution
    INTO v_detail_url, v_license, v_source_url, v_attribution
    FROM pliego.fn_edition_detail(v_edition);
    IF v_detail_url IS DISTINCT FROM v_cover_url OR v_license IS NOT NULL
            OR v_source_url IS NOT NULL OR v_attribution IS NOT NULL THEN
        RAISE EXCEPTION 'Edition detail did not preserve the delivery URL and unresolved metadata';
    END IF;

    BEGIN
        PERFORM pliego.fn_validate_cover_metadata(v_cover_url, 'CC_BY', NULL, NULL);
    EXCEPTION WHEN SQLSTATE 'P2047' THEN
        v_rejected := TRUE;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'Incomplete declared licensing metadata must remain invalid';
    END IF;
END;
$gate$;
ROLLBACK;
