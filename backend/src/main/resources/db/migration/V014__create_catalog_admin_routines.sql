-- PLIEGO V014 — Catalog administration commands

CREATE OR REPLACE PROCEDURE pliego.sp_author_create(IN p_actor_user_id BIGINT,IN p_name VARCHAR,IN p_biography VARCHAR,OUT o_author_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
 IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR (p_biography IS NOT NULL AND char_length(p_biography)>5000) THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 INSERT INTO pliego.autor(nombre,biografia,estado) VALUES(btrim(p_name),NULLIF(btrim(p_biography),''),'ACTIVE') RETURNING autor_id INTO o_author_id;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_author_update(IN p_actor_user_id BIGINT,IN p_author_id BIGINT,IN p_name VARCHAR,IN p_biography VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_book RECORD;v_snapshot TEXT;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
 IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR (p_biography IS NOT NULL AND char_length(p_biography)>5000) THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 PERFORM 1 FROM pliego.autor a WHERE a.autor_id=p_author_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2001','AUTHOR_NOT_FOUND'); END IF;
 FOR v_book IN SELECT DISTINCT la.libro_id FROM pliego.libro_autor la WHERE la.autor_id=p_author_id ORDER BY la.libro_id LOOP
  SELECT string_agg(CASE WHEN la.autor_id=p_author_id THEN btrim(p_name) ELSE a.nombre END,'; ' ORDER BY la.orden_autoria) INTO v_snapshot FROM pliego.libro_autor la JOIN pliego.autor a ON a.autor_id=la.autor_id WHERE la.libro_id=v_book.libro_id;
  IF v_snapshot IS NULL OR char_length(v_snapshot)>1000 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Authors snapshot exceeds 1000 characters'); END IF;
 END LOOP;
 UPDATE pliego.autor SET nombre=btrim(p_name),biografia=NULLIF(btrim(p_biography),'') WHERE autor_id=p_author_id;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_author_set_status(IN p_actor_user_id BIGINT,IN p_author_id BIGINT,IN p_new_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_state VARCHAR;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');IF p_new_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 SELECT a.estado INTO v_state FROM pliego.autor a WHERE a.autor_id=p_author_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2001','AUTHOR_NOT_FOUND'); END IF;
 IF v_state<>p_new_state THEN UPDATE pliego.autor SET estado=p_new_state WHERE autor_id=p_author_id;END IF;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_publisher_create(IN p_actor_user_id BIGINT,IN p_name VARCHAR,IN p_description VARCHAR,OUT o_publisher_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
 IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR (p_description IS NOT NULL AND char_length(p_description)>2000) THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 INSERT INTO pliego.editorial(nombre,descripcion,estado) VALUES(btrim(p_name),NULLIF(btrim(p_description),''),'ACTIVE') RETURNING editorial_id INTO o_publisher_id;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_publisher_update(IN p_actor_user_id BIGINT,IN p_publisher_id BIGINT,IN p_name VARCHAR,IN p_description VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
 IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR (p_description IS NOT NULL AND char_length(p_description)>2000) THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 UPDATE pliego.editorial SET nombre=btrim(p_name),descripcion=NULLIF(btrim(p_description),'') WHERE editorial_id=p_publisher_id;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2011','PUBLISHER_NOT_FOUND'); END IF;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_publisher_set_status(IN p_actor_user_id BIGINT,IN p_publisher_id BIGINT,IN p_new_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_state VARCHAR;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');IF p_new_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 SELECT e.estado INTO v_state FROM pliego.editorial e WHERE e.editorial_id=p_publisher_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2011','PUBLISHER_NOT_FOUND'); END IF;
 IF v_state<>p_new_state THEN UPDATE pliego.editorial SET estado=p_new_state WHERE editorial_id=p_publisher_id;END IF;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_category_create(IN p_actor_user_id BIGINT,IN p_name VARCHAR,IN p_slug VARCHAR,IN p_description VARCHAR,IN p_parent_category_id BIGINT,OUT o_category_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_slug TEXT;v_constraint TEXT;v_parent_parent BIGINT;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');v_slug:=pliego.fn_normalize_slug(p_slug);
 IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR v_slug IS NULL OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(v_slug)>140 OR (p_description IS NOT NULL AND char_length(p_description)>1000) THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF p_parent_category_id IS NOT NULL THEN SELECT c.categoria_padre_id INTO v_parent_parent FROM pliego.categoria c WHERE c.categoria_id=p_parent_category_id FOR SHARE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2021','CATEGORY_NOT_FOUND');END IF;IF v_parent_parent IS NOT NULL THEN PERFORM pliego.fn_raise_domain_error('P2023','CATEGORY_INVALID_HIERARCHY');END IF;END IF;
 BEGIN INSERT INTO pliego.categoria(categoria_padre_id,nombre,slug,descripcion,estado) VALUES(p_parent_category_id,btrim(p_name),v_slug,NULLIF(btrim(p_description),''),'ACTIVE') RETURNING categoria_id INTO o_category_id;
 EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;IF v_constraint='uq_categoria_slug' THEN PERFORM pliego.fn_raise_domain_error('P2024','CATEGORY_SLUG_EXISTS');END IF;RAISE;END;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_category_update(IN p_actor_user_id BIGINT,IN p_category_id BIGINT,IN p_name VARCHAR,IN p_slug VARCHAR,IN p_description VARCHAR,IN p_parent_category_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_slug TEXT;v_parent_parent BIGINT;v_constraint TEXT;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM 1 FROM pliego.categoria c WHERE c.categoria_id=p_category_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2021','CATEGORY_NOT_FOUND');END IF;
 v_slug:=pliego.fn_normalize_slug(p_slug);IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR v_slug IS NULL OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(v_slug)>140 OR (p_description IS NOT NULL AND char_length(p_description)>1000) THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');END IF;
 IF p_parent_category_id=p_category_id THEN PERFORM pliego.fn_raise_domain_error('P2023','CATEGORY_INVALID_HIERARCHY');END IF;
 IF p_parent_category_id IS NOT NULL THEN SELECT c.categoria_padre_id INTO v_parent_parent FROM pliego.categoria c WHERE c.categoria_id=p_parent_category_id FOR SHARE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2021','CATEGORY_NOT_FOUND');END IF;IF v_parent_parent IS NOT NULL OR EXISTS(SELECT 1 FROM pliego.categoria ch WHERE ch.categoria_padre_id=p_category_id) THEN PERFORM pliego.fn_raise_domain_error('P2023','CATEGORY_INVALID_HIERARCHY');END IF;END IF;
 BEGIN UPDATE pliego.categoria SET categoria_padre_id=p_parent_category_id,nombre=btrim(p_name),slug=v_slug,descripcion=NULLIF(btrim(p_description),'') WHERE categoria_id=p_category_id;
 EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;IF v_constraint='uq_categoria_slug' THEN PERFORM pliego.fn_raise_domain_error('P2024','CATEGORY_SLUG_EXISTS');END IF;RAISE;END;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_category_set_status(IN p_actor_user_id BIGINT,IN p_category_id BIGINT,IN p_new_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_state VARCHAR;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');IF p_new_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');END IF;
 SELECT c.estado INTO v_state FROM pliego.categoria c WHERE c.categoria_id=p_category_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2021','CATEGORY_NOT_FOUND');END IF;
 IF v_state<>p_new_state THEN UPDATE pliego.categoria SET estado=p_new_state WHERE categoria_id=p_category_id;END IF;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_book_create(IN p_actor_user_id BIGINT,IN p_title VARCHAR,IN p_subtitle VARCHAR,IN p_synopsis VARCHAR,IN p_authors JSONB,IN p_category_ids JSONB,OUT o_book_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_author_count INTEGER;v_category_count INTEGER;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
 IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 300 OR (p_subtitle IS NOT NULL AND char_length(p_subtitle)>300) OR (p_synopsis IS NOT NULL AND char_length(p_synopsis)>10000) OR p_authors IS NULL OR jsonb_typeof(p_authors)<>'array' OR p_category_ids IS NULL OR jsonb_typeof(p_category_ids)<>'array' THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');END IF;
 v_author_count:=jsonb_array_length(p_authors);v_category_count:=jsonb_array_length(p_category_ids);IF v_author_count<1 THEN PERFORM pliego.fn_raise_domain_error('P2032','BOOK_REQUIRES_AUTHOR');END IF;IF v_category_count<1 THEN PERFORM pliego.fn_raise_domain_error('P2033','BOOK_REQUIRES_CATEGORY');END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_authors) AS x("authorId" BIGINT,"order" INTEGER) WHERE x."authorId" IS NULL OR x."order" IS NULL OR x."order"<=0) OR (SELECT count(*) FROM jsonb_to_recordset(p_authors) AS x("authorId" BIGINT,"order" INTEGER))<>(SELECT count(DISTINCT x."authorId") FROM jsonb_to_recordset(p_authors) AS x("authorId" BIGINT,"order" INTEGER)) OR (SELECT count(*) FROM jsonb_to_recordset(p_authors) AS x("authorId" BIGINT,"order" INTEGER))<>(SELECT count(DISTINCT x."order") FROM jsonb_to_recordset(p_authors) AS x("authorId" BIGINT,"order" INTEGER)) THEN PERFORM pliego.fn_raise_domain_error('P2034','AUTHOR_ORDER_INVALID');END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_category_ids) e(value) WHERE jsonb_typeof(e.value)<>'number' OR e.value::TEXT !~ '^[0-9]+$') OR (SELECT count(*) FROM jsonb_array_elements(p_category_ids))<>(SELECT count(DISTINCT (e.value::TEXT)::BIGINT) FROM jsonb_array_elements(p_category_ids)e(value)) THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');END IF;
 PERFORM a.autor_id FROM pliego.autor a JOIN(SELECT x."authorId" author_id FROM jsonb_to_recordset(p_authors) AS x("authorId" BIGINT,"order" INTEGER))req ON req.author_id=a.autor_id ORDER BY a.autor_id FOR SHARE OF a;
 IF (SELECT count(*) FROM pliego.autor a JOIN(SELECT x."authorId" author_id FROM jsonb_to_recordset(p_authors) AS x("authorId" BIGINT,"order" INTEGER))req ON req.author_id=a.autor_id)<>v_author_count THEN PERFORM pliego.fn_raise_domain_error('P2001','AUTHOR_NOT_FOUND');END IF;
 IF EXISTS(SELECT 1 FROM pliego.autor a JOIN(SELECT x."authorId" author_id FROM jsonb_to_recordset(p_authors) AS x("authorId" BIGINT,"order" INTEGER))req ON req.author_id=a.autor_id WHERE a.estado<>'ACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P2002','AUTHOR_INACTIVE');END IF;
 PERFORM c.categoria_id FROM pliego.categoria c JOIN(SELECT(e.value::TEXT)::BIGINT category_id FROM jsonb_array_elements(p_category_ids)e(value))req ON req.category_id=c.categoria_id ORDER BY c.categoria_id FOR SHARE OF c;
 IF (SELECT count(*) FROM pliego.categoria c JOIN(SELECT(e.value::TEXT)::BIGINT category_id FROM jsonb_array_elements(p_category_ids)e(value))req ON req.category_id=c.categoria_id)<>v_category_count THEN PERFORM pliego.fn_raise_domain_error('P2021','CATEGORY_NOT_FOUND');END IF;
 IF EXISTS(SELECT 1 FROM pliego.categoria c JOIN(SELECT(e.value::TEXT)::BIGINT category_id FROM jsonb_array_elements(p_category_ids)e(value))req ON req.category_id=c.categoria_id WHERE c.estado<>'ACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P2022','CATEGORY_INACTIVE');END IF;
 INSERT INTO pliego.libro(titulo,subtitulo,sinopsis,estado)VALUES(btrim(p_title),NULLIF(btrim(p_subtitle),''),NULLIF(btrim(p_synopsis),''),'ACTIVE')RETURNING libro_id INTO o_book_id;
 INSERT INTO pliego.libro_autor(libro_id,autor_id,orden_autoria)SELECT o_book_id,x."authorId",x."order" FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER);
 INSERT INTO pliego.libro_categoria(libro_id,categoria_id)SELECT o_book_id,(e.value::TEXT)::BIGINT FROM jsonb_array_elements(p_category_ids)e(value);
 PERFORM pliego.fn_build_authors_snapshot(o_book_id);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_book_update(IN p_actor_user_id BIGINT,IN p_book_id BIGINT,IN p_title VARCHAR,IN p_subtitle VARCHAR,IN p_synopsis VARCHAR,IN p_authors JSONB,IN p_category_ids JSONB)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_author_count INTEGER;v_category_count INTEGER;v_book_state VARCHAR;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');SELECT l.estado INTO v_book_state FROM pliego.libro l WHERE l.libro_id=p_book_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2031','BOOK_NOT_FOUND');END IF;
 IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 300 OR (p_subtitle IS NOT NULL AND char_length(p_subtitle)>300) OR (p_synopsis IS NOT NULL AND char_length(p_synopsis)>10000) OR p_authors IS NULL OR jsonb_typeof(p_authors)<>'array' OR p_category_ids IS NULL OR jsonb_typeof(p_category_ids)<>'array' THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');END IF;
 v_author_count:=jsonb_array_length(p_authors);v_category_count:=jsonb_array_length(p_category_ids);IF v_book_state='ACTIVE' AND v_author_count<1 THEN PERFORM pliego.fn_raise_domain_error('P2032','BOOK_REQUIRES_AUTHOR');END IF;IF v_book_state='ACTIVE' AND v_category_count<1 THEN PERFORM pliego.fn_raise_domain_error('P2033','BOOK_REQUIRES_CATEGORY');END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER)WHERE x."authorId" IS NULL OR x."order" IS NULL OR x."order"<=0) OR (SELECT count(*) FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER))<>(SELECT count(DISTINCT x."authorId") FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER)) OR (SELECT count(*) FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER))<>(SELECT count(DISTINCT x."order") FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER)) THEN PERFORM pliego.fn_raise_domain_error('P2034','AUTHOR_ORDER_INVALID');END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_category_ids)e(value)WHERE jsonb_typeof(e.value)<>'number' OR e.value::TEXT !~ '^[0-9]+$') OR (SELECT count(*) FROM jsonb_array_elements(p_category_ids))<>(SELECT count(DISTINCT(e.value::TEXT)::BIGINT)FROM jsonb_array_elements(p_category_ids)e(value)) THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');END IF;
 PERFORM a.autor_id FROM pliego.autor a JOIN(SELECT x."authorId" author_id FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER))req ON req.author_id=a.autor_id ORDER BY a.autor_id FOR SHARE OF a;
 IF (SELECT count(*) FROM pliego.autor a JOIN(SELECT x."authorId" author_id FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER))req ON req.author_id=a.autor_id)<>v_author_count THEN PERFORM pliego.fn_raise_domain_error('P2001','AUTHOR_NOT_FOUND');END IF;
 IF EXISTS(SELECT 1 FROM pliego.autor a JOIN(SELECT x."authorId" author_id FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER))req ON req.author_id=a.autor_id WHERE a.estado<>'ACTIVE' AND NOT EXISTS(SELECT 1 FROM pliego.libro_autor old WHERE old.libro_id=p_book_id AND old.autor_id=a.autor_id)) THEN PERFORM pliego.fn_raise_domain_error('P2002','AUTHOR_INACTIVE');END IF;
 PERFORM c.categoria_id FROM pliego.categoria c JOIN(SELECT(e.value::TEXT)::BIGINT category_id FROM jsonb_array_elements(p_category_ids)e(value))req ON req.category_id=c.categoria_id ORDER BY c.categoria_id FOR SHARE OF c;
 IF (SELECT count(*) FROM pliego.categoria c JOIN(SELECT(e.value::TEXT)::BIGINT category_id FROM jsonb_array_elements(p_category_ids)e(value))req ON req.category_id=c.categoria_id)<>v_category_count THEN PERFORM pliego.fn_raise_domain_error('P2021','CATEGORY_NOT_FOUND');END IF;
 IF EXISTS(SELECT 1 FROM pliego.categoria c JOIN(SELECT(e.value::TEXT)::BIGINT category_id FROM jsonb_array_elements(p_category_ids)e(value))req ON req.category_id=c.categoria_id WHERE c.estado<>'ACTIVE' AND NOT EXISTS(SELECT 1 FROM pliego.libro_categoria old WHERE old.libro_id=p_book_id AND old.categoria_id=c.categoria_id)) THEN PERFORM pliego.fn_raise_domain_error('P2022','CATEGORY_INACTIVE');END IF;
 SET CONSTRAINTS uq_libro_autor_orden DEFERRED;DELETE FROM pliego.libro_autor WHERE libro_id=p_book_id;DELETE FROM pliego.libro_categoria WHERE libro_id=p_book_id;
 INSERT INTO pliego.libro_autor(libro_id,autor_id,orden_autoria)SELECT p_book_id,x."authorId",x."order" FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER);
 INSERT INTO pliego.libro_categoria(libro_id,categoria_id)SELECT p_book_id,(e.value::TEXT)::BIGINT FROM jsonb_array_elements(p_category_ids)e(value);
 UPDATE pliego.libro SET titulo=btrim(p_title),subtitulo=NULLIF(btrim(p_subtitle),''),sinopsis=NULLIF(btrim(p_synopsis),'') WHERE libro_id=p_book_id;
 IF v_author_count>0 THEN PERFORM pliego.fn_build_authors_snapshot(p_book_id);END IF;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_book_set_status(IN p_actor_user_id BIGINT,IN p_book_id BIGINT,IN p_new_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_state VARCHAR;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');IF p_new_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');END IF;
 SELECT l.estado INTO v_state FROM pliego.libro l WHERE l.libro_id=p_book_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2031','BOOK_NOT_FOUND');END IF;
 IF p_new_state='ACTIVE' THEN IF NOT EXISTS(SELECT 1 FROM pliego.libro_autor WHERE libro_id=p_book_id) THEN PERFORM pliego.fn_raise_domain_error('P2032','BOOK_REQUIRES_AUTHOR');END IF;IF NOT EXISTS(SELECT 1 FROM pliego.libro_categoria WHERE libro_id=p_book_id) THEN PERFORM pliego.fn_raise_domain_error('P2033','BOOK_REQUIRES_CATEGORY');END IF;END IF;
 IF v_state<>p_new_state THEN UPDATE pliego.libro SET estado=p_new_state WHERE libro_id=p_book_id;END IF;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_edition_create(IN p_actor_user_id BIGINT,IN p_book_id BIGINT,IN p_publisher_id BIGINT,IN p_sku VARCHAR,IN p_isbn13 VARCHAR,IN p_language VARCHAR,IN p_format VARCHAR,IN p_page_count INTEGER,IN p_publication_date DATE,IN p_price NUMERIC,IN p_cover_url VARCHAR,IN p_cover_license VARCHAR,IN p_cover_source_url VARCHAR,IN p_cover_attribution VARCHAR,OUT o_edition_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_sku TEXT;v_isbn TEXT;v_language TEXT;v_pub_state VARCHAR;v_constraint TEXT;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM l.libro_id FROM pliego.libro l WHERE l.libro_id=p_book_id FOR SHARE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2031','BOOK_NOT_FOUND');END IF;
 SELECT e.estado INTO v_pub_state FROM pliego.editorial e WHERE e.editorial_id=p_publisher_id FOR SHARE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2011','PUBLISHER_NOT_FOUND');END IF;IF v_pub_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P2012','PUBLISHER_INACTIVE');END IF;
 v_sku:=pliego.fn_normalize_sku(p_sku);v_isbn:=NULLIF(btrim(p_isbn13),'');v_language:=pliego.fn_normalize_language(p_language);
 IF v_sku IS NULL OR v_sku !~ '^[A-Z0-9][A-Z0-9._-]{0,63}$' OR v_language IS NULL OR v_language !~ '^[a-z]{2,3}$' OR p_format NOT IN('PAPERBACK','HARDCOVER') OR p_page_count IS NULL OR p_page_count NOT BETWEEN 1 AND 100000 OR p_price IS NULL OR p_price<=0 OR p_price>999999999.99 THEN PERFORM pliego.fn_raise_domain_error('P2048','EDITION_DATA_INVALID');END IF;
 IF v_isbn IS NOT NULL AND NOT pliego.fn_is_valid_isbn13(v_isbn) THEN PERFORM pliego.fn_raise_domain_error('P2046','ISBN_INVALID');END IF;
 PERFORM pliego.fn_validate_cover_metadata(NULLIF(btrim(p_cover_url),''),NULLIF(btrim(p_cover_license),''),NULLIF(btrim(p_cover_source_url),''),NULLIF(btrim(p_cover_attribution),''));
 BEGIN INSERT INTO pliego.edicion(libro_id,editorial_id,sku,isbn13,idioma,formato,numero_paginas,fecha_publicacion,precio,portada_url,portada_licencia,portada_fuente_url,portada_atribucion,estado)VALUES(p_book_id,p_publisher_id,v_sku,v_isbn,v_language,p_format,p_page_count,p_publication_date,p_price,NULLIF(btrim(p_cover_url),''),NULLIF(btrim(p_cover_license),''),NULLIF(btrim(p_cover_source_url),''),NULLIF(btrim(p_cover_attribution),''),'ACTIVE')RETURNING edicion_id INTO o_edition_id;
 EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;IF v_constraint='uq_edicion_sku' THEN PERFORM pliego.fn_raise_domain_error('P2044','SKU_ALREADY_EXISTS');ELSIF v_constraint='uq_edicion_isbn' THEN PERFORM pliego.fn_raise_domain_error('P2045','ISBN_ALREADY_EXISTS');END IF;RAISE;END;
 INSERT INTO pliego.inventario(edicion_id,stock_actual,stock_minimo)VALUES(o_edition_id,0,0);
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_edition_update(IN p_actor_user_id BIGINT,IN p_edition_id BIGINT,IN p_publisher_id BIGINT,IN p_isbn13 VARCHAR,IN p_language VARCHAR,IN p_format VARCHAR,IN p_page_count INTEGER,IN p_publication_date DATE,IN p_price NUMERIC,IN p_cover_url VARCHAR,IN p_cover_license VARCHAR,IN p_cover_source_url VARCHAR,IN p_cover_attribution VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_current_pub BIGINT;v_book_id BIGINT;v_pub_state VARCHAR;v_isbn TEXT;v_language TEXT;v_constraint TEXT;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');SELECT e.editorial_id,e.libro_id INTO v_current_pub,v_book_id FROM pliego.edicion e WHERE e.edicion_id=p_edition_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND');END IF;
 PERFORM l.libro_id FROM pliego.libro l WHERE l.libro_id=v_book_id FOR SHARE;SELECT e.estado INTO v_pub_state FROM pliego.editorial e WHERE e.editorial_id=p_publisher_id FOR SHARE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2011','PUBLISHER_NOT_FOUND');END IF;IF p_publisher_id<>v_current_pub AND v_pub_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P2012','PUBLISHER_INACTIVE');END IF;
 v_isbn:=NULLIF(btrim(p_isbn13),'');v_language:=pliego.fn_normalize_language(p_language);IF v_language IS NULL OR v_language !~ '^[a-z]{2,3}$' OR p_format NOT IN('PAPERBACK','HARDCOVER') OR p_page_count IS NULL OR p_page_count NOT BETWEEN 1 AND 100000 OR p_price IS NULL OR p_price<=0 OR p_price>999999999.99 THEN PERFORM pliego.fn_raise_domain_error('P2048','EDITION_DATA_INVALID');END IF;
 IF v_isbn IS NOT NULL AND NOT pliego.fn_is_valid_isbn13(v_isbn) THEN PERFORM pliego.fn_raise_domain_error('P2046','ISBN_INVALID');END IF;PERFORM pliego.fn_validate_cover_metadata(NULLIF(btrim(p_cover_url),''),NULLIF(btrim(p_cover_license),''),NULLIF(btrim(p_cover_source_url),''),NULLIF(btrim(p_cover_attribution),''));
 BEGIN UPDATE pliego.edicion SET editorial_id=p_publisher_id,isbn13=v_isbn,idioma=v_language,formato=p_format,numero_paginas=p_page_count,fecha_publicacion=p_publication_date,precio=p_price,portada_url=NULLIF(btrim(p_cover_url),''),portada_licencia=NULLIF(btrim(p_cover_license),''),portada_fuente_url=NULLIF(btrim(p_cover_source_url),''),portada_atribucion=NULLIF(btrim(p_cover_attribution),'') WHERE edicion_id=p_edition_id;
 EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;IF v_constraint='uq_edicion_isbn' THEN PERFORM pliego.fn_raise_domain_error('P2045','ISBN_ALREADY_EXISTS');ELSIF v_constraint='uq_edicion_sku' THEN PERFORM pliego.fn_raise_domain_error('P2044','SKU_ALREADY_EXISTS');END IF;RAISE;END;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_edition_set_status(IN p_actor_user_id BIGINT,IN p_edition_id BIGINT,IN p_new_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_state VARCHAR;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');IF p_new_state NOT IN('ACTIVE','INACTIVE') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');END IF;SELECT e.estado INTO v_state FROM pliego.edicion e WHERE e.edicion_id=p_edition_id FOR UPDATE;IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND');END IF;IF v_state<>p_new_state THEN UPDATE pliego.edicion SET estado=p_new_state WHERE edicion_id=p_edition_id;END IF;
END;$$;
