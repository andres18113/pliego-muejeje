"""Normal Flyway 66→67 on a disposable PG18 DB; preserve 15% history and stale-quote safety."""
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
import uuid

from checkout_last_unit import PSQL, query


def start(target):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    log = Path(f'/tmp/pliego-ecuador-tax-upgrade-{target}.log')
    jar = Path(os.environ.get('PLIEGO_UPGRADE_TEST_JAR', str(
        Path(__file__).resolve().parents[3] / 'target/pliego-backend-0.1.0-SNAPSHOT.jar')))
    with log.open('w') as stream:
        process = subprocess.Popen(['java', '-jar', str(jar), '--server.address=127.0.0.1',
            f'--server.port={port}', f'--spring.flyway.target={target}'],
            env={**os.environ, 'PLIEGO_MAIL_ENABLED': 'false',
                 'PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED': 'false'}, stdout=stream, stderr=stream)
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f'Upgrade backend startup failed; inspect {log}')
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/v3/api-docs', timeout=2) as response:
                if response.status == 200:
                    return process
        except OSError:
            pass
        time.sleep(.1)
    process.terminate()
    process.wait(timeout=20)
    raise AssertionError('Upgrade backend did not start')


def fixture():
    suffix = uuid.uuid4().hex[:12]
    query(f"""
    DO $fixture$
    DECLARE a BIGINT; author_id BIGINT; pub BIGINT; cat BIGINT; book BIGINT; edition BIGINT;
      u BIGINT; customer BIGINT; state VARCHAR; cart BIGINT; item BIGINT; qty INTEGER;
      movement BIGINT; before_stock INTEGER; after_stock INTEGER; n INTEGER; offer BIGINT; line RECORD;
    BEGIN
      INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
      VALUES('ecuador-upgrade-admin-{suffix}@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
      CALL pliego.sp_author_create(a,'Autora tributaria',NULL,author_id);
      CALL pliego.sp_publisher_create(a,'Editorial tributaria',NULL,pub);
      CALL pliego.sp_category_create(a,'Tributaria','ecuador-upgrade-{suffix}',NULL,NULL,cat);
      CALL pliego.sp_book_create(a,'Libro tributario',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(cat),book);
      FOR n IN 1..3 LOOP
        CALL pliego.sp_edition_create(a,book,pub,('EC-UPGRADE-{suffix}-'||n)::VARCHAR,NULL,'es',
          CASE n WHEN 1 THEN 'PAPERBACK' WHEN 2 THEN 'EBOOK' ELSE 'AUDIOBOOK' END,
          CASE WHEN n=1 THEN 100 ELSE NULL END,NULL,
          CASE n WHEN 1 THEN 10.00 WHEN 2 THEN 5.00 ELSE 7.00 END,NULL,NULL,NULL,NULL,NULL,
          CASE WHEN n=3 THEN 3600 ELSE NULL END,CASE WHEN n=3 THEN ARRAY['Narradora tributaria'] ELSE NULL END,edition);
        IF n=1 THEN CALL pliego.sp_inventory_entry(a,edition,10,'fixture',movement,before_stock,after_stock); END IF;
        CALL pliego.sp_edition_offer_set(a,edition,CASE n WHEN 1 THEN 8.00 WHEN 2 THEN 4.00 ELSE 6.00 END,
          statement_timestamp()-INTERVAL '1 day',statement_timestamp()+INTERVAL '1 day',offer);
      END LOOP;
      FOR n IN 1..3 LOOP
        CALL pliego.sp_customer_register(('ecuador-upgrade-'||n||'-{suffix}@example.invalid')::VARCHAR,
          'fixture','Cliente','Tributario',NULL,u,customer,state);
        FOR line IN SELECT edicion_id,formato FROM pliego.edicion WHERE libro_id=book ORDER BY edicion_id LOOP
          CALL pliego.sp_cart_add_item(u,line.edicion_id,CASE WHEN line.formato='PAPERBACK' THEN 2 ELSE 1 END,cart,item,qty);
        END LOOP;
      END LOOP;
    END $fixture$;
    """)
    admin = int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='ecuador-upgrade-admin-{suffix}@example.invalid'"))
    actors = [int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='ecuador-upgrade-{n}-{suffix}@example.invalid'")) for n in (1, 2, 3)]
    return admin, actors


def quote(actor):
    return json.loads(query(f'SELECT to_jsonb(q) FROM pliego.fn_cart_checkout_quote({actor}) q'))


def command(actor, accepted, key, location):
    return (f"CALL pliego.sp_checkout_quoted({actor},'{key}',NULL,'TRANSFER','APPROVED',"
            f"{accepted['cart_id']},'STORE_PICKUP',{location},'{accepted['quote_fingerprint']}',NULL,NULL,NULL,NULL,NULL)")


def immutable_snapshot(order, key, actor):
    return json.loads(query(f"""SELECT jsonb_build_object(
      'order',(SELECT to_jsonb(p) FROM pliego.pedido p WHERE pedido_id={order}),
      'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY pedido_item_id) FROM pliego.pedido_item l WHERE pedido_id={order}),
      'payment',(SELECT to_jsonb(p) FROM pliego.pago p WHERE pedido_id={order}),
      'receipt',(SELECT to_jsonb(r) FROM pliego.checkout_attempt r WHERE actor_user_id={actor} AND attempt_key='{key}'),
      'mail',(SELECT datos FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{order}'))"""))


def issue_invoice(admin, order, number):
    query(f"CALL pliego.sp_invoice_issue({admin},{order},'{number}','Cliente Tributario','OTHER','fixture',"
          "'ecuador-upgrade@example.invalid','Fiscal',NULL,'Quito','Pichincha','EC',NULL,NULL)")


def main():
    old = start(66)
    try:
        admin, actors = fixture()
        location = query('SELECT pickup_location_id FROM pliego.fn_pickup_locations() LIMIT 1')
        receipts = []
        for actor in actors[:2]:
            accepted = quote(actor)
            assert accepted['subtotal'] == 26 and accepted['tax_rate'] == 15
            assert accepted['tax_amount'] == 3.90 and accepted['total'] == 29.90
            key = str(uuid.uuid4())
            sql = command(actor, accepted, key, location)
            result = query(sql).splitlines()[0].split('|')
            assert result[3] == '29.90'
            order = int(result[0])
            receipts.append((actor, order, sql, immutable_snapshot(order, key, actor)))
        issue_invoice(admin, receipts[0][1], 'EC-UPGRADE-EARLY')
        old_invoice = query(f'SELECT to_jsonb(i) FROM pliego.factura i WHERE pedido_id={receipts[0][1]}')
        open_quote = quote(actors[2])
    finally:
        old.terminate()
        old.wait(timeout=20)

    new = start(67)
    try:
        assert query('SELECT count(*)||\':\'||max(version)::integer FROM public.flyway_schema_history WHERE success AND version IS NOT NULL') == '67:67'
        for actor, order, sql, snapshot in receipts:
            assert query(sql).splitlines()[0].split('|')[3] == '29.90'
            key = snapshot['receipt']['attempt_key']
            assert immutable_snapshot(order, key, actor) == snapshot
        assert query(f'SELECT to_jsonb(i) FROM pliego.factura i WHERE pedido_id={receipts[0][1]}') == old_invoice
        issue_invoice(admin, receipts[1][1], 'EC-UPGRADE-LATE')
        for _, order, _, _ in receipts:
            assert query(f"SELECT impuesto_tasa||':'||impuesto_total||':'||total FROM pliego.factura WHERE pedido_id={order}") == '15.0000:3.90:29.90'
            assert query(f"SELECT count(*) FROM pliego.factura_item fi JOIN pliego.factura f USING(factura_id) WHERE f.pedido_id={order} AND fi.tratamiento_impuesto<>'ASSESSED'") == '0'

        current = quote(actors[2])
        assert current['tax_rate'] == 0 and current['tax_amount'] == 0 and current['total'] == 26
        assert current['items'] == open_quote['items'] and current['savings_total'] == 6
        assert current['quote_fingerprint'] != open_quote['quote_fingerprint']
        stale_key = str(uuid.uuid4())
        stale = subprocess.run(PSQL + ['-At', '-c', command(actors[2], open_quote, stale_key, location)], text=True, capture_output=True)
        assert stale.returncode != 0 and 'P4005' in stale.stderr, stale.stderr
        assert query(f"SELECT count(*) FROM pliego.checkout_attempt WHERE actor_user_id={actors[2]} AND attempt_key='{stale_key}'") == '0'
        fresh = query(command(actors[2], current, stale_key, location)).splitlines()[0].split('|')
        assert fresh[3] == '26.00'
        issue_invoice(admin, int(fresh[0]), 'EC-UPGRADE-ZERO')
        assert query(f"SELECT impuesto_tasa||':'||impuesto_total||':'||total FROM pliego.factura WHERE pedido_id={fresh[0]}") == '0.0000:0.00:26.00'
        for actor, order, _, _ in receipts:
            query(f'CALL pliego.sp_order_cancel({actor},{order},NULL,NULL,NULL,NULL,NULL)')
            query(f"CALL pliego.sp_credit_note_issue({admin},{order},'EC-UPGRADE-CREDIT-{order}','Cancelación',NULL)")
            assert query(f"SELECT n.impuesto_total||':'||n.total FROM pliego.nota_credito n JOIN pliego.factura f USING(factura_id) WHERE f.pedido_id={order}") == '3.90:29.90'
        print('PASS Flyway66→67: mixed offers retain 15% orders/payments/receipts/outbox/invoices/credits; stale quote rejected; fresh purchases use zero IVA.')
    finally:
        new.terminate()
        new.wait(timeout=20)


if __name__ == '__main__':
    main()
