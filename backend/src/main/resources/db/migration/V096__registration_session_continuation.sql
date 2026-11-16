-- ADR 0050. A registration credential proves browser continuity, never email ownership.
CREATE TABLE pliego.registro_continuacion (
 token_hash VARCHAR(64) PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 usuario_id BIGINT NOT NULL UNIQUE REFERENCES pliego.usuario(usuario_id) ON DELETE CASCADE,
 email VARCHAR(254) NOT NULL,
 return_path VARCHAR(2048),
 fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 fecha_expiracion TIMESTAMPTZ NOT NULL,
 fecha_uso TIMESTAMPTZ,
 sesion_id UUID REFERENCES pliego.sesion_autenticacion(sesion_id) ON DELETE CASCADE,
 CHECK(fecha_expiracion>fecha_creacion AND fecha_expiracion<=fecha_creacion+INTERVAL '24 hours'),
 CHECK((fecha_uso IS NULL)=(sesion_id IS NULL))
);
CREATE INDEX ix_registro_continuacion_expiracion ON pliego.registro_continuacion(fecha_expiracion);
CREATE INDEX ix_registro_continuacion_sesion ON pliego.registro_continuacion(sesion_id);

-- Keep these buckets separate from email delivery buckets: no cleanup of unrelated locked IP rows.
CREATE TABLE pliego.registro_continuacion_limite (
 clave VARCHAR(80) PRIMARY KEY,
 ventana TIMESTAMPTZ NOT NULL,
 solicitudes INTEGER NOT NULL
);
CREATE FUNCTION pliego.fn_registration_session_rate_limit(p_key VARCHAR,p_max INTEGER) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE n INTEGER;
BEGIN
 INSERT INTO pliego.registro_continuacion_limite AS l VALUES(p_key,clock_timestamp(),1)
 ON CONFLICT(clave) DO UPDATE SET
 solicitudes=CASE WHEN l.ventana<clock_timestamp()-INTERVAL '1 hour' THEN 1 ELSE l.solicitudes+1 END,
 ventana=CASE WHEN l.ventana<clock_timestamp()-INTERVAL '1 hour' THEN clock_timestamp() ELSE l.ventana END
 RETURNING solicitudes INTO n;
 RETURN n<=p_max;
END; $$;

CREATE FUNCTION pliego.fn_registration_session_issue(p_user BIGINT,p_hash VARCHAR,p_return_path VARCHAR)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE u pliego.usuario%ROWTYPE; expiry TIMESTAMPTZ;
BEGIN
 SELECT * INTO u FROM pliego.usuario WHERE usuario_id=p_user FOR UPDATE;
 IF NOT FOUND OR u.estado<>'ACTIVE' OR u.rol<>'CUSTOMER' OR u.email_verificado_en IS NOT NULL
 OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 SELECT fecha_expiracion INTO expiry FROM pliego.correo_token WHERE usuario_id=p_user
  AND tipo='VERIFY_EMAIL' AND email=u.email_normalizado
  AND fecha_uso IS NULL AND fecha_expiracion>clock_timestamp();
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 -- Defense in depth: the application applies the full AuthReturnPaths allowlist.
 IF p_return_path IS NOT NULL AND (length(p_return_path)>2048 OR p_return_path !~ '^/[^/]' AND p_return_path<>'/'
  OR p_return_path ~ '[\r\n\\]' OR split_part(split_part(p_return_path,'?',1),'#',1) !~ '^/(catalog(/editions/[1-9][0-9]{0,18})?|ofertas|favorites|cart|checkout|account(/addresses)?|(orders|biblioteca)(/[1-9][0-9]{0,18})?)?/?$') THEN
  p_return_path:=NULL;
 END IF;
 DELETE FROM pliego.registro_continuacion WHERE fecha_expiracion<clock_timestamp()-INTERVAL '1 day';
 INSERT INTO pliego.registro_continuacion(token_hash,usuario_id,email,return_path,fecha_expiracion)
 VALUES(p_hash,p_user,u.email_normalizado,p_return_path,LEAST(expiry,clock_timestamp()+INTERVAL '24 hours'));
 RETURN expiry;
END; $$;

