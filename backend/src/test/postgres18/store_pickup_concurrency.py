"""Checkout replay and collection/cancellation use the existing PostgreSQL locks."""
import concurrent.futures
import os
import subprocess
import time
import uuid
from checkout_last_unit import fixture, query, PSQL


def main():
    actors, edition = fixture()
    actor, _ = actors[0]
    location = query('SELECT pickup_location_id FROM pliego.fn_pickup_locations() LIMIT 1')
    key = str(uuid.uuid4())
    command = (f"CALL pliego.sp_checkout_idempotent({actor},'{key}',NULL,'TRANSFER','APPROVED',NULL,'STORE_PICKUP',"
               f"{location},NULL,NULL,NULL,NULL,NULL)")
    app = 'pickup-replay-' + uuid.uuid4().hex
    first = subprocess.Popen(PSQL + ['-At', '-c', 'BEGIN', '-c', command, '-c', 'SELECT pg_sleep(2)', '-c', 'COMMIT'],
        env={**os.environ, 'PGAPPNAME': app}, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        end = time.monotonic() + 10
        while time.monotonic() < end:
            if query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND query='SELECT pg_sleep(2)' AND state='active'") == '1':
                break
            time.sleep(.05)
        else:
            raise AssertionError('Initial checkout did not hold its transaction')
        replay = query(command).splitlines()[0].split('|')[0]
        stdout, stderr = first.communicate(timeout=15)
        assert first.returncode == 0, stderr
        original = next(line for line in stdout.splitlines() if '|CONFIRMED|' in line).split('|')[0]
        assert replay == original
        assert query(f"SELECT count(*) FROM pliego.pedido_item WHERE edicion_id={edition}") == '1'
        assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{original}'") == '1'
        assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}") == '0'
        admin = query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' ORDER BY usuario_id LIMIT 1")
        code = query(f'SELECT codigo FROM pliego.pedido_retiro WHERE pedido_id={original}')
        commands = [f"CALL pliego.sp_pickup_collect({admin},{original},'{code}')",
                    f'CALL pliego.sp_order_cancel({actor},{original},NULL,NULL,NULL,NULL,NULL)']
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda sql: subprocess.run(PSQL + ['-At', '-c', sql],capture_output=True,text=True), commands))
        assert sum(result.returncode == 0 for result in results) == 1
        failed = next(result for result in results if result.returncode != 0)
        assert 'P5002' in failed.stderr or 'P5003' in failed.stderr
        state = query(f'SELECT estado FROM pliego.pedido WHERE pedido_id={original}')
        assert state in ['DELIVERED', 'CANCELLED']
        expected_stock = '0' if state == 'DELIVERED' else '1'
        expected_payment = 'APPROVED' if state == 'DELIVERED' else 'REFUNDED'
        assert query(f'SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}') == expected_stock
        assert query(f'SELECT estado FROM pliego.pago WHERE pedido_id={original}') == expected_payment
        print('STORE_PICKUP concurrency passed: replay once, unique confirmation, collection/cancellation serialize')
    finally:
        if first.poll() is None:
            first.terminate()
            first.communicate(timeout=5)


if __name__ == '__main__':
    main()
