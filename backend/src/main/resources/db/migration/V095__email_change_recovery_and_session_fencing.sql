-- ADR 0049: a login using a stale email snapshot must not issue a session after promotion/revocation.
-- Keep the existing password-only signature available to historical callers.
CREATE FUNCTION pliego.fn_auth_session_create_identity_checked(p_user BIGINT,p_refresh_hash VARCHAR,
 p_expires TIMESTAMPTZ,p_password_hash VARCHAR,p_expected_email VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE current_email VARCHAR;
BEGIN
 SELECT email_normalizado INTO current_email FROM pliego.usuario WHERE usuario_id=p_user FOR UPDATE;
 IF NOT FOUND OR p_expected_email IS NULL OR current_email IS DISTINCT FROM p_expected_email THEN RETURN FALSE; END IF;
 RETURN pliego.fn_auth_session_create_checked(p_user,p_refresh_hash,p_expires,p_password_hash);
END; $$;

-- Recovering the current account must invalidate a previously delivered change confirmation.
-- The old routine retains token/password/session semantics and holds the same user lock.
ALTER FUNCTION pliego.fn_email_action_consume(VARCHAR,VARCHAR,VARCHAR) RENAME TO fn_email_action_consume_internal_v039;
CREATE FUNCTION pliego.fn_email_action_consume(p_type VARCHAR,p_hash VARCHAR,p_password_hash VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE actor BIGINT; consumed BOOLEAN;
BEGIN
 IF p_type='RESET_PASSWORD' THEN
  SELECT usuario_id INTO actor FROM pliego.correo_token WHERE token_hash=p_hash AND tipo=p_type;
 END IF;
 consumed:=pliego.fn_email_action_consume_internal_v039(p_type,p_hash,p_password_hash);
 IF consumed AND p_type='RESET_PASSWORD' THEN
  -- Reset also supports ADMIN; token ownership was already checked by the original routine.
  UPDATE pliego.correo_cambio SET estado='CANCELLED',fecha_fin=clock_timestamp()
   WHERE usuario_id=actor AND estado='PENDING';
  UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='ACTION_CANCELLED',fecha_actualizacion=clock_timestamp()
   WHERE usuario_id=actor AND tipo IN('EMAIL_CHANGE_CONFIRM','EMAIL_CHANGE_REQUESTED') AND estado='PENDING';
 END IF;
 RETURN consumed;
END; $$;

REVOKE ALL ON FUNCTION pliego.fn_auth_session_create_identity_checked(BIGINT,VARCHAR,TIMESTAMPTZ,VARCHAR,VARCHAR),
 pliego.fn_email_action_consume(VARCHAR,VARCHAR,VARCHAR) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT EXECUTE ON FUNCTION pliego.fn_auth_session_create_identity_checked(BIGINT,VARCHAR,TIMESTAMPTZ,VARCHAR,VARCHAR),
   pliego.fn_email_action_consume(VARCHAR,VARCHAR,VARCHAR),pliego.fn_email_action_consume_internal_v039(VARCHAR,VARCHAR,VARCHAR) TO pliego_app;
 END IF;
END $grants$;
