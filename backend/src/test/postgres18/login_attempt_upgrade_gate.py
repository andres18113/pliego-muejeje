"""Actual packaged Flyway V098 -> V100 over populated history, empty disposable DB only."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from checkout_last_unit import query, fixture
from login_attempt_gate import begin, digest


def migrate(target):
    jar = Path(__file__).resolve().parents[3] / 'target/pliego-backend-0.1.0-SNAPSHOT.jar'
    with tempfile.NamedTemporaryFile(prefix='pliego-login-upgrade-', suffix='.log', delete=False) as log:
        name = Path(log.name)
        process = subprocess.Popen(['java', '-jar', str(jar), '--server.port=0', f'--spring.flyway.target={target}'],
            env={**os.environ, 'PLIEGO_MAIL_ENABLED': 'false', 'PLIEGO_BILLING_ENABLED': 'false',
                 'PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED': 'false'}, stdout=log, stderr=log)
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AssertionError(f'Flyway startup failed: {name}')
            if 'Started PliegoApplication' in name.read_text():
                assert query("SELECT count(*)::TEXT||':'||max(version)::INTEGER FROM public.flyway_schema_history WHERE success AND version IS NOT NULL") == f'{target}:{target}'
                return
            time.sleep(.1)
        raise AssertionError(f'Flyway startup timed out: {name}')
    finally:
        process.terminate()
        process.wait(timeout=20)


def snapshots():
    tables = query("SELECT tablename FROM pg_tables WHERE schemaname='pliego' AND tablename<>'login_intento_limite' ORDER BY tablename").splitlines()
    # Compare every existing table, including users, sessions, orders, payments and outbox.
    return {table: query(f'SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::TEXT),\'[]\'::JSONB) FROM pliego."{table}" t') for table in tables}


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1'
    assert os.environ.get('PGHOST') == '127.0.0.1'
    assert query("SELECT to_regnamespace('pliego') IS NULL") == 't', 'Use an empty disposable database'
    migrate(98)
    actors, edition = fixture()
    actor, address = actors[0]
    query(f"CALL pliego.sp_checkout_idempotent({actor},'{__import__('uuid').uuid4()}',{address},'TRANSFER','APPROVED',NULL,'HOME_DELIVERY',NULL,NULL,NULL,NULL,NULL,NULL)")
    query(f"UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id={actor}")
    refresh = digest(str(actor) + 'upgrade-session')
    assert query(f"SELECT pliego.fn_auth_session_create_checked({actor},'{refresh}',clock_timestamp()+INTERVAL '1 day','fixture-hash')") == 't'
    before = snapshots()
    migrate(100)
    assert snapshots() == before, 'V099/V100 changed existing persisted rows'
    assert query('SELECT count(*) FROM pliego.login_intento_limite') == '0'
    email = query(f'SELECT email_normalizado FROM pliego.usuario WHERE usuario_id={actor}')
    assert query(begin(email, digest('upgrade-client'))) == '0'
    assert query(f"SELECT user_id FROM pliego.fn_auth_session_refresh('{refresh}','{digest(refresh)}')") == str(actor)
    print(json.dumps({'upgrade': '98->100', 'cases_passed': 1, 'cases_total': 1,
                      'existing_tables_preserved': len(before), 'history': 'order/payment/session/outbox',
                      'login_admission': True, 'refresh_survives': True}))


if __name__ == '__main__':
    main()
