-- Report why one copy of an edition is unavailable in catalog and favorites.
-- Use the status precedence of the cart read and the existing single-copy availability check.
CREATE FUNCTION pliego.fn_edition_unavailability_reason(
    p_format TEXT, p_book_state TEXT, p_edition_state TEXT, p_stock INTEGER
)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$
    SELECT CASE
        WHEN p_book_state IS DISTINCT FROM 'ACTIVE' THEN 'P2043'
        WHEN p_edition_state IS DISTINCT FROM 'ACTIVE' THEN 'P2042'
        WHEN pliego.fn_is_physical_format(p_format)
            AND NOT pliego.fn_edition_available(p_format, p_book_state, p_edition_state, p_stock) THEN 'OUT_OF_STOCK'
        ELSE NULL
    END;
$$;

-- Append the new OUT column. PostgreSQL requires recreating these routines to
-- change their return type. Keep the catalog estimates and the two V079 ROWS hints.
DROP FUNCTION pliego.fn_catalog_search(VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER);
DROP FUNCTION pliego.fn_catalog_search(VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR);
DROP FUNCTION pliego.fn_catalog_search_global(VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER);
DROP FUNCTION pliego.fn_catalog_search_global(VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR);
DROP FUNCTION pliego.fn_catalog_search_offers(VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER);
DROP FUNCTION pliego.fn_catalog_search_global_offers(VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER);
DROP FUNCTION pliego.fn_edition_detail(BIGINT);
DROP FUNCTION pliego.fn_customer_favorites(BIGINT, INTEGER, INTEGER);

CREATE FUNCTION pliego.fn_catalog_search(
    p_title_query VARCHAR, p_author_query VARCHAR, p_isbn13 VARCHAR,
    p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_sort VARCHAR,
    p_page INTEGER, p_page_size INTEGER
)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, authors_ordered VARCHAR,
    publisher_name VARCHAR, isbn13 CHAR(13), price NUMERIC(11,2),
    cover_url VARCHAR, cover_license VARCHAR, cover_attribution VARCHAR,
    format VARCHAR, language VARCHAR, available BOOLEAN, total_count BIGINT,
    ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[], unavailability_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_title TEXT := NULLIF(pliego.fn_search_fold(btrim(p_title_query)), '');
    v_author TEXT := NULLIF(pliego.fn_search_fold(btrim(p_author_query)), '');
    v_category TEXT := CASE WHEN p_category_slug IS NULL OR btrim(p_category_slug) = ''
        THEN NULL ELSE pliego.fn_normalize_slug(p_category_slug) END;
    v_language TEXT := CASE WHEN p_language IS NULL OR btrim(p_language) = ''
        THEN NULL ELSE pliego.fn_normalize_language(p_language) END;
    v_category_state VARCHAR;
    v_parent_category_id BIGINT;
    v_parent_state VARCHAR;
BEGIN
    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);
    IF p_sort IS NULL OR p_sort NOT IN ('TITLE_ASC', 'TITLE_DESC', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid sort');
    END IF;
    IF p_isbn13 IS NOT NULL AND p_isbn13 !~ '^[0-9]{13}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid ISBN filter');
    END IF;
    IF (p_price_min IS NOT NULL AND p_price_min < 0)
       OR (p_price_max IS NOT NULL AND p_price_max < 0)
       OR (p_price_min IS NOT NULL AND p_price_max IS NOT NULL AND p_price_min > p_price_max) THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid price range');
    END IF;
    IF v_language IS NOT NULL AND v_language !~ '^[a-z]{2,3}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid language');
    END IF;
    IF p_format IS NOT NULL AND p_format NOT IN ('PAPERBACK', 'HARDCOVER', 'EBOOK', 'AUDIOBOOK') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid format');
    END IF;

    IF v_category IS NOT NULL THEN
        SELECT category.estado, category.categoria_padre_id, parent.estado
        INTO v_category_state, v_parent_category_id, v_parent_state
        FROM pliego.categoria AS category
        LEFT JOIN pliego.categoria AS parent
            ON parent.categoria_id = category.categoria_padre_id
        WHERE category.slug = v_category;

        IF FOUND AND (v_category_state <> 'ACTIVE'
            OR (v_parent_category_id IS NOT NULL AND v_parent_state <> 'ACTIVE')) THEN
            PERFORM pliego.fn_raise_domain_error('P2022', 'CATEGORY_INACTIVE');
        END IF;
    END IF;

    RETURN QUERY
    SELECT e.edicion_id, l.libro_id, l.titulo, pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre, e.isbn13, pliego.fn_edition_price(e.edicion_id), e.portada_url, e.portada_licencia, e.portada_atribucion,
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores,
           pliego.fn_edition_unavailability_reason(e.formato,l.estado,e.estado,i.stock_actual)
    FROM pliego.edicion AS e
    JOIN pliego.libro AS l ON l.libro_id = e.libro_id
    JOIN pliego.editorial AS pub ON pub.editorial_id = e.editorial_id
    LEFT JOIN pliego.inventario AS i ON i.edicion_id = e.edicion_id
    LEFT JOIN pliego.fn_catalog_sales_30d() AS sales ON sales.edition_id = e.edicion_id
    WHERE e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
      AND (v_title IS NULL OR l.search_title_folded LIKE '%' || v_title || '%')
      AND (v_author IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_autor AS la
            JOIN pliego.autor AS a ON a.autor_id = la.autor_id
            WHERE la.libro_id = l.libro_id AND a.search_name_folded LIKE '%' || v_author || '%'))
      AND (p_isbn13 IS NULL OR e.isbn13 = p_isbn13)
      AND (v_category IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_categoria AS lc
            JOIN pliego.categoria AS c ON c.categoria_id = lc.categoria_id
            LEFT JOIN pliego.categoria AS cp ON cp.categoria_id = c.categoria_padre_id
            WHERE lc.libro_id = l.libro_id
              AND c.estado = 'ACTIVE'
              AND (c.categoria_padre_id IS NULL OR cp.estado = 'ACTIVE')
              AND (c.slug = v_category OR cp.slug = v_category)))
      AND (p_price_min IS NULL OR pliego.fn_edition_price(e.edicion_id) >= p_price_min)
      AND (p_price_max IS NULL OR pliego.fn_edition_price(e.edicion_id) <= p_price_max)
      AND (v_language IS NULL OR e.idioma = v_language)
      AND (p_format IS NULL OR e.formato = p_format)
    ORDER BY CASE WHEN p_sort = 'BEST_SELLING' THEN coalesce(sales.units,0) END DESC NULLS LAST,
             CASE WHEN p_sort = 'BEST_SELLING' THEN e.fecha_creacion END DESC NULLS LAST,
             CASE WHEN p_sort = 'TITLE_ASC' THEN l.titulo COLLATE pliego.catalog_title_es END ASC NULLS LAST,
             CASE WHEN p_sort = 'TITLE_DESC' THEN l.titulo COLLATE pliego.catalog_title_es END DESC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

