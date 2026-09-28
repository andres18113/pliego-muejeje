#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
SECRET_DIR="$ROOT_DIR/.local-secrets"
HASH_FILE="$SECRET_DIR/admin-password.hash"
CP_FILE="$SECRET_DIR/maven-classpath.txt"

umask 077
mkdir -p "$SECRET_DIR"

# Idempotencia: si ya existe un hash válido, reutilizarlo.
if [[ -s "$HASH_FILE" ]]; then
    EXISTING_HASH="$(tr -d '\r\n' < "$HASH_FILE")"

    if [[ "$EXISTING_HASH" =~ ^\$2[aby]\$[0-9]{2}\$ ]]; then
        echo "Hash BCrypt ya existente:"
        echo "$EXISTING_HASH"
        exit 0
    fi

    echo "Hash existente inválido. Se regenerará." >&2
    rm -f "$HASH_FILE"
fi

# Solicitar contraseña sin mostrarla.
if [[ -z "${PLIEGO_ADMIN_PASSWORD:-}" ]]; then
    read -rsp "Contraseña para el usuario ADMIN: " PLIEGO_ADMIN_PASSWORD
    echo
fi

if [[ -z "$PLIEGO_ADMIN_PASSWORD" ]]; then
    echo "ERROR: la contraseña ADMIN no puede estar vacía." >&2
    exit 1
fi

export PLIEGO_ADMIN_PASSWORD

cd "$BACKEND_DIR"

echo "Resolviendo dependencias BCrypt..."

mvn -q dependency:build-classpath \
    -Dmdep.outputFile="$CP_FILE"

if [[ ! -s "$CP_FILE" ]]; then
    echo "ERROR: Maven no generó el classpath." >&2
    exit 1
fi

CLASSPATH="$(cat "$CP_FILE")"

JSHELL_OUTPUT="$(
    jshell --class-path "$CLASSPATH" <<'EOF_JSHELL' 2>/dev/null || true
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
var encoder = new BCryptPasswordEncoder(12);
System.out.println("PLIEGO_BCRYPT=" + encoder.encode(System.getenv("PLIEGO_ADMIN_PASSWORD")));
/exit
EOF_JSHELL
)"

HASH="$(
    printf '%s\n' "$JSHELL_OUTPUT" \
        | sed -n 's/.*PLIEGO_BCRYPT=\(\$2[aby]\$[0-9][0-9]\$[^[:space:]]*\).*/\1/p' \
        | tail -n 1
)"

if [[ -z "$HASH" ]]; then
    echo "ERROR: no se pudo generar el hash BCrypt." >&2
    echo "Comprueba que backend tenga Spring Security / BCrypt disponible." >&2
    exit 1
fi

printf '%s\n' "$HASH" > "$HASH_FILE"
chmod 600 "$HASH_FILE"

unset PLIEGO_ADMIN_PASSWORD

echo
echo "Hash BCrypt generado correctamente:"
echo "$HASH"
echo
echo "Guardado en:"
echo "$HASH_FILE"
