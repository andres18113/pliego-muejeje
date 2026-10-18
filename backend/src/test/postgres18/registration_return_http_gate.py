"""Real JDBC/HTTP registration + outbox/worker/email-proof gate, loopback fixtures only.

Requires a migrated disposable local DB, built JAR and PLIEGO_REGISTRATION_FIXTURE=true.
--serve leaves the local provider/backend running for browser tests. Message bodies,
passwords and action credentials stay in memory and are never printed to logs.
"""
import argparse
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class LocalMailtrap(http.server.BaseHTTPRequestHandler):
    status = 200
    messages = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/__fixture__/status':
            self.__class__.status = int(data['status'])
            self.send_response(204)
            self.end_headers()
            return
        assert self.path == '/api/send'
        identifier = str(uuid.uuid4())
        self.messages.append((self.status, data, identifier))
        self.send_response(self.status)
        self.end_headers()
        self.wfile.write(json.dumps({'success': True, 'message_ids': [identifier]}).encode())

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/__fixture__/mail':
            self.send_response(404)
            self.end_headers()
            return
        email = urllib.parse.parse_qs(parsed.query).get('email', [''])[0]
        found = [(payload, identifier) for status, payload, identifier in self.messages
                 if status == 200 and payload['to'][0]['email'] == email]
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        # A test-only local inbox, analogous to opening the email; no persisted raw token.
        result = []
        for payload, identifier in found:
            outbox_id = int(payload['custom_variables']['pliego_outbox_id'])
            state = query(f"SELECT estado FROM pliego.correo_outbox WHERE correo_id={outbox_id}")
            receipt = query(f"SELECT id_mensaje_proveedor FROM pliego.correo_outbox WHERE correo_id={outbox_id}")
            result.append({'text': payload['text'], 'id': identifier, 'state': state, 'receiptMatches': receipt == identifier})
        self.wfile.write(json.dumps(result).encode())


def request_json(base, path, body=None):
    request = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
        method='GET' if body is None else 'POST', headers={'Content-Type': 'application/json'})
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    return response.status, json.loads(raw) if raw else None


def query(sql):
    return subprocess.check_output(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], text=True).strip()


def wait_for(predicate, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.15)
    raise AssertionError('Local registration fixture timed out')


def email_link(email):
    candidates = [payload for status, payload, _ in LocalMailtrap.messages
                  if status == 200 and payload['to'][0]['email'] == email]
    if not candidates:
        return None
    return re.search(r'http://127\.0\.0\.1:5176/verificar-correo[^\s]+', candidates[-1]['text']).group(0)