CREATE FUNCTION pliego.fn_catalog_search(
    p_title_query VARCHAR, p_author_query VARCHAR, p_isbn13 VARCHAR,
    p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_sort VARCHAR,
    p_page INTEGER, p_page_size INTEGER, p_product_type VARCHAR
)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, authors_ordered VARCHAR,
    publisher_name VARCHAR, isbn13 CHAR(13), price NUMERIC(11,2),
    cover_url VARCHAR, cover_license VARCHAR, cover_attribution VARCHAR,
    format VARCHAR, language VARCHAR, available BOOLEAN, total_count BIGINT,
    ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[], unavailability_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_title TEXT := NULLIF(pliego.fn_search_fold(btrim(p_title_query)), '');
    v_author TEXT := NULLIF(pliego.fn_search_fold(btrim(p_author_query)), '');
    v_category TEXT := CASE WHEN p_category_slug IS NULL OR btrim(p_category_slug) = ''
        THEN NULL ELSE pliego.fn_normalize_slug(p_category_slug) END;
    v_language TEXT := CASE WHEN p_language IS NULL OR btrim(p_language) = ''
        THEN NULL ELSE pliego.fn_normalize_language(p_language) END;
    v_category_state VARCHAR;
    v_parent_category_id BIGINT;
    v_parent_state VARCHAR;
