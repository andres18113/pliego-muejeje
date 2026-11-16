-- Synthetic fixture ONLY for the explicitly disposable localhost benchmark DB.
-- Uses approved Database API commands. Never run against an existing dataset.
-- Each entity commits separately, matching short command transactions and avoiding
-- a fixture-only transaction with thousands of nested subtransactions. A failed
-- partial seed is retained for diagnosis; discard this unique cluster, never resume.
\set ON_ERROR_STOP on
\if :{?benchmark_port}
\else
 \set benchmark_port 55464
\endif
SET pliego.fixture_port = :'benchmark_port';
DO $safety$
BEGIN
 IF current_database()<>'pliego_benchmark' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('pliego.fixture_port') NOT IN ('55464','55465','55466','55467','55468')
    OR current_setting('port') IS DISTINCT FROM current_setting('pliego.fixture_port') OR current_setting('server_version_num')::integer NOT BETWEEN 180000 AND 189999
 THEN RAISE EXCEPTION 'Refusing fixture outside explicitly selected isolated PG18 localhost benchmark'; END IF;
 IF EXISTS(SELECT FROM pliego.libro) OR EXISTS(SELECT FROM pliego.usuario WHERE rol='CUSTOMER')
 THEN RAISE EXCEPTION 'Refusing fixture over populated database'; END IF;
END $safety$;
DO $fixture$
DECLARE
 admin_id bigint; authors bigint[]='{}'; publishers bigint[]='{}'; categories bigint[]='{}';
 author_id bigint; publisher_id bigint; category_id bigint; book_id bigint; edition_id bigint;
 movement_id bigint; before_stock integer; after_stock integer; offer_id bigint;
 user_id bigint; customer_id bigint; user_state varchar; address_id bigint;
 author_json jsonb; i integer;
 -- Public, synthetic shared password: PerfLocal2026! (BCrypt cost 12).
 password_hash varchar := '$2b$12$9uJQWhxbzpU0x/jebYy0x.c6lfLCNwtDWzYc6z4EpgE09ORsJU0nq';
BEGIN
 SELECT min(usuario_id) INTO admin_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE';
 IF admin_id IS NULL THEN RAISE EXCEPTION 'Run approved Flyway migrations first'; END IF;
 FOR i IN 1..545 LOOP
  CALL pliego.sp_author_create(admin_id,('Autora Sintética '||lpad(i::text,4,'0'))::varchar,NULL,author_id);
  authors:=array_append(authors,author_id);
  COMMIT;
 END LOOP;
 FOR i IN 1..172 LOOP
  CALL pliego.sp_publisher_create(admin_id,('Editorial Local '||lpad(i::text,3,'0'))::varchar,NULL,publisher_id);
  publishers:=array_append(publishers,publisher_id);
  COMMIT;
 END LOOP;
 FOR i IN 1..12 LOOP
  CALL pliego.sp_category_create(admin_id,('Categoría '||i)::varchar,('perf-category-'||i)::varchar,NULL,NULL,category_id);
  categories:=array_append(categories,category_id);
  COMMIT;
 END LOOP;
 FOR i IN 1..425 LOOP
  author_json:=jsonb_build_array(jsonb_build_object('authorId',authors[i],'order',1));
  IF i<=152 THEN
   author_json:=author_json||jsonb_build_array(jsonb_build_object('authorId',authors[426+((i-1)%120)],'order',2));
  END IF;
  CALL pliego.sp_book_create(admin_id,('Libro Local '||lpad(i::text,4,'0')||CASE WHEN i%5=0 THEN ' García Ciencia' ELSE ' Lectura Novela' END)::varchar,
   NULL,'Contenido enteramente sintético para evaluar el catálogo local.',author_json,
   jsonb_build_array(categories[1+((i-1)%12)]),book_id);
  IF i<=424 THEN
   CALL pliego.sp_edition_create(admin_id,book_id,publishers[1+((i-1)%172)],('PERF-'||lpad(i::text,4,'0'))::varchar,NULL,
    (CASE WHEN i%7=0 THEN 'en' ELSE 'es' END)::varchar,
    (CASE WHEN i<=175 THEN CASE WHEN i%4=0 THEN 'HARDCOVER' ELSE 'PAPERBACK' END ELSE 'EBOOK' END)::varchar,
    100+(i%400),DATE '2025-01-01',(10+(i%40))::numeric,NULL,NULL,NULL,NULL,
    (CASE WHEN i>175 THEN 'EPUB' ELSE NULL END)::varchar,NULL,ARRAY[]::text[],edition_id);
   IF i<=175 THEN
    CALL pliego.sp_inventory_entry(admin_id,edition_id,10000,'Fixture local desechable',movement_id,before_stock,after_stock);
   END IF;
   IF i<=44 THEN
    CALL pliego.sp_edition_offer_set(admin_id,edition_id,(5+(i%5))::numeric,
     statement_timestamp()-interval '1 day',
     statement_timestamp()+(CASE WHEN i<=21 THEN interval '30 days' ELSE interval '60 days' END),
     'Oferta sintética',NULL,offer_id);
    IF i>21 THEN CALL pliego.sp_edition_offer_clear(admin_id,edition_id); END IF;
   END IF;
  END IF;
  COMMIT;
 END LOOP;
 FOR i IN 1..160 LOOP
  CALL pliego.sp_customer_register(('perf-customer-'||lpad(i::text,3,'0')||'@example.invalid')::varchar,password_hash,
   'Cliente Sintético','Prueba Local','+593999999999',user_id,customer_id,user_state);
  -- Fixture-only verification avoids an external mailbox. No token or real credential exists.
  UPDATE pliego.usuario SET email_verificado_en=statement_timestamp() WHERE usuario_id=user_id;
  CALL pliego.sp_address_create(user_id,'Casa','Cliente Sintético','Calle Local 1',NULL,
   'Quito','Pichincha','EC',NULL,NULL,'+593999999999',true,address_id);
  COMMIT;
 END LOOP;
END $fixture$;
ANALYZE pliego.autor;
ANALYZE pliego.editorial;
ANALYZE pliego.categoria;
ANALYZE pliego.libro;
ANALYZE pliego.libro_autor;
ANALYZE pliego.libro_categoria;
ANALYZE pliego.edicion;
ANALYZE pliego.inventario;
ANALYZE pliego.edicion_oferta;
ANALYZE pliego.usuario;
ANALYZE pliego.cliente;
ANALYZE pliego.direccion;
SELECT jsonb_build_object(
 'books',(SELECT count(*) FROM pliego.libro),
 'editions',(SELECT count(*) FROM pliego.edicion),
 'authors',(SELECT count(*) FROM pliego.autor),
 'authorLinks',(SELECT count(*) FROM pliego.libro_autor),
 'publishers',(SELECT count(*) FROM pliego.editorial),
 'inventory',(SELECT count(*) FROM pliego.inventario),
 'offers',(SELECT count(*) FROM pliego.edicion_oferta),
 'activeOffers',(SELECT count(*) FROM pliego.edicion_oferta WHERE estado='ACTIVE'),
 'customers',(SELECT count(*) FROM pliego.cliente),
 'issuedInvoices',(SELECT count(*) FROM pliego.factura WHERE estado='ISSUED'),
 'approvedPayments',(SELECT count(*) FROM pliego.pago WHERE estado='APPROVED'));
