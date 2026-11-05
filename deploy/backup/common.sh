#!/usr/bin/env bash
# Shared by reviewed backup/restore tools. Never enable shell tracing.
set -euo pipefail
umask 077
fail() { printf '%s\n' "$*" >&2; exit 1; }
configure_store() {
  : "${BACKUP_ENDPOINT:?}" "${BACKUP_BUCKET:?}" "${CREDENTIALS_DIRECTORY:?}"
  if [[ ${PLIEGO_BACKUP_TEST_LOCAL:-0} == 1 ]]; then
    [[ $BACKUP_ENDPOINT =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || fail 'Local store must use loopback'
  else
    [[ $BACKUP_ENDPOINT =~ ^https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com$ ]] || fail 'Expected reviewed R2 HTTPS account endpoint'
  fi
  [[ $BACKUP_BUCKET =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || fail 'Invalid bucket'
  # LoadCredential exposes a private file. The secret never enters argv or logs.
  python3 - "$CREDENTIALS_DIRECTORY/s3.json" "$WORK/curl.conf" <<'PY'
import datetime,json,os,re,sys
c=json.load(open(sys.argv[1]))
for k in ('access_key','secret_key'):
    if not re.fullmatch(r'[A-Za-z0-9/+=_-]+',c[k]): raise SystemExit('Invalid credential encoding')
expiry=datetime.datetime.fromisoformat(c['expires_at'].replace('Z','+00:00'))
if expiry.tzinfo is None or expiry <= datetime.datetime.now(datetime.timezone.utc):
    raise SystemExit('Backup credential expired; upload/download refused')
with open(sys.argv[2],'w') as f: f.write('user = "'+c['access_key']+':'+c['secret_key']+'"\n')
os.chmod(sys.argv[2],0o600)
PY
}
store() {
  local method=$1 key=$2 file=$3
  [[ $key =~ ^[A-Za-z0-9/_\.-]+$ && $key != *..* ]] || fail 'Unsafe object key'
  local args=(--silent --show-error --fail --noproxy '*' --connect-timeout 10 --max-time 180
    --retry 2 --retry-delay 2 --aws-sigv4 "aws:amz:${BACKUP_REGION:-auto}:s3" --config "$WORK/curl.conf")
  if [[ $method == PUT ]]; then
    args+=(--upload-file "$file" --header "x-amz-content-sha256:$(sha256sum "$file" | cut -d' ' -f1)")
  elif [[ $method == GET ]]; then args+=(--output "$file")
  elif [[ $method == COPY ]]; then
    [[ $file =~ ^[A-Za-z0-9/_\.-]+$ && $file != *..* ]] || fail 'Unsafe copy source'
    args+=(--request PUT --header "x-amz-copy-source:/$BACKUP_BUCKET/$file" --output "$WORK/copy-result.xml")
  else fail 'Unsupported S3 operation'; fi
  curl "${args[@]}" "$BACKUP_ENDPOINT/$BACKUP_BUCKET/$key"
  if [[ $method == COPY ]]; then
    # CopyObject may return HTTP 200 with an embedded error. Fail closed.
    python3 - "$WORK/copy-result.xml" <<'PYCOPY'
import sys,xml.etree.ElementTree as ET
root=ET.parse(sys.argv[1]).getroot()
if root.tag.rsplit('}',1)[-1] != 'CopyObjectResult':
    raise SystemExit('CopyObject did not return a success result')
PYCOPY
  fi
}
