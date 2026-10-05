-- Forward-only transactional email infrastructure. No raw action tokens are persisted.
ALTER TABLE pliego.usuario ADD COLUMN email_verificado_en TIMESTAMPTZ;
UPDATE pliego.usuario SET email_verificado_en=fecha_creacion;

CREATE TABLE pliego.correo_token (
 usuario_id BIGINT NOT NULL REFERENCES pliego.usuario(usuario_id) ON DELETE CASCADE,
 tipo VARCHAR(24) NOT NULL CHECK(tipo IN ('VERIFY_EMAIL','RESET_PASSWORD')),
 token_hash VARCHAR(64) NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 email VARCHAR(254) NOT NULL,
 fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 fecha_expiracion TIMESTAMPTZ NOT NULL,
 fecha_uso TIMESTAMPTZ,
 PRIMARY KEY(usuario_id,tipo)
);
CREATE TABLE pliego.correo_outbox (
 correo_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 evento_clave VARCHAR(160) NOT NULL UNIQUE,
 tipo VARCHAR(24) NOT NULL CHECK(tipo IN ('VERIFY_EMAIL','RESET_PASSWORD','ORDER_CONFIRMED')),
 usuario_id BIGINT NOT NULL REFERENCES pliego.usuario(usuario_id),
 destinatario VARCHAR(254) NOT NULL CHECK(destinatario !~ '[\r\n]'),
 datos JSONB NOT NULL CHECK(jsonb_typeof(datos)='object'),
 token_hash VARCHAR(64),
 estado VARCHAR(8) NOT NULL DEFAULT 'PENDING' CHECK(estado IN ('PENDING','SENDING','SENT','FAILED')),
 intentos INTEGER NOT NULL DEFAULT 0 CHECK(intentos BETWEEN 0 AND 5),
 proximo_intento TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 propietario UUID,
 lease_hasta TIMESTAMPTZ,
 fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 fecha_envio TIMESTAMPTZ,
 ultimo_error VARCHAR(80) CHECK(ultimo_error IS NULL OR ultimo_error ~ '^[A-Z0-9_]+$')
);
CREATE INDEX ix_correo_outbox_pendiente ON pliego.correo_outbox(proximo_intento,correo_id) WHERE estado='PENDING';
CREATE INDEX ix_correo_outbox_lease ON pliego.correo_outbox(lease_hasta) WHERE estado='SENDING';
CREATE INDEX ix_correo_outbox_token ON pliego.correo_outbox(usuario_id,tipo) WHERE estado='PENDING';
CREATE TABLE pliego.correo_limite (
 clave VARCHAR(80) PRIMARY KEY,
 ventana TIMESTAMPTZ NOT NULL,
 solicitudes INTEGER NOT NULL
);
CREATE INDEX ix_correo_limite_ventana ON pliego.correo_limite(ventana);

CREATE FUNCTION pliego.fn_email_rate_limit(p_key VARCHAR,p_max INTEGER) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE n INTEGER;
BEGIN
 INSERT INTO pliego.correo_limite AS l VALUES(p_key,clock_timestamp(),1)
 ON CONFLICT(clave) DO UPDATE SET
 solicitudes=CASE WHEN l.ventana<clock_timestamp()-INTERVAL '1 hour' THEN 1 ELSE l.solicitudes+1 END,
 ventana=CASE WHEN l.ventana<clock_timestamp()-INTERVAL '1 hour' THEN clock_timestamp() ELSE l.ventana END
 RETURNING solicitudes INTO n;
 -- Limits are persisted even for nonexistent accounts, and old buckets are bounded in time.
 DELETE FROM pliego.correo_limite WHERE ventana<clock_timestamp()-INTERVAL '2 hours';
 RETURN n<=p_max;
END; $$;

CREATE FUNCTION pliego.fn_email_action_enqueue(p_user BIGINT,p_type VARCHAR,p_hash VARCHAR,p_nonce VARCHAR)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE v_email VARCHAR; v_expires TIMESTAMPTZ;
BEGIN
 IF p_type NOT IN ('VERIFY_EMAIL','RESET_PASSWORD') OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
 OR p_nonce IS NULL OR p_nonce !~ '^[A-Za-z0-9_-]{43}$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 SELECT email_normalizado INTO STRICT v_email FROM pliego.usuario WHERE usuario_id=p_user FOR UPDATE;
 v_expires:=CURRENT_TIMESTAMP+CASE WHEN p_type='VERIFY_EMAIL' THEN INTERVAL '24 hours' ELSE INTERVAL '15 minutes' END;
 UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='ACTION_SUPERSEDED',fecha_actualizacion=CURRENT_TIMESTAMP
 WHERE usuario_id=p_user AND tipo=p_type AND estado='PENDING';
 DELETE FROM pliego.correo_token WHERE usuario_id=p_user AND tipo=p_type;
 INSERT INTO pliego.correo_token(usuario_id,tipo,token_hash,email,fecha_expiracion)
 VALUES(p_user,p_type,p_hash,v_email,v_expires);
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,token_hash)
 VALUES(p_type||':'||p_hash,p_type,p_user,v_email,jsonb_build_object('nonce',p_nonce,'expiresAt',v_expires),p_hash);
