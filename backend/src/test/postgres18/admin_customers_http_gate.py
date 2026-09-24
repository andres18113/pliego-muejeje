"""Exercise ADMIN customer HTTP operations against PostgreSQL 18.

The backend must be running with Flyway through V001-V020. Set PGHOST, PGPORT,
PGDATABASE, PGUSER, PLIEGO_JWT_SECRET and CHECKOUT_BASE_URL.
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
    return "Bearer " + (signed + b"." + signature).decode()


def request(path, authorization=None, method="GET", body=None):
    headers = {}
    data = None
    if authorization is not None:
        headers["Authorization"] = authorization
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


def fixture():
    suffix = uuid.uuid4().hex[:16]
    admin_email = f"i11-gate-admin-{suffix}@pliego.local"
    customer_email = f"i11-gate-customer-{suffix}@pliego.local"
    query(f"""
        DO $fixture$
        DECLARE v_admin BIGINT; v_user BIGINT; v_customer BIGINT; v_state VARCHAR;
        BEGIN
            INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
            VALUES ('{admin_email}','fixture-hash','ADMIN','ACTIVE')
            RETURNING usuario_id INTO v_admin;
            CALL pliego.sp_customer_register('{customer_email}','fixture-hash',
                'Cliente I11','Gate {suffix}',NULL,v_user,v_customer,v_state);
        END;
        $fixture$;
    """)
    row = query(f"""
        SELECT admin.usuario_id, customer.usuario_id, c.cliente_id
        FROM pliego.usuario admin
        JOIN pliego.usuario customer ON customer.email_normalizado='{customer_email}'
        JOIN pliego.cliente c ON c.usuario_id=customer.usuario_id
        WHERE admin.email_normalizado='{admin_email}'
    """)
    admin, customer_user, customer_id = map(int, row.split("|"))
    return suffix, admin, customer_user, customer_id, customer_email


def main():
    required = ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PLIEGO_JWT_SECRET", "CHECKOUT_BASE_URL")
    if not all(os.environ.get(key) for key in required):
        raise SystemExit("Set PGHOST, PGPORT, PGDATABASE, PGUSER, PLIEGO_JWT_SECRET and CHECKOUT_BASE_URL")

    suffix, admin_user, customer_user, customer_id, customer_email = fixture()
    admin = token(admin_user, "ADMIN")
    customer = token(customer_user, "CUSTOMER")

    status, problem = request("/api/v1/admin/customers")
    assert status == 401 and problem["code"] == "AUTH_REQUIRED", (status, problem)
    status, problem = request("/api/v1/admin/customers", customer)
    assert status == 403 and problem["code"] == "ACCESS_DENIED", (status, problem)
    status, problem = request(f"/api/v1/admin/customers/{customer_id}/status", customer,
                              method="PUT", body={"state": "BLOCKED"})
    assert status == 403 and problem["code"] == "ACCESS_DENIED", (status, problem)

    filtered = urllib.parse.urlencode({"query": suffix, "state": "ACTIVE", "page": 0, "pageSize": 1})
    status, page = request("/api/v1/admin/customers?" + filtered, admin)
    assert status == 200 and page["totalCount"] == "1" and len(page["items"]) == 1, (status, page)
    summary = page["items"][0]
    assert set(summary) == {"customerId", "email", "firstNames", "lastNames", "phone", "state", "createdAt"}
    assert summary["customerId"] == str(customer_id) and summary["email"] == customer_email
    assert summary["state"] == "ACTIVE" and isinstance(summary["customerId"], str)
    assert "userId" not in summary
    for state in ("ACTIVE", "BLOCKED"):
        status, state_page = request("/api/v1/admin/customers?" + urllib.parse.urlencode(
            {"query": suffix, "state": state}), admin)
        assert status == 200, (status, state_page)
        if state == "ACTIVE":
            assert state_page["totalCount"] == "1" and len(state_page["items"]) == 1
    beyond = urllib.parse.urlencode({"query": suffix, "page": 4, "pageSize": 1})
    status, beyond_page = request("/api/v1/admin/customers?" + beyond, admin)
    assert status == 200 and beyond_page["items"] == [] and beyond_page["totalCount"] == "1", (status, beyond_page)
    status, invalid = request("/api/v1/admin/customers?state=PENDING", admin)
    assert status == 400 and invalid["code"] == "VALIDATION_ERROR", (status, invalid)

    status, profile = request("/api/v1/me", customer)
    assert status == 200 and profile["customerId"] == str(customer_id), (status, profile)
    status, none = request(f"/api/v1/admin/customers/{customer_id}/status", admin,
                           method="PUT", body={"state": "ACTIVE"})
    assert status == 204 and none is None, (status, none)
    status, none = request(f"/api/v1/admin/customers/{customer_id}/status", admin,
                           method="PUT", body={"state": "BLOCKED"})
    assert status == 204 and none is None, (status, none)
    assert query(f"SELECT estado FROM pliego.usuario WHERE usuario_id={customer_user}") == "BLOCKED"

    status, blocked = request("/api/v1/me", customer)
    assert status == 401 and blocked["code"] == "P1003", (status, blocked)
    assert (blocked["title"], blocked["detail"]) == (
        "Cuenta bloqueada", "Tu cuenta está bloqueada y no puede realizar esta operación.")
    status, blocked_page = request("/api/v1/admin/customers?" + urllib.parse.urlencode(
        {"query": suffix, "state": "BLOCKED"}), admin)
    assert status == 200 and blocked_page["totalCount"] == "1", (status, blocked_page)

    status, none = request(f"/api/v1/admin/customers/{customer_id}/status", admin,
                           method="PUT", body={"state": "ACTIVE"})
    assert status == 204 and none is None, (status, none)
    assert query(f"SELECT estado FROM pliego.usuario WHERE usuario_id={customer_user}") == "ACTIVE"
    status, reactivated = request("/api/v1/me", customer)
    assert status == 200 and reactivated["customerId"] == str(customer_id), (status, reactivated)

    status, missing = request("/api/v1/admin/customers/9223372036854775807/status", admin,
                              method="PUT", body={"state": "BLOCKED"})
    assert status == 404 and missing["code"] == "P1102", (status, missing)
    assert (missing["title"], missing["detail"]) == (
        "Cliente no encontrado", "El cliente solicitado no está disponible.")
    print("PostgreSQL 18 ADMIN customer HTTP gate passed: search, ADMIN status changes, existing JWT block and reactivation")


if __name__ == "__main__":
    main()
