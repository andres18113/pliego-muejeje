#!/usr/bin/env python3
"""Preparation-first isolated staging kit. Defaults print plans; never creates a VM."""
import argparse
import datetime
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time
import zipfile

KIT = Path(__file__).resolve().parent
ROOT = KIT.parents[1]
PURPOSE = 'pliego-disposable-staging'
MATRIX = [('smoke', 1, '45s', False), ('users5', 5, '90s', False),
          ('users10', 10, '90s', False), ('users15-a', 15, '600s', False),
          ('users15-b', 15, '600s', False), ('users15-c', 15, '600s', False),
          ('users15-sse', 15, '600s', True)]
SAFE = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_record(path, applying=False):
    r = json.loads(Path(path).read_text())
    require(r['purpose'] == PURPOSE, 'Wrong purpose marker')
    for field in ('target_ipv4', 'generator_ipv4', 'admin_ipv4'):
        ip = ipaddress.IPv4Address(r[field])
        require(not ip.is_loopback and not ip.is_unspecified and not ip.is_multicast, 'Canonical nonloopback IPv4 required')
    for field in ('target_ipv4', 'generator_ipv4'):
        ip = ipaddress.IPv4Address(r[field])
        require(any(ip in ipaddress.ip_network(c) for c in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')),
                'Target/generator must use private RFC1918 network')
    require(r['target_ipv4'] != r['generator_ipv4'], 'Generator must be separate')
    require(r['target_vm_id'] != r['generator_vm_id'], 'Separate VM IDs required')
    if applying:
        require('REPLACE' not in json.dumps(r), 'Replace all example record values')
        require(re.fullmatch('[a-f0-9]{32}', r['target_machine_id']), 'Invalid machine ID')
        require(re.fullmatch('[a-f0-9]{32}', r['generator_machine_id']), 'Invalid generator machine ID')
        require(r['target_machine_id'] != r['generator_machine_id'], 'Separate machine IDs required')
        require(re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}', r['ssh_host_fingerprint']), 'SSH fingerprint required')
        require(datetime.datetime.fromisoformat(r['destroy_after_utc'].replace('Z', '+00:00')) > datetime.datetime.now(datetime.UTC), 'Record expired')
    return r


class Runner:
    def __init__(self, out, apply):
        self.out = Path(out).resolve()
        self.out.mkdir(parents=True, exist_ok=False)
        self.out.chmod(0o700)
        self.apply = apply
        self.index = 0

    def command(self, argv, *, env=None, input=None, check=True):
        self.index += 1
        argv = list(map(str, argv))
        item = {'utc': datetime.datetime.now(datetime.UTC).isoformat(), 'argv': argv,
                'command': shlex.join(argv), 'executed': self.apply}
        print(('EXEC ' if self.apply else 'PLAN ') + item['command'], flush=True)
        if self.apply:
            log = self.out / f'{self.index:03d}.log'
            with log.open('w') as stream:
                p = subprocess.run(argv, env=env or SAFE, input=input, text=True,
                                   stdout=stream, stderr=subprocess.STDOUT, cwd=ROOT)
            item.update(exit_status=p.returncode, log=log.name)
        else:
            item.update(exit_status=None, status='NOT_EXECUTED_DRY_RUN')
        with (self.out / 'commands.jsonl').open('a') as stream:
            stream.write(json.dumps(item) + '\n')
        if self.apply and check and item['exit_status']:
            raise RuntimeError('Command failed; see ' + str(log))
        return item

    def write(self, path, value, mode=0o600):
        path = Path(path)
        if self.apply:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value)
            path.chmod(mode)
        else:
            print(f'PLAN write {path} mode={oct(mode)} sha256={hashlib.sha256(value.encode()).hexdigest()}')


def host_identity(record, generator=False):
    field = 'generator_machine_id' if generator else 'target_machine_id'
    require(Path('/etc/machine-id').read_text().strip() == record[field], 'Local machine ID does not match isolated record')
    if not generator:
        require(os.geteuid() == 0, 'Apply on isolated target requires root')
        os_release = Path('/etc/os-release').read_text()
        require('VERSION_ID="24.04"' in os_release, 'Ubuntu 24.04 required')
        require('24.04.5' in Path('/etc/lsb-release').read_text(), 'Ubuntu point release differs from parity record')
        require(os.cpu_count() == 2, 'Exactly 2 target vCPUs required')
        mem_kib = int(re.search(r'MemTotal:\s+(\d+)', Path('/proc/meminfo').read_text())[1])
        require(3700000 <= mem_kib <= 4400000, 'Target must match 4 GB envelope')


