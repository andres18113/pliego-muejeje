-- Historical offer presentation belongs to the immutable paid order items.
-- Existing orders have no trustworthy original prices: leave their new columns
-- NULL and never reconstruct them from a later catalog or offer state.
ALTER TABLE pliego.pedido_item
 ADD COLUMN precio_original_snapshot NUMERIC(11,2),
 ADD COLUMN ahorro_unitario_snapshot NUMERIC(11,2),
 ADD COLUMN subtotal_original_snapshot NUMERIC(30,2),
 ADD COLUMN ahorro_linea_snapshot NUMERIC(30,2),
 ADD CONSTRAINT ck_pedido_item_offer_snapshot CHECK (
  (precio_original_snapshot IS NULL AND ahorro_unitario_snapshot IS NULL
   AND subtotal_original_snapshot IS NULL AND ahorro_linea_snapshot IS NULL)
  OR
  (precio_original_snapshot IS NOT NULL AND ahorro_unitario_snapshot IS NOT NULL
   AND subtotal_original_snapshot IS NOT NULL AND ahorro_linea_snapshot IS NOT NULL
   AND precio_original_snapshot>=precio_unitario AND ahorro_unitario_snapshot>=0
   AND precio_original_snapshot-ahorro_unitario_snapshot=precio_unitario
   AND subtotal_original_snapshot=precio_original_snapshot*cantidad
   AND ahorro_linea_snapshot=ahorro_unitario_snapshot*cantidad
   AND subtotal_original_snapshot-ahorro_linea_snapshot=subtotal)
 );

CREATE FUNCTION pliego.fn_capture_order_item_offer_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE pricing RECORD;
BEGIN
 -- Checkout already holds these edition locks before calculating paid prices.
 -- Retain that serialization when an item is inserted through another DB path.
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
CREATE TRIGGER trg_pedido_item_offer_snapshot BEFORE INSERT ON pliego.pedido_item
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_capture_order_item_offer_snapshot();

-- Existing UPDATE/DELETE guards cover the added item columns automatically.
-- The original/savings order summary is derived solely from those stored items;
-- the existing immutable header remains authoritative for paid merchandise.
CREATE FUNCTION pliego.fn_order_offer_pricing(p_order BIGINT)
RETURNS TABLE(original_subtotal NUMERIC(30,2),savings_total NUMERIC(30,2),
 current_subtotal NUMERIC(30,2),pricing_snapshot_available BOOLEAN)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT CASE WHEN snapshot.complete THEN snapshot.original_subtotal END,
  CASE WHEN snapshot.complete THEN snapshot.savings_total END,
  paid.subtotal,snapshot.complete
 FROM pliego.fn_order_pricing(p_order) paid
 CROSS JOIN LATERAL (
  SELECT (count(*)>0
   AND count(i.precio_original_snapshot)=count(*)
   AND count(i.ahorro_unitario_snapshot)=count(*)
   AND count(i.subtotal_original_snapshot)=count(*)
   AND count(i.ahorro_linea_snapshot)=count(*)
   AND sum(i.subtotal)=paid.subtotal) AS complete,
   sum(i.subtotal_original_snapshot)::NUMERIC(30,2) AS original_subtotal,
   sum(i.ahorro_linea_snapshot)::NUMERIC(30,2) AS savings_total
  FROM pliego.pedido_item i WHERE i.pedido_id=p_order
 ) snapshot;
$$;

-- Internal enrichment helper: call after the approved actor/ownership-checked
-- customer/admin detail routines. Preserve their existing fields and ordering.
-- Admin details historically use pedido_item_id; customer details orderItemId.
CREATE FUNCTION pliego.fn_order_item_offer_snapshots(p_items JSONB)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT COALESCE(jsonb_agg(entry.item || jsonb_build_object(
  'originalPrice',i.precio_original_snapshot,
  'unitSavings',i.ahorro_unitario_snapshot,
  'originalSubtotal',i.subtotal_original_snapshot,
  'lineSavings',i.ahorro_linea_snapshot,
  'pricingSnapshotAvailable',i.precio_original_snapshot IS NOT NULL
   AND i.ahorro_unitario_snapshot IS NOT NULL
   AND i.subtotal_original_snapshot IS NOT NULL
   AND i.ahorro_linea_snapshot IS NOT NULL
 ) ORDER BY entry.position),'[]'::JSONB)
 FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(item,position)
 LEFT JOIN pliego.pedido_item i
 ON i.pedido_item_id=COALESCE(entry.item->>'orderItemId',entry.item->>'pedido_item_id')::BIGINT;
$$;
COMMENT ON FUNCTION pliego.fn_order_offer_pricing(BIGINT) IS
 'Immutable historical original/savings summary from stored order items. Unknown legacy originals and savings are NULL; current_subtotal is always the paid order subtotal.';
COMMENT ON FUNCTION pliego.fn_order_item_offer_snapshots(JSONB) IS
 'Enrich approved ownership-checked order detail JSON using immutable item snapshots only; preserves unknown legacy originals as explicit NULL with pricingSnapshotAvailable=false.';
