"""Live PostgreSQL/JDBC/REST offer pricing and customer purchase contract."""
from datetime import datetime, timedelta, timezone
import uuid
import os
from urllib.parse import urlencode
from digital_editions_http_gate import ok, problem
from full_journey_http_gate import admin_token
from checkout_last_unit import query


def main():
    suffix = uuid.uuid4().hex[:12]
    email = f'offers-{suffix}@example.invalid'
    query(f"INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('{email}','fixture','ADMIN','ACTIVE')")
    actor = int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='{email}'"))
    admin = admin_token(actor)
    author = ok('/api/v1/admin/authors', admin, 'POST', {'name': f'Ofertas {suffix}', 'biography': None}, 201)
    publisher = ok('/api/v1/admin/publishers', admin, 'POST', {'name': f'Ofertas {suffix}', 'description': None}, 201)
    category = ok('/api/v1/admin/categories', admin, 'POST', {'name': f'Ofertas {suffix}', 'slug': f'offers-{suffix}', 'description': None, 'parentCategoryId': None}, 201)
    book = ok('/api/v1/admin/books', admin, 'POST', {'title': f'Oferta {suffix}', 'subtitle': None, 'synopsis': None,
        'authors': [{'authorId': author['authorId'], 'order': 1}], 'categoryIds': [category['categoryId']]}, 201)
    edition = ok('/api/v1/admin/editions', admin, 'POST', {'bookId': book['bookId'], 'publisherId': publisher['publisherId'],
        'sku': f'OFFERS-{suffix}', 'isbn13': None, 'language': 'es', 'format': 'EBOOK', 'pageCount': None,
        'publicationDate': None, 'price': '20.00', 'coverUrl': None, 'coverLicense': None, 'coverSourceUrl': None,
        'coverAttribution': None, 'ebookFileFormat': 'EPUB'}, 201)['editionId']
    endpoint = f'/api/v1/admin/editions/{edition}/offer'
    now = datetime.now(timezone.utc)
    offer = {'offerPrice': '15.00', 'startsAt': (now-timedelta(days=1)).isoformat(), 'endsAt': (now+timedelta(days=1)).isoformat(), 'offerCopy': 'Texto editorial de la oferta', 'terms': 'Aplica a esta edición.'}
    # This route is the first missing production behavior in the pre-integration baseline.
    ok(endpoint, admin, 'PUT', offer, 204)
    detail = ok('/api/v1/catalog/editions/'+edition)
    assert detail['price'] == '15.00' and detail['offer']['originalPrice'] == '20.00'
    assert detail['offer']['discountAmount'] == '5.00' and detail['offer']['offerId'].isdigit()
    assert detail['offer']['effectivePrice'] == '15.00' and detail['offer']['savingsAmount'] == '5.00'
    assert detail['offer']['savingsPercent'] == '25.00'
    assert detail['offer']['daysRemaining'] == 1 and detail['offer']['endingSoon'] is True
    assert detail['offer']['endsAt'].endswith('-05:00') and detail['offer']['startsAt'].endswith('-05:00')
    assert detail['offer']['offerCopy'] == 'Texto editorial de la oferta' and detail['offer']['terms'] == 'Aplica a esta edición.'
    facets = ok('/api/v1/catalog/offers/filter-options')
    assert facets['timezone'] == 'America/Guayaquil' and facets['endingSoonDays'] == 3
    assert any(row['code'] == 'EBOOK' and int(row['count']) > 0 for row in facets['productTypes'])
    assert any(row['slug'] == f'offers-{suffix}' and row['count'] == '1' for row in facets['categories'])
    assert [row['code'] for row in facets['sorts']] == ['RELEVANCE', 'ENDING_SOON', 'PRICE_ASC', 'PRICE_DESC']
    results = ok('/api/v1/catalog/editions?'+urlencode({'que': suffix, 'minPrice': '14.00', 'maxPrice': '16.00'}))
    assert len(results['items']) == 1 and results['items'][0]['offer'] == detail['offer'], results
    offers = ok('/api/v1/catalog/offers?'+urlencode({'productType': 'EBOOK', 'category': f'offers-{suffix}', 'sort': 'ENDING_SOON', 'pageSize': 50}))
    assert offers['totalCount'] == '1' and [row['editionId'] for row in offers['items']] == [edition], offers
    assert ok('/api/v1/catalog/offers?'+urlencode({'productType': 'PHYSICAL', 'category': f'offers-{suffix}'}))['totalCount'] == '0'
    customer_email = f'offers-customer-{suffix}@example.invalid'
    ok('/api/v1/auth/register', None, 'POST', {'email': customer_email, 'password': 'Offers-fixture-1', 'firstNames': 'Cliente', 'lastNames': 'Ofertas'}, 201)
    from email_verification_fixture import verify_registered_email
    verify_registered_email(customer_email, os.environ['CHECKOUT_BASE_URL'])
    customer = 'Bearer ' + ok('/api/v1/auth/login', None, 'POST', {'email': customer_email, 'password': 'Offers-fixture-1'})['accessToken']
    problem(endpoint, customer, 'PUT', offer, 'ACCESS_DENIED', 403)
    address = ok('/api/v1/me/addresses', customer, 'POST', {'alias': 'Casa', 'recipient': 'Cliente Ofertas', 'line1': 'Calle Ofertas',
        'line2': None, 'city': 'Quito', 'province': 'Pichincha', 'countryCode': 'EC', 'postalCode': None, 'reference': None,
        'phone': '+59325550134', 'makePrimary': True}, 201)['addressId']
    ok('/api/v1/me/favorites/'+edition, customer, 'PUT', expected=204)
    assert ok('/api/v1/me/favorites', customer)['items'][0]['price'] == '15.00'
    ok('/api/v1/cart/items', customer, 'POST', {'editionId': edition, 'quantity': 1})
    cart = ok('/api/v1/cart', customer)
    assert cart['items'][0]['currentPrice'] == '15.00' and cart['subtotal'] == '15.00' and cart['taxAmount'] == '2.25' and cart['total'] == '17.25', cart
    order = ok('/api/v1/checkout', customer, 'POST', {'addressId': address, 'paymentMethod': 'TRANSFER', 'simulationOutcome': 'APPROVED'}, 201)
    assert order['subtotal'] == '15.00' and order['taxAmount'] == '2.25' and order['total'] == '17.25', order
    bought = ok('/api/v1/orders/'+order['orderId'], customer)
    assert bought['items'][0]['unitPrice'] == '15.00' and bought['items'][0]['format'] == 'EBOOK'
    problem(endpoint, admin, 'PUT', {**offer, 'offerPrice': '25.00'}, 'P1001')
    problem(endpoint, admin, 'PUT', {**offer, 'endsAt': offer['startsAt']}, 'P1001')
    problem(endpoint, admin, 'PUT', {**offer, 'offerPrice': '0.00'}, 'VALIDATION_ERROR')
    problem('/api/v1/catalog/offers?pageSize=51', None, 'GET', None, 'VALIDATION_ERROR')
    ok(endpoint, None, 'PUT', offer, 401)
    ok(endpoint, admin, 'DELETE', None, 204)
    ok(endpoint, admin, 'DELETE', None, 204)
    detail = ok('/api/v1/catalog/editions/'+edition)
    assert detail['price'] == '20.00' and detail['offer'] is None, detail
    bought = ok('/api/v1/orders/'+order['orderId'], customer)
    assert bought['items'][0]['unitPrice'] == '15.00' and bought['total'] == '17.25', bought
    ok(endpoint, admin, 'PUT', {**offer, 'startsAt': (now-timedelta(days=2)).isoformat(), 'endsAt': (now-timedelta(days=1)).isoformat()}, 204)
    assert ok('/api/v1/catalog/editions/'+edition)['offer'] is None
    print('Offers HTTP gate passed: admin lifecycle, public metadata/filter/pagination, Spanish validation and authentication.')


if __name__ == '__main__':
    main()
