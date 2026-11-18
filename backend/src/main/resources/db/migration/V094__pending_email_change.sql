-- ADR 0049: the current identity remains authoritative until ownership of the new address is proven.
-- UUID identifies the address/version; only hashes and non-secret reconstruction nonces persist.
CREATE TABLE pliego.correo_cambio (
 cambio_id UUID PRIMARY KEY DEFAULT uuidv4(),
 usuario_id BIGINT NOT NULL REFERENCES pliego.usuario(usuario_id),
 email_actual VARCHAR(254) NOT NULL,
 email_pendiente VARCHAR(254) NOT NULL,
 estado VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK(estado IN('PENDING','SUPERSEDED','CANCELLED','CONFIRMED')),
 fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 fecha_expiracion TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+INTERVAL '24 hours',
 ultimo_envio_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 fecha_fin TIMESTAMPTZ,
 entrega_evento_en TIMESTAMPTZ,
 entrega_prioridad INTEGER CHECK(entrega_prioridad IN(1,2)),
 entrega_evento_id VARCHAR(128),
 no_entregable BOOLEAN NOT NULL DEFAULT FALSE,
 CHECK(email_actual<>email_pendiente),
 CHECK((estado='PENDING')=(fecha_fin IS NULL))
);
CREATE UNIQUE INDEX uq_correo_cambio_pendiente ON pliego.correo_cambio(usuario_id) WHERE estado='PENDING';
CREATE INDEX ix_correo_cambio_usuario ON pliego.correo_cambio(usuario_id,fecha_creacion DESC);
CREATE TABLE pliego.correo_cambio_token (
 token_hash VARCHAR(64) PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 cambio_id UUID NOT NULL REFERENCES pliego.correo_cambio(cambio_id),
 tipo VARCHAR(24) NOT NULL CHECK(tipo IN('EMAIL_CHANGE_CONFIRM','EMAIL_CHANGE_CANCEL')),
 nonce VARCHAR(43) NOT NULL CHECK(nonce ~ '^[A-Za-z0-9_-]{43}$'),
 invalidado_en TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_correo_cambio_token_activo ON pliego.correo_cambio_token(cambio_id,tipo) WHERE invalidado_en IS NULL;
CREATE INDEX ix_correo_cambio_token_cambio ON pliego.correo_cambio_token(cambio_id);
-- Keep all existing mail types and historical rows intact.
ALTER TABLE pliego.correo_outbox DROP CONSTRAINT ck_correo_outbox_tipo,
 ADD CONSTRAINT ck_correo_outbox_tipo CHECK(tipo IN('VERIFY_EMAIL','RESET_PASSWORD','ORDER_CONFIRMED',
 'ORDER_STATUS','ORDER_CANCELLED','INVOICE_ISSUED','EMAIL_CHANGE_CONFIRM','EMAIL_CHANGE_REQUESTED','EMAIL_CHANGED'));

CREATE FUNCTION pliego.fn_email_change_mask(p_email VARCHAR) RETURNS VARCHAR
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$
 SELECT (left(split_part(p_email,'@',1),2)||'•••@'||split_part(p_email,'@',2))::VARCHAR;
$$;
CREATE FUNCTION pliego.fn_customer_email_change_request(p_actor BIGINT,p_email VARCHAR,
 p_confirm_hash VARCHAR,p_confirm_nonce VARCHAR,p_cancel_hash VARCHAR,p_cancel_nonce VARCHAR)
RETURNS TABLE(email VARCHAR,address VARCHAR,expires_at TIMESTAMPTZ)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE u pliego.usuario%ROWTYPE; c pliego.correo_cambio%ROWTYPE; normalized VARCHAR;
BEGIN
 SELECT * INTO u FROM pliego.usuario WHERE usuario_id=p_actor FOR UPDATE;
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 normalized:=pliego.fn_normalize_email(p_email);
 IF normalized IS NULL OR char_length(normalized) NOT BETWEEN 3 AND 254 OR position('@' IN normalized)<=1
  OR normalized ~ '[\r\n]' OR p_confirm_hash IS NULL OR p_confirm_hash !~ '^[0-9a-f]{64}$'
  OR p_cancel_hash IS NULL OR p_cancel_hash !~ '^[0-9a-f]{64}$' OR p_confirm_hash=p_cancel_hash
  OR p_confirm_nonce IS NULL OR p_confirm_nonce !~ '^[A-Za-z0-9_-]{43}$'
  OR p_cancel_nonce IS NULL OR p_cancel_nonce !~ '^[A-Za-z0-9_-]{43}$'
 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF normalized=u.email_normalizado THEN PERFORM pliego.fn_raise_domain_error('P1120','EMAIL_CHANGE_SAME_ADDRESS'); END IF;
 IF EXISTS(SELECT FROM pliego.usuario WHERE email_normalizado=normalized) THEN
  PERFORM pliego.fn_raise_domain_error('P1101','EMAIL_ALREADY_EXISTS'); END IF;
 IF NOT pliego.fn_email_rate_limit(('EMAIL_CHANGE:'||p_actor)::VARCHAR,5) THEN
  PERFORM pliego.fn_raise_domain_error('P1122','EMAIL_CHANGE_RATE_LIMITED'); END IF;
 UPDATE pliego.correo_cambio SET estado='SUPERSEDED',fecha_fin=clock_timestamp() WHERE usuario_id=p_actor AND estado='PENDING';
 UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='ACTION_SUPERSEDED',fecha_actualizacion=clock_timestamp()
 WHERE usuario_id=p_actor AND tipo IN('EMAIL_CHANGE_CONFIRM','EMAIL_CHANGE_REQUESTED') AND estado='PENDING';
 INSERT INTO pliego.correo_cambio(usuario_id,email_actual,email_pendiente)
 VALUES(p_actor,u.email_normalizado,normalized) RETURNING * INTO c;
 INSERT INTO pliego.correo_cambio_token(token_hash,cambio_id,tipo,nonce) VALUES
 (p_confirm_hash,c.cambio_id,'EMAIL_CHANGE_CONFIRM',p_confirm_nonce),(p_cancel_hash,c.cambio_id,'EMAIL_CHANGE_CANCEL',p_cancel_nonce);
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,token_hash) VALUES
 ('EMAIL_CHANGE_CONFIRM:'||p_confirm_hash,'EMAIL_CHANGE_CONFIRM',p_actor,normalized,
  jsonb_build_object('nonce',p_confirm_nonce,'expiresAt',c.fecha_expiracion,'changeId',c.cambio_id),p_confirm_hash),
 ('EMAIL_CHANGE_REQUESTED:'||p_cancel_hash,'EMAIL_CHANGE_REQUESTED',p_actor,u.email_normalizado,
  jsonb_build_object('nonce',p_cancel_nonce,'expiresAt',c.fecha_expiracion,'changeId',c.cambio_id,'maskedEmail',pliego.fn_email_change_mask(normalized)),p_cancel_hash);
 RETURN QUERY SELECT u.email_normalizado,normalized,c.fecha_expiracion;
