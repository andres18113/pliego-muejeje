-- A payment's order FK holds KEY SHARE until commit. Acquire the conflicting
-- parent lock before the existing snapshot trigger checks for payment existence,
-- so an uncommitted concurrent payment cannot evade the historical append guard.
CREATE FUNCTION pliego.fn_lock_order_offer_snapshot_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 PERFORM 1 FROM pliego.pedido WHERE pedido_id=NEW.pedido_id FOR UPDATE;
 RETURN NEW;
END;
$$;
-- PostgreSQL executes same-event triggers alphabetically: the lock precedes
-- trg_pedido_item_offer_snapshot, which captures prices or rejects paid history.
CREATE TRIGGER trg_pedido_item_00_offer_history_lock BEFORE INSERT ON pliego.pedido_item
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_lock_order_offer_snapshot_capture();
COMMENT ON FUNCTION pliego.fn_lock_order_offer_snapshot_capture() IS
 'Serialize immutable order item capture with payment FK locks before testing whether a payment already exists.';
