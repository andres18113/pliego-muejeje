ALTER TABLE pliego.sesion_autenticacion
    ADD COLUMN token_refresco_hash_anterior VARCHAR(64),
    ADD CONSTRAINT uq_sesion_autenticacion_token_anterior UNIQUE (token_refresco_hash_anterior),
    ADD CONSTRAINT ck_sesion_autenticacion_hash_anterior
        CHECK (token_refresco_hash_anterior IS NULL OR token_refresco_hash_anterior ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION pliego.fn_auth_session_refresh(
    p_current_refresh_token_hash VARCHAR, p_replacement_refresh_token_hash VARCHAR)
RETURNS TABLE(user_id BIGINT, email_canonical VARCHAR, role VARCHAR, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
    IF p_current_refresh_token_hash IS NULL OR p_current_refresh_token_hash !~ '^[0-9a-f]{64}$'
       OR p_replacement_refresh_token_hash IS NULL OR p_replacement_refresh_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN;
    END IF;

    RETURN QUERY
    UPDATE pliego.sesion_autenticacion s
       SET token_refresco_hash_anterior = p_current_refresh_token_hash,
           token_refresco_hash = p_replacement_refresh_token_hash,
           fecha_renovacion = transaction_timestamp()
      FROM pliego.usuario u
     WHERE s.token_refresco_hash = p_current_refresh_token_hash
       AND s.usuario_id = u.usuario_id
       AND s.fecha_revocacion IS NULL
       AND s.fecha_expiracion > transaction_timestamp()
       AND u.estado = 'ACTIVE'
       AND u.rol IN ('CUSTOMER', 'ADMIN')
       AND (u.rol <> 'CUSTOMER' OR EXISTS (
            SELECT 1 FROM pliego.cliente c WHERE c.usuario_id = u.usuario_id))
    RETURNING u.usuario_id, u.email_normalizado, u.rol, s.fecha_expiracion;

    IF FOUND THEN
        RETURN;
    END IF;

    -- A retry after an unknown/lost HTTP response receives the same deterministic replacement.
    RETURN QUERY
    SELECT u.usuario_id, u.email_normalizado, u.rol, s.fecha_expiracion
      FROM pliego.sesion_autenticacion s
      JOIN pliego.usuario u ON u.usuario_id = s.usuario_id
     WHERE s.token_refresco_hash_anterior = p_current_refresh_token_hash
       AND s.token_refresco_hash = p_replacement_refresh_token_hash
       AND s.fecha_renovacion >= transaction_timestamp() - INTERVAL '5 minutes'
       AND s.fecha_revocacion IS NULL
       AND s.fecha_expiracion > transaction_timestamp()
       AND u.estado = 'ACTIVE'
       AND u.rol IN ('CUSTOMER', 'ADMIN')
       AND (u.rol <> 'CUSTOMER' OR EXISTS (
            SELECT 1 FROM pliego.cliente c WHERE c.usuario_id = u.usuario_id));
END;
$$;
