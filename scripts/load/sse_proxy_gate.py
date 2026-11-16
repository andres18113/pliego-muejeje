#!/usr/bin/env python3
"""Real PostgreSQL18/backend/nginx SSE evidence, restricted to disposable local ports.

Run from repository root with PLIEGO_TEST_DISPOSABLE_DB=1 and --jar PATH. Downloads/extracts
Ubuntu nginx1.24 without installing it. All private artifacts go under --work;
no production endpoint, existing local cluster or external mail/R2 is used.
"""
import argparse, base64, hashlib, hmac, http.client, json, math, os, pathlib, signal
import socket, subprocess, threading, time, traceback, urllib.request, uuid

ROOT=pathlib.Path(__file__).resolve().parents[2]
PG=pathlib.Path('/usr/lib/postgresql/18/bin')
EVENTS='/api/v1/auth/events'
ORIGIN='https://pliegolibros.com'
DEB='https://archive.ubuntu.com/ubuntu/pool/main/n/nginx/nginx_1.24.0-2ubuntu7.19_amd64.deb'
BACKEND_PORT=18083
PROXY_PORTS=(18085,18086)
CPUS=(2,3)
EVIDENCE=ROOT/'.release-evidence'/'2026-11-03'/'proxy'

class Stream:
 def __init__(self, gate, port, cookie, label, cursor=None):
  self.gate=gate; self.label=label; self.start=time.monotonic_ns(); self.start_epoch_ns=time.time_ns(); self.first=None
  self.events=[]; self.lines=[]; self.bytes=[]; self.done=threading.Event(); self.error=None; self.eof=None
  gate.streams.append(self)
  self.connection=http.client.HTTPConnection('127.0.0.1',port,timeout=85)
  headers=gate.headers(cookie)
  if cursor is not None:headers['Last-Event-ID']=str(cursor)
  self.connection.request('GET',EVENTS,headers=headers)
  self.response=self.connection.getresponse();self.header_items=self.response.getheaders(); self.headers=dict(self.header_items);self.headers_ns=time.monotonic_ns()
  self.status=self.response.status
  if self.status!=200:raise AssertionError(f'{label}: expected200, got{self.status}: {self.response.read()}')
  assert self.response.getheader('Content-Type').startswith('text/event-stream')
  assert self.response.getheader('Content-Encoding') is None
  assert self.response.getheader('Cache-Control')=='no-cache'
  assert self.response.getheader('Access-Control-Allow-Origin')==ORIGIN
  assert self.response.getheader('Access-Control-Allow-Credentials')=='true'
  self.thread=threading.Thread(target=self.read,daemon=True); self.thread.start()
 def read(self):
  line=bytearray(); fields={}
  try:
   while True:
    b=self.response.read(1); now=time.monotonic_ns()
    if not b:break
    if self.first is None:self.first=now
    self.bytes.append([now,b.hex()]); line.extend(b)
    if b!=b'\n':continue
    value=line.decode().rstrip('\r\n');line.clear(); self.lines.append((now,value))
    if not value:
     if 'event' in fields:self.events.append({'at_ns':now,'at_epoch_ns':time.time_ns(),**fields})
     fields={}
    elif ':' in value:
     key,val=value.split(':',1); fields[key]=val.lstrip()
  except Exception as error:self.error=type(error).__name__+': '+str(error)
  finally:
   self.eof=time.monotonic_ns(); self.done.set(); self.save()
 def save(self):
  record={'status':self.status,'headers':self.headers,'header_items':self.header_items,'start_ns':self.start,'start_epoch_ns':self.start_epoch_ns,'headers_ns':self.headers_ns,'first_ns':self.first,'eof_ns':self.eof,'error':self.error,'lines':self.lines,'events':self.events,'bytes':self.bytes,'byte_semantics':'Decoded HTTP response payload, one monotonic timestamp per byte; not a packet or transfer-framing capture'}
  (self.gate.work/(self.label+'.wire.json')).write_text(json.dumps(record,indent=2))
  (self.gate.work/(self.label+'.sse')).write_bytes(b''.join(bytes.fromhex(value) for _,value in self.bytes))
 def event(self, predicate=lambda e:True, timeout=10):
  until=time.monotonic()+timeout
  while time.monotonic()<until:
   found=next((e for e in self.events if predicate(e)),None)
   if found:return found
   if self.done.is_set():raise AssertionError(f'{self.label}: stream ended before expected event ({self.error})')
   time.sleep(.005)
  raise AssertionError(self.label+': expected event deadline exceeded')
 def close(self):
  if not self.done.is_set():self.gate.results.setdefault('client_close_requests',[]).append({'label':self.label,'epoch_ns':time.time_ns()})
  if self.connection.sock:
   try:self.connection.sock.shutdown(socket.SHUT_RDWR)
   except OSError:pass
  self.connection.close(); self.done.wait(2); self.save()

