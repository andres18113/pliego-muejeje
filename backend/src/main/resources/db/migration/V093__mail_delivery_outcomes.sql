-- Provider acceptance (SENT) remains separate from asynchronous delivery.
ALTER TABLE pliego.correo_outbox
 DROP CONSTRAINT correo_outbox_estado_check,
 ADD CONSTRAINT correo_outbox_estado_check CHECK(estado IN('PENDING','SENDING','SENT','FAILED','HELD')),
 ADD COLUMN entrega_estado VARCHAR(16) CHECK(entrega_estado IN('DELIVERED','BOUNCED','SOFT_BOUNCE','REJECTED','SUPPRESSED','SUSPENDED')),
 ADD COLUMN entrega_evento_en TIMESTAMPTZ,
 ADD COLUMN entrega_evento_id VARCHAR(128),
 ADD COLUMN entrega_prioridad INTEGER,
 ADD COLUMN destinatario_capturado_en TIMESTAMPTZ;
-- Preserve historical rows; new snapshots identify the current email generation
-- even when provider timestamps have only whole-second precision.
ALTER TABLE pliego.correo_outbox ALTER COLUMN destinatario_capturado_en SET DEFAULT clock_timestamp();

ALTER TABLE pliego.usuario
 ADD COLUMN email_cambiado_en TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
 ADD COLUMN email_no_entregable_desde TIMESTAMPTZ,
 ADD COLUMN email_entrega_evento_en TIMESTAMPTZ,
 ADD COLUMN email_entrega_prioridad INTEGER,
 ADD COLUMN email_entrega_evento_id VARCHAR(128),
 ADD COLUMN email_entrega_motivo VARCHAR(24) CHECK(email_entrega_motivo IN('HARD_BOUNCE','SUPPRESSED')),
 ADD CONSTRAINT ck_usuario_email_delivery CHECK((email_no_entregable_desde IS NULL)=(email_entrega_motivo IS NULL));

-- Only sanitized event facts; no raw JSON, SMTP text, recipient or credentials.
CREATE TABLE pliego.correo_evento_proveedor (
 evento_id VARCHAR(128) PRIMARY KEY CHECK(evento_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
 id_mensaje_proveedor VARCHAR(128) NOT NULL CHECK(id_mensaje_proveedor ~ '^[A-Za-z0-9._:-]{1,128}$'),
 proveedor VARCHAR(16) NOT NULL CHECK(proveedor='MAILTRAP'),
 estado VARCHAR(16) NOT NULL CHECK(estado IN('DELIVERED','BOUNCED','SOFT_BOUNCE','REJECTED','SUPPRESSED','SUSPENDED')),
 motivo VARCHAR(24),
 ocurrido_en TIMESTAMPTZ NOT NULL,
 recibido_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 procesado_en TIMESTAMPTZ,
 correo_id BIGINT REFERENCES pliego.correo_outbox(correo_id),
 CONSTRAINT ck_correo_evento_motivo CHECK(
  (estado='BOUNCED' AND motivo IS NOT DISTINCT FROM 'HARD_BOUNCE') OR
  (estado='SUPPRESSED' AND motivo IS NOT DISTINCT FROM 'SUPPRESSED') OR
  (estado NOT IN('BOUNCED','SUPPRESSED') AND motivo IS NULL))
);
CREATE INDEX ix_correo_evento_pendiente ON pliego.correo_evento_proveedor(id_mensaje_proveedor,recibido_en,evento_id) WHERE procesado_en IS NULL;
CREATE INDEX ix_correo_evento_outbox ON pliego.correo_evento_proveedor(correo_id) WHERE correo_id IS NOT NULL;

-- This address state also protects queued snapshots after the account changes email.
CREATE TABLE pliego.correo_destinatario_entrega (
 destinatario VARCHAR(254) PRIMARY KEY,
 motivo VARCHAR(24) CHECK(motivo IN('HARD_BOUNCE','SUPPRESSED')),
 desde TIMESTAMPTZ,
 ocurrido_en TIMESTAMPTZ NOT NULL,
 prioridad INTEGER NOT NULL CHECK(prioridad IN(1,2)),
 evento_id VARCHAR(128) NOT NULL,
 CHECK((motivo IS NULL)=(desde IS NULL))
);

CREATE FUNCTION pliego.fn_mail_event_record(p_event VARCHAR,p_message VARCHAR,p_state VARCHAR,
 p_reason VARCHAR,p_at TIMESTAMPTZ,p_provider VARCHAR) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 IF p_event IS NULL OR p_event !~ '^[A-Za-z0-9._:-]{1,128}$'
  OR p_message IS NULL OR p_message !~ '^[A-Za-z0-9._:-]{1,128}$'
  OR p_state IS NULL OR p_state NOT IN('DELIVERED','BOUNCED','SOFT_BOUNCE','REJECTED','SUPPRESSED','SUSPENDED')
  OR p_at IS NULL OR NOT isfinite(p_at) OR p_at<to_timestamp(0) OR p_at>clock_timestamp()+INTERVAL '5 minutes'
  OR p_provider IS DISTINCT FROM 'MAILTRAP'
  OR (p_state='BOUNCED' AND p_reason IS DISTINCT FROM 'HARD_BOUNCE')
  OR (p_state='SUPPRESSED' AND p_reason IS DISTINCT FROM 'SUPPRESSED')
  OR (p_state NOT IN('BOUNCED','SUPPRESSED') AND p_reason IS NOT NULL)
 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 INSERT INTO pliego.correo_evento_proveedor(evento_id,id_mensaje_proveedor,proveedor,estado,motivo,ocurrido_en)
 VALUES(p_event,p_message,p_provider,p_state,p_reason,p_at) ON CONFLICT(evento_id) DO NOTHING;
 -- A concurrent duplicate waits on the unique constraint; READ COMMITTED then sees it.
 RETURN EXISTS(SELECT FROM pliego.correo_evento_proveedor e WHERE e.evento_id=p_event
  AND e.id_mensaje_proveedor=p_message AND e.estado=p_state AND e.motivo IS NOT DISTINCT FROM p_reason
  AND e.ocurrido_en=p_at AND e.proveedor=p_provider);
END; $$;

CREATE FUNCTION pliego.fn_mail_event_project_next() RETURNS BOOLEAN
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
 PERFORM 1 FROM pliego.usuario WHERE email_normalizado=mail_row.destinatario FOR UPDATE;
 PERFORM 1 FROM pliego.correo_outbox WHERE correo_id=mail_row.correo_id FOR UPDATE;
 priority:=CASE WHEN event_row.motivo IS NOT NULL THEN 2 WHEN event_row.estado='DELIVERED' THEN 1 ELSE 0 END;
 UPDATE pliego.correo_outbox SET entrega_estado=event_row.estado,entrega_evento_en=event_row.ocurrido_en,
  entrega_evento_id=event_row.evento_id,entrega_prioridad=priority
 WHERE correo_id=mail_row.correo_id AND (entrega_evento_en IS NULL OR
  (entrega_evento_en,entrega_prioridad,entrega_evento_id)<(event_row.ocurrido_en,priority,event_row.evento_id));
 IF priority>0 THEN
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

CREATE FUNCTION pliego.fn_mail_outbox_prepare_send(p_id BIGINT,p_owner UUID) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE recipient VARCHAR;
BEGIN
 SELECT destinatario INTO recipient FROM pliego.correo_outbox WHERE correo_id=p_id
  AND propietario=p_owner AND estado='SENDING' AND lease_hasta>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT FROM pliego.correo_destinatario_entrega WHERE destinatario=recipient AND motivo IS NOT NULL) THEN
  UPDATE pliego.correo_outbox SET estado='HELD',ultimo_error='EMAIL_UNDELIVERABLE',propietario=NULL,
   lease_hasta=NULL,fecha_actualizacion=clock_timestamp() WHERE correo_id=p_id;
  RETURN FALSE;
 END IF;
 RETURN TRUE;
