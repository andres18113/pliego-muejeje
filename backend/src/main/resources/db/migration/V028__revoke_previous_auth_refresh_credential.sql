CREATE OR REPLACE FUNCTION pliego.fn_auth_session_revoke(p_refresh_token_hash VARCHAR)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
    IF p_refresh_token_hash IS NOT NULL AND p_refresh_token_hash ~ '^[0-9a-f]{64}$' THEN
        UPDATE pliego.sesion_autenticacion
           SET fecha_revocacion = COALESCE(fecha_revocacion, transaction_timestamp())
         WHERE token_refresco_hash = p_refresh_token_hash
            OR token_refresco_hash_anterior = p_refresh_token_hash;
    END IF;
END;
$$;