def validate_pins(directory, manifest, dry=False):
    directory = Path(directory).resolve()
    pins = json.loads(Path(manifest).read_text())
    require(pins['java_version'] == '25.0.5+8' and pins['postgres_version'] == '18.6'
            and pins['ubuntu_version'] == '24.04.5', 'Parity versions must be exact')
    require(pins['debs'], 'Approved offline package closure required')
    required = {'temurin-25.0.5+8.tar.gz', 'pliego-backend-0.1.0-SNAPSHOT.jar', 'frozen-sources.sha256'} | set(pins['debs'])
    require(required <= set(pins['artifacts']), 'Missing pinned artifacts')
    for name, digest in pins['artifacts'].items():
        require(Path(name).name == name, 'Artifact names must be basenames')
        require(re.fullmatch('[a-f0-9]{64}', digest), 'Unreviewed/missing SHA256')
        require(sha(directory / name) == digest, 'Artifact checksum mismatch: ' + name)
    # Every SQL/source byte used by bootstrap is separately frozen before install.
    expected = set()
    for line in (directory / 'frozen-sources.sha256').read_text().splitlines():
        digest, rel = line.split(maxsplit=1)
        rel = rel.lstrip('*')
        path = (ROOT / rel).resolve()
        require(path.is_relative_to(ROOT) and path.is_file(), 'Source outside staged repository')
        require(sha(path) == digest, 'Source checksum mismatch: ' + rel)
        expected.add(rel)
    essential = {'perf/k6/bootstrap.py', 'perf/k6/seed.sql', 'scripts/LocalFlyway.java', 'docs/deployment/production-runbook.md','perf/k6/journeys.js','perf/k6/target-guard.js','perf/jvm/fatal-collector.py'}
    essential |= {str(p.relative_to(ROOT)) for p in (ROOT/'backend/src/main/resources/db/migration').glob('*') if p.is_file()}
    essential |= {str(p.relative_to(ROOT)) for p in KIT.glob('*') if p.is_file()}
    require(essential <= expected, 'Frozen source manifest does not cover all provisioning inputs')
    if not dry:
        with zipfile.ZipFile(directory/'pliego-backend-0.1.0-SNAPSHOT.jar') as jar:
            for p in (ROOT/'backend/src/main/resources/db/migration').glob('*.sql'):
                require(jar.read('BOOT-INF/classes/db/migration/'+p.name) == p.read_bytes(), 'JAR/source migration divergence')
    return pins


