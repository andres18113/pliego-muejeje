#!/usr/bin/env python3
"""Replay copied compiler input; each attempt gets a fresh writable directory."""
import argparse, datetime, hashlib, json, os, pathlib, resource, subprocess, time
p=argparse.ArgumentParser();p.add_argument('--jdk',type=pathlib.Path,required=True);p.add_argument('--evidence',type=pathlib.Path,required=True);p.add_argument('--label',required=True);p.add_argument('--cores',default='0,2,4,16');p.add_argument('--repeats',type=int,default=10);a=p.parse_args()
r=a.evidence.resolve(); root=r/'replays'/a.label;root.mkdir(parents=True,exist_ok=False); resource.setrlimit(resource.RLIMIT_CORE,(0,0))
cp=str(r/'classpath/BOOT-INF/classes')+':'+str(r/'classpath/BOOT-INF/lib/*'); results=[]
for core in map(int,a.cores.split(',')):
 for n in range(a.repeats):
  d=root/f'core{core}-{n+1:02}';d.mkdir();cmd=['taskset','-c',str(core),str(a.jdk.resolve()/'bin/java'),'-Xms256m','-Xmx1280m','-XX:+UnlockDiagnosticVMOptions','-XX:+ReplayCompiles','-XX:ReplayDataFile='+str(r/'inputs/replay_pid112.log'),'-XX:+ReplayIgnoreInitErrors','-XX:ErrorFile='+str(d/'hs_err_pid%p.log'),'-XX:+PrintCompilation','-cp',cp]
  start=datetime.datetime.now(datetime.timezone.utc).isoformat();t=time.monotonic()
  with (d/'output.log').open('w') as log:
   try: status=subprocess.run(cmd,cwd=d,env={'PATH':'/usr/bin:/bin','HOME':str(d)},stdout=log,stderr=subprocess.STDOUT,timeout=60).returncode
   except subprocess.TimeoutExpired: status=124
   log.write('\nEXIT_STATUS='+str(status)+'\n')
  text=(d/'output.log').read_text();target='PrometheusMeterRegistry::lambda$addDistributionStatisticSamples$0' in text
  row={'argv':cmd,'core':core,'repeat':n+1,'start':start,'seconds':time.monotonic()-t,'exit_status':status,'target_compile_seen':target,'fatal_files':[x.name for x in d.glob('hs_err*')]};(d/'command.json').write_text(json.dumps(row,indent=2)+'\n');results.append(row)
  with (r/'commands.jsonl').open('a') as f:f.write(json.dumps(row)+'\n')
  (root/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(f'core={core} repeat={n+1} exit={status} target={target}',flush=True)
