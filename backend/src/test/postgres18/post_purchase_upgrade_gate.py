"""Prepare against Flyway target 32, then verify after upgrade through 34.

Usage: python3 post_purchase_upgrade_gate.py prepare|verify /tmp/snapshot.json
Requires the ordinary disposable PostgreSQL gate environment. The snapshot contains
only generated test fixtures, never development/customer data.
"""
import argparse
import json
import uuid
from pathlib import Path

from checkout_last_unit import fixture, query
from order_cancel_concurrency import two_item_order


def prepare(path):
    assert query("SELECT max(version)::integer FROM public.flyway_schema_history WHERE success") == "32"
    snapshots = []
    for state in ("CONFIRMED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELLED"):
        customer, order, _ = two_item_order()
        admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'"))
        if state == "CANCELLED":
            query(f"CALL pliego.sp_order_cancel({customer},{order},NULL,NULL,NULL,NULL,NULL)")
        else:
            for target in ("PREPARING", "SHIPPED", "DELIVERED"):
                if state == "CONFIRMED":
                    break
                query(f"CALL pliego.sp_order_change_status({admin},{order},'{target}',NULL,NULL,NULL)")
                if target == state:
                    break
        detail = json.loads(query(f"SELECT to_jsonb(d) FROM pliego.fn_customer_order_detail({customer},{order}) d"))
        snapshots.append({"customer": customer, "order": order, "detail": detail,
                          "shipmentState": "PENDING" if state == "CONFIRMED" else state})
    actors, edition = fixture()
    customer, address = actors[0]
    order = int(query(f"CALL pliego.sp_checkout({customer},{address},'TRANSFER','REJECTED',NULL,NULL,NULL,NULL,NULL)").split("|")[0])
    detail = json.loads(query(f"SELECT to_jsonb(d) FROM pliego.fn_customer_order_detail({customer},{order}) d"))
    snapshots.append({"customer": customer, "order": order, "detail": detail, "shipmentState": "CANCELLED"})
    suffix = uuid.uuid4().hex
    query(f"""
        DO $fixture$
        DECLARE a BIGINT; u BIGINT; c BIGINT; d BIGINT; b BIGINT; p BIGINT; e BIGINT;
            cart BIGINT; item BIGINT; qty INTEGER; o BIGINT; state VARCHAR; pay VARCHAR; total NUMERIC; ref VARCHAR;
        BEGIN
            SELECT min(usuario_id) INTO a FROM pliego.usuario WHERE rol='ADMIN';
            SELECT libro_id,editorial_id INTO b,p FROM pliego.edicion WHERE edicion_id={edition};
            CALL pliego.sp_customer_register('upgrade-digital-{suffix}@pliego.local','fixture-hash',
                'Cliente','Digital',NULL,u,c,state);
            CALL pliego.sp_address_create(u,'Casa','Cliente Digital','Calle Digital',NULL,
                'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,d);
            CALL pliego.sp_edition_create(a,b,p,'UPGRADE-DIGITAL-{suffix}',NULL,
                'es','EBOOK',NULL,NULL,10.00,NULL,NULL,NULL,NULL,NULL,NULL,ARRAY[]::TEXT[],e);
            CALL pliego.sp_cart_add_item(u,e,1,cart,item,qty);
            CALL pliego.sp_checkout(u,d,'CARD','APPROVED',o,state,pay,total,ref);
        END; $fixture$;
    """)
    customer, order = map(int, query(f"SELECT c.usuario_id,p.pedido_id FROM pliego.pedido p "
        "JOIN pliego.cliente c USING(cliente_id) JOIN pliego.usuario u USING(usuario_id) "
        f"WHERE u.email_normalizado='upgrade-digital-{suffix}@pliego.local'").split("|"))
    detail = json.loads(query(f"SELECT to_jsonb(d) FROM pliego.fn_customer_order_detail({customer},{order}) d"))
    snapshots.append({"customer": customer, "order": order, "detail": detail, "shipmentState": None})
    path.write_text(json.dumps(snapshots), encoding="utf-8")
    print("Prepared seven historical V032 orders, including digital-only, and stored transition timestamps")


def verify(path):
    assert query("SELECT count(*)::text || ':' || max(version)::integer FROM public.flyway_schema_history WHERE success") == "34:34"
    for snapshot in json.loads(path.read_text(encoding="utf-8")):
        actor, order = snapshot["customer"], snapshot["order"]
        detail = json.loads(query(f"SELECT to_jsonb(d) FROM pliego.fn_customer_order_detail({actor},{order}) d"))
        for key, original in snapshot["detail"].items():
            assert original == detail[key], (order, key, original, detail[key])
        assert detail["invoice"] is None and detail["credit_notes"] == []
        if snapshot["shipmentState"] is None:
            assert detail["shipment"] is None and detail["fulfillment"] is None
            continue
        assert detail["shipment"]["state"] == snapshot["shipmentState"]
        assert detail["fulfillment"] == {"method": "HOME_DELIVERY"}
        assert detail["shipment"]["carrier"] is None
        assert detail["shipment"]["estimatedDeliveryFrom"] is None
        events = detail["shipment"]["history"]
        assert len(events) == len(detail["state_history"])
        assert [event["at"] for event in events] == [event["at"] for event in detail["state_history"]]
        assert all(event["origin"] == "MIGRATION" for event in events)
    print("V032 → V034 upgrade passed: snapshots/history unchanged; known shipment states/times backfilled; no invented documents/tracking")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "verify"))
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    (prepare if args.phase == "prepare" else verify)(args.snapshot)
