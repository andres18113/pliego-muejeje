-- PostgreSQL 18, Flyway through V046. All fixtures roll back.
BEGIN;
CREATE FUNCTION pg_temp.purchase(p_customer BIGINT,p_edition BIGINT,p_at TIMESTAMPTZ,p_quantity INTEGER DEFAULT 1,
 p_payment VARCHAR DEFAULT 'APPROVED',p_order_state VARCHAR DEFAULT 'CONFIRMED') RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE o BIGINT; e RECORD;
BEGIN
 SELECT * INTO e FROM pliego.edicion WHERE edicion_id=p_edition;
 INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total,fecha_creacion)
 VALUES(p_customer,p_order_state,10*p_quantity,10*p_quantity,p_at) RETURNING pedido_id INTO o;
 INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,isbn_snapshot,titulo_snapshot,autores_snapshot,
 editorial_snapshot,formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
 VALUES(o,e.edicion_id,e.sku,e.isbn13,'Compra de prueba','Autora de prueba','Editorial de prueba',e.formato,e.idioma,10,p_quantity,10*p_quantity);
 INSERT INTO pliego.pedido_estado_historial(pedido_id,origen,estado_anterior,estado_nuevo,fecha)
 VALUES(o,'SYSTEM','PENDING_PAYMENT','CONFIRMED',p_at);
 INSERT INTO pliego.pago(pedido_id,metodo,estado,monto,referencia)
 VALUES(o,'TRANSFER',p_payment,10*p_quantity,CASE WHEN p_payment IN('APPROVED','REFUNDED') THEN 'NAV-'||o END);
 RETURN o;
