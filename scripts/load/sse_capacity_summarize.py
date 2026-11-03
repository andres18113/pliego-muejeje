#!/usr/bin/env python3
"""Combine capacity runs and local JMX/resource samples without fixture credentials."""
import argparse,csv,json,pathlib,re,statistics

def summarize(directory):
    p=pathlib.Path(directory);results=json.loads((p/'results.json').read_text())
    if 'pool-exhaustion' in results and 'rest_waves' not in results['pool-exhaustion']:
        results['pool-exhaustion']['note']='Induced8s ACCESS EXCLUSIVE lock on realtime_cursor with128streams; probe4concurrent /me REST calls after2.5s. Mainpool concurrency measured by JMX; read count/query age by independent PostgreSQL probe.'
    if 'failure' in results:
        results['failure']={k:v for k,v in results['failure'].items() if k in ('type','phase')}
    resources=[];resource_errors=[]
    if (p/'resources.jsonl').exists():
        for line in (p/'resources.jsonl').read_text().splitlines():
            row=json.loads(line)
            if 'error' not in row:resources.append(row)
            else:resource_errors.append({'at':row.get('at'),'phase':row.get('phase')})
    jmx=[];jmx_dropped=0;jmx_files={}
    for file in p.glob('jmx-*.csv'):
        lines=file.read_text().splitlines()
        header=next((i for i,line in enumerate(lines) if line.startswith('epoch_ms,')),None)
        if header is None:
            jmx_files[file.name]={'parsed':0,'skipped':len(lines),'header_found':False};jmx_dropped+=len(lines);continue
        parsed=0;skipped=header
        for row in csv.DictReader(lines[header:]):
            try:jmx.append({**{k:int(v) for k,v in row.items()},'generation':file.name});parsed+=1
            except (TypeError,ValueError):skipped+=1
        jmx_dropped+=skipped;jmx_files[file.name]={'parsed':parsed,'skipped':skipped,'header_found':True}
    metrics={}
    for phase in sorted({x['phase'] for x in resources}):
        rs=[x for x in resources if x['phase']==phase]
        window=results.get(phase,{})
        start=window.get('start',min(x['at'] for x in rs));end=window.get('end',max(x['at'] for x in rs))
        rs=[x for x in rs if start<=x['at']<=end]
        js=[x for x in jmx if start<=x['epoch_ms']/1000<=end]
        if not rs or not js:continue
        cpu=elapsed=gc_ms=gc_count=0
        for gen in {x['generation'] for x in js}:
            a=sorted([x for x in js if x['generation']==gen],key=lambda x:x['epoch_ms'])
            cpu+=(a[-1]['cpu_ns']-a[0]['cpu_ns'])/1e9;elapsed+=(a[-1]['epoch_ms']-a[0]['epoch_ms'])/1000
            gc_ms+=a[-1]['gc_ms']-a[0]['gc_ms'];gc_count+=a[-1]['gc_count']-a[0]['gc_count']
        metrics[phase]={'window_start_epoch':start,'window_end_epoch':end,'window_seconds':end-start,
            'resource_samples':len(rs),'jmx_samples':len(js),'jmx_interval_ms':250,'resource_interval_ms':500,
            'backend_cpu_seconds':round(cpu,4),'backend_cpu_percent_one_core':round(cpu/elapsed*100,3) if elapsed else None,
            'backend_cpu_percent_two_cpu_allocation':round(cpu/elapsed*50,3) if elapsed else None,
            'cpu_measured_interval_s':elapsed,'rss_max_mib':round(max(x['rss_kib'] for x in rs)/1024,3),
            'jmx_window_coverage_ratio':round(elapsed/(end-start),4) if end>start else None,
            'heap_used_max_mib':round(max(x['heap_used'] for x in js)/1024**2,3),'heap_committed_max_mib':round(max(x['heap_committed'] for x in js)/1024**2,3),
            'hikari_main_active_max':max(x['active'] for x in js),'hikari_main_pending_max':max(x['pending'] for x in js),
            'hikari_main_total_max':max(x['total'] for x in js),'postgres_connections_max_including_sampler':max(x['pg']['connections'] for x in rs),
            'postgres_active_max_including_sampler':max(x['pg']['active'] for x in rs),'idle_in_transaction_max':max(x['pg']['idle_transaction'] for x in rs),
            'gc_collection_count_delta':gc_count,'gc_collection_time_ms_delta':gc_ms}
        if all('pool_max' in x for x in js):
            metrics[phase].update(hikari_configured_max_values=sorted({x['pool_max'] for x in js}),
              hikari_configured_min_values=sorted({x['pool_min'] for x in js}),heap_max_mib=round(max(x['heap_max'] for x in js)/1024**2,3),
              nonheap_used_max_mib=round(max(x['nonheap_used'] for x in js)/1024**2,3))
        if all('pg_cpu_seconds_sampled' in x for x in rs):
            duration=rs[-1]['at']-rs[0]['at'];pg_cpu=rs[-1]['pg_cpu_seconds_sampled']-rs[0]['pg_cpu_seconds_sampled']
            metrics[phase].update(pg_cpu_seconds_sampled=round(pg_cpu,4),pg_cpu_percent_one_core=round(pg_cpu/duration*100,3) if duration else None,
              combined_cpu_percent_two_cpu_allocation=round((cpu/elapsed+pg_cpu/duration)*50,3) if duration and elapsed else None,
              pg_pss_max_mib=round(max(x['pg_pss_kib'] for x in rs)/1024,3),pg_private_max_mib=round(max(x['pg_private_kib'] for x in rs)/1024,3),
              pg_cpu_note='Sum of postmaster+directchildren utime/stime deltas at500ms; excludes CPU of children that live entirely between samples.')
    logs='\n'.join(x.read_text() for x in p.glob('backend-*.log'))
    comparisons={}
    baseline=results.get('ramp-0',{})
    for name in ('ramp-32','ramp-64','ramp-128','ramp-128-multilease'):
        candidate=results.get(name,{})
        comparisons[name]={}
        for kind in ('rest','writes'):
            comparisons[name][kind]={}
            for endpoint,stats in candidate.get(kind,{}).items():
                before=baseline.get(kind,{}).get(endpoint,{})
                comparisons[name][kind][endpoint]={
                    'baseline_n':before.get('n'),'loaded_n':stats.get('n'),
                    **{f'p{quantile}_ratio':round(stats[f'p{quantile}_ms']/before[f'p{quantile}_ms'],3)
                       for quantile in (50,95,99) if before.get(f'p{quantile}_ms') and stats.get(f'p{quantile}_ms') is not None}}
    return {'raw_directory':str(p),'run_status':json.loads((p/'run-status.json').read_text()) if (p/'run-status.json').exists() else {'status':'failed' if 'failure' in results else 'partial'},'results':results,'metrics':metrics,'observed_baseline_ratios':comparisons,
        'monitoring':{'resource_valid_samples':len(resources),'resource_error_samples':len(resource_errors),'resource_errors_by_phase':{phase:sum(x['phase']==phase for x in resource_errors) for phase in {x['phase'] for x in resource_errors}},'jmx_skipped_lines':jmx_dropped,'jmx_files':jmx_files},
        'logged_hikari_connection_timeout_messages':len(re.findall('Connection is not available, request timed out',logs)),
        'logged_sse_http_message_not_writable_exceptions':len(re.findall('^org.springframework.http.converter.HttpMessageNotWritableException:',logs,re.M)),
        'limitations':['Backend and PostgreSQL share two pinned logical CPUs; backend-only and approximate combined CPU percentages are labeled separately. Consult cpu-topology.txt: two SMT siblings do not prove parity with two distinct production vCPUs.',
          'Host RAM approximately15.5GiB versus production3.8GiB; no cgroup memory cap. Evidence/PG filesystem is recorded under environment.disk; warm local storage differs from production.',
          'JMX snapshots every250ms can miss brief pool occupancy/wait spikes; loggedtimeouts counts messages, not a Micrometer timer.',
          'Combined PostgreSQL+backend CPU percentages approximate independently sampled intervals; exclude short-lived PostgreSQL children between samples.',
          'Warm cache and sequential ramp order permit JVM/JIT effects; no speedup or production-capacity inference.',
          '30write samples give an unstable p99(maximum);200read samples per ramp; sustained denominator reported separately.',
          'Clients are Python HTTP/SSE consumers with explicit cursor reconnect; browser EventSource behavior belongs to frontend/proxy validation.']}

