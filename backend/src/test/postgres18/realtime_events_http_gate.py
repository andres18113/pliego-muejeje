"""Real HTTP SSE cookie authorization, wire framing, isolation, replay and revocation."""
import concurrent.futures
import hashlib
import http.client
import json
import os
import time
import urllib.parse
import uuid
from checkout_last_unit import query, fixture
from admin_orders_http_gate import token


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1'
    url=urllib.parse.urlsplit(os.environ['CHECKOUT_BASE_URL'])
    assert url.hostname in ('127.0.0.1','localhost')
    actors,_=fixture()
    a,address=actors[0]
    b,_=actors[1]
    admin=int(query(f"INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('realtime-http-admin-{uuid.uuid4().hex}@example.invalid','fixture-hash','ADMIN','ACTIVE') RETURNING usuario_id").splitlines()[0])
    secrets={}
    for actor in (a,b,admin):
        import base64
        secret=base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=')
        digest=hashlib.sha256(secret.encode()).hexdigest()
        assert query(f"UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id={actor}; SELECT pliego.fn_auth_session_create_checked({actor},'{digest}',clock_timestamp()+interval '1 day','fixture-hash')").splitlines()[-1]=='t'
        secrets[actor]=(secret,digest)
    def open_stream(actor=None,cursor=None):
        connection=http.client.HTTPConnection(url.hostname,url.port,timeout=20)
        headers={'Accept':'text/event-stream'}
        if actor: headers['Cookie']='pliego_session='+secrets[actor][0]
        if cursor is not None:headers['Last-Event-ID']=str(cursor)
        connection.request('GET','/api/v1/auth/events',headers=headers)
        return connection,connection.getresponse()
    def event(response):
        fields={}
        while True:
            line=response.readline().decode().strip()
            if not line:
                if 'event' in fields:return fields
                if response.isclosed():return None
                fields={}
            elif ':' in line:
                key,value=line.split(':',1)
                fields[key]=value.lstrip()
    c,r=open_stream()
    assert r.status==401 and r.getheader('Content-Type').startswith('application/problem+json')
    c.close()
    streams=[]
    for actor in (a,b,admin):
        c,r=open_stream(actor)
        assert r.status==200
        assert r.getheader('Cache-Control')=='no-cache' and r.getheader('X-Accel-Buffering')=='no'
        first=r.readline().decode().strip()
        assert first=='retry:3000',first
        assert ':heartbeat' in r.readline().decode()
        initial=event(r)
        assert initial['event']=='resync'
        streams.append((c,r,initial['id']))
    query(f"SELECT pliego.fn_realtime_enqueue({a},false,'order.changed','order','90001'); SELECT pliego.fn_realtime_enqueue({b},false,'order.changed','order','90002'); SELECT pliego.fn_realtime_enqueue(NULL,true,'order.changed','order','90003'); SELECT pliego.fn_realtime_publish(1000)")
    for (c,r,_),expected in zip(streams,('90001','90002','90003')):
        message=event(r)
        assert message['event']=='order.changed'
        assert json.loads(message['data'])=={'resourceType':'order','resourceId':expected}
    # A fresh HTTP connection resumes only A's committed hints from initial cursor.
    c,r=open_stream(a,streams[0][2])
    replay=event(r)
    assert json.loads(replay['data'])['resourceId']=='90001'
    c.close()
    # A public ADMIN decision must reach streams that were already open before
    # the request existed. No synthetic enqueue or manual publisher invocation
    # can substitute for the correction trigger and scheduled committed sweep.
    def rest(path,actor,role='CUSTOMER',method='GET',body=None):
        connection=http.client.HTTPConnection(url.hostname,url.port,timeout=15)
        headers={'Authorization':'Bearer '+token(actor,role)}
        data=None
        if body is not None:
            data=json.dumps(body).encode()
            headers['Content-Type']='application/json'
        if method=='POST':headers['Idempotency-Key']=str(uuid.uuid4())
        try:
            connection.request(method,path,body=data,headers=headers)
            response=connection.getresponse()
            payload=response.read()
            return response.status,json.loads(payload) if payload else None
        finally:connection.close()

    def identity_event(stream,name,request_id):
        connection,response,_=stream
        deadline=time.monotonic()+12
        try:
            while time.monotonic()<deadline:
                connection.sock.settimeout(max(0.1,deadline-time.monotonic()))
                message=event(response)
                assert message is not None,f'stream closed before {name}'
                if message['event']!=name:continue
                payload=json.loads(message['data'])
                if payload.get('resourceId')!=request_id:continue
                assert payload=={'resourceType':'billingIdentity','resourceId':request_id}
                assert int(message['id'])>int(stream[2])
                return
        except TimeoutError as error:
            raise AssertionError(f'preopened stream did not receive {name}') from error
        raise AssertionError(f'preopened stream did not receive {name}')

    query(f"CALL pliego.sp_customer_billing_identity_register({a},'EC_CEDULA','0912345675')")
    query(f"""CALL pliego.sp_checkout_billed_quoted({a},'{uuid.uuid4()}',{address},'TRANSFER','PENDING',NULL,
      'HOME_DELIVERY',NULL,NULL,'EC_CEDULA','0912345675','Comprador SSE','Fiscal SSE',NULL,
      'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)""")
    status,created=rest('/api/v1/me/billing-identity/correction-requests',a,method='POST',body={
        'type':'EC_CEDULA','currentNumber':'0912345675','number':'1710034065','reasonCode':'DOCUMENT_TYPO'})
    assert status==201 and created['status']=='PENDING',(status,created)
    request_id=created['id']
    for stream in (streams[0],streams[2]):identity_event(stream,'identity.correction.created',request_id)
    status,approved=rest(f'/api/v1/admin/billing-identity-corrections/{request_id}/decision',admin,'ADMIN','POST',{'decision':'APPROVE'})
    assert status==200 and approved['status']=='APPROVED' and approved['decidedBy']==str(admin),(status,approved)
    for stream in (streams[0],streams[2]):identity_event(stream,'identity.correction.decided',request_id)
    status,identity=rest('/api/v1/me/billing-identity',a)
    assert status==200 and identity['number']=='1710034065',(status,identity)
    assert identity['correctionRequest']['id']==request_id and identity['correctionRequest']['status']=='APPROVED'
    # Revocation closes an already-open stream on the next poll, and refuses reconnect.
    query(f"SELECT pliego.fn_auth_session_revoke('{secrets[b][1]}')")
    deadline=time.monotonic()+8
    while streams[1][1].readline() and time.monotonic()<deadline:pass
    assert time.monotonic()<deadline
    c,r=open_stream(b)
    assert r.status==401
    c.close()
    # Exercise actual concurrent HTTP subscribers (distinct authenticated users).
    many=[]
    for index in range(12):
        email=f'realtime-many-{uuid.uuid4().hex}@example.invalid'
        row=query(f"CALL pliego.sp_customer_register('{email}','fixture-hash','Cliente','Eventos',NULL,NULL,NULL,NULL)")
        actor=int(row.split('|')[0])
        import base64
        secret=base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=')
        digest=hashlib.sha256(secret.encode()).hexdigest()
        query(f"UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id={actor}; SELECT pliego.fn_auth_session_create_checked({actor},'{digest}',clock_timestamp()+interval '1 day','fixture-hash')")
        secrets[actor]=(secret,digest)
        many.append(actor)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        opened=list(pool.map(open_stream,many))
    for c,r in opened:
        assert r.status==200 and event(r)['event']=='resync'
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda actor:query(f"SELECT pliego.fn_realtime_enqueue({actor},false,'order.changed','order','{actor}')"),many))
    query('SELECT pliego.fn_realtime_publish(1000)')
    for (c,r),actor in zip(opened,many):
        assert json.loads(event(r)['data'])['resourceId']==str(actor)
    # Periodic heartbeat is observed over real HTTP, not only initial framing.
    started=time.monotonic()
    while ':heartbeat' not in opened[0][1].readline().decode():
        assert time.monotonic()-started<18
    assert time.monotonic()-started<18
    for c,r in opened:c.close()
    for c,r,_ in streams:c.close()
    print(json.dumps({'cases_passed':11,'cases_total':11,'wire':'real HTTP/SSE','revocation_bound_seconds':8,'concurrent_subscribers':12,
        'public_admin_approval_to_preopened_customer_and_admin_streams':True}))


if __name__=='__main__':main()