END; $$;

CREATE OR REPLACE FUNCTION pliego.fn_invalidate_changed_email() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.email_normalizado IS DISTINCT FROM OLD.email_normalizado THEN
  NEW.email_verificado_en:=NULL;
  NEW.email_cambiado_en:=clock_timestamp();
  NEW.email_no_entregable_desde:=NULL;
  NEW.email_entrega_motivo:=NULL;
  NEW.email_entrega_evento_en:=NULL;
  NEW.email_entrega_prioridad:=NULL;
  NEW.email_entrega_evento_id:=NULL;
  DELETE FROM pliego.correo_token WHERE usuario_id=OLD.usuario_id;
  UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='EMAIL_CHANGED',fecha_actualizacion=CURRENT_TIMESTAMP
  WHERE usuario_id=OLD.usuario_id AND token_hash IS NOT NULL AND estado='PENDING';
  UPDATE pliego.sesion_autenticacion SET fecha_revocacion=COALESCE(fecha_revocacion,CURRENT_TIMESTAMP) WHERE usuario_id=OLD.usuario_id;
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION pliego.fn_customer_profile_delivery(p_actor BIGINT)
RETURNS TABLE(customer_id BIGINT,email VARCHAR,first_names VARCHAR,last_names VARCHAR,phone VARCHAR,
 state VARCHAR,version BIGINT,email_verified BOOLEAN,email_delivery_status VARCHAR,email_delivery_since TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT p.*,CASE WHEN u.email_no_entregable_desde IS NULL THEN 'OK' ELSE 'UNDELIVERABLE' END::VARCHAR,
  u.email_no_entregable_desde
 FROM pliego.fn_customer_profile_verified(p_actor) p JOIN pliego.usuario u ON u.usuario_id=p_actor;
$$;

REVOKE ALL ON TABLE pliego.correo_evento_proveedor,pliego.correo_destinatario_entrega FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_mail_event_record(VARCHAR,VARCHAR,VARCHAR,VARCHAR,TIMESTAMPTZ,VARCHAR),
 pliego.fn_mail_event_project_next(),pliego.fn_mail_outbox_prepare_send(BIGINT,UUID),
 pliego.fn_customer_profile_delivery(BIGINT) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT SELECT,INSERT,UPDATE ON TABLE pliego.correo_evento_proveedor,pliego.correo_destinatario_entrega TO pliego_app;
  GRANT EXECUTE ON FUNCTION pliego.fn_mail_event_record(VARCHAR,VARCHAR,VARCHAR,VARCHAR,TIMESTAMPTZ,VARCHAR),
   pliego.fn_mail_event_project_next(),pliego.fn_mail_outbox_prepare_send(BIGINT,UUID),
   pliego.fn_customer_profile_delivery(BIGINT) TO pliego_app;
 END IF;
END $grants$;
