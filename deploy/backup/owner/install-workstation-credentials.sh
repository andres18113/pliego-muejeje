#!/usr/bin/env bash
# OWNER ONLY: a dedicated restore reader; no private key or network use here.
set +xv
set -euo pipefail
umask 077
ulimit -c 0
[[ $EUID != 0 && $# == 0 ]] || { printf '%s\n' 'Run as your workstation user, without sudo or arguments.' >&2; exit 1; }
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export -n restore_access restore_secret
exec 3<>/dev/tty
trap 'unset restore_access restore_secret' EXIT
IFS= read -r -p 'Absolute private directory outside repositories/evidence (parent must exist): ' credential_directory <&3
IFS= read -rs -p 'Owner: restore-reader Access Key ID: ' restore_access <&3; printf '\n' >&3
IFS= read -rs -p 'Owner: restore-reader Secret Access Key: ' restore_secret <&3; printf '\n' >&3
IFS= read -r -p 'Actual dashboard expiry UTC (YYYY-MM-DDTHH:MM:SSZ, <=90d): ' restore_expiry <&3
printf '%s\0' "$restore_access" "$restore_secret" "$restore_expiry" |
  python3 "$HERE/owner-credentials.py" workstation "$credential_directory"
