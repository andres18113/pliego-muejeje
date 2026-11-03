-- ADR0054. Transactional hints; public cursors are assigned only to committed rows.
CREATE TABLE pliego.realtime_event (
 pending_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id BIGINT UNIQUE,
 user_id BIGINT REFERENCES pliego.usuario(usuario_id) ON DELETE CASCADE,
 admin_scope BOOLEAN NOT NULL,
 event_name VARCHAR(64) NOT NULL,
 resource_type VARCHAR(32) NOT NULL,
 resource_id VARCHAR(32) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 published_at TIMESTAMPTZ,
 CHECK ((admin_scope AND user_id IS NULL) OR (NOT admin_scope AND user_id IS NOT NULL)),
 CHECK ((event_id IS NULL)=(published_at IS NULL))
);
CREATE INDEX ix_realtime_event_user_cursor ON pliego.realtime_event(user_id,event_id);
CREATE INDEX ix_realtime_event_admin_cursor ON pliego.realtime_event(event_id) WHERE admin_scope;
CREATE INDEX ix_realtime_event_pending ON pliego.realtime_event(pending_id) WHERE event_id IS NULL;
CREATE INDEX ix_realtime_event_retention ON pliego.realtime_event(published_at,event_id) WHERE event_id IS NOT NULL;
CREATE SEQUENCE pliego.realtime_event_cursor_seq;
CREATE TABLE pliego.realtime_cursor (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 head BIGINT NOT NULL DEFAULT 0,
 retained_after BIGINT NOT NULL DEFAULT 0
);
INSERT INTO pliego.realtime_cursor DEFAULT VALUES;
CREATE TABLE pliego.realtime_connection (
 connection_id UUID PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES pliego.usuario(usuario_id) ON DELETE CASCADE,
 session_id UUID NOT NULL REFERENCES pliego.sesion_autenticacion(sesion_id) ON DELETE CASCADE,
 role VARCHAR(16) NOT NULL CHECK(role IN('CUSTOMER','ADMIN')),
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_realtime_connection_user ON pliego.realtime_connection(user_id,expires_at);
CREATE INDEX ix_realtime_connection_session ON pliego.realtime_connection(session_id);
CREATE INDEX ix_realtime_connection_expiry ON pliego.realtime_connection(expires_at);

CREATE FUNCTION pliego.fn_realtime_enqueue(p_user BIGINT,p_admin BOOLEAN,p_event TEXT,p_type TEXT,p_id TEXT)
RETURNS VOID LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 INSERT INTO pliego.realtime_event(user_id,admin_scope,event_name,resource_type,resource_id)
 VALUES(p_user,p_admin,p_event,p_type,p_id);
$$;

CREATE FUNCTION pliego.fn_realtime_publish(p_limit INTEGER DEFAULT 1000) RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE r RECORD; v_head BIGINT; v_removed BIGINT; n INTEGER:=0;
 v_cutoff TIMESTAMPTZ:=clock_timestamp()-INTERVAL '1 hour';
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 -- Only publishers serialize. Business transactions never acquire this lock.
 SELECT head INTO v_head FROM pliego.realtime_cursor WHERE singleton FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN 0; END IF;
 FOR r IN SELECT pending_id FROM pliego.realtime_event WHERE event_id IS NULL
  ORDER BY pending_id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  v_head:=nextval('pliego.realtime_event_cursor_seq');
  UPDATE pliego.realtime_event SET event_id=v_head,published_at=clock_timestamp() WHERE pending_id=r.pending_id;
  n:=n+1;
 END LOOP;
 WITH expired AS (
  SELECT pending_id FROM pliego.realtime_event WHERE event_id IS NOT NULL AND published_at<v_cutoff
  ORDER BY published_at,event_id LIMIT p_limit FOR UPDATE SKIP LOCKED
 ), removed AS (DELETE FROM pliego.realtime_event WHERE pending_id IN(SELECT pending_id FROM expired) RETURNING event_id)
 SELECT max(event_id) INTO v_removed FROM removed;
 UPDATE pliego.realtime_cursor SET head=v_head,retained_after=greatest(retained_after,COALESCE(v_removed,0)) WHERE singleton;
 DELETE FROM pliego.realtime_connection WHERE connection_id IN(
  SELECT connection_id FROM pliego.realtime_connection WHERE expires_at<=clock_timestamp()
  ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED);
 RETURN n;
END; $$;

CREATE FUNCTION pliego.fn_realtime_connect(p_hash VARCHAR,p_connection UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE s RECORD;
BEGIN
 SELECT se.sesion_id,u.usuario_id,u.rol,se.fecha_expiracion INTO s
 FROM pliego.sesion_autenticacion se JOIN pliego.usuario u USING(usuario_id)
 WHERE (se.token_refresco_hash=p_hash OR (se.token_refresco_hash_anterior=p_hash
   AND se.fecha_renovacion>=clock_timestamp()-INTERVAL '5 minutes'))
 AND se.fecha_revocacion IS NULL AND se.fecha_expiracion>clock_timestamp()
 AND u.estado='ACTIVE' AND u.rol IN('CUSTOMER','ADMIN')
 AND (u.rol='ADMIN' OR (u.email_verificado_en IS NOT NULL AND EXISTS(SELECT FROM pliego.cliente c WHERE c.usuario_id=u.usuario_id)))
 LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','UNAUTHORIZED'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('realtime-connection:'||s.usuario_id,0));
 DELETE FROM pliego.realtime_connection WHERE user_id=s.usuario_id AND expires_at<=clock_timestamp();
 IF (SELECT count(*) FROM pliego.realtime_connection WHERE user_id=s.usuario_id)>=4 THEN
  RETURN jsonb_build_object('state','LIMITED'); END IF;
 INSERT INTO pliego.realtime_connection(connection_id,user_id,session_id,role,expires_at)
 VALUES(p_connection,s.usuario_id,s.sesion_id,s.rol,least(s.fecha_expiracion,clock_timestamp()+INTERVAL '60 seconds'));
 RETURN jsonb_build_object('state','CONNECTED');
END; $$;

CREATE FUNCTION pliego.fn_realtime_read(p_connection UUID,p_after BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE c RECORD; h RECORD; events JSONB; next_cursor BIGINT;
BEGIN
 SELECT rc.* INTO c FROM pliego.realtime_connection rc
 JOIN pliego.sesion_autenticacion s ON s.sesion_id=rc.session_id
 JOIN pliego.usuario u ON u.usuario_id=rc.user_id
 WHERE rc.connection_id=p_connection AND rc.expires_at>clock_timestamp()
 AND s.fecha_expiracion>clock_timestamp() AND s.fecha_revocacion IS NULL
 AND u.estado='ACTIVE' AND u.rol=rc.role
 AND (u.rol='ADMIN' OR u.email_verificado_en IS NOT NULL);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','CLOSED'); END IF;
 SELECT head,retained_after INTO h FROM pliego.realtime_cursor WHERE singleton;
 IF p_after IS NULL OR p_after<h.retained_after OR p_after>h.head OR p_after<0 THEN
  RETURN jsonb_build_object('state','OPEN','cursor',h.head::TEXT,'resync',TRUE,'events','[]'::JSONB);
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.event_id::TEXT,'name',e.event_name,
  'resourceType',e.resource_type,'resourceId',e.resource_id) ORDER BY e.event_id),'[]'::JSONB),max(e.event_id)
 INTO events,next_cursor FROM (
  SELECT * FROM pliego.realtime_event WHERE event_id>p_after AND event_id<=h.head
   AND ((c.role='ADMIN' AND admin_scope) OR (c.role='CUSTOMER' AND NOT admin_scope AND user_id=c.user_id))
  ORDER BY event_id LIMIT 100
 ) e;
 RETURN jsonb_build_object('state','OPEN','cursor',
  (CASE WHEN jsonb_array_length(events)=100 THEN next_cursor ELSE h.head END)::TEXT,
  'resync',FALSE,'events',events);