BEGIN
    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);
    IF p_product_type IS NOT NULL AND p_product_type NOT IN ('PHYSICAL','EBOOK','AUDIOBOOK') THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Invalid product type');
    END IF;
    IF p_sort IS NULL OR p_sort NOT IN ('TITLE_ASC', 'TITLE_DESC', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid sort');
    END IF;
    IF p_isbn13 IS NOT NULL AND p_isbn13 !~ '^[0-9]{13}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid ISBN filter');
    END IF;
    IF (p_price_min IS NOT NULL AND p_price_min < 0)
       OR (p_price_max IS NOT NULL AND p_price_max < 0)
       OR (p_price_min IS NOT NULL AND p_price_max IS NOT NULL AND p_price_min > p_price_max) THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid price range');
    END IF;
    IF v_language IS NOT NULL AND v_language !~ '^[a-z]{2,3}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid language');
    END IF;
    IF p_format IS NOT NULL AND p_format NOT IN ('PAPERBACK', 'HARDCOVER', 'EBOOK', 'AUDIOBOOK') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid format');
    END IF;

    IF v_category IS NOT NULL THEN
        SELECT category.estado, category.categoria_padre_id, parent.estado
        INTO v_category_state, v_parent_category_id, v_parent_state
        FROM pliego.categoria AS category
        LEFT JOIN pliego.categoria AS parent
            ON parent.categoria_id = category.categoria_padre_id
        WHERE category.slug = v_category;

        IF FOUND AND (v_category_state <> 'ACTIVE'
            OR (v_parent_category_id IS NOT NULL AND v_parent_state <> 'ACTIVE')) THEN
            PERFORM pliego.fn_raise_domain_error('P2022', 'CATEGORY_INACTIVE');
        END IF;
    END IF;

    RETURN QUERY
    SELECT e.edicion_id, l.libro_id, l.titulo, pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre, e.isbn13, pliego.fn_edition_price(e.edicion_id), e.portada_url, e.portada_licencia, e.portada_atribucion,
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores,
           pliego.fn_edition_unavailability_reason(e.formato,l.estado,e.estado,i.stock_actual)
    FROM pliego.edicion AS e
    JOIN pliego.libro AS l ON l.libro_id = e.libro_id
    JOIN pliego.editorial AS pub ON pub.editorial_id = e.editorial_id
    LEFT JOIN pliego.inventario AS i ON i.edicion_id = e.edicion_id
    LEFT JOIN pliego.fn_catalog_sales_30d() AS sales ON sales.edition_id = e.edicion_id
    WHERE e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
      AND (v_title IS NULL OR l.search_title_folded LIKE '%' || v_title || '%')
      AND (v_author IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_autor AS la
            JOIN pliego.autor AS a ON a.autor_id = la.autor_id
            WHERE la.libro_id = l.libro_id AND a.search_name_folded LIKE '%' || v_author || '%'))
      AND (p_isbn13 IS NULL OR e.isbn13 = p_isbn13)
      AND (v_category IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_categoria AS lc
            JOIN pliego.categoria AS c ON c.categoria_id = lc.categoria_id
            LEFT JOIN pliego.categoria AS cp ON cp.categoria_id = c.categoria_padre_id
            WHERE lc.libro_id = l.libro_id
              AND c.estado = 'ACTIVE'
              AND (c.categoria_padre_id IS NULL OR cp.estado = 'ACTIVE')
              AND (c.slug = v_category OR cp.slug = v_category)))
      AND (p_price_min IS NULL OR pliego.fn_edition_price(e.edicion_id) >= p_price_min)
      AND (p_price_max IS NULL OR pliego.fn_edition_price(e.edicion_id) <= p_price_max)
      AND (v_language IS NULL OR e.idioma = v_language)
      AND (p_format IS NULL OR e.formato = p_format)
      AND (p_product_type IS NULL OR pliego.fn_edition_product_type(e.formato) = p_product_type)
    ORDER BY CASE WHEN p_sort = 'BEST_SELLING' THEN coalesce(sales.units,0) END DESC NULLS LAST,
             CASE WHEN p_sort = 'BEST_SELLING' THEN e.fecha_creacion END DESC NULLS LAST,
             CASE WHEN p_sort = 'TITLE_ASC' THEN l.titulo COLLATE pliego.catalog_title_es END ASC NULLS LAST,
             CASE WHEN p_sort = 'TITLE_DESC' THEN l.titulo COLLATE pliego.catalog_title_es END DESC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

CREATE FUNCTION pliego.fn_catalog_search_global(
    p_query VARCHAR, p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_sort VARCHAR, p_page INTEGER, p_page_size INTEGER
)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, authors_ordered VARCHAR,
    publisher_name VARCHAR, isbn13 CHAR(13), price NUMERIC(11,2),
    cover_url VARCHAR, cover_license VARCHAR, cover_attribution VARCHAR,
    format VARCHAR, language VARCHAR, available BOOLEAN, total_count BIGINT,
    ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[], unavailability_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_query TEXT := NULLIF(pliego.fn_search_fold(btrim(p_query)), '');
    v_compact_query TEXT := CASE WHEN p_query IS NULL THEN NULL
        ELSE regexp_replace(btrim(p_query), '[-[:space:]]', '', 'g') END;
    v_isbn13 TEXT;
    v_category TEXT := CASE WHEN p_category_slug IS NULL OR btrim(p_category_slug) = ''
        THEN NULL ELSE pliego.fn_normalize_slug(p_category_slug) END;
    v_language TEXT := CASE WHEN p_language IS NULL OR btrim(p_language) = ''
        THEN NULL ELSE pliego.fn_normalize_language(p_language) END;
    v_category_state VARCHAR;
    v_parent_category_id BIGINT;
    v_parent_state VARCHAR;
