"""Real startup/Flyway 73→75 (ADR 0040, 0041): a cédula stored under V071 survives, is audited once as
MIGRATION, cannot be removed or overwritten, and stays correctable. A number that passed the V071 checksum but
not the full algorithm (province 00) is kept readable and can only be corrected to a fully valid one.
Requires an EMPTY disposable PostgreSQL database and the current built backend jar.
"""
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
from checkout_last_unit import query


def start(target):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    log = Path(f'/tmp/pliego-identity-upgrade-{target}.log')
    jar = Path(os.environ.get('PLIEGO_UPGRADE_TEST_JAR', str(Path(__file__).resolve().parents[3] / 'target/pliego-backend-0.1.0-SNAPSHOT.jar')))
    with log.open('w') as stream:
        process = subprocess.Popen(['java', '-jar', str(jar), '--server.address=127.0.0.1',
            f'--server.port={port}', f'--spring.flyway.target={target}', '--pliego.billing.enabled=false',
            '--pliego.mail.enabled=false', '--pliego.home-delivery.scheduler-enabled=false'],
            env=os.environ.copy(), stdout=stream, stderr=stream)
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f'Upgrade startup failed; inspect {log}')
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/v3/api-docs', timeout=2) as response:
                if response.status == 200:
                    process.terminate()
                    process.wait(timeout=20)
                    return
        except OSError:
            pass
        time.sleep(.1)
    process.terminate()
    process.wait(timeout=20)
    raise AssertionError(f'Upgrade startup timeout; inspect {log}')


def scalar(sql):
    return query(sql).strip()


start(73)
user = scalar("""DO $$ DECLARE u BIGINT; c BIGINT; s VARCHAR; BEGIN
 CALL pliego.sp_customer_register('identity-upgrade@pliego.local','fixture-hash','Cliente','Previo',NULL,u,c,s);
 CALL pliego.sp_customer_billing_identity_set(u,'EC_CEDULA','0012345674');
END $$; SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='identity-upgrade@pliego.local'""").splitlines()[-1]

start(75)
assert scalar("SELECT max(version)::integer FROM public.flyway_schema_history WHERE success") == "75"
assert scalar(f"SELECT identity_type||'|'||identity_number FROM pliego.fn_customer_billing_identity({user})") == "EC_CEDULA|0012345674"
assert scalar("""SELECT count(*) FROM pliego.cliente_identificacion_evento e JOIN pliego.cliente c USING(cliente_id)
 JOIN pliego.usuario u ON u.usuario_id=c.usuario_id WHERE u.email_normalizado='identity-upgrade@pliego.local'
 AND e.accion='REGISTERED' AND e.origen='MIGRATION' AND e.numero_nuevo='0012345674'""") == "1"
assert scalar(f"""DO $$ BEGIN
 BEGIN CALL pliego.sp_customer_billing_identity_register({user},'EC_CEDULA','0012345674'); RAISE EXCEPTION 'legacy re-registered';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 BEGIN CALL pliego.sp_customer_billing_identity_register({user},'EC_CEDULA','1710034065'); RAISE EXCEPTION 'overwrite';
 EXCEPTION WHEN SQLSTATE 'P1105' THEN NULL; END;
 BEGIN DELETE FROM pliego.cliente_identificacion; RAISE EXCEPTION 'removed';
 EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
 BEGIN CALL pliego.sp_customer_billing_identity_correct({user},'EC_CEDULA','0012345674','0012345674'); RAISE EXCEPTION 'no-op';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN NULL; END;
 CALL pliego.sp_customer_billing_identity_correct({user},'EC_RUC','0012345674','1790016919001');
END $$; SELECT identity_type||'|'||identity_number FROM pliego.fn_customer_billing_identity({user})""").splitlines()[-1] == "EC_RUC|1790016919001"
assert scalar(f"""SELECT count(*) FROM pliego.cliente_identificacion_evento e JOIN pliego.cliente c USING(cliente_id)
 WHERE c.usuario_id={user} AND e.accion='CORRECTED' AND e.identidad_tipo_anterior='EC_CEDULA' AND e.numero_anterior='0012345674'
 AND e.identidad_tipo='EC_RUC' AND e.numero_nuevo='1790016919001'""") == "1"
print("Billing identity upgrade: Flyway73→75, legacy cédula audited as MIGRATION, kept readable, not removable or overwritable, correctable to a RUC.")
