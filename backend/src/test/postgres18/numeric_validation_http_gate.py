"""Verify exact cart quantities and bounded pagination against PostgreSQL 18.

Set PGHOST, PGPORT, PGDATABASE, PLIEGO_JWT_SECRET and CHECKOUT_BASE_URL
for the disposable database and its running backend before executing this gate.
Raw JSON preserves decimal precision and scientific notation in requests.
"""

import json
import os
import urllib.error
import urllib.request

from checkout_http_gate import token
from checkout_last_unit import fixture, query


def request(path, method="GET", raw_body=None, actor=None):
    headers = {}
    if actor is not None:
        headers["Authorization"] = "Bearer " + token(actor)
    if raw_body is not None:
        headers["Content-Type"] = "application/json"
    incoming = urllib.request.Request(
        os.environ["CHECKOUT_BASE_URL"] + path,
        method=method,
        data=None if raw_body is None else raw_body.encode(),
        headers=headers,
    )
    try:
        response = urllib.request.urlopen(incoming, timeout=20)
    except urllib.error.HTTPError as failure:
        response = failure
    with response:
        content = response.read()
        return response.status, json.loads(content) if content else None


def cart_snapshot(actor, edition):
    return query(f"""
        SELECT jsonb_build_object(
            'carts', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.carrito_id)
                FROM pliego.carrito c JOIN pliego.cliente p USING(cliente_id)
                WHERE p.usuario_id = {actor}),
            'items', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.carrito_item_id)
                FROM pliego.carrito_item i JOIN pliego.carrito c USING(carrito_id)
                JOIN pliego.cliente p USING(cliente_id) WHERE p.usuario_id = {actor}),
            'inventory', (SELECT to_jsonb(i) FROM pliego.inventario i
                WHERE i.edicion_id = {edition})
        )::TEXT
    """)


def exact_cart_quantities():
    actors, edition = fixture()
    actor = actors[0][0]
    cart_item = query(f"""
        SELECT i.carrito_item_id
        FROM pliego.carrito_item i JOIN pliego.carrito c USING(carrito_id)
        JOIN pliego.cliente p USING(cliente_id)
        WHERE p.usuario_id = {actor} AND c.estado = 'ACTIVE'
    """)
    before = cart_snapshot(actor, edition)
    for quantity in ("1.5", "-1.5", "1.0000000000000001", "1e-1",
                     "2147483648", "-2147483649", "1e100"):
        commands = (
            ("POST", "/api/v1/cart/items", f'{{"editionId":"{edition}","quantity":{quantity}}}'),
            ("PUT", f"/api/v1/cart/items/{cart_item}", f'{{"quantity":{quantity}}}'),
        )
        for method, path, body in commands:
            status, problem = request(path, method, body, actor)
            assert status == 400, (quantity, method, status, problem)
            assert problem["code"] == "VALIDATION_ERROR", problem
            quantity_errors = [item for item in problem["violations"] if item["field"] == "quantity"]
            assert quantity_errors and "cantidad entera" in quantity_errors[0]["message"], problem
            assert cart_snapshot(actor, edition) == before, (quantity, method, "Rejected request mutated data")

    # Integral decimals are exact integers; retain the documented integer request contract.
    status, result = request(f"/api/v1/cart/items/{cart_item}", "PUT", '{"quantity":1.0}', actor)
    assert status == 200 and type(result["quantity"]) is int and result["quantity"] == 1, (status, result)
    admin = query("SELECT usuario_id FROM pliego.usuario WHERE rol = 'ADMIN' AND estado = 'ACTIVE' ORDER BY usuario_id DESC LIMIT 1")
    query(f"CALL pliego.sp_inventory_entry({admin}, {edition}, 1, 'numeric HTTP gate', NULL, NULL, NULL)")
    status, result = request("/api/v1/cart/items", "POST", f'{{"editionId":"{edition}","quantity":1.0}}', actor)
    assert status == 200 and type(result["quantity"]) is int and result["quantity"] == 2, (status, result)
    assert query(f"SELECT cantidad FROM pliego.carrito_item WHERE carrito_item_id = {cart_item}") == "2"

    status, document = request("/v3/api-docs")
    assert status == 200, status
    for path, method in (("/api/v1/cart/items", "post"), ("/api/v1/cart/items/{cartItemId}", "put")):
        schema_ref = document["paths"][path][method]["requestBody"]["content"]["application/json"]["schema"]["$ref"]
        quantity_schema = document["components"]["schemas"][schema_ref.rsplit("/", 1)[1]]["properties"]["quantity"]
        assert quantity_schema["type"] == "integer" and quantity_schema["format"] == "int32", quantity_schema


def pagination_bounds():
    for page, size in ((2147483647, 50), (42949673, 50), (2147483647, 2)):
        status, problem = request(f"/api/v1/catalog/editions?page={page}&pageSize={size}")
        assert status == 400 and problem["code"] == "P1006", (status, problem)
        assert problem["title"] == "Página fuera de rango", problem
        assert "Vuelve a la primera página" in problem["detail"], problem
    for page, size in ((2147483647, 1), (42949672, 50)):
        status, page_result = request(f"/api/v1/catalog/editions?page={page}&pageSize={size}")
        assert status == 200 and page_result["items"] == [], (status, page_result)
    status, problem = request("/api/v1/catalog/editions?page=0&pageSize=51")
    assert status == 400 and problem["code"] == "VALIDATION_ERROR", (status, problem)


if __name__ == "__main__":
    exact_cart_quantities()
    pagination_bounds()
    print("numeric_validation_http_gate: PASS")
