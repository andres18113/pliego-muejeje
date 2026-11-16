"""Live offer expiry projections, public clock, actual scheduler and SSE delivery.

Run against the disposable migrated backend with the offer worker enabled.
No pricing/transition routine is invoked to help the scheduler pass.
"""
import base64
import hashlib
import http.client
import json
import os
import time
import urllib.parse
import uuid

from checkout_last_unit import fixture, query
from checkout_http_gate import token
from digital_editions_http_gate import ok
from cart_saved_for_later_http_gate import create_edition
from full_journey_http_gate import request


def read_event(response):
    fields = {}
    while True:
        raw = response.readline()
        if not raw:
            raise AssertionError("SSE stream closed before the expected offer hint")
        line = raw.decode().strip()
        if not line:
            if 'event' in fields:
                return fields
            fields = {}
        elif ':' in line:
            key, value = line.split(':', 1)
            fields[key] = value.lstrip()


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1'
    actors, physical = fixture()
    actor = actors[0][0]
    auth = 'Bearer ' + token(actor)
    admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'"))
    ebook = int(create_edition(admin, physical, 'EBOOK', '20.00'))
    audio = int(create_edition(admin, physical, 'AUDIOBOOK', '30.00'))
    editions = [(physical, '7.25', '3.00'), (ebook, '20.00', '15.00'), (audio, '30.00', '25.00')]
    category, title = query(f"""SELECT c.slug,l.titulo FROM pliego.edicion e JOIN pliego.libro l USING(libro_id)
      JOIN pliego.libro_categoria lc USING(libro_id) JOIN pliego.categoria c USING(categoria_id)
      WHERE e.edicion_id={physical} LIMIT 1""").split('|')

    for edition, _, _ in editions:
        ok(f'/api/v1/me/favorites/{edition}', auth, 'PUT', expected=204)
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': str(ebook), 'quantity': 1})
    line = next(x for x in ok('/api/v1/cart', auth)['items'] if x['editionId'] == str(ebook))
    ok(f"/api/v1/cart/items/{line['cartItemId']}/save-for-later", auth, 'POST')
    ok('/api/v1/cart/items', auth, 'POST', {'editionId': str(audio), 'quantity': 1})

    # Open the authenticated stream BEFORE writing the offer or reaching its end.
    secret = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=')
    digest = hashlib.sha256(secret.encode()).hexdigest()
    query(f"UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id={actor}")
    assert query(f"SELECT pliego.fn_auth_session_create_checked({actor},'{digest}',clock_timestamp()+INTERVAL '1 day','fixture-hash')") == 't'
    url = urllib.parse.urlsplit(os.environ['CHECKOUT_BASE_URL'])
    stream = http.client.HTTPConnection(url.hostname, url.port, timeout=15)
    stream.request('GET', '/api/v1/auth/events', headers={'Cookie': 'pliego_session=' + secret})
    response = stream.getresponse()
    assert response.status == 200
    assert read_event(response)['event'] == 'resync'
    try:
        ends = query("SELECT clock_timestamp()+INTERVAL '12 seconds'")
        for edition, _, price in editions:
            query(f"CALL pliego.sp_edition_offer_set({admin},{edition},{price},clock_timestamp()-INTERVAL '1 day','{ends}',NULL)")
        # Consume creation hints now: later assertions must observe NEW expiry hints.
        expected = {str(physical), str(ebook), str(audio)}
        created_seen = set()
        while created_seen != expected:
            creation = read_event(response)
            if creation['event'] == 'catalog.offers.changed':
                created_seen.add(json.loads(creation['data'])['resourceId'])
            created_seen.intersection_update(expected)
        before = query(f"SELECT to_jsonb(o) FROM pliego.edicion_oferta o WHERE edicion_id={physical}")
        clock_status, headers, clock = request('/api/v1/catalog/offer-refresh')
        assert clock_status == 200 and 'no-store' in headers.get('Cache-Control', '')
        assert set(clock) == {'serverTime', 'nextTransitionAt', 'revalidateAfterSeconds'}
        assert clock['revalidateAfterSeconds'] == 60 and clock['nextTransitionAt'] is not None
        offers_path = '/api/v1/catalog/offers?' + urllib.parse.urlencode({'category': category})
        assert ok(offers_path)['totalCount'] == '3'
        assert ok(f'/api/v1/catalog/editions/{physical}')['price'] == '3.00'
        assert ok('/api/v1/cart', auth)['subtotal'] == '28.00'
        assert ok('/api/v1/cart/saved', auth)['items'][0]['currentPrice'] == '15.00'
        assert {x['price'] for x in ok('/api/v1/me/favorites', auth)['items']} == {'3.00', '15.00', '25.00'}

        # Wait using the DB's deadline; then observe the worker through tables only.
        query(f"SELECT pg_sleep(greatest(0,extract(epoch FROM '{ends}'::TIMESTAMPTZ-clock_timestamp())))")
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            remaining = query(f"""SELECT count(*) FROM pliego.offer_transition t JOIN pliego.edicion_oferta o
              ON o.oferta_id=t.offer_id WHERE o.edicion_id IN ({physical},{ebook},{audio}) AND t.next_transition_at IS NOT NULL""")
            if remaining == '0':
                break
            time.sleep(.1)
        else:
            raise AssertionError('Actual Spring offer worker did not consume expired transitions')
        assert query(f"SELECT to_jsonb(o) FROM pliego.edicion_oferta o WHERE edicion_id={physical}") == before
        assert ok(offers_path)['items'] == []
        facets = ok('/api/v1/catalog/offers/filter-options')
        assert not any(c['slug'] == category for c in facets['categories'])
        for edition, base, _ in editions:
            detail = ok(f'/api/v1/catalog/editions/{edition}')
            assert detail['price'] == base and detail['offer'] is None
        for params in ({'category': category}, {'que': title}):
            results = ok('/api/v1/catalog/editions?' + urllib.parse.urlencode(params))['items']
            assert len(results) == 3 and all(x['offer'] is None for x in results)
            assert {x['price'] for x in results} == {'7.25', '20.00', '30.00'}
        assert ok('/api/v1/cart', auth)['subtotal'] == '37.25'
        assert ok('/api/v1/cart/saved', auth)['items'][0]['currentPrice'] == '20.00'
        assert {x['price'] for x in ok('/api/v1/me/favorites', auth)['items']} == {'7.25', '20.00', '30.00'}

        # Real SSE publisher/read, rather than a synthetic queue/publish call.
        expected = {str(physical), str(ebook), str(audio)}
        seen = set()
        deadline = time.monotonic() + 12
        while seen != expected and time.monotonic() < deadline:
            message = read_event(response)
            if message['event'] == 'catalog.offers.changed':
                payload = json.loads(message['data'])
                assert set(payload) == {'resourceType', 'resourceId'}
                assert payload['resourceType'] == 'edition'
                if payload['resourceId'] in expected:
                    seen.add(payload['resourceId'])
        assert seen == expected, (seen, expected)
        assert query("SELECT last_success_at IS NOT NULL FROM pliego.offer_lifecycle_run WHERE singleton") == 't'
    finally:
        stream.close()
    print('PASS: 8 HTTP/worker/SSE groups: public clock/cache, all media expiry, catalog/search/facets, cart, saved, favorites, preserved history, real scheduler and durable event wire')


if __name__ == '__main__':
    main()
