"""Disposable owner-role gate: inject a closing-boundary clock transactionally.

Only the opening-hours predicate uses the test clock; reconciliation, readiness,
enqueue, outbox and completion run their real implementations. ROLLBACK restores
the predicate, fixtures and clock. Restricted-runtime gates run separately.
"""
import os
import subprocess

from checkout_last_unit import query
from verified_pickup_concurrency import ready_fixture


def main():
    if os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') != '1' or os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost', '::1'):
        raise SystemExit('Requires PLIEGO_TEST_DISPOSABLE_DB=1 and explicit loopback PGHOST')
    _, source, _ = ready_fixture()
    definition_sql = "SELECT pg_get_functiondef('pliego.fn_pickup_is_open_at(timestamptz,text,time,time)'::regprocedure)"
    original = query(definition_sql)
    try:
        query(f"""BEGIN;
        DO $fixture$
        DECLARE o BIGINT;
        BEGIN
         INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total)
          SELECT cliente_id,'CONFIRMED',subtotal,total FROM pliego.pedido WHERE pedido_id={source} RETURNING pedido_id INTO o;
         INSERT INTO pliego.pedido_item(pedido_id,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,
          formato_snapshot,idioma_snapshot,precio_unitario,cantidad,subtotal)
          SELECT o,edicion_id,sku_snapshot,titulo_snapshot,autores_snapshot,editorial_snapshot,formato_snapshot,
           idioma_snapshot,precio_unitario,cantidad,subtotal FROM pliego.pedido_item WHERE pedido_id={source};
         INSERT INTO pliego.pago(pedido_id,metodo,estado,monto,referencia,fecha_aprobacion)
          SELECT o,metodo,'APPROVED',monto,pliego.fn_generate_payment_reference(),clock_timestamp()-INTERVAL '2 days'
          FROM pliego.pago WHERE pedido_id={source};
         INSERT INTO pliego.pedido_entrega(pedido_id,metodo) VALUES(o,'STORE_PICKUP');
         INSERT INTO pliego.pedido_retiro(pedido_id,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,
          codigo_postal,latitud,longitud,zona_horaria,apertura,cierre,preparacion_minutos,estimado_desde,listo_desde,codigo,programacion_version)
          SELECT o,ubicacion_retiro_id,nombre,direccion,ciudad,provincia,pais_codigo,codigo_postal,latitud,longitud,
           'UTC','09:00','17:00',10,clock_timestamp()-INTERVAL '1 day',clock_timestamp()-INTERVAL '23 hours 50 minutes',
           pliego.fn_generate_pickup_code(),1 FROM pliego.pedido_retiro WHERE pedido_id={source};
         CALL pliego.sp_purchase_lifecycle_reconcile(o);
         PERFORM set_config('pliego.closing_boundary_order',o::TEXT,TRUE);
        END $fixture$;

        CREATE TEMP TABLE pickup_clock(first_at TIMESTAMPTZ, later_at TIMESTAMPTZ, calls INTEGER);
        INSERT INTO pickup_clock VALUES('2026-11-01 16:59:59+00','2026-11-01 17:00:00+00',0);
        CREATE FUNCTION pg_temp.pickup_now() RETURNS TIMESTAMPTZ LANGUAGE plpgsql VOLATILE AS $$
        DECLARE result TIMESTAMPTZ;
        BEGIN
         UPDATE pg_temp.pickup_clock SET calls=calls+1 RETURNING CASE WHEN calls=1 THEN first_at ELSE later_at END INTO result;
         RETURN result;
        END $$;
        CREATE OR REPLACE FUNCTION pliego.fn_pickup_is_open_at(p_at TIMESTAMPTZ,p_timezone TEXT,p_opens TIME,p_closes TIME)
        RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER AS $$
        DECLARE at_time TIME := (pg_temp.pickup_now() AT TIME ZONE p_timezone)::TIME;
        BEGIN
         RETURN CASE WHEN p_opens<p_closes THEN at_time>=p_opens AND at_time<p_closes
          ELSE at_time>=p_opens OR at_time<p_closes END;
        END $$;

        DO $boundary$
        DECLARE o BIGINT:=current_setting('pliego.closing_boundary_order')::BIGINT;
         event_key TEXT:='ORDER_STATUS:'||o||':STORE_PICKUP:READY';
        BEGIN
         PERFORM pliego.fn_pickup_ready_mail_enqueue(o);
         IF (SELECT calls FROM pg_temp.pickup_clock)<2 THEN RAISE EXCEPTION 'closing clock did not cross both readiness checks'; END IF;
         IF EXISTS(SELECT FROM pliego.correo_outbox WHERE evento_clave=event_key) THEN RAISE EXCEPTION 'closing check unexpectedly enqueued READY'; END IF;
         IF (SELECT listo_procesado_en IS NOT NULL FROM pliego.pedido_retiro_aviso WHERE pedido_id=o)
          THEN RAISE EXCEPTION 'closing boundary permanently completed READY without durable outbox event'; END IF;
         CALL pliego.sp_pickup_notifications_advance_due(100);
         IF (SELECT listo_procesado_en IS NOT NULL FROM pliego.pedido_retiro_aviso WHERE pedido_id=o)
          THEN RAISE EXCEPTION 'closed sweep completed unqueued READY'; END IF;
         UPDATE pg_temp.pickup_clock SET first_at='2026-11-02 09:00:00+00',later_at='2026-11-02 09:00:00+00',calls=0;
         CALL pliego.sp_pickup_notifications_advance_due(100);
         CALL pliego.sp_pickup_notifications_advance_due(100);
         IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave=event_key)<>1
          OR (SELECT listo_procesado_en IS NULL FROM pliego.pedido_retiro_aviso WHERE pedido_id=o)
          THEN RAISE EXCEPTION 'next opening failed to recover exactly one READY and complete marker'; END IF;
         -- A durable deduplicated event is also sufficient to complete observation.
         UPDATE pliego.pedido_retiro_aviso SET listo_procesado_en=NULL WHERE pedido_id=o;
         PERFORM pliego.fn_pickup_ready_mail_enqueue(o);
         IF (SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave=event_key)<>1
          OR (SELECT listo_procesado_en IS NULL FROM pliego.pedido_retiro_aviso WHERE pedido_id=o)
          THEN RAISE EXCEPTION 'existing READY event did not complete observation exactly once'; END IF;
        END $boundary$;
        ROLLBACK;""")
    except subprocess.CalledProcessError as error:
        print(error.stderr)
        raise
    finally:
        assert query(definition_sql) == original, 'Test clock was not rolled back'
    print('Pickup closing boundary passed: 16:59:59 -> 17:00 stays pending without event; next 09:00 recovers once; existing event deduplicates; test clock rolled back')


if __name__ == '__main__':
    main()
