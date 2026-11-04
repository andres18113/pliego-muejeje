"""Real PG18 checkout/expiry races, with observed locks and a known DB deadline.

Run as database owner against disposable PG18 with PLIEGO_TEST_DISPOSABLE_DB=1
and loopback PGHOST/PGPORT/PGDATABASE. --red-only
needs only V105 and demonstrates stale statement-clock pricing before the fix.
No production routine is replaced and no application clock is mocked.
"""
import argparse
import json
import os
import subprocess
import time
import uuid

from checkout_last_unit import PSQL, fixture, query


def wait_for(app, predicate, process, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND {predicate}") == '1':
            return
        if process.poll() is not None:
            output, error = process.communicate()
            raise AssertionError(f'{app} exited before the lock barrier: {output} {error}')
        time.sleep(.02)  # Poll a real PostgreSQL barrier; never infer a lock from elapsed time.
    raise AssertionError(f'{app} did not reach {predicate}')


def start(sql, app, interactive=False):
    process = subprocess.Popen(PSQL + ['-qAt'] + ([] if interactive else ['-c', sql]),
                               env={**os.environ, 'PGAPPNAME': app}, text=True,
                               stdin=subprocess.PIPE if interactive else None,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if interactive:
        process.stdin.write(sql + '\n')
        process.stdin.flush()
    return process


def finish_holder(process, commit=True):
    process.stdin.write(('COMMIT;' if commit else 'ROLLBACK;') + '\n\\q\n')
    process.stdin.flush()
    output, error = process.communicate(timeout=10)
    assert process.returncode == 0, error
    return output


def stop(process):
    if process is not None and process.poll() is None:
        process.terminate()
        process.communicate(timeout=10)


def expiry_fixture(kind):
    actors, physical = fixture()
    actor = actors[0][0]
    admin, book, publisher = map(int, query(f"""SELECT u.usuario_id,e.libro_id,e.editorial_id
      FROM pliego.edicion e JOIN pliego.usuario u
      ON u.email_normalizado='i8-conc-admin-'||lower(substring(e.sku FROM 9))||'@pliego.local'
      WHERE e.edicion_id={physical}""").split('|'))
    editions = [(physical, '7.25', '3.00')]
    if kind in ('digital', 'mixed'):
        digital = int(query(f"CALL pliego.sp_edition_create({admin},{book},{publisher},'EXPIRY-{uuid.uuid4().hex.upper()}',NULL,'es','EBOOK',NULL,NULL,20,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],NULL)"))
        if kind == 'digital':
            item = query(f"SELECT ci.carrito_item_id FROM pliego.carrito c JOIN pliego.cliente cl USING(cliente_id) JOIN pliego.carrito_item ci USING(carrito_id) WHERE cl.usuario_id={actor} AND c.estado='ACTIVE'")
            query(f'CALL pliego.sp_cart_remove_item({actor},{item})')
            editions = []
        query(f'CALL pliego.sp_cart_add_item({actor},{digital},1,NULL,NULL,NULL)')
        editions.append((digital, '20.00', '15.00'))
    cart = int(query(f"SELECT cart_id FROM pliego.fn_cart_checkout_quote({actor})"))
    # The deadline is assigned only after the complete catalog/cart fixture exists.
    end = query("SELECT clock_timestamp()+INTERVAL '3 seconds'")
    for edition, _, discount in editions:
        query(f"CALL pliego.sp_edition_offer_set({admin},{edition},{discount},clock_timestamp()-INTERVAL '1 day','{end}',NULL)")
    accepted = query(f'SELECT quote_fingerprint FROM pliego.fn_cart_checkout_quote({actor})')
    discounted = str(sum(float(discount) for _, _, discount in editions))
    assert query(f'SELECT subtotal::NUMERIC(30,2)={discounted} FROM pliego.fn_cart_checkout_quote({actor})') == 't'
    pickup = query('SELECT pickup_location_id FROM pliego.fn_pickup_locations() LIMIT 1')
    return {'actor': actor, 'admin': admin, 'physical': physical, 'editions': editions,
            'cart': cart, 'end': end, 'accepted': accepted,
            'fulfillment': 'DIGITAL_ONLY' if kind == 'digital' else 'STORE_PICKUP',
            'pickup': 'NULL' if kind == 'digital' else pickup}


def checkout_sql(data, key, quoted, outcome='APPROVED'):
    args = f"{data['actor']},'{key}',NULL,'TRANSFER','{outcome}',{data['cart']},'{data['fulfillment']}',{data['pickup']}"
    if quoted:
        return f"""CALL pliego.sp_checkout_billed_quoted({args},'{data['accepted']}',
         'OTHER','EC_CEDULA','0912345675','Destinatario de prueba','Calle de prueba',NULL,
         'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)"""
    return f'CALL pliego.sp_checkout_idempotent({args},NULL,NULL,NULL,NULL,NULL)'


def persisted_snapshot(data):
    return json.loads(query(f"""SELECT jsonb_build_object('orders',
      (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY pedido_id),'[]') FROM pliego.pedido p
       JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={data['actor']}),
      'items',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY pedido_item_id),'[]')
       FROM pliego.pedido_item i JOIN pliego.pedido p USING(pedido_id)
       JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={data['actor']}))"""))


def assert_rollback(data, key):
    actor, physical = data['actor'], data['physical']
    result = query(f"""SELECT
      (SELECT count(*) FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}),
      (SELECT count(*) FROM pliego.pago pay JOIN pliego.pedido p USING(pedido_id) JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}),
      (SELECT count(*) FROM pliego.pedido_item i JOIN pliego.pedido p USING(pedido_id) JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}),
      (SELECT count(*) FROM pliego.movimiento_inventario WHERE edicion_id={physical} AND tipo='SALE'),
      (SELECT stock_actual FROM pliego.inventario WHERE edicion_id={physical}),
      (SELECT estado FROM pliego.carrito WHERE carrito_id={data['cart']}),
      (SELECT count(*) FROM pliego.checkout_attempt WHERE actor_user_id={actor} AND attempt_key='{key}'),
      (SELECT count(*) FROM pliego.checkout_billing_attempt WHERE actor_user_id={actor} AND attempt_key='{key}'),
      (SELECT count(*) FROM pliego.factura f JOIN pliego.pedido p USING(pedido_id) JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}),
      (SELECT count(*) FROM pliego.digital_ownership WHERE cliente_id=(SELECT cliente_id FROM pliego.cliente WHERE usuario_id={actor})),
      (SELECT count(*) FROM pliego.correo_outbox WHERE usuario_id={actor} AND tipo='ORDER_CONFIRMED')""")
    assert result == '0|0|0|0|1|ACTIVE|0|0|0|0|0', f'Expired accepted quote left durable effects: {result}'
    assert query(f'SELECT count(*) FROM pliego.carrito_item WHERE carrito_id={data["cart"]}') == str(len(data['editions']))


def assert_regular_order(data, key, require_instant):
    actor = data['actor']
    order = query(f'SELECT p.pedido_id FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={actor}')
    expected_total = sum(float(base) for _, base, _ in data['editions'])
    result = query(f"SELECT subtotal={expected_total},total={expected_total} FROM pliego.pedido WHERE pedido_id={order}")
    assert result == 't|t', f'RED: checkout after expiry kept a stale discounted total: {result}; order={order}'
    for edition, base, _ in data['editions']:
        row = query(f"""SELECT precio_unitario={base},precio_original_snapshot={base},
          ahorro_unitario_snapshot=0,subtotal_original_snapshot={base},ahorro_linea_snapshot=0
          FROM pliego.pedido_item WHERE pedido_id={order} AND edicion_id={edition}""")
        assert row == 't|t|t|t|t', f'Checkout snapshots disagreed with expired price: {row}'
    if require_instant:
        assert query(f"SELECT pricing_evaluated_at>='{data['end']}'::TIMESTAMPTZ FROM pliego.pedido WHERE pedido_id={order}") == 't', 'Pricing instant preceded the last lock/expiry'
    snapshot = persisted_snapshot(data)
    # Replay after a new offer and base-price edit must preserve the original paid
    # receipt and its snapshots, including pricing_evaluated_at.
    for edition, base, _ in data['editions']:
        query(f"UPDATE pliego.edicion SET precio={float(base)+10} WHERE edicion_id={edition}")
        query(f"CALL pliego.sp_edition_offer_set({data['admin']},{edition},1,clock_timestamp()-INTERVAL '1 day',clock_timestamp()+INTERVAL '1 day',NULL)")
    query(checkout_sql(data, key, False))
    assert persisted_snapshot(data) == snapshot, 'Idempotent replay repriced an immutable order'
    return order


def run_case(kind, lock, quoted, require_instant=True):
    data = expiry_fixture(kind)
    suffix = uuid.uuid4().hex
    key = str(uuid.uuid4())
    holder = checkout = None
    try:
        if lock != 'none':
            lock_table = 'edicion' if lock == 'edition' else 'inventario'
            locked = data['editions'][-1][0] if lock == 'edition' else data['physical']
            holder = start(f'BEGIN; SELECT edicion_id FROM pliego.{lock_table} WHERE edicion_id={locked} FOR UPDATE;', 'expiry-holder-'+suffix, True)
            wait_for('expiry-holder-'+suffix, "state='idle in transaction'", holder)
            checkout = start(checkout_sql(data, key, quoted), 'expiry-checkout-'+suffix)
            wait_for('expiry-checkout-'+suffix, "wait_event_type='Lock'", checkout)
            # Observe that the blocked command really started before expiry.
            assert query(f"SELECT query_start<'{data['end']}'::TIMESTAMPTZ FROM pg_stat_activity WHERE application_name='expiry-checkout-{suffix}'") == 't', 'Checkout was not issued before offer expiry'
            query(f"SELECT pg_sleep_until('{data['end']}'::TIMESTAMPTZ)")
            finish_holder(holder)
            output, error = checkout.communicate(timeout=15)
            code = checkout.returncode
        else:
            query(f"SELECT pg_sleep_until('{data['end']}'::TIMESTAMPTZ)")
            completed = subprocess.run(PSQL + ['-At', '-c', checkout_sql(data, key, quoted)], capture_output=True, text=True, timeout=15)
            output, error, code = completed.stdout, completed.stderr, completed.returncode
        if quoted:
            assert code != 0 and 'P4005' in error, f'Expired quote was accepted or failed for the wrong reason: {code} {output} {error}'
            assert_rollback(data, key)
        else:
            assert code == 0, f'Unquoted checkout failed: {output} {error}'
            assert_regular_order(data, key, require_instant)
        print(f'PASS: {kind}; {lock} lock; {"accepted quote P4005 with atomic rollback" if quoted else "fresh paid snapshots and stable idempotent replay"}')
    finally:
        stop(checkout)
        stop(holder)


def expiry_after_pricing_before_item_insert():
    if os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') != '1' or os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost', '::1'):
        raise SystemExit('Item-insert barrier requires PLIEGO_TEST_DISPOSABLE_DB=1 and explicit loopback PGHOST')
    data = expiry_fixture('mixed')
    key = str(uuid.uuid4())
    barrier = int(uuid.uuid4().hex[:15], 16)
    name = 'offer-snapshot-insert-' + uuid.uuid4().hex
    holder = checkout = None
    try:
        holder = start(f'BEGIN; SELECT pg_advisory_xact_lock({barrier});', name+'-holder', True)
        wait_for(name+'-holder', "state='idle in transaction'", holder)
        # Install the narrow test barrier in the checkout's own transaction, then
        # remove it before commit. It delays insertion only, after the real
        # routine has captured its pricing instant and created the order header.
        # No production predicate or clock is replaced.
        checkout = start(f"""BEGIN;
          CREATE FUNCTION pg_temp.offer_snapshot_barrier() RETURNS TRIGGER LANGUAGE plpgsql AS $barrier$
          BEGIN
           IF NEW.edicion_id={data['physical']} THEN PERFORM pg_advisory_xact_lock({barrier}); END IF;
           RETURN NEW;
          END $barrier$;
          CREATE TRIGGER aa_offer_expiry_gate_wait BEFORE INSERT ON pliego.pedido_item
            FOR EACH ROW EXECUTE FUNCTION pg_temp.offer_snapshot_barrier();
          {checkout_sql(data, key, True)};
          DROP TRIGGER aa_offer_expiry_gate_wait ON pliego.pedido_item;
          DROP FUNCTION pg_temp.offer_snapshot_barrier();
          COMMIT;""", name)
        wait_for(name, "wait_event_type='Lock' AND wait_event='advisory'", checkout)
        assert query(f"SELECT query_start<'{data['end']}'::TIMESTAMPTZ FROM pg_stat_activity WHERE application_name='{name}'") == 't'
        query(f"SELECT pg_sleep_until('{data['end']}'::TIMESTAMPTZ)")
        finish_holder(holder)
        output, error = checkout.communicate(timeout=15)
        assert checkout.returncode == 0, f'Pricing instant/snapshot capture disagreed across expiry: {output} {error}'
        order = query(f"SELECT p.pedido_id FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={data['actor']}")
        result = query(f"SELECT pricing_evaluated_at<'{data['end']}'::TIMESTAMPTZ,subtotal,total FROM pliego.pedido WHERE pedido_id={order}")
        assert result == 't|18.00|18.00', f'Expiry after pricing changed the accepted paid total: {result}'
        for edition, base, discount in data['editions']:
            row = query(f"""SELECT precio_unitario={discount},precio_original_snapshot={base},
              ahorro_unitario_snapshot={base}-{discount},subtotal_original_snapshot={base},
              ahorro_linea_snapshot={base}-{discount}
              FROM pliego.pedido_item WHERE pedido_id={order} AND edicion_id={edition}""")
            assert row == 't|t|t|t|t', f'Item capture used a later clock than its order header: {row}'
        before = persisted_snapshot(data)
        replay = query(checkout_sql(data, key, True))
        assert replay.split('|')[0] == order, replay
        assert persisted_snapshot(data) == before, 'Paid discounted replay changed after natural offer expiry'
        query(f"""DO $immutable$ BEGIN
          BEGIN
           UPDATE pliego.pedido SET pricing_evaluated_at=clock_timestamp() WHERE pedido_id={order};
           RAISE EXCEPTION 'Historical pricing instant accepted an update';
          EXCEPTION WHEN SQLSTATE 'P9001' THEN NULL; END;
        END $immutable$""")
        assert persisted_snapshot(data) == before, 'Historical pricing instant mutation was not rolled back'
        assert query("SELECT count(*) FROM pg_trigger WHERE tgname='aa_offer_expiry_gate_wait'") == '0', 'Test barrier persisted'
    finally:
        stop(checkout)
        stop(holder)
    print('PASS: expiry after pricing but before item insertion preserves one discounted decision; paid replay and pricing instant remain immutable')


def quoted_payment_outcomes():
    for outcome in ('PENDING', 'REJECTED'):
        data = expiry_fixture('mixed')
        # Keep the price accepted throughout these controls: they verify the
        # created-order hash also matches non-approved payment branches.
        for edition, _, discount in data['editions']:
            query(f"CALL pliego.sp_edition_offer_set({data['admin']},{edition},{discount},clock_timestamp()-INTERVAL '1 day',clock_timestamp()+INTERVAL '1 day',NULL)")
        key = str(uuid.uuid4())
        output = query(checkout_sql(data, key, True, outcome))
        order, state, payment, total, _, invoice = output.split('|')
        expected_state = 'PENDING_PAYMENT' if outcome == 'PENDING' else 'CANCELLED'
        assert (state, payment, total) == (expected_state, outcome, '18.00'), output
        assert bool(invoice) == (outcome == 'PENDING'), output
        before = persisted_snapshot(data)
        assert query(checkout_sql(data, key, True, outcome)) == output, 'Non-approved receipt replay changed'
        assert persisted_snapshot(data) == before, 'Non-approved replay changed historical snapshots'
        assert query(f'SELECT precio_unitario FROM pliego.pedido_item WHERE pedido_id={order} ORDER BY edicion_id') == '3.00\n15.00'
        print(f'PASS: quoted {outcome} order retains accepted hash, consistent discounted snapshots and stable replay')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--red-only', action='store_true', help='Run the V105 behavioral regression before migrating')
    options = parser.parse_args()
    if not all(os.environ.get(key) for key in ('PGHOST', 'PGPORT', 'PGDATABASE')):
        raise SystemExit('Set PGHOST, PGPORT and PGDATABASE for a disposable PostgreSQL 18 database')
    if options.red_only:
        run_case('physical', 'edition', False, require_instant=False)
        return
    for kind, lock in [('physical', 'none'), ('digital', 'none'), ('physical', 'edition'),
                       ('digital', 'edition'), ('physical', 'inventory'), ('mixed', 'inventory')]:
        for quoted in (False, True):
            run_case(kind, lock, quoted)
    expiry_after_pricing_before_item_insert()
    quoted_payment_outcomes()
    print('PASS: 15 checkout cases, including lock-straddling expiry, one pricing decision, atomic quote rollback, payment outcomes and immutable replay')


if __name__ == '__main__':
    main()
