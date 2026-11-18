#!/usr/bin/env python3
"""Run the full PG18 gate on a new private cluster and retain its evidence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shlex
import socket
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--pg-bin', type=Path, default=Path('/usr/lib/postgresql/18/bin'))
    parser.add_argument('--pg-port', type=int, default=55546)
    parser.add_argument('--http-port', type=int, default=18096)
    parser.add_argument('--runtime-port', type=int, default=18097)
    parser.add_argument('--max-connections', type=int, default=100,
        help='CI uses concurrent direct SQL clients as well as two application pools; capacity runs use 30 separately')
    parser.add_argument('--cpus', default='24,25')
    parser.add_argument('--diagnostic-c2-only', action='store_true',
        help='Functional diagnostic after a retained C1 compiler crash; not default-runtime qualification')
    parser.add_argument('--runtime-only', action='store_true',
        help='Run the restricted-role lifecycle independently; does not replace the complete gate')
    args = parser.parse_args()
    if os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') != '1':
        parser.error('Explicit PLIEGO_TEST_DISPOSABLE_DB=1 required')
    ports = (args.pg_port, args.http_port, args.runtime_port)
    if len(set(ports)) != 3 or any(p < 1024 or p > 65535 or p in (5432, 55436, 55539) for p in ports):
        parser.error('Use three distinct disposable ports; 5432, 55436 and 55539 are forbidden')
    if args.max_connections < 30:
        parser.error('The full CI gate requires at least 30 connections')
    out = args.output.resolve()
    evidence = ROOT / '.release-evidence'
    if not out.is_relative_to(evidence):
        parser.error('Output must be under the private persistent .release-evidence directory')
    if subprocess.run(['git', 'check-ignore', '-q', str(out)], cwd=ROOT).returncode:
        parser.error('Evidence destination must be excluded from git')
    for port in ports:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', port))
    out.mkdir(mode=0o700, parents=True)
    (out / 'tmp').mkdir(mode=0o700)
    env = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'PLIEGO_', 'SPRING_'))
        and k not in ('JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'JAVA_TOOL_OPTIONS')}
    jar = ROOT / 'backend/target/pliego-backend-0.1.0-SNAPSHOT.jar'
    identity = {'source_jar_sha256_before': hashlib.sha256(jar.read_bytes()).hexdigest(),
        'pg_bin': str(args.pg_bin.resolve()), 'cpus': args.cpus,
        'postgres_max_connections': args.max_connections,
        'java_home': env.get('JAVA_HOME'), 'diagnostic_c2_only': args.diagnostic_c2_only,
        'runtime_only': args.runtime_only}
    (out / 'identity.json').write_text(json.dumps(identity, indent=2) + '\n')
    password = secrets.token_hex(24)
    env.update(PGHOST='127.0.0.1', PGPORT=str(args.pg_port), PGUSER='pliego',
        PGDATABASE='pliego_pg18gate', PGPASSWORD=password,
        PLIEGO_DB_URL=f'jdbc:postgresql://127.0.0.1:{args.pg_port}/pliego_pg18gate',
        PLIEGO_DB_USERNAME='pliego', PLIEGO_DB_PASSWORD=password,
        PLIEGO_TEST_DISPOSABLE_DB='1', PLIEGO_ADMIN_EMAIL='gate-admin@example.invalid',
        PLIEGO_ADMIN_PASSWORD_HASH='fixture-hash', PLIEGO_JWT_SECRET=secrets.token_urlsafe(48),
        PLIEGO_MAIL_ENABLED='false', PLIEGO_R2_ENABLED='false',
        CHECKOUT_BASE_URL=f'http://127.0.0.1:{args.http_port}',
        PLIEGO_PG18_APP_PORT=str(args.http_port), PLIEGO_CI_RUNTIME_APP_PORT=str(args.runtime_port),
        PLIEGO_GATE_LOG_DIR=str(out), TMPDIR=str(out / 'tmp'),
        PLIEGO_CI_ADMIN_MODE='connection', PLIEGO_CI_ADMIN_USER='pliego',
        PLIEGO_CI_ADMIN_HOST='127.0.0.1', PLIEGO_CI_ADMIN_PORT=str(args.pg_port),
        PLIEGO_CI_ADMIN_PASSWORD=password, NO_PROXY='127.0.0.1,localhost', no_proxy='127.0.0.1,localhost',
        SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE='8', SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE='2',
        JAVA_TOOL_OPTIONS=f'-Xms256m -Xmx1280m -XX:-UsePerfData -Djava.io.tmpdir={out}/tmp -XX:ErrorFile={out}/hs-error-%p.log -XX:ReplayDataFile={out}/replay-%p.log')
    if args.diagnostic_c2_only:
        env['JAVA_TOOL_OPTIONS'] += ' -XX:-TieredCompilation'
    keys = [k for k in env if k.startswith(('PG', 'PLIEGO_', 'SPRING_DATASOURCE_'))
        or k in ('CHECKOUT_BASE_URL', 'TMPDIR', 'JAVA_TOOL_OPTIONS', 'JAVA_HOME', 'PATH',
            'LD_LIBRARY_PATH', 'NO_PROXY', 'no_proxy')]
    private_env = out / 'root.env'
    private_env.write_text(''.join(f'export {k}={shlex.quote(env[k])}\n' for k in keys))
    private_env.chmod(0o600)
    running = False
    with (out / 'setup.log').open('w') as setup:
        def run(command):
            return subprocess.run([str(x) for x in command], env=env, cwd=ROOT,
                stdout=setup, stderr=subprocess.STDOUT, check=True)
        control = ['taskset', '-c', args.cpus, args.pg_bin / 'pg_ctl', '-D', out / 'pg']
        try:
            run([args.pg_bin / 'initdb', '-D', out / 'pg', '-A', 'trust', '-U', 'pliego'])
            with (out / 'pg/postgresql.conf').open('a') as config:
                config.write(f"\nlisten_addresses='127.0.0.1'\nport={args.pg_port}\nmax_connections={args.max_connections}\nunix_socket_directories='{out}'\n")
            run([*control, '-l', out / 'postgres.log', '-w', 'start'])
            running = True
            run([args.pg_bin / 'createdb', 'pliego_pg18gate'])
            with (out / 'full-gates.log').open('w') as log:
                runner = ('backend/src/test/postgres18/run_runtime_privileges_ci_gate.sh' if args.runtime_only
                    else 'backend/src/test/postgres18/run_ci_gates.sh')
                result = subprocess.run(['taskset', '-c', args.cpus, 'bash',
                    runner], env=env, cwd=ROOT,
                    stdout=log, stderr=subprocess.STDOUT)
            print(f'{runner} exit={result.returncode}; retained full-gates.log', flush=True)
            raise SystemExit(result.returncode)
        finally:
            if running:
                run([*control, '-m', 'fast', '-w', 'stop'])
            identity['source_jar_sha256_after'] = hashlib.sha256(jar.read_bytes()).hexdigest()
            (out / 'identity.json').write_text(json.dumps(identity, indent=2) + '\n')


if __name__ == '__main__':
    main()
