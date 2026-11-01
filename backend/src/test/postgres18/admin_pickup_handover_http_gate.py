"""AC-tagged real HTTP/JDBC evidence for the administrative pickup handover contract."""
import json
import os
import subprocess
import uuid
from checkout_last_unit import fixture, query, PSQL, wait_for_activity
from store_pickup_http_gate import request
from verified_pickup_concurrency import ready_fixture

counts = {}


def check(ac, condition, detail=''):
    assert condition, f'{ac}: {detail}'
    counts[ac] = counts.get(ac, 0) + 1


def checkout(outcome='APPROVED', method='CARD', delivery='STORE_PICKUP'):
    actors, _ = fixture()
    actor, address = actors[0]
    location = query('SELECT pickup_location_id FROM pliego.fn_pickup_locations() LIMIT 1')
    body = {'paymentMethod': method, 'simulationOutcome': outcome, 'fulfillmentMethod': delivery}
    if method == 'CARD':
        body['cardNumber'] = '4242424242424242'
    body.update({'pickupLocationId': location} if delivery == 'STORE_PICKUP' else {'addressId': str(address)})
    status, result = request('/api/v1/checkout', actor, 'POST', body, str(uuid.uuid4()))
    assert status == 201, (status, result)
    return actor, result


def paths(order):
    return (f'/api/v1/admin/pickups/{order}', f'/api/v1/admin/pickups/{order}/verify-code',
            f'/api/v1/admin/orders/{order}/pickup/collect', f'/api/v1/admin/orders/{order}/cancel')


