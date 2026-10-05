"""Flyway V042 -> V043: preserve historical events and catch up existing shipments."""
import os
from monetary_upgrade_gate import start
from checkout_last_unit import fixture, query


def main():
    os.environ['PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED'] = 'false'
    old = start(42)
    try:
        actors, edition = fixture()
        actor, address = actors[0]
        order = query(f"CALL pliego.sp_checkout({actor},{address},'CARD','APPROVED',NULL,NULL,NULL,NULL,NULL)").split('|')[0]
        admin = query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' LIMIT 1")
        query(f"CALL pliego.sp_order_change_status({admin},{order},'PREPARING',NULL,NULL,NULL)")
        query(f"CALL pliego.sp_order_change_status({admin},{order},'SHIPPED',NULL,NULL,NULL)")
        # Historical confirmedAt seed; immutable source events are appended, never rewritten.
        query(f"INSERT INTO pliego.pedido_estado_historial(pedido_id,origen,estado_anterior,estado_nuevo,fecha) VALUES({order},'SYSTEM','PENDING_PAYMENT','CONFIRMED',clock_timestamp()-INTERVAL '1 day')")
        history = query(f"SELECT jsonb_agg(to_jsonb(h) ORDER BY envio_historial_id) FROM pliego.envio_historial h JOIN pliego.envio e USING(envio_id) WHERE e.pedido_id={order}")
        old_events = query(f"SELECT count(*) FROM pliego.envio_historial h JOIN pliego.envio e USING(envio_id) WHERE e.pedido_id={order}")
        commercial = query(f"SELECT estado FROM pliego.pedido WHERE pedido_id={order}")
        commercial_history = query(f"SELECT jsonb_agg(to_jsonb(h) ORDER BY pedido_estado_historial_id) FROM pliego.pedido_estado_historial h WHERE pedido_id={order}")
    finally:
        old.terminate()
        old.wait(timeout=20)
    new = start(43)
    try:
        assert query(f"SELECT fecha_confirmacion=(SELECT min(fecha) FROM pliego.pedido_estado_historial WHERE pedido_id={order} AND estado_nuevo='CONFIRMED') FROM pliego.envio WHERE pedido_id={order}") == 't'
        assert query(f"SELECT shipment->>'state' FROM pliego.fn_customer_order_detail_priced({actor},{order})") == 'DELIVERED'
        for _ in range(3):
            query('CALL pliego.sp_home_delivery_advance_due(100)')
        assert query(f"SELECT estado FROM pliego.pedido WHERE pedido_id={order}") == commercial
        assert query(f"SELECT jsonb_agg(to_jsonb(h) ORDER BY pedido_estado_historial_id) FROM pliego.pedido_estado_historial h WHERE pedido_id={order}") == commercial_history
        assert query(f"SELECT jsonb_agg(to_jsonb(h) ORDER BY envio_historial_id) FROM (SELECT h.* FROM pliego.envio_historial h JOIN pliego.envio e USING(envio_id) WHERE e.pedido_id={order} ORDER BY envio_historial_id LIMIT {old_events}) h") == history
        assert query(f"SELECT count(*) FROM pliego.envio_historial h JOIN pliego.envio e USING(envio_id) WHERE e.pedido_id={order} AND h.estado_nuevo='DELIVERED'") == '1'
        assert query("SELECT count(*)||':'||max(version::int) FROM public.flyway_schema_history WHERE success AND version IS NOT NULL") == '43:43'
        print('HOME_DELIVERY Flyway upgrade passed: confirmedAt backfill, legacy history preserved, catch-up once')
    finally:
        new.terminate()
        new.wait(timeout=20)


if __name__ == '__main__':
    main()
