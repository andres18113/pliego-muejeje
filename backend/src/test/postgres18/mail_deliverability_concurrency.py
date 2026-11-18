"""Disposable PostgreSQL 18: concurrent webhook ingestion and projection. No mail."""
import concurrent.futures
import uuid
from checkout_last_unit import query


def main():
    suffix = uuid.uuid4().hex
    event = 'event-' + suffix
    message = 'message-' + suffix
    actor = query(f"INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado) VALUES('event-{suffix}@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id").splitlines()[0]
    query(f"INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,estado,id_mensaje_proveedor) VALUES('event-{suffix}','ORDER_CONFIRMED',{actor},'event-{suffix}@example.invalid','{{}}','SENT','{message}')")
    statement = f"SELECT pliego.fn_mail_event_record('{event}','{message}','BOUNCED','HARD_BOUNCE',to_timestamp(1793547217),'MAILTRAP')"
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        assert list(pool.map(lambda _: query(statement), range(8))) == ['t'] * 8
    assert query(f"SELECT count(*) FROM pliego.correo_evento_proveedor WHERE evento_id='{event}'") == '1'
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: query('SELECT pliego.fn_mail_event_project_next()'), range(8)))
    assert query(f"SELECT count(*) FROM pliego.correo_evento_proveedor WHERE evento_id='{event}' AND procesado_en IS NOT NULL") == '1'
    assert query(f"SELECT motivo FROM pliego.correo_destinatario_entrega WHERE destinatario='event-{suffix}@example.invalid'") == 'HARD_BOUNCE'
    # A rolled-back batch cannot persist even its earlier valid event.
    query(f"BEGIN; SELECT pliego.fn_mail_event_record('rollback-{suffix}','{message}','DELIVERED',NULL,to_timestamp(1793547218),'MAILTRAP'); ROLLBACK")
    assert query(f"SELECT count(*) FROM pliego.correo_evento_proveedor WHERE evento_id='rollback-{suffix}'") == '0'
    print('Mail deliverability concurrency passed: 8 identical records, concurrent projection, rollback.')


if __name__ == '__main__':
    main()
