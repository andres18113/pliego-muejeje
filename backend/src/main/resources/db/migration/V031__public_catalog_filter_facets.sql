-- Additive public discovery metadata. V023 and approved baselines remain unchanged.
CREATE FUNCTION pliego.fn_public_catalog_filter_facets()
RETURNS TABLE(languages JSONB, formats JSONB, minimum_price NUMERIC(11,2), maximum_price NUMERIC(11,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    WITH public_editions AS MATERIALIZED (
        SELECT edition.idioma AS language_code, edition.formato AS edition_format, edition.precio AS price
        FROM pliego.edicion AS edition
        JOIN pliego.libro AS book ON book.libro_id = edition.libro_id
        JOIN pliego.inventario AS inventory ON inventory.edicion_id = edition.edicion_id
        WHERE edition.estado = 'ACTIVE' AND book.estado = 'ACTIVE'
    )
    SELECT coalesce(jsonb_agg(DISTINCT language_code ORDER BY language_code), '[]'::jsonb),
           coalesce(jsonb_agg(DISTINCT edition_format ORDER BY edition_format), '[]'::jsonb),
           min(price), max(price)
    FROM public_editions;
$$;
