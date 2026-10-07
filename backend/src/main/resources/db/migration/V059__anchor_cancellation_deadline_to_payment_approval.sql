-- Keep the cancellation cutoff exactly six minutes from the database payment approval event.
ALTER TABLE pliego.pago ADD COLUMN fecha_aprobacion TIMESTAMPTZ;

CREATE FUNCTION pliego.fn_capture_payment_approval_time() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.estado='APPROVED' AND (TG_OP='INSERT' OR OLD.estado IS DISTINCT FROM NEW.estado)
    AND NEW.fecha_aprobacion IS NULL THEN
  NEW.fecha_aprobacion:=clock_timestamp();
 ELSIF TG_OP='UPDATE' AND OLD.fecha_aprobacion IS NOT NULL THEN
  NEW.fecha_aprobacion:=OLD.fecha_aprobacion;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pago_capture_approval_time BEFORE INSERT OR UPDATE OF estado ON pliego.pago
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_capture_payment_approval_time();

CREATE OR REPLACE FUNCTION pliego.fn_assign_order_cancel_deadline(p_order BIGINT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 UPDATE pliego.pedido p SET cancelacion_hasta=pa.fecha_aprobacion+INTERVAL '6 minutes'
 FROM pliego.pago pa WHERE p.pedido_id=p_order AND pa.pedido_id=p.pedido_id AND pa.estado='APPROVED'
  AND pa.fecha_aprobacion IS NOT NULL AND p.estado='CONFIRMED' AND p.cancelacion_hasta IS NULL
  AND pliego.fn_order_starts_cancel_window(p.pedido_id);
$$;
