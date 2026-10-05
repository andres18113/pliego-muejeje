-- ADR-0018. Spring owns the outer transaction. Results and effects commit together.
CREATE TABLE pliego.checkout_attempt (
    actor_user_id BIGINT NOT NULL REFERENCES pliego.usuario(usuario_id),
    attempt_key UUID NOT NULL,
    state VARCHAR(16) NOT NULL CHECK (state IN ('CREATED','NOT_CREATED')),
    address_id BIGINT,
    cart_id BIGINT,
    payment_method VARCHAR(16),
    simulation_outcome VARCHAR(16),
    order_id BIGINT REFERENCES pliego.pedido(pedido_id),
    order_state VARCHAR(32),
    payment_state VARCHAR(32),
    total NUMERIC(12,2),
    payment_reference VARCHAR,
    PRIMARY KEY(actor_user_id,attempt_key),
    CHECK ((state='NOT_CREATED' AND order_id IS NULL) OR
           (state='CREATED' AND order_id IS NOT NULL AND total IS NOT NULL))
);
CREATE TABLE pliego.address_create_attempt (
    actor_user_id BIGINT NOT NULL REFERENCES pliego.usuario(usuario_id),
    attempt_key UUID NOT NULL,
    state VARCHAR(16) NOT NULL CHECK (state IN ('CREATED','NOT_CREATED')),
    fingerprint TEXT,
    -- Historical receipt survives address deletion, and never recreates it.
    address_id BIGINT,
    PRIMARY KEY(actor_user_id,attempt_key),
    CHECK ((state='NOT_CREATED' AND address_id IS NULL) OR
           (state='CREATED' AND address_id IS NOT NULL AND fingerprint IS NOT NULL))
);
CREATE TRIGGER trg_checkout_attempt_immutable BEFORE UPDATE OR DELETE ON pliego.checkout_attempt
FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();
CREATE TRIGGER trg_address_attempt_immutable BEFORE UPDATE OR DELETE ON pliego.address_create_attempt
FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

CREATE PROCEDURE pliego.sp_checkout_idempotent(
    IN p_actor BIGINT, IN p_key UUID, IN p_address BIGINT, IN p_method VARCHAR,
    IN p_outcome VARCHAR, IN p_cart BIGINT,
    OUT o_order_id BIGINT, OUT o_order_state VARCHAR, OUT o_payment_state VARCHAR,
    OUT o_total NUMERIC, OUT o_payment_reference VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_attempt pliego.checkout_attempt%ROWTYPE; v_customer BIGINT; v_cart BIGINT;
BEGIN
    SELECT a.cliente_id INTO v_customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER') a;
    IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('checkout:'||p_actor||':'||p_key,0));
    SELECT * INTO v_attempt FROM pliego.checkout_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
    IF FOUND THEN
        IF v_attempt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
        IF v_attempt.address_id IS DISTINCT FROM p_address OR v_attempt.payment_method IS DISTINCT FROM p_method
           OR v_attempt.simulation_outcome IS DISTINCT FROM p_outcome OR v_attempt.cart_id IS DISTINCT FROM p_cart THEN
            PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT');
        END IF;
        o_order_id:=v_attempt.order_id; o_order_state:=v_attempt.order_state;
        o_payment_state:=v_attempt.payment_state; o_total:=v_attempt.total;
        o_payment_reference:=v_attempt.payment_reference; RETURN;
    END IF;
    -- An expected cart protects the browser's reviewed intent from a delayed command
    -- accidentally consuming a later active cart. Legacy SQL delegates are unchanged.
    IF p_cart IS NOT NULL THEN
        SELECT carrito_id INTO v_cart FROM pliego.carrito
        WHERE cliente_id=v_customer AND estado='ACTIVE' FOR UPDATE;
        IF v_cart IS DISTINCT FROM p_cart THEN PERFORM pliego.fn_raise_domain_error('P4001','CART_NOT_ACTIVE'); END IF;
    END IF;
    CALL pliego.sp_checkout(p_actor,p_address,p_method,p_outcome,
        o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
    INSERT INTO pliego.checkout_attempt VALUES(p_actor,p_key,'CREATED',p_address,p_cart,p_method,p_outcome,
        o_order_id,o_order_state,o_payment_state,o_total,o_payment_reference);
END; $$;

CREATE FUNCTION pliego.fn_checkout_resolve(p_actor BIGINT,p_key UUID)
RETURNS TABLE(state VARCHAR,order_id BIGINT,order_state VARCHAR,payment_state VARCHAR,total NUMERIC,payment_reference VARCHAR)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
    PERFORM * FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
    IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('checkout:'||p_actor||':'||p_key,0)) THEN
        RETURN QUERY SELECT 'PENDING'::VARCHAR,NULL::BIGINT,NULL::VARCHAR,NULL::VARCHAR,NULL::NUMERIC,NULL::VARCHAR; RETURN;
    END IF;
    INSERT INTO pliego.checkout_attempt(actor_user_id,attempt_key,state) VALUES(p_actor,p_key,'NOT_CREATED')
        ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT a.state,a.order_id,a.order_state,a.payment_state,a.total,a.payment_reference
        FROM pliego.checkout_attempt a WHERE a.actor_user_id=p_actor AND a.attempt_key=p_key;
END; $$;