END; $$;

CREATE FUNCTION pliego.fn_realtime_disconnect(p_connection UUID) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 DELETE FROM pliego.realtime_connection WHERE connection_id=p_connection;
$$;

CREATE FUNCTION pliego.fn_realtime_resource_hint() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_user BIGINT; v_id TEXT; v_name TEXT; v_type TEXT; v_admin BOOLEAN:=TRUE;
BEGIN
 IF TG_TABLE_NAME='cliente_identificacion_solicitud_correccion' THEN
  IF TG_OP='UPDATE' AND NEW.estado=OLD.estado THEN RETURN NEW; END IF;
  SELECT usuario_id INTO v_user FROM pliego.cliente WHERE cliente_id=NEW.cliente_id;
  v_id:=NEW.solicitud_id::TEXT; v_type:='billingIdentity';
  v_name:=CASE WHEN TG_OP='INSERT' THEN 'identity.correction.created'
   WHEN NEW.estado='WITHDRAWN' THEN 'identity.correction.withdrawn' ELSE 'identity.correction.decided' END;
 ELSIF TG_TABLE_NAME='cliente_identificacion_solicitud_acuse' THEN
  SELECT c.usuario_id INTO v_user FROM pliego.cliente_identificacion_solicitud_correccion r
   JOIN pliego.cliente c USING(cliente_id) WHERE r.solicitud_id=NEW.solicitud_id;
  v_id:=NEW.solicitud_id::TEXT;v_type:='billingIdentity';v_name:='identity.correction.acknowledged';v_admin:=FALSE;
 ELSIF TG_TABLE_NAME='digital_grant' THEN
  IF TG_OP='UPDATE' AND NEW.state=OLD.state THEN RETURN NEW; END IF;
  SELECT c.usuario_id INTO v_user FROM pliego.digital_ownership o JOIN pliego.cliente c USING(cliente_id)
   WHERE o.owned_item_id=NEW.owned_item_id;
  v_id:=NEW.owned_item_id::TEXT;v_type:='library';v_name:='library.changed';v_admin:=FALSE;
 ELSE
  IF TG_TABLE_NAME='correo_outbox' THEN
   IF NEW.tipo<>'ORDER_STATUS' OR NEW.evento_clave NOT LIKE '%:STORE_PICKUP:READY' THEN RETURN NEW; END IF;
   v_id:=NEW.datos->>'orderId';v_name:='pickup.ready';
  ELSE
   v_id:=NEW.pedido_id::TEXT;v_name:='order.changed';
   IF TG_TABLE_NAME='pedido' THEN
    IF TG_OP='UPDATE' AND NEW.estado=OLD.estado AND NEW.finalizado_en IS NOT DISTINCT FROM OLD.finalizado_en THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND OLD.finalizado_en IS NULL AND NEW.finalizado_en IS NOT NULL THEN
     v_name:='order.cancellation-window.expired'; END IF;
   ELSIF TG_TABLE_NAME IN('pago','envio') THEN
    IF TG_OP='UPDATE' AND NEW.estado=OLD.estado THEN RETURN NEW; END IF;
   ELSIF TG_TABLE_NAME='pedido_retiro' THEN
    IF NEW.fecha_retiro IS NOT DISTINCT FROM OLD.fecha_retiro THEN RETURN NEW; END IF;
   END IF;
  END IF;
  SELECT c.usuario_id INTO v_user FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE p.pedido_id=v_id::BIGINT;
  v_type:='order';
 END IF;
 IF v_user IS NOT NULL THEN
  PERFORM pliego.fn_realtime_enqueue(v_user,FALSE,v_name,v_type,v_id);
  IF v_admin THEN PERFORM pliego.fn_realtime_enqueue(NULL,TRUE,v_name,v_type,v_id); END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_realtime_correction AFTER INSERT OR UPDATE ON pliego.cliente_identificacion_solicitud_correccion
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_realtime_resource_hint();
CREATE TRIGGER trg_realtime_ack AFTER INSERT ON pliego.cliente_identificacion_solicitud_acuse
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_realtime_resource_hint();
CREATE TRIGGER trg_realtime_grant AFTER INSERT OR UPDATE ON pliego.digital_grant
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_realtime_resource_hint();
CREATE TRIGGER trg_realtime_order AFTER INSERT OR UPDATE ON pliego.pedido
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_realtime_resource_hint();
CREATE TRIGGER trg_realtime_payment AFTER INSERT OR UPDATE ON pliego.pago
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_realtime_resource_hint();
CREATE TRIGGER trg_realtime_shipment AFTER INSERT OR UPDATE ON pliego.envio
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_realtime_resource_hint();
CREATE TRIGGER trg_realtime_pickup AFTER UPDATE ON pliego.pedido_retiro
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_realtime_resource_hint();
CREATE TRIGGER trg_realtime_ready AFTER INSERT ON pliego.correo_outbox
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_realtime_resource_hint();

