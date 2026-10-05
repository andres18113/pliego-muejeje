"""HTTP projection/cancel plus a real scheduled Spring -> JDBC -> PostgreSQL advance."""
import time
from checkout_last_unit import fixture, query
from admin_orders_http_gate import request
from home_delivery_test_support import age_shipment


def main():
    actors, edition = fixture()
    actor, address = actors[0]
    order = query(f"CALL pliego.sp_checkout({actor},{address},'CARD','APPROVED',NULL,NULL,NULL,NULL,NULL)").split('|')[0]
    path = '/api/v1/orders/' + order
    status, detail = request(path, actor, 'CUSTOMER')
    assert status == 200 and detail['shipment']['state'] == 'PREPARING', (status,detail)
    assert detail['orderState'] == 'CONFIRMED' and detail['availableActions']['cancel']
    admin = query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' LIMIT 1")
    status, problem = request('/api/v1/admin/orders/'+order+'/shipment/transitions', admin,
        method='POST',body={'targetState':'DELIVERED'})
    assert status == 409 and problem['code'] == 'P5002', (status,problem)
    age_shipment(order,3)
    status, detail = request(path,actor,'CUSTOMER')
    assert status == 200 and detail['shipment']['state'] == 'IN_TRANSIT', (status,detail)
    assert not detail['availableActions']['cancel'] and detail['orderState']=='CONFIRMED'
    status, problem = request(path+'/cancel',actor,'CUSTOMER',method='POST')
    assert status == 409 and problem['code']=='P5003', (status,problem)
    age_shipment(order,4)
    # Poll tables only: no detail/routine calls, so advancement proves the real scheduled worker ran.
    end = time.monotonic()+30
    while time.monotonic()<end:
        if query(f'SELECT estado FROM pliego.envio WHERE pedido_id={order}')=='DELIVERED':
            break
        time.sleep(.2)
    else:
        raise AssertionError('Scheduled backend task did not advance overdue HOME_DELIVERY')
    status, detail = request(path,actor,'CUSTOMER')
    assert status==200 and detail['shipment']['state']=='DELIVERED'
    assert detail['orderState']=='CONFIRMED' and detail['payment']['state']=='APPROVED'
    assert [event['newState'] for event in sorted(detail['shipment']['history'],key=lambda x:int(x['eventId']))]==['PREPARING','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED']
    assert all(detail['shipment'][key] is not None for key in ('preparingAt','shippedAt','outForDeliveryAt','deliveredAt'))
    print('HOME_DELIVERY HTTP/scheduler passed: state/history projected, cancel cutoff, commercial state preserved')


if __name__ == '__main__':
    main()