def write_report(summary,destination):
    """Render measured outcomes and their denominators without promoting local results to an SLA."""
    runs=summary['runs'];main=next((r for r in runs if 'ramp-0' in r['results']),None)
    if main is None:raise ValueError('--report requires a main ramp run; JSON-only summaries support targeted runs.')
    qualified=not any(r['results'].get('connection-lock',{}).get('rest_200_under_500ms') is False for r in runs)
    results=main['results'];env=results.get('environment',{});lines=['# Local SSE capacity and recovery evidence','',
      'No production, VPS, Cloudflare, mail-provider or R2 connection was part of these experiments. All databases are disposable native PostgreSQL18 clusters. No Docker or production configuration change was used.','',
      '**Qualification: NO-GO for full SSE fault isolation.**' if not qualified else 'Qualification is limited to the checks and fault windows recorded below.','',
      'The normal ramp, burst, admission and explicit recovery checks completed. The later lease-table fault determines the bounded-REST verdict; a successful cursor-table fault alone cannot establish reserved connections for every SSE operation.','',
      f"Frozen backend SHA-256: `{env.get('jar_sha256','unknown')}`. Main evidence: `{main['raw_directory']}`. Aggregate machine-readable evidence: `summary.json`.",'',
      f"Environment: `{env.get('os','unknown')}`; PostgreSQL `{env.get('postgres_version','unknown')}`; Java version and runtime JIT are in `results.java`. JVM heap256m/1280m, Hikari max8/min2, PostgreSQL max_connections30. JVM and PostgreSQL share logical CPUs `{env.get('backend_cpus','unknown')}`. CPU0/1 on this host are SMT siblings of one physical core. Production's supplied budget is2vCPU/3.8GiB; host RAM is approximately15.5GiB and no3.8GiB memory cgroup was imposed. Evidence/PG resides on persistent ext4; the actual filesystem is retained in `results.environment.disk`.",'',
      'Synthetic data: '+json.dumps(env.get('cardinality',{}),sort_keys=True)+'. Fixtures use public business routines except direct synthetic correction inputs, event bursts and retention timestamps. The capacity runtime uses the scratch owner role, so restricted production-role parity belongs to the separate PostgreSQL gate. Mail and R2 are explicitly disabled.','',
      '## REST ramps','',
      'Each ramp has5s warmup,200 requests per read endpoint at concurrency4,30 fresh identity rejection decisions and30 distinct physical-order shipment transitions through REST. Cells show p50/p95/p99 in milliseconds. Warm sequential order permits cache/JIT effects; lower later latencies do not establish a benefit from SSE. Thirty write samples make p99 an unstable sample maximum.','',
      '| Operation | 0 streams | 32 streams | 64 streams | 128 streams | 128 / 32 users × 4 leases |',
      '| --- | ---: | ---: | ---: | ---: | ---: |']
    ramps=('ramp-0','ramp-32','ramp-64','ramp-128','ramp-128-multilease')
    for kind in ('rest','writes'):
        names=list(results.get('ramp-0',{}).get(kind,{}))
        for name in names:
            cells=[]
            for ramp in ramps:
                row=results.get(ramp,{}).get(kind,{}).get(name,{})
                cells.append('/'.join(str(row.get('p'+str(p)+'_ms','—')) for p in (50,95,99)))
            lines.append('| '+name+' | '+' | '.join(cells)+' |')
    steady=results.get('steady-128',{})
    lines+=['','The main130s steady window measured '+str(steady.get('reconnects','—'))+' retained-cursor readmissions, '+str(steady.get('marker_unique','—'))+'/'+str(steady.get('marker_events_expected','—'))+' unique markers, '+str(steady.get('marker_misrouted','—'))+' misroutes and '+str(len(steady.get('resumed_unexpected_resyncs',[])))+' unexpected resumed resyncs. Marker duplicate deliveries: '+str(steady.get('marker_duplicate_delivery','—'))+'.',
      'The first run seeded markers near0/20/40/60/80/100s and observed the second readmission cycle near120s. It verifies marker delivery spanning the first resume and second readmission without resync; it does not verify a newly seeded business marker after the second resume. The current harness adds that final marker for future runs.','',
      '| Steady endpoint | Samples | p95 ms | p99 ms | Errors |','| --- | ---: | ---: | ---: | ---: |']
    for name,row in steady.get('rest',{}).items():lines.append(f"| {name} | {row.get('n')} | {row.get('p95_ms')} | {row.get('p99_ms')} | {row.get('errors')} |")
    lines+=['','## Resources and pool behavior','',
      'JMX samples every250ms; resources/PostgreSQL every500ms. CPU is observed work averaged over each window: backend percentage uses one logical CPU; combined percentage divides the backend+sampled PostgreSQL work by two logical CPUs. These SMT siblings do not supply two physical cores. PostgreSQL CPU misses processes entirely between samples. PSS avoids repeatedly counting shared PostgreSQL pages. Sampling may miss short waits and peaks. Platform/OS thread counts do not count active virtual SSE tasks.','',
      '| Run / phase | JVM RSS MiB max | Heap used MiB max | PG PSS MiB max | JVM CPU % one CPU | Combined CPU % two logical CPUs | Pool active / pending max | PG connections max incl probes | GC count / ms delta | JMX window coverage |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
    for run in runs:
        selected=ramps+('steady-128','burst-1000','burst-10000','pool-exhaustion','connection-lock') if run is main else ('connection-lock',)
        for phase in selected:
            row=run['metrics'].get(phase)
            if not row:continue
            fields=[pathlib.Path(run['raw_directory']).name+' / '+phase,row.get('rss_max_mib'),row.get('heap_used_max_mib'),row.get('pg_pss_max_mib'),
              row.get('backend_cpu_percent_one_core'),row.get('combined_cpu_percent_two_cpu_allocation'),
              str(row.get('hikari_main_active_max'))+' / '+str(row.get('hikari_main_pending_max')),row.get('postgres_connections_max_including_sampler'),
              str(row.get('gc_collection_count_delta'))+' / '+str(row.get('gc_collection_time_ms_delta')),row.get('jmx_window_coverage_ratio')]
            lines.append('| '+' | '.join(map(str,fields))+' |')
    for run in runs:
        mon=run['monitoring']
        lines+=['',f"`{pathlib.Path(run['raw_directory']).name}`: {mon['resource_valid_samples']} valid resource samples, {mon['resource_error_samples']} errors ({json.dumps(mon['resource_errors_by_phase'],sort_keys=True)}); {sum(x['parsed'] for x in mon['jmx_files'].values())} parsed JMX rows, {mon['jmx_skipped_lines']} skipped lines. Hikari connection-timeout log messages: {run['logged_hikari_connection_timeout_messages']}; SSE HttpMessageNotWritableException log entries: {run['logged_sse_http_message_not_writable_exceptions']}."]
    lines+=['','## Admission, bursts and retention','',
      'Process admission with128 live HTTP streams and128 unexpired leases rejected the129th connection with429 / Retry-After60, both for128 users and32 users with four leases. Four leases for one user succeeded and the fifth received429 / Retry-After60. Idle client disconnect release of all four leases took '+str(round(results.get('disconnect-release',{}).get('all_four_leases_released_s',0),3))+'s; the next connection succeeded. This idle socket detection time is distinct from session revocation.','',
      '| Burst | Unique / expected | Missing / duplicate / misrouted | Publish p95 / p99 ms | Delivery p95 / p99 ms | Expired-row cleanup s |',
      '| --- | ---: | ---: | ---: | ---: | ---: |']
    for count in (1000,10000):
        row=results.get('burst-'+str(count),{});pub=row.get('publication',{});delivery=row.get('delivery',{})
        lines.append(f"| {count} | {row.get('unique')} / {row.get('n')} | {row.get('missing')} / {row.get('duplicate')} / {row.get('misrouted')} | {pub.get('p95_ms')} / {pub.get('p99_ms')} | {delivery.get('p95_ms')} / {delivery.get('p99_ms')} | {round(row.get('cleanup_elapsed_s',0),3)} |")
    lines+=['','Burst routing covers127 customers plus one administrator; every reader reached the final published head and settled2.2s before exact-set checks. Per-actor denominators and delivered frames are retained. Lag starts at the client commit acknowledgement, so it excludes the insert transaction itself. Cleanup ages only synthetic burst rows, observes bounded1000-row sweeps and confirms an old cursor receives resync. DELETE does not shrink allocated table bytes.','',
      '## Faults and recovery','']
    cursor=results.get('pool-exhaustion',{})
    lines.append('Cursor-table8s exclusive lock: '+str(cursor.get('active_sse_reads_max','—'))+' active SSE reads maximum; maximum query age '+str(cursor.get('active_sse_query_age_max_s','—'))+'s; four REST status/latency pairs '+json.dumps([{'status':r['status'],'ms':round(r['ms'],3)} for r in cursor.get('rest',[])])+'.')
    for run in runs:
        lock=run['results'].get('connection-lock',{})
        if not lock:continue
        lines+=['',f"Lease-table fault `{pathlib.Path(run['raw_directory']).name}`: {lock.get('active_disconnect_calls_max')} active blocked disconnect calls maximum, {lock.get('query_probe_valid_samples')} valid query samples / {lock.get('query_probe_errors')} errors. All REST200/<500ms verdict: **{lock.get('rest_200_under_500ms')}**."]
        for wave in lock.get('rest_waves',[]):
            rows=wave['requests'];lines.append(f"Wave scheduled at{wave['scheduled_offset_s']}s: "+', '.join(f"{r['status']}/{r['ms']:.3f}ms (invoked+{r['actual_offset_s']:.6f}s)" for r in rows)+'.')
    if any(r['results'].get('connection-lock',{}).get('rest_200_under_500ms') is False for r in runs):
        lines+=['','**Bounded REST access fails under the lease-table lock.** Four-read admission bounds reads only. Cleanup plus publisher work can occupy the entire eight-connection pool and delay REST. The earlier2.5s-only probe occurred before that saturation; independently scheduled4.5s/6.5s waves reveal it. No universal reserved-REST-connection or production128-stream-capacity claim follows.']
    revoke=results.get('session-revocation',{});back=results.get('backend-restart',{});pg=results.get('postgres-restart',{});kill=results.get('kill9-lease-expiry',{})
    lines+=['',f"Revocation: commit acknowledgement to close {revoke.get('commit_ack_to_close_ms')}ms; reconnect status {revoke.get('reconnect_status')}.",
      f"Backend restart: {back.get('ready_s')}s startup-to-ready; {round(back.get('end',0)-back.get('start',0),3)}s total observation including graceful shutdown. Explicit retained-cursor replay delivered the queued marker; a fresh stream received resync.",
      f"PostgreSQL restart: {pg.get('pg_restart_s')}s; post-restart REST status {pg.get('rest_status')} / {pg.get('rest_ms')}ms. Explicit retained-cursor replay and fresh resync passed. The first run did not retain delivery evidence for the old still-open stream; its open state is not automatic-recovery proof. The current harness adds an old-stream delivery-or-close assertion for future runs.",
      f"SIGKILL: {kill.get('leases_after_crash')} leases remained; reconnect before expiry {kill.get('reconnect_before_expiry_status')}; SQL expiry deadline {kill.get('scheduled_expiry_after_kill_s')}s after kill; first post-deadline probe {kill.get('reconnect_after_expiry_status')} at{kill.get('reconnect_at_after_kill_s')}s. The observed HTTP probe was after60s; the captured SQL deadline establishes expiry within60s, not an HTTP recovery measurement strictly before60s.",'',
      '## Evidence custody and limits','',
      'Summaries omit fixture credentials and contain synthetic IDs and timings. Raw JVM crash/JFR files may contain environment values and the generated synthetic JWT key; they remain in the private ignored evidence tree. Main run generation0 and2 JFR files have successful summary validation. SIGKILL left generation1 final output empty and an unfinished repository chunk; assembly produced a3,031,350-byte file which jfr summary rejected as a locked stream. This is partial/unreadable evidence, not a valid recovered profile. Original chunk, assembled file and failure text are retained. GC logs and JMX observations remain available for that generation.','',
      'The main Python process loaded once before post-start guard/report hardening. A names-only audit found no inherited SPRING_* or JDK_JAVA_OPTIONS/_JAVA_OPTIONS/JAVA_TOOL_OPTIONS overrides, so the existing target was not overridden. Future runs strip them. The late targeted run froze helper/source files and SHA-256 manifests in its harness directory. The initial main-run JMX CSV lacks the later configuration columns; generations1/2 and the targeted run confirm max8/min2 and heap max1280MiB. Main-run success status describes its implemented checks; the later targeted fault supplies the stronger failure verdict.','',
      'OS/JDK patch, synthetic cardinality, owner role, warm disk/cache, SMT topology, uncapped memory and Python HTTP clients differ from production. These observations are local engineering evidence, not Cloudflare/browser/TLS certification, a production p99 SLA, or authorization to deploy.']
    pathlib.Path(destination).write_text('\n'.join(lines)+'\n')

def throughput_range_lines(summary):
    before,after=summary['runs'][0],summary['runs'][-1];phases=['ramp-128-warm-'+str(i) for i in range(1,4)]
    if not all(p in run['results'] for run in (before,after) for p in phases):return []
    lines=['','## Throughput range qualification','',
      'Finite repeated windows do not establish zero overhead or strict throughput equivalence. The range column must be checked per endpoint; a gain above the old range is distinct from a reduction below it.','',
      '| Endpoint | Old RPS range | Final RPS range | Median RPS change % | All final windows inside old range |',
      '| --- | ---: | ---: | ---: | --- |']
    all_inside=True
    for path in before['results'][phases[0]]['rest']:
        old=[before['results'][p]['rest'][path]['throughput_rps'] for p in phases];new=[after['results'][p]['rest'][path]['throughput_rps'] for p in phases]
        inside=all(min(old)<=x<=max(old) for x in new);all_inside=all_inside and inside
        change=(statistics.median(new)/statistics.median(old)-1)*100
        lines.append(f"| {path} | {min(old):.3f}–{max(old):.3f} | {min(new):.3f}–{max(new):.3f} | {change:+.3f}% | {inside} |")
    if not all_inside:lines+=['','An assertion that every final request rate lies within the old observed range would be false. Retain the signed changes and individual windows instead of claiming no throughput cost.']
    return lines

def write_fixed_report(summary,destination):
    runs=summary['runs'];before=runs[0];after=runs[-1]
    phase_labels=lambda run:('ramp-0','ramp-128') if 'ramp-0' in run['results'] else ('ramp-0-warm','ramp-128-warm-3')
    before_zero,before_full=phase_labels(before);after_zero,after_full=phase_labels(after)
    checks=[before['run_status'].get('status')=='passed',after['run_status'].get('status')=='passed']
    for key in ('backend_cpus','postgres_cpus','heap','pool','postgres_max_connections','cardinality'):
        checks.append(before['results']['environment'].get(key)==after['results']['environment'].get(key))
    for run in (before,after):
        for phase in phase_labels(run):
            ramp=run['results'].get(phase,{})
            checks.append(len(ramp.get('rest',{}))==4 and all(row.get('n')==200 and row.get('errors')==0 for row in ramp.get('rest',{}).values()))
            checks.append(len(ramp.get('writes',{}))==2 and all(row.get('n')==30 for row in ramp.get('writes',{}).values()))
    for label in ('pool-exhaustion','connection-lock'):
        row=after['results'].get(label,{})
        checks.extend([row.get('rest_200_under_500ms') is True,0<row.get('active_sse_mixed_max',99)<=4,
          row.get('active_sse_including_publisher_max',99)<=5,row.get('active_sse_mixed_query_age_max_s',99)<2,
          row.get('post_fault_reconnect_status')==200,row.get('leases_after_recovery')==0])
        checks.append(all(r.get('status')==429 and r.get('retry_after')=='60' and r.get('problem_code')=='REALTIME_CONNECTION_LIMITED' for r in row.get('admission_during_lock',[])))
        if label=='connection-lock':checks.append(len(row.get('admission_during_lock',[]))==3)
    passed=all(checks)
    lines=['# SSE shared-pool correction: targeted verification','',
      '**Fault and functional checks: '+('PASS' if passed else 'FAIL / incomplete')+'.** This report covers the shared-pool correction and the two8s lock faults. The healthy latency comparison below requires separate warm replication before a performance conclusion. Earlier full-matrix evidence remains unchanged under capacity/. No production or external provider was contacted.','',
      f"Pre-fix SHA-256 `{before['results']['environment']['jar_sha256']}`; fixed SHA-256 `{after['results']['environment']['jar_sha256']}`.",'',
      f"Both runs use fresh native PostgreSQL18 clusters, PG55547/HTTP18094, CPU affinity24,25, JVM256m/1280m, Hikari max8/min2, max_connections30, identical143-user/501-edition/452-order/100-grant synthetic fixtures and disabled mail/R2. Each run retains its actual environment, topology, frozen helper sources and hashes. Host RAM is not capped at3.8GiB; logical CPU count is not physical-core/production-vCPU parity.",'',
      '## Healthy comparison','',
      'Each read cell is p50/p95 milliseconds (n200, concurrency4); each write cell is p50/p95 milliseconds (n30 fresh inputs). The table selects the initial0 and last128 window; for warm suites every window has200 actual GET warmups per endpoint and three128 windows are retained separately in the warm report. Sequential runs permit cache/JIT/scheduling variation; they do not establish a p99 SLA or statistically significant speedup.','',
      '| Operation | Pre0 | Fixed0 | Pre128 | Fixed128 | Fixed128 / pre128 p50,p95 |','| --- | ---: | ---: | ---: | ---: | ---: |']
    for kind in ('rest','writes'):
        for name in before['results'].get(before_zero,{}).get(kind,{}):
            rows=[r['results'].get(phase,{}).get(kind,{}).get(name,{}) for r,phase in ((before,before_zero),(after,after_zero),(before,before_full),(after,after_full))]
            cells=['/'.join(str(row.get('p'+str(p)+'_ms','—')) for p in (50,95)) for row in rows]
            ratios=[round(rows[3]['p'+str(p)+'_ms']/rows[2]['p'+str(p)+'_ms'],3) if rows[3].get('p'+str(p)+'_ms') is not None else '—' for p in (50,95)]
            lines.append('| '+name+' | '+' | '.join(cells)+' | '+', '.join(map(str,ratios))+' |')
    lines+=['','## Lock faults','',
      'Each fault opens128 streams and holds an ACCESS EXCLUSIVE relation lock for8s. Four independent REST workers per wave are scheduled at2.5/4.5/6.5s; a slow early wave cannot delay later invocations. The100ms PostgreSQL probe counts connect/read/disconnect together in one snapshot and reports publisher activity separately. The gate requires mixed≤4, mixed+publisher≤5, query age<2s and every REST200/<500ms. Samples cannot prove absence of a sub100ms transient; source/unit coverage establishes the budget boundary.','',
      '| Fault | Wave offset s | REST status codes | Min / max ms | Actual invocation offset range s |','| --- | ---: | --- | ---: | ---: |']
    for label in ('pool-exhaustion','connection-lock'):
        row=after['results'].get(label,{})
        for wave in row.get('rest_waves',[]):
            rs=wave['requests'];lines.append(f"| {label} | {wave['scheduled_offset_s']} | {','.join(str(x['status']) for x in rs)} | {min(x['ms'] for x in rs):.3f} / {max(x['ms'] for x in rs):.3f} | {min(x['actual_offset_s'] for x in rs):.6f}–{max(x['actual_offset_s'] for x in rs):.6f} |")
        lines+=['',f"{label}: {row.get('query_probe_valid_samples')} valid SQL samples, {row.get('query_probe_errors')} errors; mixed maximum {row.get('active_sse_mixed_max')}, including publisher {row.get('active_sse_including_publisher_max')}, max mixed query age {row.get('active_sse_mixed_query_age_max_s')}s. {row.get('closed_streams_after_lock')} streams had closed while fault work timed out; {row.get('leases_after_lock')} leases remained after the lock; last captured original expiry was {row.get('max_original_lease_expiry_after_lock_s')}s away. All leases later cleared ({row.get('leases_after_recovery')} remaining), reconnect status {row.get('post_fault_reconnect_status')}. Observed lease recovery relative to captured maximum expiry: {row.get('lease_recovery_beyond_expiry_s')}s; a negative value means successful post-lock cleanup cleared them earlier."]
        for r in row.get('admission_during_lock',[]):lines.append(f"Admission+{r['scheduled_offset_s']}s: status {r['status']}, Retry-After {r['retry_after']}, code {r['problem_code']}, {r['ms']:.3f}ms; {r['closed_streams_before_probe']} original clients already closed.")
    lines+=['','## Sampled resources','',
      '| Run / phase | JVM RSS MiB max | Heap MiB max | PG PSS MiB max | Pool active/pending max | PG connections incl probes max | JVM CPU % one logical CPU | GC count/ms delta |','| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
    for r in runs:
        for phase in ('ramp-0','ramp-128','ramp-0-warm','ramp-128-warm-1','ramp-128-warm-2','ramp-128-warm-3','pool-exhaustion','connection-lock'):
            m=r['metrics'].get(phase)
            if not m:continue
            cells=[pathlib.Path(r['raw_directory']).name+' / '+phase,m['rss_max_mib'],m['heap_used_max_mib'],m.get('pg_pss_max_mib'),
              str(m['hikari_main_active_max'])+'/'+str(m['hikari_main_pending_max']),m['postgres_connections_max_including_sampler'],m['backend_cpu_percent_one_core'],
              str(m['gc_collection_count_delta'])+'/'+str(m['gc_collection_time_ms_delta'])]
            lines.append('| '+' | '.join(map(str,cells))+' |')
        lines+=['',f"{pathlib.Path(r['raw_directory']).name}: execution status {r['run_status'].get('status')}; Hikari timeout log messages {r['logged_hikari_connection_timeout_messages']}; HttpMessageNotWritableException stack entries {r['logged_sse_http_message_not_writable_exceptions']}; monitoring {json.dumps(r['monitoring'],sort_keys=True)}."]
    lines+=['','JMX is sampled250ms and resources500ms; PSS avoids shared-page double counting. PostgreSQL CPU omits children that live between samples. Raw CSV/JSONL, REST/write observations, lock probes, JFR/GC logs, source snapshots and run status stay in the private ignored evidence tree. Summaries omit fixture credentials. The expected exit status for fixed --expect-bounded is0; a measurement failure is emitted before a nonzero exit. Full browser/Cloudflare/release qualification remains outside this targeted run.']
    lines+=throughput_range_lines(summary)
    pathlib.Path(destination).write_text('\n'.join(lines)+'\n')

def write_warm_report(summary,destination):
    before,after=summary['runs'][0],summary['runs'][-1]
    phases=['ramp-0-warm']+['ramp-128-warm-'+str(i) for i in range(1,4)]
    valid=all(run['run_status'].get('status')=='passed' and all(phase in run['results'] for phase in phases) for run in (before,after))
    for run in (before,after):
        for phase in phases:
            row=run['results'].get(phase,{})
            valid=valid and len(row.get('read_warmup',{}))==4 and all(x.get('n')==200 and x.get('errors')==0 for x in row.get('read_warmup',{}).values())
            valid=valid and len(row.get('rest',{}))==4 and all(x.get('n')==200 and x.get('errors')==0 for x in row.get('rest',{}).values())
    lines=['# Warm paired healthy SSE comparison','',
      'Execution and denominator checks: **'+('PASS' if valid else 'FAIL / incomplete')+'**. This is repeated local latency evidence; it does not automatically establish performance equivalence or a production SLA.','',
      'Old SHA-256 `'+before['results']['environment']['jar_sha256']+'`; corrected SHA-256 `'+after['results']['environment']['jar_sha256']+'`. Both artifacts use fresh matching fixtures, the same CPU24,25/Hikari8/2/PG30/JVM256m/1280m settings and an exclusive measurement window. Root heavy tests remain paused until both runs finish.','',
      'One JVM per artifact runs an initial0-stream window and then three128-stream windows. Before every measured window each endpoint receives200 actual GET warmups at concurrency4, followed by200 measured GETs at concurrency4. Thirty fresh identity decisions and30 distinct shipment transitions follow each window (120 of each per artifact). JMX window timestamps exclude read warmup and include the measured reads plus writes. Endpoint throughput is200 divided by its measured wall time.','',
      '| Window | Endpoint | Pre p50/p95/p99 ms | Fixed p50/p95/p99 ms | Pre / fixed requests per second | Pre / fixed endpoint seconds |','| --- | --- | ---: | ---: | ---: | ---: |']
    for phase in phases:
        a=before['results'].get(phase,{});z=after['results'].get(phase,{})
        for path,old in a.get('rest',{}).items():
            new=z.get('rest',{}).get(path,{})
            cell=lambda r:'/'.join(str(r.get('p'+str(p)+'_ms','—')) for p in (50,95,99))
            lines.append(f"| {phase} | {path} | {cell(old)} | {cell(new)} | {old.get('throughput_rps',0):.3f} / {new.get('throughput_rps',0):.3f} | {old.get('elapsed_s',0):.3f} / {new.get('elapsed_s',0):.3f} |")
    lines+=['','## Three-window summaries','',
      'These are medians of three window statistics, not pooled request percentiles. Ranges expose phase variation. Ratios above1 mean a larger corrected latency. A causal JIT or round-trip claim needs supporting traces, not the ratio alone.','',
      '| Endpoint | Pre / fixed median p50 ms | p50 ratio | Pre / fixed median p95 ms | p95 ratio | Pre p95 range | Fixed p95 range |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for path in before['results'].get(phases[1],{}).get('rest',{}):
        a=[before['results'][p]['rest'][path] for p in phases[1:]];z=[after['results'][p]['rest'][path] for p in phases[1:]]
        median=lambda rs,q:statistics.median(r['p'+str(q)+'_ms'] for r in rs)
        lines.append(f"| {path} | {median(a,50):.3f} / {median(z,50):.3f} | {median(z,50)/median(a,50):.3f} | {median(a,95):.3f} / {median(z,95):.3f} | {median(z,95)/median(a,95):.3f} | {min(r['p95_ms'] for r in a):.3f}–{max(r['p95_ms'] for r in a):.3f} | {min(r['p95_ms'] for r in z):.3f}–{max(r['p95_ms'] for r in z):.3f} |")
    if len(summary['runs'])>2:
        lines+=['','## Intermediate and final artifact medians','',
          '| Artifact | Endpoint | Median p50 / p95 ms | Median requests per second |','| --- | --- | ---: | ---: |']
        for run in summary['runs']:
            for path in before['results'].get(phases[1],{}).get('rest',{}):
                rows=[run['results'][p]['rest'][path] for p in phases[1:]]
                lines.append(f"| {pathlib.Path(run['raw_directory']).name} | {path} | {statistics.median(r['p50_ms'] for r in rows):.3f} / {statistics.median(r['p95_ms'] for r in rows):.3f} | {statistics.median(r['throughput_rps'] for r in rows):.3f} |")
    lines+=['','## Per-window CPU, heap, GC and pool','',
      '| Artifact / window | Measured span s | Backend CPU seconds / % one logical CPU | Combined CPU % two logical CPUs | GC count / ms | JVM RSS / heap MiB max | Main pool active / pending max | JMX samples / coverage |','| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
    for run in summary['runs']:
        for phase in phases:
            m=run['metrics'].get(phase)
            if not m:continue
            lines.append(f"| {pathlib.Path(run['raw_directory']).name} / {phase} | {m['window_seconds']:.3f} | {m['backend_cpu_seconds']:.3f} / {m['backend_cpu_percent_one_core']:.3f} | {m.get('combined_cpu_percent_two_cpu_allocation')} | {m['gc_collection_count_delta']} / {m['gc_collection_time_ms_delta']} | {m['rss_max_mib']} / {m['heap_used_max_mib']} | {m['hikari_main_active_max']} / {m['hikari_main_pending_max']} | {m['jmx_samples']} / {m['jmx_window_coverage_ratio']} |")
        lines+=['',f"{pathlib.Path(run['raw_directory']).name}: Hikari timeout messages {run['logged_hikari_connection_timeout_messages']}, SSE HttpMessageNotWritableException stack entries {run['logged_sse_http_message_not_writable_exceptions']}; monitoring {json.dumps(run['monitoring'],sort_keys=True)}."]
    lines+=['','All raw warmup/measured rows, window timestamps, JVM/JMX/PG affinity, GC/JFR and source hashes remain under the two run directories. CPU24/25 are SMT siblings on this host; uncapped host memory and warm synthetic data do not certify production capacity. GC/JMX samples may miss brief activity; trace files retain timing for a deeper compilation or pause analysis.']
    lines+=throughput_range_lines(summary)
    pathlib.Path(destination).write_text('\n'.join(lines)+'\n')

def write_aba_report(summary,destination):
    if len(summary['runs'])!=3:raise ValueError('--aba-report requires old-before, optimized, old-after in that order.')
    a,b,c=summary['runs'];phases=['ramp-128-warm-'+str(i) for i in range(1,4)]
    valid=all(r['run_status'].get('status')=='passed' and all(p in r['results'] for p in phases) for r in (a,b,c))
    same_old=a['results']['environment']['jar_sha256']==c['results']['environment']['jar_sha256']
    lines=['# Reverse old-artifact control (ABA)','',
      'Execution checks: **'+('PASS' if valid and same_old else 'FAIL / incomplete')+'**. Old-before and old-after use the same JAR; every run uses the same warmup, fixture and pinned resource settings. Root heavy jobs were held during each measurement.','',
      'Artifact SHA-256 values: '+', '.join(pathlib.Path(r['raw_directory']).name+' `'+r['results']['environment']['jar_sha256']+'`' for r in (a,b,c))+'.','',
      'Each cell lists three measured request rates after200 GET warmups per endpoint. Each measured window has200 GETs at concurrency4. Reverse control tests sequential host/JIT variation; it does not prove strict performance equivalence or identify a cause by itself.','',
      '| Endpoint | Old-before RPS windows | Optimized RPS windows | Old-after RPS windows | Median optimized / before | Median optimized / after | Median after / before |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for path in a['results'][phases[0]]['rest']:
        values=[[r['results'][p]['rest'][path]['throughput_rps'] for p in phases] for r in (a,b,c)]
        med=[statistics.median(v) for v in values];cells=[', '.join(f'{v:.3f}' for v in vs) for vs in values]
        lines.append('| '+path+' | '+' | '.join(cells)+f' | {med[1]/med[0]:.3f} | {med[1]/med[2]:.3f} | {med[2]/med[0]:.3f} |')
    lines+=['','## Median and spread of latency','',
      '| Endpoint | Artifact | Median p50 / p95 ms | p95 window range ms | RPS window range |','| --- | --- | ---: | ---: | ---: |']
    for path in a['results'][phases[0]]['rest']:
        for run in (a,b,c):
            rows=[run['results'][p]['rest'][path] for p in phases]
            lines.append(f"| {path} | {pathlib.Path(run['raw_directory']).name} | {statistics.median(x['p50_ms'] for x in rows):.3f} / {statistics.median(x['p95_ms'] for x in rows):.3f} | {min(x['p95_ms'] for x in rows):.3f}–{max(x['p95_ms'] for x in rows):.3f} | {min(x['throughput_rps'] for x in rows):.3f}–{max(x['throughput_rps'] for x in rows):.3f} |")
    lines+=['','Raw observations and per-window CPU/GC/pool metrics remain in the accompanying JSON summary. Both original and reverse old controls remain included; no run is excluded or replaced.']
    pathlib.Path(destination).write_text('\n'.join(lines)+'\n')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('runs',nargs='+');p.add_argument('--output',required=True);p.add_argument('--report');p.add_argument('--fixed-report');p.add_argument('--warm-report');p.add_argument('--aba-report');args=p.parse_args()
    result={'runs':[summarize(x) for x in args.runs]}
    pathlib.Path(args.output).write_text(json.dumps(result,indent=2)+'\n')
    if args.report:write_report(result,args.report)
    if args.fixed_report:write_fixed_report(result,args.fixed_report)
    if args.warm_report:write_warm_report(result,args.warm_report)
    if args.aba_report:write_aba_report(result,args.aba_report)

if __name__=='__main__':main()
