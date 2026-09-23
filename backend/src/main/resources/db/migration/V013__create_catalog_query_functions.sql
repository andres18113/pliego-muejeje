-- PLIEGO V013 — Catalog public/admin read API

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
)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE
    v_title TEXT := NULLIF(lower(btrim(p_title_query)), '');
    v_author TEXT := NULLIF(lower(btrim(p_author_query)), '');
    v_category TEXT := CASE WHEN p_category_slug IS NULL OR btrim(p_category_slug)='' THEN NULL ELSE pliego.fn_normalize_slug(p_category_slug) END;
    v_language TEXT := CASE WHEN p_language IS NULL OR btrim(p_language)='' THEN NULL ELSE pliego.fn_normalize_language(p_language) END;
BEGIN
    PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
    IF p_sort IS NULL OR p_sort NOT IN('TITLE_ASC','PRICE_ASC','PRICE_DESC') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Invalid sort'); END IF;
    IF p_isbn13 IS NOT NULL AND p_isbn13 !~ '^[0-9]{13}$' THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Invalid ISBN filter'); END IF;
    IF (p_price_min IS NOT NULL AND p_price_min<0) OR (p_price_max IS NOT NULL AND p_price_max<0) OR (p_price_min IS NOT NULL AND p_price_max IS NOT NULL AND p_price_min>p_price_max) THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Invalid price range'); END IF;
    IF v_language IS NOT NULL AND v_language !~ '^[a-z]{2,3}$' THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Invalid language'); END IF;
    IF p_format IS NOT NULL AND p_format NOT IN('PAPERBACK','HARDCOVER') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Invalid format'); END IF;

    RETURN QUERY
    SELECT e.edicion_id,l.libro_id,l.titulo,pliego.fn_build_authors_snapshot(l.libro_id),pub.nombre,e.isbn13,e.precio,e.portada_url,e.portada_licencia,e.portada_atribucion,e.formato,e.idioma,(i.stock_actual>0),count(*) OVER()::BIGINT
    FROM pliego.edicion e
    JOIN pliego.libro l ON l.libro_id=e.libro_id
    JOIN pliego.editorial pub ON pub.editorial_id=e.editorial_id
    JOIN pliego.inventario i ON i.edicion_id=e.edicion_id
    WHERE e.estado='ACTIVE' AND l.estado='ACTIVE'
      AND (v_title IS NULL OR lower(l.titulo) LIKE '%'||v_title||'%')
      AND (v_author IS NULL OR EXISTS(SELECT 1 FROM pliego.libro_autor la JOIN pliego.autor a ON a.autor_id=la.autor_id WHERE la.libro_id=l.libro_id AND lower(a.nombre) LIKE '%'||v_author||'%'))
      AND (p_isbn13 IS NULL OR e.isbn13=p_isbn13)
      AND (v_category IS NULL OR EXISTS(
            SELECT 1 FROM pliego.libro_categoria lc
            JOIN pliego.categoria c ON c.categoria_id=lc.categoria_id
            LEFT JOIN pliego.categoria cp ON cp.categoria_id=c.categoria_padre_id
            WHERE lc.libro_id=l.libro_id AND (c.slug=v_category OR cp.slug=v_category)
      ))
      AND (p_price_min IS NULL OR e.precio>=p_price_min)
      AND (p_price_max IS NULL OR e.precio<=p_price_max)
      AND (v_language IS NULL OR e.idioma=v_language)
      AND (p_format IS NULL OR e.formato=p_format)
    ORDER BY CASE WHEN p_sort='TITLE_ASC' THEN lower(l.titulo) END ASC NULLS LAST,
             CASE WHEN p_sort='PRICE_ASC' THEN e.precio END ASC NULLS LAST,
             CASE WHEN p_sort='PRICE_DESC' THEN e.precio END DESC NULLS LAST,
             e.edicion_id ASC
    LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_edition_detail(p_edition_id BIGINT)
RETURNS TABLE(
    edition_id BIGINT, book_id BIGINT, title VARCHAR, subtitle VARCHAR, synopsis VARCHAR,
    authors_json JSONB, categories_json JSONB, publisher_id BIGINT, publisher_name VARCHAR,
    isbn13 CHAR(13), sku VARCHAR, language VARCHAR, format VARCHAR, page_count INTEGER,
    publication_date DATE, price NUMERIC(11,2), cover_url VARCHAR, cover_license VARCHAR,
    cover_source_url VARCHAR, cover_attribution VARCHAR, available BOOLEAN
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
SELECT e.edicion_id,l.libro_id,l.titulo,l.subtitulo,l.sinopsis,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('authorId',a.autor_id,'name',a.nombre,'order',la.orden_autoria) ORDER BY la.orden_autoria) FROM pliego.libro_autor la JOIN pliego.autor a ON a.autor_id=la.autor_id WHERE la.libro_id=l.libro_id),'[]'::jsonb),
       COALESCE((SELECT jsonb_agg(jsonb_build_object('categoryId',c.categoria_id,'name',c.nombre,'slug',c.slug,'parentCategoryId',c.categoria_padre_id) ORDER BY c.nombre,c.categoria_id) FROM pliego.libro_categoria lc JOIN pliego.categoria c ON c.categoria_id=lc.categoria_id WHERE lc.libro_id=l.libro_id),'[]'::jsonb),
       pub.editorial_id,pub.nombre,e.isbn13,e.sku,e.idioma,e.formato,e.numero_paginas,e.fecha_publicacion,e.precio,e.portada_url,e.portada_licencia,e.portada_fuente_url,e.portada_atribucion,(i.stock_actual>0)
FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id JOIN pliego.editorial pub ON pub.editorial_id=e.editorial_id JOIN pliego.inventario i ON i.edicion_id=e.edicion_id
WHERE e.edicion_id=p_edition_id AND e.estado='ACTIVE' AND l.estado='ACTIVE';
$$;

CREATE OR REPLACE FUNCTION pliego.fn_admin_author_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(author_id BIGINT,name VARCHAR,biography VARCHAR,state VARCHAR,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(lower(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT a.autor_id,a.nombre,a.biografia,a.estado,a.fecha_creacion,a.fecha_actualizacion,count(*) OVER()::BIGINT FROM pliego.autor a WHERE (p_state IS NULL OR a.estado=p_state) AND (v_query IS NULL OR lower(a.nombre) LIKE '%'||v_query||'%') ORDER BY a.fecha_creacion DESC,a.autor_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_admin_publisher_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(publisher_id BIGINT,name VARCHAR,description VARCHAR,state VARCHAR,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(lower(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT e.editorial_id,e.nombre,e.descripcion,e.estado,e.fecha_creacion,e.fecha_actualizacion,count(*) OVER()::BIGINT FROM pliego.editorial e WHERE (p_state IS NULL OR e.estado=p_state) AND (v_query IS NULL OR lower(e.nombre) LIKE '%'||v_query||'%') ORDER BY e.fecha_creacion DESC,e.editorial_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_admin_category_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(category_id BIGINT,parent_category_id BIGINT,parent_name VARCHAR,name VARCHAR,slug VARCHAR,description VARCHAR,state VARCHAR,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(lower(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT c.categoria_id,c.categoria_padre_id,cp.nombre,c.nombre,c.slug,c.descripcion,c.estado,c.fecha_creacion,c.fecha_actualizacion,count(*) OVER()::BIGINT FROM pliego.categoria c LEFT JOIN pliego.categoria cp ON cp.categoria_id=c.categoria_padre_id WHERE (p_state IS NULL OR c.estado=p_state) AND (v_query IS NULL OR lower(c.nombre) LIKE '%'||v_query||'%' OR c.slug LIKE '%'||v_query||'%') ORDER BY c.fecha_creacion DESC,c.categoria_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_admin_book_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(book_id BIGINT,title VARCHAR,subtitle VARCHAR,synopsis VARCHAR,state VARCHAR,authors_json JSONB,categories_json JSONB,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(lower(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT l.libro_id,l.titulo,l.subtitulo,l.sinopsis,l.estado,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('authorId',a.autor_id,'name',a.nombre,'order',la.orden_autoria) ORDER BY la.orden_autoria) FROM pliego.libro_autor la JOIN pliego.autor a ON a.autor_id=la.autor_id WHERE la.libro_id=l.libro_id),'[]'::jsonb),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('categoryId',c.categoria_id,'name',c.nombre,'slug',c.slug) ORDER BY c.nombre,c.categoria_id) FROM pliego.libro_categoria lc JOIN pliego.categoria c ON c.categoria_id=lc.categoria_id WHERE lc.libro_id=l.libro_id),'[]'::jsonb),
 l.fecha_creacion,l.fecha_actualizacion,count(*) OVER()::BIGINT
 FROM pliego.libro l WHERE (p_state IS NULL OR l.estado=p_state) AND (v_query IS NULL OR lower(l.titulo) LIKE '%'||v_query||'%' OR EXISTS(SELECT 1 FROM pliego.libro_autor la2 JOIN pliego.autor a2 ON a2.autor_id=la2.autor_id WHERE la2.libro_id=l.libro_id AND lower(a2.nombre) LIKE '%'||v_query||'%')) ORDER BY l.fecha_creacion DESC,l.libro_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_admin_edition_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_book_id BIGINT,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(edition_id BIGINT,book_id BIGINT,book_title VARCHAR,publisher_id BIGINT,publisher_name VARCHAR,sku VARCHAR,isbn13 CHAR(13),language VARCHAR,format VARCHAR,page_count INTEGER,publication_date DATE,price NUMERIC(11,2),cover_url VARCHAR,cover_license VARCHAR,cover_source_url VARCHAR,cover_attribution VARCHAR,state VARCHAR,stock_actual INTEGER,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(lower(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT e.edicion_id,l.libro_id,l.titulo,pub.editorial_id,pub.nombre,e.sku,e.isbn13,e.idioma,e.formato,e.numero_paginas,e.fecha_publicacion,e.precio,e.portada_url,e.portada_licencia,e.portada_fuente_url,e.portada_atribucion,e.estado,i.stock_actual,e.fecha_creacion,e.fecha_actualizacion,count(*) OVER()::BIGINT FROM pliego.edicion e JOIN pliego.libro l ON l.libro_id=e.libro_id JOIN pliego.editorial pub ON pub.editorial_id=e.editorial_id JOIN pliego.inventario i ON i.edicion_id=e.edicion_id WHERE (p_state IS NULL OR e.estado=p_state) AND (p_book_id IS NULL OR e.libro_id=p_book_id) AND (v_query IS NULL OR lower(e.sku) LIKE '%'||v_query||'%' OR lower(COALESCE(e.isbn13,''))=v_query OR lower(l.titulo) LIKE '%'||v_query||'%') ORDER BY e.fecha_creacion DESC,e.edicion_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;
