"""Disposable PostgreSQL/REST gate for live cart and immutable order offer pricing."""
import json
import os
import uuid
import urllib.request
from datetime import datetime, timedelta, timezone
from digital_editions_http_gate import ok
from full_journey_http_gate import admin_token
from checkout_last_unit import query
from checkout_http_gate import token


def checkout(customer, body, key, expected=201):
    request = urllib.request.Request(os.environ['CHECKOUT_BASE_URL'] + '/api/v1/checkout',
        data=json.dumps(body).encode(), method='POST', headers={
            'Authorization': customer, 'Content-Type': 'application/json', 'Idempotency-Key': key})
    with urllib.request.urlopen(request, timeout=20) as response:
        assert response.status == expected
        return json.load(response)


def main():
    suffix = uuid.uuid4().hex[:12]
    # Fixtures use public commands, with the same synthetic actor bootstrap as the other HTTP gates.
    query(f"INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('cart-order-offer-{suffix}@example.invalid','fixture','ADMIN','ACTIVE')")
    actor = int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='cart-order-offer-{suffix}@example.invalid'"))
    admin = admin_token(actor)
    author = ok('/api/v1/admin/authors', admin, 'POST', {'name': f'Autora snapshot {suffix}', 'biography': None}, 201)
    publisher = ok('/api/v1/admin/publishers', admin, 'POST', {'name': f'Editorial snapshot {suffix}', 'description': None}, 201)
    category = ok('/api/v1/admin/categories', admin, 'POST', {'name': f'Snapshot {suffix}', 'slug': f'snapshot-{suffix}', 'description': None, 'parentCategoryId': None}, 201)
    book = ok('/api/v1/admin/books', admin, 'POST', {'title': f'Obra snapshot {suffix}', 'subtitle': None, 'synopsis': None,
        'authors': [{'authorId': author['authorId'], 'order': 1}], 'categoryIds': [category['categoryId']]}, 201)
    query(f"DO $$ DECLARE u BIGINT; c BIGINT; s VARCHAR; BEGIN CALL pliego.sp_customer_register('cart-order-buyer-{suffix}@example.invalid','fixture','Ana','Pérez',NULL,u,c,s); END $$;")
    buyer = int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='cart-order-buyer-{suffix}@example.invalid'"))
    customer = 'Bearer ' + token(buyer)
    editions = []
    fixtures = [('PAPERBACK', '79.95', '63.96', 2), ('EBOOK', '15.99', '12.79', 1),
                ('AUDIOBOOK', '28.99', '23.19', 1), ('HARDCOVER', '10.00', None, 1)]
    now = datetime.now(timezone.utc)
    for index, (format, base, effective, quantity) in enumerate(fixtures):
        body = {'bookId': book['bookId'], 'publisherId': publisher['publisherId'], 'sku': f'CART-SNAPSHOT-{suffix}-{index}',
            'isbn13': None, 'language': 'es', 'format': format, 'pageCount': 100 if format in ('PAPERBACK', 'HARDCOVER') else None,
            'publicationDate': None, 'price': base, 'coverUrl': None, 'coverLicense': None, 'coverSourceUrl': None, 'coverAttribution': None}
        if format == 'AUDIOBOOK':
            body.update(audioDurationSeconds=3600, narrators=['Narrador DEMO'])
        edition = ok('/api/v1/admin/editions', admin, 'POST', body, 201)['editionId']
        if format in ('PAPERBACK', 'HARDCOVER'):
            ok('/api/v1/admin/inventory/' + edition + '/entries', admin, 'POST', {'quantity': 10, 'reason': 'Fixture snapshot'}, 201)
        if effective:
            ok('/api/v1/admin/editions/' + edition + '/offer', admin, 'PUT', {'offerPrice': effective,
                'startsAt': (now - timedelta(days=1)).isoformat(), 'endsAt': (now + timedelta(days=3)).isoformat()}, 204)
        editions.append(edition)
        ok('/api/v1/cart/items', customer, 'POST', {'editionId': edition, 'quantity': quantity})
    cart = ok('/api/v1/cart', customer)
    assert cart['originalSubtotal'] == '214.88' and cart['savingsTotal'] == '40.98'
    assert cart['currentSubtotal'] == cart['subtotal'] == '173.90'
    assert cart['taxAmount'] == '26.09' and cart['total'] == '199.99'
    physical = next(x for x in cart['items'] if x['editionId'] == editions[0])
    assert physical['originalPrice'] == '79.95' and physical['unitSavings'] == '15.99'
    assert physical['originalSubtotal'] == '159.90' and physical['lineSavings'] == '31.98'
    locations = ok('/api/v1/pickup-locations')
    key = str(uuid.uuid4())
    payload = {'fulfillmentMethod': 'STORE_PICKUP', 'pickupLocationId': locations[0]['id'],
               'paymentMethod': 'TRANSFER', 'simulationOutcome': 'APPROVED', 'expectedCartId': cart['cartId']}
    result = checkout(customer, payload, key)
    pricing = {name: result[name] for name in ('originalSubtotal', 'savingsTotal', 'currentSubtotal', 'subtotal', 'taxAmount', 'shippingAmount', 'total', 'pricingSnapshotAvailable')}
    assert pricing == {'originalSubtotal': '214.88', 'savingsTotal': '40.98', 'currentSubtotal': '173.90',
        'subtotal': '173.90', 'taxAmount': '26.09', 'shippingAmount': '0.00', 'total': '199.99', 'pricingSnapshotAvailable': True}
    detail = ok('/api/v1/orders/' + result['orderId'], customer)
    summary = next(x for x in ok('/api/v1/orders', customer)['items'] if x['orderId'] == result['orderId'])
    for response in (detail, summary):
        assert all(response[name] == value for name, value in pricing.items())
    lines_before = detail['items']
    assert len(lines_before) == 4 and all(x['pricingSnapshotAvailable'] for x in lines_before)
    for line in lines_before:
        projected = next(x for x in cart['items'] if x['editionId'] == line['editionId'])
        assert line['unitPrice'] == projected['currentPrice'] and line['subtotal'] == projected['currentSubtotal']
        assert all(line[name] == projected[name] for name in ('originalPrice', 'unitSavings', 'originalSubtotal', 'lineSavings'))
    # Expiry is authored via official API, never by deriving historical values from catalog prices.
    for edition, (_, base, effective, _) in zip(editions, fixtures):
        if effective:
            ok('/api/v1/admin/editions/' + edition + '/offer', admin, 'PUT', {'offerPrice': effective,
                'startsAt': (now - timedelta(days=2)).isoformat(), 'endsAt': (now - timedelta(days=1)).isoformat()}, 204)
            assert ok('/api/v1/catalog/editions/' + edition)['price'] == base
    after = ok('/api/v1/orders/' + result['orderId'], customer)
    assert after['items'] == lines_before and all(after[name] == value for name, value in pricing.items())
    replay = checkout(customer, payload, key)
    assert replay['orderId'] == result['orderId'] and all(replay[name] == value for name, value in pricing.items())
    ok('/api/v1/cart/items', customer, 'POST', {'editionId': editions[0], 'quantity': 1})
    new_cart = ok('/api/v1/cart', customer)
    assert new_cart['originalSubtotal'] == new_cart['currentSubtotal'] == '79.95'
    assert new_cart['savingsTotal'] == new_cart['items'][0]['unitSavings'] == '0.00'
    assert new_cart['taxAmount'] == '11.99' and new_cart['total'] == '91.94'
    ok('/api/v1/orders/' + result['orderId'] + '/cancel', customer, 'POST', expected=200)
    cancelled = ok('/api/v1/orders/' + result['orderId'], customer)
    assert cancelled['items'] == lines_before and all(cancelled[name] == value for name, value in pricing.items())
    print('PASS: live REST cart, confirmation, Mis pedidos, detail, quantity, mixed formats, expiry, idempotency and cancellation preserve authoritative pricing.')


if __name__ == '__main__':
    main()
