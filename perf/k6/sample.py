#!/usr/bin/env python3
"""Five-second local-only observability and host snapshots; no third-party libraries."""
import datetime
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

out = Path(sys.argv[1])
java_pid = int(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
stop = False


def shutdown(*_):
    global stop
    stop = True


signal.signal(signal.SIGTERM, shutdown)
http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
with (out / 'samples.jsonl').open('w') as f:
    while not stop:
        started = time.monotonic()
        stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        sample = {'utc': stamp, 'monotonic': started,
                  'meminfo': Path('/proc/meminfo').read_text(),
                  'psi': {x: Path('/proc/pressure/' + x).read_text() for x in ('cpu', 'memory', 'io')},
                  'loadavg': Path('/proc/loadavg').read_text(), 'processes': {}}
        for proc in Path('/proc').iterdir():
            if not proc.name.isdigit():
                continue
            try:
                name = (proc / 'comm').read_text().strip()
                if int(proc.name) == java_pid or name == 'postgres':
                    sample['processes'][proc.name] = {
                        'comm': name, 'status': (proc / 'status').read_text(),
                        'stat': (proc / 'stat').read_text(), 'io': (proc / 'io').read_text(),
                        'cmdline': (proc / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')}
            except (OSError, ValueError):
                pass
        try:
            with http.open('http://127.0.0.1:8081/actuator/prometheus', timeout=4) as r:
                prom = r.read().decode()
            fname = 'prometheus-' + stamp.replace(':', '').replace('+', '_') + '.txt'
            (out / fname).write_text(prom)
            sample['prometheus_file'] = fname
            wanted = ('hikaricp_', 'tomcat_threads_', 'jvm_memory_', 'jvm_gc_pause_',
                      'process_cpu_', 'process_uptime_', 'pliego_sse_', 'jvm_threads_', 'jvm_buffer_')
            sample['metrics'] = [line for line in prom.splitlines() if line.startswith(wanted)]
        except Exception as e:
            sample['scrape_error'] = str(e)
        f.write(json.dumps(sample) + '\n')
        f.flush()
        while not stop and time.monotonic() - started < 5:
            time.sleep(.2)

# Once, after k6 has finished and the harness stops this sampler. No SQL polling
# is added inside the measured window. Aggregate counts prove proxy identity and
# safety without storing IP keys, customer addresses, token values or payloads.
query = """BEGIN READ ONLY;
DO $$ BEGIN
 IF current_database()<>'pliego_benchmark' OR current_setting('port')<>'55464'
  OR inet_server_addr()<>'127.0.0.1'::inet
 THEN RAISE EXCEPTION 'Refusing diagnostics outside disposable local benchmark'; END IF;
END $$;
SELECT jsonb_build_object(
 'utc',clock_timestamp(),
 'ipBuckets',(SELECT count(*) FROM pliego.login_intento_limite WHERE clave LIKE 'IP:%'),
 'matchingSyntheticClientIpBuckets',(SELECT count(*) FROM pliego.login_intento_limite l
    JOIN generate_series(1,1024) AS g(i)
    ON l.clave='IP:'||encode(sha256(convert_to('10.201.'||(i/250)::text||'.'||(i%250+1)::text,'UTF8')),'hex')),
 'loopbackIpBucketPresent',EXISTS(SELECT FROM pliego.login_intento_limite
    WHERE clave='IP:'||encode(sha256(convert_to('127.0.0.1','UTF8')),'hex')),
 'maximumVerificationsPerIp',(SELECT COALESCE(max(verificaciones),0) FROM pliego.login_intento_limite WHERE clave LIKE 'IP:%'),
 'issuedInvoices',(SELECT count(*) FROM pliego.factura WHERE estado='ISSUED'),
 'approvedPayments',(SELECT count(*) FROM pliego.pago WHERE estado='APPROVED'),
 'draftInvoices',(SELECT count(*) FROM pliego.factura WHERE estado='DRAFT'),
 'pendingPayments',(SELECT count(*) FROM pliego.pago WHERE estado='PENDING'),
 'artifacts',(SELECT count(*) FROM pliego.factura_archivo),
 'sentMail',(SELECT count(*) FROM pliego.correo_outbox WHERE estado='SENT'));
COMMIT;
"""
port = os.environ.get('PGPORT', '55464')
if port not in ('55464', '55465', '55466', '55467', '55468'):
    raise SystemExit('Unexpected local diagnostic PostgreSQL port')
query = query.replace("current_setting('port')<>'55464'", "current_setting('port')<>'" + port + "'")
if os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1':
    command = ['/usr/lib/postgresql/18/bin/psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
               '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'pliego_benchmark', '-c', query]
    result = subprocess.run(command, capture_output=True, text=True, timeout=15)
    (out / 'post-run-diagnostics.json').write_text(result.stdout)
    (out / 'post-run-diagnostics.stderr').write_text(result.stderr)
    (out / 'post-run-diagnostics-command.json').write_text(json.dumps({
        'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'argv': command, 'exit_status': result.returncode}, indent=2) + '\n')
