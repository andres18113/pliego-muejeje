"""Verify persistent session restore, rotation, logout, and expiry against live Spring + PostgreSQL 18.

Requires PLIEGO_TEST_API_BASE_URL and the PGHOST/PGPORT/PGDATABASE/PGUSER variables used by psql.
The test registers its own random CUSTOMER account and never prints its password or cookie value.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import subprocess
import urllib.error
import urllib.request


COOKIE_NAME = "pliego_session"


def request(base_url: str, path: str, method: str, *, body=None, cookie=None, access_token=None):
    payload = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json, application/problem+json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = f"{COOKIE_NAME}={cookie}"
    if path in ("/api/v1/auth/refresh", "/api/v1/auth/logout"):
        headers["X-PLIEGO-SESSION-REQUEST"] = "1"
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    call = urllib.request.Request(base_url.rstrip("/") + path, data=payload, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(call, timeout=15)
    except urllib.error.HTTPError as failure:
        response = failure
    text = response.read().decode("utf-8")
    try:
        body = json.loads(text) if text else None
    except json.JSONDecodeError:
        body = text
    return response.status, response.headers, body


def session_cookie(headers) -> str:
    value = headers.get("Set-Cookie", "")
    match = re.search(rf"(?:^|,\s*){COOKIE_NAME}=([^; ,]+)", value)
    if not match:
        raise AssertionError("Expected the auth endpoint to set the persistent session cookie")
    return match.group(1)


def assert_live_login(base_url: str, email: str, password: str) -> tuple[str, str]:
    status, headers, body = request(base_url, "/api/v1/auth/login", "POST",
                                    body={"email": email, "password": password})
    assert status == 200, f"login returned HTTP {status}: {body}"
    assert body["user"]["role"] == "CUSTOMER"
    assert body["expiresInSeconds"] == 1800
    cookie = session_cookie(headers)
    attributes = headers.get("Set-Cookie", "")
    for expected in ("HttpOnly", "Secure", "SameSite=Strict", "Path=/api/v1/auth"):
        assert expected in attributes, f"session cookie lacks {expected}"
    return body["accessToken"], cookie


def expire_hash_in_postgres(token: str) -> None:
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    sql = ("UPDATE pliego.sesion_autenticacion "
           "SET fecha_creacion=transaction_timestamp()-INTERVAL '31 days', "
           "fecha_renovacion=transaction_timestamp(), "
           "fecha_expiracion=transaction_timestamp()-INTERVAL '1 second' "
           f"WHERE token_refresco_hash='{token_hash}';")
    subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-c", sql],
                   check=True, env=os.environ.copy(), stdout=subprocess.DEVNULL)


def age_rotation_grace_in_postgres(previous_token: str) -> None:
    token_hash = hashlib.sha256(previous_token.encode("ascii")).hexdigest()
    sql = ("UPDATE pliego.sesion_autenticacion "
           "SET fecha_creacion=transaction_timestamp()-INTERVAL '31 days', "
           "fecha_renovacion=transaction_timestamp()-INTERVAL '6 minutes' "
           f"WHERE token_refresco_hash_anterior='{token_hash}';")
    subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-c", sql],
                   check=True, env=os.environ.copy(), stdout=subprocess.DEVNULL)


def main() -> None:
    base_url = os.environ.get("PLIEGO_TEST_API_BASE_URL")
    if not base_url:
        raise SystemExit("Set PLIEGO_TEST_API_BASE_URL")
    for name in ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER"):
        if not os.environ.get(name):
            raise SystemExit(f"Set {name} for the PostgreSQL expiry fixture")

    email = f"session-{secrets.token_hex(8)}@example.invalid"
    password = f"Session-{secrets.token_urlsafe(18)}"
    status, _, body = request(base_url, "/api/v1/auth/register", "POST", body={
        "email": email,
        "password": password,
        "firstNames": "Prueba",
        "lastNames": "Sesión",
    })
    assert status == 201, f"registration returned HTTP {status}: {body}"
    from email_verification_fixture import verify_registered_email
    verify_registered_email(email, base_url)

    access_token, cookie = assert_live_login(base_url, email, password)
    status, _, profile = request(base_url, "/api/v1/me", "GET", access_token=access_token)
    assert status == 200 and profile["email"] == email, "the login JWT did not authorize CUSTOMER profile access"

    # Simulates reload: retain only the browser cookie and ask the backend to restore/rotate it.
    status, headers, restored = request(base_url, "/api/v1/auth/refresh", "POST", cookie=cookie)
    assert status == 200 and restored["user"]["role"] == "CUSTOMER", "reload did not restore the session"
    rotated_cookie = session_cookie(headers)
    assert rotated_cookie != cookie, "refresh credential was not rotated"
    status, retry_headers, retry_body = request(base_url, "/api/v1/auth/refresh", "POST", cookie=cookie)
    assert status == 200 and session_cookie(retry_headers) == rotated_cookie, \
        f"retry after a lost rotation response did not recover the same credential: {retry_body}"
    age_rotation_grace_in_postgres(cookie)
    status, _, _ = request(base_url, "/api/v1/auth/refresh", "POST", cookie=cookie)
    assert status == 204, "a stale refresh credential remained usable beyond its retry window"

    # A new HTTP client represents closing and reopening the frontend while its cookie jar is preserved.
    status, headers, reopened = request(base_url, "/api/v1/auth/refresh", "POST", cookie=rotated_cookie)
    assert status == 200 and reopened["user"]["role"] == "CUSTOMER", "reopening did not restore the session"
    active_cookie = session_cookie(headers)
    status, headers, _ = request(base_url, "/api/v1/auth/logout", "POST", cookie=rotated_cookie)
    assert status == 204 and "Max-Age=0" in headers.get("Set-Cookie", ""), "logout did not expire the cookie"
    status, _, _ = request(base_url, "/api/v1/auth/refresh", "POST", cookie=active_cookie)
    assert status == 204, "logout did not revoke the PostgreSQL session"

    _, expired_cookie = assert_live_login(base_url, email, password)
    expire_hash_in_postgres(expired_cookie)
    status, headers, _ = request(base_url, "/api/v1/auth/refresh", "POST", cookie=expired_cookie)
    assert status == 204 and "Max-Age=0" in headers.get("Set-Cookie", ""), "expired session was not cleared"

    print("PASS: live PostgreSQL session login, reload restore, reopen restore, rotation, logout, and expiry")


if __name__ == "__main__":
    main()
