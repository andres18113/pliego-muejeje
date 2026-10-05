"""Real concurrent outbox claims on PostgreSQL 18. No provider/network calls."""
import subprocess
import os
import hashlib
import time
import uuid
from checkout_last_unit import query, PSQL


def email_change_reauthentication_serializes_reset():
    suffix = uuid.uuid4().hex
    email = f'reauth-{suffix}@example.invalid'
    changed = f'reauth-changed-{suffix}@example.invalid'
    query(f"CALL pliego.sp_customer_register('{email}','fixture-old-hash','Ana','Pérez',NULL,NULL,NULL,NULL)")
    user = query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='{email}'")
    digest = hashlib.sha256(suffix.encode()).hexdigest()
    query(f"UPDATE pliego.usuario SET email_verificado_en=CURRENT_TIMESTAMP WHERE usuario_id={user}")
    query(f"SELECT pliego.fn_email_action_enqueue({user},'RESET_PASSWORD','{digest}','{'x' * 43}')")
    app_name = f'mail-reauth-{suffix}'
    reader = subprocess.Popen(PSQL + ['-At', '-c', 'BEGIN', '-c', f'SELECT pliego.fn_customer_password_hash({user})',
        '-c', 'SELECT pg_sleep(2)', '-c', f"CALL pliego.sp_customer_change_email({user},'{changed}',NULL)", '-c', 'COMMIT'],
        env={**os.environ, 'PGAPPNAME': app_name}, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app_name}' AND query='SELECT pg_sleep(2)' AND state='active'") == '1':
                break
            time.sleep(.05)
        else:
            raise AssertionError('Email-change transaction did not reach password-check window')
        reset = query(f"SELECT pliego.fn_email_action_consume('RESET_PASSWORD','{digest}','fixture-new-hash')")
        _, stderr = reader.communicate(timeout=15)
        assert reader.returncode == 0, stderr
        assert reset == 'f', 'Password reset committed in the middle of old-password email-change reauthentication'
        assert query(f"SELECT email_normalizado||':'||password_hash FROM pliego.usuario WHERE usuario_id={user}") == changed + ':fixture-old-hash'
        print('Transactional email concurrency gate passed: email reauthentication serializes password reset')
    finally:
        if reader.poll() is None:
            reader.terminate()
            reader.communicate(timeout=5)


def main():
    suffix = uuid.uuid4().hex
    user = query(f"INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado,email_verificado_en) "
                 f"VALUES('claim-{suffix}@example.invalid','fixture','ADMIN','ACTIVE',CURRENT_TIMESTAMP) RETURNING usuario_id").splitlines()[0]
    ids = query(f"INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,proximo_intento) "
                f"SELECT 'claim-{suffix}-'||n,'ORDER_CONFIRMED',{user},'claim@example.invalid','{{}}',CURRENT_TIMESTAMP-INTERVAL '2 days' "
                "FROM generate_series(1,2)n RETURNING correo_id").splitlines()[:2]
    first = subprocess.Popen(PSQL + ['-At', '-c', 'BEGIN', '-c', 'SELECT correo_id FROM pliego.fn_mail_outbox_claim()',
        '-c', 'SELECT pg_sleep(3)', '-c', 'COMMIT'], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        # Poll the lock holder rather than sleep to start a concurrent query.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if query("SELECT count(*) FROM pg_stat_activity WHERE query='SELECT pg_sleep(3)' AND state='active'") != '0':
                break
            time.sleep(.05)
        else:
            raise AssertionError('First claim did not hold its transaction')
        start = time.monotonic()
        second = query('SELECT correo_id FROM pliego.fn_mail_outbox_claim()')
        assert time.monotonic() - start < 2, 'SKIP LOCKED claim blocked on another worker'
        stdout, stderr = first.communicate(timeout=15)
        assert first.returncode == 0, stderr
        claimed = [line for line in stdout.splitlines() if line.strip().isdigit()]
        assert len(claimed) == 1 and second != claimed[0]
        assert set([second, claimed[0]]) == set(ids)
        for oid in ids:
            query(f"SELECT pliego.fn_mail_outbox_complete(correo_id,propietario,'SENT',NULL) FROM pliego.correo_outbox WHERE correo_id={oid}")
        print('Transactional email concurrency gate passed: two workers claim distinct events without blocking')
    finally:
        if first.poll() is None:
            first.terminate()
            first.communicate(timeout=5)
    email_change_reauthentication_serializes_reset()


if __name__ == '__main__':
    main()
