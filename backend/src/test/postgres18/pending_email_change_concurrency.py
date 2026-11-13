"""PostgreSQL 18, disposable loopback DB only; no provider or HTTP calls.

Independent committed connections prove the winner and loser of identity races.
The tests wait for PostgreSQL lock states, then inspect committed state from a
third connection. Customer-only fixtures are deleted after each race.
"""
import hashlib
import os
import subprocess
import uuid
from contextlib import contextmanager

from checkout_last_unit import PSQL, query, wait_for_activity


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


@contextmanager
def pending_fixture():
    suffix = uuid.uuid4().hex
    email = f'pending-race-{suffix}@example.invalid'
    target = f'pending-target-{suffix}@example.invalid'
    users = []
    try:
        query(f"CALL pliego.sp_customer_register('{email}','fixture','Ana','Pérez',NULL,NULL,NULL,NULL)")
        actor = query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='{email}'")
        users.append(actor)
        query(f"UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id={actor}")
        for number in (1, 2):
            query(f"SELECT pliego.fn_auth_session_create({actor},'{digest(suffix + str(number))}',clock_timestamp()+INTERVAL '1 day')")
        confirm = digest(suffix + 'confirm')
        cancel = digest(suffix + 'cancel')
        query(f"SELECT * FROM pliego.fn_customer_email_change_request({actor},'{target}','{confirm}','{'c' * 43}','{cancel}','{'d' * 43}')")
        yield {'actor': actor, 'email': email, 'target': target, 'confirm': confirm,
               'cancel': cancel, 'suffix': suffix, 'users': users}
    finally:
        if users:
            actors = ','.join(users)
            query(f"""BEGIN;
                DELETE FROM pliego.correo_outbox WHERE usuario_id IN ({actors});
                DELETE FROM pliego.correo_cambio_token WHERE cambio_id IN
                    (SELECT cambio_id FROM pliego.correo_cambio WHERE usuario_id IN ({actors}));
                DELETE FROM pliego.correo_cambio WHERE usuario_id IN ({actors});
                DELETE FROM pliego.correo_token WHERE usuario_id IN ({actors});
                DELETE FROM pliego.sesion_autenticacion WHERE usuario_id IN ({actors});
                DELETE FROM pliego.correo_limite WHERE clave IN
                    (SELECT prefix||u.usuario_id FROM pliego.usuario u
                     CROSS JOIN (VALUES ('EMAIL_CHANGE:'),('EMAIL_CHANGE_RESEND:')) p(prefix)
                     WHERE u.usuario_id IN ({actors}));
                DELETE FROM pliego.cliente WHERE usuario_id IN ({actors});
                DELETE FROM pliego.usuario WHERE usuario_id IN ({actors});
                COMMIT;""")


