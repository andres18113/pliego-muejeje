-- V032 — Digital editions; approved migrations remain unchanged. See ADR-0016.
CREATE FUNCTION pliego.fn_is_physical_format(p_format TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$
    SELECT p_format IN ('PAPERBACK', 'HARDCOVER');
$$;

CREATE FUNCTION pliego.fn_edition_metadata_valid(
    p_format TEXT, p_pages INTEGER, p_ebook_format TEXT,
    p_audio_seconds INTEGER, p_narrators TEXT[]
) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER AS $$
DECLARE v_name TEXT;
BEGIN
    IF p_format IS NULL OR p_narrators IS NULL THEN RETURN FALSE; END IF;
    IF p_pages IS NOT NULL AND p_pages NOT BETWEEN 1 AND 100000 THEN RETURN FALSE; END IF;
    IF cardinality(p_narrators) > 32 OR (cardinality(p_narrators) > 0 AND array_ndims(p_narrators) <> 1) THEN RETURN FALSE; END IF;
    FOREACH v_name IN ARRAY p_narrators LOOP
        IF v_name IS NULL OR char_length(btrim(v_name)) NOT BETWEEN 1 AND 200 THEN RETURN FALSE; END IF;
    END LOOP;
    IF pliego.fn_is_physical_format(p_format) THEN
        RETURN p_pages IS NOT NULL AND p_ebook_format IS NULL
            AND p_audio_seconds IS NULL AND cardinality(p_narrators) = 0;
    ELSIF p_format = 'EBOOK' THEN
        RETURN (p_ebook_format IS NULL OR p_ebook_format IN ('EPUB', 'PDF'))
            AND p_audio_seconds IS NULL AND cardinality(p_narrators) = 0;
    ELSIF p_format = 'AUDIOBOOK' THEN
        RETURN p_pages IS NULL AND p_ebook_format IS NULL
            AND p_audio_seconds IS NOT NULL AND p_audio_seconds > 0
            AND cardinality(p_narrators) BETWEEN 1 AND 32;
    END IF;
    RETURN FALSE;
END;
$$;

ALTER TABLE pliego.edicion
    ADD COLUMN ebook_formato VARCHAR(8),
    ADD COLUMN audio_duracion_segundos INTEGER,
    ADD COLUMN audio_narradores TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ALTER COLUMN numero_paginas DROP NOT NULL,
    DROP CONSTRAINT ck_edicion_formato,
    ADD CONSTRAINT ck_edicion_formato CHECK (formato IN ('PAPERBACK','HARDCOVER','EBOOK','AUDIOBOOK')),
    ADD CONSTRAINT ck_edicion_metadatos CHECK (pliego.fn_edition_metadata_valid(
        formato, numero_paginas, ebook_formato, audio_duracion_segundos, audio_narradores));
ALTER TABLE pliego.pedido_item DROP CONSTRAINT ck_pedido_item_formato,
    ADD CONSTRAINT ck_pedido_item_formato CHECK (formato_snapshot IN ('PAPERBACK','HARDCOVER','EBOOK','AUDIOBOOK')),
    ADD CONSTRAINT ck_pedido_item_cantidad_digital CHECK (
        pliego.fn_is_physical_format(formato_snapshot) OR cantidad = 1);

-- Also protect direct writes: changing fulfillment would invalidate stock/history.
CREATE FUNCTION pliego.fn_validate_edition_fulfillment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    IF pliego.fn_is_physical_format(OLD.formato) IS DISTINCT FROM pliego.fn_is_physical_format(NEW.formato) THEN
        PERFORM pliego.fn_raise_domain_error('P2048','EDITION_DATA_INVALID');
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_edicion_validate_fulfillment BEFORE UPDATE OF formato ON pliego.edicion
FOR EACH ROW EXECUTE FUNCTION pliego.fn_validate_edition_fulfillment();

CREATE FUNCTION pliego.fn_validate_physical_inventory() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    PERFORM e.edicion_id FROM pliego.edicion e WHERE e.edicion_id = NEW.edicion_id
        AND pliego.fn_is_physical_format(e.formato) FOR SHARE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND'); END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_inventario_physical_only BEFORE INSERT OR UPDATE ON pliego.inventario
FOR EACH ROW EXECUTE FUNCTION pliego.fn_validate_physical_inventory();

-- Public listing keeps physical out-of-stock editions visible; digital needs no inventory row.
CREATE FUNCTION pliego.fn_edition_listable(p_format TEXT, p_stock INTEGER)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$
    SELECT CASE WHEN pliego.fn_is_physical_format(p_format) THEN p_stock IS NOT NULL
        ELSE p_format IN ('EBOOK','AUDIOBOOK') END;
$$;
CREATE FUNCTION pliego.fn_edition_available(p_format TEXT, p_book_state TEXT,
    p_edition_state TEXT, p_stock INTEGER, p_quantity INTEGER DEFAULT 1)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$
    SELECT COALESCE(p_book_state = 'ACTIVE' AND p_edition_state = 'ACTIVE'
        AND CASE WHEN pliego.fn_is_physical_format(p_format) THEN p_stock >= p_quantity
            ELSE p_format IN ('EBOOK','AUDIOBOOK') AND p_quantity = 1 END, FALSE);
$$;



CREATE OR REPLACE PROCEDURE pliego.sp_edition_create(IN p_actor_user_id BIGINT,IN p_book_id BIGINT,IN p_publisher_id BIGINT,IN p_sku VARCHAR,IN p_isbn13 VARCHAR,IN p_language VARCHAR,IN p_format VARCHAR,IN p_page_count INTEGER,IN p_publication_date DATE,IN p_price NUMERIC,IN p_cover_url VARCHAR,IN p_cover_license VARCHAR,IN p_cover_source_url VARCHAR,IN p_cover_attribution VARCHAR,IN p_ebook_format VARCHAR,IN p_audio_duration_seconds INTEGER,IN p_narrators TEXT[],OUT o_edition_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_sku TEXT;v_isbn TEXT;v_language TEXT;v_pub_state VARCHAR;v_constraint TEXT;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM l.libro_id FROM pliego.libro l WHERE l.libro_id=p_book_id FOR SHARE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2031','BOOK_NOT_FOUND');END IF;
 SELECT e.estado INTO v_pub_state FROM pliego.editorial e WHERE e.editorial_id=p_publisher_id FOR SHARE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2011','PUBLISHER_NOT_FOUND');END IF;IF v_pub_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P2012','PUBLISHER_INACTIVE');END IF;
 v_sku:=pliego.fn_normalize_sku(p_sku);v_isbn:=NULLIF(btrim(p_isbn13),'');v_language:=pliego.fn_normalize_language(p_language);
 IF v_sku IS NULL OR v_sku !~ '^[A-Z0-9][A-Z0-9._-]{0,63}$' OR v_language IS NULL OR v_language !~ '^[a-z]{2,3}$' OR NOT pliego.fn_edition_metadata_valid(p_format,p_page_count,p_ebook_format,p_audio_duration_seconds,COALESCE(p_narrators,ARRAY[]::TEXT[])) OR p_price IS NULL OR p_price<=0 OR p_price>999999999.99 THEN PERFORM pliego.fn_raise_domain_error('P2048','EDITION_DATA_INVALID');END IF;
 IF v_isbn IS NOT NULL AND NOT pliego.fn_is_valid_isbn13(v_isbn) THEN PERFORM pliego.fn_raise_domain_error('P2046','ISBN_INVALID');END IF;
 PERFORM pliego.fn_validate_cover_metadata(NULLIF(btrim(p_cover_url),''),NULLIF(btrim(p_cover_license),''),NULLIF(btrim(p_cover_source_url),''),NULLIF(btrim(p_cover_attribution),''));
 BEGIN INSERT INTO pliego.edicion(libro_id,editorial_id,sku,isbn13,idioma,formato,numero_paginas,fecha_publicacion,precio,portada_url,portada_licencia,portada_fuente_url,portada_atribucion,ebook_formato,audio_duracion_segundos,audio_narradores,estado)VALUES(p_book_id,p_publisher_id,v_sku,v_isbn,v_language,p_format,p_page_count,p_publication_date,p_price,NULLIF(btrim(p_cover_url),''),NULLIF(btrim(p_cover_license),''),NULLIF(btrim(p_cover_source_url),''),NULLIF(btrim(p_cover_attribution),''),p_ebook_format,p_audio_duration_seconds,ARRAY(SELECT btrim(n) FROM unnest(COALESCE(p_narrators,ARRAY[]::TEXT[])) n),'ACTIVE')RETURNING edicion_id INTO o_edition_id;
 EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;IF v_constraint='uq_edicion_sku' THEN PERFORM pliego.fn_raise_domain_error('P2044','SKU_ALREADY_EXISTS');ELSIF v_constraint='uq_edicion_isbn' THEN PERFORM pliego.fn_raise_domain_error('P2045','ISBN_ALREADY_EXISTS');END IF;RAISE;END;
 IF pliego.fn_is_physical_format(p_format) THEN INSERT INTO pliego.inventario(edicion_id,stock_actual,stock_minimo)VALUES(o_edition_id,0,0); END IF;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_edition_create(IN p_actor_user_id BIGINT,IN p_book_id BIGINT,IN p_publisher_id BIGINT,IN p_sku VARCHAR,IN p_isbn13 VARCHAR,IN p_language VARCHAR,IN p_format VARCHAR,IN p_page_count INTEGER,IN p_publication_date DATE,IN p_price NUMERIC,IN p_cover_url VARCHAR,IN p_cover_license VARCHAR,IN p_cover_source_url VARCHAR,IN p_cover_attribution VARCHAR,OUT o_edition_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN
 CALL pliego.sp_edition_create(p_actor_user_id,p_book_id,p_publisher_id,p_sku,p_isbn13,p_language,p_format,p_page_count,p_publication_date,p_price,p_cover_url,p_cover_license,p_cover_source_url,p_cover_attribution,NULL::VARCHAR,NULL::INTEGER,ARRAY[]::TEXT[],o_edition_id);
END; $$;

CREATE OR REPLACE PROCEDURE pliego.sp_edition_update(IN p_actor_user_id BIGINT,IN p_edition_id BIGINT,IN p_publisher_id BIGINT,IN p_isbn13 VARCHAR,IN p_language VARCHAR,IN p_format VARCHAR,IN p_page_count INTEGER,IN p_publication_date DATE,IN p_price NUMERIC,IN p_cover_url VARCHAR,IN p_cover_license VARCHAR,IN p_cover_source_url VARCHAR,IN p_cover_attribution VARCHAR,IN p_ebook_format VARCHAR,IN p_audio_duration_seconds INTEGER,IN p_narrators TEXT[])
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_current_pub BIGINT;v_book_id BIGINT;v_pub_state VARCHAR;v_isbn TEXT;v_language TEXT;v_constraint TEXT;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');SELECT e.editorial_id,e.libro_id INTO v_current_pub,v_book_id FROM pliego.edicion e WHERE e.edicion_id=p_edition_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND');END IF;
 PERFORM l.libro_id FROM pliego.libro l WHERE l.libro_id=v_book_id FOR SHARE;SELECT e.estado INTO v_pub_state FROM pliego.editorial e WHERE e.editorial_id=p_publisher_id FOR SHARE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2011','PUBLISHER_NOT_FOUND');END IF;IF p_publisher_id<>v_current_pub AND v_pub_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P2012','PUBLISHER_INACTIVE');END IF;
 v_isbn:=NULLIF(btrim(p_isbn13),'');v_language:=pliego.fn_normalize_language(p_language);IF v_language IS NULL OR v_language !~ '^[a-z]{2,3}$' OR NOT pliego.fn_edition_metadata_valid(p_format,p_page_count,p_ebook_format,p_audio_duration_seconds,COALESCE(p_narrators,ARRAY[]::TEXT[])) OR p_price IS NULL OR p_price<=0 OR p_price>999999999.99 THEN PERFORM pliego.fn_raise_domain_error('P2048','EDITION_DATA_INVALID');END IF;
 IF v_isbn IS NOT NULL AND NOT pliego.fn_is_valid_isbn13(v_isbn) THEN PERFORM pliego.fn_raise_domain_error('P2046','ISBN_INVALID');END IF;PERFORM pliego.fn_validate_cover_metadata(NULLIF(btrim(p_cover_url),''),NULLIF(btrim(p_cover_license),''),NULLIF(btrim(p_cover_source_url),''),NULLIF(btrim(p_cover_attribution),''));
 BEGIN UPDATE pliego.edicion SET editorial_id=p_publisher_id,isbn13=v_isbn,idioma=v_language,formato=p_format,numero_paginas=p_page_count,fecha_publicacion=p_publication_date,precio=p_price,portada_url=NULLIF(btrim(p_cover_url),''),portada_licencia=NULLIF(btrim(p_cover_license),''),portada_fuente_url=NULLIF(btrim(p_cover_source_url),''),portada_atribucion=NULLIF(btrim(p_cover_attribution),''),ebook_formato=p_ebook_format,audio_duracion_segundos=p_audio_duration_seconds,audio_narradores=ARRAY(SELECT btrim(n) FROM unnest(COALESCE(p_narrators,ARRAY[]::TEXT[])) n) WHERE edicion_id=p_edition_id;
 EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;IF v_constraint='uq_edicion_isbn' THEN PERFORM pliego.fn_raise_domain_error('P2045','ISBN_ALREADY_EXISTS');ELSIF v_constraint='uq_edicion_sku' THEN PERFORM pliego.fn_raise_domain_error('P2044','SKU_ALREADY_EXISTS');END IF;RAISE;END;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_edition_update(IN p_actor_user_id BIGINT,IN p_edition_id BIGINT,IN p_publisher_id BIGINT,IN p_isbn13 VARCHAR,IN p_language VARCHAR,IN p_format VARCHAR,IN p_page_count INTEGER,IN p_publication_date DATE,IN p_price NUMERIC,IN p_cover_url VARCHAR,IN p_cover_license VARCHAR,IN p_cover_source_url VARCHAR,IN p_cover_attribution VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN
 CALL pliego.sp_edition_update(p_actor_user_id,p_edition_id,p_publisher_id,p_isbn13,p_language,p_format,p_page_count,p_publication_date,p_price,p_cover_url,p_cover_license,p_cover_source_url,p_cover_attribution,NULL::VARCHAR,NULL::INTEGER,ARRAY[]::TEXT[]);
END; $$;

DROP FUNCTION pliego.fn_catalog_search(VARCHAR,VARCHAR,VARCHAR,VARCHAR,NUMERIC,NUMERIC,VARCHAR,VARCHAR,VARCHAR,INTEGER,INTEGER);
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
           pub.nombre, e.isbn13, e.precio, e.portada_url, e.portada_licencia, e.portada_atribucion,
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
      AND (p_price_min IS NULL OR e.precio >= p_price_min)
      AND (p_price_max IS NULL OR e.precio <= p_price_max)
      AND (v_language IS NULL OR e.idioma = v_language)
      AND (p_format IS NULL OR e.formato = p_format)
    ORDER BY CASE WHEN p_sort = 'TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN e.precio END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN e.precio END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

DROP FUNCTION pliego.fn_catalog_search_global(VARCHAR,VARCHAR,NUMERIC,NUMERIC,VARCHAR,VARCHAR,VARCHAR,INTEGER,INTEGER);
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
           pub.nombre, e.isbn13, e.precio, e.portada_url, e.portada_licencia, e.portada_atribucion,
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
      AND (p_price_min IS NULL OR e.precio >= p_price_min)
      AND (p_price_max IS NULL OR e.precio <= p_price_max)
      AND (v_language IS NULL OR e.idioma = v_language)
      AND (p_format IS NULL OR e.formato = p_format)
    ORDER BY CASE WHEN p_sort = 'TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_ASC' THEN e.precio END ASC NULLS LAST,
             CASE WHEN p_sort = 'PRICE_DESC' THEN e.precio END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page * p_page_size;
END;
$$;

DROP FUNCTION pliego.fn_edition_detail(BIGINT);
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
       pub.editorial_id,pub.nombre,e.isbn13,e.sku,e.idioma,e.formato,e.numero_paginas,e.fecha_publicacion,e.precio,e.portada_url,e.portada_licencia,e.portada_fuente_url,e.portada_atribucion,pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual),e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores
FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id JOIN pliego.editorial pub ON pub.editorial_id=e.editorial_id LEFT JOIN pliego.inventario i ON i.edicion_id=e.edicion_id
WHERE e.edicion_id=p_edition_id AND e.estado='ACTIVE' AND l.estado='ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual);
$$;

DROP FUNCTION pliego.fn_admin_edition_search(BIGINT,VARCHAR,VARCHAR,BIGINT,INTEGER,INTEGER);
CREATE OR REPLACE FUNCTION pliego.fn_admin_edition_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_book_id BIGINT,p_page INTEGER,p_page_size INTEGER,p_format VARCHAR DEFAULT NULL)
RETURNS TABLE(edition_id BIGINT,book_id BIGINT,book_title VARCHAR,publisher_id BIGINT,publisher_name VARCHAR,sku VARCHAR,isbn13 CHAR(13),language VARCHAR,format VARCHAR,page_count INTEGER,publication_date DATE,price NUMERIC(11,2),cover_url VARCHAR,cover_license VARCHAR,cover_source_url VARCHAR,cover_attribution VARCHAR,state VARCHAR,stock_actual INTEGER,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT, ebook_file_format VARCHAR, audio_duration_seconds INTEGER, narrators TEXT[]
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(lower(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF p_format IS NOT NULL AND p_format NOT IN ('PAPERBACK','HARDCOVER','EBOOK','AUDIOBOOK') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT e.edicion_id,l.libro_id,l.titulo,pub.editorial_id,pub.nombre,e.sku,e.isbn13,e.idioma,e.formato,e.numero_paginas,e.fecha_publicacion,e.precio,e.portada_url,e.portada_licencia,e.portada_fuente_url,e.portada_atribucion,e.estado,i.stock_actual,e.fecha_creacion,e.fecha_actualizacion,count(*) OVER()::BIGINT,e.ebook_formato,e.audio_duracion_segundos,e.audio_narradores FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id JOIN pliego.editorial pub ON pub.editorial_id=e.editorial_id LEFT JOIN pliego.inventario i ON i.edicion_id=e.edicion_id WHERE (p_format IS NULL OR e.formato=p_format) AND (p_state IS NULL OR e.estado=p_state) AND (p_book_id IS NULL OR e.libro_id=p_book_id) AND (v_query IS NULL OR lower(e.sku) LIKE '%'||v_query||'%' OR lower(COALESCE(e.isbn13,''))=v_query OR lower(l.titulo) LIKE '%'||v_query||'%') ORDER BY e.fecha_creacion DESC,e.edicion_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_public_category_list()
RETURNS TABLE(category_slug VARCHAR, category_name VARCHAR, parent_category_slug VARCHAR)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT category.slug, category.nombre, parent.slug
    FROM pliego.categoria AS category
    LEFT JOIN pliego.categoria AS parent
        ON parent.categoria_id = category.categoria_padre_id
    WHERE category.estado = 'ACTIVE'
      AND (category.categoria_padre_id IS NULL OR parent.estado = 'ACTIVE')
      AND EXISTS (
            SELECT 1
            FROM pliego.libro_categoria AS lc
            JOIN pliego.libro AS book ON book.libro_id = lc.libro_id AND book.estado = 'ACTIVE'
            JOIN pliego.edicion AS edition ON edition.libro_id = book.libro_id AND edition.estado = 'ACTIVE'
            LEFT JOIN pliego.inventario AS inventory ON inventory.edicion_id = edition.edicion_id
            WHERE pliego.fn_edition_listable(edition.formato,inventory.stock_actual) AND (lc.categoria_id = category.categoria_id
               OR (category.categoria_padre_id IS NULL AND EXISTS (
                    SELECT 1
                    FROM pliego.categoria AS child
                    WHERE child.categoria_id = lc.categoria_id
                      AND child.categoria_padre_id = category.categoria_id
                      AND child.estado = 'ACTIVE')))
      )
    ORDER BY COALESCE(parent.nombre, category.nombre),
             (category.categoria_padre_id IS NOT NULL), category.nombre, category.slug;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_public_catalog_filter_options()
RETURNS TABLE(language_code VARCHAR, minimum_price NUMERIC(11,2), maximum_price NUMERIC(11,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    WITH public_editions AS MATERIALIZED (
        SELECT edition.idioma AS language_code, edition.precio AS price
        FROM pliego.edicion AS edition
        JOIN pliego.libro AS book ON book.libro_id = edition.libro_id
        LEFT JOIN pliego.inventario AS inventory ON inventory.edicion_id = edition.edicion_id
        WHERE edition.estado = 'ACTIVE' AND book.estado = 'ACTIVE' AND pliego.fn_edition_listable(edition.formato,inventory.stock_actual)
    ),
    price_bounds AS (
        SELECT min(price) AS minimum_price, max(price) AS maximum_price
        FROM public_editions
    ),
    public_languages AS (
        SELECT DISTINCT language_code
        FROM public_editions
    )
    SELECT public_languages.language_code, price_bounds.minimum_price, price_bounds.maximum_price
    FROM price_bounds
    LEFT JOIN public_languages ON TRUE
    ORDER BY public_languages.language_code NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_public_catalog_filter_facets()
RETURNS TABLE(languages JSONB, formats JSONB, minimum_price NUMERIC(11,2), maximum_price NUMERIC(11,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    WITH public_editions AS MATERIALIZED (
        SELECT edition.idioma AS language_code, edition.formato AS edition_format, edition.precio AS price
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

CREATE OR REPLACE PROCEDURE pliego.sp_customer_favorite_add(
    IN p_actor_user_id BIGINT,
    IN p_edition_id BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_customer_id BIGINT;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    IF p_edition_id IS NULL OR p_edition_id <= 0 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT');
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pliego.edicion e
          JOIN pliego.libro l ON l.libro_id = e.libro_id
          LEFT JOIN pliego.inventario i ON i.edicion_id = e.edicion_id
         WHERE e.edicion_id = p_edition_id
           AND e.estado = 'ACTIVE'
           AND l.estado = 'ACTIVE' AND pliego.fn_edition_listable(e.formato,i.stock_actual)
    ) THEN
        PERFORM pliego.fn_raise_domain_error('P2041', 'EDITION_NOT_FOUND');
    END IF;

    INSERT INTO pliego.cliente_favorito(cliente_id, edicion_id)
    VALUES (v_customer_id, p_edition_id)
    ON CONFLICT (cliente_id, edicion_id) DO NOTHING;
END;
$$;

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
           e.precio,
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

CREATE OR REPLACE FUNCTION pliego.fn_cart_get(p_actor_user_id BIGINT)
RETURNS TABLE(cart_id BIGINT,state VARCHAR,items JSONB,total_current NUMERIC(30,2))
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_cart_id BIGINT;v_state VARCHAR;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;SELECT c.carrito_id,c.estado INTO v_cart_id,v_state FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE';
 IF NOT FOUND THEN RETURN QUERY SELECT NULL::BIGINT,NULL::VARCHAR,'[]'::JSONB,0.00::NUMERIC(30,2);RETURN;END IF;
 RETURN QUERY SELECT v_cart_id,v_state,COALESCE((SELECT jsonb_agg(jsonb_build_object('cartItemId',ci.carrito_item_id,'editionId',e.edicion_id,'title',l.titulo,'authors',pliego.fn_build_authors_snapshot(l.libro_id),'sku',e.sku,'format',e.formato,'coverUrl',e.portada_url,'quantity',ci.cantidad,'currentPrice',e.precio,'currentSubtotal',(ci.cantidad*e.precio),'available',pliego.fn_edition_available(e.formato,l.estado,e.estado,i.stock_actual,ci.cantidad),'unavailabilityReason',CASE WHEN l.estado<>'ACTIVE' THEN 'P2043' WHEN e.estado<>'ACTIVE' THEN 'P2042' WHEN NOT pliego.fn_is_physical_format(e.formato) AND ci.cantidad<>1 THEN 'P4004' WHEN pliego.fn_is_physical_format(e.formato) AND COALESCE(i.stock_actual,0)<ci.cantidad THEN 'P3002' ELSE NULL END)ORDER BY ci.fecha_creacion,ci.carrito_item_id) FROM pliego.carrito_item ci JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id JOIN pliego.libro l ON l.libro_id=e.libro_id LEFT JOIN pliego.inventario i ON i.edicion_id=e.edicion_id WHERE ci.carrito_id=v_cart_id),'[]'::JSONB),COALESCE((SELECT sum(ci.cantidad*e.precio)::NUMERIC(30,2) FROM pliego.carrito_item ci JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id WHERE ci.carrito_id=v_cart_id),0.00::NUMERIC(30,2));
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_cart_add_item(IN p_actor_user_id BIGINT,IN p_edition_id BIGINT,IN p_quantity INTEGER,OUT o_cart_id BIGINT,OUT o_cart_item_id BIGINT,OUT o_quantity INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_book_state VARCHAR;v_edition_state VARCHAR;v_stock INTEGER;v_current INTEGER;v_format VARCHAR;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;IF p_quantity IS NULL OR p_quantity<=0 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID');END IF;
 SELECT l.estado,e.estado,e.formato INTO v_book_state,v_edition_state,v_format FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id WHERE e.edicion_id=p_edition_id;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND');END IF;IF v_edition_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P2042','EDITION_INACTIVE');END IF;IF v_book_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P2043','BOOK_INACTIVE');END IF;
 IF pliego.fn_is_physical_format(v_format) THEN SELECT i.stock_actual INTO v_stock FROM pliego.inventario i WHERE i.edicion_id=p_edition_id;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');END IF; END IF;
 INSERT INTO pliego.carrito(cliente_id,estado)VALUES(v_customer_id,'ACTIVE')ON CONFLICT(cliente_id)WHERE estado='ACTIVE' DO NOTHING;
 SELECT c.carrito_id INTO o_cart_id FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE' FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE');END IF;
 SELECT ci.cantidad,ci.carrito_item_id INTO v_current,o_cart_item_id FROM pliego.carrito_item ci WHERE ci.carrito_id=o_cart_id AND ci.edicion_id=p_edition_id;
 IF FOUND THEN o_quantity:=v_current+p_quantity;IF NOT pliego.fn_is_physical_format(v_format) AND o_quantity<>1 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID'); END IF;IF pliego.fn_is_physical_format(v_format) AND o_quantity>v_stock THEN PERFORM pliego.fn_raise_domain_error('P3002','INSUFFICIENT_STOCK');END IF;UPDATE pliego.carrito_item SET cantidad=o_quantity WHERE carrito_item_id=o_cart_item_id;
 ELSE o_quantity:=p_quantity;IF NOT pliego.fn_is_physical_format(v_format) AND o_quantity<>1 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID'); END IF;IF pliego.fn_is_physical_format(v_format) AND o_quantity>v_stock THEN PERFORM pliego.fn_raise_domain_error('P3002','INSUFFICIENT_STOCK');END IF;INSERT INTO pliego.carrito_item(carrito_id,edicion_id,cantidad)VALUES(o_cart_id,p_edition_id,o_quantity)RETURNING carrito_item_id INTO o_cart_item_id;END IF;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_cart_update_item(IN p_actor_user_id BIGINT,IN p_cart_item_id BIGINT,IN p_quantity INTEGER,OUT o_cart_id BIGINT,OUT o_cart_item_id BIGINT,OUT o_quantity INTEGER)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_ed BIGINT;v_stock INTEGER;v_format VARCHAR;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;IF p_quantity IS NULL OR p_quantity<=0 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID');END IF;SELECT c.carrito_id INTO o_cart_id FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE' FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE');END IF;SELECT ci.edicion_id INTO v_ed FROM pliego.carrito_item ci WHERE ci.carrito_item_id=p_cart_item_id AND ci.carrito_id=o_cart_id;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P4003','CART_ITEM_NOT_FOUND');END IF;SELECT e.formato INTO v_format FROM pliego.edicion e WHERE e.edicion_id=v_ed;IF NOT pliego.fn_is_physical_format(v_format) AND p_quantity<>1 THEN PERFORM pliego.fn_raise_domain_error('P4004','CART_QUANTITY_INVALID');END IF;IF pliego.fn_is_physical_format(v_format) THEN SELECT i.stock_actual INTO v_stock FROM pliego.inventario i WHERE i.edicion_id=v_ed;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P3001','INVENTORY_NOT_FOUND');END IF;IF p_quantity>v_stock THEN PERFORM pliego.fn_raise_domain_error('P3002','INSUFFICIENT_STOCK');END IF;END IF;UPDATE pliego.carrito_item SET cantidad=p_quantity WHERE carrito_item_id=p_cart_item_id;o_cart_item_id:=p_cart_item_id;o_quantity:=p_quantity;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_checkout(
    IN p_actor_user_id BIGINT,
    IN p_address_id BIGINT,
    IN p_payment_method VARCHAR,
    IN p_payment_outcome VARCHAR,
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
    v_customer_id BIGINT;
    v_cart_id BIGINT;
    v_address pliego.direccion%ROWTYPE;
    v_item RECORD;
    v_before INTEGER;
    v_after INTEGER;
    v_payment_id BIGINT;
    v_reference VARCHAR;
    v_constraint TEXT;
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

    SELECT d.*
      INTO v_address
      FROM pliego.direccion d
     WHERE d.direccion_id = p_address_id
       AND d.cliente_id = v_customer_id
     FOR SHARE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P5004', 'CHECKOUT_ADDRESS_INVALID');
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
               e.precio, e.formato
          FROM pliego.carrito_item ci
          JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
          JOIN pliego.libro l ON l.libro_id = e.libro_id
         WHERE ci.carrito_id = v_cart_id
         ORDER BY ci.edicion_id
    LOOP
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

    SELECT sum(ci.cantidad * e.precio)::NUMERIC(30,2)
      INTO o_total
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
     WHERE ci.carrito_id = v_cart_id;

    IF o_total IS NULL OR o_total <= 0 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid order total');
    END IF;

    INSERT INTO pliego.pedido(cliente_id, estado, subtotal, total)
    VALUES (v_customer_id, 'PENDING_PAYMENT', o_total, o_total)
    RETURNING pedido_id INTO o_order_id;

    INSERT INTO pliego.pedido_estado_historial(
        pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
    ) VALUES (
        o_order_id, NULL, 'SYSTEM', NULL, 'PENDING_PAYMENT'
    );

    INSERT INTO pliego.pedido_item(
        pedido_id, edicion_id, sku_snapshot, isbn_snapshot, titulo_snapshot,
        autores_snapshot, editorial_snapshot, formato_snapshot, idioma_snapshot,
        precio_unitario, cantidad, subtotal
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
           e.precio,
           ci.cantidad,
           (e.precio * ci.cantidad)::NUMERIC(30,2)
      FROM pliego.carrito_item ci
      JOIN pliego.edicion e ON e.edicion_id = ci.edicion_id
      JOIN pliego.libro l ON l.libro_id = e.libro_id
      JOIN pliego.editorial pub ON pub.editorial_id = e.editorial_id
     WHERE ci.carrito_id = v_cart_id
     ORDER BY e.edicion_id;

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

CREATE OR REPLACE PROCEDURE pliego.sp_order_cancel(
    IN p_actor_user_id BIGINT,
    IN p_order_id BIGINT,
    OUT o_order_id BIGINT,
    OUT o_previous_state VARCHAR,
    OUT o_order_state VARCHAR,
    OUT o_payment_state VARCHAR,
    OUT o_restored_units BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_actor RECORD;
    v_order_customer BIGINT;
    v_payment_state VARCHAR;
    v_item RECORD;
    v_before INTEGER;
    v_after INTEGER;
    v_constraint TEXT;
BEGIN
    SELECT * INTO v_actor
      FROM pliego.fn_assert_actor(p_actor_user_id, NULL);

    -- RC-07: existence/ownership must be checked before exposing state/payment details.
    SELECT p.cliente_id, p.estado
      INTO v_order_customer, o_previous_state
      FROM pliego.pedido p
     WHERE p.pedido_id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P5001', 'ORDER_NOT_FOUND');
    END IF;

    IF v_actor.rol = 'CUSTOMER' AND v_order_customer <> v_actor.cliente_id THEN
        PERFORM pliego.fn_raise_domain_error('P5001', 'ORDER_NOT_FOUND');
    ELSIF v_actor.rol NOT IN ('CUSTOMER', 'ADMIN') THEN
        PERFORM pliego.fn_raise_domain_error('P5001', 'ORDER_NOT_FOUND');
    END IF;

    IF o_previous_state NOT IN ('CONFIRMED', 'PREPARING') THEN
        PERFORM pliego.fn_raise_domain_error('P5003', 'ORDER_NOT_CANCELLABLE');
    END IF;

    SELECT pa.estado
      INTO v_payment_state
      FROM pliego.pago pa
     WHERE pa.pedido_id = p_order_id;

    IF NOT FOUND OR v_payment_state <> 'APPROVED' THEN
        PERFORM pliego.fn_raise_domain_error('P5006', 'PAYMENT_STATE_INVALID');
    END IF;

    FOR v_item IN
        SELECT pi.edicion_id, pi.cantidad, i.stock_actual
          FROM pliego.pedido_item pi
          JOIN pliego.inventario i ON i.edicion_id = pi.edicion_id
         WHERE pi.pedido_id = p_order_id
         ORDER BY pi.edicion_id
         FOR UPDATE OF i
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pliego.movimiento_inventario m
             WHERE m.pedido_id = p_order_id
               AND m.edicion_id = v_item.edicion_id
               AND m.tipo = 'SALE'
        ) THEN
            PERFORM pliego.fn_raise_domain_error('P3006', 'SALE_REQUIRED_FOR_CANCELLATION');
        END IF;

        IF EXISTS (
            SELECT 1
              FROM pliego.movimiento_inventario m
             WHERE m.pedido_id = p_order_id
               AND m.edicion_id = v_item.edicion_id
               AND m.tipo = 'CANCELLATION'
        ) THEN
            PERFORM pliego.fn_raise_domain_error('P3005', 'STOCK_MOVEMENT_DUPLICATE');
        END IF;

        v_before := v_item.stock_actual;
        v_after := v_before + v_item.cantidad;

        UPDATE pliego.inventario
           SET stock_actual = v_after
         WHERE edicion_id = v_item.edicion_id;

        BEGIN
            INSERT INTO pliego.movimiento_inventario(
                edicion_id, pedido_id, usuario_actor_id, tipo, cantidad,
                stock_anterior, stock_posterior, motivo
            ) VALUES (
                v_item.edicion_id, p_order_id, NULL, 'CANCELLATION', v_item.cantidad,
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

    UPDATE pliego.pago
       SET estado = 'REFUNDED'
     WHERE pedido_id = p_order_id
       AND estado = 'APPROVED';

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P5006', 'PAYMENT_STATE_INVALID');
    END IF;

    UPDATE pliego.pedido
       SET estado = 'CANCELLED'
     WHERE pedido_id = p_order_id;

    INSERT INTO pliego.pedido_estado_historial(
        pedido_id, usuario_actor_id, origen, estado_anterior, estado_nuevo
    ) VALUES (
        p_order_id, p_actor_user_id, 'USER', o_previous_state, 'CANCELLED'
    );

    SELECT COALESCE(sum(pi.cantidad), 0)::BIGINT
      INTO o_restored_units
      FROM pliego.pedido_item pi
     WHERE pi.pedido_id = p_order_id AND pliego.fn_is_physical_format(pi.formato_snapshot);

    o_order_id := p_order_id;
    o_order_state := 'CANCELLED';
    o_payment_state := 'REFUNDED';
END;
$$;
