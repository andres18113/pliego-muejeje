#!/usr/bin/env python3
"""Local-only Moto + PG18 object-copy/restore acceptance drill; no external endpoints."""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[3]
PG = Path('/usr/lib/postgresql/18/bin')
SCRIPT = ROOT/'deploy/backup/object-backup.py'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    evidence = args.evidence.resolve()
    assert evidence.is_relative_to(ROOT/'.release-evidence/2026-11-05-gaps/g4') and not evidence.exists()
    evidence.mkdir(mode=0o700)
    env = os.environ.copy()
    env.update(PGHOST='127.0.0.1', PGPORT='55484', PGUSER=os.environ['USER'], PGDATABASE='postgres',
               PLIEGO_OBJECT_BACKUP_TEST_LOCAL='1', OBJECT_BACKUP_ENABLED='1',
               OBJECT_SOURCE_ENDPOINT='http://127.0.0.1:19084', OBJECT_SOURCE_BUCKET='test-source',
               OBJECT_SOURCE_PREFIX='invoices/', OBJECT_TARGET_ENDPOINT='http://127.0.0.1:19084',
               OBJECT_TARGET_BUCKET='test-target', OBJECT_BACKUP_PREFIX='object-backups/v1/',
               OBJECT_BACKUP_STATE_DIR=str(evidence/'state'), CREDENTIALS_DIRECTORY=str(evidence/'credentials'),
               GNUPGHOME=str(evidence/'gpg'), OBJECT_BACKUP_PUBLIC_KEYRING=str(evidence/'recipient.gpg'))
    (evidence/'gpg').mkdir(mode=0o700)
    (evidence/'credentials').mkdir(mode=0o700)
    for name,key in [('object-source.json','LOCAL_SOURCE'),('object-target.json','LOCAL_TARGET')]:
        (evidence/'credentials'/name).write_text(json.dumps(dict(access_key=key,secret_key='LOCAL_ONLY_SECRET',expires_at='2099-01-01T00:00:00Z')))
    def run(cmd,name,expected=0,input=None,extra=None):
        local_env=env.copy(); local_env.update(extra or {})
        proc=subprocess.run(list(map(str,cmd)),env=local_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,input=input)
        (evidence/(name+'.log')).write_bytes(('$ '+' '.join(map(str,cmd))+'\n').encode()+proc.stdout+proc.stderr+f'\nEXIT_CODE={proc.returncode}\n'.encode())
        with (evidence/'commands.jsonl').open('a') as f:f.write(json.dumps(dict(command=list(map(str,cmd)),exit_code=proc.returncode,expected=expected,log=name+'.log'))+'\n')
        assert (proc.returncode==0 if expected==0 else proc.returncode!=0),name
        return proc.stdout
    moto_log=(evidence/'moto.log').open('w')
    moto=subprocess.Popen([str(Path(sys.executable).with_name('moto_server')),'-H','127.0.0.1','-p','19084'],stdout=moto_log,stderr=subprocess.STDOUT,env=env)
    started=False
    try:
        run([PG/'initdb','-D',evidence/'pg','-A','trust','--no-locale'],'initdb')
        run([PG/'pg_ctl','-D',evidence/'pg','-l',evidence/'postgres.log','-o',"-h 127.0.0.1 -p 55484 -k ''",'-w','start'],'pg-start'); started=True
        for attempt in range(100):
            try:
                urllib.request.urlopen('http://127.0.0.1:19084',timeout=1).close(); break
            except OSError: time.sleep(.1)
        else: raise AssertionError('Moto not ready')
        s3=boto3.client('s3',endpoint_url='http://127.0.0.1:19084',aws_access_key_id='LOCAL_FIXTURE',aws_secret_access_key='LOCAL_ONLY',region_name='us-east-1',config=Config(connect_timeout=3,read_timeout=5,retries={'total_max_attempts':1}))
        for bucket in ['test-source','test-target']: s3.create_bucket(Bucket=bucket)
        def keys(): return [obj['Key'] for page in s3.get_paginator('list_objects_v2').paginate(Bucket='test-target') for obj in page.get('Contents',[])]
        def get(key):
            with s3.get_object(Bucket='test-target',Key=key)['Body'] as body:return body.read()
        rows=[]
        for number,body in enumerate([b'%PDF-1.7 synthetic invoice',b'<invoice>SYNTHETIC</invoice>'],1):
            digest=hashlib.sha256(body).hexdigest();key=f'invoices/{number}/{digest}.pdf'
            rows.append(dict(object_key=key,checksum=digest,size_bytes=len(body)))
            s3.put_object(Bucket='test-source',Key=key,Body=body)
        sql="CREATE SCHEMA pliego; CREATE TABLE pliego.factura_archivo(object_key text, checksum char(64), size_bytes bigint, storage_kind text);"
        for row in rows:sql+=f"INSERT INTO pliego.factura_archivo VALUES ('{row['object_key']}','{row['checksum']}',{row['size_bytes']},'R2');"
        run([PG/'psql','-X','-v','ON_ERROR_STOP=1','-c',sql],'seed-db')
        run(['gpg','--batch','--passphrase','','--quick-generate-key','LOCAL OBJECT TEST ONLY','rsa2048','encr','1d'],'test-key')
        listing=run(['gpg','--batch','--with-colons','--list-keys'],'test-fingerprint').decode()
        env['OBJECT_BACKUP_RECIPIENT']=next(line.split(':')[9] for line in listing.splitlines() if line.startswith('fpr:'))
        (evidence/'recipient.gpg').write_bytes(run(['gpg','--batch','--export',env['OBJECT_BACKUP_RECIPIENT']],'export-public'))
        # This contract is written before implementation; failure must not publish a run marker.
        original=rows[0];s3.put_object(Bucket='test-source',Key=original['object_key'],Body=b'CORRUPTED')
        run([sys.executable,SCRIPT,'copy'],'source-checksum-negative',expected=1)
        assert not any('/runs/' in key for key in keys())
        s3.put_object(Bucket='test-source',Key=original['object_key'],Body=b'%PDF-1.7 synthetic invoice')
        first=json.loads(run([sys.executable,SCRIPT,'copy'],'copy-first'))
        before={key:get(key) for key in keys() if '/runs/' not in key}
        shutil.rmtree(evidence/'state')
        run([sys.executable,SCRIPT,'copy'],'copy-second-after-state-loss')
        assert before=={key:get(key) for key in keys() if '/runs/' not in key},'repeat run changed content-addressed ciphertext'
        inventory_marker=json.loads(get('object-backups/v1/'+env['OBJECT_BACKUP_RECIPIENT']+'/index/'+first['inventory_sha256']+'/complete.json'))
        encrypted_inventory=get('object-backups/v1/'+env['OBJECT_BACKUP_RECIPIENT']+'/blobs/'+inventory_marker['cipher_sha256']+'.gpg')
        decoded=run(['gpg','--batch','--decrypt'],'encrypted-inventory-restore',input=encrypted_inventory)
        assert json.loads(decoded)==rows
        run([PG/'pg_dump','-Fc','--file',evidence/'metadata.dump'],'dump-metadata')
        run([PG/'createdb','object_restored'],'create-restore-db')
        run([PG/'pg_restore','--exit-on-error','--dbname','object_restored',evidence/'metadata.dump'],'restore-metadata-db')
        env['PGDATABASE']='object_restored'
        source_credential=evidence/'credentials/object-source.json'
        source_credential.rename(evidence/'credentials/source-hidden.json')
        run([sys.executable,SCRIPT,'verify','--output',evidence/'restored'],'restore-checksum-without-source-credential')
        source_credential.with_name('source-hidden.json').rename(source_credential)
        (evidence/'wrong-key').mkdir(mode=0o700)
        run([sys.executable,SCRIPT,'verify','--output',evidence/'wrong-key-restore'],'wrong-offline-key',expected=1,extra={'GNUPGHOME':str(evidence/'wrong-key')})
        for row in rows:
            data=(evidence/'restored'/row['checksum']).read_bytes()
            assert hashlib.sha256(data).hexdigest()==row['checksum'] and len(data)==row['size_bytes']
        # Target corruption must fail copy and attended restore, never silently repair/overwrite.
        object_marker=json.loads(get('object-backups/v1/'+env['OBJECT_BACKUP_RECIPIENT']+'/index/'+rows[0]['checksum']+'/complete.json'))
        blob='object-backups/v1/'+env['OBJECT_BACKUP_RECIPIENT']+'/blobs/'+object_marker['cipher_sha256']+'.gpg'
        saved=get(blob);s3.put_object(Bucket='test-target',Key=blob,Body=b'TRUNCATED')
        run([sys.executable,SCRIPT,'verify','--output',evidence/'corrupt-restore'],'target-corrupt-restore',expected=1)
        run([sys.executable,SCRIPT,'copy'],'target-corrupt-copy',expected=1)
        s3.put_object(Bucket='test-target',Key=blob,Body=saved)
        run([sys.executable,SCRIPT,'copy'],'copy-recovered')
        # A failed write cannot leave a complete run marker (source bucket has no impact).
        run([sys.executable,SCRIPT,'copy'],'target-missing',expected=1,extra={'OBJECT_TARGET_BUCKET':'missing-target'})
        # Covers have no DB checksum: use an owner-pinned offline inventory and its own source bucket.
        s3.create_bucket(Bucket='test-covers')
        cover_rows=[]
        for key,body in [('covers/editions/v2/test.webp',b'SYNTHETIC WEBP'),('covers/editions/email-v1/test.jpg',b'SYNTHETIC JPEG')]:
            cover_rows.append(dict(object_key=key,checksum=hashlib.sha256(body).hexdigest(),size_bytes=len(body)))
            s3.put_object(Bucket='test-covers',Key=key,Body=body)
        cover_inventory=evidence/'approved-cover-inventory.json'
        cover_inventory.write_text(json.dumps(cover_rows))
        cover_settings=dict(OBJECT_SOURCE_BUCKET='test-covers',OBJECT_SOURCE_PREFIX='covers/editions/',
                            OBJECT_BACKUP_INVENTORY_SHA256=hashlib.sha256(cover_inventory.read_bytes()).hexdigest(),PGPORT='1')
        (evidence/'credentials/object-source.json').write_text(json.dumps(dict(access_key='LOCAL_COVERS_READ',secret_key='LOCAL_ONLY_COVERS',expires_at='2099-01-01T00:00:00Z')))
        run([sys.executable,SCRIPT,'copy','--inventory-file',cover_inventory],'cover-copy',extra=cover_settings)
        before_cover={key:get(key) for key in keys() if '/runs/' not in key}
        run([sys.executable,SCRIPT,'copy','--inventory-file',cover_inventory],'cover-copy-second',extra=cover_settings)
        assert before_cover=={key:get(key) for key in keys() if '/runs/' not in key}
        run([sys.executable,SCRIPT,'verify','--inventory-file',cover_inventory,'--output',evidence/'restored-covers'],'cover-restore',extra=cover_settings)
        for row in cover_rows:
            assert hashlib.sha256((evidence/'restored-covers'/row['checksum']).read_bytes()).hexdigest()==row['checksum']
        cover_inventory.write_text('[]')
        run([sys.executable,SCRIPT,'copy','--inventory-file',cover_inventory],'cover-inventory-pin-negative',expected=1,extra=cover_settings)
        report=dict(status='PASS',database='PostgreSQL18 synthetic metadata table; not full migrated schema',objects=len(rows),checks=['source SHA256 mismatch blocks completion','incremental second run after local state loss preserves ciphertext','encrypted inventory mapping decrypts exactly','restore matches pg_dump/pg_restore DB checksums+sizes without source credential','wrong offline key fails','target corruption fails copy and restore','missing target fails','cover pinned inventory copy/reuse/restore without DB','changed cover inventory pin rejected'],limitations=['Moto does not enforce real R2 token scope or R2 prefix lock semantics'])
        (evidence/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report))
    finally:
        if started: run([PG/'pg_ctl','-D',evidence/'pg','-m','fast','-w','stop'],'pg-stop')
        moto.terminate();moto.wait(timeout=10);moto_log.close()
        subprocess.run(['gpgconf','--homedir',env['GNUPGHOME'],'--kill','gpg-agent'],check=False)
    return 0

if __name__=='__main__':sys.exit(main())
