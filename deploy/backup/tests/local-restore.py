#!/usr/bin/env python3
"""Container-free PG18 + pinned Moto S3 end-to-end drill. Disposable local data only.
Requires --runtime and --evidence (new paths below .release-evidence),
--moto installed locally, a Java25 binary, and a built PLIEGO JAR. No production contact.
"""
import argparse,datetime,hashlib,http.client,json,os,pathlib,shlex,shutil,subprocess,sys,time,urllib.request,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--runtime',type=pathlib.Path,required=True)
parser.add_argument('--evidence',type=pathlib.Path,required=True)
parser.add_argument('--moto',type=pathlib.Path,required=True)
parser.add_argument('--java',type=pathlib.Path,required=True)
parser.add_argument('--jar',type=pathlib.Path,default=ROOT/'backend/target/pliego-backend-0.1.0-SNAPSHOT.jar')
a=parser.parse_args(); W=a.runtime.resolve(); E=a.evidence.resolve()
assert W.is_relative_to(ROOT/'.release-evidence/2026-11-05-gaps') and not W.exists()
assert E.is_relative_to(ROOT/'.release-evidence/2026-11-05-gaps') and not E.exists()
W.mkdir(mode=0o700); E.mkdir(parents=True,mode=0o700)
PG=pathlib.Path('/usr/lib/postgresql/18/bin'); tools=ROOT/'deploy/backup'; children=[]; clusters=[]
env={'PATH':str(PG)+':/usr/bin:/bin','HOME':str(W),'LANG':'C.UTF-8','TZ':'UTC','NO_PROXY':'127.0.0.1,localhost','no_proxy':'127.0.0.1,localhost'}
seq=0

def run(cmd,name,*,extra=None,input=None,expected=0):
 global seq
 seq+=1; log=E/f'{seq:03}-{name}.log'; start=time.monotonic()
 e=env.copy(); e.update(extra or {})
 with log.open('w') as f:
  f.write('$ '+shlex.join(map(str,cmd))+'\nCOMMAND_END\n'); f.flush()
  p=subprocess.run(list(map(str,cmd)),env=e,cwd=ROOT,input=input,text=True,stdout=f,stderr=subprocess.STDOUT)
  f.write(f'\nEXIT_STATUS={p.returncode}\n')
 item={'command':shlex.join(map(str,cmd)),'exit_status':p.returncode,'expected':expected,'duration_seconds':round(time.monotonic()-start,3),'log':str(log.relative_to(ROOT))}
 with (E/'commands.jsonl').open('a') as f:f.write(json.dumps(item)+'\n')
 if expected=='nonzero':assert p.returncode!=0,item
 else:assert p.returncode==expected,item
 print(name,p.returncode,flush=True)
 return log.read_text().split('\nCOMMAND_END\n',1)[1].rsplit('\nEXIT_STATUS=',1)[0],item

def launch(cmd,name,extra=None):
 e=env.copy();e.update(extra or {}); log=(E/f'{name}.log').open('w')
 log.write('$ '+shlex.join(map(str,cmd))+'\n');log.flush()
 p=subprocess.Popen(list(map(str,cmd)),env=e,cwd=W,stdout=log,stderr=subprocess.STDOUT);children.append((p,log,name));return p

def sql(query,name,port=55481,user='postgres',db='pliego_benchmark'):
 return run([PG/'psql','-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U',user,'-d',db,'-At','-c',query],name)[0].strip()

def psql_file(path,name,port=55481,user='postgres',db='pliego_benchmark'):
 return run([PG/'psql','-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U',user,'-d',db,'-f',path],name)

def http_ready(port,path,process):
 deadline=time.monotonic()+100
 while time.monotonic()<deadline:
  assert process.poll() is None, f'Server exited: {process.returncode}'
  try:
   c=http.client.HTTPConnection('127.0.0.1',port,timeout=2);c.request('GET',path);r=c.getresponse();r.read();c.close()
   if r.status==200:return
  except OSError:pass
  time.sleep(.5)
 raise AssertionError('Server readiness timed out')

