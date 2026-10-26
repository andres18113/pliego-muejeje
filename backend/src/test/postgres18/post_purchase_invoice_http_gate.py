"""Private invoice preview/download contract against disposable PostgreSQL 18 and live HTTP.

Uses the same PG*, CHECKOUT_BASE_URL and PLIEGO_JWT_SECRET as the CI gates.
Only public business routines create historical fixtures; existing records are untouched.
"""

import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid

from admin_orders_http_gate import token
from checkout_billing import billed
from checkout_last_unit import fixture, query


def request(path, actor=None, role="CUSTOMER", method="GET", body=None):
    headers = {}
    if actor is not None:
        headers["Authorization"] = "Bearer " + token(actor, role)
    if body is not None:
        headers["Content-Type"] = "application/json"
        headers["Idempotency-Key"] = str(uuid.uuid4())
    outgoing = urllib.request.Request(
        os.environ["CHECKOUT_BASE_URL"] + path, method=method, headers=headers,
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(outgoing, timeout=15) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as response:
        return response.code, response.headers, response.read()


def problem(path, actor, status, code, role="CUSTOMER"):
    actual, headers, content = request(path, actor, role)
    assert actual == status and json.loads(content)["code"] == code, (path, actual, content)
    assert "Content-Disposition" not in headers, (path, headers)
    return headers


def checkout(outcome):
    actors, _ = fixture()
    actor, address = actors[0]
    status, _, content = request("/api/v1/checkout", actor, method="POST", body=billed({
        "addressId": str(address), "paymentMethod": "TRANSFER", "simulationOutcome": outcome}))
    assert status == 201, (status, content)
    return actor, actors[1][0], int(json.loads(content)["orderId"])


def private_file(path, actor, mime, disposition, role="CUSTOMER"):
    status, headers, content = request(path, actor, role)
    assert status == 200 and headers.get("Content-Type", "").startswith(mime), (path, status, content)
    assert headers.get("Content-Disposition", "").startswith(disposition + ";"), headers
    assert "no-store" in headers.get("Cache-Control", ""), headers
    assert headers.get("X-Content-Type-Options") == "nosniff", headers
    assert int(headers["Content-Length"]) == len(content), headers
    return content


def pdf_text(content):
    """Read the renderer's actual WinAnsi text operators, including octal accents/dash."""
    rows = re.findall(r"\(((?:\\.|[^\\)])*)\) Tj", content.decode("ascii", errors="replace"))
    def decode(row):
        unescaped = re.sub(r"\\([0-7]{3}|.)", lambda match: chr(int(match[1], 8))
                           if re.fullmatch("[0-7]{3}", match[1]) else match[1], row)
        return unescaped.encode("latin-1").decode("windows-1252")
    return "\n".join(decode(row) for row in rows)


def main():
    required = ("PGHOST", "PGPORT", "PGDATABASE", "PLIEGO_JWT_SECRET", "CHECKOUT_BASE_URL")
    if not all(os.environ.get(key) for key in required):
        raise SystemExit("Set PGHOST, PGPORT, PGDATABASE, PLIEGO_JWT_SECRET and CHECKOUT_BASE_URL")

    actor, other, order = checkout("APPROVED")
    invoice = f"/api/v1/orders/{order}/invoice"
    preview = invoice + "/files/PDF?disposition=inline"
    admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'"))
    problem(preview, None, 401, "AUTH_REQUIRED")
    problem(preview, admin, 403, "ACCESS_DENIED", "ADMIN")
    problem(preview + f"&actorId={actor}", other, 404, "P5001")
    problem("/api/v1/orders/9223372036854775807/invoice/files/PDF?disposition=inline",
            actor, 404, "P5001")
    problem(invoice + "/files/XML?disposition=inline", actor, 400, "VALIDATION_ERROR")
    problem(invoice + "/files/PDF?disposition=preview", actor, 400, "VALIDATION_ERROR")

    deadline = time.monotonic() + 35
    while True:
        status, headers, content = request(invoice, actor)
        assert status == 200 and "no-store" in headers.get("Cache-Control", ""), (status, content)
        metadata = json.loads(content)
        assert metadata["provenance"] == "SIMULATED" and metadata["state"] == "ISSUED", metadata
        assert set(metadata) == {"invoiceId", "orderId", "state", "provenance", "documentNumber", "files"}, metadata
        assert "0912345675" not in content.decode() and "db://" not in content.decode(), content
        if all(file["state"] == "READY" for file in metadata["files"]):
            break
        assert time.monotonic() < deadline, "invoice artifact worker did not publish both formats"
        time.sleep(0.25)

    pdf = private_file(preview, actor, "application/pdf", "inline")
    assert pdf.startswith(b"%PDF-")
    assert "SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA" in pdf_text(pdf)
    assert private_file(invoice + "/files/PDF", actor, "application/pdf", "attachment") == pdf
    assert private_file(invoice + "/files/PDF?disposition=attachment", actor, "application/pdf", "attachment") == pdf
    assert private_file(f"/api/v1/admin/orders/{order}/invoice/files/PDF?disposition=inline",
                        admin, "application/pdf", "inline", "ADMIN") == pdf
    xml = private_file(invoice + "/files/XML", actor, "application/xml", "attachment")
    assert "SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA" in xml.decode("utf-8")

    pending_actor, _, pending_order = checkout("PENDING")
    pending = f"/api/v1/orders/{pending_order}/invoice"
    status, _, content = request(pending, pending_actor)
    assert status == 200 and json.loads(content)["state"] == "DRAFT", (status, content)
    for file_type in ("PDF?disposition=inline", "XML"):
        headers = problem(pending + "/files/" + file_type, pending_actor, 409, "INVOICE_FILE_NOT_READY")
        assert "no-store" in headers.get("Cache-Control", "")

    # Preserve old orders: absence is metadata 404, download 409, until a legacy invoice is issued.
    legacy_actors, _ = fixture()
    legacy_actor, legacy_address = legacy_actors[0]
    legacy_order = int(query(f"CALL pliego.sp_checkout({legacy_actor},{legacy_address},"
                             "'TRANSFER','APPROVED',NULL,NULL,NULL,NULL,NULL)").split("|")[0])
    legacy = f"/api/v1/orders/{legacy_order}/invoice"
    problem(legacy, legacy_actor, 404, "INVOICE_NOT_FOUND")
    problem(legacy + "/files/PDF?disposition=inline", legacy_actor, 409, "INVOICE_FILE_NOT_READY")
    issue_payload = {
        'documentNumber': f'LEGACY-{uuid.uuid4().hex}', 'buyerName': 'Comprador histórico',
        'identityType': 'OTHER', 'identityNumber': 'synthetic-fixture',
        'billingAddress': {'line1': 'Calle histórica', 'city': 'Playas', 'province': 'Guayas', 'countryCode': 'EC'},
    }
    issue_status, _, issue_body = request(f"/api/v1/admin/orders/{legacy_order}/invoice", admin,
        role='ADMIN', method='POST', body=issue_payload)
    assert issue_status == 201, (issue_status, issue_body)
    invoice_id = json.loads(issue_body)['invoiceId']
    assert query(f"SELECT ciudad||'|'||provincia FROM pliego.factura_direccion WHERE factura_id={invoice_id}") == 'General Villamil|Guayas'
    status, _, content = request(legacy, legacy_actor)
    metadata = json.loads(content)
    assert status == 200 and metadata["provenance"] == "LEGACY", (status, content)
    assert all(file["state"] == "UNAVAILABLE" for file in metadata["files"]), metadata
    for file_type in ("PDF?disposition=inline", "XML"):
        headers = problem(legacy + "/files/" + file_type, legacy_actor, 404, "INVOICE_FILE_UNAVAILABLE")
        assert "no-store" in headers.get("Cache-Control", "")

    print("Live invoice preview/download passed: private PDF/XML, exact academic disclosure, "
          "customer/ADMIN authorization, pending 409, metadata absence 404/download 409 and legacy 404.")


if __name__ == "__main__":
    main()
