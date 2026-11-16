#!/usr/bin/env python3
"""Observe an existing staging JVM without changing its flags or service config."""
import argparse, datetime, gzip, hashlib, ipaddress, json, os, pathlib, re, shutil, subprocess, time, urllib.parse, urllib.request

def validate_management(url):
 u=urllib.parse.urlsplit(url)
 try: loopback=ipaddress.ip_address(u.hostname or '').is_loopback
 except ValueError: loopback=False
 if not (u.scheme=='http' and loopback and u.port and not u.username and not u.password and u.path=='/actuator/prometheus' and not u.query and not u.fragment): raise ValueError('management must be an explicit HTTP loopback literal /actuator/prometheus URL')

def validate_jit(flags):
 if re.search(r'-Xint\b|-XX:(?:TieredStopAtLevel=|CompileCommand(?:File)?=|CompilerDirectivesFile=|[-](?:TieredCompilation|UseCompiler)|CICompilerCount=1\b)',flags): raise ValueError('compiler diagnostic/workaround flags cannot qualify normal JIT')

def validate_scrape(data):
 if not all(re.search(rb'^'+name+rb'(?:\{|\s)',data,re.M) for name in [b'process_uptime_seconds',b'jvm_threads_live_threads']): raise ValueError('required JVM metrics absent')

def memory_failures(before,after):
 return [name for name in ('oom','oom_kill','oom_group_kill') if after.get(name,0)>before.get(name,0)]

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): raise ValueError('management redirect refused')

def read(path):
 try:return pathlib.Path(path).read_text()
 except OSError as e:return 'UNAVAILABLE: '+str(e)

def events(path):
 return {k:int(v) for k,v in (line.split() for line in pathlib.Path(path).read_text().splitlines())}

