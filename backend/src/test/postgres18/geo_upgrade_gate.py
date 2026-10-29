"""V081 -> V082 upgrade gate for complete INEC codes, aliases and preserved legacy rows.

Run only against an empty disposable PostgreSQL 18 database. Set the ordinary
PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD and PLIEGO_DB_* gate variables.
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
    log = Path(f'/tmp/pliego-geo-upgrade-{target}.log')
    jar = Path(__file__).resolve().parents[3] / 'target/pliego-backend-0.1.0-SNAPSHOT.jar'
    env = {**os.environ, 'PLIEGO_MAIL_ENABLED': 'false', 'PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED': 'false',
           'NO_PROXY':'127.0.0.1,localhost','no_proxy':'127.0.0.1,localhost'}
    with log.open('w') as stream:
        process = subprocess.Popen(
            ['java', '-jar', str(jar), '--server.address=127.0.0.1', f'--server.port={port}',
             f'--spring.flyway.target={target}', '--pliego.mail.enabled=false',
             '--pliego.home-delivery.scheduler-enabled=false'],
            env=env, stdout=stream, stderr=stream)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f'Flyway target {target} failed; inspect {log}')
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/v3/api-docs', timeout=2) as response:
                if response.status == 200:
                    return process
        except OSError:
            pass
        time.sleep(.2)
    process.terminate()
    process.wait(timeout=20)
    raise AssertionError(f'Backend target {target} did not become ready; inspect {log}')


def stop(process):
    process.terminate()
    process.wait(timeout=20)


def sql_string(value):
    return "'" + value.replace("'", "''") + "'"


def row_counts():
    return query("""SELECT jsonb_build_object(
        'usuario',(SELECT count(*) FROM pliego.usuario),
        'cliente',(SELECT count(*) FROM pliego.cliente),
        'direccion',(SELECT count(*) FROM pliego.direccion),
        'carrito',(SELECT count(*) FROM pliego.carrito),
        'carrito_item',(SELECT count(*) FROM pliego.carrito_item),
        'inventario',(SELECT count(*) FROM pliego.inventario),
        'movimiento_inventario',(SELECT count(*) FROM pliego.movimiento_inventario),
        'pedido',(SELECT count(*) FROM pliego.pedido),
        'pedido_direccion',(SELECT count(*) FROM pliego.pedido_direccion),
        'pedido_retiro',(SELECT count(*) FROM pliego.pedido_retiro),
        'factura',(SELECT count(*) FROM pliego.factura),
        'factura_direccion',(SELECT count(*) FROM pliego.factura_direccion),
        'factura_item',(SELECT count(*) FROM pliego.factura_item),
        'ubicacion_retiro',(SELECT count(*) FROM pliego.ubicacion_retiro),
        'checkout_attempt',(SELECT count(*) FROM pliego.checkout_attempt),
        'checkout_billing_attempt',(SELECT count(*) FROM pliego.checkout_billing_attempt))::text""")


def ensure_runtime_role():
    if query("SELECT to_regrole('pliego_app') IS NOT NULL") != 't':
        raise AssertionError('Create the production runtime role first, as a superuser: CREATE ROLE pliego_app NOLOGIN')


def address_text_snapshot():
    return query("""SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',direccion_id,'city',ciudad,'province',provincia) ORDER BY direccion_id),'[]'::jsonb)::text
        FROM pliego.direccion""")


def commercial_snapshot(orders):
    ids = ','.join(str(x) for x in orders)
    return query(f"""SELECT jsonb_build_object(
        'delivery',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY pedido_id),'[]'::jsonb)
                    FROM pliego.pedido_direccion d WHERE pedido_id IN ({ids})),
        'pickup',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY pedido_id),'[]'::jsonb)
                  FROM pliego.pedido_retiro r WHERE pedido_id IN ({ids})),
        'invoice',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY factura_id),'[]'::jsonb)
                   FROM pliego.factura_direccion d JOIN pliego.factura f USING(factura_id) WHERE f.pedido_id IN ({ids})))::text""")


def make_order(actor, address, fulfillment, pickup_id=None):
    cart_id = int(query(f'SELECT cart_id FROM pliego.fn_cart_get({actor})'))
    address_sql = 'NULL' if address is None else str(address)
    pickup_sql = 'NULL' if pickup_id is None else str(pickup_id)
    mode = fulfillment
    call = f"""CALL pliego.sp_checkout_billed_quoted({actor},'{uuid.uuid4()}',{address_sql},'TRANSFER','APPROVED',
        {cart_id},'{mode}',{pickup_sql},NULL,'OTHER','EC_CEDULA','0912345675','Comprador de prueba',
        'Dirección fiscal',NULL,'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)"""
    fields = query(call).split('|')
    assert len(fields) == 6 and fields[2] == 'APPROVED', fields
    return int(fields[0])


def main():
    database = os.environ.get('PGDATABASE')
    assert database and database not in {'pliego', 'postgres', 'template0', 'template1'}, \
        'Set PGDATABASE to an empty disposable database; the local pliego database is not an upgrade fixture.'
    assert query('SHOW server_version_num') >= '180000', 'PostgreSQL 18 is required.'
    ensure_runtime_role()
    old = start(81)
    orders = []
    try:
        assert query("SELECT max(version)::integer FROM public.flyway_schema_history WHERE success") == '81'
        # Mirror production's default runtime DML grants so V082 must explicitly remove them for geo data.
        query("ALTER DEFAULT PRIVILEGES IN SCHEMA pliego GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON TABLES TO pliego_app")
        actors, edition = fixture()
        actor_a, address_a = actors[0]
        actor_b, address_b = actors[1]

        # Six rows exercise folded names, canton seats, an official alias, ambiguity, review and the Sevilla Don Bosco seat.
        address_case = int(query(f"CALL pliego.sp_address_create({actor_a},'Legado caso','Cliente legado',"
            f"'Calle caso',NULL,'quIto','pIcHiNcHa','EC',NULL,NULL,'+59325550134',FALSE,NULL)"))
        address_canton = int(query(f"CALL pliego.sp_address_create({actor_a},'Legado cantón','Cliente legado',"
            f"'Calle cantón',NULL,'Rumiñahui','Pichincha','EC',NULL,NULL,'+59325550134',FALSE,NULL)"))
        address_ambiguous = int(query(f"CALL pliego.sp_address_create({actor_a},'Legado ambiguo','Cliente legado',"
            f"'Calle ambigua',NULL,'Bellamaría','El Oro','EC',NULL,NULL,'+59325550134',FALSE,NULL)"))
        address_unmatched = int(query(f"CALL pliego.sp_address_create({actor_a},'Legado sin catálogo','Cliente legado',"
            f"'Calle sin catálogo',NULL,'Ciudad no clasificada','Pichincha','EC',NULL,NULL,'+59325550134',FALSE,NULL)"))
        address_alias = int(query(f"CALL pliego.sp_address_create({actor_a},'Legado alias','Cliente legado',"
            f"'Calle Bucay',NULL,'Bucay','Guayas','EC',NULL,NULL,'+59325550134',FALSE,NULL)"))
        address_sevilla_don_bosco = int(query(f"CALL pliego.sp_address_create({actor_a},'Legado Sevilla Don Bosco','Cliente legado',"
            f"'Calle Sevilla Don Bosco',NULL,'Sevilla Don Bosco','Morona Santiago','EC',NULL,NULL,'+59325550134',FALSE,NULL)"))

        # V082 must include the canonical Sevilla Don Bosco seat and link this V081 legacy pickup text.
        query("""INSERT INTO pliego.ubicacion_retiro(nombre,direccion,ciudad,provincia,pais_codigo,codigo_postal,
            latitud,longitud,zona_horaria,apertura,cierre)
            VALUES('Punto legado geo','Calle legado','Bucay','Guayas','EC',NULL,-0.21,-78.49,
                   'America/Guayaquil','09:00','17:00')""")
        query("""INSERT INTO pliego.ubicacion_retiro(nombre,direccion,ciudad,provincia,pais_codigo,codigo_postal,
            latitud,longitud,zona_horaria,apertura,cierre)
            VALUES('Punto Sevilla Don Bosco','Calle Sevilla Don Bosco','Sevilla Don Bosco','Morona Santiago','EC',NULL,-2.31,-78.12,
                   'America/Guayaquil','09:00','17:00')""")

        # Create delivery and pickup snapshots so V082 preserves each historical text projection.
        admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'"))
        query(f"CALL pliego.sp_inventory_entry({admin},{edition},1,'geo upgrade extra stock',NULL,NULL,NULL)")
        orders.append(make_order(actor_a,address_a,'HOME_DELIVERY'))
        pickup = int(query('SELECT pickup_location_id FROM pliego.fn_pickup_locations() ORDER BY pickup_location_id LIMIT 1'))
        orders.append(make_order(actor_b,None,'STORE_PICKUP',pickup))

        counts_before = row_counts()
        address_text_before = address_text_snapshot()
        snapshots_before = commercial_snapshot(orders)
    finally:
        stop(old)

    current = start(82)
    try:
        assert query("SELECT count(*)::text||':'||max(version)::integer FROM public.flyway_schema_history WHERE success") == '82:82'
        for table in ('pliego.provincia','pliego.ciudad','pliego.ciudad_alias'):
            privileges = query(f"SELECT has_table_privilege('pliego_app','{table}','SELECT')::text||'|'||"
                               f"has_table_privilege('pliego_app','{table}','INSERT')::text||'|'||"
                               f"has_table_privilege('pliego_app','{table}','UPDATE')::text||'|'||"
                               f"has_table_privilege('pliego_app','{table}','DELETE')::text")
            assert privileges == 'true|false|false|false', (table,privileges)
        counts_after = row_counts()
        assert counts_after == counts_before, (counts_before,counts_after)
        assert address_text_snapshot() == address_text_before, 'Legacy address text changed during backfill.'
        assert commercial_snapshot(orders) == snapshots_before, 'Order, invoice or pickup snapshot changed during upgrade.'

        def address_pair(address_id):
            return query(f"""SELECT COALESCE(p.codigo_dpa,'NULL')||'|'||COALESCE(c.codigo_dpa,'NULL')||'|'||
                d.ciudad||'|'||d.provincia FROM pliego.direccion d
                LEFT JOIN pliego.provincia p USING(provincia_id)
                LEFT JOIN pliego.ciudad c USING(provincia_id,ciudad_id)
                WHERE d.direccion_id={address_id}""")

        assert address_pair(address_a).startswith('17|1701|Quito|Pichincha'), address_pair(address_a)
        assert address_pair(address_case).startswith('17|1701|quIto|pIcHiNcHa'), address_pair(address_case)
        assert address_pair(address_canton).startswith('17|1705|Rumiñahui|Pichincha'), address_pair(address_canton)
        assert address_pair(address_alias).startswith('09|0927|Bucay|Guayas'), address_pair(address_alias)
        assert address_pair(address_ambiguous) == 'NULL|NULL|Bellamaría|El Oro', address_pair(address_ambiguous)
        assert address_pair(address_unmatched) == 'NULL|NULL|Ciudad no clasificada|Pichincha', address_pair(address_unmatched)
        assert address_pair(address_sevilla_don_bosco).startswith('14|1413|Sevilla Don Bosco|Morona Santiago'), address_pair(address_sevilla_don_bosco)
        assert query(f"SELECT count(*) FROM pliego.fn_address_list({actor_a}) WHERE city_needs_review") == '2'
        pickup_pair = query("""SELECT p.codigo_dpa||'|'||c.codigo_dpa||'|'||u.ciudad||'|'||u.provincia
            FROM pliego.ubicacion_retiro u JOIN pliego.provincia p USING(provincia_id)
            JOIN pliego.ciudad c USING(provincia_id,ciudad_id) WHERE u.nombre='Punto legado geo'""")
        assert pickup_pair == '09|0927|Bucay|Guayas', pickup_pair
        sevilla_pickup = query("""SELECT p.codigo_dpa||'|'||c.codigo_dpa||'|'||u.ciudad||'|'||u.provincia
            FROM pliego.ubicacion_retiro u JOIN pliego.provincia p USING(provincia_id)
            JOIN pliego.ciudad c USING(provincia_id,ciudad_id) WHERE u.nombre='Punto Sevilla Don Bosco'""")
        assert sevilla_pickup == '14|1413|Sevilla Don Bosco|Morona Santiago', sevilla_pickup
        assert query('SELECT count(*) FROM pliego.ciudad') == '1171'
        assert query("SELECT count(*) FROM pliego.ciudad WHERE tipo='CABECERA_CANTONAL'") == '223'
        assert query("SELECT count(*) FROM pliego.ciudad WHERE tipo='PARROQUIA_RURAL'") == '948'
        assert query('SELECT count(*) FROM pliego.ciudad WHERE activo') == '1048'
        assert query("SELECT count(*) FROM pliego.ciudad_alias") == '278'
        assert query("SELECT count(*) FROM pliego.ciudad WHERE codigo_dpa='1413' AND activo") == '1'
        assert query("SELECT count(*) FROM pliego.ciudad WHERE codigo_dpa='140157' AND NOT activo") == '1'

        # An unlinked legacy address remains deliverable and its order snapshot keeps its stored text.
        admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'"))
        query(f"CALL pliego.sp_inventory_entry({admin},{edition},1,'geo upgrade delivery check',NULL,NULL,NULL)")
        query(f"CALL pliego.sp_cart_add_item({actor_a},{edition},1,NULL,NULL,NULL)")
        legacy_delivery_order = make_order(actor_a,address_unmatched,'HOME_DELIVERY')
        legacy_delivery_snapshot = query(f"SELECT ciudad||'|'||provincia FROM pliego.pedido_direccion WHERE pedido_id={legacy_delivery_order}")
        assert legacy_delivery_snapshot == 'Ciudad no clasificada|Pichincha', legacy_delivery_snapshot

        report = {
            'from': 'V081', 'to': 'V082', 'database': database,
            'provinces': query('SELECT count(*) FROM pliego.provincia'),
            'cities': query('SELECT count(*) FROM pliego.ciudad'),
            'activeCities': query('SELECT count(*) FROM pliego.ciudad WHERE activo'),
            'cantonSeats': query("SELECT count(*) FROM pliego.ciudad WHERE tipo='CABECERA_CANTONAL'"),
            'ruralParishes': query("SELECT count(*) FROM pliego.ciudad WHERE tipo='PARROQUIA_RURAL'"),
            'legacyCustomerAddresses': query('SELECT count(*) FROM pliego.direccion'),
            'customerAddressesLinked': query('SELECT count(*) FROM pliego.direccion WHERE ciudad_id IS NOT NULL'),
            'customerAddressesNeedsReview': query('SELECT count(*) FROM pliego.direccion WHERE ciudad_id IS NULL'),
            'aliases': query('SELECT count(*) FROM pliego.ciudad_alias'),
            'legacyPickupLocations': query('SELECT count(*) FROM pliego.ubicacion_retiro'),
            'legacyPickupLocationsLinked': query('SELECT count(*) FROM pliego.ubicacion_retiro WHERE ciudad_id IS NOT NULL'),
            'legacyPickupLocationsNeedsReview': query('SELECT count(*) FROM pliego.ubicacion_retiro WHERE ciudad_id IS NULL'),
            'testRows': {'caseFold': address_case, 'cantonAlias': address_canton,
                         'ambiguous': address_ambiguous, 'unmatched': address_unmatched,
                         'officialAlias': address_alias, 'sevillaDonBosco': address_sevilla_don_bosco},
            'preservedOrderIds': orders,
            'legacyNullIdDeliveryOrder': legacy_delivery_order,
            'legacyNullIdDeliverySnapshot': legacy_delivery_snapshot,
        }
        print(json.dumps(report,ensure_ascii=False,sort_keys=True))
    finally:
        stop(current)


if __name__ == '__main__':
    main()
