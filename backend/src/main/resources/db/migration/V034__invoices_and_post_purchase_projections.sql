-- Commercial document infrastructure, not an Ecuador fiscal/SRI implementation.
CREATE TABLE pliego.factura (
    factura_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id BIGINT NOT NULL UNIQUE REFERENCES pliego.pedido(pedido_id),
    numero_documento VARCHAR(80) NOT NULL UNIQUE CHECK (char_length(btrim(numero_documento)) BETWEEN 1 AND 80),
    estado VARCHAR(16) NOT NULL CHECK (estado IN ('DRAFT','ISSUED')),
    comprador_nombre VARCHAR(240) NOT NULL CHECK (char_length(btrim(comprador_nombre)) BETWEEN 1 AND 240),
    identidad_tipo VARCHAR(16) NOT NULL CHECK (identidad_tipo IN ('NATIONAL_ID','TAX_ID','PASSPORT','OTHER')),
    identidad_numero VARCHAR(80) NOT NULL CHECK (char_length(btrim(identidad_numero)) BETWEEN 1 AND 80),
    comprador_email VARCHAR(254),
    moneda CHAR(3) NOT NULL DEFAULT 'USD' CHECK (moneda='USD'),
    subtotal NUMERIC(30,2) NOT NULL CHECK (subtotal>0),
    impuesto_total NUMERIC(30,2) NOT NULL CHECK (impuesto_total>=0),
    total NUMERIC(30,2) NOT NULL CHECK (total=subtotal+impuesto_total),
    usuario_emisor_id BIGINT NOT NULL REFERENCES pliego.usuario(usuario_id),
    fecha_emision TIMESTAMPTZ,
    CHECK ((estado='DRAFT' AND fecha_emision IS NULL) OR (estado='ISSUED' AND fecha_emision IS NOT NULL))
);
CREATE TABLE pliego.factura_direccion (
    factura_id BIGINT PRIMARY KEY REFERENCES pliego.factura(factura_id),
    direccion_linea1 VARCHAR(200) NOT NULL CHECK (char_length(btrim(direccion_linea1)) BETWEEN 1 AND 200),
    direccion_linea2 VARCHAR(200),
    ciudad VARCHAR(100) NOT NULL CHECK (char_length(btrim(ciudad)) BETWEEN 1 AND 100),
    provincia VARCHAR(100) NOT NULL CHECK (char_length(btrim(provincia)) BETWEEN 1 AND 100),
    pais_codigo CHAR(2) NOT NULL CHECK (pais_codigo ~ '^[A-Z]{2}$' AND pliego.fn_is_valid_country_code(pais_codigo)),
    codigo_postal VARCHAR(20)
);
CREATE TABLE pliego.factura_item (
    factura_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    factura_id BIGINT NOT NULL REFERENCES pliego.factura(factura_id),
    pedido_item_id BIGINT NOT NULL REFERENCES pliego.pedido_item(pedido_item_id),
    descripcion VARCHAR(300) NOT NULL,
    cantidad INTEGER NOT NULL CHECK (cantidad>0),
    precio_unitario NUMERIC(11,2) NOT NULL CHECK (precio_unitario>0),
    subtotal NUMERIC(30,2) NOT NULL CHECK (subtotal=precio_unitario*cantidad),
    tratamiento_impuesto VARCHAR(16) NOT NULL CHECK (tratamiento_impuesto IN ('NOT_ASSESSED','ASSESSED')),
    impuesto_tasa NUMERIC(7,4),
    impuesto_monto NUMERIC(30,2) NOT NULL CHECK (impuesto_monto>=0),
    total NUMERIC(30,2) NOT NULL CHECK (total=subtotal+impuesto_monto),
    UNIQUE(factura_id,pedido_item_id),
    CHECK ((tratamiento_impuesto='NOT_ASSESSED' AND impuesto_tasa IS NULL AND impuesto_monto=0)
        OR (tratamiento_impuesto='ASSESSED' AND impuesto_tasa IS NOT NULL AND impuesto_tasa BETWEEN 0 AND 100
            AND impuesto_monto=round(subtotal*impuesto_tasa/100,2)))
);
-- Future adapters append processing records/artifacts without changing issuance snapshots.
CREATE TABLE pliego.factura_emision_electronica (
    factura_id BIGINT PRIMARY KEY REFERENCES pliego.factura(factura_id),
    proveedor VARCHAR(80) NOT NULL CHECK (char_length(btrim(proveedor))>0),
    estado VARCHAR(16) NOT NULL CHECK (estado IN ('SUBMITTED','AUTHORIZED','REJECTED')),
    referencia_externa VARCHAR(200),
    fecha_presentacion TIMESTAMPTZ NOT NULL,
    fecha_autorizacion TIMESTAMPTZ,
    CHECK ((estado='AUTHORIZED' AND fecha_autorizacion IS NOT NULL) OR
        (estado<>'AUTHORIZED' AND fecha_autorizacion IS NULL)),
    CHECK (fecha_autorizacion IS NULL OR fecha_autorizacion>=fecha_presentacion)
);
CREATE TABLE pliego.factura_archivo (
    factura_id BIGINT NOT NULL REFERENCES pliego.factura(factura_id),
    tipo VARCHAR(3) NOT NULL CHECK (tipo IN ('PDF','XML')),
    almacenamiento_clave VARCHAR(1000) NOT NULL CHECK (char_length(btrim(almacenamiento_clave))>0),
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(factura_id,tipo)
);
CREATE TABLE pliego.nota_credito (
    nota_credito_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    factura_id BIGINT NOT NULL UNIQUE REFERENCES pliego.factura(factura_id),
    numero_documento VARCHAR(80) NOT NULL UNIQUE CHECK (char_length(btrim(numero_documento)) BETWEEN 1 AND 80),
    estado VARCHAR(16) NOT NULL DEFAULT 'ISSUED' CHECK (estado='ISSUED'),
    motivo VARCHAR(500) NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 1 AND 500),
    subtotal NUMERIC(30,2) NOT NULL CHECK (subtotal>0),
    impuesto_total NUMERIC(30,2) NOT NULL CHECK (impuesto_total>=0),
    total NUMERIC(30,2) NOT NULL CHECK (total=subtotal+impuesto_total),
    usuario_emisor_id BIGINT NOT NULL REFERENCES pliego.usuario(usuario_id),
    fecha_emision TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- A full credit references every immutable invoice line and billing snapshot through factura_id.
