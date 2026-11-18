#!/usr/bin/env bash
# Downloads/verifies/decrypts only; destructive DB restore remains an explicit operator command.
set -euo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$HERE/common.sh"
: "${RESTORE_KEY:?}" "${RESTORE_OUTPUT:?}" "${RESTORE_GNUPGHOME:?}"
[[ ! -e $RESTORE_OUTPUT ]] || fail 'Restore output must not exist'
mkdir -m 700 "$RESTORE_OUTPUT"
WORK=$(mktemp -d "$RESTORE_OUTPUT/.transport.XXXXXXXX")
trap 'rm -rf -- "$WORK"' EXIT
configure_store
store GET "$RESTORE_KEY/complete.json" "$WORK/complete.json"
store GET "$RESTORE_KEY/backup.tar.gpg" "$WORK/backup.tar.gpg"
store GET "$RESTORE_KEY/backup.tar.gpg.sha256" "$WORK/backup.tar.gpg.sha256"
(cd "$WORK" && sha256sum --check --strict backup.tar.gpg.sha256)
python3 - "$WORK" <<'PY'
import hashlib,json,os,pathlib,sys
p=pathlib.Path(sys.argv[1]); m=json.loads((p/'complete.json').read_text()); b=(p/'backup.tar.gpg').read_bytes()
assert m['sha256']==hashlib.sha256(b).hexdigest() and m['bytes']==len(b),'Completion manifest mismatch'
expected=os.environ.get('RESTORE_EXPECTED_SHA256')
assert expected is None or m['sha256']==expected,'Completion changed since verifier selected it'
PY
# Verify GPG integrity fully before extracting any plaintext.
gpg --batch --no-tty --homedir "$RESTORE_GNUPGHOME" --output "$WORK/backup.tar" --decrypt "$WORK/backup.tar.gpg"
# Fixed members only: an operator never extracts arbitrary archive paths.
tar -xf "$WORK/backup.tar" -C "$RESTORE_OUTPUT" -- database.dump globals.sql SHA256SUMS versions.txt backup-id.txt
(cd "$RESTORE_OUTPUT" && sha256sum --check --strict SHA256SUMS)
printf 'restore_archive_verified id=%s\n' "$(cat "$RESTORE_OUTPUT/backup-id.txt")"
