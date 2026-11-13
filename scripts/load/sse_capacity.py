#!/usr/bin/env python3
"""Disposable, loopback-only SSE capacity/recovery experiments; Python stdlib + JDK25/PG18.

Example: python3 scripts/load/sse_capacity.py --jar backend/target/pliego-backend-0.1.0-SNAPSHOT.jar
Results contain synthetic fixture IDs/timing only. Never targets an existing database.
The output directory must not exist. The script initializes its own PostgreSQL18 cluster.
"""
import argparse, base64, concurrent.futures as cf, csv, hashlib, hmac, http.client, platform
import json, math, os, pathlib, shutil, signal, socket, subprocess, sys, threading, time, uuid

ROOT=pathlib.Path(__file__).resolve().parents[2]

def encoded(x):
    return base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).rstrip(b'=')

def percentiles(values):
    a=sorted(values)
    return {'n':len(a),**{f'p{p}_ms':round(a[min(len(a)-1,math.ceil(p/100*len(a))-1)],3) if a else None for p in (50,95,99)}}

class Stream:
    def __init__(self,run,actor,cursor=None):
        self.actor=actor; self.events=[]; self.frames=[]; self.error=None; self.closed_at=None
        self.connection=http.client.HTTPConnection('127.0.0.1',run.args.http_port,timeout=80)
        headers={'Cookie':'pliego_session='+run.secrets[actor][0],'Accept':'text/event-stream'}
        if cursor is not None: headers['Last-Event-ID']=str(cursor)
        started=time.monotonic()
        self.connection.request('GET','/api/v1/auth/events',headers=headers)
        self.response=self.connection.getresponse(); self.status=self.response.status
        self.opened_at=time.time()
        self.retry_after=self.response.getheader('Retry-After'); self.open_ms=(time.monotonic()-started)*1000
        self.cursor=cursor
        if self.status!=200:
            self.problem=json.loads(self.response.read()); self.connection.close(); return
        self.thread=threading.Thread(target=self.read,daemon=True); self.thread.start()
    def read(self):
        fields={}
        try:
            while True:
                raw=self.response.readline()
                if not raw: break
                line=raw.decode().rstrip('\r\n')
                if not line:
                    if fields:
                        fields['at']=time.time(); self.frames.append(fields)
                        if 'id' in fields:self.cursor=fields['id']
                        if 'event' in fields:self.events.append(fields)
                    fields={}
                elif ':' in line:
                    key,value=line.split(':',1); fields[key]=value.lstrip()
        except Exception as e:self.error=type(e).__name__
        finally:self.closed_at=time.time()
    def close(self):
        try:
            sock=self.connection.sock
            if sock is None and self.response.fp is not None:sock=self.response.fp.raw._sock
            if sock:sock.shutdown(socket.SHUT_RDWR)
        except (OSError,AttributeError):pass
        self.connection.close()
        self.response.close()

