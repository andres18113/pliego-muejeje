#!/usr/bin/env python3
"""Hold the existing deploy lock using a descriptor opened by systemd PID1.

OpenFile= passes the existing root-owned lock read-only to User=postgres. All
original hardening remains active. Never create/truncate/chmod/chown/unlink it.
"""
import fcntl
import argparse
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

LOCK = '/run/lock/pliego-deploy.lock'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', choices=('db', 'invoices'), default='db')
    args = parser.parse_args()
    local = os.environ.get('PLIEGO_BACKUP_TEST_LOCAL') == '1'
    lock = os.environ.get('BACKUP_TEST_DEPLOY_LOCK', LOCK) if local else LOCK
    if local:
        # Never let test overrides open the real operator lock.
        resolved = Path(lock).resolve()
        root = Path(__file__).resolve().parents[2]/'.release-evidence/2026-11-05-gaps'
        if not resolved.is_relative_to(root):
            raise ValueError('Local stand-in lock must be under gaps evidence')
        command = json.loads(os.environ['BACKUP_TEST_LOCK_COMMAND'])
        if not isinstance(command,list) or not command or not all(isinstance(v,str) for v in command):
            raise ValueError('Invalid local test command')
        fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    else:
        # systemd >=253 supplies OpenFile descriptors starting at fd3. Refuse
        # direct execution or an unexpected activation set; never open root paths.
        if (os.environ.get('LISTEN_PID') != str(os.getpid())
                or os.environ.get('LISTEN_FDS') != '1'
                or os.environ.get('LISTEN_FDNAMES') != 'deploy-lock'):
            raise ValueError('Expected the reviewed systemd OpenFile descriptor')
        fd = 3
        executable = 'backup.sh' if args.job == 'db' else 'invoice-backup.sh'
        command = [str(Path(__file__).resolve().with_name(executable))]
    try:
        metadata = os.fstat(fd)
        if not local:
            opened = os.stat(LOCK, follow_symlinks=False)
            if (opened.st_dev,opened.st_ino) != (metadata.st_dev,metadata.st_ino):
                raise ValueError('Deploy lock path changed after descriptor open')
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise ValueError('Deploy lock is not an existing regular file')
        if not local and (metadata.st_uid != 0 or metadata.st_mode & 0o022):
            raise ValueError('Deploy lock must be root-owned and not group/world writable')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('backup_skipped_deploy_lock: deployment or backup in progress; receipts unchanged',flush=True)
            return 0
        # Inheritance retains the lock even if the wrapper dies before its child.
        # backup.sh uses fd9 for its own lock; this descriptor is separate.
        child_env = {k:v for k,v in os.environ.items() if k not in ('LISTEN_PID','LISTEN_FDS','LISTEN_FDNAMES')}
        status = subprocess.run(command, pass_fds=(fd,), env=child_env, check=False).returncode
        return status if status >= 0 else 128-status
    finally:
        os.close(fd)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError,ValueError,KeyError):
        # No config/credential payloads or arbitrary command text in logs.
        print('backup_deploy_gate_failed: check existing lock and reviewed service configuration',file=sys.stderr)
        sys.exit(1)
