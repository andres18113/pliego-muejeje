"""Live mixed-catalog verification; all expectations derive from active identities."""
import collections
from decimal import Decimal
from pathlib import Path
import re
import sys
from urllib.parse import urlencode

repo = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(repo / 'scripts'))
from cover_catalog import category_slug, read_manifest, write_json
from publish_digital_editions import flow, private_env

audit = Path(__file__).resolve().parent
config = private_env(Path('/home/andres18123/.config/pliego/digital-admin.env'))
api = flow.PliegoApi(config.get('PLIEGO_API_BASE_URL', flow.API_BASE))
api.login(config['PLIEGO_ADMIN_EMAIL'], config['PLIEGO_ADMIN_PASSWORD'])
editions = api.all_pages('/api/v1/admin/editions')
books = {b['bookId']: b for b in api.all_pages('/api/v1/admin/books')}
active = {e['sku']: e for e in editions if e['state'] == 'ACTIVE'}
manifest = read_manifest(repo / 'covers/generated/manifest-normalized.json')['records']
retired = read_manifest(repo / 'covers/retired-manifest.json')['records']
assert set(active) == {r['permanent_sku'] for r in manifest}, 'Active manifest differs from ADMIN'
assert not set(active) & {r['permanent_sku'] for r in retired}
assert 'PLG-BK-000042' not in active
checks = []
sku_by_id = {e['editionId']: e['sku'] for e in editions}

def identity(row):
    # Public list cards expose editionId; SKU belongs to the detail/admin contract.
    return sku_by_id[row['editionId']]

def search(params, expected=None):
    rows, page = [], 0
    while True:
        result = api.request('GET', '/api/v1/catalog/editions?' + urlencode({'pageSize': 50, **params, 'page': page}))
        rows.extend(result['items'])
        if len(rows) >= int(result['totalCount']) or not result['items']:
            break
        page += 1
    skus = [identity(r) for r in rows]
    assert len(skus) == len(set(skus)) and set(skus) <= set(active), 'Duplicate or retired search identity'
    if expected is not None:
        assert set(skus) == set(expected), 'Search identity set differs: ' + str(params)
    assert all(r['available'] for r in rows), 'Active edition unavailable'
    if params.get('sort') in {'PRICE_ASC', 'PRICE_DESC'}:
        prices = [Decimal(r['price']) for r in rows]
        assert prices == sorted(prices, reverse=params['sort'] == 'PRICE_DESC'), 'Price order incorrect'
    checks.append({'parameters': params, 'returned': len(rows), 'status': 200})
    return rows