REVOKE ALL ON TABLE pliego.realtime_event,pliego.realtime_cursor,pliego.realtime_connection FROM PUBLIC;
REVOKE ALL ON SEQUENCE pliego.realtime_event_pending_id_seq,pliego.realtime_event_cursor_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_realtime_enqueue(BIGINT,BOOLEAN,TEXT,TEXT,TEXT),
 pliego.fn_realtime_publish(INTEGER),pliego.fn_realtime_connect(VARCHAR,UUID),
 pliego.fn_realtime_read(UUID,BIGINT),pliego.fn_realtime_disconnect(UUID),pliego.fn_realtime_resource_hint() FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON pliego.realtime_event,pliego.realtime_cursor,pliego.realtime_connection TO pliego_app;
 GRANT USAGE,SELECT ON SEQUENCE pliego.realtime_event_pending_id_seq,pliego.realtime_event_cursor_seq TO pliego_app;
 GRANT EXECUTE ON FUNCTION pliego.fn_realtime_enqueue(BIGINT,BOOLEAN,TEXT,TEXT,TEXT),
  pliego.fn_realtime_publish(INTEGER),pliego.fn_realtime_connect(VARCHAR,UUID),
  pliego.fn_realtime_read(UUID,BIGINT),pliego.fn_realtime_disconnect(UUID),pliego.fn_realtime_resource_hint() TO pliego_app;
END IF; END; $$;
