-- Customer favorites are saved per edition so multiple editions of the same book
-- can be saved independently, matching the catalog and cart identity.
CREATE TABLE pliego.cliente_favorito (
    cliente_id BIGINT NOT NULL,
    edicion_id BIGINT NOT NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_cliente_favorito PRIMARY KEY (cliente_id, edicion_id),
    CONSTRAINT fk_cliente_favorito_cliente FOREIGN KEY (cliente_id)
        REFERENCES pliego.cliente(cliente_id) ON DELETE RESTRICT,
    CONSTRAINT fk_cliente_favorito_edicion FOREIGN KEY (edicion_id)
        REFERENCES pliego.edicion(edicion_id) ON DELETE RESTRICT
);

CREATE INDEX idx_cliente_favorito_reciente
    ON pliego.cliente_favorito(cliente_id, fecha_creacion DESC, edicion_id DESC);

CREATE OR REPLACE PROCEDURE pliego.sp_customer_favorite_add(
    IN p_actor_user_id BIGINT,
    IN p_edition_id BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_customer_id BIGINT;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    IF p_edition_id IS NULL OR p_edition_id <= 0 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT');
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pliego.edicion e
          JOIN pliego.libro l ON l.libro_id = e.libro_id
          JOIN pliego.inventario i ON i.edicion_id = e.edicion_id
         WHERE e.edicion_id = p_edition_id
           AND e.estado = 'ACTIVE'
           AND l.estado = 'ACTIVE'
    ) THEN
        PERFORM pliego.fn_raise_domain_error('P2041', 'EDITION_NOT_FOUND');
    END IF;

    INSERT INTO pliego.cliente_favorito(cliente_id, edicion_id)
    VALUES (v_customer_id, p_edition_id)
    ON CONFLICT (cliente_id, edicion_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE PROCEDURE pliego.sp_customer_favorite_remove(
    IN p_actor_user_id BIGINT,
    IN p_edition_id BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_customer_id BIGINT;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    IF p_edition_id IS NULL OR p_edition_id <= 0 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT');
    END IF;

    DELETE FROM pliego.cliente_favorito
     WHERE cliente_id = v_customer_id
       AND edicion_id = p_edition_id;
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_customer_favorites(
    p_actor_user_id BIGINT,
    p_page INTEGER,
    p_page_size INTEGER
)
RETURNS TABLE (
    edition_id BIGINT,
    book_id BIGINT,
    title VARCHAR,
    authors VARCHAR,
    publisher VARCHAR,
    price NUMERIC(11,2),
    cover_url VARCHAR,
    cover_license VARCHAR,
    cover_attribution VARCHAR,
    format VARCHAR,
    language VARCHAR,
    available BOOLEAN,
    favorited_at TIMESTAMPTZ,
    total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
    v_customer_id BIGINT;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    PERFORM pliego.fn_assert_pagination(p_page, p_page_size);

    RETURN QUERY
    SELECT e.edicion_id,
           l.libro_id,
           l.titulo,
           pliego.fn_build_authors_snapshot(l.libro_id),
           pub.nombre,
           e.precio,
           e.portada_url,
           e.portada_licencia,
           e.portada_atribucion,
           e.formato,
           e.idioma,
           (e.estado = 'ACTIVE' AND l.estado = 'ACTIVE' AND COALESCE(i.stock_actual, 0) > 0),
           f.fecha_creacion,
           count(*) OVER ()::BIGINT
      FROM pliego.cliente_favorito f
      JOIN pliego.edicion e ON e.edicion_id = f.edicion_id
      JOIN pliego.libro l ON l.libro_id = e.libro_id
      JOIN pliego.editorial pub ON pub.editorial_id = e.editorial_id
      LEFT JOIN pliego.inventario i ON i.edicion_id = e.edicion_id
     WHERE f.cliente_id = v_customer_id
     ORDER BY f.fecha_creacion DESC, f.edicion_id DESC
     LIMIT p_page_size
    OFFSET p_page * p_page_size;
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_customer_favorite_status(
    p_actor_user_id BIGINT,
    p_edition_ids BIGINT[]
)
RETURNS TABLE (edition_id BIGINT, favorite BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
    v_customer_id BIGINT;
BEGIN
    SELECT a.cliente_id
      INTO v_customer_id
      FROM pliego.fn_assert_actor(p_actor_user_id, 'CUSTOMER') a;

    IF p_edition_ids IS NULL
       OR cardinality(p_edition_ids) < 1
       OR cardinality(p_edition_ids) > 50
       OR array_position(p_edition_ids, NULL) IS NOT NULL
       OR EXISTS (SELECT 1 FROM unnest(p_edition_ids) AS ids(id) WHERE ids.id <= 0) THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT');
    END IF;

    RETURN QUERY
    SELECT requested.edition_id,
           EXISTS (
               SELECT 1
                 FROM pliego.cliente_favorito f
                WHERE f.cliente_id = v_customer_id
                  AND f.edicion_id = requested.edition_id
           )
      FROM (SELECT DISTINCT id AS edition_id FROM unnest(p_edition_ids) AS input(id)) requested
     ORDER BY requested.edition_id;
END;
$$;
