"""Compete ADMIN transition and cancellation transactions on PostgreSQL 18.

Set PGHOST, PGPORT, PGDATABASE and PGUSER for a disposable migrated database.
The two losing calls must wait on the order lock and receive the approved conflict.
"""

import os
import subprocess
import uuid

from checkout_last_unit import PSQL, query, wait_for_activity


def fixture():
    suffix = uuid.uuid4().hex[:12]
    query(f"""
        DO $fixture$
        DECLARE
            v_admin BIGINT; v_author BIGINT; v_publisher BIGINT; v_category BIGINT; v_book BIGINT;
            v_edition BIGINT; v_movement BIGINT; v_before INTEGER; v_after INTEGER;
            v_user BIGINT; v_customer BIGINT; v_state VARCHAR; v_address BIGINT;
            v_cart BIGINT; v_item BIGINT; v_quantity INTEGER;
            v_order BIGINT; v_order_state VARCHAR; v_payment_state VARCHAR;
            v_total NUMERIC; v_reference VARCHAR;
        BEGIN
            INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
            VALUES ('i10-conc-admin-{suffix}@pliego.local','fixture-hash','ADMIN','ACTIVE')
            RETURNING usuario_id INTO v_admin;
            CALL pliego.sp_author_create(v_admin,'Autor I10 {suffix}',NULL,v_author);
            CALL pliego.sp_publisher_create(v_admin,'Editorial I10 {suffix}',NULL,v_publisher);
            CALL pliego.sp_category_create(v_admin,'Categoría I10 {suffix}',
                'i10-conc-{suffix}',NULL,NULL,v_category);
            CALL pliego.sp_book_create(v_admin,'Libro I10 {suffix}',NULL,NULL,
                jsonb_build_array(jsonb_build_object('authorId',v_author,'order',1)),
                jsonb_build_array(v_category),v_book);
            CALL pliego.sp_edition_create(v_admin,v_book,v_publisher,'I10-CONC-{suffix.upper()}',NULL,
                'es','PAPERBACK',100,NULL,7.25,NULL,NULL,NULL,NULL,v_edition);
            CALL pliego.sp_inventory_entry(v_admin,v_edition,2,'fixture',v_movement,v_before,v_after);
            CALL pliego.sp_customer_register('i10-conc-customer-{suffix}@pliego.local','fixture-hash',
                'Cliente','I10',NULL,v_user,v_customer,v_state);
            CALL pliego.sp_address_create(v_user,'Casa','Cliente I10','Calle I10',NULL,
                'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,v_address);
            CALL pliego.sp_cart_add_item(v_user,v_edition,1,v_cart,v_item,v_quantity);
            CALL pliego.sp_checkout(v_user,v_address,'CARD','APPROVED',
                v_order,v_order_state,v_payment_state,v_total,v_reference);
            CALL pliego.sp_cart_add_item(v_user,v_edition,1,v_cart,v_item,v_quantity);
            CALL pliego.sp_checkout(v_user,v_address,'CARD','APPROVED',
                v_order,v_order_state,v_payment_state,v_total,v_reference);
        END;
        $fixture$;
    """)
    row = query(f"""
        SELECT admin.usuario_id,min(p.pedido_id),max(p.pedido_id),min(pi.edicion_id)
        FROM pliego.usuario admin
        JOIN pliego.usuario customer ON customer.email_normalizado=
            'i10-conc-customer-{suffix}@pliego.local'
        JOIN pliego.cliente c ON c.usuario_id=customer.usuario_id
        JOIN pliego.pedido p ON p.cliente_id=c.cliente_id
        JOIN pliego.pedido_item pi ON pi.pedido_id=p.pedido_id
        WHERE admin.email_normalizado='i10-conc-admin-{suffix}@pliego.local'
        GROUP BY admin.usuario_id
    """)
    admin, first_order, cancel_order, edition = map(int, row.split("|"))
    return admin, first_order, cancel_order, edition


