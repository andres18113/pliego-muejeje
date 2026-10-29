-- Complete the Saved for Later foreign-key index promised by ADR-0045.
CREATE INDEX ix_cliente_guardado_despues_edicion
    ON pliego.cliente_guardado_despues(edicion_id);

-- A PDF becomes a customer mail event only when its first READY transition commits.
-- Deliberately no backfill: READY artifacts and legacy invoices remain untouched.
ALTER TABLE pliego.correo_outbox DROP CONSTRAINT ck_correo_outbox_tipo;
ALTER TABLE pliego.correo_outbox ADD CONSTRAINT ck_correo_outbox_tipo
    CHECK (tipo IN ('VERIFY_EMAIL','RESET_PASSWORD','ORDER_CONFIRMED','ORDER_STATUS','ORDER_CANCELLED','INVOICE_ISSUED'));

-- Claim-time only projection from the immutable checkout receipt. Older purchases without
-- a receipt carry their authoritative invoice total but no inferred payment method.
CREATE OR REPLACE FUNCTION pliego.fn_invoice_artifact_claim()
RETURNS TABLE(invoice_id BIGINT,file_type VARCHAR,lease_owner UUID,attempt INTEGER,snapshot TEXT)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE
    job pliego.factura_archivo_trabajo%ROWTYPE;
    invoice_snapshot JSONB;
    payment_method VARCHAR;
    payment_amount NUMERIC;
BEGIN
    UPDATE pliego.factura_archivo_trabajo
       SET estado='FAILED',propietario=NULL,lease_until=NULL,actualizado_en=clock_timestamp()
     WHERE estado='PROCESSING' AND lease_until<clock_timestamp() AND intentos>=5;

    SELECT * INTO job
      FROM pliego.factura_archivo_trabajo j
     WHERE j.intentos<5
       AND ((j.estado='PENDING' AND j.siguiente_intento<=clock_timestamp())
         OR (j.estado='PROCESSING' AND j.lease_until<clock_timestamp()))
     ORDER BY j.siguiente_intento,j.factura_id,j.tipo
     FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;

    UPDATE pliego.factura_archivo_trabajo
       SET estado='PROCESSING',intentos=intentos+1,propietario=uuidv4(),
           lease_until=clock_timestamp()+INTERVAL '60 seconds',actualizado_en=clock_timestamp()
     WHERE factura_id=job.factura_id AND tipo=job.tipo
     RETURNING * INTO job;

    invoice_snapshot:=pliego.fn_invoice_snapshot_data(job.factura_id);
    SELECT receipt.payment_method,receipt.total
      INTO payment_method,payment_amount
      FROM pliego.factura f
      LEFT JOIN LATERAL (
          SELECT a.payment_method,a.total
            FROM pliego.checkout_attempt a
           WHERE a.order_id=f.pedido_id AND a.state='CREATED'
           ORDER BY a.actor_user_id,a.attempt_key
           LIMIT 1
      ) receipt ON TRUE
     WHERE f.factura_id=job.factura_id;

    invoice_snapshot:=invoice_snapshot || jsonb_build_object('payment',
        jsonb_strip_nulls(jsonb_build_object(
            'method',payment_method,
            'amount',COALESCE(payment_amount,(invoice_snapshot->>'total')::NUMERIC)::TEXT)));

    RETURN QUERY SELECT job.factura_id,job.tipo,job.propietario,job.intentos,invoice_snapshot::TEXT;
END; $$;

-- Publish bytes, READY status and the idempotent email event atomically under the lease.
CREATE OR REPLACE FUNCTION pliego.fn_invoice_artifact_complete(p_invoice BIGINT,p_type VARCHAR,p_owner UUID,p_content BYTEA)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE
    job pliego.factura_archivo_trabajo%ROWTYPE;
