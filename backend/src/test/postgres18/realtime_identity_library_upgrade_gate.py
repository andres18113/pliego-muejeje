"""Actual packaged Flyway V100 -> V104, preserving populated commercial history."""
import json
import os
from checkout_last_unit import fixture, query
from login_attempt_upgrade_gate import migrate, snapshots


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1'
    assert os.environ.get('PGHOST') == '127.0.0.1'
    assert query("SELECT to_regnamespace('pliego') IS NULL") == 't'
    migrate(100)
    actors, _ = fixture()
    actor, address = actors[0]
    query(f"CALL pliego.sp_checkout_idempotent({actor},'{__import__('uuid').uuid4()}',{address},'TRANSFER','APPROVED',NULL,'HOME_DELIVERY',NULL,NULL,NULL,NULL,NULL,NULL)")
    before = snapshots()
    migrate(104)
    # V101..104 add structures/projections, never rewrite existing history.
    after = snapshots()
    assert all(after[name] == value for name,value in before.items())
    assert query('SELECT count(*) FROM pliego.realtime_event') == '0'
    assert query('SELECT count(*) FROM pliego.cliente_identificacion_solicitud_acuse') == '0'
    assert query('SELECT count(*) FROM pliego.registro_intento_limite') == '0'
    print(json.dumps({'upgrade':'100->104','cases_passed':4,'cases_total':4,'existing_tables_preserved':len(before)}))


if __name__ == '__main__':
    main()
