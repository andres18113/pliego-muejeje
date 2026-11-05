"""Disposable PG18 continuation invariant and lock-wait races. No mail or production access."""
import hashlib
import json
import os
import secrets
import subprocess
import uuid
from checkout_last_unit import query, PSQL, wait_for_activity
from pending_email_change_security_concurrency import race


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def fixture(path='/cart?source=edition#items'):
    tag=uuid.uuid4().hex
    secret=secrets.token_urlsafe(32)
    verification=digest(tag+'verify')
    actor=int(query(f"CALL pliego.sp_customer_register_with_verification('reg-{tag}@example.invalid','fixture-password','Ana','Pérez',NULL,'{verification}','{'A'*43}',NULL,NULL,NULL)").split('|')[0])
    safe='NULL' if path is None else "'"+path.replace("'","''")+"'"
    query(f"SELECT pliego.fn_registration_session_issue({actor},'{digest(secret)}',{safe})")
    assert query(f"SELECT c.fecha_expiracion<=t.fecha_expiracion FROM pliego.registro_continuacion c JOIN pliego.correo_token t USING(usuario_id) WHERE c.usuario_id={actor} AND t.tipo='VERIFY_EMAIL'")=='t'
    return actor,secret,verification


def exchange_sql(secret,source=None):
    source=source or digest('127.0.0.1')
    return f"SELECT * FROM pliego.fn_registration_session_exchange('{digest(secret)}','{digest(uuid.uuid4().hex)}',clock_timestamp()+INTERVAL '30 days','{source}')"


def state(secret):
    result=query(exchange_sql(secret))
    return result.split('|')[0] if result else None


def verify(actor,verification):
    assert query(f"SELECT pliego.fn_email_action_consume('VERIFY_EMAIL','{verification}',NULL)")=='t'


def sessions(actor):
    return int(query(f'SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id={actor} AND fecha_revocacion IS NULL'))


