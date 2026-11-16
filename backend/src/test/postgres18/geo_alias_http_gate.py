"""Live HTTP/JDBC proof for official aliases and transitional strict name-only inputs."""
import json
import os
import urllib.error
import urllib.request
import uuid

from checkout_http_gate import token
from checkout_last_unit import fixture, query

base = os.environ['CHECKOUT_BASE_URL'].rstrip('/')


def request(method, path, actor=None, body=None, key=None):
    headers = {'Accept': 'application/json'}
    if actor is not None:
        headers['Authorization'] = 'Bearer ' + token(actor)
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if key is not None:
        headers['Idempotency-Key'] = str(key)
    outgoing = urllib.request.Request(base + path,
        data=None if body is None else json.dumps(body).encode(), method=method, headers=headers)
    try:
        with urllib.request.urlopen(outgoing, timeout=15) as response:
            raw = response.read()
            return response.status, response.headers, json.loads(raw) if raw else None
    except urllib.error.HTTPError as response:
        raw = response.read()
        return response.code, response.headers, json.loads(raw) if raw else None


_, _, provinces = request('GET', '/api/v1/geo/provinces')
guayas = next(row for row in provinces if row['code'] == '09')
pichincha = next(row for row in provinces if row['code'] == '17')
_, headers, guayas_cities = request('GET', f"/api/v1/geo/provinces/{guayas['id']}/cities")
assert headers.get('Cache-Control') == 'public, max-age=86400, stale-while-revalidate=86400', headers
elizalde = next(row for row in guayas_cities if row['code'] == '0927')
villamil = next(row for row in guayas_cities if row['code'] == '0921')
assert {'Bucay', 'General Elizalde', 'General Elizalde (Bucay)'} <= set(elizalde['aliases']), elizalde
assert {'Gral. Villamil', 'Playas', 'Playas (Gral. Villamil)'} <= set(villamil['aliases']), villamil
garaicoa = next(row for row in guayas_cities if row['code'] == '092251')
assert 'Coronel Lorenzo de Garaicoa' in garaicoa['aliases'] and 'Pedregal' in garaicoa['aliases'], garaicoa
assert 'Coronel Lorenzo de Garaicoa (Pedregal)' in garaicoa['aliases'], garaicoa
assert not any(row['name'] in {'Bucay', 'Playas'} for row in guayas_cities), guayas_cities
assert query("SELECT count(*) FROM pliego.ciudad WHERE activo AND search_key IN ('bucay','playas')") == '0'
manabi = next(row for row in provinces if row['code'] == '13')
_, _, manabi_cities = request('GET', f"/api/v1/geo/provinces/{manabi['id']}/cities")
dieza = next(row for row in manabi_cities if row['code'] == '131752')
assert '10 de Agosto' in dieza['aliases'], dieza
morona = next(row for row in provinces if row['code'] == '14')
_, _, morona_cities = request('GET', f"/api/v1/geo/provinces/{morona['id']}/cities")
tuutinentsa = next(row for row in morona_cities if row['code'] == '140953')
assert 'Tuutinentza' in tuutinentsa['aliases'], tuutinentsa

actors, _edition = fixture()
actor, delivery_address = actors[0]

# Old SPA shape resolves exact folded official aliases, then persists catalog IDs and canonical text.
legacy_address = {
    'alias': 'Casa Bucay', 'recipient': 'Cliente Prueba', 'line1': 'Calle de Bucay',
    'city': 'bUcAy', 'province': 'gUaYaS', 'countryCode': 'EC',
    'phone': '+59325550134', 'makePrimary': False,
}
status, _, created = request('POST', '/api/v1/me/addresses', actor, legacy_address, uuid.uuid4())
assert status == 201, created
legacy_address_id = created['addressId']
_, _, listed = request('GET', '/api/v1/me/addresses', actor)
created_row = next(row for row in listed if row['addressId'] == legacy_address_id)
assert (created_row['city'], created_row['province'], created_row['cityId'], created_row['provinceId'],
        created_row['cityNeedsReview']) == ('General Antonio Elizalde', 'Guayas', elizalde['id'], guayas['id'], False), created_row

