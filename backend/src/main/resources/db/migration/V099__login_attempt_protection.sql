-- ADR 0053. No identity FK: unknown and known accounts have identical admission state.
CREATE TABLE pliego.login_intento_limite (
 clave VARCHAR(67) PRIMARY KEY CHECK (clave ~ '^(IP|AC|AP):[0-9a-f]{64}$'),
 expira TIMESTAMPTZ NOT NULL,
 solicitudes INTEGER NOT NULL CHECK (solicitudes >= 1),
 verificaciones INTEGER NOT NULL DEFAULT 0 CHECK (verificaciones >= 0),
 fallos INTEGER NOT NULL DEFAULT 0 CHECK (fallos >= 0),
 bloqueado_hasta TIMESTAMPTZ
);
CREATE INDEX ix_login_intento_limite_expira ON pliego.login_intento_limite(expira,clave);

-- Spring outcome transaction: AP -> user -> INSERT new session -> continuation.
-- Existing-session operations retain user -> continuation -> existing session;
-- the new session is invisible until commit and never locks a refresh session.
-- While holding AP, call the separately committed admission transaction: IP -> AC.
-- Admission never reads/locks AP or auth rows; no IP/AC lock survives into BCrypt.
-- Never begin admission after acquiring a user/continuation/session lock.
CREATE FUNCTION pliego.fn_login_attempt_pair_begin(p_email VARCHAR,p_ip_hash VARCHAR)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE account_hash TEXT; pair_key VARCHAR; bucket pliego.login_intento_limite%ROWTYPE;
BEGIN
 IF p_email IS NULL OR pliego.fn_normalize_email(p_email) IS NULL
 OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 account_hash:=encode(sha256(convert_to(pliego.fn_normalize_email(p_email),'UTF8')),'hex');
 pair_key:='AP:'||encode(sha256(convert_to(account_hash||':'||p_ip_hash,'UTF8')),'hex');
 INSERT INTO pliego.login_intento_limite AS l(clave,expira,solicitudes)
 VALUES(pair_key,clock_timestamp()+INTERVAL '15 minutes',1)
 ON CONFLICT(clave) DO UPDATE SET
 solicitudes=CASE WHEN l.expira<=clock_timestamp() THEN 1 ELSE LEAST(l.solicitudes,2147483646)+1 END,
 fallos=CASE WHEN l.expira<=clock_timestamp() THEN 0 ELSE l.fallos END,
 bloqueado_hasta=CASE WHEN l.expira<=clock_timestamp() THEN NULL ELSE l.bloqueado_hasta END,
 expira=CASE WHEN l.expira<=clock_timestamp() THEN clock_timestamp()+INTERVAL '15 minutes' ELSE l.expira END
 RETURNING * INTO bucket;
 -- The outer transaction retains ONLY this pair row through password/session work.
 RETURN bucket.bloqueado_hasta;
END; $$;

CREATE FUNCTION pliego.fn_login_attempt_admit(p_email VARCHAR,p_ip_hash VARCHAR,p_pair_blocked_until TIMESTAMPTZ)
RETURNS INTEGER LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE account_hash TEXT; bucket pliego.login_intento_limite%ROWTYPE;
 now_at TIMESTAMPTZ; retry_at TIMESTAMPTZ:=p_pair_blocked_until;
BEGIN
 IF p_email IS NULL OR pliego.fn_normalize_email(p_email) IS NULL
 OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 account_hash:=encode(sha256(convert_to(pliego.fn_normalize_email(p_email),'UTF8')),'hex');
 IF p_pair_blocked_until IS NOT NULL AND NOT isfinite(p_pair_blocked_until) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 -- Independent short Spring transaction, always IP -> AC. It must not acquire AP.
 -- clock_timestamp is read after each UPSERT lock wait, including window rollover.
 INSERT INTO pliego.login_intento_limite AS l(clave,expira,solicitudes)
 VALUES('IP:'||p_ip_hash,clock_timestamp()+INTERVAL '10 minutes',1)
 ON CONFLICT(clave) DO UPDATE SET
 solicitudes=CASE WHEN l.expira<=clock_timestamp() THEN 1 ELSE LEAST(l.solicitudes,2147483646)+1 END,
 verificaciones=CASE WHEN l.expira<=clock_timestamp() THEN 0 ELSE l.verificaciones END,
 expira=CASE WHEN l.expira<=clock_timestamp() THEN clock_timestamp()+INTERVAL '10 minutes' ELSE l.expira END
 RETURNING * INTO bucket;
 IF bucket.verificaciones>=600 THEN retry_at:=GREATEST(retry_at,bucket.expira); END IF;

 INSERT INTO pliego.login_intento_limite AS l(clave,expira,solicitudes)
 VALUES('AC:'||account_hash,clock_timestamp()+INTERVAL '15 minutes',1)
 ON CONFLICT(clave) DO UPDATE SET
 solicitudes=CASE WHEN l.expira<=clock_timestamp() THEN 1 ELSE LEAST(l.solicitudes,2147483646)+1 END,
 verificaciones=CASE WHEN l.expira<=clock_timestamp() THEN 0 ELSE l.verificaciones END,
 expira=CASE WHEN l.expira<=clock_timestamp() THEN clock_timestamp()+INTERVAL '15 minutes' ELSE l.expira END
 RETURNING * INTO bucket;
 IF bucket.verificaciones>=60 THEN retry_at:=GREATEST(retry_at,bucket.expira); END IF;

 now_at:=clock_timestamp();
 IF retry_at>now_at THEN
  -- All scopes count denials; existing windows/cooldowns are never extended.
  RETURN LEAST(3600,GREATEST(1,CEIL(EXTRACT(EPOCH FROM retry_at-now_at))::INTEGER));
 END IF;
 -- Only requests eligible in ALL three scopes consume expensive-work budgets.
 UPDATE pliego.login_intento_limite SET verificaciones=verificaciones+1 WHERE clave='IP:'||p_ip_hash;
 UPDATE pliego.login_intento_limite SET verificaciones=verificaciones+1 WHERE clave='AC:'||account_hash;
 RETURN 0;
