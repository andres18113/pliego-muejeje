"""PPA-05: PG18 invariants and observed-lock races, also under strict pliego_app.

No password computation: SQL compositions test Database API invariants/lock races.
The HTTP integration class separately proves independent Spring commits and that
only AP is retained through BCrypt. Every named case prints only on pass.
"""
import hashlib
import os
import subprocess
import uuid
from checkout_last_unit import PSQL, query, wait_for_activity
from pending_email_change_security_concurrency import race, start
from registration_continuation_gate import fixture, verify


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def identity():
    return 'ppa05-' + uuid.uuid4().hex + '@example.invalid', digest(uuid.uuid4().hex)


def key(scope, email, ip):
    return scope + ':' + (digest(digest(email.strip().lower()) + ':' + ip) if scope == 'AP'
                           else ip if scope == 'IP' else digest(email.strip().lower()))


def begin(email, ip):
    # A single SQL test transaction composes the three APIs; no BCrypt occurs here.
    # Consume the reserve result in JSON so its volatile side effect cannot be pruned.
    return f"""SELECT jsonb_build_object('retry',a.retry,'reserved',
        CASE WHEN a.retry=0 THEN pliego.fn_login_attempt_pair_reserve('{email}','{ip}') END)->>'retry'
        FROM (SELECT pliego.fn_login_attempt_admit('{email}','{ip}',
            pliego.fn_login_attempt_pair_begin('{email}','{ip}')) AS retry OFFSET 0) a"""


def success(email, ip):
    return f"SELECT pliego.fn_login_attempt_success('{email}','{ip}')"


def value(email, ip, column='fallos', scope='AP'):
    return query(f"SELECT {column} FROM pliego.login_intento_limite WHERE clave='{key(scope,email,ip)}'")


def burst_and_backoff():
    email, ip = identity()
    for _ in range(5):
        assert query(begin(email, ip)) == '0'
    assert 1 <= int(query(begin(email, ip))) <= 5
    assert value(email, ip) == '5' and value(email, ip, 'solicitudes') == '6'
    deadline = value(email, ip, 'bloqueado_hasta')
    for _ in range(3):
        assert int(query(begin(email, ip))) > 0
    assert value(email, ip, 'bloqueado_hasta') == deadline
    for seconds in (15, 30, 60, 120, 300, 300):
        query(f"UPDATE pliego.login_intento_limite SET bloqueado_hasta=clock_timestamp()-INTERVAL '1 second' WHERE clave='{key('AP',email,ip)}'")
        assert query(begin(email, ip)) == '0'
        assert seconds - 1 <= int(query(begin(email, ip))) <= seconds


def ceilings():
    for scope, ceiling, expiry in [('IP', 600, '10 minutes'), ('AC', 60, '15 minutes')]:
        email, ip = identity()
        assert query(begin(email, ip)) == '0'
        query(f"UPDATE pliego.login_intento_limite SET verificaciones={ceiling} WHERE clave='{key(scope,email,ip)}'")
        assert 1 <= int(query(begin(email, ip))) <= (600 if scope == 'IP' else 900)
        assert value(email, ip, 'solicitudes', scope) == '2'
        assert value(email, ip, 'verificaciones', scope) == str(ceiling)
        # Fixed windows roll over all counters independently of previous traffic.
        query(f"UPDATE pliego.login_intento_limite SET expira=clock_timestamp()-INTERVAL '1 second' WHERE clave='{key(scope,email,ip)}'")
        assert query(begin(email, ip)) == '0'
        assert value(email, ip, 'solicitudes', scope) == '1'
        assert value(email, ip, 'verificaciones', scope) == '1'
        remaining = float(query(f"SELECT EXTRACT(EPOCH FROM expira-clock_timestamp()) FROM pliego.login_intento_limite WHERE clave='{key(scope,email,ip)}'"))
        assert 595 <= remaining <= 900


