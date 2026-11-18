-- ADR 0053 security review: credential/lease deadlines checked on the wall clock after their locks,
-- and offer windows rejected when not finite. Replaces V027/V039/V044/V073/V094 routine bodies only;
-- signatures, SECURITY INVOKER and grants are unchanged. V001–V098 are not edited.

-- Credential deadlines use the wall clock after acquiring their production locks.
-- A transaction may begin before a credential expires and wait past that deadline.
CREATE OR REPLACE FUNCTION pliego.fn_auth_session_refresh(
 p_current_refresh_token_hash VARCHAR,p_replacement_refresh_token_hash VARCHAR)
RETURNS TABLE(user_id BIGINT,email_canonical VARCHAR,role VARCHAR,expires_at TIMESTAMPTZ)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER ROWS 1 AS $$
DECLARE u pliego.usuario%ROWTYPE; s pliego.sesion_autenticacion%ROWTYPE; now_at TIMESTAMPTZ;
BEGIN
 IF p_current_refresh_token_hash IS NULL OR p_current_refresh_token_hash !~ '^[0-9a-f]{64}$'
 OR p_replacement_refresh_token_hash IS NULL OR p_replacement_refresh_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;

 -- Lock only this family; password login creates a separate session and may
 -- proceed concurrently. Never acquire user/continuation locks after this row.
 SELECT * INTO s FROM pliego.sesion_autenticacion
 WHERE token_refresco_hash=p_current_refresh_token_hash FOR UPDATE;
 IF NOT FOUND THEN
  SELECT * INTO s FROM pliego.sesion_autenticacion
  WHERE token_refresco_hash_anterior=p_current_refresh_token_hash FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO u FROM pliego.usuario WHERE usuario_id=s.usuario_id;
 IF NOT FOUND THEN RETURN; END IF;
 now_at:=clock_timestamp();
 IF s.fecha_revocacion IS NOT NULL OR s.fecha_expiracion<=now_at OR u.estado<>'ACTIVE'
 OR u.rol NOT IN ('CUSTOMER','ADMIN') OR (u.rol='CUSTOMER' AND NOT EXISTS(
  SELECT FROM pliego.cliente WHERE usuario_id=s.usuario_id)) THEN RETURN; END IF;

 IF s.token_refresco_hash=p_current_refresh_token_hash THEN
  UPDATE pliego.sesion_autenticacion SET token_refresco_hash_anterior=p_current_refresh_token_hash,
   token_refresco_hash=p_replacement_refresh_token_hash,fecha_renovacion=now_at WHERE sesion_id=s.sesion_id;
 ELSIF s.token_refresco_hash_anterior IS DISTINCT FROM p_current_refresh_token_hash
 OR s.token_refresco_hash IS DISTINCT FROM p_replacement_refresh_token_hash
 OR s.fecha_renovacion IS NULL OR s.fecha_renovacion<now_at-INTERVAL '5 minutes' THEN RETURN;
 END IF;
 RETURN QUERY SELECT u.usuario_id,u.email_normalizado,u.rol,s.fecha_expiracion;
END; $$;

