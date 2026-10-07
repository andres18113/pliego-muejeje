-- Persist the provider acceptance identifier so an outbox entry can be matched
-- to Mailtrap Email Logs and later transactional delivery events.
ALTER TABLE pliego.correo_outbox
 ADD COLUMN id_mensaje_proveedor VARCHAR(128),
 ADD CONSTRAINT ck_correo_outbox_provider_message_id
  CHECK(id_mensaje_proveedor IS NULL OR id_mensaje_proveedor ~ '^[A-Za-z0-9._:-]{1,128}$');

CREATE UNIQUE INDEX uq_correo_outbox_provider_message_id
 ON pliego.correo_outbox(id_mensaje_proveedor)
 WHERE id_mensaje_proveedor IS NOT NULL;

CREATE FUNCTION pliego.fn_mail_outbox_complete(
 p_id BIGINT,p_owner UUID,p_result VARCHAR,p_error VARCHAR,p_provider_message_id VARCHAR)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 IF p_result NOT IN ('SENT','RETRY','FAILED')
 OR (p_error IS NOT NULL AND p_error !~ '^[A-Z0-9_]{1,80}$')
 OR (p_provider_message_id IS NOT NULL AND
    (p_result<>'SENT' OR p_provider_message_id !~ '^[A-Za-z0-9._:-]{1,128}$')) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
 END IF;
 UPDATE pliego.correo_outbox SET
  estado=CASE WHEN p_result='SENT' THEN 'SENT' WHEN p_result='RETRY' AND intentos<5 THEN 'PENDING' ELSE 'FAILED' END,
  proximo_intento=clock_timestamp()+make_interval(secs=>30*power(2,intentos-1)::INTEGER),
  fecha_actualizacion=clock_timestamp(),fecha_envio=CASE WHEN p_result='SENT' THEN clock_timestamp() END,
  ultimo_error=CASE WHEN p_result='SENT' THEN NULL ELSE p_error END,
  id_mensaje_proveedor=CASE WHEN p_result='SENT' THEN p_provider_message_id ELSE id_mensaje_proveedor END,
  propietario=NULL,lease_hasta=NULL,
  -- Discard nonce once sending is terminal; only hashes remain in action storage.
  datos=CASE WHEN token_hash IS NOT NULL AND (p_result<>'RETRY' OR intentos>=5) THEN datos-'nonce' ELSE datos END
 WHERE correo_id=p_id AND propietario=p_owner AND estado='SENDING';
END; $$;

-- Preserve the established Database API signature for existing maintenance and
-- concurrency gates; only the production sender supplies a provider receipt.
CREATE OR REPLACE FUNCTION pliego.fn_mail_outbox_complete(p_id BIGINT,p_owner UUID,p_result VARCHAR,p_error VARCHAR)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 PERFORM pliego.fn_mail_outbox_complete(p_id,p_owner,p_result,p_error,NULL::VARCHAR);
END; $$;