-- Partial quantities/returns and their fiscal correction policy are deliberately deferred.
CREATE TRIGGER trg_nota_credito_immutable BEFORE UPDATE OR DELETE ON pliego.nota_credito
FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();
CREATE TRIGGER trg_factura_archivo_immutable BEFORE UPDATE OR DELETE ON pliego.factura_archivo
FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

CREATE FUNCTION pliego.fn_guard_invoice_immutable() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    IF OLD.estado='ISSUED' THEN
        PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION');
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_factura_immutable BEFORE UPDATE OR DELETE ON pliego.factura
FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_invoice_immutable();
CREATE FUNCTION pliego.fn_guard_invoice_child_immutable() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_state VARCHAR;
BEGIN
    IF TG_OP<>'INSERT' THEN PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION'); END IF;
    SELECT estado INTO v_state FROM pliego.factura WHERE factura_id=NEW.factura_id FOR SHARE;
    IF v_state='ISSUED' THEN PERFORM pliego.fn_raise_domain_error('P9001','IMMUTABLE_HISTORY_VIOLATION'); END IF;
    RETURN NEW;
END; $$;
CREATE TRIGGER trg_factura_item_immutable BEFORE INSERT OR UPDATE OR DELETE ON pliego.factura_item
FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_invoice_child_immutable();
CREATE TRIGGER trg_factura_direccion_immutable BEFORE INSERT OR UPDATE OR DELETE ON pliego.factura_direccion
FOR EACH ROW EXECUTE FUNCTION pliego.fn_guard_invoice_child_immutable();

