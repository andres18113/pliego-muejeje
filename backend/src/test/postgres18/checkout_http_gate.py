"""Exercise the built HTTP → Spring transaction → JDBC → PostgreSQL 18 path.

Start the backend against a disposable migrated database. Set PGHOST, PGPORT,
PGDATABASE, PLIEGO_JWT_SECRET and CHECKOUT_BASE_URL before running.
"""

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
import uuid

from checkout_last_unit import fixture, query


def encoded(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=")


def token(actor):
    now = int(time.time())
    header = encoded({"alg": "HS256", "typ": "JWT"})
    claims = encoded({"iss": "pliego", "aud": "pliego-api", "sub": str(actor),
                      "role": "CUSTOMER", "iat": now, "exp": now + 1800,
                      "jti": str(uuid.uuid4())})
    signed = header + b"." + claims
    signature = base64.urlsafe_b64encode(hmac.new(os.environ["PLIEGO_JWT_SECRET"].encode(),
                                                 signed, hashlib.sha256).digest()).rstrip(b"=")
    return (signed + b"." + signature).decode()


def checkout(actor, address, method, outcome, card=None):
    body = {"addressId": str(address), "paymentMethod": method,
            "simulationOutcome": outcome}
    if card is not None:
        body["cardNumber"] = card
    request = urllib.request.Request(
        os.environ["CHECKOUT_BASE_URL"] + "/api/v1/checkout",
        data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": "Bearer " + token(actor),
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.headers, json.loads(response.read())
    except urllib.error.HTTPError as response:
        return response.code, response.headers, json.loads(response.read())


def main():
    required = ("PGHOST", "PGPORT", "PGDATABASE", "PLIEGO_JWT_SECRET", "CHECKOUT_BASE_URL")
    if not all(os.environ.get(key) for key in required):
        raise SystemExit("Set PGHOST, PGPORT, PGDATABASE, PLIEGO_JWT_SECRET, CHECKOUT_BASE_URL")

    actors, edition = fixture()
    actor, address = actors[0]
    status, _, problem = checkout(actor, address, "CARD", "APPROVED", "4242424242424241")
    assert status == 400 and problem["title"] == "Tarjeta inválida", (status, problem)
    assert "4242424242424241" not in json.dumps(problem)
    assert query(f"SELECT count(*) FROM pliego.pedido_item WHERE edicion_id={edition}") == "0"

    status, headers, result = checkout(actor, address, "CARD", "APPROVED", "4242424242424242")
    assert status == 201, (status, result)
    assert headers["Location"] == "/api/v1/orders/" + result["orderId"]
    assert result["orderState"] == "CONFIRMED" and result["paymentState"] == "APPROVED"
    assert result["total"] == "7.25" and result["paymentReference"].startswith("SIM-")
    assert "cardNumber" not in result and "4242424242424242" not in json.dumps(result)
    assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition}") == "0"
    assert query(f"SELECT count(*) FROM pliego.movimiento_inventario WHERE edicion_id={edition} AND tipo='SALE'") == "1"

    rejected_actors, rejected_edition = fixture()
    actor, address = rejected_actors[0]
    status, headers, result = checkout(actor, address, "TRANSFER", "REJECTED")
    assert status == 201, (status, result)
    assert headers["Location"] == "/api/v1/orders/" + result["orderId"]
    assert result["orderState"] == "CANCELLED" and result["paymentState"] == "REJECTED"
    assert result["total"] == "7.25" and result["paymentReference"] is None
    assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={rejected_edition}") == "1"
    assert query(f"SELECT count(*) FROM pliego.movimiento_inventario WHERE edicion_id={rejected_edition} AND tipo='SALE'") == "0"
    print("PostgreSQL 18 HTTP gate passed: CARD validation, APPROVED, REJECTED, Location, exact total, persisted effects")


if __name__ == "__main__":
    main()