def parity():
    actor, secret, verification = fixture()
    email = query(f'SELECT email_normalizado FROM pliego.usuario WHERE usuario_id={actor}')
    unknown, ip = identity()
    other = digest(ip)
    for _ in range(5):
        assert query(begin(email.upper(), ip)) == query(begin(unknown, other)) == '0'
    assert 1 <= int(query(begin(email, ip))) <= 5
    assert 1 <= int(query(begin(unknown, other))) <= 5
    for col in ('solicitudes', 'fallos'):
        assert value(email, ip, col) == value(unknown, other, col)
    assert query(f"SELECT count(*) FROM pliego.login_intento_limite WHERE clave LIKE '%{email}%' OR clave LIKE '%{unknown}%'") == '0'


def denied_flood_isolation():
    email, ip = identity()
    for _ in range(5):
        assert query(begin(email, ip)) == '0'
    # Keep time deterministic: no BCrypt and no real cooldown sleeps in this gate.
    query(f"UPDATE pliego.login_intento_limite SET bloqueado_hasta=clock_timestamp()+INTERVAL '5 minutes' WHERE clave='{key('AP',email,ip)}'")
    query(f"""DO $gate$ BEGIN FOR i IN 1..650 LOOP
        IF pliego.fn_login_attempt_admit('{email}','{ip}',pliego.fn_login_attempt_pair_begin('{email}','{ip}'))<=0
        THEN RAISE EXCEPTION 'blocked pair admitted'; END IF;
        END LOOP; END $gate$""")
    assert value(email, ip, 'solicitudes', 'AC') == '655'
    assert value(email, ip, 'verificaciones', 'AC') == '5'
    assert value(email, ip, 'verificaciones', 'IP') == '5'
    assert query(begin(email, digest(ip))) == '0', 'Denied pair requests exhausted account budget'
    other, _ = identity()
    assert query(begin(other, ip)) == '0', 'Denied pair requests exhausted shared IP budget'


def pair_window_and_success():
    email, ip = identity()
    for _ in range(5):
        assert query(begin(email, ip)) == '0'
    query(f"UPDATE pliego.login_intento_limite SET expira=clock_timestamp()-INTERVAL '1 second' WHERE clave='{key('AP',email,ip)}'")
    assert query(begin(email, ip)) == '0' and value(email, ip) == '1'
    query('BEGIN; ' + begin(email, ip) + '; ' + success(email, ip) + '; COMMIT')
    assert value(email, ip) == '0'
    assert value(email, ip, 'bloqueado_hasta IS NULL') == 't'
    assert value(email, ip, 'solicitudes', 'AC') == '7'


def pair_expires_while_admission_waits():
    email, ip = identity()
    row = key('AP', email, ip)
    # Advance only this transaction's test fixture, preserving its already-held AP lock.
    query(f"""BEGIN;
    SELECT pliego.fn_login_attempt_pair_begin('{email}','{ip}');
    UPDATE pliego.login_intento_limite SET expira=clock_timestamp()-INTERVAL '1 second',
      solicitudes=10,fallos=9,bloqueado_hasta=clock_timestamp()-INTERVAL '2 seconds' WHERE clave='{row}';
    SELECT pliego.fn_login_attempt_admit('{email}','{ip}',NULL);
    SELECT pliego.fn_login_attempt_pair_reserve('{email}','{ip}');
    DO $gate$ BEGIN
      IF NOT EXISTS(SELECT FROM pliego.login_intento_limite WHERE clave='{row}'
        AND fallos=1 AND solicitudes=1 AND bloqueado_hasta IS NULL
        AND expira>clock_timestamp()+INTERVAL '14 minutes') THEN
        RAISE EXCEPTION 'admitted failure was charged to expired AP window';
      END IF;
    END $gate$;
    ROLLBACK;""")


def bounded_cleanup():
    tag = uuid.uuid4().hex
    # Own transaction keeps the scheduler from consuming these fixtures.
    query(f"""BEGIN;
    INSERT INTO pliego.login_intento_limite(clave,expira,solicitudes)
      SELECT 'IP:'||encode(sha256(convert_to('{tag}'||n,'UTF8')),'hex'),'2000-01-01',1 FROM generate_series(1,1005) n;
    DO $test$ BEGIN
      IF pliego.fn_login_attempt_cleanup()<>1000 THEN RAISE EXCEPTION 'cleanup batch not bounded'; END IF;
      IF (SELECT count(*) FROM pliego.login_intento_limite WHERE expira='2000-01-01')<>5 THEN RAISE EXCEPTION 'cleanup lost rows'; END IF;
      PERFORM pliego.fn_login_attempt_cleanup();
      IF EXISTS(SELECT FROM pliego.login_intento_limite WHERE expira='2000-01-01') THEN RAISE EXCEPTION 'cleanup did not drain'; END IF;
    END $test$; COMMIT""")


