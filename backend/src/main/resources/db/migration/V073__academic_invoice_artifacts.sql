-- Derived academic documents, published atomically under fenced worker leases.
-- Small academic files remain private bytea objects; storage is behind the Database API.
CREATE TABLE pliego.factura_archivo_trabajo (
 factura_id BIGINT NOT NULL REFERENCES pliego.factura(factura_id),
 tipo VARCHAR(3) NOT NULL CHECK(tipo IN('PDF','XML')),
 estado VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(estado IN('PENDING','PROCESSING','READY','FAILED')),
 intentos INTEGER NOT NULL DEFAULT 0 CHECK(intentos BETWEEN 0 AND 5),
 propietario UUID,
 lease_until TIMESTAMPTZ,
 siguiente_intento TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 actualizado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(factura_id,tipo),
 CHECK((estado='PROCESSING' AND propietario IS NOT NULL AND lease_until IS NOT NULL)
    OR (estado<>'PROCESSING' AND propietario IS NULL AND lease_until IS NULL))
);
CREATE INDEX ix_invoice_artifact_pending ON pliego.factura_archivo_trabajo(siguiente_intento,factura_id,tipo) WHERE estado='PENDING';
CREATE INDEX ix_invoice_artifact_expired ON pliego.factura_archivo_trabajo(lease_until) WHERE estado='PROCESSING';
CREATE TABLE pliego.factura_archivo_contenido (
 factura_id BIGINT NOT NULL,
 tipo VARCHAR(3) NOT NULL,
 contenido BYTEA NOT NULL CHECK(octet_length(contenido) BETWEEN 1 AND 10485760),
 checksum CHAR(64) NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'),
 mime_type VARCHAR(32) NOT NULL CHECK(mime_type IN('application/pdf','application/xml')),
 creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(factura_id,tipo),
 FOREIGN KEY(factura_id,tipo) REFERENCES pliego.factura_archivo_trabajo(factura_id,tipo)
);
CREATE TRIGGER trg_invoice_artifact_bytes_immutable BEFORE UPDATE OR DELETE ON pliego.factura_archivo_contenido
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_prevent_update_delete();

CREATE FUNCTION pliego.fn_invoice_artifact_enqueue() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
 IF NEW.estado='ISSUED' AND NEW.procedencia='SIMULATED' THEN
  INSERT INTO pliego.factura_archivo_trabajo(factura_id,tipo) VALUES(NEW.factura_id,'PDF'),(NEW.factura_id,'XML') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_invoice_artifact_enqueue AFTER INSERT OR UPDATE OF estado ON pliego.factura
 FOR EACH ROW EXECUTE FUNCTION pliego.fn_invoice_artifact_enqueue();
INSERT INTO pliego.factura_archivo_trabajo(factura_id,tipo)
 SELECT f.factura_id,t.tipo FROM pliego.factura f CROSS JOIN (VALUES('PDF'),('XML')) t(tipo)
 WHERE f.estado='ISSUED' AND f.procedencia='SIMULATED' ON CONFLICT DO NOTHING;

CREATE FUNCTION pliego.fn_invoice_artifact_claim()
RETURNS TABLE(invoice_id BIGINT,file_type VARCHAR,lease_owner UUID,attempt INTEGER,snapshot TEXT)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE job pliego.factura_archivo_trabajo%ROWTYPE;
BEGIN
 UPDATE pliego.factura_archivo_trabajo SET estado='FAILED',propietario=NULL,lease_until=NULL,actualizado_en=clock_timestamp()
 WHERE estado='PROCESSING' AND lease_until<clock_timestamp() AND intentos>=5;
 SELECT * INTO job FROM pliego.factura_archivo_trabajo j
 WHERE j.intentos<5 AND ((j.estado='PENDING' AND j.siguiente_intento<=clock_timestamp())
    OR (j.estado='PROCESSING' AND j.lease_until<clock_timestamp()))
 ORDER BY j.siguiente_intento,j.factura_id,j.tipo FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE pliego.factura_archivo_trabajo SET estado='PROCESSING',intentos=intentos+1,propietario=uuidv4(),
  lease_until=clock_timestamp()+INTERVAL '60 seconds',actualizado_en=clock_timestamp()
 WHERE factura_id=job.factura_id AND tipo=job.tipo RETURNING * INTO job;
 RETURN QUERY SELECT job.factura_id,job.tipo,job.propietario,job.intentos,pliego.fn_invoice_snapshot_data(job.factura_id)::TEXT;
END; $$;