def snapshot(port,user,label):
 tables=json.loads(sql("SELECT json_agg(n.nspname||'.'||c.relname ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('pliego','public');",label+'-tables',port,user))
 rows={}
 for t in tables:
  # Sorted canonical JSON content digest, independent of heap order; includes duplicates.
  q=f"SELECT json_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(x,E'\\n' ORDER BY x),''),'UTF8')),'hex')) FROM (SELECT row_to_json(t)::text x FROM {t} t) d;"
  rows[t]=json.loads(sql(q,label+'-table-'+t,port,user))
 (E/f'{label}-tables.json').write_text(json.dumps(rows,indent=2)+'\n')
 aclq="""SELECT json_build_object('roles',(SELECT json_agg(r ORDER BY rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig FROM pg_roles WHERE rolname LIKE 'pliego%') r),
 'memberships',(SELECT json_agg(r ORDER BY role_name,member_name) FROM (SELECT pr.rolname role_name,pm.rolname member_name,admin_option,inherit_option,set_option FROM pg_auth_members m JOIN pg_roles pr ON pr.oid=m.roleid JOIN pg_roles pm ON pm.oid=m.member WHERE pr.rolname LIKE 'pliego%' OR pm.rolname LIKE 'pliego%') r),
 'relations',(SELECT json_agg(r ORDER BY schema_name,relname) FROM (SELECT n.nspname schema_name,c.relname,c.relkind,pg_get_userbyid(c.relowner) owner,ARRAY(SELECT x::text FROM unnest(c.relacl) x ORDER BY x::text) acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('pliego','public')) r),
 'database',(SELECT json_build_object('owner',pg_get_userbyid(datdba),'acl',ARRAY(SELECT x::text FROM unnest(datacl) x ORDER BY x::text)) FROM pg_database WHERE datname=current_database()),
 'schemas',(SELECT json_agg(r ORDER BY nspname) FROM (SELECT nspname,pg_get_userbyid(nspowner) owner,ARRAY(SELECT x::text FROM unnest(nspacl) x ORDER BY x::text) acl FROM pg_namespace WHERE nspname IN ('pliego','public')) r),
 'routines',(SELECT json_agg(r ORDER BY proname,args) FROM (SELECT proname,pg_get_function_identity_arguments(p.oid) args,pg_get_userbyid(proowner) owner,ARRAY(SELECT x::text FROM unnest(proacl) x ORDER BY x::text) acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pliego') r),
 'default_acls',(SELECT json_agg(r ORDER BY role_name,schema_name,defaclobjtype) FROM (SELECT pg_get_userbyid(defaclrole) role_name,n.nspname schema_name,defaclobjtype,ARRAY(SELECT x::text FROM unnest(defaclacl) x ORDER BY x::text) acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace) r));"""
 acls=json.loads(sql(aclq,label+'-acl',port,user)); (E/f'{label}-acl.json').write_text(json.dumps(acls,indent=2)+'\n')
 seqs=json.loads(sql("SELECT json_agg(r ORDER BY schemaname,sequencename) FROM (SELECT schemaname,sequencename,last_value FROM pg_sequences WHERE schemaname IN ('pliego','public')) r",label+'-sequences',port,user));(E/f'{label}-sequences.json').write_text(json.dumps(seqs,indent=2)+'\n')
 return rows,acls,seqs

