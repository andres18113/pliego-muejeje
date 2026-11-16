-- V101: durable decisions and customer acknowledgment. Every fixture rolls back.
BEGIN;
CREATE FUNCTION pg_temp.reject_identity_mail() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tipo='BILLING_IDENTITY_DECIDED' AND NEW.datos->>'decisionReason'='rollback-probe' THEN
  RAISE EXCEPTION USING ERRCODE='Z1010',MESSAGE='forced outbox failure';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_identity_decision_rollback_probe BEFORE INSERT ON pliego.correo_outbox
 FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_identity_mail();

DO $gate$
<<identity_gate>>
DECLARE admin BIGINT; actor BIGINT; customer BIGINT; stranger BIGINT; other_customer BIGINT;
 request_id BIGINT; withdrawn BIGINT; approved BIGINT; older_rejected BIGINT; state VARCHAR; decided TIMESTAMPTZ;
 decided_by BIGINT; reason TEXT; acknowledged TIMESTAMPTZ; before_events BIGINT; snapshot JSONB;
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('identity-decision-admin@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO admin;
 CALL pliego.sp_customer_register('identity-decision-owner@example.invalid','fixture','Cliente','Decisión',NULL,actor,customer,state);
 CALL pliego.sp_customer_register('identity-decision-other@example.invalid','fixture','Otro','Cliente',NULL,stranger,other_customer,state);
 CALL pliego.sp_customer_billing_identity_register(actor,'EC_CEDULA','0912345675');
 INSERT INTO pliego.cliente_identificacion_solicitud_correccion(cliente_id,tipo_actual,numero_actual,
  tipo_propuesto,numero_propuesto,codigo_motivo,estado,clave_idempotencia,huella_payload)
 VALUES(customer,'EC_CEDULA','0912345675','EC_CEDULA','1710034065','DOCUMENT_TYPO','PENDING',uuidv4(),repeat('a',64))
 RETURNING solicitud_id INTO request_id;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correction_request_acknowledge(actor,request_id);
  RAISE EXCEPTION 'pending request was acknowledged';
 EXCEPTION WHEN SQLSTATE 'P1111' THEN NULL; END;
 IF (SELECT correction_request_id FROM pliego.fn_customer_billing_identity_read_model(actor))<>request_id
  OR EXISTS(SELECT FROM pliego.cliente_identificacion_solicitud_acuse WHERE solicitud_id=request_id) THEN
  RAISE EXCEPTION 'pending request changed after refused acknowledgment'; END IF;
 FOR withdrawn IN SELECT request_id UNION ALL SELECT 9223372036854775807 LOOP
  BEGIN
   CALL pliego.sp_customer_billing_identity_correction_request_acknowledge(stranger,withdrawn);
   RAISE EXCEPTION 'foreign or unknown request was acknowledged';
  EXCEPTION WHEN SQLSTATE 'P1109' THEN NULL; END;
 END LOOP;

 CALL pliego.sp_admin_billing_identity_correction_decide(admin,request_id,'REJECT','No permite confirmar el cambio.',state,decided,decided_by,reason);
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='BILLING_IDENTITY_DECIDED:'||request_id||':REJECTED')<>1
  OR NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE tipo='BILLING_IDENTITY_DECIDED'
   AND destinatario='identity-decision-owner@example.invalid' AND usuario_id=actor
   AND datos->>'requestId'=request_id::TEXT AND datos->>'status'='REJECTED'
   AND datos->>'decisionReason'='No permite confirmar el cambio.' AND datos->>'actionPath'='/account/identity'
   AND (datos->>'decidedAt')::TIMESTAMPTZ=decided AND NOT datos ? 'identityNumber') THEN
  RAISE EXCEPTION 'rejection notification snapshot or dedup key missing'; END IF;
 BEGIN
  CALL pliego.sp_admin_billing_identity_correction_decide(admin,request_id,'REJECT','No permite confirmar el cambio.',state,decided,decided_by,reason);
  RAISE EXCEPTION 'terminal decision was repeated';
 EXCEPTION WHEN SQLSTATE 'P1111' THEN NULL; END;
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE datos->>'requestId'=request_id::TEXT AND tipo='BILLING_IDENTITY_DECIDED')<>1 THEN
  RAISE EXCEPTION 'repeated decision duplicated notification'; END IF;
 SELECT to_jsonb(q) INTO snapshot FROM pliego.cliente_identificacion_solicitud_correccion q WHERE solicitud_id=request_id;
 SELECT count(*) INTO before_events FROM pliego.cliente_identificacion_evento WHERE cliente_id=customer;
 CALL pliego.sp_customer_billing_identity_correction_request_acknowledge(actor,request_id);
 SELECT reconocido_en INTO acknowledged FROM pliego.cliente_identificacion_solicitud_acuse WHERE solicitud_id=request_id;
 CALL pliego.sp_customer_billing_identity_correction_request_acknowledge(actor,request_id);
 IF acknowledged IS NULL OR (SELECT reconocido_en FROM pliego.cliente_identificacion_solicitud_acuse WHERE solicitud_id=request_id)<>acknowledged
  OR (SELECT correction_request_id FROM pliego.fn_customer_billing_identity_read_model(actor)) IS NOT NULL
  OR (SELECT to_jsonb(q) FROM pliego.cliente_identificacion_solicitud_correccion q WHERE solicitud_id=request_id)<>snapshot
  OR (SELECT count(*) FROM pliego.cliente_identificacion_evento WHERE cliente_id=customer)<>before_events
  OR NOT EXISTS(SELECT FROM pliego.fn_admin_billing_identity_correction_requests(admin,'REJECTED',0,20) q WHERE q.request_id=identity_gate.request_id) THEN
  RAISE EXCEPTION 'acknowledgment is not durable/idempotent or altered audit'; END IF;

 INSERT INTO pliego.cliente_identificacion_solicitud_correccion(cliente_id,tipo_actual,numero_actual,
  tipo_propuesto,numero_propuesto,codigo_motivo,estado,clave_idempotencia,huella_payload)
 VALUES(customer,'EC_CEDULA','0912345675','EC_CEDULA','1710034065','DOCUMENT_TYPO','PENDING',uuidv4(),repeat('b',64))
 RETURNING solicitud_id INTO withdrawn;
 CALL pliego.sp_customer_billing_identity_correction_request_withdraw(actor,withdrawn);
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE tipo='BILLING_IDENTITY_DECIDED' AND datos->>'requestId'=withdrawn::TEXT) THEN
  RAISE EXCEPTION 'withdrawal sent a decision notification'; END IF;

 -- The latest decision alone controls the profile notice. Acknowledging it must
 -- never reveal an older unacknowledged decision as a new result.
 INSERT INTO pliego.cliente_identificacion_solicitud_correccion(cliente_id,tipo_actual,numero_actual,
  tipo_propuesto,numero_propuesto,codigo_motivo,estado,clave_idempotencia,huella_payload)
 VALUES(customer,'EC_CEDULA','0912345675','EC_CEDULA','1710034065','DOCUMENT_TYPO','PENDING',uuidv4(),repeat('d',64))
 RETURNING solicitud_id INTO older_rejected;
 CALL pliego.sp_admin_billing_identity_correction_decide(admin,older_rejected,'REJECT','Primera decisión anterior.',state,decided,decided_by,reason);

 INSERT INTO pliego.cliente_identificacion_solicitud_correccion(cliente_id,tipo_actual,numero_actual,
  tipo_propuesto,numero_propuesto,codigo_motivo,estado,clave_idempotencia,huella_payload)
 VALUES(customer,'EC_CEDULA','0912345675','EC_CEDULA','1710034065','DOCUMENT_TYPO','PENDING',uuidv4(),repeat('c',64))
 RETURNING solicitud_id INTO approved;
 BEGIN
  CALL pliego.sp_admin_billing_identity_correction_decide(admin,approved,'APPROVE','rollback-probe',state,decided,decided_by,reason);
  RAISE EXCEPTION 'forced outbox failure did not abort decision';
 EXCEPTION WHEN SQLSTATE 'Z1010' THEN NULL; END;
 IF (SELECT estado FROM pliego.cliente_identificacion_solicitud_correccion WHERE solicitud_id=approved)<>'PENDING'
  OR (SELECT identidad_numero FROM pliego.cliente_identificacion WHERE cliente_id=customer)<>'0912345675'
  OR EXISTS(SELECT FROM pliego.correo_outbox WHERE tipo='BILLING_IDENTITY_DECIDED' AND datos->>'requestId'=approved::TEXT) THEN
  RAISE EXCEPTION 'outbox failure did not roll back identity and decision'; END IF;
 CALL pliego.sp_admin_billing_identity_correction_decide(admin,approved,'APPROVE',NULL,state,decided,decided_by,reason);
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave='BILLING_IDENTITY_DECIDED:'||approved||':APPROVED'
  AND datos->>'identityType'='EC_CEDULA' AND datos->>'identityNumber'='1710034065') THEN
  RAISE EXCEPTION 'approval did not snapshot the number now in use'; END IF;
 CALL pliego.sp_customer_billing_identity_correction_request_acknowledge(actor,approved);
 IF (SELECT correction_request_id FROM pliego.fn_customer_billing_identity_read_model(actor)) IS NOT NULL
  OR EXISTS(SELECT FROM pliego.cliente_identificacion_solicitud_acuse WHERE solicitud_id=older_rejected) THEN
  RAISE EXCEPTION 'acknowledged latest approval exposes an older unacknowledged decision'; END IF;
 BEGIN
  UPDATE pliego.cliente_identificacion_solicitud_acuse SET reconocido_en=clock_timestamp() WHERE solicitud_id=approved;
  RAISE EXCEPTION 'acknowledgment timestamp was mutable';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 BEGIN
  DELETE FROM pliego.cliente_identificacion_solicitud_acuse WHERE solicitud_id=approved;
  RAISE EXCEPTION 'acknowledgment was removable';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
END; $gate$;
ROLLBACK;
\echo 'Billing identity decisions gate passed: atomic outbox, no withdrawal email, acknowledgment ownership/idempotency/pending/audit.'