def privileges():
    assert query("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE n.nspname='pliego' AND p.proname LIKE 'fn_login_attempt_%' AND a.grantee=0") == '0'
    assert query("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='pliego' AND c.relname='login_intento_limite' AND a.grantee=0") == '0'
    if os.environ.get('PLIEGO_LOGIN_GATE_STRICT') == '1':
        assert query("SELECT current_user='pliego_app' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls FROM pg_roles WHERE rolname=current_user") == 't'
        assert query("SELECT NOT pg_has_role(current_user,'pliego_owner','MEMBER')") == 't'
        assert query("SELECT NOT has_schema_privilege(current_user,'pliego','CREATE')") == 't'
        assert query("SELECT relowner<>current_user::regrole FROM pg_class WHERE oid='pliego.login_intento_limite'::regclass") == 't'
        assert query("SELECT bool_and(proowner<>current_user::regrole) FROM pg_proc WHERE pronamespace='pliego'::regnamespace AND proname LIKE 'fn_login_attempt_%'") == 't'
    email, ip = identity()
    query(begin(email, ip))
    query(success(email, ip))
    query('SELECT pliego.fn_login_attempt_cleanup()')


def many_ips():
    email, ip = identity()
    holder_name = 'ppa05-holder-' + uuid.uuid4().hex[:8]
    holder = subprocess.Popen(PSQL + ['-At', '-c', 'BEGIN', '-c', begin(email, ip),
                              '-c', 'SELECT pg_sleep(12)', '-c', 'COMMIT'],
                              env={**os.environ, 'PGAPPNAME': holder_name}, text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    workers = []
    try:
        wait_for_activity(holder_name, "wait_event='PgSleep'")
        for n in range(20):
            name = 'ppa05-many-' + uuid.uuid4().hex[:8]
            process = start(begin(email, digest(ip + str(n))), name)
            workers.append(process)
            wait_for_activity(name, "wait_event_type='Lock'")
        out, err = holder.communicate(timeout=15)
        assert holder.returncode == 0, err
        for process in workers:
            out, err = process.communicate(timeout=15)
            assert process.returncode == 0 and '0' in out.splitlines(), err
        assert value(email, ip, 'solicitudes', 'AC') == '21'
        assert value(email, ip, 'verificaciones', 'AC') == '21'
        assert query(f"SELECT count(*) FROM pliego.login_intento_limite WHERE clave IN ({','.join(chr(39)+key('AP',email,digest(ip+str(n)))+chr(39) for n in range(20))}) AND fallos=1") == '20'
    finally:
        for process in [holder] + workers:
            if process.poll() is None:
                process.kill(); process.communicate()


def success_race(success_first):
    email, ip = identity()
    failed = begin(email, ip)
    succeeded = failed + '; ' + success(email, ip)
    code, rows, err = race(succeeded if success_first else failed,
                           failed if success_first else succeeded, 'ppa05-success-' + str(success_first))
    assert code == 0, err
    assert value(email, ip) == ('1' if success_first else '0')
    assert value(email, ip, 'solicitudes', 'AC') == '2'


def auth_lock_race(operation, login_first):
    actor, secret, verification = fixture()
    verify(actor, verification)
    email = query(f'SELECT email_normalizado FROM pliego.usuario WHERE usuario_id={actor}')
    ip = digest(uuid.uuid4().hex)
    refresh = digest(uuid.uuid4().hex)
    assert query(f"SELECT pliego.fn_auth_session_create_checked({actor},'{refresh}',clock_timestamp()+INTERVAL '1 day','fixture-password')") == 't'
    login = (begin(email, ip) + f"; SELECT pliego.fn_auth_session_create_identity_checked({actor},'{digest(refresh)}',clock_timestamp()+INTERVAL '1 day','fixture-password','{email}'); "
             + f'SELECT pliego.fn_registration_session_invalidate({actor},NULL); ' + success(email, ip))
    if operation == 'refresh':
        other = f"SELECT * FROM pliego.fn_auth_session_refresh('{refresh}','{digest(refresh+'replacement')}')"
    else:
        other = f"SELECT * FROM pliego.fn_registration_session_exchange('{digest(secret)}','{digest(refresh+'exchange')}',clock_timestamp()+INTERVAL '1 day','{ip}')"
    if operation == 'refresh':
        # Refresh updates its existing session; password login creates a different
        # session and need not wait. Prove overlap while the first holds real locks.
        name = 'ppa05-refresh-overlap-' + uuid.uuid4().hex[:8]
        first = start(login if login_first else other, name, pause=True)
        second = None
        try:
            wait_for_activity(name, "wait_event='PgSleep'")
            assert int(query(f"SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE a.application_name='{name}' AND l.granted AND l.mode='RowExclusiveLock' AND l.relation='pliego.sesion_autenticacion'::regclass")) > 0
            second = start(other if login_first else login, name + '-second')
            rows, err = second.communicate(timeout=15)
            assert second.returncode == 0, err
            rows, err = first.communicate(timeout=15)
            assert first.returncode == 0, err
        finally:
            for process in (first, second):
                if process is not None and process.poll() is None:
                    process.kill(); process.communicate()
    else:
        code, rows, err = race(login if login_first else other, other if login_first else login,
                               'ppa05-' + operation + '-' + str(login_first))
        assert code == 0, err
    assert value(email, ip) == '0'


def cleanup_skips_locked():
    email, ip = identity()
    query(begin(email, ip))
    row = key('AP', email, ip)
    holder_name = 'ppa05-cleanup-' + uuid.uuid4().hex[:8]
    holder = start(f"UPDATE pliego.login_intento_limite SET expira='2000-01-01' WHERE clave='{row}'", holder_name, pause=True)
    try:
        wait_for_activity(holder_name, "wait_event='PgSleep'")
        # Another expired row is committed; cleanup must not wait on the held tuple.
        query(f"INSERT INTO pliego.login_intento_limite(clave,expira,solicitudes) VALUES('IP:{digest(row)}','2000-01-01',1)")
        query("SET statement_timeout='1s'; SELECT pliego.fn_login_attempt_cleanup()")
        out, err = holder.communicate(timeout=15)
        assert holder.returncode == 0, err
        assert query(f"SELECT count(*) FROM pliego.login_intento_limite WHERE clave='{row}'") == '1'
        query('SELECT pliego.fn_login_attempt_cleanup()')
        assert query(f"SELECT count(*) FROM pliego.login_intento_limite WHERE clave='{row}'") == '0'
    finally:
        if holder.poll() is None:
            holder.kill(); holder.communicate()


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1'
    assert os.environ.get('PGHOST') == '127.0.0.1'
    cases = [('burst_backoff_non_sliding', burst_and_backoff), ('ip_account_ceilings_windows', ceilings),
             ('denied_flood_does_not_lock_other_origins', denied_flood_isolation),
             ('known_unknown_canonical_parity', parity), ('pair_window_success_reset', pair_window_and_success),
             ('pair_rollover_during_short_admission_wait', pair_expires_while_admission_waits),
             ('bounded_cleanup', bounded_cleanup), ('runtime_privileges', privileges),
             ('twenty_ips_atomic_account_budget_observed_lock', many_ips),
             ('failure_then_success', lambda: success_race(False)), ('success_then_failure', lambda: success_race(True)),
             ('cleanup_skips_locked', cleanup_skips_locked)]
    for operation in ('refresh', 'registration'):
        for first in (False, True):
            cases.append((f'{operation}_login_first_{first}', lambda op=operation, f=first: auth_lock_race(op, f)))
    for name, run in cases:
        run()
        print('PASS login_attempt ' + name, flush=True)
    print(f'Login attempt PostgreSQL gate: {len(cases)}/{len(cases)} cases passed', flush=True)


if __name__ == '__main__':
    main()
