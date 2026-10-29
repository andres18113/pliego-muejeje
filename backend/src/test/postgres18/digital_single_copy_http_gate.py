"""HTTP -> Spring transaction -> JDBC -> real PostgreSQL ownership conflicts."""
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from checkout_http_gate import token
from checkout_last_unit import query
from digital_editions_http_gate import ok, problem
from digital_single_copy_support import digital_fixture
from library_checkout_http_gate import checkout


def main():
    contract = ok('/v3/api-docs', None)
    operation = contract['paths']['/api/v1/me/digital-eligibility']['get']
    assert operation['responses']['200']['content']['*/*']['schema']['items']['$ref'].endswith('/DigitalEligibility')
    assert set(contract['components']['schemas']['DigitalEligibility']['required']) >= {'owned', 'pendingOrder', 'inCart', 'purchasable'}
    for outcome, code, title in [('APPROVED', 'P6002', 'Ya tienes esta edición digital'),
                                  ('PENDING', 'P6003', 'Compra digital pendiente')]:
        actor, other, edition, cart, _ = digital_fixture()
        auth, other_auth = 'Bearer ' + token(actor), 'Bearer ' + token(other)
        path = '/api/v1/me/digital-eligibility?editionIds=' + edition
        assert ok(path, auth) == [dict(editionId=edition, owned=False, ownedItemId=None, pendingOrder=False, pendingOrderId=None, inCart=True, purchasable=True)]
        body = dict(fulfillmentMethod='DIGITAL_ONLY', paymentMethod='TRANSFER', simulationOutcome=outcome, expectedCartId=cart)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: checkout(auth, body, str(uuid.uuid4())), range(2)))
        assert sorted(status for status, _ in results) == [201, 409], results
        error = next(payload for status, payload in results if status == 409)
        assert error['code'] == code and error['title'] == title, error
        assert error['detail'] == ('Esta edición digital ya está en tu biblioteca. Puedes consultarla sin volver a comprarla.' if code == 'P6002' else 'Ya tienes un pedido abierto con esta edición digital. Revisa ese pedido antes de intentar otra compra.'), error
        problem('/api/v1/cart/items', auth, 'POST', dict(editionId=edition, quantity=1), code, 409)
        eligible = ok(path, auth)[0]
        assert eligible['owned'] == (outcome == 'APPROVED') and not eligible['purchasable'] and not eligible['inCart']
        assert ok(path, other_auth)[0]['purchasable'] is True
        order = next(payload for status, payload in results if status == 201)
        assert eligible['pendingOrderId'] == order['orderId']
        assert ok('/api/v1/orders/' + eligible['pendingOrderId'], auth)['orderId'] == order['orderId']
        assert ok(path, other_auth)[0]['pendingOrderId'] is None
        if eligible['owned']:
            assert ok('/api/v1/me/library/' + eligible['ownedItemId'], auth)['editionId'] == edition
        # Stale line from an earlier session: cart projection is usable and blocks checkout.
        customer = query(f'SELECT cliente_id FROM pliego.cliente WHERE usuario_id={actor}')
        query(f"INSERT INTO pliego.carrito(cliente_id,estado) VALUES({customer},'ACTIVE')")
        query(f"INSERT INTO pliego.carrito_item(carrito_id,edicion_id,cantidad) SELECT carrito_id,{edition},1 FROM pliego.carrito WHERE cliente_id={customer} AND estado='ACTIVE'")
        current = ok('/api/v1/cart', auth)
        assert current['items'][0]['unavailabilityReason'] == code and current['items'][0]['available'] is False
        before = query(f'SELECT count(*) FROM pliego.pedido WHERE cliente_id={customer}')
        status, error = checkout(auth, {**body, 'expectedCartId': current['cartId'], 'expectedQuoteFingerprint': current['quoteFingerprint']}, str(uuid.uuid4()))
        assert status == 409 and error['code'] == code, error
        assert query(f'SELECT count(*) FROM pliego.pedido WHERE cliente_id={customer}') == before
        assert query(f'SELECT count(*) FROM pliego.pago pa JOIN pliego.pedido p USING(pedido_id) WHERE p.cliente_id={customer}') == before
        # Batch validation and isolation through real authentication and JDBC.
        ok('/api/v1/me/digital-eligibility', auth, expected=400)
        ok('/api/v1/me/digital-eligibility?editionIds=0', auth, expected=400)
        ok('/api/v1/me/digital-eligibility?editionIds=' + ','.join([edition] * 51), auth, expected=400)
        ok(path, None, expected=401)
        order = next(payload for status, payload in results if status == 201)
        ok('/api/v1/orders/' + order['orderId'] + '/cancel', auth, 'POST', {}, 200)
        assert ok(path, auth)[0]['purchasable'] is True
        assert ok(path, auth)[0]['pendingOrderId'] is None
        status, purchased = checkout(auth, {**body, 'simulationOutcome': 'APPROVED', 'expectedCartId': current['cartId']}, str(uuid.uuid4()))
        assert status == 201 and purchased['paymentState'] == 'APPROVED', purchased
    print('Digital single-copy HTTP: 2 checkout races, cart conflicts, Spanish errors, eligibility/isolation/validation, rollback and repurchase passed.')


if __name__ == '__main__':
    main()
