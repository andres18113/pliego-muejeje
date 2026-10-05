"""Real HTTP regressions for replay and stale field writes; usable against the pre-fix build."""
import json
import os
import urllib.error
import urllib.request
import uuid

from checkout_http_gate import token
from checkout_last_unit import fixture, query


def request(actor, path, method="GET", body=None, key=None):
    headers = {"Authorization": "Bearer " + token(actor)}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if key:
        headers["Idempotency-Key"] = key
    incoming = urllib.request.Request(os.environ["CHECKOUT_BASE_URL"] + path,
        data=None if body is None else json.dumps(body).encode(), method=method, headers=headers)
    try:
        response = urllib.request.urlopen(incoming, timeout=20)
    except urllib.error.HTTPError as failure:
        response = failure
    with response:
        raw = response.read()
        return response.status, json.loads(raw) if raw else None


def address_replay():
    actors, _ = fixture()
    actor, _ = actors[0]
    key = str(uuid.uuid4())
    body = {"alias": "Trabajo", "recipient": "Cliente Conc", "line1": "Calle Reintento",
            "line2": None, "city": "Quito", "province": "Pichincha", "countryCode": "EC",
            "postalCode": None, "reference": None, "phone": "+59325550134", "makePrimary": True}
    first_status, first = request(actor, "/api/v1/me/addresses", "POST", body, key)
    second_status, second = request(actor, "/api/v1/me/addresses", "POST", body, key)
    assert first_status == second_status == 201, (first_status, second_status, first, second)
    assert first["addressId"] == second["addressId"], "Replaying a lost successful address response created a duplicate"
    count = query(f"SELECT count(*) FROM pliego.direccion d JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor} AND d.alias='Trabajo'")
    assert count == "1", count
    status, problem = request(actor, "/api/v1/me/addresses", "POST", {**body, "line1": "Otro lugar"}, key)
    assert status == 409 and problem["code"] == "P1010", (status, problem)
    request(actor, f'/api/v1/me/addresses/{first["addressId"]}', "DELETE")
    status, replay = request(actor, "/api/v1/me/addresses", "POST", body, key)
    assert status == 201 and replay == first, (status, replay)
    assert query(f"SELECT count(*) FROM pliego.direccion d JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor} AND d.alias='Trabajo'") == "0"


def profile_concurrency():
    actors, _ = fixture()
    actor, _ = actors[0]
    status, original = request(actor, "/api/v1/me")
    assert status == 200
    # Another client changes the phone between the initial read and saving names.
    body = {"firstNames": original["firstNames"], "lastNames": original["lastNames"], "phone": "+593999123456"}
    if "version" in original:
        body["expectedVersion"] = original["version"]
    assert request(actor, "/api/v1/me", "PUT", body)[0] == 204
    replacement = {"firstNames": "Nuevo nombre", "lastNames": original["lastNames"], "phone": original["phone"]}
    if "version" in original:
        replacement["expectedVersion"] = original["version"]
    status, problem = request(actor, "/api/v1/me", "PUT", replacement)
    assert status == 409 and problem["code"] == "P1104", "Stale profile replacement overwrote a concurrent phone change: " + str((status, problem))
    stale = {"field": "firstNames", "value": "Nuevo nombre", "expectedVersion": original.get("version", "0")}
    status, problem = request(actor, "/api/v1/me", "PATCH", stale)
    assert status == 409 and problem["code"] == "P1104", (status, problem)
    _, current = request(actor, "/api/v1/me")
    assert current["phone"] == "+593999123456" and current["firstNames"] == original["firstNames"], current
    stale["expectedVersion"] = current["version"]
    assert request(actor, "/api/v1/me", "PATCH", stale)[0] == 204
    _, current = request(actor, "/api/v1/me")
    assert current["phone"] == "+593999123456" and current["firstNames"] == "Nuevo nombre", current
    # Lost success response: exact replay cannot silently overwrite a newer value.
    status, problem = request(actor, "/api/v1/me", "PATCH", stale)
    assert status == 409 and problem["code"] == "P1104", (status, problem)


def checkout_replay():
    actors, edition = fixture()
    actor, address = actors[0]
    key = str(uuid.uuid4())
    body = {"addressId": str(address), "paymentMethod": "TRANSFER", "simulationOutcome": "APPROVED"}
    status, first = request(actor, "/api/v1/checkout", "POST", body, key)
    assert status == 201, (status, first)
    status, second = request(actor, "/api/v1/checkout", "POST", body, key)
    assert status == 201 and second == first, (status, second)
    status, resolved = request(actor, f"/api/v1/checkout/attempts/{key}/resolve", "POST")
    assert status == 200 and resolved["state"] == "CREATED" and resolved["order"]["orderId"] == first["orderId"], (status, resolved)
    assert query(f"SELECT count(*) FROM pliego.pedido_item WHERE edicion_id={edition}") == "1"
    assert query(f"SELECT count(*) FROM pliego.correo_outbox WHERE evento_clave='ORDER_CONFIRMED:{first['orderId']}'") == "1"


def validation_contracts():
    actors, _ = fixture()
    actor, address = actors[0]
    checkout = {"addressId": str(address), "paymentMethod": "TRANSFER", "simulationOutcome": "APPROVED"}
    for key in (None, "invalid-uuid"):
        status, problem = request(actor, "/api/v1/checkout", "POST", checkout, key)
        assert status == 400 and problem["code"] == "VALIDATION_ERROR", (status, problem)
    for body in ({"field": "phone", "expectedVersion": "0"},
                 {"field": "firstNames", "value": None, "expectedVersion": "0"},
                 {"field": "email", "value": "otro@example.com", "expectedVersion": "0"},
                 {"field": "phone", "value": None},
                 {"field": "phone", "value": None, "expectedVersion": "9223372036854775808"}):
        status, problem = request(actor, "/api/v1/me", "PATCH", body)
        assert status == 400, (body, status, problem)
    status, problem = request(actor, "/api/v1/me", "PUT", {"firstNames": "Otro", "lastNames": "Conc", "phone": None})
    assert status == 400 and problem["code"] == "VALIDATION_ERROR", (status, problem)
    _, current = request(actor, "/api/v1/me")
    assert current["version"] == "0" and current["firstNames"] == "Cliente", current
    # Explicit null phone is accepted and preserves all other fields.
    assert request(actor, "/api/v1/me", "PATCH", {"field": "phone", "value": None, "expectedVersion": "0"})[0] == 204


if __name__ == "__main__":
    import sys
    selected = sys.argv[1:]
    for check in (address_replay, profile_concurrency, checkout_replay, validation_contracts):
        if not selected or check.__name__ in selected:
            check()
            print(check.__name__ + " passed")
