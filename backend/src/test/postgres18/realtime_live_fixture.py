"""Disposable PG18 fixture for frontend/tests/e2e/realtime-identity.live.spec.ts (ADR 0054/0055).

Commands (JSON on stdout):
  prepare <email>                      -> cédula on a DRAFT invoice (REQUEST mode) and a pending-transfer order
  request <email>                      -> the customer's correction request through the public API
  decide <request_id> APPROVED|REJECTED -> an ADMIN decision through the public API
  approve-payment <order_id>           -> an ADMIN payment approval through the public API
  evidence <email> <request_id>        -> acknowledgment and decision-email outbox rows (aggregates only)
  digital-edition                      -> an active eBook for the Favorites cart-shortcut journey
  admin-login                          -> disposable ADMIN credentials for the real browser login (local DB only)

Requires the same environment as the other PG18 HTTP gates (PG*, PLIEGO_JWT_SECRET, CHECKOUT_BASE_URL).
"""
import json
import os
import random
import secrets
import sys
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from admin_orders_http_gate import token  # noqa: E402
from checkout_last_unit import query  # noqa: E402

BASE = os.environ['CHECKOUT_BASE_URL'].rstrip('/')
UA = 'PLIEGO-realtime-live-fixture/1.0'


def cedula() -> str:
    """A valid Ecuadorian cédula (province 01–24, third digit < 6, mod-10 check digit), fresh per run."""
    digits = [*divmod(random.randint(1, 24), 10), random.randint(0, 5), *[random.randint(0, 9) for _ in range(6)]]
    total = 0
    for index, digit in enumerate(digits):
        weighted = digit * 2 if index % 2 == 0 else digit
        total += weighted - 9 if weighted > 9 else weighted
    return ''.join(map(str, digits)) + str((10 - total % 10) % 10)


def call(path, actor, role, method='GET', body=None):
    headers = {'Authorization': 'Bearer ' + token(actor, role), 'User-Agent': UA, 'Idempotency-Key': str(uuid.uuid4())}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, method=method, headers=headers), timeout=15) as r:
            payload = r.read()
            return r.status, json.loads(payload) if payload else None
    except urllib.error.HTTPError as r:
        payload = r.read()
        return r.code, json.loads(payload) if payload else None


def user_id(email: str) -> int:
    return int(query(f"SELECT usuario_id FROM pliego.usuario WHERE email_normalizado=lower('{email}')"))


def admin_id() -> int:
    return int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE'"))


