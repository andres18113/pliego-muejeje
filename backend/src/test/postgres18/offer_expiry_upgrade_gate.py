"""Packaged Flyway V105 -> V106 over populated, disposable PostgreSQL 18.

Offer, fulfillment, realtime, invoice and mail workers/providers are disabled. Logs stay in
.release-evidence/2026-11-04/offers/upgrade. The installation race uses a short
lived clone of the stopped V105 fixture; it never changes Flyway's real upgrade.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid
import zipfile

from checkout_last_unit import PSQL, fixture


ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / '.release-evidence/2026-11-04/offers/upgrade'
MIGRATION = 'V106__offer_expiration_and_refresh.sql'


def environment(database=None):
    result = os.environ.copy()
    if database:
        result['PGDATABASE'] = database
    return result


def query(sql, database=None):
    result = subprocess.run(PSQL + ['-qAt', '-c', sql], env=environment(database),
                            text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError(f'Upgrade SQL failed: {result.stderr}')
    return result.stdout.strip()


def write_json(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def terminate(process):
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def migrate(jar, target):
    """Use the executable JAR's Flyway configuration, then stop the backend."""
    log = EVIDENCE / f'flyway-v{target}.backend.log'
    child_env = environment()
    # Bind the Java connection to the SAME explicitly guarded PGDATABASE used
    # by psql, even if a caller inherited a JDBC URL for another local fixture.
    child_env['PLIEGO_DB_URL'] = (
        f"jdbc:postgresql://{os.environ['PGHOST']}:{os.environ['PGPORT']}/{os.environ['PGDATABASE']}")
    with log.open('w') as stream:
        process = subprocess.Popen([
            'java', '-XX:ActiveProcessorCount=2', '-Xmx512m', '-jar', str(jar),
            '--server.address=127.0.0.1', '--server.port=0',
            f'--spring.flyway.target={target}', '--pliego.offers.scheduler-enabled=false',
            '--pliego.realtime.enabled=false', '--pliego.home-delivery.scheduler-enabled=false',
            '--pliego.billing.enabled=false', '--pliego.mail.enabled=false',
            '--pliego.mail.webhook.secret=',
            '--pliego.r2.enabled=false', '--pliego.r2.production-storage=false',
        ], env=child_env, stdout=stream, stderr=stream)
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AssertionError(f'Packaged Flyway startup failed; inspect {log}')
            if 'Started PliegoApplication' in log.read_text():
                actual = query("SELECT count(*)::TEXT||':'||max(version)::INTEGER "
                               'FROM public.flyway_schema_history WHERE success AND version IS NOT NULL')
                assert actual == f'{target}:{target}', f'Unexpected Flyway history: {actual}'
                return
            time.sleep(.1)
        raise AssertionError(f'Packaged Flyway startup timed out; inspect {log}')
    finally:
        terminate(process)


def table_snapshots(tables, after_upgrade=False):
    result = {}
    for table in tables:
        # These additive columns must not disguise a change to any old value.
        row = 'to_jsonb(t)'
        if after_upgrade and table == 'pedido':
            row += "-'pricing_evaluated_at'"
        if after_upgrade and table == 'realtime_event':
            row += "-'public_scope'"
        result[table] = query(f"SELECT COALESCE(jsonb_agg(r ORDER BY r::TEXT),'[]'::JSONB) "
                              f'FROM (SELECT {row} AS r FROM pliego."{table}" t) snapshots')
    return result


def snapshot_digests(snapshots):
    # Do not write raw user/session/outbox contents into evidence files.
    return {table: hashlib.sha256(value.encode()).hexdigest() for table, value in snapshots.items()}


