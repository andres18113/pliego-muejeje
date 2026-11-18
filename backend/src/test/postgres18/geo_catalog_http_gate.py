"""Live HTTP/JDBC proof for public geo reads and catalog-backed address inputs."""
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


status, headers, provinces = request('GET','/api/v1/geo/provinces')
assert status == 200 and len(provinces) == 24, (status,provinces)
assert headers.get('Cache-Control') == 'public, max-age=86400, stale-while-revalidate=86400', headers
assert 'ETag' not in headers
pichincha = next(row for row in provinces if row['code'] == '17')
assert pichincha['name'] == 'Pichincha'
assert any(row['name'] == 'Santo Domingo de los Tsáchilas' for row in provinces)

status, headers, cities = request('GET',f"/api/v1/geo/provinces/{pichincha['id']}/cities")
assert status == 200 and headers.get('Cache-Control') == 'public, max-age=86400, stale-while-revalidate=86400'
assert 'ETag' not in headers
quito = next(row for row in cities if row['code'] == '1701')
sangolqui = next(row for row in cities if row['code'] == '1705')
conocoto = next(row for row in cities if row['code'] == '170156')
el_quinche = next(row for row in cities if row['code'] == '170160')
assert (quito['name'],quito['kind'],quito['cantonName']) == (
    'Quito','CABECERA_CANTONAL','Distrito Metropolitano de Quito')
assert sangolqui['name'] == 'Sangolquí' and sangolqui['kind'] == 'CABECERA_CANTONAL'
assert conocoto['name'] == 'Conocoto' and conocoto['kind'] == 'PARROQUIA_RURAL'
assert el_quinche['name'] == 'El Quinche' and el_quinche['kind'] == 'PARROQUIA_RURAL'
assert cities.index(conocoto) < cities.index(quito), 'Cities must use alphabetical Spanish ordering, without seat promotion.'
guayas = next(row for row in provinces if row['code'] == '09')
_, _, guayas_cities = request('GET',f"/api/v1/geo/provinces/{guayas['id']}/cities")
assert any(row['code'] == '0901' and row['name'] == 'Guayaquil' for row in guayas_cities)

santo_domingo = next(row for row in provinces if row['code'] == '23')
_, _, santo_domingo_cities = request('GET',f"/api/v1/geo/provinces/{santo_domingo['id']}/cities")
assert len(santo_domingo_cities) == 12, len(santo_domingo_cities)
la_concordia = next(row for row in santo_domingo_cities if row['code'] == '2302')
assert (la_concordia['name'],la_concordia['kind'],la_concordia['cantonName']) == (
    'La Concordia','CABECERA_CANTONAL','La Concordia')
for code,name in [('230251','Monterrey'),('230252','La Villegas'),('230253','Plan Piloto')]:
    city = next(row for row in santo_domingo_cities if row['code'] == code)
    assert (city['name'],city['kind'],city['cantonName']) == (
        name,'PARROQUIA_RURAL','La Concordia')
morona_santiago = next(row for row in provinces if row['code'] == '14')
_, _, morona_cities = request('GET',f"/api/v1/geo/provinces/{morona_santiago['id']}/cities")
sevilla_don_bosco = next(row for row in morona_cities if row['code'] == '1413')
assert (sevilla_don_bosco['name'],sevilla_don_bosco['kind'],sevilla_don_bosco['cantonName']) == (
    'Sevilla Don Bosco','CABECERA_CANTONAL','Sevilla Don Bosco')
sinaí_cuchaentza = next(row for row in morona_cities if row['code'] == '140190')
assert (sinaí_cuchaentza['name'],sinaí_cuchaentza['kind'],sinaí_cuchaentza['cantonName']) == (
    'Sinaí-Cuchaentza','PARROQUIA_RURAL','Morona')

