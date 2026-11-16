\set ON_ERROR_STOP on
BEGIN;
DO $gate$
DECLARE actor BIGINT; customer BIGINT; edition BIGINT; author_id BIGINT; publisher BIGINT;
 book BIGINT; ignored BIGINT; category BIGINT;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('campaign-gate-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO actor;
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('campaign-gate-customer@example.invalid','fixture','CUSTOMER','ACTIVE') RETURNING usuario_id INTO customer;
 CALL pliego.sp_author_create(actor,'Autora campaña',NULL,author_id);
 CALL pliego.sp_publisher_create(actor,'Editorial campaña',NULL,publisher);
 CALL pliego.sp_category_create(actor,'Campaña','campaign-sql-gate',NULL,NULL,category);
 CALL pliego.sp_book_create(actor,'Libro campaña',NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category),book);
 CALL pliego.sp_edition_create(actor,book,publisher,'CAMPAIGN-GATE',NULL,'es','EBOOK',NULL,NULL,
  20.00,'https://covers.pliegolibros.com/covers/fixture.webp',NULL,NULL,NULL,NULL,NULL,NULL,edition);
 IF pliego.fn_admin_edition_offer_row_exists(actor,edition) THEN RAISE EXCEPTION 'Absent offer row reported present'; END IF;
 UPDATE pliego.libro SET estado='INACTIVE' WHERE libro_id=book;
 BEGIN
  CALL pliego.sp_edition_offer_create_if_absent(actor,edition,20.00,'NONE','*',16.00,statement_timestamp(),statement_timestamp()+INTERVAL '3 days',NULL,NULL,ignored);
  RAISE EXCEPTION 'Inactive book accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 UPDATE pliego.libro SET estado='ACTIVE' WHERE libro_id=book;
 UPDATE pliego.edicion SET portada_url=NULL WHERE edicion_id=edition;
 BEGIN
  CALL pliego.sp_edition_offer_create_if_absent(actor,edition,20.00,'NONE','*',16.00,statement_timestamp(),statement_timestamp()+INTERVAL '3 days',NULL,NULL,ignored);
  RAISE EXCEPTION 'Missing CDN cover accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 UPDATE pliego.edicion SET portada_url='https://covers.pliegolibros.com/covers/fixture.webp' WHERE edicion_id=edition;
 BEGIN
  CALL pliego.sp_edition_offer_create_if_absent(actor,edition,21.00,'NONE','*',16.00,statement_timestamp(),statement_timestamp()+INTERVAL '3 days',NULL,NULL,ignored);
  RAISE EXCEPTION 'Changed base price accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_edition_offer_create_if_absent(actor,edition,20.00,'NONE',NULL,16.00,statement_timestamp(),statement_timestamp()+INTERVAL '3 days',NULL,NULL,ignored);
  RAISE EXCEPTION 'Incomplete preconditions accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_edition_offer_create_if_absent(customer,edition,20.00,'NONE','*',16.00,statement_timestamp(),statement_timestamp()+INTERVAL '3 days',NULL,NULL,ignored);
  RAISE EXCEPTION 'Customer created guarded offer';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 CALL pliego.sp_edition_offer_create_if_absent(actor,edition,20.00,'NONE','*',16.00,statement_timestamp(),statement_timestamp()+INTERVAL '3 days',NULL,NULL,ignored);
 BEGIN
  CALL pliego.sp_edition_offer_create_if_absent(actor,edition,20.00,'NONE','*',15.00,statement_timestamp(),statement_timestamp()+INTERVAL '3 days',NULL,NULL,ignored);
  RAISE EXCEPTION 'Existing offer overwritten by guarded command';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 CALL pliego.sp_edition_offer_set(actor,edition,16.00,statement_timestamp()-INTERVAL '2 days',statement_timestamp()-INTERVAL '1 day',ignored);
 IF NOT pliego.fn_admin_edition_offer_row_exists(actor,edition) THEN RAISE EXCEPTION 'Expired row hidden from admin preflight'; END IF;
 IF (SELECT offer_id FROM pliego.fn_edition_offer(edition)) IS NOT NULL OR pliego.fn_edition_price(edition)<>20.00 THEN
  RAISE EXCEPTION 'Expired row remained public or altered base price'; END IF;
 CALL pliego.sp_edition_offer_clear(actor,edition);
 IF NOT pliego.fn_admin_edition_offer_row_exists(actor,edition) THEN RAISE EXCEPTION 'Inactive row hidden from admin preflight'; END IF;
 BEGIN
  PERFORM pliego.fn_admin_edition_offer_row_exists(customer,edition);
  RAISE EXCEPTION 'Customer obtained admin offer-row projection';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 BEGIN
  PERFORM pliego.fn_admin_edition_offer_row_exists(NULL,edition);
  RAISE EXCEPTION 'Anonymous actor obtained admin offer-row projection';
 EXCEPTION WHEN SQLSTATE 'P1002' THEN NULL; END;
END $gate$;
ROLLBACK;
SELECT 'PASS: absent, expired, inactive offer-row presence and ADMIN actor enforcement';
