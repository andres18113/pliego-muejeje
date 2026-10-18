"""Normal Flyway67→68 preserves legacy contacts/history; new commands enforce Ecuador scope."""
import json
import subprocess
import uuid

from checkout_last_unit import PSQL, fixture, query
from ecuador_tax_upgrade_gate import start


def rejects(sql):
    result = subprocess.run(PSQL + ['-At', '-c', sql], text=True, capture_output=True, timeout=20)
    assert result.returncode != 0 and 'P1001' in result.stderr, result.stderr


def main():
    old = start(67)
    try:
        actors, edition = fixture()
        admin = query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' ORDER BY usuario_id LIMIT 1")
        query(f"CALL pliego.sp_inventory_entry({admin},{edition},2,'legacy upgrade fixture',NULL,NULL,NULL)")
        for actor, address in actors:
            query(f"CALL pliego.sp_customer_update({actor},'Cliente','Conc','+442079460018')")
            query(f"CALL pliego.sp_address_update({actor},{address},'Casa','Cliente9 Conc','Calle histórica',NULL,'London','London','GB',NULL,NULL,'+442079460018')")
        key = str(uuid.uuid4())
        actor, address = actors[0]
        command = f"CALL pliego.sp_checkout_idempotent({actor},'{key}',{address},'TRANSFER','APPROVED',NULL,'HOME_DELIVERY',NULL,NULL,NULL,NULL,NULL,NULL)"
        result = query(command).splitlines()[0].split('|')
        order = int(result[0])
        order_snapshot = query(f"SELECT jsonb_build_object('address',(SELECT to_jsonb(d) FROM pliego.pedido_direccion d WHERE pedido_id={order}),'money',(SELECT to_jsonb(p) FROM pliego.fn_order_pricing({order}) p),'receipt',(SELECT to_jsonb(r) FROM pliego.checkout_attempt r WHERE actor_user_id={actor} AND attempt_key='{key}'))")
        legacy_addresses = {a: query(f'SELECT to_jsonb(d) FROM pliego.direccion d WHERE direccion_id={d}') for a, d in actors}
    finally:
        old.terminate()
        old.wait(timeout=20)

    new = start(68)
    try:
        assert query("SELECT count(*)||':'||max(version)::integer FROM public.flyway_schema_history WHERE success AND version IS NOT NULL") == '68:68'
        for actor, address in actors:
            assert query(f'SELECT to_jsonb(d) FROM pliego.direccion d WHERE direccion_id={address}') == legacy_addresses[actor]
            assert query(f'SELECT phone FROM pliego.fn_customer_profile_versioned({actor})') == '+442079460018'
            version = query(f'SELECT version FROM pliego.fn_customer_profile_versioned({actor})')
            query(f"CALL pliego.sp_customer_patch({actor},{version},'firstNames','Ana')")
            assert query(f'SELECT phone FROM pliego.fn_customer_profile_versioned({actor})') == '+442079460018'
            version = query(f'SELECT version FROM pliego.fn_customer_profile_versioned({actor})')
            rejects(f"CALL pliego.sp_customer_patch({actor},{version},'phone','+442079460018')")
            query(f'UPDATE pliego.cliente SET telefono=telefono WHERE usuario_id={actor}')
            query(f'UPDATE pliego.direccion SET telefono=telefono,destinatario=destinatario,pais_codigo=pais_codigo WHERE direccion_id={address}')
            # The existing address touch trigger advances its timestamp on UPDATE;
            # recipient/country/phone and every other stored value remain unchanged.
            current_address = json.loads(query(f'SELECT to_jsonb(d) FROM pliego.direccion d WHERE direccion_id={address}'))
            original_address = json.loads(legacy_addresses[actor])
            assert {k: v for k, v in current_address.items() if k != 'fecha_actualizacion'} == {
                k: v for k, v in original_address.items() if k != 'fecha_actualizacion'}
        replay = query(command).splitlines()[0].split('|')
        assert int(replay[0]) == order and replay[3] == result[3]
        assert query(f"SELECT jsonb_build_object('address',(SELECT to_jsonb(d) FROM pliego.pedido_direccion d WHERE pedido_id={order}),'money',(SELECT to_jsonb(p) FROM pliego.fn_order_pricing({order}) p),'receipt',(SELECT to_jsonb(r) FROM pliego.checkout_attempt r WHERE actor_user_id={actors[0][0]} AND attempt_key='{key}'))") == order_snapshot

        actor, address = actors[1]
        before_stock = query(f'SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}')
        rejects(f"CALL pliego.sp_checkout({actor},{address},'TRANSFER','APPROVED',NULL,NULL,NULL,NULL,NULL)")
        assert query(f'SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}') == before_stock
        assert query(f'SELECT count(*) FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}') == '0'
        assert query("SELECT pliego.fn_is_valid_country_code('GB')") == 't'
        print('PASS Flyway67→68: legacy foreign phones/recipient/address/history and replay unchanged; unrelated profile edits succeed; new explicit foreign phone and delivery checkout rejected before persistent effects.')
    finally:
        new.terminate()
        new.wait(timeout=20)


if __name__ == '__main__':
    main()
