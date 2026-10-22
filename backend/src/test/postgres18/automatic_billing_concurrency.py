"""Real PostgreSQL locks, replay, numbering, last stock and approval/cancel races.
Only execute against an explicitly selected disposable migrated database.
"""
import os
import subprocess
import uuid
from checkout_last_unit import PSQL, fixture, query, wait_for_activity


def checkout(actor, address, key, outcome='APPROVED'):
    return f"""CALL pliego.sp_checkout_billed_quoted({actor},'{key}',{address},'TRANSFER','{outcome}',NULL,
      'HOME_DELIVERY',NULL,NULL,'EC_CEDULA','0912345675','Comprador Fiscal','Calle Fiscal',NULL,
      'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)"""


def compete(first_sql, second_sql, expected_error=None):
    name = 'academic-' + uuid.uuid4().hex[:10]
    env = os.environ.copy()
    env['PGAPPNAME'] = name
    first = subprocess.Popen(PSQL + ['-c', 'BEGIN', '-c', first_sql, '-c', 'SELECT pg_sleep(2)', '-c', 'COMMIT'], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    second = None
    try:
        wait_for_activity(name, "wait_event='PgSleep'")
        env['PGAPPNAME'] = name + '-second'
        second = subprocess.Popen(PSQL + ['-c', 'BEGIN', '-c', second_sql, '-c', 'COMMIT'], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        wait_for_activity(name + '-second', "wait_event_type='Lock'")
        _, error = first.communicate(timeout=12)
        assert first.returncode == 0, 'first transaction failed: ' + error
        _, error = second.communicate(timeout=12)
        if expected_error:
            assert second.returncode != 0 and expected_error in error, 'wrong losing transaction outcome'
        else:
            assert second.returncode == 0, 'second transaction failed: ' + error
    except Exception:
        if first.poll() is not None:
            _, error = first.communicate()
            raise AssertionError('first transaction exited before barrier: ' + error)
        raise
    finally:
        for child in (first, second):
            if child is not None and child.poll() is None:
                child.terminate()
                child.communicate(timeout=5)


def main():
    assert all(os.environ.get(x) for x in ('PGHOST', 'PGPORT', 'PGDATABASE')), 'select disposable database explicitly'
    actors, edition = fixture()
    key = uuid.uuid4()
    sql = checkout(*actors[0], key)
    compete(sql, sql)
    actor, address = actors[0]
    assert query(f"SELECT count(*) FROM pliego.checkout_attempt WHERE actor_user_id={actor} AND attempt_key='{key}'") == '1'
    assert query(f"SELECT count(*) FROM pliego.factura f JOIN pliego.pedido p USING(pedido_id) JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}") == '1'
    assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}") == '0'
    # Another actor cannot spend the already sold unit.
    result = subprocess.run(PSQL + ['-c', checkout(*actors[1], uuid.uuid4())], text=True, capture_output=True)
    assert result.returncode != 0 and 'P3002' in result.stderr, 'last unit oversold'

    actors, edition = fixture()
    # Pending orders reserve no inventory. Approval consumes the original snapshot once.
    for actor, address in actors:
        query(checkout(actor, address, uuid.uuid4(), 'PENDING'))
    rows = [int(query(f'SELECT p.pedido_id FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}')) for actor, _ in actors]
    admin = int(query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' ORDER BY usuario_id LIMIT 1"))
    approve = lambda order: f'CALL pliego.sp_billed_order_approve({admin},{order})'
    compete(approve(rows[0]), approve(rows[0]))
    assert query(f"SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id={rows[0]} AND tipo='SALE'") == '1'
    assert query(f"SELECT estado FROM pliego.factura WHERE pedido_id={rows[0]}") == 'ISSUED'
    result = subprocess.run(PSQL + ['-c', approve(rows[1])], text=True, capture_output=True)
    assert result.returncode != 0 and 'P3002' in result.stderr, 'pending approvals oversold stock'
    assert query(f"SELECT estado FROM pliego.factura WHERE pedido_id={rows[1]}") == 'DRAFT'
    # Competing refund commands must append exactly one credit.
    actor = actors[0][0]
    cancel = f'CALL pliego.sp_order_cancel({actor},{rows[0]},NULL,NULL,NULL,NULL,NULL)'
    credit = f"CALL pliego.sp_invoice_credit_after_refund({actor},{rows[0]},'Cancelacion',NULL)"
    compete(cancel, credit)
    assert query(f"SELECT count(*) FROM pliego.nota_credito n JOIN pliego.factura f USING(factura_id) WHERE f.pedido_id={rows[0]}") == '1'
    # Independent invoices serialize only their shared academic number series.
    actors, edition = fixture()
    query(f"CALL pliego.sp_inventory_entry({admin},{edition},1,'concurrency fixture',NULL,NULL,NULL)")
    compete(checkout(*actors[0], uuid.uuid4()), checkout(*actors[1], uuid.uuid4()))
    assert query(f"SELECT count(DISTINCT f.numero_documento) FROM pliego.factura f JOIN pliego.pedido_item i USING(pedido_id) WHERE i.edicion_id={edition}") == '2'
    # Pending cancellation wins the order lock: delayed approval must fail, no sale/credit.
    actors, edition = fixture()
    actor, address = actors[0]
    query(checkout(actor, address, uuid.uuid4(), 'PENDING'))
    order = int(query(f'SELECT p.pedido_id FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}'))
    cancel = f'CALL pliego.sp_order_cancel({actor},{order},NULL,NULL,NULL,NULL,NULL)'
    compete(cancel, approve(order), 'P5006')
    assert query(f"SELECT estado FROM pliego.factura WHERE pedido_id={order}") == 'VOID'
    assert query(f"SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id={order}") == '0'
    assert query(f"SELECT count(*) FROM pliego.nota_credito n JOIN pliego.factura f USING(factura_id) WHERE f.pedido_id={order}") == '0'
    print('Automatic billing concurrency: replay, last stock, double approval, independent numbering, pending cancellation and refund/credit passed.')


if __name__ == '__main__':
    main()
