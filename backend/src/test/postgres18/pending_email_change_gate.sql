-- Disposable PostgreSQL 18 only. No provider, network or real email; all fixtures roll back.
BEGIN;
CREATE FUNCTION pg_temp.expect_state(command TEXT, expected TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=expected THEN RETURN; END IF;
  RAISE EXCEPTION 'Expected SQLSTATE %, got %',expected,SQLSTATE;
 END;
 RAISE EXCEPTION 'Expected SQLSTATE %, command succeeded',expected;
END $$;
DO $gate$
DECLARE actor BIGINT; customer BIGINT; other_user BIGINT; other_customer BIGINT; state VARCHAR;
 result RECORD; current_change UUID; old_change UUID; mail BIGINT; owner UUID; initial_verified TIMESTAMPTZ;
 at_time TIMESTAMPTZ; old_recipient VARCHAR; i INTEGER;
BEGIN
 CALL pliego.sp_customer_register('pending-current@example.invalid','fixture','Ana','Pérez',NULL,actor,customer,state);
 CALL pliego.sp_customer_register('pending-other@example.invalid','fixture','Luis','Mora',NULL,other_user,other_customer,state);
 UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id=actor RETURNING email_verificado_en INTO initial_verified;
 PERFORM pliego.fn_auth_session_create(actor,repeat('1',64)::VARCHAR,clock_timestamp()+INTERVAL '1 day');
 SELECT * INTO result FROM pliego.fn_customer_email_change_request(actor,'  Pending-New@Example.INVALID ',repeat('a',64)::VARCHAR,repeat('a',43)::VARCHAR,repeat('b',64)::VARCHAR,repeat('b',43)::VARCHAR);
 IF result.email<>'pending-current@example.invalid' OR result.address<>'pending-new@example.invalid'
  OR result.expires_at NOT BETWEEN clock_timestamp()+INTERVAL '23 hours 59 minutes' AND clock_timestamp()+INTERVAL '24 hours 1 minute'
 THEN RAISE EXCEPTION 'request contract/normalization/24h violated'; END IF;
 SELECT cambio_id INTO current_change FROM pliego.correo_cambio WHERE usuario_id=actor AND estado='PENDING';
 IF NOT EXISTS(SELECT FROM pliego.usuario WHERE usuario_id=actor AND email_normalizado=result.email AND email_verificado_en=initial_verified)
  OR NOT EXISTS(SELECT FROM pliego.sesion_autenticacion WHERE usuario_id=actor AND fecha_revocacion IS NULL)
 THEN RAISE EXCEPTION 'pending request changed identity/verification/sessions'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_user_auth_data('pending-current@example.invalid') a WHERE a.user_id=actor AND a.state='ACTIVE')
  OR EXISTS(SELECT FROM pliego.fn_user_auth_data('pending-new@example.invalid')) THEN RAISE EXCEPTION 'pending changed login identity'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE usuario_id=actor AND tipo='EMAIL_CHANGE_CONFIRM' AND destinatario=result.address AND datos->>'nonce'=repeat('a',43) AND NOT datos ? 'oldEmail')
  OR NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE usuario_id=actor AND tipo='EMAIL_CHANGE_REQUESTED' AND destinatario=result.email AND datos->>'maskedEmail'='pe•••@example.invalid')
 THEN RAISE EXCEPTION 'request recipients/payload unsafe'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_profile_email_change(actor) WHERE pending_email_address=result.address AND pending_email_delivery='OK') THEN RAISE EXCEPTION 'pending profile missing'; END IF;
 -- Unchanged/taken/invalid requests preserve the prior request.
 PERFORM pg_temp.expect_state(format('SELECT * FROM pliego.fn_customer_email_change_request(%s,%L,%L,%L,%L,%L)',actor,'PENDING-CURRENT@example.invalid',repeat('c',64),repeat('c',43),repeat('d',64),repeat('d',43)),'P1120');
 PERFORM pg_temp.expect_state(format('SELECT * FROM pliego.fn_customer_email_change_request(%s,%L,%L,%L,%L,%L)',actor,'pending-other@example.invalid',repeat('c',64),repeat('c',43),repeat('d',64),repeat('d',43)),'P1101');
 PERFORM pg_temp.expect_state(format('SELECT * FROM pliego.fn_customer_email_change_request(%s,%L,%L,%L,%L,%L)',actor,'sin-arroba',repeat('c',64),repeat('c',43),repeat('d',64),repeat('d',43)),'P1001');
 -- Replacing invalidates confirm AND recovery tokens and queued credentials.
 old_change:=current_change;
 PERFORM * FROM pliego.fn_customer_email_change_request(actor,'pending-replacement@example.invalid',repeat('c',64)::VARCHAR,repeat('c',43)::VARCHAR,repeat('d',64)::VARCHAR,repeat('d',43)::VARCHAR);
 SELECT cambio_id INTO current_change FROM pliego.correo_cambio WHERE usuario_id=actor AND estado='PENDING';
 IF current_change=old_change OR (SELECT estado FROM pliego.correo_cambio WHERE cambio_id=old_change)<>'SUPERSEDED' THEN RAISE EXCEPTION 'request was not versioned'; END IF;
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_confirm(%L)',repeat('a',64)),'P1126');
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_cancel(%L)',repeat('b',64)),'P1126');
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE datos->>'changeId'=old_change::TEXT AND estado='PENDING') THEN RAISE EXCEPTION 'old credential still queued'; END IF;
 -- Resend rotates only confirm. Cooldown and hourly quota enforced in DB.
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_customer_email_change_resend(%s,%L,%L)',actor,repeat('e',64),repeat('e',43)),'P1122');
 UPDATE pliego.correo_cambio SET ultimo_envio_en=clock_timestamp()-INTERVAL '2 minutes' WHERE cambio_id=current_change;
 PERFORM pliego.fn_customer_email_change_resend(actor,repeat('e',64)::VARCHAR,repeat('e',43)::VARCHAR);
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_confirm(%L)',repeat('c',64)),'P1126');
 IF pliego.fn_email_change_token_nonce('EMAIL_CHANGE_CANCEL',repeat('d',64)::VARCHAR)<>repeat('d',43) THEN RAISE EXCEPTION 'resend invalidated recovery'; END IF;
 PERFORM pliego.fn_email_change_cancel(repeat('d',64)::VARCHAR);
 PERFORM pliego.fn_email_change_cancel(repeat('d',64)::VARCHAR);
 PERFORM pliego.fn_customer_email_change_cancel(actor);
 IF EXISTS(SELECT FROM pliego.fn_customer_profile_email_change(actor) WHERE pending_email_address IS NOT NULL) THEN RAISE EXCEPTION 'cancelled pending still visible'; END IF;
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_confirm(%L)',repeat('e',64)),'P1127');
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_customer_email_change_resend(%s,%L,%L)',actor,repeat('f',64),repeat('f',43)),'P1121');
 -- Expired reads null and cannot be consumed or resent.
 PERFORM * FROM pliego.fn_customer_email_change_request(actor,'pending-expired@example.invalid',repeat('1',64)::VARCHAR,repeat('1',43)::VARCHAR,repeat('2',64)::VARCHAR,repeat('2',43)::VARCHAR);
 UPDATE pliego.correo_cambio SET fecha_expiracion=clock_timestamp()-INTERVAL '1 second' WHERE usuario_id=actor AND estado='PENDING';
 IF EXISTS(SELECT FROM pliego.fn_customer_profile_email_change(actor) WHERE pending_email_address IS NOT NULL) THEN RAISE EXCEPTION 'expired pending visible'; END IF;
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_confirm(%L)',repeat('1',64)),'P1124');
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_cancel(%L)',repeat('2',64)),'P1124');
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_customer_email_change_resend(%s,%L,%L)',actor,repeat('f',64),repeat('f',43)),'P1121');
 -- Address is not reserved. Conflict at confirmation rolls back ALL side effects.
 PERFORM * FROM pliego.fn_customer_email_change_request(actor,'pending-race@example.invalid',repeat('3',64)::VARCHAR,repeat('3',43)::VARCHAR,repeat('4',64)::VARCHAR,repeat('4',43)::VARCHAR);
 CALL pliego.sp_customer_register('pending-race@example.invalid','fixture','Eva','Mora',NULL,other_user,other_customer,state);
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_confirm(%L)',repeat('3',64)),'P1101');
 IF NOT EXISTS(SELECT FROM pliego.correo_cambio WHERE usuario_id=actor AND estado='PENDING' AND email_pendiente='pending-race@example.invalid')
  OR NOT EXISTS(SELECT FROM pliego.sesion_autenticacion WHERE usuario_id=actor AND fecha_revocacion IS NULL)
  OR EXISTS(SELECT FROM pliego.correo_outbox WHERE usuario_id=actor AND tipo='EMAIL_CHANGED') THEN RAISE EXCEPTION 'uniqueness conflict partially committed'; END IF;
 -- Fifth request allowed; sixth rejected with stable quota. Recovery still works.
 PERFORM * FROM pliego.fn_customer_email_change_request(actor,'pending-final@example.invalid',repeat('5',64)::VARCHAR,repeat('5',43)::VARCHAR,repeat('6',64)::VARCHAR,repeat('6',43)::VARCHAR);
 PERFORM pg_temp.expect_state(format('SELECT * FROM pliego.fn_customer_email_change_request(%s,%L,%L,%L,%L,%L)',actor,'pending-sixth@example.invalid',repeat('7',64),repeat('7',43),repeat('8',64),repeat('8',43)),'P1122');
 -- A pending bounce or suppression never poisons the current/global recipient state.
 SELECT correo_id INTO mail FROM pliego.correo_outbox WHERE token_hash=repeat('5',64);
 UPDATE pliego.correo_outbox SET estado='SENT',id_mensaje_proveedor='pending-bounce-message' WHERE correo_id=mail;
 at_time:=clock_timestamp();
 PERFORM pliego.fn_mail_event_record('pending-bounce','pending-bounce-message','BOUNCED','HARD_BOUNCE',at_time,'MAILTRAP');
 WHILE pliego.fn_mail_event_project_next() LOOP END LOOP;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_profile_email_change(actor) WHERE pending_email_delivery='UNDELIVERABLE' AND email_delivery_status='OK')
  OR EXISTS(SELECT FROM pliego.correo_destinatario_entrega WHERE destinatario='pending-final@example.invalid' AND motivo IS NOT NULL)
 THEN RAISE EXCEPTION 'pending bounce affected account/global delivery'; END IF;
 PERFORM pliego.fn_mail_event_record('pending-delivery','pending-bounce-message','DELIVERED',NULL,at_time+INTERVAL '1 second','MAILTRAP');
 WHILE pliego.fn_mail_event_project_next() LOOP END LOOP;
 PERFORM pliego.fn_mail_event_record('pending-old-bounce','pending-bounce-message','BOUNCED','HARD_BOUNCE',at_time-INTERVAL '1 second','MAILTRAP');
 WHILE pliego.fn_mail_event_project_next() LOOP END LOOP;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_profile_email_change(actor) WHERE pending_email_delivery='OK') THEN RAISE EXCEPTION 'stale pending failure won'; END IF;
 PERFORM pliego.fn_mail_event_record('pending-suppressed','pending-bounce-message','SUPPRESSED','SUPPRESSED',at_time+INTERVAL '2 seconds','MAILTRAP');
 WHILE pliego.fn_mail_event_project_next() LOOP END LOOP;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_profile_email_change(actor) WHERE pending_email_delivery='UNDELIVERABLE' AND email_delivery_status='OK') THEN RAISE EXCEPTION 'pending suppression mapping'; END IF;
 -- The current address may be blocked and still be corrected. Held mail remains held.
 UPDATE pliego.usuario SET email_no_entregable_desde=at_time,email_entrega_motivo='HARD_BOUNCE' WHERE usuario_id=actor;
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,estado,ultimo_error)
 VALUES('pending-held','ORDER_CONFIRMED',actor,'pending-current@example.invalid','{}','HELD','EMAIL_UNDELIVERABLE');
 IF pliego.fn_email_change_confirm(repeat('5',64)::VARCHAR)<>'pending-final@example.invalid' THEN RAISE EXCEPTION 'confirm response incorrect'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.usuario WHERE usuario_id=actor AND email_normalizado='pending-final@example.invalid' AND email_verificado_en IS NOT NULL AND email_no_entregable_desde IS NULL)
  OR EXISTS(SELECT FROM pliego.sesion_autenticacion WHERE usuario_id=actor AND fecha_revocacion IS NULL)
  OR EXISTS(SELECT FROM pliego.fn_customer_profile_email_change(actor) WHERE pending_email_address IS NOT NULL)
 THEN RAISE EXCEPTION 'promotion incomplete'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE usuario_id=actor AND tipo='EMAIL_CHANGED' AND destinatario='pending-current@example.invalid' AND datos->>'maskedEmail'='pe•••@example.invalid')
  OR (SELECT estado FROM pliego.correo_outbox WHERE evento_clave='pending-held')<>'HELD' THEN RAISE EXCEPTION 'final notice/held invariant'; END IF;
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_confirm(%L)',repeat('5',64)),'P1125');
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_cancel(%L)',repeat('6',64)),'P1128');
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_confirm(%L)',repeat('9',64)),'P1123');
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_email_change_confirm(%L)',repeat('6',64)),'P1123');
 -- Late confirmation bounce after promotion must never poison the new current email.
 PERFORM pliego.fn_mail_event_record('pending-after-confirm','pending-bounce-message','BOUNCED','HARD_BOUNCE',at_time+INTERVAL '3 seconds','MAILTRAP');
 WHILE pliego.fn_mail_event_project_next() LOOP END LOOP;
 IF (SELECT email_delivery_status FROM pliego.fn_customer_profile_email_change(actor))<>'OK' THEN RAISE EXCEPTION 'late pending bounce poisoned promoted account'; END IF;
 -- Blocked-current customer CAN request; unverified current state also remains unchanged.
 DELETE FROM pliego.correo_limite WHERE clave='EMAIL_CHANGE:'||actor;
 UPDATE pliego.usuario SET email_no_entregable_desde=at_time,email_entrega_motivo='HARD_BOUNCE',email_verificado_en=NULL WHERE usuario_id=actor;
 PERFORM * FROM pliego.fn_customer_email_change_request(actor,'pending-correction@example.invalid',repeat('7',64)::VARCHAR,repeat('7',43)::VARCHAR,repeat('8',64)::VARCHAR,repeat('8',43)::VARCHAR);
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_profile_email_change(actor) WHERE NOT email_verified AND email_delivery_status='UNDELIVERABLE' AND pending_email_address IS NOT NULL) THEN RAISE EXCEPTION 'blocked/unverified request lost current state'; END IF;
 PERFORM pliego.fn_customer_email_change_cancel(actor);
 PERFORM pliego.fn_customer_email_change_cancel(actor);
