-- Operator-attended isolated restore ONLY. Read-only aggregate booleans, no customer rows.
BEGIN READ ONLY;
SELECT json_build_object(
 'database_owner', (SELECT pg_get_userbyid(datdba)='pliego_owner' FROM pg_database WHERE datname=current_database()),
 'schema_owners', (SELECT count(*)=2 AND bool_and(pg_get_userbyid(nspowner)='pliego_owner') FROM pg_namespace WHERE nspname IN ('public','pliego')),
 'relation_owners', NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('pliego','public') AND pg_get_userbyid(c.relowner)<>'pliego_owner'),
 'routine_owners', NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pliego' AND pg_get_userbyid(p.proowner)<>'pliego_owner'),
 'runtime_flags', (SELECT NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolcanlogin FROM pg_roles WHERE rolname='pliego_app'),
 'runtime_not_owner_member', NOT pg_has_role('pliego_app','pliego_owner','MEMBER'),
 'runtime_no_create', NOT(has_schema_privilege('pliego_app','public','CREATE') OR has_schema_privilege('pliego_app','pliego','CREATE') OR has_database_privilege('pliego_app',current_database(),'CREATE')),
 'runtime_no_owned_relations', NOT EXISTS(SELECT FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='pliego_app')),
 'geo_select_no_write', (SELECT bool_and(has_table_privilege('pliego_app',r,'SELECT') AND NOT(has_table_privilege('pliego_app',r,'INSERT') OR has_table_privilege('pliego_app',r,'UPDATE') OR has_table_privilege('pliego_app',r,'DELETE') OR has_table_privilege('pliego_app',r,'TRUNCATE'))) FROM unnest(ARRAY['pliego.provincia'::regclass,'pliego.ciudad'::regclass,'pliego.ciudad_alias'::regclass]) r),
 'geo_no_column_writes', NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid IN ('pliego.provincia'::regclass,'pliego.ciudad'::regclass,'pliego.ciudad_alias'::regclass) AND a.attnum>0 AND NOT a.attisdropped AND (has_column_privilege('pliego_app',a.attrelid,a.attnum,'INSERT') OR has_column_privilege('pliego_app',a.attrelid,a.attnum,'UPDATE') OR has_column_privilege('pliego_app',a.attrelid,a.attnum,'REFERENCES'))),
 'owner_city_id_update', has_column_privilege('pliego_owner','pliego.ciudad','ciudad_id','UPDATE') AND NOT has_table_privilege('pliego_owner','pliego.ciudad','UPDATE') AND EXISTS(SELECT FROM pg_attribute a CROSS JOIN LATERAL aclexplode(coalesce(a.attacl,'{}'::aclitem[])) acl WHERE a.attrelid='pliego.ciudad'::regclass AND a.attname='ciudad_id' AND acl.grantee=(SELECT oid FROM pg_roles WHERE rolname='pliego_owner') AND acl.privilege_type='UPDATE'),
 'address_grants', has_table_privilege('pliego_app','pliego.direccion','SELECT,INSERT,UPDATE,DELETE'),
 'only_approved_not_valid_constraints', NOT EXISTS(SELECT FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('pliego','public') AND NOT c.convalidated AND (c.conrelid::regclass::text,c.conname::text) NOT IN (('pliego.factura','ck_factura_identity_new'),('pliego.cliente_identificacion','ck_cliente_identificacion_numero'),('pliego.cliente_identificacion_evento','ck_cliente_identificacion_evento_nuevo'),('pliego.cliente_identificacion_evento','ck_cliente_identificacion_evento_tipo_anterior_presente'))),
 'stock_nonnegative', NOT EXISTS(SELECT FROM pliego.inventario WHERE stock_actual<0),
 'invoice_totals', NOT EXISTS(SELECT FROM pliego.factura WHERE total<>subtotal+impuesto_total OR subtotal<=0 OR impuesto_total<0),
 'invoice_lines', NOT EXISTS(SELECT FROM pliego.factura_item WHERE cantidad<=0 OR subtotal<>precio_unitario*cantidad OR total<>subtotal+impuesto_monto),
 'invoice_bytes_sha256', NOT EXISTS(SELECT FROM pliego.factura_archivo_contenido WHERE checksum<>encode(sha256(contenido),'hex'))
);
ROLLBACK;
