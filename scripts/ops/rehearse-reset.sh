#!/usr/bin/env bash
# Local only. The Python driver creates and owns a new PG18 cluster; it never
# consumes a database URI, remote host, .env file or production credentials.
set -euo pipefail
umask 077
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 -B "$script_dir/rehearse-reset.py" "$@"