def run_checks(base):
    for phone in (None, '+593991234567'):
        email = f'registration-{secrets.token_hex(8)}@example.invalid'
        password = secrets.token_urlsafe(18)
        body = {'email': email, 'password': password, 'firstNames': 'Ana María', 'lastNames': 'Pérez',
                'returnTo': '/cart?source=edition#items', **({'phone': phone} if phone else {})}
        status, registered = request_json(base, '/api/v1/auth/register', body)
        assert status == 201 and registered['state'] == 'PENDING_VERIFICATION'
        user_id = int(registered['userId'])
        assert query(f'SELECT email_verificado_en IS NULL FROM pliego.usuario WHERE usuario_id={user_id}') == 't'
        assert query(f'SELECT telefono IS NOT DISTINCT FROM {"NULL" if phone is None else chr(39)+phone+chr(39)} FROM pliego.cliente WHERE cliente_id={registered["customerId"]}') == 't'
        status, failure = request_json(base, '/api/v1/auth/login', {'email': email, 'password': password})
        assert status == 403 and failure['code'] == 'EMAIL_NOT_VERIFIED'
        assert request_json(base, '/api/v1/auth/login', {'email': email, 'password': 'wrong-local-fixture'})[0] == 401
        status, duplicate = request_json(base, '/api/v1/auth/register', {**body, 'email': email.upper()})
        assert status == 409 and duplicate['code'] == 'P1101', f'Duplicate rejection status={status}, code={duplicate.get("code")}'
        assert query(f"SELECT count(*) FROM pliego.usuario WHERE email_normalizado='{email}'") == '1'
        wait_for(lambda: query(f"SELECT estado FROM pliego.correo_outbox WHERE usuario_id={user_id}") == 'SENT')
        link = email_link(email)
        assert link and '?from=%2Fcart%3Fsource%3Dedition%23items#token=' in link
        credential = urllib.parse.parse_qs(urllib.parse.urlparse(link).fragment)['token'][0]
        assert request_json(base, '/api/v1/auth/verify-email', {'token': 'x' * 43})[0] == 400
        # Expiration is a test fixture boundary; accounts are verified only by valid token proof.
        query(f"UPDATE pliego.correo_token SET fecha_expiracion=clock_timestamp()-INTERVAL '1 second' WHERE usuario_id={user_id}")
        assert request_json(base, '/api/v1/auth/verify-email', {'token': credential})[0] == 400
        query(f"UPDATE pliego.correo_token SET fecha_expiracion=clock_timestamp()+INTERVAL '1 hour' WHERE usuario_id={user_id}")
        assert request_json(base, '/api/v1/auth/verify-email', {'token': credential})[0] == 204
        assert request_json(base, '/api/v1/auth/verify-email', {'token': credential})[0] == 400
        assert request_json(base, '/api/v1/auth/login', {'email': email, 'password': password})[0] == 200
        provider_id = query(f'SELECT id_mensaje_proveedor FROM pliego.correo_outbox WHERE usuario_id={user_id}')
        assert provider_id in [identifier for status, _, identifier in LocalMailtrap.messages if status == 200]
        assert query(f"SELECT datos ? 'nonce' FROM pliego.correo_outbox WHERE usuario_id={user_id}") == 'f'

    # Recovery through a genuine retry; no external provider or mailbox is contacted.
    LocalMailtrap.status = 503
    email = f'retry-{secrets.token_hex(8)}@example.invalid'
    password = secrets.token_urlsafe(18)
    status, registered = request_json(base, '/api/v1/auth/register', {'email': email, 'password': password,
        'firstNames': 'Ana', 'lastNames': 'Pérez', 'returnTo': '/cart'})
    assert status == 201
    user_id = int(registered['userId'])
    wait_for(lambda: query(f"SELECT estado||':'||intentos||':'||ultimo_error FROM pliego.correo_outbox WHERE usuario_id={user_id}") == 'PENDING:1:MAILTRAP_HTTP_503')
    LocalMailtrap.status = 200
    query(f"UPDATE pliego.correo_outbox SET proximo_intento=clock_timestamp() WHERE usuario_id={user_id}")
    wait_for(lambda: query(f"SELECT estado||':'||intentos FROM pliego.correo_outbox WHERE usuario_id={user_id}") == 'SENT:2')
    assert email_link(email) and '?from=%2Fcart#token=' in email_link(email)
    print('Registration HTTP gate PASS: unique/duplicate, optional phone, proof-before-login, safe mail context, invalid/expired/reused tokens, provider acceptance persisted, retry503→SENT; no production data or mail')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve', action='store_true')
    options = parser.parse_args()
    if os.environ.get('PLIEGO_REGISTRATION_FIXTURE') != 'true' or os.environ.get('PGHOST') != '127.0.0.1' or os.environ.get('PGDATABASE') != 'pliego_registration':
        raise SystemExit('Explicit isolated loopback registration fixture required')
    provider = http.server.ThreadingHTTPServer(('127.0.0.1', 18439), LocalMailtrap)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:18088'
    env = {**os.environ, 'PLIEGO_MAIL_ENABLED': 'true', 'PLIEGO_MAIL_ALLOW_LOCAL_HTTP': 'true',
        'PLIEGO_MAIL_ENDPOINT': 'http://127.0.0.1:18439/api/send', 'PLIEGO_MAILTRAP_API_TOKEN': 'local-stub-only',
        'PLIEGO_MAIL_FROM_ADDRESS': 'fixture@example.invalid', 'PLIEGO_MAIL_FROM_NAME': 'PLIEGO',
        'PLIEGO_APP_PUBLIC_URL': 'http://127.0.0.1:5176', 'PLIEGO_MAIL_POLL_INTERVAL': 'PT0.2S',
        'PLIEGO_CORS_ALLOWED_ORIGINS': 'http://127.0.0.1:5176',
        'PLIEGO_AUTH_COOKIE_SECURE': 'false', 'PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED': 'false'}
    jar = Path(__file__).resolve().parents[3] / 'target/pliego-backend-0.1.0-SNAPSHOT.jar'
    log_dir = Path(__file__).resolve().parents[4] / '.local-secrets/validation-20261010/testsprite-registration/logs'
    log_dir.mkdir(parents=True, exist_ok=True)
    with (log_dir / 'local-backend.log').open('w') as log:
        backend = subprocess.Popen(['java', '-Xms128m', '-Xmx512m', '-jar', str(jar), '--server.address=127.0.0.1', '--server.port=18088'], env=env, stdout=log, stderr=log)
        try:
            def ready():
                if backend.poll() is not None:
                    raise AssertionError('Local backend startup failed; inspect private local-backend.log')
                try:
                    return request_json(base, '/v3/api-docs')[0] == 200
                except urllib.error.URLError:
                    return False
            wait_for(ready)
            subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-f', str(Path(__file__).with_name('email_action_return_context_gate.sql'))], check=True, stdout=subprocess.DEVNULL)
            run_checks(base)
            if options.serve:
                print('Local browser fixtures ready: backend18088, inbox18439, frontend expected5176', flush=True)
                signal.pause()
        finally:
            backend.terminate()
            backend.wait(timeout=30)
            provider.shutdown()
            provider.server_close()


if __name__ == '__main__':
    main()
