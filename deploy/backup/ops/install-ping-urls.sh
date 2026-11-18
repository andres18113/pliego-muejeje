#!/usr/bin/env bash
# OWNER ONLY: run after creating separate DB and invoice checks, never under capture.
set +xv
set -euo pipefail
umask 077
ulimit -c 0
[[ $EUID == 0 && $# == 0 ]] || { printf '%s\n' 'Run as root, without arguments.' >&2; exit 1; }
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export -n db_ping invoice_ping
exec 3<>/dev/tty
trap 'unset db_ping invoice_ping' EXIT
IFS= read -rs -p 'Owner: default UUID ping URL for DATABASE check: ' db_ping <&3; printf '\n' >&3
IFS= read -rs -p 'Owner: default UUID ping URL for INVOICES check: ' invoice_ping <&3; printf '\n' >&3
printf '%s\0' "$db_ping" "$invoice_ping" | python3 "$HERE/owner-credentials.py" pings /etc/pliego-backup
