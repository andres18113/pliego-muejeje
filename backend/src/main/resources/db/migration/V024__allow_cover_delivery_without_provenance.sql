-- PLIEGO V024 — A delivery URL does not imply that licensing provenance is known.
ALTER TABLE pliego.edicion DROP CONSTRAINT ck_edicion_portada_coherencia;
ALTER TABLE pliego.edicion ADD CONSTRAINT ck_edicion_portada_coherencia CHECK (
    (portada_url IS NULL AND portada_licencia IS NULL
        AND portada_fuente_url IS NULL AND portada_atribucion IS NULL)
    OR
    (portada_url IS NOT NULL AND (
        (portada_licencia IS NULL AND portada_fuente_url IS NULL AND portada_atribucion IS NULL)
        OR
        (portada_licencia IS NOT NULL AND portada_fuente_url IS NOT NULL
            AND (portada_licencia NOT IN ('CC_BY','CC_BY_SA')
                OR (portada_atribucion IS NOT NULL AND char_length(btrim(portada_atribucion)) > 0)))
    ))
);

CREATE OR REPLACE FUNCTION pliego.fn_validate_cover_metadata(
    p_cover_url TEXT,
    p_cover_license TEXT,
    p_cover_source_url TEXT,
    p_cover_attribution TEXT
)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER AS $$
DECLARE
    v_url TEXT := NULLIF(btrim(p_cover_url), '');
    v_license TEXT := NULLIF(btrim(p_cover_license), '');
    v_source TEXT := NULLIF(btrim(p_cover_source_url), '');
    v_attr TEXT := NULLIF(btrim(p_cover_attribution), '');
BEGIN
    IF v_url IS NULL THEN
        IF v_license IS NOT NULL OR v_source IS NOT NULL OR v_attr IS NOT NULL THEN
            PERFORM pliego.fn_raise_domain_error('P2047', 'COVER_METADATA_INVALID');
        END IF;
        RETURN;
    END IF;

    -- The URL identifies where PLIEGO serves an asset; it is not license evidence.
    IF v_license IS NULL AND v_source IS NULL AND v_attr IS NULL THEN
        RETURN;
    END IF;
    IF v_license IS NULL OR v_source IS NULL
            OR v_license NOT IN ('PUBLIC_DOMAIN','CC0','CC_BY','CC_BY_SA','OWNED') THEN
        PERFORM pliego.fn_raise_domain_error('P2047', 'COVER_METADATA_INVALID');
    END IF;
    IF v_license IN ('CC_BY','CC_BY_SA') AND v_attr IS NULL THEN
        PERFORM pliego.fn_raise_domain_error('P2047', 'COVER_METADATA_INVALID');
    END IF;
END;
$$;
