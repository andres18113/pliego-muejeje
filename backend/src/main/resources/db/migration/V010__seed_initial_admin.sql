-- Required Flyway placeholders from environment/configuration:
-- ${PLIEGO_ADMIN_EMAIL}
-- ${PLIEGO_ADMIN_PASSWORD_HASH}
INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
VALUES(lower(btrim('${PLIEGO_ADMIN_EMAIL}')),'${PLIEGO_ADMIN_PASSWORD_HASH}','ADMIN','ACTIVE')
ON CONFLICT(email_normalizado) DO NOTHING;
