-- A worker must distinguish its accepted completion from a stale, fenced write.
-- Keep the established void maintenance signatures unchanged.
CREATE FUNCTION pliego.fn_mail_outbox_try_complete(p_id BIGINT,p_owner UUID,
 p_result VARCHAR,p_error VARCHAR,p_provider_message_id VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 IF p_result IS NULL OR p_result NOT IN ('SENT','RETRY','FAILED')
 OR (p_error IS NOT NULL AND p_error !~ '^[A-Z0-9_]{1,80}$')
 OR (p_provider_message_id IS NOT NULL AND
    (p_result<>'SENT' OR p_provider_message_id !~ '^[A-Za-z0-9._:-]{1,128}$')) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 PERFORM correo_id FROM pliego.correo_outbox
  WHERE correo_id=p_id AND propietario=p_owner AND estado='SENDING' FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 PERFORM pliego.fn_mail_outbox_complete(p_id,p_owner,p_result,p_error,p_provider_message_id);
 RETURN TRUE;
END;
$$;
