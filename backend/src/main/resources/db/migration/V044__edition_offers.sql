-- ADR0025: edition offers reuse existing catalog/cart/checkout projections.
CREATE TABLE pliego.edicion_oferta (
 oferta_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 edicion_id BIGINT NOT NULL UNIQUE REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT,
 precio_oferta NUMERIC(11,2) NOT NULL CHECK(precio_oferta>0),
 inicio TIMESTAMPTZ NOT NULL,
 fin TIMESTAMPTZ NOT NULL,
 oferta_texto VARCHAR(1000),
 condiciones VARCHAR(5000),
 estado VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK(estado IN('ACTIVE','INACTIVE')),
 CHECK(fin>inicio)
);

-- Calendar dates and thresholds are centralized for every frontend client.
CREATE FUNCTION pliego.fn_offer_days_remaining(p_end TIMESTAMPTZ,p_at TIMESTAMPTZ) RETURNS INTEGER
LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$
 SELECT GREATEST(0,(p_end AT TIME ZONE 'America/Guayaquil')::DATE-(p_at AT TIME ZONE 'America/Guayaquil')::DATE);
$$;
CREATE FUNCTION pliego.fn_offer_ending_soon_days() RETURNS INTEGER
LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$ SELECT 3; $$;
CREATE FUNCTION pliego.fn_offer_ending_soon(p_days INTEGER) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$ SELECT p_days<=pliego.fn_offer_ending_soon_days(); $$;

