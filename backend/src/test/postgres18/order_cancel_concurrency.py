"""Compete two cancellation transactions on one two-item PostgreSQL 18 order.

Set PGHOST, PGPORT, PGDATABASE for a disposable migrated database. The losing
transaction must wait for the Pedido lock and then receive P5003.
"""

import os
import subprocess
import uuid

from checkout_last_unit import PSQL, fixture, query, wait_for_activity


def two_item_order():
    actors, first_edition = fixture()
    second_sku = "I9-CONC-" + uuid.uuid4().hex[:12].upper()
    query(f"""
        DO $fixture$
        DECLARE
            v_admin BIGINT; v_book BIGINT; v_pub BIGINT; v_ed BIGINT;
            v_mov BIGINT; v_before INTEGER; v_after INTEGER;
            v_cart BIGINT; v_item BIGINT; v_qty INTEGER;
        BEGIN
            INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
            VALUES ('{second_sku.lower()}@pliego.local','fixture-hash','ADMIN','ACTIVE')
            RETURNING usuario_id INTO v_admin;
            SELECT libro_id,editorial_id INTO v_book,v_pub
            FROM pliego.edicion WHERE edicion_id={first_edition};
            CALL pliego.sp_edition_create(v_admin,v_book,v_pub,'{second_sku}',NULL,
                'es','HARDCOVER',100,NULL,11.40,NULL,NULL,NULL,NULL,v_ed);
            CALL pliego.sp_inventory_entry(v_admin,v_ed,1,'fixture',v_mov,v_before,v_after);
            CALL pliego.sp_cart_add_item({actors[0][0]},v_ed,1,v_cart,v_item,v_qty);
            CALL pliego.sp_cart_add_item({actors[1][0]},v_ed,1,v_cart,v_item,v_qty);
        END;
        $fixture$;
    """)
    second_edition = int(query(f"SELECT edicion_id FROM pliego.edicion WHERE sku='{second_sku}'"))
    actor, address = actors[0]
    order = int(query(f"CALL pliego.sp_checkout({actor},{address},'CARD','APPROVED',"
                      "NULL,NULL,NULL,NULL,NULL)").split("|")[0])
    return actor, order, (first_edition, second_edition)


def transaction(actor, order, name, pause):
    commands = PSQL + ["-c", "BEGIN",
                       "-c", f"CALL pliego.sp_order_cancel({actor},{order},NULL,NULL,NULL,NULL,NULL)"]
    if pause:
        commands += ["-c", "SELECT pg_sleep(4)"]
    commands += ["-c", "COMMIT"]
    environment = os.environ.copy()
    environment["PGAPPNAME"] = name
    return subprocess.Popen(commands, env=environment, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main():
    if not all(os.environ.get(key) for key in ("PGHOST", "PGPORT", "PGDATABASE")):
        raise SystemExit("Set PGHOST, PGPORT and PGDATABASE for a disposable PostgreSQL 18 database")
    actor, order, editions = two_item_order()
    snapshots_before = query(f"SELECT items::text || '|' || address::text "
                             f"FROM pliego.fn_customer_order_detail({actor},{order})")
    first = transaction(actor, order, "i9_cancel_a", pause=True)
    try:
        wait_for_activity("i9_cancel_a", "wait_event='PgSleep'")
        second = transaction(actor, order, "i9_cancel_b", pause=False)
        try:
            wait_for_activity("i9_cancel_b", "wait_event_type='Lock'")
            _, first_error = first.communicate(timeout=10)
            _, second_error = second.communicate(timeout=10)
            if first.returncode != 0:
                raise AssertionError(f"winning cancellation failed: {first_error}")
            if second.returncode == 0 or "P5003" not in second_error:
                raise AssertionError(f"losing cancellation did not receive P5003: {second_error}")
        finally:
            if second.poll() is None:
                second.kill()
                second.communicate()
    finally:
        if first.poll() is None:
            first.kill()
            first.communicate()

    snapshots_after = query(f"SELECT items::text || '|' || address::text "
                            f"FROM pliego.fn_customer_order_detail({actor},{order})")
    if snapshots_before != snapshots_after:
        raise AssertionError("cancellation changed immutable snapshots")
    result = query(f"""
        SELECT p.estado,pa.estado,
            (SELECT count(*) FROM pliego.movimiento_inventario m
             WHERE m.pedido_id={order} AND m.tipo='SALE'),
            (SELECT count(*) FROM pliego.movimiento_inventario m
             WHERE m.pedido_id={order} AND m.tipo='CANCELLATION'),
            (SELECT count(*) FROM pliego.movimiento_inventario m
             WHERE m.pedido_id={order} AND m.tipo='CANCELLATION'
               AND m.edicion_id={editions[0]}),
            (SELECT count(*) FROM pliego.movimiento_inventario m
             WHERE m.pedido_id={order} AND m.tipo='CANCELLATION'
               AND m.edicion_id={editions[1]}),
            (SELECT stock_actual FROM pliego.inventario WHERE edicion_id={editions[0]}),
            (SELECT stock_actual FROM pliego.inventario WHERE edicion_id={editions[1]}),
            (SELECT count(*) FROM pliego.pedido_estado_historial h
             WHERE h.pedido_id={order} AND h.origen='USER' AND h.usuario_actor_id={actor}
               AND h.estado_anterior='CONFIRMED' AND h.estado_nuevo='CANCELLED')
        FROM pliego.pedido p JOIN pliego.pago pa ON pa.pedido_id=p.pedido_id
        WHERE p.pedido_id={order}
    """)
    if result != "CANCELLED|REFUNDED|2|2|1|1|1|1|1":
        raise AssertionError(f"double-cancellation persisted invariant failed: {result}")
    print("PostgreSQL 18 double-cancellation gate passed: one winner, loser P5003, two restorations once each")


if __name__ == "__main__":
    main()
