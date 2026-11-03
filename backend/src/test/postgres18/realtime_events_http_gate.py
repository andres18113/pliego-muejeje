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


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1'
    url=urllib.parse.urlsplit(os.environ['CHECKOUT_BASE_URL'])
    assert url.hostname in ('127.0.0.1','localhost')
    actors,_=fixture()
    a,b=[p[0] for p in actors]
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
    print(json.dumps({'cases_passed':10,'cases_total':10,'wire':'real HTTP/SSE','revocation_bound_seconds':8,'concurrent_subscribers':12}))


if __name__=='__main__':main()
