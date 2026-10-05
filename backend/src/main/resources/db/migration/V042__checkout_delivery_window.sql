-- Home-delivery window stated before purchase: the store's current calendar day through two days later.
-- The store's calendar is Ecuador's (America/Guayaquil), whatever time zone the server or session runs in.
CREATE FUNCTION pliego.fn_delivery_window_at(p_at TIMESTAMPTZ)
RETURNS TABLE(estimated_from DATE,estimated_to DATE)
LANGUAGE sql STABLE STRICT SECURITY INVOKER AS $$
 SELECT (p_at AT TIME ZONE 'America/Guayaquil')::DATE,((p_at AT TIME ZONE 'America/Guayaquil')::DATE+2);
$$;

-- The window applies to what would be shipped: a cart with at least one physical edition. An empty or
-- digital-only cart has no delivery and yields one row of NULLs.
CREATE FUNCTION pliego.fn_cart_delivery_window(p_actor BIGINT)
RETURNS TABLE(estimated_from DATE,estimated_to DATE)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT w.estimated_from,w.estimated_to
 FROM (SELECT EXISTS (
   SELECT 1 FROM pliego.fn_cart_get(p_actor) c
   JOIN pliego.carrito_item ci ON ci.carrito_id=c.cart_id
   JOIN pliego.edicion e USING(edicion_id)
   WHERE pliego.fn_is_physical_format(e.formato)) AS ships) s
 LEFT JOIN LATERAL pliego.fn_delivery_window_at(CURRENT_TIMESTAMP) w ON s.ships;
$$;
