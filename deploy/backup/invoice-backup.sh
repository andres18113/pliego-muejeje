#!/usr/bin/env bash
set -euo pipefail
umask 077
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# This wrapper is reached only after deploy-lock.py owns the shared lock.
# A skipped gate must never reach this success hook.
python3 "$HERE/object-backup.py" copy
if [[ ${BACKUP_HEARTBEAT_ENABLED:-0} == 1 ]]; then
  "$HERE/heartbeat.py" success || printf '%s\n' 'backup_heartbeat_warning: helper failed; invoice backup status unchanged' >&2
fi