def prepare_history():
    actors, physical = fixture()
    admin, book, publisher = map(int, query(f"""SELECT u.usuario_id,e.libro_id,e.editorial_id
      FROM pliego.edicion e JOIN pliego.usuario u
       ON u.email_normalizado='i8-conc-admin-'||lower(substring(e.sku FROM 9))||'@pliego.local'
      WHERE e.edicion_id={physical}""").split('|'))
    suffix = uuid.uuid4().hex.upper()

    def digital(name, format_code, price):
        ebook = "'EPUB'" if format_code == 'EBOOK' else 'NULL'
        duration = '3600' if format_code == 'AUDIOBOOK' else 'NULL'
        narrators = "ARRAY['Narrador de migración']::TEXT[]" if format_code == 'AUDIOBOOK' else 'ARRAY[]::TEXT[]'
        return int(query(f"""CALL pliego.sp_edition_create({admin},{book},{publisher},
          'OFFER-UPGRADE-{name}-{suffix}',NULL,'es','{format_code}',NULL,NULL,{price},
          NULL,NULL,NULL,NULL,{ebook},{duration},{narrators},NULL)"""))

    ebook = digital('EBOOK', 'EBOOK', '20.00')
    audio = digital('AUDIO', 'AUDIOBOOK', '30.00')
    inactive = digital('INACTIVE', 'EBOOK', '20.00')
    writer_edition = digital('INSTALL-WRITER', 'EBOOK', '20.00')
    for edition, price in [(physical, '3.00'), (ebook, '15.00'), (audio, '25.00'), (inactive, '10.00')]:
        query(f"CALL pliego.sp_edition_offer_set({admin},{edition},{price},"
              "clock_timestamp()-INTERVAL '1 day',clock_timestamp()+INTERVAL '1 day',NULL)")

    physical_actor, address = actors[0]
    key = uuid.uuid4()
    physical_command = (f"CALL pliego.sp_checkout_idempotent({physical_actor},'{key}',{address},"
                        "'TRANSFER','APPROVED',NULL,'HOME_DELIVERY',NULL,NULL,NULL,NULL,NULL,NULL)")
    physical_receipt = query(physical_command)
    assert physical_receipt.split('|')[3] == '3.00', physical_receipt

    digital_actor = actors[1][0]
    cart_item = query(f"""SELECT ci.carrito_item_id FROM pliego.carrito_item ci
      JOIN pliego.carrito c USING(carrito_id) JOIN pliego.cliente customer USING(cliente_id)
      WHERE customer.usuario_id={digital_actor} AND c.estado='ACTIVE'""")
    query(f'CALL pliego.sp_cart_remove_item({digital_actor},{cart_item})')
    for edition in [ebook, audio]:
        query(f'CALL pliego.sp_cart_add_item({digital_actor},{edition},1,NULL,NULL,NULL)')
    cart, accepted = query(f'SELECT cart_id,quote_fingerprint FROM pliego.fn_cart_checkout_quote({digital_actor})').split('|')
    digital_command = f"""CALL pliego.sp_checkout_billed_quoted({digital_actor},'{uuid.uuid4()}',NULL,
      'TRANSFER','APPROVED',{cart},'DIGITAL_ONLY',NULL,'{accepted}',
      'OTHER','EC_CEDULA','0912345675','Destinatario de migración','Calle de migración',NULL,
      'Quito','Pichincha','EC',NULL,NULL,NULL,NULL,NULL,NULL,NULL)"""
    digital_receipt = query(digital_command)
    assert digital_receipt.split('|')[3] == '40.00', digital_receipt

    # Model downtime across both boundaries while retaining ACTIVE history.
    query(f"CALL pliego.sp_edition_offer_set({admin},{physical},3.00,"
          "clock_timestamp()-INTERVAL '3 days',clock_timestamp()-INTERVAL '1 day',NULL)")
    query(f"CALL pliego.sp_edition_offer_set({admin},{audio},25.00,"
          "clock_timestamp()+INTERVAL '1 day',clock_timestamp()+INTERVAL '2 days',NULL)")
    query(f'CALL pliego.sp_edition_offer_clear({admin},{inactive})')
    offers = {}
    for name, edition in [('expired', physical), ('current', ebook), ('scheduled', audio), ('inactive', inactive)]:
        offers[name] = int(query(f'SELECT oferta_id FROM pliego.edicion_oferta WHERE edicion_id={edition}'))
    orders = [int(physical_receipt.split('|')[0]), int(digital_receipt.split('|')[0])]
    assert query(f"SELECT count(*) FROM pliego.pedido_item WHERE pedido_id IN({','.join(map(str, orders))}) "
                 'AND precio_original_snapshot IS NOT NULL AND ahorro_unitario_snapshot>0') == '3'
    return {'admin': admin, 'writerEdition': writer_edition, 'offers': offers, 'orders': orders,
            'replays': [(physical_command, physical_receipt), (digital_command, digital_receipt)]}