-- Preserve the V095 and V096 public wrappers: reset still cancels pending email
-- changes and invalidates registration continuation, including same-hash reset.
CREATE OR REPLACE FUNCTION pliego.fn_email_action_consume_internal_v039(
 p_type VARCHAR,p_hash VARCHAR,p_password_hash VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE actor BIGINT; t pliego.correo_token%ROWTYPE; u pliego.usuario%ROWTYPE; now_at TIMESTAMPTZ;
BEGIN
 IF p_type NOT IN ('VERIFY_EMAIL','RESET_PASSWORD') OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RETURN FALSE; END IF;
 SELECT usuario_id INTO actor FROM pliego.correo_token WHERE token_hash=p_hash AND tipo=p_type;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 SELECT * INTO u FROM pliego.usuario WHERE usuario_id=actor FOR UPDATE;
 SELECT * INTO t FROM pliego.correo_token WHERE usuario_id=actor AND tipo=p_type AND token_hash=p_hash FOR UPDATE;
 now_at:=clock_timestamp();
 IF NOT FOUND OR t.fecha_uso IS NOT NULL OR t.fecha_expiracion<=now_at OR t.email<>u.email_normalizado
 OR u.estado<>'ACTIVE' THEN RETURN FALSE; END IF;
 IF p_type='RESET_PASSWORD' AND (p_password_hash IS NULL OR btrim(p_password_hash)='') THEN RETURN FALSE; END IF;
 UPDATE pliego.correo_token SET fecha_uso=now_at WHERE usuario_id=actor AND tipo=p_type;
 IF p_type='VERIFY_EMAIL' THEN
  UPDATE pliego.usuario SET email_verificado_en=now_at WHERE usuario_id=actor;
 ELSE
  UPDATE pliego.usuario SET password_hash=p_password_hash WHERE usuario_id=actor;
  UPDATE pliego.sesion_autenticacion SET fecha_revocacion=COALESCE(fecha_revocacion,now_at) WHERE usuario_id=actor;
  UPDATE pliego.correo_token SET fecha_uso=COALESCE(fecha_uso,now_at) WHERE usuario_id=actor;
 END IF;
 UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='ACTION_CONSUMED',fecha_actualizacion=now_at
 WHERE usuario_id=actor AND estado='PENDING' AND (tipo=p_type OR (p_type='RESET_PASSWORD' AND token_hash IS NOT NULL));
 RETURN TRUE;
END; $$;

-- Reject JDBC infinity sentinels before they poison public offer date projections.
CREATE OR REPLACE PROCEDURE pliego.sp_edition_offer_set(IN p_actor BIGINT,IN p_edition BIGINT,IN p_price NUMERIC,
 IN p_starts TIMESTAMPTZ,IN p_ends TIMESTAMPTZ,IN p_copy VARCHAR,IN p_terms VARCHAR,OUT o_offer BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE base NUMERIC(11,2);
BEGIN
 PERFORM pliego.fn_assert_actor(p_actor,'ADMIN');
 -- Match checkout's master lock: changing an offer cannot race its monetary snapshots.
 SELECT precio INTO base FROM pliego.edicion WHERE edicion_id=p_edition FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND'); END IF;
 IF p_price IS NULL OR p_price<=0 OR p_price>=base OR p_price<>round(p_price,2)
 OR p_starts IS NULL OR p_ends IS NULL OR NOT isfinite(p_starts) OR NOT isfinite(p_ends) OR p_ends<=p_starts OR char_length(p_copy)>1000 OR char_length(p_terms)>5000 THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 INSERT INTO pliego.edicion_oferta(edicion_id,precio_oferta,inicio,fin,oferta_texto,condiciones) VALUES(p_edition,p_price,p_starts,p_ends,NULLIF(btrim(p_copy),''),NULLIF(btrim(p_terms),''))
 ON CONFLICT(edicion_id) DO UPDATE SET precio_oferta=EXCLUDED.precio_oferta,inicio=EXCLUDED.inicio,fin=EXCLUDED.fin,oferta_texto=EXCLUDED.oferta_texto,condiciones=EXCLUDED.condiciones,estado='ACTIVE'
 RETURNING oferta_id INTO o_offer;
END; $$;

-- Lease predicates must be checked after row locks: a lock-only transaction can
-- hold an unchanged tuple until a previously valid worker lease has expired.
CREATE OR REPLACE FUNCTION pliego.fn_mail_outbox_prepare_send(p_id BIGINT,p_owner UUID) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE o pliego.correo_outbox%ROWTYPE;
BEGIN
 SELECT * INTO o FROM pliego.correo_outbox WHERE correo_id=p_id;
 IF o.tipo IN('EMAIL_CHANGE_CONFIRM','EMAIL_CHANGE_REQUESTED') THEN
  PERFORM 1 FROM pliego.usuario WHERE usuario_id=o.usuario_id FOR UPDATE;
 END IF;
 SELECT * INTO o FROM pliego.correo_outbox WHERE correo_id=p_id FOR UPDATE;
 IF NOT FOUND OR p_owner IS NULL OR o.propietario IS DISTINCT FROM p_owner OR o.estado<>'SENDING'
 OR o.lease_hasta IS NULL OR o.lease_hasta<=clock_timestamp() THEN RETURN FALSE; END IF;
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

CREATE OR REPLACE FUNCTION pliego.fn_invoice_artifact_fail(p_invoice BIGINT,p_type VARCHAR,p_owner UUID)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE job pliego.factura_archivo_trabajo%ROWTYPE;
BEGIN
 SELECT * INTO job FROM pliego.factura_archivo_trabajo
 WHERE factura_id=p_invoice AND tipo=p_type FOR UPDATE;
 IF NOT FOUND OR job.estado<>'PROCESSING' OR job.propietario IS DISTINCT FROM p_owner
 OR job.lease_until IS NULL OR job.lease_until<clock_timestamp() THEN RETURN FALSE; END IF;
 UPDATE pliego.factura_archivo_trabajo SET estado=CASE WHEN intentos>=5 THEN 'FAILED' ELSE 'PENDING' END,
  propietario=NULL,lease_until=NULL,siguiente_intento=clock_timestamp()+make_interval(secs=>LEAST(300,5*power(2,intentos)::INTEGER)),
  actualizado_en=clock_timestamp()
 WHERE factura_id=p_invoice AND tipo=p_type;
 RETURN TRUE;
END; $$;
