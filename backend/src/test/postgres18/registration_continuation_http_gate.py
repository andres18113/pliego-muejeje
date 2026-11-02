"""Real loopback HTTP + JDBC gate for browser registration continuity; prints no credentials."""
import concurrent.futures
import hashlib
import json
import os
import secrets
import urllib.error
import urllib.request
from checkout_last_unit import query
from email_verification_fixture import verification_token

BASE=os.environ.get('PLIEGO_TEST_API_BASE_URL',os.environ.get('CHECKOUT_BASE_URL','http://127.0.0.1:18096'))
MARKER={'X-PLIEGO-SESSION-REQUEST':'1'}


def request(path,body=None,cookies=None,marker=True,access=None,forwarded=None):
    headers={'Content-Type':'application/json',**(MARKER if marker else {})}
    if forwarded:headers['X-Forwarded-For']=forwarded
    if cookies:headers['Cookie']='; '.join(cookies)
    if access:headers['Authorization']='Bearer '+access
    req=urllib.request.Request(BASE+path,method='POST' if access is None else 'GET',
        data=None if body is None else json.dumps(body).encode(),headers=headers)
    try:response=urllib.request.urlopen(req,timeout=15)
    except urllib.error.HTTPError as error:response=error
    raw=response.read()
    return response.status,json.loads(raw) if raw else None,response.headers.get_all('Set-Cookie',[])


def cookie(headers,name):
    matches=[header for header in headers if header.startswith(name+'=') and 'Max-Age=0' not in header]
    assert len(matches)==1, 'Expected exactly one live cookie'
    return matches[0].split(';',1)[0]


def register(path='/checkout'):
    email='reg-http-'+secrets.token_hex(10)+'@example.invalid'
    password=secrets.token_urlsafe(20)
    status,body,headers=request('/api/v1/auth/register',{'email':email,'password':password,
        'firstNames':'Ana','lastNames':'Pérez','returnTo':path})
    assert status==201 and body['state']=='PENDING_VERIFICATION' and 'accessToken' not in body
    continuation=cookie(headers,'pliego_registration')
    assert len(continuation.split('=',1)[1])==43
    header=[h for h in headers if h.startswith('pliego_registration=')][0]
    assert all(value in header for value in ('HttpOnly','Secure','SameSite=Strict','Path=/api/v1/auth'))
    assert 'Domain=' not in header
    max_age=int(header.split('Max-Age=')[1].split(';')[0])
    assert 0<max_age<=86400
    stored_hash=hashlib.sha256(continuation.split('=',1)[1].encode()).hexdigest()
    assert query(f"SELECT token_hash='{stored_hash}' FROM pliego.registro_continuacion WHERE usuario_id={int(body['userId'])}")=='t'
    return email,password,int(body['userId']),continuation,verification_token(email)


def count(actor):
    return query(f'SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor}')


def exchange(continuation,marker=True,forwarded=None):
    return request('/api/v1/auth/registration-session',cookies=[continuation],marker=marker,forwarded=forwarded)


def verify(token,continuation=None,marker=True):
    return request('/api/v1/auth/verify-email',{'token':token},[continuation] if continuation else None,marker)


def quota_checks():
    ip='198.51.100.71'
    for bucket,maximum in [('REGIP',1200),('REG',600)]:
        _,_,actor,continuation,token=register()
        assert verify(token)[0]==204
        secret=continuation.split('=',1)[1]
        key=bucket+':'+hashlib.sha256((ip if bucket=='REGIP' else secret).encode()).hexdigest()
        query(f"INSERT INTO pliego.registro_continuacion_limite VALUES('{key}',clock_timestamp(),{maximum}) ON CONFLICT(clave) DO UPDATE SET ventana=clock_timestamp(),solicitudes={maximum}")
        try:
            status,body,headers=exchange(continuation,forwarded=ip)
            assert (status,body,headers)==(202,{'state':'RETRY_LATER'},[]) and count(actor)=='0'
            assert query(f"SELECT fecha_uso IS NULL AND sesion_id IS NULL FROM pliego.registro_continuacion WHERE usuario_id={actor}")=='t'
            query(f"UPDATE pliego.registro_continuacion_limite SET ventana=clock_timestamp()-INTERVAL '61 minutes' WHERE clave='{key}'")
            assert exchange(continuation,forwarded=ip)[0]==200 and count(actor)=='1'
        finally:
            query(f"DELETE FROM pliego.registro_continuacion_limite WHERE clave='{key}'")
    _,_,actor,continuation,token=register()
    key='REGIP:'+hashlib.sha256(b'127.0.0.1').hexdigest()
    query(f"INSERT INTO pliego.registro_continuacion_limite VALUES('{key}',clock_timestamp(),1200) ON CONFLICT(clave) DO UPDATE SET ventana=clock_timestamp(),solicitudes=1200")
    try:
        assert verify(token,continuation)==(204,None,[]) and count(actor)=='0'
        assert exchange(continuation)==(202,{'state':'RETRY_LATER'},[])
        query(f"UPDATE pliego.registro_continuacion_limite SET ventana=clock_timestamp()-INTERVAL '61 minutes' WHERE clave='{key}'")
        assert exchange(continuation)[0]==200 and count(actor)=='1'
    finally:
        query(f"DELETE FROM pliego.registro_continuacion_limite WHERE clave='{key}'")


