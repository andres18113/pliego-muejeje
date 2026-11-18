#!/usr/bin/env python3
"""Opt-in encrypted invoice object copy; attended verify uses a restored DB and offline key.
Only curl, GPG, PostgreSQL client and Python stdlib are required at runtime.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

INVENTORY_SQL = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='60s';
SELECT COALESCE(json_agg(x ORDER BY object_key), '[]'::json)
FROM (SELECT object_key, checksum::text, size_bytes
      FROM pliego.factura_archivo WHERE storage_kind='R2') x;
COMMIT;"""
MAX_BYTES = 10485760

def digest(data):
    return hashlib.sha256(data).hexdigest()

def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()

def safe_key(key):
    if not isinstance(key,str) or not re.fullmatch(r'[A-Za-z0-9._/-]+',key) or key.startswith('/') or '..' in key:
        raise ValueError('Unsafe object key')
    return key

def validate_inventory(rows, prefix):
    safe_key(prefix)
    if not prefix.endswith('/') or not isinstance(rows,list):
        raise ValueError('Invalid source prefix/inventory')
    seen={}
    for row in rows:
        key=safe_key(row['object_key'])
        if not key.startswith(prefix) or not re.fullmatch('[a-f0-9]{64}',row.get('checksum') or ''):
            raise ValueError('Invalid source scope/checksum')
        if type(row.get('size_bytes')) is not int or not 1 <= row['size_bytes'] <= MAX_BYTES:
            raise ValueError('Invalid source size')
        if key in seen and seen[key] != row:
            raise ValueError('Conflicting object metadata')
        seen[key]=row
    return sorted(seen.values(),key=lambda row:row['object_key'])

def verify_plain(data, row):
    if data is None or len(data)!=row['size_bytes'] or digest(data)!=row['checksum']:
        raise ValueError('Object bytes do not match database checksum/size')

def database_inventory(prefix):
    proc=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',INVENTORY_SQL],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=70)
    return validate_inventory(json.loads(proc.stdout),prefix)

def file_inventory(path,prefix,expected_sha256):
    data=path.read_bytes()
    if not re.fullmatch('[a-f0-9]{64}',expected_sha256 or '') or digest(data)!=expected_sha256:
        raise ValueError('Offline inventory must match independently approved SHA256')
    return validate_inventory(json.loads(data),prefix)

class Store:
    def __init__(self, endpoint, bucket, credential, work, name, readonly=False):
        local=os.environ.get('PLIEGO_OBJECT_BACKUP_TEST_LOCAL')=='1'
        pattern=r'http://127\.0\.0\.1:[0-9]+' if local else r'https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com'
        if not re.fullmatch(pattern,endpoint) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]',bucket):
            raise ValueError('Expected reviewed R2 endpoint/bucket (loopback only in local tests)')
        self.endpoint,self.bucket,self.work,self.readonly=endpoint,bucket,work,readonly
        c=json.loads(Path(credential).read_text())
        for key in ['access_key','secret_key']:
            if not re.fullmatch(r'[A-Za-z0-9/+=_-]+',c[key]):raise ValueError('Invalid credential encoding')
        expiry=dt.datetime.fromisoformat(c['expires_at'].replace('Z','+00:00'))
        if expiry.tzinfo is None or expiry <= dt.datetime.now(dt.timezone.utc):raise ValueError('Object credential expired')
        self.config=work/(name+'.curl')
        self.config.write_text('user = "'+c['access_key']+':'+c['secret_key']+'"\n')
        self.config.chmod(0o600)

    def request(self, method, key, data=None, optional=False):
        safe_key(key)
        if self.readonly and method!='GET':raise ValueError('Source is read-only')
        out=self.work/'response';payload=self.work/'request'
        command=['curl','--silent','--show-error','--noproxy','*','--connect-timeout','10','--max-time','180',
                 '--aws-sigv4','aws:amz:auto:s3','--config',str(self.config),'--max-filesize',str(MAX_BYTES*4),
                 '--output',str(out),'--write-out','%{http_code}']
        if method=='PUT':
            payload.write_bytes(data)
            command+=['--upload-file',str(payload),'--header','x-amz-content-sha256:'+digest(data)]
        elif method!='GET':raise ValueError('Unsupported store operation')
        command+=[self.endpoint+'/'+self.bucket+'/'+key]
        result=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=190)
        if result.returncode:raise RuntimeError('Object transfer failed')
        if result.stdout==b'404' and optional:return None
        if result.stdout not in [b'200',b'201',b'204']:raise RuntimeError('Object store HTTP '+result.stdout.decode(errors='replace'))
        return out.read_bytes()

    def put_verified(self,key,data):
        # No overwrite. Recover idempotently when an earlier run uploaded these exact bytes.
        previous=self.request('GET',key,optional=True)
        if previous is not None:
            if previous!=data:raise ValueError('Existing backup object differs; refusing overwrite')
            return
        self.request('PUT',key,data)
        if self.request('GET',key)!=data:raise ValueError('Object readback mismatch')