def bootstrap(a, r, run):
    if a.apply:
        host_identity(r)
        require(os.environ.get('APPLY_STAGING') == '1', 'APPLY_STAGING=1 required')
        require(not Path('/opt/pliego/current').exists(), 'Pristine isolated host required')
        require(not Path('/etc/pliego-staging.json').exists(), 'Never rerun bootstrap on initialized host')
        require(not Path('/etc/postgresql/18/main/postgresql.conf').exists(), 'Use a pristine vanilla image without an existing PostgreSQL cluster')
    if a.pins:
        pins = validate_pins(a.artifacts, a.pins)
    else:
        require(not a.apply, 'Apply requires checksum manifest and all offline artifacts')
        pins = {'debs': ['<approved-offline-deb-closure>']}
        print('NOT VALIDATED: supply --pins + --artifacts before any apply')
    artifacts = Path(a.artifacts).resolve()
    run.command(['dpkg', '--install', *[artifacts / p for p in pins['debs']]])
    if a.apply:
        firewall=subprocess.check_output(['ufw','show','added'],env=SAFE,text=True)
        require(not any(line.strip().startswith('ufw ') for line in firewall.splitlines()), 'Pristine UFW rules required; existing allow rules would break isolation')
    run.command(['install', '-d', '-m', '0755', '/opt/temurin25', '/opt/pliego/current', '/etc/pliego'])
    run.command(['tar', '-xzf', artifacts/'temurin-25.0.5+8.tar.gz', '--strip-components=1', '-C', '/opt/temurin25'])
    run.command(['update-alternatives', '--install', '/usr/bin/java', 'java', '/opt/temurin25/bin/java', '250508'])
    run.command(['update-alternatives', '--set', 'java', '/opt/temurin25/bin/java'])
    if a.apply:
        version = subprocess.check_output(['/usr/bin/java', '-version'], stderr=subprocess.STDOUT, env=SAFE, text=True)
        require('25.0.5+8' in version, 'Java version mismatch')
        pgversion = subprocess.check_output(['/usr/lib/postgresql/18/bin/postgres','--version'], env=SAFE, text=True)
        require('18.6' in pgversion, 'PostgreSQL version mismatch')
    run.command(['useradd', '--system', '--user-group', '--home-dir', '/opt/pliego', '--shell', '/usr/sbin/nologin', 'pliego'])
    run.command(['install', '-o', 'root', '-g', 'pliego', '-m', '0640', artifacts/'pliego-backend-0.1.0-SNAPSHOT.jar', '/opt/pliego/current/pliego-backend-0.1.0-SNAPSHOT.jar'])
    run.command(['install', '-o', 'root', '-g', 'pliego', '-m', '0640', KIT/'staging.env', '/etc/pliego/pliego.env'])
    run.command(['install', '-m', '0644', KIT/'pliego.service', '/etc/systemd/system/pliego.service'])
    run.command(['install', '-m', '0644', KIT/'99-pliego.conf', '/etc/postgresql/18/main/conf.d/99-pliego.conf'])
    if a.apply:
        databases = subprocess.check_output(['runuser','-u','postgres','--','psql','-XAt','-p','5432','-c',"SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1"], env=SAFE,text=True).strip()
        require(databases == 'postgres', 'Fresh cluster required BEFORE changing port/HBA; unexpected existing database')
        (run.out/'bootstrap-trust-open').touch()
    run.command(['pg_conftool', '18', 'main', 'set', 'port', '55468'])
    run.command(['pg_conftool', '18', 'main', 'set', 'listen_addresses', '127.0.0.1'])
    run.write('/etc/postgresql/18/main/pg_hba.conf', 'local all postgres peer\nhost all postgres 127.0.0.1/32 trust\nhost pliego_benchmark pliego_app 127.0.0.1/32 scram-sha-256\n', 0o640)
    run.command(['chown', 'postgres:postgres', '/etc/postgresql/18/main/pg_hba.conf'])
    run.command(['systemctl', 'restart', 'postgresql@18-main'])
    run.command(['runuser', '-u', 'postgres', '--', 'createdb', '-p', '55468', 'pliego_benchmark'])
    output = ROOT / '.release-evidence/2026-11-05-next/ws3/staging-bootstrap'
    run.command(['python3', ROOT/'perf/k6/bootstrap.py', '--java', '/usr/bin/java', '--pg-port', '55468', '--jar', '/opt/pliego/current/pliego-backend-0.1.0-SNAPSHOT.jar', '--output', output], env={**SAFE,'PLIEGO_TEST_DISPOSABLE_DB':'1'})
    run.write('/etc/postgresql/18/main/pg_hba.conf', 'local all postgres peer\nhost pliego_benchmark pliego_app 127.0.0.1/32 scram-sha-256\n', 0o640)
    run.command(['chown', 'postgres:postgres', '/etc/postgresql/18/main/pg_hba.conf'])
    run.command(['systemctl', 'reload', 'postgresql@18-main'])
    if a.apply: (run.out/'bootstrap-trust-open').unlink()
    run.command(['rm', '-f', '/etc/nginx/sites-enabled/default'])
    run.command(['install', '-m', '0644', KIT/'nginx-staging.conf', '/etc/nginx/sites-enabled/pliego-staging'])
    run.command(['nginx', '-t'])
    for args in (['default','deny','incoming'], ['default','allow','outgoing'], ['allow','from',r['admin_ipv4'],'to','any','port','22','proto','tcp'], ['allow','from',r['generator_ipv4'],'to','any','port','22','proto','tcp'], ['allow','from',r['generator_ipv4'],'to','any','port','80','proto','tcp'], ['--force','enable']):
        run.command(['ufw', *args])
    run.write('/etc/pliego-staging.json', json.dumps(r,indent=2)+'\n')
    run.command(['systemctl', 'daemon-reload'])
    run.command(['systemctl', 'start', 'pliego'])
    run.command(['systemctl', 'restart', 'nginx'])
    run.command(['sha256sum', '/opt/pliego/current/pliego-backend-0.1.0-SNAPSHOT.jar', ROOT/'perf/k6/seed.sql', KIT/'pliego.service', KIT/'99-pliego.conf'])
    run.command(['curl','--fail','--retry','60','--retry-delay','2','--retry-connrefused','--retry-max-time','180','--max-time','5','--noproxy','*','http://127.0.0.1:8081/actuator/health'])
    run.command(['ufw','status','verbose'])
    run.command(['systemctl','show','pliego','-p','MemoryHigh','-p','MemoryMax','-p','TasksMax','-p','ExecStart'])
    print('Transfer synthetic fixtures.json to separate generator through approved SSH; never generate load on target.')