END $$;
DO $gate$
DECLARE a BIGINT; author_id BIGINT; publisher BIGINT; category BIGINT; hidden BIGINT; hidden_child BIGINT;
 book BIGINT; other_book BIGINT; paperback BIGINT; hardcover BIGINT; ebook BIGINT; recent1 BIGINT; recent2 BIGINT;
 recent3 BIGINT; audio BIGINT; hidden_edition BIGINT; user_id BIGINT; customer BIGINT; state VARCHAR; movement BIGINT;
 before_stock INTEGER; after_stock INTEGER; o BIGINT; offer BIGINT; nav JSONB; section JSONB; first_id BIGINT;
 c BIGINT; ids BIGINT[]; draft_category BIGINT;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('nav-help-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
 CALL pliego.sp_author_create(a,'Autora navegación',NULL,author_id);
 CALL pliego.sp_publisher_create(a,'Editorial navegación',NULL,publisher);
 CALL pliego.sp_category_create(a,'Navegación','nav-help',NULL,NULL,category);
 CALL pliego.sp_category_create(a,'Oculta','nav-hidden',NULL,NULL,hidden);
 CALL pliego.sp_category_create(a,'Hija oculta','nav-hidden-child',NULL,hidden,hidden_child);
 CALL pliego.sp_book_create(a,'Obra navegación',NULL,NULL,jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category),book);
 CALL pliego.sp_book_create(a,'Obra oculta navegación',NULL,NULL,jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(hidden_child),other_book);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-PAPER',NULL,'es','PAPERBACK',100,NULL,10,NULL,NULL,NULL,NULL,paperback);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-HARD',NULL,'es','HARDCOVER',100,NULL,10,NULL,NULL,NULL,NULL,hardcover);
 CALL pliego.sp_inventory_entry(a,paperback,10,'fixture',movement,before_stock,after_stock);
 CALL pliego.sp_inventory_entry(a,hardcover,10,'fixture',movement,before_stock,after_stock);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-EBOOK',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],ebook);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-RECENT1',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,'PDF',NULL,ARRAY[]::TEXT[],recent1);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-RECENT2',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL,recent2);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-RECENT3',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL,recent3);
 CALL pliego.sp_edition_create(a,book,publisher,'NAV-AUDIO',NULL,'es','AUDIOBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Una voz'],audio);
 CALL pliego.sp_edition_create(a,other_book,publisher,'NAV-HIDDEN',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL,hidden_edition);
 CALL pliego.sp_category_set_status(a,hidden,'INACTIVE');
 UPDATE pliego.edicion SET fecha_creacion=statement_timestamp()-INTERVAL '4 days' WHERE edicion_id=ebook;
 UPDATE pliego.edicion SET fecha_creacion=statement_timestamp()-INTERVAL '3 days' WHERE edicion_id=recent1;
 UPDATE pliego.edicion SET fecha_creacion=statement_timestamp()-INTERVAL '2 days' WHERE edicion_id=recent2;
 UPDATE pliego.edicion SET fecha_creacion=statement_timestamp()-INTERVAL '1 day' WHERE edicion_id=recent3;
 CALL pliego.sp_customer_register('nav-help-customer@example.invalid','fixture','Ana','Pérez',NULL,user_id,customer,state);
 PERFORM pg_temp.purchase(customer,paperback,statement_timestamp()-INTERVAL '2 days',3);
 PERFORM pg_temp.purchase(customer,hardcover,statement_timestamp()-INTERVAL '1 day',1);
 o:=pg_temp.purchase(customer,ebook,statement_timestamp()-INTERVAL '30 days');
 -- Later physical lifecycle/payment timestamp changes do not move the sale timestamp.
 UPDATE pliego.pago SET fecha_actualizacion=statement_timestamp()+INTERVAL '100 days' WHERE pedido_id=o;
 PERFORM pg_temp.purchase(customer,recent1,statement_timestamp()-INTERVAL '31 days');
 PERFORM pg_temp.purchase(customer,recent2,statement_timestamp()+INTERVAL '1 day');
 PERFORM pg_temp.purchase(customer,recent3,statement_timestamp()-INTERVAL '1 day',1,'REJECTED','CANCELLED');
 PERFORM pg_temp.purchase(customer,recent3,statement_timestamp()-INTERVAL '1 day',1,'REFUNDED','CANCELLED');
 PERFORM pg_temp.purchase(customer,audio,statement_timestamp()-INTERVAL '1 day');
 IF (SELECT units FROM pliego.fn_catalog_sales_30d() WHERE edition_id=ebook)<>1
  OR EXISTS(SELECT 1 FROM pliego.fn_catalog_sales_30d() WHERE edition_id IN(recent1,recent2,recent3)) THEN
  RAISE EXCEPTION '30-day ranking included stale/future/rejected/refunded or omitted boundary sale'; END IF;
 SELECT edition_id INTO first_id FROM pliego.fn_catalog_search(NULL,NULL,NULL,'nav-help',NULL,NULL,NULL,NULL,'BEST_SELLING',0,20,'PHYSICAL') LIMIT 1;
 IF first_id<>paperback OR (SELECT count(*) FROM pliego.fn_catalog_search(NULL,NULL,NULL,'nav-help',NULL,NULL,NULL,NULL,'BEST_SELLING',0,20,'PHYSICAL'))<>2 THEN
  RAISE EXCEPTION 'Physical bestseller ranking/filter incorrect'; END IF;
 SELECT array_agg(edition_id) INTO ids FROM pliego.fn_catalog_search_global('Obra navegación','nav-help',NULL,NULL,NULL,NULL,'BEST_SELLING',0,20,'EBOOK');
 IF ids<>ARRAY[ebook,recent3,recent2,recent1] THEN RAISE EXCEPTION 'eBook ranking/fallback incorrect: %',ids; END IF;
 IF (SELECT count(*) FROM pliego.fn_catalog_search(NULL,NULL,NULL,'nav-help',NULL,NULL,NULL,NULL,'BEST_SELLING',0,20,'AUDIOBOOK'))<>1 THEN
  RAISE EXCEPTION 'Audiobook scope incorrect'; END IF;
 CALL pliego.sp_edition_offer_set(a,ebook,8,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '1 day',offer);
 nav:=pliego.fn_storefront_navigation();
 IF jsonb_array_length(nav->'sections')<>5 OR nav->'sections'->0->>'label'<>'Libros'
  OR nav->'sections'->2->>'label'<>'Audiolibros' OR nav->'sections'->4->>'href'<>'/ayuda' THEN
  RAISE EXCEPTION 'Storefront section contract incorrect'; END IF;
 SELECT value INTO section FROM jsonb_array_elements(nav->'sections') WHERE value->>'key'='EBOOK';
 SELECT array_agg((value->>'editionId')::BIGINT) INTO ids FROM jsonb_array_elements(section->'featured');
 IF ids<>ARRAY[ebook,recent3,recent2] OR section->>'bestSellingHref'<>'/catalog?productType=EBOOK&sort=BEST_SELLING'
  OR (section->>'activeOfferCount')::BIGINT<1 OR section->'featured'->0->>'price'<>'8.00'
  OR section->'featured'->0->'offer'->>'offerId'<>offer::TEXT THEN RAISE EXCEPTION 'Featured fallback/offer contract incorrect: %',section; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(section->'categories') value WHERE value->>'slug' IN('nav-hidden','nav-hidden-child'))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(section->'featured') value WHERE value->>'editionId'=hidden_edition::TEXT) THEN
  RAISE EXCEPTION 'Inactive category ancestor leaked'; END IF;
 UPDATE pliego.edicion SET estado='INACTIVE' WHERE edicion_id=recent3;
 nav:=pliego.fn_storefront_navigation();
 SELECT value INTO section FROM jsonb_array_elements(nav->'sections') WHERE value->>'key'='EBOOK';
 SELECT array_agg((value->>'editionId')::BIGINT) INTO ids FROM jsonb_array_elements(section->'featured');
 IF ids<>ARRAY[ebook,recent2,recent1] THEN RAISE EXCEPTION 'Inactive edition leaked into featured'; END IF;
 -- Published Help filters on both category and article, with literal substring search and applicability.
 INSERT INTO pliego.ayuda_categoria(slug,titulo,estado) VALUES('draft-help','Oculto','DRAFT') RETURNING categoria_id INTO draft_category;
 INSERT INTO pliego.ayuda_articulo(categoria_id,slug,titulo,resumen,cuerpo,estado)
 VALUES(draft_category,'hidden-published','Hidden','Hidden','Hidden','PUBLISHED');
 SELECT categoria_id INTO c FROM pliego.ayuda_categoria WHERE slug='ebooks';
 INSERT INTO pliego.ayuda_articulo(categoria_id,slug,titulo,resumen,cuerpo,estado)
 VALUES(c,'draft-ebook','Hidden','Hidden','Hidden','DRAFT');
 IF EXISTS(SELECT 1 FROM pliego.fn_help_categories() WHERE slug='draft-help')
  OR EXISTS(SELECT 1 FROM pliego.fn_help_search('Hidden',NULL,NULL,0,20))
  OR EXISTS(SELECT 1 FROM pliego.fn_help_article('draft-ebook'))
  OR EXISTS(SELECT 1 FROM pliego.fn_help_article('hidden-published')) THEN RAISE EXCEPTION 'Unpublished Help leaked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pliego.fn_help_search('simulación académica','ebooks','EBOOK',0,20) WHERE slug='ebooks')
  OR NOT EXISTS(SELECT 1 FROM pliego.fn_help_search(NULL,NULL,'EBOOK',0,20) WHERE slug='pagos')
  OR EXISTS(SELECT 1 FROM pliego.fn_help_search(NULL,NULL,'EBOOK',0,20) WHERE applicability IN('PHYSICAL','AUDIOBOOK')) THEN
  RAISE EXCEPTION 'Help search/applicability incorrect'; END IF;
 UPDATE pliego.ayuda_categoria SET estado='DRAFT' WHERE slug='ebooks';
 IF EXISTS(SELECT 1 FROM pliego.fn_help_article('ebooks')) THEN RAISE EXCEPTION 'Unpublished parent category leaked article'; END IF;
END $gate$;
ROLLBACK;