END; $$;

CREATE FUNCTION pliego.fn_customer_email_change_resend(p_actor BIGINT,p_hash VARCHAR,p_nonce VARCHAR) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE c pliego.correo_cambio%ROWTYPE;
BEGIN
 PERFORM 1 FROM pliego.usuario WHERE usuario_id=p_actor FOR UPDATE;
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 SELECT * INTO c FROM pliego.correo_cambio WHERE usuario_id=p_actor AND estado='PENDING' AND fecha_expiracion>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1121','EMAIL_CHANGE_NOT_PENDING'); END IF;
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_nonce IS NULL OR p_nonce !~ '^[A-Za-z0-9_-]{43}$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 IF c.ultimo_envio_en>clock_timestamp()-INTERVAL '1 minute'
  OR NOT pliego.fn_email_rate_limit(('EMAIL_CHANGE_RESEND:'||p_actor)::VARCHAR,5) THEN
  PERFORM pliego.fn_raise_domain_error('P1122','EMAIL_CHANGE_RATE_LIMITED'); END IF;
 UPDATE pliego.correo_cambio_token SET invalidado_en=clock_timestamp() WHERE cambio_id=c.cambio_id AND tipo='EMAIL_CHANGE_CONFIRM' AND invalidado_en IS NULL;
 INSERT INTO pliego.correo_cambio_token(token_hash,cambio_id,tipo,nonce) VALUES(p_hash,c.cambio_id,'EMAIL_CHANGE_CONFIRM',p_nonce);
 UPDATE pliego.correo_cambio SET ultimo_envio_en=clock_timestamp() WHERE cambio_id=c.cambio_id;
 UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='ACTION_SUPERSEDED',fecha_actualizacion=clock_timestamp()
 WHERE usuario_id=p_actor AND tipo='EMAIL_CHANGE_CONFIRM' AND estado='PENDING';
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,token_hash)
 VALUES('EMAIL_CHANGE_CONFIRM:'||p_hash,'EMAIL_CHANGE_CONFIRM',p_actor,c.email_pendiente,
 jsonb_build_object('nonce',p_nonce,'expiresAt',c.fecha_expiracion,'changeId',c.cambio_id),p_hash);
