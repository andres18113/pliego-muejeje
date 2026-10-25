"""A detail blocked behind approval must see the same committed payment and grant."""
import os
import subprocess
import uuid

from checkout_last_unit import PSQL, query, wait_for_activity
from digital_single_copy_support import digital_fixture


def main():
    actor, _, digital, cart, admin = digital_fixture()
    physical = query(f"SELECT e.edicion_id FROM pliego.edicion e JOIN pliego.edicion d "
                     f"ON d.libro_id=e.libro_id WHERE d.edicion_id={digital} AND e.formato='PAPERBACK'")
    address = query(f"SELECT d.direccion_id FROM pliego.direccion d JOIN pliego.cliente c USING(cliente_id) "
                    f"WHERE c.usuario_id={actor}")
    query(f"CALL pliego.sp_cart_add_item({actor},{physical},1,NULL,NULL,NULL)")
    order = query(f"CALL pliego.sp_checkout_billed_quoted({actor},'{uuid.uuid4()}',{address},"
                  f"'TRANSFER','PENDING',{cart},'HOME_DELIVERY',NULL,NULL,"
                  "'EC_CEDULA','0912345675','Cliente Prueba','Calle Fiscal',NULL,"
                  "'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)").split('|')[0]
    suffix = uuid.uuid4().hex
    approval_name, reader_name = 'access-approval-' + suffix, 'access-reader-' + suffix
    # Approval writes the grant but holds its transaction until the reader is blocked.
    approval = subprocess.Popen(PSQL + ['-At', '-c', 'BEGIN', '-c',
        f'CALL pliego.sp_billed_order_approve({admin},{order})', '-c', 'SELECT pg_sleep(4)', '-c', 'COMMIT'],
        env={**os.environ, 'PGAPPNAME': approval_name}, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    reader = None
    try:
        wait_for_activity(approval_name, "wait_event='PgSleep'")
        reader = subprocess.Popen(PSQL + ['-At', '-c',
            f"SELECT d.payment->>'state',i->'digitalAccess'->>'state',i->'digitalAccess'->>'ownedItemId' "
            f"FROM pliego.fn_customer_order_detail_priced({actor},{order}) d "
            f"CROSS JOIN LATERAL jsonb_array_elements(d.items) i WHERE i->>'editionId'='{digital}'"],
            env={**os.environ, 'PGAPPNAME': reader_name}, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        wait_for_activity(reader_name, "wait_event_type='Lock'")
        _, errors = approval.communicate(timeout=15)
        assert approval.returncode == 0, errors
        result, errors = reader.communicate(timeout=15)
        assert reader.returncode == 0, errors
        owned = query(f"SELECT g.owned_item_id FROM pliego.digital_grant g JOIN pliego.pedido_item i "
                      f"USING(pedido_item_id) WHERE i.pedido_id={order} AND g.state='ACTIVE'")
        assert result.strip() == f'APPROVED|AVAILABLE|{owned}', result
    finally:
        for process in (reader, approval):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate()
    print('Post-purchase concurrent mixed transfer approval/detail passed: committed payment and source grant agree.')


if __name__ == '__main__':
    main()