def wait_for(app, predicate, process, database):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if query(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND {predicate}", database) == '1':
            return
        if process.poll() is not None:
            raise AssertionError(f'{app} exited before its PostgreSQL barrier; inspect upgrade logs')
        time.sleep(.02)
    raise AssertionError(f'{app} did not reach PostgreSQL barrier: {predicate}')


def installation_writer_race(migration, data):
    """A writer started before seed must wait, then hit the committed trigger."""
    trigger_end = 'FOR EACH ROW EXECUTE FUNCTION pliego.fn_offer_transition_changed();'
    seed = 'INSERT INTO pliego.offer_transition(offer_id,next_transition_at)'
    trigger_at, seed_at = migration.index(trigger_end), migration.index(seed)
    assert trigger_at < seed_at, 'Existing-row seed precedes trigger installation and leaves a capture gap'
    assert migration.count(trigger_end) == 1
    clone = 'offers_upgrade_install_' + uuid.uuid4().hex[:10]
    barrier = int(uuid.uuid4().hex[:12], 16)
    guardian = installer = writer = None
    streams = []

    def start(app, sql=None, interactive=False, sql_file=None):
        stream = (EVIDENCE / f'{app}.log').open('w')
        streams.append(stream)
        arguments = PSQL + ['-qAt']
        if sql_file:
            arguments += ['-f', str(sql_file)]
        elif not interactive:
            arguments += ['-c', sql]
        process = subprocess.Popen(arguments, env={**environment(clone), 'PGAPPNAME': app},
                                   stdin=subprocess.PIPE if interactive else None, stdout=stream,
                                   stderr=stream, text=True)
        if interactive:
            process.stdin.write(sql + '\n')
            process.stdin.flush()
        return process

    created = subprocess.run(['createdb', '--maintenance-db=postgres',
                              f'--template={os.environ["PGDATABASE"]}', clone],
                             env=environment(), text=True, capture_output=True, timeout=20)
    assert created.returncode == 0, f'Cannot create disposable migration-race clone: {created.stderr}'
    try:
        guardian_name = 'offer-install-barrier-' + uuid.uuid4().hex[:10]
        guardian = start(guardian_name, f'BEGIN; SELECT pg_advisory_xact_lock({barrier});', True)
        wait_for(guardian_name, "state='idle in transaction'", guardian, clone)
        instrumented = migration.replace(trigger_end, trigger_end + f'\nSELECT pg_advisory_xact_lock({barrier});')
        sql_path = EVIDENCE / 'v106-installation-barrier.sql'
        sql_path.write_text('BEGIN;\n' + instrumented + '\nCOMMIT;\n')
        installer_name = 'offer-install-migration-' + uuid.uuid4().hex[:10]
        installer = start(installer_name, sql_file=sql_path)
        wait_for(installer_name, "wait_event='advisory'", installer, clone)
        writer_name = 'offer-install-writer-' + uuid.uuid4().hex[:10]
        writer = start(writer_name, f"CALL pliego.sp_edition_offer_set({data['admin']},{data['writerEdition']},"
                       "15.00,clock_timestamp()-INTERVAL '1 day',clock_timestamp()+INTERVAL '1 day',NULL)")
        wait_for(writer_name, "wait_event_type='Lock'", writer, clone)
        assert query(f"""SELECT EXISTS(SELECT FROM pg_locks locks JOIN pg_stat_activity a USING(pid)
          WHERE a.application_name='{writer_name}' AND NOT locks.granted AND locks.locktype='relation'
          AND locks.relation='pliego.edicion_oferta'::REGCLASS AND locks.mode='RowExclusiveLock')""", clone) == 't', \
            'Concurrent offer writer did not wait on the trigger installation table lock'
        guardian.stdin.write('COMMIT;\n\\q\n')
        guardian.stdin.flush()
        guardian.wait(timeout=10)
        installer.wait(timeout=15)
        writer.wait(timeout=15)
        assert guardian.returncode == installer.returncode == writer.returncode == 0, \
            'Installation-race process failed; inspect upgrade logs'
        assert query(f"""SELECT count(*) FROM pliego.edicion_oferta o
          JOIN pliego.offer_transition t ON t.offer_id=o.oferta_id
          WHERE o.edicion_id={data['writerEdition']} AND t.next_transition_at=o.fin""", clone) == '1', \
            'Writer committed after migration without its durable expiry marker'
        assert query(f"SELECT count(*) FROM pliego.realtime_event WHERE public_scope "
                     f"AND event_name='catalog.offers.changed' AND resource_id='{data['writerEdition']}'", clone) == '1', \
            'Writer committed after migration without its public invalidation hint'
        print('PASS: concurrent offer writer waits through trigger installation/seed and commits one marker/hint')
    finally:
        for process in [writer, installer, guardian]:
            terminate(process)
        for stream in streams:
            stream.close()
        dropped = subprocess.run(['dropdb', '--maintenance-db=postgres', '--if-exists', '--force', clone],
                                 env=environment(), text=True, capture_output=True, timeout=20)
        assert dropped.returncode == 0, f'Could not remove disposable migration-race clone: {dropped.stderr}'


def assert_seed_and_catchup(data):
    offers = data['offers']
    assert query('SELECT count(*) FROM pliego.offer_transition') == '4'
    assert query("SELECT count(*) FROM pliego.offer_transition t JOIN pliego.edicion_oferta o "
                 "ON o.oferta_id=t.offer_id WHERE t.last_observed_at IS NULL "
                 "AND t.next_transition_at IS NOT DISTINCT FROM CASE WHEN o.estado='ACTIVE' THEN o.inicio END") == '4', \
        'Migration did not seed original starts without pretending to have observed them'
    assert query("SELECT count(*) FROM pliego.realtime_event WHERE public_scope") == '0', \
        'Migration prematurely emitted public offer changes'
    history = query('SELECT jsonb_agg(to_jsonb(o) ORDER BY oferta_id) FROM pliego.edicion_oferta o')
    first = json.loads(query('SELECT pliego.fn_offer_lifecycle_advance(1000)'))
    assert first['state'] == 'OK' and first['transitionCount'] == 2, first
    assert first['maxLagSeconds'] >= 259199, first
    assert query(f'SELECT next_transition_at IS NULL FROM pliego.offer_transition WHERE offer_id={offers["expired"]}') == 't'
    assert query(f"SELECT t.next_transition_at=o.fin FROM pliego.offer_transition t JOIN pliego.edicion_oferta o "
                 f'ON o.oferta_id=t.offer_id WHERE t.offer_id={offers["current"]}') == 't'
    assert query(f"SELECT t.next_transition_at=o.inicio AND t.last_observed_at IS NULL "
                 f'FROM pliego.offer_transition t JOIN pliego.edicion_oferta o ON o.oferta_id=t.offer_id '
                 f'WHERE t.offer_id={offers["scheduled"]}') == 't'
    assert query(f'SELECT next_transition_at IS NULL AND last_observed_at IS NULL FROM pliego.offer_transition '
                 f'WHERE offer_id={offers["inactive"]}') == 't'
    assert query("SELECT count(*) FROM pliego.realtime_event WHERE public_scope AND event_name='catalog.offers.changed'") == '2'
    second = json.loads(query('SELECT pliego.fn_offer_lifecycle_advance(1000)'))
    assert second['state'] == 'OK' and second['transitionCount'] == 0, second
    assert query("SELECT count(*) FROM pliego.realtime_event WHERE public_scope") == '2', 'Catchup rerun duplicated hints'
    assert query('SELECT jsonb_agg(to_jsonb(o) ORDER BY oferta_id) FROM pliego.edicion_oferta o') == history, \
        'Lifecycle catchup rewrote preserved offer history'
    write_json('catchup.json', {'first': first, 'second': second, 'publicHints': 2})


def main():
    if (os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') != '1'
            or os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost', '::1')
            or not all(os.environ.get(name) for name in ('PGPORT', 'PGDATABASE'))):
        raise SystemExit('Requires PLIEGO_TEST_DISPOSABLE_DB=1 and explicit loopback PGHOST/PGPORT/PGDATABASE')
    assert os.environ['PGDATABASE'].startswith('offers_upgrade'), 'Use a dedicated offers_upgrade disposable database'
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    assert query("SELECT to_regnamespace('pliego') IS NULL") == 't', 'Use an EMPTY disposable upgrade database'
    jar = Path(os.environ.get('PLIEGO_UPGRADE_TEST_JAR', ROOT / 'backend/target/pliego-backend-0.1.0-SNAPSHOT.jar')).resolve()
    with zipfile.ZipFile(jar) as archive:
        packaged = archive.read('BOOT-INF/classes/db/migration/' + MIGRATION)
    source = ROOT / 'backend/src/main/resources/db/migration' / MIGRATION
    assert packaged == source.read_bytes(), 'Packaged V106 differs from the migration under test; rebuild first'
    assert b'${' not in packaged, 'The instrumented race requires a migration without unresolved placeholders'
    write_json('packaged-resource.json', {'jar': str(jar), 'jarSha256': hashlib.sha256(jar.read_bytes()).hexdigest(),
                                        'migration': MIGRATION, 'migrationSha256': hashlib.sha256(packaged).hexdigest()})
    migrate(jar, 105)
    data = prepare_history()
    tables = query("SELECT tablename FROM pg_tables WHERE schemaname='pliego' ORDER BY tablename").splitlines()
    before = table_snapshots(tables)
    write_json('before-table-digests.json', snapshot_digests(before))
    installation_writer_race(packaged.decode(), data)
    migrate(jar, 106)
    after = table_snapshots(tables, after_upgrade=True)
    write_json('after-table-digests.json', snapshot_digests(after))
    for table in tables:
        assert after[table] == before[table], f'V106 rewrote preexisting rows in {table}'
    assert query('SELECT count(*) FROM pliego.pedido WHERE pricing_evaluated_at IS NOT NULL') == '0', \
        'Migration invented a historical pricing instant'
    assert query('SELECT count(*) FROM pliego.realtime_event WHERE public_scope') == '0', \
        'Migration changed private event scope'
    for command, receipt in data['replays']:
        assert query(command) == receipt, 'V106 changed an existing checkout receipt or billed replay'
    replayed = table_snapshots(tables, after_upgrade=True)
    for table in tables:
        assert replayed[table] == before[table], f'Historical replay rewrote rows in {table}'
    assert_seed_and_catchup(data)
    # Catchup may add hints/telemetry, but old paid orders and item snapshots stay exact.
    for table in ['pedido', 'pedido_item', 'pago', 'factura', 'factura_item', 'checkout_attempt', 'checkout_billing_attempt']:
        assert table_snapshots([table], after_upgrade=True)[table] == before[table], \
            f'Offer catchup changed immutable purchase history in {table}'
    summary = {'upgrade': '105->106', 'packagedFlyway': True, 'existingTablesPreserved': len(tables),
               'offersPreserved': 4, 'paidOrdersPreserved': 2, 'discountedItemsPreserved': 3,
               'historicalPricingInstant': 'NULL', 'idempotentAndBilledReplay': True,
               'missedTransitionsObservedOnce': 2, 'concurrentInstallationWriterCaptured': True}
    write_json('summary.json', summary)
    print('PASS: ' + json.dumps(summary, sort_keys=True))


if __name__ == '__main__':
    main()