def admin_login():
    """Create a new test principal; never change an existing administrator's password."""
    if (os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') != '1'
            or os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost', '::1')
            or os.environ.get('PGPORT', '5432') in ('5432', '55436', '55539')
            or urlparse(BASE).hostname not in ('127.0.0.1', 'localhost', '::1')):
        raise RuntimeError('admin-login requires an explicitly disposable local PostgreSQL/API stack on an isolated port')
    email = f'cross-device-admin-{uuid.uuid4().hex}@pliego.local'
    password = 'Disposable-' + secrets.token_urlsafe(24)
    body = json.dumps({'email': email, 'password': password, 'firstNames': 'Admin', 'lastNames': 'Prueba'}).encode()
    req = urllib.request.Request(BASE + '/api/v1/auth/register', data=body,
                                 headers={'Content-Type': 'application/json', 'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=15) as response:
        assert response.status == 201, 'Disposable administrator registration failed'
    from email_verification_fixture import verify_registered_email
    verify_registered_email(email, BASE)
    # No public role-management command exists. Promote only the newly registered, verified fixture principal.
    query(f"UPDATE pliego.usuario SET rol='ADMIN' WHERE email_normalizado='{email}' AND rol='CUSTOMER'")
    return {'email': email, 'password': password}


def prepare(email: str):
    actor = user_id(email)
    number = cedula()
    address = int(query(f"""CALL pliego.sp_address_create({actor},'Casa','Lectora Viva','Calle Viva 1',NULL,
      'Quito','Pichincha','EC',NULL,NULL,'+59325550134',TRUE,NULL)""").splitlines()[0].split('|')[0])
    # One stocked paperback in the customer's cart, so the real checkout routine creates the order and its DRAFT invoice.
    suffix = uuid.uuid4().hex[:12]
    query(f"""DO $fixture$
    DECLARE v_admin BIGINT := {admin_id()}; v_author BIGINT; v_pub BIGINT; v_cat BIGINT; v_book BIGINT; v_ed BIGINT;
            v_mov BIGINT; v_before INTEGER; v_after INTEGER; v_cart BIGINT; v_item BIGINT; v_qty INTEGER;
    BEGIN
      CALL pliego.sp_author_create(v_admin,'Autor Vivo {suffix}',NULL,v_author);
      CALL pliego.sp_publisher_create(v_admin,'Editorial Viva {suffix}',NULL,v_pub);
      CALL pliego.sp_category_create(v_admin,'Categoría Viva {suffix}','rt-live-{suffix}',NULL,NULL,v_cat);
      CALL pliego.sp_book_create(v_admin,'Libro Vivo {suffix}',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',v_author,'order',1)),jsonb_build_array(v_cat),v_book);
      CALL pliego.sp_edition_create(v_admin,v_book,v_pub,'RT-LIVE-{suffix}',NULL,'es','PAPERBACK',100,NULL,7.25,NULL,NULL,NULL,NULL,v_ed);
      CALL pliego.sp_inventory_entry(v_admin,v_ed,3,'fixture',v_mov,v_before,v_after);
      CALL pliego.sp_cart_add_item({actor},v_ed,1,v_cart,v_item,v_qty);
    END $fixture$""")
    query(f"CALL pliego.sp_customer_billing_identity_register({actor},'EC_CEDULA','{number}')")
    checkout = query(f"""CALL pliego.sp_checkout_billed_quoted({actor},'{uuid.uuid4()}',{address},'TRANSFER','PENDING',NULL,
      'HOME_DELIVERY',NULL,NULL,'EC_CEDULA','{number}','Lectora Viva','Lectora Viva',NULL,
      'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)""").splitlines()[0].split('|')
    return {'cedula': number, 'orderId': checkout[0], 'invoiceId': checkout[5]}


def request(email: str):
    actor = user_id(email)
    status, identity = call('/api/v1/me/billing-identity', actor, 'CUSTOMER')
    assert status == 200 and identity['correctionMode'] == 'REQUEST', (status, identity)
    proposed = cedula()
    status, created = call('/api/v1/me/billing-identity/correction-requests', actor, 'CUSTOMER', 'POST',
                           {'currentNumber': identity['number'], 'type': 'EC_CEDULA', 'number': proposed, 'reasonCode': 'DOCUMENT_TYPO'})
    assert status == 201, (status, created)
    return {'requestId': created['id'], 'proposedNumber': proposed}


def decide(request_id: str, decision: str):
    # The command is APPROVE/REJECT; the resulting request status is APPROVED/REJECTED.
    body = {'decision': 'APPROVE'} if decision == 'APPROVED' else {'decision': 'REJECT', 'decisionReason': 'La documentación no permite confirmar el cambio.'}
    status, decided = call(f'/api/v1/admin/billing-identity-corrections/{request_id}/decision', admin_id(), 'ADMIN', 'POST', body)
    assert status == 200 and decided['status'] == decision, (status, decided)
    return {'status': decided['status']}


def approve_payment(order_id: str):
    status, body = call(f'/api/v1/admin/orders/{order_id}/approve-payment', admin_id(), 'ADMIN', 'POST')
    assert status in (200, 204), (status, body)
    return {'approved': True}


def digital_edition():
    """An active eBook created through the catalog routines, for the Favorites cart-shortcut journey."""
    suffix = uuid.uuid4().hex[:12]
    title = f'Libro Digital Vivo {suffix}'
    edition = query(f"""DO $fixture$
    DECLARE v_admin BIGINT := {admin_id()}; v_author BIGINT; v_pub BIGINT; v_cat BIGINT; v_book BIGINT; v_ed BIGINT;
    BEGIN
      CALL pliego.sp_author_create(v_admin,'Autora Digital {suffix}',NULL,v_author);
      CALL pliego.sp_publisher_create(v_admin,'Editorial Digital {suffix}',NULL,v_pub);
      CALL pliego.sp_category_create(v_admin,'Categoría Digital {suffix}','rt-digital-{suffix}',NULL,NULL,v_cat);
      CALL pliego.sp_book_create(v_admin,'{title}',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',v_author,'order',1)),jsonb_build_array(v_cat),v_book);
      CALL pliego.sp_edition_create(v_admin,v_book,v_pub,'RT-EPUB-{suffix}',NULL,'es','EBOOK',120,NULL,10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],v_ed);
      PERFORM set_config('pliego.fixture_edition', v_ed::text, false);
    END $fixture$; SELECT current_setting('pliego.fixture_edition')""").splitlines()[-1]
    return {'editionId': edition, 'title': title}


def evidence(email: str, request_id: str):
    acknowledgments = int(query(f"SELECT count(*) FROM pliego.cliente_identificacion_solicitud_acuse WHERE solicitud_id={int(request_id)}"))
    mails = int(query(f"SELECT count(*) FROM pliego.correo_outbox WHERE tipo='BILLING_IDENTITY_DECIDED' AND evento_clave LIKE 'BILLING_IDENTITY_DECIDED:{int(request_id)}:%'"))
    events = query(f"""SELECT coalesce(string_agg(DISTINCT event_name, ',' ORDER BY event_name), '') FROM pliego.realtime_event
      WHERE user_id={user_id(email)}""")
    return {'acknowledgments': acknowledgments, 'decisionMails': mails, 'customerEvents': events.split(',') if events else []}


if __name__ == '__main__':
    command, *args = sys.argv[1:]
    handlers = {'admin-login': admin_login, 'digital-edition': digital_edition, 'prepare': prepare, 'request': request, 'decide': decide, 'approve-payment': approve_payment, 'evidence': evidence}
    print(json.dumps(handlers[command](*args)))
