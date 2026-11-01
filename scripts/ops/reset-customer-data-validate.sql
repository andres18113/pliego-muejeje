-- Disposable restored databases ONLY; never a production preflight.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE pliego_owner;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='10min';
SELECT format('ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',n.nspname,c.relname,k.conname)
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='pliego' AND k.contype IN('c','f','n') ORDER BY c.relname,k.conname \gexec
COMMIT;
