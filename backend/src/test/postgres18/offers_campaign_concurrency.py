"""Native PostgreSQL races for create-only campaign offers; disposable local DB."""
import os
import subprocess
import time
import uuid
from checkout_last_unit import fixture, query, PSQL


def setup():
    _, edition = fixture()
    sku = query(f'SELECT sku FROM pliego.edicion WHERE edicion_id={edition}')
    suffix = sku.removeprefix('I8-CONC-').lower()
    actor = query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='i8-conc-admin-{suffix}@pliego.local'")
    query(f"UPDATE pliego.edicion SET portada_url='https://covers.pliegolibros.com/covers/fixture.webp' WHERE edicion_id={edition}")
    base, stock = query(f'SELECT e.precio,i.stock_actual FROM pliego.edicion e JOIN pliego.inventario i USING(edicion_id) WHERE edicion_id={edition}').split('|')
    return actor, edition, base, stock


def guarded(actor, edition, base, stock, price='3.00'):
    return f"CALL pliego.sp_edition_offer_create_if_absent({actor},{edition},{base},'{stock}','*',{price},statement_timestamp(),statement_timestamp()+INTERVAL '3 days',NULL,NULL,NULL)"


def start(name, sql):
    return subprocess.Popen(PSQL + ['-At', '-c', sql], env=dict(os.environ, PGAPPNAME=name),
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def barrier(name, waiting):
    deadline = time.monotonic() + 10
    condition = "wait_event='PgSleep'" if waiting == 'sleep' else "wait_event_type='Lock'"
    while query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{name}' AND {condition}") != '1':
        assert time.monotonic() < deadline, f'Missing PostgreSQL {waiting} barrier'
        time.sleep(.02)


def race(first_sql, second_sql, name):
    first = second = None
    try:
        first = start(name, f'BEGIN; {first_sql}; SELECT pg_sleep(1); COMMIT;')
        barrier(name, 'sleep')
        second = start(name + '-second', second_sql)
        barrier(name + '-second', 'lock')
        _, first_error = first.communicate(timeout=10)
        _, second_error = second.communicate(timeout=10)
        assert first.returncode == 0, first_error
        assert second.returncode != 0 and 'P1001' in second_error, second_error
    finally:
        for child in (first, second):
            if child is not None and child.poll() is None:
                child.terminate()
                child.communicate(timeout=5)


def main():
    assert os.environ.get('PGHOST') in {'127.0.0.1', 'localhost', '::1'}, 'Disposable loopback DB required'
    name = 'campaign-race-' + uuid.uuid4().hex[:10]
    actor, edition, base, stock = setup()
    race(guarded(actor, edition, base, stock), guarded(actor, edition, base, stock, '4.00'), name)
    assert query(f'SELECT count(*),min(precio_oferta) FROM pliego.edicion_oferta WHERE edicion_id={edition}') == '1|3.00'
    actor, edition, base, stock = setup()
    race(f'UPDATE pliego.edicion SET precio=precio+1 WHERE edicion_id={edition}',
         guarded(actor, edition, base, stock), name + '-base')
    assert query(f'SELECT count(*) FROM pliego.edicion_oferta WHERE edicion_id={edition}') == '0'
    actor, edition, base, stock = setup()
    race(f'UPDATE pliego.inventario SET stock_actual=stock_actual+1 WHERE edicion_id={edition}',
         guarded(actor, edition, base, stock), name + '-stock')
    assert query(f'SELECT count(*) FROM pliego.edicion_oferta WHERE edicion_id={edition}') == '0'
    # Existing inventory commands hold inventory before their trigger requests a
    # SHARE edition lock. Hold inventory before UPDATE and start the creator:
    # NOWAIT must release its edition lock before the writer's trigger needs it.
    actor, edition, base, stock = setup()
    creator = writer = None
    name += '-inventory-command'
    try:
        writer = start(name + '-writer', f"BEGIN; SELECT 1 FROM pliego.inventario WHERE edicion_id={edition} FOR UPDATE; SELECT pg_sleep(1); CALL pliego.sp_inventory_adjust({actor},{edition},'ADJUSTMENT_IN',1,'Carrera fixture',NULL,NULL,NULL); COMMIT;")
        barrier(name + '-writer', 'sleep')
        creator = start(name, guarded(actor, edition, base, stock))
        _, creator_error = creator.communicate(timeout=10)
        _, writer_error = writer.communicate(timeout=10)
        assert creator.returncode != 0 and 'P1001' in creator_error and '40P01' not in creator_error, creator_error
        assert writer.returncode == 0 and '40P01' not in writer_error, writer_error
        assert query(f'SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}') == str(int(stock) + 1)
        assert query(f'SELECT count(*) FROM pliego.edicion_oferta WHERE edicion_id={edition}') == '0'
    finally:
        for child in (creator, writer):
            if child is not None and child.poll() is None:
                child.terminate()
                child.communicate(timeout=5)
    print('PASS: four PostgreSQL lock-barrier races; one create winner, base/stock changes refused, inventory command completes without deadlock.')


if __name__ == '__main__':
    main()
