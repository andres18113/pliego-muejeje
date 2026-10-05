"""An offer change holds the edition lock until checkout can snapshot its price."""
import os
import subprocess
import time
import uuid
from checkout_last_unit import fixture, query, PSQL


def main():
    actors, edition = fixture()
    actor, address = actors[0]
    sku = query(f'SELECT sku FROM pliego.edicion WHERE edicion_id={edition}')
    suffix = sku.removeprefix('I8-CONC-').lower()
    admin = query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='i8-conc-admin-{suffix}@pliego.local'")
    name = 'offers-concurrency-' + uuid.uuid4().hex[:10]
    env = os.environ.copy()
    env['PGAPPNAME'] = name
    offer_sql = f"""BEGIN;
      CALL pliego.sp_edition_offer_set({admin},{edition},3.00,statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '1 day',NULL);
      SELECT pg_sleep(3); COMMIT;"""
    mutation = subprocess.Popen(PSQL + ['-At', '-c', offer_sql], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    checkout = None
    try:
        deadline = time.monotonic() + 8
        while query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{name}' AND wait_event='PgSleep'") != '1':
            assert time.monotonic() < deadline, 'Offer mutation did not reach lock barrier'
            time.sleep(.03)
        env['PGAPPNAME'] = name + '-checkout'
        checkout = subprocess.Popen(PSQL + ['-At', '-c', f"CALL pliego.sp_checkout({actor},{address},'TRANSFER','APPROVED',NULL,NULL,NULL,NULL,NULL)"], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        while query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{name}-checkout' AND wait_event_type='Lock'") != '1':
            assert time.monotonic() < deadline, 'Checkout did not wait for offer lock'
            time.sleep(.03)
        _, err = mutation.communicate(timeout=8)
        assert mutation.returncode == 0, err
        _, err = checkout.communicate(timeout=8)
        assert checkout.returncode == 0, err
        money = query(f"SELECT pi.precio_unitario,p.subtotal,p.impuesto_monto,p.total FROM pliego.pedido_item pi JOIN pliego.pedido p USING(pedido_id) JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}")
        assert money == '3.00|3.00|0.45|3.45', money
        print('Offers concurrency passed: checkout waited for offer mutation and persisted consistent monetary snapshots.')
    finally:
        for child in [mutation, checkout]:
            if child is not None and child.poll() is None:
                child.terminate()
                child.communicate(timeout=5)


if __name__ == '__main__':
    main()
