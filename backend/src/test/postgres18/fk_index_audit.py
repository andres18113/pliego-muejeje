"""PPA-08 catalog and reproducible local EXPLAIN evidence (stdlib + psql only).

Read-only inventory is the default. --benchmark needs the explicit disposable
guard, a loopback connection and the dedicated fixture marker. Every mutating
EXPLAIN runs in a rollback transaction. --seed imports synthetic history once.
Output contains plan summaries, never row dumps, credentials or customer data.
"""
import argparse
import json
import os
from pathlib import Path
import statistics
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
AUDIT = ROOT / 'docs/audit/ppa08-fk-indexes'
PSQL = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']


def query(sql):
    result = subprocess.run(PSQL + ['-c', sql], capture_output=True, text=True,
                            timeout=90)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def inventory():
    return [json.loads(line) for line in query((HERE / 'fk_index_catalog.sql').read_text()).splitlines()]


def guard():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1', 'Explicit disposable DB opt-in required'
    assert os.environ.get('PGHOST') in {'localhost', '127.0.0.1', '::1'}, 'Loopback only'
    assert query('SHOW server_version_num').startswith('18'), 'PostgreSQL 18 required'
    assert query("SELECT current_database() LIKE '%fk_index%' OR current_database() LIKE '%fk_indexes%'") == 't', 'Use dedicated fk_index database'


def seed():
    guard()
    assert query("SELECT count(*) FROM pliego.usuario WHERE email_normalizado='fk-index-1@example.invalid'") == '0', 'Fixture already present'
    subprocess.run(PSQL + ['-f', str(AUDIT / 'seed.sql')], check=True,
                   stdout=subprocess.DEVNULL, timeout=90)


def validate_fks():
    # The local bulk fixture bypasses trigger side effects. Prove every declared
    # FK still resolves; SIMPLE-match NULLs intentionally do not require a parent.
    checks = json.loads(query("""SELECT jsonb_agg(jsonb_build_object('name',c.conname,
      'child',c.conrelid::regclass::text,'parent',c.confrelid::regclass::text,
      'join',(SELECT string_agg(format('x.%I=p.%I',a.attname,b.attname),' AND ' ORDER BY k.n)
        FROM unnest(c.conkey,c.confkey) WITH ORDINALITY k(a,b,n)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.a
        JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.b),
      'nonnull',(SELECT string_agg(format('x.%I IS NOT NULL',a.attname),' AND ')
        FROM unnest(c.conkey) k(a) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.a)))
      FROM pg_constraint c WHERE c.connamespace='pliego'::regnamespace AND c.contype='f'"""))
    for check in checks:
        count = query(f"SELECT count(*) FROM {check['child']} x WHERE {check['nonnull']} AND NOT EXISTS (SELECT FROM {check['parent']} p WHERE {check['join']})")
        assert count == '0', (check['name'], count)
    return len(checks)


def nodes(plan):
    yield plan
    for child in plan.get('Plans', []):
        yield from nodes(child)


def explain(sql, setup=''):
    runs = []
    for _ in range(5):
        raw = query('BEGIN; ' + setup + ' EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) ' + sql + '; ROLLBACK;')
        value = json.loads(raw)
        plan = value[0]['Plan']
        runs.append({'execution_ms': value[0]['Execution Time'],
                     'planning_ms': value[0]['Planning Time'],
                     'shared_hit_blocks': plan.get('Shared Hit Blocks', 0),
                     'shared_read_blocks': plan.get('Shared Read Blocks', 0),
                     'shared_dirtied_blocks': plan.get('Shared Dirtied Blocks', 0),
                     'wal_bytes': plan.get('WAL Bytes', 0),
                     'indexes': sorted({n['Index Name'] for n in nodes(plan) if 'Index Name' in n}),
                     'nodes': [n['Node Type'] for n in nodes(plan)],
                     'rows': plan['Actual Rows'],
                     'rows_removed': sum(n.get('Rows Removed by Filter', 0) for n in nodes(plan)),
                     'triggers': value[0].get('Triggers', [])})
    return {'sql': sql, 'median_execution_ms': statistics.median(r['execution_ms'] for r in runs),
            'median_shared_blocks': statistics.median(r['shared_hit_blocks'] + r['shared_read_blocks'] for r in runs),
            'plan': runs[-1], 'execution_ms_samples': [r['execution_ms'] for r in runs]}


