-- PLIEGO release preflight for V101–V105 (docs/deployment/2026-11-03-release-candidate-v101-v105.md).
-- READ ONLY: one read-only transaction that always rolls back; aggregates only, no identities, hashes or bodies.
-- Run as root in the deployment session: runuser -u postgres -- psql -X -d pliego -f - < release-preflight-v101-v105.sql
\set ON_ERROR_STOP on
\pset pager off
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';

\echo '== server / flyway'
SHOW server_version;
SHOW max_connections;
SELECT max(version::int) AS flyway_max, count(*) FILTER (WHERE success) AS ok, count(*) FILTER (WHERE NOT success) AS failed
FROM public.flyway_schema_history WHERE version IS NOT NULL;

\echo '== V103 target tables and every table V101/V104 alters or adds triggers to'
SELECT c.relname, s.n_live_tup, s.n_dead_tup,
       pg_size_pretty(pg_relation_size(c.oid)) AS heap, pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       s.n_tup_ins + s.n_tup_upd + s.n_tup_del AS writes_since_stats_reset, s.last_autovacuum, s.last_autoanalyze
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = 'pliego' AND c.relkind = 'r' AND c.relname IN (
  'digital_ownership','sesion_autenticacion','digital_grant','pedido','pago','envio','pedido_retiro','correo_outbox',
  'cliente_identificacion_solicitud_correccion','usuario','cliente','ayuda_articulo')
ORDER BY pg_total_relation_size(c.oid) DESC;

\echo '== existing indexes on the two V103 tables (expect no index led by edicion_id / usuario_id alone)'
SELECT t.relname AS table_name, i.relname AS index_name, pg_get_indexdef(i.oid) AS def
FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'pliego' AND t.relname IN ('digital_ownership','sesion_autenticacion');

\echo '== names V101–V105 create must not exist yet'
SELECT count(*) FILTER (WHERE c.relname IN ('ix_digital_ownership_edicion','ix_sesion_autenticacion_usuario','realtime_event','realtime_cursor','realtime_connection','cliente_identificacion_solicitud_acuse')) AS conflicting_relations
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'pliego';
SELECT count(*) AS conflicting_triggers FROM pg_trigger WHERE tgname LIKE 'trg_realtime_%';

\echo '== lock / activity risk right now (no query text)'
SELECT datname, usename, application_name, state, wait_event_type,
       now() - xact_start AS xact_age, now() - state_change AS in_state
FROM pg_stat_activity WHERE datname = 'pliego' AND pid <> pg_backend_pid() ORDER BY xact_start NULLS LAST;
SELECT count(*) AS ungranted_locks FROM pg_locks WHERE NOT granted;
SELECT count(*) AS prepared_xacts FROM pg_prepared_xacts;

\echo '== data V101 and V105 depend on (aggregates)'
SELECT estado, count(*), count(*) FILTER (WHERE decidido_en > now() - interval '30 days') AS decided_last_30d
FROM pliego.cliente_identificacion_solicitud_correccion GROUP BY estado ORDER BY estado;
SELECT state, count(*) FROM pliego.digital_grant GROUP BY state ORDER BY state;
SELECT count(*) AS owned_identities,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM pliego.digital_grant g WHERE g.owned_item_id = o.owned_item_id AND g.state = 'ACTIVE')) AS leave_library_after_v101
FROM pliego.digital_ownership o;
SELECT slug, estado,
       position('El eBook sale de Mi biblioteca. Mira cuándo puedes cancelar' IN cuerpo) > 0 AS ebook_sentence,
       position('El audiolibro sale de Mi biblioteca. Mira cuándo puedes cancelar' IN cuerpo) > 0 AS audio_sentence,
       position('Te respondemos en un plazo de 15 días. Mientras tanto, tu solicitud aparece como En revisión.' IN cuerpo) > 0 AS cedula_sentence
FROM pliego.ayuda_articulo WHERE slug IN ('ebooks','audiolibros','cedula-o-ruc') ORDER BY slug;

\echo '== runtime role must stay without CREATE/ownership'
SELECT has_schema_privilege('pliego_app','pliego','CREATE') AS app_schema_create,
       has_database_privilege('pliego_app','pliego','CREATE') AS app_db_create,
       pg_has_role('pliego_app','pliego_owner','MEMBER') AS app_is_owner_member;
ROLLBACK;
