"""Run with PGHOST, PGPORT, PGDATABASE set for a disposable PostgreSQL 18 database.

The fixture uses public routines. Two independent psql processes execute competing
transactions. Direct table reads verify the persisted last-unit invariant.
"""

import os
import subprocess
import time
import uuid


PSQL = ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]


def query(sql, app_name=None):
    environment = os.environ.copy()
    if app_name:
        environment["PGAPPNAME"] = app_name
    result = subprocess.run(PSQL + ["-At", "-c", sql], env=environment,
                            text=True, capture_output=True, check=True)
    return result.stdout.strip()


def fixture():
    suffix = uuid.uuid4().hex[:12]
    sql = f"""
    DO $fixture$
    DECLARE
        v_admin BIGINT; v_author BIGINT; v_pub BIGINT; v_cat BIGINT; v_book BIGINT;
        v_ed BIGINT; v_mov BIGINT; v_before INTEGER; v_after INTEGER;
        v_user BIGINT; v_customer BIGINT; v_state VARCHAR;
        v_addr BIGINT; v_cart BIGINT; v_item BIGINT; v_qty INTEGER;
    BEGIN
        INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
        VALUES ('i8-conc-admin-{suffix}@pliego.local','fixture-hash','ADMIN','ACTIVE')
        RETURNING usuario_id INTO v_admin;
        CALL pliego.sp_author_create(v_admin,'Autor Conc {suffix}',NULL,v_author);
        CALL pliego.sp_publisher_create(v_admin,'Editorial Conc {suffix}',NULL,v_pub);
        CALL pliego.sp_category_create(v_admin,'Categoría Conc {suffix}',
            'i8-conc-{suffix}',NULL,NULL,v_cat);
        CALL pliego.sp_book_create(v_admin,'Libro Conc {suffix}',NULL,NULL,
            jsonb_build_array(jsonb_build_object('authorId',v_author,'order',1)),
            jsonb_build_array(v_cat),v_book);
        CALL pliego.sp_edition_create(v_admin,v_book,v_pub,'I8-CONC-{suffix}',NULL,
            'es','PAPERBACK',100,NULL,7.25,NULL,NULL,NULL,NULL,v_ed);
        CALL pliego.sp_inventory_entry(v_admin,v_ed,1,'fixture',v_mov,v_before,v_after);
        FOR v_qty IN 1..2 LOOP
            CALL pliego.sp_customer_register(
                'i8-conc-' || v_qty || '-{suffix}@pliego.local','fixture-hash',
                'Cliente','Conc',NULL,v_user,v_customer,v_state);
            CALL pliego.sp_address_create(v_user,'Casa','Cliente Conc','Calle Conc',NULL,
                'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,v_addr);
            CALL pliego.sp_cart_add_item(v_user,v_ed,1,v_cart,v_item,v_qty);
        END LOOP;
    END;
    $fixture$;
    """
    query(sql)
    actors = []
    for customer in (1, 2):
        row = query(f"""
            SELECT u.usuario_id,d.direccion_id
            FROM pliego.usuario u JOIN pliego.cliente c ON c.usuario_id=u.usuario_id
            JOIN pliego.direccion d ON d.cliente_id=c.cliente_id
            WHERE u.email_normalizado='i8-conc-{customer}-{suffix}@pliego.local'
        """)
        actors.append(tuple(map(int, row.split("|"))))
    edition = int(query(f"SELECT edicion_id FROM pliego.edicion WHERE sku='I8-CONC-{suffix.upper()}'"))
    return actors, edition


def transaction(actor, address, app_name, pause):
    commands = PSQL + ["-c", "BEGIN",
                       "-c", f"CALL pliego.sp_checkout({actor},{address},'CARD','APPROVED',NULL,NULL,NULL,NULL,NULL)"]
    if pause:
        commands += ["-c", "SELECT pg_sleep(4)"]
    commands += ["-c", "COMMIT"]
    environment = os.environ.copy()
    environment["PGAPPNAME"] = app_name
    return subprocess.Popen(commands, env=environment, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def wait_for_activity(app_name, predicate, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        count = int(query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app_name}' AND {predicate}"))
        if count:
            return
        time.sleep(0.1)
    raise AssertionError(f"{app_name} did not reach expected PostgreSQL wait state")


def main():
    if not all(os.environ.get(key) for key in ("PGHOST", "PGPORT", "PGDATABASE")):
        raise SystemExit("Set PGHOST, PGPORT and PGDATABASE for a disposable PostgreSQL 18 database")
    actors, edition = fixture()
    first = transaction(*actors[0], "i8_checkout_a", pause=True)
    try:
        wait_for_activity("i8_checkout_a", "wait_event='PgSleep'")
        second = transaction(*actors[1], "i8_checkout_b", pause=False)
        try:
            wait_for_activity("i8_checkout_b", "wait_event_type='Lock'")
            first_out, first_err = first.communicate(timeout=10)
            second_out, second_err = second.communicate(timeout=10)
            if first.returncode != 0:
                raise AssertionError(f"winning transaction failed: {first_err}")
            if second.returncode == 0 or "P3002" not in second_err:
                raise AssertionError(f"losing transaction did not fail with P3002: {second_err}")
        finally:
            if second.poll() is None:
                second.kill()
                second.communicate()
    finally:
        if first.poll() is None:
            first.kill()
            first.communicate()

    result = query(f"""
        SELECT
            (SELECT count(*) FROM pliego.pedido p JOIN pliego.cliente c
                ON c.cliente_id=p.cliente_id
                WHERE c.usuario_id IN ({actors[0][0]},{actors[1][0]})),
            (SELECT count(*) FROM pliego.pago pay JOIN pliego.pedido p
                ON p.pedido_id=pay.pedido_id JOIN pliego.cliente c
                ON c.cliente_id=p.cliente_id
                WHERE c.usuario_id IN ({actors[0][0]},{actors[1][0]})),
            (SELECT count(*) FROM pliego.pedido_item WHERE edicion_id={edition}),
            (SELECT count(*) FROM pliego.pedido_item pi JOIN pliego.pedido p
                ON p.pedido_id=pi.pedido_id WHERE pi.edicion_id={edition} AND p.estado='CONFIRMED'),
            (SELECT count(*) FROM pliego.movimiento_inventario
                WHERE edicion_id={edition} AND tipo='SALE'),
            (SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}),
            (SELECT count(*) FROM pliego.inventario WHERE edicion_id={edition} AND stock_actual<0),
            (SELECT count(*) FROM pliego.carrito ca JOIN pliego.cliente c
                ON c.cliente_id=ca.cliente_id
                WHERE c.usuario_id IN ({actors[0][0]},{actors[1][0]}) AND ca.estado='CHECKED_OUT'),
            (SELECT count(*) FROM pliego.carrito ca JOIN pliego.cliente c
                ON c.cliente_id=ca.cliente_id
                WHERE c.usuario_id IN ({actors[0][0]},{actors[1][0]}) AND ca.estado='ACTIVE')
    """)
    if result != "1|1|1|1|1|0|0|1|1":
        raise AssertionError(f"last-unit persisted invariant failed: {result}")
    print("PostgreSQL 18 last-unit gate passed: one checkout, one SALE, stock 0, no negative stock; loser P3002")


if __name__ == "__main__":
    main()
