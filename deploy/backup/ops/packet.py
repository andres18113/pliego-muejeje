#!/usr/bin/env python3
"""Build a secret-free pinned backup packet; install without starting any unit."""
import argparse
import datetime as dt
import grp
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

RUNTIME = ('backup.sh', 'common.sh', 'restore.sh', 'invoice-backup.sh', 'deploy-lock.py',
           'object-backup.py', 'heartbeat.py', 'freshness.py', 'verify-restore.py',
           'verify-restore-checks.sql', 'alert.sh', 'owner-credentials.py')
UNITS = ('pliego-backup.service', 'pliego-backup.timer', 'object-backup.service',
         'object-backup.timer', 'pliego-backup-freshness.service',
         'pliego-backup-freshness.timer', 'pliego-backup-heartbeat-fail.service',
         'object-backup-heartbeat-fail.service', 'pliego-backup-alert.service')
TIMERS = ('pliego-backup.timer', 'object-backup.timer', 'pliego-backup-freshness.timer')
JOBS = ('pliego-backup.service', 'object-backup.service')
DROPS = {'db-heartbeat.conf': 'pliego-backup.service',
         'invoice-heartbeat.conf': 'object-backup.service',
         'freshness-heartbeat.conf': 'pliego-backup-freshness.service'}
DEST = Path('/opt/pliego/backup')
CONFIG = Path('/etc/pliego-backup')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args, capture=False):
    return subprocess.run(args, check=True, capture_output=capture, text=True)


def safe_path(path, *, root_owned=False, regular=False):
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('absolute safe path required')
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('symlink path refused')
        if part.exists():
            info = part.stat()
            if root_owned and (info.st_uid != 0 or info.st_mode & 0o022):
                # Root's sticky temporary parent is safe for a root-owned child.
                if not (part == Path('/tmp') and info.st_uid == 0 and info.st_mode & stat.S_ISVTX):
                    raise ValueError('root-owned non-writable paths required')
    if regular and not path.is_file():
        raise ValueError('regular input file required')


def build(output):
    source = Path(__file__).resolve().parents[1]
    safe_path(output)
    output.mkdir(mode=0o700, exist_ok=False)
    names = list(RUNTIME+UNITS)+['pliego-deploy-lock.tmpfiles.conf']
    names += [str(p.relative_to(source)) for p in (source/'ops').iterdir()
              if p.is_file() and p.suffix in ('.py', '.sh', '.conf')]
    names += ['owner-key-paths.py', 'owner-protected-key.py']
    names += [str(p.relative_to(source)) for p in (source/'owner').iterdir()
              if p.is_file() and p.suffix in ('.py', '.sh')]
    for name in sorted(set(names)):
        src = source/name
        if src.is_symlink() or not src.is_file():
            raise ValueError('packet source must be regular')
        target = output/name
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        shutil.copyfile(src, target)
        target.chmod(0o755 if target.suffix in ('.sh', '.py') else 0o644)
    manifest = output/'SHA256SUMS'
    manifest.write_text(''.join(sha(output/n)+'  '+n+'\n' for n in sorted(set(names))))
    manifest.chmod(0o600)
    print(json.dumps({'release': str(output), 'files': len(set(names)), 'manifest_sha256': sha(manifest)}, sort_keys=True))


def put(path, data, mode, gid=0):
    safe_path(path, root_owned=True)
    ensure_directory(path.parent)
    with tempfile.NamedTemporaryFile(prefix='.backup-install-', dir=path.parent, delete=False) as out:
        temporary = Path(out.name)
        try:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
            os.fchmod(out.fileno(), mode)
            os.fchown(out.fileno(), 0, gid)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def ensure_directory(path):
    """Create traversable code/unit parents even under the installer's umask0077."""
    safe_path(path, root_owned=True)
    if not path.exists():
        ensure_directory(path.parent)
        path.mkdir(mode=0o755)
        path.chmod(0o755)


def require_root():
    if os.geteuid() != 0:
        raise ValueError('root required for installation or scheduling')


def require_idle():
    # Never interrupt a running dump, or silently modify an activated installation.
    for unit in (*JOBS, *TIMERS):
        result = subprocess.run(['systemctl', 'show', unit, '--property=ActiveState', '--value'],
                                capture_output=True, text=True, check=False)
        if result.returncode != 0 or result.stdout.strip() not in ('inactive', 'failed'):
            raise ValueError('pause timers and drain both jobs before installing')


