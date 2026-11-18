#!/usr/bin/env bash
# Review this bootstrap and pin SHA256SUMS independently before root execution.
set -euo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
unset PYTHONPATH PYTHONHOME
python3 -I - "$@" <<'PY'
import hashlib, os, pathlib, re, stat, sys
try:
    args = sys.argv[1:]
    if args.count('--release') != 1 or args.count('--manifest-sha256') != 1:
        raise ValueError('exactly one release and manifest pin required')
    release = pathlib.Path(args[args.index('--release')+1])
    pin = args[args.index('--manifest-sha256')+1]
    if not release.is_absolute() or release.is_symlink() or not release.is_dir():
        raise ValueError('absolute regular release directory required')
    if not re.fullmatch('[a-f0-9]{64}', pin):
        raise ValueError('independent SHA256SUMS pin required')
    # No packet program or library is executed until every payload is verified.
    manifest = release/'SHA256SUMS'
    if manifest.is_symlink() or not manifest.is_file():
        raise ValueError('regular manifest required')
    data = manifest.read_bytes()
    if hashlib.sha256(data).hexdigest() != pin:
        raise ValueError('manifest pin mismatch')
    seen = set()
    for line in data.decode('ascii').splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  ([a-zA-Z0-9][a-zA-Z0-9/_.-]*)', line)
        if not match:
            raise ValueError('invalid manifest entry')
        sha, name = match.groups()
        parts = pathlib.PurePosixPath(name).parts
        if any(p in ('.', '..') for p in parts) or name in seen or name == 'SHA256SUMS':
            raise ValueError('unsafe or duplicate manifest path')
        seen.add(name)
        file = release/name
        for component in (file, *file.parents):
            if component == release.parent:
                break
            if component.is_symlink():
                raise ValueError('symlink in packet')
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != sha:
            raise ValueError('payload digest mismatch')
    actual = set()
    for file in release.rglob('*'):
        if file.is_symlink() or not (file.is_file() or file.is_dir()):
            raise ValueError('nonregular packet entry')
        if file.is_file() and file != manifest:
            actual.add(file.relative_to(release).as_posix())
    if actual != seen or not {'ops/packet.py', 'ops/install.sh', 'backup.sh'} <= seen:
        raise ValueError('incomplete or unlisted packet payload')
    if '--verify-only' not in args:
        if os.geteuid() != 0:
            raise ValueError('root required')
        # Prevent payload replacement between verification and execution.
        for component in [release, *release.parents, *release.rglob('*')]:
            info = component.stat()
            if component.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
                if not (component == pathlib.Path('/tmp') and info.st_uid == 0 and info.st_mode & stat.S_ISVTX):
                    raise ValueError('packet and parents must be root-owned and non-writable')
    if '--verify-only' in args:
        print('packet_verified manifest_sha256='+pin)
    else:
        # Verified code is invoked in isolated Python mode with a fixed executable.
        os.execv('/usr/bin/python3', ['python3', '-I', str(release/'ops/packet.py'), 'install', *args])
except (ValueError, OSError, IndexError, UnicodeError):
    print('packet_refused: check manifest pin, regular paths and payload hashes', file=sys.stderr)
    sys.exit(1)
PY
