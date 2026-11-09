#!/usr/bin/env python3
"""Fenced local benchmark. A fresh foreground PostgreSQL child owns unique data.

No daemon/PID-file assumptions, no reused cluster, no inherited credentials.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import ipaddress
import os
import re
import shutil
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / '.release-evidence/2026-11-04-vps-audit'
BASE = EVIDENCE / 'performance'
SERVICE_CPUS = '0,2'
LOAD_CPUS = '4-31'
CLI = ['--server.address=127.0.0.1', '--server.port=8080', '--server.forward-headers-strategy=native',
       '--server.tomcat.remoteip.internal-proxies=127[.]0[.]0[.]1',
       '--server.tomcat.remoteip.remote-ip-header=X-Forwarded-For',
       '--server.tomcat.remoteip.protocol-header=X-Forwarded-Proto',
       '--server.tomcat.remoteip.host-header=X-Forwarded-Host',
       '--server.tomcat.remoteip.port-header=X-Forwarded-Port',
       '--server.tomcat.threads.max=50', '--server.tomcat.threads.min-spare=5',
       '--server.tomcat.max-connections=1024', '--server.tomcat.connection-timeout=10s',
       '--spring.datasource.hikari.maximum-pool-size=8', '--spring.datasource.hikari.minimum-idle=2',
       '--spring.datasource.hikari.connection-timeout=10000', '--spring.datasource.hikari.validation-timeout=3000']
processes = []
http = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def record(command, status, log, started, cwd=ROOT, **extra):
    with (OUT / 'runtime-commands.jsonl').open('a') as f:
        f.write(json.dumps({'start_utc': started, 'end_utc': utc(), 'argv': list(map(str, command)),
                            'exit_status': status, 'log': str(log), 'cwd': str(cwd), **extra}) + '\n')


def run(command, log, env=None, check=True):
    started = utc()
    with Path(log).open('w') as f:
        result = subprocess.run(list(map(str, command)), cwd=ROOT, env=env or SAFE,
                                stdout=f, stderr=subprocess.STDOUT)
    record(command, result.returncode, log, started)
    if check and result.returncode:
        raise RuntimeError(str(log) + ' exited ' + str(result.returncode))
    return result.returncode


def launch(command, log, env=None):
    f = Path(log).open('w')
    proc = subprocess.Popen(list(map(str, command)), cwd=OUT, env=env or SAFE,
                            stdout=f, stderr=subprocess.STDOUT)
    processes.append((proc, f, command, Path(log), utc()))
    return proc


def halt(proc, pg=False):
    if proc.poll() is None:
        proc.send_signal(signal.SIGINT if pg else signal.SIGTERM)
    try:
        proc.wait(timeout=60)
    except subprocess.TimeoutExpired:
        # Disposable process only. A forced exit is retained as unclean and this
        # cluster is never reused; do not delete its PID file or repair its data.
        proc.kill()
        proc.wait()
    for entry in processes[:]:
        if entry[0] is proc:
            entry[1].close()
            record(entry[2], proc.returncode, entry[3], entry[4], cwd=OUT,
                   stop_signal='SIGINT-fast' if pg else 'SIGTERM', pid=proc.pid)
            processes.remove(entry)


def sql(query, log, database='pliego_benchmark', check=True):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
                '-p', args.pg_port, '-U', 'postgres', '-d', database, '-c', query], log, PGENV, check)


def nmt(name):
    run(['taskset', '-c', LOAD_CPUS, JDK / 'bin/jcmd', java.pid,
         'VM.native_memory', 'summary', 'scale=KB'], OUT / (name + '-nmt.txt'), check=False)


def request(path, port=8080):
    try:
        with http.open('http://127.0.0.1:' + str(port) + path, timeout=3) as response:
            return response.status, len(response.read())
    except urllib.error.HTTPError as error:
        return error.code, len(error.read())


def native_pg_errors():
    text = (OUT / 'postgres.log').read_text(errors='replace')
    return [line for line in text.splitlines()
            if re.search(r'MultiXactId .*not been created|PANIC:|invalid page|corrupt|checksum verification failed', line, re.I)]


def nginx_config():
    prefix = str(OUT / 'nginx')
    for directory in ('body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'):
        (OUT / 'nginx' / directory).mkdir(parents=True, exist_ok=True)
    config = '''worker_processes 2;
error_log %(p)s/error.log warn;
pid %(p)s/nginx.pid;
events { worker_connections 768; }
http {
 log_format audit '$msec $request_method $uri $status duration=$request_time upstream=$upstream_response_time';
 access_log %(p)s/access.log audit;
 client_body_temp_path %(p)s/body;
 proxy_temp_path %(p)s/proxy;
 fastcgi_temp_path %(p)s/fastcgi;
 uwsgi_temp_path %(p)s/uwsgi;
 scgi_temp_path %(p)s/scgi;
 gzip on;
 server { listen 127.0.0.1:18085; server_name localhost;
  location / {
   default_type text/plain;
   proxy_pass http://127.0.0.1:8080;
   proxy_http_version 1.1;
   proxy_set_header Host api.pliegolibros.com;
   proxy_set_header X-Forwarded-Host api.pliegolibros.com;
   proxy_set_header X-Forwarded-Proto https;
   proxy_set_header X-Forwarded-Port 443;
   proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
   proxy_set_header X-Real-IP $http_cf_connecting_ip;
   proxy_set_header Forwarded "";
   proxy_set_header Connection "";
   client_max_body_size 1m;
   client_body_timeout 15s;
   proxy_connect_timeout 5s;
   proxy_send_timeout 30s;
   proxy_read_timeout 30s;
  }
 }
}
''' % {'p': prefix}
    (OUT / 'nginx.conf').write_text(config)


def k6run(name, users, hold, sse=False, stress=False, step=False, workload=None, sse_duration="630s"):
    directory = OUT / 'runs' / name
    directory.mkdir(parents=True, exist_ok=False)
    environment = {**SAFE, 'BENCHMARK_DISPOSABLE': '1', 'BASE_URL': 'http://127.0.0.1:18085',
                   'VUS': str(users), 'HOLD': hold, 'FIXTURES': str(fixtures),
                   'SUMMARY': str(directory / 'summary.json'), 'SSE': '1' if sse else '0',
                   'SSE_DURATION': sse_duration, 'STRESS': '1' if stress and not step else '0',
                   'K6_NO_USAGE_REPORT': 'true'}
    command = ['taskset', '-c', LOAD_CPUS, 'k6', 'run', '--out', 'json=' + str(directory / 'raw.json'),
               '--quiet', ROOT / ('perf/k6/' + workload if workload else 'perf/k6/step.js' if step else 'perf/k6/journeys.js')]
    (directory / 'invocation.json').write_text(json.dumps({'argv': list(map(str, command)),
            'environment': environment, 'cwd': str(OUT), 'synthetic_credentials_only': True}, indent=2) + '\n')
    observer = None
    if args.db_observer:
        observer = launch(['taskset','-c',LOAD_CPUS,'python3',args.db_observer,
                           '--port',args.pg_port,'--output',directory/'db-observer'], directory/'db-observer-driver.log')
        for _ in range(120):
            if observer.poll() is not None:
                raise RuntimeError('DB observer exited before ready; no timed workload started')
            if (directory/'db-observer/ready.json').exists():break
            time.sleep(.25)
        else:raise RuntimeError('DB observer did not become ready within30seconds')
    sampler = launch(['taskset', '-c', LOAD_CPUS, 'python3', ROOT / 'perf/k6/sample.py',
                      directory / 'samples', java.pid], directory / 'sampler.log')
    pidstat = launch(['taskset', '-c', LOAD_CPUS, 'pidstat', '-h', '-u', '-r', '-w',
                      '-C', 'java|postgres', '5'], directory / 'pidstat.txt')
    vmstat = launch(['taskset', '-c', LOAD_CPUS, 'vmstat', '-t', '5'], directory / 'vmstat.txt')
    nmt(name + '-before')
    started = utc()
    print(started, 'START', name, flush=True)
    proc = launch(command, directory / 'k6.log', environment)
    sampled = False
    aborted = False
    while proc.poll() is None:
        time.sleep(.5)
        if java.poll() is not None or postgres.poll() is not None:
            aborted = True
            proc.send_signal(signal.SIGINT)
            break
        if not sampled and (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(started)).total_seconds() > 60:
            nmt(name + '-during')
            sampled = True
    if aborted:
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.terminate()
    halt(proc)
    errors = native_pg_errors()
    if not aborted:
        nmt(name + '-after')
        run(['taskset', '-c', LOAD_CPUS, JDK / 'bin/jcmd', java.pid, 'Compiler.codelist'],
            OUT / (name + '-compiler-codelist.txt'), check=False)
    for child in (sampler, pidstat, vmstat):
        halt(child)
    if observer is not None:
        # PostgreSQL backend counters are asynchronously published. This guard
        # interval follows k6 completion and is kept outside its sample window.
        time.sleep(6)
        halt(observer)
    result = {'name': name, 'vus': users, 'hold': hold, 'sse': sse, 'stress': stress,
              'stress_steps': [users] if step else [25,40,60,100,160] if stress else [],
              'start_utc': started, 'end_utc': utc(), 'exit_status': proc.returncode,
              'raw_dir': str(directory.relative_to(ROOT)), 'valid_for_capacity': not aborted and not errors,
              'java_exit_status': java.poll(), 'postgres_exit_status': postgres.poll(),
              'native_pg_errors': errors, 'diagnostic_compile_exclusion': args.exclude_prometheus_compilation,
              'diagnostic_jvm_mode': 'C1-tier1' if args.diagnostic_tier1 else 'single-method-exclusion' if args.exclude_prometheus_compilation else None,
              'production_jvm_parity': not args.diagnostic_tier1 and not args.exclude_prometheus_compilation,
              'cluster_fingerprint_file': str(OUT / 'cluster-fingerprint.json'),
              'workload_file': workload or ('step.js' if step else 'journeys.js'),
              'minimum_actual_checkout_requests': 150 if workload == 'checkout-weighted.js' else None,
              'expected_endpoint_groups': ['auth','cart','checkout'] if workload else ['catalog','search','detail','auth','cart','checkout'],
              'additive_review_run': args.suite == 'checkout-review',
              'db_commit_observer': str(directory/'db-observer') if observer is not None else None}
    (directory / 'run.json').write_text(json.dumps(result, indent=2) + '\n')
    with (OUT / 'runs.jsonl').open('a') as f:
        f.write(json.dumps(result) + '\n')
    print(utc(), 'END', name, 'exit', proc.returncode, 'substrate_valid', not aborted and not errors, flush=True)
    if aborted or errors:
        (OUT / 'qualification-exclusions.json').write_text(json.dumps({
            'utc': utc(), 'scope': 'This session', 'reason': 'Native process exit or PostgreSQL integrity error',
            'native_pg_errors': errors}, indent=2) + '\n')
        raise RuntimeError('Native substrate failed; retained run is not accepted for capacity')
    return proc.returncode


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', choices=['all', 'smoke', 'checkout-review'], default='all')
    parser.add_argument('--session', required=True)
    parser.add_argument('--cluster-key', required=True)
    parser.add_argument('--pg-port', choices=['55464','55465','55466','55467','55468'], default='55465')
    parser.add_argument('--jdk', type=Path, default=ROOT / '.release-evidence/2026-11-03/temurin/jdk-25.0.5+8')
    parser.add_argument('--pg-bin', type=Path, default=Path('/usr/lib/postgresql/18/bin'))
    parser.add_argument('--pg-library-path', type=Path)
    parser.add_argument('--jar', type=Path, default=ROOT / 'backend/target/pliego-backend-0.1.0-SNAPSHOT.jar')
    parser.add_argument('--extend-if-needed', action='store_true')
    parser.add_argument('--exclude-prometheus-compilation', action='store_true')
    parser.add_argument('--diagnostic-tier1', action='store_true')
    parser.add_argument('--skip-explains', action='store_true')
    parser.add_argument('--db-observer',type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', args.session) or not re.fullmatch(r'[A-Za-z0-9_-]{1,12}', args.cluster_key):
        raise SystemExit('Session/cluster key must be a short safe local label')
    BASE.mkdir(parents=True, exist_ok=True)
    lock = (BASE / 'harness.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    OUT = BASE / 'sessions' / args.session
    CLUSTER = EVIDENCE / 'clusters' / args.cluster_key
    PGDATA = CLUSTER / 'data'
    PGSOCKET = CLUSTER / 's'
    socket_file = str(PGSOCKET / ('.s.PGSQL.' + args.pg_port))
    if len(socket_file.encode()) >= 108:
        raise SystemExit('PostgreSQL pathname Unix socket exceeds108-byte limit')
    OUT.mkdir(parents=True, exist_ok=False)
    CLUSTER.mkdir(parents=True, exist_ok=False)
    PGSOCKET.mkdir()
    (OUT / 'home').mkdir()
    (OUT / 'source').mkdir()
    JDK = args.jdk.resolve()
    PG = args.pg_bin.resolve()
    SAFE = {'PATH': str(JDK / 'bin') + ':/usr/bin:/bin', 'HOME': str(OUT / 'home'), 'LANG': 'C.UTF-8',
            'TZ': 'UTC', 'NO_PROXY': '127.0.0.1,localhost', 'no_proxy': '127.0.0.1,localhost',
            'PLIEGO_TEST_DISPOSABLE_DB': '1', 'PGHOST': '127.0.0.1', 'PGPORT': args.pg_port,
            'PGDATABASE': 'pliego_benchmark', 'PGUSER': 'postgres', 'PGPASSWORD': 'synthetic-unused-trust'}
    PGENV = {**SAFE, **({'LD_LIBRARY_PATH': str(args.pg_library_path.resolve())} if args.pg_library_path else {})}
    APPENV = {**SAFE, 'PLIEGO_DB_URL': 'jdbc:postgresql://127.0.0.1:' + args.pg_port + '/pliego_benchmark',
              'PLIEGO_DB_USERNAME': 'pliego_app', 'PLIEGO_DB_PASSWORD': 'benchmark-local-only',
              'PLIEGO_ADMIN_EMAIL': 'perf-admin@example.invalid', 'PLIEGO_ADMIN_PASSWORD_HASH': 'unused-synthetic-admin',
              'PLIEGO_JWT_SECRET': 'SyntheticLocalBenchmarkSecret-Only-2026-Not-Real-64bytes',
              'PLIEGO_MAIL_ENABLED': 'false', 'PLIEGO_R2_ENABLED': 'false', 'PLIEGO_BILLING_ENABLED': 'false',
              'PLIEGO_AUTH_COOKIE_SECURE': 'false', 'SPRING_PROFILES_ACTIVE': 'observability'}
    hashes = {}
    for name in ('local-benchmark.py','journeys.js','checkout-weighted.js','step.js','sample.py','bootstrap.py','seed.sql','extend-customers.sql'):
        path = ROOT / 'perf/k6' / name
        shutil.copy2(path, OUT / 'source' / name)
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    (OUT / 'source-sha256.json').write_text(json.dumps(hashes, indent=2) + '\n')
    lifecycle = {'created_utc': utc(), 'cluster_directory': str(CLUSTER), 'data_directory': str(PGDATA),
                 'socket_directory': str(PGSOCKET), 'socket_path_bytes': len(socket_file.encode()),
                 'port': args.pg_port, 'lock_inode': os.fstat(lock.fileno()).st_ino,
                 'lock_device': os.fstat(lock.fileno()).st_dev, 'policy': 'Fresh unique cluster; never reused or PID-unlinked'}
    (OUT / 'cluster-lifecycle.json').write_text(json.dumps(lifecycle, indent=2) + '\n')
    postgres = java = nginx = None
    try:
        # Fail closed if a local service already owns the requested TCP port.
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', int(args.pg_port)))
        run(['taskset','-c',SERVICE_CPUS,PG/'initdb','-D',PGDATA,'-U','postgres','-A','trust','--locale=C.UTF-8','--encoding=UTF8'], OUT/'initdb.log', PGENV)
        (PGDATA/'conf.d').mkdir()
        with (PGDATA/'postgresql.conf').open('a') as f:
            f.write("\ninclude_dir='conf.d'\nlisten_addresses='127.0.0.1'\nport=" + args.pg_port + "\nunix_socket_directories='" + str(PGSOCKET) + "'\n")
        (PGDATA/'conf.d/99-pliego.conf').write_text('max_connections=30\nshared_buffers=512MB\neffective_cache_size=2GB\nwork_mem=4MB\nmaintenance_work_mem=128MB\nwal_compression=on\nrandom_page_cost=1.1\neffective_io_concurrency=200\njit=off\n')
        run([PG/'pg_controldata',PGDATA],OUT/'pg-control-after-init.txt',PGENV)
        control=(OUT/'pg-control-after-init.txt').read_text()
        system_id=re.search(r'Database system identifier:\s+(\d+)',control).group(1)
        postgres=launch(['taskset','-c',SERVICE_CPUS,PG/'postgres','-D',PGDATA],OUT/'postgres.log',PGENV)
        for _ in range(120):
            if postgres.poll() is not None:raise RuntimeError('PostgreSQL startup failed')
            if 'database system is ready to accept connections' in (OUT/'postgres.log').read_text():break
            time.sleep(.25)
        else:raise RuntimeError('PostgreSQL not ready within30seconds')
        fingerprint_query="SELECT jsonb_build_object('system_identifier',system_identifier::text,'data_directory',current_setting('data_directory'),'port',current_setting('port'),'address',inet_server_addr()::text,'server_version',current_setting('server_version')) FROM pg_control_system()"
        sql(fingerprint_query,OUT/'cluster-fingerprint.json',database='postgres')
        fingerprint=json.loads((OUT/'cluster-fingerprint.json').read_text())
        if fingerprint['system_identifier']!=system_id or Path(fingerprint['data_directory'])!=PGDATA or fingerprint['port']!=args.pg_port or str(ipaddress.ip_interface(fingerprint['address']).ip)!='127.0.0.1':
            raise RuntimeError('PostgreSQL cluster fingerprint mismatch; refusing mutation')
        lifecycle.update(started_utc=utc(),postgres_pid=postgres.pid,system_identifier=system_id)
        (OUT/'cluster-lifecycle.json').write_text(json.dumps(lifecycle,indent=2)+'\n')
        run([PG/'createdb','-h','127.0.0.1','-p',args.pg_port,'-U','postgres','pliego_benchmark'],OUT/'create-db.log',PGENV)
        run(['python3',ROOT/'perf/k6/bootstrap.py','--java',JDK/'bin/java','--jar',args.jar,'--output',OUT/'postgres','--pg-port',args.pg_port],OUT/'bootstrap.log')
        if not args.skip_explains:
            run(['python3',EVIDENCE/'postgres/run-explains.py','--pg-port',args.pg_port,'--output',EVIDENCE/'postgres'/('clean-'+args.cluster_key)],OUT/'explain-command.log')
        fixtures=OUT/'postgres/fixtures.json'
        shutil.copy2(args.jar,OUT/'pliego-benchmark.jar')
        (OUT/'artifact-sha256.txt').write_text(hashlib.sha256((OUT/'pliego-benchmark.jar').read_bytes()).hexdigest()+'  pliego-benchmark.jar\n')
        nginx_config()
        run([BASE/'bin/nginx','-t','-p',OUT/'nginx','-c',OUT/'nginx.conf'],OUT/'nginx-test.log')
        diagnostic=['-XX:CompileCommand=exclude,io/micrometer/prometheusmetrics/PrometheusMeterRegistry.lambda$addDistributionStatisticSamples$0'] if args.exclude_prometheus_compilation else []
        if args.diagnostic_tier1:diagnostic.append('-XX:TieredStopAtLevel=1')
        jvm=['-Xms256m','-Xmx1280m','-XX:+ExitOnOutOfMemoryError','-XX:NativeMemoryTracking=summary','-XX:ErrorFile='+str(OUT/'hs_err_pid%p.log'),*diagnostic]
        (OUT/'runtime-config.json').write_text(json.dumps({'jvm_flags':jvm,'production_cli_verbatim':CLI,'service_cpus':SERVICE_CPUS,'load_cpus':LOAD_CPUS,'pg_bin':str(PG),'pg_library_path':str(args.pg_library_path),'jdk':str(JDK),'synthetic_credentials_only':True,'mail_enabled':False,'r2_enabled':False,'billing_enabled':False,'memory_scope_enforced':False,'diagnostic_tier1':args.diagnostic_tier1,'plan_reference':'postgres/clean-c2' if args.skip_explains else 'postgres/clean-'+args.cluster_key},indent=2)+'\n')
        java=launch(['taskset','-c',SERVICE_CPUS,JDK/'bin/java',*jvm,'-jar',OUT/'pliego-benchmark.jar',*CLI],OUT/'backend.log',APPENV)
        for _ in range(120):
            if java.poll() is not None:raise RuntimeError('Java startup failed')
            try:
                if request('/api/v1/catalog/editions')[0]==200:break
            except Exception:pass
            time.sleep(1)
        else:raise RuntimeError('Java not ready')
        nginx=launch(['taskset','-c',SERVICE_CPUS,BASE/'bin/nginx','-p',OUT/'nginx','-c',OUT/'nginx.conf','-g','daemon off;'],OUT/'nginx-master.log')
        time.sleep(1)
        run(['bash','-c','lscpu; free -h; uname -a; ss -ltnp; ps -eo pid,comm,psr; taskset -pc '+str(java.pid)+'; taskset -pc '+str(postgres.pid)],OUT/'runtime-environment.txt')
        exposure=[]
        for port in (8080,8081):
            for path in ('/actuator/health','/actuator/metrics','/actuator/prometheus','/actuator/env','/actuator/heapdump','/actuator/threaddump','/actuator/beans','/actuator/configprops','/actuator/loggers','/actuator/mappings','/actuator/shutdown'):
                status,size=request(path,port);exposure.append({'port':port,'path':path,'status':status,'body_bytes':size})
        (OUT/'profile-on-exposure.json').write_text(json.dumps(exposure,indent=2)+'\n')
        if args.suite in ('all','smoke') and k6run('smoke-1',1,'45s'):
            raise RuntimeError('Smoke thresholds failed')
        if args.suite=='all':
            schedule=[('baseline-5-a',5,'90s',False,False),('baseline-5-b',5,'90s',False,False),('expected-10-a',10,'90s',False,False),('expected-10-b',10,'90s',False,False),('target-15-a',15,'600s',False,False),('target-15-b',15,'600s',False,False),('target-15-c',15,'600s',False,False),('target-15-sse',15,'600s',True,False),('stress-25-40-60-100-160',160,'120s',False,True)]
            last_status=0
            for row in schedule:last_status=k6run(*row)
            if args.extend_if_needed and last_status==0:
                run(['taskset','-c',LOAD_CPUS,'python3',ROOT/'perf/k6/summarize.py',OUT/'runs'],OUT/'initial-summary-command.log')
                stress=json.loads((OUT/'runs/stress-25-40-60-100-160/results.json').read_text())
                stage_pass=all(v['p95_ms'] is not None and v['p95_ms'] < (3000 if g=='checkout' else 1500 if g in ('auth','cart') else 800) and v['error_rate'] is not None and v['error_rate']<.01 for w in stress['steady_windows_from_vu_samples'].values() for g,v in w['groups'].items())
                if stage_pass:
                    run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','benchmark_port='+args.pg_port,'-v','target_customers=600','-f',ROOT/'perf/k6/extend-customers.sql'],OUT/'extend-customers.log',PGENV)
                    lines=[x for x in (OUT/'extend-customers.log').read_text().splitlines() if x.startswith('{')]
                    fixture=json.loads(lines[-1])
                    if len(fixture['customers'])!=600:raise RuntimeError('Expected600 unique extended customers')
                    fixtures=OUT/'postgres/fixtures-extended.json'
                    fixtures.write_text(json.dumps(fixture)+'\n')
                    (OUT/'extended-fixture-sha256.txt').write_text(hashlib.sha256(fixtures.read_bytes()).hexdigest()+'\n')
                    k6run('extended-warmup-15',15,'120s')
                    decisions=[]
                    for users in (250,400,600):
                        status=k6run('extended-stress-'+str(users),users,'120s',stress=True,step=True)
                        decisions.append({'users':users,'exit_status':status,'utc':utc()})
                        if status:break
                    (OUT/'extended-stress-decisions.json').write_text(json.dumps(decisions,indent=2)+'\n')
        if args.suite == 'checkout-review':
            k6run('review-http15-120s',15,'120s')
            k6run('review-http15-sse15-120s',15,'120s',sse=True,sse_duration='150s')
            status=k6run('review-checkout150',15,'10iterations perVU;150total',workload='checkout-weighted.js')
            outcome=json.loads((OUT/'runs/review-checkout150/summary.json').read_text())
            count=outcome['metrics'].get('checkout_requests',{}).get('values',{}).get('count',0)
            valid=outcome['metrics'].get('checkout_created',{}).get('values',{}).get('count',0)
            (OUT/'checkout-review-decision.json').write_text(json.dumps({'utc':utc(),'k6_exit_status':status,
                'actual_checkout_requests':count,'positive_pending_checkout_responses':valid,
                'minimum_required':100,'planned':150},indent=2)+'\n')
            if count<100 or valid<100:
                raise RuntimeError('Checkout review did not produce at least100 real pending-transfer responses')
        sql("SELECT 'factura',estado,count(*) FROM pliego.factura GROUP BY estado; SELECT 'pago',estado,count(*) FROM pliego.pago GROUP BY estado; SELECT 'artifacts',count(*) FROM pliego.factura_archivo; SELECT 'mail',estado,count(*) FROM pliego.correo_outbox GROUP BY estado;",OUT/'safety-final-counts.txt')
        sql("SELECT name,setting,unit FROM pg_settings WHERE name IN ('max_connections','shared_buffers','effective_cache_size','work_mem','maintenance_work_mem','wal_compression','random_page_cost','effective_io_concurrency','jit','io_method','synchronous_commit','archive_mode','log_min_duration_statement','idle_in_transaction_session_timeout');",OUT/'pg-final-settings.txt')
        run(['taskset','-c',LOAD_CPUS,'python3',ROOT/'perf/k6/summarize.py',OUT/'runs'],OUT/'summary-command.log')
    finally:
        for entry in processes[:]:
            if entry[0] is not postgres:halt(entry[0])
        if postgres is not None:
            halt(postgres,pg=True)
            lifecycle.update(stopped_utc=utc(),postgres_exit_status=postgres.returncode,
                             clean_stop=postgres.returncode==0,pidfile_exists_after_stop=(PGDATA/'postmaster.pid').exists())
            (OUT/'cluster-lifecycle.json').write_text(json.dumps(lifecycle,indent=2)+'\n')
            run([PG/'pg_controldata',PGDATA],OUT/'pg-control-after-stop.txt',PGENV,check=False)
