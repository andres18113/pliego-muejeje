"""Private invoice preview/download contract against disposable PostgreSQL 18 and live HTTP.

Uses the same PG*, CHECKOUT_BASE_URL and PLIEGO_JWT_SECRET as the CI gates.
Only public business routines create historical fixtures; existing records are untouched.
"""

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid
import zlib

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


def pdf_structure(pdf):
    """Inflates the PDF's object/content streams (PDFBox writes PDF 1.6 object streams) to read its structure."""
    inflated = []
    for raw in re.findall(rb"stream\r?\n(.*?)\r?\nendstream", pdf, re.S):
        try:
            inflated.append(zlib.decompress(raw))
        except zlib.error:
            pass  # images and other non-Flate streams carry no structure this gate reads
    return pdf + b"\n".join(inflated)


def pdf_title(structure):
    match = re.search(rb"/Title\s*(<[0-9A-Fa-f]+>|\((?:\\.|[^\\)])*\))", structure)
    assert match, "PDF has no document title"
    value = match.group(1)
    if value.startswith(b"<"):
        raw = bytes.fromhex(value[1:-1].decode())
        return raw[2:].decode("utf-16-be") if raw.startswith(b"\xfe\xff") else raw.decode("latin-1")
    return value[1:-1].decode("latin-1")


def assert_academic_pdf(pdf, document_number, pages, invoice_id):
    """Integrity of the served bytes: a complete PDF for this invoice, with embedded fonts and no active content."""
    assert pdf.startswith(b"%PDF-1.") and pdf.rstrip().endswith(b"%%EOF"), "truncated or non-PDF bytes"
    # Fonts are subset-embedded (a one-page invoice is ~32 KB): the bounds reject a stub and full-font regressions.
    assert 10_000 < len(pdf) < 1_000_000, len(pdf)
    structure = pdf_structure(pdf)
    assert re.findall(rb"/Type\s*/Catalog", structure), "PDF has no catalog"
    # One page tree and no outlines: its /Count is the document's page count.
    assert [int(n) for n in re.findall(rb"/Count\s+(\d+)", structure)] == [pages], "unexpected page count"
    fonts = set(re.findall(rb"/BaseFont\s*/[A-Z]{6}\+(Roboto-[A-Za-z]+)", structure))
    assert fonts >= {b"Roboto-Regular"} and len(re.findall(rb"/FontFile2", structure)) == len(fonts), fonts
    assert not re.search(rb"/(?:JavaScript|JS|OpenAction|Launch|EmbeddedFile|Encrypt|AA)\b", structure), "active PDF content"
    assert pdf_title(structure) == "Factura académica " + document_number, pdf_title(structure)
    # The bytes served are exactly the artifact PostgreSQL recorded, whichever storage holds them.
    recorded = query(f"""SELECT coalesce(a.checksum, c.checksum) FROM pliego.factura_archivo a
        LEFT JOIN pliego.factura_archivo_contenido c USING(factura_id, tipo)
        WHERE a.factura_id={int(invoice_id)} AND a.tipo='PDF'""")
    assert recorded == hashlib.sha256(pdf).hexdigest(), "served PDF differs from the recorded SHA-256"


def private_file(path, actor, mime, disposition, role="CUSTOMER"):
    status, headers, content = request(path, actor, role)
    assert status == 200 and headers.get("Content-Type", "").startswith(mime), (path, status, content)
    assert headers.get("Content-Disposition", "").startswith(disposition + ";"), headers
    assert "no-store" in headers.get("Cache-Control", ""), headers
    assert headers.get("X-Content-Type-Options") == "nosniff", headers
    assert int(headers["Content-Length"]) == len(content), headers
    return content


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
    # Text is CID-encoded in compressed streams: the Java PDFBox suite extracts and checks every value;
    # this gate checks the served bytes' structure, identity and integrity.
    assert_academic_pdf(pdf, metadata["documentNumber"], 1, metadata["invoiceId"])
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
