#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/../backend"

# Match the local defaults documented in backend/README.md.
export PLIEGO_DB_URL="${PLIEGO_DB_URL:-jdbc:postgresql://localhost:5432/pliego}"
export PLIEGO_DB_USERNAME="${PLIEGO_DB_USERNAME:-pliego}"

missing=()
for variable in PLIEGO_DB_PASSWORD PLIEGO_ADMIN_EMAIL PLIEGO_ADMIN_PASSWORD_HASH; do
  if [[ -z "${!variable:-}" ]]; then
    missing+=("$variable")
  fi
done

if ((${#missing[@]} > 0)); then
  printf 'Missing required backend environment variables: %s\n' "${missing[*]}" >&2
  printf 'Set them in this shell, then run this script again. See backend/README.md, Configuration.\n' >&2
  exit 2
fi

if [[ -z "${PLIEGO_JWT_SECRET:-}" ]]; then
  state_home="${XDG_STATE_HOME:-${HOME:?HOME or XDG_STATE_HOME must be set}/.local/state}"
  secret_dir="${state_home%/}/pliego"
  secret_file="$secret_dir/dev-jwt-secret"
  mkdir -p "$secret_dir"
  chmod 700 "$secret_dir"

  if [[ ! -f "$secret_file" ]] || ! grep -Eq '^[[:xdigit:]]{64}$' "$secret_file"; then
    if ! command -v openssl >/dev/null 2>&1; then
      printf 'openssl is required to generate a local JWT secret.\n' >&2
      exit 2
    fi
    umask 077
    openssl rand -hex 32 > "$secret_file"
    chmod 600 "$secret_file"
  fi

  PLIEGO_JWT_SECRET="$(tr -d '\r\n' < "$secret_file")"
  export PLIEGO_JWT_SECRET
fi

secret_bytes="$(LC_ALL=C printf '%s' "$PLIEGO_JWT_SECRET" | wc -c | tr -d '[:space:]')"
if ((secret_bytes < 32)); then
  printf 'PLIEGO_JWT_SECRET must contain at least 32 UTF-8 bytes.\n' >&2
  exit 2
fi

exec mvn spring-boot:run "$@"
