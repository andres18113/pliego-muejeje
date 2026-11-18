#!/usr/bin/env bash
set -euo pipefail
umask 077
# Root-only curl configuration must specify an approved alert receiver URL, auth and
# request=POST; no customer data or backup credential is included in the body.
logger -p daemon.err -t pliego-backup 'Backup/freshness failure; operator action required'
: "${CREDENTIALS_DIRECTORY:?}"
curl --silent --show-error --fail --connect-timeout 10 --max-time 30 \
  --config "$CREDENTIALS_DIRECTORY/alert.curl" --data 'PLIEGO backup or freshness check failed'