def reject_private_packets(data):
    """Inspect packet framing before GPG is permitted to parse/import any key."""
    cursor = 0
    primary = False
    while cursor < len(data):
        header = data[cursor]
        cursor += 1
        if not header & 0x80:
            raise ValueError('invalid public packet header')
        if header & 0x40:
            tag = header & 63
            first = data[cursor]
            cursor += 1
            if first < 192:
                size = first
            elif first < 224:
                size = (first-192)*256+data[cursor]+192
                cursor += 1
            elif first == 255:
                if cursor+4 > len(data):
                    raise ValueError('truncated public header')
                size = int.from_bytes(data[cursor:cursor+4], 'big')
                cursor += 4
            else:
                raise ValueError('partial key packets refused')
        else:
            tag = (header >> 2) & 15
            length = (1, 2, 4, 0)[header & 3]
            if not length or cursor+length > len(data):
                raise ValueError('indeterminate or truncated public header')
            size = int.from_bytes(data[cursor:cursor+length], 'big')
            cursor += length
        if tag not in (2, 6, 10, 12, 13, 14, 17) or cursor+size > len(data):
            raise ValueError('nonpublic or truncated key packet refused')
        primary |= tag == 6
        cursor += size
    if not primary:
        raise ValueError('public primary key required')


def public_key(path, fingerprint):
    safe_path(path, regular=True)
    binary = path.read_bytes()
    if not binary or len(binary) > 1024*1024:
        raise ValueError('bounded public export required')
    with tempfile.TemporaryDirectory(prefix='pliego-public-key-') as home:
        if binary.startswith(b'-----BEGIN '):
            if not binary.startswith(b'-----BEGIN PGP PUBLIC KEY BLOCK-----'):
                raise ValueError('public armor required')
            binary = subprocess.run(['gpg', '--homedir', home, '--batch', '--no-tty', '--no-autostart', '--dearmor'],
                                    input=binary, capture_output=True, check=True).stdout
        reject_private_packets(binary)
        result = subprocess.run(['gpg', '--homedir', home, '--batch', '--no-tty', '--no-autostart', '--with-colons', '--show-keys'],
                                input=binary, capture_output=True, check=True)
    rows = [line.split(':') for line in result.stdout.decode().splitlines()]
    if any(row[0] in ('sec', 'ssb') for row in rows):
        raise ValueError('private key material refused')
    pubs = [i for i, row in enumerate(rows) if row[0] == 'pub']
    if len(pubs) != 1 or rows[pubs[0]+1][0] != 'fpr' or rows[pubs[0]+1][9] != fingerprint:
        raise ValueError('one independently verified primary fingerprint required')
    primary = rows[pubs[0]]
    now = int(dt.datetime.now(dt.timezone.utc).timestamp())
    if primary[1] in ('r', 'e', 'd') or (primary[6] and int(primary[6]) <= now):
        raise ValueError('valid public primary key required')
    if not any(row[0] in ('pub', 'sub') and 'e' in row[11].lower()
               and row[1] not in ('r', 'e', 'd') and (not row[6] or int(row[6]) > now) for row in rows):
        raise ValueError('usable encryption public key required')
    # Normalize to a binary public keyring so armored exports also work with --keyring.
    with tempfile.TemporaryDirectory(prefix='pliego-public-key-') as home:
        subprocess.run(['gpg', '--homedir', home, '--batch', '--no-tty', '--no-autostart', '--import'],
                       input=binary, capture_output=True, check=True)
        return subprocess.run(['gpg', '--homedir', home, '--batch', '--no-tty', '--no-autostart', '--export', fingerprint],
                              capture_output=True, check=True).stdout


