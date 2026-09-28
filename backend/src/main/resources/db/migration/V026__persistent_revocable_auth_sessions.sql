-- Persistent refresh credentials are stored only as SHA-256 digests. Raw values exist only in HttpOnly cookies.
CREATE TABLE pliego.sesion_autenticacion (
    sesion_id UUID NOT NULL DEFAULT uuidv4(),
    usuario_id BIGINT NOT NULL,
    token_refresco_hash VARCHAR(64) NOT NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_expiracion TIMESTAMPTZ NOT NULL,
    fecha_renovacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_revocacion TIMESTAMPTZ,
    CONSTRAINT pk_sesion_autenticacion PRIMARY KEY (sesion_id),
    CONSTRAINT uq_sesion_autenticacion_token_hash UNIQUE (token_refresco_hash),
    CONSTRAINT fk_sesion_autenticacion_usuario FOREIGN KEY (usuario_id)
        REFERENCES pliego.usuario(usuario_id) ON DELETE CASCADE,
    CONSTRAINT ck_sesion_autenticacion_hash CHECK (token_refresco_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_sesion_autenticacion_expiracion CHECK (fecha_expiracion > fecha_creacion),
    CONSTRAINT ck_sesion_autenticacion_renovacion CHECK (fecha_renovacion >= fecha_creacion)
);

CREATE INDEX ix_sesion_autenticacion_usuario_activa
    ON pliego.sesion_autenticacion(usuario_id, fecha_expiracion)
    WHERE fecha_revocacion IS NULL;

CREATE OR REPLACE FUNCTION pliego.fn_auth_session_create(
    p_user_id BIGINT, p_refresh_token_hash VARCHAR, p_expires_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
    IF p_refresh_token_hash IS NULL OR p_refresh_token_hash !~ '^[0-9a-f]{64}$'
       OR p_expires_at IS NULL OR p_expires_at <= transaction_timestamp()
       OR p_expires_at > transaction_timestamp() + INTERVAL '30 days 1 minute' THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT');
    END IF;

    PERFORM 1 FROM pliego.fn_assert_actor(p_user_id);

    DELETE FROM pliego.sesion_autenticacion
    WHERE fecha_expiracion < transaction_timestamp() - INTERVAL '30 days'
       OR fecha_revocacion < transaction_timestamp() - INTERVAL '30 days';

    INSERT INTO pliego.sesion_autenticacion(usuario_id, token_refresco_hash, fecha_expiracion)
    VALUES (p_user_id, p_refresh_token_hash, p_expires_at);
END;
$$;

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
       SET token_refresco_hash = p_replacement_refresh_token_hash,
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
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_auth_session_revoke(p_refresh_token_hash VARCHAR)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
    IF p_refresh_token_hash IS NOT NULL AND p_refresh_token_hash ~ '^[0-9a-f]{64}$' THEN
        UPDATE pliego.sesion_autenticacion
           SET fecha_revocacion = COALESCE(fecha_revocacion, transaction_timestamp())
         WHERE token_refresco_hash = p_refresh_token_hash;
    END IF;
END;
$$;