class Gate:
 def __init__(self,args):
  if os.environ.get('PLIEGO_TEST_DISPOSABLE_DB')!='1':raise SystemExit('Explicit PLIEGO_TEST_DISPOSABLE_DB=1 required')
  self.work=args.work.resolve()
  if not self.work.is_relative_to(EVIDENCE.resolve()) or self.work==EVIDENCE.resolve():raise SystemExit('Work directory must be a fresh child of '+str(EVIDENCE))
  self.work.mkdir(mode=0o700,parents=True,exist_ok=False)
  (self.work/'harness-owner').write_text('pliego-sse-proxy-gate-v2\n')
  os.chmod(self.work,0o700)
  self.java=getattr(args,'java_bin',None) or pathlib.Path('/usr/lib/jvm/java-25-openjdk-amd64/bin/java')
  self.java=pathlib.Path(self.java).resolve(strict=True)
  self.jar=args.jar.resolve(strict=True); self.processes=[];self.streams=[];self.app=None;self.nginx=None;self.cluster=False
  (self.work/'tmp').mkdir(mode=0o700)
  self.env={key:os.environ[key] for key in ('PATH','HOME','USER','LOGNAME','LANG','LC_ALL') if key in os.environ}
  self.env.update({'TMPDIR':str(self.work/'tmp'),'PGHOST':'127.0.0.1','PGPORT':'55538','PGUSER':'postgres','PGDATABASE':'pliego_sse_proxy','PLIEGO_TEST_DISPOSABLE_DB':'1'})
  self.results={'requested_backend_base':'c81892227c3d5b160838af309f9fb99c671fc2f4','observed_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'jar_sha256':hashlib.sha256(self.jar.read_bytes()).hexdigest(),'jar':str(self.jar),'cpus':list(CPUS),'ports':{'postgres':55538,'backend':BACKEND_PORT,'baseline':PROXY_PORTS[0],'dedicated':PROXY_PORTS[1]},'checks':{},'work':str(self.work)}
  self.results['backend_worktree_diff_sha256']=hashlib.sha256(subprocess.check_output(['git','diff','HEAD','--','backend/src'],cwd=ROOT)).hexdigest()
  for name in ('sse_proxy_gate.py','sse_proxy_native.mjs'):
   source=(ROOT/'scripts'/'load'/name).read_bytes();(self.work/name).write_bytes(source);self.results.setdefault('harness_sha256',{})[name]=hashlib.sha256(source).hexdigest()
  self.results['stripped_environment_override_names']=sorted(key for key in os.environ if key.startswith(('PG','PLIEGO_','SPRING_')) or key in ('JAVA_TOOL_OPTIONS','JDK_JAVA_OPTIONS','_JAVA_OPTIONS'))
  self.results['child_environment_policy']='Whitelist PATH/HOME/USER/LOGNAME/LANG/LC_ALL, then owned TMPDIR/PG/PLIEGO values; inherited provider, Spring, JVM and database options excluded'
  self.results['java_bin']=str(self.java)
  self.results['java_version']=subprocess.check_output([str(self.java),'-version'],stderr=subprocess.STDOUT,text=True).strip()
  if not set(CPUS).issubset(os.sched_getaffinity(0)):raise SystemExit('Test CPU affinity unavailable')
  if any(self.listening(p) for p in (55538,BACKEND_PORT,*PROXY_PORTS)):raise SystemExit('Disposable test port already in use')
  self.results['environment']={'postgres_version':subprocess.check_output([PG/'postgres','--version'],text=True).strip(),'uname':list(os.uname()),'lscpu':subprocess.check_output(['lscpu'],text=True),'no_memory_cgroup_limit_imposed':True,'loopback_http_only':True,'mail_enabled':False,'r2_enabled':False}
  self.save()
 def listening(self,port):
  with socket.socket() as s:return s.connect_ex(('127.0.0.1',port))==0
 def run(self,cmd,label,env=None,input=None):
  if input is not None:(self.work/(label+'.input.sql')).write_text(input)
  result=subprocess.run(list(map(str,cmd)),input=input,text=True,capture_output=True,env=env or self.env,cwd=ROOT)
  (self.work/(label+'.log')).write_text(result.stdout+result.stderr)
  if result.returncode:raise RuntimeError(f'{label} failed; inspect private artifact')
  return result.stdout.strip()
 def sql(self,sql,label='sql-last'):
  return self.run([PG/'psql','-X','-h','127.0.0.1','-p','55538','-U','postgres','-d','pliego_sse_proxy','-At','-v','ON_ERROR_STOP=1','-f','-'],label,input=sql)
 def launch(self,cmd,label,env=None):
  log=(self.work/(label+'.log')).open('w')
  p=subprocess.Popen(['taskset','-c',','.join(map(str,CPUS)),*map(str,cmd)],cwd=self.work,env=env or self.env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  log.close();self.processes.append(p);self.results.setdefault('processes',[]).append({'label':label,'pid':p.pid});self.save();return p
 def stop(self,p):
  if p and p.poll() is None:
   os.killpg(p.pid,signal.SIGCONT);os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=45)
   except subprocess.TimeoutExpired:
    self.results.setdefault('cleanup_forced_kills',[]).append({'pid':p.pid,'wait_seconds':45})
    os.killpg(p.pid,signal.SIGKILL);p.wait()
 def setup(self):
  self.run([PG/'initdb','-D',self.work/'data','-U','postgres','--auth-local=trust','--auth-host=trust','--no-locale','-E','UTF8'],'initdb')
  # TCP only avoids the Unix socket path limit in retained evidence directories.
  with (self.work/'data'/'postgresql.conf').open('a') as conf:conf.write("\nport=55538\nlisten_addresses='127.0.0.1'\nunix_socket_directories=''\nmax_connections=30\n")
  self.run(['taskset','-c',','.join(map(str,CPUS)),PG/'pg_ctl','-D',self.work/'data','-l',self.work/'postgres.log','-w','start'],'cluster-start');self.cluster=True
  exists=self.run([PG/'psql','-h','127.0.0.1','-p','55538','-U','postgres','-d','postgres','-At','-c',"SELECT 1 FROM pg_database WHERE datname='pliego_sse_proxy'"],'database-check')
  if not exists:self.run([PG/'createdb','-h','127.0.0.1','-p','55538','-U','postgres','pliego_sse_proxy'],'createdb')
  self.sql("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_owner') THEN CREATE ROLE pliego_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='pliego_app') THEN CREATE ROLE pliego_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$; ALTER DATABASE pliego_sse_proxy OWNER TO pliego_owner; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT pliego_owner TO pliego_app;",'roles')
  self.appenv={**self.env,'PLIEGO_DB_URL':'jdbc:postgresql://127.0.0.1:55538/pliego_sse_proxy','PLIEGO_DB_USERNAME':'pliego_app','PLIEGO_DB_PASSWORD':base64.urlsafe_b64encode(os.urandom(24)).decode(),'PLIEGO_ADMIN_EMAIL':'proxy-bootstrap@example.invalid','PLIEGO_ADMIN_PASSWORD_HASH':'fixture-not-usable','PLIEGO_JWT_SECRET':base64.urlsafe_b64encode(os.urandom(48)).decode(),'PLIEGO_MAIL_ENABLED':'false','PLIEGO_R2_ENABLED':'false','PLIEGO_CORS_ALLOWED_ORIGINS':ORIGIN}
  self.start_app('backend-migrate');self.stop(self.app)
  doc=(ROOT/'docs/deployment/production-runbook.md').read_text()
  cleanup=doc.split('-- BEGIN PLIEGO_RUNTIME_ACL_CLEANUP_SQL',1)[1].split('-- END PLIEGO_RUNTIME_ACL_CLEANUP_SQL',1)[0]
  self.sql(cleanup,'runtime-cleanup')
  self.results['runtime_privileges']=self.sql("SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,pg_has_role('pliego_app','pliego_owner','MEMBER'),has_schema_privilege('pliego_app','pliego','CREATE') FROM pg_roles WHERE rolname='pliego_app';",'runtime-privileges')
  assert self.results['runtime_privileges']=='f|f|f|f|f|f'
  self.start_app('backend-runtime');self.start_nginx()
 def start_app(self,label):
  self.app=self.launch([self.java,'-Xms256m','-Xmx1280m','-Djava.io.tmpdir='+str(self.work/'tmp'),'-XX:ErrorFile='+str(self.work/'hs_err_pid%p.log'),'-jar',self.jar,'--server.address=127.0.0.1','--server.port='+str(BACKEND_PORT),'--spring.datasource.hikari.maximum-pool-size=8','--spring.datasource.hikari.minimum-idle=2'],label,self.appenv)
  until=time.monotonic()+100
  while time.monotonic()<until:
   if self.app.poll() is not None:raise RuntimeError(label+' exited; inspect log')
   try:
    c=http.client.HTTPConnection('127.0.0.1',BACKEND_PORT,timeout=2);c.request('GET','/api/v1/catalog/editions');r=c.getresponse();r.read();c.close()
    if r.status==200:return
   except OSError:pass
   time.sleep(.25)
  raise RuntimeError('backend startup deadline exceeded')
 def start_nginx(self):
  dependencies=EVIDENCE/'dependencies';dependencies.mkdir(mode=0o700,parents=True,exist_ok=True)
  binary=dependencies/'nginx-root'/'usr'/'sbin'/'nginx'
  if not binary.exists():
   urllib.request.urlretrieve(DEB,dependencies/'nginx.deb')
   self.run(['dpkg-deb','-x',dependencies/'nginx.deb',dependencies/'nginx-root'],'nginx-extract')
  self.results['nginx_deb_url']=DEB;self.results['nginx_deb_sha256']=hashlib.sha256((dependencies/'nginx.deb').read_bytes()).hexdigest()
  self.run(['dpkg-deb','-f',dependencies/'nginx.deb','Package','Version','Architecture'],'nginx-package')
  self.run([binary,'-V'],'nginx-version')
  version=(self.work/'nginx-version.log').read_text()
  assert 'nginx/1.24.0 (Ubuntu)' in version
  headers='''proxy_pass http://127.0.0.1:18083;
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
 proxy_read_timeout 30s;'''
  root_location='location / { default_type text/plain; '+headers+' }'
  exact='location = /api/v1/auth/events { default_type text/plain; '+headers+' proxy_buffering off; proxy_cache off; gzip off; }'
  conf=f'''worker_processes 2;
error_log {self.work}/nginx-error.log info;
pid {self.work}/nginx.pid;
events {{ worker_connections 768; }}
http {{
 log_format probe '$msec $server_port $request_method $uri $status cursor=$http_last_event_id probe=$arg_probe duration=$request_time upstream=$upstream_response_time';
 access_log {self.work}/nginx-access.log probe;
 client_body_temp_path {self.work}/body;
 proxy_temp_path {self.work}/proxy;
 fastcgi_temp_path {self.work}/fastcgi;
 uwsgi_temp_path {self.work}/uwsgi;
 scgi_temp_path {self.work}/scgi;
 gzip on;
 server {{ listen 127.0.0.1:18085; server_name api.pliegolibros.com; {root_location} }}
 server {{ listen 127.0.0.1:18086; server_name api.pliegolibros.com; {exact} {root_location} }}
}}'''
  (self.work/'nginx.conf').write_text(conf)
  self.run([binary,'-p',str(self.work)+'/', '-c',self.work/'nginx.conf','-t'],'nginx-test')
  self.run([binary,'-p',str(self.work)+'/', '-c',self.work/'nginx.conf','-T'],'nginx-effective')
  self.nginx=self.launch([binary,'-p',str(self.work)+'/', '-c',self.work/'nginx.conf','-g','daemon off;'],'nginx-master')
  until=time.monotonic()+5
  while not all(self.listening(p) for p in PROXY_PORTS):
   assert time.monotonic()<until;time.sleep(.05)
 def headers(self,cookie=None):
  h={'Host':'api.pliegolibros.com','Origin':ORIGIN,'Accept':'text/event-stream','Accept-Encoding':'gzip','CF-Connecting-IP':'198.51.100.77'}
  if cookie is not None:h['Cookie']='pliego_session='+cookie
  return h
 def actor(self,label,admin=False):
  suffix=uuid.uuid4().hex
  uid=int(self.sql(f"CALL pliego.sp_customer_register('sse-{suffix}@example.invalid','fixture-hash','Cliente','Proxy',NULL,NULL,NULL,NULL)",label+'-register').split('|')[0])
  if admin:self.sql(f"UPDATE pliego.usuario SET rol='ADMIN' WHERE usuario_id={uid}",label+'-admin')
  cookie=base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=');digest=hashlib.sha256(cookie.encode()).hexdigest()
  self.sql(f"UPDATE pliego.usuario SET email_verificado_en=clock_timestamp() WHERE usuario_id={uid};SELECT pliego.fn_auth_session_create_checked({uid},'{digest}',clock_timestamp()+interval '1 day','fixture-hash');",label+'-session')
  return {'uid':uid,'cookie':cookie,'digest':digest}
 def request(self,port,cookie=None,method='GET',extra=None):
  c=http.client.HTTPConnection('127.0.0.1',port,timeout=8);h=self.headers(cookie);h.update(extra or {})
  c.request(method,EVENTS,headers=h);r=c.getresponse();body=r.read().decode();items=r.getheaders();result={'status':r.status,'headers':dict(items),'header_items':items,'body':body};c.close();return result
 def bearer(self,actor):
  encoded=lambda value:base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).rstrip(b'=')
  now=int(time.time());signed=encoded({'alg':'HS256','typ':'JWT'})+b'.'+encoded({'iss':'pliego','aud':'pliego-api','sub':str(actor),'role':'CUSTOMER','iat':now,'exp':now+1800,'jti':str(uuid.uuid4())})
  signature=base64.urlsafe_b64encode(hmac.new(self.appenv['PLIEGO_JWT_SECRET'].encode(),signed,hashlib.sha256).digest()).rstrip(b'=')
  return (signed+b'.'+signature).decode()
 def auth(self):
  result={}
  self.results['checks']['authorization']=result
  for port in PROXY_PORTS:
   checks={}
   result[str(port)]=checks
   for label,cookie in [('absent',None),('invalid','!invalid'),('invalid-shaped','A'*43)]:
    response=self.request(port,cookie);assert response['status']==401;self.problem(response,'AUTH_REQUIRED');checks[label]=response
   response=self.request(port,None,extra={'Authorization':'Bearer fixture-invalid-token'})
   assert response['status']==401;checks['invalid-bearer-without-cookie']=response
   a=self.actor(f'cap-{port}')
   response=self.request(port,None,extra={'Authorization':'Bearer '+self.bearer(a['uid'])})
   checks['valid-bearer-without-cookie']=response;assert response['status']==401;self.problem(response,'AUTH_REQUIRED')
   opened=[Stream(self,port,a['cookie'],f'cap-{port}-{i}') for i in range(4)]
   for stream in opened:stream.event()
   leases=int(self.sql(f"SELECT count(*) FROM pliego.realtime_connection WHERE user_id={a['uid']}",f'lease-count-{port}').splitlines()[-1]);assert leases==4;checks['admitted_lease_count']=leases
   response=self.request(port,a['cookie']);assert response['status']==429 and response['headers']['Retry-After']=='60';self.problem(response,'REALTIME_CONNECTION_LIMITED');checks['fifth']=response
   for cursor in ('-1','invalid','9223372036854775808'):
    response=self.request(port,a['cookie'],extra={'Last-Event-ID':cursor});assert response['status']==400;self.problem(response,'VALIDATION_ERROR');checks['cursor-'+cursor]=response
   revoked_at=time.monotonic_ns();self.sql(f"SELECT pliego.fn_auth_session_revoke('{a['digest']}')",f'revoke-{port}')
   for stream in opened:assert stream.done.wait(6)
   checks['revocation_close_ms']=[(s.eof-revoked_at)/1e6 for s in opened]
   response=self.request(port,a['cookie']);assert response['status']==401;self.problem(response,'AUTH_REQUIRED');checks['revoked']=response
   remaining=int(self.sql(f"SELECT count(*) FROM pliego.realtime_connection WHERE user_id={a['uid']}",f'lease-cleanup-{port}').splitlines()[-1])
   assert remaining==0
   cookie=base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=');digest=hashlib.sha256(cookie.encode()).hexdigest()
   self.sql(f"SELECT pliego.fn_auth_session_create_checked({a['uid']},'{digest}',clock_timestamp()+interval '1 day','fixture-hash')",f'reuse-session-{port}')
   reused=Stream(self,port,cookie,f'lease-reuse-{port}');reused.event()
   self.sql(f"SELECT pliego.fn_auth_session_revoke('{digest}')",f'reuse-revoke-{port}');assert reused.done.wait(6)
   checks['lease_cleanup_and_readmission']={'remaining_leases_after_revoke':remaining,'new_session_admitted':True}
   response=self.request(port,None,'OPTIONS',{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Last-Event-ID'})
   assert response['status']==200 and response['headers']['Access-Control-Allow-Origin']==ORIGIN and response['headers']['Access-Control-Allow-Credentials']=='true' and 'last-event-id' in response['headers']['Access-Control-Allow-Headers'].lower()
   checks['cors_preflight']=response
   checks['cors_rejected']={}
   for method in ('OPTIONS','GET'):
    denied=self.request(port,a['cookie'],method,{'Origin':'https://untrusted.example.invalid','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Last-Event-ID'})
    assert denied['status']==403 and 'Access-Control-Allow-Origin' not in denied['headers']
    checks['cors_rejected'][method]=denied
   result[str(port)]=checks
  self.results['checks']['authorization']=result;self.save();print('Authorization/CORS/cap/revocation passed',flush=True)
 def problem(self,response,code):
  headers=response['headers'];body=json.loads(response['body'])
  assert headers['Content-Type'].startswith('application/problem+json')
  assert body['code']==code and body['status']==response['status']
  assert headers['Access-Control-Allow-Origin']==ORIGIN and headers['Access-Control-Allow-Credentials']=='true'
  assert 'retry-after' in headers['Access-Control-Expose-Headers'].lower()
  assert body['title'] and body['detail']
 def isolation(self):
  actors=[self.actor('scope-a'),self.actor('scope-b'),self.actor('scope-admin',admin=True)]
  observed={}
  for port in PROXY_PORTS:
   streams=[Stream(self,port,a['cookie'],f'isolation-{port}-{index}') for index,a in enumerate(actors)]
   for stream in streams:stream.event(lambda event:event['event']=='resync')
   self.sql('BEGIN;'+''.join(f"SELECT pliego.fn_realtime_enqueue({a['uid'] if i<2 else 'NULL'},{'false' if i<2 else 'true'},'order.changed','order','{800000+i}');" for i,a in enumerate(actors))+'COMMIT;',f'isolation-{port}-commit')
   for index,stream in enumerate(streams):
    event=stream.event(lambda event:event['event']=='order.changed')
    assert json.loads(event['data'])=={'resourceType':'order','resourceId':str(800000+index)}
   time.sleep(2.2)
   observed[str(port)]=[]
   for index,stream in enumerate(streams):
    received=[json.loads(e['data'])['resourceId'] for e in stream.events if e['event']=='order.changed']
    assert received==[str(800000+index)]
    observed[str(port)].append({'role':'ADMIN' if index==2 else 'CUSTOMER','received_resource_ids':received})
    stream.close()
  self.results['checks']['scope_isolation']=observed;self.save();print('Customer A/B and admin scope isolation passed through both proxies',flush=True)
 def healthy(self):
  actors=[self.actor('healthy-'+str(p)) for p in PROXY_PORTS]
  streams=[Stream(self,p,a['cookie'],'healthy-'+str(p)) for p,a in zip(PROXY_PORTS,actors)]
  lifecycle=list(streams)
  initials=[s.event(lambda e:e['event']=='resync') for s in streams]
  assert all(s.lines[0][1]=='retry:3000' and s.lines[1][1]==':heartbeat' for s in streams)
  nativeactors=[self.actor('native-'+str(p)) for p in PROXY_PORTS]
  fixture=self.work/'native-fixture.json';fixture.write_text(json.dumps([{'port':p,'cookie':a['cookie']} for p,a in zip(PROXY_PORTS,nativeactors)]));os.chmod(fixture,0o600)
  native=self.launch(['node',ROOT/'scripts/load/sse_proxy_native.mjs',fixture,self.work/'native-results.json',self.work/'nginx-access.log'],'native-browser')
  samples=[[],[]]
  for n in range(24):
   resource=str(700000+n)
   sql='BEGIN;'+''.join(f"SELECT pliego.fn_realtime_enqueue({a['uid']},false,'order.changed','order','{resource}');" for a in actors)+"SELECT 'pre|'||extract(epoch from clock_timestamp());COMMIT;SELECT 'post|'||extract(epoch from clock_timestamp());"
   # A transaction's actual commit lies between these two DB timestamps.
   # The local client and DB share a host clock; retain both latency bounds.
   out=self.sql(sql,'healthy-commit-'+str(n))
   pre_commit=float(next(line.split('|')[1] for line in out.splitlines() if line.startswith('pre|')))
   post_commit=float(next(line.split('|')[1] for line in out.splitlines() if line.startswith('post|')))
   for i,stream in enumerate(streams):
    predicate=lambda e:e['event']=='order.changed' and json.loads(e['data'])['resourceId']==resource
    try:event=stream.event(predicate)
    except AssertionError:
     if not stream.done.is_set():raise
     # The 60s lifecycle is independent of the latency sample count. Resume
     # explicitly if a natural close lands between this commit and delivery.
     cursor=stream.events[-1]['id'];stream=Stream(self,PROXY_PORTS[i],actors[i]['cookie'],f'healthy-reconnect-{i}-{n}',cursor);streams[i]=stream
     event=stream.event(predicate)
    lower=max(0,(event['at_epoch_ns']/1e9-post_commit)*1000)
    upper=(event['at_epoch_ns']/1e9-pre_commit)*1000
    assert 0<=lower<=upper<6000
    samples[i].append({'resourceId':resource,'pre_commit_epoch':pre_commit,'post_commit_epoch':post_commit,'commit_bracket_ms':(post_commit-pre_commit)*1000,'received_monotonic_ns':event['at_ns'],'received_epoch_ns':event['at_epoch_ns'],'latency_lower_ms':lower,'latency_upper_ms':upper,'id':event['id']})
   if n%6==5:print(f'Healthy delivery {n+1}/24 per proxy',flush=True)
  resume=[]
  for p,a,initial in zip(PROXY_PORTS,actors,initials):
   s=Stream(self,p,a['cookie'],'resume-'+str(p),initial['id'])
   received=[]
   for n in range(24):received.append(s.event(lambda e,n=n:e['event']=='order.changed' and json.loads(e['data'])['resourceId']==str(700000+n)))
   assert [e['id'] for e in received]==[x['id'] for x in samples[0 if p==PROXY_PORTS[0] else 1]]
   assert not any(e['event']=='resync' for e in s.events)
   resume.append({'port':p,'lastEventId':initial['id'],'count':len(received),'ordered_exactly':True});s.close()
  result={}
  for i,(p,s) in enumerate(zip(PROXY_PORTS,lifecycle)):
   assert s.done.wait(65)
   lifetime=(s.eof-s.start)/1e9;assert 59<=lifetime<=63
   beats=[t for t,value in s.lines if value==':heartbeat']; gaps=[(b-a)/1e9 for a,b in zip(beats,beats[1:])]
   assert len(beats)>=4 and max(gaps)<=17 and (s.eof-beats[-1])/1e9<=17
   assert s.error is None
   first_byte_ms=(s.first-s.start)/1e6;assert first_byte_ms<2000
   quantiles={}
   for name in ('lower','upper'):
    ordered=sorted(x['latency_'+name+'_ms'] for x in samples[i])
    quantiles[name]={f'p{q}':ordered[math.ceil(q/100*len(ordered))-1] for q in (50,95,99)}
   result[str(p)]={'first_byte_ms':first_byte_ms,'lifetime_seconds':lifetime,'heartbeat_count':len(beats),'heartbeat_gaps_seconds':gaps,'sample_count':len(samples[i]),'commit_to_client_latency_bounds_ms':quantiles,'samples':samples[i],'gzip':False,'headers':s.headers}
  self.results['checks']['healthy']=result;self.save()
  native.wait(timeout=80);assert native.returncode==0,'Native browser probe failed; inspect private log'
  result['native']=json.loads((self.work/'native-results.json').read_text());result['resume']=resume
  self.results['checks']['healthy']=result;self.save();print('Healthy30s timeout, 60s lifetime, native retry3000, cursor replay passed',flush=True)
 def stall(self):
  a=self.actor('stalled');streams=[Stream(self,p,a['cookie'],'stall-'+str(p)) for p in PROXY_PORTS]
  for s in streams:s.event()
  # Freeze just after a measured periodic heartbeat, following the initial one.
  until=time.monotonic()+18
  while any(sum(value==':heartbeat' for _,value in s.lines)<2 for s in streams):assert time.monotonic()<until;time.sleep(.01)
  frozen=time.monotonic_ns();frozen_epoch=time.time_ns();self.app.send_signal(signal.SIGSTOP)
  try:
   for s in streams:assert s.done.wait(34),'Read timeout did not terminate stalled stream'
   while (time.monotonic_ns()-frozen)/1e9<33:time.sleep(.05)
  finally:self.app.send_signal(signal.SIGCONT)
  resumed_epoch=time.time_ns()
  result={}
  for p,s in zip(PROXY_PORTS,streams):
   since=(s.eof-s.bytes[-1][0])/1e9
   assert 29<=since<=33 and s.error and 'IncompleteRead' in s.error
   result[str(p)]={'last_byte_to_close_seconds':since,'sigstop_to_close_seconds':(s.eof-frozen)/1e9,'wire_error':s.error}
  self.results['checks']['stall']={'proxies':result,'frozen_epoch_ns':frozen_epoch,'resumed_epoch_ns':resumed_epoch};self.save();print('SIGSTOP33s: both nginx30s read timeouts terminated response as expected',flush=True)
 def save(self):(self.work/'results.json').write_text(json.dumps(self.results,indent=2))
 def cleanup(self):
  for stream in self.streams:
   if hasattr(stream,'response'):stream.close()
  for p in reversed(self.processes):self.stop(p)
  if self.cluster:self.run([PG/'pg_ctl','-D',self.work/'data','-m','fast','-w','stop'],'cluster-stop')
  runtime=self.work/'backend-runtime.log'
  if runtime.exists():
   lines=runtime.read_text().splitlines()
   self.results['backend_log_review']={'exception_handler_failure_lines':[line for line in lines if 'Failure in @ExceptionHandler' in line],'realtime_publish_failed_count':sum('realtime state=PUBLISH_FAILED' in line for line in lines),'warn_error_lines':[line for line in lines if ' WARN ' in line or ' ERROR ' in line]}
  self.results['all_processes_stopped']=not any(self.listening(p) for p in (55538,BACKEND_PORT,*PROXY_PORTS));self.save()

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--jar',type=pathlib.Path,required=True);parser.add_argument('--java-bin',type=pathlib.Path);parser.add_argument('--work',type=pathlib.Path,default=EVIDENCE/('run-'+time.strftime('%H%M%S')+'-'+uuid.uuid4().hex[:6]));args=parser.parse_args()
 gate=Gate(args)
 try:
  gate.setup();gate.auth();gate.isolation();gate.healthy();gate.stall();gate.results['verdict']='PASS for measured local nginx SSE transport with 30s read timeout; production not tested';gate.save()
 except BaseException as error:
  gate.results['verdict']='FAIL';gate.results['failure']={'type':type(error).__name__,'message':str(error)};(gate.work/'failure.txt').write_text(traceback.format_exc());gate.save();raise
 finally:gate.cleanup()
 print('Proxy gate passed; private evidence: '+str(gate.work),flush=True)
if __name__=='__main__':main()
