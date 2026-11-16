-- ADR-0057 / PPA-08: only access paths justified by supported Database API work.
-- Full ownership identity lookup includes retained identities without ACTIVE grants.
CREATE INDEX ix_digital_ownership_edicion
    ON pliego.digital_ownership (edicion_id);

-- Revoke-all, password reset and email invalidation visit revoked families too;
-- ix_sesion_autenticacion_usuario_activa cannot cover those statements.
CREATE INDEX ix_sesion_autenticacion_usuario
    ON pliego.sesion_autenticacion (usuario_id);