BEGIN
    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);
    IF p_query IS NOT NULL AND char_length(p_query) > 140 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid search query');
    END IF;
    IF p_sort IS NULL OR p_sort NOT IN ('TITLE_ASC', 'TITLE_DESC', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid sort');
    END IF;
    IF (p_price_min IS NOT NULL AND p_price_min < 0)
       OR (p_price_max IS NOT NULL AND p_price_max < 0)
       OR (p_price_min IS NOT NULL AND p_price_max IS NOT NULL AND p_price_min > p_price_max) THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid price range');
    END IF;
    IF v_language IS NOT NULL AND v_language !~ '^[a-z]{2,3}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid language');
    END IF;
    IF p_format IS NOT NULL AND p_format NOT IN ('PAPERBACK', 'HARDCOVER', 'EBOOK', 'AUDIOBOOK') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid format');
    END IF;

    IF v_compact_query ~ '^[0-9]{13}$' THEN
        v_isbn13 := v_compact_query;
    END IF;

    IF v_category IS NOT NULL THEN
        SELECT category.estado, category.categoria_padre_id, parent.estado
        INTO v_category_state, v_parent_category_id, v_parent_state
        FROM pliego.categoria AS category
        LEFT JOIN pliego.categoria AS parent
            ON parent.categoria_id = category.categoria_padre_id
        WHERE category.slug = v_category;

        IF FOUND AND (v_category_state <> 'ACTIVE'
            OR (v_parent_category_id IS NOT NULL AND v_parent_state <> 'ACTIVE')) THEN
            PERFORM pliego.fn_raise_domain_error('P2022', 'CATEGORY_INACTIVE');
        END IF;
    END IF;

    RETURN QUERY
    SELECT e.edicion_id, l.libro_id, l.titulo, pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre, e.isbn13, pliego.fn_edition_price(e.edicion_id), e.portada_url, e.portada_licencia, e.portada_atribucion,
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores,
           pliego.fn_edition_unavailability_reason(e.formato,l.estado,e.estado,i.stock_actual)
    FROM pliego.edicion AS e
    JOIN pliego.libro AS l ON l.libro_id = e.libro_id
    JOIN pliego.editorial AS pub ON pub.editorial_id = e.editorial_id
    LEFT JOIN pliego.inventario AS i ON i.edicion_id = e.edicion_id
    LEFT JOIN pliego.fn_catalog_sales_30d() AS sales ON sales.edition_id = e.edicion_id
    WHERE e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
      AND (v_query IS NULL OR (
            (v_isbn13 IS NOT NULL AND e.isbn13::TEXT = v_isbn13)
            OR (v_isbn13 IS NULL AND (
                l.search_title_folded LIKE '%' || v_query || '%'
                OR EXISTS (
                    SELECT 1
                    FROM pliego.libro_autor AS la
                    JOIN pliego.autor AS a ON a.autor_id = la.autor_id
                    WHERE la.libro_id = l.libro_id
                      AND a.search_name_folded LIKE '%' || v_query || '%'
                )
            ))
      ))
      AND (v_category IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_categoria AS lc
            JOIN pliego.categoria AS c ON c.categoria_id = lc.categoria_id
            LEFT JOIN pliego.categoria AS cp ON cp.categoria_id = c.categoria_padre_id
            WHERE lc.libro_id = l.libro_id
              AND c.estado = 'ACTIVE'
              AND (c.categoria_padre_id IS NULL OR cp.estado = 'ACTIVE')
              AND (c.slug = v_category OR cp.slug = v_category)))
      AND (p_price_min IS NULL OR pliego.fn_edition_price(e.edicion_id) >= p_price_min)
      AND (p_price_max IS NULL OR pliego.fn_edition_price(e.edicion_id) <= p_price_max)
      AND (v_language IS NULL OR e.idioma = v_language)
      AND (p_format IS NULL OR e.formato = p_format)
    ORDER BY CASE WHEN p_sort = 'BEST_SELLING' THEN coalesce(sales.units,0) END DESC NULLS LAST,
             CASE WHEN p_sort = 'BEST_SELLING' THEN e.fecha_creacion END DESC NULLS LAST,
             CASE WHEN p_sort = 'TITLE_ASC' THEN l.titulo COLLATE pliego.catalog_title_es END ASC NULLS LAST,
             CASE WHEN p_sort = 'TITLE_DESC' THEN l.titulo COLLATE pliego.catalog_title_es END DESC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

CREATE FUNCTION pliego.fn_catalog_search_global(
    p_query VARCHAR, p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_sort VARCHAR, p_page INTEGER, p_page_size INTEGER, p_product_type VARCHAR
)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, authors_ordered VARCHAR,
    publisher_name VARCHAR, isbn13 CHAR(13), price NUMERIC(11,2),
    cover_url VARCHAR, cover_license VARCHAR, cover_attribution VARCHAR,
    format VARCHAR, language VARCHAR, available BOOLEAN, total_count BIGINT,
    ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[], unavailability_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_query TEXT := NULLIF(pliego.fn_search_fold(btrim(p_query)), '');
    v_compact_query TEXT := CASE WHEN p_query IS NULL THEN NULL
        ELSE regexp_replace(btrim(p_query), '[-[:space:]]', '', 'g') END;
    v_isbn13 TEXT;
    v_category TEXT := CASE WHEN p_category_slug IS NULL OR btrim(p_category_slug) = ''
        THEN NULL ELSE pliego.fn_normalize_slug(p_category_slug) END;
    v_language TEXT := CASE WHEN p_language IS NULL OR btrim(p_language) = ''
        THEN NULL ELSE pliego.fn_normalize_language(p_language) END;
    v_category_state VARCHAR;
    v_parent_category_id BIGINT;
    v_parent_state VARCHAR;
