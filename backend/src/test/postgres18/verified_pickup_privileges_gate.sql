-- Disposable PostgreSQL only, after the production-style ACL cleanup.
\set ON_ERROR_STOP on
SELECT count(*)=2 AS strict_pickup_roles_present FROM pg_roles
 WHERE rolname IN('pliego_app','pliego_owner') \gset
\if :strict_pickup_roles_present
SET ROLE pliego_app;
DO $gate$
DECLARE routine REGPROCEDURE;
BEGIN
 IF current_user<>'pliego_app' OR pg_has_role('pliego_app','pliego_owner','MEMBER') THEN
  RAISE EXCEPTION 'pickup ACL gate requires restricted runtime role after owner membership removal'; END IF;
 FOREACH routine IN ARRAY ARRAY[
  -- AC-7.1: all V091 entry points keep explicit runtime grants after cleanup.
  'pliego.fn_admin_pickup_handover_view(bigint,bigint)'::REGPROCEDURE,
  'pliego.fn_admin_pickup_handover_detail(bigint,bigint)'::REGPROCEDURE,
  'pliego.fn_admin_pickup_verify_code(bigint,bigint,character varying)'::REGPROCEDURE,
  'pliego.sp_admin_order_cancel(bigint,bigint)'::REGPROCEDURE,
  'pliego.fn_admin_pickup_view(bigint,bigint)'::REGPROCEDURE,
  'pliego.fn_admin_pickup_detail(bigint,bigint)'::REGPROCEDURE,
  'pliego.fn_admin_pickup_lookup(bigint,character varying)'::REGPROCEDURE,
  'pliego.fn_admin_pickups(bigint,character varying,character varying,integer,integer)'::REGPROCEDURE,
  'pliego.sp_pickup_collect(bigint,bigint,character varying,boolean)'::REGPROCEDURE
 ] LOOP
  IF NOT has_function_privilege('pliego_app',routine,'EXECUTE') THEN
   RAISE EXCEPTION 'runtime pickup execute missing: %',routine; END IF;
  IF EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
   WHERE p.oid=routine AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
   RAISE EXCEPTION 'pickup routine still executable by PUBLIC: %',routine; END IF;
 END LOOP;
 FOREACH routine IN ARRAY ARRAY[
  'pliego.fn_order_reference(bigint)'::REGPROCEDURE,
  'pliego.fn_customer_orders(bigint,integer,integer)'::REGPROCEDURE,
  'pliego.fn_customer_order_detail_priced(bigint,bigint)'::REGPROCEDURE,
  'pliego.fn_admin_order_detail_priced(bigint,bigint)'::REGPROCEDURE,
  'pliego.fn_checkout_resolve(bigint,uuid)'::REGPROCEDURE,
  'pliego.fn_admin_orders(bigint,character varying,timestamp with time zone,timestamp with time zone,bigint,integer,integer,character varying)'::REGPROCEDURE,
  'pliego.fn_admin_billing_identity_correction_requests(bigint,character varying,integer,integer)'::REGPROCEDURE
 ] LOOP
  IF NOT has_function_privilege('pliego_app',routine,'EXECUTE') THEN
   RAISE EXCEPTION 'runtime reference/correction execute missing: %',routine; END IF;
 END LOOP;
 IF to_regprocedure('pliego.sp_pickup_collect(bigint,bigint,character varying)') IS NOT NULL THEN
  RAISE EXCEPTION 'unverified collection routine remains callable'; END IF;
END $gate$;
-- Execute the complete fixture and command/read assertions as the restricted role.
\ir verified_pickup_gate.sql
RESET ROLE;
\else
\echo 'Pickup ACL gate requires production-style roles; behavior is covered by verified_pickup_gate.sql'
\endif
