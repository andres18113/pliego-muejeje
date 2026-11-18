-- Disposable PostgreSQL 18 only. Identity-bound login and current-address recovery.
\set ON_ERROR_STOP on
BEGIN;
DO $gate$
DECLARE actor BIGINT; customer BIGINT; admin_id BIGINT; state VARCHAR; promoted VARCHAR;
 old_email VARCHAR := 'email-change-security-current@example.invalid';
 new_email VARCHAR := 'email-change-security-new@example.invalid';
 old_password VARCHAR := 'fixture-password-before-reset';
BEGIN
 -- Password recovery was already available to ADMIN; customer-change fencing must preserve it.
 SELECT usuario_id INTO STRICT admin_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' ORDER BY usuario_id LIMIT 1;
 PERFORM pliego.fn_email_action_enqueue(admin_id,'RESET_PASSWORD',repeat('6',64)::VARCHAR,repeat('G',43)::VARCHAR);
 IF NOT pliego.fn_email_action_consume('RESET_PASSWORD',repeat('6',64)::VARCHAR,'fixture-admin-after-reset') THEN
  RAISE EXCEPTION 'Email-change security fencing regressed existing ADMIN password recovery'; END IF;
 CALL pliego.sp_customer_register(old_email,old_password,'Cliente','Seguridad',NULL,actor,customer,state);
 PERFORM pliego.fn_email_action_enqueue(actor,'VERIFY_EMAIL',repeat('a',64)::VARCHAR,repeat('A',43)::VARCHAR);
 IF NOT pliego.fn_email_action_consume('VERIFY_EMAIL',repeat('a',64)::VARCHAR,NULL) THEN
  RAISE EXCEPTION 'Security fixture could not verify its current address'; END IF;
 PERFORM pliego.fn_auth_session_create(actor,repeat('b',64)::VARCHAR,clock_timestamp()+INTERVAL '1 day');
 PERFORM pliego.fn_customer_email_change_request(actor,new_email,repeat('1',64)::VARCHAR,
  repeat('B',43)::VARCHAR,repeat('2',64)::VARCHAR,repeat('C',43)::VARCHAR);
 promoted := pliego.fn_email_change_confirm(repeat('1',64)::VARCHAR);
 IF promoted IS DISTINCT FROM new_email OR EXISTS(SELECT FROM pliego.sesion_autenticacion
  WHERE usuario_id=actor AND fecha_revocacion IS NULL) THEN
  RAISE EXCEPTION 'Confirmation did not promote the address and revoke every existing refresh session'; END IF;
 -- The BCrypt result was obtained while the old login email was still current.
 IF pliego.fn_auth_session_create_identity_checked(actor,repeat('c',64)::VARCHAR,
  clock_timestamp()+INTERVAL '1 day',old_password,old_email) THEN
  RAISE EXCEPTION 'A stale old-address login created a refresh session after email confirmation'; END IF;
 IF EXISTS(SELECT FROM pliego.sesion_autenticacion WHERE usuario_id=actor AND fecha_revocacion IS NULL) THEN
  RAISE EXCEPTION 'Rejected stale login persisted an active session'; END IF;
 IF NOT pliego.fn_auth_session_create_identity_checked(actor,repeat('d',64)::VARCHAR,
  clock_timestamp()+INTERVAL '1 day',old_password,new_email) THEN
  RAISE EXCEPTION 'Login using the confirmed canonical email was rejected'; END IF;

 PERFORM pliego.fn_customer_email_change_request(actor,'email-change-security-next@example.invalid',
  repeat('3',64)::VARCHAR,repeat('D',43)::VARCHAR,repeat('4',64)::VARCHAR,repeat('E',43)::VARCHAR);
 PERFORM pliego.fn_email_action_enqueue(actor,'RESET_PASSWORD',repeat('5',64)::VARCHAR,repeat('F',43)::VARCHAR);
 IF NOT pliego.fn_email_action_consume('RESET_PASSWORD',repeat('5',64)::VARCHAR,'fixture-password-after-reset') THEN
  RAISE EXCEPTION 'Current-address password recovery did not succeed'; END IF;
 IF EXISTS(SELECT FROM pliego.correo_cambio WHERE usuario_id=actor AND estado='PENDING')
  OR NOT EXISTS(SELECT FROM pliego.correo_cambio WHERE usuario_id=actor AND estado='CANCELLED'
   AND email_pendiente='email-change-security-next@example.invalid') THEN
  RAISE EXCEPTION 'Successful recovery left a pending email change usable'; END IF;
 IF (SELECT email_normalizado FROM pliego.usuario WHERE usuario_id=actor) IS DISTINCT FROM new_email
  OR EXISTS(SELECT FROM pliego.sesion_autenticacion WHERE usuario_id=actor AND fecha_revocacion IS NULL) THEN
  RAISE EXCEPTION 'Recovery changed the current email or retained an active refresh session'; END IF;
 BEGIN
  PERFORM pliego.fn_email_change_confirm(repeat('3',64)::VARCHAR);
  RAISE EXCEPTION 'A pre-recovery pending confirmation remained usable';
 EXCEPTION WHEN SQLSTATE 'P1127' THEN NULL;
 END;
 IF pliego.fn_auth_session_create_identity_checked(actor,repeat('e',64)::VARCHAR,
  clock_timestamp()+INTERVAL '1 day',old_password,new_email) THEN
  RAISE EXCEPTION 'Recovery allowed an earlier password check to create a session'; END IF;
END $gate$;
ROLLBACK;
\echo 'Pending email security SQL passed: identity-bound session creation, confirmed login, current-address reset cancels pending change and revokes refresh.'
