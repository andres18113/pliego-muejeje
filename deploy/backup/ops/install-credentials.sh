#!/usr/bin/env bash
# OWNER ONLY in a private terminal. No logging, tracing, piping or screen recording.
set +xv
set -euo pipefail
umask 077
ulimit -c 0
[[ $EUID == 0 && $# == 0 ]] || { printf '%s\n' 'Run as root, without arguments.' >&2; exit 1; }
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export -n writer_access writer_secret source_access source_secret
exec 3<>/dev/tty
trap 'unset writer_access writer_secret source_access source_secret' EXIT
printf '%s\n' 'Owner: enter dedicated backup-bucket WRITER values; input is hidden.' >&3
IFS= read -rs -p 'Access Key ID: ' writer_access <&3; printf '\n' >&3
IFS= read -rs -p 'Secret Access Key: ' writer_secret <&3; printf '\n' >&3
IFS= read -r -p 'Actual dashboard expiry UTC (YYYY-MM-DDTHH:MM:SSZ, <=90d): ' writer_expiry <&3
printf '%s\n' 'Owner: enter separate billing-pliego READ ONLY values; input is hidden.' >&3
IFS= read -rs -p 'Access Key ID: ' source_access <&3; printf '\n' >&3
IFS= read -rs -p 'Secret Access Key: ' source_secret <&3; printf '\n' >&3
IFS= read -r -p 'Actual dashboard expiry UTC (YYYY-MM-DDTHH:MM:SSZ, <=90d): ' source_expiry <&3
# printf is a Bash builtin; values flow through a pipe, never process arguments.
printf '%s\0' "$writer_access" "$writer_secret" "$writer_expiry" "$source_access" "$source_secret" "$source_expiry" |
  python3 "$HERE/owner-credentials.py" vps /etc/pliego-backup
