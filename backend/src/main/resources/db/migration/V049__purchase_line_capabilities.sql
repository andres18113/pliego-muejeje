-- V049 — Purchase line capabilities owned by the Database API.
-- Both live cart quotes and immutable order snapshots carry the canonical format.
-- Preserve their metadata/order and project behavior separately from display labels.
CREATE FUNCTION pliego.fn_purchase_item_capabilities(p_items JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$
 SELECT coalesce(jsonb_agg(item || jsonb_build_object(
   'requiresPhysicalFulfillment', pliego.fn_is_physical_format(item->>'format'),
   -- A malformed digital cart quantity remains editable so it can be repaired to one.
   'quantityEditable', pliego.fn_is_physical_format(item->>'format') OR (item->>'quantity')::INTEGER <> 1
 ) ORDER BY position), '[]'::JSONB)
 FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entries(item, position);
$$;
COMMENT ON FUNCTION pliego.fn_purchase_item_capabilities(JSONB) IS
 'Public Database API: physical fulfillment and quantity-edit capabilities for authorized purchase line projections.';