def install(args):
    require_root()
    release = args.release
    safe_path(release, root_owned=True)
    if sha(release/'SHA256SUMS') != args.manifest_sha256:
        raise ValueError('manifest pin mismatch')
    if not re.fullmatch('[a-f0-9]{32}', args.account_id):
        raise ValueError('32 lowercase hex R2 account id required')
    fingerprint = args.fingerprint.upper()
    if not re.fullmatch(r'(?:[A-F0-9]{40}|[A-F0-9]{64})', fingerprint):
        raise ValueError('full fingerprint required')
    if not re.fullmatch('[a-z_][a-z0-9_]{0,62}', args.database):
        raise ValueError('safe PostgreSQL database name required')
    version = run('systemd-analyze', '--version', capture=True).stdout.splitlines()[0]
    if int(re.search(r'\b([0-9]{3})\b', version)[1]) < 253:
        raise ValueError('systemd OpenFile requires >=253')
    for binary in ('gpg', 'curl', 'python3', 'tar', 'flock', 'sha256sum', 'systemd-tmpfiles', 'runuser'):
        if not shutil.which(binary):
            raise ValueError('required binary absent')
    if '--aws-sigv4' not in run('curl', '--help', 'all', capture=True).stdout:
        raise ValueError('curl SigV4 support required')
    for binary in ('pg_dump', 'pg_dumpall', 'psql'):
        if not re.search(r'\(PostgreSQL\) 18\.', run('/usr/lib/postgresql/18/bin/'+binary, '--version', capture=True).stdout):
            raise ValueError('PostgreSQL 18 clients required')
    require_idle()
    # Validate all destinations before the first mutation; never follow root-path links.
    targets = [DEST, CONFIG, Path('/etc/systemd/system'), Path('/etc/tmpfiles.d/pliego-deploy-lock.conf')]
    targets += [DEST/n for n in RUNTIME]
    targets += [Path('/etc/systemd/system')/n for n in UNITS]
    targets += [CONFIG/n for n in ('backup.conf', 'object-backup.conf', 'recipients.gpg', 'install.json')]
    targets += [DEST/'ops'/p.name for p in (release/'ops').iterdir()]
    targets += [Path('/etc/systemd/system')/(unit+'.d')/'heartbeat.conf' for unit in DROPS.values()]
    for path in targets:
        safe_path(path, root_owned=True)
    keyring = public_key(args.public_keyring, fingerprint)
    postgres_gid = grp.getgrnam('postgres').gr_gid
    ensure_directory(DEST)
    DEST.chmod(0o755)
    ensure_directory(DEST/'ops')
    (DEST/'ops').chmod(0o755)
    CONFIG.mkdir(mode=0o750, exist_ok=True)
    os.chown(CONFIG, 0, postgres_gid)
    CONFIG.chmod(0o750)
    endpoint = 'https://'+args.account_id+'.r2.cloudflarestorage.com'
    pg = 'PGHOST=/var/run/postgresql\nPGPORT=5432\nPGUSER=postgres\nPGDATABASE='+args.database+'\n'
    db = pg+f'BACKUP_ENDPOINT={endpoint}\nBACKUP_REGION=auto\nBACKUP_BUCKET=pliego-db-backups\nBACKUP_STATE_DIR=/var/lib/pliego-backup\nBACKUP_PUBLIC_KEYRING=/etc/pliego-backup/recipients.gpg\nBACKUP_RECIPIENT={fingerprint}\n'
    invoice = pg+f'OBJECT_BACKUP_ENABLED=1\nOBJECT_SOURCE_ENDPOINT={endpoint}\nOBJECT_SOURCE_BUCKET=billing-pliego\nOBJECT_SOURCE_PREFIX=invoices/\nOBJECT_TARGET_ENDPOINT={endpoint}\nOBJECT_TARGET_BUCKET=pliego-db-backups\nOBJECT_BACKUP_PREFIX=object-backups/v1/\nOBJECT_BACKUP_STATE_DIR=/var/lib/pliego-object-backup\nOBJECT_BACKUP_PUBLIC_KEYRING=/etc/pliego-backup/recipients.gpg\nOBJECT_BACKUP_RECIPIENT={fingerprint}\n'
    installed = {}
    def record(path, data, mode, gid=0):
        put(path, data, mode, gid)
        installed[str(path)] = sha(path)
    for name in RUNTIME:
        record(DEST/name, (release/name).read_bytes(), 0o644 if name.endswith('.sql') else 0o755)
    for path in sorted((release/'ops').iterdir()):
        if path.suffix in ('.sh', '.py', '.conf'):
            record(DEST/'ops'/path.name, path.read_bytes(), 0o755 if path.suffix in ('.py', '.sh') else 0o644)
    record(CONFIG/'backup.conf', db.encode(), 0o640, postgres_gid)
    record(CONFIG/'object-backup.conf', invoice.encode(), 0o640, postgres_gid)
    record(CONFIG/'recipients.gpg', keyring, 0o640, postgres_gid)
    for unit in UNITS:
        record(Path('/etc/systemd/system')/unit, (release/unit).read_bytes(), 0o644)
    for source, unit in DROPS.items():
        record(Path('/etc/systemd/system')/(unit+'.d')/'heartbeat.conf', (release/'ops'/source).read_bytes(), 0o644)
    tmpfiles = Path('/etc/tmpfiles.d/pliego-deploy-lock.conf')
    record(tmpfiles, (release/'pliego-deploy-lock.tmpfiles.conf').read_bytes(), 0o644)
    run('systemd-tmpfiles', '--create', str(tmpfiles))
    lock = Path('/run/lock/pliego-deploy.lock')
    if lock.is_symlink() or not lock.is_file() or lock.stat().st_uid or lock.stat().st_gid or stat.S_IMODE(lock.stat().st_mode) != 0o600:
        raise ValueError('existing deployment lock metadata refused')
    run('systemd-analyze', 'verify', *[str(Path('/etc/systemd/system')/u) for u in UNITS])
    # Existing parents may be private; do not relax their permissions silently.
    for path in (DEST/'backup.sh', DEST/'common.sh', DEST/'invoice-backup.sh',
                 DEST/'object-backup.py', CONFIG/'backup.conf', CONFIG/'object-backup.conf',
                 CONFIG/'recipients.gpg'):
        run('runuser', '-u', 'postgres', '--', '/usr/bin/test', '-r', str(path))
    for name in ('backup.sh', 'invoice-backup.sh', 'deploy-lock.py', 'heartbeat.py'):
        run('runuser', '-u', 'postgres', '--', '/usr/bin/test', '-x', str(DEST/name))
    run('systemctl', 'daemon-reload')
    record(DEST/'SHA256SUMS', (release/'SHA256SUMS').read_bytes(), 0o644)
    receipt = {'schema': 1, 'manifest_sha256': args.manifest_sha256, 'installed_files': installed,
               'fingerprint': fingerprint, 'endpoint': endpoint, 'database': args.database}
    put(CONFIG/'install.json', (json.dumps(receipt, sort_keys=True, indent=2)+'\n').encode(), 0o600)
    print('backup_install_ready timers_not_started manifest_sha256='+args.manifest_sha256)


