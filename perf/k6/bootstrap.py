#!/usr/bin/env python3
"""Use the built application's exact pinned libraries to run approved Flyway locally."""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import zipfile
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.release-evidence/2026-11-04-vps-audit/postgres'

def run(argv, name, env=None, input=None):
    log = OUT / (name + '.log')
    if log.exists():
        i=2
        while (OUT/(name+f'-{i}.log')).exists(): i+=1
        log=OUT/(name+f'-{i}.log')
    with log.open('w') as f:
        p = subprocess.run([str(a) for a in argv], cwd=ROOT, env=env, input=input,
                           stdout=f, stderr=subprocess.STDOUT, text=True)
    with (OUT / 'commands.jsonl').open('a') as f:
        f.write(json.dumps({'command': shlex.join(map(str, argv)), 'exit_status': p.returncode,
                            'log': str(log.relative_to(ROOT))})+'\n')
    if p.returncode: raise SystemExit(f'{name} failed ({p.returncode}): {log}')

if __name__ == '__main__':
    if os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') != '1':
        raise SystemExit('PLIEGO_TEST_DISPOSABLE_DB=1 required')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java',default='/usr/bin/java')
    parser.add_argument('--pg-port',type=int,choices=(55464,55465,55466,55467,55468),default=55464,
                        help='Explicit isolated local benchmark port; production/default ports refused')
    parser.add_argument('--jar',type=Path,default=ROOT/'backend/target/pliego-backend-0.1.0-SNAPSHOT.jar')
    parser.add_argument('--output',type=Path,default=OUT)
    args=parser.parse_args()
    OUT=args.output.resolve()
    if not OUT.is_relative_to(ROOT/'.release-evidence'):
        raise SystemExit('Output must be within git-ignored .release-evidence')
    OUT.mkdir(parents=True,exist_ok=True)
    jar=args.jar.resolve()
    libs=OUT/'flyway-libs'
    libs.mkdir(exist_ok=True)
    with zipfile.ZipFile(jar) as z:
        for name in z.namelist():
            if name.startswith('BOOT-INF/lib/') and name.endswith('.jar'):
                (libs/Path(name).name).write_bytes(z.read(name))
    # The standalone helper is safe even outside the resident harness: retain
    # no inherited mail/R2/cloud/DB credentials, user config home, or JVM options.
    local_home=OUT/'bootstrap-home'; local_home.mkdir(mode=0o700,exist_ok=True)
    env={'PATH':'/usr/bin:/bin','HOME':str(local_home),'LANG':'C.UTF-8','TZ':'UTC',
         'NO_PROXY':'127.0.0.1,localhost','no_proxy':'127.0.0.1,localhost'}
    env.update(PLIEGO_DB_URL=f'jdbc:postgresql://127.0.0.1:{args.pg_port}/pliego_benchmark',
               PLIEGO_DB_USERNAME='pliego_app',PLIEGO_DB_PASSWORD='benchmark-local-only',
               PLIEGO_ADMIN_EMAIL='perf-admin@example.invalid',PLIEGO_ADMIN_PASSWORD_HASH='unused-synthetic-admin',
               PLIEGO_MAIL_ENABLED='false',PLIEGO_R2_ENABLED='false')
    java=args.java
    psql=['/usr/lib/postgresql/18/bin/psql','-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',str(args.pg_port),
          '-U','postgres','-d','pliego_benchmark']
    roles=f"""DO $$ BEGIN
    IF current_database()<>'pliego_benchmark' OR current_setting('port')<>'{args.pg_port}'
      OR inet_server_addr()<>'127.0.0.1'::inet OR to_regclass('public.flyway_schema_history') IS NOT NULL
    THEN RAISE EXCEPTION 'Refusing benchmark roles outside pristine isolated DB'; END IF;
    END $$;
    CREATE ROLE pliego_owner NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE pliego_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'benchmark-local-only';
    ALTER DATABASE pliego_benchmark OWNER TO pliego_owner;
    ALTER SCHEMA public OWNER TO pliego_owner;
    GRANT CONNECT ON DATABASE pliego_benchmark TO pliego_app;
    GRANT pliego_owner TO pliego_app;
    """
    (OUT/'runtime-roles.sql').write_text(roles)
    run([*psql,'-f',OUT/'runtime-roles.sql'],'roles',env)
    run([java,'--class-path',str(libs/'*'),ROOT/'scripts/LocalFlyway.java',
         ROOT/'backend/src/main/resources/db/migration'],'flyway',env)
    runbook=(ROOT/'docs/deployment/production-runbook.md').read_text()
    cleanup=runbook.split('-- BEGIN PLIEGO_RUNTIME_ACL_CLEANUP_SQL',1)[1].split('-- END PLIEGO_RUNTIME_ACL_CLEANUP_SQL',1)[0]
    (OUT/'runtime-cleanup.sql').write_text(cleanup)
    run([*psql,'-f',OUT/'runtime-cleanup.sql'],'runtime-cleanup',env)
    # FK key-share checks use the referencing table owner. Finish the canonical
    # owner/geo-column privilege lifecycle before fixture address insertion.
    run([*psql,'-v',f'benchmark_port={args.pg_port}','-f',ROOT/'perf/k6/seed.sql'],'seed',env)
    query="""SELECT jsonb_build_object(
      'customers',(SELECT jsonb_agg(jsonb_build_object('id',u.usuario_id::text,'email',u.email_normalizado,
         'addressId',d.direccion_id::text) ORDER BY u.usuario_id)
          FROM pliego.usuario u JOIN pliego.cliente c USING(usuario_id)
          JOIN pliego.direccion d USING(cliente_id) WHERE u.rol='CUSTOMER'),
      'physicalEditions',(SELECT jsonb_agg(edicion_id::text ORDER BY edicion_id) FROM pliego.inventario),
      'editions',(SELECT jsonb_agg(edicion_id::text ORDER BY edicion_id) FROM pliego.edicion),
      'password','PerfLocal2026!');"""
    run([*psql,'-At','-c',query],'fixtures',env)
    (OUT/'fixtures.json').write_text((OUT/'fixtures.log').read_text())
