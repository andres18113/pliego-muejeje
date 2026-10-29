"""User regression: mixed HOME_DELIVERY audiobook/card and later duplicate attempts.

Only fixture construction uses SQL. Purchases, replay, conflict, quotes and library
reads cross the real HTTP -> Spring transaction -> JDBC -> PostgreSQL boundary.
"""
import uuid
from concurrent.futures import ThreadPoolExecutor
from checkout_http_gate import token
from checkout_last_unit import fixture, query
from digital_editions_http_gate import ok, problem
from library_checkout_http_gate import checkout
from full_journey_http_gate import admin_token


def mixed_fixture():
    actors, physical = fixture()
    actor, address = actors[0]
    admin = query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'")
    book, publisher = query(f'SELECT libro_id,editorial_id FROM pliego.edicion WHERE edicion_id={physical}').split('|')
    editions = {}
    for media in ('AUDIOBOOK', 'EBOOK'):
        extra = "NULL,3600,ARRAY['Voz']" if media == 'AUDIOBOOK' else "'EPUB',NULL,ARRAY[]::TEXT[]"
        editions[media] = query(f"CALL pliego.sp_edition_create({admin},{book},{publisher},'MIX-{uuid.uuid4().hex}',NULL,'es','{media}',NULL,NULL,10,NULL,NULL,NULL,NULL,{extra},NULL)")
    auth = 'Bearer ' + token(actor)
    ok('/api/v1/cart/items', auth, 'POST', dict(editionId=editions['AUDIOBOOK'], quantity=1))
    cart = ok('/api/v1/cart', auth)
    assert cart['physicalItemCount'] == 1 and cart['digitalItemCount'] == 1
    body = dict(fulfillmentMethod='HOME_DELIVERY', addressId=str(address), paymentMethod='CARD',
                cardNumber='4242424242424242', simulationOutcome='APPROVED',
                expectedCartId=cart['cartId'], expectedQuoteFingerprint=cart['quoteFingerprint'])
    return actor, auth, physical, editions, cart, body


def effects(actor, physical):
    return query(f"""SELECT
      (SELECT count(*) FROM pliego.pedido WHERE cliente_id=c.cliente_id),
      (SELECT count(*) FROM pliego.pago pa JOIN pliego.pedido p USING(pedido_id) WHERE p.cliente_id=c.cliente_id),
      (SELECT count(*) FROM pliego.movimiento_inventario WHERE edicion_id={physical}),
      (SELECT stock_actual FROM pliego.inventario WHERE edicion_id={physical}),
      (SELECT count(*) FROM pliego.checkout_attempt WHERE actor_user_id={actor})
      FROM pliego.cliente c WHERE usuario_id={actor}""")


def assert_single_source(auth, edition, order_id):
    items = [x for x in ok('/api/v1/me/library', auth)['items'] if x['editionId'] == edition]
    assert len(items) == 1, items
    item = ok('/api/v1/me/library/' + items[0]['ownedItemId'], auth)
    sources = item['sourcePurchases']
    assert len(sources) == 1 and sources[0]['grantState'] == 'ACTIVE' and sources[0]['orderId'] == order_id, item


