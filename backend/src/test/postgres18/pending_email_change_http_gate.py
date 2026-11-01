"""Disposable loopback PostgreSQL 18 + real backend + local provider stub only.

Creates committed checkout/invoice history: discard the isolated database after
the gate. No Mailtrap API, external storage or real email. PLIEGO_GATE_JAR may
select a frozen candidate; otherwise the standard backend target JAR is used.
"""
import base64
import hashlib
import hmac
import http.server
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid

from checkout_billing import billed
from checkout_http_gate import token as fixture_jwt
from checkout_last_unit import fixture, query
from transactional_email_http_gate import free_port, wait_for


class Provider(http.server.BaseHTTPRequestHandler):
    messages = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        message_id = str(uuid.uuid4())
        self.messages.append((message_id, payload))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({'success': True, 'message_ids': [message_id]}).encode())


def pending_token(actor, purpose):
    nonce = query(f"SELECT t.nonce FROM pliego.correo_cambio_token t JOIN pliego.correo_cambio c USING(cambio_id) "
                  f"WHERE c.usuario_id={actor} AND c.estado='PENDING' AND t.tipo='{purpose}' AND t.invalidado_en IS NULL")
    assert re.fullmatch('[A-Za-z0-9_-]{43}', nonce), 'Pending action nonce missing'
    key = os.environ.get('PLIEGO_MAIL_TOKEN_SECRET', os.environ['PLIEGO_JWT_SECRET']).encode()
    digest = hmac.new(key, f'PLIEGO:EMAIL_ACTION:v1:{purpose}:{nonce}'.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip('=')


def main():
    assert os.environ.get('PGHOST') in ('127.0.0.1', 'localhost'), 'Disposable loopback database required'
    assert int(query('SHOW server_version_num')) >= 180000, 'PostgreSQL 18 required'
    Provider.messages = []
    provider = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{free_port()}'
    webhook_secret = '0123456789abcdef0123456789abcdef'
    env = {**os.environ, 'PLIEGO_MAIL_ENABLED': 'true', 'PLIEGO_MAIL_ALLOW_LOCAL_HTTP': 'true',
        'PLIEGO_MAIL_ENDPOINT': f'http://127.0.0.1:{provider.server_port}/send',
        'PLIEGO_MAILTRAP_API_TOKEN': 'local-provider-fixture', 'PLIEGO_MAIL_FROM_ADDRESS': 'pliego@example.invalid',
        'PLIEGO_MAIL_FROM_NAME': 'PLIEGO', 'PLIEGO_APP_PUBLIC_URL': 'https://pliego.example',
        'PLIEGO_MAIL_POLL_INTERVAL': 'PT0.1S', 'PLIEGO_MAIL_BATCH_SIZE': '10',
        'PLIEGO_MAILTRAP_WEBHOOK_SECRET': webhook_secret,
        'PLIEGO_BILLING_ENABLED': 'false', 'PLIEGO_R2_ENABLED': 'false',
        'PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED': 'false'}

    def request(path, body=None, method=None, headers=None):
        req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
            method=method or ('GET' if body is None else 'POST'),
            headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            response = urllib.request.urlopen(req, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, response.headers, json.loads(raw) if raw else None

    def problem(path, body, status, code, method='POST', headers=None):
        actual, _, response = request(path, body, method, headers)
        assert actual == status and response['code'] == code, (actual, response)
        assert response['title'] and response['detail']
        return response

    def wait_mail(address, category):
        wait_for(lambda: any(p['to'][0]['email'] == address and p['category'] == category for _, p in Provider.messages))
        return [(mid, p) for mid, p in Provider.messages if p['to'][0]['email'] == address and p['category'] == category][-1]

    def webhook(message_id, event, suffix, timestamp, reason=None):
        fact = {'event_id': 'pending-' + suffix, 'message_id': message_id, 'event': event,
                'sending_stream': 'transactional', 'timestamp': timestamp}
        if reason:
            fact['reason'] = reason
        body = {'events': [fact]}
        signature = hmac.new(webhook_secret.encode(), json.dumps(body).encode(), hashlib.sha256).hexdigest()
        assert request('/api/v1/webhooks/mailtrap', body, headers={'Mailtrap-Signature': signature})[0] == 200
        wait_for(lambda: query(f"SELECT count(*) FROM pliego.correo_evento_proveedor WHERE evento_id='pending-{suffix}' AND procesado_en IS NOT NULL") == '1')

    default_jar = Path(__file__).resolve().parents[3] / 'target/pliego-backend-0.1.0-SNAPSHOT.jar'
    jar = Path(os.environ.get('PLIEGO_GATE_JAR', str(default_jar)))
    log_path = Path('/tmp/pliego-pending-email-change-http-backend.log')
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
            suffix = uuid.uuid4().hex
            email = f'pending-http-{suffix}@example.invalid'
            password = 'Pending-fixture-2026'
            status, _, registered = request('/api/v1/auth/register', {'email': email, 'password': password,
                'firstNames': 'Ana', 'lastNames': 'Pérez'})
            assert status == 201 and registered['state'] == 'PENDING_VERIFICATION'
            actor = int(registered['userId'])
            auth = {'Authorization': 'Bearer ' + fixture_jwt(actor)}
            initial_message, verification = wait_mail(email, 'VERIFY_EMAIL')
            raw = re.search(r'/verificar-correo#token=([A-Za-z0-9_-]{43})', verification['text']).group(1)
            assert request('/api/v1/auth/verify-email', {'token': raw})[0] == 204
            status, headers, login = request('/api/v1/auth/login', {'email': email, 'password': password})
            assert status == 200
            cookie = headers['Set-Cookie'].split(';', 1)[0]
            assert request('/api/v1/auth/login', {'email': email, 'password': password})[0] == 200
            original_verification = query(f"SELECT email_verificado_en FROM pliego.usuario WHERE usuario_id={actor}")
            profile = request('/api/v1/me', headers=auth)[2]
            assert profile['email'] == email and profile['emailVerified'] and profile['pendingEmail'] is None
            assert request('/api/v1/me/email-change/resend', {}, headers={})[0] == 401
            assert request('/api/v1/me/email-change', method='DELETE')[0] == 401
            problem('/api/v1/me/email', {'newEmail': 'new@example.invalid', 'currentPassword': 'incorrecta'},
                400, 'CURRENT_PASSWORD_INVALID', 'PUT', auth)
            same = problem('/api/v1/me/email', {'newEmail': email.upper(), 'currentPassword': password},
                400, 'EMAIL_CHANGE_SAME_ADDRESS', 'PUT', auth)
            assert same['detail'] == 'Ese ya es tu correo actual.'

            def change(address):
                status, _, result = request('/api/v1/me/email', {'newEmail': address, 'currentPassword': password}, 'PUT', auth)
                assert status == 202, (status, result)
                assert set(result) == {'email', 'pendingEmail'} and result['email'] == email
                assert set(result['pendingEmail']) == {'address', 'expiresAt'}
                assert result['pendingEmail']['address'] == address.lower()
                return result

            target = f'pending-new-{suffix}@example.invalid'
            first = change(target.upper())
            profile = request('/api/v1/me', headers=auth)[2]
            assert profile['email'] == email and profile['emailVerified']
            assert profile['pendingEmail'] == {**first['pendingEmail'], 'delivery': 'OK'}
            assert query(f"SELECT email_verificado_en FROM pliego.usuario WHERE usuario_id={actor}") == original_verification
            assert query(f"SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor} AND fecha_revocacion IS NOT NULL") == '0'
            assert request('/api/v1/auth/login', {'email': email, 'password': password})[0] == 200
            assert request('/api/v1/auth/login', {'email': target, 'password': password})[0] == 401
            confirm_first = pending_token(actor, 'EMAIL_CHANGE_CONFIRM')
            cancel_first = pending_token(actor, 'EMAIL_CHANGE_CANCEL')
            pending_mid, confirm_mail = wait_mail(target, 'EMAIL_CHANGE_CONFIRM')
            _, requested_mail = wait_mail(email, 'EMAIL_CHANGE_REQUESTED')
            assert '/confirmar-correo#token=' + confirm_first in confirm_mail['text']
            assert '/cancelar-cambio-correo#token=' + cancel_first in requested_mail['text']
            assert email not in confirm_mail['text'] + confirm_mail['html']
            assert target not in requested_mail['text'] + requested_mail['html']
            assert 'pe•••@example.invalid' in requested_mail['text']

            # Both order and invoice recipients are selected by the unchanged identity while pending.
            _, edition = fixture()
            query(f"CALL pliego.sp_address_create({actor},'Casa','Ana Pérez','Calle local',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,NULL)")
            address = query(f"SELECT d.direccion_id FROM pliego.direccion d JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}")
            query(f"CALL pliego.sp_cart_add_item({actor},{edition},1,NULL,NULL,NULL)")
            status, _, order = request('/api/v1/checkout', billed({'addressId': address,
                'paymentMethod': 'TRANSFER', 'simulationOutcome': 'APPROVED'}),
                headers={**auth, 'Idempotency-Key': str(uuid.uuid4())})
            assert status == 201, (status, order)
            order_id = order['orderId']
            assert query(f"SELECT destinatario FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{order_id}'") == email
            invoice = query(f"SELECT factura_id FROM pliego.factura WHERE pedido_id={order_id}")
            query(f"UPDATE pliego.factura_archivo_trabajo SET siguiente_intento=clock_timestamp()-INTERVAL '7 days' WHERE factura_id={invoice} AND tipo='PDF'")
            job = query('SELECT invoice_id,file_type,lease_owner FROM pliego.fn_invoice_artifact_claim()').split('|')
            assert job[:2] == [invoice, 'PDF']
            assert query(f"SELECT pliego.fn_invoice_artifact_complete({invoice},'PDF','{job[2]}',decode('25504446','hex'))") == 't'
            assert query(f"SELECT destinatario FROM pliego.correo_outbox WHERE evento_clave='INVOICE_ISSUED:{invoice}'") == email
            wait_mail(email, 'ORDER_CONFIRMED')
            wait_mail(email, 'INVOICE_ISSUED')
            assert not any(p['to'][0]['email'] == target and p['category'] != 'EMAIL_CHANGE_CONFIRM' for _, p in Provider.messages)

            # A hard bounce affects this pending generation only; current mail still goes to the provider.
            occurred = int(time.time())
            webhook(pending_mid, 'bounce', suffix + '-new-bounce', occurred)
            profile = request('/api/v1/me', headers=auth)[2]
            assert profile['pendingEmail']['delivery'] == 'UNDELIVERABLE' and profile['emailDelivery']['status'] == 'OK'
            assert query(f"SELECT count(*) FROM pliego.correo_destinatario_entrega WHERE destinatario='{target}' AND motivo IS NOT NULL") == '0'
            assert request('/api/v1/auth/forgot-password', {'email': email})[0] == 202
            wait_mail(email, 'RESET_PASSWORD')
            assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={actor} AND destinatario='{email}' AND estado='HELD'") == '0'
            print('Pending email HTTP passed: 202/current identity, verification, login, sessions and ORDER/INVOICE recipients unchanged; pending bounce isolated from current mail')

            # Replacing and resending supersede the appropriate token, retaining the recovery token on resend.
            replacement = f'pending-replacement-{suffix}@example.invalid'
            second = change(replacement)
            problem('/api/v1/auth/email-change/confirm', {'token': confirm_first}, 410, 'EMAIL_CHANGE_TOKEN_SUPERSEDED')
            problem('/api/v1/auth/email-change/cancel', {'token': cancel_first}, 410, 'EMAIL_CHANGE_TOKEN_SUPERSEDED')
            confirm_second = pending_token(actor, 'EMAIL_CHANGE_CONFIRM')
            cancel_second = pending_token(actor, 'EMAIL_CHANGE_CANCEL')
            problem('/api/v1/me/email-change/resend', {}, 429, 'EMAIL_CHANGE_RATE_LIMITED', headers=auth)
            query(f"UPDATE pliego.correo_cambio SET ultimo_envio_en=clock_timestamp()-INTERVAL '2 minutes' WHERE usuario_id={actor} AND estado='PENDING'")
            assert request('/api/v1/me/email-change/resend', {}, headers=auth)[0] == 202
            confirm_resent = pending_token(actor, 'EMAIL_CHANGE_CONFIRM')
            assert confirm_resent != confirm_second
            assert pending_token(actor, 'EMAIL_CHANGE_CANCEL') == cancel_second
            assert request('/api/v1/me', headers=auth)[2]['pendingEmail']['expiresAt'] == second['pendingEmail']['expiresAt']
            problem('/api/v1/auth/email-change/confirm', {'token': confirm_second}, 410, 'EMAIL_CHANGE_TOKEN_SUPERSEDED')
            assert request('/api/v1/auth/email-change/cancel', {'token': cancel_second})[0] == 200
            assert request('/api/v1/auth/email-change/cancel', {'token': cancel_second})[0] == 200
            problem('/api/v1/auth/email-change/confirm', {'token': confirm_resent}, 410, 'EMAIL_CHANGE_CANCELLED')
            for _ in range(2):
                assert request('/api/v1/me/email-change', method='DELETE', headers=auth)[0] == 204
            problem('/api/v1/me/email-change/resend', {}, 404, 'EMAIL_CHANGE_NOT_PENDING', headers=auth)
            assert request('/api/v1/me', headers=auth)[2]['pendingEmail'] is None
            print('Pending email HTTP passed: replace, resend, cooldown, preserved recovery credential, idempotent token cancel and DELETE')

            change(f'pending-expired-{suffix}@example.invalid')
            expired_confirm = pending_token(actor, 'EMAIL_CHANGE_CONFIRM')
            expired_cancel = pending_token(actor, 'EMAIL_CHANGE_CANCEL')
            query(f"UPDATE pliego.correo_cambio SET fecha_expiracion=clock_timestamp()-INTERVAL '1 second' WHERE usuario_id={actor} AND estado='PENDING'")
            assert request('/api/v1/me', headers=auth)[2]['pendingEmail'] is None
            problem('/api/v1/auth/email-change/confirm', {'token': expired_confirm}, 410, 'EMAIL_CHANGE_TOKEN_EXPIRED')
            problem('/api/v1/auth/email-change/cancel', {'token': expired_cancel}, 410, 'EMAIL_CHANGE_TOKEN_EXPIRED')
            problem('/api/v1/me/email-change/resend', {}, 404, 'EMAIL_CHANGE_NOT_PENDING', headers=auth)
            conflict = f'pending-taken-{suffix}@example.invalid'
            change(conflict)
            conflict_confirm = pending_token(actor, 'EMAIL_CHANGE_CONFIRM')
            query(f"CALL pliego.sp_customer_register('{conflict}','fixture','Luis','Mora',NULL,NULL,NULL,NULL)")
            problem('/api/v1/auth/email-change/confirm', {'token': conflict_confirm}, 409, 'P1101')
            assert request('/api/v1/me', headers=auth)[2]['pendingEmail']['address'] == conflict
            assert query(f"SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor} AND fecha_revocacion IS NOT NULL") == '0'
            problem('/api/v1/me/email', {'newEmail': conflict, 'currentPassword': password}, 409, 'P1101', 'PUT', auth)
            assert request('/api/v1/me/email-change', method='DELETE', headers=auth)[0] == 204
            for endpoint in ('confirm', 'cancel'):
                for invalid in ('malformado', 'z' * 43, None):
                    invalid_problem = problem('/api/v1/auth/email-change/' + endpoint, {'token': invalid}, 400, 'EMAIL_CHANGE_TOKEN_INVALID')
                    assert 'example.invalid' not in invalid_problem['detail']
            print('Pending email HTTP passed: expiry reads null, no resend, confirmation-time uniqueness P1101, rollback and private invalid-token responses')

            # Current delivery failure does not prevent a session+password correction.
            webhook(initial_message, 'bounce', suffix + '-current-bounce', occurred + 1)
            profile = request('/api/v1/me', headers=auth)[2]
            assert profile['emailDelivery']['status'] == 'UNDELIVERABLE'
            held = query(f"INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos) "
                f"VALUES('pending-held-{suffix}','ORDER_CONFIRMED',{actor},'{email}','{{}}') RETURNING correo_id").splitlines()[0]
            wait_for(lambda: query(f"SELECT estado FROM pliego.correo_outbox WHERE correo_id={held}") == 'HELD')
            corrected = f'pending-corrected-{suffix}@example.invalid'
            change(corrected)
            final_confirm = pending_token(actor, 'EMAIL_CHANGE_CONFIRM')
            final_cancel = pending_token(actor, 'EMAIL_CHANGE_CANCEL')
            corrected_mid, _ = wait_mail(corrected, 'EMAIL_CHANGE_CONFIRM')
            webhook(corrected_mid, 'suspension', suffix + '-new-suppressed', occurred + 2, 'Recipient is in suppression list')
            profile = request('/api/v1/me', headers=auth)[2]
            assert profile['pendingEmail']['delivery'] == 'UNDELIVERABLE' and profile['emailDelivery']['status'] == 'UNDELIVERABLE'
            status, _, confirmed = request('/api/v1/auth/email-change/confirm', {'token': final_confirm})
            assert status == 200 and confirmed == {'email': corrected}
            profile = request('/api/v1/me', headers=auth)[2]
            assert profile['email'] == corrected and profile['emailVerified'] and profile['pendingEmail'] is None
            assert profile['emailDelivery'] == {'status': 'OK', 'since': None}
            assert query(f"SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor} AND fecha_revocacion IS NULL") == '0'
            assert request('/api/v1/auth/refresh', {}, headers={'Cookie': cookie, 'X-PLIEGO-SESSION-REQUEST': '1'})[0] == 204
            assert request('/api/v1/auth/login', {'email': email, 'password': password})[0] == 401
            assert request('/api/v1/auth/login', {'email': corrected, 'password': password})[0] == 200
            assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={actor} AND tipo='EMAIL_CHANGED' AND destinatario='{email}'") == '1'
            problem('/api/v1/auth/email-change/confirm', {'token': final_confirm}, 410, 'EMAIL_CHANGE_TOKEN_USED')
            problem('/api/v1/auth/email-change/cancel', {'token': final_cancel}, 410, 'EMAIL_CHANGE_ALREADY_CONFIRMED')
            assert query(f"SELECT estado FROM pliego.correo_outbox WHERE correo_id={held}") == 'HELD'
            webhook(corrected_mid, 'bounce', suffix + '-late-pending-bounce', occurred + 3)
            assert request('/api/v1/me', headers=auth)[2]['emailDelivery']['status'] == 'OK'
            problem('/api/v1/me/email', {'newEmail': f'pending-sixth-{suffix}@example.invalid', 'currentPassword': password},
                429, 'EMAIL_CHANGE_RATE_LIMITED', 'PUT', auth)
            assert request('/api/v1/me', headers=auth)[2]['pendingEmail'] is None
            print('Pending email HTTP passed: correction from UNDELIVERABLE, promotion verified, account delivery cleared, every refresh revoked, single use, cancel-after-confirm, hourly quota and held rows preserved')
        finally:
            if backend.poll() is None:
                backend.terminate()
            backend.wait(timeout=30)
            provider.shutdown()
            provider.server_close()


if __name__ == '__main__':
    main()