END; $$;

CREATE PROCEDURE pliego.sp_customer_register_with_verification(
 IN p_email VARCHAR,IN p_password_hash VARCHAR,IN p_first_names VARCHAR,IN p_last_names VARCHAR,IN p_phone VARCHAR,
 IN p_token_hash VARCHAR,IN p_nonce VARCHAR,OUT o_user_id BIGINT,OUT o_customer_id BIGINT,OUT o_user_state VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 CALL pliego.sp_customer_register(p_email,p_password_hash,p_first_names,p_last_names,p_phone,o_user_id,o_customer_id,o_user_state);
 PERFORM pliego.fn_email_action_enqueue(o_user_id,'VERIFY_EMAIL',p_token_hash,p_nonce);
 o_user_state:='PENDING_VERIFICATION';
END; $$;

CREATE OR REPLACE FUNCTION pliego.fn_user_auth_data(p_email VARCHAR)
RETURNS TABLE(user_id BIGINT,email_canonical VARCHAR,password_hash VARCHAR,role VARCHAR,state VARCHAR)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT u.usuario_id,u.email_normalizado,u.password_hash,u.rol,
 (CASE WHEN u.estado='ACTIVE' AND u.rol='CUSTOMER' AND u.email_verificado_en IS NULL THEN 'UNVERIFIED' ELSE u.estado END)::VARCHAR
 FROM pliego.usuario u WHERE u.email_normalizado=pliego.fn_normalize_email(p_email);
$$;

CREATE FUNCTION pliego.fn_auth_session_create_checked(p_user BIGINT,p_refresh_hash VARCHAR,p_expires TIMESTAMPTZ,p_password_hash VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE u pliego.usuario%ROWTYPE;
BEGIN
 SELECT * INTO u FROM pliego.usuario WHERE usuario_id=p_user FOR UPDATE;
 -- Serialize login with password reset/email changes; don't issue a fresh session from a stale BCrypt check.
 IF NOT FOUND OR u.estado<>'ACTIVE' OR u.password_hash IS DISTINCT FROM p_password_hash
 OR (u.rol='CUSTOMER' AND u.email_verificado_en IS NULL) THEN RETURN FALSE; END IF;
 PERFORM pliego.fn_auth_session_create(p_user,p_refresh_hash,p_expires);
 RETURN TRUE;
END; $$;

CREATE FUNCTION pliego.fn_email_action_request(p_email VARCHAR,p_type VARCHAR,p_hash VARCHAR,p_nonce VARCHAR,p_request_hash VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE u pliego.usuario%ROWTYPE; ip_ok BOOLEAN; email_ok BOOLEAN;
BEGIN
 IF p_email IS NULL OR p_type NOT IN ('VERIFY_EMAIL','RESET_PASSWORD') OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 -- Apply IP quota first to bound email-bucket creation under abuse, before account lookup.
 ip_ok:=pliego.fn_email_rate_limit(('IP:'||p_request_hash)::VARCHAR,20);
 IF NOT ip_ok THEN RETURN FALSE; END IF;
 email_ok:=pliego.fn_email_rate_limit(('EMAIL:'||encode(sha256(convert_to(pliego.fn_normalize_email(p_email),'UTF8')),'hex'))::VARCHAR,5);
 IF NOT ip_ok OR NOT email_ok THEN RETURN FALSE; END IF;
 SELECT * INTO u FROM pliego.usuario WHERE email_normalizado=pliego.fn_normalize_email(p_email) FOR UPDATE;
 IF NOT FOUND OR u.estado<>'ACTIVE' THEN RETURN FALSE; END IF;
 IF p_type='VERIFY_EMAIL' AND (u.rol<>'CUSTOMER' OR u.email_verificado_en IS NOT NULL) THEN RETURN FALSE; END IF;
 IF p_type='RESET_PASSWORD' AND u.email_verificado_en IS NULL THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT FROM pliego.correo_token WHERE usuario_id=u.usuario_id AND tipo=p_type
   AND fecha_creacion>CURRENT_TIMESTAMP-INTERVAL '1 minute') THEN RETURN FALSE; END IF;
 PERFORM pliego.fn_email_action_enqueue(u.usuario_id,p_type,p_hash,p_nonce);
 RETURN TRUE;
END; $$;

CREATE FUNCTION pliego.fn_email_verification_for_user(p_user BIGINT,p_hash VARCHAR,p_nonce VARCHAR)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_user,'CUSTOMER');
 PERFORM 1 FROM pliego.usuario WHERE usuario_id=p_user FOR UPDATE;
 -- Distinct authenticated quota avoids a lock inversion with public email/IP buckets.
 IF NOT pliego.fn_email_rate_limit(('USER:'||p_user)::VARCHAR,5) THEN RETURN; END IF;
 IF EXISTS(SELECT FROM pliego.usuario WHERE usuario_id=p_user AND email_verificado_en IS NULL) THEN
  PERFORM pliego.fn_email_action_enqueue(p_user,'VERIFY_EMAIL',p_hash,p_nonce);
 END IF;
END; $$;

CREATE FUNCTION pliego.fn_email_action_consume(p_type VARCHAR,p_hash VARCHAR,p_password_hash VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE v_user BIGINT; t pliego.correo_token%ROWTYPE; u pliego.usuario%ROWTYPE;
BEGIN
 IF p_type NOT IN ('VERIFY_EMAIL','RESET_PASSWORD') OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RETURN FALSE; END IF;
 SELECT usuario_id INTO v_user FROM pliego.correo_token WHERE token_hash=p_hash AND tipo=p_type;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 -- All writers lock user before token/outbox to avoid inversions under resend/reset/email change.
 SELECT * INTO u FROM pliego.usuario WHERE usuario_id=v_user FOR UPDATE;
 SELECT * INTO t FROM pliego.correo_token WHERE usuario_id=v_user AND tipo=p_type AND token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR t.fecha_uso IS NOT NULL OR t.fecha_expiracion<=CURRENT_TIMESTAMP OR t.email<>u.email_normalizado
 OR u.estado<>'ACTIVE' THEN RETURN FALSE; END IF;
 IF p_type='RESET_PASSWORD' AND (p_password_hash IS NULL OR btrim(p_password_hash)='') THEN RETURN FALSE; END IF;
 UPDATE pliego.correo_token SET fecha_uso=CURRENT_TIMESTAMP WHERE usuario_id=v_user AND tipo=p_type;
 IF p_type='VERIFY_EMAIL' THEN
  UPDATE pliego.usuario SET email_verificado_en=CURRENT_TIMESTAMP WHERE usuario_id=v_user;
 ELSE
  UPDATE pliego.usuario SET password_hash=p_password_hash WHERE usuario_id=v_user;
  UPDATE pliego.sesion_autenticacion SET fecha_revocacion=COALESCE(fecha_revocacion,CURRENT_TIMESTAMP) WHERE usuario_id=v_user;
  UPDATE pliego.correo_token SET fecha_uso=COALESCE(fecha_uso,CURRENT_TIMESTAMP) WHERE usuario_id=v_user;
 END IF;
 UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='ACTION_CONSUMED',fecha_actualizacion=CURRENT_TIMESTAMP
 WHERE usuario_id=v_user AND estado='PENDING' AND (tipo=p_type OR (p_type='RESET_PASSWORD' AND token_hash IS NOT NULL));
 RETURN TRUE;
END; $$;

CREATE FUNCTION pliego.fn_invalidate_changed_email() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.email_normalizado IS DISTINCT FROM OLD.email_normalizado THEN
  NEW.email_verificado_en:=NULL;
  DELETE FROM pliego.correo_token WHERE usuario_id=OLD.usuario_id;
  UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='EMAIL_CHANGED',fecha_actualizacion=CURRENT_TIMESTAMP
  WHERE usuario_id=OLD.usuario_id AND token_hash IS NOT NULL AND estado='PENDING';
  UPDATE pliego.sesion_autenticacion SET fecha_revocacion=COALESCE(fecha_revocacion,CURRENT_TIMESTAMP) WHERE usuario_id=OLD.usuario_id;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION pliego.fn_customer_password_hash(p_actor_user_id BIGINT)
RETURNS VARCHAR LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE v_hash VARCHAR;
BEGIN
 -- Hold the user lock through Spring's reauthentication + email-change transaction.
 -- A reset cannot replace the password between BCrypt verification and the sensitive write.
 SELECT u.password_hash INTO v_hash FROM pliego.usuario u WHERE u.usuario_id=p_actor_user_id FOR UPDATE;
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER');
 RETURN v_hash;
END; $$;
CREATE TRIGGER trg_usuario_email_verification BEFORE UPDATE OF email_normalizado ON pliego.usuario
FOR EACH ROW EXECUTE FUNCTION pliego.fn_invalidate_changed_email();

-- Capture after the full V033 checkout: product and delivery snapshots now exist.
ALTER PROCEDURE pliego.sp_checkout(BIGINT,BIGINT,VARCHAR,VARCHAR) RENAME TO sp_checkout_internal_v033;
CREATE PROCEDURE pliego.sp_checkout(IN p_actor_user_id BIGINT,IN p_address_id BIGINT,IN p_payment_method VARCHAR,IN p_payment_outcome VARCHAR,
 OUT o_order_id BIGINT,OUT o_order_state VARCHAR,OUT o_payment_state VARCHAR,OUT o_total NUMERIC,OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 CALL pliego.sp_checkout_internal_v033(p_actor_user_id,p_address_id,p_payment_method,p_payment_outcome,o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
 IF o_order_state='CONFIRMED' THEN
  INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
  SELECT 'ORDER_CONFIRMED:'||p.pedido_id,'ORDER_CONFIRMED',u.usuario_id,u.email_normalizado,
   jsonb_build_object('orderId',p.pedido_id::TEXT,'date',p.fecha_creacion,'subtotal',p.subtotal::TEXT,'total',p.total::TEXT,
   'items',(SELECT jsonb_agg(jsonb_build_object('title',i.titulo_snapshot,'quantity',i.cantidad,'unitPrice',i.precio_unitario::TEXT,'subtotal',i.subtotal::TEXT) ORDER BY i.pedido_item_id) FROM pliego.pedido_item i WHERE i.pedido_id=p.pedido_id),
   'delivery',(SELECT jsonb_build_object('recipient',d.destinatario,'line1',d.direccion_linea1,'line2',d.direccion_linea2,'city',d.ciudad,'province',d.provincia,'country',d.pais_codigo,'postalCode',d.codigo_postal) FROM pliego.pedido_direccion d WHERE d.pedido_id=p.pedido_id AND EXISTS(SELECT FROM pliego.pedido_entrega e WHERE e.pedido_id=p.pedido_id)))
  FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id)
  WHERE p.pedido_id=o_order_id ON CONFLICT(evento_clave) DO NOTHING;
 END IF;
END; $$;

CREATE FUNCTION pliego.fn_mail_outbox_claim()
RETURNS SETOF pliego.correo_outbox LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE v_id BIGINT;
BEGIN
 UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='AMBIGUOUS_DELIVERY',fecha_actualizacion=clock_timestamp(),propietario=NULL,lease_hasta=NULL
 WHERE estado='SENDING' AND lease_hasta<clock_timestamp();
 UPDATE pliego.correo_outbox o SET estado='FAILED',ultimo_error='ACTION_EXPIRED',fecha_actualizacion=clock_timestamp()
 WHERE o.estado='PENDING' AND o.token_hash IS NOT NULL AND NOT EXISTS(
  SELECT FROM pliego.correo_token t WHERE t.token_hash=o.token_hash AND t.fecha_uso IS NULL AND t.fecha_expiracion>clock_timestamp());
 SELECT correo_id INTO v_id FROM pliego.correo_outbox WHERE estado='PENDING' AND proximo_intento<=clock_timestamp() AND intentos<5
 ORDER BY proximo_intento,correo_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY UPDATE pliego.correo_outbox SET estado='SENDING',intentos=intentos+1,propietario=uuidv4(),
 lease_hasta=clock_timestamp()+INTERVAL '60 seconds',fecha_actualizacion=clock_timestamp() WHERE correo_id=v_id RETURNING *;
END; $$;

CREATE FUNCTION pliego.fn_mail_outbox_complete(p_id BIGINT,p_owner UUID,p_result VARCHAR,p_error VARCHAR)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 IF p_result NOT IN ('SENT','RETRY','FAILED') OR (p_error IS NOT NULL AND p_error !~ '^[A-Z0-9_]{1,80}$') THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 UPDATE pliego.correo_outbox SET
 estado=CASE WHEN p_result='SENT' THEN 'SENT' WHEN p_result='RETRY' AND intentos<5 THEN 'PENDING' ELSE 'FAILED' END,
 proximo_intento=clock_timestamp()+make_interval(secs=>30*power(2,intentos-1)::INTEGER),
 fecha_actualizacion=clock_timestamp(),fecha_envio=CASE WHEN p_result='SENT' THEN clock_timestamp() END,
 ultimo_error=CASE WHEN p_result='SENT' THEN NULL ELSE p_error END,propietario=NULL,lease_hasta=NULL,
 -- Discard nonce once sending is terminal; only hashes remain in action storage.
 datos=CASE WHEN token_hash IS NOT NULL AND (p_result<>'RETRY' OR intentos>=5) THEN datos-'nonce' ELSE datos END
 WHERE correo_id=p_id AND propietario=p_owner AND estado='SENDING';
END; $$;
