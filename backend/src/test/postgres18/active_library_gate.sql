-- V101: customer library scope, pagination and type counts derive only from ACTIVE grants.
BEGIN;
CREATE FUNCTION pg_temp.acquire_library_item(p_actor BIGINT,p_edition BIGINT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE cart BIGINT; item BIGINT; quantity INTEGER; purchase BIGINT; order_state VARCHAR;
 payment_state VARCHAR; total NUMERIC; reference VARCHAR;
BEGIN
 CALL pliego.sp_cart_add_item(p_actor,p_edition,1,cart,item,quantity);
 CALL pliego.sp_checkout(p_actor,NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,purchase,order_state,payment_state,total,reference);
 RETURN purchase;
END; $$;
DO $gate$
DECLARE admin BIGINT; author_id BIGINT; publisher_id BIGINT; category_id BIGINT; book BIGINT;
 ebook BIGINT; removed_ebook BIGINT; audio BIGINT; actor BIGINT; customer BIGINT; other BIGINT; other_customer BIGINT;
 state VARCHAR; purchase BIGINT; cancelled BIGINT; previous VARCHAR; order_state VARCHAR; payment_state VARCHAR;
 restored BIGINT; removed_owned BIGINT; first_owned BIGINT; second_owned BIGINT; before_history JSONB; after_history JSONB;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('active-library-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO admin;
 CALL pliego.sp_author_create(admin,'Autora Biblioteca Activa',NULL,author_id);
 CALL pliego.sp_publisher_create(admin,'Editorial Biblioteca Activa',NULL,publisher_id);
 CALL pliego.sp_category_create(admin,'Biblioteca Activa','active-library-gate',NULL,NULL,category_id);
 CALL pliego.sp_book_create(admin,'Biblioteca Activa',NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category_id),book);
 CALL pliego.sp_edition_create(admin,book,publisher_id,'ACTIVE-LIB-EPUB',NULL,'es','EBOOK',120,NULL,10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],ebook);
 CALL pliego.sp_edition_create(admin,book,publisher_id,'ACTIVE-LIB-PDF',NULL,'es','EBOOK',120,NULL,11,NULL,NULL,NULL,NULL,'PDF',NULL,ARRAY[]::TEXT[],removed_ebook);
 CALL pliego.sp_edition_create(admin,book,publisher_id,'ACTIVE-LIB-AUDIO',NULL,'es','AUDIOBOOK',NULL,NULL,15,NULL,NULL,NULL,NULL,NULL,3600,ARRAY['Voz'],audio);
 CALL pliego.sp_customer_register('active-library-owner@example.invalid','fixture','Cliente','Biblioteca',NULL,actor,customer,state);
 CALL pliego.sp_customer_register('active-library-other@example.invalid','fixture','Otro','Cliente',NULL,other,other_customer,state);
 PERFORM pg_temp.acquire_library_item(actor,ebook);
 purchase:=pg_temp.acquire_library_item(actor,removed_ebook);
 PERFORM pg_temp.acquire_library_item(actor,audio);
 SELECT owned_item_id INTO removed_owned FROM pliego.digital_ownership WHERE cliente_id=customer AND edicion_id=removed_ebook;
 CALL pliego.sp_order_cancel(actor,purchase,cancelled,previous,order_state,payment_state,restored);
 SELECT jsonb_build_object('grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY pedido_item_id) FROM pliego.digital_grant g
   JOIN pliego.digital_ownership o USING(owned_item_id) WHERE o.cliente_id=customer),
  'orders',(SELECT jsonb_agg(to_jsonb(p) ORDER BY pedido_id) FROM pliego.pedido p WHERE cliente_id=customer)) INTO before_history;
 UPDATE pliego.edicion SET estado='INACTIVE' WHERE edicion_id=audio;
 IF (SELECT count(*) FROM pliego.fn_customer_library(actor,NULL,0,50))<>2
  OR EXISTS(SELECT FROM pliego.fn_customer_library(actor,NULL,0,50) WHERE total_count<>2 OR item->>'ownershipState'<>'OWNED')
  OR (SELECT count(*) FROM pliego.fn_customer_library(actor,'EBOOK',0,50))<>1
  OR (SELECT total_count FROM pliego.fn_customer_library(actor,'EBOOK',0,50))<>1
  OR (SELECT count(*) FROM pliego.fn_customer_library(actor,'AUDIOBOOK',0,50))<>1
  OR (SELECT total_count FROM pliego.fn_customer_library(actor,'AUDIOBOOK',0,50))<>1 THEN
  RAISE EXCEPTION 'library scope/type counts include revoked or exclude active inactive-catalog acquisitions'; END IF;
 SELECT owned_item_id INTO first_owned FROM pliego.fn_customer_library(actor,NULL,0,1);
 SELECT owned_item_id INTO second_owned FROM pliego.fn_customer_library(actor,NULL,1,1);
 IF first_owned=second_owned OR first_owned IS NULL OR second_owned IS NULL
  OR EXISTS(SELECT FROM pliego.fn_customer_library(actor,NULL,2,1))
  OR EXISTS(SELECT FROM pliego.fn_customer_library(other,NULL,0,50))
  OR (SELECT item->>'editionId' FROM pliego.fn_customer_library(actor,NULL,0,1))<>audio::TEXT
  OR (SELECT item->>'editionId' FROM pliego.fn_customer_library(actor,NULL,1,1))<>ebook::TEXT THEN
  RAISE EXCEPTION 'pagination, empty customer or acquisition ordering changed'; END IF;
 BEGIN PERFORM pliego.fn_customer_library_detail(actor,removed_owned); RAISE EXCEPTION 'revoked detail exposed'; EXCEPTION WHEN SQLSTATE 'P6001' THEN NULL; END;
 BEGIN PERFORM pliego.fn_customer_library_detail(actor,9223372036854775807); RAISE EXCEPTION 'unknown detail exposed'; EXCEPTION WHEN SQLSTATE 'P6001' THEN NULL; END;
 BEGIN PERFORM pliego.fn_customer_library_detail(other,first_owned); RAISE EXCEPTION 'foreign detail exposed'; EXCEPTION WHEN SQLSTATE 'P6001' THEN NULL; END;
 SELECT jsonb_build_object('grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY pedido_item_id) FROM pliego.digital_grant g
   JOIN pliego.digital_ownership o USING(owned_item_id) WHERE o.cliente_id=customer),
  'orders',(SELECT jsonb_agg(to_jsonb(p) ORDER BY pedido_id) FROM pliego.pedido p WHERE cliente_id=customer)) INTO after_history;
 IF before_history IS DISTINCT FROM after_history OR (SELECT count(*) FROM pliego.digital_ownership WHERE cliente_id=customer)<>3
  OR (SELECT grantState FROM (SELECT pliego.fn_library_item(removed_owned)#>>'{sourcePurchases,0,grantState}' AS grantState) g)<>'REVOKED' THEN
  RAISE EXCEPTION 'customer projections deleted or rewrote commercial/grant history'; END IF;
END; $gate$;
ROLLBACK;
\echo 'Active library gate passed: owned-only lists/type counts/pagination, equivalent detail404, retained immutable purchase history.'