CREATE PROCEDURE pliego.sp_invoice_issue(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
    IN p_document_number VARCHAR,IN p_buyer_name VARCHAR,IN p_identity_type VARCHAR,IN p_identity_number VARCHAR,
    IN p_buyer_email VARCHAR,IN p_line1 VARCHAR,IN p_line2 VARCHAR,IN p_city VARCHAR,IN p_province VARCHAR,
    IN p_country_code VARCHAR,IN p_postal_code VARCHAR,OUT o_invoice_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_order pliego.pedido%ROWTYPE; v_country VARCHAR;
BEGIN
    PERFORM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
    SELECT * INTO v_order FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
    IF EXISTS (SELECT 1 FROM pliego.factura WHERE pedido_id=p_order_id) THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    IF v_order.estado IN ('PENDING_PAYMENT','CANCELLED') OR NOT EXISTS (
        SELECT 1 FROM pliego.pago WHERE pedido_id=p_order_id AND estado='APPROVED') THEN
        PERFORM pliego.fn_raise_domain_error('P5006','PAYMENT_STATE_INVALID');
    END IF;
    v_country:=pliego.fn_normalize_country_code(p_country_code);
    IF p_document_number IS NULL OR char_length(btrim(p_document_number)) NOT BETWEEN 1 AND 80
        OR p_buyer_name IS NULL OR char_length(btrim(p_buyer_name)) NOT BETWEEN 1 AND 240
        OR p_identity_type IS NULL OR p_identity_type NOT IN ('NATIONAL_ID','TAX_ID','PASSPORT','OTHER')
        OR p_identity_number IS NULL OR char_length(btrim(p_identity_number)) NOT BETWEEN 1 AND 80
        OR (p_buyer_email IS NOT NULL AND (char_length(p_buyer_email)>254 OR p_buyer_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
        OR p_line1 IS NULL OR char_length(btrim(p_line1)) NOT BETWEEN 1 AND 200 OR char_length(p_line2)>200
        OR p_city IS NULL OR char_length(btrim(p_city)) NOT BETWEEN 1 AND 100
        OR p_province IS NULL OR char_length(btrim(p_province)) NOT BETWEEN 1 AND 100
        OR v_country IS NULL OR NOT pliego.fn_is_valid_country_code(v_country) OR char_length(p_postal_code)>20 THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pliego.pedido_item WHERE pedido_id=p_order_id)
        OR (SELECT sum(subtotal) FROM pliego.pedido_item WHERE pedido_id=p_order_id)<>v_order.subtotal THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    BEGIN
        INSERT INTO pliego.factura(pedido_id,numero_documento,estado,comprador_nombre,identidad_tipo,identidad_numero,
            comprador_email,subtotal,impuesto_total,total,usuario_emisor_id)
        VALUES(p_order_id,btrim(p_document_number),'DRAFT',btrim(p_buyer_name),p_identity_type,btrim(p_identity_number),
            p_buyer_email,v_order.subtotal,0,v_order.total,p_actor_user_id) RETURNING factura_id INTO o_invoice_id;
    EXCEPTION WHEN unique_violation THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END;
    INSERT INTO pliego.factura_direccion VALUES(o_invoice_id,btrim(p_line1),NULLIF(btrim(p_line2),''),
        btrim(p_city),btrim(p_province),v_country,NULLIF(btrim(p_postal_code),''));
    INSERT INTO pliego.factura_item(factura_id,pedido_item_id,descripcion,cantidad,precio_unitario,subtotal,
        tratamiento_impuesto,impuesto_tasa,impuesto_monto,total)
    SELECT o_invoice_id,pedido_item_id,titulo_snapshot,cantidad,precio_unitario,subtotal,'NOT_ASSESSED',NULL,0,subtotal
    FROM pliego.pedido_item WHERE pedido_id=p_order_id ORDER BY pedido_item_id;
    UPDATE pliego.factura SET estado='ISSUED',fecha_emision=CURRENT_TIMESTAMP WHERE factura_id=o_invoice_id;
END; $$;

CREATE PROCEDURE pliego.sp_credit_note_issue(IN p_actor_user_id BIGINT,IN p_order_id BIGINT,
    IN p_document_number VARCHAR,IN p_reason VARCHAR,OUT o_credit_note_id BIGINT)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_invoice pliego.factura%ROWTYPE;
BEGIN
    PERFORM pliego.fn_assert_actor(p_actor_user_id,'ADMIN');
    PERFORM 1 FROM pliego.pedido WHERE pedido_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM pliego.fn_raise_domain_error('P5001','ORDER_NOT_FOUND'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pliego.pago WHERE pedido_id=p_order_id AND estado='REFUNDED') THEN
        PERFORM pliego.fn_raise_domain_error('P5006','PAYMENT_STATE_INVALID');
    END IF;
    SELECT * INTO v_invoice FROM pliego.factura WHERE pedido_id=p_order_id AND estado='ISSUED';
    IF NOT FOUND OR EXISTS (SELECT 1 FROM pliego.nota_credito WHERE factura_id=v_invoice.factura_id) THEN
        PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION');
    END IF;
    IF p_document_number IS NULL OR char_length(btrim(p_document_number)) NOT BETWEEN 1 AND 80
        OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_ARGUMENT');
    END IF;
    BEGIN
        INSERT INTO pliego.nota_credito(factura_id,numero_documento,motivo,subtotal,impuesto_total,total,usuario_emisor_id)
        VALUES(v_invoice.factura_id,btrim(p_document_number),btrim(p_reason),v_invoice.subtotal,
            v_invoice.impuesto_total,v_invoice.total,p_actor_user_id) RETURNING nota_credito_id INTO o_credit_note_id;
    EXCEPTION WHEN unique_violation THEN PERFORM pliego.fn_raise_domain_error('P5002','ORDER_INVALID_TRANSITION'); END;
END; $$;

-- Internal nested read projection. Never stores business data as JSON.
CREATE FUNCTION pliego.fn_order_post_purchase(p_order_id BIGINT)
RETURNS TABLE(purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
SELECT pliego.fn_order_purchase_state(p.estado),
    (SELECT jsonb_build_object('method',f.metodo) FROM pliego.pedido_entrega f WHERE f.pedido_id=p.pedido_id),
    (SELECT jsonb_build_object('shipmentId',e.envio_id,'state',e.estado,'carrier',e.transportista,
        'trackingCode',e.seguimiento_codigo,'trackingUrl',e.seguimiento_url,
        'estimatedDeliveryFrom',e.entrega_estimada_desde,'estimatedDeliveryTo',e.entrega_estimada_hasta,
        'createdAt',e.fecha_creacion,'preparingAt',e.fecha_preparacion,'shippedAt',e.fecha_envio,
        'outForDeliveryAt',e.fecha_en_reparto,'deliveredAt',e.fecha_entrega,'canceledAt',e.fecha_cancelacion,
        'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('eventId',h.envio_historial_id,'type',h.tipo,
            'origin',h.origen,'actorUserId',h.usuario_actor_id,'previousState',h.estado_anterior,'newState',h.estado_nuevo,
            'carrier',h.transportista,'trackingCode',h.seguimiento_codigo,'trackingUrl',h.seguimiento_url,'at',h.fecha)
            ORDER BY h.fecha,h.envio_historial_id) FROM pliego.envio_historial h WHERE h.envio_id=e.envio_id),'[]'::JSONB))
        FROM pliego.envio e WHERE e.pedido_id=p.pedido_id),
    (SELECT jsonb_build_object('invoiceId',i.factura_id,'documentNumber',i.numero_documento,'state',i.estado,
        'buyerName',i.comprador_nombre,'identityType',i.identidad_tipo,'identityNumber',i.identidad_numero,
        'buyerEmail',i.comprador_email,'currency',i.moneda,'subtotal',i.subtotal,'taxTotal',i.impuesto_total,'total',i.total,
        'issuedAt',i.fecha_emision,'billingAddress',(SELECT jsonb_build_object('line1',d.direccion_linea1,
            'line2',d.direccion_linea2,'city',d.ciudad,'province',d.provincia,'countryCode',d.pais_codigo,'postalCode',d.codigo_postal)
            FROM pliego.factura_direccion d WHERE d.factura_id=i.factura_id),
        'items',(SELECT jsonb_agg(jsonb_build_object('invoiceItemId',l.factura_item_id,'orderItemId',l.pedido_item_id,
            'description',l.descripcion,'quantity',l.cantidad,'unitPrice',l.precio_unitario,'subtotal',l.subtotal,
            'taxTreatment',l.tratamiento_impuesto,'taxRate',l.impuesto_tasa,'taxAmount',l.impuesto_monto,'total',l.total)
            ORDER BY l.factura_item_id) FROM pliego.factura_item l WHERE l.factura_id=i.factura_id),
        'electronicIssuance',(SELECT jsonb_build_object('provider',el.proveedor,'state',el.estado,
            'externalReference',el.referencia_externa,'submittedAt',el.fecha_presentacion,'authorizedAt',el.fecha_autorizacion)
            FROM pliego.factura_emision_electronica el WHERE el.factura_id=i.factura_id),
        'pdfAvailable',EXISTS(SELECT 1 FROM pliego.factura_archivo ar WHERE ar.factura_id=i.factura_id AND ar.tipo='PDF'),
        'xmlAvailable',EXISTS(SELECT 1 FROM pliego.factura_archivo ar WHERE ar.factura_id=i.factura_id AND ar.tipo='XML'))
        FROM pliego.factura i WHERE i.pedido_id=p.pedido_id AND i.estado='ISSUED'),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('creditNoteId',n.nota_credito_id,'invoiceId',n.factura_id,
        'documentNumber',n.numero_documento,'state',n.estado,'reason',n.motivo,'subtotal',n.subtotal,
        'taxTotal',n.impuesto_total,'total',n.total,'issuedAt',n.fecha_emision) ORDER BY n.fecha_emision,n.nota_credito_id)
        FROM pliego.nota_credito n JOIN pliego.factura i USING(factura_id) WHERE i.pedido_id=p.pedido_id),'[]'::JSONB),
    jsonb_build_object('cancel',p.estado IN ('CONFIRMED','PREPARING') AND pa.estado='APPROVED'
        AND NOT EXISTS(SELECT 1 FROM pliego.envio e WHERE e.pedido_id=p.pedido_id AND e.estado NOT IN ('PENDING','PREPARING')),
        'changeShippingAddress',FALSE)
FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) WHERE p.pedido_id=p_order_id;
$$;

ALTER FUNCTION pliego.fn_customer_order_detail(BIGINT,BIGINT) RENAME TO fn_customer_order_detail_internal_v017;
CREATE FUNCTION pliego.fn_customer_order_detail(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id BIGINT,order_state VARCHAR,subtotal NUMERIC(30,2),total NUMERIC(30,2),created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,items JSONB,address JSONB,payment JSONB,state_history JSONB,
    purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
    RETURN QUERY SELECT b.*,e.* FROM pliego.fn_customer_order_detail_internal_v017(p_actor_user_id,p_order_id) b
        CROSS JOIN LATERAL pliego.fn_order_post_purchase(b.order_id) e;
END; $$;

ALTER FUNCTION pliego.fn_customer_orders(BIGINT,INTEGER,INTEGER) RENAME TO fn_customer_orders_internal_v017;
CREATE FUNCTION pliego.fn_customer_orders(p_actor_user_id BIGINT,p_page INTEGER,p_page_size INTEGER)
RETURNS TABLE(order_id BIGINT,created_at TIMESTAMPTZ,order_state VARCHAR,total NUMERIC(30,2),payment_state VARCHAR,total_count BIGINT,
    purchase_state VARCHAR,fulfillment_method VARCHAR,shipment_state VARCHAR,estimated_delivery_from TIMESTAMPTZ,
    estimated_delivery_to TIMESTAMPTZ,item_count BIGINT,unit_count BIGINT,item_summary JSONB,invoice_state VARCHAR,
    invoice_pdf_available BOOLEAN,invoice_xml_available BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
    RETURN QUERY SELECT b.*,pliego.fn_order_purchase_state(b.order_state),f.metodo,s.estado,
        s.entrega_estimada_desde,s.entrega_estimada_hasta,
        (SELECT count(*) FROM pliego.pedido_item l WHERE l.pedido_id=b.order_id),
        (SELECT sum(l.cantidad)::BIGINT FROM pliego.pedido_item l WHERE l.pedido_id=b.order_id),
        COALESCE((SELECT jsonb_agg(jsonb_build_object('orderItemId',l.pedido_item_id,'title',l.titulo_snapshot,
            'format',l.formato_snapshot,'quantity',l.cantidad) ORDER BY l.pedido_item_id)
            FROM (SELECT * FROM pliego.pedido_item WHERE pedido_id=b.order_id ORDER BY pedido_item_id LIMIT 3) l),'[]'::JSONB),
        i.estado,EXISTS(SELECT 1 FROM pliego.factura_archivo ar WHERE ar.factura_id=i.factura_id AND ar.tipo='PDF'),
        EXISTS(SELECT 1 FROM pliego.factura_archivo ar WHERE ar.factura_id=i.factura_id AND ar.tipo='XML')
    FROM pliego.fn_customer_orders_internal_v017(p_actor_user_id,p_page,p_page_size) b
        LEFT JOIN pliego.pedido_entrega f ON f.pedido_id=b.order_id LEFT JOIN pliego.envio s ON s.pedido_id=b.order_id
        LEFT JOIN pliego.factura i ON i.pedido_id=b.order_id AND i.estado='ISSUED'
    ORDER BY b.created_at DESC,b.order_id DESC;
END; $$;

ALTER FUNCTION pliego.fn_admin_order_detail(BIGINT,BIGINT) RENAME TO fn_admin_order_detail_internal_v017;
CREATE FUNCTION pliego.fn_admin_order_detail(p_actor_user_id BIGINT,p_order_id BIGINT)
RETURNS TABLE(order_id BIGINT,customer_id BIGINT,customer_email VARCHAR,customer_name VARCHAR,order_state VARCHAR,
    subtotal NUMERIC(30,2),total NUMERIC(30,2),created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,
    items JSONB,address JSONB,payment JSONB,state_history JSONB,inventory_movements JSONB,
    purchase_state VARCHAR,fulfillment JSONB,shipment JSONB,invoice JSONB,credit_notes JSONB,available_actions JSONB)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
BEGIN
    RETURN QUERY SELECT b.*,e.* FROM pliego.fn_admin_order_detail_internal_v017(p_actor_user_id,p_order_id) b
        CROSS JOIN LATERAL pliego.fn_order_post_purchase(b.order_id) e;
END; $$;