BEGIN
    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);
    IF p_product_type IS NOT NULL AND p_product_type NOT IN ('PHYSICAL','EBOOK','AUDIOBOOK') THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Invalid product type');
    END IF;
    IF p_query IS NOT NULL AND char_length(p_query) > 140 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid search query');
    END IF;
    IF p_sort IS NULL OR p_sort NOT IN ('TITLE_ASC', 'TITLE_DESC', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid sort');
    END IF;
    IF (p_price_min IS NOT NULL AND p_price_min < 0)
       OR (p_price_max IS NOT NULL AND p_price_max < 0)
       OR (p_price_min IS NOT NULL AND p_price_max IS NOT NULL AND p_price_min > p_price_max) THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid price range');
    END IF;
    IF v_language IS NOT NULL AND v_language !~ '^[a-z]{2,3}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid language');
    END IF;
    IF p_format IS NOT NULL AND p_format NOT IN ('PAPERBACK', 'HARDCOVER', 'EBOOK', 'AUDIOBOOK') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid format');
    END IF;

    IF v_compact_query ~ '^[0-9]{13}$' THEN
        v_isbn13 := v_compact_query;
    END IF;

    IF v_category IS NOT NULL THEN
        SELECT category.estado, category.categoria_padre_id, parent.estado
        INTO v_category_state, v_parent_category_id, v_parent_state
        FROM pliego.categoria AS category
        LEFT JOIN pliego.categoria AS parent
            ON parent.categoria_id = category.categoria_padre_id
        WHERE category.slug = v_category;

        IF FOUND AND (v_category_state <> 'ACTIVE'
            OR (v_parent_category_id IS NOT NULL AND v_parent_state <> 'ACTIVE')) THEN
            PERFORM pliego.fn_raise_domain_error('P2022', 'CATEGORY_INACTIVE');
        END IF;
    END IF;

    RETURN QUERY
    SELECT e.edicion_id, l.libro_id, l.titulo, pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre, e.isbn13, pliego.fn_edition_price(e.edicion_id), e.portada_url, e.portada_licencia, e.portada_atribucion,
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores,
           pliego.fn_edition_unavailability_reason(e.formato,l.estado,e.estado,i.stock_actual)
    FROM pliego.edicion AS e
    JOIN pliego.libro AS l ON l.libro_id = e.libro_id
    JOIN pliego.editorial AS pub ON pub.editorial_id = e.editorial_id
    LEFT JOIN pliego.inventario AS i ON i.edicion_id = e.edicion_id
    LEFT JOIN pliego.fn_catalog_sales_30d() AS sales ON sales.edition_id = e.edicion_id
    WHERE e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
      AND (v_query IS NULL OR (
            (v_isbn13 IS NOT NULL AND e.isbn13::TEXT = v_isbn13)
            OR (v_isbn13 IS NULL AND (
                l.search_title_folded LIKE '%' || v_query || '%'
                OR EXISTS (
                    SELECT 1
                    FROM pliego.libro_autor AS la
                    JOIN pliego.autor AS a ON a.autor_id = la.autor_id
                    WHERE la.libro_id = l.libro_id
                      AND a.search_name_folded LIKE '%' || v_query || '%'
                )
            ))
      ))
      AND (v_category IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_categoria AS lc
            JOIN pliego.categoria AS c ON c.categoria_id = lc.categoria_id
            LEFT JOIN pliego.categoria AS cp ON cp.categoria_id = c.categoria_padre_id
            WHERE lc.libro_id = l.libro_id
              AND c.estado = 'ACTIVE'
              AND (c.categoria_padre_id IS NULL OR cp.estado = 'ACTIVE')
              AND (c.slug = v_category OR cp.slug = v_category)))
      AND (p_price_min IS NULL OR pliego.fn_edition_price(e.edicion_id) >= p_price_min)
      AND (p_price_max IS NULL OR pliego.fn_edition_price(e.edicion_id) <= p_price_max)
      AND (v_language IS NULL OR e.idioma = v_language)
      AND (p_format IS NULL OR e.formato = p_format)
      AND (p_product_type IS NULL OR pliego.fn_edition_product_type(e.formato) = p_product_type)
    ORDER BY CASE WHEN p_sort = 'BEST_SELLING' THEN coalesce(sales.units,0) END DESC NULLS LAST,
             CASE WHEN p_sort = 'BEST_SELLING' THEN e.fecha_creacion END DESC NULLS LAST,
             CASE WHEN p_sort = 'TITLE_ASC' THEN l.titulo COLLATE pliego.catalog_title_es END ASC NULLS LAST,
             CASE WHEN p_sort = 'TITLE_DESC' THEN l.titulo COLLATE pliego.catalog_title_es END DESC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

CREATE FUNCTION pliego.fn_catalog_search_offers(
    p_title_query VARCHAR, p_author_query VARCHAR, p_isbn13 VARCHAR,
    p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_product_type VARCHAR, p_sort VARCHAR,
    p_page INTEGER, p_page_size INTEGER
)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, authors_ordered VARCHAR,
    publisher_name VARCHAR, isbn13 CHAR(13), price NUMERIC(11,2),
    cover_url VARCHAR, cover_license VARCHAR, cover_attribution VARCHAR,
    format VARCHAR, language VARCHAR, available BOOLEAN, total_count BIGINT,
    ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[], unavailability_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_title TEXT := NULLIF(pliego.fn_search_fold(btrim(p_title_query)), '');
    v_author TEXT := NULLIF(pliego.fn_search_fold(btrim(p_author_query)), '');
    v_category TEXT := CASE WHEN p_category_slug IS NULL OR btrim(p_category_slug) = ''
        THEN NULL ELSE pliego.fn_normalize_slug(p_category_slug) END;
    v_language TEXT := CASE WHEN p_language IS NULL OR btrim(p_language) = ''
        THEN NULL ELSE pliego.fn_normalize_language(p_language) END;
    v_category_state VARCHAR;
    v_parent_category_id BIGINT;
    v_parent_state VARCHAR;
