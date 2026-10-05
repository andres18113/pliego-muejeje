-- Customer email change (API amendment v1.0.9).
-- The email is the CUSTOMER's sign-in identity. Changing it reuses the registration rules: the same
-- normalization and validation (P1001) and the same uniqueness guarantee (P1101 EMAIL_ALREADY_EXISTS).
-- Re-authentication happens in the application (BCrypt), which reads the current hash through
-- fn_customer_password_hash; the database never receives the plaintext password.
-- Sessions and JWTs are keyed by user id, so they stay valid after the change.

CREATE OR REPLACE FUNCTION pliego.fn_customer_password_hash(p_actor_user_id BIGINT)
RETURNS VARCHAR
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_hash VARCHAR;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER');
 SELECT u.password_hash INTO v_hash FROM pliego.usuario u WHERE u.usuario_id=p_actor_user_id;
 RETURN v_hash;
END;$$;

CREATE OR REPLACE PROCEDURE pliego.sp_customer_change_email(IN p_actor_user_id BIGINT,IN p_new_email VARCHAR,OUT o_email VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_email VARCHAR;v_current VARCHAR;v_constraint TEXT;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER');
 v_email:=pliego.fn_normalize_email(p_new_email);
 IF v_email IS NULL OR char_length(v_email) NOT BETWEEN 3 AND 254 OR position('@' IN v_email)<=1 THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 SELECT u.email_normalizado INTO v_current FROM pliego.usuario u WHERE u.usuario_id=p_actor_user_id FOR UPDATE;
 IF v_current=v_email THEN o_email:=v_current; RETURN; END IF;
 BEGIN
  UPDATE pliego.usuario SET email_normalizado=v_email WHERE usuario_id=p_actor_user_id;
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
  IF v_constraint='uq_usuario_email' THEN PERFORM pliego.fn_raise_domain_error('P1101','EMAIL_ALREADY_EXISTS'); END IF;
  RAISE;
 END;
 o_email:=v_email;
END;$$;
