"""Disposable PG18 credential deadlines, including observed production-row waits.

Uses the same public Database API and identity-fixture DML as the other gates,
including under strict pliego_app. No transport, real credentials or new roles.
"""
import hashlib
import os
import subprocess
import uuid

from checkout_last_unit import PSQL, query, wait_for_activity


RUN_PREFIX = 'expiry-' + uuid.uuid4().hex + '-'
CREATED_ACTORS = []


def digest(label):
    return hashlib.sha256(label.encode()).hexdigest()


def account():
    tag = uuid.uuid4().hex
    actor = int(query(f"CALL pliego.sp_customer_register('{RUN_PREFIX}{tag}@example.invalid',"
                      "'fixture-password','Cliente','Caducidad',NULL,NULL,NULL,NULL)").split('|')[0])
    CREATED_ACTORS.append(actor)
    return actor, tag


def session(prior=False):
    actor, tag = account()
    current, replacement = digest(tag + 'current'), digest(tag + 'replacement')
    query(f"UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id={actor}")
    query(f"SELECT pliego.fn_auth_session_create({actor},'{replacement if prior else current}',"
          "clock_timestamp()+INTERVAL '1 day')")
    if prior:
        query(f"UPDATE pliego.sesion_autenticacion SET token_refresco_hash_anterior='{current}',"
              "fecha_creacion=clock_timestamp()-INTERVAL '1 day',fecha_renovacion=clock_timestamp() "
              f"WHERE usuario_id={actor}")
    return actor, current, replacement


def refresh(current, replacement):
    return f"SELECT count(*) FROM pliego.fn_auth_session_refresh('{current}','{replacement}')"


