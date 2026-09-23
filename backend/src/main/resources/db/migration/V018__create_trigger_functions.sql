-- PLIEGO V018 — Technical trigger functions only.

CREATE OR REPLACE FUNCTION pliego.fn_set_fecha_actualizacion()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
BEGIN
    NEW.fecha_actualizacion := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_prevent_update_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
BEGIN
    RAISE EXCEPTION
        USING ERRCODE = 'P9001',
              MESSAGE = 'IMMUTABLE_HISTORY_VIOLATION';
END;
$$;

CREATE OR REPLACE FUNCTION pliego.fn_validate_category_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
DECLARE
    v_parent_parent BIGINT;
BEGIN
    IF NEW.categoria_padre_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.categoria_padre_id = NEW.categoria_id THEN
        PERFORM pliego.fn_raise_domain_error('P2023', 'CATEGORY_INVALID_HIERARCHY');
    END IF;

    SELECT c.categoria_padre_id
      INTO v_parent_parent
      FROM pliego.categoria c
     WHERE c.categoria_id = NEW.categoria_padre_id;

    IF NOT FOUND THEN
        PERFORM pliego.fn_raise_domain_error('P2021', 'CATEGORY_NOT_FOUND');
    END IF;

    IF v_parent_parent IS NOT NULL THEN
        PERFORM pliego.fn_raise_domain_error('P2023', 'CATEGORY_INVALID_HIERARCHY');
    END IF;

    -- A root that already has children cannot become a subcategory.
    IF NEW.categoria_id IS NOT NULL
       AND EXISTS (
           SELECT 1
             FROM pliego.categoria ch
            WHERE ch.categoria_padre_id = NEW.categoria_id
       ) THEN
        PERFORM pliego.fn_raise_domain_error('P2023', 'CATEGORY_INVALID_HIERARCHY');
    END IF;

    RETURN NEW;
END;
$$;
