#!/usr/bin/env bash
# OWNER ONLY, own terminal. Creates temporary admin auth outside repo/evidence.
set +xv
set -euo pipefail
ulimit -c 0
export -n token_value 2>/dev/null || true
umask 077
[[ $# == 1 && -t 0 ]] || { printf 'Usage: cloudflare-auth.sh /private/outside-repo/cloudflare-admin.curl (owner terminal)\n' >&2; exit 1; }
credential_path=$(realpath -m -- "$1")
credential_parent=$(dirname -- "$credential_path")
[[ ! -L $1 && ! -L $(dirname -- "$1") && $(stat -c %u -- "$credential_parent") == "$EUID" && $(stat -c %a -- "$credential_parent") == 700 ]] || { printf 'Parent must be owner-owned mode0700; no symlink file\n' >&2; exit 1; }
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
case "$credential_path" in "$repo_root"/*) printf 'Auth file must be outside repository/evidence\n' >&2; exit 1;; esac
python3 - "$credential_path" <<'PYBOUNDARY'
from pathlib import Path
import sys
p = Path(sys.argv[1]).resolve()
if any(a.name == '.release-evidence' or (a/'.git').exists() for a in (p, *p.parents)):
    raise SystemExit('Auth file must be outside every repository/evidence directory')
PYBOUNDARY
[[ -d $(dirname -- "$credential_path") && ! -e $credential_path && ! -L $credential_path ]] || { printf 'Use a NEW file in a private existing directory\n' >&2; exit 1; }
read -rs -p 'Temporary Cloudflare admin API token: ' token_value < /dev/tty
printf '\n' >&2
export -n token_value
[[ $token_value =~ ^[A-Za-z0-9_-]{20,200}$ ]] || { unset token_value; printf 'Invalid token encoding\n' >&2; exit 1; }
set -o noclobber
printf 'header = "Authorization: Bearer %s"\n' "$token_value" > "$credential_path"
unset token_value
chmod 0600 "$credential_path"
printf 'Temporary admin auth installed mode=0600; owner must remove file and revoke token after provisioning\n'
