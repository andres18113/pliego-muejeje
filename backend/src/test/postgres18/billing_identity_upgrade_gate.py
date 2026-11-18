"""Upgrade an empty disposable PG18 database from V079 through V081.

Run after building the current backend jar, with PG* and PLIEGO_DB_* variables
pointing at an empty database. Existing account identities, their immutable
events, invoice snapshots, and digital ownership must survive unchanged.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
import uuid

from checkout_last_unit import query


def start(target):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    log_dir = Path(os.environ.get('PLIEGO_GATE_LOG_DIR', '/tmp'))
    log_dir.mkdir(parents=True, exist_ok=True)
    log = log_dir / f'billing-identity-upgrade-v{target}.backend.log'
    jar = Path(os.environ.get('PLIEGO_UPGRADE_TEST_JAR', str(
        Path(__file__).resolve().parents[3] / 'target/pliego-backend-0.1.0-SNAPSHOT.jar')))
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
    return query(sql).strip().splitlines()[0]


def checkout(actor, address, edition, fulfillment, outcome):
    query(f'CALL pliego.sp_cart_add_item({actor},{edition},1,NULL,NULL,NULL)')
    address_value = 'NULL' if address is None else str(address)
    result = query(f"""CALL pliego.sp_checkout_billed_quoted({actor},'{uuid.uuid4()}',{address_value},
      'TRANSFER','{outcome}',NULL,'{fulfillment}',NULL,NULL,'EC_CEDULA','1710034065',
      'Comprador de migración','Dirección fiscal',NULL,'Quito','Pichincha','EC',
      NULL,NULL,NULL,NULL,NULL,NULL,NULL)""").splitlines()[0].split('|')
    return int(result[0]), int(result[5])


def history(customer_id):
    return json.loads(scalar(f"""SELECT jsonb_build_object(
      'identity',(SELECT to_jsonb(i) FROM pliego.cliente_identificacion i WHERE i.cliente_id={customer_id}),
      'events',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.evento_id),'[]'::jsonb)
        FROM pliego.cliente_identificacion_evento e WHERE e.cliente_id={customer_id}),
      'invoices',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'header',to_jsonb(f)-'destinatario_tipo',
          'items',(SELECT COALESCE(jsonb_agg(to_jsonb(fi) ORDER BY fi.factura_item_id),'[]'::jsonb)
            FROM pliego.factura_item fi WHERE fi.factura_id=f.factura_id),
          'address',(SELECT to_jsonb(fd) FROM pliego.factura_direccion fd WHERE fd.factura_id=f.factura_id))
          ORDER BY f.factura_id),'[]'::jsonb)
        FROM pliego.factura f JOIN pliego.pedido p USING(pedido_id) WHERE p.cliente_id={customer_id}),
      'digital',(SELECT jsonb_build_object(
          'ownership',(SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.owned_item_id),'[]'::jsonb)
            FROM pliego.digital_ownership o WHERE o.cliente_id={customer_id}),
          'grants',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.pedido_item_id),'[]'::jsonb)
            FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id)
            JOIN pliego.pedido p USING(pedido_id) WHERE p.cliente_id={customer_id})))
      )"""))


def prepare_v079_fixture():
    suffix = uuid.uuid4().hex[:12]
    admin = int(scalar(f"""INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
      VALUES('billing-identity-upgrade-admin-{suffix}@pliego.local','fixture-hash','ADMIN','ACTIVE')
      RETURNING usuario_id"""))
    author = int(scalar(f"CALL pliego.sp_author_create({admin},'Autor upgrade {suffix}',NULL,NULL)"))
    publisher = int(scalar(f"CALL pliego.sp_publisher_create({admin},'Editorial upgrade {suffix}',NULL,NULL)"))
    category = int(scalar(f"CALL pliego.sp_category_create({admin},'Categoría upgrade {suffix}','identity-upgrade-{suffix}',NULL,NULL,NULL)"))
    book = int(scalar(f"""CALL pliego.sp_book_create({admin},'Libro upgrade {suffix}',NULL,NULL,
      jsonb_build_array(jsonb_build_object('authorId',{author},'order',1)),jsonb_build_array({category}),NULL)"""))
    physical = int(scalar(f"CALL pliego.sp_edition_create({admin},{book},{publisher},'BILL-UPG-{suffix}',NULL,'es','PAPERBACK',100,NULL,9.50,NULL,NULL,NULL,NULL,NULL)"))
    query(f"CALL pliego.sp_inventory_entry({admin},{physical},12,'identity upgrade fixture',NULL,NULL,NULL)")
    digital = int(scalar(f"""CALL pliego.sp_edition_create({admin},{book},{publisher},'BILL-UPG-EB-{suffix}',NULL,
      'es','EBOOK',100,NULL,8.50,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],NULL)"""))
    customer_result = query(f"""CALL pliego.sp_customer_register('billing-identity-upgrade-{suffix}@pliego.local',
      'fixture-hash','Cliente','Upgrade',NULL,NULL,NULL,NULL)""").splitlines()[0].split('|')
    actor, customer_id = map(int, customer_result[:2])
    address = int(scalar(f"""CALL pliego.sp_address_create({actor},'Casa','Cliente Upgrade','Calle Upgrade',NULL,
      'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,NULL)"""))
    query(f"CALL pliego.sp_customer_billing_identity_register({actor},'EC_CEDULA','0912345675')")
    query(f"CALL pliego.sp_customer_billing_identity_correct({actor},'EC_CEDULA','0912345675','1710034065')")
    issued_order, issued_invoice = checkout(actor, address, physical, 'HOME_DELIVERY', 'APPROVED')
    draft_order, draft_invoice = checkout(actor, address, physical, 'HOME_DELIVERY', 'PENDING')
    digital_order, digital_invoice = checkout(actor, None, digital, 'DIGITAL_ONLY', 'APPROVED')
    assert scalar(f"SELECT estado FROM pliego.factura WHERE factura_id={issued_invoice}") == 'ISSUED'
    assert scalar(f"SELECT estado FROM pliego.factura WHERE factura_id={draft_invoice}") == 'DRAFT'
    assert scalar(f"SELECT count(*) FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.pedido_id={digital_order} AND g.state='ACTIVE'") == '1'
    return customer_id, (issued_order, draft_order, digital_order), (issued_invoice, draft_invoice, digital_invoice)


def main():
    if not all(os.environ.get(key) for key in ('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD')):
        raise SystemExit('Set PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD for an empty disposable PG18 database')
    if not os.environ.get('PLIEGO_DB_URL'):
        raise SystemExit('Set PLIEGO_DB_URL and PLIEGO_DB_USERNAME/PLIEGO_DB_PASSWORD for the same disposable database')
    start(79)
    customer_id, orders, invoices = prepare_v079_fixture()
    before = history(customer_id)
    start(81)
    assert scalar("SELECT max(version)::integer FROM public.flyway_schema_history WHERE success") == '81'
    after = history(customer_id)
    assert after == before, 'V080–V081 changed an existing identity, audit event, invoice, or digital ownership snapshot'
    assert scalar(f"""SELECT count(*) FROM pliego.factura WHERE pedido_id IN ({','.join(map(str,orders))})
      AND destinatario_tipo IS NULL""") == str(len(invoices)), 'historical invoice recipient kind is not NULL'
    print('Billing identity upgrade: Flyway V079→V081 preserved identity, immutable events, ISSUED/DRAFT invoice snapshots, and digital ownership; historical destinatario_tipo remains NULL.')


if __name__ == '__main__':
    main()
