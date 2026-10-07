#!/usr/bin/env python3
"""Manual-only live Mailtrap check through PLIEGO's real API and outbox.

This deliberately sends one password-reset email to an existing eligible test
account. It is never imported or called by automated tests. Run from a shell
that has the backend's Mailtrap and PostgreSQL environment configured.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


CONFIRMATION = "--confirm-real-email"


def fail(message):
    raise SystemExit(message)


def require_environment():
    if os.environ.get("PLIEGO_MAIL_ENABLED", "").lower() != "true":
        fail("PLIEGO_MAIL_ENABLED debe ser true en el entorno del smoke test.")
    if not (os.environ.get("PLIEGO_MAILTRAP_API_TOKEN") or os.environ.get("PLIEGO_MAIL_TOKEN")):
        fail("Falta el token de Mailtrap en el entorno; no se imprimirá ni se solicitará por argumentos.")
    if not os.environ.get("PLIEGO_APP_PUBLIC_URL"):
        fail("Falta PLIEGO_APP_PUBLIC_URL en el entorno del backend.")
    recipient = os.environ.get("PLIEGO_MAIL_SMOKE_RECIPIENT", "").strip()
    if not re.fullmatch(r"[^\s<>@]+@[^\s<>@]+", recipient):
        fail("Configura PLIEGO_MAIL_SMOKE_RECIPIENT con una cuenta de prueba existente y elegible.")
    if not shutil.which("psql"):
        fail("psql debe estar instalado para correlacionar la respuesta con la outbox.")
    return recipient


def backend_url():
    base = os.environ.get("PLIEGO_MAIL_SMOKE_API_URL", "http://127.0.0.1:8080").rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    loopback = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        fail("PLIEGO_MAIL_SMOKE_API_URL debe usar HTTPS; HTTP solo se permite en loopback.")
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        fail("PLIEGO_MAIL_SMOKE_API_URL no es una URL base válida.")
    return base


def psql(sql, recipient, started_at):
    command = [
        "psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
        "-v", "recipient=" + recipient,
        "-v", "started_at=" + str(started_at),
        "-c", sql,
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=10)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        fail("No se pudo consultar la outbox; revisa las variables PG* del entorno sin compartirlas.")
    return result.stdout.strip()


def send_reset_request(base, recipient):
    request = urllib.request.Request(
        base + "/api/v1/auth/forgot-password",
        data=json.dumps({"email": recipient}).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 202:
                fail("PLIEGO no aceptó la solicitud de smoke test (se esperaba HTTP 202).")
    except urllib.error.HTTPError as error:
        fail("PLIEGO rechazó la solicitud de smoke test con HTTP " + str(error.code) + ".")
    except urllib.error.URLError:
        fail("No se pudo conectar con el backend configurado para el smoke test.")


def main():
    parser = argparse.ArgumentParser(description="Envía un correo real de reset al destinatario de prueba configurado.")
    parser.add_argument(CONFIRMATION, action="store_true", help="confirma explícitamente el único envío real")
    args = parser.parse_args()
    if not args.confirm_real_email:
        fail("No se envió nada. Repite con --confirm-real-email solo después de revisar el destinatario.")

    recipient = require_environment()
    base = backend_url()
    migration = psql(
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema='pliego' AND table_name='correo_outbox' AND column_name='id_mensaje_proveedor'",
        recipient, int(time.time()),
    )
    if migration != "1":
        fail("La base conectada no tiene V060; no se envió nada.")

    started_at = int(time.time())
    send_reset_request(base, recipient)
    sql = (
        "SELECT correo_id::text || '|' || estado || '|' || intentos::text || '|' "
        "|| COALESCE(id_mensaje_proveedor,'') || '|' || COALESCE(ultimo_error,'') "
        "FROM pliego.correo_outbox WHERE destinatario=:'recipient' "
        "AND tipo='RESET_PASSWORD' AND fecha_creacion>=to_timestamp(:'started_at') "
        "ORDER BY correo_id DESC LIMIT 1"
    )
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        row = psql(sql, recipient, started_at)
        if row:
            fields = row.split("|", 4)
            if len(fields) == 5:
                outbox_id, state, attempts, provider_id, error = fields
                if state == "SENT" and provider_id:
                    print(f"Mailtrap aceptó el mensaje: outbox_id={outbox_id} provider_message_id={provider_id} attempts={attempts}.")
                    print("Confirma después el evento delivery en Mailtrap Email Logs; SENT solo significa aceptación del proveedor.")
                    return
                if state == "FAILED":
                    fail(f"El correo terminó FAILED: outbox_id={outbox_id} attempts={attempts} code={error or 'UNKNOWN'}.")
        time.sleep(1)
    fail("No se observó una aceptación dentro de 90 s. Revisa la outbox y los logs por id/código, sin copiar datos sensibles.")


if __name__ == "__main__":
    main()
