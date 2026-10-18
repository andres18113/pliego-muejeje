-- Synthetic algorithm fixtures only; never evidence of identity/existence.
BEGIN;
DO $gate$
DECLARE sample TEXT; u BIGINT; c BIGINT; state VARCHAR;
BEGIN
 IF pliego.fn_is_valid_ec_cedula(NULL) OR pliego.fn_is_valid_ec_cedula('') THEN RAISE EXCEPTION 'NULL/empty accepted'; END IF;
 IF NOT pliego.fn_is_valid_ec_cedula(' 0012345674 ') THEN RAISE EXCEPTION 'leading zero/trim rejected'; END IF;
 FOREACH sample IN ARRAY ARRAY['0000000000','1111111111','0012345670','001234567','00123456740','00123 5676','+0012345674','00123456.6','００１２３４５６７６','abcdefghij'] LOOP
  IF pliego.fn_is_valid_ec_cedula(sample) THEN RAISE EXCEPTION 'invalid cedula accepted'; END IF;
 END LOOP;
 CALL pliego.sp_customer_register('cedula-fixture@pliego.local','fixture-hash','Cliente','Prueba',NULL,u,c,state);
 IF EXISTS(SELECT FROM pliego.fn_customer_billing_identity(u)) THEN RAISE EXCEPTION 'unexpected profile identity'; END IF;
 CALL pliego.sp_customer_billing_identity_set(u,'EC_CEDULA',' 0012345674 ');
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_billing_identity(u) WHERE identity_type='EC_CEDULA' AND identity_number='0012345674') THEN RAISE EXCEPTION 'profile snapshot mismatch'; END IF;
 BEGIN
  CALL pliego.sp_customer_billing_identity_set(u,'EC_CEDULA','0012345670');
  RAISE EXCEPTION 'invalid profile identity accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN
  INSERT INTO pliego.cliente_identificacion(cliente_id,identidad_tipo,identidad_numero) VALUES(c,'EC_CEDULA','0012345670') ON CONFLICT(cliente_id) DO UPDATE SET identidad_numero=EXCLUDED.identidad_numero;
  RAISE EXCEPTION 'direct invalid profile identity accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 CALL pliego.sp_customer_billing_identity_remove(u);
 IF EXISTS(SELECT FROM pliego.fn_customer_billing_identity(u)) THEN RAISE EXCEPTION 'identity not removed'; END IF;
END; $gate$;
ROLLBACK;
