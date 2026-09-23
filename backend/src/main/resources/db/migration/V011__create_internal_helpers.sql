CREATE OR REPLACE FUNCTION pliego.fn_raise_domain_error(p_sqlstate CHAR(5),p_code TEXT,p_detail TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
  IF p_detail IS NULL THEN
    RAISE EXCEPTION USING ERRCODE=p_sqlstate,MESSAGE=p_code;
  ELSE
    RAISE EXCEPTION USING ERRCODE=p_sqlstate,MESSAGE=p_code,DETAIL=p_detail;
  END IF;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_normalize_email(p_value TEXT)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$ SELECT lower(btrim(p_value)); $$;
CREATE OR REPLACE FUNCTION pliego.fn_normalize_phone(p_value TEXT)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$ SELECT regexp_replace(btrim(p_value),'[[:space:]().-]','','g'); $$;
CREATE OR REPLACE FUNCTION pliego.fn_normalize_sku(p_value TEXT)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$ SELECT upper(btrim(p_value)); $$;
CREATE OR REPLACE FUNCTION pliego.fn_normalize_slug(p_value TEXT)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$ SELECT regexp_replace(lower(btrim(p_value)),'[[:space:]]+','-','g'); $$;
CREATE OR REPLACE FUNCTION pliego.fn_normalize_language(p_value TEXT)
RETURNS VARCHAR LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$ SELECT lower(btrim(p_value)); $$;
CREATE OR REPLACE FUNCTION pliego.fn_normalize_country_code(p_value TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$ SELECT upper(btrim(p_value)); $$;

CREATE OR REPLACE FUNCTION pliego.fn_is_valid_isbn13(p_isbn TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER AS $$
DECLARE v_sum INTEGER:=0; v_digit INTEGER; i INTEGER;
BEGIN
  IF p_isbn !~ '^[0-9]{13}$' THEN RETURN FALSE; END IF;
  FOR i IN 1..12 LOOP
    v_digit:=substr(p_isbn,i,1)::INTEGER;
    IF (i%2)=1 THEN v_sum:=v_sum+v_digit; ELSE v_sum:=v_sum+(v_digit*3); END IF;
  END LOOP;
  v_digit:=(10-(v_sum%10))%10;
  RETURN v_digit=substr(p_isbn,13,1)::INTEGER;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_generate_payment_reference()
RETURNS VARCHAR LANGUAGE sql VOLATILE SECURITY INVOKER AS $$ SELECT ('SIM-'||uuidv4()::TEXT)::VARCHAR; $$;

CREATE OR REPLACE FUNCTION pliego.fn_assert_actor(p_actor_user_id BIGINT,p_required_role VARCHAR DEFAULT NULL)
RETURNS TABLE(usuario_id BIGINT,cliente_id BIGINT,rol VARCHAR)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_uid BIGINT;v_cid BIGINT;v_role VARCHAR;v_state VARCHAR;
BEGIN
 SELECT u.usuario_id,c.cliente_id,u.rol,u.estado INTO v_uid,v_cid,v_role,v_state
 FROM pliego.usuario u LEFT JOIN pliego.cliente c ON c.usuario_id=u.usuario_id
 WHERE u.usuario_id=p_actor_user_id;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1002','ACTOR_NOT_FOUND'); END IF;
 IF v_state<>'ACTIVE' THEN PERFORM pliego.fn_raise_domain_error('P1003','ACTOR_INACTIVE'); END IF;
 IF p_required_role='ADMIN' AND v_role<>'ADMIN' THEN PERFORM pliego.fn_raise_domain_error('P1004','ACTOR_NOT_ADMIN');
 ELSIF p_required_role='CUSTOMER' AND v_role<>'CUSTOMER' THEN PERFORM pliego.fn_raise_domain_error('P1005','ACTOR_NOT_CUSTOMER');
 ELSIF p_required_role IS NOT NULL AND p_required_role NOT IN('ADMIN','CUSTOMER') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF v_role='CUSTOMER' AND v_cid IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1102','CUSTOMER_NOT_FOUND'); END IF;
 RETURN QUERY SELECT v_uid,v_cid,v_role;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_assert_pagination(p_page INTEGER,p_page_size INTEGER)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER AS $$
BEGIN
 IF p_page IS NULL OR p_page<0 OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>50 THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Invalid pagination');
 END IF;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_build_authors_snapshot(p_book_id BIGINT)
RETURNS VARCHAR LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_snapshot TEXT;
BEGIN
 SELECT string_agg(a.nombre,'; ' ORDER BY la.orden_autoria) INTO v_snapshot
 FROM pliego.libro_autor la JOIN pliego.autor a ON a.autor_id=la.autor_id WHERE la.libro_id=p_book_id;
 IF v_snapshot IS NULL OR char_length(v_snapshot)=0 THEN PERFORM pliego.fn_raise_domain_error('P2032','BOOK_REQUIRES_AUTHOR'); END IF;
 IF char_length(v_snapshot)>1000 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Authors snapshot exceeds 1000 characters'); END IF;
 RETURN v_snapshot::VARCHAR;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_validate_cover_metadata(p_cover_url TEXT,p_cover_license TEXT,p_cover_source_url TEXT,p_cover_attribution TEXT)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER AS $$
DECLARE v_url TEXT:=NULLIF(btrim(p_cover_url),'');v_license TEXT:=NULLIF(btrim(p_cover_license),'');v_source TEXT:=NULLIF(btrim(p_cover_source_url),'');v_attr TEXT:=NULLIF(btrim(p_cover_attribution),'');
BEGIN
 IF v_url IS NULL THEN
  IF v_license IS NOT NULL OR v_source IS NOT NULL OR v_attr IS NOT NULL THEN PERFORM pliego.fn_raise_domain_error('P2047','COVER_METADATA_INVALID'); END IF;
  RETURN;
 END IF;
 IF v_license IS NULL OR v_source IS NULL OR v_license NOT IN('PUBLIC_DOMAIN','CC0','CC_BY','CC_BY_SA','OWNED') THEN PERFORM pliego.fn_raise_domain_error('P2047','COVER_METADATA_INVALID'); END IF;
 IF v_license IN('CC_BY','CC_BY_SA') AND v_attr IS NULL THEN PERFORM pliego.fn_raise_domain_error('P2047','COVER_METADATA_INVALID'); END IF;
END;$$;
