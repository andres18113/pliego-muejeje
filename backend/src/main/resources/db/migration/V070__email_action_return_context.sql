-- Add navigation metadata to the newly enqueued action within its existing business
-- transaction. No change to credentials, verification, quotas, recipients or legacy API.
CREATE FUNCTION pliego.fn_email_action_set_return_path(p_nonce VARCHAR, p_return_path VARCHAR)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 IF p_nonce IS NULL OR p_nonce !~ '^[A-Za-z0-9_-]{43}$'
 OR p_return_path IS NULL OR length(p_return_path)>2048
 OR p_return_path LIKE '//%'
 OR p_return_path ~ '[[:cntrl:]\\]'
 OR p_return_path !~ '^/(catalog(/editions/[1-9][0-9]{0,18})?|ofertas|favorites|cart|checkout|account(/addresses)?|(orders|biblioteca)(/[1-9][0-9]{0,18})?)?/?([?#].*)?$' THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 UPDATE pliego.correo_outbox
 SET datos = datos || jsonb_build_object('returnTo',p_return_path)
 WHERE estado='PENDING' AND tipo IN ('VERIFY_EMAIL','RESET_PASSWORD')
   AND datos->>'nonce'=p_nonce;
END; $$;