END $gate$;
DO $worker$
DECLARE actor BIGINT; customer BIGINT; state VARCHAR; c UUID; old_c UUID; o RECORD; mail BIGINT; i INTEGER;
BEGIN
 CALL pliego.sp_customer_register('pending-worker@example.invalid','fixture','Ana','Mora',NULL,actor,customer,state);
 UPDATE pliego.correo_outbox SET proximo_intento=clock_timestamp()+INTERVAL '1 day' WHERE estado='PENDING';
 PERFORM * FROM pliego.fn_customer_email_change_request(actor,'pending-worker-new@example.invalid',repeat('a1',32)::VARCHAR,repeat('A',43)::VARCHAR,repeat('b1',32)::VARCHAR,repeat('B',43)::VARCHAR);
 SELECT cambio_id INTO c FROM pliego.correo_cambio WHERE usuario_id=actor AND estado='PENDING';
 SELECT * INTO o FROM pliego.fn_mail_outbox_claim();
 IF o.tipo<>'EMAIL_CHANGE_CONFIRM' OR o.destinatario<>'pending-worker-new@example.invalid'
  OR NOT pliego.fn_mail_outbox_prepare_send(o.correo_id,o.propietario) THEN RAISE EXCEPTION 'claim rejected valid change token'; END IF;
 UPDATE pliego.correo_cambio SET fecha_expiracion=clock_timestamp()-INTERVAL '1 second' WHERE cambio_id=c;
 IF pliego.fn_mail_outbox_prepare_send(o.correo_id,o.propietario) THEN RAISE EXCEPTION 'claimed expired token reached provider'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE correo_id=o.correo_id AND estado='FAILED') THEN RAISE EXCEPTION 'expired claimed row not fenced'; END IF;
 -- Expired queued cancel notice must also be fenced at claim.
 PERFORM 1 FROM pliego.fn_mail_outbox_claim();
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE datos->>'changeId'=c::TEXT AND estado IN('PENDING','SENDING')) THEN RAISE EXCEPTION 'expired request still queued'; END IF;
 PERFORM * FROM pliego.fn_customer_email_change_request(actor,'pending-worker-second@example.invalid',repeat('c1',32)::VARCHAR,repeat('C',43)::VARCHAR,repeat('d1',32)::VARCHAR,repeat('D',43)::VARCHAR);
 SELECT * INTO o FROM pliego.fn_mail_outbox_claim();
 old_c:=c;
 SELECT cambio_id INTO c FROM pliego.correo_cambio WHERE usuario_id=actor AND estado='PENDING';
 PERFORM * FROM pliego.fn_customer_email_change_request(actor,'pending-worker-third@example.invalid',repeat('e1',32)::VARCHAR,repeat('E',43)::VARCHAR,repeat('f1',32)::VARCHAR,repeat('F',43)::VARCHAR);
 IF pliego.fn_mail_outbox_prepare_send(o.correo_id,o.propietario) THEN RAISE EXCEPTION 'superseded claimed token reached provider'; END IF;
 -- A late bounce from the replaced version cannot contaminate the successor.
 UPDATE pliego.correo_outbox SET id_mensaje_proveedor='pending-obsolete-message' WHERE correo_id=o.correo_id;
 PERFORM pliego.fn_mail_event_record('pending-obsolete-bounce','pending-obsolete-message','BOUNCED','HARD_BOUNCE',clock_timestamp(),'MAILTRAP');
 WHILE pliego.fn_mail_event_project_next() LOOP END LOOP;
 IF (SELECT pending_email_delivery FROM pliego.fn_customer_profile_email_change(actor))<>'OK' THEN RAISE EXCEPTION 'obsolete version poisoned successor'; END IF;
 SELECT cambio_id INTO c FROM pliego.correo_cambio WHERE usuario_id=actor AND estado='PENDING';
 -- Independent hourly resend quota; each rotation preserves original expiry/recovery token.
 FOR i IN 1..5 LOOP
  UPDATE pliego.correo_cambio SET ultimo_envio_en=clock_timestamp()-INTERVAL '2 minutes' WHERE cambio_id=c;
  PERFORM pliego.fn_customer_email_change_resend(actor,encode(sha256(convert_to('resend-'||i,'UTF8')),'hex')::VARCHAR,repeat('G',43)::VARCHAR);
 END LOOP;
 UPDATE pliego.correo_cambio SET ultimo_envio_en=clock_timestamp()-INTERVAL '2 minutes' WHERE cambio_id=c;
 PERFORM pg_temp.expect_state(format('SELECT pliego.fn_customer_email_change_resend(%s,%L,%L)',actor,repeat('ab',32),repeat('H',43)),'P1122');
 IF NOT EXISTS(SELECT FROM pliego.correo_cambio_token WHERE cambio_id=c AND tipo='EMAIL_CHANGE_CANCEL' AND token_hash=repeat('f1',32) AND invalidado_en IS NULL) THEN RAISE EXCEPTION 'resend replaced recovery'; END IF;
 -- A known historic suppression holds the confirmation and exposes pending delivery only.
 INSERT INTO pliego.correo_destinatario_entrega(destinatario,motivo,desde,ocurrido_en,prioridad,evento_id)
 VALUES('pending-worker-third@example.invalid','SUPPRESSED',clock_timestamp(),clock_timestamp(),2,'pending-historic');
 SELECT * INTO o FROM pliego.fn_mail_outbox_claim();
 -- The recovery notice can be first: it is still deliverable to CURRENT address.
 IF o.tipo='EMAIL_CHANGE_REQUESTED' THEN
  IF NOT pliego.fn_mail_outbox_prepare_send(o.correo_id,o.propietario) THEN RAISE EXCEPTION 'current notice held by pending suppression'; END IF;
  PERFORM pliego.fn_mail_outbox_try_complete(o.correo_id,o.propietario,'SENT',NULL,'pending-requested-receipt');
  SELECT * INTO o FROM pliego.fn_mail_outbox_claim();
 END IF;
 IF o.tipo<>'EMAIL_CHANGE_CONFIRM' OR pliego.fn_mail_outbox_prepare_send(o.correo_id,o.propietario) THEN RAISE EXCEPTION 'known suppression was sent'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_profile_email_change(actor) WHERE pending_email_delivery='UNDELIVERABLE' AND email_delivery_status='OK') THEN RAISE EXCEPTION 'hold not mapped to pending'; END IF;
END $worker$;
ROLLBACK;