BEGIN
    SELECT * INTO job
      FROM pliego.factura_archivo_trabajo
     WHERE factura_id=p_invoice AND tipo=p_type
     FOR UPDATE;
    IF NOT FOUND OR job.estado<>'PROCESSING' OR job.propietario IS DISTINCT FROM p_owner
       OR job.lease_until<clock_timestamp() THEN RETURN FALSE; END IF;
    IF p_content IS NULL OR octet_length(p_content) NOT BETWEEN 1 AND 10485760 THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_PARAMETER');
    END IF;

    INSERT INTO pliego.factura_archivo_contenido(factura_id,tipo,contenido,checksum,mime_type)
    VALUES(p_invoice,p_type,p_content,encode(sha256(p_content),'hex'),
           CASE p_type WHEN 'PDF' THEN 'application/pdf' ELSE 'application/xml' END);
    INSERT INTO pliego.factura_archivo(factura_id,tipo,almacenamiento_clave)
    VALUES(p_invoice,p_type,'db://academic-invoices/'||p_invoice||'/'||p_type);
    UPDATE pliego.factura_archivo_trabajo
       SET estado='READY',propietario=NULL,lease_until=NULL,actualizado_en=clock_timestamp()
     WHERE factura_id=p_invoice AND tipo=p_type;

    IF p_type='PDF' THEN
        INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
        SELECT 'INVOICE_ISSUED:'||f.factura_id,'INVOICE_ISSUED',u.usuario_id,u.email_normalizado,
               jsonb_build_object(
                   'customerName',btrim(c.nombres||' '||c.apellidos),
                   'documentNumber',f.numero_documento,
                   'orderId',p.pedido_id::TEXT)
          FROM pliego.factura f
          JOIN pliego.pedido p USING(pedido_id)
          JOIN pliego.cliente c USING(cliente_id)
          JOIN pliego.usuario u USING(usuario_id)
         WHERE f.factura_id=p_invoice AND f.estado='ISSUED' AND f.procedencia='SIMULATED'
        ON CONFLICT(evento_clave) DO NOTHING;
    END IF;
    RETURN TRUE;
END; $$;

-- Authenticated access metadata uses the same Database API ownership rules as downloads.
-- Object references stay inside the billing adapter and never appear in customer JSON.
CREATE FUNCTION pliego.fn_invoice_artifact_access(p_actor BIGINT,p_order BIGINT,p_type VARCHAR)
RETURNS TABLE(invoice_id BIGINT,provenance VARCHAR,file_state VARCHAR,storage_key TEXT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE doc JSONB;
BEGIN
    doc:=pliego.fn_invoice_snapshot(p_actor,p_order);
    IF doc IS NULL THEN RETURN; END IF;
    IF p_type IS NULL OR p_type NOT IN('PDF','XML') THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_PARAMETER');
    END IF;

    RETURN QUERY
    SELECT f.factura_id,f.procedencia::VARCHAR,
           CASE
             WHEN EXISTS(SELECT FROM pliego.factura_archivo_contenido c
                          WHERE c.factura_id=f.factura_id AND c.tipo=p_type) THEN 'READY'::VARCHAR
             WHEN f.procedencia='LEGACY' THEN 'UNAVAILABLE'::VARCHAR
             ELSE COALESCE(work.estado,'PENDING')::VARCHAR
           END,
           stored.almacenamiento_clave::TEXT
      FROM pliego.factura f
      LEFT JOIN pliego.factura_archivo_trabajo work
        ON work.factura_id=f.factura_id AND work.tipo=p_type
      LEFT JOIN pliego.factura_archivo stored
        ON stored.factura_id=f.factura_id AND stored.tipo=p_type
     WHERE f.pedido_id=p_order;
END; $$;

COMMENT ON FUNCTION pliego.fn_invoice_artifact_access(BIGINT,BIGINT,VARCHAR) IS
    'Authorizes through fn_invoice_snapshot, then reports artifact readiness and its private storage reference to the billing adapter.';
