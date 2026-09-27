-- Run after Flyway through V023 on PostgreSQL 18. All fixtures roll back.
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
    v_minimum NUMERIC(11,2);
    v_maximum NUMERIC(11,2);
BEGIN
    INSERT INTO pliego.usuario(email_normalizado, password_hash, rol, estado)
    VALUES ('v23-filter-options-gate-admin@pliego.local', 'fixture-hash', 'ADMIN', 'ACTIVE')
    RETURNING usuario_id INTO v_admin;

    CALL pliego.sp_author_create(v_admin, 'Autor V23', NULL, v_author);
    CALL pliego.sp_publisher_create(v_admin, 'Editorial V23', NULL, v_publisher);
    CALL pliego.sp_category_create(v_admin, 'Categoría V23', 'v23-category', NULL, NULL, v_category);

    CALL pliego.sp_book_create(v_admin, 'Libro en V23', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)),
        jsonb_build_array(v_category), v_book);
    CALL pliego.sp_edition_create(v_admin, v_book, v_publisher, 'V23-EN-1', NULL,
        'en', 'PAPERBACK', 100, NULL, 7.25, NULL, NULL, NULL, NULL, v_edition);

    CALL pliego.sp_book_create(v_admin, 'Libro en español V23', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)),
        jsonb_build_array(v_category), v_book);
    CALL pliego.sp_edition_create(v_admin, v_book, v_publisher, 'V23-ES-1', NULL,
        'es', 'HARDCOVER', 200, NULL, 38.00, NULL, NULL, NULL, NULL, v_edition);

    SELECT count(DISTINCT language_code), min(minimum_price), max(maximum_price)
    INTO v_count, v_minimum, v_maximum
    FROM pliego.fn_public_catalog_filter_options();
    IF v_count <> 2 OR v_minimum <> 7.25 OR v_maximum <> 38.00 THEN
        RAISE EXCEPTION 'Expected languages en/es and bounds 7.25–38.00; found % languages and bounds %–%',
            v_count, v_minimum, v_maximum;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pliego.fn_public_catalog_filter_options()
        WHERE minimum_price IS DISTINCT FROM 7.25 OR maximum_price IS DISTINCT FROM 38.00
    ) THEN
        RAISE EXCEPTION 'Every language option must repeat the same global public price bounds';
    END IF;
END;
$gate$;
ROLLBACK;
