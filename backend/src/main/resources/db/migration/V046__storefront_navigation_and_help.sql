-- ADR0026: backend-authoritative discovery and published Help. Approved migrations are unchanged.
CREATE FUNCTION pliego.fn_edition_product_type(p_format TEXT) RETURNS VARCHAR
LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$
 SELECT CASE WHEN p_format IN ('PAPERBACK','HARDCOVER') THEN 'PHYSICAL' ELSE p_format END::VARCHAR;
$$;

-- The first CONFIRMED event is immutable; later shipping updates never move the ranking window.
CREATE FUNCTION pliego.fn_catalog_sales_30d()
RETURNS TABLE(edition_id BIGINT,units BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT i.edicion_id,sum(i.cantidad)::BIGINT
 FROM pliego.pedido_item i JOIN pliego.pedido p USING(pedido_id)
 JOIN pliego.pago pay USING(pedido_id)
 JOIN LATERAL (SELECT min(h.fecha) AS approved_at FROM pliego.pedido_estado_historial h
  WHERE h.pedido_id=p.pedido_id AND h.estado_nuevo='CONFIRMED') approval ON true
 WHERE pay.estado='APPROVED' AND p.estado<>'CANCELLED'
  AND approval.approved_at>=statement_timestamp()-INTERVAL '30 days'
  AND approval.approved_at<=statement_timestamp()
 GROUP BY i.edicion_id;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_catalog_search(
    p_title_query VARCHAR, p_author_query VARCHAR, p_isbn13 VARCHAR,
    p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_sort VARCHAR,
    p_page INTEGER, p_page_size INTEGER
)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, authors_ordered VARCHAR,
    publisher_name VARCHAR, isbn13 CHAR(13), price NUMERIC(11,2),
    cover_url VARCHAR, cover_license VARCHAR, cover_attribution VARCHAR,
    format VARCHAR, language VARCHAR, available BOOLEAN, total_count BIGINT
, ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[]
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_title TEXT := NULLIF(lower(btrim(p_title_query)), '');
    v_author TEXT := NULLIF(lower(btrim(p_author_query)), '');
    v_category TEXT := CASE WHEN p_category_slug IS NULL OR btrim(p_category_slug) = ''
        THEN NULL ELSE pliego.fn_normalize_slug(p_category_slug) END;
    v_language TEXT := CASE WHEN p_language IS NULL OR btrim(p_language) = ''
        THEN NULL ELSE pliego.fn_normalize_language(p_language) END;
    v_category_state VARCHAR;
    v_parent_category_id BIGINT;
    v_parent_state VARCHAR;
BEGIN
    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);
    IF p_sort IS NULL OR p_sort NOT IN ('TITLE_ASC', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING') THEN
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
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores
    FROM pliego.edicion AS e
    JOIN pliego.libro AS l ON l.libro_id = e.libro_id
    JOIN pliego.editorial AS pub ON pub.editorial_id = e.editorial_id
    LEFT JOIN pliego.inventario AS i ON i.edicion_id = e.edicion_id
    LEFT JOIN pliego.fn_catalog_sales_30d() AS sales ON sales.edition_id = e.edicion_id
    WHERE e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
      AND (v_title IS NULL OR lower(l.titulo) LIKE '%' || v_title || '%')
      AND (v_author IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_autor AS la
            JOIN pliego.autor AS a ON a.autor_id = la.autor_id
            WHERE la.libro_id = l.libro_id AND lower(a.nombre) LIKE '%' || v_author || '%'))
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
             CASE WHEN p_sort = 'TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_catalog_search(
    p_title_query VARCHAR, p_author_query VARCHAR, p_isbn13 VARCHAR,
    p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_sort VARCHAR,
    p_page INTEGER, p_page_size INTEGER, p_product_type VARCHAR
)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, authors_ordered VARCHAR,
    publisher_name VARCHAR, isbn13 CHAR(13), price NUMERIC(11,2),
    cover_url VARCHAR, cover_license VARCHAR, cover_attribution VARCHAR,
    format VARCHAR, language VARCHAR, available BOOLEAN, total_count BIGINT
, ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[]
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_title TEXT := NULLIF(lower(btrim(p_title_query)), '');
    v_author TEXT := NULLIF(lower(btrim(p_author_query)), '');
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
    IF p_sort IS NULL OR p_sort NOT IN ('TITLE_ASC', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING') THEN
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
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores
    FROM pliego.edicion AS e
    JOIN pliego.libro AS l ON l.libro_id = e.libro_id
    JOIN pliego.editorial AS pub ON pub.editorial_id = e.editorial_id
    LEFT JOIN pliego.inventario AS i ON i.edicion_id = e.edicion_id
    LEFT JOIN pliego.fn_catalog_sales_30d() AS sales ON sales.edition_id = e.edicion_id
    WHERE e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
      AND (v_title IS NULL OR lower(l.titulo) LIKE '%' || v_title || '%')
      AND (v_author IS NULL OR EXISTS (
            SELECT 1
            FROM pliego.libro_autor AS la
            JOIN pliego.autor AS a ON a.autor_id = la.autor_id
            WHERE la.libro_id = l.libro_id AND lower(a.nombre) LIKE '%' || v_author || '%'))
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
             CASE WHEN p_sort = 'TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_catalog_search_global(
    p_query VARCHAR, p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_sort VARCHAR, p_page INTEGER, p_page_size INTEGER
)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, authors_ordered VARCHAR,
    publisher_name VARCHAR, isbn13 CHAR(13), price NUMERIC(11,2),
    cover_url VARCHAR, cover_license VARCHAR, cover_attribution VARCHAR,
    format VARCHAR, language VARCHAR, available BOOLEAN, total_count BIGINT
, ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[]
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_query TEXT := NULLIF(lower(btrim(p_query)), '');
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
    IF p_sort IS NULL OR p_sort NOT IN ('TITLE_ASC', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING') THEN
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
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores
    FROM pliego.edicion AS e
    JOIN pliego.libro AS l ON l.libro_id = e.libro_id
    JOIN pliego.editorial AS pub ON pub.editorial_id = e.editorial_id
    LEFT JOIN pliego.inventario AS i ON i.edicion_id = e.edicion_id
    LEFT JOIN pliego.fn_catalog_sales_30d() AS sales ON sales.edition_id = e.edicion_id
    WHERE e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
      AND (v_query IS NULL OR (
            (v_isbn13 IS NOT NULL AND e.isbn13::TEXT = v_isbn13)
            OR (v_isbn13 IS NULL AND (
                lower(l.titulo) LIKE '%' || v_query || '%'
                OR EXISTS (
                    SELECT 1
                    FROM pliego.libro_autor AS la
                    JOIN pliego.autor AS a ON a.autor_id = la.autor_id
                    WHERE la.libro_id = l.libro_id
                      AND lower(a.nombre) LIKE '%' || v_query || '%'
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
             CASE WHEN p_sort = 'TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_catalog_search_global(
    p_query VARCHAR, p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_sort VARCHAR, p_page INTEGER, p_page_size INTEGER, p_product_type VARCHAR
)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, authors_ordered VARCHAR,
    publisher_name VARCHAR, isbn13 CHAR(13), price NUMERIC(11,2),
    cover_url VARCHAR, cover_license VARCHAR, cover_attribution VARCHAR,
    format VARCHAR, language VARCHAR, available BOOLEAN, total_count BIGINT
, ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[]
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_query TEXT := NULLIF(lower(btrim(p_query)), '');
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
    IF p_sort IS NULL OR p_sort NOT IN ('TITLE_ASC', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING') THEN
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
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores
    FROM pliego.edicion AS e
    JOIN pliego.libro AS l ON l.libro_id = e.libro_id
    JOIN pliego.editorial AS pub ON pub.editorial_id = e.editorial_id
    LEFT JOIN pliego.inventario AS i ON i.edicion_id = e.edicion_id
    LEFT JOIN pliego.fn_catalog_sales_30d() AS sales ON sales.edition_id = e.edicion_id
    WHERE e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
      AND (v_query IS NULL OR (
            (v_isbn13 IS NOT NULL AND e.isbn13::TEXT = v_isbn13)
            OR (v_isbn13 IS NULL AND (
                lower(l.titulo) LIKE '%' || v_query || '%'
                OR EXISTS (
                    SELECT 1
                    FROM pliego.libro_autor AS la
                    JOIN pliego.autor AS a ON a.autor_id = la.autor_id
                    WHERE la.libro_id = l.libro_id
                      AND lower(a.nombre) LIKE '%' || v_query || '%'
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
             CASE WHEN p_sort = 'TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

CREATE FUNCTION pliego.fn_storefront_navigation() RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 WITH kinds(code,label,position) AS (VALUES ('PHYSICAL','Libros',1),('EBOOK','eBooks',2),('AUDIOBOOK','Audiolibros',3)),
 offer_options AS MATERIALIZED (SELECT pliego.fn_offers_filter_options() AS data),
 editions AS MATERIALIZED (
  SELECT e.*,b.titulo,pliego.fn_build_authors_snapshot(b.libro_id) AS authors,
    coalesce(s.units,0) AS sales_units
  FROM pliego.edicion e JOIN pliego.libro b USING(libro_id)
  LEFT JOIN pliego.inventario inv USING(edicion_id)
  LEFT JOIN pliego.fn_catalog_sales_30d() s ON s.edition_id=e.edicion_id
  WHERE pliego.fn_edition_available(e.formato,b.estado,e.estado,inv.stock_actual)
   AND EXISTS (SELECT 1 FROM pliego.libro_categoria lc JOIN pliego.categoria c USING(categoria_id)
    LEFT JOIN pliego.categoria parent ON parent.categoria_id=c.categoria_padre_id
    WHERE lc.libro_id=b.libro_id AND c.estado='ACTIVE'
     AND (c.categoria_padre_id IS NULL OR parent.estado='ACTIVE'))
 ), sections AS (
  SELECT k.position,jsonb_build_object('key',k.code,'label',k.label,'href','/catalog?productType='||k.code,
    'allHref','/catalog?productType='||k.code,
    'bestSellingHref','/catalog?productType='||k.code||'&sort=BEST_SELLING',
    'activeOfferCount',coalesce(oc.n,'0'),
    'offersHref',CASE WHEN coalesce(oc.n,'0')::BIGINT>0 THEN '/ofertas?productType='||k.code END,
    'featured',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'editionId',e.edicion_id::TEXT,'bookId',e.libro_id::TEXT,'title',e.titulo,'authors',e.authors,
      'coverUrl',e.portada_url,'format',e.formato,'productType',k.code,'price',o.price::TEXT,
      'href','/catalog/editions/'||e.edicion_id,
      'offer',CASE WHEN o.offer_id IS NOT NULL THEN jsonb_build_object(
        'offerId',o.offer_id::TEXT,'originalPrice',o.original_price::TEXT,'discountAmount',o.discount_amount::TEXT,
        'startsAt',to_char(o.starts_at AT TIME ZONE 'America/Guayaquil','YYYY-MM-DD"T"HH24:MI:SS')||'-05:00',
        'endsAt',to_char(o.ends_at AT TIME ZONE 'America/Guayaquil','YYYY-MM-DD"T"HH24:MI:SS')||'-05:00',
        'daysRemaining',o.days_remaining,'endingSoon',o.ending_soon,'offerCopy',o.offer_copy,'terms',o.terms,
        'effectivePrice',o.price::TEXT,'savingsAmount',o.discount_amount::TEXT,'savingsPercent',o.savings_percent::TEXT) END)
      ORDER BY e.sales_units DESC,e.fecha_creacion DESC,e.edicion_id ASC)
     FROM (SELECT * FROM editions candidate WHERE pliego.fn_edition_product_type(candidate.formato)=k.code
      ORDER BY candidate.sales_units DESC,candidate.fecha_creacion DESC,candidate.edicion_id ASC LIMIT 3) e
     CROSS JOIN LATERAL pliego.fn_edition_offer(e.edicion_id) o),'[]'::JSONB),
    'categories',coalesce((SELECT jsonb_agg(jsonb_build_object('slug',c.slug,'name',c.nombre,
      'parentSlug',parent.slug,'href','/catalog?productType='||k.code||'&category='||c.slug)
      ORDER BY coalesce(parent.nombre,c.nombre),(c.categoria_padre_id IS NOT NULL),c.nombre,c.slug)
     FROM pliego.categoria c LEFT JOIN pliego.categoria parent ON parent.categoria_id=c.categoria_padre_id
     WHERE c.estado='ACTIVE' AND (c.categoria_padre_id IS NULL OR parent.estado='ACTIVE')
      AND EXISTS(SELECT 1 FROM editions e JOIN pliego.libro_categoria lc USING(libro_id)
       JOIN pliego.categoria child ON child.categoria_id=lc.categoria_id
       LEFT JOIN pliego.categoria ancestor ON ancestor.categoria_id=child.categoria_padre_id
       WHERE pliego.fn_edition_product_type(e.formato)=k.code AND child.estado='ACTIVE'
        AND (child.categoria_padre_id IS NULL OR ancestor.estado='ACTIVE')
        AND (c.categoria_id=child.categoria_id OR c.categoria_id=child.categoria_padre_id))),'[]'::JSONB)) AS section
  FROM kinds k LEFT JOIN LATERAL (
   SELECT value->>'count' AS n FROM offer_options,jsonb_array_elements(data->'productTypes') value
    WHERE value->>'code'=k.code) oc ON true
  UNION ALL
  SELECT 4,jsonb_build_object('key','OFFERS','label','Ofertas','href','/ofertas','allHref','/ofertas',
   'bestSellingHref',NULL,'offersHref','/ofertas','activeOfferCount',data->>'totalCount','featured','[]'::JSONB,'categories','[]'::JSONB)
  FROM offer_options
  UNION ALL
  SELECT 5,jsonb_build_object('key','HELP','label','Ayuda','href','/ayuda','allHref','/ayuda',
   'bestSellingHref',NULL,'offersHref',NULL,'activeOfferCount','0','featured','[]'::JSONB,'categories','[]'::JSONB)
 ) SELECT jsonb_build_object('sections',jsonb_agg(section ORDER BY position)) FROM sections;
$$;

CREATE TABLE pliego.ayuda_categoria (
 categoria_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 slug VARCHAR(140) NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 titulo VARCHAR(200) NOT NULL CHECK(btrim(titulo)<>''), posicion INTEGER NOT NULL DEFAULT 0 CHECK(posicion>=0),
 aplicabilidad VARCHAR(16) NOT NULL DEFAULT 'GENERAL' CHECK(aplicabilidad IN('GENERAL','PHYSICAL','EBOOK','AUDIOBOOK')),
 estado VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK(estado IN('DRAFT','PUBLISHED'))
);
CREATE TABLE pliego.ayuda_articulo (
 articulo_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 categoria_id BIGINT NOT NULL REFERENCES pliego.ayuda_categoria(categoria_id),
 slug VARCHAR(140) NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 titulo VARCHAR(200) NOT NULL CHECK(btrim(titulo)<>''), resumen VARCHAR(500) NOT NULL CHECK(btrim(resumen)<>''),
 cuerpo TEXT NOT NULL CHECK(btrim(cuerpo)<>''), posicion INTEGER NOT NULL DEFAULT 0 CHECK(posicion>=0),
 aplicabilidad VARCHAR(16) NOT NULL DEFAULT 'GENERAL' CHECK(aplicabilidad IN('GENERAL','PHYSICAL','EBOOK','AUDIOBOOK')),
 estado VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK(estado IN('DRAFT','PUBLISHED'))
);
CREATE INDEX ix_ayuda_publicacion ON pliego.ayuda_articulo(estado,categoria_id,posicion,slug);

CREATE FUNCTION pliego.fn_help_categories()
RETURNS TABLE(slug VARCHAR,title VARCHAR,"position" INTEGER,applicability VARCHAR)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT c.slug,c.titulo,c.posicion,c.aplicabilidad FROM pliego.ayuda_categoria c
 WHERE c.estado='PUBLISHED' AND EXISTS(SELECT 1 FROM pliego.ayuda_articulo a WHERE a.categoria_id=c.categoria_id AND a.estado='PUBLISHED')
 ORDER BY c.posicion,c.slug;
$$;
CREATE FUNCTION pliego.fn_help_search(p_query VARCHAR,p_category VARCHAR,p_applicability VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(slug VARCHAR,category_slug VARCHAR,title VARCHAR,summary VARCHAR,"position" INTEGER,applicability VARCHAR,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
 PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF char_length(p_query)>140 OR (p_applicability IS NOT NULL AND p_applicability NOT IN('GENERAL','PHYSICAL','EBOOK','AUDIOBOOK')) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT a.slug,c.slug,a.titulo,a.resumen,a.posicion,a.aplicabilidad,count(*) OVER()::BIGINT
 FROM pliego.ayuda_articulo a JOIN pliego.ayuda_categoria c USING(categoria_id)
 WHERE a.estado='PUBLISHED' AND c.estado='PUBLISHED'
  AND (p_category IS NULL OR c.slug=p_category)
  AND (p_applicability IS NULL OR a.aplicabilidad IN('GENERAL',p_applicability))
  AND (NULLIF(btrim(p_query),'') IS NULL OR strpos(lower(a.titulo||' '||a.resumen||' '||a.cuerpo),lower(btrim(p_query)))>0)
 ORDER BY c.posicion,a.posicion,a.slug LIMIT p_page_size OFFSET p_page*p_page_size;
END; $$;
CREATE FUNCTION pliego.fn_help_article(p_slug VARCHAR)
RETURNS TABLE(slug VARCHAR,category_slug VARCHAR,title VARCHAR,summary VARCHAR,"position" INTEGER,applicability VARCHAR,body TEXT)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT a.slug,c.slug,a.titulo,a.resumen,a.posicion,a.aplicabilidad,a.cuerpo
 FROM pliego.ayuda_articulo a JOIN pliego.ayuda_categoria c USING(categoria_id)
 WHERE a.slug=p_slug AND a.estado='PUBLISHED' AND c.estado='PUBLISHED';
$$;

INSERT INTO pliego.ayuda_categoria(slug,titulo,posicion,aplicabilidad,estado) VALUES
 ('ebooks','eBooks',10,'EBOOK','PUBLISHED'),('audiolibros','Audiolibros',20,'AUDIOBOOK','PUBLISHED'),
 ('compras','Compras',30,'GENERAL','PUBLISHED'),('entrega-a-domicilio','Entrega a domicilio',40,'PHYSICAL','PUBLISHED'),
 ('retiro','Retiro en tienda',50,'PHYSICAL','PUBLISHED'),('pagos','Pagos',60,'GENERAL','PUBLISHED'),
 ('cancelaciones-y-reembolsos','Cancelaciones y reembolsos',70,'GENERAL','PUBLISHED'),
 ('cuenta-y-correo','Cuenta y correo',80,'GENERAL','PUBLISHED');
INSERT INTO pliego.ayuda_articulo(categoria_id,slug,titulo,resumen,cuerpo,posicion,aplicabilidad,estado)
 SELECT c.categoria_id,c.slug,c.titulo,v.summary,v.body,10,c.aplicabilidad,'PUBLISHED'
 FROM pliego.ayuda_categoria c JOIN (VALUES
 ('ebooks','Cómo funcionan los eBooks en PLIEGO.','Un eBook es una edición digital. Después de una compra con pago aprobado aparece en Mi biblioteca y puedes abrir su detalle para comprobar la propiedad. Esta simulación académica no incluye lector, archivos, descargas ni entrega de contenido.'),
 ('audiolibros','Cómo funcionan los audiolibros en PLIEGO.','Un audiolibro es una edición digital con duración y narradores cuando estos datos están disponibles. Después de un pago aprobado aparece en Mi biblioteca. Esta simulación académica permite comprobar la propiedad en su detalle; no incluye reproductor, streaming ni descargas.'),
 ('compras','Compras físicas, digitales y mixtas.','Puedes comprar libros físicos, eBooks y audiolibros en un mismo pedido. Los productos digitales no necesitan entrega física. Mi biblioteca muestra los títulos digitales de tu cuenta después de un pago aprobado; los pedidos conservan la información de la compra.'),
 ('entrega-a-domicilio','Entrega de los libros físicos.','La entrega a domicilio se aplica únicamente a los libros físicos del pedido. Debes seleccionar una dirección válida y revisar la información de entrega que muestra el checkout. La entrega física y la propiedad de los títulos digitales son independientes.'),
 ('retiro','Retiro de libros físicos en una ubicación disponible.','Para retirar libros físicos selecciona una ubicación habilitada durante el checkout. Consulta el estado del retiro en el pedido y espera la confirmación de que está listo. Los títulos digitales no requieren retiro.'),
 ('pagos','Estados del pago y confirmación de la compra.','El checkout muestra los métodos y condiciones disponibles. Un pago aprobado confirma la compra y registra los títulos digitales en Mi biblioteca. Un pago rechazado no concede propiedad digital. Revisa siempre el resultado del pago y el estado del pedido.'),
 ('cancelaciones-y-reembolsos','Cancelaciones, reembolsos y propiedad digital.','Las opciones de cancelación dependen del estado del pedido y se muestran en su detalle. Una compra cancelada o reembolsada deja de conceder propiedad digital; si existe otra compra válida del mismo título, esa propiedad se conserva. Los pedidos y documentos mantienen el historial de la operación.'),
 ('cuenta-y-correo','La biblioteca pertenece a tu cuenta.','Inicia sesión con la cuenta que realizó la compra para consultar Mi biblioteca y tus pedidos. Los títulos digitales no se comparten automáticamente con otras cuentas. Gestiona tus datos y los cambios de correo desde tu cuenta siguiendo la verificación indicada.')
 ) v(slug,summary,body) ON v.slug=c.slug;
