-- Read-only, counts only. No customer values, credentials, document numbers,
-- recipient hashes, provider IDs, tokens, snapshots or invoice bytes are printed.
\set ON_ERROR_STOP on
\set ECHO none
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
SELECT format('SELECT %L AS table_name, count(*) AS rows FROM %I.%I',
              c.relname,n.nspname,c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE (n.nspname='pliego' AND c.relkind IN('r','p'))
    OR c.oid='public.flyway_schema_history'::regclass
 ORDER BY n.nspname,c.relname \gexec
SELECT count(*) FILTER(WHERE rol='ADMIN') AS admin_users,
       count(*) FILTER(WHERE rol='CUSTOMER') AS customer_users FROM pliego.usuario;
SELECT count(*) FILTER(WHERE storage_kind='R2') AS r2_artifacts,
       count(*) FILTER(WHERE storage_kind IS NULL OR storage_kind='DATABASE') AS database_artifacts
 FROM pliego.factura_archivo;
SELECT count(*) AS foreign_keys FROM pg_constraint WHERE connamespace='pliego'::regnamespace AND contype='f';
SELECT count(*) AS user_triggers, count(*) FILTER(WHERE t.tgenabled<>'O') AS nonstandard_trigger_flags,
       count(*) FILTER(WHERE (t.tgtype::int & 8)>0) AS delete_guards
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='pliego'::regnamespace AND NOT t.tgisinternal;
SELECT count(*) AS rules FROM pg_rules WHERE schemaname='pliego';
SELECT count(*) AS tables_with_rls FROM pg_class WHERE relnamespace='pliego'::regnamespace AND (relrowsecurity OR relforcerowsecurity);
SELECT count(*) AS rls_policies FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='pliego'::regnamespace;
SELECT count(*) AS unvalidated_constraints FROM pg_constraint WHERE connamespace='pliego'::regnamespace AND NOT convalidated;
SELECT count(*) AS pliego_sequences FROM pg_sequences WHERE schemaname='pliego';
SELECT count(*) AS unresolved_provider_events FROM pliego.correo_evento_proveedor WHERE correo_id IS NULL;
COMMIT;
