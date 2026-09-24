"""Full CUSTOMER + ADMIN journey over live HTTP against PostgreSQL 18.

The backend must be running with Flyway through V001-V020. Set PGHOST,
PGPORT, PGDATABASE, PGUSER, PLIEGO_JWT_SECRET and CHECKOUT_BASE_URL.

Covers: register/login (real BCrypt + JWT), profile, addresses incl. V020
primary replacement, public catalog, ADMIN catalog + inventory, cart,
CARD checkout, snapshots vs later catalog edits, ADMIN transitions,
ownership 404s, and Spanish ProblemDetail behavior.
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

from checkout_last_unit import query


def encoded(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=")


def admin_token(actor):
    now = int(time.time())
    header = encoded({"alg": "HS256", "typ": "JWT"})
    claims = encoded({"iss": "pliego", "aud": "pliego-api", "sub": str(actor),
                      "role": "ADMIN", "iat": now, "exp": now + 1800,
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
            return response.status, response.headers, json.loads(payload) if payload else None
    except urllib.error.HTTPError as response:
        payload = response.read()
        return response.code, response.headers, json.loads(payload) if payload else None


def assert_spanish_problem(status, headers, problem, code):
    assert problem["code"] == code, (status, problem)
    assert problem["title"] and problem["title"][0].isupper(), problem
    assert problem["detail"] and problem["detail"][0].isupper(), problem
    assert problem["traceId"], problem
    assert headers.get("Content-Type", "").startswith("application/problem+json"), headers
    assert headers.get("X-Trace-Id") == problem["traceId"], headers


def main():
    required = ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PLIEGO_JWT_SECRET", "CHECKOUT_BASE_URL")
    if not all(os.environ.get(key) for key in required):
        raise SystemExit("Set PGHOST, PGPORT, PGDATABASE, PGUSER, PLIEGO_JWT_SECRET and CHECKOUT_BASE_URL")

    suffix = uuid.uuid4().hex[:12]
    email = f"i12-journey-{suffix}@pliego.local"
    other_email = f"i12-journey-b-{suffix}@pliego.local"
    admin_email = f"i12-journey-admin-{suffix}@pliego.local"
    query(f"""INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
              VALUES ('{admin_email}','fixture-hash','ADMIN','ACTIVE')""")
    admin_user = int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='{admin_email}'"))
    admin = admin_token(admin_user)

    # --- auth: register + login through real BCrypt/JWT ---
    status, _, registered = request("/api/v1/auth/register", method="POST", body={
        "email": email, "password": "Secreta-journey-1",
        "firstNames": "Cliente", "lastNames": "Journey", "phone": "+59325550134"})
    assert status == 201 and registered["state"] == "ACTIVE", (status, registered)
    status, headers, problem = request("/api/v1/auth/register", method="POST", body={
        "email": email, "password": "Secreta-journey-1",
        "firstNames": "Cliente", "lastNames": "Journey"})
    assert status == 409, (status, problem)
    assert_spanish_problem(status, headers, problem, "P1101")
    status, _, session = request("/api/v1/auth/login", method="POST", body={
        "email": email, "password": "Secreta-journey-1"})
    assert status == 200 and session["tokenType"] == "Bearer", (status, session)
    assert session["user"]["role"] == "CUSTOMER" and session["expiresInSeconds"] == 1800
    assert "Secreta-journey-1" not in json.dumps(session)
    customer = "Bearer " + session["accessToken"]
    status, headers, problem = request("/api/v1/auth/login", method="POST", body={
        "email": email, "password": "Incorrecta-9"})
    assert status == 401, (status, problem)
    assert_spanish_problem(status, headers, problem, "AUTH_INVALID_CREDENTIALS")
    status, _, other_session = request("/api/v1/auth/register", method="POST", body={
        "email": other_email, "password": "Secreta-journey-2",
        "firstNames": "Otro", "lastNames": "Cliente"})
    assert status == 201, (status, other_session)
    status, _, other_login = request("/api/v1/auth/login", method="POST", body={
        "email": other_email, "password": "Secreta-journey-2"})
    other = "Bearer " + other_login["accessToken"]

    # --- authz: anonymous 401, customer on admin route 403 ---
    status, headers, problem = request("/api/v1/me")
    assert status == 401, (status, problem)
    assert_spanish_problem(status, headers, problem, "AUTH_REQUIRED")
    status, _, problem = request("/api/v1/admin/customers", customer)
    assert status == 403 and problem["code"] == "ACCESS_DENIED", (status, problem)

    # --- profile + addresses (V020 live) ---
    status, _, profile = request("/api/v1/me", customer)
    assert status == 200 and profile["email"] == email, (status, profile)
    customer_id = profile["customerId"]
    status, _, none = request("/api/v1/me", customer, method="PUT", body={
        "firstNames": "Cliente", "lastNames": "Journey Doe", "phone": "+59325550135"})
    assert status == 204 and none is None, (status, none)
    status, _, profile = request("/api/v1/me", customer)
    assert status == 200 and profile["lastNames"] == "Journey Doe", (status, profile)
    status, _, created = request("/api/v1/me/addresses", customer, method="POST", body={
        "alias": "Casa", "recipient": "Cliente Journey", "line1": "Calle 1", "line2": None,
        "city": "Quito", "province": "Pichincha", "countryCode": "EC",
        "postalCode": "170101", "reference": None, "phone": "+59325550134", "makePrimary": True})
    assert status == 201, (status, created)
    casa = created["addressId"]
    status, _, created = request("/api/v1/me/addresses", customer, method="POST", body={
        "alias": "Oficina", "recipient": "Cliente Journey", "line1": "Calle 2", "line2": None,
        "city": "Quito", "province": "Pichincha", "countryCode": "EC",
        "postalCode": None, "reference": None, "phone": "+59325550134", "makePrimary": False})
    assert status == 201, (status, created)
    oficina = created["addressId"]
    status, _, listed = request("/api/v1/me/addresses", customer)
    assert status == 200 and len(listed) == 2, (status, listed)
    assert [a["alias"] for a in listed if a["primary"]] == ["Casa"]
    status, headers, problem = request("/api/v1/me/addresses", customer, method="POST", body={
        "alias": "X", "recipient": "X", "line1": "X", "city": "X", "province": "X",
        "countryCode": "EC", "phone": "+59325550134", "makePrimary": False, "actorUserId": 1})
    assert status == 400, (status, problem)
    assert_spanish_problem(status, headers, problem, "MALFORMED_JSON")
    status, _, none = request(f"/api/v1/me/addresses/{oficina}/primary", customer, method="PUT")
    assert status == 204 and none is None, (status, none)
    status, _, listed = request("/api/v1/me/addresses", customer)
    assert [a["alias"] for a in listed if a["primary"]] == ["Oficina"], listed
    status, _, none = request(f"/api/v1/me/addresses/{oficina}/primary", customer, method="PUT")
    assert status == 204, (status, none)
    status, _, none = request(f"/api/v1/me/addresses/{casa}", customer, method="PUT", body={
        "alias": "Casa", "recipient": "Cliente Journey", "line1": "Calle 1 norte", "line2": None,
        "city": "Quito", "province": "Pichincha", "countryCode": "EC",
        "postalCode": "170101", "reference": None, "phone": "+59325550134"})
    assert status == 204 and none is None, (status, none)
    status, _, listed = request("/api/v1/me/addresses", customer)
    assert [a["line1"] for a in listed if a["alias"] == "Casa"] == ["Calle 1 norte"], listed
    status, _, none = request(f"/api/v1/me/addresses/{casa}", customer, method="DELETE")
    assert status == 204 and none is None, (status, none)

    # --- ADMIN catalog + inventory through HTTP ---
    status, _, author = request("/api/v1/admin/authors", admin, method="POST", body={
        "name": f"Autor Journey {suffix}", "biography": None})
    assert status == 201, (status, author)
    status, _, publisher = request("/api/v1/admin/publishers", admin, method="POST", body={
        "name": f"Editorial Journey {suffix}", "description": None})
    assert status == 201, (status, publisher)
    status, _, category = request("/api/v1/admin/categories", admin, method="POST", body={
        "name": f"Categoría Journey {suffix}", "slug": f"i12-journey-{suffix}",
        "description": None, "parentCategoryId": None})
    assert status == 201, (status, category)
    status, _, book = request("/api/v1/admin/books", admin, method="POST", body={
        "title": f"Libro Journey {suffix}", "subtitle": None, "synopsis": None,
        "authors": [{"authorId": author["authorId"], "order": 1}],
        "categoryIds": [category["categoryId"]]})
    assert status == 201, (status, book)
    sku = f"I12-JOURNEY-{suffix.upper()}"
    status, _, edition = request("/api/v1/admin/editions", admin, method="POST", body={
        "bookId": book["bookId"], "publisherId": publisher["publisherId"], "sku": sku,
        "isbn13": None, "language": "es", "format": "PAPERBACK", "pageCount": 100,
        "publicationDate": None, "price": "20.00", "coverUrl": None, "coverLicense": None,
        "coverSourceUrl": None, "coverAttribution": None})
    assert status == 201, (status, edition)
    edition_id = edition["editionId"]
    status, _, none = request(f"/api/v1/admin/books/{book['bookId']}", admin, method="PUT", body={
        "title": f"Libro Journey {suffix}", "subtitle": "Segunda edición en camino", "synopsis": None,
        "authors": [{"authorId": author["authorId"], "order": 1}],
        "categoryIds": [category["categoryId"]]})
    assert status == 204 and none is None, (status, none)
    status, _, entry = request(f"/api/v1/admin/inventory/{edition_id}/entries", admin, method="POST", body={
        "quantity": 5, "reason": "ingreso journey"})
    assert status == 201 and entry == {"movementId": entry["movementId"], "stockBefore": 0, "stockAfter": 5}, (status, entry)
    status, _, none = request(f"/api/v1/admin/inventory/{edition_id}/minimum", admin, method="PUT", body={"stockMinimum": 1})
    assert status == 204 and none is None, (status, none)
    status, _, page = request(f"/api/v1/admin/inventory?sku={sku}", admin)
    assert status == 200 and page["totalCount"] == "1", (status, page)
    status, _, movements = request(f"/api/v1/admin/inventory/{edition_id}/movements", admin)
    assert status == 200 and len(movements["items"]) == 1, (status, movements)

    # --- public catalog ---
    status, _, results = request(f"/api/v1/catalog/editions?title={suffix}")
    assert status == 200 and results["totalCount"] == "1", (status, results)
    assert results["items"][0]["editionId"] == edition_id
    status, _, detail = request(f"/api/v1/catalog/editions/{edition_id}")
    assert status == 200 and detail["price"] == "20.00", (status, detail)

    # --- cart ---
    status, _, mutation = request("/api/v1/cart/items", customer, method="POST", body={
        "editionId": edition_id, "quantity": 1})
    assert status == 200 and mutation["quantity"] == 1, (status, mutation)
    cart_item = mutation["cartItemId"]
    status, _, mutation = request(f"/api/v1/cart/items/{cart_item}", customer, method="PUT", body={"quantity": 2})
    assert status == 200 and mutation["quantity"] == 2, (status, mutation)
    status, _, cart = request("/api/v1/cart", customer)
    assert status == 200 and cart["totalCurrent"] == "40.00" and len(cart["items"]) == 1, (status, cart)

    # --- checkout: invalid CARD first (no persistence), then APPROVED ---
    status, headers, problem = request("/api/v1/checkout", customer, method="POST", body={
        "addressId": oficina, "paymentMethod": "CARD",
        "simulationOutcome": "APPROVED", "cardNumber": "1234567890123456"})
    assert status == 400, (status, problem)
    assert_spanish_problem(status, headers, problem, "INVALID_CARD_NUMBER")
    assert "1234567890123456" not in json.dumps(problem)
    user_id = int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado='{email}'"))
    assert query(f"""SELECT count(*) FROM pliego.pedido p JOIN pliego.cliente c
                      ON c.cliente_id=p.cliente_id WHERE c.usuario_id={user_id}""") == "0"
    status, headers, order = request("/api/v1/checkout", customer, method="POST", body={
        "addressId": oficina, "paymentMethod": "CARD",
        "simulationOutcome": "APPROVED", "cardNumber": "4242424242424242"})
    assert status == 201, (status, order)
    assert headers["Location"] == "/api/v1/orders/" + order["orderId"], headers
    assert order["orderState"] == "CONFIRMED" and order["paymentState"] == "APPROVED"
    assert order["total"] == "40.00" and order["paymentReference"].startswith("SIM-")
    assert "cardNumber" not in order
    order_id = order["orderId"]
    assert query(f"SELECT stock_actual FROM pliego.inventario WHERE edicion_id={edition_id}") == "3"

    # --- customer order detail + snapshots survive later catalog edits ---
    status, _, bought = request(f"/api/v1/orders/{order_id}", customer)
    assert status == 200 and bought["total"] == "40.00" and len(bought["items"]) == 1, (status, bought)
    assert bought["items"][0]["unitPrice"] == "20.00"
    assert bought["items"][0]["title"] == f"Libro Journey {suffix}"
    assert bought["address"]["line1"] == "Calle 2"
    assert len(bought["stateHistory"]) == 2
    status, _, none = request(f"/api/v1/admin/books/{book['bookId']}", admin, method="PUT", body={
        "title": f"Libro Journey {suffix} (reeditado)", "subtitle": None, "synopsis": None,
        "authors": [{"authorId": author["authorId"], "order": 1}],
        "categoryIds": [category["categoryId"]]})
    assert status == 204, (status, none)
    status, _, none = request(f"/api/v1/admin/editions/{edition_id}", admin, method="PUT", body={
        "publisherId": publisher["publisherId"], "isbn13": None, "language": "es",
        "format": "PAPERBACK", "pageCount": 100, "publicationDate": None, "price": "99.99",
        "coverUrl": None, "coverLicense": None, "coverSourceUrl": None, "coverAttribution": None})
    assert status == 204, (status, none)
    status, _, frozen = request(f"/api/v1/orders/{order_id}", customer)
    assert status == 200, (status, frozen)
    assert frozen["items"][0]["title"] == f"Libro Journey {suffix}", frozen["items"]
    assert frozen["items"][0]["unitPrice"] == "20.00" and frozen["total"] == "40.00"

    # --- ownership: another customer sees safe 404s ---
    status, headers, problem = request(f"/api/v1/orders/{order_id}", other)
    assert status == 404, (status, problem)
    assert_spanish_problem(status, headers, problem, "P5001")
    status, _, problem = request(f"/api/v1/orders/{order_id}/cancel", other, method="POST")
    assert status == 404 and problem["code"] == "P5001", (status, problem)

    # --- ADMIN order search/detail/transitions; cancel after delivery conflicts ---
    status, _, found = request(f"/api/v1/admin/orders?customerId={customer_id}&pageSize=1", admin)
    assert status == 200 and found["totalCount"] == "1", (status, found)
    assert found["items"][0]["orderId"] == order_id
    status, _, admin_detail = request(f"/api/v1/admin/orders/{order_id}", admin)
    assert status == 200 and admin_detail["orderId"] == order_id, (status, admin_detail)
    assert admin_detail["items"][0]["title"] == f"Libro Journey {suffix}", admin_detail["items"]
    assert admin_detail["items"][0]["unitPrice"] == "20.00"
    assert len(admin_detail["inventoryMovements"]) == 1
    assert admin_detail["inventoryMovements"][0]["type"] == "SALE"
    for target, previous in (("PREPARING", "CONFIRMED"), ("SHIPPED", "PREPARING"), ("DELIVERED", "SHIPPED")):
        status, _, transition = request(f"/api/v1/admin/orders/{order_id}/transitions", admin,
                                        method="POST", body={"targetState": target})
        assert status == 200 and transition == {
            "orderId": order_id, "previousState": previous, "orderState": target}, (status, transition)
    status, _, problem = request(f"/api/v1/orders/{order_id}/cancel", customer, method="POST")
    assert status == 409 and problem["code"] == "P5003", (status, problem)
    status, _, problem = request(f"/api/v1/admin/orders/{order_id}/cancel", admin, method="POST")
    assert status == 409 and problem["code"] == "P5003", (status, problem)
    status, _, delivered = request(f"/api/v1/orders/{order_id}", customer)
    assert delivered["orderState"] == "DELIVERED" and len(delivered["stateHistory"]) == 5, delivered
    assert (delivered["items"], delivered["address"]) == (bought["items"], bought["address"])

    print("PostgreSQL 18 full-journey gate passed: auth/profile/addresses/catalog/inventory/cart/checkout/snapshots/transitions/ownership/Spanish errors")
    _ = customer_id


if __name__ == "__main__":
    main()
