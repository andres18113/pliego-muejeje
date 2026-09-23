-- Preserve the approved routine contract while clearing the previous primary before setting the new one.
CREATE OR REPLACE PROCEDURE pliego.sp_address_set_primary(IN p_actor_user_id BIGINT,IN p_address_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER') a;
 PERFORM 1 FROM pliego.cliente c WHERE c.cliente_id=v_customer_id FOR UPDATE;
 PERFORM 1 FROM pliego.direccion d WHERE d.direccion_id=p_address_id AND d.cliente_id=v_customer_id;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P1103','ADDRESS_NOT_FOUND'); END IF;
 UPDATE pliego.direccion SET es_principal=FALSE
  WHERE cliente_id=v_customer_id AND es_principal AND direccion_id<>p_address_id;
 UPDATE pliego.direccion SET es_principal=TRUE
  WHERE direccion_id=p_address_id AND cliente_id=v_customer_id AND NOT es_principal;
END;$$;