def main():
    actor, auth, physical, editions, cart, body = mixed_fixture()
    key = str(uuid.uuid4())
    status, order = checkout(auth, body, key)
    assert status == 201 and order['paymentState'] == 'APPROVED' and order['orderState'] == 'CONFIRMED', (status, order)
    detail = ok('/api/v1/orders/' + order['orderId'], auth)
    assert len(detail['items']) == 2 and detail['shipment'] and detail['address'], detail
    assert {x['format'] for x in detail['items']} == {'AUDIOBOOK', 'PAPERBACK'}
    before = effects(actor, physical)
    status, replay = checkout(auth, body, key)
    assert status == 201 and replay == order and effects(actor, physical) == before, (status, replay)
    problem('/api/v1/cart/items', auth, 'POST', dict(editionId=editions['AUDIOBOOK'], quantity=1), 'P6002', 409)
    # A browser still accepting its original pre-purchase cart/quote cannot buy twice.
    status, error = checkout(auth, body, str(uuid.uuid4()))
    assert status == 409 and error['code'] == 'P6002', (status, error)
    assert effects(actor, physical) == before
    assert_single_source(auth, editions['AUDIOBOOK'], order['orderId'])
    # Legacy stale active generation: restore the pre-purchase lines from the
    # original cart as fixture data. V076 API cart-add can no longer create this.
    customer = query(f'SELECT cliente_id FROM pliego.cliente WHERE usuario_id={actor}')
    query(f"INSERT INTO pliego.carrito(cliente_id,estado) VALUES({customer},'ACTIVE')")
    stale = query(f"SELECT carrito_id FROM pliego.carrito WHERE cliente_id={customer} AND estado='ACTIVE'")
    query(f'INSERT INTO pliego.carrito_item(carrito_id,edicion_id,cantidad) SELECT {stale},edicion_id,cantidad FROM pliego.carrito_item WHERE carrito_id={cart["cartId"]}')
    quote = ok('/api/v1/cart', auth)
    line = next(x for x in quote['items'] if x['editionId'] == editions['AUDIOBOOK'])
    assert line['available'] is False and line['unavailabilityReason'] == 'P6002'
    status, error = checkout(auth, {**body, 'expectedCartId': stale, 'expectedQuoteFingerprint': quote['quoteFingerprint']}, str(uuid.uuid4()))
    assert status == 409 and error['code'] == 'P6002', (status, error)
    assert effects(actor, physical) == before, 'duplicate acceptance changed order/payment/stock/receipt'
    assert_single_source(auth, editions['AUDIOBOOK'], order['orderId'])
    # Identity is edition id: an eBook of the SAME book/title remains purchasable.
    for line in quote['items']:
        ok('/api/v1/cart/items/' + line['cartItemId'], auth, 'DELETE', expected=204)
    ok('/api/v1/cart/items', auth, 'POST', dict(editionId=editions['EBOOK'], quantity=1))
    status, second = checkout(auth, dict(fulfillmentMethod='DIGITAL_ONLY', paymentMethod='CARD',
        cardNumber='4242424242424242', simulationOutcome='APPROVED'), str(uuid.uuid4()))
    assert status == 201 and second['paymentState'] == 'APPROVED', (status, second)
    assert_single_source(auth, editions['EBOOK'], second['orderId'])
    # Pending mixed transfer blocks a later card, without sale/stock side effects.
    actor, auth, physical, editions, cart, body = mixed_fixture()
    status, pending = checkout(auth, {**body, 'paymentMethod': 'TRANSFER', 'simulationOutcome': 'PENDING', 'cardNumber': None}, str(uuid.uuid4()))
    assert status == 201 and pending['paymentState'] == 'PENDING', (status, pending)
    before = effects(actor, physical)
    problem('/api/v1/cart/items', auth, 'POST', dict(editionId=editions['AUDIOBOOK'], quantity=1), 'P6003', 409)
    status, error = checkout(auth, body, str(uuid.uuid4()))
    assert status == 409 and error['code'] == 'P6003' and effects(actor, physical) == before, (status, error)
    assert before.split('|')[:4] == ['1', '1', '1', '1'], before  # inventory ENTRY only
    # A legacy active cart already contains X BEFORE its pending card source is
    # captured. Seed that pre-V076 state, then approve and attempt checkout by HTTP.
    actor, auth, physical, editions, cart, body = mixed_fixture()
    status, pending_card = checkout(auth, {**body, 'simulationOutcome': 'PENDING'}, str(uuid.uuid4()))
    assert status == 201 and pending_card['paymentState'] == 'PENDING', (status, pending_card)
    customer = query(f'SELECT cliente_id FROM pliego.cliente WHERE usuario_id={actor}')
    query(f"INSERT INTO pliego.carrito(cliente_id,estado) VALUES({customer},'ACTIVE')")
    stale = query(f"SELECT carrito_id FROM pliego.carrito WHERE cliente_id={customer} AND estado='ACTIVE'")
    query(f'INSERT INTO pliego.carrito_item(carrito_id,edicion_id,cantidad) SELECT {stale},edicion_id,cantidad FROM pliego.carrito_item WHERE carrito_id={cart["cartId"]}')
    admin = admin_token(int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'")))
    ok('/api/v1/admin/orders/' + pending_card['orderId'] + '/approve-payment', admin, 'POST', expected=204)
    assert query(f"SELECT bool_and(ci.fecha_creacion<pa.fecha_aprobacion) FROM pliego.carrito_item ci CROSS JOIN pliego.pago pa WHERE ci.carrito_id={stale} AND pa.pedido_id={pending_card['orderId']}") == 't'
    before = effects(actor, physical)
    quote = ok('/api/v1/cart', auth)
    assert next(x for x in quote['items'] if x['editionId'] == editions['AUDIOBOOK'])['unavailabilityReason'] == 'P6002'
    status, error = checkout(auth, {**body, 'expectedCartId': stale, 'expectedQuoteFingerprint': quote['quoteFingerprint']}, str(uuid.uuid4()))
    assert status == 409 and error['code'] == 'P6002' and effects(actor, physical) == before, (status, error)
    assert_single_source(auth, editions['AUDIOBOOK'], pending_card['orderId'])
    # HTTP race with distinct keys: exactly one card purchase and one physical sale.
    actor, auth, physical, editions, cart, body = mixed_fixture()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: checkout(auth, body, str(uuid.uuid4())), range(2)))
    assert sorted(s for s, _ in results) == [201, 409], results
    assert next(p for s, p in results if s == 409)['code'] == 'P6002'
    assert effects(actor, physical) == '1|1|2|0|1'
    assert_single_source(auth, editions['AUDIOBOOK'], next(p for s, p in results if s == 201)['orderId'])
    print('Mixed digital HTTP: 4 scenarios passed (approved/replay/stale+edition identity, pending transfer/card, stale cart before card capture, concurrent cards); no duplicate commercial effects.')


if __name__ == '__main__':
    main()
