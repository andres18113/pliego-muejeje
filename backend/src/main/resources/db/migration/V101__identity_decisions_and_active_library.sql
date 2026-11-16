-- ADR-0055. Preserve correction and acquisition history; customer presentation is separate.
CREATE TABLE pliego.cliente_identificacion_solicitud_acuse (
 solicitud_id BIGINT PRIMARY KEY REFERENCES pliego.cliente_identificacion_solicitud_correccion(solicitud_id) ON DELETE RESTRICT,
 reconocido_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE pliego.cliente_identificacion_solicitud_acuse IS
 'Immutable customer acknowledgment of an approved or rejected identity correction; never changes the decision audit.';

CREATE FUNCTION pliego.fn_guard_identity_correction_acknowledgment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION');
 END IF;
 IF NOT EXISTS(SELECT FROM pliego.cliente_identificacion_solicitud_correccion q
  WHERE q.solicitud_id=NEW.solicitud_id AND q.estado IN('APPROVED','REJECTED')) THEN
  PERFORM pliego.fn_raise_domain_error('P1111','BILLING_IDENTITY_CORRECTION_INVALID_TRANSITION');
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_identity_correction_acknowledgment_guard
 BEFORE INSERT OR UPDATE OR DELETE ON pliego.cliente_identificacion_solicitud_acuse
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_identity_correction_acknowledgment();

CREATE PROCEDURE pliego.sp_customer_billing_identity_correction_request_acknowledge(IN p_actor BIGINT,IN p_request_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT; request_state VARCHAR;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 SELECT q.estado INTO request_state FROM pliego.cliente_identificacion_solicitud_correccion q
 WHERE q.solicitud_id=p_request_id AND q.cliente_id=customer FOR UPDATE;
 IF NOT FOUND THEN
  PERFORM pliego.fn_raise_domain_error('P1109','BILLING_IDENTITY_CORRECTION_NOT_FOUND');
 END IF;
 IF request_state NOT IN('APPROVED','REJECTED') THEN
  PERFORM pliego.fn_raise_domain_error('P1111','BILLING_IDENTITY_CORRECTION_INVALID_TRANSITION');
 END IF;
 INSERT INTO pliego.cliente_identificacion_solicitud_acuse(solicitud_id) VALUES(p_request_id)
 ON CONFLICT(solicitud_id) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION pliego.fn_customer_billing_identity_read_model(p_actor BIGINT)
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
  -- Select first, then hide the acknowledged result. Filtering before LIMIT
  -- would incorrectly resurrect an older unacknowledged decision.
  SELECT selected.* FROM (
   SELECT q.* FROM pliego.cliente_identificacion_solicitud_correccion q
   WHERE q.cliente_id=customer AND (q.estado='PENDING' OR
    (q.estado IN('APPROVED','REJECTED','WITHDRAWN') AND q.decidido_en>=CURRENT_TIMESTAMP-INTERVAL '30 days'))
   ORDER BY (q.estado='PENDING') DESC,q.creado_en DESC,q.solicitud_id DESC LIMIT 1
  ) selected
  WHERE NOT EXISTS(SELECT FROM pliego.cliente_identificacion_solicitud_acuse a WHERE a.solicitud_id=selected.solicitud_id)
 ) r ON TRUE
 WHERE i.cliente_id=customer;
END; $$;

-- Existing lease, retry and provider-delivery machinery delivers these snapshots.
-- No historical backfill: only newly committed staff decisions enqueue mail.
ALTER TABLE pliego.correo_outbox DROP CONSTRAINT ck_correo_outbox_tipo,
 ADD CONSTRAINT ck_correo_outbox_tipo CHECK(tipo IN('VERIFY_EMAIL','RESET_PASSWORD','ORDER_CONFIRMED',
 'ORDER_STATUS','ORDER_CANCELLED','INVOICE_ISSUED','EMAIL_CHANGE_CONFIRM','EMAIL_CHANGE_REQUESTED','EMAIL_CHANGED',
 'BILLING_IDENTITY_DECIDED'));
CREATE FUNCTION pliego.fn_identity_correction_decision_mail() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF OLD.estado='PENDING' AND NEW.estado IN('APPROVED','REJECTED') THEN
  INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
  SELECT 'BILLING_IDENTITY_DECIDED:'||NEW.solicitud_id||':'||NEW.estado,'BILLING_IDENTITY_DECIDED',u.usuario_id,u.email_normalizado,
   jsonb_build_object('requestId',NEW.solicitud_id::TEXT,'status',NEW.estado,'decidedAt',NEW.decidido_en,
    'decisionReason',NEW.motivo_decision,'actionPath','/account/identity')
   ||CASE WHEN NEW.estado='APPROVED' THEN jsonb_build_object('identityType',NEW.tipo_propuesto,'identityNumber',NEW.numero_propuesto)
     ELSE '{}'::JSONB END
  FROM pliego.cliente c JOIN pliego.usuario u USING(usuario_id) WHERE c.cliente_id=NEW.cliente_id
  ON CONFLICT(evento_clave) DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_identity_correction_decision_mail AFTER UPDATE OF estado
 ON pliego.cliente_identificacion_solicitud_correccion
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_identity_correction_decision_mail();

-- The existing partial ACTIVE-grant index supports this ownership predicate.
-- fn_library_item deliberately retains the full immutable acquisition audit.
CREATE OR REPLACE FUNCTION pliego.fn_customer_library(p_actor BIGINT,p_product_type VARCHAR,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(owned_item_id BIGINT,item JSONB,total_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER ROWS 50 AS $$
DECLARE customer BIGINT;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 IF (p_product_type IS NOT NULL AND p_product_type NOT IN('EBOOK','AUDIOBOOK')) OR p_page<0 OR p_page_size NOT BETWEEN 1 AND 50
 OR p_page IS NULL OR p_page_size IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT o.owned_item_id,pliego.fn_library_item(o.owned_item_id),count(*) OVER()
 FROM pliego.digital_ownership o JOIN pliego.edicion e USING(edicion_id)
 WHERE o.cliente_id=customer AND (p_product_type IS NULL OR e.formato=p_product_type)
  AND EXISTS(SELECT FROM pliego.digital_grant g WHERE g.owned_item_id=o.owned_item_id AND g.state='ACTIVE')
 ORDER BY (SELECT min(g.acquired_at) FROM pliego.digital_grant g WHERE g.owned_item_id=o.owned_item_id) DESC,o.owned_item_id DESC
 LIMIT p_page_size OFFSET p_page::BIGINT*p_page_size;
END; $$;
CREATE OR REPLACE FUNCTION pliego.fn_customer_library_detail(p_actor BIGINT,p_owned BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE customer BIGINT; item JSONB;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 SELECT pliego.fn_library_item(o.owned_item_id) INTO item FROM pliego.digital_ownership o
 WHERE o.owned_item_id=p_owned AND o.cliente_id=customer
  AND EXISTS(SELECT FROM pliego.digital_grant g WHERE g.owned_item_id=o.owned_item_id AND g.state='ACTIVE');
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P6001','LIBRARY_ITEM_NOT_FOUND'); END IF;
 RETURN item;
END; $$;

REVOKE ALL ON TABLE pliego.cliente_identificacion_solicitud_acuse FROM PUBLIC;
REVOKE ALL ON FUNCTION pliego.fn_guard_identity_correction_acknowledgment(),pliego.fn_identity_correction_decision_mail() FROM PUBLIC;
REVOKE ALL ON PROCEDURE pliego.sp_customer_billing_identity_correction_request_acknowledge(BIGINT,BIGINT) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT SELECT,INSERT ON TABLE pliego.cliente_identificacion_solicitud_acuse TO pliego_app;
  GRANT EXECUTE ON FUNCTION pliego.fn_guard_identity_correction_acknowledgment(),pliego.fn_identity_correction_decision_mail() TO pliego_app;
  GRANT EXECUTE ON PROCEDURE pliego.sp_customer_billing_identity_correction_request_acknowledge(BIGINT,BIGINT) TO pliego_app;
 END IF;
END $grants$;