# Current statement predicates, traced to the routine named in each entry. The
# FK miss models PostgreSQL's child-side equality probe (including row locking).
CASES = [
 ('ayuda_articulo_categoria_id_fkey','fn_help_search',"SELECT slug FROM pliego.ayuda_articulo WHERE estado='PUBLISHED' AND categoria_id=(SELECT min(categoria_id) FROM pliego.ayuda_categoria) ORDER BY posicion,slug LIMIT 20"),
 ('checkout_attempt_order_id_fkey','sp_checkout_idempotent',"SELECT * FROM pliego.checkout_attempt WHERE actor_user_id=1000020 AND attempt_key=md5('attempt-20')::uuid"),
 ('fk_cliente_favorito_edicion','fn_customer_favorite_status',"SELECT EXISTS(SELECT FROM pliego.cliente_favorito WHERE cliente_id=1000020 AND edicion_id=1000020)"),
 ('cliente_identificacion_solicitud_correccion_decidido_por_fkey','fn_admin_billing_identity_correction_requests',"SELECT * FROM pliego.cliente_identificacion_solicitud_correccion WHERE estado='APPROVED' ORDER BY vence_en,solicitud_id LIMIT 20"),
 ('digital_ownership_edicion_id_fkey','fn_guard_owned_digital_format',"SELECT EXISTS(SELECT FROM pliego.digital_ownership WHERE edicion_id=1002001)"),
 ('envio_historial_usuario_actor_id_fkey','fn_order_post_purchase_internal_v043',"SELECT * FROM pliego.envio_historial WHERE envio_id=1000001 ORDER BY fecha,envio_historial_id"),
 ('factura_usuario_emisor_id_fkey','fn_invoice_snapshot_data_internal_v088',"SELECT * FROM pliego.factura WHERE factura_id=1000001"),
 ('factura_item_pedido_item_id_fkey','fn_invoice_snapshot_data_internal_v088',"SELECT l.*,i.precio_original_snapshot FROM pliego.factura_item l JOIN pliego.pedido_item i USING(pedido_item_id) WHERE l.factura_id=1000001"),
 ('fk_movimiento_inventario_usuario','fn_inventory_movements',"SELECT * FROM pliego.movimiento_inventario WHERE edicion_id=1000001 ORDER BY fecha DESC,movimiento_inventario_id DESC LIMIT 20"),
 ('nota_credito_usuario_emisor_id_fkey','fn_order_post_purchase_internal_v043',"SELECT n.* FROM pliego.nota_credito n JOIN pliego.factura f USING(factura_id) WHERE f.pedido_id=1000001"),
 ('fk_pedido_estado_historial_usuario','fn_admin_order_detail_internal_v017',"SELECT * FROM pliego.pedido_estado_historial WHERE pedido_id=1000001 ORDER BY fecha,pedido_estado_historial_id"),
 ('pedido_retiro_ubicacion_retiro_id_fkey','fn_admin_pickup_detail',"SELECT * FROM pliego.pedido_retiro WHERE pedido_id=1000002"),
 ('fk_sesion_autenticacion_usuario','fn_auth_session_revoke_all',"UPDATE pliego.sesion_autenticacion SET fecha_revocacion=coalesce(fecha_revocacion,clock_timestamp()) WHERE usuario_id=1000020"),
]


