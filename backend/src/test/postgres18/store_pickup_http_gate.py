"""Live REST/JDBC contract including authoritative monetary amounts; no external mail."""
import json
import os
import re
import urllib.error
import urllib.request
import uuid
from checkout_last_unit import fixture, query
from checkout_http_gate import token
from full_journey_http_gate import admin_token


def request(path, actor=None, method='GET', body=None, key=None, admin=False):
    headers={'Content-Type':'application/json'}
    if actor is not None:
        headers['Authorization']='Bearer '+(admin_token(actor).removeprefix('Bearer ') if admin else token(actor))
    if key:
        headers['Idempotency-Key']=key
    req=urllib.request.Request(os.environ['CHECKOUT_BASE_URL']+path,method=method,
        data=None if body is None else json.dumps(body).encode(),headers=headers)
    try:
        response=urllib.request.urlopen(req,timeout=15)
    except urllib.error.HTTPError as error:
        response=error
    data=response.read()
    return response.status,json.loads(data) if data else None


def main():
    status, locations=request('/api/v1/pickup-locations')
    assert status==200 and locations
    location=next(p for p in locations if 'PUCE' in p['name'])
    assert location['active'] and location['preparationMinutes']==25
    assert location['latitude']==-.21 and location['longitude']==-78.4914
    assert location['openingHours']=={'opensAt':'09:00:00','closesAt':'17:00:00'}
    actors, _=fixture()
    actor, address=actors[0]
    status, cart=request('/api/v1/cart',actor)
    assert status==200
    assert {name:cart[name] for name in ['subtotal','taxRate','taxAmount','shippingAmount','total']} == {
        'subtotal':'7.25','taxRate':'15.00','taxAmount':'1.09','shippingAmount':'0.00','total':'8.34'}
    key=str(uuid.uuid4())
    body={'fulfillmentMethod':'STORE_PICKUP','pickupLocationId':location['id'],'paymentMethod':'TRANSFER','simulationOutcome':'APPROVED'}
    for changes in [{'addressId':str(address)}, {'pickupLocationId':None}, {'fulfillmentMethod':'HOME_DELIVERY'}]:
        status, _=request('/api/v1/checkout',actor,'POST',{**body,**changes},str(uuid.uuid4()))
        assert status==400
    status, problem=request('/api/v1/checkout',actor,'POST',{**body,'pickupLocationId':'9223372036854775807'},str(uuid.uuid4()))
    assert status==404 and problem['code']=='P5010'
    status, checkout=request('/api/v1/checkout',actor,'POST',body,key)
    assert status==201 and checkout['total']=='8.34' and checkout['taxAmount']=='1.09'
    assert checkout['fulfillment']['method']=='STORE_PICKUP'
    pickup=checkout['fulfillment']['pickup']
    assert pickup['location']==location and re.fullmatch(r'P-[2-9A-HJ-NP-Z]{6,8}',pickup['pickupCode'])
    oid=checkout['orderId']
    status, detail=request('/api/v1/orders/'+oid,actor)
    assert status==200 and detail['address'] is None and detail['shipment'] is None
    assert detail['fulfillment']['state']=='PENDING' and detail['fulfillment']['pickup']==pickup
    status, page=request('/api/v1/orders',actor)
    summary=next(o for o in page['items'] if o['orderId']==oid)
    assert summary['fulfillmentMethod']=='STORE_PICKUP' and summary['shipmentState'] is None and summary['total']=='8.34'
    assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{oid}'")=='1'
    query(f"UPDATE pliego.ubicacion_retiro SET activo=FALSE WHERE ubicacion_retiro_id={location['id']}")
    try:
        assert request('/api/v1/checkout',actor,'POST',body,key)==(201,checkout)
        assert request('/api/v1/orders/'+oid,actor)[1]['fulfillment']['pickup']==pickup
        # Fresh checkout against inactive pickup must fail, even though old replay still succeeds.
        actor2, _=actors[1]
        status, problem=request('/api/v1/checkout',actor2,'POST',body,str(uuid.uuid4()))
        assert status==409 and problem['code']=='P5011'
    finally:
        query(f"UPDATE pliego.ubicacion_retiro SET activo=TRUE WHERE ubicacion_retiro_id={location['id']}")
    admin=int(query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' ORDER BY usuario_id LIMIT 1"))
    status, admin_detail=request('/api/v1/admin/orders/'+oid,admin,admin=True)
    assert status==200 and admin_detail['address'] is None and admin_detail['taxAmount']=='1.09'
    path=f'/api/v1/admin/orders/{oid}/pickup/collect'
    status, problem=request(f'/api/v1/admin/orders/{oid}/transitions',admin,'POST',{'targetState':'PREPARING'},admin=True)
    assert status==409 and problem['code']=='P5002', 'Legacy admin transition bypassed pickup collection'
    assert request(path,actor,'POST',{'pickupCode':pickup['pickupCode']})[0]==403
    assert request(path,admin,'POST',{'pickupCode':pickup['pickupCode']},admin=True)[0]==204
    assert request(path,admin,'POST',{'pickupCode':pickup['pickupCode']},admin=True)[0]==204
    assert request('/api/v1/orders/'+oid,actor)[1]['fulfillment']['state']=='COLLECTED'
    assert request('/api/v1/checkout',actor,'POST',body,key)==(201,checkout)
    print('STORE_PICKUP HTTP passed: public coordinates/hours, inputs, quote/checkout/order totals, history/replay, collection authorization')


if __name__=='__main__':
    main()
