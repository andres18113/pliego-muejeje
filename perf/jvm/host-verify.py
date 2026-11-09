#!/usr/bin/env python3
"""Bounded user-space known-pattern memory/hash checks; no devices or privileged APIs."""
import argparse, hashlib, json, os, time
p=argparse.ArgumentParser(); p.add_argument('--core',type=int,required=True); p.add_argument('--seconds',type=int,default=60); p.add_argument('--mib',type=int,default=128); a=p.parse_args()
if not 1<=a.seconds<=90 or not 1<=a.mib<=128: p.error('bounds: <=90 seconds and <=128 MiB per worker')
os.sched_setaffinity(0,{a.core})
# Known-answer SHA-256 checks complement comparisons across the allocated user-space region.
assert hashlib.sha256(b'abc').hexdigest()=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
assert pow(123456789,12345,1000000007)==614455772
block=bytes(range(256))*4096; data=bytearray(a.mib*1024*1024); expected=hashlib.sha256();
for _ in range(a.mib): expected.update(block)
expected=expected.digest(); started=time.monotonic(); rounds=0
while time.monotonic()-started<a.seconds:
 for offset in range(0,len(data),len(block)): data[offset:offset+len(block)]=block
 if hashlib.sha256(data).digest()!=expected: raise RuntimeError('memory hash mismatch')
 if pow(123456789,12345,1000000007)!=614455772: raise RuntimeError('integer known-answer mismatch')
 rounds+=1
print(json.dumps({'core':a.core,'affinity':sorted(os.sched_getaffinity(0)),'mib':a.mib,'seconds':time.monotonic()-started,'rounds':rounds,'bytes_verified':rounds*len(data),'status':'PASS','scope':'user-space pattern/hash checks; not hardware certification'}))