def benchmark(rows, candidate_probes):
    guard()
    assert query("SELECT count(*) FROM pliego.sesion_autenticacion WHERE usuario_id=1000020") == '20', 'Seed first'
    validated = validate_fks()
    by_name = {r['constraint']: r for r in rows}
    results = []
    for name, routine, read in CASES:
        row = by_name[name]
        # All raw missing FKs are one-column; multi-column keys are catalogued.
        assert len(row['columns']) == 1
        column = row['columns'][0]
        fk_sql = f"SELECT 1 FROM ONLY {row['table']} x WHERE x.{column}=9999999 LIMIT 1 FOR KEY SHARE OF x"
        result = {'constraint': name, 'routine': routine,
                  'table_rows': int(query(f"SELECT count(*) FROM {row['table']}")),
                  'heap_bytes': int(query(f"SELECT pg_relation_size('{row['table']}')")),
                  'existing_index_bytes': int(query(f"SELECT pg_indexes_size('{row['table']}')")),
                  'fk_miss': explain(fk_sql), 'supported_statement': explain(read)}
        if candidate_probes:
            setup = f"CREATE INDEX ppa08_candidate ON {row['table']} ({column});"
            result['candidate_fk_miss'] = explain(fk_sql, setup)
            result['candidate_supported_statement'] = explain(read, setup)
            # Index storage estimate on the same real fixture. Transaction rolls back.
            result['candidate_index_bytes'] = int(query('BEGIN; ' + setup + " SELECT pg_relation_size('pliego.ppa08_candidate'); ROLLBACK;"))
        results.append(result)
    # Real RI trigger execution, rather than only the equivalent child query.
    parents = {
        'unused_user': 'DELETE FROM pliego.usuario WHERE usuario_id=9999999',
        'unused_edition': 'DELETE FROM pliego.edicion WHERE edicion_id=1002001',
    }
    writes = {
        'ownership_2000_inserts': "INSERT INTO pliego.digital_ownership(cliente_id,edicion_id) SELECT 1000000+n,1002001 FROM generate_series(1,2000) n",
        'sessions_2000_inserts': "INSERT INTO pliego.sesion_autenticacion(usuario_id,token_refresco_hash,fecha_expiracion) SELECT 1000000+n,md5('write-'||n)||md5('write-tail-'||n),now()+interval '1 day' FROM generate_series(1,2000) n",
    }
    return {'validated_foreign_keys': validated, 'cases': results,
            'parent_ri_checks': {name: explain(sql) for name, sql in parents.items()},
            'approved_public_command': explain('SELECT pliego.fn_auth_session_revoke_all(1000020)'),
            'edition_format_update': explain("UPDATE pliego.edicion SET formato='AUDIOBOOK',numero_paginas=NULL,audio_duracion_segundos=3600,audio_narradores=ARRAY['Narrador de prueba'] WHERE edicion_id=1002001"),
            'writes': {name: explain(sql) for name, sql in writes.items()}}


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--seed', action='store_true')
    parser.add_argument('--benchmark', action='store_true')
    parser.add_argument('--candidate-probes', action='store_true')
    args = parser.parse_args()
    if args.seed:
        seed()
    rows = inventory()
    report = {'postgres_version': query('SHOW server_version'),
              'migration_versions': query("SELECT string_agg(version,',' ORDER BY installed_rank) FROM flyway_schema_history WHERE success"),
              'foreign_key_count': len(rows), 'missing_any_prefix': sum(not r['indexes'] for r in rows),
              'missing_unconditional_prefix': sum(not any(i['predicate'] is None for i in r['indexes']) for r in rows),
              'catalog': rows}
    if args.benchmark:
        report['benchmark'] = benchmark(rows, args.candidate_probes)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f"PPA-08: {len(rows)} FKs; {report['missing_any_prefix']} without any prefix; {report['missing_unconditional_prefix']} without unconditional prefix; benchmark={args.benchmark}")


if __name__ == '__main__':
    main()
