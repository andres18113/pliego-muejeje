"""Disposable PG18: a concurrent payment cannot evade the historical item append guard."""
import os
import subprocess
import time
import uuid
from checkout_last_unit import fixture, query, PSQL


def main():
    actors, edition = fixture()
    buyer, _ = actors[0]
    price = query(f'SELECT pliego.fn_edition_price({edition})')
    order = query(f"""
      WITH parent AS (
       INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total)
       SELECT cliente_id,'PENDING_PAYMENT',{price},{price} FROM pliego.cliente WHERE usuario_id={buyer}
       RETURNING pedido_id
      )
      INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,isbn_snapshot,titulo_snapshot,
       autores_snapshot,editorial_snapshot,formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
      SELECT parent.pedido_id,e.edicion_id,e.sku,e.isbn13,'Concurrency snapshot','Fixture','Fixture',
       e.formato,e.idioma,{price},1,{price} FROM parent,pliego.edicion e WHERE e.edicion_id={edition}
      RETURNING pedido_id
    """).splitlines()[0]
    suffix = uuid.uuid4().hex[:12]
    reference = 'SNAPSHOT-LOCK-' + suffix
    env = os.environ.copy()
    app = 'snapshot-payment-' + suffix
    payment_env = {**env, 'PGAPPNAME': app}
    payment_sql = f"BEGIN; INSERT INTO pliego.pago(pedido_id,metodo,estado,monto,referencia) VALUES({order},'TRANSFER','APPROVED',{price},'{reference}'); SELECT pg_sleep(2); COMMIT;"
    process = subprocess.Popen(PSQL + ['-At', '-c', payment_sql], env=payment_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        for _ in range(100):
            if query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND wait_event='PgSleep'") == '1':
                break
            if process.poll() is not None:
                stdout, stderr = process.communicate()
                raise AssertionError(('Payment fixture exited before lock test', process.returncode, stderr))
            time.sleep(.02)
        else:
            raise AssertionError('Payment did not enter its uncommitted lock hold')
        append_sql = f"""
          INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,isbn_snapshot,titulo_snapshot,
           autores_snapshot,editorial_snapshot,formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
          SELECT {order},e.edicion_id,e.sku,e.isbn13,'Forbidden append','Fixture','Fixture',e.formato,e.idioma,
           {price},1,{price} FROM pliego.edicion e WHERE e.edicion_id={edition};
        """
        started = time.monotonic()
        append = subprocess.run(PSQL + ['-At', '-c', append_sql], env=env, capture_output=True, text=True, timeout=15)
        elapsed = time.monotonic() - started
        stdout, stderr = process.communicate(timeout=15)
        assert process.returncode == 0, stderr
        assert append.returncode != 0 and 'P9001' in append.stderr, append.stderr
        assert elapsed > .5, 'Append did not wait for the concurrent payment lock'
        assert query(f'SELECT count(*) FROM pliego.pedido_item WHERE pedido_id={order}') == '1'
        assert query(f'SELECT count(*) FROM pliego.pago WHERE pedido_id={order}') == '1'
        print('PASS: concurrent payment blocks then rejects historical item append; original snapshot unchanged.')
    finally:
        if process.poll() is None:
            process.terminate()
            process.communicate(timeout=15)


if __name__ == '__main__':
    main()
