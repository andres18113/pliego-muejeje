-- New storage metadata stays NULL on existing immutable file rows. Existing bytea bytes are untouched.
ALTER TABLE pliego.factura_archivo
    ADD COLUMN storage_kind VARCHAR(16),
    ADD COLUMN object_key VARCHAR(1024),
    ADD COLUMN checksum CHAR(64),
    ADD COLUMN size_bytes BIGINT,
    ADD COLUMN mime_type VARCHAR(32);

ALTER TABLE pliego.factura_archivo
    ADD CONSTRAINT ck_factura_archivo_storage_metadata CHECK (
        (storage_kind IS NULL AND object_key IS NULL AND checksum IS NULL AND size_bytes IS NULL AND mime_type IS NULL)
        OR (storage_kind='DATABASE' AND object_key IS NULL AND checksum ~ '^[0-9a-f]{64}$'
            AND size_bytes BETWEEN 1 AND 10485760 AND mime_type IN ('application/pdf','application/xml')
            AND ((tipo='PDF' AND mime_type='application/pdf') OR (tipo='XML' AND mime_type='application/xml')))
        OR (storage_kind='R2' AND object_key IS NOT NULL AND char_length(btrim(object_key)) BETWEEN 1 AND 995
            AND object_key NOT LIKE '/%' AND object_key NOT LIKE '%..%' AND position(chr(92) in object_key)=0
            AND checksum ~ '^[0-9a-f]{64}$' AND size_bytes BETWEEN 1 AND 10485760
            AND mime_type IN ('application/pdf','application/xml')
            AND ((tipo='PDF' AND mime_type='application/pdf') OR (tipo='XML' AND mime_type='application/xml')))
    );

-- Deferred across the completion transaction: READY must have exactly one immutable bytea object
-- or one confirmed private R2 object. Old READY bytea rows remain valid without metadata backfill.
CREATE FUNCTION pliego.fn_invoice_artifact_ready_storage_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    stored pliego.factura_archivo%ROWTYPE;
    has_storage BOOLEAN;
    has_bytes BOOLEAN;
    byte_checksum VARCHAR;
    byte_mime VARCHAR;
    byte_size BIGINT;
BEGIN
    IF NEW.estado<>'READY' THEN RETURN NEW; END IF;
    SELECT * INTO stored FROM pliego.factura_archivo
     WHERE factura_id=NEW.factura_id AND tipo=NEW.tipo;
    has_storage:=FOUND;
    SELECT c.checksum::VARCHAR,c.mime_type,octet_length(c.contenido)::BIGINT
      INTO byte_checksum,byte_mime,byte_size
      FROM pliego.factura_archivo_contenido c
     WHERE c.factura_id=NEW.factura_id AND c.tipo=NEW.tipo;
    has_bytes:=FOUND;

    IF has_storage AND stored.storage_kind IS NULL AND stored.object_key IS NULL AND has_bytes THEN
        RETURN NEW;
    END IF;
    IF has_storage AND stored.storage_kind='DATABASE' AND stored.object_key IS NULL AND has_bytes
       AND stored.checksum=byte_checksum AND stored.size_bytes=byte_size AND stored.mime_type=byte_mime THEN
        RETURN NEW;
    END IF;
    IF has_storage AND stored.storage_kind='R2' AND stored.object_key IS NOT NULL AND NOT has_bytes
       AND stored.checksum ~ '^[0-9a-f]{64}$' AND stored.size_bytes BETWEEN 1 AND 10485760
       AND stored.mime_type=(CASE NEW.tipo WHEN 'PDF' THEN 'application/pdf' ELSE 'application/xml' END) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'El archivo READY debe tener bytes o un objeto privado confirmado.' USING ERRCODE='23514';
END; $$;

CREATE CONSTRAINT TRIGGER trg_invoice_artifact_ready_storage_guard
AFTER INSERT OR UPDATE ON pliego.factura_archivo_trabajo
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.estado='READY')
EXECUTE FUNCTION pliego.fn_invoice_artifact_ready_storage_guard();