def local_capture(run, a):
    """Root on isolated target only. Every probe has its own recorded exit status."""
    run.command(['uname','-a'])
    run.command(['/usr/bin/java','-version'])
    run.command(['dpkg-query','-W','postgresql-18','nginx','sysstat','ufw'])
    run.command(['systemctl','show','pliego','-p','MainPID','-p','NRestarts','-p','ActiveState','-p','SubState','-p','MemoryHigh','-p','MemoryMax','-p','TasksMax','-p','ControlGroup','-p','ExecStart'])
    run.command(['sha256sum','/opt/pliego/current/pliego-backend-0.1.0-SNAPSHOT.jar', KIT/'staging.env', ROOT/'perf/k6/seed.sql', '/etc/postgresql/18/main/conf.d/99-pliego.conf'])
    run.command(['journalctl','--unit','pliego','--since',a_since(run),'--no-pager','-o','short-iso-precise'])
    if not run.apply:
        print('PLAN capture mainPID /proc/status, cgroup memory.{events,stat,current,high,max,pressure}, cpu.stat and pressure; jcmd VM.flags/command_line/native_memory; preserve fatal files and postmaster logs')
        return
    pid = int(subprocess.check_output(['systemctl','show','pliego','-p','MainPID','--value'],text=True,env=SAFE).strip())
    require(pid > 0, 'Backend exited; capacity run invalid')
    cg = subprocess.check_output(['systemctl','show','pliego','-p','ControlGroup','--value'],text=True,env=SAFE).strip()
    cgpath = Path('/sys/fs/cgroup') / cg.lstrip('/')
    require(cgpath.resolve().is_relative_to('/sys/fs/cgroup'), 'Unexpected cgroup path')
    require((cgpath/'memory.high').read_text().strip() == str(1700*1024*1024), 'MemoryHigh is not enforced')
    require((cgpath/'memory.max').read_text().strip() == str(2*1024**3), 'MemoryMax is not enforced')
    for file in ('memory.events','memory.stat','memory.current','memory.high','memory.max','memory.pressure','cpu.stat','cpu.pressure'):
        run.command(['cat',cgpath/file])
    for file in ('status','limits','cgroup','cmdline'):
        run.command(['cat',f'/proc/{pid}/{file}'])
    for file in ('memory','cpu','io'):
        run.command(['cat',f'/proc/pressure/{file}'])
    for command in ('VM.flags','VM.command_line','VM.native_memory summary'):
        run.command(['runuser','-u','pliego','--','/opt/temurin25/bin/jcmd',str(pid),*command.split()],check=not command.startswith('VM.native_memory'))
    # Exit status zero can still say "Native memory tracking is not enabled".
    run.write(run.out/'nmt-limitation.txt', 'NMT is unavailable unless already enabled. No JVM flags were added. Read raw VM.native_memory result; unavailable is not a zero-byte summary.\n')
    fatal_sources = [Path(f'/proc/{pid}/root/tmp'),Path('/opt/pliego/current')]
    private = list(Path('/tmp').glob('systemd-private-*-pliego.service-*/tmp'))
    fatal_sources += private
    run.write(run.out/'private-tmp-paths.json', json.dumps([str(p) for p in fatal_sources]))
    for folder in fatal_sources:
        for pattern in ('hs_err_pid*.log','replay_pid*.log'):
            for file in folder.glob(pattern):
                shutil.copy2(file,run.out/file.name)
    if a.duration:
        root_tmp=fatal_sources[0]
        root_stat=root_tmp.stat()
        verified_host=[path for path in private if (path.stat().st_dev,path.stat().st_ino)==(root_stat.st_dev,root_stat.st_ino)]
        watch=verified_host[0] if verified_host else root_tmp
        run.write(run.out/'fatal-path-scope.txt', 'inode-verified host-visible PrivateTmp path: '+str(watch)+'\n' if verified_host else 'Host-visible PrivateTmp path unavailable; /proc fallback open directory may survive unlink but discovery path disappears on PID exit. Capture remains best-effort.\n')
        sample_window(run, a, pid, cgpath, watch)

    run.command(['journalctl','--unit','postgresql@18-main','--since',a_since(run),'--no-pager'])
    # Read-only safety checks occur after load, outside the timed samples.
    run.command(['runuser','-u','postgres','--','psql','-X','-v','ON_ERROR_STOP=1','-p','55468','-d','pliego_benchmark','-c',
                 "BEGIN READ ONLY; SELECT 'flyway',count(*),max(version) FROM public.flyway_schema_history WHERE success; SELECT 'factura',estado,count(*) FROM pliego.factura GROUP BY estado; SELECT 'pago',estado,count(*) FROM pliego.pago GROUP BY estado; SELECT 'artifacts',count(*) FROM pliego.factura_archivo; SELECT 'mail',estado,count(*) FROM pliego.correo_outbox GROUP BY estado; ROLLBACK;"])

    logs = Path('/var/log/postgresql')
    for file in logs.glob('postgresql-18-main.log'):
        shutil.copy2(file,run.out/file.name)
    scan = '\n'.join(p.read_text(errors='replace') for p in run.out.glob('*.log'))
    require(not re.search(r'SIGSEGV|SIGBUS|fatal error.*Java|MultiXact.*(?:error|invalid)|PANIC:|invalid page|could not access status of transaction|apparent wraparound', scan,re.I), 'Native/database instability detected; preserve evidence and stop')
    require(not any(run.out.glob('hs_err_pid*.log')), 'Native crash artifact detected')