CREATE FUNCTION pliego.fn_invoice_artifact_complete(p_invoice BIGINT,p_type VARCHAR,p_owner UUID,p_content BYTEA)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE job pliego.factura_archivo_trabajo%ROWTYPE;
BEGIN
 SELECT * INTO job FROM pliego.factura_archivo_trabajo WHERE factura_id=p_invoice AND tipo=p_type FOR UPDATE;
 IF NOT FOUND OR job.estado<>'PROCESSING' OR job.propietario IS DISTINCT FROM p_owner OR job.lease_until<clock_timestamp() THEN RETURN FALSE; END IF;
 IF p_content IS NULL OR octet_length(p_content) NOT BETWEEN 1 AND 10485760 THEN
  PERFORM pliego.fn_raise_domain_error('P1001','INVALID_PARAMETER'); END IF;
 INSERT INTO pliego.factura_archivo_contenido(factura_id,tipo,contenido,checksum,mime_type)
 VALUES(p_invoice,p_type,p_content,encode(sha256(p_content),'hex'),CASE p_type WHEN 'PDF' THEN 'application/pdf' ELSE 'application/xml' END);
 INSERT INTO pliego.factura_archivo(factura_id,tipo,almacenamiento_clave)
 VALUES(p_invoice,p_type,'db://academic-invoices/'||p_invoice||'/'||p_type);
 UPDATE pliego.factura_archivo_trabajo SET estado='READY',propietario=NULL,lease_until=NULL,actualizado_en=clock_timestamp()
 WHERE factura_id=p_invoice AND tipo=p_type;
 RETURN TRUE;
END; $$;

CREATE FUNCTION pliego.fn_invoice_artifact_fail(p_invoice BIGINT,p_type VARCHAR,p_owner UUID)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE affected INTEGER;
BEGIN
 UPDATE pliego.factura_archivo_trabajo SET estado=CASE WHEN intentos>=5 THEN 'FAILED' ELSE 'PENDING' END,
  propietario=NULL,lease_until=NULL,siguiente_intento=clock_timestamp()+make_interval(secs=>LEAST(300,5*power(2,intentos)::INTEGER)),
  actualizado_en=clock_timestamp()
 WHERE factura_id=p_invoice AND tipo=p_type AND estado='PROCESSING' AND propietario=p_owner AND lease_until>=clock_timestamp();
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END; $$;

CREATE FUNCTION pliego.fn_invoice_artifact_metadata(p_actor BIGINT,p_order BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE doc JSONB; result JSONB;
BEGIN
 doc:=pliego.fn_invoice_snapshot(p_actor,p_order);
 IF doc IS NULL THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('invoiceId',f.factura_id::TEXT,'orderId',f.pedido_id::TEXT,'state',f.estado,
  'provenance',f.procedencia,'documentNumber',CASE WHEN f.estado='DRAFT' THEN NULL ELSE f.numero_documento END,
  'files',(SELECT jsonb_agg(jsonb_build_object('type',t.tipo,'state',
    CASE WHEN EXISTS(SELECT FROM pliego.factura_archivo_contenido c WHERE c.factura_id=f.factura_id AND c.tipo=t.tipo) THEN 'READY'
     WHEN f.procedencia='LEGACY' THEN 'UNAVAILABLE'
     ELSE COALESCE(j.estado,'PENDING') END) ORDER BY t.tipo)
    FROM (VALUES('PDF'),('XML')) t(tipo) LEFT JOIN pliego.factura_archivo_trabajo j ON j.factura_id=f.factura_id AND j.tipo=t.tipo))
 INTO result FROM pliego.factura f WHERE f.pedido_id=p_order;
 RETURN result;
END; $$;

CREATE FUNCTION pliego.fn_invoice_artifact_download(p_actor BIGINT,p_order BIGINT,p_type VARCHAR)
RETURNS TABLE(content BYTEA,mime_type VARCHAR,file_name TEXT,checksum TEXT)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE doc JSONB;
BEGIN
 doc:=pliego.fn_invoice_snapshot(p_actor,p_order);
 IF p_type IS NULL OR p_type NOT IN('PDF','XML') THEN PERFORM pliego.fn_raise_domain_error('P1001','INVALID_PARAMETER'); END IF;
 RETURN QUERY SELECT c.contenido,c.mime_type,'pliego-factura-academica-'||f.numero_documento||'.'||lower(c.tipo),c.checksum::TEXT
 FROM pliego.factura f JOIN pliego.factura_archivo_contenido c USING(factura_id)
 WHERE f.pedido_id=p_order AND f.estado='ISSUED' AND c.tipo=p_type;
END; $$;
