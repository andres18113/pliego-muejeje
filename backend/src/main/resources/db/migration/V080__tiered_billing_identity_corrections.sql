-- Tiered customer billing-identity corrections and auditable review requests (ADR-0043).
-- A request never mutates an invoice. The account's current identity affects future checkout only.

-- SRI guidance does not require a modulo-11 check digit for public/private company RUCs.
-- Keep the structural checks; natural-person RUCs remain a valid cédula plus establishment.
CREATE OR REPLACE FUNCTION pliego.fn_is_valid_ec_identification(p_type TEXT,p_number TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER AS $$
DECLARE value TEXT:=btrim(p_number,' '); province INTEGER; third INTEGER; total INTEGER:=0; digit INTEGER; i INTEGER;
 natural_weights INTEGER[]:=ARRAY[2,1,2,1,2,1,2,1,2];
BEGIN
 IF p_type IS NULL OR value IS NULL OR p_type NOT IN ('EC_CEDULA','EC_RUC') THEN RETURN FALSE; END IF;
 IF (p_type='EC_CEDULA' AND value !~ '^[0-9]{10}$') OR (p_type='EC_RUC' AND value !~ '^[0-9]{13}$') THEN RETURN FALSE; END IF;
 province:=substr(value,1,2)::INTEGER; third:=substr(value,3,1)::INTEGER;
 IF NOT (province BETWEEN 1 AND 24 OR province=30) THEN RETURN FALSE; END IF;
 IF third<6 THEN
  IF substr(value,1,10) ~ '^([0-9])\1{9}$' THEN RETURN FALSE; END IF;
  FOR i IN 1..9 LOOP
   digit:=substr(value,i,1)::INTEGER*natural_weights[i];
   total:=total+CASE WHEN digit>9 THEN digit-9 ELSE digit END;
  END LOOP;
  IF (10-total%10)%10<>substr(value,10,1)::INTEGER THEN RETURN FALSE; END IF;
  RETURN p_type='EC_CEDULA' OR substr(value,11,3)<>'000';
 END IF;
 IF p_type<>'EC_RUC' THEN RETURN FALSE; END IF;
 IF third=6 THEN RETURN substr(value,10,4)<>'0000';
 ELSIF third=9 THEN RETURN substr(value,11,3)<>'000'; END IF;
 RETURN FALSE;
END; $$;

-- Used means the customer has ever had an invoice addressed to the account identity.
-- Any state counts. V081 narrows this to ACCOUNT or NULL/historical recipients.
CREATE FUNCTION pliego.fn_customer_has_account_billed_invoice(p_customer BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT EXISTS (
  SELECT 1 FROM pliego.pedido p JOIN pliego.factura f ON f.pedido_id=p.pedido_id
  WHERE p.cliente_id=p_customer
 );
$$;

-- Expand the immutable audit vocabulary without changing historical events.
ALTER TABLE pliego.cliente_identificacion_evento
 DROP CONSTRAINT cliente_identificacion_evento_accion_check,
 DROP CONSTRAINT cliente_identificacion_evento_origen_check,
 DROP CONSTRAINT ck_cliente_identificacion_evento_tipo_anterior_presente,
 ALTER COLUMN accion TYPE VARCHAR(32),
 ALTER COLUMN origen TYPE VARCHAR(24);
ALTER TABLE pliego.cliente_identificacion_evento
 ADD CONSTRAINT ck_cliente_identificacion_evento_accion CHECK(accion IN(
  'REGISTERED','CORRECTED','CORRECTED_SAME_PERSON','CORRECTION_REQUESTED','CORRECTION_WITHDRAWN',
  'CORRECTION_APPROVED','CORRECTION_REJECTED')),
 ADD CONSTRAINT ck_cliente_identificacion_evento_origen CHECK(origen IN(
  'PROFILE','CHECKOUT','MIGRATION','CUSTOMER_REQUEST','STAFF_REVIEW')),
 ADD CONSTRAINT ck_cliente_identificacion_evento_tipo_anterior_presente CHECK(
  (accion IN('CORRECTED','CORRECTED_SAME_PERSON','CORRECTION_REQUESTED','CORRECTION_WITHDRAWN',
             'CORRECTION_APPROVED','CORRECTION_REJECTED'))=(identidad_tipo_anterior IS NOT NULL)) NOT VALID;

CREATE TABLE pliego.cliente_identificacion_solicitud_correccion (
 solicitud_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_id BIGINT NOT NULL REFERENCES pliego.cliente(cliente_id),
 tipo_actual VARCHAR(16) NOT NULL CHECK(tipo_actual IN('EC_CEDULA','EC_RUC')),
 numero_actual VARCHAR(13) NOT NULL CHECK(
  (tipo_actual='EC_CEDULA' AND numero_actual ~ '^[0-9]{10}$') OR
  (tipo_actual='EC_RUC' AND numero_actual ~ '^[0-9]{13}$')),
 tipo_propuesto VARCHAR(16) NOT NULL CHECK(tipo_propuesto IN('EC_CEDULA','EC_RUC')),
 numero_propuesto VARCHAR(13) NOT NULL CHECK(pliego.fn_is_valid_ec_identification(tipo_propuesto,numero_propuesto)),
 codigo_motivo VARCHAR(24) NOT NULL CHECK(codigo_motivo IN('DOCUMENT_TYPO','DOCUMENT_CHANGED','OTHER')),
 nota VARCHAR(500),
 estado VARCHAR(10) NOT NULL CHECK(estado IN('PENDING','APPROVED','REJECTED','WITHDRAWN')),
 creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 vence_en TIMESTAMPTZ NOT NULL,
 decidido_en TIMESTAMPTZ,
 decidido_por BIGINT REFERENCES pliego.usuario(usuario_id),
 motivo_decision TEXT,
 clave_idempotencia UUID NOT NULL,
 huella_payload VARCHAR(64) NOT NULL CHECK(huella_payload ~ '^[0-9a-f]{64}$'),
 CONSTRAINT ck_cliente_identificacion_solicitud_nota CHECK(nota IS NULL OR (nota=btrim(nota) AND char_length(nota) BETWEEN 1 AND 500)),
 CONSTRAINT ck_cliente_identificacion_solicitud_decision CHECK(
  (estado='PENDING' AND decidido_en IS NULL AND decidido_por IS NULL AND motivo_decision IS NULL) OR
  (estado='APPROVED' AND decidido_en IS NOT NULL AND decidido_por IS NOT NULL
    AND (motivo_decision IS NULL OR char_length(btrim(motivo_decision))>0)) OR
  (estado='REJECTED' AND decidido_en IS NOT NULL AND decidido_por IS NOT NULL
    AND motivo_decision IS NOT NULL AND char_length(btrim(motivo_decision))>0) OR
  (estado='WITHDRAWN' AND decidido_en IS NOT NULL AND decidido_por IS NULL AND motivo_decision IS NULL)),
 CONSTRAINT ck_cliente_identificacion_solicitud_distinta CHECK(
  ROW(tipo_actual,numero_actual) IS DISTINCT FROM ROW(tipo_propuesto,numero_propuesto)),
 CONSTRAINT uq_cliente_identificacion_solicitud_clave UNIQUE(cliente_id,clave_idempotencia)
);
CREATE UNIQUE INDEX uq_cliente_identificacion_solicitud_pending
 ON pliego.cliente_identificacion_solicitud_correccion(cliente_id) WHERE estado='PENDING';
CREATE INDEX ix_cliente_identificacion_solicitud_estado_vence
 ON pliego.cliente_identificacion_solicitud_correccion(estado,vence_en,solicitud_id);

CREATE FUNCTION pliego.fn_set_customer_identity_correction_due_at() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.creado_en IS NULL THEN NEW.creado_en:=clock_timestamp(); END IF;
 NEW.vence_en:=NEW.creado_en+INTERVAL '15 days';
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_cliente_identificacion_solicitud_correccion_due_at
 BEFORE INSERT ON pliego.cliente_identificacion_solicitud_correccion
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_set_customer_identity_correction_due_at();

CREATE FUNCTION pliego.fn_guard_customer_identity_correction_request() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='IMMUTABLE_HISTORY_VIOLATION';
 END IF;
 IF OLD.estado<>'PENDING' OR NEW.estado NOT IN('APPROVED','REJECTED','WITHDRAWN')
  OR current_setting('pliego.identity_correction_request_transition',true) IS DISTINCT FROM OLD.solicitud_id::TEXT
  OR ROW(NEW.solicitud_id,NEW.cliente_id,NEW.tipo_actual,NEW.numero_actual,NEW.tipo_propuesto,NEW.numero_propuesto,
         NEW.codigo_motivo,NEW.nota,NEW.creado_en,NEW.vence_en,NEW.clave_idempotencia,NEW.huella_payload)
     IS DISTINCT FROM ROW(OLD.solicitud_id,OLD.cliente_id,OLD.tipo_actual,OLD.numero_actual,OLD.tipo_propuesto,
         OLD.numero_propuesto,OLD.codigo_motivo,OLD.nota,OLD.creado_en,OLD.vence_en,OLD.clave_idempotencia,OLD.huella_payload) THEN
  RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='IMMUTABLE_HISTORY_VIOLATION';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_cliente_identificacion_solicitud_correccion_immutable
 BEFORE UPDATE OR DELETE ON pliego.cliente_identificacion_solicitud_correccion
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_customer_identity_correction_request();

-- One guarded correction implementation keeps profile and STAFF_REVIEW writes on the same CAS/audit path.
-- It remains safe as an executable Database API routine: PROFILE is actor-owned and STAFF_REVIEW
-- locks and transitions the matching pending request in this same procedure.
CREATE PROCEDURE pliego.sp_billing_identity_correction_apply(
 IN p_actor BIGINT,IN p_expected_number VARCHAR,IN p_type VARCHAR,IN p_number VARCHAR,IN p_origin VARCHAR,
 IN p_request_id BIGINT,IN p_decision VARCHAR,IN p_decision_reason TEXT,
 OUT o_status VARCHAR,OUT o_decided_at TIMESTAMPTZ,OUT o_decided_by BIGINT,OUT o_decision_reason TEXT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT; actor BIGINT; old_type TEXT; old_number TEXT; value TEXT:=btrim(p_number,' ');
 expected TEXT:=btrim(p_expected_number,' '); same_person BOOLEAN:=FALSE; used BOOLEAN; action TEXT;
 request_row pliego.cliente_identificacion_solicitud_correccion%ROWTYPE; reason_value TEXT:=NULLIF(btrim(p_decision_reason),'');
BEGIN
 IF p_origin='PROFILE' THEN
  SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
  IF p_request_id IS NOT NULL OR p_decision IS NOT NULL OR p_decision_reason IS NOT NULL
   OR p_expected_number IS NULL OR NOT pliego.fn_is_valid_ec_identification(p_type,p_number) THEN
   PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
  SELECT identidad_tipo,identidad_numero INTO old_type,old_number FROM pliego.cliente_identificacion
   WHERE cliente_id=customer FOR UPDATE;
  IF EXISTS(SELECT FROM pliego.cliente_identificacion_solicitud_correccion q
   WHERE q.cliente_id=customer AND q.estado='PENDING') THEN
   PERFORM pliego.fn_raise_domain_error('P1108','BILLING_IDENTITY_CORRECTION_PENDING'); END IF;
  IF old_number IS NULL OR old_number IS DISTINCT FROM expected THEN
   PERFORM pliego.fn_raise_domain_error('P1105','BILLING_IDENTITY_CONFLICT'); END IF;
  IF old_number=value THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
  same_person:=(old_type='EC_CEDULA' AND p_type='EC_RUC' AND value=old_number||'001') OR
   (old_type='EC_RUC' AND p_type='EC_CEDULA' AND right(old_number,3)='001' AND value=left(old_number,10));
  used:=pliego.fn_customer_has_account_billed_invoice(customer);
  IF used AND NOT same_person THEN PERFORM pliego.fn_raise_domain_error('P1107','BILLING_IDENTITY_CORRECTION_REQUIRES_REVIEW'); END IF;
  action:=CASE WHEN used THEN 'CORRECTED_SAME_PERSON' ELSE 'CORRECTED' END;
  PERFORM set_config('pliego.identity_correction',customer::TEXT,true);
  UPDATE pliego.cliente_identificacion SET identidad_tipo=p_type,identidad_numero=value WHERE cliente_id=customer;
  PERFORM set_config('pliego.identity_correction','',true);
  INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo_anterior,identidad_tipo,numero_anterior,numero_nuevo)
  VALUES(customer,action,'PROFILE',old_type,p_type,old_number,value);
  RETURN;
 ELSIF p_origin='STAFF_REVIEW' THEN
  SELECT usuario_id INTO actor FROM pliego.fn_assert_actor(p_actor,'ADMIN');
  IF p_request_id IS NULL OR p_decision IS NULL OR p_decision NOT IN('APPROVE','REJECT')
   OR (p_decision='REJECT' AND reason_value IS NULL) THEN
   PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
  SELECT * INTO request_row FROM pliego.cliente_identificacion_solicitud_correccion q
   WHERE q.solicitud_id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1109','BILLING_IDENTITY_CORRECTION_NOT_FOUND'); END IF;
  IF request_row.estado<>'PENDING' THEN PERFORM pliego.fn_raise_domain_error('P1111','BILLING_IDENTITY_CORRECTION_INVALID_TRANSITION'); END IF;
  IF p_decision='APPROVE' THEN
   SELECT identidad_tipo,identidad_numero INTO old_type,old_number FROM pliego.cliente_identificacion
    WHERE cliente_id=request_row.cliente_id FOR UPDATE;
   IF old_number IS NULL OR old_number IS DISTINCT FROM request_row.numero_actual THEN
    PERFORM pliego.fn_raise_domain_error('P1105','BILLING_IDENTITY_CONFLICT'); END IF;
   PERFORM set_config('pliego.identity_correction',request_row.cliente_id::TEXT,true);
   UPDATE pliego.cliente_identificacion SET identidad_tipo=request_row.tipo_propuesto,
    identidad_numero=request_row.numero_propuesto WHERE cliente_id=request_row.cliente_id;
   PERFORM set_config('pliego.identity_correction','',true);
   INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo_anterior,identidad_tipo,numero_anterior,numero_nuevo)
   VALUES(request_row.cliente_id,'CORRECTION_APPROVED','STAFF_REVIEW',old_type,request_row.tipo_propuesto,
    old_number,request_row.numero_propuesto);
   o_status:='APPROVED';
  ELSE
   INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo_anterior,identidad_tipo,numero_anterior,numero_nuevo)
   VALUES(request_row.cliente_id,'CORRECTION_REJECTED','STAFF_REVIEW',request_row.tipo_actual,request_row.tipo_propuesto,
    request_row.numero_actual,request_row.numero_propuesto);
   o_status:='REJECTED';
  END IF;
  o_decided_at:=clock_timestamp();o_decided_by:=actor;o_decision_reason:=reason_value;
  PERFORM set_config('pliego.identity_correction_request_transition',request_row.solicitud_id::TEXT,true);
  UPDATE pliego.cliente_identificacion_solicitud_correccion SET estado=o_status,decidido_en=o_decided_at,
   decidido_por=o_decided_by,motivo_decision=o_decision_reason WHERE solicitud_id=request_row.solicitud_id;
  PERFORM set_config('pliego.identity_correction_request_transition','',true);
 ELSE
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
END; $$;CREATE OR REPLACE PROCEDURE pliego.sp_customer_billing_identity_correct(
 IN p_actor BIGINT,IN p_type VARCHAR,IN p_expected_number VARCHAR,IN p_number VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE o_status VARCHAR; o_decided_at TIMESTAMPTZ; o_decided_by BIGINT; o_decision_reason TEXT;
BEGIN
 CALL pliego.sp_billing_identity_correction_apply(p_actor,p_expected_number,p_type,p_number,'PROFILE',NULL,NULL,NULL,
  o_status,o_decided_at,o_decided_by,o_decision_reason);
END; $$;

CREATE FUNCTION pliego.fn_customer_billing_identity_read_model(p_actor BIGINT)
RETURNS TABLE(identity_type VARCHAR,identity_number VARCHAR,used BOOLEAN,correction_mode VARCHAR,
 correction_request_id BIGINT,correction_request_status VARCHAR,proposed_type VARCHAR,proposed_number VARCHAR,
 reason_code VARCHAR,created_at TIMESTAMPTZ,due_at TIMESTAMPTZ,decided_at TIMESTAMPTZ,decision_reason TEXT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE customer BIGINT;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 RETURN QUERY
 SELECT i.identidad_tipo,i.identidad_numero,pliego.fn_customer_has_account_billed_invoice(customer),
  CASE WHEN pliego.fn_customer_has_account_billed_invoice(customer) THEN 'REQUEST' ELSE 'DIRECT' END::VARCHAR,
  r.solicitud_id,r.estado,r.tipo_propuesto,r.numero_propuesto,r.codigo_motivo,r.creado_en,r.vence_en,r.decidido_en,r.motivo_decision
 FROM pliego.cliente_identificacion i
 LEFT JOIN LATERAL (
  SELECT q.* FROM pliego.cliente_identificacion_solicitud_correccion q
  WHERE q.cliente_id=customer AND (q.estado='PENDING' OR
    (q.estado IN('APPROVED','REJECTED','WITHDRAWN') AND q.decidido_en>=CURRENT_TIMESTAMP-INTERVAL '30 days'))
  ORDER BY (q.estado='PENDING') DESC,q.creado_en DESC,q.solicitud_id DESC LIMIT 1
 ) r ON TRUE
 WHERE i.cliente_id=customer;
END; $$;

CREATE PROCEDURE pliego.sp_customer_billing_identity_correction_request_submit(
 IN p_actor BIGINT,IN p_key UUID,IN p_current_number VARCHAR,IN p_type VARCHAR,IN p_number VARCHAR,
 IN p_reason_code VARCHAR,IN p_note VARCHAR,
 OUT o_request_id BIGINT,OUT o_status VARCHAR,OUT o_proposed_type VARCHAR,OUT o_proposed_number VARCHAR,
 OUT o_reason_code VARCHAR,OUT o_created_at TIMESTAMPTZ,OUT o_due_at TIMESTAMPTZ,OUT o_decided_at TIMESTAMPTZ,
 OUT o_decision_reason TEXT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT; old_type TEXT; old_number TEXT; value TEXT:=btrim(p_number,' '); note_value TEXT:=NULLIF(btrim(p_note,' '),'');
 fingerprint VARCHAR; previous pliego.cliente_identificacion_solicitud_correccion%ROWTYPE; same_person BOOLEAN:=FALSE;
 request_row pliego.cliente_identificacion_solicitud_correccion%ROWTYPE;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(btrim(p_current_number,' '),p_type,value,p_reason_code,note_value)::TEXT,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-identity-correction:'||p_actor||':'||p_key,0));
 SELECT * INTO previous FROM pliego.cliente_identificacion_solicitud_correccion q
  WHERE q.cliente_id=customer AND q.clave_idempotencia=p_key;
 IF FOUND THEN
  IF previous.huella_payload IS DISTINCT FROM fingerprint THEN PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;
  o_request_id:=previous.solicitud_id;o_status:=previous.estado;o_proposed_type:=previous.tipo_propuesto;
  o_proposed_number:=previous.numero_propuesto;o_reason_code:=previous.codigo_motivo;o_created_at:=previous.creado_en;
  o_due_at:=previous.vence_en;o_decided_at:=previous.decidido_en;o_decision_reason:=previous.motivo_decision;
  RETURN;
 END IF;
 IF p_current_number IS NULL OR p_type NOT IN('EC_CEDULA','EC_RUC')
  OR NOT pliego.fn_is_valid_ec_identification(p_type,p_number)
  OR p_reason_code IS NULL OR p_reason_code NOT IN('DOCUMENT_TYPO','DOCUMENT_CHANGED','OTHER')
  OR (note_value IS NOT NULL AND char_length(note_value)>500) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 SELECT identidad_tipo,identidad_numero INTO old_type,old_number FROM pliego.cliente_identificacion
  WHERE cliente_id=customer FOR UPDATE;
 IF old_number IS NULL OR old_number IS DISTINCT FROM btrim(p_current_number,' ') THEN
  PERFORM pliego.fn_raise_domain_error('P1105','BILLING_IDENTITY_CONFLICT'); END IF;
 IF ROW(old_type,old_number) IS NOT DISTINCT FROM ROW(p_type,value) THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 same_person:=(old_type='EC_CEDULA' AND p_type='EC_RUC' AND value=old_number||'001') OR
  (old_type='EC_RUC' AND p_type='EC_CEDULA' AND right(old_number,3)='001' AND value=left(old_number,10));
 IF NOT pliego.fn_customer_has_account_billed_invoice(customer) OR same_person THEN
  PERFORM pliego.fn_raise_domain_error('P1110','BILLING_IDENTITY_CORRECTION_NOT_REQUIRED'); END IF;
 IF EXISTS(SELECT FROM pliego.cliente_identificacion_solicitud_correccion q WHERE q.cliente_id=customer AND q.estado='PENDING') THEN
  PERFORM pliego.fn_raise_domain_error('P1108','BILLING_IDENTITY_CORRECTION_PENDING'); END IF;
 INSERT INTO pliego.cliente_identificacion_solicitud_correccion(
  cliente_id,tipo_actual,numero_actual,tipo_propuesto,numero_propuesto,codigo_motivo,nota,estado,clave_idempotencia,huella_payload)
 VALUES(customer,old_type,old_number,p_type,value,p_reason_code,note_value,'PENDING',p_key,fingerprint)
 RETURNING * INTO request_row;
 INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo_anterior,identidad_tipo,numero_anterior,numero_nuevo)
 VALUES(customer,'CORRECTION_REQUESTED','CUSTOMER_REQUEST',old_type,p_type,old_number,value);
 o_request_id:=request_row.solicitud_id;o_status:=request_row.estado;o_proposed_type:=request_row.tipo_propuesto;
 o_proposed_number:=request_row.numero_propuesto;o_reason_code:=request_row.codigo_motivo;o_created_at:=request_row.creado_en;
 o_due_at:=request_row.vence_en;o_decided_at:=request_row.decidido_en;o_decision_reason:=request_row.motivo_decision;
END; $$;CREATE PROCEDURE pliego.sp_customer_billing_identity_correction_request_withdraw(IN p_actor BIGINT,IN p_request_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT; request_row pliego.cliente_identificacion_solicitud_correccion%ROWTYPE;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 SELECT * INTO request_row FROM pliego.cliente_identificacion_solicitud_correccion q
  WHERE q.solicitud_id=p_request_id AND q.cliente_id=customer FOR UPDATE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1109','BILLING_IDENTITY_CORRECTION_NOT_FOUND'); END IF;
 IF request_row.estado<>'PENDING' THEN PERFORM pliego.fn_raise_domain_error('P1111','BILLING_IDENTITY_CORRECTION_INVALID_TRANSITION'); END IF;
 PERFORM set_config('pliego.identity_correction_request_transition',request_row.solicitud_id::TEXT,true);
 UPDATE pliego.cliente_identificacion_solicitud_correccion SET estado='WITHDRAWN',decidido_en=clock_timestamp()
  WHERE solicitud_id=request_row.solicitud_id;
 PERFORM set_config('pliego.identity_correction_request_transition','',true);
 INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo_anterior,identidad_tipo,numero_anterior,numero_nuevo)
 VALUES(customer,'CORRECTION_WITHDRAWN','CUSTOMER_REQUEST',request_row.tipo_actual,request_row.tipo_propuesto,
  request_row.numero_actual,request_row.numero_propuesto);
END; $$;

CREATE OR REPLACE FUNCTION pliego.fn_admin_billing_identity_correction_requests(
 p_actor BIGINT,p_status VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(request_id BIGINT,customer_id BIGINT,customer_name VARCHAR,customer_email VARCHAR,
 current_type VARCHAR,current_number VARCHAR,proposed_type VARCHAR,proposed_number VARCHAR,reason_code VARCHAR,note VARCHAR,
 status VARCHAR,created_at TIMESTAMPTZ,due_at TIMESTAMPTZ,decided_at TIMESTAMPTZ,decided_by BIGINT,decision_reason TEXT,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
 PERFORM 1 FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF p_status IS NOT NULL AND p_status NOT IN('PENDING','APPROVED','REJECTED','WITHDRAWN') THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY
 WITH filtered AS (
  SELECT q.solicitud_id AS request_id,q.cliente_id AS customer_id,(c.nombres||' '||c.apellidos)::VARCHAR AS customer_name,
   u.email_normalizado AS customer_email,q.tipo_actual AS current_type,q.numero_actual AS current_number,
   q.tipo_propuesto AS proposed_type,q.numero_propuesto AS proposed_number,q.codigo_motivo AS reason_code,
   q.nota AS note,q.estado AS status,q.creado_en AS created_at,q.vence_en AS due_at,q.decidido_en AS decided_at,
   q.decidido_por AS decided_by,q.motivo_decision AS decision_reason
  FROM pliego.cliente_identificacion_solicitud_correccion q
  JOIN pliego.cliente c ON c.cliente_id=q.cliente_id JOIN pliego.usuario u ON u.usuario_id=c.usuario_id
  WHERE p_status IS NULL OR q.estado=p_status
 ),
 page_rows AS (
  SELECT * FROM filtered ORDER BY due_at,created_at,request_id
  LIMIT p_page_size OFFSET (p_page::BIGINT*p_page_size::BIGINT)
 ),
 total AS (SELECT count(*)::BIGINT AS total_count FROM filtered)
 SELECT page_rows.request_id,page_rows.customer_id,page_rows.customer_name,page_rows.customer_email,
  page_rows.current_type,page_rows.current_number,page_rows.proposed_type,page_rows.proposed_number,
  page_rows.reason_code,page_rows.note,page_rows.status,page_rows.created_at,page_rows.due_at,
  page_rows.decided_at,page_rows.decided_by,page_rows.decision_reason,total.total_count
 FROM total LEFT JOIN page_rows ON TRUE
 ORDER BY page_rows.due_at NULLS LAST,page_rows.created_at NULLS LAST,page_rows.request_id NULLS LAST;
END; $$;

CREATE PROCEDURE pliego.sp_admin_billing_identity_correction_decide(
 IN p_actor BIGINT,IN p_request_id BIGINT,IN p_decision VARCHAR,IN p_decision_reason TEXT,
 OUT o_status VARCHAR,OUT o_decided_at TIMESTAMPTZ,OUT o_decided_by BIGINT,OUT o_decision_reason TEXT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 CALL pliego.sp_billing_identity_correction_apply(p_actor,NULL,NULL,NULL,'STAFF_REVIEW',p_request_id,
  p_decision,p_decision_reason,o_status,o_decided_at,o_decided_by,o_decision_reason);
END; $$;