CREATE FUNCTION pliego.fn_registration_session_exchange_internal(p_hash VARCHAR,p_refresh_hash VARCHAR,p_session_expires TIMESTAMPTZ,p_ip_retry_after INTEGER DEFAULT NULL)
RETURNS TABLE(state VARCHAR,user_id BIGINT,email_canonical VARCHAR,role VARCHAR,expires_at TIMESTAMPTZ,return_path VARCHAR,retry_after_seconds INTEGER)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE actor BIGINT; u pliego.usuario%ROWTYPE; c pliego.registro_continuacion%ROWTYPE; s pliego.sesion_autenticacion%ROWTYPE;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
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

-- Every browser continuation entry point acquires the IP bucket BEFORE the user lock.
CREATE FUNCTION pliego.fn_registration_session_exchange(p_hash VARCHAR,p_refresh_hash VARCHAR,p_session_expires TIMESTAMPTZ,p_request_hash VARCHAR)
RETURNS TABLE(state VARCHAR,user_id BIGINT,email_canonical VARCHAR,role VARCHAR,expires_at TIMESTAMPTZ,return_path VARCHAR,retry_after_seconds INTEGER)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE retry_after INTEGER;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
 IF NOT pliego.fn_registration_session_rate_limit(('REGIP:'||p_request_hash)::VARCHAR,1200) THEN
  SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM (l.ventana+INTERVAL '1 hour'-clock_timestamp())))::INTEGER)
   INTO retry_after FROM pliego.registro_continuacion_limite l WHERE l.clave='REGIP:'||p_request_hash;
 END IF;
 RETURN QUERY SELECT * FROM pliego.fn_registration_session_exchange_internal(p_hash,p_refresh_hash,p_session_expires,retry_after);
END; $$;

-- Token proof and optional continuation exchange form a single Spring-owned transaction.
CREATE FUNCTION pliego.fn_registration_verify_exchange(p_verification_hash VARCHAR,p_hash VARCHAR,p_refresh_hash VARCHAR,p_session_expires TIMESTAMPTZ,p_request_hash VARCHAR)
RETURNS TABLE(state VARCHAR,user_id BIGINT,email_canonical VARCHAR,role VARCHAR,expires_at TIMESTAMPTZ,return_path VARCHAR,retry_after_seconds INTEGER)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE actor BIGINT; cookie_actor BIGINT; ip_ok BOOLEAN:=FALSE;
BEGIN
 IF p_hash ~ '^[0-9a-f]{64}$' AND p_request_hash ~ '^[0-9a-f]{64}$' THEN
  ip_ok:=pliego.fn_registration_session_rate_limit(('REGIP:'||p_request_hash)::VARCHAR,1200);
 END IF;
 SELECT usuario_id INTO actor FROM pliego.correo_token WHERE token_hash=p_verification_hash AND tipo='VERIFY_EMAIL';
 IF actor IS NULL THEN RETURN; END IF;
 PERFORM 1 FROM pliego.usuario WHERE usuario_id=actor FOR UPDATE;
 IF NOT pliego.fn_email_action_consume('VERIFY_EMAIL',p_verification_hash,NULL) THEN RETURN; END IF;
 SELECT usuario_id INTO cookie_actor FROM pliego.registro_continuacion WHERE token_hash=p_hash;
 IF cookie_actor=actor AND ip_ok THEN
  RETURN QUERY SELECT * FROM pliego.fn_registration_session_exchange_internal(p_hash,p_refresh_hash,p_session_expires);
  IF FOUND THEN RETURN; END IF;
 END IF;
 RETURN QUERY SELECT 'VERIFIED'::VARCHAR,NULL::BIGINT,NULL::VARCHAR,NULL::VARCHAR,NULL::TIMESTAMPTZ,NULL::VARCHAR,NULL::INTEGER;
END; $$;

CREATE FUNCTION pliego.fn_registration_session_invalidate(p_user BIGINT,p_hash VARCHAR) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE actor BIGINT;
BEGIN
 actor:=p_user;
 IF actor IS NULL THEN SELECT usuario_id INTO actor FROM pliego.registro_continuacion WHERE token_hash=p_hash; END IF;
 IF actor IS NULL THEN RETURN; END IF;
 PERFORM 1 FROM pliego.usuario WHERE usuario_id=actor FOR UPDATE;
 DELETE FROM pliego.registro_continuacion WHERE usuario_id=actor;
