-- Run after V039. Assertions exercise real PostgreSQL business routines; no network.
BEGIN;
DO $gate$
DECLARE
 uid BIGINT; cid BIGINT; v_state VARCHAR; rec RECORD; oid BIGINT; n INTEGER;
BEGIN
 CALL pliego.sp_customer_register_with_verification('mail-gate@example.com','old-hash','Ana','Pérez',NULL,
   repeat('a',64)::VARCHAR,repeat('n',43)::VARCHAR,uid,cid,v_state);
 IF v_state <> 'PENDING_VERIFICATION' OR NOT EXISTS(SELECT FROM pliego.fn_user_auth_data('mail-gate@example.com') WHERE state='UNVERIFIED') THEN
   RAISE EXCEPTION 'new registration did not require verification'; END IF;
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id=uid AND tipo='VERIFY_EMAIL')<>1 THEN
   RAISE EXCEPTION 'registration not atomic with verification outbox'; END IF;
 UPDATE pliego.correo_token SET fecha_expiracion=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE usuario_id=uid;
 IF pliego.fn_email_action_consume('VERIFY_EMAIL',repeat('a',64),NULL) THEN RAISE EXCEPTION 'expired verification accepted'; END IF;
 UPDATE pliego.correo_token SET fecha_expiracion=CURRENT_TIMESTAMP+INTERVAL '1 day' WHERE usuario_id=uid;
 IF pliego.fn_email_action_request('mail-gate@example.com','VERIFY_EMAIL',repeat('b',64),repeat('m',43),repeat('1',64)) THEN
   RAISE EXCEPTION 'resend bypassed cooldown'; END IF;
 UPDATE pliego.correo_token SET fecha_creacion=fecha_creacion-INTERVAL '2 minutes' WHERE usuario_id=uid;
 IF NOT pliego.fn_email_action_request('mail-gate@example.com','VERIFY_EMAIL',repeat('b',64),repeat('m',43),repeat('1',64)) THEN
   RAISE EXCEPTION 'resend did not create replacement'; END IF;
 IF pliego.fn_email_action_consume('VERIFY_EMAIL',repeat('a',64),NULL) THEN RAISE EXCEPTION 'old token remained valid'; END IF;
 IF NOT pliego.fn_email_action_consume('VERIFY_EMAIL',repeat('b',64),NULL) THEN RAISE EXCEPTION 'valid token rejected'; END IF;
 IF pliego.fn_email_action_consume('VERIFY_EMAIL',repeat('b',64),NULL) THEN RAISE EXCEPTION 'token reused'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_user_auth_data('mail-gate@example.com') WHERE state='ACTIVE') THEN RAISE EXCEPTION 'verification did not enable login'; END IF;
 PERFORM pliego.fn_auth_session_create(uid,repeat('c',64),CURRENT_TIMESTAMP+INTERVAL '1 day');
 IF NOT pliego.fn_email_action_request('mail-gate@example.com','RESET_PASSWORD',repeat('d',64),repeat('p',43),repeat('2',64)) THEN RAISE EXCEPTION 'reset request rejected'; END IF;
 IF pliego.fn_email_action_consume('VERIFY_EMAIL',repeat('d',64),NULL) THEN RAISE EXCEPTION 'cross purpose token accepted'; END IF;
 UPDATE pliego.correo_token SET fecha_expiracion=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE usuario_id=uid AND tipo='RESET_PASSWORD';
 IF pliego.fn_email_action_consume('RESET_PASSWORD',repeat('d',64),'new-hash') THEN RAISE EXCEPTION 'expired reset accepted'; END IF;
 UPDATE pliego.correo_token SET fecha_creacion=fecha_creacion-INTERVAL '2 minutes' WHERE usuario_id=uid;
 PERFORM pliego.fn_email_action_request('mail-gate@example.com','RESET_PASSWORD',repeat('e',64),repeat('q',43),repeat('3',64));
 IF NOT pliego.fn_email_action_consume('RESET_PASSWORD',repeat('e',64),'new-hash') THEN RAISE EXCEPTION 'valid reset rejected'; END IF;
 IF (SELECT password_hash FROM pliego.usuario WHERE usuario_id=uid)<>'new-hash' OR EXISTS(SELECT FROM pliego.sesion_autenticacion WHERE usuario_id=uid AND fecha_revocacion IS NULL) THEN
   RAISE EXCEPTION 'reset did not change password/revoke sessions'; END IF;
 IF pliego.fn_email_action_consume('RESET_PASSWORD',repeat('e',64),'another-hash') THEN RAISE EXCEPTION 'reset reused'; END IF;
 IF pliego.fn_auth_session_create_checked(uid,repeat('9',64),CURRENT_TIMESTAMP+INTERVAL '1 day','old-hash') THEN
   RAISE EXCEPTION 'login issued session after reset using a stale password check'; END IF;
 IF pliego.fn_email_action_request('unknown-mail-gate@example.com','RESET_PASSWORD',repeat('f',64),repeat('r',43),repeat('4',64)) THEN RAISE EXCEPTION 'unknown account scheduled mail'; END IF;
 FOR n IN 1..21 LOOP
  PERFORM pliego.fn_email_action_request(('limit-'||n||'@example.com')::VARCHAR,'RESET_PASSWORD',repeat('f',64),repeat('r',43),repeat('5',64));
 END LOOP;
 IF (SELECT count(*) FROM pliego.correo_limite WHERE clave='IP:'||repeat('5',64) AND solicitudes=21)<>1 THEN RAISE EXCEPTION 'IP requests not counted'; END IF;
 IF EXISTS(SELECT FROM pliego.correo_limite WHERE clave='EMAIL:'||encode(sha256(convert_to('limit-21@example.com','UTF8')),'hex')) THEN
  RAISE EXCEPTION 'limited IP still created unbounded email buckets'; END IF;
 -- Queued token emails already consumed become terminal and cannot leak stale tokens.
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE usuario_id=uid AND estado='PENDING') THEN RAISE EXCEPTION 'consumed action still pending'; END IF;

 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 VALUES('mail-gate-retry','ORDER_CONFIRMED',uid,'mail-gate@example.com','{"orderId":"42"}') RETURNING correo_id INTO oid;
 SELECT * INTO rec FROM pliego.fn_mail_outbox_claim();
 IF rec.correo_id IS DISTINCT FROM oid OR rec.intentos<>1 THEN RAISE EXCEPTION 'claim failed'; END IF;
 IF EXISTS(SELECT FROM pliego.fn_mail_outbox_claim()) THEN RAISE EXCEPTION 'claimed twice'; END IF;
 PERFORM pliego.fn_mail_outbox_complete(oid,rec.propietario,'RETRY','MAILTRAP_HTTP_429');
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE correo_id=oid AND estado='PENDING' AND proximo_intento>CURRENT_TIMESTAMP AND intentos=1) THEN RAISE EXCEPTION 'retry not persisted'; END IF;
 FOR n IN 2..5 LOOP
   UPDATE pliego.correo_outbox SET proximo_intento=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE correo_id=oid;
   SELECT * INTO rec FROM pliego.fn_mail_outbox_claim();
   IF rec.intentos<>n THEN RAISE EXCEPTION 'attempt counter wrong'; END IF;
   PERFORM pliego.fn_mail_outbox_complete(oid,rec.propietario,'RETRY','MAILTRAP_HTTP_503');
 END LOOP;
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE correo_id=oid AND estado='FAILED' AND intentos=5) THEN RAISE EXCEPTION 'retry not bounded'; END IF;
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 VALUES('mail-gate-sent','ORDER_CONFIRMED',uid,'mail-gate@example.com','{}') RETURNING correo_id INTO oid;
 SELECT * INTO rec FROM pliego.fn_mail_outbox_claim();
 PERFORM pliego.fn_mail_outbox_complete(oid,uuidv4(),'SENT',NULL);
 IF (SELECT estado FROM pliego.correo_outbox WHERE correo_id=oid)<>'SENDING' THEN RAISE EXCEPTION 'foreign worker completed claim'; END IF;
 PERFORM pliego.fn_mail_outbox_complete(oid,rec.propietario,'SENT',NULL,'mailtrap-gate-message-id');
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE correo_id=oid AND estado='SENT'
   AND id_mensaje_proveedor='mailtrap-gate-message-id') THEN RAISE EXCEPTION 'provider receipt was not correlated'; END IF;
 PERFORM pliego.fn_mail_outbox_complete(oid,rec.propietario,'RETRY','MAILTRAP_HTTP_503');
 IF (SELECT estado FROM pliego.correo_outbox WHERE correo_id=oid)<>'SENT' THEN RAISE EXCEPTION 'completion not idempotent'; END IF;
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 VALUES('mail-gate-ambiguous','ORDER_CONFIRMED',uid,'mail-gate@example.com','{}') RETURNING correo_id INTO oid;
 SELECT * INTO rec FROM pliego.fn_mail_outbox_claim();
 UPDATE pliego.correo_outbox SET lease_hasta=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE correo_id=oid;
 PERFORM * FROM pliego.fn_mail_outbox_claim();
 IF (SELECT estado FROM pliego.correo_outbox WHERE correo_id=oid)<>'FAILED' THEN RAISE EXCEPTION 'uncertain delivery requeued'; END IF;
 -- Verification of a changed email joins the caller's transaction and invalidates old actions/sessions.
 PERFORM pliego.fn_auth_session_create(uid,repeat('8',64),CURRENT_TIMESTAMP+INTERVAL '1 day');
 CALL pliego.sp_customer_change_email(uid,'mail-gate-changed@example.com',v_state);
 PERFORM pliego.fn_email_verification_for_user(uid,repeat('7',64),repeat('s',43));
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE usuario_id=uid AND destinatario='mail-gate-changed@example.com' AND estado='PENDING')
 OR EXISTS(SELECT FROM pliego.sesion_autenticacion WHERE usuario_id=uid AND fecha_revocacion IS NULL) THEN RAISE EXCEPTION 'email change not transactionally safe'; END IF;
 BEGIN
  CALL pliego.sp_customer_register_with_verification('mail-rollback@example.com','fixture','Ana','Pérez',NULL,
   repeat('6',64)::VARCHAR,'invalid'::VARCHAR,uid,cid,v_state);
  RAISE EXCEPTION 'invalid token accepted';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL;
 END;
 IF EXISTS(SELECT FROM pliego.usuario WHERE email_normalizado='mail-rollback@example.com') THEN RAISE EXCEPTION 'mail intent failure did not roll back registration'; END IF;
END $gate$;
ROLLBACK;
