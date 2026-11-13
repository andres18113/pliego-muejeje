-- ADR0056: independent, short admission before BCrypt; no account lookup in quotas.
CREATE TABLE pliego.registro_intento_limite (
 clave VARCHAR(67) PRIMARY KEY CHECK(clave ~ '^(IP|AC):[0-9a-f]{64}$'),
 expira TIMESTAMPTZ NOT NULL,
 solicitudes INTEGER NOT NULL CHECK(solicitudes>0),
 admitidos INTEGER NOT NULL DEFAULT 0 CHECK(admitidos>=0 AND admitidos<=solicitudes)
);
CREATE INDEX ix_registro_intento_limite_expira ON pliego.registro_intento_limite(expira,clave);

CREATE FUNCTION pliego.fn_registration_attempt_admit(p_email VARCHAR,p_ip_hash VARCHAR)
RETURNS INTEGER LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE bucket pliego.registro_intento_limite%ROWTYPE; account_key VARCHAR;
BEGIN
 IF p_email IS NULL OR pliego.fn_normalize_email(p_email) IS NULL
 OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 -- One lock order for every short admission: IP -> canonical email. No user/session locks.
 INSERT INTO pliego.registro_intento_limite AS l(clave,expira,solicitudes)
 VALUES('IP:'||p_ip_hash,clock_timestamp()+INTERVAL '1 hour',1)
 ON CONFLICT(clave) DO UPDATE SET
 solicitudes=CASE WHEN l.expira<=clock_timestamp() THEN 1 ELSE LEAST(l.solicitudes,2147483646)+1 END,
 admitidos=CASE WHEN l.expira<=clock_timestamp() THEN 0 ELSE l.admitidos END,
 expira=CASE WHEN l.expira<=clock_timestamp() THEN clock_timestamp()+INTERVAL '1 hour' ELSE l.expira END
 RETURNING * INTO bucket;
 -- Stop before creating arbitrary email buckets once the IP is exhausted.
 IF bucket.admitidos>=120 THEN
  RETURN LEAST(3600,GREATEST(1,CEIL(EXTRACT(EPOCH FROM bucket.expira-clock_timestamp()))::INTEGER));
 END IF;
 account_key:='AC:'||encode(sha256(convert_to(pliego.fn_normalize_email(p_email),'UTF8')),'hex');
 INSERT INTO pliego.registro_intento_limite AS l(clave,expira,solicitudes)
 VALUES(account_key,clock_timestamp()+INTERVAL '1 hour',1)
 ON CONFLICT(clave) DO UPDATE SET
 solicitudes=CASE WHEN l.expira<=clock_timestamp() THEN 1 ELSE LEAST(l.solicitudes,2147483646)+1 END,
 admitidos=CASE WHEN l.expira<=clock_timestamp() THEN 0 ELSE l.admitidos END,
 expira=CASE WHEN l.expira<=clock_timestamp() THEN clock_timestamp()+INTERVAL '1 hour' ELSE l.expira END
 RETURNING * INTO bucket;
 IF bucket.admitidos>=5 THEN
  -- An already limited email cannot consume the shared NAT BCrypt budget.
  RETURN LEAST(3600,GREATEST(1,CEIL(EXTRACT(EPOCH FROM bucket.expira-clock_timestamp()))::INTEGER));
 END IF;
 UPDATE pliego.registro_intento_limite SET admitidos=admitidos+1 WHERE clave IN ('IP:'||p_ip_hash,account_key);
 RETURN 0;
END; $$;

CREATE FUNCTION pliego.fn_registration_attempt_cleanup() RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE removed INTEGER; cutoff TIMESTAMPTZ:=clock_timestamp();
BEGIN
 WITH expired AS (
  SELECT clave FROM pliego.registro_intento_limite WHERE expira<=cutoff
  ORDER BY expira,clave LIMIT 1000 FOR UPDATE SKIP LOCKED
 ) DELETE FROM pliego.registro_intento_limite l USING expired e WHERE l.clave=e.clave;
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END; $$;

