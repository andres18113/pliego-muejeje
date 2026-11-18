#!/usr/bin/env python3
"""Attended restore into a NEW isolated PG18 cluster. Never connects to an existing DB.
Requires trusted archive provenance, offline-unlocked key, curl/GPG and PG18 binaries.
Read docs/operations/2026-11-05-alert-restore.md before use. No unattended key custody.
"""
import argparse
import datetime
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
UTC = datetime.timezone.utc


def newest_complete_key(keys, prefix):
    pattern = re.compile(re.escape(prefix) + r'/\d{8}T\d{6}Z-[a-f0-9]{32}/complete\.json')
    complete = [k for k in keys if pattern.fullmatch(k)]
    if not complete:
        raise ValueError('no_complete_marker')
    # Writer IDs start with UTC dump-start timestamp; ignore partial object sets.
    return max(complete)


def validate_marker(marker, key, now, max_age):
    if marker['id'] != key.split('/')[1] or not re.fullmatch(r'[a-f0-9]{64}', marker['sha256']):
        raise ValueError('invalid_marker_identity')
    if type(marker['bytes']) is not int or not 0 < marker['bytes'] < 1073741824:
        raise ValueError('invalid_marker_size')
    completed = datetime.datetime.fromisoformat(marker['completed_at'].replace('Z', '+00:00'))
    if completed.tzinfo is None or not 0 <= (now-completed).total_seconds() <= max_age:
        raise ValueError('stale_or_future_marker')