-- Offers never increase a subsequently reduced base price. A half-open window
-- [inicio,fin) evaluated at statement time keeps quote/checkout line rounding consistent.
CREATE FUNCTION pliego.fn_edition_offer(p_edition BIGINT)
RETURNS TABLE(price NUMERIC(11,2),offer_id BIGINT,original_price NUMERIC(11,2),discount_amount NUMERIC(11,2),starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,days_remaining INTEGER,ending_soon BOOLEAN,offer_copy VARCHAR,terms VARCHAR,savings_percent NUMERIC(7,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT COALESCE(o.precio_oferta,e.precio)::NUMERIC(11,2),o.oferta_id,e.precio,
 (e.precio-COALESCE(o.precio_oferta,e.precio))::NUMERIC(11,2),o.inicio,o.fin,
 CASE WHEN o.oferta_id IS NOT NULL THEN pliego.fn_offer_days_remaining(o.fin,statement_timestamp()) END,
 CASE WHEN o.oferta_id IS NOT NULL THEN pliego.fn_offer_ending_soon(pliego.fn_offer_days_remaining(o.fin,statement_timestamp())) END,
 o.oferta_texto,o.condiciones,round((e.precio-COALESCE(o.precio_oferta,e.precio))*100/e.precio,2)::NUMERIC(7,2)
 FROM pliego.edicion e LEFT JOIN pliego.edicion_oferta o ON o.edicion_id=e.edicion_id
 AND o.estado='ACTIVE' AND o.inicio<=statement_timestamp() AND o.fin>statement_timestamp() AND o.precio_oferta<e.precio
 WHERE e.edicion_id=p_edition;
$$;
CREATE FUNCTION pliego.fn_edition_price(p_edition BIGINT) RETURNS NUMERIC(11,2)
LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT price FROM pliego.fn_edition_offer(p_edition); $$;

CREATE PROCEDURE pliego.sp_edition_offer_set(IN p_actor BIGINT,IN p_edition BIGINT,IN p_price NUMERIC,
 IN p_starts TIMESTAMPTZ,IN p_ends TIMESTAMPTZ,IN p_copy VARCHAR,IN p_terms VARCHAR,OUT o_offer BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE base NUMERIC(11,2);
BEGIN
 PERFORM pliego.fn_assert_actor(p_actor,'ADMIN');
 -- Match checkout's master lock: changing an offer cannot race its monetary snapshots.
 SELECT precio INTO base FROM pliego.edicion WHERE edicion_id=p_edition FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND'); END IF;
 IF p_price IS NULL OR p_price<=0 OR p_price>=base OR p_price<>round(p_price,2)
 OR p_starts IS NULL OR p_ends IS NULL OR p_ends<=p_starts OR char_length(p_copy)>1000 OR char_length(p_terms)>5000 THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 INSERT INTO pliego.edicion_oferta(edicion_id,precio_oferta,inicio,fin,oferta_texto,condiciones) VALUES(p_edition,p_price,p_starts,p_ends,NULLIF(btrim(p_copy),''),NULLIF(btrim(p_terms),''))
 ON CONFLICT(edicion_id) DO UPDATE SET precio_oferta=EXCLUDED.precio_oferta,inicio=EXCLUDED.inicio,fin=EXCLUDED.fin,oferta_texto=EXCLUDED.oferta_texto,condiciones=EXCLUDED.condiciones,estado='ACTIVE'
 RETURNING oferta_id INTO o_offer;
END; $$;
-- Compatible Database API signature for callers without authored copy/terms.
CREATE PROCEDURE pliego.sp_edition_offer_set(IN p_actor BIGINT,IN p_edition BIGINT,IN p_price NUMERIC,
 IN p_starts TIMESTAMPTZ,IN p_ends TIMESTAMPTZ,OUT o_offer BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN CALL pliego.sp_edition_offer_set(p_actor,p_edition,p_price,p_starts,p_ends,NULL,NULL,o_offer); END; $$;
CREATE PROCEDURE pliego.sp_edition_offer_clear(IN p_actor BIGINT,IN p_edition BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM pliego.fn_assert_actor(p_actor,'ADMIN');
 PERFORM 1 FROM pliego.edicion WHERE edicion_id=p_edition FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND'); END IF;
 UPDATE pliego.edicion_oferta SET estado='INACTIVE' WHERE edicion_id=p_edition;
END; $$;

-- Preserve V032 digital/physical behavior while applying effective prices.
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
    IF p_sort IS NULL OR p_sort NOT IN ('TITLE_ASC', 'PRICE_ASC', 'PRICE_DESC') THEN
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
    ORDER BY CASE WHEN p_sort = 'TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

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
      AND (p_product_type IS NULL OR CASE WHEN pliego.fn_is_physical_format(e.formato) THEN 'PHYSICAL' ELSE e.formato END=p_product_type)
    ORDER BY CASE WHEN p_sort='RELEVANCE' THEN (SELECT discount_amount FROM pliego.fn_edition_offer(e.edicion_id)) END DESC NULLS LAST,
             CASE WHEN p_sort IN('RELEVANCE','ENDING_SOON') THEN (SELECT ends_at FROM pliego.fn_edition_offer(e.edicion_id)) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

-- Preserve V032 digital/physical behavior while applying effective prices.
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
    ORDER BY CASE WHEN p_sort = 'TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

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
    ORDER BY CASE WHEN p_sort = 'TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN pliego.fn_edition_price(e.edicion_id) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN pliego.fn_edition_price(e.edicion_id) END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

-- Preserve V032 digital/physical behavior while applying effective prices.
CREATE OR REPLACE FUNCTION pliego.fn_edition_detail(p_edition_id BIGINT)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, subtitle VARCHAR, synopsis VARCHAR,
    authors_json JSONB, categories_json JSONB, publisher_id BIGINT, publisher_name VARCHAR,
    isbn13 CHAR(13), sku VARCHAR, language VARCHAR, format VARCHAR, page_count INTEGER,
    publication_date DATE, price NUMERIC(11,2), cover_url VARCHAR, cover_license VARCHAR,
    cover_source_url VARCHAR, cover_attribution VARCHAR, available BOOLEAN
, ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[]
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
SELECT e.edicion_id,l.libro_id,l.titulo,l.subtitulo,l.sinopsis,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('authorId',a.autor_id,'name',a.nombre,'order',la.orden_autoria) ORDER BY la.orden_autoria) FROM pliego.libro_autor la JOIN pliego.autor a ON a.autor_id=la.autor_id WHERE la.libro_id=l.libro_id),'[]'::jsonb),
       COALESCE((SELECT jsonb_agg(jsonb_build_object('categoryId',c.categoria_id,'name',c.nombre,'slug',c.slug,'parentCategoryId',c.categoria_padre_id) ORDER BY c.nombre,c.categoria_id) FROM pliego.libro_categoria lc JOIN pliego.categoria c ON c.categoria_id=lc.categoria_id WHERE lc.libro_id=l.libro_id),'[]'::jsonb),
       pub.editorial_id,pub.nombre,e.isbn13,e.sku,e.idioma,e.formato,e.numero_paginas,e.fecha_publicacion,pliego.fn_edition_price(e.edicion_id),e.portada_url,e.portada_licencia,e.portada_fuente_url,e.portada_atribucion,pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual),e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores
FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id JOIN pliego.editorial pub ON pub.editorial_id=e.editorial_id LEFT JOIN pliego.inventario i ON i.edicion_id=e.edicion_id
WHERE e.edicion_id=p_edition_id AND e.estado='ACTIVE' AND l.estado='ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual);
$$;

-- Preserve V032 digital/physical behavior while applying effective prices.
CREATE OR REPLACE FUNCTION pliego.fn_public_catalog_filter_facets()
RETURNS TABLE(languages JSONB, formats JSONB, minimum_price NUMERIC(11,2), maximum_price NUMERIC(11,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    WITH public_editions AS MATERIALIZED (
        SELECT edition.idioma AS language_code, edition.formato AS edition_format, pliego.fn_edition_price(edition.edicion_id) AS price
        FROM pliego.edicion AS edition
        JOIN pliego.libro AS book ON book.libro_id = edition.libro_id
        LEFT JOIN pliego.inventario AS inventory ON inventory.edicion_id = edition.edicion_id
        WHERE edition.estado = 'ACTIVE' AND book.estado = 'ACTIVE' AND pliego.fn_edition_listable(edition.formato,inventory.stock_actual)
    )
    SELECT coalesce(jsonb_agg(DISTINCT language_code ORDER BY language_code), '[]'::jsonb),
           coalesce(jsonb_agg(DISTINCT edition_format ORDER BY edition_format), '[]'::jsonb),
           min(price), max(price)
    FROM public_editions;
$$;

-- Preserve V032 digital/physical behavior while applying effective prices.
CREATE OR REPLACE FUNCTION pliego.fn_customer_favorites(
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
    total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
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
           count(*) OVER ()::BIGINT
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

-- Preserve V032 digital/physical behavior while applying effective prices.
CREATE OR REPLACE FUNCTION pliego.fn_cart_get(p_actor_user_id BIGINT)
RETURNS TABLE(cart_id BIGINT,state VARCHAR,items JSONB,total_current NUMERIC(30,2))
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_cart_id BIGINT;v_state VARCHAR;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;SELECT c.carrito_id,c.estado INTO v_cart_id,v_state FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE';
 IF NOT FOUND THEN RETURN QUERY SELECT NULL::BIGINT,NULL::VARCHAR,'[]'::JSONB,0.00::NUMERIC(30,2);RETURN;END IF;
 RETURN QUERY SELECT v_cart_id,v_state,COALESCE((SELECT jsonb_agg(jsonb_build_object('cartItemId',ci.carrito_item_id,'editionId',e.edicion_id,'title',l.titulo,'authors',pliego.fn_build_authors_snapshot(l.libro_id),'sku',e.sku,'format',e.formato,'coverUrl',e.portada_url,'quantity',ci.cantidad,'currentPrice',pliego.fn_edition_price(e.edicion_id),'currentSubtotal',(ci.cantidad*pliego.fn_edition_price(e.edicion_id)),'available',pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual,ci.cantidad),'unavailabilityReason',CASE WHEN l.estado<>'ACTIVE' THEN 'P2043' WHEN e.estado<>'ACTIVE' THEN 'P2042' WHEN NOT pliego.fn_is_physical_format(e.formato) AND ci.cantidad<>1 THEN 'P4004' WHEN pliego.fn_is_physical_format(e.formato) AND COALESCE(i.stock_actual,0)<ci.cantidad THEN 'P3002' ELSE NULL END)ORDER BY ci.fecha_creacion,ci.carrito_item_id) FROM pliego.carrito_item ci JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id JOIN pliego.libro l ON l.libro_id=e.libro_id LEFT JOIN pliego.inventario i ON i.edicion_id=e.edicion_id WHERE ci.carrito_id=v_cart_id),'[]'::JSONB),COALESCE((SELECT sum(ci.cantidad*pliego.fn_edition_price(e.edicion_id))::NUMERIC(30,2) FROM pliego.carrito_item ci JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id WHERE ci.carrito_id=v_cart_id),0.00::NUMERIC(30,2));
END;$$;

-- Preserve V041 tax, fulfillment, email and immutable snapshots.
CREATE OR REPLACE FUNCTION pliego.fn_cart_quote(p_actor BIGINT)
RETURNS TABLE(cart_id BIGINT,state VARCHAR,items JSONB,total_current NUMERIC(30,2),subtotal NUMERIC(30,2),tax_rate NUMERIC(7,4),tax_amount NUMERIC(30,2),shipping_amount NUMERIC(30,2),total NUMERIC(30,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT b.cart_id,b.state,b.items,(b.total_current+t.amount)::NUMERIC(30,2),b.total_current,pliego.fn_checkout_tax_rate()::NUMERIC(7,4),
 t.amount,0.00::NUMERIC(30,2),(b.total_current+t.amount)::NUMERIC(30,2)
 FROM pliego.fn_cart_get(p_actor) b CROSS JOIN LATERAL (
  SELECT COALESCE(sum(round(ci.cantidad*pliego.fn_edition_price(e.edicion_id)*pliego.fn_checkout_tax_rate()/100,2)),0.00)::NUMERIC(30,2) AS amount
  FROM pliego.carrito_item ci JOIN pliego.edicion e USING(edicion_id) WHERE ci.carrito_id=b.cart_id
 ) t;
$$;

-- Preserve V041 tax, fulfillment, email and immutable snapshots.
CREATE OR REPLACE PROCEDURE pliego.sp_checkout_execute(
    IN p_actor_user_id BIGINT,
    IN p_address_id BIGINT,
    IN p_payment_method VARCHAR,
    IN p_payment_outcome VARCHAR,
    IN p_fulfillment_method VARCHAR,
    IN p_pickup_location_id BIGINT,
    OUT o_order_id BIGINT,
    OUT o_order_state VARCHAR,
    OUT o_payment_state VARCHAR,
    OUT o_total NUMERIC,
    OUT o_payment_reference VARCHAR
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_subtotal NUMERIC(30,2);
    v_tax NUMERIC(30,2);
    v_rate NUMERIC(7,4):=pliego.fn_checkout_tax_rate();
    v_customer_id BIGINT;
    v_cart_id BIGINT;
    v_address pliego.direccion%ROWTYPE;
    v_item RECORD;
    v_before INTEGER;
    v_after INTEGER;
    v_payment_id BIGINT;
    v_reference VARCHAR;
    v_constraint TEXT;
    v_has_physical BOOLEAN:=FALSE;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    IF p_payment_method NOT IN ('CARD', 'TRANSFER') THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid payment method');
    END IF;

    IF p_payment_outcome NOT IN ('APPROVED', 'REJECTED') THEN
        PERFORM pliego.fn_raise_domain_error('P5005', 'PAYMENT_OUTCOME_INVALID');
    END IF;

    SELECT c.carrito_id
      INTO v_cart_id
      FROM pliego.carrito c
     WHERE c.cliente_id = v_customer_id
       AND c.estado = 'ACTIVE'
     FOR UPDATE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P4001', 'CART_NOT_ACTIVE');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pliego.carrito_item ci WHERE ci.carrito_id = v_cart_id
    ) THEN
        PERFORM pliego.fn_raise_domain_error('P4002', 'CART_EMPTY');
    END IF;

    IF p_fulfillment_method='HOME_DELIVERY' THEN
    SELECT d.*
      INTO v_address
      FROM pliego.direccion d
     WHERE d.direccion_id = p_address_id
       AND d.cliente_id = v_customer_id
     FOR SHARE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P5004', 'CHECKOUT_ADDRESS_INVALID');
    END IF;

    END IF;

    -- RC-01: lock masters whose state/price become order snapshots.
    -- Deterministic order reduces deadlock risk with administrative writers.
    FOR v_item IN
        SELECT e.edicion_id
          FROM pliego.carrito_item ci
          JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
          JOIN pliego.libro l ON l.libro_id = e.libro_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY e.edicion_id
         FOR SHARE OF e, l
    LOOP
        NULL;
    END LOOP;

    -- Post-lock freshness check: state and price cannot change until this transaction ends.
    FOR v_item IN
        SELECT ci.edicion_id,
               ci.cantidad,
               e.estado AS edition_state,
               l.estado AS book_state,
               pliego.fn_edition_price(e.edicion_id) AS precio, e.formato
          FROM pliego.carrito_item ci
          JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
          JOIN pliego.libro l ON l.libro_id = e.libro_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY ci.edicion_id
    LOOP
        IF pliego.fn_is_physical_format(v_item.formato) THEN v_has_physical:=TRUE; END IF;
        IF v_item.edition_state <> 'ACTIVE' THEN
            PERFORM pliego.fn_raise_domain_error('P2042', 'EDITION_INACTIVE');
        END IF;
        IF v_item.book_state <> 'ACTIVE' THEN
            PERFORM pliego.fn_raise_domain_error('P2043', 'BOOK_INACTIVE');
        END IF;
        IF NOT pliego.fn_is_physical_format(v_item.formato) AND v_item.cantidad <> 1 THEN
            PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID');
        END IF;
        IF pliego.fn_is_physical_format(v_item.formato) AND NOT EXISTS (SELECT 1 FROM pliego.inventario i WHERE i.edicion_id=v_item.edicion_id) THEN
            PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');
        END IF;
        IF v_item.precio <= 0 THEN
            PERFORM pliego.fn_raise_domain_error('P2048', 'EDITION_DATA_INVALID');
        END IF;
    END LOOP;

    IF p_fulfillment_method='STORE_PICKUP' AND NOT v_has_physical THEN
        PERFORM pliego.fn_raise_domain_error('P5012','PICKUP_NOT_APPLICABLE');
    END IF;

    -- Lock inventories in deterministic EdicionId order and revalidate stock.
    FOR v_item IN
        SELECT i.edicion_id, i.stock_actual, ci.cantidad
          FROM pliego.carrito_item ci
          JOIN pliego.inventario i ON i.edicion_id = ci.edicion_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY i.edicion_id
         FOR UPDATE OF i
    LOOP
        IF v_item.stock_actual < v_item.cantidad THEN
            PERFORM pliego.fn_raise_domain_error('P3002', 'INSUFFICIENT_STOCK');
        END IF;
    END LOOP;

    SELECT sum(ci.cantidad * pliego.fn_edition_price(e.edicion_id))::NUMERIC(30,2)
      INTO v_subtotal
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
     WHERE ci.carrito_id = v_cart_id;

    IF v_subtotal IS NULL OR v_subtotal <= 0 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid order total');
    END IF;

    SELECT sum(round(ci.cantidad*pliego.fn_edition_price(e.edicion_id)*v_rate/100,2))::NUMERIC(30,2)
      INTO v_tax FROM pliego.carrito_item ci JOIN pliego.edicion e USING(edicion_id) WHERE ci.carrito_id=v_cart_id;
    o_total:=v_subtotal+v_tax;
    INSERT INTO pliego.pedido(cliente_id, estado, subtotal, total, impuesto_tasa, impuesto_monto, envio_monto)
    VALUES (v_customer_id, 'PENDING_PAYMENT', v_subtotal, o_total, v_rate, v_tax, 0.00)
    RETURNING pedido_id INTO o_order_id;

    INSERT INTO pliego.pedido_estado_historial(
        pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
    ) VALUES (
        o_order_id, NULL, 'SYSTEM', NULL, 'PENDING_PAYMENT'
    );

    INSERT INTO pliego.pedido_item(
        pedido_id, edicion_id, sku_snapshot, isbn_snapshot, titulo_snapshot,
        autores_snapshot, editorial_snapshot, formato_snapshot, idioma_snapshot,
        precio_unitario, cantidad, subtotal, impuesto_tasa, impuesto_monto
    )
    SELECT o_order_id,
           e.edicion_id,
           e.sku,
           e.isbn13,
           l.titulo,
           pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre,
           e.formato,
           e.idioma,
           pliego.fn_edition_price(e.edicion_id),
           ci.cantidad,
           (pliego.fn_edition_price(e.edicion_id) * ci.cantidad)::NUMERIC(30,2), v_rate, round(pliego.fn_edition_price(e.edicion_id)*ci.cantidad*v_rate/100,2)
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
      JOIN pliego.libro l ON l.libro_id = e.libro_id
      JOIN pliego.editorial pub ON pub.editorial_id = e.editorial_id
     WHERE ci.carrito_id = v_cart_id
     ORDER BY e.edicion_id;

    IF p_fulfillment_method='HOME_DELIVERY' THEN
    INSERT INTO pliego.pedido_direccion(
        pedido_id, destinatario, direccion_linea1, direccion_linea2,
        ciudad, provincia, pais_codigo, codigo_postal, referencia, telefono
    ) VALUES (
        o_order_id,
        v_address.destinatario,
        v_address.direccion_linea1,
        v_address.direccion_linea2,
        v_address.ciudad,
        v_address.provincia,
        v_address.pais_codigo,
        v_address.codigo_postal,
        v_address.referencia,
        v_address.telefono
    );

    END IF;

    INSERT INTO pliego.pago(
        pedido_id, metodo, estado, monto, referencia, detalle_resultado
    ) VALUES (
        o_order_id, p_payment_method, 'PENDING', o_total, NULL, NULL
    )
    RETURNING pago_id INTO v_payment_id;

    IF p_payment_outcome = 'APPROVED' THEN
        v_reference := pliego.fn_generate_payment_reference();

        BEGIN
            UPDATE pliego.pago
               SET estado = 'APPROVED',
                   referencia = v_reference,
                   detalle_resultado = NULL
             WHERE pago_id = v_payment_id;
        EXCEPTION WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            IF v_constraint = 'uq_pago_referencia' THEN
                PERFORM pliego.fn_raise_domain_error('P5007', 'PAYMENT_REFERENCE_CONFLICT');
            END IF;
            RAISE;
        END;

        FOR v_item IN
            SELECT ci.edicion_id, ci.cantidad
              FROM pliego.carrito_item ci
              JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id
             WHERE ci.carrito_id = v_cart_id AND pliego.fn_is_physical_format(e.formato)
             ORDER BY ci.edicion_id
        LOOP
            SELECT i.stock_actual
              INTO v_before
              FROM pliego.inventario i
             WHERE i.edicion_id = v_item.edicion_id;

            v_after := v_before - v_item.cantidad;
            IF v_after < 0 THEN
                PERFORM pliego.fn_raise_domain_error('P3002', 'INSUFFICIENT_STOCK');
            END IF;

            UPDATE pliego.inventario
               SET stock_actual = v_after
             WHERE edicion_id = v_item.edicion_id;

            BEGIN
                INSERT INTO pliego.movimiento_inventario(
                    edicion_id, pedido_id, usuario_actor_id, tipo, cantidad,
                    stock_anterior, stock_posterior, motivo
                ) VALUES (
                    v_item.edicion_id, o_order_id, NULL, 'SALE', v_item.cantidad,
                    v_before, v_after, NULL
                );
            EXCEPTION WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
                IF v_constraint = 'uqx_movimiento_pedido_edicion_tipo' THEN
                    PERFORM pliego.fn_raise_domain_error('P3005', 'STOCK_MOVEMENT_DUPLICATE');
                END IF;
                RAISE;
            END;
        END LOOP;

        UPDATE pliego.pedido
           SET estado = 'CONFIRMED'
         WHERE pedido_id = o_order_id;

        INSERT INTO pliego.pedido_estado_historial(
            pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
        ) VALUES (
            o_order_id, NULL, 'SYSTEM', 'PENDING_PAYMENT', 'CONFIRMED'
        );

        UPDATE pliego.carrito
           SET estado = 'CHECKED_OUT'
         WHERE carrito_id = v_cart_id;

        o_order_state := 'CONFIRMED';
        o_payment_state := 'APPROVED';
        o_payment_reference := v_reference;
    ELSE
        UPDATE pliego.pago
           SET estado = 'REJECTED',
               referencia = NULL,
               detalle_resultado = 'SIMULATED_REJECTION'
         WHERE pago_id = v_payment_id;

        UPDATE pliego.pedido
           SET estado = 'CANCELLED'
         WHERE pedido_id = o_order_id;

        INSERT INTO pliego.pedido_estado_historial(
            pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
        ) VALUES (
            o_order_id, NULL, 'SYSTEM', 'PENDING_PAYMENT', 'CANCELLED'
        );

        o_order_state := 'CANCELLED';
        o_payment_state := 'REJECTED';
        o_payment_reference := NULL;
    END IF;
END;
$$;


-- Global facets include only existing active public offers. Parent chips retain
-- catalog category navigation and count distinct matching editions.
CREATE FUNCTION pliego.fn_offers_filter_options() RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 WITH offers AS MATERIALIZED (
  SELECT e.edicion_id,e.libro_id,CASE WHEN pliego.fn_is_physical_format(e.formato) THEN 'PHYSICAL' ELSE e.formato END AS kind
  FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id LEFT JOIN pliego.inventario i USING(edicion_id)
  CROSS JOIN LATERAL pliego.fn_edition_offer(e.edicion_id) o
  WHERE e.estado='ACTIVE' AND l.estado='ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual) AND o.offer_id IS NOT NULL
 ), product_counts AS (SELECT kind,count(*) AS n FROM offers GROUP BY kind),
 category_counts AS (
  SELECT c.slug,c.nombre,count(DISTINCT o.edicion_id) AS n
  FROM offers o JOIN pliego.libro_categoria lc ON lc.libro_id=o.libro_id
  JOIN pliego.categoria child ON child.categoria_id=lc.categoria_id
  LEFT JOIN pliego.categoria parent ON parent.categoria_id=child.categoria_padre_id
  JOIN pliego.categoria c ON c.categoria_id IN(child.categoria_id,child.categoria_padre_id)
  WHERE c.estado='ACTIVE' AND child.estado='ACTIVE'
   AND (child.categoria_padre_id IS NULL OR parent.estado='ACTIVE') GROUP BY c.slug,c.nombre
 )
 SELECT jsonb_build_object(
  'productTypes',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',kind,'label',CASE kind WHEN 'PHYSICAL' THEN 'Libros físicos' WHEN 'EBOOK' THEN 'eBooks' ELSE 'Audiolibros' END,'count',n::TEXT) ORDER BY kind) FROM product_counts),'[]'::JSONB),
  'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',slug,'name',nombre,'count',n::TEXT) ORDER BY nombre,slug) FROM category_counts),'[]'::JSONB),
  'sorts',jsonb_build_array(jsonb_build_object('code','RELEVANCE','label','Relevancia'),jsonb_build_object('code','ENDING_SOON','label','Próximas a terminar'),jsonb_build_object('code','PRICE_ASC','label','Precio: menor a mayor'),jsonb_build_object('code','PRICE_DESC','label','Precio: mayor a menor')),
  'endingSoonDays',pliego.fn_offer_ending_soon_days(),'timezone','America/Guayaquil','totalCount',(SELECT count(*)::TEXT FROM offers));
$$;
