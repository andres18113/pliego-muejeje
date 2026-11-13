-- Optional ADDITIVE fixture expansion after the original 160-customer benchmark.
-- Never run during timed load; retain the original fixtures.json and results.
-- Each new customer commits separately. A partial failed expansion is retained;
-- do not continue benchmarks or resume it in the same cluster.
-- Example (same resident namespace as the disposable cluster):
-- PLIEGO_TEST_DISPOSABLE_DB=1 psql -X -qAt -v ON_ERROR_STOP=1 \
--   -h 127.0.0.1 -p 55464 -U postgres -d pliego_benchmark \
--   -v target_customers=600 -f perf/k6/extend-customers.sql \
--   > .release-evidence/2026-11-04-vps-audit/postgres/fixtures-extended.json
-- SQL stdout is one k6-compatible JSON object; errors go to stderr.
\set ON_ERROR_STOP on
\getenv fixture_opt_in PLIEGO_TEST_DISPOSABLE_DB
\if :{?fixture_opt_in}
\else
  \warn 'PLIEGO_TEST_DISPOSABLE_DB=1 is required'
  SELECT 1/0 AS refusing_missing_disposable_opt_in;
\endif
\if :{?target_customers}
\else
  \set target_customers 600
\endif
\if :{?benchmark_port}
\else
  \set benchmark_port 55464
\endif
SET pliego.fixture_port = :'benchmark_port';
SET pliego.fixture_opt_in = :'fixture_opt_in';
SET pliego.fixture_target = :'target_customers';
DO $fixture$
DECLARE
 target_count integer; existing_count integer; max_suffix integer;
 i integer; email varchar; user_id bigint; customer_id bigint; state varchar; address_id bigint;
 fixture_hash varchar := '$2b$12$9uJQWhxbzpU0x/jebYy0x.c6lfLCNwtDWzYc6z4EpgE09ORsJU0nq';
BEGIN
 IF current_setting('pliego.fixture_opt_in') IS DISTINCT FROM '1'
    OR current_database() IS DISTINCT FROM 'pliego_benchmark'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('pliego.fixture_port') NOT IN ('55464','55465','55466','55467','55468')
    OR current_setting('port') IS DISTINCT FROM current_setting('pliego.fixture_port')
    OR current_setting('server_version_num')::integer NOT BETWEEN 180000 AND 189999
 THEN RAISE EXCEPTION 'Refusing expansion outside explicitly selected disposable PG18 localhost benchmark'; END IF;
 IF current_setting('pliego.fixture_target') !~ '^[0-9]{3,4}$' THEN
  RAISE EXCEPTION 'Invalid synthetic customer target';
 END IF;
 target_count:=current_setting('pliego.fixture_target')::integer;
 IF target_count NOT BETWEEN 160 AND 1024 THEN
  RAISE EXCEPTION 'Target must be 160 through 1024 synthetic customers';
 END IF;
 IF (SELECT count(*) FROM public.flyway_schema_history WHERE success)<>106
    OR (SELECT max(version::integer) FROM public.flyway_schema_history WHERE success)<>106
    OR EXISTS(SELECT FROM public.flyway_schema_history WHERE NOT success)
 THEN RAISE EXCEPTION 'Refusing unexpected migration state'; END IF;
 IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='pliego.usuario'::regclass))<>'pliego_owner'
    OR pg_has_role('pliego_app','pliego_owner','MEMBER')
    OR has_schema_privilege('pliego_app','pliego','CREATE')
    OR (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
         FROM pg_roles WHERE rolname='pliego_app') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'Complete canonical runtime privilege cleanup before fixture expansion'; END IF;
 IF (SELECT count(*) FROM pliego.libro)<>425 OR (SELECT count(*) FROM pliego.edicion)<>424
    OR (SELECT count(*) FROM pliego.autor)<>545 OR (SELECT count(*) FROM pliego.libro_autor)<>577
    OR (SELECT count(*) FROM pliego.editorial)<>172 OR (SELECT count(*) FROM pliego.inventario)<>175
    OR (SELECT count(*) FROM pliego.edicion_oferta)<>44
 THEN RAISE EXCEPTION 'Refusing unexpected benchmark catalog'; END IF;
 IF (SELECT count(*) FROM pliego.usuario WHERE rol='ADMIN')<>1
    OR EXISTS(SELECT FROM pliego.usuario WHERE rol='ADMIN'
                AND (email_normalizado<>'perf-admin@example.invalid' OR password_hash<>'unused-synthetic-admin'))
    OR EXISTS(SELECT FROM pliego.usuario u WHERE u.rol='CUSTOMER'
                AND (u.email_normalizado !~ '^perf-customer-[0-9]{3,4}@example[.]invalid$'
                     OR u.password_hash IS DISTINCT FROM fixture_hash OR u.email_verificado_en IS NULL))
 THEN RAISE EXCEPTION 'Refusing identities outside the known synthetic fixture'; END IF;
 SELECT count(*),max(substring(email_normalizado FROM '^perf-customer-([0-9]+)@')::integer)
 INTO existing_count,max_suffix FROM pliego.usuario WHERE rol='CUSTOMER';
 IF existing_count<160 OR existing_count<>max_suffix
    OR EXISTS(SELECT FROM pliego.usuario WHERE rol='CUSTOMER'
                AND substring(email_normalizado FROM '^perf-customer-([0-9]+)@')::integer<1)
    OR EXISTS(SELECT FROM pliego.cliente c JOIN pliego.usuario u USING(usuario_id)
                WHERE u.rol<>'CUSTOMER' OR c.nombres<>'Cliente Sintético' OR c.apellidos<>'Prueba Local')
    OR (SELECT count(*) FROM pliego.cliente)<>existing_count
 THEN RAISE EXCEPTION 'Refusing incomplete or unexpected original synthetic customer sequence'; END IF;
 IF target_count<existing_count THEN RAISE EXCEPTION 'Expansion cannot remove existing customers'; END IF;
 FOR i IN (existing_count+1)..target_count LOOP
  email:=('perf-customer-'||lpad(i::text,greatest(3,char_length(i::text)),'0')||'@example.invalid')::varchar;
  CALL pliego.sp_customer_register(email,fixture_hash,'Cliente Sintético','Prueba Local','+593999999999',
   user_id,customer_id,state);
  -- Fixture-only synthetic verification: no real token, mailbox, or delivery.
  UPDATE pliego.usuario SET email_verificado_en=statement_timestamp() WHERE usuario_id=user_id;
  CALL pliego.sp_address_create(user_id,'Casa','Cliente Sintético','Calle Local 1',NULL,
   'Quito','Pichincha','EC',NULL,NULL,'+593999999999',true,address_id);
  COMMIT;
 END LOOP;
END $fixture$;
ANALYZE pliego.usuario;
ANALYZE pliego.cliente;
ANALYZE pliego.direccion;
SELECT jsonb_build_object(
 'customers',(SELECT jsonb_agg(jsonb_build_object('id',u.usuario_id::text,'email',u.email_normalizado,
    'addressId',d.direccion_id::text) ORDER BY u.usuario_id)
     FROM pliego.usuario u JOIN pliego.cliente c USING(usuario_id)
     JOIN pliego.direccion d USING(cliente_id) WHERE u.rol='CUSTOMER'),
 'physicalEditions',(SELECT jsonb_agg(edicion_id::text ORDER BY edicion_id) FROM pliego.inventario),
 'editions',(SELECT jsonb_agg(edicion_id::text ORDER BY edicion_id) FROM pliego.edicion),
 'password','PerfLocal2026!');
