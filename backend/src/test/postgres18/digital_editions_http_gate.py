"""Live PostgreSQL/JDBC/REST coverage for simulated digital editions (V032)."""
import json
import os
import uuid
from urllib.parse import urlencode
from full_journey_http_gate import admin_token, request, assert_spanish_problem
from checkout_last_unit import query


def ok(path, token=None, method="GET", body=None, expected=200):
    status, _, data = request(path, token, method, body)
    assert status == expected, (path, status, data)
    return data


def problem(path, token, method, body, code, expected=400):
    status, headers, data = request(path, token, method, body)
    assert status == expected, (path, status, data)
    assert_spanish_problem(status, headers, data, code)


def main():
    suffix = uuid.uuid4().hex[:12]
    query(f"INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('v032-{suffix}@example.invalid','fixture','ADMIN','ACTIVE')")
    actor = int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='v032-{suffix}@example.invalid'"))
    admin = admin_token(actor)
    author = ok('/api/v1/admin/authors', admin, 'POST', {'name': f'Autora Digital {suffix}', 'biography': None}, 201)
    publisher = ok('/api/v1/admin/publishers', admin, 'POST', {'name': f'Editorial Digital {suffix}', 'description': None}, 201)
    category = ok('/api/v1/admin/categories', admin, 'POST', {'name': f'Tema {suffix}', 'slug': f'digital-{suffix}', 'description': None, 'parentCategoryId': None}, 201)
    title = f'Obra Digital {suffix}'
    book = ok('/api/v1/admin/books', admin, 'POST', {'title': title, 'subtitle': None, 'synopsis': 'Fixture digital simulada.',
              'authors': [{'authorId': author['authorId'], 'order': 1}], 'categoryIds': [category['categoryId']]}, 201)
    cover = 'https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000053-700e1f21cf58.webp'
    common = {'bookId': book['bookId'], 'publisherId': publisher['publisherId'], 'isbn13': None, 'language': 'es',
              'publicationDate': None, 'price': '10.00', 'coverUrl': cover, 'coverLicense': None, 'coverSourceUrl': None, 'coverAttribution': None}
    ids = {}
    payloads = {}
    for fmt in ['PAPERBACK', 'HARDCOVER', 'EBOOK', 'AUDIOBOOK']:
        payload = {**common, 'sku': f'V032-{fmt}-{suffix}', 'format': fmt,
                   'pageCount': 100 if fmt in {'PAPERBACK', 'HARDCOVER'} else None}
        if fmt == 'EBOOK':
            payload['ebookFileFormat'] = 'EPUB'
        if fmt == 'AUDIOBOOK':
            payload.update(audioDurationSeconds=3600, narrators=['Primera voz', 'Segunda voz'])
        ids[fmt] = ok('/api/v1/admin/editions', admin, 'POST', payload, 201)['editionId']
        payloads[fmt] = payload
        detail = ok('/api/v1/catalog/editions/' + ids[fmt])
        assert detail['format'] == fmt and detail['coverUrl'] == cover
        assert detail['available'] == (fmt in {'EBOOK', 'AUDIOBOOK'}), detail
        assert detail['narrators'] == (['Primera voz', 'Segunda voz'] if fmt == 'AUDIOBOOK' else [])
        if fmt in {'EBOOK', 'AUDIOBOOK'}:
            assert detail['pageCount'] is None
            assert query(f"SELECT count(*) FROM pliego.inventario WHERE edicion_id={ids[fmt]}") == '0'
        for criteria in [{'title': title, 'format': fmt}, {'que': title, 'format': fmt, 'category': f'digital-{suffix}'},
                         {'que': f'Autora Digital {suffix}', 'format': fmt}]:
            results = ok('/api/v1/catalog/editions?' + urlencode(criteria))
            assert [row['editionId'] for row in results['items']] == [ids[fmt]], results
        results = ok('/api/v1/admin/editions?' + urlencode({'bookId': book['bookId'], 'format': fmt}), admin)
        assert [row['editionId'] for row in results['items']] == [ids[fmt]]
        assert results['items'][0]['stockActual'] == (0 if fmt in {'PAPERBACK', 'HARDCOVER'} else None)
    facets = ok('/api/v1/catalog/filter-options')
    assert set(ids) <= set(facets['formats']), facets
    assert any(c['slug'] == f'digital-{suffix}' for c in ok('/api/v1/catalog/categories')['items'])
    # Replacement, JDBC text-array ordering and nullable INTEGER binding.
    for fmt in ['EBOOK', 'AUDIOBOOK']:
        payload = {k: v for k, v in payloads[fmt].items() if k not in {'bookId', 'sku'}}
        payload.update({'ebookFileFormat': 'PDF'} if fmt == 'EBOOK' else {'audioDurationSeconds': 7200, 'narrators': ['Segunda voz', 'Primera voz']})
        ok('/api/v1/admin/editions/' + ids[fmt], admin, 'PUT', payload, 204)
        payloads[fmt] = payload
        detail = ok('/api/v1/catalog/editions/' + ids[fmt])
        assert detail['ebookFileFormat'] == ('PDF' if fmt == 'EBOOK' else None)
        if fmt == 'AUDIOBOOK':
            assert detail['audioDurationSeconds'] == 7200 and detail['narrators'] == ['Segunda voz', 'Primera voz']
    for changes, code in [({'format': 'AUDIOBOOK', 'audioDurationSeconds': 0, 'narrators': ['Voz']}, 'VALIDATION_ERROR'),
                          ({'format': 'AUDIOBOOK', 'audioDurationSeconds': 10, 'narrators': [' ']}, 'VALIDATION_ERROR'),
                          ({'format': 'AUDIOBOOK', 'audioDurationSeconds': 10, 'narrators': []}, 'P2048'),
                          ({'format': 'AUDIOBOOK', 'audioDurationSeconds': 10, 'narrators': ['Voz'], 'pageCount': 10}, 'P2048'),
                          ({'format': 'EBOOK', 'audioDurationSeconds': 10}, 'P2048'),
                          ({'format': 'EBOOK', 'ebookFileFormat': 'MOBI'}, 'VALIDATION_ERROR'),
                          ({'format': 'PAPERBACK', 'pageCount': None}, 'P2048'),
                          ({'format': 'PAPERBACK', 'pageCount': 10, 'ebookFileFormat': 'PDF'}, 'P2048')]:
        payload = {**common, 'sku': f'V032-INVALID-{suffix}', 'pageCount': None, **changes}
        problem('/api/v1/admin/editions', admin, 'POST', payload, code)
    problem('/api/v1/admin/editions/' + ids['EBOOK'], admin, 'PUT',
            {**payloads['EBOOK'], 'format': 'PAPERBACK', 'pageCount': 100, 'ebookFileFormat': None}, 'P2048')
    inventory = ok('/api/v1/admin/inventory?' + urlencode({'editionId': ids['EBOOK']}), admin)
    assert inventory['items'] == []
    problem('/api/v1/admin/inventory/' + ids['EBOOK'] + '/entries', admin, 'POST', {'quantity': 1, 'reason': 'No physical stock'}, 'P3001', 404)
    # Customer sees and buys digital without inventing stock.
    email = f'v032-customer-{suffix}@example.invalid'
    ok('/api/v1/auth/register', None, 'POST', {'email': email, 'password': 'Digital-fixture-1', 'firstNames': 'Cliente', 'lastNames': 'Digital'}, 201)
    from email_verification_fixture import verify_registered_email
    verify_registered_email(email, os.environ['CHECKOUT_BASE_URL'])
    customer = 'Bearer ' + ok('/api/v1/auth/login', None, 'POST', {'email': email, 'password': 'Digital-fixture-1'})['accessToken']
    address = ok('/api/v1/me/addresses', customer, 'POST', {'alias': 'Casa', 'recipient': 'Cliente Digital', 'line1': 'Calle Digital',
                 'line2': None, 'city': 'Quito', 'province': 'Pichincha', 'countryCode': 'EC', 'postalCode': None, 'reference': None,
                 'phone': '+59325550134', 'makePrimary': True}, 201)['addressId']
    ok('/api/v1/me/favorites/' + ids['EBOOK'], customer, 'PUT', expected=204)
    favorites = ok('/api/v1/me/favorites', customer)
    assert favorites['items'][0]['available'] and favorites['items'][0]['format'] == 'EBOOK', favorites
    added = ok('/api/v1/cart/items', customer, 'POST', {'editionId': ids['EBOOK'], 'quantity': 1})
    problem('/api/v1/cart/items/' + added['cartItemId'], customer, 'PUT', {'quantity': 2}, 'P4004')
    ok('/api/v1/admin/editions/' + ids['EBOOK'] + '/status', admin, 'PUT', {'state': 'INACTIVE'}, 204)
    cart = ok('/api/v1/cart', customer)
    assert not cart['items'][0]['available'] and cart['items'][0]['unavailabilityReason'] == 'P2042'
    problem('/api/v1/checkout', customer, 'POST', {'fulfillmentMethod': 'DIGITAL_ONLY', 'paymentMethod': 'TRANSFER', 'simulationOutcome': 'APPROVED'}, 'P2042', 409)
    ok('/api/v1/admin/editions/' + ids['EBOOK'] + '/status', admin, 'PUT', {'state': 'ACTIVE'}, 204)
    ok('/api/v1/cart/items', customer, 'POST', {'editionId': ids['AUDIOBOOK'], 'quantity': 1})
    cart = ok('/api/v1/cart', customer)
    assert {row['format'] for row in cart['items']} == {'EBOOK', 'AUDIOBOOK'} and all(row['available'] for row in cart['items'])
    order = ok('/api/v1/checkout', customer, 'POST', {'fulfillmentMethod': 'DIGITAL_ONLY', 'paymentMethod': 'TRANSFER', 'simulationOutcome': 'APPROVED'}, 201)
    bought = ok('/api/v1/orders/' + order['orderId'], customer)
    assert {row['format'] for row in bought['items']} == {'EBOOK', 'AUDIOBOOK'}
    assert query(f"SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id={order['orderId']}") == '0'
    cancelled = ok('/api/v1/orders/' + order['orderId'] + '/cancel', customer, 'POST')
    assert cancelled['restoredUnits'] == 0 and cancelled['paymentState'] == 'REFUNDED', cancelled
    schema = ok('/v3/api-docs')['components']['schemas']
    assert set(ids) <= set(schema['CatalogEditionDetailResponse']['properties']['format']['enum'])
    assert schema['CatalogEditionDetailResponse']['properties']['narrators']['type'] == 'array'
    assert 'ebookFileFormat' in schema['EditionCreate']['properties']
    print('Digital editions: admin, JDBC, discovery, filters, metadata, cart, orders and REST serialization passed.')


if __name__ == '__main__':
    main()