def check_credential(name):
    path = CONFIG/name
    safe_path(path, root_owned=True, regular=True)
    if path.stat().st_uid or path.stat().st_gid or stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise ValueError('root-only credential required')
    data = json.loads(path.read_text())
    if name in ('heartbeat.json', 'object-heartbeat.json'):
        if not re.fullmatch(r'https://hc-ping\.com/[a-fA-F0-9-]{36}', data['url']):
            raise ValueError('reviewed heartbeat credential required')
    else:
        for key in ('access_key', 'secret_key'):
            if not re.fullmatch('[A-Za-z0-9/+=_-]+', data[key]):
                raise ValueError('invalid credential format')
        expires = dt.datetime.fromisoformat(data['expires_at'].replace('Z', '+00:00'))
        if expires.tzinfo is None or expires <= dt.datetime.now(dt.timezone.utc):
            raise ValueError('unexpired credential required')


def activate(args):
    require_root()
    receipt_path = CONFIG/'install.json'
    safe_path(receipt_path, root_owned=True, regular=True)
    receipt = json.loads(receipt_path.read_text())
    if args.first_run_verified != receipt['manifest_sha256']:
        raise ValueError('first-run review must pin the installed packet')
    for name, expected in receipt['installed_files'].items():
        path = Path(name)
        if not (path.is_relative_to(DEST) or path.is_relative_to(CONFIG)
                or path.is_relative_to('/etc/systemd/system') or path == Path('/etc/tmpfiles.d/pliego-deploy-lock.conf')):
            raise ValueError('receipt destination refused')
        safe_path(path, root_owned=True, regular=True)
        if sha(path) != expected:
            raise ValueError('installed bytes changed; repeat install/review')
    for name in ('s3.json', 'object-source.json', 'object-target.json', 'heartbeat.json', 'object-heartbeat.json'):
        check_credential(name)
    # Local receipts independently prevent scheduling before a completed DB run.
    run('/usr/bin/python3', str(DEST/'freshness.py'))
    run('systemctl', 'enable', '--now', *TIMERS)
    print('backup_timers_activated: verify next UTC firings and both external checks')


def uninstall(_args):
    require_root()
    run('systemctl', 'disable', '--now', *TIMERS)
    # Drain naturally, without cancelling the process or replacing the shared lock.
    for unit in JOBS:
        state = run('systemctl', 'show', unit, '--property=ActiveState', '--value', capture=True).stdout.strip()
        if state not in ('inactive', 'failed'):
            raise ValueError('timers disabled; active backup must drain before further changes')
    print('backup_scheduling_disabled: objects, receipts, credentials and keys preserved')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    build_parser = sub.add_parser('build')
    build_parser.add_argument('--output', type=Path, required=True)
    installer = sub.add_parser('install')
    installer.add_argument('--release', type=Path, required=True)
    installer.add_argument('--manifest-sha256', required=True)
    installer.add_argument('--account-id', required=True)
    installer.add_argument('--fingerprint', required=True)
    installer.add_argument('--public-keyring', type=Path, required=True)
    installer.add_argument('--database', default='pliego')
    activator = sub.add_parser('activate')
    activator.add_argument('--first-run-verified', required=True,
                           help='installed manifest SHA256, supplied after all remote/restore/alert gates pass')
    sub.add_parser('uninstall')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.action == 'build':
            build(args.output)
        else:
            {'install': install, 'activate': activate, 'uninstall': uninstall}[args.action](args)
    except (OSError, ValueError, KeyError, IndexError, TypeError, subprocess.SubprocessError):
        # Never dump credential/config payloads, arbitrary subprocess commands or errors.
        print('backup_packet_failed action='+args.action+'; inspect prerequisites and reviewed policy', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
