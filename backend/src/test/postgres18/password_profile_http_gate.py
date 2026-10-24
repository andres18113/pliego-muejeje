"""Profile password recovery through real REST/JDBC/outbox and a loopback mail stub.

Run against a disposable, migrated PostgreSQL database with PG*, PLIEGO_DB_* and
PLIEGO_JWT_SECRET configured. Requires the built backend JAR. No external email is
sent. Full backend output is retained under PLIEGO_GATE_LOG_DIR (default /tmp).
"""

import argparse
import concurrent.futures
import hashlib
from html.parser import HTMLParser
import http.server
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
from urllib.parse import parse_qs, urlsplit

from checkout_last_unit import query
from transactional_email_http_gate import MailtrapStub, free_port, request, wait_for


class LocalMailFixture(MailtrapStub):
    def do_GET(self):
        parsed = urlsplit(self.path)
        parameters = parse_qs(parsed.query)
        email = parameters.get("email", [None])[0]
        category = parameters.get("category", [None])[0]
        if parsed.path != "/fixture/inbox" or not email:
            self.send_error(404)
            return
        messages = [payload for status, payload, _ in self.deliveries if status == 200
                    and payload["to"][0]["email"] == email
                    and (category is None or payload.get("category") == category)]
        body = json.dumps({"messages": messages}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.hrefs.extend(value for name, value in attrs if name == "href" and value)


def delivered_action(email, category):
    matches = [payload for status, payload, _ in MailtrapStub.deliveries
               if status == 200 and payload.get("category") == category
               and payload["to"][0]["email"] == email]
    return matches[-1] if matches else None


def action_link(message, expected_path, return_to=None):
    links = Links()
    links.feed(message["html"])
    matches = {href for href in links.hrefs if urlsplit(href).path == expected_path}
    assert len(matches) == 1, "Delivered email must contain one unique action link"
    parsed = urlsplit(matches.pop())
    assert parsed.scheme == "https" and parsed.netloc == "pliego.example"
    assert parse_qs(parsed.query) == ({"from": [return_to]} if return_to else {})
    assert "token" not in parse_qs(parsed.query), "Credential must remain in the URL fragment"
    values = parse_qs(parsed.fragment)
    assert len(values.get("token", [])) == 1 and len(values["token"][0]) == 43
    return values["token"][0]


def main(serve=False):
    assert os.environ.get("PGDATABASE") not in (None, "postgres", "template0", "template1"), \
        "Configure a disposable test database"
    MailtrapStub.status = 200
    MailtrapStub.deliveries = []
    provider = http.server.ThreadingHTTPServer(("127.0.0.1", 0), LocalMailFixture)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    port = int(os.environ.get("PLIEGO_PASSWORD_APP_PORT", "0")) or free_port()
    base = f"http://127.0.0.1:{port}"
    environment = {**os.environ,
        "PLIEGO_MAIL_ENABLED": "true", "PLIEGO_MAIL_ALLOW_LOCAL_HTTP": "true",
        "PLIEGO_MAIL_ENDPOINT": f"http://127.0.0.1:{provider.server_port}/api/send",
        "PLIEGO_MAILTRAP_API_TOKEN": "local-stub-token",
        "PLIEGO_MAIL_FROM_ADDRESS": "pliego@example.invalid",
        "PLIEGO_APP_PUBLIC_URL": os.environ.get("PLIEGO_APP_PUBLIC_URL", "https://pliego.example") if serve else "https://pliego.example",
        "PLIEGO_MAIL_POLL_INTERVAL": "PT1S", "PLIEGO_MAIL_BATCH_SIZE": "10"}
    jar = Path(__file__).resolve().parents[3] / "target/pliego-backend-0.1.0-SNAPSHOT.jar"
    log_dir = Path(os.environ.get("PLIEGO_GATE_LOG_DIR", "/tmp"))
    log_dir.mkdir(parents=True, exist_ok=True)
    backend = None
    try:
        with tempfile.TemporaryDirectory(prefix="pliego-password-profile-") as work:
            # A private copy remains stable if another agent rebuilds target/.
            application = Path(work) / "backend.jar"
            shutil.copyfile(jar, application)
            with (log_dir / "pliego-password-backend-http.log").open("w") as log:
                backend = subprocess.Popen(["java", "-jar", str(application), f"--server.port={port}", "--server.address=127.0.0.1"],
                                           env=environment, stdout=log, stderr=log)

                def ready():
                    assert backend.poll() is None, "Backend exited; inspect the retained backend log"
                    try:
                        return request(base, "/v3/api-docs")[0] == 200
                    except (urllib.error.URLError, TimeoutError):
                        return False

                wait_for(ready, 60)
                if serve:
                    print(json.dumps({"backend": base,
                        "inbox": f"http://127.0.0.1:{provider.server_port}/fixture/inbox",
                        "inboxQuery": "?email=<registered-email>&category=VERIFY_EMAIL|RESET_PASSWORD"}), flush=True)
                    while backend.poll() is None:
                        time.sleep(.2)
                    raise AssertionError("Fixture backend exited; inspect its retained log")

                def register_verified():
                    email = f"password-profile-{secrets.token_hex(8)}@example.invalid"
                    password = "Original-" + secrets.token_hex(12)
                    status, _, result = request(base, "/api/v1/auth/register", {
                        "email": email, "password": password, "firstNames": "Ana", "lastNames": "Pérez"})
                    assert status == 201 and result["state"] == "PENDING_VERIFICATION"
                    user_id = int(result["userId"])
                    status, _, pending = request(base, "/api/v1/auth/forgot-password", {
                        "email": email, "returnTo": "/account"})
                    assert status == 202 and pending.get("message")
                    assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={user_id} AND tipo='RESET_PASSWORD'") == "0", \
                        "Unverified email must not receive a reset credential"
                    assert query(f"SELECT count(*) FROM pliego.correo_token WHERE usuario_id={user_id} AND tipo='RESET_PASSWORD'") == "0"
                    wait_for(lambda: delivered_action(email, "VERIFY_EMAIL"))
                    token = action_link(delivered_action(email, "VERIFY_EMAIL"), "/verificar-correo")
                    assert request(base, "/api/v1/auth/verify-email", {"token": token})[0] == 204
                    return email, password, user_id

                email, old_password, user_id = register_verified()
                status, headers, session = request(base, "/api/v1/auth/login", {
                    "email": email, "password": old_password})
                assert status == 200
                original_cookie = headers["Set-Cookie"].split(";", 1)[0]
                bearer = {"Authorization": "Bearer " + session["accessToken"]}
                status, _, profile = request(base, "/api/v1/me", headers=bearer)
                assert status == 200 and profile["email"] == email and profile["emailVerified"]
                status, headers, _ = request(base, "/api/v1/auth/login", {
                    "email": email, "password": old_password})
                assert status == 200
                second_cookie = headers["Set-Cookie"].split(";", 1)[0]

                command = {"email": profile["email"], "returnTo": "/account"}
                status, _, accepted = request(base, "/api/v1/auth/forgot-password", command, bearer)
                assert status == 202 and accepted.get("message")
                wait_for(lambda: delivered_action(email, "RESET_PASSWORD"))
                raw = action_link(delivered_action(email, "RESET_PASSWORD"), "/restablecer-contrasena", "/account")
                digest = hashlib.sha256(raw.encode()).hexdigest()
                assert query(f"SELECT token_hash='{digest}' AND "
                             "extract(epoch from fecha_expiracion-fecha_creacion)::integer=900 "
                             f"FROM pliego.correo_token WHERE usuario_id={user_id} AND tipo='RESET_PASSWORD'") == "t", \
                    "Reset must persist only the token hash and a 15-minute lifetime"
                with concurrent.futures.ThreadPoolExecutor(2) as pool:
                    repeated = list(pool.map(lambda _: request(base, "/api/v1/auth/forgot-password", command, bearer), range(2)))
                assert all(code == 202 and body == accepted for code, _, body in repeated)
                assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={user_id} AND tipo='RESET_PASSWORD'") == "1", \
                    "Repeated profile requests must not enqueue duplicate reset email during cooldown"
                assert sum(1 for code, payload, _ in MailtrapStub.deliveries if code == 200
                           and payload.get("category") == "RESET_PASSWORD"
                           and payload["to"][0]["email"] == email) == 1
                unknown = f"unknown-password-{secrets.token_hex(8)}@example.invalid"
                assert request(base, "/api/v1/auth/forgot-password", {"email": unknown})[::2] == (202, accepted), \
                    "Recovery responses must not reveal account existence"
                assert request(base, "/api/v1/auth/login", {"email": email, "password": old_password})[0] == 200, \
                    "Sending a link must not change the password"

                new_password = "Replacement-" + secrets.token_hex(12)
                with concurrent.futures.ThreadPoolExecutor(2) as pool:
                    consumed = list(pool.map(lambda _: request(base, "/api/v1/auth/reset-password", {
                        "token": raw, "password": new_password})[0], range(2)))
                assert sorted(consumed) == [204, 400], "Concurrent reset must consume the token exactly once"
                assert request(base, "/api/v1/auth/reset-password", {"token": raw, "password": old_password})[0] == 400
                assert request(base, "/api/v1/auth/login", {"email": email, "password": old_password})[0] == 401
                status, new_headers, new_session = request(base, "/api/v1/auth/login", {
                    "email": email, "password": new_password})
                assert status == 200
                for cookie in (original_cookie, second_cookie):
                    code, result_headers, result = request(base, "/api/v1/auth/refresh", {}, {
                        "Cookie": cookie, "X-PLIEGO-SESSION-REQUEST": "1"})
                    assert code == 204 and result is None and "Max-Age=0" in result_headers["Set-Cookie"], \
                        "Reset must revoke every preexisting refresh session"
                fresh_cookie = new_headers["Set-Cookie"].split(";", 1)[0]
                assert request(base, "/api/v1/auth/refresh", {}, {
                    "Cookie": fresh_cookie, "X-PLIEGO-SESSION-REQUEST": "1"})[0] == 200
                assert request(base, "/api/v1/me", headers={
                    "Authorization": "Bearer " + new_session["accessToken"]})[0] == 200
                # Existing access tokens retain their bounded lifetime; UI copy must not claim immediate revocation.
                assert request(base, "/api/v1/me", headers=bearer)[0] == 200

                expired_email, expired_password, expired_user = register_verified()
                assert request(base, "/api/v1/auth/forgot-password", {"email": expired_email, "returnTo": "/account"})[0] == 202
                wait_for(lambda: delivered_action(expired_email, "RESET_PASSWORD"))
                expired_token = action_link(delivered_action(expired_email, "RESET_PASSWORD"), "/restablecer-contrasena", "/account")
                query("UPDATE pliego.correo_token SET fecha_expiracion=CURRENT_TIMESTAMP-INTERVAL '1 second' "
                      f"WHERE usuario_id={expired_user} AND tipo='RESET_PASSWORD'")
                assert request(base, "/api/v1/auth/reset-password", {"token": expired_token, "password": new_password})[0] == 400
                assert request(base, "/api/v1/auth/login", {"email": expired_email, "password": expired_password})[0] == 200
                assert query(f"SELECT fecha_uso IS NULL FROM pliego.correo_token WHERE usuario_id={expired_user} AND tipo='RESET_PASSWORD'") == "t"

                print("PASS: profile email -> real reset email -> /account return context; hash-only token; 15-minute expiry")
                print("PASS: generic unknown-account response; concurrent cooldown; one delivery; request leaves password unchanged")
                print("PASS: unverified account receives generic acceptance without reset email or credential")
                print("PASS: concurrent single-use reset; old password rejected; new login/profile/refresh accepted")
                print("PASS: all earlier refresh sessions revoked; bounded access lifetime preserved; expired token rejected")
    finally:
        if backend is not None and backend.poll() is None:
            backend.terminate()
            try:
                backend.wait(timeout=30)
            except subprocess.TimeoutExpired:
                backend.kill()
                backend.wait(timeout=10)
        provider.shutdown()
        provider.server_close()


if __name__ == "__main__":
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--serve", action="store_true", help="Keep backend and loopback inbox running for live browser gates")
    main(arguments.parse_args().serve)
