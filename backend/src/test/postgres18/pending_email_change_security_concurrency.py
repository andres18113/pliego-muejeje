"""Disposable PG18 races: stale login, current-address reset and email confirmation.

Writers pause only after acquiring the production user lock. The competing process
must reach a PostgreSQL lock wait before the first transaction can commit.
No mail transport, raw action tokens, credentials or external services are used.
"""
import hashlib
import os
import subprocess
import uuid

from checkout_last_unit import PSQL, query, wait_for_activity


def digest(label):
    return hashlib.sha256(label.encode()).hexdigest()


def account():
    suffix = uuid.uuid4().hex
    email = 'email-security-' + suffix + '@example.invalid'
    password = 'fixture-password-' + suffix
    actor = int(query(f"CALL pliego.sp_customer_register('{email}','{password}','Cliente','Seguridad',NULL,NULL,NULL,NULL)").split('|')[0])
    verify_hash = digest(suffix + 'verify')
    query(f"SELECT pliego.fn_email_action_enqueue({actor},'VERIFY_EMAIL','{verify_hash}','{'A'*43}')")
    assert query(f"SELECT pliego.fn_email_action_consume('VERIFY_EMAIL','{verify_hash}',NULL)") == 't'
    assert query(f"SELECT pliego.fn_auth_session_create_checked({actor},'{digest(suffix+'session')}',clock_timestamp()+INTERVAL '1 day','{password}')") == 't'
    target = 'email-security-new-' + suffix + '@example.invalid'
    confirm, cancel, reset = (digest(suffix + purpose) for purpose in ('confirm', 'cancel', 'reset'))
    query(f"SELECT * FROM pliego.fn_customer_email_change_request({actor},'{target}','{confirm}','{'B'*43}','{cancel}','{'C'*43}')")
    query(f"SELECT pliego.fn_email_action_enqueue({actor},'RESET_PASSWORD','{reset}','{'D'*43}')")
    return actor, email, target, password, confirm, reset


def start(sql, name, pause=False):
    commands = PSQL + ['-At', '-c', 'BEGIN', '-c', sql]
    if pause:
        commands += ['-c', 'SELECT pg_sleep(4)']
    commands += ['-c', 'COMMIT']
    return subprocess.Popen(commands, env={**os.environ, 'PGAPPNAME': name},
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def race(first_sql, second_sql, label):
    run_id = uuid.uuid4().hex[:8]
    first_name, second_name = 'security-first-' + label + '-' + run_id, 'security-second-' + label + '-' + run_id
    first = start(first_sql, first_name, pause=True)
    second = None
    try:
        wait_for_activity(first_name, "wait_event='PgSleep'")
        second = start(second_sql, second_name)
        try:
            wait_for_activity(second_name, "wait_event_type='Lock'")
        except AssertionError:
            if second.poll() is not None:
                early_out, early_error = second.communicate()
                raise AssertionError(f'{label}: competing command exited before acquiring the user lock: {early_error}') from None
            raise
        first_out, first_error = first.communicate(timeout=15)
        second_out, second_error = second.communicate(timeout=15)
        assert first.returncode == 0, f'{label}: first writer failed: {first_error}'
        return second.returncode, second_out.splitlines(), second_error
    finally:
        for process in (second, first):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate()


def main():
    assert os.environ.get('PGHOST') in ('127.0.0.1', 'localhost'), 'Disposable loopback DB required'
    assert query('SHOW server_version_num').startswith('18'), 'PostgreSQL 18 required'
    actor, old_email, target, password, confirm, reset = account()
    # The authentication projection is read before confirmation commits.
    auth_email = query(f"SELECT email_canonical FROM pliego.fn_user_auth_data('{old_email}')")
    assert auth_email == old_email
    code, rows, error = race(f"SELECT pliego.fn_email_change_confirm('{confirm}')",
      f"SELECT pliego.fn_auth_session_create_identity_checked({actor},'{digest(str(actor)+'stale')}',clock_timestamp()+INTERVAL '1 day','{password}','{auth_email}')",
      'confirm-stale-login')
    assert code == 0 and 'f' in rows, f'Stale login did not return false after waiting: {rows} / {error}'
    assert query(f"SELECT email_normalizado FROM pliego.usuario WHERE usuario_id={actor}") == target
    assert query(f'SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor} AND fecha_revocacion IS NULL') == '0'
    assert query(f"SELECT pliego.fn_auth_session_create_identity_checked({actor},'{digest(str(actor)+'new')}',clock_timestamp()+INTERVAL '1 day','{password}','{target}')") == 't'

    actor, old_email, target, password, confirm, reset = account()
    code, rows, error = race(f"SELECT pliego.fn_email_action_consume('RESET_PASSWORD','{reset}','fixture-reset-password')",
                            f"SELECT pliego.fn_email_change_confirm('{confirm}')", 'reset-confirm')
    assert code != 0 and 'P1127' in error, f'Reset-first confirmation was not cancelled: {rows} / {error}'
    assert query(f'SELECT email_normalizado FROM pliego.usuario WHERE usuario_id={actor}') == old_email
    assert query(f'SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor} AND fecha_revocacion IS NULL') == '0'
    assert query(f"SELECT estado FROM pliego.correo_cambio WHERE usuario_id={actor}") == 'CANCELLED'

    actor, old_email, target, password, confirm, reset = account()
    code, rows, error = race(f"SELECT pliego.fn_email_change_confirm('{confirm}')",
      f"SELECT pliego.fn_email_action_consume('RESET_PASSWORD','{reset}','fixture-reset-password')", 'confirm-reset')
    assert code == 0 and 'f' in rows, f'Confirm-first reset remained usable: {rows} / {error}'
    assert query(f'SELECT email_normalizado FROM pliego.usuario WHERE usuario_id={actor}') == target
    assert query(f'SELECT password_hash FROM pliego.usuario WHERE usuario_id={actor}') == password
    assert query(f'SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor} AND fecha_revocacion IS NULL') == '0'
    print('Pending email security concurrency passed: confirm fences stale old-email login (false), '
          'reset-first cancels confirmation (P1127), confirm-first invalidates old-address reset (false); refresh sessions revoked.')


if __name__ == '__main__':
    main()
