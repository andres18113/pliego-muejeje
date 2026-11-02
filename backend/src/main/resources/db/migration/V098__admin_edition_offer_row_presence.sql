-- Public offer projections intentionally hide expired/inactive rows. An ADMIN
-- campaign preflight must still see their existence before using the offer upsert.
CREATE FUNCTION pliego.fn_admin_edition_offer_row_exists(p_actor BIGINT,p_edition BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
 PERFORM pliego.fn_assert_actor(p_actor,'ADMIN');
 RETURN EXISTS(SELECT 1 FROM pliego.edicion_oferta WHERE edicion_id=p_edition);
END;
$$;

-- Optional create-only mode on the existing HTTP PUT. Lock the same edition
-- master as the legacy upsert and checkout; lock physical stock while checking
-- the submitted snapshot. No existing row (even inactive/expired) may be replaced.
CREATE PROCEDURE pliego.sp_edition_offer_create_if_absent(IN p_actor BIGINT,IN p_edition BIGINT,
 IN p_expected_base NUMERIC,IN p_expected_stock VARCHAR,IN p_if_none_match VARCHAR,
 IN p_price NUMERIC,IN p_starts TIMESTAMPTZ,IN p_ends TIMESTAMPTZ,IN p_copy VARCHAR,IN p_terms VARCHAR,
 OUT o_offer BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE edition pliego.edicion%ROWTYPE; stock INTEGER; book_state VARCHAR;
BEGIN
 PERFORM pliego.fn_assert_actor(p_actor,'ADMIN');
 SELECT * INTO edition FROM pliego.edicion WHERE edicion_id=p_edition FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND'); END IF;
 SELECT estado INTO book_state FROM pliego.libro WHERE libro_id=edition.libro_id FOR SHARE;
 IF p_if_none_match IS DISTINCT FROM '*' OR p_expected_base IS NULL OR p_expected_stock IS NULL
  OR p_expected_stock !~ '^(NONE|0|[1-9][0-9]{0,9})$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF edition.precio IS DISTINCT FROM p_expected_base OR edition.estado<>'ACTIVE' OR book_state<>'ACTIVE'
  OR edition.portada_url IS NULL OR edition.portada_url !~ '^https://covers[.]pliegolibros[.]com/covers/'
  OR EXISTS(SELECT 1 FROM pliego.edicion_oferta WHERE edicion_id=p_edition) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF pliego.fn_is_physical_format(edition.formato) THEN
  -- Existing inventory writers lock inventory first, then their trigger takes
  -- a SHARE lock on the edition. Never wait for their inventory lock while
  -- holding the edition master: fail closed so the inventory writer can finish.
  BEGIN
   SELECT stock_actual INTO stock FROM pliego.inventario WHERE edicion_id=p_edition FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
   PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
  END;
  IF stock IS NULL OR stock<=0 OR p_expected_stock='NONE' THEN
   PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
  IF stock::NUMERIC IS DISTINCT FROM p_expected_stock::NUMERIC THEN
   PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 ELSIF p_expected_stock<>'NONE' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 CALL pliego.sp_edition_offer_set(p_actor,p_edition,p_price,p_starts,p_ends,p_copy,p_terms,o_offer);
END;
$$;

REVOKE ALL ON FUNCTION pliego.fn_admin_edition_offer_row_exists(BIGINT,BIGINT) FROM PUBLIC;
REVOKE ALL ON PROCEDURE pliego.sp_edition_offer_create_if_absent(BIGINT,BIGINT,NUMERIC,VARCHAR,VARCHAR,NUMERIC,TIMESTAMPTZ,TIMESTAMPTZ,VARCHAR,VARCHAR) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT EXECUTE ON FUNCTION pliego.fn_admin_edition_offer_row_exists(BIGINT,BIGINT) TO pliego_app;
  GRANT EXECUTE ON PROCEDURE pliego.sp_edition_offer_create_if_absent(BIGINT,BIGINT,NUMERIC,VARCHAR,VARCHAR,NUMERIC,TIMESTAMPTZ,TIMESTAMPTZ,VARCHAR,VARCHAR) TO pliego_app;
 END IF;
END $$;