END; $$;

-- User-level session fencing must use this Database API, never an uncoordinated session UPDATE.
CREATE FUNCTION pliego.fn_auth_session_revoke_all(p_user BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 PERFORM 1 FROM pliego.usuario WHERE usuario_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 DELETE FROM pliego.registro_continuacion WHERE usuario_id=p_user;
 UPDATE pliego.sesion_autenticacion SET fecha_revocacion=COALESCE(fecha_revocacion,clock_timestamp()) WHERE usuario_id=p_user;
END; $$;

-- Reset revokes continuation even if an internal caller supplies the existing password hash.
ALTER FUNCTION pliego.fn_email_action_consume(VARCHAR,VARCHAR,VARCHAR) RENAME TO fn_email_action_consume_internal_v095;
CREATE FUNCTION pliego.fn_email_action_consume(p_type VARCHAR,p_hash VARCHAR,p_password_hash VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE actor BIGINT; consumed BOOLEAN;
BEGIN
 IF p_type='RESET_PASSWORD' THEN SELECT usuario_id INTO actor FROM pliego.correo_token WHERE token_hash=p_hash AND tipo=p_type; END IF;
 consumed:=pliego.fn_email_action_consume_internal_v095(p_type,p_hash,p_password_hash);
 IF consumed AND p_type='RESET_PASSWORD' THEN DELETE FROM pliego.registro_continuacion WHERE usuario_id=actor; END IF;
 RETURN consumed;
END; $$;

CREATE FUNCTION pliego.fn_registration_session_fence() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.email_normalizado IS DISTINCT FROM OLD.email_normalizado OR NEW.password_hash IS DISTINCT FROM OLD.password_hash
 OR NEW.estado IS DISTINCT FROM OLD.estado OR NEW.rol IS DISTINCT FROM OLD.rol THEN
  DELETE FROM pliego.registro_continuacion WHERE usuario_id=OLD.usuario_id;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER tg_registration_session_fence BEFORE UPDATE ON pliego.usuario
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_registration_session_fence();

REVOKE ALL ON TABLE pliego.registro_continuacion,pliego.registro_continuacion_limite FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_registration_session_issue(BIGINT,VARCHAR,VARCHAR),
 pliego.fn_registration_session_exchange(VARCHAR,VARCHAR,TIMESTAMPTZ,VARCHAR),
 pliego.fn_registration_session_exchange_internal(VARCHAR,VARCHAR,TIMESTAMPTZ,INTEGER),pliego.fn_registration_session_rate_limit(VARCHAR,INTEGER),
 pliego.fn_registration_verify_exchange(VARCHAR,VARCHAR,VARCHAR,TIMESTAMPTZ,VARCHAR),
 pliego.fn_registration_session_invalidate(BIGINT,VARCHAR),pliego.fn_registration_session_fence(),
 pliego.fn_email_action_consume(VARCHAR,VARCHAR,VARCHAR),pliego.fn_auth_session_revoke_all(BIGINT) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE pliego.registro_continuacion,pliego.registro_continuacion_limite TO pliego_app;
  GRANT EXECUTE ON FUNCTION pliego.fn_registration_session_issue(BIGINT,VARCHAR,VARCHAR),
   pliego.fn_registration_session_exchange(VARCHAR,VARCHAR,TIMESTAMPTZ,VARCHAR),
 pliego.fn_registration_session_exchange_internal(VARCHAR,VARCHAR,TIMESTAMPTZ,INTEGER),pliego.fn_registration_session_rate_limit(VARCHAR,INTEGER),
   pliego.fn_registration_verify_exchange(VARCHAR,VARCHAR,VARCHAR,TIMESTAMPTZ,VARCHAR),
   pliego.fn_registration_session_invalidate(BIGINT,VARCHAR),pliego.fn_registration_session_fence(),
   pliego.fn_email_action_consume(VARCHAR,VARCHAR,VARCHAR),pliego.fn_email_action_consume_internal_v095(VARCHAR,VARCHAR,VARCHAR),
   pliego.fn_auth_session_revoke_all(BIGINT) TO pliego_app;
 END IF;
END $grants$;
