"""Live customer HTTP/JDBC evidence for source-specific digital access on order lines.

Run only against the disposable PostgreSQL 18 gate database and backend, using
PG*, CHECKOUT_BASE_URL and PLIEGO_JWT_SECRET. The controlled deadline update
affects only the digital order created here; all purchases use billed HTTP checkout.
"""

import json
import os
import re
import urllib.error
import urllib.request
import uuid

from admin_orders_http_gate import token
from checkout_billing import billed
from checkout_last_unit import fixture, query


def request(path, actor=None, method="GET", body=None, role="CUSTOMER", expected=200):
    headers = {}
    if actor is not None:
        headers["Authorization"] = "Bearer " + token(actor, role)
    if body is not None:
        headers["Content-Type"] = "application/json"
        headers["Idempotency-Key"] = str(uuid.uuid4())
    outgoing = urllib.request.Request(
        os.environ["CHECKOUT_BASE_URL"] + path, method=method, headers=headers,
        data=None if body is None else json.dumps(body).encode())
    try:
        response = urllib.request.urlopen(outgoing, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read()
        payload = json.loads(raw) if raw else None
        assert response.status == expected, (path, response.status, payload)
        return payload


def order_fixture(kind):
    actors, physical = fixture()
    actor, address = actors[0]
    admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'"))
    digital = []
    if kind != "physical":
        book, publisher = query(f"SELECT libro_id,editorial_id FROM pliego.edicion WHERE edicion_id={physical}").split("|")
        for media, metadata in (("EBOOK", "'EPUB',NULL,ARRAY[]::TEXT[]"),
                                ("AUDIOBOOK", "NULL,3600,ARRAY['Voz sintética']::TEXT[]")):
            edition = query(f"CALL pliego.sp_edition_create({admin},{book},{publisher},"
                            f"'POST-{media}-{uuid.uuid4().hex.upper()}',NULL,'es','{media}',NULL,NULL,10,"
                            f"NULL,NULL,NULL,NULL,{metadata},NULL)")
            request("/api/v1/cart/items", actor, "POST", {"editionId": edition, "quantity": 1})
            digital.append(edition)
    if kind == "digital":
        cart = request("/api/v1/cart", actor)
        physical_item = next(item["cartItemId"] for item in cart["items"] if item["editionId"] == str(physical))
        request("/api/v1/cart/items/" + physical_item, actor, "DELETE", expected=204)
    return dict(actor=actor, other=actors[1][0], address=address, physical=str(physical),
                digital=digital, admin=admin, kind=kind)


def checkout(data, outcome="APPROVED", fulfillment=None, pickup=None):
    mode = fulfillment or ("DIGITAL_ONLY" if data["kind"] == "digital" else "HOME_DELIVERY")
    payload = dict(fulfillmentMethod=mode, paymentMethod="TRANSFER", simulationOutcome=outcome)
    if mode == "HOME_DELIVERY":
        payload["addressId"] = str(data["address"])
    elif mode == "STORE_PICKUP":
        payload["pickupLocationId"] = pickup
    receipt = request("/api/v1/checkout", data["actor"], "POST", billed(payload), expected=201)
    assert receipt["paymentState"] == outcome, receipt
    return receipt["orderId"]


def detail(data, order, state, payment=None):
    result = request("/api/v1/orders/" + order, data["actor"])
    assert result["orderId"] == order and result["items"], result
    if payment is not None:
        assert result["payment"]["state"] == payment, result
    owned = {}
    for line in result["items"]:
        assert "digitalAccess" in line, line
        if line["format"] in ("PAPERBACK", "HARDCOVER"):
            assert line["requiresPhysicalFulfillment"] is True and line["digitalAccess"] is None, line
            assert line["editionId"] == data["physical"], line
        else:
            assert line["format"] in ("EBOOK", "AUDIOBOOK") and line["requiresPhysicalFulfillment"] is False, line
            access = line["digitalAccess"]
            assert set(access) == {"state", "ownedItemId"} and access["state"] == state, line
            if state == "AVAILABLE":
                item_id = access["ownedItemId"]
                assert isinstance(item_id, str) and re.fullmatch("[1-9][0-9]*", item_id), access
                library = request("/api/v1/me/library/" + item_id, data["actor"])
                assert library["editionId"] == line["editionId"] and library["ownershipState"] == "OWNED", library
                assert any(source["orderId"] == order and source["grantState"] == "ACTIVE"
                           for source in library["sourcePurchases"]), library
                owned[line["editionId"]] = item_id
            else:
                assert access["ownedItemId"] is None, access
    assert {line["editionId"] for line in result["items"] if not line["requiresPhysicalFulfillment"]} == set(data["digital"]), result
    assert sum(line["requiresPhysicalFulfillment"] for line in result["items"]) == (data["kind"] != "digital"), result
    return result, owned


def cancel(data, order):
    result = request("/api/v1/orders/" + order + "/cancel", data["actor"], "POST", {})
    assert result["orderState"] == "CANCELLED", result


def nullable(schema):
    value = schema.get("type")
    return schema.get("nullable") is True or value == "null" or (
        isinstance(value, list) and "null" in value) or any(
            nullable(branch) for keyword in ("anyOf", "oneOf") for branch in schema.get(keyword, []))


def main():
    required = ("PGHOST", "PGPORT", "PGDATABASE", "CHECKOUT_BASE_URL", "PLIEGO_JWT_SECRET")
    if not all(os.environ.get(key) for key in required):
        raise SystemExit("Set PGHOST, PGPORT, PGDATABASE, CHECKOUT_BASE_URL and PLIEGO_JWT_SECRET")
    schemas = request("/v3/api-docs")["components"]["schemas"]
    item_schema = schemas["CustomerOrderItem"]
    assert "digitalAccess" in item_schema["required"], item_schema
    access_schema = item_schema["properties"]["digitalAccess"]
    assert set(access_schema["type"]) == {"object", "null"} and "$ref" not in access_schema, access_schema
    assert set(access_schema["required"]) >= {"state", "ownedItemId"}, access_schema
    assert set(access_schema["properties"]["state"]["enum"]) == {
        "PENDING_PAYMENT", "AVAILABLE", "REVOKED", "UNAVAILABLE"}, access_schema
    assert nullable(access_schema["properties"]["ownedItemId"]), access_schema

    physical = order_fixture("physical")
    physical_order = checkout(physical)
    detail(physical, physical_order, "AVAILABLE", "APPROVED")

    digital = order_fixture("digital")
    digital_order = checkout(digital)
    current, initial_owned = detail(digital, digital_order, "AVAILABLE", "APPROVED")
    assert current["fulfillment"] is None and current["shipment"] is None and current["address"] is None, current
    unauthorized = request("/api/v1/orders/" + digital_order, expected=401)
    assert unauthorized["code"] == "AUTH_REQUIRED", unauthorized
    other = request("/api/v1/orders/" + digital_order, digital["other"], expected=404)
    assert other["code"] == "P5001" and "digitalAccess" not in other, other

    # A cancelled source stays revoked even when the same ownership is reacquired.
    mixed = order_fixture("mixed")
    mixed_order = checkout(mixed)
    current, original_owned = detail(mixed, mixed_order, "AVAILABLE", "APPROVED")
    assert current["fulfillment"]["method"] == "HOME_DELIVERY" and current["shipment"] is not None, current
    cancel(mixed, mixed_order)
    detail(mixed, mixed_order, "REVOKED", "REFUNDED")
    for edition in mixed["digital"]:
        request("/api/v1/cart/items", mixed["actor"], "POST", {"editionId": edition, "quantity": 1})
    request("/api/v1/cart/items", mixed["actor"], "POST", {"editionId": mixed["physical"], "quantity": 1})
    repurchase = checkout(mixed)
    _, reacquired = detail(mixed, repurchase, "AVAILABLE", "APPROVED")
    assert reacquired == original_owned, (original_owned, reacquired)
    detail(mixed, mixed_order, "REVOKED", "REFUNDED")

    pickup = next(location["id"] for location in request("/api/v1/pickup-locations") if location["active"])
    collected = order_fixture("mixed")
    pickup_order = checkout(collected, fulfillment="STORE_PICKUP", pickup=pickup)
    current, _ = detail(collected, pickup_order, "AVAILABLE", "APPROVED")
    assert current["fulfillment"]["method"] == "STORE_PICKUP" and current["shipment"] is None, current

    pending = order_fixture("mixed")
    pending_order = checkout(pending, "PENDING")
    detail(pending, pending_order, "PENDING_PAYMENT", "PENDING")
    request(f"/api/v1/admin/orders/{pending_order}/approve-payment", pending["admin"],
            "POST", role="ADMIN", expected=204)
    detail(pending, pending_order, "AVAILABLE", "APPROVED")

    pending_cancel = order_fixture("mixed")
    pending_cancel_order = checkout(pending_cancel, "PENDING")
    detail(pending_cancel, pending_cancel_order, "PENDING_PAYMENT", "PENDING")
    cancel(pending_cancel, pending_cancel_order)
    detail(pending_cancel, pending_cancel_order, "UNAVAILABLE")
    assert request("/api/v1/me/library", pending_cancel["actor"])["items"] == []

    rejected = order_fixture("mixed")
    rejected_order = checkout(rejected, "REJECTED")
    detail(rejected, rejected_order, "UNAVAILABLE", "REJECTED")
    assert request("/api/v1/me/library", rejected["actor"])["items"] == []

    # Controlled time travel of this fixture; authenticated detail performs real reconciliation.
    query(f"UPDATE pliego.pedido SET cancelacion_hasta=clock_timestamp()-INTERVAL '1 second' "
          f"WHERE pedido_id={int(digital_order)}")
    completed, completed_owned = detail(digital, digital_order, "AVAILABLE", "APPROVED")
    assert completed["purchaseState"] == "COMPLETED" and completed_owned == initial_owned, completed

    print("Post-purchase digital HTTP passed: canonical required/nullable contract, physical null, "
          "EBOOK+AUDIOBOOK source-specific AVAILABLE/PENDING_PAYMENT/REVOKED/UNAVAILABLE, "
          "mixed delivery/pickup, cancellation/repurchase, approval, rejection, authorization and finalization.")


if __name__ == "__main__":
    main()
