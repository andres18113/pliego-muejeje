-- Bound offsets before approved queries evaluate INTEGER page * page_size.
CREATE OR REPLACE FUNCTION pliego.fn_assert_pagination(p_page INTEGER, p_page_size INTEGER)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER AS $$
BEGIN
    IF p_page IS NULL OR p_page < 0 OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 50 THEN
        PERFORM pliego.fn_raise_domain_error('P1001', 'INVALID_ARGUMENT', 'Invalid pagination');
    END IF;
    IF p_page::BIGINT * p_page_size::BIGINT > 2147483647 THEN
        PERFORM pliego.fn_raise_domain_error('P1006', 'PAGINATION_OUT_OF_RANGE', 'Pagination offset exceeds integer range');
    END IF;
END;
$$;
