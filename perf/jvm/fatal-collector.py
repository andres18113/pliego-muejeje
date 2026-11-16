#!/usr/bin/env python3
"""Best-effort inotify collector; open crash files survive private/tmp unlink."""
import argparse, ctypes, datetime, fnmatch, json, os, pathlib, select, struct, time

def snapshot(fd,dest):
 os.lseek(fd,0,os.SEEK_SET)
 with dest.open('wb') as out:
  while block:=os.read(fd,1024*1024):out.write(block)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--watch',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--seconds',type=int,default=7800);a=p.parse_args()
 if not 1<=a.seconds<=10800:p.error('seconds must be1..10800')
 a.out.mkdir(parents=True,exist_ok=False);os.chmod(a.out,0o700);rootfd=os.open(a.watch,os.O_RDONLY|os.O_DIRECTORY);libc=ctypes.CDLL(None,use_errno=True);fd=libc.inotify_init1(os.O_NONBLOCK|os.O_CLOEXEC)
 if fd<0:raise OSError(ctypes.get_errno(),'inotify_init1')
 if libc.inotify_add_watch(fd,os.fsencode(a.watch),0x100|0x80|0x2|0x8|0x400|0x800)<0:raise OSError(ctypes.get_errno(),'inotify_add_watch')
 opened={};started=time.monotonic()
 def capture(name):
  if not any(fnmatch.fnmatch(name,p) for p in ['hs_err_pid*.log','replay_pid*.log']):return
  try:
   q=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=rootfd)
   inode=os.fstat(q).st_ino
   if name in opened and os.fstat(opened[name]).st_ino==inode:os.close(q)
   else:
    if name in opened:os.close(opened[name])
    opened[name]=q
  except FileNotFoundError:return
  snapshot(opened[name],a.out/name)
 (a.out/'ready.json').write_text(json.dumps({'watch':str(a.watch.resolve()),'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':a.seconds}))
 try:
  while time.monotonic()-started<a.seconds:
   if not select.select([fd],[],[],max(0,min(.25,a.seconds-(time.monotonic()-started))))[0]:continue
   data=os.read(fd,1024*1024);offset=0
   while offset<len(data):
    wd,mask,cookie,size=struct.unpack_from('iIII',data,offset);offset+=16;name=os.fsdecode(data[offset:offset+size].split(b'\0')[0]);offset+=size
    if name:capture(name)
    with (a.out/'events.jsonl').open('a') as log:log.write(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mask':mask,'name':name})+'\n')
   for name,q in opened.items():snapshot(q,a.out/name)
 finally:
  for name,q in opened.items():snapshot(q,a.out/name);os.close(q)
  os.close(rootfd);os.close(fd)
 (a.out/'result.json').write_text(json.dumps({'elapsed_seconds':time.monotonic()-started,'captured_files':list(opened),'scope':'best effort; cannot capture a file deleted before its create event is serviced'}));return 0
if __name__=='__main__':raise SystemExit(main())
