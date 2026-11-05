-- Disposable PostgreSQL 18 only; no provider calls and no customer resends.
BEGIN;
DO $gate$
DECLARE actor BIGINT; customer BIGINT; state VARCHAR; mail BIGINT; pending BIGINT; held BIGINT;
 claimed RECORD; changed VARCHAR; base TIMESTAMPTZ:=clock_timestamp()-INTERVAL '1 hour';
BEGIN
 UPDATE pliego.correo_outbox SET proximo_intento=clock_timestamp()+INTERVAL '1 day' WHERE estado='PENDING';
 CALL pliego.sp_customer_register('delivery-gate@example.invalid','fixture','Ana','Pérez',NULL,actor,customer,state);
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 VALUES('deliverability-gate','ORDER_CONFIRMED',actor,'delivery-gate@example.invalid','{}') RETURNING correo_id INTO mail;
 -- An event can arrive before receipt completion; it is kept, not lost or guessed.
 IF NOT pliego.fn_mail_event_record('gate-bounce','gate-message','BOUNCED','HARD_BOUNCE',base,'MAILTRAP') THEN RAISE EXCEPTION 'record failed'; END IF;
 IF pliego.fn_mail_event_project_next() THEN RAISE EXCEPTION 'unknown message projected'; END IF;
 SELECT * INTO claimed FROM pliego.fn_mail_outbox_claim();
 IF claimed.correo_id<>mail OR NOT pliego.fn_mail_outbox_prepare_send(mail,claimed.propietario) THEN RAISE EXCEPTION 'new recipient blocked'; END IF;
 IF NOT pliego.fn_mail_outbox_try_complete(mail,claimed.propietario,'SENT',NULL,'gate-message') THEN RAISE EXCEPTION 'receipt failed'; END IF;
 IF NOT pliego.fn_mail_event_project_next() THEN RAISE EXCEPTION 'late receipt not correlated'; END IF;
 IF (SELECT entrega_estado FROM pliego.correo_outbox WHERE correo_id=mail)<>'BOUNCED' THEN RAISE EXCEPTION 'bounce not projected'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_profile_delivery(actor) WHERE email_delivery_status='UNDELIVERABLE' AND email_delivery_since=base) THEN RAISE EXCEPTION 'profile not blocked'; END IF;
 -- Replay is a no-op; same ID/different data is rejected, not overwritten.
 IF NOT pliego.fn_mail_event_record('gate-bounce','gate-message','BOUNCED','HARD_BOUNCE',base,'MAILTRAP') THEN RAISE EXCEPTION 'replay rejected'; END IF;
 IF pliego.fn_mail_event_project_next() THEN RAISE EXCEPTION 'replay projected twice'; END IF;
 IF pliego.fn_mail_event_record('gate-bounce','other-message','DELIVERED',NULL,base,'MAILTRAP') THEN RAISE EXCEPTION 'conflicting replay accepted'; END IF;
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 VALUES('deliverability-held','ORDER_STATUS',actor,'delivery-gate@example.invalid','{}') RETURNING correo_id INTO held;
 SELECT * INTO claimed FROM pliego.fn_mail_outbox_claim();
 IF pliego.fn_mail_outbox_prepare_send(held,claimed.propietario) THEN RAISE EXCEPTION 'known bad address sent'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE correo_id=held AND estado='HELD' AND ultimo_error='EMAIL_UNDELIVERABLE' AND id_mensaje_proveedor IS NULL) THEN RAISE EXCEPTION 'held not observable'; END IF;
 IF EXISTS(SELECT FROM pliego.fn_mail_outbox_claim()) THEN RAISE EXCEPTION 'held reclaimed'; END IF;
 -- Stale delivery cannot erase a later bounce; a later delivery can.
 PERFORM pliego.fn_mail_event_record('gate-old','gate-message','DELIVERED',NULL,base-INTERVAL '1 second','MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 IF (SELECT email_delivery_status FROM pliego.fn_customer_profile_delivery(actor))<>'UNDELIVERABLE' THEN RAISE EXCEPTION 'stale delivery cleared bounce'; END IF;
 PERFORM pliego.fn_mail_event_record('gate-delivery','gate-message','DELIVERED',NULL,base+INTERVAL '1 second','MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 IF (SELECT email_delivery_status FROM pliego.fn_customer_profile_delivery(actor))<>'OK' THEN RAISE EXCEPTION 'delivery did not clear'; END IF;
 IF (SELECT estado FROM pliego.correo_outbox WHERE correo_id=held)<>'HELD' THEN RAISE EXCEPTION 'delivery auto-requeued'; END IF;
 PERFORM pliego.fn_mail_event_record('gate-domain','gate-message','REJECTED',NULL,base+INTERVAL '2 seconds','MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 IF (SELECT email_delivery_status FROM pliego.fn_customer_profile_delivery(actor))<>'OK' THEN RAISE EXCEPTION 'domain reject blocked address'; END IF;
 -- Delivery between two failures can arrive last. Since is the latest decisive failure.
 PERFORM pliego.fn_mail_event_record('gate-perm-first','gate-message','BOUNCED','HARD_BOUNCE',base+INTERVAL '4 seconds','MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 PERFORM pliego.fn_mail_event_record('gate-perm-last','gate-message','BOUNCED','HARD_BOUNCE',base+INTERVAL '6 seconds','MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 PERFORM pliego.fn_mail_event_record('gate-perm-middle','gate-message','DELIVERED',NULL,base+INTERVAL '5 seconds','MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 IF (SELECT email_delivery_since FROM pliego.fn_customer_profile_delivery(actor))<>base+INTERVAL '6 seconds' THEN RAISE EXCEPTION 'since depends on arrival order'; END IF;
 PERFORM pliego.fn_mail_event_record('gate-suppression','gate-message','SUPPRESSED','SUPPRESSED',base+INTERVAL '7 seconds','MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 CALL pliego.sp_customer_change_email(actor,'corrected-gate@example.invalid',changed);
 IF NOT EXISTS(SELECT FROM pliego.fn_customer_profile_delivery(actor) WHERE email_delivery_status='OK' AND email_delivery_since IS NULL AND NOT email_verified) THEN RAISE EXCEPTION 'change did not clear delivery/verification'; END IF;
 -- Another late event for the old address must not poison the new profile.
 PERFORM pliego.fn_mail_event_record('gate-after-change','gate-message','BOUNCED','HARD_BOUNCE',clock_timestamp(),'MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 IF (SELECT email_delivery_status FROM pliego.fn_customer_profile_delivery(actor))<>'OK' THEN RAISE EXCEPTION 'old address poisoned new profile'; END IF;
 -- Mailtrap timestamps have whole-second precision; capture time identifies the email generation.
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,estado,id_mensaje_proveedor)
 VALUES('deliverability-same-second','VERIFY_EMAIL',actor,'corrected-gate@example.invalid','{}','SENT','same-second-message');
 PERFORM pliego.fn_mail_event_record('gate-same-second','same-second-message','BOUNCED','HARD_BOUNCE',date_trunc('second',clock_timestamp()),'MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 IF (SELECT email_delivery_status FROM pliego.fn_customer_profile_delivery(actor))<>'UNDELIVERABLE' THEN RAISE EXCEPTION 'same-second failure not exposed'; END IF;
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 VALUES('deliverability-old-snapshot','INVOICE_ISSUED',actor,'delivery-gate@example.invalid','{}') RETURNING correo_id INTO pending;
 SELECT * INTO claimed FROM pliego.fn_mail_outbox_claim();
 IF pliego.fn_mail_outbox_prepare_send(pending,claimed.propietario) THEN RAISE EXCEPTION 'old snapshot no longer blocked'; END IF;
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE correo_id IN(mail,held,pending) AND estado='PENDING') THEN RAISE EXCEPTION 'events auto-requeued mail'; END IF;
 -- A -> B -> A: a current-generation event must not copy an excluded old-generation event.
 CALL pliego.sp_customer_change_email(actor,'delivery-gate@example.invalid',changed);
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,estado,id_mensaje_proveedor)
 VALUES('deliverability-returned','VERIFY_EMAIL',actor,'delivery-gate@example.invalid','{}','SENT','returned-message');
 PERFORM pliego.fn_mail_event_record('gate-old-generation','gate-message','BOUNCED','HARD_BOUNCE',clock_timestamp()+INTERVAL '2 seconds','MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 PERFORM pliego.fn_mail_event_record('gate-new-generation','returned-message','DELIVERED',NULL,clock_timestamp()+INTERVAL '1 second','MAILTRAP');
 PERFORM pliego.fn_mail_event_project_next();
 IF (SELECT email_delivery_status FROM pliego.fn_customer_profile_delivery(actor))<>'OK' THEN RAISE EXCEPTION 'old generation copied into eligible event'; END IF;
END $gate$;
ROLLBACK;
