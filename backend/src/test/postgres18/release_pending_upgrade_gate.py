"""Disposable localhost PostgreSQL 18: real Flyway V087 -> latest with history.

Use an empty database and the current backend JAR. All provider calls, artifact
workers and schedulers stay disabled. --seed-only supports a reviewed V087
fixture before a candidate JAR is built; --verify-only resumes that fixture.
The evidence file contains fictional fixture data only and belongs under /tmp.
"""
import argparse
import json
import os
from pathlib import Path
import re
import uuid

from billing_identity_upgrade_gate import start
from checkout_last_unit import fixture, query


def scalar(sql):
    return query(sql).splitlines()[0]


def snapshot():
    # Exclude only additive columns introduced by the pending migrations.
    return json.loads(scalar("""SELECT jsonb_build_object(
      'users',(SELECT jsonb_agg(to_jsonb(u)-ARRAY['email_cambiado_en','email_no_entregable_desde',
          'email_entrega_evento_en','email_entrega_prioridad','email_entrega_evento_id','email_entrega_motivo']
          ORDER BY usuario_id) FROM pliego.usuario u),
      'customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY cliente_id) FROM pliego.cliente c),
      'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY sesion_id) FROM pliego.sesion_autenticacion s),
      'tokens',(SELECT jsonb_agg(to_jsonb(t) ORDER BY usuario_id,tipo) FROM pliego.correo_token t),
      'orders',(SELECT jsonb_agg(to_jsonb(p)-'referencia_publica' ORDER BY pedido_id) FROM pliego.pedido p),
      'orderItems',(SELECT jsonb_agg(to_jsonb(i) ORDER BY pedido_item_id) FROM pliego.pedido_item i),
      'pickup',(SELECT jsonb_agg(to_jsonb(r)-ARRAY['retirado_por','identidad_verificada'] ORDER BY pedido_id)
          FROM pliego.pedido_retiro r),
      'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY pago_id) FROM pliego.pago p),
      'invoices',(SELECT jsonb_agg(to_jsonb(f) ORDER BY factura_id) FROM pliego.factura f),
      'invoiceItems',(SELECT jsonb_agg(to_jsonb(i) ORDER BY factura_item_id) FROM pliego.factura_item i),
      'files',(SELECT jsonb_agg(to_jsonb(f) ORDER BY factura_id,tipo) FROM pliego.factura_archivo f),
      'content',(SELECT jsonb_agg(to_jsonb(c) ORDER BY factura_id,tipo) FROM pliego.factura_archivo_contenido c),
      'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY pedido_estado_historial_id)
          FROM pliego.pedido_estado_historial h),
      'outbox',(SELECT jsonb_agg(to_jsonb(o)-ARRAY['entrega_estado','entrega_evento_en','entrega_evento_id',
          'entrega_prioridad','destinatario_capturado_en'] ORDER BY correo_id) FROM pliego.correo_outbox o),
      'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY actor_user_id,attempt_key) FROM pliego.checkout_attempt a))"""))


def seed():
    assert scalar('SELECT max(version)::integer FROM public.flyway_schema_history WHERE success') == '87'
    actors, edition = fixture()
    actor, address = actors[0]
    unverified, _ = actors[1]
    admin = scalar("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' ORDER BY usuario_id LIMIT 1")
    suffix = uuid.uuid4().hex[:12]
    query(f"SELECT pliego.fn_email_action_enqueue({actor},'VERIFY_EMAIL','{'1'*64}','{'A'*43}')")
    assert scalar(f"SELECT pliego.fn_email_action_consume('VERIFY_EMAIL','{'1'*64}',NULL)") == 't'
    query(f"SELECT pliego.fn_auth_session_create({actor},'{'2'*64}',clock_timestamp()+INTERVAL '30 days')")
    query(f"CALL pliego.sp_inventory_entry({admin},{edition},6,'release upgrade fixture',NULL,NULL,NULL)")
    home_key = str(uuid.uuid4())
    home = scalar(f"CALL pliego.sp_checkout_idempotent({actor},'{home_key}',{address},'TRANSFER','APPROVED',NULL,'HOME_DELIVERY',NULL,NULL,NULL,NULL,NULL,NULL)").split('|')[0]
    location = scalar('SELECT pickup_location_id FROM pliego.fn_pickup_locations() LIMIT 1')
    pickup_key = str(uuid.uuid4())
    pickup = scalar(f"CALL pliego.sp_checkout_idempotent({unverified},'{pickup_key}',NULL,'TRANSFER','APPROVED',NULL,'STORE_PICKUP',{location},NULL,NULL,NULL,NULL,NULL)").split('|')[0]
    invoice = scalar(f"""CALL pliego.sp_invoice_issue({admin},{home},'RELEASE-UPGRADE-{suffix}',
        'Cliente de prueba','NATIONAL_ID','1710034065',NULL,'Calle de prueba',NULL,
        'Quito','Pichincha','EC',NULL,NULL)""")
    query("""DO $$ DECLARE job RECORD; BEGIN
      SELECT * INTO job FROM pliego.fn_invoice_artifact_claim();
      PERFORM pliego.fn_invoice_artifact_complete(job.invoice_id,job.file_type,job.lease_owner,
        decode('255044462d312e340a2572656c6561736520666978747572650a','hex'));
      END; $$""")
    code = scalar(f'SELECT codigo FROM pliego.pedido_retiro WHERE pedido_id={pickup}')
    query(f"CALL pliego.sp_pickup_collect({admin},{pickup},'{code}')")
    # Add a pending registration as well as the unverified SQL fixture account.
    query(f"""CALL pliego.sp_customer_register_with_verification('release-pending-{suffix}@example.invalid',
        'fixture-hash','Cliente','Pendiente',NULL,'{'3'*64}','{'B'*43}',NULL,NULL,NULL)""")
    # This is a fictional historical provider acceptance, with a realistic snapshot.
    query(f"""INSERT INTO pliego.correo_outbox(evento_clave,tipo,usuario_id,destinatario,datos,estado,
        intentos,fecha_envio,id_mensaje_proveedor)
      SELECT 'release-accepted-{suffix}',tipo,usuario_id,destinatario,datos,'SENT',1,
        clock_timestamp(),'release-legacy-{suffix}' FROM pliego.correo_outbox
      WHERE evento_clave='ORDER_CONFIRMED:'||{home}""")
    assert scalar(f'SELECT email_verificado_en IS NOT NULL FROM pliego.usuario WHERE usuario_id={actor}') == 't'
    assert scalar(f'SELECT email_verificado_en IS NULL FROM pliego.usuario WHERE usuario_id={unverified}') == 't'
    assert scalar(f"SELECT estado FROM pliego.factura WHERE factura_id={invoice}") == 'ISSUED'
    return {'before': snapshot(), 'actor': actor, 'unverified': unverified, 'home': home,
            'pickup': pickup, 'invoice': invoice, 'homeKey': home_key, 'pickupKey': pickup_key,
            'pickupCode': code, 'receipt': 'release-legacy-' + suffix}


