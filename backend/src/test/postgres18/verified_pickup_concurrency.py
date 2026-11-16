"""Disposable PostgreSQL 18: verified collection and candidate reservations serialize."""
import concurrent.futures
import os
import subprocess
import uuid

from checkout_last_unit import PSQL, fixture, query, wait_for_activity


def ready_fixture():
    actors, edition = fixture()
    actor, _ = actors[0]
    admin = query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' ORDER BY usuario_id LIMIT 1")
    location = query('SELECT pickup_location_id FROM pliego.fn_pickup_locations() LIMIT 1')
    source = query(f"CALL pliego.sp_checkout_idempotent({actor},'{uuid.uuid4()}',NULL,'CARD','APPROVED',NULL,"
                   f"'STORE_PICKUP',{location},NULL,NULL,NULL,NULL,NULL)").split('|')[0]
    # A time-seeded fixture obeys snapshot immutability and avoids a 25-minute sleep.
    command = f"""
    DO $fixture$
    DECLARE o BIGINT; code VARCHAR; now_at TIMESTAMPTZ:=clock_timestamp();
    BEGIN
     INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total)
      SELECT cliente_id,'CONFIRMED',subtotal,total FROM pliego.pedido WHERE pedido_id={source}
      RETURNING pedido_id INTO o;
     INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,
      editorial_snapshot,formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
      SELECT o,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,formato_snapshot,
       idioma_snapshot,precio_unitario,cantidad,subtotal FROM pliego.pedido_item WHERE pedido_id={source};
     INSERT INTO pliego.pago(pedido_id,metodo,estado,monto,referencia,fecha_aprobacion)
      SELECT o,metodo,'APPROVED',monto,pliego.fn_generate_payment_reference(),clock_timestamp()-INTERVAL '1 day'
      FROM pliego.pago WHERE pedido_id={source};
     INSERT INTO pliego.pedido_entrega(pedido_id,metodo) VALUES(o,'STORE_PICKUP');
     code:=pliego.fn_generate_pickup_code();
     INSERT INTO pliego.pedido_retiro(pedido_id,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,
      codigo_postal,latitud,longitud,zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,codigo)
      SELECT o,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,codigo_postal,latitud,longitud,
       zona_horaria,apertura,cierre,preparacion_minutos,now_at-INTERVAL '1 day',
       now_at-INTERVAL '1 day'+make_interval(mins=>preparacion_minutos),code
      FROM pliego.pedido_retiro WHERE pedido_id={source};
     PERFORM set_config('pliego.verified_pickup_fixture',o::TEXT||'|'||code,TRUE);
    END $fixture$;
    SELECT current_setting('pliego.verified_pickup_fixture');
    """
    order, code = query(command).splitlines()[-1].split('|')
    return admin, order, code


# AC-5.2 AC-6.2: concurrent administrators record one handover and one history/outbox event.
def collection_race(different_admin=False):
    admin, order, code = ready_fixture()
    second_actor = query("SELECT max(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'") if different_admin else admin
    app = 'verified-pickup-first-' + uuid.uuid4().hex
    collect = f"CALL pliego.sp_pickup_collect({admin},{order},'{code}',TRUE)"
    first = subprocess.Popen(PSQL + ['-c', 'BEGIN', '-c', collect, '-c', 'SELECT pg_sleep(2)', '-c', 'COMMIT'],
                             env={**os.environ, 'PGAPPNAME': app}, text=True,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        wait_for_activity(app, "wait_event='PgSleep'")
        second_app = 'verified-pickup-second-' + uuid.uuid4().hex
        second_command = f"CALL pliego.sp_pickup_collect({second_actor},{order},'{code}',TRUE)"
        second = subprocess.Popen(PSQL + ['-c', second_command], env={**os.environ, 'PGAPPNAME': second_app},
                                  text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            wait_for_activity(second_app, "wait_event_type='Lock'")
            _, first_error = first.communicate(timeout=10)
            _, second_error = second.communicate(timeout=10)
            assert first.returncode == 0, first_error
            assert second.returncode != 0 and 'P5017' in second_error, second_error
        finally:
            if second.poll() is None:
                second.kill()
                second.communicate(timeout=5)
    finally:
        if first.poll() is None:
            first.kill()
            first.communicate(timeout=5)
    assert query(f"SELECT estado FROM pliego.pedido WHERE pedido_id={order}") == 'DELIVERED'
    assert query(f"SELECT retirado_por||':'||identidad_verificada FROM pliego.pedido_retiro WHERE pedido_id={order}") == f'{admin}:true'
    assert query(f"SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id={order} AND estado_nuevo='DELIVERED'") == '1'
    assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{order}:STORE_PICKUP:COLLECTED'") == '1'


def generated_candidate_is_reserved():
    app = 'pickup-random-reservation-' + uuid.uuid4().hex
    first = subprocess.Popen(PSQL + ['-c', 'BEGIN', '-c',
        "SELECT set_config('pliego.test_pickup_candidate',pliego.fn_generate_pickup_code(),TRUE)",
        '-c', 'SELECT pg_sleep(2)', '-c', 'COMMIT'],
        env={**os.environ, 'PGAPPNAME': app}, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        wait_for_activity(app, "wait_event='PgSleep'")
        assert query(f"SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING(pid) "
                     f"WHERE a.application_name='{app}' AND l.locktype='advisory' AND l.granted") == '1'
        _, error = first.communicate(timeout=10)
        assert first.returncode == 0, error
    finally:
        if first.poll() is None:
            first.kill()
            first.communicate(timeout=5)
    # Independent sessions draw from the CSPRNG; all candidates match the public
    # alphabet and none reuse the legacy sequence or another sampled candidate.
    def draw(_):
        return query('SELECT pliego.fn_generate_pickup_code() FROM generate_series(1,128)').splitlines()
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        codes = [code for batch in pool.map(draw, range(8)) for code in batch]
    assert len(codes) == 1024 and len(set(codes)) == 1024
    alphabet = set('23456789ABCDEFGHJKLMNPQRSTUVWXYZ')
    assert all(code.startswith('P-') and len(code) == 10 and set(code[2:]) <= alphabet for code in codes)


def main():
    if not all(os.environ.get(key) for key in ('PGHOST', 'PGPORT', 'PGDATABASE')):
        raise SystemExit('Set PGHOST, PGPORT and PGDATABASE for a disposable PostgreSQL 18 database')
    collection_race()
    collection_race(different_admin=True)
    generated_candidate_is_reserved()
    print('Verified pickup concurrency passed: same/different admin races, one collection each, immutable audit, one outbox/history event; 1024 unique CSPRNG candidates reserved')


if __name__ == '__main__':
    main()
