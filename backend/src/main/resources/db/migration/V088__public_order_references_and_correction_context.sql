-- ADR-0047. Preserve order IDs and all issued invoice/artifact/history rows.
ALTER TABLE pliego.pedido ADD COLUMN referencia_publica VARCHAR(12);
ALTER TABLE pliego.pedido ADD CONSTRAINT uq_pedido_referencia_publica UNIQUE(referencia_publica);

-- UUID random bytes are OS CSPRNG-backed. Rejection sampling avoids modulo bias.
-- The candidate lock makes collision retries safe between concurrent inserts.
CREATE FUNCTION pliego.fn_generate_order_reference() RETURNS VARCHAR
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE digits TEXT; octet INTEGER; candidate VARCHAR(12);
BEGIN
 LOOP
  digits:='';
  WHILE length(digits)<8 LOOP
   octet:=get_byte(uuid_send(gen_random_uuid()),0);
   IF octet<250 THEN digits:=digits||(octet%10)::TEXT; END IF;
  END LOOP;
  candidate:='PL-'||substr(digits,1,4)||'-'||substr(digits,5,4);
  PERFORM pg_advisory_xact_lock(hashtextextended('order-reference:'||candidate,0));
  IF NOT EXISTS(SELECT FROM pliego.pedido WHERE referencia_publica=candidate) THEN RETURN candidate; END IF;
 END LOOP;
END; $$;

ALTER TABLE pliego.pedido DISABLE TRIGGER trg_pedido_set_updated_at;
UPDATE pliego.pedido SET referencia_publica=pliego.fn_generate_order_reference();
ALTER TABLE pliego.pedido ENABLE TRIGGER trg_pedido_set_updated_at;
ALTER TABLE pliego.pedido ALTER COLUMN referencia_publica SET NOT NULL;
ALTER TABLE pliego.pedido ADD CONSTRAINT ck_pedido_referencia_publica
 CHECK(referencia_publica ~ '^PL-[0-9]{4}-[0-9]{4}$');

CREATE FUNCTION pliego.fn_guard_order_reference() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.referencia_publica:=pliego.fn_generate_order_reference();
 ELSIF NEW.referencia_publica IS DISTINCT FROM OLD.referencia_publica THEN
  PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_pedido_public_reference BEFORE INSERT OR UPDATE OF referencia_publica ON pliego.pedido
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_order_reference();

CREATE FUNCTION pliego.fn_order_reference(p_order BIGINT) RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT referencia_publica FROM pliego.pedido WHERE pedido_id=p_order;
$$;

