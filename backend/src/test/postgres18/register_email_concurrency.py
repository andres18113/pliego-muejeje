"""Prove duplicate public registration races map to P1101 on PostgreSQL 18.

Two independent transactions register the same normalized email. The second
must wait for the first transaction, then fail with the approved duplicate
email SQLSTATE without leaving a partial customer row.
"""

import os
import subprocess
import uuid

from checkout_last_unit import PSQL, query, wait_for_activity


def transaction(email, app_name, pause):
    call = (
        "CALL pliego.sp_customer_register("
        f"'{email}','fixture-hash','Race','Customer',NULL,NULL,NULL,NULL)"
    )
    commands = PSQL + ["-c", "BEGIN", "-c", call]
    if pause:
        commands += ["-c", "SELECT pg_sleep(3)"]
    commands += ["-c", "COMMIT"]
    environment = os.environ.copy()
    environment["PGAPPNAME"] = app_name
    return subprocess.Popen(commands, env=environment, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main():
    if not all(os.environ.get(key) for key in ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER")):
        raise SystemExit("Set PGHOST, PGPORT, PGDATABASE and PGUSER for a disposable migrated database")

    email = f"i14-register-{uuid.uuid4().hex}@pliego.local"
    first = transaction(email, "i14_register_a", pause=True)
    second = None
    try:
        wait_for_activity("i14_register_a", "wait_event='PgSleep'")
        second = transaction(email, "i14_register_b", pause=False)
        wait_for_activity("i14_register_b", "wait_event_type='Lock'")
        _, first_error = first.communicate(timeout=10)
        _, second_error = second.communicate(timeout=10)
        if first.returncode != 0:
            raise AssertionError(f"first registration failed: {first_error}")
        if second.returncode == 0 or "P1101" not in second_error:
            raise AssertionError(f"duplicate registration did not receive P1101: {second_error}")
    finally:
        for process in (second, first):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate()

    persisted = query(f"""
        SELECT count(*),
               (SELECT count(*) FROM pliego.cliente c JOIN pliego.usuario u
                    ON u.usuario_id=c.usuario_id WHERE u.email_normalizado='{email}')
        FROM pliego.usuario WHERE email_normalizado='{email}'
    """)
    if persisted != "1|1":
        raise AssertionError(f"duplicate registration left unexpected rows: {persisted}")
    print("PostgreSQL 18 registration race gate passed: one customer, duplicate mapped to P1101")


if __name__ == "__main__":
    main()
