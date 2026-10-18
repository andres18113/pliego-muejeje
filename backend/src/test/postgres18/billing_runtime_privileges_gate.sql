-- Disposable-cluster proof of the existing trusted-runtime / SECURITY INVOKER model.
-- All grants and the NOLOGIN test role roll back. Production provisioning is external.
BEGIN;
CREATE ROLE pliego_billing_runtime_probe NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA pliego TO pliego_billing_runtime_probe;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pliego TO pliego_billing_runtime_probe;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA pliego TO pliego_billing_runtime_probe;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pliego TO pliego_billing_runtime_probe;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA pliego TO pliego_billing_runtime_probe;
SET LOCAL ROLE pliego_billing_runtime_probe;
DO $$
BEGIN
 IF (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolcanlogin FROM pg_roles WHERE rolname=current_user) THEN
  RAISE EXCEPTION 'probe has elevated privileges'; END IF;
 IF has_schema_privilege(current_user,'pliego','CREATE') THEN RAISE EXCEPTION 'runtime can create schema objects'; END IF;
 IF NOT pliego.fn_is_valid_ec_cedula('0012345674') THEN RAISE EXCEPTION 'runtime cannot use validator'; END IF;
 BEGIN
  PERFORM pliego.fn_invoice_artifact_metadata(-1,-1);
  RAISE EXCEPTION 'invalid actor authorized';
 EXCEPTION WHEN SQLSTATE 'P1002' THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