def verify(evidence):
    latest = max(int(re.match(r'V(\d+)__', path.name).group(1)) for path in
                 (Path(__file__).resolve().parents[2] / 'main/resources/db/migration').glob('V*__*.sql'))
    assert latest >= 94, 'Build the pending email-change migration before verifying this release'
    start(latest)
    assert scalar('SELECT max(version)::integer FROM public.flyway_schema_history WHERE success') == str(latest)
    assert scalar('SELECT count(*) FROM public.flyway_schema_history WHERE success AND version IS NOT NULL') == str(latest)
    after = snapshot()
    assert after == evidence['before'], 'Pending migrations changed historical identity/session/order/invoice/outbox rows'
    assert scalar("SELECT count(*)=count(DISTINCT referencia_publica) AND bool_and(referencia_publica ~ '^PL-[0-9]{4}-[0-9]{4}$') FROM pliego.pedido") == 't'
    actor, home = evidence['actor'], evidence['home']
    assert scalar(f"SELECT order_reference FROM pliego.fn_checkout_resolve({actor},'{evidence['homeKey']}')") == scalar(f'SELECT referencia_publica FROM pliego.pedido WHERE pedido_id={home}')
    assert scalar(f"SELECT pending_email_address IS NULL FROM pliego.fn_customer_profile_email_change({actor})") == 't'
    assert scalar(f"SELECT email_verified FROM pliego.fn_customer_profile_email_change({evidence['unverified']})") == 'f'
    receipt = evidence['receipt']
    query(f"SELECT pliego.fn_mail_event_record('release-upgrade-bounce','{receipt}','BOUNCED','HARD_BOUNCE',clock_timestamp(),'MAILTRAP')")
    assert scalar('SELECT pliego.fn_mail_event_project_next()') == 't'
    assert scalar(f"SELECT entrega_estado FROM pliego.correo_outbox WHERE id_mensaje_proveedor='{receipt}'") == 'BOUNCED'
    print(f'Release upgrade passed: V087→V{latest:03}, verified/unverified customers, refresh session, orders, '
          'legacy pickup, invoice/PDF bytes, pending/SENT outbox snapshots and receipts preserved; '
          'public references backfilled; V093 receipt correlation and V094 profile available.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seed-only', action='store_true')
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--evidence', type=Path, default=Path('/tmp/pliego-release-v087-evidence.json'))
    args = parser.parse_args()
    assert os.environ.get('PGHOST') in ('127.0.0.1', 'localhost'), 'Disposable loopback DB required'
    assert scalar('SHOW server_version_num').startswith('18'), 'PostgreSQL 18 required'
    assert str(args.evidence).startswith('/tmp/'), 'Keep fictional identity fixtures outside the repository'
    assert not (args.seed_only and args.verify_only)
    if not args.verify_only:
        if not args.seed_only:
            start(87)
        evidence = seed()
        args.evidence.write_text(json.dumps(evidence, indent=2) + '\n')
        args.evidence.chmod(0o600)
        print('V087 fixture and historical snapshot prepared locally.')
    else:
        evidence = json.loads(args.evidence.read_text())
    if not args.seed_only:
        verify(evidence)


if __name__ == '__main__':
    main()