alias_expectations = {
    '05': [('050751','Chucchilán (Chugchilán)'),('050752','Isinlibí (Isinliví)')],
    '07': [('0714','Las Lajas')],
    '09': [('092251','Coronel Lorenzo de Garaicoa (Pedregal)'),
          ('0923','Coronel Marcelino Maridueña (San Carlos)'),
          ('0927','General Elizalde (Bucay)'),('0928','Isidro Ayora (Soledad)'),
          ('0925','Piedrahita (Nobol)'),('0921','Playas (Gral. Villamil)')],
    '11': [('1116','Olmedo (Santa Bárbara)'),('1114','Pindal (Federico Páez)'),
          ('1115','Quilanga (La Paz)')],
    '12': [('1201','Barreiro (Santa Rita)')],
    '14': [('140852','San Carlos de Limón (San Carlos del Zamora)')],
    '15': [('1509','Carlos Julio Arosemena Tola (Zatza-Yacu)')],
}
for province_code, expectations in alias_expectations.items():
    province = next(row for row in provinces if row['code'] == province_code)
    _, _, rows = request('GET',f"/api/v1/geo/provinces/{province['id']}/cities")
    assert len({row['code'] for row in rows}) == len(rows), province_code
    for code,alias in expectations:
        city = next(row for row in rows if row['code'] == code)
        assert alias in city['aliases'], (code,alias,city)

# Create, read and update a saved address through the real PostgreSQL routine.
actors, _ = fixture()
actor, existing_address = actors[0]
address_body = {
    'alias':'Geográfica', 'recipient':'Cliente Prueba', 'line1':'Calle catalogada', 'line2':None,
    'provinceId':pichincha['id'], 'cityId':quito['id'], 'countryCode':'EC',
    'postalCode':None, 'reference':None, 'phone':'+59325550134', 'makePrimary':False,
}
status, _, created = request('POST','/api/v1/me/addresses',actor,address_body,uuid.uuid4())
assert status == 201, created
address_id = created['addressId']
status, _, listed = request('GET','/api/v1/me/addresses',actor)
row = next(item for item in listed if item['addressId'] == address_id)
assert (row['city'],row['province'],row['cityId'],row['provinceId'],row['cityNeedsReview']) == (
    'Quito','Pichincha',quito['id'],pichincha['id'],False), row

update_body = {key:value for key,value in address_body.items() if key != 'makePrimary'}
status, _, problem = request('PUT',f'/api/v1/me/addresses/{address_id}',actor,
    {**update_body,'cityId':guayas_cities[0]['id']})
assert status == 400 and problem['code'] == 'P5014'
assert problem['detail'] == 'La ciudad no pertenece a la provincia seleccionada.'
status, _, problem = request('PUT',f'/api/v1/me/addresses/{address_id}',actor,
    {**update_body,'cityId':'999999999'})
assert status == 400 and problem['code'] == 'P5015'
assert problem['detail'] == 'Elige una ciudad de la lista.'
status, _, none = request('PUT',f'/api/v1/me/addresses/{address_id}',actor,
    {**update_body,'cityId':conocoto['id']})
assert status == 204, none
status, _, listed = request('GET','/api/v1/me/addresses',actor)
row = next(item for item in listed if item['addressId'] == address_id)
assert (row['city'],row['province'],row['cityId'],row['provinceId'],row['cityNeedsReview']) == (
    'Conocoto','Pichincha',conocoto['id'],pichincha['id'],False), row

# OTHER checkout uses the same province/city ID pair and snapshots catalog names only.
checkout = {
    'addressId':str(existing_address), 'paymentMethod':'TRANSFER','simulationOutcome':'PENDING',
    'billingRecipient':'OTHER','billingIdentity':{'type':'EC_CEDULA','number':'1710034065'},
    'buyerName':'Comprador tercero',
    'billingAddress':{'line1':'Calle fiscal','line2':None,'provinceId':pichincha['id'],'cityId':quito['id'],
                      'countryCode':'EC','postalCode':None},
}
status, _, result = request('POST','/api/v1/checkout',actor,checkout,uuid.uuid4())
assert status == 201, result
order_id = int(result['orderId'])
assert query(f"SELECT ciudad||'|'||provincia FROM pliego.factura_direccion d JOIN pliego.factura f USING(factura_id) WHERE f.pedido_id={order_id}") == 'Quito|Pichincha'
assert query(f"SELECT count(*) FROM pliego.fn_customer_billing_identity({actor})") == '0'

print('PostgreSQL 18 geo HTTP gate passed: cacheable public reads, Spanish city order, catalog-backed addresses, stable pair errors, and OTHER checkout snapshot.')
