from pathlib import Path
import json,sys,collections,urllib.parse,subprocess,os
root=Path('/home/andres18123/PLIEGO');sys.path.insert(0,str(root/'scripts'))
import publish_digital_editions as publication
from cover_catalog import read_manifest
api=publication.flow.PliegoApi('http://127.0.0.1:8080')
admin=publication.private_env(Path('/home/andres18123/.config/pliego/digital-admin.env'))
api.login(admin['PLIEGO_ADMIN_EMAIL'],admin['PLIEGO_ADMIN_PASSWORD'])
items=publication.load_batch(root);wanted={x['seed'].sku for x in items}
admin_rows=api.all_pages('/api/v1/admin/editions');by_sku={x['sku']:x for x in admin_rows}
public_rows=api.all_pages('/api/v1/catalog/editions',sort='TITLE_ASC');by_id={x['editionId']:x for x in public_rows}
assert len(public_rows)==314
for fmt,count in [('EBOOK',142),('AUDIOBOOK',117)]:
 filtered=api.all_pages('/api/v1/catalog/editions',format=fmt,sort='TITLE_ASC')
 assert len(filtered)==count and all(x['format']==fmt and x['available'] for x in filtered)
print('API format filters PASS:142 EBOOK+117 AUDIOBOOK; public catalog314.',flush=True)
checks=[]
for index,item in enumerate(items,1):
 seed=item['seed'];row=by_sku[seed.sku];assert row['stockActual'] is None
 detail=api.request('GET','/api/v1/catalog/editions/'+row['editionId'])
 assert detail['sku']==seed.sku and detail['format']==seed.format and detail['price']==seed.price
 assert detail['coverUrl']==seed.cover_url and detail['available']
 assert detail['audioDurationSeconds']==seed.audio_duration_seconds and detail['narrators']==list(seed.narrators)
 search=api.all_pages('/api/v1/catalog/editions',query=seed.title,format=seed.format)
 assert row['editionId'] in {x['editionId'] for x in search}
 assert by_id[row['editionId']]['coverUrl']==seed.cover_url and by_id[row['editionId']]['available']
 checks.append({'sku':seed.sku,'editionId':row['editionId'],'format':seed.format,'detail':True,'search':True,'available':True,'stockActual':None,'CDN_url':seed.cover_url})
 if index%50==0:print('Detail/search/availability verified',index,'/259',flush=True)
assert not any(x.get('sku')=='PLG-BK-000042' for x in admin_rows)
cfg=publication.private_env(Path('/home/andres18123/.config/pliego/digital-cart-gate.env'))
customer=publication.flow.PliegoApi('http://127.0.0.1:8080');login=customer.request('POST','/api/v1/auth/login',{'email':cfg['PLIEGO_CUSTOMER_EMAIL'],'password':cfg['PLIEGO_CUSTOMER_PASSWORD']});assert login['user']['role']=='CUSTOMER';customer.token=login['accessToken']
cart=customer.request('GET','/api/v1/cart');assert cart['items']==[]
cartchecks=[]
for index,item in enumerate(items,1):
 seed=item['seed'];edition=by_sku[seed.sku]
 result=customer.request('POST','/api/v1/cart/items',{'editionId':edition['editionId'],'quantity':1})
 cart=customer.request('GET','/api/v1/cart');line=next(x for x in cart['items'] if x['editionId']==edition['editionId'])
 assert line['sku']==seed.sku and line['quantity']==1 and line['available'] and line['unavailabilityReason'] is None
 assert line['format']==seed.format and line['currentPrice']==seed.price and line['coverUrl']==seed.cover_url
 assert cart['estimatedDeliveryFrom'] is None and cart['estimatedDeliveryTo'] is None
 if index in [1,143]:
  try:customer.request('PUT','/api/v1/cart/items/'+line['cartItemId'],{'quantity':2})
  except publication.flow.ApiError as error:assert 'P4004' in str(error) or 'CART_QUANTITY_INVALID' in str(error)
  else:raise AssertionError('Digital quantity2 accepted')
  current=customer.request('GET','/api/v1/cart');assert current['items'][0]['quantity']==1
 customer.request('DELETE','/api/v1/cart/items/'+line['cartItemId'])
 cartchecks.append({'sku':seed.sku,'format':seed.format,'add_quantity1':True,'available':True,'price_exact':True,'removed':True})
 if index%50==0:print('Cart verified and cleaned',index,'/259',flush=True)
assert customer.request('GET','/api/v1/cart')['items']==[]
config=publication.private_env(root/'.local-db/backend.env');u=urllib.parse.urlsplit(config['PLIEGO_DB_URL'].removeprefix('jdbc:'));env={**os.environ,'PGHOST':u.hostname,'PGPORT':str(u.port or 5432),'PGDATABASE':u.path.lstrip('/'),'PGUSER':config['PLIEGO_DB_USERNAME'],'PGPASSWORD':config['PLIEGO_DB_PASSWORD'],'PGOPTIONS':'-c default_transaction_read_only=on'}
sql="BEGIN READ ONLY; SELECT json_build_object('digital_count',(SELECT count(*) FROM pliego.edicion WHERE formato IN ('EBOOK','AUDIOBOOK')),'ebook_count',(SELECT count(*) FROM pliego.edicion WHERE formato='EBOOK'),'audio_count',(SELECT count(*) FROM pliego.edicion WHERE formato='AUDIOBOOK'),'digital_inventory_rows',(SELECT count(*) FROM pliego.inventario i JOIN pliego.edicion e USING(edicion_id) WHERE e.formato IN ('EBOOK','AUDIOBOOK')),'reserved42_rows',(SELECT count(*) FROM pliego.edicion WHERE sku='PLG-BK-000042')); COMMIT;"
check=subprocess.run(['psql','-X','-At','-v','ON_ERROR_STOP=1','-c',sql],env=env,capture_output=True,text=True);assert check.returncode==0,check.stderr
result=json.loads(next(x for x in check.stdout.splitlines() if x.startswith('{')));assert result=={'digital_count':259,'ebook_count':142,'audio_count':117,'digital_inventory_rows':0,'reserved42_rows':0}
audit=root/'docs/audit/digital-publication-2026-10-04';(audit/'api-verification.json').write_text(json.dumps({'public_total':314,'details_search_availability_checked':259,'EBOOK':142,'AUDIOBOOK':117,'records':checks,'cart_checks':cartchecks,'cart_final_empty':True,'database_readonly':result},ensure_ascii=False,indent=2)+'\n')
print('PASS API details/search/filters/availability/cart/CDN URLs for259; no digital inventory; cart cleaned.',flush=True)
