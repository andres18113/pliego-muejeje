import collections
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path.cwd() / 'scripts'))
from cover_catalog import write_json
from publish_digital_editions import private_env, flow
from publish_physical_editions import assert_preserved, load_batch

repo = Path.cwd()
audit = repo / 'docs/audit/physical-catalog-180-2026-10-05'
snapshot = json.loads((audit / 'catalog-before.json').read_text())
config = private_env(Path('/home/andres18123/.config/pliego/digital-admin.env'))
api = flow.PliegoApi(config.get('PLIEGO_API_BASE_URL', flow.API_BASE))
api.login(config['PLIEGO_ADMIN_EMAIL'], config['PLIEGO_ADMIN_PASSWORD'])
items = load_batch(repo)
after = api.all_pages('/api/v1/admin/editions')
by_sku = {r['sku']: r for r in after}
assert_preserved(snapshot['editions'], [r for r in after if r['sku'] in {x['sku'] for x in snapshot['editions']}])
works = {b['bookId']: b for b in api.all_pages('/api/v1/admin/books')}
assert all(works[b['bookId']] == b for b in snapshot['books'])
for endpoint in ['authors', 'publishers', 'categories']:
    identity = {'authors': 'authorId', 'publishers': 'publisherId', 'categories': 'categoryId'}[endpoint]
    current = {x[identity]: x for x in api.all_pages('/api/v1/admin/' + endpoint)}
    assert all(current[x[identity]] == x for x in snapshot[endpoint])

details = []
for item in items:
    seed, record = item['seed'], item['record']
    row = by_sku[seed.sku]
    assert row['format'] == seed.format and row['isbn13'] == seed.isbn13
    assert row['stockActual'] == seed.stock and row['price'] == seed.price
    detail = api.request('GET', '/api/v1/catalog/editions/' + row['editionId'])
    for key, value in {'sku': seed.sku, 'isbn13': seed.isbn13, 'format': seed.format,
                       'pageCount': seed.page_count, 'language': seed.language, 'price': seed.price,
                       'coverUrl': seed.cover_url, 'publicationDate': seed.publication_date,
                       'ebookFileFormat': None, 'audioDurationSeconds': None, 'narrators': []}.items():
        assert detail[key] == value, (seed.sku, key, detail[key], value)
    assert detail['available'] is True
    assert 'SIMULATED/DEMO' in detail['synopsis']
    assert [a['name'] for a in detail['authors']] == list(seed.authors)
    assert seed.category_name in [c['name'] for c in detail['categories']]
    details.append({'sku': seed.sku, 'editionId': row['editionId'], 'category': seed.category_name,
                    'available': detail['available'], 'stock': row['stockActual'], 'isbn13': detail['isbn13'],
                    'format': detail['format'], 'title': detail['title'], 'pageCount': detail['pageCount'],
                    'coverUrl': detail['coverUrl']})
write_json(audit / 'detail-verification.json', {'records': details})
print('ADMIN/details/availability verified:', len(details), '; all prior editions/works/reference metadata preserved.', flush=True)

failures, search_verified, category_filters = [], 0, []
groups = collections.defaultdict(list)
for item in items:
    groups[item['seed'].category].append(item)
for category, grouped in groups.items():
    try:
        result = api.all_pages('/api/v1/catalog/editions', category=category, format='PAPERBACK')
        assert {x['seed'].sku for x in grouped}.issubset({r['sku'] for r in result})
        assert all(r['format'] == 'PAPERBACK' for r in result)
        category_filters.append({'category': category, 'own_books': len(grouped), 'returned': len(result)})
        sample = grouped[0]
        search = api.all_pages('/api/v1/catalog/editions', query=sample['seed'].title, category=category)
        assert sample['seed'].sku in {r['sku'] for r in search}
        search_verified += 1
    except flow.ApiError as error:
        failures.append({'gate': 'category_filter_and_search', 'category': category, 'error': str(error)})
options = api.request('GET', '/api/v1/catalog/filter-options')
write_json(audit / 'filter-options.json', options)
write_json(audit / 'search-filter-verification.json', {'category_filters': category_filters,
           'title_searches_verified': search_verified, 'existing_integration_failures': failures})

customer_config = private_env(Path('/home/andres18123/.config/pliego/digital-cart-gate.env'))
customer = flow.PliegoApi(api.base_url)
customer.token = customer.request('POST', '/api/v1/auth/login',
    {'email': customer_config['PLIEGO_CUSTOMER_EMAIL'], 'password': customer_config['PLIEGO_CUSTOMER_PASSWORD']})['accessToken']
before_cart = customer.request('GET', '/api/v1/cart')
before_items = before_cart['items']
write_json(Path('/tmp/pliego-physical-180/cart-before.json'), before_cart)
cart_checks = []
for category, grouped in groups.items():
    sample = next(i for i in grouped if by_sku[i['seed'].sku]['editionId'] not in {r['editionId'] for r in before_items})
    edition_id = by_sku[sample['seed'].sku]['editionId']
    added = customer.request('POST', '/api/v1/cart/items', {'editionId': edition_id, 'quantity': 1})
    item_id = added['cartItemId']
    try:
        customer.request('PUT', '/api/v1/cart/items/' + item_id, {'quantity': 2})
        cart = customer.request('GET', '/api/v1/cart')
        row = next(r for r in cart['items'] if r['editionId'] == edition_id)
        assert row['quantity'] == 2 and row['available'] is True and row['format'] in {'PAPERBACK', 'HARDCOVER'}
        cart_checks.append({'sku': sample['seed'].sku, 'category': category, 'quantity': 2, 'available': True})
    finally:
        customer.request('DELETE', '/api/v1/cart/items/' + item_id)
assert customer.request('GET', '/api/v1/cart')['items'] == before_items
assert_preserved(snapshot['editions'], [r for r in api.all_pages('/api/v1/admin/editions')
                 if r['sku'] in {x['sku'] for x in snapshot['editions']}])
write_json(audit / 'cart-verification.json', {'records': cart_checks, 'existing_items_preserved': True,
           'catalog_inventory_unchanged_by_cart': True})
summary = {'new_physical_editions_verified': len(items), 'previous_editions_preserved': len(snapshot['editions']),
           'previous_works_preserved': len(snapshot['books']), 'new_works': len(works) - len(snapshot['books']),
           'final_edition_formats': dict(collections.Counter(r['format'] for r in after)),
           'source_category_counts': dict(collections.Counter(i['seed'].category_name for i in items)),
           'details_passed': len(details), 'cart_categories_passed': len(cart_checks),
           'existing_integration_failures': failures}
write_json(audit / 'verification-summary.json', summary)
print('Cart add/update/remove verified for', len(cart_checks), 'categories; original cart restored.', flush=True)
print('Search/filter integration failures:', len(failures), flush=True)
