-- The checkout core approves payment before STORE_PICKUP fulfillment is captured by its wrapper.
-- Start a deadline only once both approval and order type are authoritative.
DROP TRIGGER trg_paid_order_cancel_deadline ON pliego.pago;

CREATE FUNCTION pliego.fn_assign_order_cancel_deadline(p_order BIGINT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 UPDATE pliego.pedido p SET cancelacion_hasta=clock_timestamp()+INTERVAL '6 minutes'
 FROM pliego.pago pa WHERE p.pedido_id=p_order AND pa.pedido_id=p.pedido_id AND pa.estado='APPROVED'
  AND p.estado='CONFIRMED' AND p.cancelacion_hasta IS NULL AND pliego.fn_order_starts_cancel_window(p.pedido_id);
$$;

CREATE FUNCTION pliego.fn_confirmed_order_cancel_deadline() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.estado='CONFIRMED' AND OLD.estado IS DISTINCT FROM NEW.estado THEN
  PERFORM pliego.fn_assign_order_cancel_deadline(NEW.pedido_id);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_confirmed_order_cancel_deadline AFTER UPDATE OF estado ON pliego.pedido
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_confirmed_order_cancel_deadline();

CREATE FUNCTION pliego.fn_pickup_cancel_deadline() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.metodo='STORE_PICKUP' THEN PERFORM pliego.fn_assign_order_cancel_deadline(NEW.pedido_id); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pickup_cancel_deadline AFTER INSERT ON pliego.pedido_entrega
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_pickup_cancel_deadline();
