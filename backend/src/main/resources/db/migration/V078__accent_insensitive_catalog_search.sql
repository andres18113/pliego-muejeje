-- Accent/case-insensitive catalog matching, without extension or superuser privileges.
-- NFC accepts canonically decomposed input. ñ folds to n for discovery only;
-- Spanish title collation/order, display values and identity rules are unchanged.
CREATE FUNCTION pliego.fn_search_fold(p_text TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER
RETURN translate(lower(normalize(p_text, NFC)), 'áàâäãåāăąéèêëēĕėęěíìîïĩīĭįıóòôöõōŏőúùûüũūŭůűųñńņňçćĉċčýÿŷźżžśŝşšţťŧďđğĝġģĺļľłŕŗřÁÀÂÄÃÅĀĂĄÉÈÊËĒĔĖĘĚÍÌÎÏĨĪĬĮIÓÒÔÖÕŌŎŐÚÙÛÜŨŪŬŮŰŲÑŃŅŇÇĆĈĊČÝŸŶŹŻŽŚŜŞŠŢŤŦĎĐĞĜĠĢĹĻĽŁŔŖŘ', 'aaaaaaaaaeeeeeeeeeiiiiiiiiioooooooouuuuuuuuuunnnncccccyyyzzzsssstttddggggllllrrraaaaaaaaaeeeeeeeeeiiiiiiiiioooooooouuuuuuuuuunnnncccccyyyzzzsssstttddggggllllrrr');

COMMENT ON FUNCTION pliego.fn_search_fold(TEXT) IS
 'Catalog discovery: lowercase + Latin accent folding (including ñ to n); NFC input, NULL preserved. No identity normalization.';

-- Compute once on catalog writes: substring searches must not repeatedly fold
-- every title/author per edition. Generated columns follow all routine/import updates.
ALTER TABLE pliego.libro ADD COLUMN search_title_folded TEXT
 GENERATED ALWAYS AS (pliego.fn_search_fold(titulo)) STORED;
ALTER TABLE pliego.autor ADD COLUMN search_name_folded TEXT
 GENERATED ALWAYS AS (pliego.fn_search_fold(nombre)) STORED;
-- Covering indexes keep prefix scans and index-only matching available without
-- fetching synopsis/biography. Leading-wildcard LIKE may still scan this small catalog.
CREATE INDEX ix_libro_search_fold_cover ON pliego.libro
 (search_title_folded text_pattern_ops) INCLUDE (libro_id,titulo);
CREATE INDEX ix_autor_search_fold_cover ON pliego.autor
 (search_name_folded text_pattern_ops) INCLUDE (autor_id,nombre);

-- Latest definition: V069__spanish_catalog_title_ordering.sql
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
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores
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

-- Latest definition: V069__spanish_catalog_title_ordering.sql
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
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores
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

-- Latest definition: V069__spanish_catalog_title_ordering.sql
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

-- Latest definition: V069__spanish_catalog_title_ordering.sql
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

-- Latest definition: V044__edition_offers.sql
CREATE OR REPLACE FUNCTION pliego.fn_catalog_search_offers(
    p_title_query VARCHAR, p_author_query VARCHAR, p_isbn13 VARCHAR,
    p_category_slug VARCHAR, p_price_min NUMERIC, p_price_max NUMERIC,
    p_language VARCHAR, p_format VARCHAR, p_product_type VARCHAR, p_sort VARCHAR,
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
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores
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

-- Latest definition: V044__edition_offers.sql
CREATE OR REPLACE FUNCTION pliego.fn_catalog_search_global_offers(
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
           e.formato, e.idioma, pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual), count(*) OVER()::BIGINT, e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores
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

-- Latest definition: V013__create_catalog_query_functions.sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_author_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(author_id BIGINT,name VARCHAR,biography VARCHAR,state VARCHAR,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(pliego.fn_search_fold(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT a.autor_id,a.nombre,a.biografia,a.estado,a.fecha_creacion,a.fecha_actualizacion,count(*) OVER()::BIGINT FROM pliego.autor a WHERE (p_state IS NULL OR a.estado=p_state) AND (v_query IS NULL OR a.search_name_folded LIKE '%'||v_query||'%') ORDER BY a.fecha_creacion DESC,a.autor_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

-- Latest definition: V013__create_catalog_query_functions.sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_publisher_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(publisher_id BIGINT,name VARCHAR,description VARCHAR,state VARCHAR,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(pliego.fn_search_fold(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT e.editorial_id,e.nombre,e.descripcion,e.estado,e.fecha_creacion,e.fecha_actualizacion,count(*) OVER()::BIGINT FROM pliego.editorial e WHERE (p_state IS NULL OR e.estado=p_state) AND (v_query IS NULL OR pliego.fn_search_fold(e.nombre) LIKE '%'||v_query||'%') ORDER BY e.fecha_creacion DESC,e.editorial_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

-- Latest definition: V013__create_catalog_query_functions.sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_category_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(category_id BIGINT,parent_category_id BIGINT,parent_name VARCHAR,name VARCHAR,slug VARCHAR,description VARCHAR,state VARCHAR,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(pliego.fn_search_fold(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT c.categoria_id,c.categoria_padre_id,cp.nombre,c.nombre,c.slug,c.descripcion,c.estado,c.fecha_creacion,c.fecha_actualizacion,count(*) OVER()::BIGINT FROM pliego.categoria c LEFT JOIN pliego.categoria cp ON cp.categoria_id=c.categoria_padre_id WHERE (p_state IS NULL OR c.estado=p_state) AND (v_query IS NULL OR pliego.fn_search_fold(c.nombre) LIKE '%'||v_query||'%' OR pliego.fn_search_fold(c.slug) LIKE '%'||v_query||'%') ORDER BY c.fecha_creacion DESC,c.categoria_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

-- Latest definition: V013__create_catalog_query_functions.sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_book_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(book_id BIGINT,title VARCHAR,subtitle VARCHAR,synopsis VARCHAR,state VARCHAR,authors_json JSONB,categories_json JSONB,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(pliego.fn_search_fold(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT l.libro_id,l.titulo,l.subtitulo,l.sinopsis,l.estado,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('authorId',a.autor_id,'name',a.nombre,'order',la.orden_autoria) ORDER BY la.orden_autoria) FROM pliego.libro_autor la JOIN pliego.autor a ON a.autor_id=la.autor_id WHERE la.libro_id=l.libro_id),'[]'::jsonb),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('categoryId',c.categoria_id,'name',c.nombre,'slug',c.slug) ORDER BY c.nombre,c.categoria_id) FROM pliego.libro_categoria lc JOIN pliego.categoria c ON c.categoria_id=lc.categoria_id WHERE lc.libro_id=l.libro_id),'[]'::jsonb),
 l.fecha_creacion,l.fecha_actualizacion,count(*) OVER()::BIGINT
 FROM pliego.libro l WHERE (p_state IS NULL OR l.estado=p_state) AND (v_query IS NULL OR l.search_title_folded LIKE '%'||v_query||'%' OR EXISTS(SELECT 1 FROM pliego.libro_autor la2 JOIN pliego.autor a2 ON a2.autor_id=la2.autor_id WHERE la2.libro_id=l.libro_id AND a2.search_name_folded LIKE '%'||v_query||'%')) ORDER BY l.fecha_creacion DESC,l.libro_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

-- Latest definition: V032__digital_editions.sql
CREATE OR REPLACE FUNCTION pliego.fn_admin_edition_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_book_id BIGINT,p_page INTEGER,p_page_size INTEGER,p_format VARCHAR DEFAULT NULL)
RETURNS TABLE(edition_id BIGINT,book_id BIGINT,book_title VARCHAR,publisher_id BIGINT,publisher_name VARCHAR,sku VARCHAR,isbn13 CHAR(13),language VARCHAR,format VARCHAR,page_count INTEGER,publication_date DATE,price NUMERIC(11,2),cover_url VARCHAR,cover_license VARCHAR,cover_source_url VARCHAR,cover_attribution VARCHAR,state VARCHAR,stock_actual INTEGER,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT, ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[]
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(pliego.fn_search_fold(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF p_format IS NOT NULL AND p_format NOT IN ('PAPERBACK','HARDCOVER','EBOOK','AUDIOBOOK') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT e.edicion_id,l.libro_id,l.titulo,pub.editorial_id,pub.nombre,e.sku,e.isbn13,e.idioma,e.formato,e.numero_paginas,e.fecha_publicacion,e.precio,e.portada_url,e.portada_licencia,e.portada_fuente_url,e.portada_atribucion,e.estado,i.stock_actual,e.fecha_creacion,e.fecha_actualizacion,count(*) OVER()::BIGINT,e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id JOIN pliego.editorial pub ON pub.editorial_id=e.editorial_id LEFT JOIN pliego.inventario i ON i.edicion_id=e.edicion_id WHERE (p_format IS NULL OR e.formato=p_format) AND (p_state IS NULL OR e.estado=p_state) AND (p_book_id IS NULL OR e.libro_id=p_book_id) AND (v_query IS NULL OR pliego.fn_search_fold(e.sku) LIKE '%'||v_query||'%' OR pliego.fn_search_fold(COALESCE(e.isbn13,''))=v_query OR l.search_title_folded LIKE '%'||v_query||'%') ORDER BY e.fecha_creacion DESC,e.edicion_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

-- Latest definition: V015__create_inventory_routines.sql
CREATE OR REPLACE FUNCTION pliego.fn_inventory_search(p_actor_user_id BIGINT,p_edition_id BIGINT,p_title_query VARCHAR,p_sku VARCHAR,p_low_stock_only BOOLEAN,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(edition_id BIGINT,book_id BIGINT,title VARCHAR,sku VARCHAR,isbn13 CHAR(13),edition_state VARCHAR,stock_actual INTEGER,stock_minimo INTEGER,low_stock BOOLEAN,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_title TEXT:=NULLIF(pliego.fn_search_fold(btrim(p_title_query)),'');v_sku TEXT:=CASE WHEN p_sku IS NULL OR btrim(p_sku)='' THEN NULL ELSE pliego.fn_normalize_sku(p_sku) END;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 RETURN QUERY SELECT e.edicion_id,l.libro_id,l.titulo,e.sku,e.isbn13,e.estado,i.stock_actual,i.stock_minimo,(i.stock_minimo>0 AND i.stock_actual<=i.stock_minimo),i.fecha_actualizacion,count(*) OVER()::BIGINT FROM pliego.inventario i JOIN pliego.edicion e ON e.edicion_id=i.edicion_id JOIN pliego.libro l ON l.libro_id=e.libro_id WHERE (p_edition_id IS NULL OR e.edicion_id=p_edition_id) AND (v_title IS NULL OR l.search_title_folded LIKE '%'||v_title||'%') AND (v_sku IS NULL OR e.sku=v_sku) AND (NOT COALESCE(p_low_stock_only,FALSE) OR (i.stock_minimo>0 AND i.stock_actual<=i.stock_minimo)) ORDER BY lower(l.titulo),e.edicion_id LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;