class Run:
    def __init__(self,args):
        self.args=args; self.out=pathlib.Path(args.output).resolve(); self.out.mkdir(mode=0o700,parents=True)
        (self.out/'invocation.json').write_text(json.dumps(vars(args),indent=2)+'\n')
        self.tmp=self.out/'runtime-tmp';self.tmp.mkdir(mode=0o700)
        self.harness=self.out/'harness';self.harness.mkdir(mode=0o700)
        for filename in ('sse_capacity.py','sse_capacity_jmx.java','sse_capacity_pg_probe.py','sse_capacity_summarize.py'):
            shutil.copyfile(ROOT/'scripts/load'/filename,self.harness/filename)
        (self.harness/'sha256.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in self.harness.iterdir() if p.is_file()},indent=2)+'\n')
        self.pg=self.out/'pg'; self.pg_running=False; self.backend=None; self.jmx=None
        self.results={}; self.phase='setup'; self.stop=threading.Event(); self.metrics=[]
        self.pg_cpu_seen={};self.pg_cpu_total_ticks=0
        override_names=sorted(k for k in os.environ if k.startswith('SPRING_') or k in ('JDK_JAVA_OPTIONS','_JAVA_OPTIONS','JAVA_TOOL_OPTIONS'))
        (self.out/'inherited-override-names.json').write_text(json.dumps({'removed_names':override_names},indent=2)+'\n')
        clean_env={k:v for k,v in os.environ.items() if k not in override_names}
        self.env={**clean_env,'TMPDIR':str(self.tmp),'TMP':str(self.tmp),'TEMP':str(self.tmp),'PGHOST':'127.0.0.1','PGPORT':str(args.pg_port),'PGUSER':'capacity','PGDATABASE':'capacity',
                  'PLIEGO_TEST_DISPOSABLE_DB':'1','NO_PROXY':'127.0.0.1,localhost','no_proxy':'127.0.0.1,localhost'}
        for key in ('PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGPASSWORD','PGOPTIONS'):
            self.env.pop(key,None)
        self.key=base64.urlsafe_b64encode(os.urandom(48)).decode()
        self.jar=self.out/'backend.jar'; shutil.copyfile(args.jar,self.jar)
        # Readiness polls /v3/api-docs, which production disables; opt in locally.
        self.env['SPRING_PROFILES_INCLUDE']='contract'
        self.env.update(PLIEGO_DB_URL=f'jdbc:postgresql://127.0.0.1:{args.pg_port}/capacity',PLIEGO_DB_USERNAME='capacity',
          PLIEGO_DB_PASSWORD='',PLIEGO_ADMIN_EMAIL='capacity-admin@example.invalid',PLIEGO_ADMIN_PASSWORD_HASH='fixture-hash',
          PLIEGO_JWT_SECRET=self.key,PLIEGO_MAIL_ENABLED='false',PLIEGO_R2_ENABLED='false',PLIEGO_AUTH_COOKIE_SECURE='false')
    def command(self,cmd,**kw):
        kw.setdefault('timeout',90)
        return subprocess.run(list(map(str,cmd)),env=self.env,check=True,capture_output=True,text=True,**kw).stdout.strip()
    def sql(self,sql):return self.command([self.args.pg_bin+'/psql','-X','-v','ON_ERROR_STOP=1','-At','-c',sql])
    def pgctl(self,*args):return self.command(['taskset','-c',self.args.cpus,self.args.pg_bin+'/pg_ctl','-D',self.pg,'-l',self.out/'postgres.log',*args])
    def setup(self):
        self.command([self.args.pg_bin+'/initdb','-D',self.pg,'-A','trust','-U','capacity'])
        (self.pg/'postgresql.conf').open('a').write("\nlisten_addresses='127.0.0.1'\nport="+str(self.args.pg_port)+"\nmax_connections=30\nshared_buffers='128MB'\nshared_preload_libraries='pg_stat_statements'\ntrack_io_timing=on\nunix_socket_directories='"+str(self.out)+"'\n")
        self.pgctl('-l',self.out/'postgres.log','-w','start'); self.pg_running=True
        self.command([self.args.pg_bin+'/createdb','capacity']); self.start_backend()
        self.sql('CREATE EXTENSION pg_stat_statements')
        self.fixture()
        self.metric_thread=threading.Thread(target=self.sample,daemon=True); self.metric_thread.start()
    def start_backend(self):
        generation=len(list(self.out.glob('backend-*.log')))
        log=(self.out/f'backend-{generation}.log').open('w')
        jfr_repo=self.out/f'jfr-repository-{generation}';jfr_repo.mkdir()
        self.backend=subprocess.Popen(['taskset','-c',self.args.cpus,self.args.java_bin,'-Xms256m','-Xmx1280m',
          '-XX:-UsePerfData','-Djava.io.tmpdir='+str(self.tmp),
          '-XX:StartFlightRecording=settings=profile,disk=true,dumponexit=true,maxsize=128m,filename='+str(self.out/f'backend-{generation}.jfr'),
          '-XX:FlightRecorderOptions=repository='+str(jfr_repo),
          '-XX:ErrorFile='+str(self.out/'backend-hs-error-%p.log'),
          '-XX:ReplayDataFile='+str(self.out/'backend-replay-%p.log'),
          '-Xlog:gc*:file='+str(self.out/f'gc-{generation}.log')+':time,uptime,level,tags',
          '-Dcom.sun.management.jmxremote.host=127.0.0.1','-jar',str(self.jar),
          '--server.address=127.0.0.1','--server.port='+str(self.args.http_port),
          '--spring.datasource.hikari.maximum-pool-size=8','--spring.datasource.hikari.minimum-idle=2',
          '--spring.datasource.hikari.register-mbeans=true','--spring.datasource.hikari.pool-name=CapacityPool'],env=self.env,cwd=self.out,stdout=log,stderr=subprocess.STDOUT)
        (self.out/'backend.pid').write_text(str(self.backend.pid))
        for _ in range(120):
            if self.backend.poll() is not None:raise RuntimeError('Backend startup failed; see '+str(log.name))
            try:
                if self.request('/v3/api-docs',None)[0]==200:break
            except (OSError,http.client.HTTPException):pass
            time.sleep(.5)
        else:raise RuntimeError('Backend readiness timeout')
        if self.jmx:self.jmx.terminate();self.jmx.wait(timeout=10)
        self.jmx=subprocess.Popen(['taskset','-c',self.args.cpus,self.args.java_bin,'-XX:-UsePerfData','-Djava.io.tmpdir='+str(self.tmp),'-Xint','-XX:ErrorFile='+str(self.out/'jmx-hs-error.log'),
           '-XX:ReplayDataFile='+str(self.out/'jmx-replay.log'),'--add-modules','jdk.attach',str(self.harness/'sse_capacity_jmx.java'),str(self.backend.pid)],
           env=self.env,cwd=self.out,stdout=(self.out/f'jmx-{generation}.csv').open('w'),stderr=(self.out/f'jmx-{generation}.log').open('w'))
    def fixture(self):
        self.sql("DO $$ DECLARE u BIGINT;c BIGINT;s VARCHAR; BEGIN FOR i IN 1..140 LOOP CALL pliego.sp_customer_register('capacity-'||i||'@example.invalid','fixture-hash','Cliente','Capacidad',NULL,u,c,s); END LOOP; END $$; UPDATE pliego.usuario SET email_verificado_en=clock_timestamp()")
        rows=self.sql("SELECT usuario_id,email_normalizado,rol FROM pliego.usuario ORDER BY usuario_id").splitlines()
        self.actors=[];self.secrets={}; self.roles={}; sql=[]
        for row in rows:
            actor,email,role=row.split('|'); actor=int(actor);self.roles[actor]=role
            if role=='CUSTOMER':self.actors.append(actor)
            else:self.admin=actor
            secret=base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=');digest=hashlib.sha256(secret.encode()).hexdigest()
            self.secrets[actor]=(secret,digest)
            sql.append(f"SELECT pliego.fn_auth_session_create_checked({actor},'{digest}',clock_timestamp()+interval '1 day','fixture-hash')")
        self.sql(';'.join(sql))
        self.sql(f"CALL pliego.sp_customer_billing_identity_register({self.actors[0]},'EC_CEDULA','0912345675')")
        # Reuse the repository's public-routine fixture, on this scratch DB only.
        sys.path.insert(0,str(ROOT/'backend/src/test/postgres18'))
        for key in ('PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGPASSWORD','PGOPTIONS'):os.environ.pop(key,None)
        os.environ.update({k:self.env[k] for k in ('PGHOST','PGPORT','PGUSER','PGDATABASE')})
        from admin_order_concurrency import fixture
        self.order_admin,self.order,self.cancel_order,self.edition=fixture()
        self.roles[self.order_admin]='ADMIN'
        self.order_owner=int(self.sql(f'SELECT c.usuario_id FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE pedido_id={self.order}'))
        address=int(self.sql(f'SELECT direccion_id FROM pliego.direccion d JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={self.order_owner} LIMIT 1'))
        book,publisher=self.sql(f'SELECT libro_id,editorial_id FROM pliego.edicion WHERE edicion_id={self.edition}').split('|')
        author=self.sql(f'SELECT autor_id FROM pliego.libro_autor WHERE libro_id={book} LIMIT 1')
        category=self.sql(f'SELECT categoria_id FROM pliego.libro_categoria WHERE libro_id={book} LIMIT 1')
        self.sql(f"""DO $$ DECLARE mov BIGINT;before INTEGER;after INTEGER;cart BIGINT;item BIGINT;qty INTEGER;purchase BIGINT;st VARCHAR;pay VARCHAR;total NUMERIC;ref VARCHAR;bk BIGINT;ed BIGINT;BEGIN
          CALL pliego.sp_inventory_entry({self.order_admin},{self.edition},400,'capacity fixture',mov,before,after);
          FOR i IN 1..350 LOOP
            CALL pliego.sp_cart_add_item({self.order_owner},{self.edition},1,cart,item,qty);
            CALL pliego.sp_checkout({self.order_owner},{address},'CARD','APPROVED',purchase,st,pay,total,ref);
          END LOOP;
          FOR i IN 1..500 LOOP
            CALL pliego.sp_book_create({self.order_admin},'Libro Capacidad '||i,NULL,NULL,jsonb_build_array(jsonb_build_object('authorId',{author},'order',1)),jsonb_build_array({category}),bk);
            IF i<=100 THEN
              CALL pliego.sp_edition_create({self.order_admin},bk,{publisher},'CAPACITY-EPUB-'||i,NULL,'es','EBOOK',120,NULL,10,NULL,NULL,NULL,NULL,'EPUB',NULL,ARRAY[]::TEXT[],ed);
              CALL pliego.sp_cart_add_item({self.order_owner},ed,1,cart,item,qty);
              CALL pliego.sp_checkout({self.order_owner},NULL,'TRANSFER','APPROVED','DIGITAL_ONLY',NULL,purchase,st,pay,total,ref);
            ELSE
              CALL pliego.sp_edition_create({self.order_admin},bk,{publisher},'CAPACITY-PHYSICAL-'||i,NULL,'es','PAPERBACK',100,NULL,7.25,NULL,NULL,NULL,NULL,ed);
              CALL pliego.sp_inventory_entry({self.order_admin},ed,2,'capacity fixture',mov,before,after);
            END IF;
          END LOOP; END $$""")
        self.transition_orders=list(map(int,self.sql(f"SELECT p.pedido_id FROM pliego.pedido p JOIN pliego.cliente c USING(cliente_id) WHERE c.usuario_id={self.order_owner} AND p.pedido_id>{self.cancel_order} AND p.pedido_id IN(SELECT pedido_id FROM pliego.pedido_item WHERE edicion_id={self.edition}) ORDER BY pedido_id").splitlines()))
        self.sql('ANALYZE');self.sql('SELECT pliego.fn_realtime_publish(1000) FROM generate_series(1,10)')
        (self.out/'fixture-manifest.json').write_text(json.dumps({'customers':self.actors,'admin':self.admin,
          'order_admin':self.order_admin,'order_owner':self.order_owner,'physical_edition':self.edition,
          'available_transition_orders':len(self.transition_orders)},indent=2)+'\n')
    def token(self,actor):
        now=int(time.time());h=encoded({'alg':'HS256','typ':'JWT'});p=encoded({'iss':'pliego','aud':'pliego-api','sub':str(actor),'role':self.roles.get(actor,'CUSTOMER'),'iat':now,'exp':now+1800,'jti':str(uuid.uuid4())})
        data=h+b'.'+p
        return (data+b'.'+base64.urlsafe_b64encode(hmac.new(self.key.encode(),data,hashlib.sha256).digest()).rstrip(b'=')).decode()
    def request(self,path,actor,method='GET',body=None,timeout=35):
        c=http.client.HTTPConnection('127.0.0.1',self.args.http_port,timeout=timeout); headers={}
        if actor:headers['Authorization']='Bearer '+self.token(actor)
        if body is not None:headers['Content-Type']='application/json'
        start=time.monotonic();c.request(method,path,body=json.dumps(body) if body is not None else None,headers=headers)
        r=c.getresponse();data=r.read();elapsed=(time.monotonic()-start)*1000;c.close()
        return r.status,json.loads(data) if data else None,elapsed
    def sample(self):
        path=self.out/'resources.jsonl'
        with path.open('w') as f:
            while not self.stop.is_set():
                try:
                    row={'at':time.time(),'phase':self.phase,'backend_pid':self.backend.pid,
                      'pg':self.sql("SELECT json_build_object('connections',count(*),'active',count(*) FILTER(WHERE state='active'),'idle_transaction',count(*) FILTER(WHERE state='idle in transaction')) FROM pg_stat_activity WHERE datname=current_database()")}
                    status=pathlib.Path(f'/proc/{self.backend.pid}/status').read_text()
                    row.update({k:int(next(x for x in status.splitlines() if x.startswith(k+':')).split()[1]) for k in ('VmRSS','VmHWM','Threads')})
                    row['rss_kib']=row.pop('VmRSS');row['hwm_kib']=row.pop('VmHWM');row['pg']=json.loads(row['pg'])
                    postmaster=int((self.pg/'postmaster.pid').read_text().splitlines()[0])
                    pgpids=[postmaster];pgpids+=list(map(int,pathlib.Path(f'/proc/{postmaster}/task/{postmaster}/children').read_text().split()))
                    pss=private=0;found=0
                    for pid in pgpids:
                        try:
                            fields=pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()
                            ticks=int(fields[11])+int(fields[12]);key=(pid,fields[19])
                            if key in self.pg_cpu_seen:self.pg_cpu_total_ticks+=max(0,ticks-self.pg_cpu_seen[key])
                            self.pg_cpu_seen[key]=ticks
                            memory=pathlib.Path(f'/proc/{pid}/smaps_rollup').read_text().splitlines()
                            pss+=int(next(x for x in memory if x.startswith('Pss:')).split()[1])
                            private+=sum(int(x.split()[1]) for x in memory if x.startswith(('Private_Clean:','Private_Dirty:')));found+=1
                        except (OSError,StopIteration,ValueError):pass
                    row.update(pg_cpu_seconds_sampled=self.pg_cpu_total_ticks/os.sysconf('SC_CLK_TCK'),pg_pss_kib=pss,pg_private_kib=private,pg_processes_sampled=found)
                    self.metrics.append(row);f.write(json.dumps(row)+'\n');f.flush()
                except Exception as e:f.write(json.dumps({'at':time.time(),'phase':self.phase,'error':str(e)})+'\n');f.flush()
                self.stop.wait(.5)
    def wait(self,predicate,timeout=20):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            if predicate():return
            time.sleep(.05)
        raise AssertionError('Timed out in '+self.phase)
    def streams(self,actors):
        with cf.ThreadPoolExecutor(max_workers=16) as pool:s=list(pool.map(lambda actor:Stream(self,actor),actors))
        assert all(x.status==200 for x in s),[x.status for x in s]
        self.wait(lambda:all(x.events for x in s))
        return s
    def close(self,streams):
        for s in streams:s.close()
        self.wait(lambda:int(self.sql('SELECT count(*) FROM pliego.realtime_connection'))==0,65)
    def save(self):
        (self.out/'results.json').write_text(json.dumps(self.results,indent=2)+'\n')
    def emit(self,label,data):
        self.results[label]=data;self.save();print(json.dumps({label:data}),flush=True)
    def benchmark(self,count,multi=False,suffix='',read_warmup=0):
        label=f'ramp-{count}'+('-multilease' if multi else '')+suffix
        self.phase=label;streams=self.streams([self.actors[i//4 if multi else i] for i in range(count)]) if count else []
        opened=time.time();result={'streams':count,'users':count//4 if multi else count,'start':opened,'rest':{}}
        self.sql('SELECT pg_stat_statements_reset()')
        time.sleep(5)
        paths=['/api/v1/catalog/editions?page=0&pageSize=20','/api/v1/me','/api/v1/orders','/api/v1/me/library']
        def batch(path,samples):
            started=time.time()
            def call(i):
                status,body,ms=self.request(path,self.order_owner if path!='/api/v1/catalog/editions?page=0&pageSize=20' else None)
                return {'path':path,'status':status,'ms':ms,'at':time.time(),'items':len(body.get('items',[])) if isinstance(body,dict) else None,'total':body.get('totalCount') if isinstance(body,dict) else None}
            with cf.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(call,range(samples)))
            ended=time.time()
            stats={**percentiles([x['ms'] for x in rows]),'errors':sum(x['status']!=200 for x in rows),'concurrency':4,
              'returned_items':rows[0]['items'],'total_count':rows[0]['total'],'start':started,'end':ended,
              'elapsed_s':ended-started,'throughput_rps':samples/(ended-started)}
            return rows,stats
        if read_warmup:
            warm_rows=[];result['read_warmup']={};result['stream_opened_epoch']=opened
            for path in paths:
                rows,stats=batch(path,read_warmup);warm_rows.extend(rows);result['read_warmup'][path]=stats
                assert stats['errors']==0,stats
            (self.out/(label+'-warmup.json')).write_text(json.dumps(warm_rows))
            self.sql('SELECT pg_stat_statements_reset()');result['start']=time.time()
        raw=[];result['read_window_start']=time.time()
        for path in paths:
            rows,stats=batch(path,200)
            raw.extend(rows); assert all(x['status']==200 for x in rows),rows[:2]
            result['rest'][path]=stats
        result['read_window_end']=time.time()
        # Seed only pending inputs. The measured writes traverse actual REST/JDBC commands.
        decisions=[];transitions=[];write_rows=[]
        for i in range(30):
            request_id=self.sql(f"INSERT INTO pliego.cliente_identificacion_solicitud_correccion(cliente_id,tipo_actual,numero_actual,tipo_propuesto,numero_propuesto,codigo_motivo,estado,clave_idempotencia,huella_payload) SELECT cliente_id,'EC_CEDULA','0912345675','EC_CEDULA','1710034065','DOCUMENT_TYPO','PENDING','{uuid.uuid4()}','{'0'*64}' FROM pliego.cliente WHERE usuario_id={self.actors[0]} RETURNING solicitud_id").splitlines()[0]
            status,body,ms=self.request('/api/v1/admin/billing-identity-corrections/'+request_id+'/decision',self.admin,'POST',{'decision':'REJECT','decisionReason':'Prueba sintética de capacidad.'})
            assert status==200,(status,body);decisions.append(ms)
            write_rows.append({'kind':'identity_decision_reject','resource_id':request_id,'status':status,'ms':ms,'at':time.time()})
            order=self.transition_orders.pop(0)
            status,body,ms=self.request(f'/api/v1/admin/orders/{order}/transitions',self.order_admin,'POST',{'targetState':'PREPARING'})
            assert status==200,(status,body);transitions.append(ms)
            write_rows.append({'kind':'order_transition_preparing','resource_id':str(order),'status':status,'ms':ms,'at':time.time()})
        result['writes']={'identity_decision_reject':percentiles(decisions),'order_transition_preparing_distinct_orders':percentiles(transitions)}
        result['write_note']='30fresh PENDING corrections rejected;30distinct CONFIRMED physical orders transition shipment to PREPARING through REST.'
        result['pg_stat_statements']=json.loads(self.sql("SELECT coalesce(json_agg(t),'[]') FROM (SELECT calls,total_exec_time,mean_exec_time,query FROM pg_stat_statements WHERE query LIKE '%fn_realtime_read%' ORDER BY calls DESC) t"))
        if count==128:
            result['live_streams_before_129']=sum(s.closed_at is None for s in streams)
            result['leases_before_129']=int(self.sql('SELECT count(*) FROM pliego.realtime_connection WHERE expires_at>clock_timestamp()'))
            assert result['live_streams_before_129']==128 and result['leases_before_129']==128
            reject=Stream(self,self.actors[139]);result['process_129']={'status':reject.status,'retry_after':reject.retry_after,'problem':reject.problem};assert reject.status==429 and reject.retry_after=='60'
        result['elapsed_s']=time.time()-opened;result['end']=time.time()
        (self.out/(label+'-rest.json')).write_text(json.dumps(raw))
        (self.out/(label+'-writes.json')).write_text(json.dumps(write_rows))
        self.emit(label,result);self.close(streams)
    def run_all(self):
        self.setup()
        (self.out/'cpu-topology.txt').write_text(self.command(['lscpu','--extended=CPU,CORE,SOCKET,ONLINE'])+'\n')
        affinity=lambda pid:next(line for line in pathlib.Path(f'/proc/{pid}/status').read_text().splitlines() if line.startswith('Cpus_allowed_list:'))
        self.emit('affinity',{'backend':affinity(self.backend.pid),'collector':affinity(self.jmx.pid),
          'postmaster':affinity(int((self.pg/'postmaster.pid').read_text().splitlines()[0]))})
        self.emit('java',{'version':self.command(['taskset','-c',self.args.cpus,self.args.java_bin,'--version']),'backend_jit':'default','collector_jit':'-Xint','collector_cpus':self.args.cpus})
        self.emit('environment',{'jar_sha256':hashlib.sha256(self.jar.read_bytes()).hexdigest(),'os':platform.platform(),'evidence_path':str(self.out),'backend_cpus':self.args.cpus,'postgres_cpus':self.args.cpus,'heap':'256m/1280m','pool':'max8/min2','postgres_max_connections':30,'postgres_version':self.sql('SHOW server_version'),'backend_affinity':next(x for x in pathlib.Path(f'/proc/{self.backend.pid}/status').read_text().splitlines() if x.startswith('Cpus_allowed_list:')),'memory_kib':pathlib.Path('/proc/meminfo').read_text().splitlines()[0],'disk':self.command(['df','-T',self.out]),'flyway':self.sql('SELECT count(*)||\':\'||max(version::integer) FROM flyway_schema_history WHERE success AND version IS NOT NULL'),'host_load_start':pathlib.Path('/proc/loadavg').read_text().strip(),'cardinality':json.loads(self.sql("SELECT json_build_object('users',(SELECT count(*) FROM pliego.usuario),'editions',(SELECT count(*) FROM pliego.edicion),'orders',(SELECT count(*) FROM pliego.pedido),'digital_grants',(SELECT count(*) FROM pliego.digital_grant))"))})
        if self.args.suite=='fixed':
            self.benchmark(0);self.benchmark(128);self.pool_exhaustion();self.connection_lock();return
        if self.args.suite=='healthy':
            self.benchmark(0);self.benchmark(128);return
        if self.args.suite in ('healthy-warm','fixed-warm'):
            self.benchmark(0,suffix='-warm',read_warmup=200)
            for index in range(1,4):self.benchmark(128,suffix='-warm-'+str(index),read_warmup=200)
            if self.args.suite=='fixed-warm':self.pool_exhaustion();self.connection_lock()
            return
        if self.args.suite=='faults':
            self.pool_exhaustion();self.connection_lock();return
        if self.args.suite=='connection-lock':
            self.connection_lock();return
        if self.args.suite=='recovery':
            self.pool_exhaustion();self.recovery();self.connection_lock();return
        for n in (0,32,64,128):self.benchmark(n)
        self.benchmark(128,True)
        self.steady()
        self.phase='per-user-cap';streams=self.streams([self.actors[0]]*4);fifth=Stream(self,self.actors[0]);assert fifth.status==429 and fifth.retry_after=='60'
        self.emit('per-user-cap',{'four_statuses':[s.status for s in streams],'fifth_status':fifth.status,'retry_after':fifth.retry_after,'problem':fifth.problem})
        start=time.monotonic();self.close(streams);release=time.monotonic()-start
        reopened=Stream(self,self.actors[0]);assert reopened.status==200;self.close([reopened]);self.emit('disconnect-release',{'all_four_leases_released_s':release,'reopen_status':reopened.status})
        for n in (1000,10000):self.burst(n)
        self.pool_exhaustion()
        self.recovery()
        self.connection_lock()
    def steady(self):
        self.phase='steady-128';streams=self.streams(self.actors[:128]);start=time.time();reconnects=0;rows=[];failures=[];closures=[]
        all_streams=list(streams);expected={};next_marker=start;post_second_resume_marker=False
        paths=['/api/v1/catalog/editions?page=0&pageSize=20','/api/v1/me','/api/v1/orders','/api/v1/me/library']
        with cf.ThreadPoolExecutor(max_workers=8) as pool:
            while time.time()-start<130:
                closed=[i for i,s in enumerate(streams) if s.closed_at is not None]
                if closed:
                    closures.extend({'actor':streams[i].actor,'error':streams[i].error,'lifetime_s':streams[i].closed_at-streams[i].opened_at} for i in closed)
                    opened=list(pool.map(lambda i:(i,Stream(self,streams[i].actor,streams[i].cursor)),closed))
                    for i,s in opened:
                        if s.status!=200:failures.append({'actor':s.actor,'status':s.status})
                        else:streams[i]=s;all_streams.append(s);reconnects+=1
                if (time.time()>=next_marker and time.time()-start<120) or (reconnects>=256 and not post_second_resume_marker):
                    # Mark every customer across more than two fixed stream lifetimes.
                    marker=len(expected)//128
                    pairs=[(actor,str(990000000+marker*1000+actor)) for actor in self.actors[:128]]
                    self.sql(';'.join(f"SELECT pliego.fn_realtime_enqueue({actor},false,'order.changed','order','{rid}')" for actor,rid in pairs))
                    expected.update({rid:actor for actor,rid in pairs});next_marker=time.time()+20
                    if reconnects>=256:post_second_resume_marker=True
                futures=[pool.submit(self.request,path,self.order_owner if 'catalog' not in path else None) for path in paths]
                for path,future in zip(paths,futures):
                    status,body,ms=future.result();rows.append({'path':path,'status':status,'ms':ms,'at':time.time()})
                time.sleep(.2)
        self.wait(lambda:all(any(e.get('event')=='order.changed' and json.loads(e['data']).get('resourceId')==rid for s in all_streams if s.actor==actor for e in s.events) for rid,actor in expected.items()),10)
        delivered=[{'actor':s.actor,**e} for s in all_streams for e in s.events if e.get('event')=='order.changed' and json.loads(e['data']).get('resourceId') in expected]
        misroutes=[e for e in delivered if expected[json.loads(e['data'])['resourceId']]!=e['actor']]
        resumed=[s for s in all_streams if s not in all_streams[:128]]
        unexpected_resyncs=[{'actor':s.actor,'event':e} for s in resumed for e in s.events if e.get('event')=='resync']
        duplicate_count=len(delivered)-len({json.loads(e['data'])['resourceId'] for e in delivered})
        assert not failures and all(x['status']==200 for x in rows) and not misroutes and not unexpected_resyncs and duplicate_count==0
        assert reconnects>=256 and post_second_resume_marker
        self.emit('steady-128',{'start':start,'end':time.time(),'elapsed_s':time.time()-start,'reconnects':reconnects,'admission_failures':failures,
          'rest':{p:{**percentiles([x['ms'] for x in rows if x['path']==p]),'errors':sum(x['status']!=200 for x in rows if x['path']==p)} for p in paths},'live_at_end':sum(s.closed_at is None for s in streams),
          'marker_events_expected':len(expected),'marker_events_delivered':len(delivered),'marker_unique':len({json.loads(e['data'])['resourceId'] for e in delivered}),
          'marker_misrouted':len(misroutes),'resumed_unexpected_resyncs':unexpected_resyncs,
          'marker_duplicate_delivery':duplicate_count,'post_second_resume_marker_events_expected':128 if post_second_resume_marker else 0,
          'closures':closures,'close_error_counts':{str(err):sum(x['error']==err for x in closures) for err in {x['error'] for x in closures}}})
        (self.out/'steady-128-rest.json').write_text(json.dumps(rows));self.close(streams)
        (self.out/'steady-128-events.json').write_text(json.dumps(delivered))
    def burst(self,n):
        self.phase=f'burst-{n}';actors=self.actors[:127]+[self.admin];streams=self.streams(actors)
        base=8000000+n*10;start=time.time()
        self.sql(f"INSERT INTO pliego.realtime_event(user_id,admin_scope,event_name,resource_type,resource_id) SELECT CASE WHEN i%10=0 THEN NULL ELSE (ARRAY[{','.join(map(str,self.actors[:127]))}])[1+(i%127)] END,i%10=0,'order.changed','order',({base}+i)::text FROM generate_series(1,{n}) i")
        ack=time.time()
        self.wait(lambda:int(self.sql(f"SELECT count(*) FROM pliego.realtime_event WHERE resource_id::bigint BETWEEN {base+1} AND {base+n} AND event_id IS NOT NULL"))==n,45)
        rows=self.sql(f"SELECT event_id,coalesce(user_id,0),resource_id,extract(epoch FROM published_at) FROM pliego.realtime_event WHERE resource_id::bigint BETWEEN {base+1} AND {base+n} ORDER BY event_id").splitlines()
        published={row.split('|')[2]:row.split('|') for row in rows}
        def wanted():return [(s,e) for s in streams for e in s.events if e['event']=='order.changed' and base+1<=int(json.loads(e['data'])['resourceId'])<=base+n]
        self.wait(lambda:len(wanted())>=n,50)
        # Each stream must traverse the entire committed batch. This captures late
        # extra routes/duplicates after the first n deliveries as well.
        head=max(int(row.split('|')[0]) for row in rows)
        self.wait(lambda:all(s.cursor is not None and int(s.cursor)>=head for s in streams),10)
        time.sleep(2.2)
        delivered=wanted();misroutes=[]
        for s,e in delivered:
            rid=json.loads(e['data'])['resourceId'];target=int(published[rid][1]) or self.admin
            if s.actor!=target:misroutes.append({'actor':s.actor,'intended':target,'event':e})
        ids=[json.loads(e['data'])['resourceId'] for s,e in delivered]
        expected=set(published);assert set(ids)==expected and len(ids)==n and not misroutes
        lags=[max(0,(float(v[3])-ack)*1000) for v in published.values()]
        delivery=[max(0,(e['at']-ack)*1000) for s,e in delivered]
        result={'n':n,'start':start,'end':time.time(),'streams':128,'customers':127,'admins':1,'transaction_duration_ms':(ack-start)*1000,
          'commit_ack_epoch':ack,'publication':percentiles(lags),'delivery':percentiles(delivery),'delivered':len(ids),
          'unique':len(set(ids)),'missing':len(expected-set(ids)),'misrouted':len(misroutes),'duplicate':len(ids)-len(set(ids)),
          'table_bytes_before_cleanup':int(self.sql("SELECT pg_total_relation_size('pliego.realtime_event')")),
          'delivery_note':'Time from client commit acknowledgement; publication is automatic 1000-row/2s scheduler, 100-event read pages every2s. Every stream reaches final published head, followed by 2.2s settling.',
          'per_actor':[{'actor':s.actor,'role':self.roles[s.actor],'expected':sum((int(v[1]) or self.admin)==s.actor for v in published.values()),
            'delivered':sum(other is s for other,e in delivered),'final_cursor':s.cursor} for s in streams]}
        self.close(streams)
        self.phase=f'cleanup-{n}';self.sql(f"UPDATE pliego.realtime_event SET published_at=clock_timestamp()-interval '2 hours' WHERE resource_id::bigint BETWEEN {base+1} AND {base+n}")
        clean=time.monotonic();self.wait(lambda:int(self.sql(f"SELECT count(*) FROM pliego.realtime_event WHERE resource_id::bigint BETWEEN {base+1} AND {base+n}"))==0,45)
        result['cleanup_elapsed_s']=time.monotonic()-clean;result['cleanup_rows_per_s']=n/result['cleanup_elapsed_s']
        result['table_bytes_after_delete']=int(self.sql("SELECT pg_total_relation_size('pliego.realtime_event')"))
        stale=Stream(self,self.actors[0],min(int(row.split('|')[0]) for row in rows)-1)
        self.wait(lambda:bool(stale.events));assert stale.events[0]['event']=='resync'
        result['retention_stale_cursor_event']=stale.events[0];result['cleanup_end']=time.time();self.close([stale])
        self.emit(f'burst-{n}',result)
        (self.out/f'burst-{n}-events.json').write_text(json.dumps([{'actor':s.actor,**e} for s,e in delivered]))
    def recovery(self):
        actor=self.actors[1]
        self.phase='session-revocation';s=self.streams([actor])[0];at=time.time()
        self.sql(f"SELECT pliego.fn_auth_session_revoke('{self.secrets[actor][1]}')")
        ack=time.time();self.wait(lambda:s.closed_at is not None,6);refused=Stream(self,actor)
        self.emit('session-revocation',{'start':at,'end':time.time(),'commit_ack_to_close_ms':(s.closed_at-ack)*1000,'command_start_to_close_ms':(s.closed_at-at)*1000,'reconnect_status':refused.status});assert refused.status==401
        # Restore only this synthetic scratch session for later experiments.
        secret=base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('=');digest=hashlib.sha256(secret.encode()).hexdigest()
        self.secrets[actor]=(secret,digest)
        self.sql(f"SELECT pliego.fn_auth_session_create_checked({actor},'{digest}',clock_timestamp()+interval '1 day','fixture-hash')")
        self.phase='backend-restart';begin=time.time();s=self.streams([actor])[0];cursor=s.cursor;self.backend.terminate();self.backend.wait(timeout=45)
        self.sql(f"SELECT pliego.fn_realtime_enqueue({actor},false,'order.changed','order','9800001')")
        at=time.monotonic();self.start_backend();ready=time.monotonic()-at
        resumed=Stream(self,actor,cursor);self.wait(lambda:any(e.get('event')=='order.changed' and json.loads(e['data'])['resourceId']=='9800001' for e in resumed.events),10)
        fresh=Stream(self,actor);self.wait(lambda:bool(fresh.events));assert fresh.events[0]['event']=='resync'
        self.emit('backend-restart',{'start':begin,'end':time.time(),'ready_s':ready,'cursor':cursor,'resumed_events':resumed.events,'fresh_event':fresh.events[0],'reconnect':'explicit new HTTP with retained Last-Event-ID; native browser retry not measured'})
        self.close([resumed,fresh]);s.close()
        self.phase='postgres-restart';begin=time.time();s=self.streams([actor])[0];cursor=s.cursor;at=time.monotonic()
        self.pgctl('-m','fast','-w','restart');restart=time.monotonic()-at
        self.sql(f"SELECT pliego.fn_realtime_enqueue({actor},false,'order.changed','order','9800002')")
        resumed=Stream(self,actor,cursor);self.wait(lambda:any(e.get('event')=='order.changed' and json.loads(e['data'])['resourceId']=='9800002' for e in resumed.events),15)
        fresh=Stream(self,actor);self.wait(lambda:bool(fresh.events));assert fresh.events[0]['event']=='resync'
        status,body,ms=self.request('/api/v1/me',actor);assert status==200
        old_delivered=lambda:any(e.get('event')=='order.changed' and json.loads(e['data'])['resourceId']=='9800002' for e in s.events)
        self.wait(lambda:s.closed_at is not None or old_delivered(),8)
        self.emit('postgres-restart',{'start':begin,'end':time.time(),'pg_restart_s':restart,'rest_status':status,'rest_ms':ms,'resumed_events':resumed.events,'fresh_event':fresh.events[0],
          'old_stream_closed':s.closed_at is not None,'old_stream_delivered_marker':old_delivered(),'old_stream_events_before_explicit_close':list(s.events)})
        self.close([s,resumed,fresh])
        self.kill_expiry(actor)
    def pool_exhaustion(self):
        self.database_lock('pool-exhaustion','realtime_cursor','pool')
    def kill_expiry(self,actor):
        self.phase='kill9-lease-expiry';streams=self.streams([actor]*4);expiry=float(self.sql(f"SELECT extract(epoch FROM max(expires_at)) FROM pliego.realtime_connection WHERE user_id={actor}"));at=time.time()
        self.backend.kill();self.backend.wait(timeout=10)
        after=int(self.sql(f'SELECT count(*) FROM pliego.realtime_connection WHERE user_id={actor}'))
        self.start_backend();denied=Stream(self,actor);assert denied.status==429
        self.wait(lambda:time.time()>expiry+.05,65)
        recovered=Stream(self,actor);assert recovered.status==200
        self.emit('kill9-lease-expiry',{'start':at,'end':time.time(),'leases_after_crash':after,'reconnect_before_expiry_status':denied.status,
          'scheduled_expiry_after_kill_s':expiry-at,'reconnect_after_expiry_status':recovered.status,'reconnect_at_after_kill_s':time.time()-at})
        assert after==4 and expiry-at<=60
        self.close([recovered])
        for s in streams:s.close()
    def connection_lock(self):
        self.database_lock('connection-lock','realtime_connection','connection-lock')
    def database_lock(self,label,relation,prefix):
        self.phase=label;begin=time.time();streams=self.streams(self.actors[:128])
        expiry=float(self.sql('SELECT extract(epoch FROM max(expires_at)) FROM pliego.realtime_connection'))
        process_reject=Stream(self,self.actors[139])
        assert process_reject.status==429 and process_reject.retry_after=='60'
        probe=subprocess.Popen([sys.executable,str(self.harness/'sse_capacity_pg_probe.py'),
          '--output',str(self.out),'--pg-bin',self.args.pg_bin,'--port',str(self.args.pg_port),'--now','--duration','14','--name',prefix],
          env=self.env,stdout=(self.out/(prefix+'-query-probe.log')).open('w'),stderr=subprocess.STDOUT)
        appname='capacity-'+prefix+'-blocker'
        lock=subprocess.Popen([self.args.pg_bin+'/psql','-X','-v','ON_ERROR_STOP=1','-c',
          'BEGIN; LOCK TABLE pliego.'+relation+' IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(8); COMMIT'],
          env={**self.env,'PGAPPNAME':appname},stdout=(self.out/(prefix+'-blocker.log')).open('w'),stderr=subprocess.STDOUT)
        self.wait(lambda:int(self.sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"+appname+"' AND wait_event='PgSleep'"))==1)
        locked=time.monotonic();locked_epoch=time.time();accepted=[]
        def scheduled(spec):
            delay,index,kind=spec;time.sleep(max(0,locked+delay-time.monotonic()))
            invoked=time.time();base={'scheduled_offset_s':delay,'index':index,'invoked_epoch':invoked,'actual_offset_s':invoked-locked_epoch}
            if kind=='rest':
                status,body,ms=self.request('/api/v1/me',self.order_owner)
                return {**base,'kind':kind,'status':status,'ms':ms,'completed_epoch':time.time()}
            closed=sum(s.closed_at is not None for s in streams)
            candidate=Stream(self,self.actors[139])
            if candidate.status==200:accepted.append(candidate)
            return {**base,'kind':kind,'status':candidate.status,'ms':candidate.open_ms,'completed_epoch':time.time(),'retry_after':candidate.retry_after,
              'problem_code':getattr(candidate,'problem',{}).get('code'),'closed_streams_before_probe':closed}
        specs=[(delay,index,'rest') for delay in (2.5,4.5,6.5) for index in range(4)]
        if relation=='realtime_connection':specs.extend((delay,0,'admission') for delay in (2.5,4.5,5.0))
        with cf.ThreadPoolExecutor(max_workers=len(specs)) as pool:observations=list(pool.map(scheduled,specs))
        lock.wait(timeout=15);assert lock.returncode==0,'Lock fault command failed'
        unlocked_epoch=time.time()
        probe.wait(timeout=20);assert probe.returncode==0,'Query-age probe failed'
        samples=[json.loads(line) for line in (self.out/(prefix+'-query-age.jsonl')).read_text().splitlines()]
        valid=[row for row in samples if 'probe_error' not in row]
        assert valid,'Query-age probe has no valid samples'
        requests=[row for row in observations if row['kind']=='rest'];admission=[row for row in observations if row['kind']=='admission']
        result={'start':begin,'end':time.time(),'blocker_s':8,'readers':128,'lock_relation':relation,'lock_observed_epoch':locked_epoch,'lock_release_observed_epoch':unlocked_epoch,
          'rest':requests,'rest_200_under_500ms':all(row['status']==200 and row['ms']<500 for row in requests),
          'rest_waves':[{'scheduled_offset_s':delay,'requests':[row for row in requests if row['scheduled_offset_s']==delay],
             'all_200_under_500ms':all(row['status']==200 and row['ms']<500 for row in requests if row['scheduled_offset_s']==delay)} for delay in (2.5,4.5,6.5)],
          'admission_during_lock':admission,'process_129_before_lock':{'status':process_reject.status,'retry_after':process_reject.retry_after},
          'query_age_samples':len(valid),'query_probe_valid_samples':len(valid),'query_probe_errors':len(samples)-len(valid),
          'active_sse_reads_max':max(row['active_reads'] for row in valid),'active_sse_query_age_max_s':max(row['max_age_s'] for row in valid),
          'active_sse_mixed_max':max(row['active_mixed'] for row in valid),'active_sse_mixed_query_age_max_s':max(row['max_mixed_age_s'] for row in valid),
          'active_sse_including_publisher_max':max(row['active_mixed']+row['publisher_calls'] for row in valid),
          'active_disconnect_calls_max':max(row['disconnect_calls'] for row in valid),'active_connect_calls_max':max(row['connect_calls'] for row in valid),
          'publisher_calls_max':max(row['publisher_calls'] for row in valid),'lock_waiting_sse_reads_max':max(row['waiting_locks'] for row in valid),
          'postgres_connections_including_probe_max':max(row['postgres_connections_including_probe'] for row in valid),
          'closed_streams_after_lock':sum(s.closed_at is not None for s in streams),
          'leases_after_lock':int(self.sql('SELECT count(*) FROM pliego.realtime_connection')),
          'max_original_lease_expiry_after_lock_s':max(0,expiry-time.time()),
          'note':'128streams;8s exclusive lock; independent4concurrent REST waves at2.5/4.5/6.5s. Mixed active SQL counts connect/read/disconnect in one PostgreSQL snapshot; publisher is separate. Admission probes run during the lease lock. Retain measurements before bounded assertions.'}
        self.emit(label,result)
        close_started=time.monotonic();self.close(streams+accepted)
        result['all_leases_released_after_client_close_s']=time.monotonic()-close_started
        result['lease_recovery_observed_epoch']=time.time();result['max_captured_original_expiry_epoch']=expiry
        result['lease_recovery_beyond_expiry_s']=time.time()-expiry
        result['leases_after_recovery']=int(self.sql('SELECT count(*) FROM pliego.realtime_connection'))
        reopened=Stream(self,self.actors[139]);result['post_fault_reconnect_status']=reopened.status
        assert reopened.status==200
        self.close([reopened]);self.emit(label,result)
        if self.args.expect_bounded:
            assert len(requests)==12
            assert len(admission)==(3 if relation=='realtime_connection' else 0)
            assert result['rest_200_under_500ms'],'REST500ms bound failed; measured waves retained in results.json'
            assert 1<=result['active_sse_mixed_max']<=4,result['active_sse_mixed_max']
            assert result['active_sse_including_publisher_max']<=5,result['active_sse_including_publisher_max']
            assert result['active_sse_mixed_query_age_max_s']<2,result['active_sse_mixed_query_age_max_s']
            assert all(row['status']==429 and row['retry_after']=='60' and row['problem_code']=='REALTIME_CONNECTION_LIMITED' for row in admission),admission
            assert all(row['completed_epoch']<unlocked_epoch for row in admission),'Admission probe completed after observed unlock'
            assert result['leases_after_recovery']==0
    def cleanup(self):
        self.stop.set()
        if self.jmx and self.jmx.poll() is None:self.jmx.terminate()
        if self.backend and self.backend.poll() is None:
            self.backend.terminate()
            try:self.backend.wait(timeout=40)
            except subprocess.TimeoutExpired:self.backend.kill();self.backend.wait()
        if self.pg_running:
            try:self.pgctl('-m','fast','-w','stop')
            except Exception:pass

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--jar',required=True);p.add_argument('--output',default=str(ROOT/'.release-evidence'/time.strftime('%Y-%m-%d')/'capacity-fixed'/time.strftime('%H%M%S')))
    p.add_argument('--java-bin',default='java');p.add_argument('--pg-bin',default='/usr/lib/postgresql/18/bin');p.add_argument('--pg-port',type=int,default=55547);p.add_argument('--http-port',type=int,default=18094);p.add_argument('--cpus',default='24,25');p.add_argument('--suite',choices=('all','recovery','connection-lock','faults','fixed','healthy','healthy-warm','fixed-warm'),default='all');p.add_argument('--expect-bounded',action='store_true');args=p.parse_args()
    if os.environ.get('PLIEGO_TEST_DISPOSABLE_DB')!='1':raise SystemExit('Explicit PLIEGO_TEST_DISPOSABLE_DB=1 required for scratch-only experiment.')
    out=pathlib.Path(args.output).resolve()
    if out==pathlib.Path('/tmp') or pathlib.Path('/tmp') in out.parents:raise SystemExit('Persistent evidence directory required, never /tmp.')
    if ROOT in out.parents and ROOT/'.release-evidence' not in out.parents:raise SystemExit('Repository evidence must be inside ignored .release-evidence.')
    if len(os.fsencode(str(out/('.s.PGSQL.'+str(args.pg_port)))))>107:raise SystemExit('Evidence directory is too long for the PostgreSQL Unix socket; choose a shorter persistent run name.')
    if args.pg_port in (5432,55436,55539) or args.pg_port<1024 or args.http_port<1024:raise SystemExit('Use dedicated unprivileged scratch ports; never5432/55436/55539.')
    if 'PostgreSQL) 18.' not in subprocess.check_output([args.pg_bin+'/postgres','--version'],text=True):raise SystemExit('PostgreSQL18 required.')
    for port in (args.pg_port,args.http_port):
        with socket.socket() as s:
            s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('127.0.0.1',port))
    run=Run(args)
    (run.out/'run-status.json').write_text(json.dumps({'status':'running','started_epoch':time.time(),'suite':args.suite})+'\n')
    try:
        run.run_all()
        diagnostic=run.results.get('connection-lock',{}).get('rest_200_under_500ms')
        (run.out/'run-status.json').write_text(json.dumps({'status':'completed-with-diagnostic-failure' if diagnostic is False else 'passed',
          'finished_epoch':time.time(),'suite':args.suite,'lease_table_fault_rest_200_under_500ms':diagnostic})+'\n')
    except BaseException as e:
        run.emit('failure',{'type':type(e).__name__,'message':str(e),'phase':run.phase})
        (run.out/'run-status.json').write_text(json.dumps({'status':'failed','finished_epoch':time.time(),'phase':run.phase,'type':type(e).__name__})+'\n')
        raise
    finally:run.cleanup()

if __name__=='__main__':main()
