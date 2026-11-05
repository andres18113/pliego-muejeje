#!/usr/bin/env bash
# Read-only Phase A. Run as root on the VPS; never source the application env.
set +x
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'preflight_requires_root' >&2; exit 1; }
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/preflight-facts.py"
