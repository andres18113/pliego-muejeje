-- ADR0033: the supported Ecuador book/eBook/audiobook catalog uses zero IVA.
-- Only live quotes and NEW checkout snapshots use this policy. Existing orders,
-- payments, checkout receipts, invoices, credit notes and outbox snapshots stay unchanged.
CREATE OR REPLACE FUNCTION pliego.fn_checkout_tax_rate() RETURNS NUMERIC
LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $$ SELECT 0.00::NUMERIC; $$;
