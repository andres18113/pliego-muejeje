"""Upgrade a live V060-shaped disposable database through V062 without changing history."""
import uuid

from checkout_last_unit import fixture, query
from monetary_upgrade_gate import start


def remove_fixture_cart(actor):
    item = query(f"""SELECT ci.carrito_item_id FROM pliego.carrito_item ci
        JOIN pliego.carrito ca USING(carrito_id) JOIN pliego.cliente c USING(cliente_id)
        WHERE c.usuario_id={actor} AND ca.estado='ACTIVE' LIMIT 1""")
    if item:
        query(f"CALL pliego.sp_cart_remove_item({actor},{item})")


def checkout(actor, method, address=None, pickup=None):
    address_sql = 'NULL' if address is None else str(address)
    pickup_sql = 'NULL' if pickup is None else str(pickup)
    result = query(f"""CALL pliego.sp_checkout_idempotent(
        {actor},'{uuid.uuid4()}',{address_sql},'TRANSFER','APPROVED',NULL,
        '{method}',{pickup_sql},NULL,NULL,NULL,NULL,NULL)""")
    return int(result.split('|')[0])


def historical_snapshot(order):
    raw = query(f"""SELECT jsonb_build_object(
        'order',to_jsonb(p),
        'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.pedido_item_id)
            FROM pliego.pedido_item i WHERE i.pedido_id=p.pedido_id),'[]'::JSONB),
        'payment',(SELECT to_jsonb(pa) FROM pliego.pago pa WHERE pa.pedido_id=p.pedido_id),
        'address',(SELECT to_jsonb(d) FROM pliego.pedido_direccion d WHERE d.pedido_id=p.pedido_id),
        'shipment',(SELECT to_jsonb(e) FROM pliego.envio e WHERE e.pedido_id=p.pedido_id),
        'pickup',(SELECT to_jsonb(r) FROM pliego.pedido_retiro r WHERE r.pedido_id=p.pedido_id),
        'orderHistory',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.pedido_estado_historial_id)
            FROM pliego.pedido_estado_historial h WHERE h.pedido_id=p.pedido_id),'[]'::JSONB),
        'shipmentHistory',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.envio_historial_id)
            FROM pliego.envio_historial h JOIN pliego.envio e USING(envio_id)
            WHERE e.pedido_id=p.pedido_id),'[]'::JSONB),
        'confirmation',(SELECT to_jsonb(o) FROM pliego.correo_outbox o
            WHERE o.evento_clave='ORDER_CONFIRMED:'||p.pedido_id))
        FROM pliego.pedido p WHERE p.pedido_id={order}""")
    import json
    return json.loads(raw)


def event_states(order, method):
    return query(f"""SELECT COALESCE(string_agg(datos->>'state',',' ORDER BY correo_id),'')
        FROM pliego.correo_outbox
        WHERE evento_clave LIKE 'ORDER_STATUS:{order}:{method}:%'""")