def flyway_valid(data, expected):
    return (data['versions'] == list(range(1, expected+1)) and data['all_success'] is True
            and data['ranks'] == list(range(1, len(data['ranks'])+1)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', required=True, type=pathlib.Path, help='NEW private directory, retained for operator review/cleanup')
    parser.add_argument('--gnupg-home', required=True, type=pathlib.Path, help='operator-unlocked offline private key home')
    parser.add_argument('--database', default='pliego', help='must match database recorded in dump')
    parser.add_argument('--expected-flyway', type=int, required=True, help='approved release migration count')
    parser.add_argument('--prefix', choices=('frequent','daily','weekly','monthly'), default='frequent')
    parser.add_argument('--max-age-hours', type=float, default=7)
    parser.add_argument('--pg-bin', type=pathlib.Path, default=pathlib.Path('/usr/lib/postgresql/18/bin'))
    args = parser.parse_args()
    os.umask(0o077)
    work = args.work_dir.resolve()
    if work.exists() or not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]{0,62}',args.database):
        parser.error('work directory must be new; database must be a simple identifier')
    if args.expected_flyway < 1 or args.max_age_hours <= 0:
        parser.error('expected Flyway count and max age must be positive')
    work.mkdir(mode=0o700, parents=True)
    report = {'result':'FAIL','checks':{},'commands':[], 'scope':'isolated PostgreSQL restore and read-only Database API smoke; no HTTP auth flow or external R2 invoice bytes'}
    started = time.monotonic()
    cluster_started = False
    stage = 'preflight'
    env = {k:v for k,v in os.environ.items() if k.startswith('BACKUP_') or k in ('CREDENTIALS_DIRECTORY','PLIEGO_BACKUP_TEST_LOCAL')}
    # Never inherit PGHOST/PGSERVICE/PGOPTIONS or credentials targeting another cluster.
    env.update(PATH=str(args.pg_bin.resolve())+':/usr/bin:/bin', HOME=str(work), LANG='C.UTF-8', TZ='UTC', PGPORT='5432')
    env['WORK'] = str(work/'transport'); pathlib.Path(env['WORK']).mkdir(mode=0o700)
    data = work/'cluster'; socket = work/'socket'; socket.mkdir(mode=0o700)
    pg = lambda name: str(args.pg_bin.resolve()/name)

    def run(cmd, label, *, input=None, extra=None):
        e = dict(env, **(extra or {}))
        process = subprocess.Popen(list(map(str,cmd)), env=e, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        exit_status = None
        # LOCAL TEST ONLY: exercise the timeout path against loopback synthetic S3.
        timeout = 1 if label == 'pg_restore' and env.get('PLIEGO_BACKUP_TEST_LOCAL') == '1' and env.get('BACKUP_VERIFY_TEST_RESTORE_TIMEOUT') == '1' else 1800
        try:
            stdout, _ = process.communicate(input=input, timeout=timeout)
            exit_status = process.returncode
        except (subprocess.TimeoutExpired, InterruptedError):
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            stdout = ''
            exit_status = 124
        # Retain argv and exits, suppress command output: PostgreSQL errors can contain customer rows.
        report['commands'].append({'step':label,'argv':list(map(str,cmd)),'exit_status':exit_status})
        with (work/'commands.jsonl').open('a') as f:
            f.write(json.dumps(report['commands'][-1])+'\n')
        if exit_status:
            raise RuntimeError(label)
        return stdout.strip()

    def sql(query, label, user='postgres'):
        return run([pg('psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,'-p','5432','-U',user,'-d',args.database], label, input=query)

    def interrupted(signum, frame):
        raise InterruptedError('verification interrupted')

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        if len(str(socket)) + len('/.s.PGSQL.5432') > 107:
            raise ValueError('socket_path_too_long')
        if 'PostgreSQL) 18.' not in run([pg('postgres'),'--version'],'pg18-version'):
            raise ValueError('requires_pg18')
        # Only the existing reviewed endpoint allowlist in common.sh is accepted.
        stage = 'list_complete_markers'
        keys = []; token = ''
        for _ in range(100):
            listing = run(['bash','-c', '''source "$1"
configure_store
list_args=()
if [[ -n $3 ]]; then list_args+=(--data-urlencode "continuation-token=$3"); fi
curl --silent --show-error --fail --noproxy '*' --connect-timeout 10 --max-time 180 --aws-sigv4 "aws:amz:${BACKUP_REGION:-auto}:s3" --config "$WORK/curl.conf" --get --data-urlencode list-type=2 --data-urlencode "prefix=$2/" "${list_args[@]}" "$BACKUP_ENDPOINT/$BACKUP_BUCKET"''', 'verify-list', HERE/'common.sh', args.prefix, token], 'list-page')
            tree = ET.fromstring(listing)
            keys += [e.text for e in tree.iter() if e.tag.rsplit('}',1)[-1]=='Key']
            fields = {e.tag.rsplit('}',1)[-1]:e.text for e in tree}
            if fields.get('IsTruncated') != 'true':
                break
            token = fields['NextContinuationToken']
            if not token:
                raise ValueError('missing_list_token')
        else:
            raise ValueError('listing_limit_exceeded')
        key = newest_complete_key(keys, args.prefix)
        marker_path = work/'marker.json'
        run(['bash','-c','source "$1"; configure_store; store GET "$2" "$3"','verify-marker', HERE/'common.sh',key,marker_path],'download-marker')
        marker = json.loads(marker_path.read_text())
        validate_marker(marker,key,datetime.datetime.now(UTC),args.max_age_hours*3600)
        report['archive'] = {k:marker[k] for k in ('id','sha256','bytes','completed_at')}
        report['checks']['newest_complete_fresh'] = True
        stage = 'archive_verification'
        restored = work/'archive'
        run([HERE/'restore.sh'],'outer_decrypt_inner',extra={'RESTORE_KEY':key.rsplit('/',1)[0], 'RESTORE_OUTPUT':str(restored),'RESTORE_GNUPGHOME':str(args.gnupg_home.resolve()),'RESTORE_EXPECTED_SHA256':marker['sha256']})
        if (restored/'backup-id.txt').read_text().strip() != marker['id']:
            raise ValueError('inner_id_mismatch')
        report['checks']['outer_sha_decrypt_inner_hashes'] = True
        stage = 'fresh_cluster_restore'
        run([pg('initdb'),'-D',data,'-U','postgres','-A','trust','--locale=C.UTF-8','--encoding=UTF8'],'initdb')
        with (data/'postgresql.conf').open('a') as f:
            f.write("\nlisten_addresses=''\nport=5432\nunix_socket_directories='"+str(socket).replace("'","''")+"'\nlog_min_messages=fatal\nlog_min_error_statement=panic\nlog_error_verbosity=terse\n")
        # Trust auth is confined to a 0700 socket directory; no TCP listener exists.
        cluster_started = True
        run([pg('pg_ctl'),'-D',data,'-l',work/'postgres.log','-w','start'],'cluster_start')
        globals_sql = (restored/'globals.sql').read_text()
        if globals_sql.splitlines().count('CREATE ROLE postgres;') != 1:
            raise ValueError('unexpected_bootstrap_role')
        replay = restored/'globals.replay.sql'
        replay.write_text('\n'.join(line for line in globals_sql.splitlines() if line != 'CREATE ROLE postgres;')+'\n')
        run([pg('psql'),'-X','-q','-v','ON_ERROR_STOP=1','-h',socket,'-p','5432','-U','postgres','-d','postgres','-f',replay],'restore_globals')
        run([pg('pg_restore'),'--create','--exit-on-error','-h',socket,'-p','5432','-U','postgres','-d','postgres',restored/'database.dump'],'pg_restore')
        report['checks']['fresh_pg18_restore'] = True
        stage = 'flyway_continuity'
        history = json.loads(sql("BEGIN READ ONLY; SELECT json_build_object('versions',(SELECT json_agg(version::integer ORDER BY version::integer) FROM public.flyway_schema_history WHERE version IS NOT NULL),'all_success',(SELECT bool_and(success) FROM public.flyway_schema_history),'ranks',(SELECT json_agg(installed_rank ORDER BY installed_rank) FROM public.flyway_schema_history)); ROLLBACK;",'flyway'))
        if not flyway_valid(history,args.expected_flyway):
            raise ValueError('flyway_history_mismatch')
        report['checks']['flyway_continuity'] = True
        report['flyway_versions'] = len(history['versions'])
        stage = 'owner_grants_invariants'
        checks = json.loads(sql((HERE/'verify-restore-checks.sql').read_text(),'owner_grants_invariants'))
        report['checks'].update(checks)
        if not checks or not all(v is True for v in checks.values()):
            raise ValueError('restore_checks_failed')
        stage = 'read_only_smoke'
        smoke = json.loads(sql("BEGIN READ ONLY; SELECT json_build_object('read_only',current_setting('transaction_read_only')='on','catalog_rows',(SELECT count(*) FROM pliego.fn_catalog_search_global(NULL::varchar,NULL::varchar,NULL::numeric,NULL::numeric,NULL::varchar,NULL::varchar,'TITLE_ASC'::varchar,0,20))); ROLLBACK;",'runtime_catalog_smoke',user='pliego_app'))
        if smoke['read_only'] is not True or not isinstance(smoke['catalog_rows'],int):
            raise ValueError('smoke_failed')
        report['checks']['runtime_read_only_catalog_smoke'] = True
        report['smoke_catalog_rows'] = smoke['catalog_rows']
        report['result'] = 'PASS'
    except Exception:
        # Deliberately suppress exception/command output: these can contain URLs or data.
        report['failed_step'] = stage
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        if cluster_started:
            try:
                run([pg('pg_ctl'),'-D',data,'-m','fast','-w','stop'],'cluster_stop')
                report['checks']['cluster_stopped'] = True
            except Exception:
                report['result'] = 'FAIL'; report['failed_step'] = 'cluster_stop'
        # Derived curl credentials are ephemeral; operator explicitly removes restored data.
        for secret in (work/'transport/curl.conf',):
            secret.unlink(missing_ok=True)
        report['elapsed_seconds'] = round(time.monotonic()-started,3)
        report['completed_at'] = datetime.datetime.now(UTC).isoformat()
        (work/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'result':report['result'],'report':str(work/'report.json')}))
    return 0 if report['result']=='PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
