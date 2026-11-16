"""Disposable local PostgreSQL 18: READY producers and verified collection races.

No provider calls. Each psql process is an independent worker transaction.
"""
import concurrent.futures
import os
import subprocess
import time
import uuid

from checkout_last_unit import PSQL, query, wait_for_activity
from verified_pickup_concurrency import ready_fixture


def event_count(order, state):
    return query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{order}:STORE_PICKUP:{state}'")


def main():
    if os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') != '1' or os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost', '::1'):
        raise SystemExit('Requires PLIEGO_TEST_DISPOSABLE_DB=1 and an explicit loopback PGHOST')
    _, first_order, _ = ready_fixture()
    admin, second_order, second_code = ready_fixture()
    app = 'pickup-ready-worker-' + uuid.uuid4().hex
    first = subprocess.Popen(PSQL + ['-c', 'BEGIN', '-c', f'SELECT pliego.fn_pickup_ready_mail_enqueue({first_order})',
        '-c', 'SELECT pg_sleep(3)', '-c', 'COMMIT'], env={**os.environ, 'PGAPPNAME': app},
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        wait_for_activity(app, "wait_event='PgSleep'")
        started = time.monotonic()
        query('CALL pliego.sp_pickup_notifications_advance_due(100)')
        assert time.monotonic() - started < 2, 'READY sweep blocked instead of SKIP LOCKED'
        assert event_count(first_order, 'READY') == '0', 'Uncommitted READY became visible'
        assert event_count(second_order, 'READY') == '1', 'Second worker missed the unlocked due order'
        _, error = first.communicate(timeout=10)
        assert first.returncode == 0, error
    finally:
        if first.poll() is None:
            first.terminate()
            first.communicate(timeout=5)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: query('CALL pliego.sp_pickup_notifications_advance_due(100)'), range(8)))
    assert event_count(first_order, 'READY') == event_count(second_order, 'READY') == '1'

    # A worker transaction that disappears before commit leaves recoverable work.
    _, restarted_order, _ = ready_fixture()
    query(f'BEGIN; SELECT pliego.fn_pickup_ready_mail_enqueue({restarted_order}); ROLLBACK')
    assert event_count(restarted_order, 'READY') == '0'
    query('CALL pliego.sp_pickup_notifications_advance_due(100)')
    query('CALL pliego.sp_pickup_notifications_advance_due(100)')
    assert event_count(restarted_order, 'READY') == '1'

    collect = f"CALL pliego.sp_pickup_collect({admin},{second_order},'{second_code}',TRUE)"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: subprocess.run(PSQL + ['-c', collect], text=True, capture_output=True), range(2)))
    assert sum(result.returncode == 0 for result in results) == 1, 'Competing collections both committed'
    assert any('P5017' in result.stderr for result in results if result.returncode), 'Loser did not receive stable already-collected conflict'
    assert event_count(second_order, 'READY') == event_count(second_order, 'COLLECTED') == '1'
    assert query(f"SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id={second_order} AND estado_nuevo='DELIVERED'") == '1'
    print('Pickup notification concurrency passed: SKIP LOCKED, repeated/concurrent sweeps, rollback/restart recovery, one READY and one COLLECTED enqueue')


if __name__ == '__main__':
    main()