def main():
    actor, purchase = checkout()
    admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'"))
    order = purchase['orderId']
    code = purchase['fulfillment']['pickup']['pickupCode']
    detail_path, verify_path, collect_path, cancel_path = paths(order)
    status, detail = request(detail_path, admin, admin=True)
    check('AC-2.1', status == 200 and detail['state'] == 'PENDING' and detail['paymentMethod'] == 'CARD')
    check('AC-2.2', len(detail['items']) == 1 and detail['items'][0]['format'] == 'PAPERBACK' and detail['unitCount'] == 1)
    check('AC-2.3', detail['customer']['email'] and detail['customer']['identityType'] == 'EC_CEDULA' and detail['customer']['identityNumber'])
    check('AC-2.4', code not in json.dumps(detail) and 'pickupCode' not in json.dumps(detail))
    check('AC-8.1', detail['availableActions']['cancel'] is True and detail['availableActions']['cancellationDeadline'] is not None)
    # AC-7.1: use valid bodies so role denial precedes validation/business logic.
    for path, method, body in [(detail_path, 'GET', None), (verify_path, 'POST', {'code': code}),
                              (collect_path, 'POST', {'pickupCode': code, 'identityVerified': True}),
                              (cancel_path, 'POST', None)]:
        check('AC-7.1', request(path, method=method, body=body)[0] == 401, path + ' anonymous')
        check('AC-7.1', request(path, actor, method, body)[0] == 403, path + ' customer')
    # Full PostgreSQL READ ONLY transaction proves verification cannot write, even when reconciliation is due.
    _, ready_order, ready_code = ready_fixture()
    # Keep scheduled reconciliation from racing the before/after comparison.
    lock_app = 'handover-verify-' + uuid.uuid4().hex
    locker = subprocess.Popen(PSQL + ['-c', 'BEGIN', '-c',
        f'SELECT pedido_id FROM pliego.pedido WHERE pedido_id={ready_order} FOR UPDATE',
        '-c', 'SELECT pg_sleep(30)', '-c', 'ROLLBACK'], env={**os.environ, 'PGAPPNAME': lock_app},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        wait_for_activity(lock_app, "wait_event='PgSleep'")
        result = subprocess.run(PSQL + ['-At', '-c', 'BEGIN READ ONLY', '-c',
            f"SELECT pliego.fn_admin_pickup_verify_code({admin},{ready_order},'{ready_code}')", '-c', 'ROLLBACK'],
            capture_output=True, text=True)
        check('AC-3.3', result.returncode == 0, result.stderr)
        ready_detail_path, ready_verify_path, ready_collect_path, ready_cancel_path = paths(ready_order)
        errors = []
        before = query(f"SELECT row_to_json(p)::text FROM pliego.pedido p WHERE pedido_id={ready_order}")
        for candidate in ['wrong', code]:
            status, problem = request(ready_verify_path, admin, 'POST', {'code': candidate}, admin=True)
            check('AC-3.2', status == 400 and problem['code'] == 'P5013')
            errors.append({key: value for key, value in problem.items() if key != 'traceId'})
        check('AC-3.2', errors[0] == errors[1])
        status, verified = request(ready_verify_path, admin, 'POST', {'code': ready_code[2:].lower()}, admin=True)
        check('AC-3.3', status == 200 and verified['orderState'] == json.loads(before)['estado'] and before == query(
            f"SELECT row_to_json(p)::text FROM pliego.pedido p WHERE pedido_id={ready_order}"))
        check('AC-2.4', ready_code not in json.dumps(verified) and 'pickupCode' not in json.dumps(verified))
    finally:
        if locker.poll() is None:
            query(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='{lock_app}'")
        locker.communicate(timeout=5)
    # Unknown and existing home delivery orders use exactly the same pickup-not-found code.
    _, home = checkout(delivery='HOME_DELIVERY')
    for missing in ['9223372036854775807', home['orderId']]:
        d, v, _, _ = paths(missing)
        for path, method, body in [(d, 'GET', None), (v, 'POST', {'code': 'wrong'})]:
            status, problem = request(path, admin, method, body, admin=True)
            check('AC-2.5', status == 404 and problem['code'] == 'P5016')
    # Verify identity is still enforced at collection, and early collection remains a conflict.
    for identity in [None, False]:
        body = {'pickupCode': code, **({} if identity is None else {'identityVerified': identity})}
        check('AC-4.3', request(collect_path, admin, 'POST', body, admin=True)[0] == 400)
    status, problem = request(collect_path, admin, 'POST', {'pickupCode': code, 'identityVerified': True}, admin=True)
    check('AC-6.3', status == 409 and problem['code'] == 'P5018')
    # Cancellation inside the six-minute window restores inventory/refunds once.
    status, cancelled = request(cancel_path, admin, 'POST', admin=True)
    check('AC-8.1', status == 200 and cancelled == {'orderId': order, 'previousState': 'CONFIRMED',
          'orderState': 'CANCELLED', 'paymentState': 'REFUNDED', 'restoredUnits': 1}, str(cancelled))
    check('AC-8.2', request(detail_path, admin, admin=True)[1]['availableActions']['cancel'] is False)
    status, problem = request(cancel_path, admin, 'POST', admin=True)
    check('AC-8.2', status == 409 and problem['code'] == 'P5003')
    status, problem = request(collect_path, admin, 'POST', {'pickupCode': code, 'identityVerified': True}, admin=True)
    check('AC-6.3', status == 409 and problem['code'] == 'P5002')
    # PENDING + simulated DRAFT invoice has no cutoff and no sale/refund.
    _, pending = checkout('PENDING', 'TRANSFER')
    pd, _, pc, px = paths(pending['orderId'])
    status, pending_detail = request(pd, admin, admin=True)
    check('AC-8.1', status == 200 and pending_detail['paymentMethod'] == 'TRANSFER' and
          pending_detail['availableActions'] == {'cancel': True, 'cancellationDeadline': None})
    status, problem = request(pc, admin, 'POST', {'pickupCode': pending['fulfillment']['pickup']['pickupCode'], 'identityVerified': True}, admin=True)
    check('AC-6.3', status == 409 and problem['code'] == 'P5002')
    status, pending_cancelled = request(px, admin, 'POST', admin=True)
    check('AC-8.1', status == 200 and pending_cancelled['paymentState'] == 'REJECTED' and pending_cancelled['restoredUnits'] == 0)
    # GET reconciles to READY; verify-code above deliberately did not.
    status, ready = request(ready_detail_path, admin, admin=True)
    check('AC-2.1', status == 200 and ready['state'] == 'READY' and ready['orderState'] == 'PREPARING')
    check('AC-8.2', ready['availableActions']['cancel'] is False)
    status, problem = request(ready_cancel_path, admin, 'POST', admin=True)
    check('AC-8.2', status == 409 and problem['code'] == 'P5003')
    status, collected = request(ready_collect_path, admin, 'POST', {'pickupCode': ready_code, 'identityVerified': True}, admin=True)
    check('AC-5.2', status == 200 and collected['state'] == 'COLLECTED' and collected['identityVerified'] is True and
          collected['collectedBy']['userId'] == str(admin) and collected['collectedAt'] is not None)
    other_admin = int(query("SELECT max(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'"))
    for collector in [admin, other_admin]:
        status, problem = request(ready_collect_path, collector, 'POST', {'pickupCode': ready_code, 'identityVerified': True}, admin=True)
        check('AC-6.2', status == 409 and problem['code'] == 'P5017')
    check('AC-5.2', query(f"SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id={ready_order} AND estado_nuevo='DELIVERED'") == '1')
    status, collected_detail = request(ready_detail_path, admin, admin=True)
    check('AC-5.2', status == 200 and all(collected_detail[key] == collected[key] for key in ('collectedAt', 'collectedBy', 'identityVerified')))
    check('AC-8.2', collected_detail['availableActions']['cancel'] is False)
    check('AC-8.2', request(ready_cancel_path, admin, 'POST', admin=True)[0] == 409)
    print('Admin pickup handover HTTP/JDBC passed: ' + json.dumps(counts, sort_keys=True))


if __name__ == '__main__':
    main()