BEGIN
    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);
    IF p_sort IS NULL OR p_sort NOT IN ('RELEVANCE', 'ENDING_SOON', 'PRICE_ASC', 'PRICE_DESC') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid sort');
    END IF;
    IF p_isbn13 IS NOT NULL AND p_isbn13 !~ '^[0-9]{13}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid ISBN filter');
    END IF;
    IF (p_price_min IS NOT NULL AND p_price_min < 0)
       OR (p_price_max IS NOT NULL AND p_price_max < 0)
       OR (p_price_min IS NOT NULL AND p_price_max IS NOT NULL AND p_price_min > p_price_max) THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid price range');
    END IF;
    IF v_language IS NOT NULL AND v_language !~ '^[a-z]{2,3}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid language');
    END IF;
    IF p_format IS NOT NULL AND p_format NOT IN ('PAPERBACK', 'HARDCOVER', 'EBOOK', 'AUDIOBOOK') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid format');
    END IF;

    IF v_category IS NOT NULL THEN
        SELECT category.estado, category.categoria_padre_id, parent.estado
        INTO v_category_state, v_parent_category_id, v_parent_state
        FROM pliego.categoria AS category
        LEFT JOIN pliego.categoria AS parent
            ON parent.categoria_id = category.categoria_padre_id
        WHERE category.slug = v_category;

        IF FOUND AND (v_category_state <> 'ACTIVE'
            OR (v_parent_category_id IS NOT NULL AND v_parent_state <> 'ACTIVE')) THEN
            PERFORM pliego.fn_raise_domain_error('P2022', 'CATEGORY_INACTIVE');
        END IF;
    END IF;

    IF p_product_type IS NOT NULL AND p_product_type NOT IN('PHYSICAL','EBOOK','AUDIOBOOK') THEN
      PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
    RETURN QUERY
    SELECT e.edicion_id, l.libro_id, l.titulo, pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre, e.isbn13, pliego.fn_edition_price(e.edicion_id), e.portada_url, e.portada_licencia, e.portada_atribucion,
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores,
           pliego.fn_edition_unavailability_reason(e.formato,l.estado,e.estado,i.stock_actual)
    FROM pliego.edicion AS e
    JOIN pliego.libro AS l ON l.libro_id = e.libro_id
    JOIN pliego.editorial AS pub ON pub.editorial_id = e.editorial_id
    LEFT JOIN pliego.inventario AS i ON i.edicion_id = e.edicion_id
    WHERE (SELECT offer_id FROM pliego.fn_edition_offer(e.edicion_id)) IS NOT NULL AND e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
      AND (v_title IS NULL OR l.search_title_folded LIKE '%' || v_title || '%')
      AND (v_author IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_autor AS la
            JOIN pliego.autor AS a ON a.autor_id = la.autor_id
            WHERE la.libro_id = l.libro_id AND a.search_name_folded LIKE '%' || v_author || '%'))
      AND (p_isbn13 IS NULL OR e.isbn13 = p_isbn13)
      AND (v_category IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_categoria AS lc
            JOIN pliego.categoria AS c ON c.categoria_id = lc.categoria_id
            LEFT JOIN pliego.categoria AS cp ON cp.categoria_id = c.categoria_padre_id
            WHERE lc.libro_id = l.libro_id
              AND c.estado = 'ACTIVE'
              AND (c.categoria_padre_id IS NULL OR cp.estado = 'ACTIVE')
              AND (c.slug = v_category OR cp.slug = v_category)))
      AND (p_price_min IS NULL OR pliego.fn_edition_price(e.edicion_id) >= p_price_min)
      AND (p_price_max IS NULL OR pliego.fn_edition_price(e.edicion_id) <= p_price_max)
      AND (v_language IS NULL OR e.idioma = v_language)
      AND (p_format IS NULL OR e.formato = p_format)
      AND (p_product_type IS NULL OR CASE WHEN pliego.fn_is_physical_format(e.formato) THEN 'PHYSICAL' ELSE e.formato END=p_product_type)
    ORDER BY CASE WHEN p_sort='RELEVANCE' THEN (SELECT discount_amount FROM pliego.fn_edition_offer(e.edicion_id)) END DESC NULLS LAST,
             CASE WHEN p_sort IN('RELEVANCE','ENDING_SOON') THEN (SELECT ends_at FROM pliego.fn_edition_offer(e.edicion_id)) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