def competing_transactions(winner_sql, loser_sql, loser_state, suffix):
    winner_name = 'pending-winner-' + suffix
    loser_name = 'pending-loser-' + suffix
    winner = subprocess.Popen(PSQL + ['-At', '-c', 'BEGIN', '-c', winner_sql,
        '-c', 'SELECT pg_sleep(3)', '-c', 'COMMIT'],
        env={**os.environ, 'PGAPPNAME': winner_name}, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    loser = None
    try:
        wait_for_activity(winner_name, "wait_event='PgSleep'")
        loser = subprocess.Popen(PSQL + ['-At', '-c', 'BEGIN', '-c', loser_sql, '-c', 'COMMIT'],
            env={**os.environ, 'PGAPPNAME': loser_name}, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        wait_for_activity(loser_name, "wait_event_type='Lock'")
        _, winning_error = winner.communicate(timeout=15)
        _, losing_error = loser.communicate(timeout=15)
        assert winner.returncode == 0, winning_error
        assert loser.returncode != 0 and loser_state in losing_error, (
            'Losing transaction did not return expected SQLSTATE ' + loser_state)
    finally:
        for process in (winner, loser):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate(timeout=5)


def assert_final(fixture, confirmed):
    actor = fixture['actor']
    expected_state = 'CONFIRMED' if confirmed else 'CANCELLED'
    expected_email = fixture['target'] if confirmed else fixture['email']
    assert query(f"SELECT estado FROM pliego.correo_cambio WHERE usuario_id={actor}") == expected_state
    assert query(f"SELECT email_normalizado FROM pliego.usuario WHERE usuario_id={actor}") == expected_email
    assert query(f"SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor}") == '2'
    assert query(f"SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor} AND fecha_revocacion IS NULL") == ('0' if confirmed else '2')
    assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={actor} AND tipo='EMAIL_CHANGED'") == ('1' if confirmed else '0')
    assert query(f"SELECT email_verificado_en IS NOT NULL FROM pliego.usuario WHERE usuario_id={actor}") == 't'
    assert query(f"SELECT pending_email_address IS NULL FROM pliego.fn_customer_profile_email_change({actor})") == 't'


def double_confirm():
    with pending_fixture() as f:
        command = f"SELECT pliego.fn_email_change_confirm('{f['confirm']}')"
        competing_transactions(command, command, 'P1125', f['suffix'])
        assert_final(f, True)
    print('Pending email concurrency passed: double confirm has one winner, one used-token failure, one notice and all refresh sessions revoked')


def confirm_against_cancel(confirm_first):
    with pending_fixture() as f:
        confirm = f"SELECT pliego.fn_email_change_confirm('{f['confirm']}')"
        cancel = f"SELECT pliego.fn_email_change_cancel('{f['cancel']}')"
        competing_transactions(confirm if confirm_first else cancel,
            cancel if confirm_first else confirm, 'P1128' if confirm_first else 'P1127', f['suffix'])
        assert_final(f, confirm_first)
    print('Pending email concurrency passed: confirm/cancel race, ' + ('confirm' if confirm_first else 'cancel') + ' commits first')


def uniqueness_conflict_at_commit():
    with pending_fixture() as f:
        other_email = f"pending-taker-{f['suffix']}@example.invalid"
        query(f"CALL pliego.sp_customer_register('{other_email}','fixture','Luis','Mora',NULL,NULL,NULL,NULL)")
        other = query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='{other_email}'")
        f['users'].append(other)
        competing_transactions(f"CALL pliego.sp_customer_change_email({other},'{f['target']}',NULL)",
            f"SELECT pliego.fn_email_change_confirm('{f['confirm']}')", 'P1101', f['suffix'])
        actor = f['actor']
        assert query(f"SELECT email_normalizado FROM pliego.usuario WHERE usuario_id={other}") == f['target']
        assert query(f"SELECT email_normalizado FROM pliego.usuario WHERE usuario_id={actor}") == f['email']
        assert query(f"SELECT estado FROM pliego.correo_cambio WHERE usuario_id={actor}") == 'PENDING'
        assert query(f"SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor} AND fecha_revocacion IS NULL") == '2'
        assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={actor} AND tipo='EMAIL_CHANGED'") == '0'
    print('Pending email concurrency passed: concurrent unique-index conflict returns P1101 without partial promotion or session revocation')


def resend_supersedes_waiting_confirm():
    with pending_fixture() as f:
        actor = f['actor']
        replacement = digest(f['suffix'] + 'resend')
        query(f"UPDATE pliego.correo_cambio SET ultimo_envio_en=clock_timestamp()-INTERVAL '2 minutes' WHERE usuario_id={actor}")
        competing_transactions(f"SELECT pliego.fn_customer_email_change_resend({actor},'{replacement}','{'e' * 43}')",
            f"SELECT pliego.fn_email_change_confirm('{f['confirm']}')", 'P1126', f['suffix'])
        assert query(f"SELECT pliego.fn_email_change_confirm('{replacement}')") == f['target']
        assert_final(f, True)
    print('Pending email concurrency passed: resend invalidates a confirmation that looked up its nonce before the lock')


def main():
    assert os.environ.get('PGHOST') in ('127.0.0.1', 'localhost'), 'Disposable loopback PostgreSQL required'
    assert int(query('SHOW server_version_num')) >= 180000, 'PostgreSQL 18 required'
    double_confirm()
    confirm_against_cancel(True)
    confirm_against_cancel(False)
    uniqueness_conflict_at_commit()
    resend_supersedes_waiting_confirm()


if __name__ == '__main__':
    main()
