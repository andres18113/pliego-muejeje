"""Real PostgreSQL/JDBC ownership and digital/mixed checkout contract regression."""
import json
import os
import uuid
import urllib.error
import urllib.request
from digital_editions_http_gate import ok, problem
from full_journey_http_gate import admin_token
from checkout_last_unit import query
from email_verification_fixture import verify_registered_email


def checkout(token, body, key):
    req = urllib.request.Request(os.environ['CHECKOUT_BASE_URL'].rstrip('/')+'/api/v1/checkout',
        data=json.dumps(body).encode(), method='POST', headers={'Authorization': token,
        'Content-Type': 'application/json', 'Idempotency-Key': key})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as response:
        return response.code, json.load(response)


def main():
    schemas=ok('/v3/api-docs',None)['components']['schemas']
    assert schemas['CustomerOrderDetail']['properties']['items']['items']['$ref'].endswith('/CustomerOrderItem')
    assert 'requiresPhysicalFulfillment' in schemas['CustomerOrderItem']['required']
    assert 'requiresPhysicalFulfillment' not in schemas['Item'].get('properties',{})
    suffix=uuid.uuid4().hex[:12]
    query(f"INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('lib-admin-{suffix}@example.invalid','fixture','ADMIN','ACTIVE')")
    actor=int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='lib-admin-{suffix}@example.invalid'"))
    admin=admin_token(actor)
    author=ok('/api/v1/admin/authors',admin,'POST',{'name':'Autora '+suffix,'biography':None},201)['authorId']
    pub=ok('/api/v1/admin/publishers',admin,'POST',{'name':'Editorial '+suffix,'description':None},201)['publisherId']
    category=ok('/api/v1/admin/categories',admin,'POST',{'name':'Biblioteca '+suffix,'slug':'lib-'+suffix,'description':None,'parentCategoryId':None},201)['categoryId']
    book=ok('/api/v1/admin/books',admin,'POST',{'title':'Biblioteca '+suffix,'subtitle':None,'synopsis':'Fixture digital.',
        'authors':[{'authorId':author,'order':1}],'categoryIds':[category]},201)['bookId']
    editions={}
    for media in ['EBOOK','AUDIOBOOK','PAPERBACK']:
        payload={'bookId':book,'publisherId':pub,'sku':f'LIB-{media}-{suffix}','isbn13':None,'language':'es',
            'format':media,'pageCount':100 if media=='PAPERBACK' else None,'publicationDate':None,'price':'10.00',
            'coverUrl':None,'coverLicense':None,'coverSourceUrl':None,'coverAttribution':None}
        if media=='EBOOK': payload['ebookFileFormat']='EPUB'
        if media=='AUDIOBOOK': payload.update(audioDurationSeconds=3600,narrators=['Voz Biblioteca'])
        editions[media]=ok('/api/v1/admin/editions',admin,'POST',payload,201)['editionId']
    query(f"CALL pliego.sp_inventory_entry({actor},{editions['PAPERBACK']},5,'Library fixture',NULL,NULL,NULL)")
    users=[]
    for label in ['owner','other']:
        email=f'lib-{label}-{suffix}@example.invalid'; password='Library-fixture-1'
        ok('/api/v1/auth/register',None,'POST',{'email':email,'password':password,'firstNames':'Cliente','lastNames':'Biblioteca'},201)
        verify_registered_email(email,os.environ['CHECKOUT_BASE_URL'])
        users.append((email,password,'Bearer '+ok('/api/v1/auth/login',None,'POST',{'email':email,'password':password})['accessToken']))
    email,password,customer=users[0]; other=users[1][2]
    ok('/api/v1/me/library',None,expected=401)
    ok('/api/v1/me/library',admin,expected=403)
    assert ok('/api/v1/me/library',customer)['items']==[]
    ok('/api/v1/cart/items',customer,'POST',{'editionId':editions['EBOOK'],'quantity':1})
    cart=ok('/api/v1/cart',customer)
    assert cart['requiresPhysicalFulfillment'] is False and cart['physicalItemCount']==0 and cart['digitalItemCount']==1
    assert cart['items'][0]['requiresPhysicalFulfillment'] is False and cart['items'][0]['quantityEditable'] is False
    body={'fulfillmentMethod':'DIGITAL_ONLY','paymentMethod':'TRANSFER','simulationOutcome':'APPROVED','expectedCartId':cart['cartId']}
    key=str(uuid.uuid4()); status,order=checkout(customer,body,key); assert status==201,(status,order)
    status,retry=checkout(customer,body,key); assert status==201 and retry==order
    status,conflict=checkout(customer,{**body,'simulationOutcome':'REJECTED'},key); assert status==409 and conflict['code']=='P1010'
    detail=ok('/api/v1/orders/'+order['orderId'],customer)
    assert detail['address'] is None and detail['fulfillment'] is None and detail['shipment'] is None
    assert all(line['requiresPhysicalFulfillment'] is False for line in detail['items'])
    admin_detail=ok('/api/v1/admin/orders/'+order['orderId'],admin)
    assert admin_detail['address'] is None and admin_detail['fulfillment'] is None and admin_detail['shipment'] is None
    owned=ok('/api/v1/me/library?productType=EBOOK',customer)['items'][0]
    assert owned['editionId']==editions['EBOOK'] and owned['ownershipState']=='OWNED' and owned['accessState']=='OWNERSHIP_ONLY'
    assert owned['contentAccessSupported'] is False and [a['type'] for a in owned['availableActions']]==['VIEW_ORDER','HELP']
    assert owned['sourcePurchases'][0]['orderId']==order['orderId'] and len(owned['sourcePurchases'])==1
    assert ok('/api/v1/me/library/'+owned['ownedItemId'],customer)==owned
    problem('/api/v1/me/library/'+owned['ownedItemId'],other,'GET',None,'P6001',404)
    assert ok('/api/v1/me/library',other)['items']==[]
    problem('/api/v1/me/library?productType=PHYSICAL',customer,'GET',None,'VALIDATION_ERROR')
    assert ok('/api/v1/me/library?page=100',customer)['totalCount']=='1'
    # Cancel/refund revokes only this source and retains detail/history.
    ok('/api/v1/orders/'+order['orderId']+'/cancel',customer,'POST',{},200)
    revoked=ok('/api/v1/me/library/'+owned['ownedItemId'],customer)
    assert revoked['ownershipState']=='REVOKED' and revoked['sourcePurchases'][0]['grantState']=='REVOKED'
    ok('/api/v1/cart/items',customer,'POST',{'editionId':editions['EBOOK'],'quantity':1})
    status,rejected=checkout(customer,{'fulfillmentMethod':'DIGITAL_ONLY','paymentMethod':'TRANSFER','simulationOutcome':'REJECTED'},str(uuid.uuid4()))
    assert status==201 and rejected['paymentState']=='REJECTED'
    assert ok('/api/v1/me/library/'+owned['ownedItemId'],customer)['ownershipState']=='REVOKED'
    # Rejected checkout leaves the cart active; add audiobook+physical and purchase one mixed order.
    ok('/api/v1/cart/items',customer,'POST',{'editionId':editions['AUDIOBOOK'],'quantity':1})
    ok('/api/v1/cart/items',customer,'POST',{'editionId':editions['PAPERBACK'],'quantity':1})
    cart=ok('/api/v1/cart',customer); assert cart['requiresPhysicalFulfillment'] and cart['physicalItemCount']==1 and cart['digitalItemCount']==2
    physical_cart=[line for line in cart['items'] if line['requiresPhysicalFulfillment']]
    assert len(physical_cart)==1 and physical_cart[0]['editionId']==editions['PAPERBACK'] and physical_cart[0]['quantityEditable'] is True
    assert all(line['quantityEditable'] is False for line in cart['items'] if not line['requiresPhysicalFulfillment'])
    address=ok('/api/v1/me/addresses',customer,'POST',{'alias':'Casa','recipient':'Cliente Biblioteca','line1':'Calle Biblioteca',
        'line2':None,'city':'Quito','province':'Pichincha','countryCode':'EC','postalCode':None,'reference':None,'phone':'+59325550134','makePrimary':True},201)['addressId']
    status,mixed=checkout(customer,{'fulfillmentMethod':'HOME_DELIVERY','addressId':address,'paymentMethod':'TRANSFER','simulationOutcome':'APPROVED'},str(uuid.uuid4()))
    assert status==201,(status,mixed)
    mixed_detail=ok('/api/v1/orders/'+mixed['orderId'],customer)
    assert len(mixed_detail['items'])==3 and mixed_detail['shipment'] is not None and mixed_detail['address'] is not None
    physical_snapshot=[line for line in mixed_detail['items'] if line['requiresPhysicalFulfillment']]
    assert len(physical_snapshot)==1 and physical_snapshot[0]['editionId']==editions['PAPERBACK']
    assert query(f"SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id={mixed['orderId']} AND tipo='SALE'")=='1'
    library=ok('/api/v1/me/library',customer); assert library['totalCount']=='2' and all(i['ownershipState']=='OWNED' for i in library['items'])
    assert len(ok('/api/v1/me/library/'+owned['ownedItemId'],customer)['sourcePurchases'])==2
    audio=ok('/api/v1/me/library?productType=AUDIOBOOK',customer)['items'][0]
    assert audio['metadata']['audioDurationSeconds']==3600 and audio['metadata']['narrators']==['Voz Biblioteca']
    query(f"UPDATE pliego.edicion SET estado='INACTIVE' WHERE edicion_id={editions['AUDIOBOOK']}")
    assert ok('/api/v1/me/library/'+audio['ownedItemId'],customer)['ownershipState']=='OWNED'
    if os.environ.get('PLIEGO_LIBRARY_FIXTURE_PATH'):
        path=os.environ['PLIEGO_LIBRARY_FIXTURE_PATH']; fd=os.open(path,os.O_CREAT|os.O_TRUNC|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as output:
            json.dump({'email':email,'password':password,'ebookOwnedItemId':owned['ownedItemId'],'audioOwnedItemId':audio['ownedItemId'],
                'ebookEditionId':editions['EBOOK'],'audioEditionId':editions['AUDIOBOOK'],'digitalOrderId':order['orderId'],'mixedOrderId':mixed['orderId']},output)
    print('Library checkout HTTP passed: digital-only/mixed snapshots, authoritative cart requirements, retry/conflict, isolation, ownership metadata, rejected/refunded access and inactive edition.')

if __name__=='__main__': main()
