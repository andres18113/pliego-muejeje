#!/usr/bin/env python3
"""OWNER ONLY: existing DB verifier, then invoice bytes against ITS restored DB.
Run on the owner's isolated workstation with attended key unlock. Never on VPS.
Private work stays outside repo/evidence; only allowlisted JSON evidence is copied.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import uuid

BACKUP = Path(__file__).resolve().parents[1]
REPO = BACKUP.parents[1]
EVIDENCE = REPO/'.release-evidence/2026-11-05-prod-backup/restore'


def outside(path):
    resolved = path.resolve()
    return (not resolved.is_relative_to(REPO)
            and not any(p.name == '.release-evidence' or (p/'.git').exists()
                        for p in (resolved, *resolved.parents)))


def run(command, env, steps, name, timeout=1900):
    process = subprocess.Popen([str(v) for v in command], env=env, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        out, _ = process.communicate(timeout=timeout)
        code = process.returncode
    except BaseException:
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        steps.append({'step': name, 'exit_status': 124})
        raise
    steps.append({'step': name, 'exit_status': code})
    if code:
        raise RuntimeError(name)
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--private-work', required=True, type=Path, help='NEW short path outside repository/evidence, e.g. /private/pliego-r-UNIQUE')
    p.add_argument('--gnupg-home', required=True, type=Path, help='owner-unlocked keyring, outside repository/evidence')
    p.add_argument('--credentials-directory', required=True, type=Path, help='only s3.json and object-target.json; owner-held backup reader')
    p.add_argument('--account-id', required=True)
    p.add_argument('--fingerprint', required=True, help='original object recipient full uppercase fingerprint')
    p.add_argument('--expected-flyway', required=True, type=int)
    p.add_argument('--database', default='pliego')
    p.add_argument('--pg-bin', type=Path, default=Path('/usr/lib/postgresql/18/bin'))
    p.add_argument('--max-age-hours', type=float, default=7)
    a = p.parse_args()
    os.umask(0o077)
    work, home, creds, pg = [v.resolve() for v in (a.private_work, a.gnupg_home, a.credentials_directory, a.pg_bin)]
    if os.geteuid() == 0:
        p.error('owner workstation non-root user required')
    if (work.exists() or not outside(work) or not outside(home) or not outside(creds)
            or not re.fullmatch(r'/[A-Za-z0-9._/-]+', str(work))
            or not home.is_dir() or not creds.is_dir()):
        p.error('new private work, existing owner key/credentials outside repository required; work path uses simple characters')
    if len(str(work/'db/socket/.s.PGSQL.5432')) > 107:
        p.error('private-work path too long for isolated PostgreSQL socket')
    if (not re.fullmatch('[a-f0-9]{32}', a.account_id)
            or not re.fullmatch('[A-F0-9]{40,64}', a.fingerprint)
            or not re.fullmatch('[A-Za-z_][A-Za-z_0-9]{0,62}', a.database)
            or a.expected_flyway < 1 or a.max_age_hours <= 0):
        p.error('valid non-secret account, fingerprint, database and release count required')
    # Refuse a source credential or any additional secret file in restore custody.
    if {f.name for f in creds.iterdir()} != {'s3.json', 'object-target.json'}:
        p.error('restore credential directory must contain ONLY s3.json and object-target.json')
    for path in (home, creds):
        st = path.stat()
        if st.st_uid != os.geteuid() or st.st_mode & 0o077:
            p.error('owner key/credential directories must be private to current user')
    for path in (creds/'s3.json', creds/'object-target.json'):
        st = path.lstat()
        if path.is_symlink() or not path.is_file() or st.st_uid != os.geteuid() or st.st_mode & 0o077:
            p.error('owner credential files must be private regular files')
    work.mkdir(mode=0o700)
    run_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex
    evidence = EVIDENCE/run_id
    evidence.mkdir(mode=0o700, parents=True)
    endpoint = 'https://'+a.account_id+'.r2.cloudflarestorage.com'
    env = {'PATH': str(pg)+':/usr/bin:/bin', 'HOME': str(work), 'LANG': 'C.UTF-8', 'TZ': 'UTC',
           'CREDENTIALS_DIRECTORY': str(creds), 'BACKUP_ENDPOINT': endpoint,
           'BACKUP_BUCKET': 'pliego-db-backups', 'BACKUP_REGION': 'auto'}
    if os.environ.get('GPG_TTY'):
        env['GPG_TTY'] = os.environ['GPG_TTY']
    report = {'result': 'FAIL', 'scope': 'isolated DB restore plus all R2 invoice references in that restored DB; no live source access or HTTP smoke',
              'steps': [], 'checks': {}}
    cluster_may_run = False
    stage = 'database_verifier'

    def interrupted(signum, frame):
        raise InterruptedError('owner verification interrupted')

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        run([sys.executable, BACKUP/'verify-restore.py', '--work-dir', work/'db', '--gnupg-home', home,
             '--pg-bin', pg, '--database', a.database, '--expected-flyway', a.expected_flyway,
             '--max-age-hours', a.max_age_hours], env, report['steps'], 'database_verifier', timeout=14400)
        db = json.loads((work/'db/report.json').read_bytes())
        if db['result'] != 'PASS' or db['checks'].get('cluster_stopped') is not True:
            raise ValueError('db_report_failed')
        # Copy allowlisted fields only, never command argv/private paths or raw SQL/GPG output.
        report['database'] = {name: db[name] for name in ('result', 'checks', 'archive', 'flyway_versions', 'elapsed_seconds')}
        report['checks']['database_verified'] = True
        stage = 'restart_own_isolated_cluster'
        if (work/'db/cluster/PG_VERSION').read_text().strip() != '18':
            raise ValueError('not_own_pg18_cluster')
        cluster_may_run = True
        run([pg/'pg_ctl', '-D', work/'db/cluster', '-l', work/'db/invoice-postgres.log', '-w', 'start'],
            env, report['steps'], 'isolated_cluster_restart', timeout=90)
        stage = 'invoice_verifier'
        invoice_env = dict(env, PGHOST=str(work/'db/socket'), PGPORT='5432', PGUSER='postgres',
                           PGDATABASE=a.database, PGOPTIONS='-c default_transaction_read_only=on',
                           GNUPGHOME=str(home), OBJECT_BACKUP_ENABLED='1',
                           OBJECT_BACKUP_STATE_DIR=str(work/'object-state'), OBJECT_SOURCE_PREFIX='invoices/',
                           OBJECT_TARGET_ENDPOINT=endpoint, OBJECT_TARGET_BUCKET='pliego-db-backups',
                           OBJECT_BACKUP_PREFIX='object-backups/v1/', OBJECT_BACKUP_RECIPIENT=a.fingerprint)
        # This API action never instantiates a source Store; output contains hashes only.
        out = run([sys.executable, BACKUP/'object-backup.py', 'verify', '--output', work/'invoice-plaintext'],
                  invoice_env, report['steps'], 'invoice_verifier', timeout=14400)
        invoice = json.loads(out)
        if (invoice.get('status') != 'PASS' or invoice.get('inventory_checksums_verified') is not True
                or invoice.get('inventory_source') != 'database' or type(invoice.get('objects')) is not int):
            raise ValueError('invoice_report_failed')
        report['invoices'] = {name: invoice[name] for name in ('status', 'objects', 'inventory_checksums_verified', 'inventory_source')}
        report['checks']['invoice_bytes_equal_restored_db_hashes_sizes'] = True
        report['result'] = 'PASS'
    except Exception:
        report['failed_step'] = stage
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        # The existing DB verifier normally stops itself; if terminated mid-run,
        # also stop only the newly created cluster in this wrapper's private work.
        data = work/'db/cluster'
        if cluster_may_run or (data/'postmaster.pid').exists():
            try:
                run([pg/'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'], env, report['steps'], 'cluster_stop', timeout=90)
                report['checks']['cluster_stopped'] = True
            except Exception:
                report['result'] = 'FAIL'
                report['failed_step'] = 'cluster_stop'
        else:
            report['checks']['cluster_stopped'] = not (data/'postmaster.pid').exists()
        report['completed_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
        report['private_work_retained_for_owner_cleanup'] = True
        (evidence/'report.json').write_text(json.dumps(report, indent=2)+'\n')
        print(json.dumps({'result': report['result'], 'report': str(evidence/'report.json')}))
    return 0 if report['result'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
