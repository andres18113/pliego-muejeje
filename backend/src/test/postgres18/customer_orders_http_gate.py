"""Exercise live CUSTOMER order HTTP routes through Spring JDBC and PostgreSQL 18.

Start the built backend against a disposable migrated database. Set PGHOST,
PGPORT, PGDATABASE, PLIEGO_JWT_SECRET and CHECKOUT_BASE_URL before running.
"""

import json
import os
import urllib.error
import urllib.request

from checkout_http_gate import token
from checkout_last_unit import query
from order_cancel_concurrency import two_item_order


def request(path, actor, method="GET"):
    incoming = urllib.request.Request(
        os.environ["CHECKOUT_BASE_URL"] + path, method=method,
        headers={"Authorization": "Bearer " + token(actor)})
    try:
        with urllib.request.urlopen(incoming, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as response:
        return response.code, json.loads(response.read())


def main():
    required = ("PGHOST", "PGPORT", "PGDATABASE", "PLIEGO_JWT_SECRET", "CHECKOUT_BASE_URL")
    if not all(os.environ.get(key) for key in required):
        raise SystemExit("Set PGHOST, PGPORT, PGDATABASE, PLIEGO_JWT_SECRET, CHECKOUT_BASE_URL")
    actor, order, editions = two_item_order()
    other = int(query(f"SELECT min(usuario_id) FROM pliego.usuario "
                      f"WHERE rol='CUSTOMER' AND usuario_id<>{actor}"))

    status, page = request("/api/v1/orders?page=0&pageSize=1", actor)
    assert status == 200 and page["totalCount"] == "1" and len(page["items"]) == 1, (status, page)
    assert page["items"][0]["orderId"] == str(order)
    assert page["items"][0]["total"] == "18.65"
    assert page["items"][0]["orderState"] == "CONFIRMED"
    status, beyond = request("/api/v1/orders?page=99&pageSize=1", actor)
    assert status == 200 and beyond["items"] == [] and beyond["totalCount"] == "1", (status, beyond)
    status, other_page = request("/api/v1/orders", other)
    assert status == 200 and all(item["orderId"] != str(order) for item in other_page["items"])

    path = "/api/v1/orders/" + str(order)
    status, detail = request(path, actor)
    assert status == 200, (status, detail)
    assert detail["orderId"] == str(order) and detail["subtotal"] == "18.65"
    assert detail["total"] == "18.65" and len(detail["items"]) == 2
    assert {item["unitPrice"] for item in detail["items"]} == {"7.25", "11.40"}
    assert all(isinstance(item["orderItemId"], str) and isinstance(item["editionId"], str)
               for item in detail["items"])
    assert all(item["title"].startswith("Libro Conc") and item["authors"].startswith("Autor Conc")
               for item in detail["items"])
    assert detail["address"]["recipient"] == "Cliente Conc"
    assert detail["address"]["line1"] == "Calle Conc"
    assert isinstance(detail["payment"]["paymentId"], str)
    assert detail["payment"]["state"] == "APPROVED" and detail["payment"]["amount"] == "18.65"
    assert len(detail["stateHistory"]) == 2
    assert all(isinstance(row["historyId"], str) for row in detail["stateHistory"])
    snapshots = (detail["items"], detail["address"])

    status, foreign = request(path, other)
    status_missing, missing = request("/api/v1/orders/9223372036854775807", actor)
    assert status == status_missing == 404
    assert (foreign["code"], foreign["title"], foreign["detail"]) == \
           (missing["code"], missing["title"], missing["detail"])
    assert foreign["code"] == "P5001" and "otro" not in foreign["detail"].lower()
    status, foreign_cancel = request(path + "/cancel", other, "POST")
    assert status == 404 and foreign_cancel["code"] == "P5001"

    status, cancelled = request(path + "/cancel", actor, "POST")
    assert status == 200 and cancelled == {
        "orderId": str(order), "previousState": "CONFIRMED", "orderState": "CANCELLED",
        "paymentState": "REFUNDED", "restoredUnits": 2}, (status, cancelled)
    for edition in editions:
        assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}") == "1"
        assert query(f"SELECT count(*) FROM pliego.movimiento_inventario "
                     f"WHERE pedido_id={order} AND edicion_id={edition} AND tipo='CANCELLATION'") == "1"
    status, after = request(path, actor)
    assert status == 200 and after["orderState"] == "CANCELLED"
    assert after["payment"]["state"] == "REFUNDED" and len(after["stateHistory"]) == 3
    assert after["stateHistory"][-1]["origin"] == "USER"
    assert after["stateHistory"][-1]["actorUserId"] == str(actor)
    assert (after["items"], after["address"]) == snapshots
    status, repeat = request(path + "/cancel", actor, "POST")
    assert status == 409 and repeat["code"] == "P5003"
    print("PostgreSQL 18 HTTP orders gate passed: list/detail, safe 404, cancellation and recovery state")


if __name__ == "__main__":
    main()
