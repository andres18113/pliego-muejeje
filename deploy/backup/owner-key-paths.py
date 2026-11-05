#!/usr/bin/env python3
"""Validate owner-specified locations without reading or generating keys."""
import os
from pathlib import Path
import stat
import sys


def check(path, fresh=False):
    p = Path(path)
    if not p.is_absolute() or p.resolve() != p or '\n' in path:
        raise ValueError('Use absolute paths without symlinks or newlines')
    for parent in (p, *p.parents):
        if parent.name == '.release-evidence' or (parent / '.git').exists():
            raise ValueError('Key ceremony paths must be outside repositories/evidence')
    if fresh:
        if p.exists() or not p.parent.is_dir():
            raise ValueError('Dedicated GNUPGHOME must be new, with an existing parent')
    else:
        info = p.stat()
        if not p.is_dir() or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError('Output directories must exist, owner-owned mode 0700')
    return p


def main():
    if os.geteuid() == 0:
        raise ValueError('Owner workstation only; no sudo')
    home, public, first, second = sys.argv[1:]
    paths = [check(home, fresh=True), check(public), check(first), check(second)]
    for n, p in enumerate(paths):
        for q in paths[n + 1:]:
            if p == q or p in q.parents or q in p.parents:
                raise ValueError('Choose four separate, non-nested ceremony locations')
    if paths[2].stat().st_dev == paths[3].stat().st_dev:
        raise ValueError('Private-key copies require two independently mounted filesystems/media')
    for directory, names in [(paths[1], ('recipients.gpg', 'fingerprint.txt')), (paths[2], ('pliego-private-key.gpg',)), (paths[3], ('pliego-private-key.gpg',))]:
        for name in names:
            if (directory / name).exists() or (directory / name).is_symlink():
                raise ValueError('Refusing to overwrite existing export')
    paths[0].mkdir(mode=0o700)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Key path validation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
