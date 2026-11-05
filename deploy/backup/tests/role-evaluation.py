#!/usr/bin/env python3
"""Local-only PG18 backup-role differential drill; never changes the backup defaults.

Reuses the canonical table/ACL/sequence snapshot and command logger from
local-restore.py without executing that harness's already-passing old drills.
All clusters and raw logs live below a new --evidence directory in gaps/g3.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import time
import zipfile

ROOT = Path(__file__).resolve().parents[3]
PG = Path('/usr/lib/postgresql/18/bin')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--evidence', type=Path, required=True)
parser.add_argument('--java', type=Path, required=True)
parser.add_argument('--jar', type=Path, default=ROOT / 'backend/target/pliego-backend-0.1.0-SNAPSHOT.jar')
a = parser.parse_args()
E = a.evidence.resolve()
assert E.is_relative_to(ROOT / '.release-evidence/2026-11-05-gaps/g3') and not E.exists()
E.mkdir(parents=True, mode=0o700)
W = E / 'runtime'
W.mkdir(mode=0o700)
env = {'PATH': str(PG) + ':/usr/bin:/bin', 'HOME': str(W), 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
clusters = []
seq = 0

# Import only reviewed pure helper definitions. Importing the module itself would
# run its argparse/setup and old drills. Keep its comparison SQL authoritative.
harness = ROOT / 'deploy/backup/tests/local-restore.py'
tree = ast.parse(harness.read_text())
names = {'run', 'sql', 'psql_file', 'snapshot'}
helpers = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
assert {n.name for n in helpers} == names
exec(compile(ast.Module(body=helpers, type_ignores=[]), str(harness), 'exec'), globals())
sql.__defaults__ = (55531, 'postgres', 'pliego_benchmark')
psql_file.__defaults__ = (55531, 'postgres', 'pliego_benchmark')
(E / 'reused-harness.sha256').write_text(hashlib.sha256(harness.read_bytes()).hexdigest() + '\n')


def normalized_dump(text):
    """Ignore archive timestamps and per-invocation psql safety nonces only."""
    return '\n'.join(line for line in text.splitlines()
                     if not line.startswith(('\\restrict ', '\\unrestrict ', '-- Started on ', '-- Completed on ')))


try:
    run([PG / 'postgres', '--version'], 'pg-version')
    run([a.java, '-version'], 'java-version')
    # A frozen copy prevents mutable build outputs changing during the drill.
    jar = W / 'backend.jar'
    shutil.copy2(a.jar, jar)
    libs = W / 'libs'
    libs.mkdir()
    with zipfile.ZipFile(jar) as z:
        for name in z.namelist():
            if name.startswith('BOOT-INF/lib/') and name.endswith('.jar'):
                (libs / Path(name).name).write_bytes(z.read(name))
    (E / 'jar.sha256').write_text(hashlib.sha256(jar.read_bytes()).hexdigest() + '\n')
    migrations = W / 'migration'
    shutil.copytree(ROOT / 'backend/src/main/resources/db/migration', migrations)
    (E / 'migrations.sha256').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n'
                                              for p in sorted(migrations.glob('*.sql'))))
    pattern = re.compile(r'row\s+level|row_level|create\s+policy|large\s+object|lo_import|lo_create|pg_largeobject|tablespace|security\s+label', re.I)
    matches = [{'file': p.name, 'line': n, 'text': line}
               for p in sorted(migrations.glob('*.sql'))
               for n, line in enumerate(p.read_text().splitlines(), 1) if pattern.search(line)]
    (E / 'migration-feature-scan.json').write_text(json.dumps(matches, indent=2) + '\n')
    # Preserve the bootstrap-superuser identity for GRANTED BY postgres on
    # predefined-role memberships (a different bootstrap name fails on PG18).
    for name, port, user in [('source', 55531, 'postgres'), ('super-restore', 55532, 'postgres'),
                             ('role-restore', 55533, 'postgres')]:
        data = W / name
        run([PG / 'initdb', '-D', data, '-U', user, '-A', 'trust', '--locale=C.UTF-8', '--encoding=UTF8'], name + '-initdb')
        with (data / 'postgresql.conf').open('a') as f:
            f.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nunix_socket_directories=''\n")
        run([PG / 'pg_ctl', '-D', data, '-l', E / (name + '-postgres.log'), '-w', 'start'], name + '-start')
        clusters.append(data)
    run([PG / 'createdb', '-h', '127.0.0.1', '-p', '55531', '-U', 'postgres', 'pliego_benchmark'], 'createdb')
    sql("CREATE ROLE pliego_owner NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; CREATE ROLE pliego_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; ALTER DATABASE pliego_benchmark OWNER TO pliego_owner; ALTER SCHEMA public OWNER TO pliego_owner; GRANT CONNECT ON DATABASE pliego_benchmark TO pliego_app; GRANT pliego_owner TO pliego_app;", 'runtime-roles')
    appenv = {'PLIEGO_DB_URL': 'jdbc:postgresql://127.0.0.1:55531/pliego_benchmark', 'PLIEGO_DB_USERNAME': 'pliego_app',
              'PLIEGO_DB_PASSWORD': 'local-synthetic-only', 'PLIEGO_ADMIN_EMAIL': 'perf-admin@example.invalid',
              'PLIEGO_ADMIN_PASSWORD_HASH': 'unused-synthetic-admin'}
    run([a.java, '--class-path', str(libs / '*'), ROOT / 'scripts/LocalFlyway.java', migrations], 'flyway-migrate', extra=appenv)
    cleanup = (ROOT / 'docs/deployment/production-runbook.md').read_text().split('-- BEGIN PLIEGO_RUNTIME_ACL_CLEANUP_SQL', 1)[1].split('-- END PLIEGO_RUNTIME_ACL_CLEANUP_SQL', 1)[0]
    (W / 'runtime-cleanup.sql').write_text(cleanup)
    psql_file(W / 'runtime-cleanup.sql', 'runtime-cleanup')
    seed = (ROOT / 'perf/k6/seed.sql').read_text().replace("('55464','55465','55466','55467','55468')", "('55531')").replace('\\set benchmark_port 55464', '\\set benchmark_port 55531')
    (W / 'seed.sql').write_text(seed)
    psql_file(W / 'seed.sql', 'catalog-customers-seed')
    (W / 'seed-commerce.sql').write_text((ROOT / 'deploy/backup/tests/seed-commerce.sql').read_text().replace("<>'55481'", "<>'55531'"))
    psql_file(W / 'seed-commerce.sql', 'commerce-seed')
    sql('CREATE ROLE pliego_backup LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT pg_read_all_data TO pliego_backup;', 'backup-role')
    inventory = sql("""SELECT json_build_object(
      'rls_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('pliego','public') AND (relrowsecurity OR relforcerowsecurity)),
      'policies',(SELECT count(*) FROM pg_policy),
      'large_objects',(SELECT count(*) FROM pg_largeobject_metadata),
      'nondefault_tablespaces',(SELECT count(*) FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')),
      'extensions',(SELECT json_agg(extname ORDER BY extname) FROM pg_extension),
      'role',(SELECT row_to_json(r) FROM (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='pliego_backup') r),
      'memberships',(SELECT json_agg(pr.rolname ORDER BY pr.rolname) FROM pg_auth_members m JOIN pg_roles pr ON pr.oid=m.roleid JOIN pg_roles pm ON pm.oid=m.member WHERE pm.rolname='pliego_backup'),
      'executable_business_routines',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pliego' AND has_function_privilege('pliego_backup',p.oid,'EXECUTE')),
      'executable_definer_routines',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pliego' AND p.prosecdef AND has_function_privilege('pliego_backup',p.oid,'EXECUTE')),
      'writable_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('pliego','public') AND relkind='r' AND has_table_privilege('pliego_backup',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')));""", 'object-and-role-inventory')
    (E / 'object-and-role-inventory.json').write_text(inventory + '\n')
    versions = json.loads(sql("SELECT json_agg(version::integer ORDER BY version::integer) FROM public.flyway_schema_history WHERE success AND version IS NOT NULL;", 'flyway-versions'))
    assert versions == list(range(1, 107)), versions
    baseline = snapshot(55531, 'postgres', 'source')
    globals_results = {}
    for label, user, port in [('super', 'postgres', 55532), ('role', 'pliego_backup', 55533)]:
        run([PG / 'pg_dump', '--create', '--format=custom', '--compress=gzip:6', '-h', '127.0.0.1', '-p', '55531', '-U', user, '--file', W / (label + '.dump'), '--dbname', 'pliego_benchmark'], label + '-dump')
        run([PG / 'pg_dumpall', '--globals-only', '--no-role-passwords', '-h', '127.0.0.1', '-p', '55531', '-U', user, '--file', W / (label + '-globals.sql')], label + '-globals')
        globals_results[label] = normalized_dump((W / (label + '-globals.sql')).read_text())
        original_globals = (W / (label + '-globals.sql')).read_text()
        assert original_globals.count('CREATE ROLE postgres;') == 1
        # initdb already created this bootstrap role. Keep every ALTER/GRANT and
        # the raw original; never mask other restore errors.
        restore_globals = W / (label + '-restore-globals.sql')
        restore_globals.write_text(original_globals.replace('CREATE ROLE postgres;', '-- Bootstrap postgres already exists (initdb).'))
        psql_file(restore_globals, label + '-restore-globals', port, 'postgres', 'postgres')
        run([PG / 'pg_restore', '--create', '--exit-on-error', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', W / (label + '.dump')], label + '-restore-database')
        actual = snapshot(port, 'postgres', label + '-restored')
        assert baseline == actual, label + ': table/content/role/ACL/sequence mismatch'
    assert globals_results['super'] == globals_results['role'], 'Globals differ beyond random psql safety nonces'
    # pg_read_all_data also includes sensitive catalogs on PG18. Check only
    # privilege and a count, never write password verifiers to evidence.
    assert sql("SELECT has_table_privilege(current_user,'pg_authid','SELECT');", 'password-catalog-capability', user='pliego_backup') == 't'
    assert int(sql('SELECT count(rolpassword) FROM pg_authid;', 'password-catalog-read-count', user='pliego_backup')) == 0
    out, _ = run([PG / 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55531', '-U', 'pliego_backup', '-d', 'pliego_benchmark', '-c', 'BEGIN; UPDATE pliego.usuario SET rol=rol WHERE false; ROLLBACK;'], 'negative-write', expected='nonzero')
    assert 'permission denied for table usuario' in out
    # Future-schema regressions: this role fails closed for RLS and non-owned LOs
    # on PG18. These objects are created only after the baseline comparisons.
    sql('CREATE TABLE public.g3_rls_probe(id integer); INSERT INTO public.g3_rls_probe VALUES (1); ALTER TABLE public.g3_rls_probe ENABLE ROW LEVEL SECURITY;', 'rls-probe-setup')
    out, _ = run([PG / 'pg_dump', '-h', '127.0.0.1', '-p', '55531', '-U', 'pliego_backup', '--file', W / 'rls-probe.dump', '--dbname', 'pliego_benchmark'], 'negative-rls-dump', expected='nonzero')
    assert 'row-level security policy' in out
    sql('DROP TABLE public.g3_rls_probe; SELECT lo_from_bytea(0,convert_to(\'G3 SYNTHETIC LARGE OBJECT\',\'UTF8\'));', 'large-object-probe-setup')
    out, _ = run([PG / 'pg_dump', '-h', '127.0.0.1', '-p', '55531', '-U', 'pliego_backup', '--file', W / 'large-object-probe.dump', '--dbname', 'pliego_benchmark'], 'negative-large-object-dump', expected='nonzero')
    assert 'permission denied for large object' in out
    sql('SELECT lo_unlink(oid) FROM pg_largeobject_metadata;', 'large-object-probe-cleanup')
    result = {'all_tables_equal': True, 'table_count': len(baseline[0]), 'total_rows': sum(t['rows'] for t in baseline[0].values()),
              'roles_acl_equal': True, 'sequences_equal': True, 'flyway_versions': len(versions),
              'superuser_and_non_superuser_globals_equal_after_nonce_removal': True,
              'password_verifier_catalog_readable': True, 'synthetic_cluster_has_no_password_verifiers': True, 'data_update_denied': True,
              'future_rls_dump_rejected': True, 'future_ungranted_large_object_dump_rejected': True,
              'restore_bootstrap': 'postgres; only duplicate CREATE ROLE postgres omitted from restore copy; original retained',
              'local_authentication': 'loopback trust, synthetic roles; production peer mapping NOT tested'}
    (E / 'database-comparison.json').write_text(json.dumps(result, indent=2) + '\n')
    (E / 'PASS').write_text('Both role dumps restored to fresh PG18 clusters and matched source table digests/ACLs/sequences. Read limitations in report.\n')
finally:
    for data in reversed(clusters):
        run([PG / 'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'], data.name + '-stop')
