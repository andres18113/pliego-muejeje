#!/usr/bin/env bash
# Scheduling rollback only. Preserves scripts, config, keys, receipts and objects.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
unset PYTHONPATH PYTHONHOME
exec /usr/bin/python3 -I /opt/pliego/backup/ops/packet.py uninstall "$@"
