"""Live HTTP/JDBC proof that OTHER remains a third-party invoice snapshot."""
import json
import os
import urllib.error
import urllib.request
import uuid

from checkout_http_gate import token
from checkout_last_unit import fixture, query


base = os.environ['CHECKOUT_BASE_URL'].rstrip('/')


def checkout(actor, payload, key):
    outgoing = urllib.request.Request(base + '/api/v1/checkout', data=json.dumps(payload).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + token(actor), 'Idempotency-Key': str(key),
                 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(outgoing, timeout=15) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as response:
        return response.code, json.loads(response.read())


actors, _ = fixture()
third_party = {
    'addressId': str(actors[0][1]),
    'paymentMethod': 'TRANSFER',
    'simulationOutcome': 'PENDING',
    'billingRecipient': 'OTHER',
    'billingIdentity': {'type': 'EC_CEDULA', 'number': '1710034065'},
    'buyerName': 'Comprador tercero',
    'billingAddress': {'line1': 'Calle fiscal', 'provinceId': '17', 'cityId': '893', 'countryCode': 'EC'},
}
key = uuid.uuid4()
status, body = checkout(actors[0][0], third_party, key)
assert status == 201, (status, body)
order = int(body['orderId'])
assert query(f"SELECT destinatario_tipo||'|'||identidad_numero FROM pliego.factura WHERE pedido_id={order}") == 'OTHER|1710034065'
assert query(f"SELECT count(*) FROM pliego.fn_customer_billing_identity({actors[0][0]})") == '0'

status, replay = checkout(actors[0][0], third_party, key)
assert status == 201 and replay['orderId'] == str(order), (status, replay)
status, problem = checkout(actors[0][0], {**third_party, 'billingRecipient': 'ACCOUNT'}, key)
assert status == 409 and problem['code'] == 'P1010', (status, problem)
assert query(f"SELECT count(*) FROM pliego.fn_customer_billing_identity({actors[0][0]})") == '0'

# Another customer's account has its own identity; a third-party number still bypasses P1106.
saved_actors, _ = fixture()
query(f"CALL pliego.sp_customer_billing_identity_register({saved_actors[0][0]},'EC_CEDULA','0912345675')")
other_payload = {**third_party, 'addressId': str(saved_actors[0][1]),
                 'billingAddress': {'line1': 'Calle fiscal', 'city': 'Playas', 'province': 'Guayas', 'countryCode': 'EC'}}
status, other = checkout(saved_actors[0][0], other_payload, uuid.uuid4())
assert status == 201, (status, other)
other_order = int(other['orderId'])
assert query(f"SELECT destinatario_tipo||'|'||identidad_numero FROM pliego.factura WHERE pedido_id={other_order}") == 'OTHER|1710034065'
assert query(f"SELECT ciudad||'|'||provincia FROM pliego.factura_direccion WHERE factura_id=(SELECT factura_id FROM pliego.factura WHERE pedido_id={other_order})") == 'General Villamil|Guayas'
assert query(f"SELECT identity_number FROM pliego.fn_customer_billing_identity({saved_actors[0][0]})") == '0912345675'
assert query(f"SELECT used||'|'||correction_mode FROM pliego.fn_customer_billing_identity_read_model({saved_actors[0][0]})") == 'false|DIRECT'
print('PostgreSQL 18 HTTP/JDBC recipient gate passed: OTHER snapshot, no identity registration/P1106, stable replay, and recipient-kind fingerprint.')