def crypt(data,work,*,decrypt=False):
    command=['gpg','--batch','--no-tty']
    if decrypt:command+=['--decrypt']
    else:
        recipient=os.environ['OBJECT_BACKUP_RECIPIENT']
        if not re.fullmatch(r'[A-Fa-f0-9]{40,64}',recipient):raise ValueError('Full recipient fingerprint required')
        command+=['--no-default-keyring','--keyring',os.environ['OBJECT_BACKUP_PUBLIC_KEYRING'],
                  '--trust-model','always','--recipient',recipient,'--cipher-algo','AES256','--compress-algo','none','--encrypt']
    if not decrypt:
        homedir=Path(os.environ.get('GNUPGHOME',str(work/'gpg')))
        homedir.mkdir(mode=0o700,parents=True,exist_ok=True)
        command[1:1]=['--homedir',str(homedir)]
    proc=subprocess.run(command,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
    if proc.returncode:raise RuntimeError('GPG decryption/encryption failed')
    return proc.stdout

def namespace(prefix):
    safe_key(prefix)
    recipient=os.environ['OBJECT_BACKUP_RECIPIENT'].upper()
    if not prefix.endswith('/') or not re.fullmatch(r'[A-F0-9]{40,64}',recipient):raise ValueError('Invalid backup namespace')
    return prefix+recipient+'/'

def load_blob(target,base,plainsha):
    if not re.fullmatch('[a-f0-9]{64}',plainsha):raise ValueError('Invalid plaintext digest')
    marker_bytes=target.request('GET',base+'index/'+plainsha+'/complete.json',optional=True)
    if marker_bytes is None:return None
    marker=json.loads(marker_bytes)
    cipher_sha=marker['cipher_sha256']
    if marker.get('plain_sha256')!=plainsha or not re.fullmatch('[a-f0-9]{64}',cipher_sha):raise ValueError('Invalid complete marker')
    key=base+'blobs/'+cipher_sha+'.gpg'
    sidecar=target.request('GET',key+'.sha256')
    ciphertext=target.request('GET',key)
    if sidecar!=(cipher_sha+'\n').encode() or digest(ciphertext)!=cipher_sha or len(ciphertext)!=marker['cipher_bytes']:
        raise ValueError('Ciphertext checksum/size mismatch')
    return ciphertext

def save_blob(target,base,data,work):
    plainsha=digest(data)
    if load_blob(target,base,plainsha) is not None:return plainsha,False
    encrypted=crypt(data,work)
    cipher_sha=digest(encrypted);key=base+'blobs/'+cipher_sha+'.gpg'
    target.put_verified(key,encrypted)
    target.put_verified(key+'.sha256',(cipher_sha+'\n').encode())
    marker=encode(dict(version=1,plain_sha256=plainsha,cipher_sha256=cipher_sha,cipher_bytes=len(encrypted)))
    target.put_verified(base+'index/'+plainsha+'/complete.json',marker)
    load_blob(target,base,plainsha)
    return plainsha,True

def copy(rows,source,target,base,work):
    copied=0
    for row in rows:
        if load_blob(target,base,row['checksum']) is not None:continue
        data=source.request('GET',row['object_key']);verify_plain(data,row)
        _,created=save_blob(target,base,data,work);copied+=int(created)
    # The mapping of private source keys stays encrypted. A run is complete only after all objects verify.
    inventory_sha,_=save_blob(target,base,encode(rows),work)
    now=dt.datetime.now(dt.timezone.utc).isoformat()
    run=encode(dict(version=1,completed_at=now,inventory_sha256=inventory_sha,objects=len(rows)))
    target.put_verified(base+'runs/'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex+'/complete.json',run)
    return dict(status='PASS',objects=len(rows),copied=copied,inventory_sha256=inventory_sha)

def verify(rows,target,base,work,output):
    output.mkdir(mode=0o700,parents=True,exist_ok=False)
    for row in rows:
        ciphertext=load_blob(target,base,row['checksum'])
        if ciphertext is None:raise ValueError('DB object has no complete backup')
        data=crypt(ciphertext,work,decrypt=True);verify_plain(data,row)
        (output/row['checksum']).write_bytes(data)
    return dict(status='PASS',objects=len(rows),inventory_checksums_verified=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['copy','verify'])
    parser.add_argument('--inventory-file',type=Path,help='Approved frozen offline inventory for covers; requires OBJECT_BACKUP_INVENTORY_SHA256')
    parser.add_argument('--output',type=Path,help='New local plaintext directory for attended verify only')
    args=parser.parse_args()
    os.umask(0o077)
    try:
        if os.environ.get('OBJECT_BACKUP_ENABLED')!='1':raise ValueError('Object backup is opt-in; set OBJECT_BACKUP_ENABLED=1')
        state=Path(os.environ['OBJECT_BACKUP_STATE_DIR']);state.mkdir(mode=0o700,parents=True,exist_ok=True)
        with (state/'object-backup.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with tempfile.TemporaryDirectory(prefix='object-backup-',dir=state) as directory:
                work=Path(directory)
                target=Store(os.environ['OBJECT_TARGET_ENDPOINT'],os.environ['OBJECT_TARGET_BUCKET'],Path(os.environ['CREDENTIALS_DIRECTORY'])/'object-target.json',work,'target',readonly=args.action=='verify')
                prefix=os.environ['OBJECT_SOURCE_PREFIX']
                rows=file_inventory(args.inventory_file,prefix,os.environ.get('OBJECT_BACKUP_INVENTORY_SHA256')) if args.inventory_file else database_inventory(prefix)
                base=namespace(os.environ.get('OBJECT_BACKUP_PREFIX','object-backups/v1/'))
                if args.action=='copy':
                    source=Store(os.environ['OBJECT_SOURCE_ENDPOINT'],os.environ['OBJECT_SOURCE_BUCKET'],Path(os.environ['CREDENTIALS_DIRECTORY'])/'object-source.json',work,'source',readonly=True)
                    result=copy(rows,source,target,base,work)
                else:
                    if args.output is None:raise ValueError('--output required for attended verify')
                    result=verify(rows,target,base,work,args.output)
                result['inventory_source']='pinned-file' if args.inventory_file else 'database'
                print(json.dumps(result,sort_keys=True));return 0
    except (KeyError,ValueError,RuntimeError,OSError,subprocess.SubprocessError) as error:
        # Do not log subprocess argv, private object keys, DB output, or credential values.
        print('Object backup failed: '+type(error).__name__,file=sys.stderr);return 1

if __name__=='__main__':sys.exit(main())