def after_lock_wait(actor, sql, arm, include_session=False):
    """Arm only our deadline, observe the waiter, then release after it expires."""
    tag = 'credential-expiry-' + uuid.uuid4().hex
    locks = [f'SELECT usuario_id FROM pliego.usuario WHERE usuario_id={actor} FOR UPDATE']
    if include_session:
        locks.append(f'SELECT sesion_id FROM pliego.sesion_autenticacion WHERE usuario_id={actor} FOR UPDATE')
    holder = subprocess.Popen(PSQL + ['-Atq', '-c', 'BEGIN'] +
                              [part for lock in locks for part in ('-c', lock)] +
                              ['-c', 'SELECT pg_sleep(3)', '-c', 'COMMIT'],
                              env={**os.environ, 'PGAPPNAME': tag + '-holder'},
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    waiter = None
    try:
        wait_for_activity(tag + '-holder', "wait_event='PgSleep'")
        # Separate tables/rows let the fixture set the deadline without taking
        # the very user/session locks held above. The holder only locks rows.
        if arm:
            query(arm)
        waiter = subprocess.Popen(PSQL + ['-Atq', '-c', sql],
                                  env={**os.environ, 'PGAPPNAME': tag + '-waiter'},
                                  text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        wait_for_activity(tag + '-waiter', "wait_event_type='Lock'", timeout=5)
        _, holder_error = holder.communicate(timeout=10)
        output, error = waiter.communicate(timeout=10)
        assert holder.returncode == waiter.returncode == 0, holder_error + error
        return output.strip()
    finally:
        for process in (waiter, holder):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate()


def expired_email_after_user_wait(purpose):
    actor, tag = account()
    token = digest(tag + purpose)
    query(f"SELECT pliego.fn_email_action_enqueue({actor},'{purpose}','{token}','{'A' * 43}')")
    password = "'replacement-fixture-password'" if purpose == 'RESET_PASSWORD' else 'NULL'
    result = after_lock_wait(actor,
        f"SELECT pliego.fn_email_action_consume('{purpose}','{token}',{password})",
        f"UPDATE pliego.correo_token SET fecha_expiracion=clock_timestamp()+INTERVAL '1 second' WHERE usuario_id={actor}")
    assert result == 'f', f'{purpose} accepted after its deadline while waiting for the user lock'
    assert query(f"SELECT fecha_expiracion<clock_timestamp() AND fecha_uso IS NULL "
                 f"FROM pliego.correo_token WHERE usuario_id={actor}") == 't'
    assert query(f"SELECT password_hash='fixture-password' AND email_verificado_en IS NULL "
                 f"FROM pliego.usuario WHERE usuario_id={actor}") == 't'


def expired_refresh_after_wait(prior):
    actor, current, replacement = session(prior)
    # Arm before locking: both the holder and refresher must acquire the same
    # session row, so changing it while the holder sleeps would itself block.
    query(f"UPDATE pliego.sesion_autenticacion SET fecha_expiracion=clock_timestamp()+INTERVAL '1 second' "
          f"WHERE usuario_id={actor}")
    result = after_lock_wait(actor, refresh(current, replacement), None, include_session=True)
    assert result == '0', f'{"prior" if prior else "current"} refresh accepted after absolute expiry'
    expected = replacement if prior else current
    assert query(f"SELECT fecha_expiracion<clock_timestamp() AND token_refresco_hash='{expected}' "
                 f"FROM pliego.sesion_autenticacion WHERE usuario_id={actor}") == 't'


def expired_retry_after_wait():
    actor, current, replacement = session(prior=True)
    query(f"UPDATE pliego.sesion_autenticacion SET fecha_renovacion=clock_timestamp()-INTERVAL '299 seconds' "
          f"WHERE usuario_id={actor}")
    result = after_lock_wait(actor, refresh(current, replacement), None, include_session=True)
    assert result == '0', 'prior credential accepted after its five minute recovery deadline'
    assert query(f"SELECT fecha_renovacion<clock_timestamp()-INTERVAL '5 minutes' "
                 f"FROM pliego.sesion_autenticacion WHERE usuario_id={actor}") == 't'


def expired_retry_in_old_transaction():
    actor, current, replacement = session(prior=True)
    query(f"UPDATE pliego.sesion_autenticacion SET fecha_renovacion=clock_timestamp()-INTERVAL '299 seconds' "
          f"WHERE usuario_id={actor}")
    rows = query('BEGIN; SELECT pg_sleep(2); ' + refresh(current, replacement) + '; COMMIT').splitlines()
    assert '0' in rows and '1' not in rows, 'transaction start extended the prior credential recovery deadline'


def live_rotation_and_retry():
    actor, current, replacement = session()
    expiry = query(f'SELECT fecha_expiracion FROM pliego.sesion_autenticacion WHERE usuario_id={actor}')
    assert query(refresh(current, replacement)) == '1'
    assert query(refresh(current, replacement)) == '1'
    assert query(f'SELECT fecha_expiracion FROM pliego.sesion_autenticacion WHERE usuario_id={actor}') == expiry
    query(f"SELECT pliego.fn_auth_session_revoke('{current}')")
    assert query(refresh(current, replacement)) == '0'


def live_email_single_use(purpose):
    actor, tag = account()
    token = digest(tag + purpose)
    query(f"SELECT pliego.fn_email_action_enqueue({actor},'{purpose}','{token}','{'A' * 43}')")
    password = "'replacement-fixture-password'" if purpose == 'RESET_PASSWORD' else 'NULL'
    consume = f"SELECT pliego.fn_email_action_consume('{purpose}','{token}',{password})"
    assert query(consume) == 't'
    assert query(consume) == 'f'


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1', 'Disposable database acknowledgement required'
    assert os.environ.get('PGHOST') in ('127.0.0.1', 'localhost'), 'Loopback database required'
    assert query('SHOW server_version_num').startswith('18'), 'PostgreSQL 18 required'
    cases = [
        ('verification expires during user wait', lambda: expired_email_after_user_wait('VERIFY_EMAIL')),
        ('reset expires during user wait', lambda: expired_email_after_user_wait('RESET_PASSWORD')),
        ('current refresh expires during lock wait', lambda: expired_refresh_after_wait(False)),
        ('prior refresh expires during lock wait', lambda: expired_refresh_after_wait(True)),
        ('prior recovery expires during lock wait', expired_retry_after_wait),
        ('old transaction cannot extend recovery', expired_retry_in_old_transaction),
        ('live rotation/retry/revoke preserves absolute expiry', live_rotation_and_retry),
        ('live verification remains single use', lambda: live_email_single_use('VERIFY_EMAIL')),
        ('live reset remains single use', lambda: live_email_single_use('RESET_PASSWORD')),
    ]
    failures = []
    try:
        for label, case in cases:
            try:
                case()
                print('PASS: ' + label, flush=True)
            except AssertionError as error:
                failures.append(label)
                print('FAIL: ' + label + ': ' + str(error), flush=True)
        assert not failures, 'Credential deadline failures: ' + ', '.join(failures)
    finally:
        if CREATED_ACTORS:
            actors = ','.join(str(actor) for actor in CREATED_ACTORS)
            # Expired, intentionally unconsumed actions are security fixtures.
            # Retire only our pending messages so later outbox claim races do
            # not serialize on the bulk expiry update for these same rows.
            query("UPDATE pliego.correo_outbox SET estado='FAILED',ultimo_error='TEST_COMPLETE',"
                  "datos=datos-'nonce',fecha_actualizacion=clock_timestamp() "
                  f"WHERE estado='PENDING' AND usuario_id IN ({actors})")
    print(f'Credential expiry PG18 gate passed: {len(cases)} cases')


if __name__ == '__main__':
    main()
