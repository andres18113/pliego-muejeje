-- Run after Flyway through V038 on PostgreSQL 18. All checks roll back.
BEGIN;
DO $gate$
DECLARE
    v_case RECORD;
BEGIN
    -- Every accepted offset must remain representable by existing INTEGER expressions.
    PERFORM pliego.fn_assert_pagination(0, 50);
    PERFORM pliego.fn_assert_pagination(42949672, 50);
    PERFORM pliego.fn_assert_pagination(2147483647, 1);
    PERFORM * FROM pliego.fn_catalog_search_global(NULL, NULL, NULL, NULL,
        NULL, NULL, 'TITLE_ASC', 42949672, 50);

    FOR v_case IN SELECT * FROM (VALUES
        (42949673, 50), (2147483647, 50), (2147483647, 2)
    ) AS cases(page, page_size) LOOP
        BEGIN
            PERFORM pliego.fn_assert_pagination(v_case.page, v_case.page_size);
            RAISE EXCEPTION 'Expected P1006 for page %, size %', v_case.page, v_case.page_size;
        EXCEPTION WHEN SQLSTATE 'P1006' THEN NULL;
        END;
        BEGIN
            PERFORM * FROM pliego.fn_catalog_search_global(NULL, NULL, NULL, NULL,
                NULL, NULL, 'TITLE_ASC', v_case.page, v_case.page_size);
            RAISE EXCEPTION 'Catalog query should reject an overflowing offset';
        EXCEPTION WHEN SQLSTATE 'P1006' THEN NULL;
        END;
    END LOOP;

    -- Preserve the approved SQLSTATE for invalid individual arguments.
    FOR v_case IN SELECT * FROM (VALUES
        (NULL::INTEGER, 20), (-1, 20), (0, NULL::INTEGER), (0, 0), (0, 51)
    ) AS cases(page, page_size) LOOP
        BEGIN
            PERFORM pliego.fn_assert_pagination(v_case.page, v_case.page_size);
            RAISE EXCEPTION 'Expected P1001 for invalid pagination';
        EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL;
        END;
    END LOOP;
END;
$gate$;
ROLLBACK;
