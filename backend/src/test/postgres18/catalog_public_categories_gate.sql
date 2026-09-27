-- Run after Flyway through V022 on PostgreSQL 18. All fixtures roll back.
BEGIN;
DO $gate$
DECLARE
    v_admin BIGINT;
    v_author BIGINT;
    v_publisher BIGINT;
    v_root BIGINT;
    v_child BIGINT;
    v_inactive_child BIGINT;
    v_empty_category BIGINT;
    v_hidden_root BIGINT;
    v_hidden_child BIGINT;
    v_book BIGINT;
    v_edition BIGINT;
    v_count INTEGER;
    v_available BOOLEAN;
BEGIN
    INSERT INTO pliego.usuario(email_normalizado, password_hash, rol, estado)
    VALUES ('v22-category-gate-admin@pliego.local', 'fixture-hash', 'ADMIN', 'ACTIVE')
    RETURNING usuario_id INTO v_admin;

    CALL pliego.sp_author_create(v_admin, 'Autor V22', NULL, v_author);
    CALL pliego.sp_publisher_create(v_admin, 'Editorial V22', NULL, v_publisher);
    CALL pliego.sp_category_create(v_admin, 'Raíz V22', 'v22-root', NULL, NULL, v_root);
    CALL pliego.sp_category_create(v_admin, 'Subcategoría V22', 'v22-child', NULL, v_root, v_child);
    CALL pliego.sp_category_create(v_admin, 'Subcategoría inactiva V22', 'v22-inactive-child',
        NULL, v_root, v_inactive_child);
    CALL pliego.sp_category_create(v_admin, 'Categoría vacía V22', 'v22-empty', NULL, NULL, v_empty_category);
    CALL pliego.sp_category_create(v_admin, 'Raíz oculta V22', 'v22-hidden-root', NULL, NULL, v_hidden_root);
    CALL pliego.sp_category_create(v_admin, 'Hija de raíz oculta V22', 'v22-hidden-child',
        NULL, v_hidden_root, v_hidden_child);

    CALL pliego.sp_book_create(v_admin, 'Libro público V22', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)),
        jsonb_build_array(v_child), v_book);
    CALL pliego.sp_edition_create(v_admin, v_book, v_publisher, 'V22-PUBLIC-1', NULL,
        'es', 'PAPERBACK', 100, NULL, 15.50, NULL, NULL, NULL, NULL, v_edition);

    CALL pliego.sp_book_create(v_admin, 'Libro de categoría inactiva V22', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)),
        jsonb_build_array(v_inactive_child), v_book);
    CALL pliego.sp_edition_create(v_admin, v_book, v_publisher, 'V22-INACTIVE-1', NULL,
        'es', 'PAPERBACK', 100, NULL, 15.50, NULL, NULL, NULL, NULL, v_edition);
    CALL pliego.sp_category_set_status(v_admin, v_inactive_child, 'INACTIVE');

    CALL pliego.sp_book_create(v_admin, 'Libro de padre inactivo V22', NULL, NULL,
        jsonb_build_array(jsonb_build_object('authorId', v_author, 'order', 1)),
        jsonb_build_array(v_hidden_child), v_book);
    CALL pliego.sp_edition_create(v_admin, v_book, v_publisher, 'V22-HIDDEN-1', NULL,
        'es', 'PAPERBACK', 100, NULL, 15.50, NULL, NULL, NULL, NULL, v_edition);
    CALL pliego.sp_category_set_status(v_admin, v_hidden_root, 'INACTIVE');

    SELECT count(*) INTO v_count FROM pliego.fn_public_category_list();
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'Expected only the root and active child with public editions; found %', v_count;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pliego.fn_public_category_list()
            WHERE category_slug = 'v22-root' AND category_name = 'Raíz V22' AND parent_category_slug IS NULL)
       OR NOT EXISTS (SELECT 1 FROM pliego.fn_public_category_list()
            WHERE category_slug = 'v22-child' AND parent_category_slug = 'v22-root') THEN
        RAISE EXCEPTION 'Public category names/slugs or parent-child relationship are incorrect';
    END IF;
    IF EXISTS (SELECT 1 FROM pliego.fn_public_category_list()
            WHERE category_slug IN ('v22-inactive-child', 'v22-empty', 'v22-hidden-root', 'v22-hidden-child')) THEN
        RAISE EXCEPTION 'Inactive, empty, or parent-hidden categories must not be exposed';
    END IF;

    SELECT count(*), bool_and(available)
    INTO v_count, v_available
    FROM pliego.fn_catalog_search(NULL, NULL, NULL, 'v22-root', NULL, NULL, NULL, NULL,
        'TITLE_ASC', 0, 20);
    IF v_count <> 1 OR v_available IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Root browsing must include active child editions, including zero-stock editions';
    END IF;
    SELECT count(*) INTO v_count
    FROM pliego.fn_catalog_search(NULL, NULL, NULL, 'v22-child', NULL, NULL, NULL, NULL,
        'TITLE_ASC', 0, 20);
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'A public subcategory slug must match its directly associated edition';
    END IF;

    SELECT count(*) INTO v_count
    FROM pliego.fn_catalog_search(NULL, NULL, NULL, 'v22-empty', NULL, NULL, NULL, NULL,
        'TITLE_ASC', 0, 20);
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'An active category without matching public editions must return an empty result';
    END IF;
    SELECT count(*) INTO v_count
    FROM pliego.fn_catalog_search(NULL, NULL, NULL, 'v22-unknown', NULL, NULL, NULL, NULL,
        'TITLE_ASC', 0, 20);
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'An unknown syntactically valid slug must preserve the documented empty-page behavior';
    END IF;

    BEGIN
        PERFORM 1 FROM pliego.fn_catalog_search(NULL, NULL, NULL, 'v22-inactive-child', NULL, NULL, NULL, NULL,
            'TITLE_ASC', 0, 20);
        RAISE EXCEPTION 'Expected inactive category filter to raise P2022';
    EXCEPTION WHEN SQLSTATE 'P2022' THEN
        NULL;
    END;
    BEGIN
        PERFORM 1 FROM pliego.fn_catalog_search(NULL, NULL, NULL, 'v22-hidden-child', NULL, NULL, NULL, NULL,
            'TITLE_ASC', 0, 20);
        RAISE EXCEPTION 'Expected category under an inactive parent to raise P2022';
    EXCEPTION WHEN SQLSTATE 'P2022' THEN
        NULL;
    END;
END;
$gate$;
ROLLBACK;