-- Uploads complete before this routine is called. The leased job, immutable storage metadata,
-- READY transition and simulated-PDF outbox event commit in this single Database API transaction.
CREATE FUNCTION pliego.fn_invoice_artifact_complete_stored(
    p_invoice BIGINT,p_type VARCHAR,p_owner UUID,p_storage_kind VARCHAR,p_object_key VARCHAR,
    p_checksum VARCHAR,p_size_bytes BIGINT,p_mime_type VARCHAR,p_content BYTEA)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE
    job pliego.factura_archivo_trabajo%ROWTYPE;
    storage_reference VARCHAR;
BEGIN
    SELECT * INTO job FROM pliego.factura_archivo_trabajo
     WHERE factura_id=p_invoice AND tipo=p_type FOR UPDATE;
    IF NOT FOUND OR job.estado<>'PROCESSING' OR job.propietario IS DISTINCT FROM p_owner
       OR job.lease_until<clock_timestamp() THEN RETURN FALSE; END IF;
    IF p_type IS NULL OR p_type NOT IN ('PDF','XML')
       OR p_storage_kind NOT IN ('DATABASE','R2')
       OR p_checksum IS NULL OR p_checksum !~ '^[0-9a-f]{64}$'
       OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 10485760
       OR p_mime_type IS DISTINCT FROM (CASE p_type WHEN 'PDF' THEN 'application/pdf' ELSE 'application/xml' END) THEN
        PERFORM pliego.fn_raise_domain_error('P1001','INVALID_PARAMETER');
    END IF;

    IF p_storage_kind='DATABASE' THEN
        IF p_content IS NULL OR octet_length(p_content)<>p_size_bytes
           OR encode(sha256(p_content),'hex')<>p_checksum OR p_object_key IS NOT NULL THEN
            PERFORM pliego.fn_raise_domain_error('P1001','INVALID_PARAMETER');
        END IF;
        INSERT INTO pliego.factura_archivo_contenido(factura_id,tipo,contenido,checksum,mime_type)
        VALUES(p_invoice,p_type,p_content,p_checksum,p_mime_type);
        storage_reference:='db://academic-invoices/'||p_invoice||'/'||p_type;
    ELSE
        IF p_content IS NOT NULL OR p_object_key IS NULL OR char_length(btrim(p_object_key)) NOT BETWEEN 1 AND 995
           OR p_object_key NOT LIKE '%/'||p_invoice||'/'||p_checksum||'.'||lower(p_type)
           OR p_object_key LIKE '/%' OR p_object_key LIKE '%..%' OR position(chr(92) in p_object_key)>0 THEN
            PERFORM pliego.fn_raise_domain_error('P1001','INVALID_PARAMETER');
        END IF;
        storage_reference:='r2://'||p_object_key;
    END IF;

    INSERT INTO pliego.factura_archivo(factura_id,tipo,almacenamiento_clave,storage_kind,object_key,
        checksum,size_bytes,mime_type)
    VALUES(p_invoice,p_type,storage_reference,p_storage_kind,p_object_key,p_checksum,p_size_bytes,p_mime_type);
    UPDATE pliego.factura_archivo_trabajo
       SET estado='READY',propietario=NULL,lease_until=NULL,actualizado_en=clock_timestamp()
     WHERE factura_id=p_invoice AND tipo=p_type;

    IF p_type='PDF' THEN
        INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos)
        SELECT 'INVOICE_ISSUED:'||f.factura_id,'INVOICE_ISSUED',u.usuario_id,u.email_normalizado,
               jsonb_build_object('customerName',btrim(c.nombres||' '||c.apellidos),
                   'documentNumber',f.numero_documento,'orderId',p.pedido_id::TEXT)
          FROM pliego.factura f
          JOIN pliego.pedido p USING(pedido_id)
          JOIN pliego.cliente c USING(cliente_id)
          JOIN pliego.usuario u USING(usuario_id)
         WHERE f.factura_id=p_invoice AND f.estado='ISSUED' AND f.procedencia='SIMULATED'
        ON CONFLICT(evento_clave) DO NOTHING;
    END IF;
    RETURN TRUE;
END; $$;