def sample_window(run, a, pid, cgpath, fatal_dir):
    baseline = dict(line.split() for line in (cgpath/'memory.events').read_text().splitlines())
    original_ticks = Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[19]
    original_restarts = subprocess.check_output(['systemctl','show','pliego','-p','NRestarts','--value'],env=SAFE,text=True).strip()
    children = []
    handles = []
    commands = []
    for name,argv in [('pidstat',['pidstat','-h','-r','-u','-d','-p',str(pid),'5']),
                      ('vmstat',['vmstat','5']),
                      ('fatal-collector',['python3',str(ROOT/'perf/jvm/fatal-collector.py'),'--watch',str(fatal_dir),'--out',str(run.out/'fatal-live'),'--seconds',str(a.duration+10)])]:
        handle = (run.out/(name+'.txt')).open('w'); handles.append(handle)
        children.append(subprocess.Popen(argv,env=SAFE,stdout=handle,stderr=subprocess.STDOUT));commands.append(argv)
    try:
        for _ in range(50):
            if (run.out/'fatal-live/ready.json').exists(): break
            require(children[-1].poll() is None,'Fatal collector failed')
            time.sleep(.1)
        require((run.out/'fatal-live/ready.json').exists(),'Fatal collector not ready')
        (run.out/'scrapes').mkdir()
        started=time.monotonic(); sample=0
        run.write(run.out/'ready.json',json.dumps({'pid':pid,'cgroup':str(cgpath),'private_tmp':str(fatal_dir),'duration':a.duration}))
        while time.monotonic()-started<a.duration and not (a.stop_file and a.stop_file.exists()):
            current_ticks=Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[19]
            require(current_ticks==original_ticks,'JVM disappeared or PID reused')
            restarts=subprocess.check_output(['systemctl','show','pliego','-p','NRestarts','--value'],env=SAFE,text=True).strip()
            require(restarts==original_restarts,'JVM restarted; stop load')
            require(all(child.poll() is None for child in children),'A required sampler exited')
            events=dict(line.split() for line in (cgpath/'memory.events').read_text().splitlines())
            require(all(int(events.get(k,0))==int(baseline.get(k,0)) for k in ('oom','oom_kill','oom_group_kill')), 'Cgroup OOM occurred')
            point={'utc':datetime.datetime.now(datetime.UTC).isoformat(),'pid':pid,'memory_events':events}
            for name in ('memory.stat','memory.current','memory.high','memory.max','memory.pressure','cpu.stat','cpu.pressure'):
                point[name]=(cgpath/name).read_text()
            for name in ('memory','cpu','io'):point['host_'+name]=Path('/proc/pressure',name).read_text()
            with (run.out/'samples.jsonl').open('a') as stream: stream.write(json.dumps(point)+'\n')
            scrape = subprocess.run(['curl','--fail','--silent','--show-error','--max-time','4','--max-redirs','0','--noproxy','*','http://127.0.0.1:8081/actuator/prometheus'],env=SAFE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            require(scrape.returncode==0 and b'jvm_threads_live_threads' in scrape.stdout, 'Prometheus scrape failed')
            (run.out/'scrapes'/f'{sample:05d}.prom').write_bytes(scrape.stdout)
            require(not any((run.out/'fatal-live').glob('hs_err_pid*.log')),'Fatal JVM artifact observed')
            log=Path('/var/log/postgresql/postgresql-18-main.log').read_text(errors='replace')
            require(not re.search(r'MultiXact.*(?:error|invalid)|PANIC:|invalid page|could not access status of transaction|apparent wraparound',log,re.I),'Database integrity error observed')
            sample+=1
            # Cadence is measured from loop start, not after a possibly slow scrape.
            delay=started+sample*5-time.monotonic()
            if delay>0:time.sleep(delay)
        require(sample>0,'Observer captured no samples')
    finally:
        for child,command in zip(children,commands):
            child.terminate()
            try: rc=child.wait(timeout=10)
            except subprocess.TimeoutExpired:child.kill();rc=child.wait()
            with (run.out/'commands.jsonl').open('a') as stream:
                stream.write(json.dumps({'command':shlex.join(command),'exit_status':rc,'stop_reason':'observer stop; SIGTERM expected','executed':True})+'\n')
        for handle in handles:handle.close()
        # Always save journal on sampler failure, even if PrivateTmp was removed.
        run.command(['journalctl','--unit','pliego','--since','-2 hours','--no-pager','-o','short-iso-precise'],check=False)
        pglog=Path('/var/log/postgresql/postgresql-18-main.log')
        if pglog.is_file():shutil.copy2(pglog,run.out/pglog.name)


def a_since(run):
    return run.out.parent.joinpath('matrix-start.utc').read_text().strip() if run.out.parent.joinpath('matrix-start.utc').exists() else '-2 hours'


def ssh_base(a,r):
    require(a.known_hosts is not None, 'Apply requires out-of-band verified known_hosts')
    result = subprocess.check_output(['ssh-keygen','-lf',str(a.known_hosts)],text=True,env=SAFE)
    require(r['ssh_host_fingerprint'] in result.split(), 'known_hosts fingerprint mismatch')
    # Disable personal SSH config, agent forwarding, proxies, password fallback.
    return ['ssh','-F','/dev/null','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',f'UserKnownHostsFile={Path(a.known_hosts).resolve()}','-o','ForwardAgent=no','-o','ConnectTimeout=10',f'{a.ssh_user}@{r["target_ipv4"]}']


def matrix(a,r,run):
    base = f'http://{r["target_ipv4"]}:80'
    if a.apply:
        require(os.environ.get('RUN_STAGING') == '1', 'RUN_STAGING=1 required')
        host_identity(r,generator=True)
        ssh = ssh_base(a,r)
        require(a.fixtures and Path(a.fixtures).is_file(), 'Synthetic fixtures required')
    else:
        ssh = ['ssh','<strict-out-of-band-known-hosts>',f'{a.ssh_user}@{r["target_ipv4"]}']
    (run.out/'matrix-start.utc').write_text(datetime.datetime.now(datetime.UTC).isoformat())
    (run.out/'isolated-record.json').write_text(json.dumps(r,indent=2))
    if a.fixtures:(run.out/'fixtures-sha256.txt').write_text(sha(a.fixtures)+'  fixtures.json\n')
    files = [ROOT/'perf/k6'/p for p in ('journeys.js','checkout-weighted.js','target-guard.js','seed.sql')]
    (run.out/'suite-sha256.txt').write_text(''.join(sha(p)+'  '+str(p.relative_to(ROOT))+'\n' for p in files))
    original_pid = None
    original_restart = None
    for label, vus, hold, sse in MATRIX:
        case = run.out/label
        case.mkdir()
        remote_out = f'/var/lib/pliego-staging-evidence/{run.out.name}-{label}'
        stopfile = remote_out+'/stop'
        remote = ['sudo','python3','/opt/pliego/staging-repo/deploy/staging/staging.py','capture','--apply','--record','/etc/pliego-staging.json','--out',remote_out,
                  '--expected-machine-id',r['target_machine_id'],'--expected-target-vm-id',r['target_vm_id'],
                  '--duration','900','--stop-file',stopfile]
        sampler = None
        sampler_log = None
        if a.apply:
            state = subprocess.check_output([*ssh, "systemctl show pliego -p MainPID -p NRestarts"],env=SAFE,text=True)
            values = dict(line.split('=',1) for line in state.splitlines() if '=' in line)
            pid, restarts = values['MainPID'],values['NRestarts']
            require(pid != '0','Backend stopped')
            if original_pid is None: original_pid,original_restart = pid,restarts
            require((pid,restarts)==(original_pid,original_restart),'JVM exit/restart invalidates matrix')
            sampler_log = (case/'remote-capture.log').open('w')
            sampler_argv = [*ssh,shlex.join(remote)]
            sampler = subprocess.Popen(sampler_argv,env=SAFE,stdout=sampler_log,stderr=subprocess.STDOUT)
            # Poll until the original process + cgroups + collectors are verified.
            ready = False
            for _ in range(40):
                if sampler.poll() is not None: break
                probe = subprocess.run([*ssh,'sudo test -f '+shlex.quote(remote_out+'/ready.json')],env=SAFE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                if probe.returncode == 0: ready = True; break
                time.sleep(.5)
            if not ready:
                run.command([*ssh,'sudo touch '+shlex.quote(stopfile)],check=False)
                try:sampler.wait(timeout=15)
                except subprocess.TimeoutExpired:sampler.terminate();sampler.wait(timeout=5)
                sampler_log.close()
                raise RuntimeError('Target sampler not ready; load refused')

        else:
            run.command([*ssh,shlex.join(remote)])
        env = {**SAFE,'BENCHMARK_DISPOSABLE':'1','BENCHMARK_STAGING':'1','BENCHMARK_ALLOWED_HOSTS':r['target_ipv4'],
               'BASE_URL':base,'VUS':str(vus),'HOLD':hold,'SSE':'1' if sse else '0','SSE_DURATION':'660s',
               'FIXTURES':str(Path(a.fixtures).resolve()) if a.fixtures else '<synthetic-fixtures.json>',
               'SUMMARY':str(case/'summary.json'),'K6_NO_USAGE_REPORT':'true','K6_NO_COLOR':'true'}
        (case/'invocation.json').write_text(json.dumps({'env':env,'suite_sha256':sha(ROOT/'perf/k6/journeys.js')},indent=2))
        (case/'k6-config.json').write_text('{}\n')
        try:
            load_argv = ['k6','run','--config',str(case/'k6-config.json'),'--out',f'json={case}/raw.json',str(ROOT/'perf/k6/journeys.js')]
            if a.apply:
                with (case/'k6.log').open('w') as load_log:
                    load = subprocess.Popen(load_argv,env=env,stdout=load_log,stderr=subprocess.STDOUT)
                    while load.poll() is None:
                        if sampler.poll() is not None:
                            load.terminate()
                            try: load.wait(timeout=10)
                            except subprocess.TimeoutExpired:load.kill();load.wait()
                            break
                        time.sleep(.5)
                    status={'exit_status':load.returncode}
                with (run.out/'commands.jsonl').open('a') as log:
                    log.write(json.dumps({'command':shlex.join(load_argv),'exit_status':load.returncode,'log':str(case/'k6.log'),'executed':True})+'\n')
            else:
                status=run.command(load_argv,env=env,check=False)

        finally:
            if sampler is not None:
                run.command([*ssh,'sudo touch '+shlex.quote(stopfile)],check=False)
                rc = sampler.wait(timeout=45)
                sampler_log.close()
                with (run.out/'commands.jsonl').open('a') as log:
                    log.write(json.dumps({'command':shlex.join(sampler_argv),'exit_status':rc,'log':str(case/'remote-capture.log'),'executed':True})+'\n')
                require(rc==0,'Target observer/native/stability failure; matrix stopped')
        if a.apply:
            state = subprocess.check_output([*ssh, "systemctl show pliego -p MainPID -p NRestarts"],env=SAFE,text=True)
            values = dict(line.split('=',1) for line in state.splitlines() if '=' in line)
            require((values['MainPID'],values['NRestarts'])==(original_pid,original_restart),'JVM exit/restart invalidates matrix')
            require(status['exit_status']==0,'k6 threshold/runtime failure; matrix stopped')
    print('Matrix plan/run ended. Retrieve root-only target evidence with approved SSH; reconcile raw k6 group counts and thresholds. Real acceptance additionally requires sampler + no native/PG failure.')


def teardown(a,r,run):
    if a.apply:
        require(os.environ.get('DESTROY_STAGING') == '1','DESTROY_STAGING=1 required')
        host_identity(r)
        require(json.loads(Path('/etc/pliego-staging.json').read_text())==r,'Installed identity differs')
    for service in ('pliego','nginx','postgresql@18-main'):
        run.command(['systemctl','stop',service])
    print('Archive private evidence + checksums through approved SSH. Destroy BOTH recorded VM IDs and disks/snapshots in provider console; confirm billing end. This script deliberately never calls a provider API. VM deletion is required; filesystem unlink is not secure erase on SSD/cloud volumes.')


def cleanup_bootstrap_trust(a,run):
    if a.apply and (run.out/'bootstrap-trust-open').exists():
        run.write('/etc/postgresql/18/main/pg_hba.conf', 'local all postgres peer\nhost pliego_benchmark pliego_app 127.0.0.1/32 scram-sha-256\n', 0o640)
        results=[]
        for command in (['chown','postgres:postgres','/etc/postgresql/18/main/pg_hba.conf'],
                        ['systemctl','reload','postgresql@18-main'],
                        ['systemctl','stop','pliego'],['systemctl','stop','postgresql@18-main']):
            results.append(run.command(command,check=False))
        # A failed reload can leave in-memory trust live; PostgreSQL is stopped too.
        # Keep the marker if any recovery command fails, for explicit operator audit.
        require(all(result['exit_status']==0 for result in results), 'Bootstrap cleanup incomplete; trust marker retained. Verify restrictive HBA and PostgreSQL stopped before destroying this isolated VM')
        (run.out/'bootstrap-trust-open').unlink()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=('bootstrap','run-matrix','capture','teardown'))
    p.add_argument('--apply',action='store_true',help='Execute on explicitly identified isolated host; defaults dry-run')
    p.add_argument('--record',type=Path,default=KIT/'isolated-record.example.json')
    p.add_argument('--out',type=Path,required=True,help='Fresh private evidence directory (never historical audit)')
    p.add_argument('--artifacts',type=Path,default=Path('/var/tmp/pliego-staging-artifacts'))
    p.add_argument('--pins',type=Path)
    p.add_argument('--fixtures',type=Path)
    p.add_argument('--known-hosts',type=Path)
    p.add_argument('--ssh-user',default='staging')
    p.add_argument('--duration',type=int,default=0,help='Target capture window, seconds; stops early when --stop-file exists')
    p.add_argument('--stop-file',type=Path)
    p.add_argument('--expected-machine-id')
    p.add_argument('--expected-target-vm-id')
    a=p.parse_args()
    # No action, including evidence creation, is allowed in the completed audit tree.
    require(not a.out.resolve().is_relative_to(ROOT/'.release-evidence/2026-11-04-vps-audit'), 'Completed audit is read-only')
    require(re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}',a.ssh_user), 'Invalid SSH Unix username')
    r=load_record(a.record,a.apply)
    if a.action=='capture' and a.apply:
        require(a.duration == 0 or 1 <= a.duration <= 10800, 'Capture duration must be <=3h')
        if a.expected_machine_id: require(a.expected_machine_id == r['target_machine_id'], 'Remote target machine differs from generator record')
        if a.expected_target_vm_id: require(a.expected_target_vm_id == r['target_vm_id'], 'Remote VM differs from generator record')
        host_identity(r)
        require(json.loads(Path('/etc/pliego-staging.json').read_text())==r,'Installed identity differs')
    run=Runner(a.out,a.apply)
    if a.action=='bootstrap':
        try: bootstrap(a,r,run)
        finally: cleanup_bootstrap_trust(a,run)
    elif a.action=='run-matrix': matrix(a,r,run)
    elif a.action=='capture': local_capture(run,a)
    else: teardown(a,r,run)

if __name__=='__main__':
    try: main()
    except (ValueError,RuntimeError,KeyError,OSError,subprocess.SubprocessError) as error:
        print('REFUSED/FAILED: '+str(error),file=sys.stderr)
        sys.exit(1)
