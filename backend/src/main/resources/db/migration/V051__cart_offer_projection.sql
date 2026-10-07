-- Additive cart presentation projection. Legacy quote, eligibility, taxes and
-- checkout remain authoritative and unchanged; no promotional values are stored.
CREATE FUNCTION pliego.fn_cart_offer_quote(p_actor BIGINT)
RETURNS TABLE(cart_id BIGINT, state VARCHAR, items JSONB,
 total_current NUMERIC(30,2), subtotal NUMERIC(30,2), tax_rate NUMERIC(7,4),
 tax_amount NUMERIC(30,2), shipping_amount NUMERIC(30,2), total NUMERIC(30,2),
 original_subtotal NUMERIC(30,2), savings_total NUMERIC(30,2), current_subtotal NUMERIC(30,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 WITH quote AS MATERIALIZED (SELECT * FROM pliego.fn_cart_quote(p_actor)),
 lines AS MATERIALIZED (
  SELECT entry.item, entry.position, offer.original_price,
   offer.discount_amount AS unit_savings,
   (offer.original_price * (entry.item->>'quantity')::INTEGER)::NUMERIC(30,2) AS original_line_subtotal,
   (offer.discount_amount * (entry.item->>'quantity')::INTEGER)::NUMERIC(30,2) AS line_savings
  FROM quote
  CROSS JOIN LATERAL jsonb_array_elements(quote.items) WITH ORDINALITY AS entry(item,position)
  CROSS JOIN LATERAL pliego.fn_edition_offer((entry.item->>'editionId')::BIGINT) offer
 )
 SELECT quote.cart_id, quote.state,
  COALESCE((SELECT jsonb_agg(item || jsonb_build_object(
   'originalPrice',original_price,'unitSavings',unit_savings,
   'originalSubtotal',original_line_subtotal,'lineSavings',line_savings
  ) ORDER BY position) FROM lines),'[]'::JSONB),
  quote.total_current, quote.subtotal, quote.tax_rate, quote.tax_amount,
  quote.shipping_amount, quote.total,
  COALESCE((SELECT sum(original_line_subtotal) FROM lines),0.00)::NUMERIC(30,2),
  COALESCE((SELECT sum(line_savings) FROM lines),0.00)::NUMERIC(30,2),
  quote.subtotal
 FROM quote;
$$;
COMMENT ON FUNCTION pliego.fn_cart_offer_quote(BIGINT) IS
 'Authoritative live cart base/effective/savings projection. subtotal and current_subtotal remain discounted merchandise; original_subtotal minus savings_total equals current_subtotal. Legacy totals and checkout are unchanged.';
