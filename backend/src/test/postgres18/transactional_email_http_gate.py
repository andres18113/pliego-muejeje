"""Full JDBC/REST/outbox/provider integration; starts ONLY a local Mailtrap HTTP stub.

Use a disposable PostgreSQL database and the PLIEGO_DB_*, PG*, PLIEGO_JWT_SECRET
variables. Requires a built backend jar. No real credentials or email delivery.
"""
import base64
import concurrent.futures
import hashlib
import hmac
import http.server
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid

from checkout_last_unit import fixture, query
from checkout_http_gate import token as fixture_jwt
from email_verification_fixture import verification_token


class MailtrapStub(http.server.BaseHTTPRequestHandler):
    status = 503
    deliveries = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.deliveries.append((self.status, payload))
        self.send_response(self.status)
        self.end_headers()
        self.wfile.write(b'{"success":true,"message_ids":["local-test"]}')


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait_for(predicate, timeout=30):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(.15)
    raise AssertionError('Timed out waiting for the local integration condition')


def request(base, path, body=None, headers=None):
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
        method='GET' if body is None else 'POST', headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    return response.status, response.headers, json.loads(raw) if raw else None


def action_token(user_id, purpose):
    nonce = query(f"SELECT datos->>'nonce' FROM pliego.correo_outbox WHERE usuario_id={user_id} AND tipo='{purpose}' ORDER BY correo_id DESC LIMIT 1")
    key = os.environ.get('PLIEGO_MAIL_TOKEN_SECRET', os.environ['PLIEGO_JWT_SECRET']).encode()
    raw = hmac.new(key, f'PLIEGO:EMAIL_ACTION:v1:{purpose}:{nonce}'.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def main():
    provider = http.server.ThreadingHTTPServer(('127.0.0.1', 0), MailtrapStub)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{free_port()}'
    env = {**os.environ, 'PLIEGO_MAIL_ENABLED': 'true', 'PLIEGO_MAIL_ALLOW_LOCAL_HTTP': 'true',
        'PLIEGO_MAIL_ENDPOINT': f'http://127.0.0.1:{provider.server_port}/api/send',
        'PLIEGO_MAIL_TOKEN': 'local-stub-token', 'PLIEGO_MAIL_FROM_ADDRESS': 'pliego@example.invalid',
        'PLIEGO_MAIL_FROM_NAME': 'PLIEGO', 'PLIEGO_APP_PUBLIC_URL': 'https://pliego.example',
        'PLIEGO_MAIL_POLL_INTERVAL': 'PT1S', 'PLIEGO_MAIL_BATCH_SIZE': '1'}
    jar = Path(__file__).resolve().parents[3] / 'target/pliego-backend-0.1.0-SNAPSHOT.jar'
    log_path = Path('/tmp/pliego-mail-http-backend.log')
    with log_path.open('w') as log:
        backend = subprocess.Popen(['java', '-jar', str(jar), '--server.port=' + base.rsplit(':', 1)[1]], env=env, stdout=log, stderr=log)
        try:
            def ready():
                if backend.poll() is not None:
                    raise AssertionError(f'Backend startup failed; inspect {log_path}')
                try:
                    return request(base, '/v3/api-docs')[0] == 200
                except urllib.error.URLError:
                    return False
            wait_for(ready, 60)
            email = f'mail-http-{secrets.token_hex(6)}@example.invalid'
            password = 'Mail-fixture-2026'
            status, _, registered = request(base, '/api/v1/auth/register', {'email': email, 'password': password, 'firstNames': 'Ana', 'lastNames': 'Pérez'})
            assert status == 201 and registered['state'] == 'PENDING_VERIFICATION'
            uid = int(registered['userId'])
            assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={uid} AND tipo='VERIFY_EMAIL'") == '1'
            wait_for(lambda: any(p['category'] == 'VERIFY_EMAIL' and p['to'][0]['email'] == email for _, p in MailtrapStub.deliveries))
            assert query(f"SELECT estado||':'||intentos||':'||ultimo_error FROM pliego.correo_outbox WHERE usuario_id={uid}") == 'PENDING:1:MAILTRAP_HTTP_503'
            assert request(base, '/api/v1/auth/login', {'email': email, 'password': password})[0] == 403
            assert request(base, '/api/v1/auth/login', {'email': email, 'password': 'Incorrecta-2026'})[0] == 401
            status, _, known = request(base, '/api/v1/auth/resend-verification', {'email': email})
            assert status == 202 and query(f"SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={uid}") == '1'
            status, _, unknown = request(base, '/api/v1/auth/resend-verification', {'email': 'unknown@example.invalid'})
            assert status == 202 and known == unknown
            raw = verification_token(email)
            query(f"UPDATE pliego.correo_token SET fecha_expiracion=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE usuario_id={uid}")
            assert request(base, '/api/v1/auth/verify-email', {'token': raw})[0] == 400
            query(f"UPDATE pliego.correo_token SET fecha_expiracion=CURRENT_TIMESTAMP+INTERVAL '1 day' WHERE usuario_id={uid}")
            assert request(base, '/api/v1/auth/verify-email', {'token': raw})[0] == 204
            assert request(base, '/api/v1/auth/verify-email', {'token': raw})[0] == 400
            status, headers, logged_in = request(base, '/api/v1/auth/login', {'email': email, 'password': password})
            assert status == 200
            cookie = headers['Set-Cookie'].split(';', 1)[0]
            status, _, known = request(base, '/api/v1/auth/forgot-password', {'email': email})
            status2, _, unknown = request(base, '/api/v1/auth/forgot-password', {'email': 'unknown@example.invalid'})
            assert status == status2 == 202 and known == unknown
            wait_for(lambda: any(p['category'] == 'RESET_PASSWORD' and p['to'][0]['email'] == email for _, p in MailtrapStub.deliveries))
            raw = action_token(uid, 'RESET_PASSWORD')
            assert query(f"SELECT extract(epoch from fecha_expiracion-fecha_creacion)::integer FROM pliego.correo_token WHERE usuario_id={uid} AND tipo='RESET_PASSWORD'") == '900'
            new_password = 'Nueva-fixture-2026'
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                responses = list(pool.map(lambda _: request(base, '/api/v1/auth/reset-password', {'token': raw, 'password': new_password})[0], range(2)))
            assert sorted(responses) == [204, 400], 'Reset was not single-use under concurrent requests'
            assert request(base, '/api/v1/auth/login', {'email': email, 'password': password})[0] == 401
            assert request(base, '/api/v1/auth/login', {'email': email, 'password': new_password})[0] == 200
            assert request(base, '/api/v1/auth/refresh', {}, {'Cookie': cookie, 'X-PLIEGO-SESSION-REQUEST': '1'})[0] == 204

            # Real checkout succeeds while the email provider fails; replay never queues twice.
            actors, _ = fixture()
            actor, address = actors[0]
            key = str(uuid.uuid4())
            checkout = {'addressId': str(address), 'paymentMethod': 'TRANSFER', 'simulationOutcome': 'APPROVED'}
            auth = {'Authorization': 'Bearer ' + fixture_jwt(actor), 'Idempotency-Key': key}
            status, _, order = request(base, '/api/v1/checkout', checkout, auth)
            assert status == 201 and order['orderState'] == 'CONFIRMED'
            assert request(base, '/api/v1/checkout', checkout, auth)[2] == order
            oid = int(order['orderId'])
            assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{oid}'") == '1'
            wait_for(lambda: query(f"SELECT intentos FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{oid}'") == '1')
            assert query(f"SELECT estado FROM pliego.pedido WHERE pedido_id={oid}") == 'CONFIRMED'
            assert query(f"SELECT estado FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{oid}'") == 'PENDING'
            MailtrapStub.status = 200
            query(f"UPDATE pliego.correo_outbox SET proximo_intento=CURRENT_TIMESTAMP WHERE evento_clave='ORDER_CONFIRMED:{oid}'")
            wait_for(lambda: query(f"SELECT estado FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{oid}'") == 'SENT')
            accepted = [p for status, p in MailtrapStub.deliveries if status == 200 and p['category'] == 'ORDER_CONFIRMED']
            assert len(accepted) == 1
            assert 'Cantidad: 1' in accepted[0]['text'] and 'Total: 8.34' in accepted[0]['text']
            assert f'/orders/{oid}' in accepted[0]['html']
            assert query(f"SELECT intentos FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{oid}'") == '2'
            # Same sender/outbox and one ORDER_CONFIRMED event, adapted to real pickup snapshot.
            status, _, locations = request(base, '/api/v1/pickup-locations')
            assert status == 200 and locations
            location = locations[0]
            actors, _ = fixture()
            pickup_actor, _ = actors[0]
            pickup_body = {'fulfillmentMethod': 'STORE_PICKUP', 'pickupLocationId': location['id'],
                           'paymentMethod': 'TRANSFER', 'simulationOutcome': 'APPROVED'}
            status, _, pickup_order = request(base, '/api/v1/checkout', pickup_body,
                {'Authorization': 'Bearer ' + fixture_jwt(pickup_actor), 'Idempotency-Key': str(uuid.uuid4())})
            assert status == 201 and pickup_order['total'] == '8.34'
            pickup_id = pickup_order['orderId']
            wait_for(lambda: query(f"SELECT estado FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{pickup_id}'") == 'SENT')
            mails = [p for status, p in MailtrapStub.deliveries if status == 200 and f'Pedido #{pickup_id}' in p['subject']]
            assert len(mails) == 1
            assert location['name'] in mails[0]['text'] and location['address'] in mails[0]['text']
            assert pickup_order['fulfillment']['pickup']['pickupCode'] in mails[0]['text']
            assert 'Presenta esta confirmación' in mails[0]['text'] and 'IVA (15.00%): 1.09' in mails[0]['text']
            print('Transactional email HTTP gate passed: verification/reset/BCrypt/session revocation/concurrent single-use/checkout isolation/outbox retry/provider stub')
        finally:
            backend.terminate()
            backend.wait(timeout=30)
            provider.shutdown()
            provider.server_close()


if __name__ == '__main__':
    main()
