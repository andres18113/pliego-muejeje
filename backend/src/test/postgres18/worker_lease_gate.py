"""Worker admission must recheck its lease after an observed PostgreSQL row wait.

Only disposable fixtures are written; no provider calls or role changes occur.
"""
import os
import subprocess
import uuid

from checkout_last_unit import PSQL, query, wait_for_activity


def after_row_wait(table, key, command):
    tag = 'worker-lease-' + uuid.uuid4().hex
    holder = subprocess.Popen(
        PSQL + ['-Atq', '-c', 'BEGIN', '-c',
                f'SELECT 1 FROM {table} WHERE {key} FOR UPDATE',
                '-c', 'SELECT pg_sleep(3)', '-c', 'COMMIT'],
        env={**os.environ, 'PGAPPNAME': tag + '-holder'},
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    waiter = None
    try:
        wait_for_activity(tag + '-holder', "wait_event='PgSleep'")
        waiter = subprocess.Popen(
            PSQL + ['-Atq', '-c', command],
            env={**os.environ, 'PGAPPNAME': tag + '-waiter'},
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        wait_for_activity(tag + '-waiter', "wait_event_type='Lock'", timeout=5)
        _, holder_error = holder.communicate(timeout=10)
        output, waiter_error = waiter.communicate(timeout=10)
        assert holder.returncode == waiter.returncode == 0, holder_error + waiter_error
        return output.strip()
    finally:
        for process in (waiter, holder):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate()


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1', 'Disposable database acknowledgement required'
    assert os.environ.get('PGHOST') in ('127.0.0.1', 'localhost'), 'Loopback database required'
    assert query('SHOW server_version_num').startswith('18'), 'PostgreSQL 18 required'
    suffix = uuid.uuid4().hex
    actor = int(query(f"CALL pliego.sp_customer_register('worker-lease-{suffix}@example.invalid',"
                      "'fixture-password','Cliente','Worker',NULL,NULL,NULL,NULL)").split('|')[0])
    invoice = order = None
    failures = []
    try:
        mail_owner = str(uuid.uuid4())
        mail = int(query("INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,"
                         "estado,intentos,propietario,lease_hasta) "
                         f"VALUES('worker-lease-{suffix}','ORDER_CONFIRMED',{actor},"
                         f"'worker-lease-{suffix}@example.invalid','{{}}','SENDING',1,'{mail_owner}',"
                         "clock_timestamp()+INTERVAL '60 seconds') RETURNING correo_id").splitlines()[0])
        send = f"SELECT pliego.fn_mail_outbox_prepare_send({mail},'{mail_owner}')"
        assert query(send) == 't', 'valid outbox owner cannot send'
        assert query(f"SELECT pliego.fn_mail_outbox_prepare_send({mail},uuidv4())") == 'f'
        query(f'UPDATE pliego.correo_outbox SET propietario=NULL WHERE correo_id={mail}')
        try:
            assert query(f'SELECT pliego.fn_mail_outbox_prepare_send({mail},NULL)') == 'f', 'missing worker owner permits send'
        finally:
            query(f"UPDATE pliego.correo_outbox SET propietario='{mail_owner}' WHERE correo_id={mail}")
        query(f"UPDATE pliego.correo_outbox SET lease_hasta=clock_timestamp()+INTERVAL '1 second' WHERE correo_id={mail}")
        result = after_row_wait('pliego.correo_outbox', f'correo_id={mail}', send)
        assert query(f'SELECT lease_hasta<clock_timestamp() FROM pliego.correo_outbox WHERE correo_id={mail}') == 't'
        if result != 'f':
            failures.append('outbox permits send after its lease expired during row wait')
        assert query(send) == 'f', 'already expired outbox lease permits send'

        # A draft invoice needs no immutable line/artifact history, so all test
        # rows can be removed after the independent connections release locks.
        order = int(query("INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total) "
                          f"SELECT cliente_id,'PENDING_PAYMENT',1,1 FROM pliego.cliente WHERE usuario_id={actor} "
                          "RETURNING pedido_id").splitlines()[0])
        invoice = int(query("INSERT INTO pliego.factura(pedido_id,numero_documento,estado,comprador_nombre,"
                            "identidad_tipo,identidad_numero,subtotal,impuesto_total,total,usuario_emisor_id) "
                            f"VALUES({order},'worker-lease-{suffix}','DRAFT','Cliente Worker','OTHER','fixture',1,0,1,{actor}) "
                            "RETURNING factura_id").splitlines()[0])
        invoice_owner = str(uuid.uuid4())
        query("INSERT INTO pliego.factura_archivo_trabajo(factura_id,tipo,estado,intentos,propietario,lease_until) "
              f"VALUES({invoice},'PDF','PROCESSING',1,'{invoice_owner}',clock_timestamp()+INTERVAL '60 seconds')")
        fail = f"SELECT pliego.fn_invoice_artifact_fail({invoice},'PDF','{invoice_owner}')"
        assert query(f"SELECT pliego.fn_invoice_artifact_fail({invoice},'PDF',uuidv4())") == 'f'
        assert query(fail) == 't', 'valid invoice owner cannot record failure'
        query("UPDATE pliego.factura_archivo_trabajo SET estado='PROCESSING',"
              f"propietario='{invoice_owner}',lease_until=clock_timestamp()+INTERVAL '1 second' "
              f"WHERE factura_id={invoice} AND tipo='PDF'")
        result = after_row_wait('pliego.factura_archivo_trabajo', f"factura_id={invoice} AND tipo='PDF'", fail)
        if result != 'f':
            failures.append('invoice failure mutates job after its lease expired during row wait')
        else:
            assert query("SELECT estado='PROCESSING' AND propietario="
                         f"'{invoice_owner}'::UUID AND lease_until<clock_timestamp() "
                         f"FROM pliego.factura_archivo_trabajo WHERE factura_id={invoice} AND tipo='PDF'") == 't'
        assert query(fail) == 'f', 'already expired invoice lease records failure'
        assert not failures, '; '.join(failures)
        print('Worker lease PG18 gate passed: 9 controls for live, missing/wrong owner, expired and observed row waits')
    finally:
        query(f'DELETE FROM pliego.correo_outbox WHERE usuario_id={actor}')
        if invoice is not None:
            query(f'DELETE FROM pliego.factura_archivo_trabajo WHERE factura_id={invoice}')
            query(f'DELETE FROM pliego.factura WHERE factura_id={invoice}')
        if order is not None:
            query(f'DELETE FROM pliego.pedido WHERE pedido_id={order}')
        query(f'DELETE FROM pliego.cliente WHERE usuario_id={actor}')
        query(f'DELETE FROM pliego.usuario WHERE usuario_id={actor}')


if __name__ == '__main__':
    main()
