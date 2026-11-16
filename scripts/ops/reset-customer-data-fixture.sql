-- FICTIONAL input generator for rehearse-reset.py --make-fixture ONLY.
-- Never use with production or a restored production database.
\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE a bigint; author_id bigint; publisher_id bigint; category_id bigint;
 b bigint; e bigint; physical bigint; digital bigint; audio bigint; n int;
 u bigint; c bigint; state varchar; o bigint; os varchar; ps varchar;
 amount numeric; reference varchar; invoice bigint; cancelled bigint;
 previous varchar; restored bigint; movement bigint; stock_before int; stock_after int; cart_id bigint; item_id bigint; quantity int; job record; bytes bytea; checksum text;
BEGIN
 IF current_database()<>'reset_rehearsal' OR
    (SELECT count(*) FROM pliego.libro)<>1 OR
    (SELECT max(version::int) FROM public.flyway_schema_history)<>95 THEN
  RAISE EXCEPTION 'Only a fresh fictional V087 upgrade fixture in reset_rehearsal is accepted'; END IF;
 SELECT min(usuario_id) INTO a FROM pliego.usuario WHERE rol='ADMIN';
 SELECT min(autor_id) INTO author_id FROM pliego.autor;
 SELECT min(editorial_id) INTO publisher_id FROM pliego.editorial;
 SELECT min(categoria_id) INTO category_id FROM pliego.categoria;
 SELECT min(edicion_id) INTO physical FROM pliego.edicion;
 FOR n IN 2..425 LOOP
  CALL pliego.sp_book_create(a,'Obra ficticia '||n,NULL,'Catálogo local de ensayo',
   jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(category_id),b);
  IF n=424 THEN
   CALL pliego.sp_edition_create(a,b,publisher_id,'RESET-EB-'||n,NULL,'es','EBOOK',NULL,NULL,9.50,
    'https://covers.pliegolibros.com/fictional-reset.webp',NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::text[],e);
   digital:=e;
  ELSIF n=425 THEN
   CALL pliego.sp_edition_create(a,b,publisher_id,'RESET-AB-'||n,NULL,'es','AUDIOBOOK',NULL,NULL,11.50,
    'https://covers.pliegolibros.com/fictional-reset.webp',NULL,NULL,NULL,NULL,3600,ARRAY['Voz ficticia'],e);
   audio:=e;
  ELSE
   CALL pliego.sp_edition_create(a,b,publisher_id,'RESET-PH-'||n,NULL,'es','PAPERBACK',100,NULL,10.50,
    'https://covers.pliegolibros.com/fictional-reset.webp',NULL,NULL,NULL,e);
   CALL pliego.sp_inventory_entry(a,e,3,'Fictional catalog stock',movement,stock_before,stock_after);
  END IF;
 END LOOP;
 INSERT INTO pliego.edicion_oferta(edicion_id,precio_oferta,inicio,fin,oferta_texto,condiciones,estado)
 VALUES(physical,5.25,'2020-01-01 UTC','2020-02-01 UTC','Histórica ficticia','Sin extensión','ACTIVE'),
       (digital,8.25,'2026-01-01 UTC','2027-01-01 UTC','Ficticia digital',NULL,'ACTIVE');
 CALL pliego.sp_customer_register('extra-reset@example.invalid','fixture-hash','Cliente','Ensayo',NULL,u,c,state);
 CALL pliego.sp_customer_billing_identity_register(u,'EC_CEDULA','1710034065');
 CALL pliego.sp_customer_favorite_add(u,digital);
 INSERT INTO pliego.cliente_guardado_despues(cliente_id,edicion_id,cantidad) VALUES(c,physical,2);
 INSERT INTO pliego.address_create_attempt VALUES(u,gen_random_uuid(),'NOT_CREATED',NULL,NULL);
 INSERT INTO pliego.cliente_identificacion_solicitud_correccion(cliente_id,tipo_actual,numero_actual,
  tipo_propuesto,numero_propuesto,codigo_motivo,estado,clave_idempotencia,huella_payload)
 VALUES(c,'EC_CEDULA','1710034065','EC_CEDULA','0912345675','DOCUMENT_TYPO','PENDING',gen_random_uuid(),repeat('a',64));
 PERFORM pliego.fn_auth_session_create(u,repeat('4',64),clock_timestamp()+INTERVAL '30 days');
 PERFORM pliego.fn_email_action_enqueue(u,'RESET_PASSWORD',repeat('5',64),repeat('C',43));
 PERFORM * FROM pliego.fn_customer_email_change_request(u,'extra-pending@example.invalid',repeat('6',64),repeat('D',43),repeat('7',64),repeat('E',43));
 CALL pliego.sp_cart_add_item(u,digital,1,cart_id,item_id,quantity);
 CALL pliego.sp_checkout_billed_quoted(u,gen_random_uuid(),NULL,'TRANSFER','APPROVED',NULL,'DIGITAL_ONLY',NULL,NULL,
  'EC_CEDULA','1710034065','Cliente Ensayo','Calle fiscal',NULL,'Quito','Pichincha','EC',NULL,o,os,ps,amount,reference,invoice);
 INSERT INTO pliego.factura_emision_electronica(factura_id,proveedor,estado,referencia_externa,fecha_presentacion)
 VALUES(invoice,'FICTIONAL-NO-SRI','SUBMITTED','fictional-reset',clock_timestamp());
 -- Finish queued V087 bytes first; model R2 metadata only on this new invoice.
 FOR job IN SELECT * FROM pliego.factura_archivo_trabajo WHERE estado='PENDING' ORDER BY factura_id,tipo LOOP
  UPDATE pliego.factura_archivo_trabajo SET estado='PROCESSING',propietario=gen_random_uuid(),
   lease_until=clock_timestamp()+INTERVAL '1 minute',intentos=intentos+1
   WHERE factura_id=job.factura_id AND tipo=job.tipo RETURNING * INTO job;
  bytes:=convert_to('fictional-'||job.tipo,'UTF8'); checksum:=encode(sha256(bytes),'hex');
  IF job.factura_id=invoice THEN
   PERFORM pliego.fn_invoice_artifact_complete_stored(job.factura_id,job.tipo,job.propietario,'R2',
    'invoices/'||job.factura_id||'/'||checksum||'.'||lower(job.tipo),checksum,octet_length(bytes)::bigint,
    CASE job.tipo WHEN 'PDF' THEN 'application/pdf' ELSE 'application/xml' END,NULL);
  ELSE
   PERFORM pliego.fn_invoice_artifact_complete(job.factura_id,job.tipo,job.propietario,bytes);
  END IF;
 END LOOP;
 CALL pliego.sp_cart_add_item(u,audio,1,cart_id,item_id,quantity);
 CALL pliego.sp_checkout_billed_quoted(u,gen_random_uuid(),NULL,'TRANSFER','APPROVED',NULL,'DIGITAL_ONLY',NULL,NULL,
  'EC_CEDULA','1710034065','Cliente Ensayo','Calle fiscal',NULL,'Quito','Pichincha','EC',NULL,cancelled,os,ps,amount,reference,invoice);
 CALL pliego.sp_order_cancel(u,cancelled,o,previous,os,ps,restored);
 -- The second invoice retains its original document after credit/refund. Model
 -- historical DATABASE artifacts alongside the first invoice's R2 metadata.
 FOR job IN SELECT * FROM pliego.factura_archivo_trabajo WHERE estado='PENDING' ORDER BY factura_id,tipo LOOP
  UPDATE pliego.factura_archivo_trabajo SET estado='PROCESSING',propietario=gen_random_uuid(),
   lease_until=clock_timestamp()+INTERVAL '1 minute',intentos=intentos+1
   WHERE factura_id=job.factura_id AND tipo=job.tipo RETURNING * INTO job;
  bytes:=convert_to(CASE job.tipo WHEN 'PDF' THEN E'%PDF-1.4\n% fictional reset fixture\n'
                     ELSE '<?xml version="1.0"?><fictional-reset/>' END,'UTF8');
  IF NOT pliego.fn_invoice_artifact_complete(job.factura_id,job.tipo,job.propietario,bytes) THEN
   RAISE EXCEPTION 'Fictional DATABASE artifact completion failed'; END IF;
 END LOOP;
 CALL pliego.sp_cart_add_item(u,physical,1,cart_id,item_id,quantity);
 -- Retained ADMIN security state and unknown provider deduplication controls.
 PERFORM pliego.fn_auth_session_create(a,repeat('8',64),clock_timestamp()+INTERVAL '30 days');
 PERFORM pliego.fn_email_action_enqueue(a,'RESET_PASSWORD',repeat('9',64),repeat('F',43));
 PERFORM pliego.fn_email_rate_limit('IP:shared-fictional-network',20);
 PERFORM pliego.fn_email_rate_limit(('USER:'||a)::varchar,5);
 PERFORM pliego.fn_email_rate_limit(('USER:'||u)::varchar,5);
 PERFORM pliego.fn_email_rate_limit(('EMAIL:'||encode(sha256(convert_to('extra-reset@example.invalid','UTF8')),'hex'))::varchar,5);
 -- A historical customer snapshot may share an address now belonging to ADMIN.
 -- Delete that customer's mail, retaining the ADMIN recipient's delivery state.
 UPDATE pliego.correo_outbox SET destinatario=(SELECT email_normalizado FROM pliego.usuario WHERE usuario_id=a)
 WHERE usuario_id=u AND tipo='RESET_PASSWORD';
 INSERT INTO pliego.correo_destinatario_entrega(destinatario,motivo,desde,ocurrido_en,prioridad,evento_id)
 SELECT email_normalizado,NULL,NULL,clock_timestamp(),1,'reset-admin-state' FROM pliego.usuario WHERE usuario_id=a;
 INSERT INTO pliego.correo_destinatario_entrega(destinatario,motivo,desde,ocurrido_en,prioridad,evento_id)
 VALUES('extra-reset@example.invalid','HARD_BOUNCE',clock_timestamp(),clock_timestamp(),2,'reset-customer-state'),
       ('unrelated@example.invalid',NULL,NULL,clock_timestamp(),1,'reset-unknown-state');
 UPDATE pliego.correo_outbox SET id_mensaje_proveedor='reset-message-'||correo_id,estado='SENT',fecha_envio=clock_timestamp()
 WHERE usuario_id=u AND tipo='ORDER_CONFIRMED';
 INSERT INTO pliego.correo_evento_proveedor(evento_id,id_mensaje_proveedor,proveedor,estado,ocurrido_en,correo_id,procesado_en)
 SELECT 'reset-linked-'||correo_id,id_mensaje_proveedor,'MAILTRAP','DELIVERED',clock_timestamp(),correo_id,clock_timestamp()
 FROM pliego.correo_outbox WHERE usuario_id=u AND tipo='ORDER_CONFIRMED';
 INSERT INTO pliego.correo_evento_proveedor(evento_id,id_mensaje_proveedor,proveedor,estado,ocurrido_en)
 SELECT 'reset-unprojected-'||correo_id,id_mensaje_proveedor,'MAILTRAP','SOFT_BOUNCE',clock_timestamp()
 FROM pliego.correo_outbox WHERE usuario_id=u AND tipo='ORDER_CONFIRMED';
 PERFORM pliego.fn_mail_event_record('reset-unknown','reset-unknown-message','DELIVERED',NULL,clock_timestamp(),'MAILTRAP');
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