-- Keep existing database callers compatible. R2 callers use the extended routine after PUT succeeds.
CREATE OR REPLACE FUNCTION pliego.fn_invoice_artifact_complete(p_invoice BIGINT,p_type VARCHAR,p_owner UUID,p_content BYTEA)
RETURNS BOOLEAN LANGUAGE SQL VOLATILE SECURITY INVOKER AS $$
    SELECT pliego.fn_invoice_artifact_complete_stored(
        p_invoice,p_type,p_owner,'DATABASE',NULL,
        CASE WHEN p_content IS NULL THEN NULL ELSE encode(sha256(p_content),'hex') END,
        CASE WHEN p_content IS NULL THEN NULL ELSE octet_length(p_content)::BIGINT END,
        CASE p_type WHEN 'PDF' THEN 'application/pdf' ELSE 'application/xml' END,
        p_content)
$$;

CREATE OR REPLACE FUNCTION pliego.fn_invoice_artifact_metadata(p_actor BIGINT,p_order BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE doc JSONB; result JSONB;
BEGIN
    doc:=pliego.fn_invoice_snapshot(p_actor,p_order);
    IF doc IS NULL THEN RETURN NULL; END IF;
    SELECT jsonb_build_object('invoiceId',f.factura_id::TEXT,'orderId',f.pedido_id::TEXT,'state',f.estado,
        'provenance',f.procedencia,'documentNumber',CASE WHEN f.estado='DRAFT' THEN NULL ELSE f.numero_documento END,
        'files',(SELECT jsonb_agg(jsonb_build_object('type',t.tipo,'state',
            CASE
                WHEN EXISTS(SELECT FROM pliego.factura_archivo_contenido c WHERE c.factura_id=f.factura_id AND c.tipo=t.tipo) THEN 'READY'
                WHEN EXISTS(SELECT FROM pliego.factura_archivo a WHERE a.factura_id=f.factura_id AND a.tipo=t.tipo
                    AND a.storage_kind='R2' AND a.object_key IS NOT NULL) THEN 'READY'
                WHEN f.procedencia='LEGACY' THEN 'UNAVAILABLE'
                ELSE COALESCE(j.estado,'PENDING') END) ORDER BY t.tipo)
            FROM (VALUES('PDF'),('XML')) t(tipo)
            LEFT JOIN pliego.factura_archivo_trabajo j ON j.factura_id=f.factura_id AND j.tipo=t.tipo))
      INTO result FROM pliego.factura f WHERE f.pedido_id=p_order;
    RETURN result;
END; $$;

CREATE FUNCTION pliego.fn_invoice_artifact_access_v085(p_actor BIGINT,p_order BIGINT,p_type VARCHAR)
RETURNS TABLE(invoice_id BIGINT,provenance VARCHAR,file_state VARCHAR,storage_kind VARCHAR,object_key TEXT,
    checksum TEXT,size_bytes BIGINT,mime_type VARCHAR,file_name TEXT,document_number VARCHAR)
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
            WHEN content.factura_id IS NOT NULL OR (stored.storage_kind='R2' AND stored.object_key IS NOT NULL) THEN 'READY'::VARCHAR
            WHEN f.procedencia='LEGACY' THEN 'UNAVAILABLE'::VARCHAR
            ELSE COALESCE(work.estado,'PENDING')::VARCHAR
        END,
        COALESCE(stored.storage_kind,CASE WHEN content.factura_id IS NOT NULL THEN 'DATABASE'::VARCHAR END),
        stored.object_key::TEXT,COALESCE(stored.checksum::TEXT,content.checksum::TEXT),
        COALESCE(stored.size_bytes,octet_length(content.contenido)::BIGINT),
        COALESCE(stored.mime_type,content.mime_type)::VARCHAR,
        'pliego-factura-academica-'||f.numero_documento||'.'||lower(p_type),f.numero_documento::VARCHAR
      FROM pliego.factura f
      LEFT JOIN pliego.factura_archivo_trabajo work ON work.factura_id=f.factura_id AND work.tipo=p_type
      LEFT JOIN pliego.factura_archivo stored ON stored.factura_id=f.factura_id AND stored.tipo=p_type
      LEFT JOIN pliego.factura_archivo_contenido content ON content.factura_id=f.factura_id AND content.tipo=p_type
     WHERE f.pedido_id=p_order;
END; $$;

COMMENT ON FUNCTION pliego.fn_invoice_artifact_complete_stored(BIGINT,VARCHAR,UUID,VARCHAR,VARCHAR,VARCHAR,BIGINT,VARCHAR,BYTEA) IS
    'Fenced invoice completion for either verified PostgreSQL bytea bytes or a confirmed content-addressed private R2 object.';
