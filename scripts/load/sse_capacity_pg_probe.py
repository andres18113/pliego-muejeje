#!/usr/bin/env python3
"""Observe scratch SSE read query age during the capacity runner's lock fault."""
import argparse,json,os,pathlib,subprocess,time

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True);p.add_argument('--pg-bin',default='/usr/lib/postgresql/18/bin');p.add_argument('--port',type=int,default=55547)
    p.add_argument('--now',action='store_true',help='Start immediately (runner owns the phase).');p.add_argument('--duration',type=float,default=14)
    p.add_argument('--name',default='pool',help='Output prefix for an independent fault.');args=p.parse_args()
    if os.environ.get('PLIEGO_TEST_DISPOSABLE_DB')!='1' or args.port in (5432,55436,55539) or args.port<1024:raise SystemExit('Explicit disposable guard and dedicated scratch port required; never55539.')
    out=pathlib.Path(args.output).resolve()
    if out==pathlib.Path('/tmp') or pathlib.Path('/tmp') in out.parents:raise SystemExit('Persistent evidence directory required, never /tmp.')
    deadline=time.monotonic()+1200
    while not args.now and time.monotonic()<deadline:
        try:phase=json.loads((out/'resources.jsonl').read_text().splitlines()[-1]).get('phase')
        except (OSError,ValueError,IndexError):phase=None
        if phase=='pool-exhaustion':break
        time.sleep(.3)
    if not args.now and phase!='pool-exhaustion':raise SystemExit('Pool phase not reached.')
    env={k:v for k,v in os.environ.items() if k not in ('PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGPASSWORD','PGOPTIONS')}
    query="""WITH observed AS MATERIALIZED (
      SELECT pid,state,query_start,wait_event_type,CASE
        WHEN query LIKE '%fn_realtime_read(%' THEN 'read'
        WHEN query LIKE '%fn_realtime_connect(%' THEN 'connect'
        WHEN query LIKE '%fn_realtime_disconnect(%' THEN 'disconnect'
        WHEN query LIKE '%fn_realtime_publish(%' THEN 'publish' END AS kind
      FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database()
    ) SELECT json_build_object('at',extract(epoch FROM clock_timestamp()),
      'active_reads',count(*) FILTER(WHERE state='active' AND kind='read'),
      'max_age_s',coalesce(max(extract(epoch FROM clock_timestamp()-query_start)) FILTER(WHERE state='active' AND kind='read'),0),
      'waiting_locks',count(*) FILTER(WHERE wait_event_type='Lock' AND kind='read'),
      'pids',json_agg(pid) FILTER(WHERE state='active' AND kind='read'),
      'disconnect_calls',count(*) FILTER(WHERE state='active' AND kind='disconnect'),
      'connect_calls',count(*) FILTER(WHERE state='active' AND kind='connect'),
      'active_mixed',count(*) FILTER(WHERE state='active' AND kind IN('read','connect','disconnect')),
      'max_mixed_age_s',coalesce(max(extract(epoch FROM clock_timestamp()-query_start)) FILTER(WHERE state='active' AND kind IN('read','connect','disconnect')),0),
      'mixed_waiting_locks',count(*) FILTER(WHERE wait_event_type='Lock' AND kind IN('read','connect','disconnect')),
      'publisher_calls',count(*) FILTER(WHERE state='active' AND kind='publish'),
      'postgres_connections_including_probe',count(*)+1) FROM observed"""
    command=[args.pg_bin+'/psql','-h','127.0.0.1','-p',str(args.port),'-U','capacity','-d','capacity','-XAt','-v','ON_ERROR_STOP=1','-c',query]
    start=time.monotonic()
    if not args.name.replace('-','').isalnum():raise SystemExit('Invalid output prefix.')
    with (out/(args.name+'-query-age.jsonl')).open('w') as f:
        while time.monotonic()-start<args.duration:
            r=subprocess.run(command,capture_output=True,text=True,timeout=3,env=env)
            if r.returncode==0:f.write(r.stdout);f.flush()
            else:f.write(json.dumps({'at':time.time(),'probe_error':r.returncode})+'\n');f.flush()
            time.sleep(.1)

if __name__=='__main__':main()
