"""Prove the V020 primary-address replacement is race-safe on PostgreSQL 18.

Set PGHOST, PGPORT, PGDATABASE for a disposable migrated database. Two
independent psql processes call sp_address_set_primary concurrently for two
addresses of one customer. Both calls must succeed (serialized on the cliente
row lock) and exactly one address must remain primary. A repeated call with
the same address must be idempotent.
"""

import os
import subprocess
import uuid

from checkout_last_unit import PSQL, query, wait_for_activity


def fixture():
    suffix = uuid.uuid4().hex[:12]
    query(f"""
    DO $fixture$
    DECLARE v_user BIGINT; v_customer BIGINT; v_state VARCHAR; v_addr BIGINT;
    BEGIN
        CALL pliego.sp_customer_register('i12-addr-{suffix}@pliego.local','fixture-hash',
            'Cliente','Addr',NULL,v_user,v_customer,v_state);
        CALL pliego.sp_address_create(v_user,'Casa','Cliente Addr','Calle 1',NULL,
            'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,v_addr);
        CALL pliego.sp_address_create(v_user,'Oficina','Cliente Addr','Calle 2',NULL,
            'Quito','Pichincha','EC',NULL,NULL,'+59325550135',FALSE,v_addr);
    END;
    $fixture$;
    """)
    row = query(f"""
        SELECT u.usuario_id,
            (SELECT d.direccion_id FROM pliego.direccion d JOIN pliego.cliente c
                ON c.cliente_id=d.cliente_id WHERE c.usuario_id=u.usuario_id AND d.alias='Casa'),
            (SELECT d.direccion_id FROM pliego.direccion d JOIN pliego.cliente c
                ON c.cliente_id=d.cliente_id WHERE c.usuario_id=u.usuario_id AND d.alias='Oficina')
        FROM pliego.usuario u WHERE u.email_normalizado='i12-addr-{suffix}@pliego.local'
    """)
    return tuple(map(int, row.split("|")))


def transaction(user, address, app_name, pause):
    commands = PSQL + ["-c", "BEGIN",
                       "-c", f"CALL pliego.sp_address_set_primary({user},{address})"]
    if pause:
        commands += ["-c", "SELECT pg_sleep(4)"]
    commands += ["-c", "COMMIT"]
    environment = os.environ.copy()
    environment["PGAPPNAME"] = app_name
    return subprocess.Popen(commands, env=environment, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main():
    if not all(os.environ.get(key) for key in ("PGHOST", "PGPORT", "PGDATABASE")):
        raise SystemExit("Set PGHOST, PGPORT and PGDATABASE for a disposable PostgreSQL 18 database")
    user, casa, oficina = fixture()
    first = transaction(user, oficina, "i12_addr_a", pause=True)
    try:
        wait_for_activity("i12_addr_a", "wait_event='PgSleep'")
        second = transaction(user, casa, "i12_addr_b", pause=False)
        try:
            wait_for_activity("i12_addr_b", "wait_event_type='Lock'")
            first_out, first_err = first.communicate(timeout=10)
            second_out, second_err = second.communicate(timeout=10)
            if first.returncode != 0:
                raise AssertionError(f"first set-primary failed: {first_err}")
            if second.returncode != 0:
                raise AssertionError(f"second set-primary failed: {second_err}")
        finally:
            if second.poll() is None:
                second.kill()
                second.communicate()
    finally:
        if first.poll() is None:
            first.kill()
            first.communicate()

    result = query(f"""
        SELECT (SELECT count(*) FROM pliego.direccion d JOIN pliego.cliente c
                    ON c.cliente_id=d.cliente_id
                    WHERE c.usuario_id={user} AND d.es_principal),
               (SELECT d.alias FROM pliego.direccion d JOIN pliego.cliente c
                    ON c.cliente_id=d.cliente_id
                    WHERE c.usuario_id={user} AND d.es_principal)
    """)
    if result != f"1|Casa":
        raise AssertionError(f"primary invariant failed after race: {result}")

    query(f"CALL pliego.sp_address_set_primary({user},{casa})")
    again = query(f"""SELECT count(*) FROM pliego.direccion d JOIN pliego.cliente c
                       ON c.cliente_id=d.cliente_id
                       WHERE c.usuario_id={user} AND d.es_principal""")
    if again != "1":
        raise AssertionError(f"set-primary idempotency failed: {again} primaries")
    print("PostgreSQL 18 address-primary gate passed: concurrent V020 calls serialized, one primary, idempotent")


if __name__ == "__main__":
    main()
