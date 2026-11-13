"""Disposable PG18: competing administrators and customer acknowledgment serialize on the real request row."""
import os
import uuid

from checkout_last_unit import fixture, query, wait_for_activity
from pending_email_change_security_concurrency import start


def request_fixture():
    actors, _ = fixture()
    actor, address = actors[0]
    admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'"))
    other_admin = int(query(f"""INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
        VALUES('identity-review-racer-{uuid.uuid4().hex}@example.invalid','fixture','ADMIN','ACTIVE')
        RETURNING usuario_id""").splitlines()[0])
    query(f"CALL pliego.sp_customer_billing_identity_register({actor},'EC_CEDULA','0912345675')")
    # Public billed checkout creates the account-level invoice history required by submit.
    query(f"""CALL pliego.sp_checkout_billed_quoted({actor},'{uuid.uuid4()}',{address},'TRANSFER','PENDING',NULL,
        'HOME_DELIVERY',NULL,NULL,'EC_CEDULA','0912345675','Cliente Revisión','Fiscal',NULL,
        'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)""")
    request_id = int(query(f"""CALL pliego.sp_customer_billing_identity_correction_request_submit(
        {actor},'{uuid.uuid4()}','0912345675','EC_CEDULA','1710034065','DOCUMENT_TYPO',NULL,
        NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)""").split('|')[0])
    return actor, admin, other_admin, request_id


def competing_decisions_with_acknowledgment(winning_decision):
    actor, first_admin, second_admin, request_id = request_fixture()
    run = uuid.uuid4().hex[:10]
    winner_name, loser_name, ack_name = (f'identity-{kind}-{run}' for kind in ('winner', 'loser', 'ack'))
    losing_decision = 'REJECT' if winning_decision == 'APPROVE' else 'APPROVE'

    def decide(admin, decision):
        reason = "'No permite confirmar el cambio.'" if decision == 'REJECT' else 'NULL'
        return f"CALL pliego.sp_admin_billing_identity_correction_decide({admin},{request_id},'{decision}',{reason},NULL,NULL,NULL,NULL)"

    winner = start(decide(first_admin, winning_decision), winner_name, pause=True)
    loser = acknowledgment = None
    try:
        wait_for_activity(winner_name, "wait_event='PgSleep'")
        loser = start(decide(second_admin, losing_decision), loser_name)
        wait_for_activity(loser_name, "wait_event_type='Lock'")
        acknowledgment = start(
            f'CALL pliego.sp_customer_billing_identity_correction_request_acknowledge({actor},{request_id})', ack_name)
        wait_for_activity(ack_name, "wait_event_type='Lock'")
        _, first_error = winner.communicate(timeout=15)
        _, loser_error = loser.communicate(timeout=15)
        _, ack_error = acknowledgment.communicate(timeout=15)
        assert winner.returncode == 0, first_error
        assert loser.returncode != 0 and 'P1111' in loser_error, loser_error
        assert acknowledgment.returncode == 0, ack_error
        status = 'APPROVED' if winning_decision == 'APPROVE' else 'REJECTED'
        assert query(f"SELECT estado||'|'||decidido_por FROM pliego.cliente_identificacion_solicitud_correccion WHERE solicitud_id={request_id}") == f'{status}|{first_admin}'
        assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE tipo='BILLING_IDENTITY_DECIDED' AND datos->>'requestId'='{request_id}'") == '1'
        assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='BILLING_IDENTITY_DECIDED:{request_id}:{status}'") == '1'
        assert query(f"SELECT count(*) FROM pliego.cliente_identificacion_evento e JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor} AND e.accion IN('CORRECTION_APPROVED','CORRECTION_REJECTED')") == '1'
        assert query(f'SELECT count(*) FROM pliego.cliente_identificacion_solicitud_acuse WHERE solicitud_id={request_id}') == '1'
        assert query(f'SELECT correction_request_id IS NULL FROM pliego.fn_customer_billing_identity_read_model({actor})') == 't'
        expected_number = '1710034065' if winning_decision == 'APPROVE' else '0912345675'
        assert query(f'SELECT identity_number FROM pliego.fn_customer_billing_identity_read_model({actor})') == expected_number
        print(f'PASS identity decision race: {status} winner, second administrator P1111, acknowledgment waits then persists, one email and immutable decision.', flush=True)
    finally:
        for process in (acknowledgment, loser, winner):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate()


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1'
    assert os.environ.get('PGHOST') == '127.0.0.1'
    assert int(query('SHOW server_version_num')) >= 180000
    for decision in ('APPROVE', 'REJECT'):
        competing_decisions_with_acknowledgment(decision)
    print('Identity decision concurrency gate: 2/2 observed-lock races passed.')


if __name__ == '__main__':
    main()
