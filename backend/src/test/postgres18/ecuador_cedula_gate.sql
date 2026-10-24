-- Synthetic algorithm fixtures only; never evidence of identity/existence.
BEGIN;
DO $gate$
DECLARE sample TEXT; u BIGINT; c BIGINT; state VARCHAR; u2 BIGINT; c2 BIGINT;
BEGIN
 IF pliego.fn_is_valid_ec_cedula(NULL) OR pliego.fn_is_valid_ec_cedula('') THEN RAISE EXCEPTION 'NULL/empty accepted'; END IF;
 IF NOT pliego.fn_is_valid_ec_cedula(' 0912345675 ') THEN RAISE EXCEPTION 'leading zero/trim rejected'; END IF;
 FOREACH sample IN ARRAY ARRAY['0000000000','1111111111','0012345670','001234567','09123456750','00123 5676','+0912345675','00123456.6','００１２３４５６７６','abcdefghij'] LOOP
  IF pliego.fn_is_valid_ec_cedula(sample) THEN RAISE EXCEPTION 'invalid cedula accepted'; END IF;
 END LOOP;
 CALL pliego.sp_customer_register('cedula-fixture@pliego.local','fixture-hash','Cliente','Prueba',NULL,u,c,state);
 IF EXISTS(SELECT FROM pliego.fn_customer_billing_identity(u)) THEN RAISE EXCEPTION 'unexpected profile identity'; END IF;
 -- Registration: validated, idempotent for the same number, never a silent overwrite.
 CALL pliego.sp_customer_billing_identity_register(u,'EC_CEDULA',' 0912345675 ');
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(u) WHERE identity_type='EC_CEDULA' AND identity_number='0912345675') THEN RAISE EXCEPTION 'profile snapshot mismatch'; END IF;
 CALL pliego.sp_customer_billing_identity_register(u,'EC_CEDULA','0912345675');
 IF (SELECT count(*) FROM pliego.cliente_identificacion_evento WHERE cliente_id=c)<>1 THEN RAISE EXCEPTION 'repeated registration audited twice'; END IF;
 BEGIN
  CALL pliego.sp_customer_billing_identity_register(u,'EC_CEDULA','0012345670');
  RAISE EXCEPTION 'invalid profile identity accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_customer_billing_identity_register(u,'EC_CEDULA','1710034065');
  RAISE EXCEPTION 'registration overwrote a stored identity';
 EXCEPTION WHEN SQLSTATE 'P1105' THEN NULL; END;
 -- Neither direct DML nor the retired routines can change or remove it.
 BEGIN
  UPDATE pliego.cliente_identificacion SET identidad_numero='1710034065' WHERE cliente_id=c;
  RAISE EXCEPTION 'direct update accepted';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 BEGIN
  DELETE FROM pliego.cliente_identificacion WHERE cliente_id=c;
  RAISE EXCEPTION 'direct delete accepted';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 BEGIN
  INSERT INTO pliego.cliente_identificacion(cliente_id,identidad_tipo,identidad_numero) VALUES(c,'EC_CEDULA','0012345670') ON CONFLICT(cliente_id) DO UPDATE SET identidad_numero=EXCLUDED.identidad_numero;
  RAISE EXCEPTION 'direct invalid profile identity accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF to_regprocedure('pliego.sp_customer_billing_identity_remove(bigint)') IS NOT NULL
  OR to_regprocedure('pliego.sp_customer_billing_identity_set(bigint,character varying,character varying)') IS NOT NULL THEN
  RAISE EXCEPTION 'retired identity routines still exist'; END IF;
 -- Correction: compare-and-set against the number seen, a real change, and an audit entry.
 BEGIN
  CALL pliego.sp_customer_billing_identity_correct(u,'EC_CEDULA','1710034065','1712345675');
  RAISE EXCEPTION 'stale correction accepted';
 EXCEPTION WHEN SQLSTATE 'P1105' THEN NULL; END;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correct(u,'EC_CEDULA','0912345675','0912345675');
  RAISE EXCEPTION 'no-op correction accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_customer_billing_identity_correct(u,'EC_CEDULA','0912345675','0012345670');
  RAISE EXCEPTION 'invalid correction accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 CALL pliego.sp_customer_billing_identity_correct(u,'EC_CEDULA',' 0912345675 ','1710034065');
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(u) WHERE identity_number='1710034065') THEN RAISE EXCEPTION 'correction not applied'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.cliente_identificacion_evento WHERE cliente_id=c AND accion='CORRECTED' AND origen='PROFILE'
  AND numero_anterior='0912345675' AND numero_nuevo='1710034065') THEN RAISE EXCEPTION 'correction not audited'; END IF;
 IF current_setting('pliego.identity_correction',true)<>'' THEN RAISE EXCEPTION 'correction marker leaked'; END IF;
 BEGIN
  UPDATE pliego.cliente_identificacion_evento SET numero_nuevo='0912345675' WHERE cliente_id=c;
  RAISE EXCEPTION 'audit is mutable';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 -- A correction never reaches another customer.
 CALL pliego.sp_customer_register('cedula-fixture-2@pliego.local','fixture-hash','Otra','Prueba',NULL,u2,c2,state);
 BEGIN
  CALL pliego.sp_customer_billing_identity_correct(u2,'EC_CEDULA','1710034065','0912345675');
  RAISE EXCEPTION 'correction without own identity accepted';
 EXCEPTION WHEN SQLSTATE 'P1105' THEN NULL; END;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(u) WHERE identity_number='1710034065') THEN RAISE EXCEPTION 'foreign identity changed'; END IF;
 -- ADR 0041: the full algorithm for new values, and a RUC of each kind, including a correction across kinds.
 BEGIN
  CALL pliego.sp_customer_billing_identity_register(u2,'EC_CEDULA','0012345674');
  RAISE EXCEPTION 'province 00 accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_customer_billing_identity_register(u2,'EC_CEDULA','1790016919001');
  RAISE EXCEPTION 'RUC accepted as cedula';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  CALL pliego.sp_customer_billing_identity_register(u2,'EC_RUC','1790016918001');
  RAISE EXCEPTION 'RUC with wrong check digit accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 CALL pliego.sp_customer_billing_identity_register(u2,'EC_RUC',' 1790016919001 ');
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(u2) WHERE identity_type='EC_RUC' AND identity_number='1790016919001') THEN RAISE EXCEPTION 'RUC not registered'; END IF;
 CALL pliego.sp_customer_billing_identity_correct(u2,'EC_RUC','1790016919001','1760001200001');
 CALL pliego.sp_customer_billing_identity_correct(u2,'EC_CEDULA','1760001200001','1710034065');
 IF NOT EXISTS(SELECT FROM pliego.cliente_identificacion_evento WHERE cliente_id=c2 AND accion='CORRECTED'
  AND identidad_tipo_anterior='EC_RUC' AND identidad_tipo='EC_CEDULA' AND numero_anterior='1760001200001' AND numero_nuevo='1710034065') THEN
  RAISE EXCEPTION 'cross-kind correction not audited'; END IF;
 BEGIN
  INSERT INTO pliego.cliente_identificacion_evento(cliente_id,accion,origen,identidad_tipo,numero_nuevo) VALUES(c2,'REGISTERED','PROFILE','EC_RUC','1790016918001');
  RAISE EXCEPTION 'invalid audited RUC accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END; $gate$;
ROLLBACK;