CREATE FUNCTION pliego.fn_normalize_order_reference(p_reference TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER AS $$
 SELECT regexp_replace(regexp_replace(upper(p_reference),'[[:space:]-]','','g'),'^PL','');
$$;

ALTER FUNCTION pliego.fn_customer_orders(bigint,integer,integer) RENAME TO fn_customer_orders_internal_v088;
CREATE FUNCTION pliego.fn_customer_orders(p_actor_user_id BIGINT,p_page INTEGER,p_page_size INTEGER) RETURNS TABLE(order_id bigint, created_at timestamp with time zone, order_state character varying, total numeric, payment_state character varying, total_count bigint, purchase_state character varying, fulfillment_method character varying, shipment_state character varying, estimated_delivery_from timestamp with time zone, estimated_delivery_to timestamp with time zone, item_count bigint, unit_count bigint, item_summary jsonb, invoice_state character varying, invoice_pdf_available boolean, invoice_xml_available boolean, order_reference VARCHAR)
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 SELECT b.*,p.referencia_publica FROM pliego.fn_customer_orders_internal_v088(p_actor_user_id,p_page,p_page_size) b JOIN pliego.pedido p ON p.pedido_id=b.order_id
 ORDER BY b.created_at DESC,b.order_id DESC;
$$;

ALTER FUNCTION pliego.fn_customer_order_detail(bigint,bigint) RENAME TO fn_customer_order_detail_internal_v088;
CREATE FUNCTION pliego.fn_customer_order_detail(p_actor_user_id BIGINT,p_order_id BIGINT) RETURNS TABLE(order_id bigint, order_state character varying, subtotal numeric, total numeric, created_at timestamp with time zone, updated_at timestamp with time zone, items jsonb, address jsonb, payment jsonb, state_history jsonb, purchase_state character varying, fulfillment jsonb, shipment jsonb, invoice jsonb, credit_notes jsonb, available_actions jsonb, order_reference VARCHAR)
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 SELECT b.*,p.referencia_publica FROM pliego.fn_customer_order_detail_internal_v088(p_actor_user_id,p_order_id) b JOIN pliego.pedido p ON p.pedido_id=b.order_id;
$$;

DROP FUNCTION pliego.fn_customer_order_detail_priced(BIGINT,BIGINT);
CREATE FUNCTION pliego.fn_customer_order_detail_priced(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id bigint, order_state character varying, subtotal numeric, total numeric, created_at timestamp with time zone, updated_at timestamp with time zone, items jsonb, address jsonb, payment jsonb, state_history jsonb, purchase_state character varying, fulfillment jsonb, shipment jsonb, invoice jsonb, credit_notes jsonb, available_actions jsonb, tax_rate numeric, tax_amount numeric, shipping_amount numeric, order_reference VARCHAR)
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 SELECT d.order_id,d.order_state,d.subtotal,d.total,d.created_at,d.updated_at,d.items,d.address,d.payment,d.state_history,d.purchase_state,d.fulfillment,d.shipment,d.invoice,d.credit_notes,d.available_actions,a.tax_rate,a.tax_amount,a.shipping_amount,d.order_reference
 FROM pliego.fn_customer_order_detail(p_actor_user_id,p_order_id) d
 CROSS JOIN LATERAL pliego.fn_order_pricing(d.order_id) a;
$$;

ALTER FUNCTION pliego.fn_admin_order_detail(bigint,bigint) RENAME TO fn_admin_order_detail_internal_v088;
CREATE FUNCTION pliego.fn_admin_order_detail(p_actor_user_id BIGINT,p_order_id BIGINT) RETURNS TABLE(order_id bigint, customer_id bigint, customer_email character varying, customer_name character varying, order_state character varying, subtotal numeric, total numeric, created_at timestamp with time zone, updated_at timestamp with time zone, items jsonb, address jsonb, payment jsonb, state_history jsonb, inventory_movements jsonb, purchase_state character varying, fulfillment jsonb, shipment jsonb, invoice jsonb, credit_notes jsonb, available_actions jsonb, order_reference VARCHAR)
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 SELECT b.*,p.referencia_publica FROM pliego.fn_admin_order_detail_internal_v088(p_actor_user_id,p_order_id) b JOIN pliego.pedido p ON p.pedido_id=b.order_id;
$$;

DROP FUNCTION pliego.fn_admin_order_detail_priced(BIGINT,BIGINT);
CREATE FUNCTION pliego.fn_admin_order_detail_priced(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id bigint, customer_id bigint, customer_email character varying, customer_name character varying, order_state character varying, subtotal numeric, total numeric, created_at timestamp with time zone, updated_at timestamp with time zone, items jsonb, address jsonb, payment jsonb, state_history jsonb, inventory_movements jsonb, purchase_state character varying, fulfillment jsonb, shipment jsonb, invoice jsonb, credit_notes jsonb, available_actions jsonb, tax_rate numeric, tax_amount numeric, shipping_amount numeric, order_reference VARCHAR)
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 SELECT d.order_id,d.customer_id,d.customer_email,d.customer_name,d.order_state,d.subtotal,d.total,d.created_at,d.updated_at,d.items,d.address,d.payment,d.state_history,d.inventory_movements,d.purchase_state,d.fulfillment,d.shipment,d.invoice,d.credit_notes,d.available_actions,a.tax_rate,a.tax_amount,a.shipping_amount,d.order_reference
 FROM pliego.fn_admin_order_detail(p_actor_user_id,p_order_id) d
 CROSS JOIN LATERAL pliego.fn_order_pricing(d.order_id) a;
$$;

ALTER FUNCTION pliego.fn_checkout_resolve(bigint,uuid) RENAME TO fn_checkout_resolve_internal_v088;
CREATE FUNCTION pliego.fn_checkout_resolve(p_actor BIGINT,p_key UUID) RETURNS TABLE(state character varying, order_id bigint, order_state character varying, payment_state character varying, total numeric, payment_reference character varying, order_reference VARCHAR)
LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
 SELECT b.*,p.referencia_publica FROM pliego.fn_checkout_resolve_internal_v088(p_actor,p_key) b LEFT JOIN pliego.pedido p ON p.pedido_id=b.order_id;
$$;

ALTER FUNCTION pliego.fn_order_mail_snapshot(bigint,character varying,character varying,timestamp with time zone,boolean) RENAME TO fn_order_mail_snapshot_internal_v088;
CREATE FUNCTION pliego.fn_order_mail_snapshot(p_order BIGINT,p_method VARCHAR,p_state VARCHAR,p_event_at TIMESTAMPTZ,p_confirmation BOOLEAN) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT pliego.fn_order_mail_snapshot_internal_v088(p_order,p_method,p_state,p_event_at,p_confirmation)||jsonb_build_object('orderReference',p.referencia_publica)
 FROM pliego.pedido p WHERE p.pedido_id=p_order;
$$;

ALTER FUNCTION pliego.fn_invoice_snapshot_data(bigint) RENAME TO fn_invoice_snapshot_data_internal_v088;
CREATE FUNCTION pliego.fn_invoice_snapshot_data(p_invoice_id BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT pliego.fn_invoice_snapshot_data_internal_v088(p_invoice_id)||jsonb_build_object('orderReference',p.referencia_publica)
 FROM pliego.pedido p WHERE p.pedido_id=(SELECT pedido_id FROM pliego.factura WHERE factura_id=p_invoice_id);
$$;

ALTER FUNCTION pliego.fn_admin_billing_identity_correction_requests(bigint,character varying,integer,integer) RENAME TO fn_admin_billing_identity_correction_requests_internal_v088;
CREATE FUNCTION pliego.fn_admin_billing_identity_correction_requests(p_actor BIGINT,p_status VARCHAR,p_page INTEGER,p_page_size INTEGER) RETURNS TABLE(request_id bigint, customer_id bigint, customer_name character varying, customer_email character varying, current_type character varying, current_number character varying, proposed_type character varying, proposed_number character varying, reason_code character varying, note character varying, status character varying, created_at timestamp with time zone, due_at timestamp with time zone, decided_at timestamp with time zone, decided_by bigint, decision_reason text, total_count bigint, customer_has_billed_invoices BOOLEAN, decided_by_email VARCHAR)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT b.*,CASE WHEN b.request_id IS NULL THEN NULL ELSE pliego.fn_customer_has_account_billed_invoice(b.customer_id) END,u.email_normalizado FROM pliego.fn_admin_billing_identity_correction_requests_internal_v088(p_actor,p_status,p_page,p_page_size) b LEFT JOIN pliego.usuario u ON u.usuario_id=b.decided_by;
$$;

-- Keep the seven-argument call compatible using a trailing defaulted search input.
DROP FUNCTION pliego.fn_admin_orders(BIGINT,VARCHAR,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT,INTEGER,INTEGER);
CREATE FUNCTION pliego.fn_admin_orders(
 p_actor_user_id BIGINT,p_state VARCHAR,p_date_from TIMESTAMPTZ,p_date_to TIMESTAMPTZ,
 p_customer_id BIGINT,p_page INTEGER,p_page_size INTEGER,p_q VARCHAR DEFAULT NULL)
RETURNS TABLE(order_id BIGINT,customer_id BIGINT,customer_name VARCHAR,created_at TIMESTAMPTZ,
 order_state VARCHAR,total NUMERIC(30,2),payment_state VARCHAR,total_count BIGINT,order_reference VARCHAR)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
 PERFORM * FROM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
 PERFORM pliego.fn_assert_pagination(p_page,p_page_size);
 IF (p_state IS NOT NULL AND p_state NOT IN('PENDING_PAYMENT','CONFIRMED','PREPARING','SHIPPED','DELIVERED','CANCELLED'))
 OR (p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from>p_date_to) THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT'); END IF;
 RETURN QUERY SELECT p.pedido_id,c.cliente_id,(c.nombres||' '||c.apellidos)::VARCHAR,p.fecha_creacion,
 p.estado,p.total,pa.estado,count(*) OVER()::BIGINT,p.referencia_publica
 FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id)
 JOIN pliego.pago pa ON pa.pedido_id=p.pedido_id
 WHERE (p_state IS NULL OR p.estado=p_state)
 AND (p_date_from IS NULL OR p.fecha_creacion>=p_date_from)
 AND (p_date_to IS NULL OR p.fecha_creacion<=p_date_to)
 AND (p_customer_id IS NULL OR p.cliente_id=p_customer_id)
 AND (NULLIF(btrim(p_q),'') IS NULL
  OR position(pliego.fn_normalize_order_reference(p_q) IN pliego.fn_normalize_order_reference(p.referencia_publica))>0
  OR position(lower(btrim(p_q)) IN lower(c.nombres||' '||c.apellidos))>0
  OR position(lower(btrim(p_q)) IN lower(u.email_normalizado))>0)
 ORDER BY p.fecha_creacion DESC,p.pedido_id DESC LIMIT p_page_size OFFSET p_page::BIGINT*p_page_size;
END; $$;

-- Explicit runtime privileges as well as the runbook's broad routine grant.
DO $$
DECLARE routine REGPROCEDURE;
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  FOREACH routine IN ARRAY ARRAY[
   'pliego.fn_generate_order_reference()'::REGPROCEDURE,
   'pliego.fn_guard_order_reference()'::REGPROCEDURE,
   'pliego.fn_order_reference(bigint)'::REGPROCEDURE,
   'pliego.fn_normalize_order_reference(text)'::REGPROCEDURE,
   'pliego.fn_customer_orders(bigint,integer,integer)'::REGPROCEDURE,
   'pliego.fn_customer_order_detail(bigint,bigint)'::REGPROCEDURE,
   'pliego.fn_customer_order_detail_priced(bigint,bigint)'::REGPROCEDURE,
   'pliego.fn_admin_order_detail(bigint,bigint)'::REGPROCEDURE,
   'pliego.fn_admin_order_detail_priced(bigint,bigint)'::REGPROCEDURE,
   'pliego.fn_admin_orders(bigint,character varying,timestamp with time zone,timestamp with time zone,bigint,integer,integer,character varying)'::REGPROCEDURE,
   'pliego.fn_checkout_resolve(bigint,uuid)'::REGPROCEDURE,
   'pliego.fn_order_mail_snapshot(bigint,character varying,character varying,timestamp with time zone,boolean)'::REGPROCEDURE,
   'pliego.fn_invoice_snapshot_data(bigint)'::REGPROCEDURE,
   'pliego.fn_admin_billing_identity_correction_requests(bigint,character varying,integer,integer)'::REGPROCEDURE
  ] LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO pliego_app',routine); END LOOP;
 END IF;
END; $$;

-- Artifact publication enqueues INVOICE_ISSUED directly rather than through
-- fn_order_mail_snapshot. Enrich only new rows, including that publication path.
CREATE FUNCTION pliego.fn_order_mail_public_reference() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE reference VARCHAR;
BEGIN
 IF NEW.tipo IN('ORDER_CONFIRMED','ORDER_STATUS','ORDER_CANCELLED','INVOICE_ISSUED')
    AND NEW.datos->>'orderId' ~ '^[0-9]{1,19}$' THEN
  reference:=pliego.fn_order_reference((NEW.datos->>'orderId')::BIGINT);
  IF reference IS NOT NULL THEN NEW.datos:=NEW.datos||jsonb_build_object('orderReference',reference); END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_order_mail_public_reference BEFORE INSERT ON pliego.correo_outbox
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_order_mail_public_reference();
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN
  GRANT EXECUTE ON FUNCTION pliego.fn_order_mail_public_reference() TO pliego_app;
 END IF;
END; $$;

-- Preserve the singleton planner estimates established by V079 on replacement APIs.
ALTER FUNCTION pliego.fn_customer_order_detail(BIGINT,BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_customer_order_detail_priced(BIGINT,BIGINT) ROWS 1;
ALTER FUNCTION pliego.fn_checkout_resolve(BIGINT,UUID) ROWS 1;