END; $$;

CREATE FUNCTION pliego.fn_login_attempt_pair_reserve(p_email VARCHAR,p_ip_hash VARCHAR)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE account_hash TEXT; pair_key VARCHAR; bucket pliego.login_intento_limite%ROWTYPE;
 now_at TIMESTAMPTZ; delay_seconds INTEGER;
BEGIN
 IF p_email IS NULL OR pliego.fn_normalize_email(p_email) IS NULL
 OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 account_hash:=encode(sha256(convert_to(pliego.fn_normalize_email(p_email),'UTF8')),'hex');
 pair_key:='AP:'||encode(sha256(convert_to(account_hash||':'||p_ip_hash,'UTF8')),'hex');
 -- Called only after short admission committed. Reuses the outer transaction's AP lock.
 SELECT * INTO bucket FROM pliego.login_intento_limite WHERE clave=pair_key FOR UPDATE;
 now_at:=clock_timestamp();
 IF NOT FOUND THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 -- AP may expire while the short admission waits on another budget transaction.
 -- This request is already admitted; charge its failure to the new window once.
 -- Denied requests never reach reserve, so they cannot extend an active window.
 IF bucket.expira<=now_at THEN
  UPDATE pliego.login_intento_limite SET solicitudes=1,fallos=0,bloqueado_hasta=NULL,
   expira=now_at+INTERVAL '15 minutes' WHERE clave=pair_key RETURNING * INTO bucket;
 END IF;
 IF bucket.bloqueado_hasta>now_at THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 -- The reserved failure and success clearing remain atomic with the login outcome.
 delay_seconds:=CASE WHEN bucket.fallos<4 THEN 0 WHEN bucket.fallos=4 THEN 5
  WHEN bucket.fallos=5 THEN 15 WHEN bucket.fallos=6 THEN 30 WHEN bucket.fallos=7 THEN 60
  WHEN bucket.fallos=8 THEN 120 ELSE 300 END;
 UPDATE pliego.login_intento_limite SET fallos=LEAST(fallos,2147483646)+1,
  bloqueado_hasta=CASE WHEN delay_seconds=0 THEN NULL ELSE LEAST(expira,now_at+make_interval(secs=>delay_seconds)) END
 WHERE clave=pair_key;
END; $$;

CREATE FUNCTION pliego.fn_login_attempt_success(p_email VARCHAR,p_ip_hash VARCHAR)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 -- AP was acquired before user; IP/AC admission has already committed.
 -- Clearing participates in the same outcome transaction as the newly inserted session.
 -- Do not clear account/IP quotas: a valid credential must not bypass stuffing limits.
 UPDATE pliego.login_intento_limite SET fallos=0,bloqueado_hasta=NULL
 WHERE clave='AP:'||encode(sha256(convert_to(
  encode(sha256(convert_to(pliego.fn_normalize_email(p_email),'UTF8')),'hex')||':'||p_ip_hash,'UTF8')),'hex');
END; $$;

CREATE FUNCTION pliego.fn_login_attempt_cleanup() RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE removed INTEGER; cutoff TIMESTAMPTZ:=clock_timestamp();
BEGIN
 -- Separate maintenance transaction; never takes user/session/admission locks after this.
 WITH expired AS (
  SELECT clave FROM pliego.login_intento_limite WHERE expira<=cutoff
  ORDER BY expira,clave LIMIT 1000 FOR UPDATE SKIP LOCKED
 ) DELETE FROM pliego.login_intento_limite l USING expired e WHERE l.clave=e.clave;
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END; $$;

REVOKE ALL ON TABLE pliego.login_intento_limite FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_login_attempt_pair_begin(VARCHAR,VARCHAR),
 pliego.fn_login_attempt_admit(VARCHAR,VARCHAR,TIMESTAMPTZ),pliego.fn_login_attempt_pair_reserve(VARCHAR,VARCHAR),
 pliego.fn_login_attempt_success(VARCHAR,VARCHAR),pliego.fn_login_attempt_cleanup() FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE pliego.login_intento_limite TO pliego_app;
  GRANT EXECUTE ON FUNCTION pliego.fn_login_attempt_pair_begin(VARCHAR,VARCHAR),
 pliego.fn_login_attempt_admit(VARCHAR,VARCHAR,TIMESTAMPTZ),pliego.fn_login_attempt_pair_reserve(VARCHAR,VARCHAR),
   pliego.fn_login_attempt_success(VARCHAR,VARCHAR),pliego.fn_login_attempt_cleanup() TO pliego_app;
 END IF;
END $grants$;
