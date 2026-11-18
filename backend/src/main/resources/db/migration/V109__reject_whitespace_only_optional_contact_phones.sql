-- Registration and profile replacement allow an omitted, null or empty phone.
-- Profile PATCH also accepts null or empty when the phone field is selected.
CREATE FUNCTION pliego.fn_normalize_optional_phone_input(p_value TEXT) RETURNS VARCHAR
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER AS $$
DECLARE
    normalized_phone VARCHAR := pliego.fn_normalize_phone(p_value);
BEGIN
    IF normalized_phone IS NULL AND p_value <> '' THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Escribe solo dígitos en el número de teléfono.');
    END IF;
    RETURN normalized_phone;
END; $$;

CREATE OR REPLACE PROCEDURE pliego.sp_customer_register(IN p_email VARCHAR,IN p_password_hash VARCHAR,
    IN p_first_names VARCHAR,IN p_last_names VARCHAR,IN p_phone VARCHAR,
    OUT o_user_id BIGINT,OUT o_customer_id BIGINT,OUT o_user_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    CALL pliego.sp_customer_register_internal_v012(p_email,p_password_hash,pliego.fn_normalize_person_name(p_first_names),
        pliego.fn_normalize_person_name(p_last_names),pliego.fn_normalize_optional_phone_input(p_phone),
        o_user_id,o_customer_id,o_user_state);
END; $$;

CREATE OR REPLACE PROCEDURE pliego.sp_customer_update(IN p_actor BIGINT,IN p_first_names VARCHAR,
    IN p_last_names VARCHAR,IN p_phone VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    CALL pliego.sp_customer_update_internal_v012(p_actor,pliego.fn_normalize_person_name(p_first_names),
        pliego.fn_normalize_person_name(p_last_names),pliego.fn_normalize_optional_phone_input(p_phone));
END; $$;

CREATE OR REPLACE PROCEDURE pliego.sp_customer_patch(IN p_actor BIGINT,IN p_version BIGINT,
    IN p_field VARCHAR,IN p_value VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    v_customer BIGINT;
    v_profile pliego.cliente%ROWTYPE;
    v_value VARCHAR;
BEGIN
    SELECT a.cliente_id INTO v_customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER') a;
    SELECT * INTO v_profile FROM pliego.cliente WHERE cliente_id=v_customer FOR UPDATE;
    IF p_version IS NULL OR p_version<0 OR p_field IS NULL OR p_field NOT IN ('firstNames','lastNames','phone') THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    IF v_profile.profile_version<>p_version THEN
        PERFORM pliego.fn_raise_domain_error('P1104','PROFILE_VERSION_CONFLICT');
    END IF;
    IF p_field='phone' THEN
        v_value:=pliego.fn_normalize_optional_phone_input(p_value);
        UPDATE pliego.cliente SET telefono=v_value WHERE cliente_id=v_customer;
    ELSE
        v_value:=pliego.fn_normalize_person_name(p_value);
        IF NOT pliego.fn_is_person_name(v_value) THEN
            PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
        END IF;
        IF p_field='firstNames' THEN
            UPDATE pliego.cliente SET nombres=v_value WHERE cliente_id=v_customer;
        ELSE
            UPDATE pliego.cliente SET apellidos=v_value WHERE cliente_id=v_customer;
        END IF;
    END IF;
END; $$;

REVOKE ALL ON FUNCTION pliego.fn_normalize_optional_phone_input(TEXT) FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'pliego_app') THEN
        GRANT EXECUTE ON FUNCTION pliego.fn_normalize_optional_phone_input(TEXT) TO pliego_app;
    END IF;
END; $$;
