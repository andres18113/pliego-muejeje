-- Additive read contract. Legacy profile routines and signatures remain intact.
-- The existing profile routine authorizes the CUSTOMER actor; verification belongs
-- to the current email timestamp, which the email-change trigger already clears.
CREATE FUNCTION pliego.fn_customer_profile_verified(p_actor BIGINT)
RETURNS TABLE(customer_id BIGINT,email VARCHAR,first_names VARCHAR,last_names VARCHAR,
              phone VARCHAR,state VARCHAR,version BIGINT,email_verified BOOLEAN)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT p.customer_id,p.email,p.first_names,p.last_names,p.phone,p.state,p.version,
           u.email_verificado_en IS NOT NULL
    FROM pliego.fn_customer_profile_versioned(p_actor) p
    JOIN pliego.usuario u ON u.usuario_id=p_actor AND u.email_normalizado=p.email;
$$;
