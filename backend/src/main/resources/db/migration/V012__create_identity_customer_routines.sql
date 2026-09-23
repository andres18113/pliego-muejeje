CREATE OR REPLACE PROCEDURE pliego.sp_customer_register(
 IN p_email VARCHAR,IN p_password_hash VARCHAR,IN p_first_names VARCHAR,IN p_last_names VARCHAR,IN p_phone VARCHAR,
 OUT o_user_id BIGINT,OUT o_customer_id BIGINT,OUT o_user_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_email VARCHAR;v_phone VARCHAR;v_constraint TEXT;
BEGIN
 v_email:=pliego.fn_normalize_email(p_email);
 v_phone:=CASE WHEN p_phone IS NULL OR btrim(p_phone)='' THEN NULL ELSE pliego.fn_normalize_phone(p_phone) END;
 IF v_email IS NULL OR char_length(v_email) NOT BETWEEN 3 AND 254 OR position('@' IN v_email)<=1 OR p_password_hash IS NULL OR char_length(btrim(p_password_hash))=0 OR p_first_names IS NULL OR char_length(btrim(p_first_names)) NOT BETWEEN 1 AND 120 OR p_last_names IS NULL OR char_length(btrim(p_last_names)) NOT BETWEEN 1 AND 120 OR (v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9]{7,19}$') THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 BEGIN
  INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES(v_email,p_password_hash,'CUSTOMER','ACTIVE') RETURNING usuario_id INTO o_user_id;
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
  IF v_constraint='uq_usuario_email' THEN PERFORM pliego.fn_raise_domain_error('P1101','EMAIL_ALREADY_EXISTS'); END IF;
  RAISE;
 END;
 INSERT INTO pliego.cliente(usuario_id,nombres,apellidos,telefono) VALUES(o_user_id,btrim(p_first_names),btrim(p_last_names),v_phone) RETURNING cliente_id INTO o_customer_id;
 o_user_state:='ACTIVE';
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_user_auth_data(p_email VARCHAR)
RETURNS TABLE(user_id BIGINT,email_canonical VARCHAR,password_hash VARCHAR,role VARCHAR,state VARCHAR)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_email VARCHAR;
BEGIN
 IF p_email IS NULL OR btrim(p_email)='' THEN RETURN; END IF;
 v_email:=pliego.fn_normalize_email(p_email);
 RETURN QUERY SELECT u.usuario_id,u.email_normalizado,u.password_hash,u.rol,u.estado FROM pliego.usuario u WHERE u.email_normalizado=v_email;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_admin_customer_search(p_actor_user_id BIGINT,p_query VARCHAR,p_state VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(user_id BIGINT,customer_id BIGINT,email VARCHAR,first_names VARCHAR,last_names VARCHAR,phone VARCHAR,state VARCHAR,created_at TIMESTAMPTZ,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_query TEXT:=NULLIF(lower(btrim(p_query)),'');
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_state IS NOT NULL AND p_state NOT IN('ACTIVE','BLOCKED') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT u.usuario_id,c.cliente_id,u.email_normalizado,c.nombres,c.apellidos,c.telefono,u.estado,u.fecha_creacion,count(*) OVER()::BIGINT
 FROM pliego.usuario u JOIN pliego.cliente c ON c.usuario_id=u.usuario_id
 WHERE u.rol='CUSTOMER' AND (p_state IS NULL OR u.estado=p_state) AND (v_query IS NULL OR lower(u.email_normalizado) LIKE '%'||v_query||'%' OR lower(c.nombres) LIKE '%'||v_query||'%' OR lower(c.apellidos) LIKE '%'||v_query||'%')
 ORDER BY u.fecha_creacion DESC,u.usuario_id DESC LIMIT p_page_size OFFSET p_page*p_page_size;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_customer_set_status(IN p_actor_user_id BIGINT,IN p_customer_id BIGINT,IN p_new_state VARCHAR,OUT o_customer_id BIGINT,OUT o_user_id BIGINT,OUT o_effective_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
 IF p_new_state NOT IN('ACTIVE','BLOCKED') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 SELECT c.cliente_id,u.usuario_id,u.estado INTO o_customer_id,o_user_id,o_effective_state FROM pliego.cliente c JOIN pliego.usuario u ON u.usuario_id=c.usuario_id WHERE c.cliente_id=p_customer_id AND u.rol='CUSTOMER' FOR UPDATE OF u;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1102','CUSTOMER_NOT_FOUND'); END IF;
 IF o_effective_state<>p_new_state THEN UPDATE pliego.usuario SET estado=p_new_state WHERE usuario_id=o_user_id;o_effective_state:=p_new_state; END IF;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_customer_profile(p_actor_user_id BIGINT)
RETURNS TABLE(customer_id BIGINT,email VARCHAR,first_names VARCHAR,last_names VARCHAR,phone VARCHAR,state VARCHAR)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
 RETURN QUERY SELECT c.cliente_id,u.email_normalizado,c.nombres,c.apellidos,c.telefono,u.estado FROM pliego.cliente c JOIN pliego.usuario u ON u.usuario_id=c.usuario_id WHERE c.cliente_id=v_customer_id;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_customer_update(IN p_actor_user_id BIGINT,IN p_first_names VARCHAR,IN p_last_names VARCHAR,IN p_phone VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_phone VARCHAR;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
 v_phone:=CASE WHEN p_phone IS NULL OR btrim(p_phone)='' THEN NULL ELSE pliego.fn_normalize_phone(p_phone) END;
 IF p_first_names IS NULL OR char_length(btrim(p_first_names)) NOT BETWEEN 1 AND 120 OR p_last_names IS NULL OR char_length(btrim(p_last_names)) NOT BETWEEN 1 AND 120 OR (v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9]{7,19}$') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 UPDATE pliego.cliente SET nombres=btrim(p_first_names),apellidos=btrim(p_last_names),telefono=v_phone WHERE cliente_id=v_customer_id;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1102','CUSTOMER_NOT_FOUND'); END IF;
END;$$;

CREATE OR REPLACE FUNCTION pliego.fn_address_list(p_actor_user_id BIGINT)
RETURNS TABLE(address_id BIGINT,alias VARCHAR,recipient VARCHAR,line1 VARCHAR,line2 VARCHAR,city VARCHAR,province VARCHAR,country_code CHAR(2),postal_code VARCHAR,reference VARCHAR,phone VARCHAR,is_primary BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
 RETURN QUERY SELECT d.direccion_id,d.alias,d.destinatario,d.direccion_linea1,d.direccion_linea2,d.ciudad,d.provincia,d.pais_codigo,d.codigo_postal,d.referencia,d.telefono,d.es_principal FROM pliego.direccion d WHERE d.cliente_id=v_customer_id ORDER BY d.es_principal DESC,d.fecha_creacion,d.direccion_id;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_address_create(IN p_actor_user_id BIGINT,IN p_alias VARCHAR,IN p_recipient VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,IN p_country_code VARCHAR,IN p_postal_code VARCHAR,IN p_reference VARCHAR,IN p_phone VARCHAR,IN p_make_primary BOOLEAN,OUT o_address_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_country TEXT;v_phone TEXT;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
 v_country:=pliego.fn_normalize_country_code(p_country_code);v_phone:=pliego.fn_normalize_phone(p_phone);
 IF p_alias IS NULL OR char_length(btrim(p_alias)) NOT BETWEEN 1 AND 80 OR p_recipient IS NULL OR char_length(btrim(p_recipient)) NOT BETWEEN 1 AND 200 OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200 OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 1 AND 100 OR p_province IS NULL OR char_length(btrim(p_province)) NOT BETWEEN 1 AND 100 OR char_length(v_country)<>2 OR NOT pliego.fn_is_valid_country_code(v_country) OR v_phone !~ '^\+?[0-9]{7,19}$' THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF COALESCE(p_make_primary,FALSE) THEN PERFORM 1 FROM pliego.cliente c WHERE c.cliente_id=v_customer_id FOR UPDATE;UPDATE pliego.direccion SET es_principal=FALSE WHERE cliente_id=v_customer_id AND es_principal; END IF;
 INSERT INTO pliego.direccion(cliente_id,alias,destinatario,direccion_linea1,direccion_linea2,ciudad,provincia,pais_codigo,codigo_postal,referencia,telefono,es_principal)
 VALUES(v_customer_id,btrim(p_alias),btrim(p_recipient),btrim(p_line1),NULLIF(btrim(p_line2),''),btrim(p_city),btrim(p_province),v_country::CHAR(2),NULLIF(btrim(p_postal_code),''),NULLIF(btrim(p_reference),''),v_phone,COALESCE(p_make_primary,FALSE)) RETURNING direccion_id INTO o_address_id;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_address_update(IN p_actor_user_id BIGINT,IN p_address_id BIGINT,IN p_alias VARCHAR,IN p_recipient VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,IN p_country_code VARCHAR,IN p_postal_code VARCHAR,IN p_reference VARCHAR,IN p_phone VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_country TEXT;v_phone TEXT;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
 v_country:=pliego.fn_normalize_country_code(p_country_code);v_phone:=pliego.fn_normalize_phone(p_phone);
 IF p_alias IS NULL OR char_length(btrim(p_alias)) NOT BETWEEN 1 AND 80 OR p_recipient IS NULL OR char_length(btrim(p_recipient)) NOT BETWEEN 1 AND 200 OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200 OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 1 AND 100 OR p_province IS NULL OR char_length(btrim(p_province)) NOT BETWEEN 1 AND 100 OR char_length(v_country)<>2 OR NOT pliego.fn_is_valid_country_code(v_country) OR v_phone !~ '^\+?[0-9]{7,19}$' THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 UPDATE pliego.direccion SET alias=btrim(p_alias),destinatario=btrim(p_recipient),direccion_linea1=btrim(p_line1),direccion_linea2=NULLIF(btrim(p_line2),''),ciudad=btrim(p_city),provincia=btrim(p_province),pais_codigo=v_country::CHAR(2),codigo_postal=NULLIF(btrim(p_postal_code),''),referencia=NULLIF(btrim(p_reference),''),telefono=v_phone WHERE direccion_id=p_address_id AND cliente_id=v_customer_id;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1103','ADDRESS_NOT_FOUND'); END IF;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_address_delete(IN p_actor_user_id BIGINT,IN p_address_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
 DELETE FROM pliego.direccion WHERE direccion_id=p_address_id AND cliente_id=v_customer_id;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1103','ADDRESS_NOT_FOUND'); END IF;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_address_set_primary(IN p_actor_user_id BIGINT,IN p_address_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
 PERFORM 1 FROM pliego.cliente c WHERE c.cliente_id=v_customer_id FOR UPDATE;
 PERFORM 1 FROM pliego.direccion d WHERE d.direccion_id=p_address_id AND d.cliente_id=v_customer_id;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1103','ADDRESS_NOT_FOUND'); END IF;
 UPDATE pliego.direccion SET es_principal=(direccion_id=p_address_id) WHERE cliente_id=v_customer_id AND es_principal IS DISTINCT FROM (direccion_id=p_address_id);
END;$$;
