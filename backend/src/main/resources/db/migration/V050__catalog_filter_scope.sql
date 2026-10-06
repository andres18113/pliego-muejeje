-- Scoped discovery reuses the catalog's existing public eligibility and pricing rules.
-- Legacy filter-options/base-price API and approved migrations remain unchanged.
CREATE FUNCTION pliego.fn_public_category_list(p_scope VARCHAR)
RETURNS TABLE(category_slug VARCHAR, category_name VARCHAR, parent_category_slug VARCHAR)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
    IF p_scope IS NULL OR p_scope NOT IN ('GLOBAL','PHYSICAL','EBOOK','AUDIOBOOK') THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Alcance de catálogo no válido');
    END IF;
    RETURN QUERY
    SELECT category.slug, category.nombre, parent.slug
    FROM pliego.categoria AS category
    LEFT JOIN pliego.categoria AS parent ON parent.categoria_id=category.categoria_padre_id
    WHERE category.estado='ACTIVE'
      AND (category.categoria_padre_id IS NULL OR parent.estado='ACTIVE')
      AND EXISTS (
          SELECT 1
          FROM pliego.libro_categoria AS lc
          JOIN pliego.libro AS book ON book.libro_id=lc.libro_id AND book.estado='ACTIVE'
          JOIN pliego.edicion AS edition ON edition.libro_id=book.libro_id AND edition.estado='ACTIVE'
          LEFT JOIN pliego.inventario AS inventory ON inventory.edicion_id=edition.edicion_id
          WHERE pliego.fn_edition_listable(edition.formato,inventory.stock_actual)
            AND (p_scope='GLOBAL' OR pliego.fn_edition_product_type(edition.formato)=p_scope)
            AND (lc.categoria_id=category.categoria_id
                 OR (category.categoria_padre_id IS NULL AND EXISTS (
                     SELECT 1 FROM pliego.categoria AS child
                     WHERE child.categoria_id=lc.categoria_id
                       AND child.categoria_padre_id=category.categoria_id AND child.estado='ACTIVE')))
      )
    ORDER BY COALESCE(parent.nombre,category.nombre),
             (category.categoria_padre_id IS NOT NULL),category.nombre,category.slug;
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_public_category_list()
RETURNS TABLE(category_slug VARCHAR, category_name VARCHAR, parent_category_slug VARCHAR)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT * FROM pliego.fn_public_category_list('GLOBAL'::VARCHAR);
$$;

CREATE FUNCTION pliego.fn_public_catalog_filter_facets(p_scope VARCHAR)
RETURNS TABLE(languages JSONB, formats JSONB, minimum_price NUMERIC(11,2), maximum_price NUMERIC(11,2))
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
    IF p_scope IS NULL OR p_scope NOT IN ('GLOBAL','PHYSICAL','EBOOK','AUDIOBOOK') THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT','Alcance de catálogo no válido');
    END IF;
    RETURN QUERY
    WITH public_editions AS MATERIALIZED (
        SELECT edition.idioma AS language_code,edition.formato AS edition_format,
               pliego.fn_edition_price(edition.edicion_id) AS price
        FROM pliego.edicion AS edition
        JOIN pliego.libro AS book ON book.libro_id=edition.libro_id
        LEFT JOIN pliego.inventario AS inventory ON inventory.edicion_id=edition.edicion_id
        WHERE edition.estado='ACTIVE' AND book.estado='ACTIVE'
          AND pliego.fn_edition_listable(edition.formato,inventory.stock_actual)
          AND (p_scope='GLOBAL' OR pliego.fn_edition_product_type(edition.formato)=p_scope)
    )
    SELECT coalesce(jsonb_agg(DISTINCT language_code ORDER BY language_code),'[]'::JSONB),
           coalesce(jsonb_agg(DISTINCT edition_format ORDER BY edition_format),'[]'::JSONB),
           min(price),max(price)
    FROM public_editions;
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_public_catalog_filter_facets()
RETURNS TABLE(languages JSONB, formats JSONB, minimum_price NUMERIC(11,2), maximum_price NUMERIC(11,2))
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT * FROM pliego.fn_public_catalog_filter_facets('GLOBAL'::VARCHAR);
$$;
