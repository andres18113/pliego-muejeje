-- I12 fix: SET CONSTRAINTS with an unqualified name cannot resolve the table
-- constraint while search_path excludes the pliego schema, so every
-- sp_book_update call failed with 42704. SET CONSTRAINTS ALL DEFERRED keeps
-- the approved intent: uq_libro_autor_orden is the only DEFERRABLE constraint
-- in the schema, so exactly that constraint is deferred to COMMIT.
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
 SET CONSTRAINTS ALL DEFERRED;DELETE FROM pliego.libro_autor WHERE libro_id=p_book_id;DELETE FROM pliego.libro_categoria WHERE libro_id=p_book_id;
 INSERT INTO pliego.libro_autor(libro_id,autor_id,orden_autoria)SELECT p_book_id,x."authorId",x."order" FROM jsonb_to_recordset(p_authors)AS x("authorId" BIGINT,"order" INTEGER);
 INSERT INTO pliego.libro_categoria(libro_id,categoria_id)SELECT p_book_id,(e.value::TEXT)::BIGINT FROM jsonb_array_elements(p_category_ids)e(value);
 UPDATE pliego.libro SET titulo=btrim(p_title),subtitulo=NULLIF(btrim(p_subtitle),''),sinopsis=NULLIF(btrim(p_synopsis),'') WHERE libro_id=p_book_id;
 IF v_author_count>0 THEN PERFORM pliego.fn_build_authors_snapshot(p_book_id);END IF;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
END;$$;
