"""Disposable PG18 custom-dump restore, rollback/commit/repeat and real HTTP proof.

All evidence is private. stdout contains counts and pass/fail labels only.
Use --make-fixture FILE once to create fictional V087->V095 input, then pass FILE
as the dump argument for a completely fresh-cluster rehearsal. No Docker needed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
GATES = ROOT / 'backend/src/test/postgres18'
PRESERVE = '''academic_document_counter autor ayuda_articulo ayuda_categoria categoria
ciudad ciudad_alias edicion edicion_oferta editorial home_delivery_config inventario
libro libro_autor libro_categoria provincia ubicacion_retiro'''.split()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def quoted(value):
    return "'" + str(value).replace("'", "''") + "'"


class Rehearsal:
    def __init__(self, args):
        if os.geteuid() == 0:
            raise SystemExit('Run as an unprivileged local OS user: initdb refuses root.')
        self.args = args
        self.bin = Path(args.pg_bin).resolve()
        for utility in ('initdb', 'pg_ctl', 'psql', 'createdb', 'pg_restore', 'pg_dump'):
            if not (self.bin / utility).is_file():
                raise SystemExit('PostgreSQL 18 utilities missing: ' + utility)
        self.work = Path(tempfile.mkdtemp(prefix='pliego-reset-rehearsal-', dir='/tmp'))
        self.work.chmod(0o700)
        self.jar = self.work / 'backend.jar'
        shutil.copyfile(Path(args.jar).resolve(strict=True), self.jar)
        self.port = free_port()
        self.app = None
        self.started = False
        # Do not inherit any PG connection/service/options or application/provider
        # settings, nor Java option injection, from the operator environment.
        self.env = {k: v for k, v in os.environ.items() if not
                    (k.startswith(('PG', 'PLIEGO_', 'SPRING_', 'AWS_', 'R2_', 'SERVER_')) or
                     k in ('JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CHECKOUT_BASE_URL') or
                     k.lower() in ('http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'))}
        self.env.update(PGHOST='127.0.0.1', PGPORT=str(self.port), PGDATABASE='reset_rehearsal',
                        PGUSER='postgres', PGPASSWORD='', PGSERVICEFILE='/dev/null',
                        PGPASSFILE='/dev/null', PGAPPNAME='pliego-local-reset-rehearsal',
                        PYTHONDONTWRITEBYTECODE='1', NO_PROXY='127.0.0.1,localhost',
                        no_proxy='127.0.0.1,localhost')
        (self.work / 'empty-pgpass').touch(mode=0o600)
        self.env['PGPASSFILE'] = str(self.work / 'empty-pgpass')
        self.env['PATH'] = str(self.bin) + os.pathsep + self.env['PATH']
        self.env.update(PLIEGO_DB_URL=f'jdbc:postgresql://127.0.0.1:{self.port}/reset_rehearsal',
                        PLIEGO_DB_USERNAME='pliego_app', PLIEGO_DB_PASSWORD=secrets.token_hex(24),
                        PLIEGO_ADMIN_EMAIL='rehearsal-unused@example.invalid',
                        PLIEGO_ADMIN_PASSWORD_HASH='unused-on-existing-v095',
                        PLIEGO_JWT_SECRET=secrets.token_hex(32),
                        PLIEGO_MAIL_TOKEN_SECRET=secrets.token_hex(32),
                        PLIEGO_MAIL_ENABLED='false', PLIEGO_R2_ENABLED='false',
                        PLIEGO_R2_PRODUCTION_STORAGE='false', PLIEGO_BILLING_ENABLED='true',
                        PLIEGO_BILLING_POLL_INTERVAL='PT0.1S', PLIEGO_BILLING_BATCH_SIZE='20',
                        PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED='false',
                        PLIEGO_GATE_LOG_DIR=str(self.work), PLIEGO_UPGRADE_TEST_JAR=str(self.jar))
        # Gate helpers spawn psql without an explicit env; replace the process
        # environment too. update() alone would leave excluded PGHOSTADDR etc.
        os.environ.clear()
        os.environ.update(self.env)
        urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))

    def run(self, args, name, env=None):
        with (self.work / name).open('a') as log:
            result = subprocess.run([str(a) for a in args], env=env or self.env,
                                    stdout=log, stderr=log, text=True)
        if result.returncode:
            # Logs may contain real restored data: never dump them to stdout.
            raise RuntimeError(f'{name} failed (exit {result.returncode}); private evidence: {self.work}')

    def query(self, sql):
        result = subprocess.run([str(self.bin / 'psql'), '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                                env=self.env, text=True, capture_output=True)
        if result.returncode:
            with (self.work / 'sql-errors.log').open('a') as log:
                log.write(result.stderr)
            raise RuntimeError('SQL assertion/query failed; private evidence: ' + str(self.work))
        return result.stdout.strip()

    def check(self, condition, label):
        if not condition:
            raise AssertionError(label + '; private evidence: ' + str(self.work))

    def start_cluster(self):
        version = subprocess.check_output([str(self.bin / 'initdb'), '--version'], text=True)
        self.check(bool(re.search(r'\b18\.', version)), 'PostgreSQL 18 required')
        self.run([self.bin / 'initdb', '-D', self.work / 'data', '-U', 'postgres',
                  '--auth-local=trust', '--auth-host=trust', '--no-locale', '-E', 'UTF8'], 'initdb.log')
        (self.work / 'socket').mkdir(mode=0o700)
        self.run([self.bin / 'pg_ctl', '-D', self.work / 'data', '-l', self.work / 'postgres.log',
                  '-o', f'-p {self.port} -h 127.0.0.1 -k {self.work}/socket', '-w', 'start'], 'cluster-start.log')
        self.started = True
        self.run([self.bin / 'createdb', '--owner=postgres', 'reset_rehearsal'], 'createdb.log')
        self.query("""CREATE ROLE pliego_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
            CREATE ROLE pliego_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
            REVOKE CREATE ON SCHEMA public FROM PUBLIC;
            ALTER DATABASE reset_rehearsal OWNER TO pliego_owner;""")
        # The fresh cluster listens only on loopback, with disposable credentials.
        self.query('ALTER ROLE pliego_app PASSWORD ' + quoted(self.env['PLIEGO_DB_PASSWORD']))

    def fingerprint(self, table, predicate='true'):
        self.check(bool(re.fullmatch(r'(?:pliego\.[a-z_]+|public\.flyway_schema_history)', table)), 'Unsafe table name')
        sql = f'''SET timezone='UTC'; SET datestyle='ISO,YMD'; SET intervalstyle='postgres';
            SELECT json_build_array(count(*),md5(COALESCE(string_agg(length(v)::text||':'||v,'' ORDER BY v COLLATE "C"),'')))
            FROM (SELECT to_jsonb(t)::text v FROM {table} t WHERE {predicate}) s'''
        return json.loads(self.query(sql).splitlines()[-1])

    def sequences(self):
        names = self.query("SELECT sequencename FROM pg_sequences WHERE schemaname='pliego' ORDER BY 1").splitlines()
        return {name: self.query(f'SELECT last_value,is_called FROM pliego.{name}') for name in names}

    def full_snapshot(self):
        tables = self.query("SELECT tablename FROM pg_tables WHERE schemaname='pliego' ORDER BY 1").splitlines()
        return {**{t: self.fingerprint('pliego.' + t) for t in tables},
                'flyway': self.fingerprint('public.flyway_schema_history'), 'sequences': self.sequences()}

    def structure(self):
        # Exclude physical/statistics fields which ANALYZE/validation may update.
        return self.query("""SELECT md5(string_agg(v,E'\n' ORDER BY v COLLATE "C")) FROM (
          SELECT jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relacl)::text v
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','pliego')
          UNION ALL SELECT jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),p.proowner,p.proacl)::text
           FROM pg_proc p WHERE p.pronamespace='pliego'::regnamespace
          UNION ALL SELECT to_jsonb(d)::text FROM pg_default_acl d
          UNION ALL SELECT to_jsonb(n)::text FROM pg_namespace n WHERE n.nspname IN('public','pliego')
          UNION ALL SELECT to_jsonb(t)::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='pliego'::regnamespace
          UNION ALL SELECT to_jsonb(r)::text FROM pg_roles r
          UNION ALL SELECT to_jsonb(m)::text FROM pg_auth_members m) s""")

    def retained_snapshot(self):
        # Targets are independently projected once, before deletion. Full rows of
        # every survivor are compared after commit, including conditional tables.
        users = "SELECT usuario_id FROM pliego.usuario WHERE rol='CUSTOMER'"
        emails = f'''SELECT email_normalizado::text email FROM pliego.usuario WHERE rol='CUSTOMER'
          UNION SELECT destinatario FROM pliego.correo_outbox WHERE usuario_id IN ({users})
          UNION SELECT email FROM pliego.correo_token WHERE usuario_id IN ({users})
          UNION SELECT email_actual FROM pliego.correo_cambio WHERE usuario_id IN ({users})
          UNION SELECT email_pendiente FROM pliego.correo_cambio WHERE usuario_id IN ({users})'''
        admin_emails = f'''SELECT email_normalizado::text email FROM pliego.usuario WHERE rol='ADMIN'
          UNION SELECT destinatario FROM pliego.correo_outbox WHERE usuario_id NOT IN ({users})
          UNION SELECT email FROM pliego.correo_token WHERE usuario_id NOT IN ({users})
          UNION SELECT email_actual FROM pliego.correo_cambio WHERE usuario_id NOT IN ({users})
          UNION SELECT email_pendiente FROM pliego.correo_cambio WHERE usuario_id NOT IN ({users})'''
        conditions = {'usuario': "rol='ADMIN'", 'movimiento_inventario':
            f'pedido_id IS NULL AND (usuario_actor_id IS NULL OR usuario_actor_id NOT IN ({users}))',
            'address_create_attempt': f'actor_user_id NOT IN ({users})',
            'checkout_attempt': f'actor_user_id NOT IN ({users}) AND order_id IS NULL',
            'checkout_billing_attempt': f'''actor_user_id NOT IN ({users}) AND (actor_user_id,attempt_key) NOT IN
             (SELECT actor_user_id,attempt_key FROM pliego.checkout_attempt WHERE order_id IS NOT NULL)''',
            'correo_cambio_token': f'cambio_id NOT IN (SELECT cambio_id FROM pliego.correo_cambio WHERE usuario_id IN ({users}))',
            'correo_evento_proveedor': f'''(correo_id IS NULL OR correo_id NOT IN (SELECT correo_id FROM pliego.correo_outbox WHERE usuario_id IN ({users})))
             AND id_mensaje_proveedor NOT IN (SELECT id_mensaje_proveedor FROM pliego.correo_outbox WHERE usuario_id IN ({users}) AND id_mensaje_proveedor IS NOT NULL)''',
            'correo_destinatario_entrega': f'destinatario NOT IN ({emails}) OR destinatario IN ({admin_emails})',
            'correo_limite': f'''clave NOT IN (SELECT p||usuario_id FROM pliego.usuario CROSS JOIN
             (VALUES('USER:'),('EMAIL_CHANGE:'),('EMAIL_CHANGE_RESEND:')) prefixes(p) WHERE rol='CUSTOMER')
             AND clave NOT IN (SELECT 'EMAIL:'||encode(sha256(convert_to(email,'UTF8')),'hex') FROM ({emails}) e
             WHERE email NOT IN ({admin_emails}))'''}
        for t in ('sesion_autenticacion', 'correo_token', 'correo_cambio', 'correo_outbox'):
            conditions[t] = f'usuario_id NOT IN ({users})'
        results = {t: self.fingerprint('pliego.' + t) for t in PRESERVE}
        for t, predicate in conditions.items():
            # Persist only primary-key predicates as digests: a survivor set after
            # reset is exactly the table's entire content for conditional tables.
            results[t] = self.fingerprint('pliego.' + t, predicate)
        results['public.flyway_schema_history'] = self.fingerprint('public.flyway_schema_history')
        return results

    def retained_after(self, expected):
        actual = {t: self.fingerprint(t if '.' in t else 'pliego.' + t) for t in expected}
        self.check(expected == actual, 'Preserved full-row fingerprints changed')

    def reset(self, name, commit=False, failure=False, script=None):
        cmd = [self.bin / 'psql', '-X', '-v', 'ON_ERROR_STOP=1']
        if commit:
            cmd += ['-v', 'confirm=RESET']
        cmd += ['-f', script or HERE / 'reset-customer-data.sql']
        if failure:
            with (self.work / name).open('w') as log:
                rc = subprocess.run([str(x) for x in cmd], env=self.env, stdout=log, stderr=log).returncode
            self.check(rc != 0, 'Injected reset failure did not abort')
        else:
            self.run(cmd, name)

    def privileges(self):
        self.check(self.query("""SELECT NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
            AND NOT pg_has_role('pliego_app','pliego_owner','MEMBER')
            AND NOT has_schema_privilege('pliego_app','pliego','CREATE')
            AND NOT has_schema_privilege('pliego_app','public','CREATE')
            AND NOT has_database_privilege('pliego_app',current_database(),'CREATE')
            AND NOT EXISTS(SELECT FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='pliego_app'))
            AND NOT EXISTS(SELECT FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname='pliego_app'))
            AND NOT EXISTS(SELECT FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname='pliego_app'))
            AND NOT EXISTS(SELECT FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname='pliego_app'))
            AND NOT EXISTS(SELECT FROM pg_type WHERE typowner=(SELECT oid FROM pg_roles WHERE rolname='pliego_app'))
            FROM pg_roles WHERE rolname='pliego_app'""") == 't', 'Runtime ownership/CREATE/elevated privilege gate')
        for table in ('provincia', 'ciudad', 'ciudad_alias'):
            self.check(self.query(f"""SELECT has_table_privilege('pliego_app','pliego.{table}','SELECT') AND NOT
                (has_table_privilege('pliego_app','pliego.{table}','INSERT') OR
                 has_table_privilege('pliego_app','pliego.{table}','UPDATE') OR
                 has_table_privilege('pliego_app','pliego.{table}','DELETE') OR
                 has_table_privilege('pliego_app','pliego.{table}','TRUNCATE')) AND NOT EXISTS
                (SELECT FROM pg_attribute WHERE attrelid='pliego.{table}'::regclass AND attnum>0 AND NOT attisdropped AND
                 (has_column_privilege('pliego_app',attrelid,attnum,'INSERT') OR
                  has_column_privilege('pliego_app',attrelid,attnum,'UPDATE') OR
                  has_column_privilege('pliego_app',attrelid,attnum,'REFERENCES')))""") == 't', 'Geographic runtime ACL gate')

    def validate(self):
        # VALIDATE is a no-op for already-validated FKs: independent anti-joins
        # below check all existing rows, including on restores with disabled triggers.
        foreign_keys = json.loads(self.query("""SELECT COALESCE(json_agg(json_build_object('table',c.relname,
         'parent',p.relname,'name',k.conname,'match',k.confmatchtype,
         'columns',(SELECT json_agg(a.attname ORDER BY u.i) FROM unnest(k.conkey) WITH ORDINALITY u(n,i)
                    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.n),
         'references',(SELECT json_agg(a.attname ORDER BY u.i) FROM unnest(k.confkey) WITH ORDINALITY u(n,i)
                    JOIN pg_attribute a ON a.attrelid=p.oid AND a.attnum=u.n))), '[]')
         FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class p ON p.oid=k.confrelid
         WHERE c.relnamespace='pliego'::regnamespace AND k.contype='f'"""))
        for fk in foreign_keys:
            nonnull = ' AND '.join(f'c."{c}" IS NOT NULL' for c in fk['columns'])
            join = ' AND '.join(f'p."{p}"=c."{c}"' for c, p in zip(fk['columns'], fk['references']))
            self.check(self.query(f'''SELECT NOT EXISTS(SELECT FROM pliego."{fk['table']}" c WHERE {nonnull}
               AND NOT EXISTS(SELECT FROM pliego."{fk['parent']}" p WHERE {join}))''') == 't', 'FK integrity: ' + fk['name'])
        checks = json.loads(self.query("""SELECT json_agg(json_build_array(c.relname,k.conname,pg_get_expr(k.conbin,k.conrelid)))
          FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relnamespace='pliego'::regnamespace AND k.contype='c'"""))
        for table, name, expression in checks:
            self.check(self.query(f'SELECT NOT EXISTS(SELECT FROM pliego."{table}" WHERE NOT ({expression}))') == 't', 'CHECK integrity: ' + name)
        not_null = json.loads(self.query("""SELECT json_object_agg(table_name,columns) FROM
          (SELECT c.relname table_name,json_agg(a.attname ORDER BY a.attnum) columns
           FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
           WHERE c.relnamespace='pliego'::regnamespace AND c.relkind IN('r','p')
             AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull GROUP BY c.relname) s"""))
        for table, columns in not_null.items():
            invalid = ' OR '.join(f'"{c}" IS NULL' for c in columns)
            self.check(self.query(f'SELECT NOT EXISTS(SELECT FROM pliego."{table}" WHERE {invalid})') == 't',
                       'NOT NULL integrity: ' + table)
        self.run([self.bin / 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-f', HERE / 'reset-customer-data-validate.sql'], 'constraints.log')
        self.check(self.query("SELECT count(*) FROM pg_constraint WHERE connamespace='pliego'::regnamespace AND NOT convalidated") == '0', 'Unvalidated constraints remain')
        self.check(self.query("""SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          WHERE c.relnamespace='pliego'::regnamespace AND t.tgenabled<>'O'""") == '0', 'Disabled trigger remains')
        self.check(self.query("""SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
          WHERE c.relnamespace='pliego'::regnamespace AND (NOT i.indisvalid OR NOT i.indisready OR NOT i.indislive)""") == '0', 'Invalid constraint/index')
        print(f'Integrity: {len(foreign_keys)} FK anti-joins, {len(checks)} CHECK scans, '
              f'{sum(map(len, not_null.values()))} NOT NULL columns, all constraints validated; all triggers enabled.')

    def start_backend(self):
        app_port = free_port()
        self.env['CHECKOUT_BASE_URL'] = f'http://127.0.0.1:{app_port}'
        log = (self.work / 'backend.log').open('w')
        self.app = subprocess.Popen(['java', '-jar', str(self.jar), '--server.address=127.0.0.1',
            f'--server.port={app_port}', '--pliego.mail.enabled=false', '--pliego.r2.enabled=false',
            '--pliego.mail.webhook.secret=', '--pliego.home-delivery.scheduler-enabled=false',
            '--spring.datasource.hikari.maximum-pool-size=4'], env=self.env, stdout=log, stderr=log)
        log.close()
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if self.app.poll() is not None:
                raise RuntimeError('Backend failed; private evidence: ' + str(self.work))
            try:
                with urllib.request.urlopen(self.env['CHECKOUT_BASE_URL'] + '/v3/api-docs', timeout=2) as response:
                    if response.status == 200:
                        return
            except OSError:
                pass
            time.sleep(.2)
        raise RuntimeError('Backend startup deadline exceeded; private evidence: ' + str(self.work))

    def stop_backend(self):
        if self.app is not None and self.app.poll() is None:
            self.app.terminate()
            try:
                self.app.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.app.kill()
                self.app.wait()
        self.app = None

    def http(self, old):
        # Reuse the existing gate transport, billing payload and test-only local
        # HMAC verification path. Account registration/login are real REST calls.
        sys.path.insert(0, str(GATES))
        os.environ.update(self.env)
        from digital_editions_http_gate import ok
        from email_verification_fixture import verify_registered_email
        from library_checkout_http_gate import checkout
        email = f'reset-{uuid.uuid4().hex}@example.invalid'
        password = secrets.token_urlsafe(24) + '-Aa1'
        ok('/api/v1/auth/register', None, 'POST', {'email': email, 'password': password,
            'firstNames': 'Cliente', 'lastNames': 'Ensayo', 'phone': None}, 201)
        verify_registered_email(email, self.env['CHECKOUT_BASE_URL'])
        customer = 'Bearer ' + ok('/api/v1/auth/login', None, 'POST', {'email': email, 'password': password})['accessToken']
        self.check(ok('/api/v1/me', customer)['emailVerified'], 'New customer verification')
        edition = self.query("SELECT edicion_id FROM pliego.edicion WHERE formato IN('EBOOK','AUDIOBOOK') AND estado='ACTIVE' ORDER BY edicion_id LIMIT 1")
        self.check(bool(edition), 'Restored catalog needs one active digital edition for ownership proof')
        ok('/api/v1/cart/items', customer, 'POST', {'editionId': edition, 'quantity': 1})
        cart = ok('/api/v1/cart', customer)
        status, order = checkout(customer, {'fulfillmentMethod': 'DIGITAL_ONLY', 'paymentMethod': 'TRANSFER',
            'simulationOutcome': 'APPROVED', 'expectedCartId': cart['cartId']}, str(uuid.uuid4()))
        self.check(status == 201 and order['orderState'] == 'CONFIRMED' and order['paymentState'] == 'APPROVED', 'Post-reset checkout')
        order_id = int(order['orderId'])
        self.check(order_id > old['order_id'], 'Order ID reuse')
        self.check(order['orderReference'] not in old['references'], 'Observed public order reference collision')
        invoice_id = int(self.query(f'SELECT factura_id FROM pliego.factura WHERE pedido_id={order_id}'))
        self.check(invoice_id > old['invoice_id'], 'Invoice ID / R2 namespace reuse')
        self.check(self.query(f"SELECT secuencial>{old['invoice_counter']} FROM pliego.factura WHERE factura_id={invoice_id}") == 't', 'Academic invoice number reuse')
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            ready = self.query(f"SELECT count(*) FROM pliego.factura_archivo_trabajo WHERE factura_id={invoice_id} AND estado='READY'")
            if ready == '2':
                break
            time.sleep(.2)
        self.check(ready == '2', 'PDF/XML worker readiness')
        self.check(self.query(f"SELECT count(*) FROM pliego.factura_archivo WHERE factura_id={invoice_id} AND storage_kind='DATABASE' AND object_key IS NULL") == '2', 'Non-R2 storage')
        self.check(self.query(f"SELECT count(*) FROM pliego.factura_archivo_contenido WHERE factura_id={invoice_id} AND octet_length(contenido)>0") == '2', 'Stored PDF/XML bytes')
        access = ok(f'/api/v1/orders/{order_id}/invoice/files/PDF/access', customer)
        self.check(access['delivery'] == 'API_STREAM' and access['expiresAt'] is None, 'Database invoice delivery')
        req = urllib.request.Request(self.env['CHECKOUT_BASE_URL'] + f'/api/v1/orders/{order_id}/invoice/files/PDF', headers={'Authorization': customer})
        with urllib.request.urlopen(req, timeout=10) as response:
            self.check(response.status == 200 and response.read().startswith(b'%PDF-'), 'Actual PDF download')
        library = ok('/api/v1/me/library', customer)
        self.check(any(i['editionId'] == edition and i['ownershipState'] == 'OWNED' for i in library['items']), 'Digital ownership')
        self.check(int(self.query("SELECT count(*) FROM pliego.correo_outbox WHERE estado='SENT'")) == old['sent'], 'Mail disabled')
        print('HTTP: registration, local-token verification, login, cart, checkout, new numbering, PDF/XML in DATABASE, download and digital ownership passed; no mail/R2.')

    def old_numbers(self):
        return {'order_id': int(self.query('SELECT COALESCE(max(pedido_id),0) FROM pliego.pedido')),
                'invoice_id': int(self.query('SELECT COALESCE(max(factura_id),0) FROM pliego.factura')),
                'invoice_counter': int(self.query("SELECT last_value FROM pliego.academic_document_counter WHERE document_type='01'")),
                'references': self.query('SELECT referencia_publica FROM pliego.pedido').splitlines(),
                'sent': int(self.query("SELECT count(*) FROM pliego.correo_outbox o JOIN pliego.usuario u USING(usuario_id) WHERE u.rol='ADMIN' AND o.estado='SENT'"))}

    def execute(self):
        self.start_cluster()
        if self.args.make_fixture:
            self.make_fixture(Path(self.args.make_fixture).resolve())
            return
        dump = Path(self.args.dump).resolve(strict=True)
        self.run([self.bin / 'pg_restore', '--list', dump], 'restore-list.log')
        self.run([self.bin / 'pg_restore', '--exit-on-error', '--dbname=reset_rehearsal', dump], 'restore.log')
        self.privileges()
        self.run([self.bin / 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-f', HERE / 'reset-customer-data-inventory.sql'], 'inventory-before.log')
        before = self.full_snapshot()
        retained = self.retained_snapshot()
        structure = self.structure()
        old = self.old_numbers()
        (self.work / 'before-fingerprints.json').write_text(json.dumps(before, indent=2))
        # Observe rollback with live data before any committed reset.
        # Fail closed on unexpected tables and disabled triggers. Each mutation
        # belongs to the SAME transaction/connection as the rejected reset, so
        # disconnect rolls it back without ever dropping an object explicitly.
        for label, mutation, message in (
            ('forced-rls', "ALTER TABLE pliego.usuario ENABLE ROW LEVEL SECURITY; ALTER TABLE pliego.usuario FORCE ROW LEVEL SECURITY; CREATE POLICY reset_admin_only ON pliego.usuario USING (rol='ADMIN')", 'RLS is outside'),
            ('unclassified-table', 'CREATE TABLE pliego.reset_rehearsal_unclassified(id bigint)', 'definition drift'),
            ('disabled-trigger', 'ALTER TABLE pliego.pedido DISABLE TRIGGER trg_pedido_set_updated_at', 'initially be enabled'),
            ('stale-invoice-counter', "UPDATE pliego.academic_document_counter SET last_value=0 WHERE document_type='01'", 'counter behind')):
            # An empty dump may have no invoices, so there is no stale high-water
            # value to detect in that case. The realistic fixture exercises it.
            if label == 'stale-invoice-counter' and old['invoice_counter'] == 0:
                continue
            rejected = self.work / (label + '.sql')
            rejected.write_text('BEGIN; SET LOCAL ROLE pliego_owner; ' + mutation + ';\n' +
                                (HERE / 'reset-customer-data.sql').read_text())
            self.reset(label + '.log', commit=True, failure=True, script=rejected)
            self.check(message in (self.work / (label + '.log')).read_text(), 'Unexpected rejection cause: ' + label)
            self.check(before == self.full_snapshot(), 'Refused precondition changed data: ' + label)
            self.check(structure == self.structure(), 'Refused precondition changed structure: ' + label)
        app_env = self.env.copy()
        app_env['PGUSER'] = 'pliego_app'
        with (self.work / 'runtime-reset-refused.log').open('w') as log:
            rc = subprocess.run([str(self.bin / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'confirm=RESET',
                                 '-f', str(HERE / 'reset-customer-data.sql')], env=app_env, stdout=log, stderr=log).returncode
        self.check(rc != 0, 'Runtime role unexpectedly performed owner reset')
        self.check(before == self.full_snapshot() and structure == self.structure(), 'Runtime refusal changed data/structure')
        print('Fail-closed gates: forced RLS, unclassified table, disabled trigger, stale invoice counter and runtime owner escalation rejected.')
        if int(self.query('SELECT count(*) FROM pliego.correo_evento_proveedor WHERE correo_id IS NULL')):
            # These retained rows have a nullable FK. A preservation predicate
            # evaluating UNKNOWN must still fingerprint them, rather than skip.
            corrupt = self.work / 'unknown-event-corruption.sql'
            corrupt.write_text((HERE / 'reset-customer-data.sql').read_text().replace(
                'SET CONSTRAINTS ALL IMMEDIATE;',
                "UPDATE pliego.correo_evento_proveedor SET recibido_en=recibido_en+INTERVAL '1 second' WHERE correo_id IS NULL;\nSET CONSTRAINTS ALL IMMEDIATE;"))
            self.reset('unknown-event-corruption.log', commit=True, failure=True, script=corrupt)
            self.check('Preserved content changed: correo_evento_proveedor' in (self.work / 'unknown-event-corruption.log').read_text(),
                       'Unknown event survivor was not fingerprinted')
            self.check(before == self.full_snapshot() and structure == self.structure(), 'Unknown-event corruption did not roll back')
            print('Nullable-FK survivor: injected unknown provider-event corruption rejected and rolled back.')
        self.reset('reset-rollback.log')
        self.check(before == self.full_snapshot(), 'Default rollback changed data or sequences')
        self.check(structure == self.structure(), 'Default rollback changed privileges/triggers')
        print('Default rollback: all 58 tables, Flyway, sequences and ACL/ownership/trigger flags unchanged.')
        # Force a mid-delete failure AFTER trigger disabling. Connection exit must
        # roll back both prior deletes and DDL, not merely stop further statements.
        fail_script = self.work / 'injected-failure.sql'
        reset_text = (HERE / 'reset-customer-data.sql').read_text()
        marker = '-- Explicit FK-safe child-to-parent deletes'
        self.check(marker in reset_text, 'Fault-injection marker missing')
        first_delete_end = reset_text.index(';', reset_text.index('DELETE FROM pliego.', reset_text.index(marker))) + 1
        fail_script.write_text(reset_text[:first_delete_end] + "\nDO $$ BEGIN RAISE EXCEPTION 'injected rehearsal failure'; END $$;\n" + reset_text[first_delete_end:])
        self.reset('reset-mid-delete-failure.log', commit=True, failure=True, script=fail_script)
        self.check(before == self.full_snapshot(), 'Mid-delete failure changed data or sequences')
        self.check(structure == self.structure(), 'Mid-delete failure left disabled triggers or changed ACLs')
        print('Injected mid-delete failure: all data/sequences and disabled trigger DDL rolled back.')
        self.reset('reset-commit.log', commit=True)
        self.retained_after(retained)
        self.check(before['sequences'] == self.sequences(), 'Commit changed sequences')
        self.check(structure == self.structure(), 'Commit changed ownership, ACLs, roles or triggers')
        self.validate()
        self.privileges()
        empty = self.full_snapshot()
        self.reset('reset-second-commit.log', commit=True)
        self.check(empty == self.full_snapshot(), 'Second reset was not a no-op')
        self.retained_after(retained)
        self.check(structure == self.structure(), 'Second reset changed structure')
        print('Commit and second commit: preserved fingerprints/Flyway/33 sequences identical; second reset deleted zero rows.')
        # Worker only starts once old customer/R2 rows have gone. Fresh restricted
        # app sessions cannot inherit owner privileges from the reset connection.
        self.start_backend()
        self.http(old)
        self.stop_backend()
        self.check(before['flyway'] == self.fingerprint('public.flyway_schema_history'), 'Backend changed Flyway history')
        for table in PRESERVE:
            if table != 'academic_document_counter':
                self.check(retained[table] == self.fingerprint('pliego.' + table), 'HTTP changed catalog/config: ' + table)
        self.check(retained['usuario'] == self.fingerprint('pliego.usuario', "rol='ADMIN'"), 'HTTP changed ADMIN')
        self.validate()
        self.privileges()
        # Clean the synthetic smoke account and rerun so the final restored DB is
        # reset too, while retaining its newly advanced external number counters.
        self.reset('reset-after-http.log', commit=True)
        final = self.full_snapshot()
        self.reset('reset-final-noop.log', commit=True)
        self.check(final == self.full_snapshot(), 'Final repeat was not a no-op')
        self.run([self.bin / 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-f', HERE / 'reset-customer-data-inventory.sql'], 'inventory-after.log')
        (self.work / 'result.json').write_text(json.dumps({'passed': True, 'tables': 58,
            'foreign_keys': 69, 'user_triggers': 70, 'delete_guards': 21, 'rules': 0,
            'jar_sha256': hashlib.sha256(self.jar.read_bytes()).hexdigest(),
            'script_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in HERE.iterdir() if p.suffix in ('.sql','.py','.sh')},
            'dump_sha256': hashlib.sha256(dump.read_bytes()).hexdigest(),
            'before_counts': {t: v[0] for t, v in before.items() if isinstance(v, list)},
            'final_counts': {t: v[0] for t, v in final.items() if isinstance(v, list)},
            'public_reference_nonreuse_guaranteed': False, 'manual_document_number_nonreuse_guaranteed': False,
            'random_pickup_code_nonreuse_guaranteed': False}, indent=2))
        print('Rehearsal PASSED for database effects. BLOCKER: V095 does not reserve deleted random references/codes or manual document numbers.')

    def make_fixture(self, destination):
        # This method runs only in this driver's newly initialized cluster.
        # Migrations run through the real JAR; production data is never invented.
        from_fixture = self.env.copy()
        from_fixture.update(PLIEGO_DB_USERNAME='postgres', PLIEGO_DB_PASSWORD='',
                            PLIEGO_BILLING_ENABLED='false', PLIEGO_ADMIN_PASSWORD_HASH='fictional-fixture-hash')
        self.run(['python3', '-B', GATES / 'release_pending_upgrade_gate.py', '--evidence', self.work / 'v087-private.json'], 'fixture-upgrade.log', from_fixture)
        # Extra coverage is kept separate from the actual reset SQL.
        self.run([self.bin / 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-f', HERE / 'reset-customer-data-fixture.sql'], 'fixture-extra.log')
        # Recreate production separation using the exact canonical cleanup block.
        # First transfer fictional bootstrap-owned application objects only.
        statements = self.query("""SELECT format('ALTER TABLE %I.%I OWNER TO pliego_owner',n.nspname,c.relname)
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='pliego' AND c.relkind IN('r','p')) OR c.oid='public.flyway_schema_history'::regclass
          UNION ALL SELECT format('ALTER SEQUENCE pliego.%I OWNER TO pliego_owner',c.relname) FROM pg_class c WHERE c.relnamespace='pliego'::regnamespace AND c.relkind='S'
          UNION ALL SELECT format('ALTER ROUTINE pliego.%I(%s) OWNER TO pliego_owner',p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p WHERE p.pronamespace='pliego'::regnamespace""")
        # Identity sequence owners follow their tables; ALTER SEQUENCE is then safe.
        self.query(statements.replace('\n', ';\n') + '; ALTER SCHEMA pliego OWNER TO pliego_owner;')
        # V082 intentionally revoked owner geo DML. Match that production model.
        self.query('REVOKE INSERT,UPDATE,DELETE ON pliego.provincia,pliego.ciudad,pliego.ciudad_alias FROM pliego_owner;')
        text = (ROOT / 'docs/deployment/production-runbook.md').read_text()
        cleanup = text.split('-- BEGIN PLIEGO_RUNTIME_ACL_CLEANUP_SQL', 1)[1].split('-- END PLIEGO_RUNTIME_ACL_CLEANUP_SQL', 1)[0]
        self.query(cleanup)
        self.privileges()
        self.check(self.query('SELECT count(*) FROM pliego.libro') == '425', 'Fixture 425 works')
        self.check(self.query('SELECT count(*) FROM pliego.edicion') == '425', 'Fixture 425 editions')
        tables = self.query("SELECT tablename FROM pg_tables WHERE schemaname='pliego' ORDER BY 1").splitlines()
        self.check(all(int(self.query(f'SELECT count(*) FROM pliego.{t}')) > 0 for t in tables),
                   'The realistic fixture must exercise every one of the 58 tables')
        self.check(self.query("SELECT count(*) FROM pliego.factura_archivo WHERE storage_kind='R2'") == '2', 'Fixture R2 metadata')
        self.check(self.query('SELECT count(*) FROM pliego.factura_archivo_contenido') == '2', 'Fixture historical DATABASE bytes')
        self.check(not destination.exists(), 'Refusing to overwrite an existing fixture dump')
        self.run([self.bin / 'pg_dump', '--format=custom', '--file', destination], 'fixture-dump.log')
        destination.chmod(0o600)
        print('Fictional V087→V095 custom dump created: 425 works/editions, customer transactions, invoice bytes/R2 metadata, outbox/events, ADMIN/session controls.')

    def close(self):
        self.stop_backend()
        if self.started:
            self.run([self.bin / 'pg_ctl', '-D', self.work / 'data', '-m', 'fast', '-w', 'stop'], 'cluster-stop.log')
        # Keep private logs/digests; remove restored sensitive DB bytes by default.
        if not self.args.keep_cluster:
            shutil.rmtree(self.work / 'data', ignore_errors=True)
        self.jar.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dump', nargs='?', help='Local pg_dump custom-format V095 file')
    parser.add_argument('--make-fixture', metavar='FILE', help='Create fictional upgrade fixture instead of rehearsing')
    parser.add_argument('--jar', default=str(ROOT / 'backend/target/pliego-backend-0.1.0-SNAPSHOT.jar'))
    parser.add_argument('--pg-bin', default='/usr/lib/postgresql/18/bin')
    parser.add_argument('--keep-cluster', action='store_true', help='Retain stopped sensitive cluster under private /tmp evidence')
    args = parser.parse_args()
    if bool(args.dump) == bool(args.make_fixture):
        parser.error('Supply exactly one custom dump or --make-fixture FILE')
    os.umask(0o077)
    rehearsal = Rehearsal(args)
    print('Private local evidence: ' + str(rehearsal.work), flush=True)
    try:
        rehearsal.execute()
    finally:
        rehearsal.close()


if __name__ == '__main__':
    main()