CREATE FUNCTION pliego.fn_catalog_search_global_offers(
    p_query VARCHAR, p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_sort VARCHAR, p_page INTEGER, p_page_size INTEGER
)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, authors_ordered VARCHAR,
    publisher_name VARCHAR, isbn13 CHAR(13), price NUMERIC(11,2),
    cover_url VARCHAR, cover_license VARCHAR, cover_attribution VARCHAR,
    format VARCHAR, language VARCHAR, available BOOLEAN, total_count BIGINT,
    ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[], unavailability_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_query TEXT := NULLIF(pliego.fn_search_fold(btrim(p_query)), '');
    v_compact_query TEXT := CASE WHEN p_query IS NULL THEN NULL
        ELSE regexp_replace(btrim(p_query), '[-[:space:]]', '', 'g') END;
    v_isbn13 TEXT;
    v_category TEXT := CASE WHEN p_category_slug IS NULL OR btrim(p_category_slug) = ''
        THEN NULL ELSE pliego.fn_normalize_slug(p_category_slug) END;
    v_language TEXT := CASE WHEN p_language IS NULL OR btrim(p_language) = ''
        THEN NULL ELSE pliego.fn_normalize_language(p_language) END;
    v_category_state VARCHAR;
    v_parent_category_id BIGINT;
    v_parent_state VARCHAR;
BEGIN
    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);
    IF p_query IS NOT NULL AND char_length(p_query) > 140 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid search query');
    END IF;
    IF p_sort IS NULL OR p_sort NOT IN ('TITLE_ASC', 'PRICE_ASC', 'PRICE_DESC') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid sort');
    END IF;
    IF (p_price_min IS NOT NULL AND p_price_min < 0)
       OR (p_price_max IS NOT NULL AND p_price_max < 0)
       OR (p_price_min IS NOT NULL AND p_price_max IS NOT NULL AND p_price_min > p_price_max) THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid price range');
    END IF;
    IF v_language IS NOT NULL AND v_language !~ '^[a-z]{2,3}$' THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid language');
    END IF;
    IF p_format IS NOT NULL AND p_format NOT IN ('PAPERBACK', 'HARDCOVER', 'EBOOK', 'AUDIOBOOK') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid format');
    END IF;

    IF v_compact_query ~ '^[0-9]{13}$' THEN
        v_isbn13 := v_compact_query;
    END IF;

    IF v_category IS NOT NULL THEN
        SELECT category.estado, category.categoria_padre_id, parent.estado
        INTO v_category_state, v_parent_category_id, v_parent_state
        FROM pliego.categoria AS category
        LEFT JOIN pliego.categoria AS parent
            ON parent.categoria_id = category.categoria_padre_id
        WHERE category.slug = v_category;

        IF FOUND AND (v_category_state <> 'ACTIVE'
            OR (v_parent_category_id IS NOT NULL AND v_parent_state <> 'ACTIVE')) THEN
            PERFORM pliego.fn_raise_domain_error('P2022', 'CATEGORY_INACTIVE');
        END IF;
    END IF;

    RETURN QUERY
    SELECT e.edicion_id, l.libro_id, l.titulo, pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre, e.isbn13, pliego.fn_edition_price(e.edicion_id), e.portada_url, e.portada_licencia, e.portada_atribucion,
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores,
           pliego.fn_edition_unavailability_reason(e.formato,l.estado,e.estado,i.stock_actual)
    FROM pliego.edicion AS e
    JOIN pliego.libro AS l ON l.libro_id = e.libro_id
    JOIN pliego.editorial AS pub ON pub.editorial_id = e.editorial_id
    LEFT JOIN pliego.inventario AS i ON i.edicion_id = e.edicion_id
    WHERE (SELECT offer_id FROM pliego.fn_edition_offer(e.edicion_id)) IS NOT NULL AND e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
      AND (v_query IS NULL OR (
            (v_isbn13 IS NOT NULL AND e.isbn13::TEXT = v_isbn13)
            OR (v_isbn13 IS NULL AND (
                l.search_title_folded LIKE '%' || v_query || '%'
                OR EXISTS (
                    SELECT 1
                    FROM pliego.libro_autor AS la
                    JOIN pliego.autor AS a ON a.autor_id = la.autor_id
                    WHERE la.libro_id = l.libro_id
                      AND a.search_name_folded LIKE '%' || v_query || '%'
                )
            ))
      ))
      AND (v_category IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_categoria AS lc
            JOIN pliego.categoria AS c ON c.categoria_id = lc.categoria_id
            LEFT JOIN pliego.categoria AS cp ON cp.categoria_id = c.categoria_padre_id
            WHERE lc.libro_id = l.libro_id
              AND c.estado = 'ACTIVE'
              AND (c.categoria_padre_id IS NULL OR cp.estado = 'ACTIVE')
              AND (c.slug = v_category OR cp.slug = v_category)))
      AND (p_price_min IS NULL OR pliego.fn_edition_price(e.edicion_id) >= p_price_min)
      AND (p_price_max IS NULL OR pliego.fn_edition_price(e.edicion_id) <= p_price_max)
      AND (v_language IS NULL OR e.idioma = v_language)
      AND (p_format IS NULL OR e.formato = p_format)
    ORDER BY CASE WHEN p_sort = 'TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

