-- Executed by invoice_artifacts_gate.py in the same transaction as the core fixtures.
DO $$
DECLARE job RECORD; next_job RECORD; mail_data JSONB; access RECORD; stored_access RECORD; meta JSONB; owner_id BIGINT; order_id BIGINT;
 legacy_order BIGINT; legacy_invoice BIGINT; other_actor BIGINT; other_customer BIGINT; other_state VARCHAR;
 owner_email VARCHAR; invoice_number VARCHAR; xml_owner UUID; object_checksum VARCHAR; object_key TEXT;
BEGIN
 -- A missing routine is an intentional RED before V073 is applied.
 SELECT * INTO job FROM pliego.fn_invoice_artifact_claim();
 IF job.invoice_id IS NULL THEN RAISE EXCEPTION 'issued academic fixture required'; END IF;
 SELECT f.pedido_id, c.usuario_id INTO order_id, owner_id FROM pliego.factura f
 JOIN pliego.pedido p USING(pedido_id) JOIN pliego.cliente c USING(cliente_id) WHERE f.factura_id=job.invoice_id;
 IF job.file_type<>'PDF' THEN RAISE EXCEPTION 'PDF should be the first claimed invoice artifact'; END IF;
 SELECT u.email_normalizado,f.numero_documento INTO owner_email,invoice_number
 FROM pliego.factura f JOIN pliego.pedido p USING(pedido_id)
 JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id)
 WHERE f.factura_id=job.invoice_id;
 IF job.snapshot::JSONB->'payment'->>'method' NOT IN ('CARD','TRANSFER')
    OR (job.snapshot::JSONB->'payment'->>'amount')::NUMERIC<>(job.snapshot::JSONB->>'total')::NUMERIC THEN
  RAISE EXCEPTION 'immutable checkout payment receipt missing from new claim snapshot'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_invoice_artifact_access(owner_id,order_id,'PDF') a
  WHERE a.file_state='PROCESSING' AND a.provenance='SIMULATED') THEN
  RAISE EXCEPTION 'authorized pending PDF access state missing'; END IF;
 -- Historical documents are never queued or reported as preparing, even with an old storage reference.
 INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total)
 SELECT cliente_id,'CONFIRMED',1,1 FROM pliego.cliente WHERE usuario_id=owner_id RETURNING pedido_id INTO legacy_order;
 INSERT INTO pliego.factura(pedido_id,numero_documento,estado,comprador_nombre,identidad_tipo,identidad_numero,
  subtotal,impuesto_total,total,usuario_emisor_id,fecha_emision)
 SELECT legacy_order,'artifact-legacy-'||legacy_order,'ISSUED','Cliente histórico','OTHER','fixture',1,0,1,
  usuario_id,clock_timestamp() FROM pliego.usuario WHERE email_normalizado='billing-core-gate-admin@pliego.local'
 RETURNING factura_id INTO legacy_invoice;
 INSERT INTO pliego.factura_archivo(factura_id,tipo,almacenamiento_clave)
 VALUES(legacy_invoice,'PDF','private-historical-storage-reference');
 meta:=pliego.fn_invoice_artifact_metadata(owner_id,legacy_order);
 IF meta->>'provenance' IS DISTINCT FROM 'LEGACY' OR jsonb_array_length(meta->'files')<>2
  OR EXISTS(SELECT FROM jsonb_array_elements(meta->'files') f WHERE f->>'state' IS DISTINCT FROM 'UNAVAILABLE') THEN
  RAISE EXCEPTION 'legacy files falsely reported as preparing'; END IF;
 IF meta::TEXT LIKE '%private-historical-storage-reference%' THEN RAISE EXCEPTION 'storage reference exposed'; END IF;
 IF EXISTS(SELECT FROM pliego.factura_archivo_trabajo WHERE factura_id=legacy_invoice) THEN
  RAISE EXCEPTION 'legacy invoice queued for regeneration'; END IF;
 IF EXISTS(SELECT FROM pliego.fn_invoice_artifact_download(owner_id,legacy_order,'PDF')) THEN
  RAISE EXCEPTION 'legacy bytes fabricated'; END IF;
 IF EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave='INVOICE_ISSUED:'||legacy_invoice) THEN
  RAISE EXCEPTION 'legacy invoice email enqueued'; END IF;
 meta := pliego.fn_invoice_artifact_metadata(owner_id, order_id);
 IF meta->>'provenance'<>'SIMULATED' OR jsonb_array_length(meta->'files')<>2 THEN RAISE EXCEPTION 'metadata missing'; END IF;
 IF pliego.fn_invoice_artifact_complete(job.invoice_id,job.file_type,uuidv4(),decode('25504446','hex')) THEN
  RAISE EXCEPTION 'wrong owner published'; END IF;
 IF NOT pliego.fn_invoice_artifact_complete(job.invoice_id,job.file_type,job.lease_owner,decode('25504446','hex')) THEN
  RAISE EXCEPTION 'lease completion rejected'; END IF;
 SELECT datos INTO mail_data FROM pliego.correo_outbox WHERE evento_clave='INVOICE_ISSUED:'||job.invoice_id;
 IF NOT FOUND OR (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='INVOICE_ISSUED:'||job.invoice_id)<>1
    OR (SELECT destinatario FROM pliego.correo_outbox WHERE evento_clave='INVOICE_ISSUED:'||job.invoice_id)<>owner_email
    OR mail_data->>'customerName' IS NULL OR mail_data->>'customerName'='Comprador Fiscal'
    OR mail_data->>'documentNumber' IS DISTINCT FROM invoice_number
    OR mail_data->>'orderId' IS DISTINCT FROM order_id::TEXT
    OR mail_data ? 'identityNumber' OR mail_data ? 'identityType'
    OR mail_data::TEXT ~ '[0-9]{10,13}' THEN
  RAISE EXCEPTION 'invoice email did not use minimal account-owner snapshot'; END IF;
 SELECT * INTO access FROM pliego.fn_invoice_artifact_access(owner_id,order_id,'PDF');
 IF access.file_state<>'READY' OR access.provenance<>'SIMULATED'
    OR access.storage_key IS DISTINCT FROM 'db://academic-invoices/'||job.invoice_id||'/PDF' THEN
  RAISE EXCEPTION 'ready invoice access grant mismatch'; END IF;
 SELECT * INTO stored_access FROM pliego.fn_invoice_artifact_access_v085(owner_id,order_id,'PDF');
 IF stored_access.storage_kind<>'DATABASE' OR stored_access.object_key IS NOT NULL
    OR stored_access.size_bytes<>4 OR stored_access.checksum IS NULL THEN
  RAISE EXCEPTION 'database storage metadata missing'; END IF;
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 IF (SELECT count(*) FROM pliego.factura_archivo_contenido WHERE factura_id=job.invoice_id AND tipo='PDF')<>1 THEN
  RAISE EXCEPTION 'database READY artifact is missing its single bytea object'; END IF;
 BEGIN
  UPDATE pliego.factura_archivo SET checksum=repeat('0',64) WHERE factura_id=job.invoice_id AND tipo='PDF';
  RAISE EXCEPTION 'database artifact storage metadata was mutable';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 CALL pliego.sp_customer_register('invoice-access-other@pliego.local','fixture-hash',
  'Otro','Cliente',NULL,other_actor,other_customer,other_state);
 BEGIN
  PERFORM * FROM pliego.fn_invoice_artifact_access(other_actor,order_id,'PDF');
  RAISE EXCEPTION 'cross-owner artifact access allowed';
 EXCEPTION WHEN SQLSTATE 'P5001' THEN NULL; END;
 BEGIN
  PERFORM * FROM pliego.fn_invoice_artifact_access_v085(other_actor,order_id,'PDF');
  RAISE EXCEPTION 'cross-owner v085 artifact access allowed';
 EXCEPTION WHEN SQLSTATE 'P5001' THEN NULL; END;
 IF pliego.fn_invoice_artifact_complete(job.invoice_id,job.file_type,job.lease_owner,decode('25504446','hex')) THEN
  RAISE EXCEPTION 'terminal completion replay accepted'; END IF;
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='INVOICE_ISSUED:'||job.invoice_id)<>1 THEN
  RAISE EXCEPTION 'duplicate invoice email on completion replay'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_invoice_artifact_download(owner_id,order_id,job.file_type) WHERE octet_length(content)=4) THEN
  RAISE EXCEPTION 'download differs'; END IF;
 BEGIN
  UPDATE pliego.factura_archivo_contenido SET contenido=decode('00','hex') WHERE factura_id=job.invoice_id AND tipo=job.file_type;
  RAISE EXCEPTION 'immutable bytes changed';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 SELECT * INTO next_job FROM pliego.fn_invoice_artifact_claim();
 IF next_job.invoice_id=job.invoice_id AND next_job.file_type=job.file_type THEN RAISE EXCEPTION 'ready job reclaimed'; END IF;
 UPDATE pliego.factura_archivo_trabajo SET estado='PROCESSING',intentos=1,propietario=uuidv4(),
  lease_until=clock_timestamp()+INTERVAL '60 seconds'
  WHERE factura_id=job.invoice_id AND tipo='XML' RETURNING propietario INTO xml_owner;
 object_checksum:=encode(sha256(decode('3c783e','hex')),'hex');
 object_key:='invoices/'||job.invoice_id||'/'||object_checksum||'.xml';
 BEGIN
  PERFORM pliego.fn_invoice_artifact_complete_stored(job.invoice_id,'XML',xml_owner,'R2',object_key,
   object_checksum,3,'application/xml',decode('3c783e','hex'));
  RAISE EXCEPTION 'R2 completion accepted bytes and object key together';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 IF xml_owner IS NULL OR NOT pliego.fn_invoice_artifact_complete_stored(job.invoice_id,'XML',xml_owner,'R2',
  object_key,object_checksum,3,'application/xml',NULL) THEN RAISE EXCEPTION 'R2 XML completion rejected'; END IF;
 IF EXISTS(SELECT FROM pliego.factura_archivo_contenido WHERE factura_id=job.invoice_id AND tipo='XML') THEN
  RAISE EXCEPTION 'R2 XML also stored as bytea'; END IF;
 SELECT * INTO stored_access FROM pliego.fn_invoice_artifact_access_v085(owner_id,order_id,'XML');
 IF stored_access.file_state<>'READY' OR stored_access.storage_kind<>'R2'
    OR stored_access.object_key IS DISTINCT FROM object_key OR stored_access.checksum IS DISTINCT FROM object_checksum
    OR stored_access.size_bytes<>3 OR stored_access.mime_type<>'application/xml' THEN
  RAISE EXCEPTION 'R2 object metadata was not exposed to the billing adapter'; END IF;
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 BEGIN
  UPDATE pliego.factura_archivo SET object_key='changed' WHERE factura_id=job.invoice_id AND tipo='XML';
  RAISE EXCEPTION 'R2 object metadata was mutable';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 IF pliego.fn_invoice_artifact_complete_stored(job.invoice_id,'XML',xml_owner,'R2',object_key,
  object_checksum,3,'application/xml',NULL) THEN RAISE EXCEPTION 'R2 XML completion replay accepted'; END IF;
 IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='INVOICE_ISSUED:'||job.invoice_id)<>1 THEN
  RAISE EXCEPTION 'XML artifact enqueued invoice email'; END IF;
 -- New READY transitions must have exactly one confirmed storage representation.
 INSERT INTO pliego.factura_archivo_trabajo(factura_id,tipo,estado,intentos,propietario,lease_until)
 VALUES(legacy_invoice,'PDF','PROCESSING',1,uuidv4(),clock_timestamp()+INTERVAL '60 seconds') ON CONFLICT DO NOTHING;
 BEGIN
  UPDATE pliego.factura_archivo_trabajo SET estado='READY',propietario=NULL,lease_until=NULL
   WHERE factura_id=legacy_invoice AND tipo='PDF';
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'READY artifact without storage accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 SET CONSTRAINTS ALL DEFERRED;
 IF next_job.invoice_id IS NOT NULL
    AND NOT (next_job.invoice_id=job.invoice_id AND next_job.file_type='XML') THEN
  UPDATE pliego.factura_archivo_trabajo SET lease_until=clock_timestamp()-INTERVAL '1 second'
   WHERE factura_id=next_job.invoice_id AND tipo=next_job.file_type;
  PERFORM pliego.fn_invoice_artifact_claim();
  IF pliego.fn_invoice_artifact_complete(next_job.invoice_id,next_job.file_type,next_job.lease_owner,decode('00','hex')) THEN
   RAISE EXCEPTION 'expired lease published'; END IF;
 END IF;
END $$;
ROLLBACK;