-- Internal zero IDs indicate a duplicate; REST exposes only the neutral state.
-- The exception block is a PostgreSQL subtransaction: no aborted JDBC transaction,
-- no existing-account lookup, overwrite, resend or continuation replacement.
CREATE PROCEDURE pliego.sp_customer_register_neutral(
 IN p_email VARCHAR,IN p_password_hash VARCHAR,IN p_first_names VARCHAR,IN p_last_names VARCHAR,IN p_phone VARCHAR,
 IN p_token_hash VARCHAR,IN p_nonce VARCHAR,OUT o_user_id BIGINT,OUT o_customer_id BIGINT,OUT o_user_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 BEGIN
  CALL pliego.sp_customer_register_with_verification(p_email,p_password_hash,p_first_names,p_last_names,p_phone,
   p_token_hash,p_nonce,o_user_id,o_customer_id,o_user_state);
 EXCEPTION WHEN SQLSTATE 'P1101' THEN
  o_user_id:=0; o_customer_id:=0; o_user_state:='PENDING_VERIFICATION';
 END;
END; $$;

-- A duplicate gets a pending receipt so /registration-session is neutral too.
-- It has no user/email/session reference and can never authenticate.
CREATE TABLE pliego.registro_continuacion_neutral (
 token_hash VARCHAR(64) PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 expira TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_registro_continuacion_neutral_expira ON pliego.registro_continuacion_neutral(expira,token_hash);
CREATE FUNCTION pliego.fn_registration_decoy_issue(p_hash VARCHAR) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE expiry TIMESTAMPTZ:=CURRENT_TIMESTAMP+INTERVAL '24 hours';
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 INSERT INTO pliego.registro_continuacion_neutral(token_hash,expira) VALUES(p_hash,expiry);
 RETURN expiry;
END; $$;

CREATE FUNCTION pliego.fn_registration_decoy_cleanup() RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE removed INTEGER; cutoff TIMESTAMPTZ:=clock_timestamp();
BEGIN
 WITH expired AS (
  SELECT token_hash FROM pliego.registro_continuacion_neutral WHERE expira<=cutoff
  ORDER BY expira,token_hash LIMIT 1000 FOR UPDATE SKIP LOCKED
 ) DELETE FROM pliego.registro_continuacion_neutral l USING expired e WHERE l.token_hash=e.token_hash;
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END; $$;

CREATE OR REPLACE FUNCTION pliego.fn_registration_session_exchange_internal(p_hash VARCHAR,p_refresh_hash VARCHAR,p_session_expires TIMESTAMPTZ,p_ip_retry_after INTEGER DEFAULT NULL)
RETURNS TABLE(state VARCHAR,user_id BIGINT,email_canonical VARCHAR,role VARCHAR,expires_at TIMESTAMPTZ,return_path VARCHAR,retry_after_seconds INTEGER)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE actor BIGINT; u pliego.usuario%ROWTYPE; c pliego.registro_continuacion%ROWTYPE; s pliego.sesion_autenticacion%ROWTYPE;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
 -- The IP bucket is already locked by the public entry point. Decoys share
 -- the same credential quota and pending/retry response as genuine registrations.
 PERFORM 1 FROM pliego.registro_continuacion_neutral WHERE token_hash=p_hash AND expira>clock_timestamp() FOR UPDATE;
 IF FOUND THEN
  IF p_ip_retry_after IS NOT NULL THEN
   RETURN QUERY SELECT 'RETRY_LATER'::VARCHAR,NULL::BIGINT,NULL::VARCHAR,NULL::VARCHAR,NULL::TIMESTAMPTZ,NULL::VARCHAR,p_ip_retry_after;
  ELSIF NOT pliego.fn_registration_session_rate_limit(('REG:'||p_hash)::VARCHAR,600) THEN
   RETURN QUERY SELECT 'RETRY_LATER'::VARCHAR,NULL::BIGINT,NULL::VARCHAR,NULL::VARCHAR,NULL::TIMESTAMPTZ,NULL::VARCHAR,
    GREATEST(1,CEIL(EXTRACT(EPOCH FROM (l.ventana+INTERVAL '1 hour'-clock_timestamp())))::INTEGER)
    FROM pliego.registro_continuacion_limite l WHERE l.clave='REG:'||p_hash;
  ELSE
   RETURN QUERY SELECT 'PENDING_VERIFICATION'::VARCHAR,NULL::BIGINT,NULL::VARCHAR,NULL::VARCHAR,NULL::TIMESTAMPTZ,NULL::VARCHAR,NULL::INTEGER;
  END IF;
  RETURN;
 END IF;
 SELECT usuario_id INTO actor FROM pliego.registro_continuacion WHERE token_hash=p_hash;
 IF NOT FOUND THEN RETURN; END IF;
 -- Same lock order as verification, reset, password login and email promotion: user, continuation, session.
 SELECT * INTO u FROM pliego.usuario WHERE usuario_id=actor FOR UPDATE;
 SELECT * INTO c FROM pliego.registro_continuacion WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR c.fecha_expiracion<=clock_timestamp() OR u.estado<>'ACTIVE' OR u.rol<>'CUSTOMER'
 OR c.email IS DISTINCT FROM u.email_normalizado THEN RETURN; END IF;
 IF c.fecha_uso IS NOT NULL THEN
  -- Consumed credentials have a five minute recovery window, only for their original live family.
  IF c.fecha_uso<clock_timestamp()-INTERVAL '5 minutes' THEN RETURN; END IF;
  IF NOT EXISTS(SELECT FROM pliego.sesion_autenticacion WHERE sesion_id=c.sesion_id
   AND fecha_revocacion IS NULL AND fecha_expiracion>clock_timestamp()) THEN RETURN; END IF;
 END IF;
 -- A quota never consumes a valid continuation. Validate it before reporting a temporary denial.
 IF p_ip_retry_after IS NOT NULL THEN
  RETURN QUERY SELECT 'RETRY_LATER'::VARCHAR,NULL::BIGINT,NULL::VARCHAR,NULL::VARCHAR,NULL::TIMESTAMPTZ,NULL::VARCHAR,p_ip_retry_after;
  RETURN;
 END IF;
 IF NOT pliego.fn_registration_session_rate_limit(('REG:'||p_hash)::VARCHAR,600) THEN
  RETURN QUERY SELECT 'RETRY_LATER'::VARCHAR,NULL::BIGINT,NULL::VARCHAR,NULL::VARCHAR,NULL::TIMESTAMPTZ,NULL::VARCHAR,
   GREATEST(1,CEIL(EXTRACT(EPOCH FROM (l.ventana+INTERVAL '1 hour'-clock_timestamp())))::INTEGER)
   FROM pliego.registro_continuacion_limite l WHERE l.clave='REG:'||p_hash;
  RETURN;
 END IF;
 IF c.fecha_uso IS NOT NULL THEN
  SELECT * INTO s FROM pliego.sesion_autenticacion WHERE sesion_id=c.sesion_id FOR UPDATE;
  IF NOT FOUND OR s.fecha_revocacion IS NOT NULL OR s.fecha_expiracion<=clock_timestamp() THEN RETURN; END IF;
  RETURN QUERY SELECT 'REFRESH_REQUIRED'::VARCHAR,NULL::BIGINT,NULL::VARCHAR,NULL::VARCHAR,NULL::TIMESTAMPTZ,c.return_path,NULL::INTEGER;
  RETURN;
 END IF;
 IF u.email_verificado_en IS NULL THEN
  RETURN QUERY SELECT 'PENDING_VERIFICATION'::VARCHAR,NULL::BIGINT,NULL::VARCHAR,NULL::VARCHAR,NULL::TIMESTAMPTZ,NULL::VARCHAR,NULL::INTEGER;
  RETURN;
 END IF;
 IF NOT pliego.fn_auth_session_create_identity_checked(actor,p_refresh_hash,p_session_expires,u.password_hash,u.email_normalizado) THEN RETURN; END IF;
 SELECT * INTO STRICT s FROM pliego.sesion_autenticacion WHERE token_refresco_hash=p_refresh_hash;
 UPDATE pliego.registro_continuacion SET fecha_uso=clock_timestamp(),sesion_id=s.sesion_id WHERE token_hash=p_hash;
 RETURN QUERY SELECT 'AUTHENTICATED'::VARCHAR,u.usuario_id,u.email_normalizado,u.rol,s.fecha_expiracion,c.return_path,NULL::INTEGER;
END; $$;


CREATE OR REPLACE FUNCTION pliego.fn_registration_session_invalidate(p_user BIGINT,p_hash VARCHAR) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE actor BIGINT;
BEGIN
 DELETE FROM pliego.registro_continuacion_neutral WHERE token_hash=p_hash;
 actor:=p_user;
 IF actor IS NULL THEN SELECT usuario_id INTO actor FROM pliego.registro_continuacion WHERE token_hash=p_hash; END IF;
 IF actor IS NULL THEN RETURN; END IF;
 PERFORM 1 FROM pliego.usuario WHERE usuario_id=actor FOR UPDATE;
 DELETE FROM pliego.registro_continuacion WHERE usuario_id=actor;
END; $$;

REVOKE ALL ON TABLE pliego.registro_intento_limite,pliego.registro_continuacion_neutral FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_registration_attempt_admit(VARCHAR,VARCHAR),
 pliego.fn_registration_attempt_cleanup(),pliego.fn_registration_decoy_issue(VARCHAR),pliego.fn_registration_decoy_cleanup() FROM PUBLIC;
REVOKE ALL ON PROCEDURE pliego.sp_customer_register_neutral(VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE pliego.registro_intento_limite,pliego.registro_continuacion_neutral TO pliego_app;
  GRANT EXECUTE ON FUNCTION pliego.fn_registration_attempt_admit(VARCHAR,VARCHAR),
   pliego.fn_registration_attempt_cleanup(),pliego.fn_registration_decoy_issue(VARCHAR),pliego.fn_registration_decoy_cleanup() TO pliego_app;
  GRANT EXECUTE ON PROCEDURE pliego.sp_customer_register_neutral(VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR) TO pliego_app;
 END IF;
END $grants$;