kinds = [('PHYSICAL', {'PAPERBACK', 'HARDCOVER'}), ('EBOOK', {'EBOOK'}), ('AUDIOBOOK', {'AUDIOBOOK'})]
search({}, active)
for kind, formats in kinds:
    expected = {sku for sku, e in active.items() if e['format'] in formats}
    for order in ['TITLE_ASC', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING']:
        search({'productType': kind, 'sort': order, 'pageSize': '17'}, expected)
    pages = [api.request('GET', '/api/v1/catalog/editions?' + urlencode({'productType': kind, 'page': p, 'pageSize': 7})) for p in [0, 1, 100000]]
    assert all(int(p['totalCount']) == len(expected) for p in pages), 'Pagination totals incorrect'
    assert not {identity(r) for r in pages[0]['items']} & {identity(r) for r in pages[1]['items']}
    assert pages[2]['items'] == [], 'Out-of-range page contains records'
    checks.append({'gate': 'pagination', 'productType': kind, 'totalCount': len(expected), 'status': 200})
    sample = next(e for e in active.values() if e['format'] in formats)
    text_rows = search({'que': sample['bookTitle'], 'productType': kind})
    assert sample['sku'] in {identity(r) for r in text_rows}
    assert len(text_rows) < len(expected), 'Text search was not applied'
    if sample['isbn13']:
        assert sample['sku'] in {identity(r) for r in search({'isbn13': sample['isbn13'], 'productType': kind})}
for fmt in ['PAPERBACK', 'HARDCOVER', 'EBOOK', 'AUDIOBOOK']:
    search({'format': fmt}, {sku for sku, e in active.items() if e['format'] == fmt})
search({'productType': 'PHYSICAL', 'format': 'EBOOK'}, set())
search({'que': 'PliegoSinCoincidencia8ab27164c'}, set())
categories = collections.defaultdict(set)
for sku, edition in active.items():
    for category in books[edition['bookId']]['categories']:
        categories[category_slug(category['name'])].add(sku)
for slug, expected in categories.items():
    search({'category': slug}, expected)
    for kind, formats in kinds:
        search({'category': slug, 'productType': kind}, {sku for sku in expected if active[sku]['format'] in formats})
write_json(audit / 'filter-options-final.json', api.request('GET', '/api/v1/catalog/filter-options'))
print('Search/filter/sort/pagination gates:', len(checks), 'passed.', flush=True)

details = []
for sku, edition in active.items():
    detail = api.request('GET', '/api/v1/catalog/editions/' + edition['editionId'])
    assert detail['sku'] == sku and detail['format'] == edition['format'] and detail['available']
    for field in ['isbn13', 'coverUrl', 'ebookFileFormat', 'audioDurationSeconds', 'narrators']:
        assert detail[field] == edition[field], 'Detail metadata differs: ' + sku + '/' + field
    assert isinstance(detail['synopsis'], str) and len(detail['synopsis'].strip()) >= 80
    assert not re.search(r'\b(?:DEMO|SIMULATED)\b', detail['synopsis'], re.I)
    assert '[Precio' not in detail['synopsis'] and 'disponibilidad física no verificada' not in detail['synopsis']
    assert (edition['stockActual'] > 0 if edition['format'] in {'PAPERBACK', 'HARDCOVER'} else edition['stockActual'] is None)
    details.append({'sku': sku, 'format': edition['format'], 'available': True, 'synopsis_verified': True})
for record in retired:
    edition = next(e for e in editions if e['sku'] == record['permanent_sku'])
    assert edition['state'] == 'INACTIVE'
    try:
        api.request('GET', '/api/v1/catalog/editions/' + edition['editionId'])
        raise AssertionError('Retired edition detail is public')
    except flow.ApiError as error:
        assert 'HTTP 404' in str(error), str(error)
print('Active details/availability/synopses:', len(details), '; retired details rejected:', len(retired), flush=True)

customer_config = private_env(Path('/home/andres18123/.config/pliego/digital-cart-gate.env'))
customer = flow.PliegoApi(api.base_url)
customer.token = customer.request('POST', '/api/v1/auth/login', {'email': customer_config['PLIEGO_CUSTOMER_EMAIL'],
                  'password': customer_config['PLIEGO_CUSTOMER_PASSWORD']})['accessToken']
before_cart = customer.request('GET', '/api/v1/cart')['items']
cart_checks = []
for fmt in ['PAPERBACK', 'EBOOK', 'AUDIOBOOK']:
    added = None
    for edition in [e for e in active.values() if e['format'] == fmt and e['editionId'] not in {r['editionId'] for r in before_cart}]:
        try:
            added = customer.request('POST', '/api/v1/cart/items', {'editionId': edition['editionId'], 'quantity': 1})
            break
        except flow.ApiError as error:
            if 'P4008' not in str(error):
                raise
    assert added is not None, 'No eligible cart sample'
    item_id = added['cartItemId']
    try:
        if fmt == 'PAPERBACK':
            customer.request('PUT', '/api/v1/cart/items/' + item_id, {'quantity': 2})
        row = next(r for r in customer.request('GET', '/api/v1/cart')['items'] if r['cartItemId'] == item_id)
        assert row['available'] and row['format'] == fmt and row['quantity'] == (2 if fmt == 'PAPERBACK' else 1)
        cart_checks.append({'sku': edition['sku'], 'format': fmt, 'available': True, 'quantity': row['quantity']})
    finally:
        customer.request('DELETE', '/api/v1/cart/items/' + item_id)
assert customer.request('GET', '/api/v1/cart')['items'] == before_cart, 'Original cart changed'
for sku in [retired[0]['permanent_sku'], 'PLG-BK-000196']:
    row = next(e for e in editions if e['sku'] == sku)
    try:
        customer.request('POST', '/api/v1/cart/items', {'editionId': row['editionId'], 'quantity': 1})
        raise AssertionError('Retired edition entered cart')
    except flow.ApiError as error:
        assert 'P2042' in str(error), str(error)
write_json(audit / 'api-validation.json', {'search_filter_sort_pagination_checks': checks, 'details': details,
           'cart': cart_checks, 'retired_details_rejected': len(retired), 'previous_cart_restored': True,
           'active_format_counts': dict(collections.Counter(e['format'] for e in active.values()))})
print('Cart verified for', len(cart_checks), 'formats; original cart restored.', flush=True)
