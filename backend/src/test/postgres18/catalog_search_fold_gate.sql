-- Public/admin catalog matching; rollback all fixtures. Ordering remains V069.
BEGIN;
DO $gate$
DECLARE admin BIGINT; author BIGINT; publisher BIGINT; category BIGINT; book BIGINT;
 offer BIGINT; edition BIGINT; movement BIGINT; before_stock INTEGER; after_stock INTEGER; physical BIGINT; media TEXT; q TEXT; n BIGINT; ids BIGINT[]; paged BIGINT[];
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('fold-gate@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO admin;
 CALL pliego.sp_author_create(admin,'Ángela Muñoz Peña',NULL,author);
 CALL pliego.sp_publisher_create(admin,'Edición Ñandú',NULL,publisher);
 CALL pliego.sp_category_create(admin,'Niñez única','fold-gate',NULL,NULL,category);
 CALL pliego.sp_book_create(admin,'Cómo comportarse en la multitud',NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author,'order',1)),jsonb_build_array(category),book);
 FOREACH media IN ARRAY ARRAY['PAPERBACK','EBOOK','AUDIOBOOK'] LOOP
  CALL pliego.sp_edition_create(admin,book,publisher,('FOLD-'||media)::VARCHAR,CASE WHEN media='PAPERBACK' THEN '9780000000309'::VARCHAR END,'es',media::VARCHAR,
   CASE WHEN media='PAPERBACK' THEN 100 END,NULL,10,NULL,NULL,NULL,NULL,
   CASE WHEN media='EBOOK' THEN 'EPUB'::VARCHAR END,CASE WHEN media='AUDIOBOOK' THEN 3600 END,
   CASE WHEN media='AUDIOBOOK' THEN ARRAY['Voz'] ELSE ARRAY[]::TEXT[] END,edition);
  IF media='PAPERBACK' THEN physical:=edition; CALL pliego.sp_inventory_entry(admin,edition,5,'fold fixture',movement,before_stock,after_stock); END IF;
  CALL pliego.sp_edition_offer_set(admin,edition,9,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '1 day',offer);
 END LOOP;
 FOREACH q IN ARRAY ARRAY['como','COMO','CÓMO','Cómo',U&'Co\0301mo','angela','ÁNGELA','munoz','peña','pena'] LOOP
  SELECT count(*) INTO n FROM pliego.fn_catalog_search_global(q::VARCHAR,'fold-gate',NULL,NULL,NULL,NULL,'TITLE_ASC',0,50);
  IF n<>3 THEN RAISE EXCEPTION 'fold global query %: expected 3 formats, got %',q,n; END IF;
 END LOOP;
 -- Both public overloads, independent title/author filters, product scope and counts.
 SELECT array_agg(edition_id ORDER BY edition_id) INTO ids FROM pliego.fn_catalog_search('como','angela',NULL,'fold-gate',NULL,NULL,NULL,NULL,'TITLE_ASC',0,50);
 IF cardinality(ids)<>3 THEN RAISE EXCEPTION 'Independent title/author matching failed'; END IF;
 SELECT array_agg(edition_id ORDER BY edition_id) INTO paged FROM (
  SELECT edition_id FROM pliego.fn_catalog_search_global('como','fold-gate',NULL,NULL,NULL,NULL,'TITLE_ASC',0,1)
  UNION ALL SELECT edition_id FROM pliego.fn_catalog_search_global('como','fold-gate',NULL,NULL,NULL,NULL,'TITLE_ASC',1,1)
  UNION ALL SELECT edition_id FROM pliego.fn_catalog_search_global('como','fold-gate',NULL,NULL,NULL,NULL,'TITLE_ASC',2,1)) s;
 IF ids IS DISTINCT FROM paged THEN RAISE EXCEPTION 'Pagination drift'; END IF;
 SELECT count(*) INTO n FROM pliego.fn_catalog_search_global('como','fold-gate',9,9,'es','AUDIOBOOK','TITLE_ASC',0,50,'AUDIOBOOK');
 IF n<>1 THEN RAISE EXCEPTION 'Scope/format/price/language filters changed'; END IF;
 SELECT count(*) INTO n FROM pliego.fn_catalog_search('como','munoz',NULL,'fold-gate',NULL,NULL,NULL,NULL,'TITLE_DESC',0,50,'EBOOK');
 IF n<>1 THEN RAISE EXCEPTION 'Scoped title/author failed'; END IF;
 SELECT count(*) INTO n FROM pliego.fn_catalog_search_global('como','fold-gate',11,NULL,NULL,NULL,'TITLE_ASC',0,50);
 IF n<>0 THEN RAISE EXCEPTION 'Price exclusion failed'; END IF;
 -- Both legacy offer search variants keep their relevance and offer filtering.
 IF (SELECT count(*) FROM pliego.fn_catalog_search_offers('como','munoz',NULL,'fold-gate',NULL,NULL,NULL,NULL,NULL,'RELEVANCE',0,50))<>3
 OR (SELECT count(*) FROM pliego.fn_catalog_search_global_offers('COMO','fold-gate',NULL,NULL,NULL,NULL,'TITLE_ASC',0,50))<>3
 THEN RAISE EXCEPTION 'Offer matching failed'; END IF;
 IF (SELECT count(*) FROM pliego.fn_catalog_search_global('978-000-000-0309','fold-gate',NULL,NULL,NULL,NULL,'TITLE_ASC',0,50))<>1
 OR (SELECT count(*) FROM pliego.fn_admin_edition_search(admin,'fold-paperback',NULL,book,0,50,NULL))<>1
 OR (SELECT count(*) FROM pliego.fn_admin_edition_search(admin,'9780000000309',NULL,book,0,50,NULL))<>1
 THEN RAISE EXCEPTION 'Existing ISBN/SKU matching regressed'; END IF;
 -- Admin fields already searched: names, slug, title/author, SKU and ISBN.
 IF (SELECT count(*) FROM pliego.fn_admin_author_search(admin,'angela munoz pena',NULL,0,50))<>1
 OR (SELECT count(*) FROM pliego.fn_admin_publisher_search(admin,'edicion nandu',NULL,0,50))<>1
 OR (SELECT count(*) FROM pliego.fn_admin_category_search(admin,'ninez unica',NULL,0,50))<>1
 OR (SELECT count(*) FROM pliego.fn_admin_category_search(admin,'fold-gate',NULL,0,50))<>1
 OR (SELECT count(*) FROM pliego.fn_admin_book_search(admin,'angela',NULL,0,50))<>1
 OR (SELECT count(*) FROM pliego.fn_admin_book_search(admin,'como',NULL,0,50))<>1
 OR (SELECT count(*) FROM pliego.fn_admin_edition_search(admin,'como',NULL,book,0,50,NULL))<>3
 OR (SELECT count(*) FROM pliego.fn_inventory_search(admin,physical,'como',NULL,FALSE,0,50))<>1
 THEN RAISE EXCEPTION 'Admin/inventory accent matching failed'; END IF;
 -- Accented query must also find an unaccented stored title.
 UPDATE pliego.libro SET titulo='Como nino' WHERE libro_id=book;
 IF (SELECT count(*) FROM pliego.fn_catalog_search_global('CÓMO NIÑO','fold-gate',NULL,NULL,NULL,NULL,'TITLE_ASC',0,50))<>3
 THEN RAISE EXCEPTION 'Reverse accent/enye matching failed'; END IF;
 IF pliego.fn_search_fold(NULL) IS NOT NULL OR pliego.fn_search_fold('')<>''
 OR pliego.fn_search_fold('ÁÉÍÓÚÜÑ àâäãå ç èêë ìîï òôöõ ùû ýÿ')<>'aeiouun aaaaa c eee iii oooo uu yy'
 THEN RAISE EXCEPTION 'Fold character/null contract failed'; END IF;
END $gate$;
ROLLBACK;
