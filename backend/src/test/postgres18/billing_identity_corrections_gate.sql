-- Run with psql -X -v ON_ERROR_STOP=1 against a Flyway V081 PostgreSQL 18 database.
-- Every write is rolled back. The first assertions deliberately fail on V079.
BEGIN;
DO $ruc_red$
BEGIN
 IF NOT pliego.fn_is_valid_ec_identification('EC_RUC','1760001210001') THEN
  RAISE EXCEPTION 'public RUC structural vector was rejected only by its legacy modulo-11 digit';
 END IF;
 IF NOT pliego.fn_is_valid_ec_identification('EC_RUC','1790016918001') THEN
  RAISE EXCEPTION 'private RUC structural vector was rejected only by its legacy modulo-11 digit';
 END IF;
 IF pliego.fn_is_valid_ec_identification('EC_RUC','0090016918001')
  OR pliego.fn_is_valid_ec_identification('EC_RUC','1770001210001')
  OR pliego.fn_is_valid_ec_identification('EC_RUC','1790016918000')
  OR pliego.fn_is_valid_ec_identification('EC_RUC','1760001210000') THEN
  RAISE EXCEPTION 'RUC structure/province/establishment guard was relaxed';
 END IF;
END; $ruc_red$;

CREATE FUNCTION pg_temp.billing_correction_invoice(
 p_actor BIGINT,p_address BIGINT,p_edition BIGINT,p_type VARCHAR,p_number VARCHAR,p_outcome VARCHAR
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_cart BIGINT; v_item BIGINT; v_quantity INTEGER; v_order BIGINT; v_order_state VARCHAR;
 v_payment_state VARCHAR; v_total NUMERIC; v_reference VARCHAR; v_invoice BIGINT;
BEGIN
 CALL pliego.sp_cart_add_item(p_actor,p_edition,1,v_cart,v_item,v_quantity);
 CALL pliego.sp_checkout_billed_quoted(p_actor,uuidv4(),p_address,'TRANSFER',p_outcome,v_cart,
  'HOME_DELIVERY',NULL,NULL,p_type,p_number,'Comprador de prueba','Dirección fiscal',NULL,
  'Quito','Pichincha','EC',NULL,v_order,v_order_state,v_payment_state,v_total,v_reference,v_invoice);
 RETURN v_invoice;
END; $$;

DO $gate$
DECLARE
 v_suffix TEXT:=replace(uuidv4()::TEXT,'-',''); v_admin BIGINT; v_author BIGINT; v_publisher BIGINT;
 v_category BIGINT; v_book BIGINT; v_edition BIGINT; v_movement BIGINT; v_before INTEGER; v_after INTEGER;
 v_a BIGINT; v_b BIGINT; v_c BIGINT; v_d BIGINT; v_e BIGINT;
 v_customer_a BIGINT; v_customer_b BIGINT; v_customer_c BIGINT; v_customer_d BIGINT; v_customer_e BIGINT;
 v_state VARCHAR; v_address_a BIGINT; v_address_b BIGINT; v_address_c BIGINT; v_address_d BIGINT; v_address_e BIGINT;
 v_invoice BIGINT; v_invoice_b BIGINT; v_issued_c BIGINT; v_draft_c BIGINT; v_draft_d BIGINT; v_draft_e BIGINT;
 v_old_snapshot JSONB; v_after_snapshot JSONB; v_request BIGINT; v_replay BIGINT; v_second_request BIGINT;
 v_status VARCHAR; v_type VARCHAR; v_number VARCHAR; v_reason VARCHAR; v_created TIMESTAMPTZ; v_due TIMESTAMPTZ;
 v_decided TIMESTAMPTZ; v_decision_reason TEXT; v_count BIGINT; v_page_count BIGINT; v_key UUID:=uuidv4();
BEGIN
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES ('billing-corrections-admin-'||v_suffix||'@pliego.local','fixture-hash','ADMIN','ACTIVE')
 RETURNING usuario_id INTO v_admin;
 CALL pliego.sp_author_create(v_admin,'Autor correcciones '||v_suffix,NULL,v_author);
 CALL pliego.sp_publisher_create(v_admin,'Editorial correcciones '||v_suffix,NULL,v_publisher);
 CALL pliego.sp_category_create(v_admin,'Categoría correcciones '||v_suffix,'billing-corrections-'||v_suffix,NULL,NULL,v_category);
 CALL pliego.sp_book_create(v_admin,'Libro correcciones '||v_suffix,NULL,NULL,
  jsonb_build_array(jsonb_build_object('authorId',v_author,'order',1)),jsonb_build_array(v_category),v_book);
 CALL pliego.sp_edition_create(v_admin,v_book,v_publisher,'BILL-CORR-'||v_suffix,NULL,
  'es','PAPERBACK',100,NULL,9.50,NULL,NULL,NULL,NULL,v_edition);
 CALL pliego.sp_inventory_entry(v_admin,v_edition,30,'billing correction fixture',v_movement,v_before,v_after);

 CALL pliego.sp_customer_register('billing-corr-a-'||v_suffix||'@pliego.local','fixture-hash','Ana','Prueba',NULL,v_a,v_customer_a,v_state);
 CALL pliego.sp_customer_register('billing-corr-b-'||v_suffix||'@pliego.local','fixture-hash','Beto','Prueba',NULL,v_b,v_customer_b,v_state);
 CALL pliego.sp_customer_register('billing-corr-c-'||v_suffix||'@pliego.local','fixture-hash','Cecilia','Prueba',NULL,v_c,v_customer_c,v_state);
 CALL pliego.sp_customer_register('billing-corr-d-'||v_suffix||'@pliego.local','fixture-hash','Diego','Prueba',NULL,v_d,v_customer_d,v_state);
 CALL pliego.sp_customer_register('billing-corr-e-'||v_suffix||'@pliego.local','fixture-hash','Elena','Prueba',NULL,v_e,v_customer_e,v_state);
 CALL pliego.sp_address_create(v_a,'Casa','Ana Prueba','Calle A',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,v_address_a);
 CALL pliego.sp_address_create(v_b,'Casa','Beto Prueba','Calle B',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,v_address_b);
 CALL pliego.sp_address_create(v_c,'Casa','Cecilia Prueba','Calle C',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,v_address_c);
 CALL pliego.sp_address_create(v_d,'Casa','Diego Prueba','Calle D',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,v_address_d);
 CALL pliego.sp_address_create(v_e,'Casa','Elena Prueba','Calle E',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,v_address_e);

 -- An unused identity corrects directly without re-authentication.
 CALL pliego.sp_customer_billing_identity_register(v_a,'EC_CEDULA','0912345675');
 CALL pliego.sp_customer_billing_identity_correct(v_a,'EC_CEDULA','0912345675','1710034065');
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(v_a) WHERE identity_number='1710034065')
  OR NOT EXISTS(SELECT FROM pliego.cliente_identificacion_evento WHERE cliente_id=v_customer_a
    AND accion='CORRECTED' AND origen='PROFILE' AND numero_anterior='0912345675' AND numero_nuevo='1710034065') THEN
  RAISE EXCEPTION 'unused identity did not correct directly with audit';
 END IF;

 -- A DRAFT invoice counts as use, while the same person's cédula/RUC (suffix 001) remains direct.
 CALL pliego.sp_customer_billing_identity_register(v_b,'EC_CEDULA','0912345675');
 v_invoice_b:=pg_temp.billing_correction_invoice(v_b,v_address_b,v_edition,'EC_CEDULA','0912345675','PENDING');
 IF (SELECT estado FROM pliego.factura WHERE factura_id=v_invoice_b)<>'DRAFT'
  OR NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity_read_model(v_b) WHERE used AND correction_mode='REQUEST') THEN
  RAISE EXCEPTION 'DRAFT invoice did not mark the account identity used';
 END IF;
 CALL pliego.sp_customer_billing_identity_correct(v_b,'EC_RUC','0912345675','0912345675001');
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(v_b)
   WHERE identity_type='EC_RUC' AND identity_number='0912345675001')
  OR NOT EXISTS(SELECT FROM pliego.cliente_identificacion_evento WHERE cliente_id=v_customer_b
   AND accion='CORRECTED_SAME_PERSON' AND origen='PROFILE')
  OR (SELECT identidad_numero FROM pliego.factura WHERE factura_id=v_invoice_b)<>'0912345675' THEN
  RAISE EXCEPTION 'same-person correction was not direct/audited or rewrote the DRAFT invoice';
 END IF;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correct(v_b,'EC_CEDULA','0912345675001','1710034065');
  RAISE EXCEPTION 'an account that has already been billed bypassed review after the same-person RUC switch';
 EXCEPTION WHEN SQLSTATE 'P1107' THEN NULL; END;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(v_b)
   WHERE identity_type='EC_RUC' AND identity_number='0912345675001') THEN
  RAISE EXCEPTION 'review bypass changed the RUC account identity'; END IF;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correction_request_submit(v_b,uuidv4(),'0912345675001',
   'EC_CEDULA','0912345675','DOCUMENT_TYPO',NULL,v_request,v_status,v_type,v_number,v_reason,
   v_created,v_due,v_decided,v_decision_reason);
  RAISE EXCEPTION 'same-person conversion was accepted as a review request';
 EXCEPTION WHEN SQLSTATE 'P1110' THEN NULL; END;

 -- Two invoice states keep their buyer snapshots when a reviewed change is approved.
 CALL pliego.sp_customer_billing_identity_register(v_c,'EC_CEDULA','0912345675');
 v_issued_c:=pg_temp.billing_correction_invoice(v_c,v_address_c,v_edition,'EC_CEDULA','0912345675','APPROVED');
 v_draft_c:=pg_temp.billing_correction_invoice(v_c,v_address_c,v_edition,'EC_CEDULA','0912345675','PENDING');
 IF (SELECT estado FROM pliego.factura WHERE factura_id=v_issued_c)<>'ISSUED'
  OR (SELECT estado FROM pliego.factura WHERE factura_id=v_draft_c)<>'DRAFT' THEN RAISE EXCEPTION 'invoice state fixtures are wrong'; END IF;
 SELECT jsonb_agg(jsonb_build_array(f.factura_id,f.estado,f.identidad_tipo,f.identidad_numero,f.comprador_nombre,f.total,f.fecha_emision)
   ORDER BY f.factura_id) INTO v_old_snapshot FROM pliego.factura f WHERE f.factura_id IN (v_issued_c,v_draft_c);
 BEGIN
  CALL pliego.sp_customer_billing_identity_correct(v_c,'EC_CEDULA','0912345675','1710034065');
  RAISE EXCEPTION 'used arbitrary correction was applied directly';
 EXCEPTION WHEN SQLSTATE 'P1107' THEN NULL; END;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(v_c) WHERE identity_number='0912345675') THEN
  RAISE EXCEPTION 'review-required correction changed the account'; END IF;

 BEGIN
  CALL pliego.sp_customer_billing_identity_correction_request_submit(v_c,uuidv4(),'0912345675',
   'EC_CEDULA','1710034065',NULL,NULL,v_replay,v_status,v_type,v_number,v_reason,
   v_created,v_due,v_decided,v_decision_reason);
  RAISE EXCEPTION 'request without reason code was accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;

 CALL pliego.sp_customer_billing_identity_correction_request_submit(v_c,v_key,'0912345675',
  'EC_CEDULA','1710034065','DOCUMENT_TYPO','  El documento se capturó mal.  ',v_request,v_status,v_type,v_number,v_reason,
  v_created,v_due,v_decided,v_decision_reason);
 IF v_status<>'PENDING' OR v_type<>'EC_CEDULA' OR v_number<>'1710034065' OR v_reason<>'DOCUMENT_TYPO'
  OR v_due-v_created<>INTERVAL '15 days' OR v_decided IS NOT NULL OR v_decision_reason IS NOT NULL
  OR (SELECT nota FROM pliego.cliente_identificacion_solicitud_correccion WHERE solicitud_id=v_request)<>'El documento se capturó mal.' THEN
  RAISE EXCEPTION 'request submission snapshot, trim, or due date is wrong'; END IF;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correct(v_c,'EC_RUC','0912345675','0912345675001');
  RAISE EXCEPTION 'direct correction was allowed while a request was pending';
 EXCEPTION WHEN SQLSTATE 'P1108' THEN NULL; END;
 CALL pliego.sp_customer_billing_identity_correction_request_submit(v_c,v_key,'0912345675',
  'EC_CEDULA','1710034065','DOCUMENT_TYPO','El documento se capturó mal.',v_replay,v_status,v_type,v_number,v_reason,
  v_created,v_due,v_decided,v_decision_reason);
 IF v_replay<>v_request THEN RAISE EXCEPTION 'same-key/same-payload request replay changed identity'; END IF;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correction_request_submit(v_c,v_key,'0912345675',
   'EC_CEDULA','1710034066','DOCUMENT_TYPO','El documento se capturó mal.',v_replay,v_status,v_type,v_number,v_reason,
   v_created,v_due,v_decided,v_decision_reason);
  RAISE EXCEPTION 'same key with changed request payload was accepted';
 EXCEPTION WHEN SQLSTATE 'P1010' THEN NULL; END;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correction_request_submit(v_c,uuidv4(),'0912345675',
   'EC_CEDULA','1710034065','DOCUMENT_TYPO',NULL,v_replay,v_status,v_type,v_number,v_reason,
   v_created,v_due,v_decided,v_decision_reason);
  RAISE EXCEPTION 'second pending request was accepted';
 EXCEPTION WHEN SQLSTATE 'P1108' THEN NULL; END;
 BEGIN
  CALL pliego.sp_admin_billing_identity_correction_decide(v_admin,v_request,NULL,NULL,v_status,v_decided,v_replay,v_decision_reason);
  RAISE EXCEPTION 'request without a decision was accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correction_request_withdraw(v_a,v_request);
  RAISE EXCEPTION 'another customer request was visible to withdraw';
 EXCEPTION WHEN SQLSTATE 'P1109' THEN NULL; END;
 BEGIN
  CALL pliego.sp_admin_billing_identity_correction_decide(v_c,v_request,'APPROVE',NULL,v_status,v_decided,v_replay,v_decision_reason);
  RAISE EXCEPTION 'customer was accepted as an admin';
 EXCEPTION WHEN SQLSTATE 'P1004' THEN NULL; END;
 SELECT count(*) INTO v_page_count FROM pliego.fn_admin_billing_identity_correction_requests(v_admin,'PENDING',0,20);
 IF v_page_count<1 THEN RAISE EXCEPTION 'admin could not list pending requests'; END IF;
 SELECT total_count INTO v_page_count FROM pliego.fn_admin_billing_identity_correction_requests(v_admin,'PENDING',100,20);
 IF v_page_count IS NULL OR v_page_count<1 THEN RAISE EXCEPTION 'empty admin page lost the filtered total count'; END IF;
 BEGIN
  PERFORM 1 FROM pliego.fn_admin_billing_identity_correction_requests(v_admin,'PENDING',2147483647,50);
  RAISE EXCEPTION 'overflowing admin page offset was accepted';
 EXCEPTION WHEN SQLSTATE 'P1006' THEN NULL; END;
 CALL pliego.sp_customer_billing_identity_correction_request_withdraw(v_c,v_request);
 IF (SELECT estado FROM pliego.cliente_identificacion_solicitud_correccion WHERE solicitud_id=v_request)<>'WITHDRAWN'
  OR NOT EXISTS(SELECT FROM pliego.cliente_identificacion_evento WHERE cliente_id=v_customer_c AND accion='CORRECTION_WITHDRAWN')
  OR NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity_read_model(v_c) WHERE correction_request_status='WITHDRAWN') THEN
  RAISE EXCEPTION 'withdrawal status, audit, or recent read projection is missing'; END IF;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correction_request_withdraw(v_c,v_request);
  RAISE EXCEPTION 'closed request transitioned twice';
 EXCEPTION WHEN SQLSTATE 'P1111' THEN NULL; END;

 -- Resubmit with a new key and approve; both the ISSUED and DRAFT snapshots stay byte-for-byte equal.
 CALL pliego.sp_customer_billing_identity_correction_request_submit(v_c,uuidv4(),'0912345675',
  'EC_CEDULA','1710034065','DOCUMENT_TYPO',NULL,v_second_request,v_status,v_type,v_number,v_reason,
  v_created,v_due,v_decided,v_decision_reason);
 CALL pliego.sp_admin_billing_identity_correction_decide(v_admin,v_second_request,'APPROVE',NULL,
  v_status,v_decided,v_replay,v_decision_reason);
 IF v_status<>'APPROVED' OR v_decided IS NULL OR v_replay<>v_admin
  OR NOT EXISTS(SELECT FROM pliego.cliente_identificacion_evento WHERE cliente_id=v_customer_c
    AND accion='CORRECTION_APPROVED' AND origen='STAFF_REVIEW')
  OR NOT EXISTS(SELECT FROM pliego.cliente_identificacion WHERE cliente_id=v_customer_c AND identidad_numero='1710034065') THEN
  RAISE EXCEPTION 'admin approval did not apply/account for the correction'; END IF;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correct(v_c,'EC_CEDULA','1710034065','0912345675');
  RAISE EXCEPTION 'an account that has already been billed bypassed review after admin approval';
 EXCEPTION WHEN SQLSTATE 'P1107' THEN NULL; END;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity_read_model(v_c)
   WHERE used AND correction_mode='REQUEST' AND correction_request_status='APPROVED') THEN
  RAISE EXCEPTION 'account-level usage disappeared after admin approval'; END IF;
 SELECT jsonb_agg(jsonb_build_array(f.factura_id,f.estado,f.identidad_tipo,f.identidad_numero,f.comprador_nombre,f.total,f.fecha_emision)
   ORDER BY f.factura_id) INTO v_after_snapshot FROM pliego.factura f WHERE f.factura_id IN (v_issued_c,v_draft_c);
 IF v_old_snapshot IS DISTINCT FROM v_after_snapshot
  OR (SELECT estado FROM pliego.factura WHERE factura_id=v_draft_c)<>'DRAFT'
  OR (SELECT estado FROM pliego.factura WHERE factura_id=v_issued_c)<>'ISSUED' THEN
  RAISE EXCEPTION 'approval modified an invoice snapshot or state'; END IF;
 BEGIN
  CALL pliego.sp_admin_billing_identity_correction_decide(v_admin,v_second_request,'REJECT','No procede.',
   v_status,v_decided,v_replay,v_decision_reason);
  RAISE EXCEPTION 'second decision transition was accepted';
 EXCEPTION WHEN SQLSTATE 'P1111' THEN NULL; END;

 -- A stale request remains pending and its compare-and-set failure rolls back the decision.
 CALL pliego.sp_customer_billing_identity_register(v_d,'EC_CEDULA','0912345675');
 v_draft_d:=pg_temp.billing_correction_invoice(v_d,v_address_d,v_edition,'EC_CEDULA','0912345675','PENDING');
 CALL pliego.sp_customer_billing_identity_correction_request_submit(v_d,uuidv4(),'0912345675',
  'EC_CEDULA','1710034065','DOCUMENT_CHANGED',NULL,v_request,v_status,v_type,v_number,v_reason,
  v_created,v_due,v_decided,v_decision_reason);
 -- Simulate an authorized concurrent internal write after submission so approval's CAS still fails closed.
 PERFORM set_config('pliego.identity_correction',v_customer_d::TEXT,true);
 UPDATE pliego.cliente_identificacion SET identidad_tipo='EC_RUC',identidad_numero='0912345675001'
  WHERE cliente_id=v_customer_d;
 PERFORM set_config('pliego.identity_correction','',true);
 INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo_anterior,
  identidad_tipo,numero_anterior,numero_nuevo)
 VALUES(v_customer_d,'CORRECTED_SAME_PERSON','PROFILE','EC_CEDULA','EC_RUC','0912345675','0912345675001');
 BEGIN
  CALL pliego.sp_admin_billing_identity_correction_decide(v_admin,v_request,'APPROVE',NULL,
   v_status,v_decided,v_replay,v_decision_reason);
  RAISE EXCEPTION 'stale correction request was approved';
 EXCEPTION WHEN SQLSTATE 'P1105' THEN NULL; END;
 IF (SELECT estado FROM pliego.cliente_identificacion_solicitud_correccion WHERE solicitud_id=v_request)<>'PENDING'
  OR (SELECT identidad_numero FROM pliego.cliente_identificacion WHERE cliente_id=v_customer_d)<>'0912345675001'
  OR (SELECT identidad_numero FROM pliego.factura WHERE factura_id=v_draft_d)<>'0912345675' THEN
  RAISE EXCEPTION 'stale approval changed request/account/invoice state'; END IF;

 -- Reject requires customer-facing Spanish text, writes an audit event, and is final.
 CALL pliego.sp_customer_billing_identity_register(v_e,'EC_CEDULA','0912345675');
 v_draft_e:=pg_temp.billing_correction_invoice(v_e,v_address_e,v_edition,'EC_CEDULA','0912345675','PENDING');
 CALL pliego.sp_customer_billing_identity_correction_request_submit(v_e,uuidv4(),'0912345675',
  'EC_CEDULA','1710034065','OTHER',NULL,v_request,v_status,v_type,v_number,v_reason,
  v_created,v_due,v_decided,v_decision_reason);
 BEGIN
  CALL pliego.sp_admin_billing_identity_correction_decide(v_admin,v_request,'REJECT','   ',
   v_status,v_decided,v_replay,v_decision_reason);
  RAISE EXCEPTION 'rejection without a reason was accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 CALL pliego.sp_admin_billing_identity_correction_decide(v_admin,v_request,'REJECT',
  'La documentación no permite confirmar el cambio solicitado.',v_status,v_decided,v_replay,v_decision_reason);
 IF v_status<>'REJECTED' OR v_decision_reason<>'La documentación no permite confirmar el cambio solicitado.'
  OR NOT EXISTS(SELECT FROM pliego.cliente_identificacion_evento WHERE cliente_id=v_customer_e
    AND accion='CORRECTION_REJECTED' AND origen='STAFF_REVIEW')
  OR (SELECT identidad_numero FROM pliego.cliente_identificacion WHERE cliente_id=v_customer_e)<>'0912345675'
  OR (SELECT identidad_numero FROM pliego.factura WHERE factura_id=v_draft_e)<>'0912345675' THEN
  RAISE EXCEPTION 'rejection changed the account/invoice or omitted audit'; END IF;

 -- Request rows and the audit ledger remain immutable outside one guarded decision transition.
 BEGIN
  UPDATE pliego.cliente_identificacion_solicitud_correccion SET nota='altered' WHERE solicitud_id=v_request;
  RAISE EXCEPTION 'request mutable fields were edited';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 BEGIN
  UPDATE pliego.cliente_identificacion_evento SET origen='PROFILE' WHERE cliente_id=v_customer_c AND accion='CORRECTION_APPROVED';
  RAISE EXCEPTION 'billing identity audit event was edited';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 BEGIN
  DELETE FROM pliego.cliente_identificacion_evento WHERE cliente_id=v_customer_c AND accion='CORRECTION_APPROVED';
  RAISE EXCEPTION 'billing identity audit event was deleted';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
END; $gate$;
ROLLBACK;
SELECT 'PASS: tiered identity corrections, requests, role checks, transitions, immutable audit, RUC structure, and invoice snapshots';
