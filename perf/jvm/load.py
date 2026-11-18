#!/usr/bin/env python3
"""Run the unchanged k6 journeys from a separate generator for >=2h at15 VUs."""
import argparse, datetime, hashlib, ipaddress, json, os, pathlib, socket, subprocess, urllib.parse

def validate_target(url,allowlist):
 u=urllib.parse.urlsplit(url); host=(u.hostname or '').lower().rstrip('.')
 if host=='pliegolibros.com' or host.endswith('.pliegolibros.com'):raise ValueError('production domain refused')
 if not (u.scheme=='http' and u.port and not u.username and not u.password and u.path in ('','/') and not u.query and not u.fragment):raise ValueError('explicit HTTP staging origin and port required')
 allowed={x.strip().lower().rstrip('.') for x in allowlist.split(',') if x.strip()}
 if host not in allowed:raise ValueError('host absent from explicit exact allowlist')
 addresses=socket.getaddrinfo(host,u.port,type=socket.SOCK_STREAM)
 if not addresses or not all(ipaddress.ip_address(x[4][0]).is_private or ipaddress.ip_address(x[4][0]).is_loopback for x in addresses):raise ValueError('only private staging/tunnel addresses allowed')
 return sorted({x[4][0] for x in addresses})

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base-url',required=True);p.add_argument('--allow-hosts',required=True);p.add_argument('--fixtures',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--hold',type=int,default=7200);p.add_argument('--k6',default='/usr/bin/k6');p.add_argument('--sse',action='store_true');p.add_argument('--staging-only',action='store_true',required=True);a=p.parse_args()
 if a.hold<7200:p.error('hold must be at least7200 seconds')
 resolved=validate_target(a.base_url,a.allow_hosts);fixtures=a.fixtures.resolve();data=json.loads(fixtures.read_text())
 if len(data.get('customers',[]))<15:raise ValueError('at least15 independent synthetic customer fixtures required')
 suite=pathlib.Path(__file__).resolve().parents[1]/'k6/journeys.js';a.out.mkdir(parents=True,exist_ok=False);os.chmod(a.out,0o700);out=a.out.resolve()
 env={'PATH':'/usr/bin:/bin','BENCHMARK_DISPOSABLE':'1','BENCHMARK_STAGING':'1','BENCHMARK_ALLOWED_HOSTS':a.allow_hosts,'BASE_URL':a.base_url,'FIXTURES':str(fixtures),'VUS':'15','HOLD':str(a.hold)+'s','SSE':'1' if a.sse else '0','SSE_DURATION':str(a.hold+30)+'s','SUMMARY':str(out/'summary.json'),'K6_NO_USAGE_REPORT':'true','K6_NO_COLOR':'true','K6_NO_SETUP':'false'}
 cmd=[a.k6,'run','--out','json='+str(out/'raw.json'),str(suite)]
 invocation={'argv':cmd,'environment':env,'resolved_target_addresses':resolved,'suite_sha256':hashlib.sha256(suite.read_bytes()).hexdigest(),'fixtures_sha256':hashlib.sha256(fixtures.read_bytes()).hexdigest(),'start_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'steady_vus':15,'steady_hold_seconds':a.hold,'generator_must_be_separate_from_target':True}
 (out/'invocation.json').write_text(json.dumps(invocation,indent=2))
 with (out/'k6.log').open('w') as log:
  try:rc=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=a.hold+240).returncode
  except subprocess.TimeoutExpired:rc=124
 result={'exit_status':rc,'end_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'LOAD_PASS_PENDING_MONITOR_AND_DB_REVIEW' if rc==0 else 'FAIL'};(out/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));return rc
if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as e:print('FAIL: '+str(e));raise SystemExit(2)
