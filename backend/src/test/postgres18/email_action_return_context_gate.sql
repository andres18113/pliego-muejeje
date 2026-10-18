-- Disposable database only; the fixture and all changes roll back.
BEGIN;
DO $$
DECLARE uid BIGINT; cid BIGINT; state VARCHAR; bad VARCHAR;
 nonce VARCHAR := repeat('Q',43); old_data JSONB;
BEGIN
 CALL pliego.sp_customer_register_with_verification(
  ('return-context-'||txid_current()||'@example.invalid')::VARCHAR,
  ('$2a$12$'||repeat('a',53))::VARCHAR,'Ana'::VARCHAR,'Pérez'::VARCHAR,NULL::VARCHAR,
  repeat('f',64)::VARCHAR,nonce,uid,cid,state);
 PERFORM pliego.fn_email_action_set_return_path(nonce,'/cart?source=edition#items'::VARCHAR);
 IF NOT EXISTS(SELECT FROM pliego.correo_outbox WHERE usuario_id=uid AND tipo='VERIFY_EMAIL'
  AND estado='PENDING' AND datos->>'returnTo'='/cart?source=edition#items')
 THEN RAISE EXCEPTION 'New pending verification lost return context'; END IF;
 IF EXISTS(SELECT FROM pliego.usuario WHERE usuario_id=uid AND email_verificado_en IS NOT NULL)
 THEN RAISE EXCEPTION 'Navigation metadata bypassed verification'; END IF;
 FOREACH bad IN ARRAY ARRAY['//evil.test/cart','https://evil.test/cart','/admin','/cart/../admin','/cart/%2e%2e/admin','/cart\evil',E'/cart\n'] LOOP
  BEGIN
   PERFORM pliego.fn_email_action_set_return_path(nonce,bad);
   RAISE EXCEPTION 'Unsafe Database API return context accepted';
  EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL;
  END;
 END LOOP;
 SELECT datos INTO old_data FROM pliego.correo_outbox WHERE usuario_id=uid;
 -- An already sent snapshot is immutable to this narrowly scoped command.
 UPDATE pliego.correo_outbox SET estado='SENT' WHERE usuario_id=uid;
 PERFORM pliego.fn_email_action_set_return_path(nonce,'/favorites'::VARCHAR);
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE usuario_id=uid AND datos<>old_data)
 THEN RAISE EXCEPTION 'Historical sent message was modified'; END IF;
END $$;
ROLLBACK;
