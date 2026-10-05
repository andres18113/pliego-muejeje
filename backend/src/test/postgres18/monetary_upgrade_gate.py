"""Flyway40→41 keeps historical orders/receipts/invoices untaxed. Disposable DB only."""
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
        sock.bind(('127.0.0.1',0))
        port=sock.getsockname()[1]
    log=Path(f'/tmp/pliego-monetary-upgrade-{target}.log')
    jar=Path(__file__).resolve().parents[3]/'target/pliego-backend-0.1.0-SNAPSHOT.jar'
    with log.open('w') as stream:
        process=subprocess.Popen(['java','-jar',str(jar),f'--server.port={port}',f'--spring.flyway.target={target}'],
            env={**os.environ,'PLIEGO_MAIL_ENABLED':'false'},stdout=stream,stderr=stream)
    end=time.monotonic()+60
    while time.monotonic()<end:
        if process.poll() is not None:
            raise AssertionError(f'Upgrade backend startup failed; inspect {log}')
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/v3/api-docs',timeout=2) as response:
                if response.status==200:
                    return process
        except OSError:
            pass
        time.sleep(.1)
    process.terminate();process.wait(timeout=20)
    raise AssertionError('Upgrade backend did not start')


def main():
    old=start(40)
    try:
        actors,edition=fixture()
        admin=query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' ORDER BY usuario_id LIMIT 1")
        query(f"CALL pliego.sp_inventory_entry({admin},{edition},1,'upgrade fixture',NULL,NULL,NULL)")
        location=query('SELECT pickup_location_id FROM pliego.fn_pickup_locations() LIMIT 1')
        receipts=[]
        for n,(actor,address) in enumerate(actors):
            key=str(uuid.uuid4())
            mode='HOME_DELIVERY' if n==0 else 'STORE_PICKUP'
            address_sql=str(address) if n==0 else 'NULL'
            location_sql='NULL' if n==0 else location
            command=f"CALL pliego.sp_checkout_idempotent({actor},'{key}',{address_sql},'TRANSFER','APPROVED',NULL,'{mode}',{location_sql},NULL,NULL,NULL,NULL,NULL)"
            result=query(command).splitlines()[0].split('|')
            assert result[3]=='7.25'
            receipts.append((actor,result[0],command))
        query(f"CALL pliego.sp_invoice_issue({admin},{receipts[1][1]},'UPGRADE-OLD','Ana Pérez','OTHER','fixture',NULL,'Fiscal',NULL,'Quito','Pichincha','EC',NULL,NULL)")
    finally:
        old.terminate();old.wait(timeout=20)
    new=start(41)
    try:
        for actor,order,command in receipts:
            money=json.loads(query(f'SELECT to_jsonb(m) FROM pliego.fn_order_pricing({order}) m'))
            assert money=={'subtotal':7.25,'tax_rate':0,'tax_amount':0,'shipping_amount':0,'total':7.25}
            assert query(command).splitlines()[0].split('|')[3]=='7.25'
            assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{order}'")=='1'
        query(f"CALL pliego.sp_invoice_issue({admin},{receipts[0][1]},'UPGRADE-ISSUED-LATER','Ana Pérez','OTHER','fixture',NULL,'Fiscal',NULL,'Quito','Pichincha','EC',NULL,NULL)")
        for _,order,_ in receipts:
            assert query(f'SELECT total||\':\'||impuesto_total FROM pliego.factura WHERE pedido_id={order}')=='7.25:0.00'
            assert query(f"SELECT count(*) FROM pliego.factura_item l JOIN pliego.factura i USING(factura_id) WHERE i.pedido_id={order} AND l.tratamiento_impuesto<>'NOT_ASSESSED'")=='0'
        print('Monetary Flyway upgrade passed: historical home/pickup receipts and invoices retain zero tax, including later issuance')
    finally:
        new.terminate();new.wait(timeout=20)


if __name__=='__main__':
    main()