CREATE FUNCTION pliego.fn_edition_detail(p_edition_id BIGINT)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, subtitle VARCHAR, synopsis VARCHAR,
    authors_json JSONB, categories_json JSONB, publisher_id BIGINT, publisher_name VARCHAR,
    isbn13 CHAR(13), sku VARCHAR, language VARCHAR, format VARCHAR, page_count INTEGER,
    publication_date DATE, price NUMERIC(11,2), cover_url VARCHAR, cover_license VARCHAR,
    cover_source_url VARCHAR, cover_attribution VARCHAR, available BOOLEAN,
    ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[], unavailability_reason TEXT
)
LANGUAGE sql STABLE SECURITY INVOKER ROWS 1 AS $$
SELECT e.edicion_id,l.libro_id,l.titulo,l.subtitulo,l.sinopsis,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('authorId',a.autor_id,'name',a.nombre,'order',la.orden_autoria) ORDER BY la.orden_autoria) FROM pliego.libro_autor la JOIN pliego.autor a ON a.autor_id=la.autor_id WHERE la.libro_id=l.libro_id),'[]'::jsonb),
       COALESCE((SELECT jsonb_agg(jsonb_build_object('categoryId',c.categoria_id,'name',c.nombre,'slug',c.slug,'parentCategoryId',c.categoria_padre_id) ORDER BY c.nombre,c.categoria_id) FROM pliego.libro_categoria lc JOIN pliego.categoria c ON c.categoria_id=lc.categoria_id WHERE lc.libro_id=l.libro_id),'[]'::jsonb),
       pub.editorial_id,pub.nombre,e.isbn13,e.sku,e.idioma,e.formato,e.numero_paginas,e.fecha_publicacion,pliego.fn_edition_price(e.edicion_id),e.portada_url,e.portada_licencia,e.portada_fuente_url,e.portada_atribucion,pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual),e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores,
       pliego.fn_edition_unavailability_reason(e.formato,l.estado,e.estado,i.stock_actual)
FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id JOIN pliego.editorial pub ON pub.editorial_id=e.editorial_id LEFT JOIN pliego.inventario i ON i.edicion_id=e.edicion_id
WHERE e.edicion_id=p_edition_id AND e.estado='ACTIVE' AND l.estado='ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual);
$$;

CREATE FUNCTION pliego.fn_customer_favorites(
    p_actor_user_id BIGINT,
    p_page INTEGER,
    p_page_size INTEGER
)
RETURNS TABLE (
    edition_id BIGINT,
    book_id BIGINT,
    title VARCHAR,
    authors VARCHAR,
    publisher VARCHAR,
    price NUMERIC(11,2),
    cover_url VARCHAR,
    cover_license VARCHAR,
    cover_attribution VARCHAR,
    format VARCHAR,
    language VARCHAR,
    available BOOLEAN,
    favorited_at TIMESTAMPTZ,
    total_count BIGINT,
    unavailability_reason TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
ROWS 50
AS $$
DECLARE
    v_customer_id BIGINT;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);

    RETURN QUERY
    SELECT e.edicion_id,
           l.libro_id,
           l.titulo,
           pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre,
           pliego.fn_edition_price(e.edicion_id),
           e.portada_url,
           e.portada_licencia,
           e.portada_atribucion,
           e.formato,
           e.idioma,
           pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual),
           f.fecha_creacion,
           count(*) OVER ()::BIGINT,
           pliego.fn_edition_unavailability_reason(e.formato,l.estado,e.estado,i.stock_actual)
      FROM pliego.cliente_favorito f
      JOIN pliego.edicion e ON e.edicion_id = f.edicion_id
      JOIN pliego.libro l ON l.libro_id = e.libro_id
      JOIN pliego.editorial pub ON pub.editorial_id = e.editorial_id
      LEFT JOIN pliego.inventario i ON i.edicion_id = e.edicion_id
     WHERE f.cliente_id = v_customer_id
     ORDER BY f.fecha_creacion DESC, f.edicion_id DESC
     LIMIT p_page_size
    OFFSET p_page * p_page_size;
END;
$$;

-- Restore runtime execution explicitly after recreating the readers.
REVOKE ALL ON FUNCTION
    pliego.fn_edition_unavailability_reason(TEXT, TEXT, TEXT, INTEGER),
    pliego.fn_catalog_search(VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER),
    pliego.fn_catalog_search(VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR),
    pliego.fn_catalog_search_global(VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER),
    pliego.fn_catalog_search_global(VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR),
    pliego.fn_catalog_search_offers(VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER),
    pliego.fn_catalog_search_global_offers(VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER),
    pliego.fn_edition_detail(BIGINT),
    pliego.fn_customer_favorites(BIGINT, INTEGER, INTEGER)
FROM PUBLIC;

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pliego_app') THEN
        GRANT EXECUTE ON FUNCTION
            pliego.fn_edition_unavailability_reason(TEXT, TEXT, TEXT, INTEGER),
            pliego.fn_catalog_search(VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER),
            pliego.fn_catalog_search(VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR),
            pliego.fn_catalog_search_global(VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER),
            pliego.fn_catalog_search_global(VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR),
            pliego.fn_catalog_search_offers(VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER),
            pliego.fn_catalog_search_global_offers(VARCHAR, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER),
            pliego.fn_edition_detail(BIGINT),
            pliego.fn_customer_favorites(BIGINT, INTEGER, INTEGER)
        TO pliego_app;
    END IF;
END;
$grants$;
