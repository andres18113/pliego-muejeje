-- ADR-0047: additive handover detail. Keep V089 list/lookup/collect contracts intact.
-- fn_order_post_purchase is the existing V043/V055/V072 cancellation projection:
-- approved CONFIRMED/PREPARING, shipment guard, six-minute payment cutoff, or
-- simulated DRAFT invoice + PENDING payment. Never infer eligibility in Java.
CREATE FUNCTION pliego.fn_admin_pickup_handover_view(p_actor BIGINT,p_order BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE result JSONB;
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 SELECT pliego.fn_admin_pickup_view(p_actor,p_order)||jsonb_build_object(
  'paymentMethod',pa.metodo,'availableActions',jsonb_build_object(
   'cancel',COALESCE((post.available_actions->>'cancel')::BOOLEAN,FALSE),
   'cancellationDeadline',post.available_actions->'cancellationDeadline'))
 INTO result FROM pliego.pago pa
 CROSS JOIN LATERAL pliego.fn_order_post_purchase(pa.pedido_id) post
 WHERE pa.pedido_id=p_order;
 IF result IS NULL THEN PERFORM pliego.fn_raise_domain_error('P5016','PICKUP_NOT_FOUND'); END IF;
 RETURN result;
END; $$;

CREATE FUNCTION pliego.fn_admin_pickup_handover_detail(p_actor BIGINT,p_order BIGINT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 -- Reuse existence checks and read-through lifecycle reconciliation from V089.
 PERFORM pliego.fn_admin_pickup_detail(p_actor,p_order);
 RETURN pliego.fn_admin_pickup_handover_view(p_actor,p_order);
END; $$;

CREATE FUNCTION pliego.fn_admin_pickup_verify_code(p_actor BIGINT,p_order BIGINT,p_code VARCHAR) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE stored_code TEXT; code TEXT:=pliego.fn_normalize_pickup_code(p_code);
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 SELECT r.codigo INTO stored_code FROM pliego.pedido_retiro r
 JOIN pliego.pedido_entrega f USING(pedido_id)
 WHERE r.pedido_id=p_order AND f.metodo='STORE_PICKUP';
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5016','PICKUP_NOT_FOUND'); END IF;
 -- Compare only this order, without looking up any other customer's credential.
 IF code IS NULL OR code NOT IN(pliego.fn_normalize_pickup_code(stored_code),substr(stored_code,3)) THEN
  PERFORM pliego.fn_raise_domain_error('P5013','PICKUP_CODE_INVALID');
 END IF;
 -- STABLE all the way through: verification never reconciles, locks, or writes rows.
 RETURN pliego.fn_admin_pickup_handover_view(p_actor,p_order);
END; $$;

-- The shared customer/admin command retains ownership semantics. Give the admin
-- HTTP boundary its own routine with the same business command and an ADMIN assertion.
CREATE PROCEDURE pliego.sp_admin_order_cancel(IN p_actor BIGINT,IN p_order BIGINT,
 OUT o_order_id BIGINT,OUT o_previous_state VARCHAR,OUT o_order_state VARCHAR,
 OUT o_payment_state VARCHAR,OUT o_restored_units BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor,'ADMIN');
 CALL pliego.sp_order_cancel(p_actor,p_order,o_order_id,o_previous_state,o_order_state,o_payment_state,o_restored_units);
END; $$;

REVOKE ALL ON FUNCTION pliego.fn_admin_pickup_handover_view(BIGINT,BIGINT),
 pliego.fn_admin_pickup_handover_detail(BIGINT,BIGINT),
 pliego.fn_admin_pickup_verify_code(BIGINT,BIGINT,VARCHAR) FROM PUBLIC;
REVOKE ALL ON PROCEDURE pliego.sp_admin_order_cancel(BIGINT,BIGINT) FROM PUBLIC;
DO $grants$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT EXECUTE ON FUNCTION pliego.fn_admin_pickup_handover_view(BIGINT,BIGINT),
   pliego.fn_admin_pickup_handover_detail(BIGINT,BIGINT),
   pliego.fn_admin_pickup_verify_code(BIGINT,BIGINT,VARCHAR) TO pliego_app;
  GRANT EXECUTE ON PROCEDURE pliego.sp_admin_order_cancel(BIGINT,BIGINT) TO pliego_app;
 END IF;
END $grants$;
