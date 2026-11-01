"""Disposable localhost DB + local Mailtrap stub only. Exercises webhook to worker/profile."""
import concurrent.futures
import hashlib
import hmac
import http.server
import json
import os
import re
from pathlib import Path
import subprocess
import threading
import urllib.error
import urllib.request
import uuid
from checkout_last_unit import query
from checkout_http_gate import token
from transactional_email_http_gate import free_port, wait_for


class Provider(http.server.BaseHTTPRequestHandler):
    messages = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        message = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        message_id = str(uuid.uuid4())
        self.messages.append((message_id, message))
        reply = json.dumps({'success': True, 'message_ids': [message_id]}).encode()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(reply)


def main():
    assert os.environ['PGHOST'] in ('127.0.0.1', 'localhost'), 'Disposable localhost database required'
    secret = '0123456789abcdef0123456789abcdef'
    provider = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{free_port()}'
    env = {**os.environ, 'PLIEGO_MAIL_ENABLED': 'true', 'PLIEGO_MAIL_ALLOW_LOCAL_HTTP': 'true',
        'PLIEGO_MAILTRAP_WEBHOOK_SECRET': secret, 'PLIEGO_MAILTRAP_API_TOKEN': 'local-fixture',
        'PLIEGO_MAIL_ENDPOINT': f'http://127.0.0.1:{provider.server_port}/send',
        'PLIEGO_MAIL_FROM_ADDRESS': 'pliego@example.invalid', 'PLIEGO_APP_PUBLIC_URL': 'https://pliego.example',
        'PLIEGO_MAIL_POLL_INTERVAL': 'PT0.2S', 'PLIEGO_MAIL_BATCH_SIZE': '10',
        'PLIEGO_BILLING_ENABLED': 'false', 'PLIEGO_R2_ENABLED': 'false',
        'PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED': 'false'}

    def request(path, data=None, method=None, headers=None):
        req = urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(),
            method=method or ('GET' if data is None else 'POST'),
            headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            response = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None

    def webhook(event):
        body = {'events': [event]}
        signature = hmac.new(secret.encode(), json.dumps(body).encode(), hashlib.sha256).hexdigest()
        return request('/api/v1/webhooks/mailtrap', body, headers={'Mailtrap-Signature': signature})

    jar = Path(__file__).resolve().parents[3] / 'target/pliego-backend-0.1.0-SNAPSHOT.jar'
    log_path = Path('/tmp/pliego-deliverability-http-backend.log')
    with log_path.open('w') as log:
        backend = subprocess.Popen(['java', '-jar', str(jar), '--server.port=' + base.rsplit(':', 1)[1]],
            env=env, stdout=log, stderr=log)
        try:
            def ready():
                if backend.poll() is not None:
                    raise AssertionError(f'Backend startup failed; inspect {log_path}')
                try:
                    return request('/v3/api-docs')[0] == 200
                except urllib.error.URLError:
                    return False
            wait_for(ready, 60)
            assert request('/api/v1/webhooks/mailtrap', {'events': []})[0] == 401
            suffix = uuid.uuid4().hex
            email = f'webhook-{suffix}@example.invalid'
            password = 'Mail-fixture-2026'
            status, registered = request('/api/v1/auth/register', {'email': email, 'password': password,
                'firstNames': 'Ana', 'lastNames': 'Pérez'})
            assert status == 201, registered
            actor = int(registered['userId'])
            wait_for(lambda: query(f"SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={actor} AND id_mensaje_proveedor IS NOT NULL") == '1')
            message_id = query(f"SELECT id_mensaje_proveedor FROM pliego.correo_outbox WHERE usuario_id={actor}")
            occurred = int(__import__('time').time())
            event = {'event': 'bounce', 'event_id': 'bounce-' + suffix, 'message_id': message_id,
                'sending_stream': 'transactional', 'timestamp': occurred, 'email': email,
                'response': 'private SMTP - must never be stored'}
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                assert list(pool.map(lambda _: webhook(event)[0], range(2))) == [200, 200]
            wait_for(lambda: query(f"SELECT count(*) FROM pliego.usuario WHERE usuario_id={actor} AND email_entrega_motivo='HARD_BOUNCE'") == '1')
            auth = {'Authorization': 'Bearer ' + token(actor)}
            profile = request('/api/v1/me', headers=auth)[1]
            assert profile['emailDelivery']['status'] == 'UNDELIVERABLE' and profile['emailDelivery']['since']
            assert 'private SMTP' not in json.dumps(profile)
            assert query(f"SELECT count(*) FROM pliego.correo_evento_proveedor WHERE evento_id='bounce-{suffix}'") == '1'
            assert webhook({**event, 'message_id': 'wrong-message'})[0] == 409
            held = query(f"INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos) VALUES('held-{suffix}','ORDER_CONFIRMED',{actor},'{email}','{{}}') RETURNING correo_id").splitlines()[0]
            wait_for(lambda: query(f"SELECT estado FROM pliego.correo_outbox WHERE correo_id={held}") == 'HELD')
            assert sum(p['to'][0]['email'] == email for _, p in Provider.messages) == 1
            # Stale delivery cannot erase the bounce.
            assert webhook({**event, 'event': 'delivery', 'event_id': 'old-' + suffix, 'timestamp': occurred-1})[0] == 200
            wait_for(lambda: query(f"SELECT count(*) FROM pliego.correo_evento_proveedor WHERE evento_id='old-{suffix}' AND procesado_en IS NOT NULL") == '1')
            assert request('/api/v1/me', headers=auth)[1]['emailDelivery']['status'] == 'UNDELIVERABLE'
            corrected = f'corrected-{suffix}@example.invalid'
            status, change = request('/api/v1/me/email', {'newEmail': corrected, 'currentPassword': password}, 'PUT', auth)
            assert status == 202 and change['email'] == email and change['pendingEmail']['address'] == corrected
            pending = request('/api/v1/me', headers=auth)[1]
            assert pending['email'] == email and pending['emailDelivery']['status'] == 'UNDELIVERABLE'
            wait_for(lambda: any(p['category'] == 'EMAIL_CHANGE_CONFIRM' and p['to'][0]['email'] == corrected for _, p in Provider.messages))
            confirmation = next(p for _, p in Provider.messages if p['category'] == 'EMAIL_CHANGE_CONFIRM' and p['to'][0]['email'] == corrected)
            credential = re.search(r'#token=([A-Za-z0-9_-]{43})', confirmation['text']).group(1)
            assert request('/api/v1/auth/email-change/confirm', {'token': credential}) == (200, {'email': corrected})
            assert request('/api/v1/me', headers=auth)[1]['emailDelivery']['status'] == 'OK'
            assert webhook({**event, 'event': 'delivery', 'event_id': 'later-' + suffix, 'timestamp': occurred+1})[0] == 200
            wait_for(lambda: query(f"SELECT count(*) FROM pliego.correo_evento_proveedor WHERE evento_id='later-{suffix}' AND procesado_en IS NOT NULL") == '1')
            assert query(f"SELECT estado FROM pliego.correo_outbox WHERE correo_id={held}") == 'HELD'
            assert request('/api/v1/me', headers=auth)[1]['emailDelivery']['status'] == 'OK'
            print('Mail deliverability HTTP passed: signatures, concurrent replay/conflict, projection, real worker HELD/no provider call, profile and correction; stub only.')
        finally:
            backend.terminate()
            backend.wait(timeout=15)
            provider.shutdown()
            provider.server_close()


if __name__ == '__main__':
    main()
