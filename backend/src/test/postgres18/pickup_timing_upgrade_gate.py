"""V096 -> V097 on an EMPTY disposable local database, using the packaged backend.

Proves that deployment neither changes historical snapshots nor sends a READY
backlog. Does not contact a mail provider or any production service.
"""
import os

from checkout_last_unit import query
from monetary_upgrade_gate import start
from transactional_email_lifecycle_upgrade_gate import historical_snapshot
from verified_pickup_concurrency import ready_fixture


def past_estimate_fixture(source, approved=False):
    state = 'APPROVED' if approved else 'PENDING'
    reference = 'pliego.fn_generate_payment_reference()' if approved else 'NULL'
    return query(f"""DO $fixture$
    DECLARE o BIGINT;
    BEGIN
     INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total)
      SELECT cliente_id,'PENDING_PAYMENT',subtotal,total FROM pliego.pedido WHERE pedido_id={source}
      RETURNING pedido_id INTO o;
     INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,
      editorial_snapshot,formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
      SELECT o,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,formato_snapshot,
       idioma_snapshot,precio_unitario,cantidad,subtotal FROM pliego.pedido_item WHERE pedido_id={source};
     INSERT INTO pliego.pago(pedido_id,metodo,estado,monto,referencia)
      SELECT o,metodo,'{state}',monto,{reference} FROM pliego.pago WHERE pedido_id={source};
     INSERT INTO pliego.pedido_entrega(pedido_id,metodo) VALUES(o,'STORE_PICKUP');
     IF {str(approved).upper()} THEN UPDATE pliego.pedido SET estado='CONFIRMED' WHERE pedido_id=o; END IF;
     INSERT INTO pliego.pedido_retiro(pedido_id,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,
      codigo_postal,latitud,longitud,zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,codigo)
      SELECT o,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,codigo_postal,latitud,longitud,
       zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,pliego.fn_generate_pickup_code()
      FROM pliego.pedido_retiro WHERE pedido_id={source};
     PERFORM set_config('pliego.pending_pickup_fixture',o::TEXT,TRUE);
    END $fixture$;
    SELECT current_setting('pliego.pending_pickup_fixture');""").splitlines()[-1]


def stop(process):
    process.terminate()
    process.wait(timeout=20)


def main():
    if os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') != '1' or os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost', '::1'):
        raise SystemExit('Requires PLIEGO_TEST_DISPOSABLE_DB=1 and explicit loopback PGHOST')
    assert query("SELECT to_regnamespace('pliego') IS NULL") == 't', 'Use an empty disposable upgrade database'
    os.environ['PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED'] = 'false'
    old = start(96)
    try:
        admin, ready, _ = ready_fixture()
        _, collected, code = ready_fixture()
        _, unreconciled_ready, _ = ready_fixture()
        query(f'SELECT pliego.fn_admin_pickup_detail({admin},{ready})')
        query(f"CALL pliego.sp_pickup_collect({admin},{collected},'{code}',TRUE)")
        pending_past = past_estimate_fixture(ready)
        cancellable_past = past_estimate_fixture(ready, approved=True)
        future = query(f"""SELECT p.pedido_id FROM pliego.pedido p JOIN pliego.pedido_retiro r USING(pedido_id)
            WHERE p.estado='CONFIRMED' AND r.listo_desde>clock_timestamp() ORDER BY p.pedido_id LIMIT 1""")
        assert future, 'Historical future-ready source fixture missing'
        orders = [ready, collected, unreconciled_ready, future, pending_past, cancellable_past]
        before = {order: historical_snapshot(order) for order in orders}
        assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{ready}:STORE_PICKUP:READY'") == '0'
    finally:
        stop(old)
    upgraded = start(97)
    try:
        for order in orders:
            after = historical_snapshot(order)
            assert after['pickup'].pop('programacion_version') is None
            assert after['pickup'].pop('aprobacion_programada_en') is None
            assert after == before[order], f'Migration rewrote order/payment/pickup/history/outbox for {order}'
        query('CALL pliego.sp_home_delivery_advance_due(100)')
        query('CALL pliego.sp_home_delivery_advance_due(100)')
        for order in [ready, collected, unreconciled_ready]:
            assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{order}:STORE_PICKUP:READY'") == '0', 'Historical READY backlog was sent'
            assert query(f'SELECT listo_omitido_historico FROM pliego.pedido_retiro_aviso WHERE pedido_id={order}') == 't'
        assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{collected}:STORE_PICKUP:COLLECTED'") == '1'
        for order in [future, pending_past, cancellable_past]:
            assert query(f'SELECT listo_procesado_en IS NULL AND NOT listo_omitido_historico FROM pliego.pedido_retiro_aviso WHERE pedido_id={order}') == 't'
            assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{order}:STORE_PICKUP:READY'") == '0'
        # This approval is a new transition after migration, despite its stale
        # historical estimate. The original snapshot must not be reprogrammed.
        original = query(f'SELECT listo_desde FROM pliego.pedido_retiro WHERE pedido_id={pending_past}')
        query(f"UPDATE pliego.pago SET estado='APPROVED',referencia=pliego.fn_generate_payment_reference() WHERE pedido_id={pending_past}")
        query(f"UPDATE pliego.pedido SET estado='CONFIRMED' WHERE pedido_id={pending_past}")
        assert query(f'SELECT listo_desde FROM pliego.pedido_retiro WHERE pedido_id={pending_past}') == original
        assert query(f"SELECT p.cancelacion_hasta=pa.fecha_aprobacion+INTERVAL '6 minutes' FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) WHERE pedido_id={pending_past}") == 't'
        # Age only this disposable fixture's window; no six-minute real-time sleep.
        query(f"UPDATE pliego.pedido SET cancelacion_hasta=clock_timestamp()-INTERVAL '1 second' WHERE pedido_id IN({pending_past},{cancellable_past})")
        query('CALL pliego.sp_home_delivery_advance_due(100)')
        query('CALL pliego.sp_home_delivery_advance_due(100)')
        for order in [pending_past, cancellable_past]:
            assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{order}:STORE_PICKUP:READY'") == '1'
        print('Pickup V096 -> V097 upgrade passed: snapshots unchanged; ready/unreconciled/collected backlog omitted; unapproved/still-cancellable past estimates retain future READY once')
    finally:
        stop(upgraded)


if __name__ == '__main__':
    main()