def compete_call(winner_name, loser_name, sql, expected_sqlstate, label):
    winner_commands = PSQL + ["-c", "BEGIN", "-c", sql,
                              "-c", "SELECT pg_sleep(4)", "-c", "COMMIT"]
    winner_environment = os.environ.copy()
    winner_environment["PGAPPNAME"] = winner_name
    first_process = subprocess.Popen(winner_commands, env=winner_environment, text=True,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    loser_env = os.environ.copy()
    loser_env["PGAPPNAME"] = loser_name
    loser = PSQL + ["-c", "BEGIN", "-c", sql, "-c", "COMMIT"]
    try:
        wait_for_activity(winner_name, "wait_event='PgSleep'")
        second = subprocess.Popen(loser, env=loser_env, text=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            wait_for_activity(loser_name, "wait_event_type='Lock'")
            _, winner_error = first_process.communicate(timeout=12)
            _, loser_error = second.communicate(timeout=12)
            if first_process.returncode != 0:
                raise AssertionError(f"winning {label} failed: {winner_error}")
            if second.returncode == 0 or expected_sqlstate not in loser_error:
                raise AssertionError(f"losing {label} did not receive {expected_sqlstate}: {loser_error}")
        finally:
            if second.poll() is None:
                second.kill()
                second.communicate()
    finally:
        if first_process.poll() is None:
            first_process.kill()
            first_process.communicate()


def main():
    if not all(os.environ.get(key) for key in ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER")):
        raise SystemExit("Set PGHOST, PGPORT, PGDATABASE and PGUSER for a disposable migrated database")
    admin, transition_order, cancel_order, edition = fixture()

    transition = f"CALL pliego.sp_order_change_status({admin},{transition_order},'PREPARING',NULL,NULL,NULL)"
    compete_call("i10_transition_a", "i10_transition_b",
                 transition, "P5002", "competing admin transition")
    result = query(f"""
        SELECT p.estado,
            (SELECT count(*) FROM pliego.pedido_estado_historial h
             WHERE h.pedido_id=p.pedido_id AND h.origen='USER' AND h.usuario_actor_id={admin}
               AND h.estado_anterior='CONFIRMED' AND h.estado_nuevo='PREPARING'),
            (SELECT count(*) FROM pliego.pedido_estado_historial WHERE pedido_id=p.pedido_id)
        FROM pliego.pedido p WHERE p.pedido_id={transition_order}
    """)
    if result != "PREPARING|1|3":
        raise AssertionError(f"competing transitions persisted invalid state/history: {result}")

    cancel = f"CALL pliego.sp_order_cancel({admin},{cancel_order},NULL,NULL,NULL,NULL,NULL)"
    compete_call("i10_cancel_a", "i10_cancel_b",
                 cancel, "P5003", "competing admin cancellation")
    result = query(f"""
        SELECT p.estado,pa.estado,
            (SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}),
            (SELECT count(*) FROM pliego.movimiento_inventario
             WHERE pedido_id={cancel_order} AND edicion_id={edition} AND tipo='CANCELLATION'),
            (SELECT count(*) FROM pliego.pedido_estado_historial h
             WHERE h.pedido_id=p.pedido_id AND h.origen='USER' AND h.usuario_actor_id={admin}
               AND h.estado_anterior='CONFIRMED' AND h.estado_nuevo='CANCELLED')
        FROM pliego.pedido p JOIN pliego.pago pa ON pa.pedido_id=p.pedido_id
        WHERE p.pedido_id={cancel_order}
    """)
    if result != "CANCELLED|REFUNDED|1|1|1":
        raise AssertionError(f"competing cancellation duplicated or lost effects: {result}")
    try:
        query(f"CALL pliego.sp_order_change_status({admin},{cancel_order},'PREPARING',NULL,NULL,NULL)")
    except subprocess.CalledProcessError as error:
        if "P5002" not in error.stderr:
            raise AssertionError(f"cancelled order transition returned an unexpected failure: {error.stderr}")
    else:
        raise AssertionError("cancelled order accepted a logistics transition")
    result = query(f"SELECT estado,(SELECT count(*) FROM pliego.movimiento_inventario "
                   f"WHERE pedido_id={cancel_order} AND tipo='CANCELLATION') "
                   f"FROM pliego.pedido WHERE pedido_id={cancel_order}")
    if result != "CANCELLED|1":
        raise AssertionError(f"terminal-state recovery mutated cancellation effects: {result}")
    print("PostgreSQL 18 admin concurrency gate passed: one transition, one cancellation, losing calls conflicted")


if __name__ == "__main__":
    main()
