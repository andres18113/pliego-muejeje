-- V095 / source 53e062a. Maintenance only: stop/drain the backend, all workers
-- and webhook ingress; hold the deployment lock and take a private custom dump.
-- WARNING: V095 cannot guarantee non-reuse of deleted random public references
-- or administrator-supplied legacy document numbers (no durable reservations).
-- See docs/testing/data-reset.md before considering a production COMMIT.
-- Run psql -X -v ON_ERROR_STOP=1 -f this-file.sql. Default is ROLLBACK.
-- Only -v confirm=RESET commits. SQL/psql errors must terminate this connection.
-- No R2 calls, sequence changes, TRUNCATE, cascading deletes, or object drops.
\set ON_ERROR_STOP on
\set ECHO none
\if :{?confirm}
\else
  \set confirm ROLLBACK
\endif
SELECT :'confirm' = 'RESET' AS reset_commit \gset
BEGIN;
SET LOCAL ROLE pliego_owner;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL intervalstyle = 'postgres';
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '10min';
SET LOCAL idle_in_transaction_session_timeout = '15min';
-- Advisory lock complements, and does not replace, the external deployment lock.
SELECT pg_advisory_xact_lock(95001, 1);
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_class c WHERE (c.relnamespace='pliego'::regnamespace
       OR c.oid='public.flyway_schema_history'::regclass)
       AND (c.relrowsecurity OR c.relforcerowsecurity))
    OR EXISTS(SELECT FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
       WHERE c.relnamespace='pliego'::regnamespace OR c.oid='public.flyway_schema_history'::regclass) THEN
  RAISE EXCEPTION 'RLS is outside the reviewed V095 reset contract'; END IF;
 IF current_user <> 'pliego_owner'
    OR (SELECT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
          FROM pg_roles WHERE rolname=current_user) THEN
  RAISE EXCEPTION 'Reset requires the non-login, unprivileged object owner pliego_owner'; END IF;
 IF current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999
    OR (SELECT count(*) FROM public.flyway_schema_history WHERE success AND version IS NOT NULL)<>95
    OR (SELECT max(version::int) FROM public.flyway_schema_history WHERE success)<>95
    OR EXISTS(SELECT FROM public.flyway_schema_history WHERE NOT success) THEN
  RAISE EXCEPTION 'Expected PostgreSQL 18 with exactly V001-V095 successful migrations'; END IF;
 IF EXISTS(SELECT FROM pg_class c WHERE (c.relnamespace='pliego'::regnamespace
       OR c.oid='public.flyway_schema_history'::regclass) AND c.relkind IN('r','p','S','v','m')
       AND c.relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
  RAISE EXCEPTION 'Unexpected application object owner'; END IF;
END $$;
-- Lock every table before deriving targets/fingerprints. No concurrent writer
-- may enter while triggers are disabled. DDL trigger flags are transaction-scoped
-- here (not intrinsically session-local); errors/disconnect restore them on rollback.
-- Write-protected tables (the geographic catalogs keep only SELECT for the owner after the runtime ACL cleanup)
-- cannot take ACCESS EXCLUSIVE: PostgreSQL requires table-level UPDATE/DELETE/TRUNCATE for it. Nobody here can
-- write them, ACCESS SHARE needs only SELECT, and the preserved fingerprints fail closed on any change anyway.
SELECT format('LOCK TABLE %I.%I IN %s MODE',n.nspname,c.relname,
       CASE WHEN has_table_privilege(c.oid,'UPDATE') OR has_table_privilege(c.oid,'DELETE') OR has_table_privilege(c.oid,'TRUNCATE')
            THEN 'ACCESS EXCLUSIVE' ELSE 'ACCESS SHARE' END)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE (n.nspname='pliego' AND c.relkind IN('r','p')) OR c.oid='public.flyway_schema_history'::regclass
 ORDER BY n.nspname,c.relname \gexec
CREATE TEMP TABLE _reset_policy(table_name text PRIMARY KEY, class text, remove_where text, reason text);
INSERT INTO _reset_policy VALUES
 ('academic_document_counter','preserve','false','Academic invoice/credit high-water counters; never reuse document numbers'),
 ('address_create_attempt','conditional','actor_user_id IN (SELECT usuario_id FROM _reset_users)','Customer address idempotency receipts; preserve unrelated ADMIN receipts'),
 ('autor','preserve','false','Catalog or geographic configuration; preserve every column'),
 ('ayuda_articulo','preserve','false','Operational help content'),
 ('ayuda_categoria','preserve','false','Operational help navigation'),
 ('carrito','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('carrito_item','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('categoria','preserve','false','Catalog or geographic configuration; preserve every column'),
 ('checkout_attempt','conditional','actor_user_id IN (SELECT usuario_id FROM _reset_users) OR order_id IS NOT NULL','Customer/order checkout receipts; preserve unrelated ADMIN NOT_CREATED receipts'),
 ('checkout_billing_attempt','conditional','actor_user_id IN (SELECT usuario_id FROM _reset_users) OR (actor_user_id,attempt_key) IN (SELECT actor_user_id,attempt_key FROM _reset_attempts)','Billing command receipts dependent on removed checkouts'),
 ('ciudad','preserve','false','Catalog or geographic configuration; preserve every column'),
 ('ciudad_alias','preserve','false','Catalog or geographic configuration; preserve every column'),
 ('cliente','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('cliente_favorito','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('cliente_guardado_despues','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('cliente_identificacion','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('cliente_identificacion_evento','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('cliente_identificacion_solicitud_correccion','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('correo_cambio','conditional','usuario_id IN (SELECT usuario_id FROM _reset_users)','Customer email-change history; preserve ADMIN history'),
 ('correo_cambio_token','conditional','cambio_id IN (SELECT cambio_id FROM _reset_changes)','Customer purpose credentials; preserve ADMIN credentials'),
 ('correo_destinatario_entrega','conditional','destinatario IN (SELECT email FROM _reset_emails) AND destinatario NOT IN (SELECT email FROM _reset_admin_emails)','Customer current/old/pending recipient state; preserve shared ADMIN and unknown state'),
 ('correo_evento_proveedor','conditional','correo_id IN (SELECT correo_id FROM _reset_mail) OR id_mensaje_proveedor IN (SELECT id_mensaje_proveedor FROM _reset_mail WHERE id_mensaje_proveedor IS NOT NULL)','Correlated customer provider events including unprojected receipts; preserve unknown/admin deduplication'),
 ('correo_limite','conditional','clave IN (SELECT prefix||usuario_id FROM _reset_users CROSS JOIN (VALUES (''USER:''),(''EMAIL_CHANGE:''),(''EMAIL_CHANGE_RESEND:'')) p(prefix)) OR clave IN (SELECT ''EMAIL:''||encode(sha256(convert_to(email,''UTF8'')),''hex'') FROM _reset_emails WHERE email NOT IN (SELECT email FROM _reset_admin_emails))','Customer user/email rate buckets; preserve shared IP/unknown/ADMIN buckets'),
 ('correo_outbox','conditional','correo_id IN (SELECT correo_id FROM _reset_mail)','Customer mail including old recipient snapshots; preserve ADMIN mail'),
 ('correo_token','conditional','usuario_id IN (SELECT usuario_id FROM _reset_users)','Customer verification/reset tokens; preserve ADMIN tokens'),
 ('digital_grant','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('digital_ownership','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('direccion','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('edicion','preserve','false','Pricing, cover URLs and digital metadata in all edition columns'),
 ('edicion_oferta','preserve','false','Original promotion prices, dates and conditions'),
 ('editorial','preserve','false','Catalog or geographic configuration; preserve every column'),
 ('envio','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('envio_historial','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('factura','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('factura_archivo','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('factura_archivo_contenido','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('factura_archivo_trabajo','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('factura_direccion','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('factura_emision_electronica','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('factura_item','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('home_delivery_config','preserve','false','Operational delivery timing configuration'),
 ('inventario','preserve','false','Exact stock and timestamps; no restock or recalculation'),
 ('libro','preserve','false','Catalog or geographic configuration; preserve every column'),
 ('libro_autor','preserve','false','Catalog or geographic configuration; preserve every column'),
 ('libro_categoria','preserve','false','Catalog or geographic configuration; preserve every column'),
 ('movimiento_inventario','conditional','pedido_id IS NOT NULL OR usuario_actor_id IN (SELECT usuario_id FROM _reset_users)','Order/customer ledger rows only; retain manual ADMIN stock provenance without recomputing stock'),
 ('nota_credito','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('pago','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('pedido','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('pedido_direccion','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('pedido_entrega','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('pedido_estado_historial','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('pedido_item','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('pedido_retiro','clear','true','Customer/order dependent transactional rows; all clients must belong to CUSTOMER'),
 ('provincia','preserve','false','Catalog or geographic configuration; preserve every column'),
 ('sesion_autenticacion','conditional','usuario_id IN (SELECT usuario_id FROM _reset_users)','Customer refresh/session history; preserve ADMIN sessions'),
 ('ubicacion_retiro','preserve','false','Operational pickup locations'),
 ('usuario','conditional','rol=''CUSTOMER''','CUSTOMER only; preserve complete ADMIN rows and credentials');
-- PG18 dump/restore distributes varchar-array coercions into element casts.
-- Accept the exact directly migrated and pg_dump/restore V095 definitions only.
CREATE TEMP TABLE _reset_expected_schema AS SELECT md5(string_agg(v,E'\n' ORDER BY v COLLATE "C")) FROM (
 SELECT 'column:'||c.relname||':'||a.attnum||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||a.attidentity::text||':'||COALESCE(pg_get_expr(d.adbin,d.adrelid),'') v
 FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE c.relnamespace='pliego'::regnamespace AND c.relkind IN('r','p')
 UNION ALL SELECT 'constraint:'||c.relname||':'||k.conname||':'||replace(pg_get_constraintdef(k.oid),' NOT VALID','') FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relnamespace='pliego'::regnamespace
 UNION ALL SELECT 'trigger:'||c.relname||':'||pg_get_triggerdef(t.oid)||':'||pg_get_functiondef(t.tgfoid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='pliego'::regnamespace AND NOT t.tgisinternal
 UNION ALL SELECT 'rule:'||tablename||':'||definition FROM pg_rules WHERE schemaname='pliego'
) s;
DO $$ BEGIN IF (SELECT md5 FROM _reset_expected_schema) NOT IN ('9b1fca545b6bc79b6669a41a7b380799','44c8bdb81ea0c173e645e941167c5feb') THEN RAISE EXCEPTION 'V095 constraint/column/trigger/rule definition drift'; END IF;
 IF EXISTS((SELECT relname FROM pg_class WHERE relnamespace='pliego'::regnamespace AND relkind IN('r','p') EXCEPT SELECT table_name FROM _reset_policy)
 UNION ALL (SELECT table_name FROM _reset_policy EXCEPT SELECT relname FROM pg_class WHERE relnamespace='pliego'::regnamespace AND relkind IN('r','p'))) THEN
 RAISE EXCEPTION 'Unclassified or missing table'; END IF;
 IF EXISTS(SELECT FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='pliego'::regnamespace AND t.tgenabled<>'O') THEN
 RAISE EXCEPTION 'All triggers must initially be enabled normally'; END IF;
 IF EXISTS(SELECT FROM pliego.cliente c JOIN pliego.usuario u USING(usuario_id) WHERE u.rol<>'CUSTOMER')
 OR EXISTS(SELECT FROM pliego.usuario WHERE rol NOT IN('ADMIN','CUSTOMER')) THEN
 RAISE EXCEPTION 'Unexpected non-CUSTOMER client or user role'; END IF;
END $$;
CREATE TEMP TABLE _reset_users AS SELECT usuario_id,email_normalizado FROM pliego.usuario WHERE rol='CUSTOMER';
CREATE TEMP TABLE _reset_changes AS SELECT cambio_id FROM pliego.correo_cambio WHERE usuario_id IN (SELECT usuario_id FROM _reset_users);
CREATE TEMP TABLE _reset_mail AS SELECT correo_id,id_mensaje_proveedor FROM pliego.correo_outbox WHERE usuario_id IN (SELECT usuario_id FROM _reset_users);
CREATE TEMP TABLE _reset_attempts AS SELECT actor_user_id,attempt_key FROM pliego.checkout_attempt WHERE actor_user_id IN (SELECT usuario_id FROM _reset_users) OR order_id IS NOT NULL;
CREATE TEMP TABLE _reset_emails AS
 SELECT email_normalizado::text email FROM _reset_users
 UNION SELECT destinatario FROM pliego.correo_outbox WHERE usuario_id IN (SELECT usuario_id FROM _reset_users)
 UNION SELECT email FROM pliego.correo_token WHERE usuario_id IN (SELECT usuario_id FROM _reset_users)
 UNION SELECT email_actual FROM pliego.correo_cambio WHERE usuario_id IN (SELECT usuario_id FROM _reset_users)
 UNION SELECT email_pendiente FROM pliego.correo_cambio WHERE usuario_id IN (SELECT usuario_id FROM _reset_users);
CREATE TEMP TABLE _reset_admin_emails AS
 SELECT email_normalizado::text email FROM pliego.usuario WHERE rol='ADMIN'
 UNION SELECT destinatario FROM pliego.correo_outbox WHERE usuario_id NOT IN (SELECT usuario_id FROM _reset_users)
 UNION SELECT email FROM pliego.correo_token WHERE usuario_id NOT IN (SELECT usuario_id FROM _reset_users)
 UNION SELECT email_actual FROM pliego.correo_cambio WHERE usuario_id NOT IN (SELECT usuario_id FROM _reset_users)
 UNION SELECT email_pendiente FROM pliego.correo_cambio WHERE usuario_id NOT IN (SELECT usuario_id FROM _reset_users);
-- All content columns, including keys, ordered by their complete canonical JSON
-- representation with C collation. Length framing prevents ambiguous concatenation.
CREATE FUNCTION pg_temp._reset_fingerprint(relation regclass, predicate text)
RETURNS TABLE(rows bigint,digest text) LANGUAGE plpgsql AS $$ BEGIN
 RETURN QUERY EXECUTE format('SELECT count(*), md5(COALESCE(string_agg(length(v)::text||'':''||v, '''' ORDER BY v COLLATE "C"),'''')) FROM (SELECT to_jsonb(t)::text v FROM %s t WHERE %s) s',relation,predicate);
END $$;
CREATE TEMP TABLE _reset_counts(table_name text PRIMARY KEY, before_rows bigint, after_rows bigint, targeted bigint);
CREATE TEMP TABLE _reset_preserved(table_name text PRIMARY KEY, rows bigint, digest text);
DO $$ DECLARE r record; n bigint; target bigint; BEGIN
 FOR r IN SELECT * FROM _reset_policy ORDER BY table_name LOOP
  EXECUTE format('SELECT count(*),count(*) FILTER(WHERE %s) FROM pliego.%I',r.remove_where,r.table_name) INTO n,target;
  INSERT INTO _reset_counts VALUES(r.table_name,n,NULL,target);
  INSERT INTO _reset_preserved SELECT r.table_name,f.* FROM pg_temp._reset_fingerprint(format('pliego.%I',r.table_name)::regclass,'('||r.remove_where||') IS NOT TRUE') f;
 END LOOP;
 INSERT INTO _reset_preserved SELECT 'public.flyway_schema_history',f.* FROM pg_temp._reset_fingerprint('public.flyway_schema_history','true') f;
END $$;
CREATE TEMP TABLE _reset_sequences(sequence_name text PRIMARY KEY, value bigint, called boolean);
DO $$ DECLARE r record; v bigint; called boolean; high bigint; BEGIN
 FOR r IN SELECT c.oid,c.relname,s.seqcycle,s.seqincrement,a.attname,tc.relname tab
  FROM pg_class c JOIN pg_sequence s ON s.seqrelid=c.oid
  LEFT JOIN pg_depend d ON d.objid=c.oid AND d.classid='pg_class'::regclass AND d.deptype IN('a','i')
  LEFT JOIN pg_class tc ON tc.oid=d.refobjid
  LEFT JOIN pg_attribute a ON a.attrelid=tc.oid AND a.attnum=d.refobjsubid
  WHERE c.relnamespace='pliego'::regnamespace LOOP
   IF r.seqcycle OR r.seqincrement<>1 THEN RAISE EXCEPTION 'Unexpected cycling/nonunit sequence'; END IF;
   -- pg_sequence_last_value needs only USAGE: REASSIGN OWNED can leave the owner without SELECT on a sequence
   -- (production: one sequence holds only U for its owner). NULL means not yet called; last_value is then its start.
   SELECT COALESCE(pg_sequence_last_value(s.seqrelid),s.seqstart), pg_sequence_last_value(s.seqrelid) IS NOT NULL
     INTO v,called FROM pg_sequence s WHERE s.seqrelid=format('pliego.%I',r.relname)::regclass;
   INSERT INTO _reset_sequences VALUES(r.relname,v,called);
   IF r.attname IS NOT NULL THEN
    EXECUTE format('SELECT COALESCE(max(%I),0) FROM pliego.%I',r.attname,r.tab) INTO high;
    IF (v+CASE WHEN called THEN 1 ELSE 0 END)<=high THEN RAISE EXCEPTION 'Sequence behind retained/deleted IDs: %',r.relname; END IF;
   END IF;
 END LOOP;
 IF (SELECT count(*) FROM pliego.academic_document_counter)<>2 THEN
  RAISE EXCEPTION 'Missing academic document counter'; END IF;
 IF (SELECT last_value FROM pliego.academic_document_counter WHERE document_type='01') <
    (SELECT COALESCE(max(n),0) FROM (
      SELECT secuencial n FROM pliego.factura
      UNION ALL SELECT right(numero_documento,9)::bigint FROM pliego.factura WHERE numero_documento ~ '^999-999-[0-9]{9}$'
    ) numbers) THEN
  RAISE EXCEPTION 'Academic invoice counter behind issued numbers'; END IF;
 IF (SELECT last_value FROM pliego.academic_document_counter WHERE document_type='04') <
    COALESCE((SELECT max(right(numero_documento,9)::bigint) FROM pliego.nota_credito WHERE numero_documento ~ '^999-999-[0-9]{9}$'),0) THEN
  RAISE EXCEPTION 'Academic credit counter behind issued numbers'; END IF;
END $$;
-- Capture structural metadata including ownership, ACLs, defaults, rules and all
-- trigger flags. Compare after re-enabling. No GRANT/REVOKE or ownership changes.
CREATE TEMP TABLE _reset_structure AS
 SELECT md5(string_agg(v,E'\n' ORDER BY v COLLATE "C")) digest FROM (
 SELECT to_jsonb(c)::text v FROM pg_class c WHERE c.relnamespace IN('pliego'::regnamespace,'public'::regnamespace)
 UNION ALL SELECT to_jsonb(t)::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='pliego'::regnamespace
 UNION ALL SELECT to_jsonb(p)::text FROM pg_proc p WHERE p.pronamespace='pliego'::regnamespace
 UNION ALL SELECT to_jsonb(n)::text FROM pg_namespace n WHERE n.nspname IN('pliego','public')
 UNION ALL SELECT to_jsonb(d)::text FROM pg_default_acl d
 UNION ALL SELECT to_jsonb(r)::text FROM pg_roles r
 UNION ALL SELECT to_jsonb(m)::text FROM pg_auth_members m
 UNION ALL SELECT to_jsonb(a)::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace IN('pliego'::regnamespace,'public'::regnamespace)
 UNION ALL SELECT to_jsonb(d)::text FROM pg_database d WHERE d.datname=current_database()
 ) s;
-- Disable ONLY these reviewed DELETE guards; leave every internal FK trigger enabled.
ALTER TABLE pliego.address_create_attempt DISABLE TRIGGER trg_address_attempt_immutable;
ALTER TABLE pliego.checkout_attempt DISABLE TRIGGER trg_checkout_attempt_immutable;
ALTER TABLE pliego.checkout_billing_attempt DISABLE TRIGGER trg_checkout_billing_immutable;
ALTER TABLE pliego.cliente_identificacion_evento DISABLE TRIGGER trg_cliente_identificacion_evento_immutable;
ALTER TABLE pliego.cliente_identificacion_solicitud_correccion DISABLE TRIGGER trg_cliente_identificacion_solicitud_correccion_immutable;
ALTER TABLE pliego.cliente_identificacion DISABLE TRIGGER trg_cliente_identificacion_guard;
ALTER TABLE pliego.digital_grant DISABLE TRIGGER trg_digital_grant_guard;
ALTER TABLE pliego.digital_ownership DISABLE TRIGGER trg_digital_ownership_identity;
ALTER TABLE pliego.envio_historial DISABLE TRIGGER trg_envio_historial_immutable;
ALTER TABLE pliego.factura_archivo_contenido DISABLE TRIGGER trg_invoice_artifact_bytes_immutable;
ALTER TABLE pliego.factura_archivo DISABLE TRIGGER trg_factura_archivo_immutable;
ALTER TABLE pliego.factura_direccion DISABLE TRIGGER trg_factura_direccion_immutable;
ALTER TABLE pliego.factura_item DISABLE TRIGGER trg_factura_item_immutable;
ALTER TABLE pliego.factura DISABLE TRIGGER trg_factura_immutable;
ALTER TABLE pliego.movimiento_inventario DISABLE TRIGGER trg_movimiento_inventario_append_only;
ALTER TABLE pliego.nota_credito DISABLE TRIGGER trg_nota_credito_immutable;
ALTER TABLE pliego.pedido_direccion DISABLE TRIGGER trg_pedido_direccion_append_only;
ALTER TABLE pliego.pedido_estado_historial DISABLE TRIGGER trg_pedido_estado_historial_append_only;
ALTER TABLE pliego.pedido_item DISABLE TRIGGER trg_pedido_item_append_only;
ALTER TABLE pliego.pedido_item DISABLE TRIGGER trg_pedido_item_immutable;
ALTER TABLE pliego.pedido_retiro DISABLE TRIGGER trg_pedido_retiro_snapshot;
-- Explicit FK-safe child-to-parent deletes (no referential action is relied on).
DELETE FROM pliego.address_create_attempt WHERE actor_user_id IN (SELECT usuario_id FROM _reset_users);
DELETE FROM pliego.carrito_item;
DELETE FROM pliego.checkout_billing_attempt WHERE actor_user_id IN (SELECT usuario_id FROM _reset_users) OR (actor_user_id,attempt_key) IN (SELECT actor_user_id,attempt_key FROM _reset_attempts);
DELETE FROM pliego.cliente_favorito;
DELETE FROM pliego.cliente_guardado_despues;
DELETE FROM pliego.cliente_identificacion;
DELETE FROM pliego.cliente_identificacion_evento;
DELETE FROM pliego.cliente_identificacion_solicitud_correccion;
DELETE FROM pliego.correo_cambio_token WHERE cambio_id IN (SELECT cambio_id FROM _reset_changes);
DELETE FROM pliego.correo_destinatario_entrega WHERE destinatario IN (SELECT email FROM _reset_emails) AND destinatario NOT IN (SELECT email FROM _reset_admin_emails);
DELETE FROM pliego.correo_evento_proveedor WHERE correo_id IN (SELECT correo_id FROM _reset_mail) OR id_mensaje_proveedor IN (SELECT id_mensaje_proveedor FROM _reset_mail WHERE id_mensaje_proveedor IS NOT NULL);
DELETE FROM pliego.correo_limite WHERE clave IN (SELECT prefix||usuario_id FROM _reset_users CROSS JOIN (VALUES ('USER:'),('EMAIL_CHANGE:'),('EMAIL_CHANGE_RESEND:')) p(prefix)) OR clave IN (SELECT 'EMAIL:'||encode(sha256(convert_to(email,'UTF8')),'hex') FROM _reset_emails WHERE email NOT IN (SELECT email FROM _reset_admin_emails));
DELETE FROM pliego.correo_token WHERE usuario_id IN (SELECT usuario_id FROM _reset_users);
DELETE FROM pliego.digital_grant;
DELETE FROM pliego.direccion;
DELETE FROM pliego.envio_historial;
DELETE FROM pliego.factura_archivo;
DELETE FROM pliego.factura_archivo_contenido;
DELETE FROM pliego.factura_direccion;
DELETE FROM pliego.factura_emision_electronica;
DELETE FROM pliego.factura_item;
DELETE FROM pliego.movimiento_inventario WHERE pedido_id IS NOT NULL OR usuario_actor_id IN (SELECT usuario_id FROM _reset_users);
DELETE FROM pliego.nota_credito;
DELETE FROM pliego.pago;
DELETE FROM pliego.pedido_direccion;
DELETE FROM pliego.pedido_estado_historial;
DELETE FROM pliego.pedido_retiro;
DELETE FROM pliego.sesion_autenticacion WHERE usuario_id IN (SELECT usuario_id FROM _reset_users);
DELETE FROM pliego.carrito;
DELETE FROM pliego.checkout_attempt WHERE actor_user_id IN (SELECT usuario_id FROM _reset_users) OR order_id IS NOT NULL;
DELETE FROM pliego.correo_cambio WHERE usuario_id IN (SELECT usuario_id FROM _reset_users);
DELETE FROM pliego.correo_outbox WHERE correo_id IN (SELECT correo_id FROM _reset_mail);
DELETE FROM pliego.digital_ownership;
DELETE FROM pliego.envio;
DELETE FROM pliego.factura_archivo_trabajo;
DELETE FROM pliego.pedido_item;
DELETE FROM pliego.factura;
DELETE FROM pliego.pedido_entrega;
DELETE FROM pliego.pedido;
DELETE FROM pliego.cliente;
DELETE FROM pliego.usuario WHERE rol='CUSTOMER';
ALTER TABLE pliego.address_create_attempt ENABLE TRIGGER trg_address_attempt_immutable;
ALTER TABLE pliego.checkout_attempt ENABLE TRIGGER trg_checkout_attempt_immutable;
ALTER TABLE pliego.checkout_billing_attempt ENABLE TRIGGER trg_checkout_billing_immutable;
ALTER TABLE pliego.cliente_identificacion_evento ENABLE TRIGGER trg_cliente_identificacion_evento_immutable;
ALTER TABLE pliego.cliente_identificacion_solicitud_correccion ENABLE TRIGGER trg_cliente_identificacion_solicitud_correccion_immutable;
ALTER TABLE pliego.cliente_identificacion ENABLE TRIGGER trg_cliente_identificacion_guard;
ALTER TABLE pliego.digital_grant ENABLE TRIGGER trg_digital_grant_guard;
ALTER TABLE pliego.digital_ownership ENABLE TRIGGER trg_digital_ownership_identity;
ALTER TABLE pliego.envio_historial ENABLE TRIGGER trg_envio_historial_immutable;
ALTER TABLE pliego.factura_archivo_contenido ENABLE TRIGGER trg_invoice_artifact_bytes_immutable;
ALTER TABLE pliego.factura_archivo ENABLE TRIGGER trg_factura_archivo_immutable;
ALTER TABLE pliego.factura_direccion ENABLE TRIGGER trg_factura_direccion_immutable;
ALTER TABLE pliego.factura_item ENABLE TRIGGER trg_factura_item_immutable;
ALTER TABLE pliego.factura ENABLE TRIGGER trg_factura_immutable;
ALTER TABLE pliego.movimiento_inventario ENABLE TRIGGER trg_movimiento_inventario_append_only;
ALTER TABLE pliego.nota_credito ENABLE TRIGGER trg_nota_credito_immutable;
ALTER TABLE pliego.pedido_direccion ENABLE TRIGGER trg_pedido_direccion_append_only;
ALTER TABLE pliego.pedido_estado_historial ENABLE TRIGGER trg_pedido_estado_historial_append_only;
ALTER TABLE pliego.pedido_item ENABLE TRIGGER trg_pedido_item_append_only;
ALTER TABLE pliego.pedido_item ENABLE TRIGGER trg_pedido_item_immutable;
ALTER TABLE pliego.pedido_retiro ENABLE TRIGGER trg_pedido_retiro_snapshot;
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE r record; f record; n bigint; v bigint; called boolean; BEGIN
 FOR r IN SELECT * FROM _reset_policy ORDER BY table_name LOOP
  EXECUTE format('SELECT count(*) FROM pliego.%I',r.table_name) INTO n;
  UPDATE _reset_counts SET after_rows=n WHERE table_name=r.table_name;
  IF EXISTS(SELECT FROM _reset_counts WHERE table_name=r.table_name AND before_rows-after_rows<>targeted) THEN
   RAISE EXCEPTION 'Unexpected delete count: %',r.table_name; END IF;
  SELECT * INTO f FROM pg_temp._reset_fingerprint(format('pliego.%I',r.table_name)::regclass,'('||r.remove_where||') IS NOT TRUE');
  IF NOT EXISTS(SELECT FROM _reset_preserved p WHERE p.table_name=r.table_name AND p.rows=f.rows AND p.digest=f.digest) THEN
   RAISE EXCEPTION 'Preserved content changed: %',r.table_name; END IF;
  EXECUTE format('SELECT count(*) FROM pliego.%I WHERE %s',r.table_name,r.remove_where) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'Target rows remain: %',r.table_name; END IF;
 END LOOP;
 SELECT * INTO f FROM pg_temp._reset_fingerprint('public.flyway_schema_history','true');
 IF NOT EXISTS(SELECT FROM _reset_preserved WHERE table_name='public.flyway_schema_history' AND rows=f.rows AND digest=f.digest) THEN RAISE EXCEPTION 'Flyway history changed'; END IF;
 FOR r IN SELECT * FROM _reset_sequences LOOP
  SELECT COALESCE(pg_sequence_last_value(s.seqrelid),s.seqstart), pg_sequence_last_value(s.seqrelid) IS NOT NULL
    INTO v,called FROM pg_sequence s WHERE s.seqrelid=format('pliego.%I',r.sequence_name)::regclass;
  IF v<>r.value OR called<>r.called THEN RAISE EXCEPTION 'Sequence changed: %',r.sequence_name; END IF;
 END LOOP;
 IF EXISTS(SELECT FROM pliego.usuario WHERE rol='CUSTOMER') OR EXISTS(SELECT FROM pliego.cliente) THEN RAISE EXCEPTION 'Customers remain'; END IF;
END $$;
CREATE TEMP TABLE _reset_structure_after AS
SELECT md5(string_agg(v,E'\n' ORDER BY v COLLATE "C")) digest FROM (
 SELECT to_jsonb(c)::text v FROM pg_class c WHERE c.relnamespace IN('pliego'::regnamespace,'public'::regnamespace)
 UNION ALL SELECT to_jsonb(t)::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='pliego'::regnamespace
 UNION ALL SELECT to_jsonb(p)::text FROM pg_proc p WHERE p.pronamespace='pliego'::regnamespace
 UNION ALL SELECT to_jsonb(n)::text FROM pg_namespace n WHERE n.nspname IN('pliego','public')
 UNION ALL SELECT to_jsonb(d)::text FROM pg_default_acl d
 UNION ALL SELECT to_jsonb(r)::text FROM pg_roles r
 UNION ALL SELECT to_jsonb(m)::text FROM pg_auth_members m
 UNION ALL SELECT to_jsonb(a)::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace IN('pliego'::regnamespace,'public'::regnamespace)
 UNION ALL SELECT to_jsonb(d)::text FROM pg_database d WHERE d.datname=current_database()
 ) s;
DO $$ BEGIN
 IF (SELECT digest FROM _reset_structure) IS DISTINCT FROM (SELECT digest FROM _reset_structure_after) THEN
  RAISE EXCEPTION 'Ownership/ACL/role/trigger/structure changed'; END IF;
END $$;
SELECT c.table_name,p.class,c.before_rows,c.after_rows,c.before_rows-c.after_rows AS deleted
 FROM _reset_counts c JOIN _reset_policy p USING(table_name) ORDER BY c.table_name;
SELECT count(*) AS preserved_fingerprints_verified FROM _reset_preserved;
SELECT count(*) AS unchanged_sequences_verified FROM _reset_sequences;
\if :reset_commit
 COMMIT;
 \echo 'RESET committed. Counts above describe committed rows.'
\else
 ROLLBACK;
 \echo 'Dry run rolled back. Counts above are proposed changes only.'
\endif
