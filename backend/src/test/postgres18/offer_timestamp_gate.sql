-- Run on disposable PostgreSQL, including the restricted runtime role.
\set ON_ERROR_STOP on
BEGIN;
DO $gate$
DECLARE actor BIGINT; author_id BIGINT; publisher BIGINT; category BIGINT; book BIGINT; edition BIGINT;
 offer BIGINT; starts TIMESTAMPTZ; ends TIMESTAMPTZ;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('offer-timestamp-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO actor;
 CALL pliego.sp_author_create(actor,'Autora fechas',NULL,author_id);
 CALL pliego.sp_publisher_create(actor,'Editorial fechas',NULL,publisher);
 CALL pliego.sp_category_create(actor,'Fechas','offer-timestamp-gate',NULL,NULL,category);
 CALL pliego.sp_book_create(actor,'Libro fechas',NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category),book);
 CALL pliego.sp_edition_create(actor,book,publisher,'OFFER-TIMESTAMP-GATE',NULL,'es','EBOOK',NULL,NULL,
  20.00,'https://covers.pliegolibros.com/covers/fixture.webp',NULL,NULL,NULL,NULL,NULL,NULL,edition);

 FOR starts,ends IN SELECT * FROM (VALUES
  ('-infinity'::TIMESTAMPTZ,statement_timestamp()+INTERVAL '1 day'),
  (statement_timestamp()-INTERVAL '1 day','infinity'::TIMESTAMPTZ),
  ('-infinity'::TIMESTAMPTZ,'infinity'::TIMESTAMPTZ)) invalid(starts,ends)
 LOOP
  BEGIN
   CALL pliego.sp_edition_offer_set(actor,edition,15.00,starts,ends,'Oferta','Condiciones',offer);
   RAISE EXCEPTION 'Nonfinite offer dates accepted by authored command';
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
  BEGIN
   CALL pliego.sp_edition_offer_set(actor,edition,15.00,starts,ends,offer);
   RAISE EXCEPTION 'Nonfinite offer dates accepted by compatible command';
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
  BEGIN
   CALL pliego.sp_edition_offer_create_if_absent(actor,edition,20.00,'NONE','*',15.00,starts,ends,NULL,NULL,offer);
   RAISE EXCEPTION 'Nonfinite offer dates accepted by conditional creation';
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 END LOOP;
 IF EXISTS(SELECT FROM pliego.edicion_oferta WHERE edicion_id=edition) THEN
  RAISE EXCEPTION 'Rejected offer dates created a row'; END IF;

 -- Valid historical, scheduled and current windows remain available to ADMIN.
 CALL pliego.sp_edition_offer_set(actor,edition,15.00,statement_timestamp()-INTERVAL '2 days',statement_timestamp()-INTERVAL '1 day',offer);
 IF (SELECT offer_id FROM pliego.fn_edition_offer(edition)) IS NOT NULL THEN
  RAISE EXCEPTION 'Historical finite offer became public'; END IF;
 CALL pliego.sp_edition_offer_set(actor,edition,15.00,statement_timestamp()+INTERVAL '1 day',statement_timestamp()+INTERVAL '2 days',offer);
 IF (SELECT offer_id FROM pliego.fn_edition_offer(edition)) IS NOT NULL THEN
  RAISE EXCEPTION 'Scheduled finite offer became public early'; END IF;
 CALL pliego.sp_edition_offer_set(actor,edition,15.00,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '1 day',offer);
 IF (SELECT price FROM pliego.fn_edition_offer(edition))<>15.00 THEN
  RAISE EXCEPTION 'Current finite offer lost its effective price'; END IF;
END $gate$;
ROLLBACK;
SELECT 'PASS: finite offer dates across authored, compatible and conditional commands';
