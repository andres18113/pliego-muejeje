-- Keep stored order-level original/savings aggregates immutable: checkout
-- creates all order items before the payment, and historical orders must never
-- receive additional lines once their payment record exists.
CREATE OR REPLACE FUNCTION pliego.fn_capture_order_item_offer_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE pricing RECORD;
BEGIN
 IF EXISTS(SELECT 1 FROM pliego.pago WHERE pedido_id=NEW.pedido_id) THEN
  PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION');
 END IF;
 PERFORM 1 FROM pliego.edicion WHERE edicion_id=NEW.edicion_id FOR SHARE;
 IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P2041','EDITION_NOT_FOUND'); END IF;
 SELECT * INTO pricing FROM pliego.fn_edition_offer(NEW.edicion_id);
 IF pricing.price IS DISTINCT FROM NEW.precio_unitario THEN
  PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION');
 END IF;
 NEW.precio_original_snapshot:=pricing.original_price;
 NEW.ahorro_unitario_snapshot:=pricing.discount_amount;
 NEW.subtotal_original_snapshot:=(pricing.original_price*NEW.cantidad)::NUMERIC(30,2);
 NEW.ahorro_linea_snapshot:=(pricing.discount_amount*NEW.cantidad)::NUMERIC(30,2);
 RETURN NEW;
END;
$$;
