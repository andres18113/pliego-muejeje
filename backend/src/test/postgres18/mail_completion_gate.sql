-- Completion fencing, including a provider reply after lease reaping. Disposable DB.
BEGIN;
DO $gate$
DECLARE actor BIGINT; id BIGINT; owner UUID; claimed RECORD; applied BOOLEAN;
BEGIN
 UPDATE pliego.correo_outbox SET proximo_intento=clock_timestamp()+INTERVAL '1 day' WHERE estado='PENDING';
 INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
 VALUES('mail-completion-gate@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO actor;
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 VALUES('mail-completion-gate','ORDER_CONFIRMED',actor,'reader@example.invalid','{}') RETURNING correo_id INTO id;
 SELECT * INTO claimed FROM pliego.fn_mail_outbox_claim();
 IF claimed.correo_id<>id THEN RAISE EXCEPTION 'wrong test claim'; END IF;
 owner:=claimed.propietario;
 applied:=pliego.fn_mail_outbox_try_complete(id,uuidv4(),'SENT',NULL,'wrong-owner-id');
 IF applied OR (SELECT estado FROM pliego.correo_outbox WHERE correo_id=id)<>'SENDING' THEN RAISE EXCEPTION 'foreign completion accepted'; END IF;
 UPDATE pliego.correo_outbox SET lease_hasta=clock_timestamp()-INTERVAL '1 second' WHERE correo_id=id;
 PERFORM * FROM pliego.fn_mail_outbox_claim();
 applied:=pliego.fn_mail_outbox_try_complete(id,owner,'SENT',NULL,'late-provider-id');
 IF applied OR NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE correo_id=id AND estado='FAILED'
  AND ultimo_error='AMBIGUOUS_DELIVERY' AND id_mensaje_proveedor IS NULL) THEN RAISE EXCEPTION 'late completion overwrote reaped lease'; END IF;
 INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
 VALUES('mail-completion-valid','ORDER_CONFIRMED',actor,'reader@example.invalid','{}') RETURNING correo_id INTO id;
 SELECT * INTO claimed FROM pliego.fn_mail_outbox_claim();
 applied:=pliego.fn_mail_outbox_try_complete(id,claimed.propietario,'SENT',NULL,'valid-provider-id');
 IF NOT applied OR NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE correo_id=id AND estado='SENT' AND id_mensaje_proveedor='valid-provider-id') THEN RAISE EXCEPTION 'valid completion not persisted'; END IF;
 IF pliego.fn_mail_outbox_try_complete(id,claimed.propietario,'RETRY','MAILTRAP_HTTP_503',NULL) THEN RAISE EXCEPTION 'terminal completion repeated'; END IF;
END $gate$;
ROLLBACK;
