-- PostgreSQL 18 after V031; fixtures and changes are rolled back.
BEGIN;
DO $gate$
DECLARE
    v_admin BIGINT; v_author BIGINT; v_publisher BIGINT; v_category BIGINT;
    v_book BIGINT; v_edition BIGINT; v_languages JSONB; v_formats JSONB; v_min NUMERIC;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado, password_hash, rol, estado)
    VALUES ('v31-facets-gate@example.invalid', 'fixture-hash', 'ADMIN', 'ACTIVE') RETURNING usuario_id INTO v_admin;
    CALL pliego.sp_author_create(v_admin, 'Autor Facetas V031', NULL, v_author);
    CALL pliego.sp_publisher_create(v_admin, 'Editorial Facetas V031', NULL, v_publisher);
    CALL pliego.sp_category_create(v_admin, 'Tema Facetas V031', 'v31-facets', NULL, NULL, v_category);
    CALL pliego.sp_book_create(v_admin, 'Libro Facetas V031', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)), jsonb_build_array(v_category), v_book);
    CALL pliego.sp_edition_create(v_admin, v_book, v_publisher, 'V031-FACETS', NULL,
        'zz', 'HARDCOVER', 120, NULL, 1.37, NULL, NULL, NULL, NULL, v_edition);
    SELECT languages, formats, minimum_price INTO v_languages, v_formats, v_min FROM pliego.fn_public_catalog_filter_facets();
    IF NOT (v_languages ? 'zz') OR NOT (v_formats ? 'HARDCOVER') OR v_min > 1.37 THEN
        RAISE EXCEPTION 'Public metadata must include every public edition, including zero stock';
    END IF;
    UPDATE pliego.libro SET estado = 'INACTIVE' WHERE libro_id = v_book;
    SELECT languages INTO v_languages FROM pliego.fn_public_catalog_filter_facets();
    IF v_languages ? 'zz' THEN RAISE EXCEPTION 'Inactive books must not contribute filter values'; END IF;
    UPDATE pliego.libro SET estado = 'INACTIVE';
    SELECT languages, formats, minimum_price INTO v_languages, v_formats, v_min FROM pliego.fn_public_catalog_filter_facets();
    IF v_languages <> '[]'::jsonb OR v_formats <> '[]'::jsonb OR v_min IS NOT NULL THEN
        RAISE EXCEPTION 'Empty public catalog must return empty facets and null price bounds';
    END IF;
END $gate$;
ROLLBACK;