END; $$;

CREATE FUNCTION pliego.fn_customer_email_change_cancel(p_actor BIGINT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 PERFORM 1 FROM pliego.usuario WHERE usuario_id=p_actor FOR UPDATE;
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 UPDATE pliego.correo_cambio SET estado='CANCELLED',fecha_fin=clock_timestamp() WHERE usuario_id=p_actor AND estado='PENDING';
 UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='ACTION_CANCELLED',fecha_actualizacion=clock_timestamp()
 WHERE usuario_id=p_actor AND tipo IN('EMAIL_CHANGE_CONFIRM','EMAIL_CHANGE_REQUESTED') AND estado='PENDING';
END; $$;

CREATE FUNCTION pliego.fn_email_change_token_nonce(p_type VARCHAR,p_hash VARCHAR) RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT nonce FROM pliego.correo_cambio_token WHERE token_hash=p_hash AND tipo=p_type;
$$;
-- All writers lock the user before request/token/outbox. The initial hash lookup is non-locking.
CREATE FUNCTION pliego.fn_email_change_lock(p_type VARCHAR,p_hash VARCHAR) RETURNS pliego.correo_cambio
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE t pliego.correo_cambio_token%ROWTYPE; c pliego.correo_cambio%ROWTYPE; u pliego.usuario%ROWTYPE;
BEGIN
 SELECT * INTO t FROM pliego.correo_cambio_token WHERE token_hash=p_hash AND tipo=p_type;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1123','EMAIL_CHANGE_TOKEN_INVALID'); END IF;
 SELECT * INTO c FROM pliego.correo_cambio WHERE cambio_id=t.cambio_id;
 SELECT * INTO u FROM pliego.usuario WHERE usuario_id=c.usuario_id FOR UPDATE;
 SELECT * INTO c FROM pliego.correo_cambio WHERE cambio_id=t.cambio_id FOR UPDATE;
 -- Re-read after serializing with resend; a nonce looked up before the lock may be obsolete now.
 SELECT * INTO t FROM pliego.correo_cambio_token WHERE token_hash=p_hash AND tipo=p_type;
 IF u.estado<>'ACTIVE' OR u.rol<>'CUSTOMER' THEN PERFORM pliego.fn_raise_domain_error('P1123','EMAIL_CHANGE_TOKEN_INVALID'); END IF;
 IF c.estado='SUPERSEDED' OR t.invalidado_en IS NOT NULL THEN PERFORM pliego.fn_raise_domain_error('P1126','EMAIL_CHANGE_TOKEN_SUPERSEDED'); END IF;
 IF c.estado='CONFIRMED' THEN
  IF p_type='EMAIL_CHANGE_CANCEL' THEN PERFORM pliego.fn_raise_domain_error('P1128','EMAIL_CHANGE_ALREADY_CONFIRMED');
  ELSE PERFORM pliego.fn_raise_domain_error('P1125','EMAIL_CHANGE_TOKEN_USED'); END IF;
 END IF;
 IF c.estado='CANCELLED' THEN
  IF p_type='EMAIL_CHANGE_CANCEL' THEN RETURN c;
  ELSE PERFORM pliego.fn_raise_domain_error('P1127','EMAIL_CHANGE_CANCELLED'); END IF;
 END IF;
 IF c.email_actual<>u.email_normalizado THEN PERFORM pliego.fn_raise_domain_error('P1126','EMAIL_CHANGE_TOKEN_SUPERSEDED'); END IF;
 IF c.fecha_expiracion<=clock_timestamp() THEN PERFORM pliego.fn_raise_domain_error('P1124','EMAIL_CHANGE_TOKEN_EXPIRED'); END IF;
 RETURN c;
END; $$;

CREATE FUNCTION pliego.fn_email_change_confirm(p_hash VARCHAR) RETURNS VARCHAR
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE c pliego.correo_cambio%ROWTYPE; new_email VARCHAR;
BEGIN
 c:=pliego.fn_email_change_lock('EMAIL_CHANGE_CONFIRM',p_hash);
 -- Existing routine preserves approved normalization, unique-constraint mapping and refresh revocation.
 CALL pliego.sp_customer_change_email(c.usuario_id,c.email_pendiente,new_email);
 UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id=c.usuario_id;
 UPDATE pliego.correo_cambio SET estado='CONFIRMED',fecha_fin=clock_timestamp() WHERE cambio_id=c.cambio_id;
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 VALUES('EMAIL_CHANGED:'||c.cambio_id,'EMAIL_CHANGED',c.usuario_id,c.email_actual,
  jsonb_build_object('maskedEmail',pliego.fn_email_change_mask(new_email)));
 RETURN new_email;
END; $$;
CREATE FUNCTION pliego.fn_email_change_cancel(p_hash VARCHAR) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE c pliego.correo_cambio%ROWTYPE;
BEGIN
 c:=pliego.fn_email_change_lock('EMAIL_CHANGE_CANCEL',p_hash);
 IF c.estado='CANCELLED' THEN RETURN; END IF;
 PERFORM pliego.fn_customer_email_change_cancel(c.usuario_id);
END; $$;
CREATE FUNCTION pliego.fn_customer_profile_email_change(p_actor BIGINT)
RETURNS TABLE(customer_id BIGINT,email VARCHAR,first_names VARCHAR,last_names VARCHAR,phone VARCHAR,
 state VARCHAR,version BIGINT,email_verified BOOLEAN,email_delivery_status VARCHAR,email_delivery_since TIMESTAMPTZ,
 pending_email_address VARCHAR,pending_email_expires_at TIMESTAMPTZ,pending_email_delivery VARCHAR)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT p.*,c.email_pendiente,c.fecha_expiracion,
 CASE WHEN c.cambio_id IS NULL THEN NULL WHEN c.no_entregable THEN 'UNDELIVERABLE' ELSE 'OK' END::VARCHAR
 FROM pliego.fn_customer_profile_delivery(p_actor) p LEFT JOIN pliego.correo_cambio c
 ON c.usuario_id=p_actor AND c.estado='PENDING' AND c.fecha_expiracion>CURRENT_TIMESTAMP;
$$;

-- Fence expired/superseded/cancelled change messages at claim and preflight, including already claimed rows.
CREATE OR REPLACE FUNCTION pliego.fn_mail_outbox_claim()
RETURNS SETOF pliego.correo_outbox LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE v_id BIGINT;
BEGIN
 UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='AMBIGUOUS_DELIVERY',fecha_actualizacion=clock_timestamp(),propietario=NULL,lease_hasta=NULL
 WHERE estado='SENDING' AND lease_hasta<clock_timestamp();
 UPDATE pliego.correo_outbox o SET estado='FAILED',ultimo_error='ACTION_EXPIRED',fecha_actualizacion=clock_timestamp()
 WHERE o.estado='PENDING' AND o.token_hash IS NOT NULL AND NOT EXISTS(
  SELECT FROM pliego.correo_token t WHERE t.token_hash=o.token_hash AND t.fecha_uso IS NULL AND t.fecha_expiracion>clock_timestamp())
 AND NOT EXISTS(SELECT FROM pliego.correo_cambio_token t JOIN pliego.correo_cambio c USING(cambio_id)
  WHERE t.token_hash=o.token_hash AND t.invalidado_en IS NULL AND c.estado='PENDING' AND c.fecha_expiracion>clock_timestamp());
 SELECT correo_id INTO v_id FROM pliego.correo_outbox WHERE estado='PENDING' AND proximo_intento<=clock_timestamp() AND intentos<5
 ORDER BY proximo_intento,correo_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY UPDATE pliego.correo_outbox SET estado='SENDING',intentos=intentos+1,propietario=uuidv4(),
 lease_hasta=clock_timestamp()+INTERVAL '60 seconds',fecha_actualizacion=clock_timestamp() WHERE correo_id=v_id RETURNING *;
END; $$;
CREATE OR REPLACE FUNCTION pliego.fn_mail_outbox_prepare_send(p_id BIGINT,p_owner UUID) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE o pliego.correo_outbox%ROWTYPE;
BEGIN
 SELECT * INTO o FROM pliego.correo_outbox WHERE correo_id=p_id;
 IF o.tipo IN('EMAIL_CHANGE_CONFIRM','EMAIL_CHANGE_REQUESTED') THEN
  PERFORM 1 FROM pliego.usuario WHERE usuario_id=o.usuario_id FOR UPDATE;
 END IF;
 SELECT * INTO o FROM pliego.correo_outbox WHERE correo_id=p_id AND propietario=p_owner AND estado='SENDING' AND lease_hasta>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF o.tipo IN('EMAIL_CHANGE_CONFIRM','EMAIL_CHANGE_REQUESTED') AND NOT EXISTS(
  SELECT FROM pliego.correo_cambio_token t JOIN pliego.correo_cambio c USING(cambio_id)
  WHERE t.token_hash=o.token_hash AND t.invalidado_en IS NULL AND c.estado='PENDING' AND c.fecha_expiracion>clock_timestamp()) THEN
  UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='ACTION_EXPIRED',propietario=NULL,lease_hasta=NULL,fecha_actualizacion=clock_timestamp() WHERE correo_id=p_id;
  RETURN FALSE;
 END IF;
 IF EXISTS(SELECT FROM pliego.correo_destinatario_entrega WHERE destinatario=o.destinatario AND motivo IS NOT NULL) THEN
  UPDATE pliego.correo_outbox SET estado='HELD',ultimo_error='EMAIL_UNDELIVERABLE',propietario=NULL,lease_hasta=NULL,fecha_actualizacion=clock_timestamp() WHERE correo_id=p_id;
  IF o.tipo='EMAIL_CHANGE_CONFIRM' THEN
   UPDATE pliego.correo_cambio SET no_entregable=TRUE WHERE cambio_id=(o.datos->>'changeId')::UUID AND estado='PENDING';
  END IF;
  RETURN FALSE;
 END IF;
 RETURN TRUE;
END; $$;

CREATE OR REPLACE FUNCTION pliego.fn_mail_event_project_next() RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE event_row pliego.correo_evento_proveedor%ROWTYPE; mail_row pliego.correo_outbox%ROWTYPE;
 priority INTEGER;
BEGIN
 -- Serialize projection only. Never hold this lock across HTTP or inbox ingestion.
 IF NOT pg_try_advisory_xact_lock(93001,1) THEN RETURN FALSE; END IF;
 SELECT e.* INTO event_row FROM pliego.correo_evento_proveedor e
 JOIN pliego.correo_outbox o ON o.id_mensaje_proveedor=e.id_mensaje_proveedor
 WHERE e.procesado_en IS NULL ORDER BY e.recibido_en,e.evento_id LIMIT 1;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 SELECT * INTO STRICT mail_row FROM pliego.correo_outbox WHERE id_mensaje_proveedor=event_row.id_mensaje_proveedor;
 -- Same lock order as email change/action routines: user before outbox.
 IF mail_row.tipo='EMAIL_CHANGE_CONFIRM' THEN
  PERFORM 1 FROM pliego.usuario WHERE usuario_id=mail_row.usuario_id FOR UPDATE;
  PERFORM 1 FROM pliego.correo_cambio WHERE cambio_id=(mail_row.datos->>'changeId')::UUID FOR UPDATE;
 ELSE
  PERFORM 1 FROM pliego.usuario WHERE email_normalizado=mail_row.destinatario FOR UPDATE;
 END IF;
 PERFORM 1 FROM pliego.correo_outbox WHERE correo_id=mail_row.correo_id FOR UPDATE;
 priority:=CASE WHEN event_row.motivo IS NOT NULL THEN 2 WHEN event_row.estado='DELIVERED' THEN 1 ELSE 0 END;
 UPDATE pliego.correo_outbox SET entrega_estado=event_row.estado,entrega_evento_en=event_row.ocurrido_en,
  entrega_evento_id=event_row.evento_id,entrega_prioridad=priority
 WHERE correo_id=mail_row.correo_id AND (entrega_evento_en IS NULL OR
  (entrega_evento_en,entrega_prioridad,entrega_evento_id)<(event_row.ocurrido_en,priority,event_row.evento_id));
 IF priority>0 AND mail_row.tipo='EMAIL_CHANGE_CONFIRM' THEN
  -- Confirmation delivery belongs exclusively to this address/version, even after promotion.
  -- Resends share the pending address/version; replaced requests and promoted accounts are excluded.
  UPDATE pliego.correo_cambio SET no_entregable=(priority=2),entrega_evento_en=event_row.ocurrido_en,
   entrega_prioridad=priority,entrega_evento_id=event_row.evento_id
  WHERE cambio_id=(mail_row.datos->>'changeId')::UUID AND estado='PENDING'
   AND (entrega_evento_en IS NULL OR
    (entrega_evento_en,entrega_prioridad,entrega_evento_id)<(event_row.ocurrido_en,priority,event_row.evento_id));
 ELSIF priority>0 THEN
  INSERT INTO pliego.correo_destinatario_entrega AS d(destinatario,motivo,desde,ocurrido_en,prioridad,evento_id)
  VALUES(mail_row.destinatario,event_row.motivo,CASE WHEN priority=2 THEN event_row.ocurrido_en END,
   event_row.ocurrido_en,priority,event_row.evento_id)
  ON CONFLICT(destinatario) DO UPDATE SET motivo=EXCLUDED.motivo,
   desde=EXCLUDED.desde,
   ocurrido_en=EXCLUDED.ocurrido_en,prioridad=EXCLUDED.prioridad,evento_id=EXCLUDED.evento_id
  WHERE (d.ocurrido_en,d.prioridad,d.evento_id)<(EXCLUDED.ocurrido_en,EXCLUDED.prioridad,EXCLUDED.evento_id);
  -- Project the current email generation independently: global address knowledge
  -- may come from an older snapshot and must not be copied into this generation.
  UPDATE pliego.usuario SET email_no_entregable_desde=CASE WHEN priority=2 THEN event_row.ocurrido_en END,
    email_entrega_motivo=event_row.motivo,email_entrega_evento_en=event_row.ocurrido_en,
    email_entrega_prioridad=priority,email_entrega_evento_id=event_row.evento_id
   WHERE email_normalizado=mail_row.destinatario
    AND event_row.ocurrido_en>=date_trunc('second',email_cambiado_en)
    AND (email_cambiado_en='-infinity'::TIMESTAMPTZ OR mail_row.destinatario_capturado_en>=email_cambiado_en)
    AND (email_entrega_evento_en IS NULL OR
      (email_entrega_evento_en,email_entrega_prioridad,email_entrega_evento_id)<(event_row.ocurrido_en,priority,event_row.evento_id));
 END IF;
 UPDATE pliego.correo_evento_proveedor SET procesado_en=clock_timestamp(),correo_id=mail_row.correo_id
 WHERE evento_id=event_row.evento_id;
 RETURN TRUE;
END; $$;


REVOKE ALL ON TABLE pliego.correo_cambio,pliego.correo_cambio_token FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_email_change_mask(VARCHAR),
 pliego.fn_customer_email_change_request(BIGINT,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR),
 pliego.fn_customer_email_change_resend(BIGINT,VARCHAR,VARCHAR),pliego.fn_customer_email_change_cancel(BIGINT),
 pliego.fn_email_change_token_nonce(VARCHAR,VARCHAR),pliego.fn_email_change_lock(VARCHAR,VARCHAR),
 pliego.fn_email_change_confirm(VARCHAR),pliego.fn_email_change_cancel(VARCHAR),
 pliego.fn_customer_profile_email_change(BIGINT) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT SELECT,INSERT,UPDATE ON TABLE pliego.correo_cambio,pliego.correo_cambio_token TO pliego_app;
  GRANT EXECUTE ON FUNCTION pliego.fn_email_change_mask(VARCHAR),
   pliego.fn_customer_email_change_request(BIGINT,VARCHAR,VARCHAR,VARCHAR,VARCHAR,VARCHAR),
   pliego.fn_customer_email_change_resend(BIGINT,VARCHAR,VARCHAR),pliego.fn_customer_email_change_cancel(BIGINT),
   pliego.fn_email_change_token_nonce(VARCHAR,VARCHAR),pliego.fn_email_change_lock(VARCHAR,VARCHAR),
   pliego.fn_email_change_confirm(VARCHAR),pliego.fn_email_change_cancel(VARCHAR),
   pliego.fn_customer_profile_email_change(BIGINT) TO pliego_app;
 END IF;
END $grants$;
