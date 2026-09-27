-- PLIEGO V023 — Database-backed public catalog filter options

CREATE OR REPLACE FUNCTION pliego.fn_public_catalog_filter_options()
RETURNS TABLE(language_code VARCHAR, minimum_price NUMERIC(11,2), maximum_price NUMERIC(11,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    WITH public_editions AS MATERIALIZED (
        SELECT edition.idioma AS language_code, edition.precio AS price
        FROM pliego.edicion AS edition
        JOIN pliego.libro AS book ON book.libro_id = edition.libro_id
        JOIN pliego.inventario AS inventory ON inventory.edicion_id = edition.edicion_id
        WHERE edition.estado = 'ACTIVE' AND book.estado = 'ACTIVE'
    ),
    price_bounds AS (
        SELECT min(price) AS minimum_price, max(price) AS maximum_price
        FROM public_editions
    ),
    public_languages AS (
        SELECT DISTINCT language_code
        FROM public_editions
    )
    SELECT public_languages.language_code, price_bounds.minimum_price, price_bounds.maximum_price
    FROM price_bounds
    LEFT JOIN public_languages ON TRUE
    ORDER BY public_languages.language_code NULLS LAST;
$$;