CREATE PROCEDURE pliego.sp_address_create_idempotent(
    IN p_actor BIGINT,IN p_key UUID,IN p_alias VARCHAR,IN p_recipient VARCHAR,IN p_line1 VARCHAR,
    IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,IN p_country VARCHAR,IN p_postal VARCHAR,
    IN p_reference VARCHAR,IN p_phone VARCHAR,IN p_primary BOOLEAN,OUT o_address_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_attempt pliego.address_create_attempt%ROWTYPE; v_fingerprint TEXT;
BEGIN
    PERFORM * FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
    IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
    v_fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_alias,p_recipient,p_line1,p_line2,
        p_city,p_province,p_country,p_postal,p_reference,p_phone,p_primary)::TEXT,'UTF8')),'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended('address:'||p_actor||':'||p_key,0));
    SELECT * INTO v_attempt FROM pliego.address_create_attempt WHERE actor_user_id=p_actor AND attempt_key=p_key;
    IF FOUND THEN
        IF v_attempt.state='NOT_CREATED' THEN PERFORM pliego.fn_raise_domain_error('P1011','ATTEMPT_NOT_CREATED'); END IF;
        IF v_attempt.fingerprint IS DISTINCT FROM v_fingerprint THEN PERFORM pliego.fn_raise_domain_error('P1010','IDEMPOTENCY_CONFLICT'); END IF;
        o_address_id:=v_attempt.address_id; RETURN;
    END IF;
    CALL pliego.sp_address_create(p_actor,p_alias,p_recipient,p_line1,p_line2,p_city,p_province,p_country,
        p_postal,p_reference,p_phone,p_primary,o_address_id);
    INSERT INTO pliego.address_create_attempt VALUES(p_actor,p_key,'CREATED',v_fingerprint,o_address_id);
END; $$;

CREATE FUNCTION pliego.fn_address_create_resolve(p_actor BIGINT,p_key UUID)
RETURNS TABLE(state VARCHAR,address_id BIGINT)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
    PERFORM * FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
    IF p_key IS NULL THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('address:'||p_actor||':'||p_key,0)) THEN
        RETURN QUERY SELECT 'PENDING'::VARCHAR,NULL::BIGINT; RETURN;
    END IF;
    INSERT INTO pliego.address_create_attempt(actor_user_id,attempt_key,state) VALUES(p_actor,p_key,'NOT_CREATED')
        ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT a.state,a.address_id FROM pliego.address_create_attempt a
        WHERE a.actor_user_id=p_actor AND a.attempt_key=p_key;
END; $$;

ALTER TABLE pliego.cliente ADD COLUMN profile_version BIGINT NOT NULL DEFAULT 0 CHECK(profile_version>=0);
CREATE FUNCTION pliego.fn_customer_profile_version() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    NEW.profile_version:=OLD.profile_version + CASE WHEN
        ROW(NEW.nombres,NEW.apellidos,NEW.telefono) IS DISTINCT FROM ROW(OLD.nombres,OLD.apellidos,OLD.telefono)
        THEN 1 ELSE 0 END;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_customer_profile_version BEFORE UPDATE ON pliego.cliente
FOR EACH ROW EXECUTE FUNCTION pliego.fn_customer_profile_version();

CREATE FUNCTION pliego.fn_customer_profile_versioned(p_actor BIGINT)
RETURNS TABLE(customer_id BIGINT,email VARCHAR,first_names VARCHAR,last_names VARCHAR,phone VARCHAR,state VARCHAR,version BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_customer BIGINT;
BEGIN
    SELECT a.cliente_id INTO v_customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER') a;
    RETURN QUERY SELECT c.cliente_id,u.email_normalizado,c.nombres,c.apellidos,c.telefono,u.estado,c.profile_version
        FROM pliego.cliente c JOIN pliego.usuario u USING(usuario_id) WHERE c.cliente_id=v_customer;
END; $$;

CREATE PROCEDURE pliego.sp_customer_update_versioned(IN p_actor BIGINT,IN p_version BIGINT,
    IN p_first VARCHAR,IN p_last VARCHAR,IN p_phone VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer BIGINT; v_version BIGINT;
BEGIN
    SELECT a.cliente_id INTO v_customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER') a;
    SELECT profile_version INTO v_version FROM pliego.cliente WHERE cliente_id=v_customer FOR UPDATE;
    IF p_version IS NULL OR p_version<0 THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
    IF v_version<>p_version THEN PERFORM pliego.fn_raise_domain_error('P1104','PROFILE_VERSION_CONFLICT'); END IF;
    CALL pliego.sp_customer_update(p_actor,p_first,p_last,p_phone);
END; $$;

CREATE PROCEDURE pliego.sp_customer_patch(IN p_actor BIGINT,IN p_version BIGINT,IN p_field VARCHAR,IN p_value VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer BIGINT; v_profile pliego.cliente%ROWTYPE;
BEGIN
    SELECT a.cliente_id INTO v_customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER') a;
    SELECT * INTO v_profile FROM pliego.cliente WHERE cliente_id=v_customer FOR UPDATE;
    IF p_version IS NULL OR p_version<0 OR p_field IS NULL OR p_field NOT IN ('firstNames','lastNames','phone') THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    IF v_profile.profile_version<>p_version THEN PERFORM pliego.fn_raise_domain_error('P1104','PROFILE_VERSION_CONFLICT'); END IF;
    CALL pliego.sp_customer_update(p_actor,
        CASE WHEN p_field='firstNames' THEN p_value ELSE v_profile.nombres END,
        CASE WHEN p_field='lastNames' THEN p_value ELSE v_profile.apellidos END,
        CASE WHEN p_field='phone' THEN p_value ELSE v_profile.telefono END);
END; $$;
