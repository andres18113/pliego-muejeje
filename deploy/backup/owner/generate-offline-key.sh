#!/usr/bin/env bash
# OWNER ONLY. NEVER run on VPS, in automation, or while terminal capture is active.
# Codex/Claude must not execute this script. Passphrases go only through pinentry.
set +xv
set -euo pipefail
umask 077
ulimit -c 0
[[ $EUID != 0 && $# == 0 ]] || { printf '%s\n' 'Run as the workstation owner, without sudo or arguments.' >&2; exit 1; }
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
for binary in gpg gpgconf python3 cmp mktemp pinentry; do
  command -v "$binary" >/dev/null || { printf 'Required binary missing: %s\n' "$binary" >&2; exit 1; }
done
exec 3<>/dev/tty
GPG_TTY=$(tty <&3)
export GPG_TTY
printf '%s\n' 'Disconnect network; unlock two independent encrypted removable media.' \
  'Keep terminal capture, shell tracing, clipboard history and screen sharing OFF.' \
  'Use a fresh random passphrase (at least 6 random words, >=24 characters); store separately.' >&3
IFS= read -r -p 'Type OWNER-OFFLINE-PRIVATE-TERMINAL to attest local private ceremony: ' ceremony <&3
[[ $ceremony == OWNER-OFFLINE-PRIVATE-TERMINAL ]] || exit 1
IFS= read -r -p 'Fresh dedicated GNUPGHOME absolute path (outside all repos/evidence): ' key_home <&3
IFS= read -r -p 'Existing owner-owned 0700 directory for PUBLIC exports: ' public_dir <&3
IFS= read -r -p 'Existing owner-owned 0700 directory on private backup MEDIA A: ' media_a <&3
IFS= read -r -p 'Existing owner-owned 0700 directory on independent MEDIA B: ' media_b <&3
python3 "$HERE/owner-key-paths.py" "$key_home" "$public_dir" "$media_a" "$media_b"
export GNUPGHOME="$key_home"
test_home=''
cleanup() {
  if [[ -n $test_home && -d $test_home ]]; then
    gpgconf --homedir "$test_home" --kill gpg-agent || true
    rm -rf -- "$test_home"
  fi
  gpgconf --homedir "$key_home" --kill gpg-agent || true
}
trap cleanup EXIT
# Only this new dedicated home is configured. Empty passphrases cannot be accepted.
cat > "$GNUPGHOME/gpg-agent.conf" <<'CONF'
enforce-passphrase-constraints
min-passphrase-len 24
min-passphrase-nonalpha 0
no-allow-external-cache
no-allow-loopback-pinentry
default-cache-ttl 60
max-cache-ttl 120
CONF
cat > "$GNUPGHOME/gpg.conf" <<'CONF'
rfc4880
no-auto-key-retrieve
no-auto-key-import
personal-cipher-preferences AES256 AES192 AES
cert-digest-algo SHA512
s2k-cipher-algo AES256
s2k-digest-algo SHA512
CONF
# No batch mode, loopback, passphrase option, shell variable or secret argument.
gpg --pinentry-mode ask --quick-generate-key 'PLIEGO offline backup recovery' rsa4096 cert,sign 3y
fingerprint=$(gpg --with-colons --list-secret-keys | awk -F: '$1=="fpr" && !f {f=$10} END {print f}')
[[ $fingerprint =~ ^[A-F0-9]{40}$ ]] || { printf '%s\n' 'Full RSA fingerprint missing; stop.' >&2; exit 1; }
gpg --pinentry-mode ask --quick-add-key "$fingerprint" rsa4096 encr 3y
gpg --output "$public_dir/recipients.gpg" --export "$fingerprint"
printf '%s\n' "$fingerprint" > "$public_dir/fingerprint.txt"
# Each media gets a full export of primary + encryption subkey; no stdout export.
for media in "$media_a" "$media_b"; do
  gpg --pinentry-mode ask --output "$media/pliego-private-key.gpg" --export-secret-keys "$fingerprint"
  chmod 600 "$media/pliego-private-key.gpg"
  python3 "$HERE/owner-protected-key.py" "$media/pliego-private-key.gpg"
done
printf '%s\n' 'PLIEGO offline recovery self-test; this contains no production data.' > "$GNUPGHOME/self-test.txt"
gpg --batch --trust-model always --cipher-algo AES256 --recipient "$fingerprint" \
  --output "$GNUPGHOME/self-test.gpg" --encrypt "$GNUPGHOME/self-test.txt"
# Import each exported copy into its own fresh media-local home, kill its agent,
# then require an attended decrypt. This proves both media copies can recover.
for media in "$media_a" "$media_b"; do
  test_home=$(mktemp -d "$media/pliego-selftest.XXXXXXXX")
  chmod 700 "$test_home"
  cp "$key_home/gpg-agent.conf" "$test_home/gpg-agent.conf"
  gpg --homedir "$test_home" --import "$media/pliego-private-key.gpg"
  gpgconf --homedir "$test_home" --kill gpg-agent
  gpg --homedir "$test_home" --pinentry-mode ask --output "$test_home/recovered.txt" --decrypt "$key_home/self-test.gpg"
  cmp -- "$key_home/self-test.txt" "$test_home/recovered.txt"
  gpgconf --homedir "$test_home" --kill gpg-agent
  rm -rf -- "$test_home"
  test_home=''
  printf '%s\n' 'Independent exported-copy decrypt self-test PASS.'
done
rm -- "$GNUPGHOME/self-test.txt" "$GNUPGHOME/self-test.gpg"
printf 'Ceremony PASS. Public fingerprint: %s\n' "$fingerprint"
printf '%s\n' 'Keep the original key home and revocation certificate offline; unmount both media.' \
  'Share only recipients.gpg and fingerprint.txt with Claude; no private-key files or screenshots.'
