"""Hold real PG transactions open to exercise outcome resolution, fencing and racing writes."""
from concurrent.futures import ThreadPoolExecutor
import subprocess
import uuid

from checkout_last_unit import PSQL, fixture, query


def checkout_sql(actor, address, key):
    return f"CALL pliego.sp_checkout_idempotent({actor},'{key}',{address},'TRANSFER','APPROVED',NULL,NULL,NULL,NULL,NULL,NULL)"


def address_sql(actor, key):
    return f"CALL pliego.sp_address_create_idempotent({actor},'{key}','Trabajo','Cliente','Calle segura',NULL,'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,NULL)"


def hold(command):
    process = subprocess.Popen(PSQL + ["-At"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write("BEGIN;\n" + command + ";\nSELECT 'READY';\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline().strip()
        if line == "READY":
            return process
        if process.poll() is not None:
            raise AssertionError(process.stderr.read())


def finish(process, commit):
    output, error = process.communicate("COMMIT;\n" if commit else "ROLLBACK;\n", timeout=20)
    assert process.returncode == 0, (output, error)


def expect_sqlstate(command, state):
    result = subprocess.run(PSQL + ["-At", "-c", command], text=True, capture_output=True, timeout=20)
    assert result.returncode != 0 and state in result.stderr, (result.returncode, result.stdout, result.stderr)


def resolution_while_open(commit, kind):
    actors, edition = fixture()
    actor, address = actors[0]
    key = str(uuid.uuid4())
    command = checkout_sql(actor, address, key) if kind == "checkout" else address_sql(actor, key)
    resolver = "fn_checkout_resolve" if kind == "checkout" else "fn_address_create_resolve"
    open_transaction = hold(command)
    try:
        assert query(f"SELECT state FROM pliego.{resolver}({actor},'{key}')") == "PENDING"
    finally:
        finish(open_transaction, commit)
    expected = "CREATED" if commit else "NOT_CREATED"
    assert query(f"SELECT state FROM pliego.{resolver}({actor},'{key}')") == expected
    if not commit:
        expect_sqlstate(command, "P1011")
        assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}") == "1"
    else:
        # A different actor with the same UUID sees only their own absent/fenced attempt.
        assert query(f"SELECT state FROM pliego.{resolver}({actors[1][0]},'{key}')") == "NOT_CREATED"
        assert query(f"SELECT state FROM pliego.{resolver}({actor},'{key}')") == "CREATED"


def fence_before_original_arrives(kind):
    actors, _ = fixture()
    actor, address = actors[0]
    key = str(uuid.uuid4())
    resolver = "fn_checkout_resolve" if kind == "checkout" else "fn_address_create_resolve"
    assert query(f"SELECT state FROM pliego.{resolver}({actor},'{key}')") == "NOT_CREATED"
    expect_sqlstate(checkout_sql(actor, address, key) if kind == "checkout" else address_sql(actor, key), "P1011")


def racing_replays(kind):
    actors, edition = fixture()
    actor, address = actors[0]
    key = str(uuid.uuid4())
    command = checkout_sql(actor, address, key) if kind == "checkout" else address_sql(actor, key)
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(query, [command, command]))
    assert replies[0] == replies[1], replies
    if kind == "checkout":
        assert query(f"SELECT count(*) FROM pliego.pedido_item WHERE edicion_id={edition}") == "1"
        assert query(f"SELECT count(*) FROM pliego.movimiento_inventario WHERE edicion_id={edition} AND tipo='SALE'") == "1"
        # A replay must not purchase a later cart even after it has been refilled.
        _, next_edition = fixture()
        query(f"CALL pliego.sp_cart_add_item({actor},{next_edition},1,NULL,NULL,NULL)")
        assert query(command) == replies[0]
        assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={next_edition}") == "1"
    else:
        assert query(f"SELECT count(*) FROM pliego.direccion d JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor} AND d.alias='Trabajo'") == "1"


def racing_profile_updates():
    actors, _ = fixture()
    actor, _ = actors[0]
    version = query(f"SELECT version FROM pliego.fn_customer_profile_versioned({actor})")
    commands = [f"CALL pliego.sp_customer_patch({actor},{version},'firstNames','Nuevo')",
                f"CALL pliego.sp_customer_patch({actor},{version},'phone','+593999123456')"]
    def execute(command):
        return subprocess.run(PSQL + ["-At", "-c", command], text=True, capture_output=True, timeout=20)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(execute, commands))
    assert sum(result.returncode == 0 for result in results) == 1
    assert any("P1104" in result.stderr for result in results)
    assert query(f"SELECT version FROM pliego.fn_customer_profile_versioned({actor})") == str(int(version) + 1)
    # Returning a value to its old spelling cannot revive an old version (ABA).
    query(f"CALL pliego.sp_customer_update({actor},'Cliente','Conc',NULL)")
    expect_sqlstate(commands[0], "P1104")


if __name__ == "__main__":
    for kind in ("checkout", "address"):
        for commit in (True, False):
            resolution_while_open(commit, kind)
        fence_before_original_arrives(kind)
        racing_replays(kind)
        print(kind + ": pending transaction, commit, rollback, delayed arrival, ownership and concurrent replay passed")
    racing_profile_updates()
    print("profile: concurrent compare-and-set and ABA protection passed")
