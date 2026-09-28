-- Domain-error contract standardization (API amendment v1.0.3).
-- PostgreSQL SQLSTATEs are the single canonical identifier for each domain condition.
-- fn_cart_get previously reported cart-item unavailability with symbolic labels
-- ('BOOK_INACTIVE', 'EDITION_INACTIVE', 'INSUFFICIENT_STOCK') while the same conditions
-- surface as P2043, P2042 and P3002 from the cart and checkout commands. The function now
-- reports the canonical SQLSTATE; its signature, ordering and all other fields are unchanged.
CREATE OR REPLACE FUNCTION pliego.fn_cart_get(p_actor_user_id BIGINT)
RETURNS TABLE(cart_id BIGINT,state VARCHAR,items JSONB,total_current NUMERIC(30,2))
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE v_customer_id BIGINT;v_cart_id BIGINT;v_state VARCHAR;
BEGIN
 SELECT a.cliente_id INTO v_customer_id FROM pliego.fn_assert_actor(p_actor_user_id,'CUSTOMER')a;SELECT c.carrito_id,c.estado INTO v_cart_id,v_state FROM pliego.carrito c WHERE c.cliente_id=v_customer_id AND c.estado='ACTIVE';
 IF NOT FOUND THEN RETURN QUERY SELECT NULL::BIGINT,NULL::VARCHAR,'[]'::JSONB,0.00::NUMERIC(30,2);RETURN;END IF;
 RETURN QUERY SELECT v_cart_id,v_state,COALESCE((SELECT jsonb_agg(jsonb_build_object('cartItemId',ci.carrito_item_id,'editionId',e.edicion_id,'title',l.titulo,'authors',pliego.fn_build_authors_snapshot(l.libro_id),'sku',e.sku,'coverUrl',e.portada_url,'quantity',ci.cantidad,'currentPrice',e.precio,'currentSubtotal',(ci.cantidad*e.precio),'available',(l.estado='ACTIVE' AND e.estado='ACTIVE' AND i.stock_actual>=ci.cantidad),'unavailabilityReason',CASE WHEN l.estado<>'ACTIVE' THEN 'P2043' WHEN e.estado<>'ACTIVE' THEN 'P2042' WHEN i.stock_actual<ci.cantidad THEN 'P3002' ELSE NULL END)ORDER BY ci.fecha_creacion,ci.carrito_item_id) FROM pliego.carrito_item ci JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id JOIN pliego.libro l ON l.libro_id=e.libro_id JOIN pliego.inventario i ON i.edicion_id=e.edicion_id WHERE ci.carrito_id=v_cart_id),'[]'::JSONB),COALESCE((SELECT sum(ci.cantidad*e.precio)::NUMERIC(30,2) FROM pliego.carrito_item ci JOIN pliego.edicion e ON e.edicion_id=ci.edicion_id WHERE ci.carrito_id=v_cart_id),0.00::NUMERIC(30,2));
END;$$;
