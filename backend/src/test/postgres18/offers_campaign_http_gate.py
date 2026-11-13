"""Local disposable PostgreSQL 18/API campaign rehearsal; never accepts production."""
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import uuid

from checkout_last_unit import query
from digital_editions_http_gate import ok
from full_journey_http_gate import admin_token

ROOT = Path(__file__).resolve().parents[4]
CAMPAIGN = ROOT / "scripts/ops/offers-campaign/campaign.py"
SPEC = importlib.util.spec_from_file_location("campaign", CAMPAIGN)
campaign = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(campaign)


def fingerprint(table):
    return query(f"SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::TEXT)::TEXT,'')) FROM pliego.{table} t")


def main():
    base = os.environ["CHECKOUT_BASE_URL"].rstrip("/")
    campaign.validate_target(base, "local", None)
    assert os.environ.get("PGHOST") in {"127.0.0.1", "localhost", "::1"}, "Disposable loopback database required"
    assert int(query("SHOW server_version_num")) >= 180000
    suffix = uuid.uuid4().hex[:12]
    actor = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'"))
    admin = admin_token(actor)
    api = campaign.Api(base, admin)
    author = ok('/api/v1/admin/authors', admin, 'POST', {'name': f'Campaña {suffix}', 'biography': None}, 201)['authorId']
    publisher = ok('/api/v1/admin/publishers', admin, 'POST', {'name': f'Campaña {suffix}', 'description': None}, 201)['publisherId']
    category = ok('/api/v1/admin/categories', admin, 'POST', {'name': f'Campaña {suffix}', 'slug': f'campaign-{suffix}',
        'description': None, 'parentCategoryId': None}, 201)['categoryId']
    book = ok('/api/v1/admin/books', admin, 'POST', {'title': f'Catálogo fixture campaña {suffix}', 'subtitle': None, 'synopsis': None,
        'authors': [{'authorId': author, 'order': 1}], 'categoryIds': [category]}, 201)['bookId']
    # Actual legacy SKUs/windows are recreated locally; IDs are disposable fixture IDs.
    # The real October campaign and all production resources remain untouched.
    prior = json.loads(campaign.PRIOR.read_text())
    occupied_skus = {r['sku'] for r in api.editions()}
    fixture_skus = set()
    legacy_ids = []
    sample_cover = 'https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000053-700e1f21cf58.webp'

    def create(sku, fmt, price):
        payload = dict(bookId=book, publisherId=publisher, sku=sku, isbn13=None, language='es',
            format=fmt, pageCount=100 if fmt == 'PAPERBACK' else None, publicationDate=None, price=price,
            coverUrl=sample_cover, coverLicense=None, coverSourceUrl=None, coverAttribution=None)
        if fmt == 'EBOOK':
            payload['ebookFileFormat'] = 'EPUB'
        elif fmt == 'AUDIOBOOK':
            payload.update(audioDurationSeconds=3600, narrators=['Voz fixture'])
        edition = ok('/api/v1/admin/editions', admin, 'POST', payload, 201)['editionId']
        fixture_skus.add(sku)
        if fmt == 'PAPERBACK':
            ok(f'/api/v1/admin/inventory/{edition}/entries', admin, 'POST', {'quantity': 10, 'reason': 'Fixture local de campaña'}, 201)
        return edition

    for old in prior:
        if old['sku'] in occupied_skus:
            continue
        edition = create(old['sku'], old['format'], old['basePrice'])
        ok(f'/api/v1/admin/editions/{edition}/offer', admin, 'PUT', old['request'], 204)
        assert api.detail(edition)['offer'] is None
        assert next(r for r in api.editions(old['sku']) if r['editionId'] == edition)['offerRowExists'] is True
        legacy_ids.append(edition)

    # Keep nine eligible per type even when a disposable ID matches an excluded ID.
    start = int(query("SELECT COALESCE(max(substring(sku from 8)::INTEGER),900000) FROM pliego.edicion WHERE sku ~ '^PLG-BK-9[0-9]{5}$'"))
    start = max(start, 900000)
    excluded_ids, _, _ = campaign.exclusions()
    serial = start
    for group, fmt in enumerate(('PAPERBACK', 'EBOOK', 'AUDIOBOOK')):
        prices = ('7.99', '12.99', '19.99') if fmt == 'EBOOK' else ('9.95', '19.95', '29.95')
        accepted, index = 0, 0
        while accepted < 9:
            serial += 1
            edition = create(f'PLG-BK-{serial:06d}', fmt, prices[index % 3])
            accepted += edition not in excluded_ids
            index += 1

    # Select only this gate's fixtures even if other CI fixtures have matching SKUs.
    class FixtureApi(campaign.Api):
        def editions(self, sku=None):
            return [r for r in super().editions(sku) if r['sku'] in fixture_skus]

    fixture_api = FixtureApi(base, admin)
    ids, skus, _ = campaign.exclusions()
    plan = campaign.generate_plan(fixture_api, ids, skus, 7, base)
    assert not {r['sku'] for r in plan['editions']} & skus
    logs = Path(os.environ.get('PLIEGO_OFFERS_CAMPAIGN_LOG_DIR') or tempfile.mkdtemp(prefix='pliego-offers-campaign-'))
    logs.mkdir(parents=True, exist_ok=True)
    plan_path = logs / 'local-fixture-plan.json'
    campaign.write_json(plan_path, plan)
    selected = ','.join(r['editionId'] for r in plan['editions'])
    previous_offers_before = query(f"SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY oferta_id)::TEXT,'[]') FROM pliego.edicion_oferta o WHERE edicion_id NOT IN({selected})")
    baseline = {name: fingerprint(name) for name in ('edicion', 'inventario', 'movimiento_inventario', 'edicion_oferta')}
    child_env = dict(os.environ, OFFER_ADMIN_TOKEN=admin)
    common = ['python3', str(CAMPAIGN), 'run', '--base-url', base, '--plan', str(plan_path)]
    with (logs / 'dry-run.log').open('w') as log:
        subprocess.run(common + ['--report', str(logs / 'dry-run.json')], env=child_env, stdout=log, stderr=subprocess.STDOUT, check=True)
    assert baseline == {name: fingerprint(name) for name in baseline}, 'Dry run mutated catalogue'
    with (logs / 'apply.log').open('w') as log:
        subprocess.run(common + ['--apply', '--exclusive-writer-window', '--journal', str(logs / 'writes.jsonl'),
            '--report', str(logs / 'applied.json')], env=child_env, stdout=log, stderr=subprocess.STDOUT, check=True)
    result = json.loads((logs / 'applied.json').read_text())
    assert result['counts'] == {'PHYSICAL': 7, 'EBOOK': 7, 'AUDIOBOOK': 7}
    assert result['endingSoonCount'] == 6
    assert query(f"SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY oferta_id)::TEXT,'[]') FROM pliego.edicion_oferta o WHERE edicion_id NOT IN({selected})") == previous_offers_before, 'Existing offer rows changed during apply'
    assert {name: fingerprint(name) for name in ('edicion', 'inventario', 'movimiento_inventario')} == {k: baseline[k] for k in ('edicion', 'inventario', 'movimiento_inventario')}

    # A rerun must fail rather than upsert any of the 21 campaign rows again.
    offers_after = fingerprint('edicion_oferta')
    rerun = subprocess.run(common, env=child_env, text=True, capture_output=True)
    assert rerun.returncode == 2 and fingerprint('edicion_oferta') == offers_after

    email = f'campaign-{suffix}@example.invalid'
    password = 'Local-campaign-' + uuid.uuid4().hex
    ok('/api/v1/auth/register', None, 'POST', {'email': email, 'password': password, 'firstNames': 'Cliente', 'lastNames': 'Campaña'}, 201)
    from email_verification_fixture import verify_registered_email
    verify_registered_email(email, base)
    customer = 'Bearer ' + ok('/api/v1/auth/login', None, 'POST', {'email': email, 'password': password})['accessToken']
    from full_journey_http_gate import request
    first = result['preflight'][0]
    endpoint = f'/api/v1/admin/editions/{first["editionId"]}/offer'
    assert request(endpoint, None, 'PUT', first['request'])[0] == 401
    assert request(endpoint, customer, 'PUT', first['request'])[0] == 403
    assert request('/api/v1/admin/editions', customer)[0] == 403
    cart_results = []
    for row in plan['editions']:
        ok('/api/v1/cart/items', customer, 'POST', {'editionId': row['editionId'], 'quantity': 1})
        cart = ok('/api/v1/cart', customer)
        item = next(r for r in cart['items'] if r['editionId'] == row['editionId'])
        assert item['currentPrice'] == row['offerPrice'], item
        cart_results.append(dict(editionId=row['editionId'], currentPrice=item['currentPrice']))
        ok('/api/v1/cart/items/' + item['cartItemId'], customer, 'DELETE', None, 204)
    assert not ok('/api/v1/cart', customer)['items']
    assert not query(f"SELECT pedido_id FROM pliego.pedido WHERE cliente_id=(SELECT cliente_id FROM pliego.cliente c JOIN pliego.usuario u USING(usuario_id) WHERE u.email_normalizado='{email}')")
    legacy_before = query(f"SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY oferta_id)::TEXT,'[]') FROM pliego.edicion_oferta o WHERE edicion_id NOT IN({selected})")
    expiry_sql = f"""BEGIN;
DO $gate$ DECLARE r RECORD; ignored BIGINT; BEGIN
 FOR r IN SELECT edicion_id,precio_oferta FROM pliego.edicion_oferta WHERE edicion_id IN({selected}) LOOP
  CALL pliego.sp_edition_offer_set({actor},r.edicion_id,r.precio_oferta,statement_timestamp()-INTERVAL '2 days',statement_timestamp()-INTERVAL '1 day',ignored);
  IF (SELECT offer_id FROM pliego.fn_edition_offer(r.edicion_id)) IS NOT NULL OR
   (SELECT price<>original_price FROM pliego.fn_edition_offer(r.edicion_id)) THEN RAISE EXCEPTION 'Expiry did not restore base'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pliego.fn_catalog_search_offers(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'RELEVANCE',0,50) WHERE edition_id IN({selected})) THEN
  RAISE EXCEPTION 'Expired campaign remained in public offers'; END IF;
END $gate$;
ROLLBACK;"""
    (logs / 'expiration-gate.sql').write_text(expiry_sql)
    query(expiry_sql)
    assert fingerprint('edicion_oferta') == offers_after, 'Rollback changed campaign dates/prices'
    assert query(f"SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY oferta_id)::TEXT,'[]') FROM pliego.edicion_oferta o WHERE edicion_id NOT IN({selected})") == legacy_before
    assert all(campaign.verify_detail(api, row) for row in result['preflight'])
    assert {name: fingerprint(name) for name in ('edicion', 'inventario', 'movimiento_inventario')} == {k: baseline[k] for k in ('edicion', 'inventario', 'movimiento_inventario')}
    # Exercise all-or-none header validation and the server guard via the actual route.
    selected_ids = {r['editionId'] for r in plan['editions']}
    probes = [r for r in fixture_api.editions() if r['editionId'] not in selected_ids and campaign.eligible(r, ids, skus)]
    probe = next(r for r in probes if r['format'] == 'EBOOK')
    physical_probe = next(r for r in probes if r['format'] == 'PAPERBACK')
    probe_payload = dict(first['request'], offerPrice=f'{campaign.discount(probe["format"], probe["price"])[1]:.2f}')

    def guarded_http(edition, payload, conditions, authorization=admin):
        headers = dict(conditions, Authorization=authorization, **{'Content-Type': 'application/json'})
        request = Request(base + f'/api/v1/admin/editions/{edition}/offer', method='PUT',
                          data=json.dumps(payload).encode(), headers=headers)
        try:
            with urlopen(request, timeout=15) as response:
                return response.status, None
        except HTTPError as response:
            return response.code, json.loads(response.read())

    complete = {'If-None-Match': '*', 'X-Expected-Base-Price': probe['price'], 'X-Expected-Stock': 'NONE'}
    from itertools import combinations
    for size in (1, 2):
        for fields in combinations(complete, size):
            status, problem = guarded_http(probe['editionId'], probe_payload, {k: complete[k] for k in fields})
            assert status == 400 and problem['code'] == 'P1001', problem
    for changes in [{'X-Expected-Base-Price': '999.00'}, {'X-Expected-Stock': '0'}]:
        status, problem = guarded_http(probe['editionId'], probe_payload, dict(complete, **changes))
        assert status == 400 and problem['code'] == 'P1001'
    physical_payload = dict(first['request'], offerPrice=f'{campaign.discount("PAPERBACK", physical_probe["price"])[1]:.2f}')
    status, problem = guarded_http(physical_probe['editionId'], physical_payload,
        {'If-None-Match': '*', 'X-Expected-Base-Price': physical_probe['price'],
         'X-Expected-Stock': str(physical_probe['stockActual'] + 1)})
    assert status == 400 and problem['code'] == 'P1001'
    assert guarded_http(probe['editionId'], probe_payload, complete, customer)[0] == 403
    from concurrent.futures import ThreadPoolExecutor
    import threading
    ready = threading.Barrier(2)

    def contender():
        ready.wait(timeout=10)
        return guarded_http(probe['editionId'], probe_payload, complete)

    with ThreadPoolExecutor(max_workers=2) as workers:
        futures = [workers.submit(contender) for _ in range(2)]
        outcomes = [future.result(timeout=20) for future in futures]
    assert sorted(status for status, _ in outcomes) == [204, 400], outcomes
    assert next(body for status, body in outcomes if status == 400)['code'] == 'P1001'
    assert query(f"SELECT count(*) FROM pliego.edicion_oferta WHERE edicion_id={probe['editionId']}") == '1'
    report = dict(scope='LOCAL_DISPOSABLE_FIXTURE_ONLY', counts=result['counts'], endingSoonCount=6,
        previousExpiredOffersRecreated=len(legacy_ids), oldOffersPreserved=True, cartPricesVerified=len(cart_results),
        cartEmpty=True, noOrdersCreated=True, catalogueAndInventoryUnchanged=True, expiryRollbackVerified=21,
        anonymousWriteStatus=401, customerWriteStatus=403, rerunRefused=True,
        dryRunCatalogueUnchanged=True, publicFilterSortCombinations=12, conditionalPartialHeaderCases=6,
        conditionalRaceStatuses=[204, 400], failedPreconditionsCode='P1001',
        sourceDate=datetime.now(timezone.utc).isoformat())
    campaign.write_json(logs / 'gates.json', report)
    campaign.write_json(logs / 'cart-prices.json', cart_results)
    print(json.dumps(report, ensure_ascii=False))
    print('Verbose local-only evidence:', logs)


if __name__ == '__main__':
    main()
