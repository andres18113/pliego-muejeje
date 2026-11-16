#!/usr/bin/env python3
"""Local installer backend: NUL-delimited values on stdin, fixed safe diagnostics."""
import datetime as dt
import grp
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


def private_directory(path, root=False):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError('Use an absolute path without symlinks')
    if root:
        if os.geteuid() != 0 or path != Path('/etc/pliego-backup'):
            raise ValueError('Root and the fixed production credential directory are required')
        if not path.exists():
            path.mkdir(mode=0o750)
            path.chmod(0o750)
            os.chown(path, 0, grp.getgrnam('postgres').gr_gid)
        s = path.stat()
        if s.st_uid != 0 or s.st_gid != grp.getgrnam('postgres').gr_gid or stat.S_IMODE(s.st_mode) != 0o750:
            raise ValueError('Credential directory must be root:postgres 0750')
    else:
        if os.geteuid() == 0:
            raise ValueError('Run workstation installer as the owner, without sudo')
        for parent in (path, *path.parents):
            if parent.name == '.release-evidence' or (parent / '.git').exists():
                raise ValueError('Workstation credentials must be outside every repository and evidence directory')
        if not path.exists():
            path.mkdir(mode=0o700)
        s = path.stat()
        if s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o700:
            raise ValueError('Workstation credential directory must be owner-owned 0700')
    if not path.is_dir():
        raise ValueError('Expected private directory')
    return path


def credential(access, secret, expiry):
    if not re.fullmatch(r'[A-Za-z0-9/+=_-]{16,256}', access) or not re.fullmatch(r'[A-Za-z0-9/+=_-]{32,256}', secret):
        raise ValueError('Credential encoding/length rejected; no values printed')
    if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', expiry):
        raise ValueError('Expiry must match dashboard expiry in UTC YYYY-MM-DDTHH:MM:SSZ')
    expires = dt.datetime.fromisoformat(expiry.replace('Z', '+00:00'))
    now = dt.datetime.now(dt.timezone.utc)
    if not now < expires <= now + dt.timedelta(days=90):
        raise ValueError('Expiry must be in the future and at most 90 days away')
    return {'access_key': access, 'secret_key': secret, 'expires_at': expiry}


def write_json(directory, name, data):
    target = directory / name
    if target.is_symlink() or (target.exists() and not target.is_file()):
        raise ValueError('Refusing non-regular credential target')
    descriptor, temporary = tempfile.mkstemp(prefix='.owner-install-', dir=directory)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), 0, 0)
            json.dump(data, stream)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        directory_fd = os.open(directory, os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(name + ': installed 0600; values hidden')


def main():
    mode, location = sys.argv[1:]
    directory = private_directory(location, root=mode in ('vps', 'pings'))
    raw = sys.stdin.buffer.read(4097)
    if len(raw) > 4096:
        raise ValueError('Input too long')
    values = raw.decode('ascii').split('\0')
    if values[-1] != '':
        raise ValueError('Input framing rejected')
    values.pop()
    if mode == 'vps' and len(values) == 6:
        writer = credential(*values[:3])
        source = credential(*values[3:])
        if writer['access_key'] == source['access_key']:
            raise ValueError('Writer and source-reader must be distinct credentials')
        for name, data in [('s3.json', writer), ('object-target.json', writer), ('object-source.json', source)]:
            write_json(directory, name, data)
        print('Writer expires_at=' + writer['expires_at'] + '; source-reader expires_at=' + source['expires_at'])
    elif mode == 'workstation' and len(values) == 3:
        reader = credential(*values)
        for name in ('s3.json', 'object-target.json'):
            write_json(directory, name, reader)
        print('Restore-reader expires_at=' + reader['expires_at'])
    elif mode == 'pings' and len(values) == 2:
        if values[0] == values[1]:
            raise ValueError('DB and invoice checks must be distinct')
        if not all(re.fullmatch(r'https://hc-ping\.com/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}', value) for value in values):
            raise ValueError('Expected default Healthchecks HTTPS UUID ping URLs; values hidden')
        for name, value in zip(('heartbeat.json', 'object-heartbeat.json'), values):
            write_json(directory, name, {'url': value})
    else:
        raise ValueError('Installer mode/input rejected')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Exceptions can contain the offending input. Never format them.
        print('Credential install failed: check directory ownership/mode, distinct credentials, encoding and actual UTC expiry (maximum 90 days). Values hidden.', file=sys.stderr)
        sys.exit(1)
