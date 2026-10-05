"""Verify gate accounts through the public endpoint with local test-only HMAC material.

Never sends mail; only reads the nonce/hash outbox representation from the test database.
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import urllib.request


def verification_token(email):
    escaped = email.replace("'", "''")
    sql = ("SELECT o.datos->>'nonce' FROM pliego.correo_outbox o JOIN pliego.usuario u USING(usuario_id) "
           f"WHERE u.email_normalizado='{escaped}' AND o.tipo='VERIFY_EMAIL' "
           "ORDER BY o.correo_id DESC LIMIT 1")
    nonce = subprocess.check_output(["psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], text=True).strip()
    assert nonce, "Registration did not persist a verification email"
    key = os.environ.get("PLIEGO_MAIL_TOKEN_SECRET", os.environ["PLIEGO_JWT_SECRET"]).encode()
    digest = hmac.new(key, ("PLIEGO:EMAIL_ACTION:v1:VERIFY_EMAIL:" + nonce).encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def verify_registered_email(email, base_url):
    request = urllib.request.Request(base_url.rstrip("/") + "/api/v1/auth/verify-email", method="POST",
        data=json.dumps({"token": verification_token(email)}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        assert response.status == 204, "Email verification did not succeed"