def process_identity(pid):
 # pid reuse guard; comm can contain spaces/parentheses.
 return pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[19]

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--pid',type=int,required=True);p.add_argument('--management-url',default='http://127.0.0.1:8081/actuator/prometheus');p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--fatal-dir',type=pathlib.Path,required=True);p.add_argument('--jcmd',type=pathlib.Path,required=True);p.add_argument('--duration',type=int,default=7500);p.add_argument('--interval',type=int,default=2);p.add_argument('--staging-only',action='store_true',required=True);a=p.parse_args()
 validate_management(a.management_url)
 if a.duration<7200 or not 1<=a.interval<=5: p.error('duration >=7200 seconds and interval 1..5 required')
 if not a.fatal_dir.is_dir():p.error('fatal directory must exist')
 a.out.mkdir(parents=True,exist_ok=False);os.chmod(a.out,0o700);(a.out/'scrapes').mkdir();(a.out/'fatal').mkdir();identity=process_identity(a.pid)
 baseline={str(x): (x.stat().st_mtime_ns,x.stat().st_size) for pattern in ['hs_err_pid*.log','replay_pid*.log'] for x in a.fatal_dir.glob(pattern)}
 commandline=pathlib.Path(f'/proc/{a.pid}/cmdline').read_bytes().replace(b'\0',b' ').decode();validate_jit(commandline)
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 failures=[];commands=[]
 def jcmd(what,label):
  cmd=[str(a.jcmd.resolve()),str(a.pid),*what];start=datetime.datetime.now(datetime.timezone.utc).isoformat()
  try:q=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=20);rc=q.returncode;out=q.stdout
  except subprocess.TimeoutExpired:rc=124;out='jcmd timed out'
  (a.out/(label+'.txt')).write_text(out);commands.append({'argv':cmd,'start':start,'exit_status':rc});(a.out/'commands.json').write_text(json.dumps(commands,indent=2));return rc,out
 rc,vmflags=jcmd(['VM.flags','-all'],'vm-flags-start')
 if rc:raise RuntimeError('VM.flags capture failed')
 validate_jit(vmflags)
 if re.search(r'\b(?:UseCompiler|TieredCompilation)\s*:?=\s*false',vmflags) or re.search(r'TieredStopAtLevel\s*:?=\s*[0123]\b',vmflags): raise ValueError('effective flags lack normal tiered C2 JIT')
 nmt=bool(re.search(r'NativeMemoryTracking\s*:?=\s*(?:summary|detail)',vmflags));jcmd(['VM.version'],'vm-version');jcmd(['VM.command_line'],'vm-command-line')
 if nmt:jcmd(['VM.native_memory','summary'],'nmt-start')
 cgline=next((line[3:] for line in pathlib.Path(f'/proc/{a.pid}/cgroup').read_text().splitlines() if line.startswith('0::')),None)
 if cgline is None:raise RuntimeError('cgroup v2 required for staging memory evidence')
 cg=pathlib.Path('/sys/fs/cgroup')/cgline.lstrip('/');before=events(cg/'memory.events')
 for name in ['memory.high','memory.max','memory.events','memory.stat','pids.max','cpu.max']:(a.out/(name+'-start.txt')).write_text(read(cg/name))
 high=read(cg/'memory.high').strip();maximum=read(cg/'memory.max').strip()
 if high!=str(1700*1024*1024) or maximum!=str(2*1024*1024*1024):raise ValueError('staging cgroup must enforce MemoryHigh=1700M and MemoryMax=2G')
 manifest={'pid':a.pid,'process_start_ticks':identity,'commandline':commandline,'duration_seconds':a.duration,'interval_seconds':a.interval,'management_url':a.management_url,'nmt_enabled':nmt,'start_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'staging_only':True,'normal_jit':True}
 (a.out/'manifest.json').write_text(json.dumps(manifest,indent=2));started=time.monotonic();samples=0;last_nmt=started;last_scrape=started
 try:
  while time.monotonic()-started<a.duration:
   tick=time.monotonic()
   if process_identity(a.pid)!=identity:raise RuntimeError('JVM exited or PID reused')
   with opener.open(a.management_url,timeout=min(a.interval,5)) as response:
    if response.status!=200:raise RuntimeError('scrape HTTP status '+str(response.status))
    body=response.read(16*1024*1024+1)
   if len(body)>16*1024*1024:raise RuntimeError('scrape exceeds16MiB bound')
   validate_scrape(body);now=time.monotonic()
   if samples and now-last_scrape>5.5:raise RuntimeError('scrape gap exceeds 5.5s')
   last_scrape=now
   with gzip.open(a.out/'scrapes'/f'{samples:06}.prom.gz','wb') as f:f.write(body)
   for pattern in ['hs_err_pid*.log','replay_pid*.log']:
    for x in a.fatal_dir.glob(pattern):
     if baseline.get(str(x))!=(x.stat().st_mtime_ns,x.stat().st_size):
      shutil.copy2(x,a.out/'fatal'/x.name);failures.append('native JVM evidence: '+x.name)
   snapshot={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsed':now-started,'proc_status':read(f'/proc/{a.pid}/status'),'proc_stat':read(f'/proc/{a.pid}/stat'),'meminfo':read('/proc/meminfo'),'vmstat':read('/proc/vmstat'),'pressure':{n:read('/proc/pressure/'+n) for n in ['cpu','memory','io']},'cgroup':{n:read(cg/n) for n in ['memory.events','memory.stat','memory.current','memory.pressure','cpu.stat']}}
   with (a.out/'samples.jsonl').open('a') as f:f.write(json.dumps(snapshot)+'\n')
   failures.extend(memory_failures(before,events(cg/'memory.events')));samples+=1
   if samples==1:(a.out/'ready.json').write_text(json.dumps({'utc':snapshot['utc'],'pid':a.pid}))
   if failures:break
   # Capture NMT outside the frequent scrape critical path; long jcmd can invalidate the gap gate.
   if nmt and now-last_nmt>=600:jcmd(['VM.native_memory','summary'],f'nmt-{samples}');last_nmt=now
   time.sleep(max(0,a.interval-(time.monotonic()-tick)))
 except Exception as e:failures.append(str(e))
 for pattern in ['hs_err_pid*.log','replay_pid*.log']:
  for x in a.fatal_dir.glob(pattern):
   if baseline.get(str(x))!=(x.stat().st_mtime_ns,x.stat().st_size):shutil.copy2(x,a.out/'fatal'/x.name);failures.append('native JVM evidence: '+x.name)
 rc,code=jcmd(['Compiler.codelist'],'compiler-codelist-end')
 if rc or not re.search(r'^\d+\s+4\s+\d+\s+io\.micrometer\.prometheusmetrics\.PrometheusMeterRegistry\.lambda\$addDistributionStatisticSamples\$0',code,re.M):failures.append('no level4 Prometheus export lambda captured; inspect codelist')
 if nmt:jcmd(['VM.native_memory','summary'],'nmt-end')
 (a.out/'memory.events-end.txt').write_text(read(cg/'memory.events'))
 elapsed=time.monotonic()-started
 if elapsed<a.duration:failures.append('incomplete requested observation duration')
 result={'status':'FAIL' if failures else 'OBSERVATION_PASS_PENDING_LOAD_AND_DB_REVIEW','failures':sorted(set(failures)),'samples':samples,'elapsed_seconds':elapsed,'end_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'load_qualification':'separate >=2h 15VU k6 evidence + database native-error/log and service restart review required'}
 (a.out/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));return 1 if failures else 0
if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as e:print('FAIL: '+str(e));raise SystemExit(2)
