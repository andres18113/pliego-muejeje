#!/usr/bin/env python3
"""Allowlisted, aggregate-only local preflight. No HTTP, writes, or raw errors."""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess


def run(args):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=20,
                           env={'PATH': '/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                                'LANG': 'C', 'LC_ALL': 'C'})
        return p.stdout.strip() if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def metadata(path):
    try:
        s = Path(path).lstat()
        return {'present': True, 'uid': s.st_uid, 'gid': s.st_gid,
                'mode': oct(stat.S_IMODE(s.st_mode)), 'symlink': stat.S_ISLNK(s.st_mode)}
    except FileNotFoundError:
        return {'present': False}


def lock_status(path):
    result = metadata(path)
    if not result['present']:
        return result
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            result['probe'] = 'refused_nonregular'
            return result
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result['held'] = False
            fcntl.flock(fd, fcntl.LOCK_UN)
        except BlockingIOError:
            result['held'] = True
    except OSError:
        result['probe'] = 'unavailable'
    finally:
        if fd is not None:
            os.close(fd)
    return result


def env_facts(path):
    result = {}
    allowed = {'PLIEGO_R2_ENDPOINT', 'PLIEGO_R2_BUCKET', 'PLIEGO_R2_ENABLED',
               'PLIEGO_R2_PRODUCTION_STORAGE'}
    try:
        with open(path) as source:
            for line in source:
                match = re.match(r'^\s*(?:export\s+)?([A-Z0-9_]+)\s*=', line)
                if not match or match[1] not in allowed:
                    continue
                key = match[1]
                value = line[match.end():].strip().strip('\"\'')
                if key == 'PLIEGO_R2_ENDPOINT':
                    endpoint = re.fullmatch(r'https://([0-9a-f]{32})\.r2\.cloudflarestorage\.com/?', value)
                    result['r2_account_id'] = endpoint[1] if endpoint else 'invalid_or_nonstandard'
                elif key == 'PLIEGO_R2_BUCKET':
                    result['invoice_bucket'] = value if re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', value) else 'invalid'
                else:
                    result[key.lower()] = value.lower() if value.lower() in ('true', 'false', '1', '0') else 'invalid'
    except OSError:
        result['env_file'] = 'unavailable'
    return result


def query(sql):
    raw = run(['runuser', '-u', 'postgres', '--', '/usr/lib/postgresql/18/bin/psql',
               '-X', '-w', '-h', '/var/run/postgresql', '-p', '5432', '-d', 'pliego',
               '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
               'BEGIN READ ONLY; SET LOCAL statement_timeout=\'10s\'; '+sql+'; ROLLBACK;'])
    if raw is None:
        return {'status': 'unavailable'}
    # psql transaction/SET command tags excluded. Only JSON SELECT results accepted.
    for line in raw.splitlines():
        try:
            return json.loads(line)
        except ValueError:
            continue
    return {'status': 'unavailable'}


def artifacts():
    found = []
    roots = ['/var/backups', '/var/lib/pliego-backup', '/var/lib/pliego-object-backup', '/opt/pliego/backups']
    # Bounded metadata-only traversal; never read a backup, cron body or credential.
    for base in roots:
        root = Path(base)
        if not root.is_dir():
            continue
        for directory, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if not Path(directory, d).is_symlink()]
            if len(Path(directory).relative_to(root).parts) >= 2:
                dirs[:] = []
            for name in files:
                p = Path(directory, name)
                try:
                    s = p.lstat()
                    found.append({'name': str(p), 'bytes': s.st_size, 'mtime_epoch': int(s.st_mtime)})
                except OSError:
                    pass
                if len(found) >= 200:
                    return {'entries': found, 'truncated': True}
    return {'entries': found, 'truncated': False}