try:
 run([PG/'postgres','--version'],'pg-version');run([a.java,'-version'],'java-version');run([a.moto.parent/'python','-c','import importlib.metadata; print(importlib.metadata.version("moto"))'],'s3-version')
 # Freeze copies: runtime never uses mutable previous-audit files.
 jar=W/'backend.jar';shutil.copy2(a.jar,jar);libs=W/'libs';libs.mkdir()
 with zipfile.ZipFile(jar) as z:
  for name in z.namelist():
   if name.startswith('BOOT-INF/lib/') and name.endswith('.jar'):(libs/pathlib.Path(name).name).write_bytes(z.read(name))
 (E/'jar.sha256').write_text(hashlib.sha256(jar.read_bytes()).hexdigest()+'\n')
 migrations=W/'migration';shutil.copytree(ROOT/'backend/src/main/resources/db/migration',migrations)
 (E/'migrations.sha256').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(migrations.glob('*.sql'))))
 for name,port,user in [('source',55481,'postgres'),('target',55482,'restore_admin')]:
  data=W/name;socket=W/(name+'-socket');socket.mkdir()
  run([PG/'initdb','-D',data,'-U',user,'-A','trust','--locale=C.UTF-8','--encoding=UTF8'],name+'-initdb')
  with (data/'postgresql.conf').open('a') as f:f.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\nunix_socket_directories='{socket}'\n")
  run([PG/'pg_ctl','-D',data,'-l',E/(name+'-postgres.log'),'-w','start'],name+'-start');clusters.append(data)
 run([PG/'createdb','-h','127.0.0.1','-p','55481','-U','postgres','pliego_benchmark'],'source-createdb')
 sql("CREATE ROLE pliego_owner NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; CREATE ROLE pliego_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; ALTER DATABASE pliego_benchmark OWNER TO pliego_owner; ALTER SCHEMA public OWNER TO pliego_owner; GRANT CONNECT ON DATABASE pliego_benchmark TO pliego_app; GRANT pliego_owner TO pliego_app;",'runtime-roles')
 appenv={'PLIEGO_DB_URL':'jdbc:postgresql://127.0.0.1:55481/pliego_benchmark','PLIEGO_DB_USERNAME':'pliego_app','PLIEGO_DB_PASSWORD':'local-synthetic-only','PLIEGO_ADMIN_EMAIL':'perf-admin@example.invalid','PLIEGO_ADMIN_PASSWORD_HASH':'unused-synthetic-admin','PLIEGO_JWT_SECRET':'ws1-local-synthetic-jwt-only-abcdefghijklmnopqrstuvwxyz-0123456789','PLIEGO_BILLING_ENABLED':'false','PLIEGO_HOME_DELIVERY_SCHEDULER_ENABLED':'false','PLIEGO_MAIL_ENABLED':'false','PLIEGO_R2_ENABLED':'false'}
 run([a.java,'--class-path',str(libs/'*'),ROOT/'scripts/LocalFlyway.java',migrations],'flyway-migrate',extra=appenv)
 cleanup=(ROOT/'docs/deployment/production-runbook.md').read_text().split('-- BEGIN PLIEGO_RUNTIME_ACL_CLEANUP_SQL',1)[1].split('-- END PLIEGO_RUNTIME_ACL_CLEANUP_SQL',1)[0];(W/'runtime-cleanup.sql').write_text(cleanup);psql_file(W/'runtime-cleanup.sql','runtime-cleanup')
 seed=(ROOT/'perf/k6/seed.sql').read_text().replace("('55464','55465','55466','55467','55468')","('55481')").replace('\\set benchmark_port 55464','\\set benchmark_port 55481');(W/'seed.sql').write_text(seed)
 psql_file(W/'seed.sql','catalog-customers-seed');psql_file(tools/'tests/seed-commerce.sql','commerce-seed')
 versions=json.loads(sql("SELECT json_agg(version::integer ORDER BY version::integer) FROM public.flyway_schema_history WHERE success AND version IS NOT NULL;",'source-flyway-versions'));assert versions==list(range(1,107)),versions
 (E/'flyway-versions.json').write_text(json.dumps(versions)+'\n')
 source=snapshot(55481,'postgres','source')
 # Public-only encryption keyring for backup host; private keys only in drill's offline workstation dir.
 # Short homes keep Unix gpg-agent socket names below Linux sockaddr_un limits.
 off=W/'o';off.mkdir(mode=0o700);wrong=W/'k';wrong.mkdir(mode=0o700)
 for home,uid in [(off,'WS1 Synthetic Restore <restore@example.invalid>'),(wrong,'WS1 Wrong Key <wrong@example.invalid>')]:
  run(['gpg','--batch','--homedir',home,'--pinentry-mode','loopback','--passphrase','','--quick-generate-key',uid,'rsa2048','encr','1d'],'generate-synthetic-key')
 out,_=run(['gpg','--homedir',off,'--with-colons','--list-keys'],'key-fingerprint');fp=next(x.split(':')[9] for x in out.splitlines() if x.startswith('fpr:'))
 pub=W/'public.gpg';run(['gpg','--homedir',off,'--output',pub,'--export',fp],'export-public-key')
 s3=launch([a.moto,'-H','127.0.0.1','-p','19081'],'local-s3');http_ready(19081,'/',s3)
 creds=W/'credentials';creds.mkdir(mode=0o700);(creds/'s3.json').write_text(json.dumps({'access_key':'ws1synthetic','secret_key':'ws1-synthetic-local-only','expires_at':'2099-01-01T00:00:00Z'}));os.chmod(creds/'s3.json',0o600)
 curlcfg=W/'local-curl.conf';curlcfg.write_text('user = "ws1synthetic:ws1-synthetic-local-only"\n');os.chmod(curlcfg,0o600)
 def s3call(method,key,name,file=None,headers=(),expected=0):
  cmd=['curl','--silent','--show-error','--fail-with-body','--noproxy','*','--aws-sigv4','aws:amz:us-east-1:s3','--config',curlcfg,'-H','Content-Type: application/octet-stream','-X',method]
  for h in headers:cmd+=['-H',h]
  if file:cmd+=['--data-binary','@'+str(file)]
  return run(cmd+['http://127.0.0.1:19081/'+key],name,expected=expected)
 s3call('PUT','pliego-db-backups','create-local-bucket',headers=['x-amz-bucket-object-lock-enabled:true'])
 backupenv={'PGHOST':'127.0.0.1','PGPORT':'55481','PGUSER':'postgres','PGDATABASE':'pliego_benchmark','BACKUP_ENDPOINT':'http://127.0.0.1:19081','BACKUP_REGION':'us-east-1','BACKUP_BUCKET':'pliego-db-backups','BACKUP_STATE_DIR':str(W/'state'),'BACKUP_PUBLIC_KEYRING':str(pub),'BACKUP_RECIPIENT':fp,'CREDENTIALS_DIRECTORY':str(creds),'PLIEGO_BACKUP_TEST_LOCAL':'1','BACKUP_TEST_ALL_PREFIXES':'1'}
 _,backup_result=run([tools/'backup.sh'],'backup-encrypt-upload-readback',extra=backupenv)
 receipt=json.loads((W/'state/last-success.json').read_text());key='daily/'+receipt['id']
 restoreenv={**backupenv,'RESTORE_KEY':key,'RESTORE_OUTPUT':str(W/'restored'),'RESTORE_GNUPGHOME':str(off)}
 _,download_result=run([tools/'restore.sh'],'download-verify-decrypt',extra=restoreenv)
 t=time.monotonic();psql_file(W/'restored/globals.sql','restore-globals',55482,'restore_admin','postgres')
 run([PG/'pg_restore','--create','--exit-on-error','-h','127.0.0.1','-p','55482','-U','restore_admin','-d','postgres',W/'restored/database.dump'],'restore-database')
 pgrestore_seconds=time.monotonic()-t
 target=snapshot(55482,'restore_admin','target');assert source==target,'Table/content/role/ACL/sequence mismatch'
 assert sql("SELECT NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AND NOT pg_has_role(r.oid,'pliego_owner','MEMBER') AND NOT has_schema_privilege(r.oid,'pliego','CREATE') AND NOT has_schema_privilege(r.oid,'public','CREATE') AND NOT EXISTS(SELECT FROM pg_class WHERE relowner=r.oid) FROM pg_roles r WHERE rolname='pliego_app';",'restored-runtime-privileges',55482,'restore_admin')=='t'
 (E/'database-comparison.json').write_text(json.dumps({'all_tables_equal':True,'table_count':len(source[0]),'roles_acl_equal':True,'sequences_equal':True,'flyway_versions':len(versions),'total_rows':sum(x['rows'] for x in source[0].values())},indent=2)+'\n')
 targetenv={**appenv,'PLIEGO_DB_URL':'jdbc:postgresql://127.0.0.1:55482/pliego_benchmark'}
 backend=launch([a.java,'-jar',jar,'--server.address=127.0.0.1','--server.port=18081'],'restored-backend',targetenv)
 http_ready(18081,'/api/v1/catalog/editions?page=0&pageSize=20',backend)
 def request(method,path,body=None,headers=None):
  c=http.client.HTTPConnection('127.0.0.1',18081,timeout=20); h=headers or {};h['Content-Type']='application/json'
  c.request(method,path,json.dumps(body) if body is not None else None,h);r=c.getresponse();b=r.read();status=r.status;c.close();return status,json.loads(b) if b else None
 status,catalog=request('GET','/api/v1/catalog/editions?page=0&pageSize=20');assert status==200
 status,login=request('POST','/api/v1/auth/login',{'email':'perf-customer-001@example.invalid','password':'PerfLocal2026!'});assert status==200 and login.get('accessToken')
 status,cart=request('GET','/api/v1/cart',headers={'Authorization':'Bearer '+login['accessToken']});assert status==200
 (E/'backend-smoke.json').write_text(json.dumps({'catalog_status':200,'catalog_has_content':bool(catalog),'login_status':200,'authenticated_cart_status':status,'backend_alive':backend.poll() is None},indent=2)+'\n')
 # Authentication tokens and account bodies deliberately not written to evidence.
 _,badkey=run([tools/'restore.sh'],'negative-wrong-key',extra={**restoreenv,'RESTORE_OUTPUT':str(W/'wrong-key-restore'),'RESTORE_GNUPGHOME':str(wrong)},expected='nonzero')
 # Pull binary to a file with direct curl to avoid recording bytes.
 run(['curl','--silent','--show-error','--fail','--noproxy','*','--aws-sigv4','aws:amz:us-east-1:s3','--config',curlcfg,'--output',W/'cipher-original.gpg','http://127.0.0.1:19081/pliego-db-backups/'+key+'/backup.tar.gpg'],'cipher-file')
 original=(W/'cipher-original.gpg').read_bytes();corrupt=bytearray(original);corrupt[len(corrupt)//2]^=1;(W/'corrupt.gpg').write_bytes(corrupt);(W/'truncated.gpg').write_bytes(original[:len(original)//2])
 for label,file in [('corrupted',W/'corrupt.gpg'),('truncated',W/'truncated.gpg')]:
  s3call('PUT','pliego-db-backups/'+key+'/backup.tar.gpg','inject-'+label,file)
  run([tools/'restore.sh'],'negative-'+label+'-object',extra={**restoreenv,'RESTORE_OUTPUT':str(W/(label+'-restore'))},expected='nonzero')
 s3call('PUT','pliego-db-backups/'+key+'/backup.tar.gpg','restore-original-cipher',W/'cipher-original.gpg')
 # Send fewer bytes than declared to a real local HTTP store and end the client.
 # This checks an interrupted transport, independently of the stored-short-object probe.
 run(['curl','--silent','--show-error','--fail-with-body','--noproxy','*','--max-time','2',
      '--aws-sigv4','aws:amz:us-east-1:s3','--config',curlcfg,'-H','Content-Type: application/octet-stream',
      '-H','Content-Length: '+str(len(original)),'--data-binary','@'+str(W/'truncated.gpg'),
      'http://127.0.0.1:19081/pliego-db-backups/incomplete/interrupted.gpg'],
     'negative-interrupted-upload',expected='nonzero')

 expired=W/'expired-credentials';expired.mkdir(mode=0o700);(expired/'s3.json').write_text(json.dumps({'access_key':'expiredsynthetic','secret_key':'never-valid-local-key','expires_at':'2000-01-01T00:00:00Z'}))
 run([tools/'backup.sh'],'negative-expired-credentials',extra={**backupenv,'CREDENTIALS_DIRECTORY':str(expired)},expected='nonzero')
 run([tools/'freshness.py',W/'state/last-success.json'],'freshness-success')
 stale=W/'stale.json';stale.write_text('{"completed_at":"2000-01-01T00:00:00Z"}')
 run([tools/'freshness.py',stale],'negative-stale-freshness',expected='nonzero')
 run([tools/'freshness.py',W/'missing.json'],'negative-missing-freshness',expected='nonzero')
 # Moto supports S3 Object Lock retention. This is NOT an R2 bucket-lock parity claim.
 retention=W/'retention.xml';retention.write_text('<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>COMPLIANCE</Mode><RetainUntilDate>2099-01-01T00:00:00Z</RetainUntilDate></Retention>')
 s3call('PUT','pliego-db-backups/'+key+'/backup.tar.gpg?retention','set-local-object-retention',retention)
 listing,_=s3call('GET','pliego-db-backups?versions','list-local-versions')
 import xml.etree.ElementTree as ET
 tree=ET.fromstring(listing);ns={'s':tree.tag.split('}',1)[0].lstrip('{')}
 version=next(v.find('s:VersionId',ns).text for v in tree.findall('s:Version',ns) if v.find('s:Key',ns).text==key+'/backup.tar.gpg' and v.find('s:IsLatest',ns).text=='true')
 s3call('DELETE','pliego-db-backups/'+key+'/backup.tar.gpg?versionId='+version,'negative-local-retained-version-delete',expected='nonzero')
 # Record Moto overwrite behavior rather than asserting it has R2 prefix bucket-lock semantics.
 s3call('PUT','pliego-db-backups/'+key+'/backup.tar.gpg','local-versioned-overwrite-probe',W/'corrupt.gpg')
 timing={'backup_seconds':backup_result['duration_seconds'],'encrypted_bytes':receipt['bytes'],'download_verify_decrypt_seconds':download_result['duration_seconds'],'globals_create_pg_restore_seconds':round(pgrestore_seconds,3),'rto_scope':'local archive download through pg_restore; full VPS provisioning and human key retrieval not measured','s3_engine':'Moto 5.1.16','s3_limitations':['Moto does not enforce AWS signature/credential expiration as a real cloud server would; client expiry test only','S3 version retention deletion rejected; overwrite creates new version, unlike R2 prefix bucket-lock refusal','Truncated object simulates short stored upload, not interrupted TCP PUT atomicity']}
 (E/'timings-and-limitations.json').write_text(json.dumps(timing,indent=2)+'\n')
 (E/'PASS').write_text('All assertions completed; read timings-and-limitations.json before interpreting S3 negative tests.\n')
finally:
 for home in (W/'o',W/'k'):
  if home.exists(): run(['gpgconf','--homedir',home,'--kill','gpg-agent'],'stop-synthetic-key-agent')
 for p,f,name in reversed(children):
  if p.poll() is None:p.terminate()
  try:p.wait(timeout=20)
  except subprocess.TimeoutExpired:p.kill();p.wait()
  f.write(f'\nEXIT_STATUS={p.returncode}\n');f.close()
  with (E/'process-exits.jsonl').open('a') as log:log.write(json.dumps({'process':name,'exit_status':p.returncode,'expected_termination':p.returncode in (0,-15,143)})+'\n')
 for data in reversed(clusters):run([PG/'pg_ctl','-D',data,'-m','fast','-w','stop'],data.name+'-stop')
