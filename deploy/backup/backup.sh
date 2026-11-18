#!/usr/bin/env bash
set -euo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$HERE/common.sh"
: "${BACKUP_STATE_DIR:?}" "${BACKUP_PUBLIC_KEYRING:?}" "${BACKUP_RECIPIENT:?}"
[[ $BACKUP_RECIPIENT =~ ^[A-Fa-f0-9]{40,64}$ ]] || fail 'Pin the complete encryption fingerprint'
mkdir -p "$BACKUP_STATE_DIR/work" "$BACKUP_STATE_DIR/retention"
chmod 700 "$BACKUP_STATE_DIR" "$BACKUP_STATE_DIR/work"
exec 9>"$BACKUP_STATE_DIR/backup.lock"
flock -n 9 || fail 'A backup is already running'
WORK=$(mktemp -d "$BACKUP_STATE_DIR/work/run.XXXXXXXX")
trap 'rm -rf -- "$WORK"' EXIT
configure_store
started=$(date +%s)
# LOCAL TEST ONLY: injected UTC clock is ignored unless the loopback test gate is on.
backup_date() {
  if [[ ${PLIEGO_BACKUP_TEST_LOCAL:-0} == 1 && -n ${BACKUP_TEST_NOW:-} ]]; then
    [[ $BACKUP_TEST_NOW =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || fail 'Invalid local test clock'
    date -u --date="$BACKUP_TEST_NOW" "$1"
  else date -u "$1"; fi
}
snapshot_time=$(backup_date +%FT%TZ)
stamp=$(date -u --date="$snapshot_time" +%Y%m%dT%H%M%SZ)
# Pin periods to the dump start: crossing a UTC boundary cannot label an older
# snapshot as the next period. A later run promotes that next period.
day=$(date -u --date="$snapshot_time" +%F)
week=$(date -u --date="$snapshot_time" +%G-W%V)
month=$(date -u --date="$snapshot_time" +%Y-%m)
run_id="$stamp-$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
export PGCONNECT_TIMEOUT=10
# Peer-authenticated local postgres service, no stored database password.
pg_dump --create --format=custom --compress=gzip:6 --file="$WORK/database.dump" --dbname="${PGDATABASE:-pliego}"
# Exclude role password verifiers: restore operator resets runtime passwords offline.
pg_dumpall --globals-only --no-role-passwords --file="$WORK/globals.sql"
(cd "$WORK" && sha256sum database.dump globals.sql > SHA256SUMS)
pg_dump --version > "$WORK/versions.txt"
printf '%s\n' "$run_id" > "$WORK/backup-id.txt"
# Cipher uses a public-only keyring; recipient secret key must never be on VPS.
mkdir "$WORK/gnupg"
chmod 700 "$WORK/gnupg"
tar -C "$WORK" -cf - database.dump globals.sql SHA256SUMS versions.txt backup-id.txt |
  gpg --batch --no-tty --homedir "$WORK/gnupg" --no-default-keyring --keyring "$BACKUP_PUBLIC_KEYRING" \
    --trust-model always --recipient "$BACKUP_RECIPIENT" --compress-algo none --cipher-algo AES256 --encrypt --output "$WORK/backup.tar.gpg"
(cd "$WORK" && sha256sum backup.tar.gpg > backup.tar.gpg.sha256)
size=$(stat -c %s "$WORK/backup.tar.gpg")
# Single PUT is bounded below R2's limit; stop and review growth before 1 GiB.
(( size < 1073741824 )) || fail 'Backup exceeds reviewed single-PUT size ceiling'
# Missing, corrupt or lost local state always means promote again, never skip.
prefixes=(frequent)
for tier in daily weekly monthly; do
  case $tier in daily) period=$day;; weekly) period=$week;; monthly) period=$month;; esac
  previous=$(python3 - "$BACKUP_STATE_DIR/retention/$tier.json" <<'PYMARKER'
import json,sys
try:
    m=json.load(open(sys.argv[1])); print(m.get('period',''))
except (OSError,ValueError,AttributeError): pass
PYMARKER
)
  [[ $previous == "$period" ]] || prefixes+=("$tier")
done
# LOCAL TEST ONLY: retained for the native regression harness.
if [[ ${PLIEGO_BACKUP_TEST_LOCAL:-0} == 1 && ${BACKUP_TEST_ALL_PREFIXES:-0} == 1 ]]; then prefixes=(frequent daily weekly monthly); fi
for tier in "${prefixes[@]}"; do
  key="$tier/$run_id"
  if [[ $tier == frequent ]]; then
    store PUT "$key/backup.tar.gpg" "$WORK/backup.tar.gpg"
    store PUT "$key/backup.tar.gpg.sha256" "$WORK/backup.tar.gpg.sha256"
  else
    # R2 and Moto implement CopyObject. Destination GET still proves byte parity.
    store COPY "$key/backup.tar.gpg" "frequent/$run_id/backup.tar.gpg"
    store COPY "$key/backup.tar.gpg.sha256" "frequent/$run_id/backup.tar.gpg.sha256"
  fi
  store GET "$key/backup.tar.gpg" "$WORK/readback.gpg"
  cmp --silent "$WORK/backup.tar.gpg" "$WORK/readback.gpg" || fail 'Uploaded ciphertext readback mismatch'
  store GET "$key/backup.tar.gpg.sha256" "$WORK/readback.sha256"
  cmp --silent "$WORK/backup.tar.gpg.sha256" "$WORK/readback.sha256" || fail 'Uploaded checksum readback mismatch'
  case $tier in frequent|daily) period=$day;; weekly) period=$week;; monthly) period=$month;; esac
  printf '{"id":"%s","sha256":"%s","bytes":%s,"completed_at":"%s","period":"%s","tier":"%s"}\n' "$run_id" \
    "$(sha256sum "$WORK/backup.tar.gpg" | cut -d' ' -f1)" "$size" "$(backup_date +%FT%TZ)" "$period" "$tier" > "$WORK/complete.json"
  store PUT "$key/complete.json" "$WORK/complete.json"
  # Same-filesystem rename publishes a receipt only after the complete remote set.
  # A crash before rename can cause an extra immutable promotion, never a skip.
  cp "$WORK/complete.json" "$BACKUP_STATE_DIR/retention/$tier.json.tmp"
  mv "$BACKUP_STATE_DIR/retention/$tier.json.tmp" "$BACKUP_STATE_DIR/retention/$tier.json"
  if [[ $tier == frequent ]]; then
    cp "$WORK/complete.json" "$BACKUP_STATE_DIR/last-success.json.tmp"
    mv "$BACKUP_STATE_DIR/last-success.json.tmp" "$BACKUP_STATE_DIR/last-success.json"
  fi
done
printf 'backup_success id=%s bytes=%s duration_seconds=%s prefixes=%s\n' "$run_id" "$size" "$(( $(date +%s)-started ))" "${prefixes[*]}"
# Only an owner-installed LoadCredential drop-in enables the external dead-man ping.
# Even an unexpectedly failing helper must not turn verified backup bytes into failure.
if [[ ${BACKUP_HEARTBEAT_ENABLED:-0} == 1 ]]; then
  "$HERE/heartbeat.py" success || printf 'backup_heartbeat_warning: helper failed; backup status unchanged\n' >&2
fi
