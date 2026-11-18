"""RQ-REG: disposable PG18 quotas, neutral receipts and observed-lock races."""
import hashlib
import os
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor
from checkout_last_unit import PSQL, query, wait_for_activity
from pending_email_change_security_concurrency import start


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def identity():
    seed = uuid.uuid4().hex
    return 'registration-' + seed + '@example.invalid', digest(seed)


def admit(email, ip):
    return f"SELECT pliego.fn_registration_attempt_admit('{email}','{ip}')"


def count(key, column='admitidos'):
    return int(query(f"SELECT COALESCE((SELECT {column} FROM pliego.registro_intento_limite WHERE clave='{key}'),0)"))


def ceilings_and_fixed_expiry():
    email, ip = identity()
    for _ in range(5):
        assert query(admit(email.upper() if _ % 2 else ' ' + email + ' ', ip)) == '0'
    account_key = 'AC:' + digest(email)
    expiry = query(f"SELECT expira FROM pliego.registro_intento_limite WHERE clave='{account_key}'")
    for _ in range(4):
        assert 1 <= int(query(admit(email, digest(ip)))) <= 3600
    assert count(account_key) == 5 and count(account_key, 'solicitudes') == 9
    assert query(f"SELECT expira FROM pliego.registro_intento_limite WHERE clave='{account_key}'") == expiry
    # Denied email floods never exhaust the shared NAT expensive-work budget.
    assert count('IP:' + digest(ip)) == 0
    query(f"UPDATE pliego.registro_intento_limite SET expira=clock_timestamp()-INTERVAL '1 second' WHERE clave='{account_key}'")
    assert query(admit(email, digest(ip))) == '0'
    assert count(account_key) == 1 and count(account_key, 'solicitudes') == 1


def ip_ceiling_and_cardinality():
    email, ip = identity()
    assert query(admit(email, ip)) == '0'
    query(f"UPDATE pliego.registro_intento_limite SET solicitudes=120,admitidos=120 WHERE clave='IP:{ip}'")
    missing, _ = identity()
    assert 1 <= int(query(admit(missing, ip))) <= 3600
    assert count('AC:' + digest(missing), 'solicitudes') == 0, 'denied IP created an account bucket'
    query(f"UPDATE pliego.registro_intento_limite SET expira=clock_timestamp()-INTERVAL '1 second' WHERE clave='IP:{ip}'")
    assert query(admit(missing, ip)) == '0'
    assert count('IP:' + ip) == 1


def concurrent_email_ceiling():
    email, _ = identity()
    with ThreadPoolExecutor(max_workers=12) as workers:
        values = list(workers.map(lambda n: int(query(admit(email, digest(email + str(n))))), range(12)))
    assert values.count(0) == 5 and sum(value > 0 for value in values) == 7, values
    assert count('AC:' + digest(email)) == 5
    assert count('AC:' + digest(email), 'solicitudes') == 12


def concurrent_nat_ceiling():
    email, ip = identity()
    assert query(admit(email, ip)) == '0'
    query(f"UPDATE pliego.registro_intento_limite SET solicitudes=118,admitidos=118 WHERE clave='IP:{ip}'")
    with ThreadPoolExecutor(max_workers=8) as workers:
        values = list(workers.map(lambda n: int(query(admit(str(n) + email, ip))), range(8)))
    assert values.count(0) == 2 and sum(value > 0 for value in values) == 6, values
    assert count('IP:' + ip) == 120


def neutral_duplicate_no_mutation():
    email, _ = identity()
    token, nonce = digest(email), 'A' * 43
    original = query(f"CALL pliego.sp_customer_register_neutral('{email}','fixture-password','Cliente','Registro',NULL,'{token}','{nonce}',NULL,NULL,NULL)")
    actor = int(original.split('|')[0])
    assert actor > 0
    before = query(f"SELECT password_hash,estado,email_verificado_en FROM pliego.usuario WHERE usuario_id={actor}")
    duplicate = query(f"CALL pliego.sp_customer_register_neutral('{email.upper()}','attacker-password','Otro','Nombre',NULL,'{digest(token)}','{'B'*43}',NULL,NULL,NULL)")
    assert duplicate == '0|0|PENDING_VERIFICATION'
    assert query(f"SELECT password_hash,estado,email_verificado_en FROM pliego.usuario WHERE usuario_id={actor}") == before
    assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={actor}") == '1'
    assert query(f"SELECT token_hash FROM pliego.correo_token WHERE usuario_id={actor}") == token
    assert query(f"SELECT count(*) FROM pliego.registro_continuacion WHERE usuario_id={actor}") == '0'


