-- Algorithm validity only: no claim of document existence, province or ownership.
CREATE FUNCTION pliego.fn_is_valid_ec_cedula(p_value TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER AS $$
DECLARE value TEXT:=btrim(p_value); total INTEGER:=0; digit INTEGER; i INTEGER;
BEGIN
 IF value IS NULL OR value !~ '^[0-9]{10}$' OR value ~ '^([0-9])\1{9}$' THEN RETURN FALSE; END IF;
 FOR i IN 1..9 LOOP
  digit:=substr(value,i,1)::INTEGER * CASE WHEN i%2=1 THEN 2 ELSE 1 END;
  total:=total + CASE WHEN digit>9 THEN digit-9 ELSE digit END;
 END LOOP;
 RETURN (10-total%10)%10=substr(value,10,1)::INTEGER;
END; $$;

CREATE TABLE pliego.cliente_identificacion (
 cliente_id BIGINT PRIMARY KEY REFERENCES pliego.cliente(cliente_id),
 identidad_tipo VARCHAR(16) NOT NULL CHECK(identidad_tipo='EC_CEDULA'),
 identidad_numero VARCHAR(10) NOT NULL CHECK(identidad_numero=btrim(identidad_numero) AND pliego.fn_is_valid_ec_cedula(identidad_numero))
);
-- Deliberately no global uniqueness: knowledge of a number proves no ownership.
CREATE FUNCTION pliego.fn_customer_billing_identity(p_actor BIGINT)
RETURNS TABLE(identity_type VARCHAR,identity_number VARCHAR)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE customer BIGINT;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 RETURN QUERY SELECT i.identidad_tipo,i.identidad_numero FROM pliego.cliente_identificacion i WHERE i.cliente_id=customer;
END; $$;
CREATE PROCEDURE pliego.sp_customer_billing_identity_set(IN p_actor BIGINT,IN p_type VARCHAR,IN p_number VARCHAR)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE customer BIGINT;
BEGIN
 SELECT cliente_id INTO customer FROM pliego.fn_assert_actor(p_actor,'CUSTOMER');
 PERFORM 1 FROM pliego.cliente WHERE cliente_id=customer FOR UPDATE;
 IF p_type IS NULL AND p_number IS NULL THEN
  DELETE FROM pliego.cliente_identificacion WHERE cliente_id=customer; RETURN;
 END IF;
 IF p_type IS DISTINCT FROM 'EC_CEDULA' OR NOT pliego.fn_is_valid_ec_cedula(p_number) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 INSERT INTO pliego.cliente_identificacion VALUES(customer,p_type,btrim(p_number))
 ON CONFLICT(cliente_id) DO UPDATE SET identidad_tipo=EXCLUDED.identidad_tipo,identidad_numero=EXCLUDED.identidad_numero;
END; $$;
CREATE PROCEDURE pliego.sp_customer_billing_identity_remove(IN p_actor BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN
 CALL pliego.sp_customer_billing_identity_set(p_actor,NULL,NULL);
END; $$;
