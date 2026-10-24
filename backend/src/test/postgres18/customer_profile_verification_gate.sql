-- Current-email verification comes from its database timestamp, never ACTIVE.
-- All fixtures and current-email changes roll back.
BEGIN;
DO $gate$
DECLARE v_user BIGINT; v_customer BIGINT; v_state VARCHAR; v_email VARCHAR; v_admin BIGINT;
BEGIN
    CALL pliego.sp_customer_register('v66-profile@example.com', 'fixture-hash-v66', 'Ana', 'Pérez', NULL, v_user, v_customer, v_state);
    IF (SELECT email_verified FROM pliego.fn_customer_profile_verified(v_user)) IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'new current email must be explicitly unverified';
    END IF;
    UPDATE pliego.usuario SET email_verificado_en=CURRENT_TIMESTAMP WHERE usuario_id=v_user;
    IF (SELECT email_verified FROM pliego.fn_customer_profile_verified(v_user)) IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'verified current email must be explicitly verified';
    END IF;
    CALL pliego.sp_customer_change_email(v_user, 'v66-current@example.com', v_email);
    IF NOT EXISTS (SELECT FROM pliego.fn_customer_profile_verified(v_user)
        WHERE email=v_email AND email_verified=FALSE AND state='ACTIVE') THEN
        RAISE EXCEPTION 'changed current email must be unverified even while ACTIVE';
    END IF;
    IF (SELECT email FROM pliego.fn_customer_profile_versioned(v_user)) IS DISTINCT FROM v_email THEN
        RAISE EXCEPTION 'legacy profile read must remain compatible';
    END IF;
    BEGIN
        PERFORM * FROM pliego.fn_customer_profile_verified(0);
        RAISE EXCEPTION 'profile read accepted a missing actor';
    EXCEPTION WHEN SQLSTATE 'P1002' THEN NULL;
    END;
    SELECT usuario_id INTO v_admin FROM pliego.usuario WHERE rol='ADMIN' LIMIT 1;
    BEGIN
        PERFORM * FROM pliego.fn_customer_profile_verified(v_admin);
        RAISE EXCEPTION 'profile read accepted an ADMIN actor';
    EXCEPTION WHEN SQLSTATE 'P1005' THEN NULL;
    END;
END;
$gate$;
ROLLBACK;
