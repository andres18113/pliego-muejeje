BEGIN;
DO $gate$ DECLARE r RECORD; ignored BIGINT; BEGIN
 FOR r IN SELECT edicion_id,precio_oferta FROM pliego.edicion_oferta WHERE edicion_id IN(25,26,27,28,29,30,31,34,35,36,37,38,39,40,43,44,45,46,47,48,49) LOOP
  CALL pliego.sp_edition_offer_set(1,r.edicion_id,r.precio_oferta,statement_timestamp()-INTERVAL '2 days',statement_timestamp()-INTERVAL '1 day',ignored);
  IF (SELECT offer_id FROM pliego.fn_edition_offer(r.edicion_id)) IS NOT NULL OR
   (SELECT price<>original_price FROM pliego.fn_edition_offer(r.edicion_id)) THEN RAISE EXCEPTION 'Expiry did not restore base'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pliego.fn_catalog_search_offers(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'RELEVANCE',0,50) WHERE edition_id IN(25,26,27,28,29,30,31,34,35,36,37,38,39,40,43,44,45,46,47,48,49)) THEN
  RAISE EXCEPTION 'Expired campaign remained in public offers'; END IF;
END $gate$;
ROLLBACK;