def verification_exchange_race(verify_first):
    actor,secret,verification=fixture()
    tag=uuid.uuid4().hex[:8]
    lock=(f"SELECT usuario_id FROM pliego.correo_token WHERE usuario_id={actor} AND tipo='VERIFY_EMAIL' FOR UPDATE"
          if verify_first else f'SELECT usuario_id FROM pliego.usuario WHERE usuario_id={actor} FOR UPDATE')
    blocker_name='registration-blocker-'+tag
    blocker=subprocess.Popen(PSQL+['-At','-c','BEGIN','-c',lock,'-c','SELECT pg_sleep(4)','-c','COMMIT'],
        env={**os.environ,'PGAPPNAME':blocker_name},text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    first=second=None
    try:
        wait_for_activity(blocker_name,"wait_event='PgSleep'")
        verification_sql=f"SELECT * FROM pliego.fn_registration_verify_exchange('{verification}','{digest(secret)}','{digest('race-session-'+tag)}',clock_timestamp()+INTERVAL '1 day','{digest('127.0.0.1')}')"
        a,b=(verification_sql,exchange_sql(secret)) if verify_first else (exchange_sql(secret),verification_sql)
        def start(sql,name):
            return subprocess.Popen(PSQL+['-At','-c',sql],env={**os.environ,'PGAPPNAME':name},text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        first_name='registration-first-'+tag
        first=start(a,first_name)
        wait_for_activity(first_name,"wait_event_type='Lock'")
        second_name='registration-second-'+tag
        second=start(b,second_name)
        wait_for_activity(second_name,"wait_event_type='Lock'")
        blocker.communicate(timeout=15)
        output_a,error_a=first.communicate(timeout=15)
        output_b,error_b=second.communicate(timeout=15)
        assert first.returncode==second.returncode==0, 'Verification/exchange lock inversion: '+error_a+error_b
        assert sessions(actor)==1
        assert 'AUTHENTICATED|' in output_a+output_b
        assert ('REFRESH_REQUIRED|' if verify_first else 'PENDING_VERIFICATION|') in output_b+output_a
    finally:
        for process in (second,first,blocker):
            if process is not None and process.poll() is None:
                process.kill();process.communicate()


def quota_and_acl_checks():
    actor,secret,verification=fixture()
    source=digest('quota-'+uuid.uuid4().hex)
    query(f"INSERT INTO pliego.registro_continuacion_limite VALUES('REGIP:{source}',clock_timestamp(),1200)")
    result=query(f"SELECT * FROM pliego.fn_registration_verify_exchange('{verification}','{digest(secret)}','{digest('quota-session-'+str(actor))}',clock_timestamp()+INTERVAL '1 day','{source}')")
    assert result.startswith('VERIFIED|') and sessions(actor)==0
    assert state(secret)=='AUTHENTICATED'
    for bucket,maximum in [('REGIP',1200),('REG',600)]:
        actor,secret,verification=fixture()
        verify(actor,verification)
        source=digest('quota-'+uuid.uuid4().hex)
        key=bucket+':'+(source if bucket=='REGIP' else digest(secret))
        query(f"INSERT INTO pliego.registro_continuacion_limite VALUES('{key}',clock_timestamp(),{maximum})")
        result=query(exchange_sql(secret,source)).split('|')
        assert result[0]=='RETRY_LATER' and 1<=int(result[-1])<=3600 and sessions(actor)==0
        assert query(f"SELECT fecha_uso IS NULL AND sesion_id IS NULL FROM pliego.registro_continuacion WHERE usuario_id={actor}")=='t'
        query(f"UPDATE pliego.registro_continuacion_limite SET ventana=clock_timestamp()-INTERVAL '61 minutes' WHERE clave='{key}'")
        assert query(exchange_sql(secret,source)).startswith('AUTHENTICATED|') and sessions(actor)==1
    assert query("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE n.nspname='pliego' AND p.proname LIKE 'fn_registration_%' AND a.grantee=0")=='0'
    assert query("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='pliego' AND c.relname IN ('registro_continuacion','registro_continuacion_limite') AND a.grantee=0")=='0'


def main():
    assert os.environ.get('PGHOST')=='127.0.0.1' and os.environ.get('PLIEGO_TEST_DISPOSABLE_DB')=='1'
    assert query('SHOW server_version_num').startswith('18')
    actor,secret,verification=fixture()
    assert state(secret)=='PENDING_VERIFICATION' and sessions(actor)==0
    verify(actor,verification)  # Another browser only verifies; the original can still exchange.
    result=query(exchange_sql(secret)).split('|')
    assert result[0]=='AUTHENTICATED' and result[5]=='/cart?source=edition#items' and sessions(actor)==1
    assert state(secret)=='REFRESH_REQUIRED' and sessions(actor)==1
    query(f"UPDATE pliego.registro_continuacion SET fecha_uso=clock_timestamp()-INTERVAL '6 minutes' WHERE usuario_id={actor}")
    assert state(secret) is None and state(secrets.token_urlsafe(32)) is None

    actor,secret,verification=fixture('https://evil.invalid/cart')
    assert query(f'SELECT return_path IS NULL FROM pliego.registro_continuacion WHERE usuario_id={actor}')=='t'
    query(f"UPDATE pliego.registro_continuacion SET fecha_creacion=clock_timestamp()-INTERVAL '2 hours',fecha_expiracion=clock_timestamp()-INTERVAL '1 hour' WHERE usuario_id={actor}")
    verify(actor,verification)
    assert state(secret) is None and sessions(actor)==0

    actor,secret,verification=fixture()
    wrong_actor,wrong_secret,wrong_verification=fixture()
    result=query(f"SELECT * FROM pliego.fn_registration_verify_exchange('{verification}','{digest(wrong_secret)}','{digest('wrong-user-session')}',clock_timestamp()+INTERVAL '1 day','{digest('127.0.0.1')}')")
    assert result.startswith('VERIFIED|') and sessions(actor)==sessions(wrong_actor)==0
    assert state(secret)=='AUTHENTICATED' and state(wrong_secret)=='PENDING_VERIFICATION'

    actor,secret,verification=fixture('/checkout')
    result=query(f"SELECT * FROM pliego.fn_registration_verify_exchange('{verification}','{digest(secret)}','{digest('same-browser-'+str(actor))}',clock_timestamp()+INTERVAL '1 day','{digest('127.0.0.1')}')")
    assert result.startswith('AUTHENTICATED|') and result.split('|')[5]=='/checkout' and sessions(actor)==1
    assert query(f"SELECT pliego.fn_email_action_consume('VERIFY_EMAIL','{verification}',NULL)")=='f'
    query(f"SELECT pliego.fn_email_action_enqueue({actor},'RESET_PASSWORD','{digest(str(actor)+'reset')}','{'B'*43}')")
    # Reset with exactly the same password hash must still invalidate continuity.
    assert query(f"SELECT pliego.fn_email_action_consume('RESET_PASSWORD','{digest(str(actor)+'reset')}','fixture-password')")=='t'
    assert state(secret) is None and sessions(actor)==0

    for field,value in [('password_hash',"'changed-fixture-password'"),('email_normalizado',"'changed-"+uuid.uuid4().hex+"@example.invalid'"),('estado',"'BLOCKED'")]:
        actor,secret,verification=fixture()
        verify(actor,verification)
        query(f'UPDATE pliego.usuario SET {field}={value} WHERE usuario_id={actor}')
        assert state(secret) is None and sessions(actor)==0

    actor,secret,verification=fixture()
    verify(actor,verification)
    code,rows,error=race(exchange_sql(secret),exchange_sql(secret),'registration-exchange')
    assert code==0 and any(row.startswith('REFRESH_REQUIRED|') for row in rows), (rows,error)
    assert sessions(actor)==1

    actor,secret,verification=fixture()
    verify(actor,verification)
    code,rows,error=race(f"UPDATE pliego.usuario SET password_hash='fenced-fixture-password' WHERE usuario_id={actor}",exchange_sql(secret),'registration-password-fence')
    assert code==0 and not any(row.startswith('AUTHENTICATED|') for row in rows), (rows,error)
    assert sessions(actor)==0

    actor,secret,verification=fixture()
    verify(actor,verification)
    code,rows,error=race(exchange_sql(secret),f"UPDATE pliego.usuario SET password_hash='fenced-fixture-password' WHERE usuario_id={actor}",'registration-exchange-first')
    assert code==0 and state(secret) is None
    # Password change invalidates continuation; normal password-update routines separately revoke sessions.

    for first_exchange in (False,True):
        actor,secret,verification=fixture()
        verify(actor,verification)
        revoke=f'SELECT pliego.fn_auth_session_revoke_all({actor})'
        first,second=(exchange_sql(secret),revoke) if first_exchange else (revoke,exchange_sql(secret))
        code,rows,error=race(first,second,'registration-revoke-all-'+str(first_exchange))
        assert code==0 and state(secret) is None and sessions(actor)==0, (rows,error)

    verification_exchange_race(True)
    verification_exchange_race(False)

    quota_and_acl_checks()

    print('Registration continuation PG18 PASS: pending/no access, verify other device, same-device atomic exchange, mismatched user, one-family replay, expiry/tampering/consumption, safe return path, reset/email/password/disable fencing, quotas/PUBLIC ACL, seven observed-lock races including revoke-all and verification/exchange both orderings')


if __name__=='__main__':
    main()
