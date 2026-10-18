-- Executed by invoice_artifacts_gate.py in the same transaction as the core fixtures.
DO $$
DECLARE job RECORD; next_job RECORD; meta JSONB; owner_id BIGINT; order_id BIGINT;
 legacy_order BIGINT; legacy_invoice BIGINT;
BEGIN
 -- A missing routine is an intentional RED before V073 is applied.
 SELECT * INTO job FROM pliego.fn_invoice_artifact_claim();
 IF job.invoice_id IS NULL THEN RAISE EXCEPTION 'issued academic fixture required'; END IF;
 SELECT f.pedido_id, c.usuario_id INTO order_id, owner_id FROM pliego.factura f
 JOIN pliego.pedido p USING(pedido_id) JOIN pliego.cliente c USING(cliente_id) WHERE f.factura_id=job.invoice_id;
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
 meta := pliego.fn_invoice_artifact_metadata(owner_id, order_id);
 IF meta->>'provenance'<>'SIMULATED' OR jsonb_array_length(meta->'files')<>2 THEN RAISE EXCEPTION 'metadata missing'; END IF;
 IF pliego.fn_invoice_artifact_complete(job.invoice_id,job.file_type,uuidv4(),decode('25504446','hex')) THEN
  RAISE EXCEPTION 'wrong owner published'; END IF;
 IF NOT pliego.fn_invoice_artifact_complete(job.invoice_id,job.file_type,job.lease_owner,decode('25504446','hex')) THEN
  RAISE EXCEPTION 'lease completion rejected'; END IF;
 IF pliego.fn_invoice_artifact_complete(job.invoice_id,job.file_type,job.lease_owner,decode('25504446','hex')) THEN
  RAISE EXCEPTION 'terminal completion replay accepted'; END IF;
 IF NOT EXISTS(SELECT FROM pliego.fn_invoice_artifact_download(owner_id,order_id,job.file_type) WHERE octet_length(content)=4) THEN
  RAISE EXCEPTION 'download differs'; END IF;
 BEGIN
  UPDATE pliego.factura_archivo_contenido SET contenido=decode('00','hex') WHERE factura_id=job.invoice_id AND tipo=job.file_type;
  RAISE EXCEPTION 'immutable bytes changed';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 SELECT * INTO next_job FROM pliego.fn_invoice_artifact_claim();
 IF next_job.invoice_id=job.invoice_id AND next_job.file_type=job.file_type THEN RAISE EXCEPTION 'ready job reclaimed'; END IF;
 IF next_job.invoice_id IS NOT NULL THEN
  UPDATE pliego.factura_archivo_trabajo SET lease_until=clock_timestamp()-INTERVAL '1 second'
   WHERE factura_id=next_job.invoice_id AND tipo=next_job.file_type;
  PERFORM pliego.fn_invoice_artifact_claim();
  IF pliego.fn_invoice_artifact_complete(next_job.invoice_id,next_job.file_type,next_job.lease_owner,decode('00','hex')) THEN
   RAISE EXCEPTION 'expired lease published'; END IF;
 END IF;
END $$;
ROLLBACK;