def decoy_is_pending_and_never_authenticates():
    email, ip = identity()
    receipt, refresh = digest(email), digest(ip)
    query(f"SELECT pliego.fn_registration_decoy_issue('{receipt}')")
    exchange = f"SELECT state FROM pliego.fn_registration_session_exchange('{receipt}','{refresh}',clock_timestamp()+INTERVAL '1 day','{ip}')"
    assert query(exchange) == 'PENDING_VERIFICATION'
    query(f"INSERT INTO pliego.registro_continuacion_limite(clave,ventana,solicitudes) VALUES('REG:{receipt}',clock_timestamp(),600) ON CONFLICT(clave) DO UPDATE SET solicitudes=600")
    assert query(exchange) == 'RETRY_LATER'
    query(f"UPDATE pliego.registro_continuacion_limite SET ventana=clock_timestamp()-INTERVAL '2 hours' WHERE clave='REG:{receipt}'")
    assert query(exchange) == 'PENDING_VERIFICATION'
    assert query(f"SELECT count(*) FROM pliego.sesion_autenticacion WHERE token_refresco_hash='{refresh}'") == '0'
    query(f"UPDATE pliego.registro_continuacion_neutral SET expira=clock_timestamp()-INTERVAL '1 second' WHERE token_hash='{receipt}'")
    assert query(exchange) == ''


def cleanup_bounded_and_skip_locked():
    # Isolate expired rows left by preceding cases.
    query('SELECT pliego.fn_registration_attempt_cleanup()')
    seed = uuid.uuid4().hex
    query(f"INSERT INTO pliego.registro_intento_limite(clave,expira,solicitudes,admitidos) SELECT 'IP:'||encode(sha256(convert_to('{seed}'||n,'UTF8')),'hex'),'2000-01-01',1,1 FROM generate_series(1,1005) n")
    assert query('SELECT pliego.fn_registration_attempt_cleanup()') == '1000'
    assert int(query('SELECT pliego.fn_registration_attempt_cleanup()')) == 5
    email, ip = identity()
    query(admit(email, ip))
    holder_name = 'registration-cleanup-' + uuid.uuid4().hex[:8]
    holder = start(f"UPDATE pliego.registro_intento_limite SET expira='2000-01-01' WHERE clave='IP:{ip}'", holder_name, pause=True)
    try:
        wait_for_activity(holder_name, "wait_event='PgSleep'")
        query("SET statement_timeout='1s'; SELECT pliego.fn_registration_attempt_cleanup()")
        out, error = holder.communicate(timeout=15)
        assert holder.returncode == 0, error
        assert count('IP:' + ip) == 1
        assert query('SELECT pliego.fn_registration_attempt_cleanup()') == '1'
        assert count('IP:' + ip) == 0
        receipt = digest(seed)
        query(f"INSERT INTO pliego.registro_continuacion_neutral(token_hash,expira) VALUES('{receipt}','2000-01-01')")
        query('SELECT pliego.fn_registration_decoy_cleanup()')
        assert query(f"SELECT count(*) FROM pliego.registro_continuacion_neutral WHERE token_hash='{receipt}'") == '0'
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.communicate()


def privileges():
    assert query("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='pliego' AND p.proname IN ('fn_registration_attempt_admit','fn_registration_attempt_cleanup','fn_registration_decoy_issue','fn_registration_decoy_cleanup','sp_customer_register_neutral') AND a.grantee=0 AND a.privilege_type='EXECUTE'") == '0'


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1'
    assert os.environ.get('PGHOST') == '127.0.0.1'
    assert int(query('SHOW server_version_num')) >= 180000
    cases = [ceilings_and_fixed_expiry, ip_ceiling_and_cardinality, concurrent_email_ceiling,
             concurrent_nat_ceiling, neutral_duplicate_no_mutation,
             decoy_is_pending_and_never_authenticates, cleanup_bounded_and_skip_locked, privileges]
    for case in cases:
        case()
        print('PASS registration_attempt ' + case.__name__, flush=True)
    print(f'Registration attempt PostgreSQL gate: {len(cases)}/{len(cases)} cases passed')


if __name__ == '__main__':
    main()
