-- Run after Flyway through V035 on PostgreSQL 18. All fixtures roll back.
-- sp_customer_change_email reuses registration's normalization, validation and uniqueness, and
-- fn_customer_password_hash serves only the CUSTOMER actor's own hash.
BEGIN;
DO $gate$
DECLARE
    v_user BIGINT; v_customer BIGINT; v_state VARCHAR;
    v_other BIGINT; v_other_customer BIGINT;
    v_admin BIGINT;
    v_email VARCHAR; v_hash VARCHAR; v_raised TEXT;
BEGIN
    CALL pliego.sp_customer_register('V35-Lectora@Example.com', 'fixture-hash-v35', 'Ana', 'Pérez', NULL, v_user, v_customer, v_state);
    CALL pliego.sp_customer_register('v35-otra@example.com', 'fixture-hash-other', 'Luis', 'Mora', NULL, v_other, v_other_customer, v_state);
    INSERT INTO pliego.usuario(email_normalizado, password_hash, rol, estado)
    VALUES ('v35-admin@pliego.local', 'fixture-admin-hash', 'ADMIN', 'ACTIVE') RETURNING usuario_id INTO v_admin;

    v_hash := pliego.fn_customer_password_hash(v_user);
    IF v_hash IS DISTINCT FROM 'fixture-hash-v35' THEN RAISE EXCEPTION 'fn_customer_password_hash returned another hash'; END IF;

    BEGIN
        v_hash := pliego.fn_customer_password_hash(v_admin);
        RAISE EXCEPTION 'fn_customer_password_hash served a non-CUSTOMER actor';
    EXCEPTION WHEN OTHERS THEN
        v_raised := SQLSTATE;
        IF v_raised NOT LIKE 'P1%' THEN RAISE EXCEPTION 'non-CUSTOMER actor raised % instead of an actor error', v_raised; END IF;
    END;

    -- Normalized like registration, stored and returned.
    CALL pliego.sp_customer_change_email(v_user, '  V35-Nueva@Example.COM ', v_email);
    IF v_email <> pliego.fn_normalize_email('V35-Nueva@Example.COM') THEN RAISE EXCEPTION 'unexpected stored email %', v_email; END IF;
    IF NOT EXISTS (SELECT 1 FROM pliego.fn_user_auth_data('v35-nueva@example.com') WHERE user_id = v_user) THEN
        RAISE EXCEPTION 'the new email does not sign in';
    END IF;
    IF EXISTS (SELECT 1 FROM pliego.fn_user_auth_data('V35-Lectora@Example.com')) THEN
        RAISE EXCEPTION 'the previous email still signs in';
    END IF;
    IF (SELECT email FROM pliego.fn_customer_profile(v_user)) <> v_email THEN RAISE EXCEPTION 'profile does not show the new email'; END IF;

    -- Unchanged email is an idempotent no-op.
    CALL pliego.sp_customer_change_email(v_user, 'v35-nueva@example.com', v_email);

    -- Another account's email is rejected with the registration code.
    BEGIN
        CALL pliego.sp_customer_change_email(v_user, 'V35-Otra@Example.com', v_email);
        RAISE EXCEPTION 'a taken email was accepted';
    EXCEPTION WHEN OTHERS THEN
        v_raised := SQLSTATE;
        IF v_raised <> 'P1101' THEN RAISE EXCEPTION 'taken email raised % instead of P1101', v_raised; END IF;
    END;

    -- Malformed input is rejected with P1001 and changes nothing.
    BEGIN
        CALL pliego.sp_customer_change_email(v_user, 'sin-arroba', v_email);
        RAISE EXCEPTION 'a malformed email was accepted';
    EXCEPTION WHEN OTHERS THEN
        v_raised := SQLSTATE;
        IF v_raised <> 'P1001' THEN RAISE EXCEPTION 'malformed email raised % instead of P1001', v_raised; END IF;
    END;
    IF (SELECT email FROM pliego.fn_customer_profile(v_user)) <> 'v35-nueva@example.com' THEN RAISE EXCEPTION 'a rejected change altered the email'; END IF;

    -- Only CUSTOMER actors may change their email through this routine.
    BEGIN
        CALL pliego.sp_customer_change_email(v_admin, 'v35-admin-nuevo@example.com', v_email);
        RAISE EXCEPTION 'an ADMIN changed its email through the CUSTOMER routine';
    EXCEPTION WHEN OTHERS THEN
        v_raised := SQLSTATE;
        IF v_raised NOT LIKE 'P1%' THEN RAISE EXCEPTION 'ADMIN actor raised % instead of an actor error', v_raised; END IF;
    END;
END;
$gate$;
ROLLBACK;
