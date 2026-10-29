"""Live HTTP/JDBC coverage for customer and ADMIN identity-correction endpoints."""
import json
import os
import urllib.error
import urllib.request
import uuid

from admin_orders_http_gate import token
from checkout_last_unit import fixture, query


base = os.environ['CHECKOUT_BASE_URL'].rstrip('/')


def request(path, actor, role='CUSTOMER', method='GET', body=None, key=None):
    headers = {'Authorization': 'Bearer ' + token(actor, role)}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if key is not None:
        headers['Idempotency-Key'] = str(key)
    outgoing = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(outgoing, timeout=15) as response:
            payload = response.read()
            return response.status, response.headers, json.loads(payload) if payload else None
    except urllib.error.HTTPError as response:
        payload = response.read()
        return response.code, response.headers, json.loads(payload) if payload else None


actors, _ = fixture()
owner, address = actors[0]
other_owner, _ = actors[1]
admin = int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'"))
identity_path = '/api/v1/me/billing-identity'
admin_path = '/api/v1/admin/billing-identity-corrections'

# This DRAFT invoice makes the account identity used.
query(f"CALL pliego.sp_customer_billing_identity_register({owner},'EC_CEDULA','0912345675')")
checkout = query(f"""CALL pliego.sp_checkout_billed_quoted({owner},'{uuid.uuid4()}',{address},'TRANSFER','PENDING',NULL,
  'HOME_DELIVERY',NULL,NULL,'EC_CEDULA','0912345675','Comprador cuenta','Fiscal cuenta',NULL,
  'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)""").splitlines()[0].split('|')
invoice_id = int(checkout[5])
assert query(f"SELECT estado||'|'||identidad_numero FROM pliego.factura WHERE factura_id={invoice_id}") == 'DRAFT|0912345675'

status, headers, body = request(identity_path, owner)
assert status == 200 and 'no-store' in headers.get('Cache-Control', '')
assert body['used'] is True and body['correctionMode'] == 'REQUEST' and body['correctionRequest'] is None

# Direct correction is blocked with the Spanish review problem; no password is sent.
status, _, problem = request(identity_path + '/correction', owner, method='POST', body={
    'type': 'EC_CEDULA', 'currentNumber': '0912345675', 'number': '1710034065'})
assert status == 409 and problem['code'] == 'P1107'
assert problem['title'] == 'Esta identificación requiere revisión'
assert '0912345675' not in json.dumps(problem)

payload = {'type': 'EC_CEDULA', 'currentNumber': '0912345675', 'number': '1710034065',
           'reasonCode': 'DOCUMENT_TYPO', 'note': '  El documento se capturó mal.  '}
key = uuid.uuid4()
status, headers, created = request(identity_path + '/correction-requests', owner, method='POST', body=payload, key=key)
assert status == 201 and created['status'] == 'PENDING' and 'no-store' in headers.get('Cache-Control', '')
request_id = int(created['id'])
assert query(f"SELECT nota FROM pliego.cliente_identificacion_solicitud_correccion WHERE solicitud_id={request_id}") == 'El documento se capturó mal.'
status, _, replay = request(identity_path + '/correction-requests', owner, method='POST', body=payload, key=key)
assert status == 201 and replay['id'] == created['id'], (status, replay)

status, _, duplicate = request(identity_path + '/correction-requests', owner, method='POST', body=payload, key=uuid.uuid4())
assert status == 409 and duplicate['code'] == 'P1108', (status, duplicate)
status, _, hidden = request(f'{identity_path}/correction-requests/{request_id}/withdraw', other_owner, method='POST')
assert status == 404 and hidden['code'] == 'P1109', (status, hidden)
status, _, denied = request(admin_path, owner)
assert status == 403 and denied['code'] == 'ACCESS_DENIED', (status, denied)

status, _, admin_page = request(admin_path + '?status=PENDING&page=0&pageSize=20', admin, role='ADMIN')
assert status == 200 and admin_page['totalCount'] == '1'
assert admin_page['items'][0]['id'] == created['id'] and admin_page['items'][0]['currentNumber'] == '0912345675'
status, _, empty_page = request(admin_path + '?status=PENDING&page=100&pageSize=20', admin, role='ADMIN')
assert status == 200 and empty_page['items'] == [] and empty_page['totalCount'] == '1', (status, empty_page)
status, _, pagination_problem = request(admin_path + '?status=PENDING&page=2147483647&pageSize=50', admin, role='ADMIN')
assert status == 400 and pagination_problem['code'] == 'P1006', (status, pagination_problem)

status, _, withdrawn = request(f'{identity_path}/correction-requests/{request_id}/withdraw', owner, method='POST')
assert status == 204 and withdrawn is None
status, _, replay = request(identity_path + '/correction-requests', owner, method='POST', body=payload, key=key)
assert status == 201 and replay['status'] == 'WITHDRAWN' and replay['id'] == created['id']
status, _, owner_read = request(identity_path, owner)
assert status == 200 and owner_read['correctionRequest']['status'] == 'WITHDRAWN'

second_key = uuid.uuid4()
status, _, rejected_request = request(identity_path + '/correction-requests', owner, method='POST', body=payload, key=second_key)
assert status == 201 and rejected_request['status'] == 'PENDING'
decision_reason = 'La documentación no permite confirmar el cambio solicitado.'
status, _, rejected = request(f'{admin_path}/{rejected_request["id"]}/decision', admin, role='ADMIN', method='POST',
                              body={'decision': 'REJECT', 'decisionReason': decision_reason})
assert status == 200 and rejected['status'] == 'REJECTED' and rejected['decisionReason'] == decision_reason
assert query(f"SELECT identidad_numero FROM pliego.cliente_identificacion WHERE cliente_id=(SELECT cliente_id FROM pliego.cliente WHERE usuario_id={owner})") == '0912345675'

third_key = uuid.uuid4()
status, _, approval_request = request(identity_path + '/correction-requests', owner, method='POST', body=payload, key=third_key)
assert status == 201 and approval_request['status'] == 'PENDING'
status, _, approved = request(f'{admin_path}/{approval_request["id"]}/decision', admin, role='ADMIN', method='POST',
                              body={'decision': 'APPROVE'})
assert status == 200 and approved['status'] == 'APPROVED' and approved['decidedBy'] == str(admin)
assert query(f"SELECT identidad_numero FROM pliego.cliente_identificacion WHERE cliente_id=(SELECT cliente_id FROM pliego.cliente WHERE usuario_id={owner})") == '1710034065'
assert query(f"SELECT estado||'|'||identidad_numero FROM pliego.factura WHERE factura_id={invoice_id}") == 'DRAFT|0912345675'
print('PostgreSQL 18 correction HTTP/JDBC gate passed: no-password tier, request replay/uniqueness/withdraw, ADMIN list/reject/approve, ownership 404, Spanish problems, and unchanged DRAFT invoice.')
