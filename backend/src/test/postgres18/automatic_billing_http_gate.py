"""Live HTTP/JDBC billing, actor isolation, idempotency and actual artifact bytes."""
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from admin_orders_http_gate import token
from checkout_last_unit import fixture, query

base = os.environ["CHECKOUT_BASE_URL"]

def request(path, actor=None, method="GET", body=None, key=None, role="CUSTOMER"):
    headers = {"Content-Type": "application/json"}
    if actor is not None:
        headers["Authorization"] = "Bearer " + token(actor, role)
    if key is not None:
        headers["Idempotency-Key"] = str(key)
    outgoing = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                      method=method, headers=headers)
    try:
        with urllib.request.urlopen(outgoing, timeout=15) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as response:
        return response.code, response.headers, response.read()

actors, edition = fixture()
actor, address = actors[0]
other = actors[1][0]
path = "/api/v1/me/billing-identity"
identity = {"type": "EC_CEDULA", "number": "0012345674"}
assert request(path, actor)[0] == 204
assert request(path, actor, "PUT", identity)[0] == 204
status, headers, body = request(path, actor)
assert status == 200 and json.loads(body) == identity and "no-store" in headers.get("Cache-Control", "")
assert request(path, other)[0] == 204
assert request(path, actor, "PUT", {**identity, "number": "0012345670"})[0] == 400

payload = {"addressId": str(address), "paymentMethod": "CARD", "simulationOutcome": "APPROVED",
           "cardNumber": "4242424242424242", "billingIdentity": identity, "buyerName": "Comprador Prueba",
           "billingAddress": {"line1": "Calle Fiscal", "city": "Quito", "province": "Pichincha", "countryCode": "EC"}}
key = uuid.uuid4()
invalid = {**payload, "billingIdentity": {"type": "EC_CEDULA", "number": "0012345670"}}
status, _, invalid_body = request("/api/v1/checkout", actor, "POST", invalid, uuid.uuid4())
assert status == 400 and "0012345670" not in invalid_body.decode(), "invalid identity was accepted or leaked"
assert query(f"SELECT count(*) FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}") == "0"
status, _, body = request("/api/v1/checkout", actor, "POST", payload, key)
assert status == 201, (status, body)
result = json.loads(body)
order = result["orderId"]
invoice_path = f"/api/v1/orders/{order}/invoice"
assert request(invoice_path)[0] == 401
assert request(invoice_path, other)[0] == 404
admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'"))
assert request(f"/api/v1/admin/orders/{order}/invoice", admin, role="ADMIN")[0] == 200
status, _, body = request("/api/v1/checkout", actor, "POST", payload, key)
assert status in (200, 201) and json.loads(body)["orderId"] == order
assert request("/api/v1/checkout", actor, "POST", {**payload, "buyerName": "Otro Comprador"}, key)[0] == 409
assert query(f"SELECT count(*) FROM pliego.factura WHERE pedido_id={int(order)}") == "1"
assert request(path, actor, "DELETE")[0] == 204

deadline = time.monotonic() + 35
while True:
    status, headers, body = request(invoice_path, actor)
    assert status == 200 and "no-store" in headers.get("Cache-Control", "")
    metadata = json.loads(body)
    assert "0012345674" not in body.decode(), "metadata leaked identification"
    assert metadata["provenance"] == "SIMULATED" and metadata["state"] == "ISSUED"
    if all(file["state"] == "READY" for file in metadata["files"]):
        break
    assert time.monotonic() < deadline, "artifact worker did not produce PDF/XML"
    time.sleep(0.25)
for file_type, mime, prefix in (("PDF", "application/pdf", b"%PDF-"), ("XML", "application/xml", b"<?xml")):
    status, headers, content = request(invoice_path + "/files/" + file_type, actor)
    assert status == 200 and headers.get("Content-Type").startswith(mime) and content.startswith(prefix)
    assert "attachment" in headers.get("Content-Disposition", "") and "no-store" in headers.get("Cache-Control", "")
    assert request(invoice_path + "/files/" + file_type, other)[0] == 404
    if file_type == "XML":
        assert b"SIN VALIDEZ TRIBUTARIA" in content and b"<Signature" not in content

pending_actors, pending_edition = fixture()
pending_actor, pending_address = pending_actors[0]
pending_payload = {**payload, "addressId": str(pending_address), "paymentMethod": "TRANSFER", "simulationOutcome": "PENDING"}
pending_payload.pop("cardNumber")
status, _, body = request("/api/v1/checkout", pending_actor, "POST", pending_payload, uuid.uuid4())
assert status == 201, (status, body)
pending_order = json.loads(body)["orderId"]
pending_path = f"/api/v1/orders/{pending_order}/invoice"
status, _, body = request(pending_path, pending_actor)
assert status == 200 and json.loads(body)["state"] == "DRAFT" and json.loads(body)["documentNumber"] is None
approval_path = f"/api/v1/admin/orders/{pending_order}/approve-payment"
assert request(approval_path, pending_actor, "POST")[0] == 403
assert request(approval_path, admin, "POST", role="ADMIN")[0] == 204
assert request(approval_path, admin, "POST", role="ADMIN")[0] == 204
status, _, body = request(pending_path, pending_actor)
assert status == 200 and json.loads(body)["state"] == "ISSUED"
assert query(f"SELECT count(*) FROM pliego.factura WHERE pedido_id={int(pending_order)}") == "1"
assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={pending_edition}") == "0"
unicode_actors, _ = fixture()
unicode_actor, unicode_address = unicode_actors[0]
unicode_payload = {**payload, "addressId": str(unicode_address), "buyerName": "Ana 李",
    "billingAddress": {"line1": ("Calle\nFiscal " + "A" * 200)[:200], "line2": "B" * 200,
                       "city": "Q" * 100, "province": "P" * 100, "countryCode": "EC"}}
status, _, body = request("/api/v1/checkout", unicode_actor, "POST", unicode_payload, uuid.uuid4())
assert status == 201, (status, body)
unicode_path = f'/api/v1/orders/{json.loads(body)["orderId"]}/invoice'
deadline = time.monotonic() + 35
while True:
    status, _, body = request(unicode_path, unicode_actor)
    assert status == 200
    if all(file["state"] == "READY" for file in json.loads(body)["files"]):
        break
    assert time.monotonic() < deadline, "accepted Unicode/address poisoned the artifact jobs"
    time.sleep(0.25)
status, _, body = request(unicode_path + "/files/XML", unicode_actor)
assert status == 200 and "Ana 李".encode() in body and b"B" * 200 in body
status, _, body = request(unicode_path + "/files/PDF", unicode_actor)
assert status == 200 and b"[U+674E]" in body and b"/ActualText" in body
print("Live billed checkout/profile/replay/ownership/ADMIN/private PDF+XML, pending approval and Unicode/address boundaries passed.")
