\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE actor BIGINT; row RECORD; ignored BIGINT; projected RECORD;
BEGIN
 SELECT min(usuario_id) INTO actor FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE';
 IF actor IS NULL THEN RAISE EXCEPTION 'No active admin'; END IF;
 IF (SELECT count(*) FROM pliego.edicion_oferta WHERE estado='ACTIVE')<>23 THEN RAISE EXCEPTION 'Expected 23 offers'; END IF;
 FOR row IN SELECT edicion_id,precio_oferta FROM pliego.edicion_oferta WHERE estado='ACTIVE' LOOP
  CALL pliego.sp_edition_offer_set(actor,row.edicion_id,row.precio_oferta,
      statement_timestamp()-INTERVAL '2 days',statement_timestamp()-INTERVAL '1 day',NULL,NULL,ignored);
  SELECT * INTO projected FROM pliego.fn_edition_offer(row.edicion_id);
  IF projected.offer_id IS NOT NULL OR projected.price<>projected.original_price THEN
   RAISE EXCEPTION 'Expired offer did not restore base price for edition %',row.edicion_id;
  END IF;
 END LOOP;
 IF (pliego.fn_offers_filter_options()->>'totalCount')::INTEGER<>0 THEN RAISE EXCEPTION 'Expired offers still listed'; END IF;
END $$;
ROLLBACK;
DO $$
BEGIN
 IF (pliego.fn_offers_filter_options()->>'totalCount')::INTEGER<>23 THEN RAISE EXCEPTION 'Offers not preserved after rollback'; END IF;
END $$;
SELECT 'PASS: 23 expirations restore base prices; all 23 real offers and dates preserved.';
