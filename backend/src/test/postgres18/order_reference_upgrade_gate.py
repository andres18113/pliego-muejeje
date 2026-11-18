"""Fresh disposable database only: Flyway V087 -> latest preserves historical artifacts."""
import json
import uuid
from billing_identity_upgrade_gate import start
from checkout_last_unit import fixture, query


def snapshot():
    return json.loads(query("""SELECT jsonb_build_object(
      'orders',(SELECT jsonb_agg(to_jsonb(p)-'referencia_publica' ORDER BY pedido_id) FROM pliego.pedido p),
      'pickup',(SELECT jsonb_agg(to_jsonb(r)-ARRAY['retirado_por','identidad_verificada'] ORDER BY pedido_id) FROM pliego.pedido_retiro r),
      'invoices',(SELECT jsonb_agg(to_jsonb(f) ORDER BY factura_id) FROM pliego.factura f),
      'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY factura_item_id) FROM pliego.factura_item i),
      'files',(SELECT jsonb_agg(to_jsonb(f) ORDER BY factura_id,tipo) FROM pliego.factura_archivo f),
      'content',(SELECT jsonb_agg(to_jsonb(c) ORDER BY factura_id,tipo) FROM pliego.factura_archivo_contenido c),
      'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY pedido_estado_historial_id) FROM pliego.pedido_estado_historial h),
      'outbox',(SELECT jsonb_agg(to_jsonb(o) ORDER BY correo_id) FROM pliego.correo_outbox o),
      'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY actor_user_id,attempt_key) FROM pliego.checkout_attempt a))"""))


def main():
    start(87)
    actors, _ = fixture()
    actor, _ = actors[0]
    admin = query("SELECT usuario_id FROM pliego.usuario WHERE rol='ADMIN' AND estado='ACTIVE' ORDER BY usuario_id LIMIT 1")
    location = query('SELECT pickup_location_id FROM pliego.fn_pickup_locations() LIMIT 1')
    key = str(uuid.uuid4())
    order = query(f"CALL pliego.sp_checkout_idempotent({actor},'{key}',NULL,'TRANSFER','APPROVED',NULL,'STORE_PICKUP',{location},NULL,NULL,NULL,NULL,NULL)").split('|')[0]
    invoice = query(f"""CALL pliego.sp_invoice_issue({admin},{order},'UPGRADE-REFERENCE','Cliente Prueba','NATIONAL_ID',
      '1710034065',NULL,'Calle Prueba',NULL,'Quito','Pichincha','EC',NULL,NULL)""")
    query("""DO $$ DECLARE job RECORD; BEGIN
      SELECT * INTO job FROM pliego.fn_invoice_artifact_claim();
      PERFORM pliego.fn_invoice_artifact_complete(job.invoice_id,job.file_type,job.lease_owner,decode('255044462d74657374','hex'));
      END; $$""")
    old_code = query(f'SELECT codigo FROM pliego.pedido_retiro WHERE pedido_id={order}')
    query(f"CALL pliego.sp_pickup_collect({admin},{order},'{old_code}')")
    query(f"INSERT INTO pliego.pedido(cliente_id,estado,subtotal,total) SELECT cliente_id,'PENDING_PAYMENT',1,1 FROM pliego.cliente WHERE usuario_id={actor}")
    before = snapshot()
    old_code = query(f'SELECT codigo FROM pliego.pedido_retiro WHERE pedido_id={order}')
    assert len(old_code) == 8, old_code
    start(89)
    assert snapshot() == before, 'Migration changed a historical order, invoice, artifact, mail, receipt or history row'
    assert query("SELECT count(*)=count(DISTINCT referencia_publica) AND bool_and(referencia_publica ~ '^PL-[0-9]{4}-[0-9]{4}$') FROM pliego.pedido") == 't'
    reference = query(f'SELECT referencia_publica FROM pliego.pedido WHERE pedido_id={order}')
    replay = query(f"CALL pliego.sp_checkout_idempotent({actor},'{key}',NULL,'TRANSFER','APPROVED',NULL,'STORE_PICKUP',{location},NULL,NULL,NULL,NULL,NULL)").split('|')[0]
    assert replay == order
    assert query(f"SELECT order_reference FROM pliego.fn_checkout_resolve({actor},'{key}')") == reference
    assert query(f"SELECT pliego.fn_admin_pickup_lookup({admin},'{old_code}')->>'orderReference'") == reference
    assert query(f"SELECT pliego.fn_admin_pickup_lookup({admin},'{old_code}')->>'state'") == 'COLLECTED'
    assert query(f'SELECT retirado_por IS NULL AND identidad_verificada IS NULL FROM pliego.pedido_retiro WHERE pedido_id={order}') == 't'
    assert query(f"SELECT pliego.fn_invoice_snapshot_data({invoice})->>'orderReference'") == reference
    print('Order reference upgrade gate passed: V087->V089 backfill, legacy code/replay, unchanged orders/invoices/files/history/outbox/attempts.')


if __name__ == '__main__':
    main()
