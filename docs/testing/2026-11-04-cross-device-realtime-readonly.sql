-- Run with an existing authorized production connection; no credentials in commands:
-- psql -X -v ON_ERROR_STOP=1 -v request_id=123 -f docs/testing/2026-11-04-cross-device-realtime-readonly.sql
-- Replace 123 with the affected correction-request ID. IDs/aggregates only; no PII.
-- Run during a fresh reproduction: published hints retain one hour, leases 60s.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

SELECT version::integer AS migration_id, count(*) FILTER (WHERE success) AS successful_rows
FROM public.flyway_schema_history
WHERE version::integer IN (80, 101, 104, 105)
GROUP BY version ORDER BY version::integer;

SELECT count(*) AS correction_hint_triggers,
       count(*) FILTER (WHERE tgenabled IN ('O', 'A')) AS enabled_for_normal_writes,
       count(*) FILTER (WHERE tgfoid = 'pliego.fn_realtime_resource_hint()'::regprocedure)
           AS correct_trigger_function
FROM pg_trigger
WHERE tgrelid = 'pliego.cliente_identificacion_solicitud_correccion'::regclass
  AND tgname = 'trg_realtime_correction' AND NOT tgisinternal;

SELECT r.solicitud_id AS request_id, r.cliente_id AS customer_id,
       c.usuario_id AS customer_user_id, r.decidido_por AS admin_user_id,
       count(*) FILTER (WHERE r.estado = 'APPROVED') AS approved_rows,
       count(*) FILTER (WHERE r.estado = 'REJECTED') AS rejected_rows,
       count(*) FILTER (WHERE r.estado = 'PENDING') AS pending_rows,
       count(*) FILTER (WHERE r.estado = 'WITHDRAWN') AS withdrawn_rows,
       count(*) FILTER (WHERE r.decidido_en < clock_timestamp() - interval '1 hour')
           AS decisions_older_than_retention,
       (SELECT count(*) FROM pliego.cliente_identificacion_solicitud_acuse a
        WHERE a.solicitud_id = r.solicitud_id) AS acknowledgment_count,
       (SELECT count(*) FROM pliego.correo_outbox m
        WHERE m.tipo = 'BILLING_IDENTITY_DECIDED'
          AND m.evento_clave = 'BILLING_IDENTITY_DECIDED:' || r.solicitud_id || ':' || r.estado)
           AS decision_mail_count
FROM pliego.cliente_identificacion_solicitud_correccion r
JOIN pliego.cliente c USING (cliente_id)
WHERE r.solicitud_id = :'request_id'::bigint
GROUP BY r.solicitud_id, r.cliente_id, c.usuario_id, r.decidido_por, r.estado;

-- Every retained event ID, with aggregate classifications instead of payloads.
SELECT e.pending_id, e.event_id, e.user_id AS target_user_id,
       count(*) FILTER (WHERE e.admin_scope AND e.user_id IS NULL) AS admin_hint_count,
       count(*) FILTER (WHERE NOT e.admin_scope AND e.user_id = c.usuario_id) AS customer_hint_count,
       count(*) FILTER (WHERE e.event_name = 'identity.correction.created') AS created_hint_count,
       count(*) FILTER (WHERE e.event_name = 'identity.correction.decided') AS decided_hint_count,
       count(*) FILTER (WHERE e.event_name = 'identity.correction.withdrawn') AS withdrawn_hint_count,
       count(*) FILTER (WHERE e.event_name = 'identity.correction.acknowledged') AS acknowledged_hint_count,
       count(*) FILTER (WHERE e.published_at IS NOT NULL) AS published_hint_count,
       max(extract(epoch FROM e.published_at - e.created_at)) AS publication_delay_seconds
FROM pliego.cliente_identificacion_solicitud_correccion r
JOIN pliego.cliente c USING (cliente_id)
JOIN pliego.realtime_event e ON e.resource_type = 'billingIdentity'
  AND e.resource_id = r.solicitud_id::text
WHERE r.solicitud_id = :'request_id'::bigint
GROUP BY e.pending_id, e.event_id, e.user_id
ORDER BY e.pending_id;

SELECT head AS head_event_id, retained_after AS retained_after_event_id
FROM pliego.realtime_cursor WHERE singleton;

SELECT count(*) FILTER (WHERE event_id IS NULL) AS unpublished_count,
       max(extract(epoch FROM clock_timestamp() - created_at))
           FILTER (WHERE event_id IS NULL) AS oldest_unpublished_seconds,
       min(extract(epoch FROM clock_timestamp() - published_at)) AS latest_publication_age_seconds,
       count(*) FILTER (WHERE published_at < clock_timestamp() - interval '1 hour') AS expired_count
FROM pliego.realtime_event;

WITH target AS (
  SELECT c.usuario_id AS customer_user_id, r.decidido_por AS admin_user_id
  FROM pliego.cliente_identificacion_solicitud_correccion r
  JOIN pliego.cliente c USING (cliente_id)
  WHERE r.solicitud_id = :'request_id'::bigint
), target_users AS (
  SELECT customer_user_id AS user_id FROM target
  UNION SELECT admin_user_id FROM target WHERE admin_user_id IS NOT NULL
)
SELECT u.usuario_id AS user_id,
       count(DISTINCT u.usuario_id) FILTER (WHERE u.estado = 'ACTIVE') AS active_user_count,
       count(DISTINCT u.usuario_id) FILTER (WHERE u.email_verificado_en IS NOT NULL) AS verified_user_count,
       count(rc.connection_id) FILTER (WHERE rc.expires_at > clock_timestamp()) AS active_stream_leases,
       count(rc.connection_id) FILTER (WHERE rc.expires_at > clock_timestamp()
         AND rc.role = u.rol AND u.estado = 'ACTIVE'
         AND (u.rol = 'ADMIN' OR u.email_verificado_en IS NOT NULL)
         AND s.fecha_revocacion IS NULL AND s.fecha_expiracion > clock_timestamp())
           AS authorized_stream_leases,
       min(extract(epoch FROM rc.expires_at - clock_timestamp()))
           FILTER (WHERE rc.expires_at > clock_timestamp()) AS next_expiry_seconds
FROM target_users t JOIN pliego.usuario u ON u.usuario_id = t.user_id
LEFT JOIN pliego.realtime_connection rc ON rc.user_id = u.usuario_id
LEFT JOIN pliego.sesion_autenticacion s ON s.sesion_id = rc.session_id
GROUP BY u.usuario_id ORDER BY u.usuario_id;
COMMIT;