def main():
    old = start(60)
    try:
        assert query("SELECT count(*)::text||':'||max(version)::integer FROM public.flyway_schema_history WHERE success AND version IS NOT NULL") == '60:60'
        actors, fixture_edition = fixture()
        admin = int(query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' ORDER BY usuario_id LIMIT 1"))
        book, publisher = map(int, query(
            f"SELECT libro_id,editorial_id FROM pliego.edicion WHERE edicion_id={fixture_edition}").split('|'))
        for actor, _ in actors:
            remove_fixture_cart(actor)

        suffix = uuid.uuid4().hex[:12].upper()
        physical = int(query(f"""CALL pliego.sp_edition_create({admin},{book},{publisher},
            'HIST-PHYS-{suffix}',NULL,'es','PAPERBACK',100,NULL,12.00,NULL,NULL,NULL,NULL,NULL)"""))
        query(f"CALL pliego.sp_inventory_entry({admin},{physical},10,'lifecycle upgrade fixture',NULL,NULL,NULL)")
        digital = int(query(f"""CALL pliego.sp_edition_create({admin},{book},{publisher},
            'HIST-EBOOK-{suffix}',NULL,'es','EBOOK',NULL,NULL,18.00,NULL,NULL,NULL,NULL,
            'EPUB',NULL,ARRAY[]::TEXT[],NULL)"""))

        home_actor, home_address = actors[0]
        pickup_actor, _ = actors[1]
        location = int(query("SELECT pickup_location_id FROM pliego.fn_pickup_locations() ORDER BY pickup_location_id LIMIT 1"))
        query(f"CALL pliego.sp_cart_add_item({home_actor},{physical},1,NULL,NULL,NULL)")
        home = checkout(home_actor,'HOME_DELIVERY',home_address)
        query(f"CALL pliego.sp_cart_add_item({pickup_actor},{physical},1,NULL,NULL,NULL)")
        pickup = checkout(pickup_actor,'STORE_PICKUP',pickup=location)

        email = f'lifecycle-upgrade-{suffix.lower()}@example.invalid'
        registered = query(f"""CALL pliego.sp_customer_register('{email}','fixture-hash',
            'Cliente','Digital',NULL,NULL,NULL,NULL)""").split('|')
        digital_actor = int(registered[0])
        query(f"CALL pliego.sp_cart_add_item({digital_actor},{digital},1,NULL,NULL,NULL)")
        digital_order = checkout(digital_actor,'DIGITAL_ONLY')

        orders = {
            'HOME_DELIVERY': (home,home_actor),
            'STORE_PICKUP': (pickup,pickup_actor),
            'DIGITAL': (digital_order,digital_actor),
        }
        before = {method: historical_snapshot(order) for method,(order,_) in orders.items()}
        assert all(snapshot['confirmation'] is not None for snapshot in before.values())
        assert all(snapshot['confirmation']['tipo']=='ORDER_CONFIRMED' for snapshot in before.values())
    finally:
        old.terminate()
        old.wait(timeout=20)

    upgraded = start(62)
    try:
        assert query("SELECT count(*)::text||':'||max(version)::integer FROM public.flyway_schema_history WHERE success AND version IS NOT NULL") == '62:62'
        for method,(order,_) in orders.items():
            assert historical_snapshot(order)==before[method], (method,'historical purchase or confirmation changed during migration')
            assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave LIKE 'ORDER_STATUS:{order}:%'")== '0'

        query(f"""UPDATE pliego.envio SET
            fecha_confirmacion=clock_timestamp()-INTERVAL '10 minutes',
            transito_desde=clock_timestamp()-INTERVAL '8 minutes',
            reparto_desde=clock_timestamp()-INTERVAL '6 minutes',
            entrega_desde=clock_timestamp()-INTERVAL '4 minutes'
            WHERE pedido_id={home}""")
        query(f"UPDATE pliego.pedido SET cancelacion_hasta=clock_timestamp()-INTERVAL '1 second' WHERE pedido_id IN ({pickup},{digital_order})")
        query('CALL pliego.sp_home_delivery_advance_due(100)')

        assert event_states(home,'HOME_DELIVERY')=='IN_TRANSIT,OUT_FOR_DELIVERY,DELIVERED'
        assert event_states(pickup,'STORE_PICKUP')=='PREPARING'
        assert event_states(digital_order,'DIGITAL')=='COMPLETED'
        assert query(f"""SELECT (datos->>'orderId')||'|'||(datos->>'customerEmail')||'|'||
            ((datos->'items')->0->>'originalSubtotal')||'|'||((datos->'items')->0->>'lineSavings')
            FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{home}:HOME_DELIVERY:IN_TRANSIT'""").endswith('|12.00|0.00')
        assert query(f"""SELECT (datos->'pickup'->>'pickupCode') IS NOT NULL AND
            (datos->'pickup'->>'readyAt') IS NOT NULL AND
            (datos->'pickup'->'location'->>'name') IS NOT NULL
            FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{pickup}:STORE_PICKUP:PREPARING'""")=='t'
        assert query(f"""SELECT (datos->>'actionPath')='/orders/{digital_order}' AND
            (datos->'items'->0->>'originalPrice')='18.00'
            FROM pliego.correo_outbox WHERE evento_clave='ORDER_STATUS:{digital_order}:DIGITAL:COMPLETED'""")=='t'

        code = query(f"SELECT codigo FROM pliego.pedido_retiro WHERE pedido_id={pickup}")
        query(f"CALL pliego.sp_pickup_collect({admin},{pickup},'{code}')")
        query(f"CALL pliego.sp_pickup_collect({admin},{pickup},'{code}')")
        assert event_states(pickup,'STORE_PICKUP')=='PREPARING,COLLECTED'
        query('CALL pliego.sp_home_delivery_advance_due(100)')
        assert event_states(home,'HOME_DELIVERY')=='IN_TRANSIT,OUT_FOR_DELIVERY,DELIVERED'
        assert event_states(pickup,'STORE_PICKUP')=='PREPARING,COLLECTED'
        assert event_states(digital_order,'DIGITAL')=='COMPLETED'
        print('V060 → V062 upgrade passed: historical orders and confirmation outbox unchanged; upgraded historical lifecycles catch up once with pricing snapshots')
    finally:
        upgraded.terminate()
        upgraded.wait(timeout=20)


if __name__ == '__main__':
    main()
