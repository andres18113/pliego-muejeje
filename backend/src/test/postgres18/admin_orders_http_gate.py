"""Exercise the ADMIN orders HTTP -> Spring JDBC -> PostgreSQL 18 path.

The backend must already be running with Flyway through V001-V020. Set PGHOST,
PGPORT, PGDATABASE, PGUSER, PLIEGO_JWT_SECRET and CHECKOUT_BASE_URL.
"""

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from admin_order_concurrency import fixture
from checkout_last_unit import query


def encoded(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=")


def token(actor, role):
    now = int(time.time())
    header = encoded({"alg": "HS256", "typ": "JWT"})
    claims = encoded({"iss": "pliego", "aud": "pliego-api", "sub": str(actor),
                      "role": role, "iat": now, "exp": now + 1800,
                      "jti": str(uuid.uuid4())})
    signed = header + b"." + claims
    signature = base64.urlsafe_b64encode(hmac.new(os.environ["PLIEGO_JWT_SECRET"].encode(),
                                                 signed, hashlib.sha256).digest()).rstrip(b"=")
    return (signed + b"." + signature).decode()


def request(path, actor=None, role="ADMIN", method="GET", body=None):
    headers = {}
    data = None
    if actor is not None:
        headers["Authorization"] = "Bearer " + token(actor, role)
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    incoming = urllib.request.Request(os.environ["CHECKOUT_BASE_URL"] + path,
                                      data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(incoming, timeout=10) as response:
            payload = response.read()
            return response.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as response:
        payload = response.read()
        return response.code, json.loads(payload) if payload else None


def main():
    required = ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PLIEGO_JWT_SECRET", "CHECKOUT_BASE_URL")
    if not all(os.environ.get(key) for key in required):
        raise SystemExit("Set PGHOST, PGPORT, PGDATABASE, PGUSER, PLIEGO_JWT_SECRET and CHECKOUT_BASE_URL")

    admin, logistics_order, cancel_order, edition = fixture()
    customer = int(query(f"SELECT c.usuario_id FROM pliego.pedido p "
                         f"JOIN pliego.cliente c ON c.cliente_id=p.cliente_id "
                         f"WHERE p.pedido_id={logistics_order}"))

    status, problem = request("/api/v1/admin/orders")
    assert status == 401 and problem["code"] == "AUTH_REQUIRED", (status, problem)
    status, problem = request("/api/v1/admin/orders", customer, "CUSTOMER")
    assert status == 403 and problem["code"] == "ACCESS_DENIED", (status, problem)

    path = f"/api/v1/admin/orders/{logistics_order}"
    status, detail = request(path, admin)
    assert status == 200, (status, detail)
    assert detail["orderId"] == str(logistics_order)
    assert detail["customerId"] == query(f"SELECT cliente_id FROM pliego.pedido WHERE pedido_id={logistics_order}")
    assert detail["customerEmail"].startswith("i10-conc-customer-")
    assert detail["orderState"] == "CONFIRMED" and detail["total"] == "7.25"
    assert len(detail["items"]) == 1 and detail["items"][0]["title"].startswith("Libro I10 ")
    assert detail["address"]["line1"] == "Calle I10"
    assert detail["payment"]["state"] == "APPROVED" and detail["payment"]["amount"] == "7.25"
    assert len(detail["stateHistory"]) == 2
    assert len(detail["inventoryMovements"]) == 1
    movement = detail["inventoryMovements"][0]
    assert movement["type"] == "SALE" and movement["editionId"] == str(edition)
    assert all(isinstance(detail[key], str) for key in ("orderId", "customerId"))
    assert all(isinstance(detail["items"][0][key], str) for key in ("orderItemId", "editionId"))
    assert isinstance(detail["payment"]["paymentId"], str)
    created_at = detail["createdAt"]
    date_filter = urllib.parse.urlencode({"state": "CONFIRMED", "dateFrom": created_at,
                                          "dateTo": created_at, "customerId": detail["customerId"],
                                          "page": 0, "pageSize": 10})
    status, page = request("/api/v1/admin/orders?" + date_filter, admin)
    assert status == 200 and page["totalCount"] == "2" and len(page["items"]) == 2, (status, page)
    assert {item["orderId"] for item in page["items"]} == {str(logistics_order), str(cancel_order)}
    assert all(item["total"] == "7.25" for item in page["items"])

    status, missing = request("/api/v1/admin/orders/9223372036854775807", admin)
    assert status == 404 and missing["code"] == "P5001"
    assert (missing["title"], missing["detail"]) == (
        "Pedido no encontrado", "El pedido solicitado no existe.")

    status, problem = request(f"/api/v1/admin/orders/{logistics_order}/transitions", admin,
                              method="POST", body={"targetState": "SHIPPED"})
    assert status == 409 and problem["code"] == "P5002", (status, problem)
    assert problem["title"] == "Cambio de estado inválido"
    assert problem["detail"] == "El pedido no puede pasar al estado solicitado desde su estado actual."
    status, unchanged = request(path, admin)
    assert status == 200 and unchanged["orderState"] == "CONFIRMED" and len(unchanged["stateHistory"]) == 2

    for target, previous in (("PREPARING", "CONFIRMED"), ("SHIPPED", "PREPARING"),
                             ("DELIVERED", "SHIPPED")):
        status, result = request(f"/api/v1/admin/orders/{logistics_order}/transitions", admin,
                                 method="POST", body={"targetState": target})
        assert status == 200 and result == {"orderId": str(logistics_order),
                                            "previousState": previous, "orderState": target}, (status, result)
    status, terminal_cancel = request(f"/api/v1/admin/orders/{logistics_order}/cancel", admin, method="POST")
    assert status == 409 and terminal_cancel["code"] == "P5003"
    assert terminal_cancel["detail"] == "El pedido ya no puede cancelarse en su estado actual."
    status, delivered = request(path, admin)
    assert status == 200 and delivered["orderState"] == "DELIVERED" and len(delivered["stateHistory"]) == 5
    assert sum(row["newState"] in ("PREPARING", "SHIPPED", "DELIVERED")
               and row["actorUserId"] == str(admin) for row in delivered["stateHistory"]) == 3

    status, invalid_target = request(f"/api/v1/admin/orders/{cancel_order}/transitions", admin,
                                     method="POST", body={"targetState": "CANCELLED"})
    assert status == 400 and invalid_target["code"] == "VALIDATION_ERROR", (status, invalid_target)
    status, eligible = request(f"/api/v1/admin/orders/{cancel_order}", admin)
    assert status == 200 and eligible["orderState"] == "CONFIRMED"
    status, cancelled = request(f"/api/v1/admin/orders/{cancel_order}/cancel", admin, method="POST")
    assert status == 200 and cancelled == {"orderId": str(cancel_order),
        "previousState": "CONFIRMED", "orderState": "CANCELLED",
        "paymentState": "REFUNDED", "restoredUnits": 1}, (status, cancelled)
    assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}") == "1"
    assert query(f"SELECT count(*) FROM pliego.movimiento_inventario WHERE pedido_id={cancel_order} "
                 f"AND edicion_id={edition} AND tipo='CANCELLATION'") == "1"
    status, recovered = request(f"/api/v1/admin/orders/{cancel_order}", admin)
    assert status == 200 and recovered["orderState"] == "CANCELLED"
    assert recovered["payment"]["state"] == "REFUNDED"
    assert len(recovered["stateHistory"]) == 3
    assert recovered["stateHistory"][-1]["origin"] == "USER"
    assert recovered["stateHistory"][-1]["actorUserId"] == str(admin)
    assert sum(movement["type"] == "CANCELLATION" for movement in recovered["inventoryMovements"]) == 1
    status, repeated = request(f"/api/v1/admin/orders/{cancel_order}/cancel", admin, method="POST")
    assert status == 409 and repeated["code"] == "P5003"
    assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}") == "1"
    beyond_filter = urllib.parse.urlencode({"customerId": detail["customerId"], "page": 99, "pageSize": 1})
    status, beyond = request("/api/v1/admin/orders?" + beyond_filter, admin)
    assert status == 200 and beyond["items"] == [] and beyond["totalCount"] == "2", (status, beyond)
    print("PostgreSQL 18 ADMIN HTTP gate passed: access, filters, detail JSON mapping, logistics and cancellation")


if __name__ == "__main__":
    main()