def collect():
    facts = {'scope': 'read_only_local_no_network', 'kernel': run(['uname', '-srmo']),
             'os': {}, 'systemd_version': run(['systemctl', '--version'])}
    if facts['systemd_version']:
        facts['systemd_version'] = facts['systemd_version'].splitlines()[0]
        version = re.search(r'\b(\d+)\b', facts['systemd_version'])
        facts['openfile_supported'] = bool(version and int(version[1]) >= 253)
    try:
        for line in Path('/etc/os-release').read_text().splitlines():
            key, _, value = line.partition('=')
            if key in ('ID', 'VERSION_ID', 'PRETTY_NAME'):
                facts['os'][key] = value.strip('"')
        facts['uptime_seconds'] = float(Path('/proc/uptime').read_text().split()[0])
        facts['load'] = list(os.getloadavg())
        facts['memory_kib'] = {m[1]: int(m[2]) for m in
            re.finditer(r'^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+) kB$',
                        Path('/proc/meminfo').read_text(), re.M)}
    except OSError:
        facts['resources_status'] = 'unavailable'
    facts['disk'] = {}
    for path in ('/', '/var/lib', '/run'):
        try:
            d = shutil.disk_usage(path)
            facts['disk'][path] = {'total_bytes': d.total, 'free_bytes': d.free}
        except OSError:
            facts['disk'][path] = {'status': 'unavailable'}
    facts['service'] = run(['systemctl', 'show', 'pliego.service', '--property=ActiveState,SubState,NRestarts,MainPID'])
    facts['postgresql18_clusters'] = run(['pg_lsclusters', '--no-header', '18'])
    facts['pg_dump_version'] = run(['/usr/lib/postgresql/18/bin/pg_dump', '--version'])
    facts['pg_dumpall_version'] = run(['/usr/lib/postgresql/18/bin/pg_dumpall', '--version'])
    facts['database'] = query("SELECT json_build_object('peer_select_1',1,'size_bytes',pg_database_size(current_database()),'role_names',(SELECT json_agg(rolname ORDER BY rolname) FROM pg_roles))")
    facts['flyway'] = query("SELECT json_build_object('latest_version',(SELECT version FROM public.flyway_schema_history WHERE success AND version IS NOT NULL ORDER BY installed_rank DESC LIMIT 1),'failed_count',(SELECT count(*) FROM public.flyway_schema_history WHERE NOT success))")
    facts['invoices'] = query("SELECT json_build_object('counts_by_storage_kind',(SELECT json_agg(x) FROM (SELECT storage_kind,count(*) AS count FROM pliego.factura_archivo GROUP BY storage_kind ORDER BY storage_kind) x),'r2_total_bytes',(SELECT coalesce(sum(size_bytes),0) FROM pliego.factura_archivo WHERE storage_kind='R2'))")
    facts['deploy_lock'] = lock_status('/run/lock/pliego-deploy.lock')
    facts['binaries'] = {b: bool(shutil.which(b)) for b in ('gpg', 'curl', 'python3', 'tar', 'flock', 'sha256sum', 'systemd-tmpfiles', 'systemd-analyze')}
    curl = run(['curl', '--version'])
    facts['curl_version'] = curl.splitlines()[0] if curl else None
    help_text = run(['curl', '--help', 'all'])
    facts['curl_sigv4'] = bool(help_text and '--aws-sigv4' in help_text)
    facts['paths'] = {p: metadata(p) for p in ('/etc/pliego-backup', '/opt/pliego/backup')}
    facts['application_storage'] = env_facts('/etc/pliego/pliego.env')
    facts['artifacts'] = artifacts()
    # Fixed systemctl properties/name-only output; no unit bodies or environment.
    raw = run(['systemctl', 'list-unit-files', '--type=timer', '--no-legend', '--no-pager'])
    facts['backup_timer_names'] = [line.split()[0] for line in (raw or '').splitlines() if re.search(r'backup|object-backup', line, re.I)]
    facts['backup_timer_states'] = {name: run(['systemctl', 'show', name, '--property=ActiveState,NextElapseUSecRealtime,LastTriggerUSec']) for name in facts['backup_timer_names'] if re.fullmatch(r'[A-Za-z0-9_.@-]+\.timer', name)}
    facts['cron_names'] = {}
    for base in ('/etc/cron.d', '/etc/cron.daily', '/etc/cron.hourly', '/etc/cron.weekly', '/etc/cron.monthly', '/var/spool/cron/crontabs'):
        try:
            facts['cron_names'][base] = [{'name': p.name, 'bytes': p.lstat().st_size, 'mtime_epoch': int(p.lstat().st_mtime)} for p in sorted(Path(base).iterdir())]
        except OSError:
            facts['cron_names'][base] = []
    # comm only, never command lines (argv can contain credentials).
    raw = run(['ps', '-eo', 'pid=,comm='])
    facts['deployment_backup_processes'] = [line.strip() for line in (raw or '').splitlines() if re.search(r'(backup|deploy|pg_dump|pg_restore|gpg|rsync|flock)', line, re.I)]
    facts['process_observation_limit'] = 'comm only; generic bash/python deploy processes cannot be identified safely'
    return facts


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('preflight_requires_root')
    print(json.dumps(collect(), indent=2, sort_keys=True))
