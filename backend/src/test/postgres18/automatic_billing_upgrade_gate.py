"""Real startup/Flyway 66→70→73: preserve 15% legacy history, then new fulfillment.
Requires an EMPTY disposable PostgreSQL database and the current built backend jar.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
import uuid
from checkout_last_unit import fixture, query


def start(target):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    log = Path(f'/tmp/pliego-billing-upgrade-{target}.log')
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
                    return process
        except OSError:
            pass
        time.sleep(.1)
    process.terminate()
    process.wait(timeout=20)
    raise AssertionError(f'Upgrade startup timeout; inspect {log}')


def stop(process):
    process.terminate()
    process.wait(timeout=20)


def historical(order):
    # Only approved pre-V071 columns participate; new LEGACY defaults are expected.
    return json.loads(query(f"""SELECT jsonb_build_object(
      'order',to_jsonb(p),'lines',(SELECT jsonb_agg(to_jsonb(i) ORDER BY pedido_item_id) FROM pliego.pedido_item i WHERE pedido_id=p.pedido_id),
      'payment',(SELECT to_jsonb(pa) FROM pliego.pago pa WHERE pedido_id=p.pedido_id),
      'receipt',(SELECT to_jsonb(a) FROM pliego.checkout_attempt a WHERE order_id=p.pedido_id),
      'invoice',(SELECT jsonb_build_object('id',f.factura_id,'number',f.numero_documento,'state',f.estado,'buyer',f.comprador_nombre,
        'identityType',f.identidad_tipo,'identityNumber',f.identidad_numero,'subtotal',f.subtotal,'taxRate',f.impuesto_tasa,
        'tax',f.impuesto_total,'shipping',f.envio_monto,'total',f.total,'issuedAt',f.fecha_emision) FROM pliego.factura f WHERE pedido_id=p.pedido_id),
      'invoiceLines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY factura_item_id) FROM pliego.factura_item l JOIN pliego.factura f USING(factura_id) WHERE f.pedido_id=p.pedido_id),
      'files',(SELECT jsonb_agg(to_jsonb(a) ORDER BY tipo) FROM pliego.factura_archivo a JOIN pliego.factura f USING(factura_id) WHERE f.pedido_id=p.pedido_id))
      FROM pliego.pedido p WHERE pedido_id={order}"""))


def new_fulfillment(actor, address, edition, admin):
    book, publisher = query(f'SELECT libro_id,editorial_id FROM pliego.edicion WHERE edicion_id={edition}').split('|')
    query(f"CALL pliego.sp_inventory_entry({admin},{edition},8,'upgrade fixture',NULL,NULL,NULL)")
    location = query('SELECT pickup_location_id FROM pliego.fn_pickup_locations() LIMIT 1')
    assert location, 'pickup fixture absent'
    for mode in ('HOME_DELIVERY', 'STORE_PICKUP', 'DIGITAL_ONLY', 'MIXED'):
        if mode in ('HOME_DELIVERY', 'STORE_PICKUP', 'MIXED'):
            query(f'CALL pliego.sp_cart_add_item({actor},{edition},1,NULL,NULL,NULL)')
        if mode in ('DIGITAL_ONLY', 'MIXED'):
            sku = 'BILL-UPGRADE-' + uuid.uuid4().hex.upper()
            digital = query(f"CALL pliego.sp_edition_create({admin},{book},{publisher},'{sku}',NULL,'es','EBOOK',NULL,NULL,10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],NULL)")
            query(f'CALL pliego.sp_cart_add_item({actor},{digital},1,NULL,NULL,NULL)')
        actual_mode = 'HOME_DELIVERY' if mode == 'MIXED' else mode
        target_address = str(address) if actual_mode == 'HOME_DELIVERY' else 'NULL'
        pickup = location if actual_mode == 'STORE_PICKUP' else 'NULL'
        outcome = 'PENDING' if mode == 'DIGITAL_ONLY' else 'APPROVED'
        result = query(f"""CALL pliego.sp_checkout_billed_quoted({actor},'{uuid.uuid4()}',{target_address},'TRANSFER','{outcome}',NULL,
          '{actual_mode}',{pickup},NULL,'EC_CEDULA','0012345674','Comprador Fiscal','Fiscal independiente',NULL,
          'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)""").split('|')
        order = int(result[0])
        if outcome == 'PENDING':
            assert query(f"SELECT count(*) FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.pedido_id={order}") == '0'
            query(f'CALL pliego.sp_billed_order_approve({admin},{order})')
            assert query(f"SELECT p.cancelacion_hasta=pa.fecha_aprobacion+INTERVAL '6 minutes' FROM pliego.pedido p JOIN pliego.pago pa USING(pedido_id) WHERE p.pedido_id={order}") == 't'
        assert query(f"SELECT estado||':'||impuesto_total FROM pliego.factura WHERE pedido_id={order}") == 'ISSUED:0.00'
        assert query(f"SELECT count(*) FROM pliego.factura_item l JOIN pliego.factura f USING(factura_id) WHERE f.pedido_id={order} AND l.tratamiento_impuesto='ASSESSED' AND l.impuesto_tasa=0") == ('2' if mode == 'MIXED' else '1')
        if mode in ('DIGITAL_ONLY', 'MIXED'):
            assert query(f"SELECT count(*) FROM pliego.digital_grant g JOIN pliego.pedido_item i USING(pedido_item_id) WHERE i.pedido_id={order} AND g.state='ACTIVE'") == '1'


def main():
    assert os.environ.get('PGDATABASE'), 'select an empty disposable database'
    old = start(66)
    try:
        actors, edition = fixture()
        admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'"))
        query(f"CALL pliego.sp_inventory_entry({admin},{edition},1,'upgrade fixture',NULL,NULL,NULL)")
        receipts = []
        for actor, address in actors:
            key = uuid.uuid4()
            command = f"CALL pliego.sp_checkout_quoted({actor},'{key}',{address},'TRANSFER','APPROVED',NULL,'HOME_DELIVERY',NULL,NULL,NULL,NULL,NULL,NULL,NULL)"
            order = int(query(command).split('|')[0])
            assert query(f'SELECT impuesto_tasa FROM pliego.pedido WHERE pedido_id={order}') == '15.0000'
            receipts.append((actor, order, command))
        invoice_order = receipts[1][1]
        invoice = query(f"CALL pliego.sp_invoice_issue({admin},{invoice_order},'UPGRADE-BILLING-LEGACY','Comprador Anterior','OTHER','fixture',NULL,'Fiscal Anterior',NULL,'Quito','Pichincha','EC',NULL,NULL)")
        query(f"INSERT INTO pliego.factura_archivo(factura_id,tipo,almacenamiento_clave) VALUES({invoice},'PDF','legacy-private-fixture.pdf')")
        before = {order: historical(order) for _, order, _ in receipts}
    finally:
        stop(old)
    baseline = start(70)
    try:
        assert all(historical(order) == before[order] for _, order, _ in receipts), 'V070 baseline modified history'
    finally:
        stop(baseline)
    current = start(73)
    try:
        for actor, order, command in receipts:
            assert historical(order) == before[order], 'billing upgrade modified approved history'
            assert int(query(command).split('|')[0]) == order, 'legacy replay changed IDs'
        assert query(f'SELECT count(*) FROM pliego.factura WHERE pedido_id={receipts[0][1]}') == '0', 'retroactive invoice invented'
        assert query(f"SELECT procedencia FROM pliego.factura WHERE pedido_id={invoice_order}") == 'LEGACY'
        # Refund of a legacy order without invoice must not invent invoice/credit.
        actor, order, _ = receipts[0]
        query(f'CALL pliego.sp_order_cancel({actor},{order},NULL,NULL,NULL,NULL,NULL)')
        assert query(f'SELECT count(*) FROM pliego.factura WHERE pedido_id={order}') == '0'
        new_fulfillment(actors[0][0], actors[0][1], edition, admin)
        print('Automatic billing upgrade: Flyway66→70→73, legacy15%, receipts/files unchanged, no retroactive documents, physical/pickup/digital/mixed zero-tax invoices passed.')
    finally:
        stop(current)


if __name__ == '__main__':
    main()