def main():
    assert os.environ.get('PGHOST')=='127.0.0.1' and os.environ.get('PLIEGO_TEST_DISPOSABLE_DB')=='1'
    assert BASE.startswith('http://127.0.0.1:')
    email,password,actor,continuation,token=register('/cart?source=edition#items')
    assert exchange(continuation)[0:2]==(202,{'state':'PENDING_VERIFICATION'}) and count(actor)=='0'
    assert exchange(continuation,False)[0]==403
    assert verify(token,continuation,False)[0]==403
    assert request('/api/v1/auth/login',{'email':email,'password':password})[0]==403
    status,body,headers=verify(token,continuation)
    assert status==200 and body['returnTo']=='/cart?source=edition#items' and body['user']['userId']==str(actor)
    session=cookie(headers,'pliego_session')
    assert any(h.startswith('pliego_registration=') and 'Max-Age=0' in h for h in headers)
    assert request('/api/v1/me',access=body['accessToken'])[0]==200 and count(actor)=='1'
    assert verify(token,continuation)[0]==400
    assert exchange(continuation)[0:2]==(202,{'state':'REFRESH_REQUIRED'})
    assert request('/api/v1/auth/refresh',cookies=[session])[0]==200

    email,password,actor,continuation,token=register('/checkout')
    status,body,headers=verify(token)
    assert status==204 and body is None and not headers and count(actor)=='0'
    status,body,headers=exchange(continuation)
    assert status==200 and body['returnTo']=='/checkout' and count(actor)=='1'

    _,_,actor,continuation,token=register()
    _,_,other,wrong_cookie,wrong_token=register()
    assert verify(token,wrong_cookie)[0]==204 and count(actor)==count(other)=='0'
    assert exchange(continuation)[0]==200 and exchange(wrong_cookie)[0]==202

    _,_,actor,continuation,token=register('https://evil.invalid/checkout')
    assert verify(token,continuation)[1]['returnTo'] is None

    _,_,actor,continuation,token=register()
    assert verify('X'*43,continuation)[0]==400
    query(f"UPDATE pliego.registro_continuacion SET fecha_creacion=clock_timestamp()-INTERVAL '2 hours',fecha_expiracion=clock_timestamp()-INTERVAL '1 hour' WHERE usuario_id={actor}")
    status,body,headers=exchange(continuation)
    assert status==204 and body is None and any('Max-Age=0' in h for h in headers)
    assert count(actor)=='0' and verify(token)[0]==204
    assert exchange('pliego_registration='+secrets.token_urlsafe(32))[0]==204
    assert exchange('pliego_registration=bad')[0]==204

    _,_,actor,continuation,token=register()
    assert verify(token)[0]==204
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(exchange,[continuation,continuation]))
    assert sorted(r[0] for r in responses)==[200,202] and count(actor)=='1'
    winner=next(r for r in responses if r[0]==200)
    session=cookie(winner[2],'pliego_session')
    assert request('/api/v1/auth/refresh',cookies=[session])[0]==200
    query(f"UPDATE pliego.registro_continuacion SET fecha_uso=clock_timestamp()-INTERVAL '6 minutes' WHERE usuario_id={actor}")
    assert exchange(continuation)[0]==204

    email,password,actor,continuation,token=register()
    assert verify(token)[0]==204
    status,body,headers=request('/api/v1/auth/login',{'email':email,'password':password})
    assert status==200 and any(h.startswith('pliego_registration=') and 'Max-Age=0' in h for h in headers)
    assert exchange(continuation)[0]==204

    _,_,actor,continuation,token=register()
    assert request('/api/v1/auth/logout',cookies=[continuation])[0]==204
    assert verify(token)[0]==204 and exchange(continuation)[0]==204 and count(actor)=='0'

    quota_checks()
    print('Registration continuation HTTP/JDBC PASS: secure cookie and hash-only persistence, pending, CSRF marker, same-browser200, other-browser204 then original200, user mismatch, invalid/reused/expired/tampered, safe returnTo, concurrent tabs one family+refresh, password login/logout clearing; 3 quota scenarios (IP/credential RETRY_LATER without Set-Cookie then successful reset, IP-limited verification204 retaining continuation)')


if __name__=='__main__':main()