status, _, _ = request('PUT', f'/api/v1/me/addresses/{legacy_address_id}', actor, {
    'alias': 'Casa Bucay', 'recipient': 'Cliente Prueba', 'line1': 'Calle actualizada',
    'city': 'Playas', 'province': 'Guayas', 'countryCode': 'EC', 'phone': '+59325550134',
})
assert status == 204
_, _, listed = request('GET', '/api/v1/me/addresses', actor)
updated = next(row for row in listed if row['addressId'] == legacy_address_id)
assert (updated['city'], updated['cityId']) == ('General Villamil', villamil['id']), updated

for city, province, expected_code, expected_detail in [
    ('Ciudad que no existe', 'Guayas', 'P5015', 'Elige una ciudad de la lista.'),
    ('La Unión', 'Esmeraldas', 'P5015', 'Elige una ciudad de la lista.'),
    ('Quito', 'Guayas', 'P5014', 'La ciudad no pertenece a la provincia seleccionada.'),
]:
    status, _, problem = request('PUT', f'/api/v1/me/addresses/{legacy_address_id}', actor, {
        'alias': 'Casa Bucay', 'recipient': 'Cliente Prueba', 'line1': 'Calle actualizada',
        'city': city, 'province': province, 'countryCode': 'EC', 'phone': '+59325550134',
    })
    assert status == 400 and problem['code'] == expected_code and problem['detail'] == expected_detail, problem

status, _, validation = request('PUT', f'/api/v1/me/addresses/{legacy_address_id}', actor, {
    'alias': 'Casa Bucay', 'recipient': 'Cliente Prueba', 'line1': 'Calle actualizada',
    'provinceId': guayas['id'], 'cityId': villamil['id'], 'city': 'Playas', 'province': 'Guayas',
    'countryCode': 'EC', 'phone': '+59325550134',
})
assert status == 400 and validation['code'] == 'VALIDATION_ERROR', validation

# A NULL-ID legacy address stays reviewable and still supports HOME_DELIVERY with its old snapshot text.
query(f"UPDATE pliego.direccion SET ciudad='Ciudad no clasificada',provincia='Pichincha',"
      f"provincia_id=NULL,ciudad_id=NULL WHERE direccion_id={delivery_address}")
_, _, listed = request('GET', '/api/v1/me/addresses', actor)
legacy_delivery = next(row for row in listed if row['addressId'] == str(delivery_address))
assert legacy_delivery['cityNeedsReview'] is True and legacy_delivery['cityId'] is None, legacy_delivery

checkout = {
    'addressId': str(delivery_address), 'paymentMethod': 'TRANSFER', 'simulationOutcome': 'APPROVED',
    'billingRecipient': 'OTHER', 'billingIdentity': {'type': 'EC_CEDULA', 'number': '1710034065'},
    'buyerName': 'Comprador tercero',
    'billingAddress': {'line1': 'Calle fiscal', 'provinceId': pichincha['id'], 'cityId': '893', 'countryCode': 'EC'},
}
status, _, order = request('POST', '/api/v1/checkout', actor, checkout, uuid.uuid4())
assert status == 201, order
order_id = int(order['orderId'])
snapshot = query(f"SELECT ciudad||'|'||provincia FROM pliego.pedido_direccion WHERE pedido_id={order_id}")
assert snapshot == 'Ciudad no clasificada|Pichincha', snapshot

unknown_edit = {
    'alias': 'Casa', 'recipient': 'Cliente Prueba', 'line1': 'Calle actualizada',
    'city': 'Ciudad no clasificada', 'province': 'Pichincha', 'countryCode': 'EC', 'phone': '+59325550134',
}
status, _, problem = request('PUT', f'/api/v1/me/addresses/{delivery_address}', actor, unknown_edit)
assert status == 400 and problem['code'] == 'P5015' and problem['detail'] == 'Elige una ciudad de la lista.', problem

catalog_edit = {key: value for key, value in unknown_edit.items() if key not in {'city', 'province'}}
catalog_edit.update({'provinceId': pichincha['id'], 'cityId': '893'})
status, _, _ = request('PUT', f'/api/v1/me/addresses/{delivery_address}', actor, catalog_edit)
assert status == 204
_, _, listed = request('GET', '/api/v1/me/addresses', actor)
repaired = next(row for row in listed if row['addressId'] == str(delivery_address))
assert (repaired['city'], repaired['province'], repaired['cityNeedsReview']) == ('Quito', 'Pichincha', False), repaired

print('PostgreSQL 18 alias HTTP gate passed: aliases resolve without duplicate cities, name-only compatibility is strict, and NULL-ID delivery snapshots survive until catalog edit.')
