#!/usr/bin/env python3
"""Explicit opt-in native PG18 + Moto verifier regression against synthetic fixture.
G5_FIXTURE points to the completed local drill runtime, G5_EVIDENCE to a NEW short
path under .release-evidence/2026-11-05-gaps/g5/. Requires boto3 + Moto5.1.16.
"""
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
TOOLS = ROOT/'deploy/backup'

@unittest.skipUnless(os.environ.get('G5_FIXTURE') and os.environ.get('G5_EVIDENCE'), 'explicit local synthetic fixture required')
class MotoVerifierTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import boto3
        cls.fixture = pathlib.Path(os.environ['G5_FIXTURE']).resolve()
        cls.evidence = pathlib.Path(os.environ['G5_EVIDENCE']).resolve()
        assert cls.evidence.is_relative_to(ROOT/'.release-evidence/2026-11-05-gaps/g5') and not cls.evidence.exists()
        cls.evidence.mkdir(mode=0o700)
        cls.keyhome = cls.fixture/'o'
        cls.cipher = (cls.fixture/'cipher-original.gpg').read_bytes()
        cls.backup_id = (cls.fixture/'restored/backup-id.txt').read_text().strip()
        cls.key = 'frequent/'+cls.backup_id
        cls.bucket = 'pliego-verifier-local'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); cls.port = sock.getsockname()[1]
        cls.log = (cls.evidence/'moto.log').open('w')
        cls.moto = subprocess.Popen([str(pathlib.Path(sys.executable).parent/'moto_server'),'-H','127.0.0.1','-p',str(cls.port)],stdout=cls.log,stderr=subprocess.STDOUT)
        cls.addClassCleanup(cls.stop_moto)
        endpoint = 'http://127.0.0.1:'+str(cls.port)
        cls.s3 = boto3.client('s3',endpoint_url=endpoint,region_name='us-east-1',aws_access_key_id='g5synthetic',aws_secret_access_key='g5-synthetic-local-only')
        for _ in range(100):
            try:
                cls.s3.create_bucket(Bucket=cls.bucket); break
            except Exception:
                if cls.moto.poll() is not None:
                    raise RuntimeError('Moto stopped')
                time.sleep(.1)
        else:
            raise RuntimeError('Moto startup timeout')
        credentials = cls.evidence/'credentials'; credentials.mkdir(mode=0o700)
        (credentials/'s3.json').write_text(json.dumps({'access_key':'g5synthetic','secret_key':'g5-synthetic-local-only','expires_at':'2099-01-01T00:00:00Z'}))
        cls.env = {**os.environ,'BACKUP_ENDPOINT':endpoint,'BACKUP_BUCKET':cls.bucket,'BACKUP_REGION':'us-east-1','CREDENTIALS_DIRECTORY':str(credentials),'PLIEGO_BACKUP_TEST_LOCAL':'1'}
        cls.counter=0
        cls.upload(cls.cipher)
        # The latest object name is deliberately incomplete and must be ignored.
        cls.s3.put_object(Bucket=cls.bucket,Key='frequent/20990101T000000Z-'+'f'*32+'/backup.tar.gpg',Body=b'partial')

    @classmethod
    def stop_moto(cls):
        cleanup=[]
        for pid in cls.evidence.glob('v*/cluster/postmaster.pid'):
            result=subprocess.run(['/usr/lib/postgresql/18/bin/pg_ctl','-D',str(pid.parent),'-m','immediate','-w','stop'],capture_output=True,text=True,timeout=30)
            cleanup.append({'cluster':str(pid.parent),'exit_status':result.returncode})
        (cls.evidence/'cluster-cleanup.json').write_text(json.dumps(cleanup)+'\n')
        cls.moto.terminate()
        try:
            cls.moto.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.moto.kill(); cls.moto.wait()
        cls.log.write('\nEXIT_STATUS='+str(cls.moto.returncode)+'\n'); cls.log.close()
        (cls.evidence/'server-stopped.json').write_text(json.dumps({'moto_exit':cls.moto.returncode,'running':False})+'\n')

    @classmethod
    def upload(cls,cipher):
        marker={'id':cls.backup_id,'sha256':hashlib.sha256(cipher).hexdigest(),'bytes':len(cipher),'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        for name,body in [('backup.tar.gpg',cipher),('backup.tar.gpg.sha256',(marker['sha256']+'  backup.tar.gpg\n').encode()),('complete.json',json.dumps(marker).encode())]:
            cls.s3.put_object(Bucket=cls.bucket,Key=cls.key+'/'+name,Body=body)

    def verify(self,label,expected=0,flyway=106,home=None,pg_bin=None,extra_env=None):
        type(self).counter+=1
        work=self.evidence/('v'+str(self.counter))
        command=[str(TOOLS/'verify-restore.py'),'--work-dir',str(work),'--gnupg-home',str(home or self.keyhome),'--database','pliego_benchmark','--expected-flyway',str(flyway)]
        if pg_bin:
            command += ['--pg-bin',str(pg_bin)]
        result=subprocess.run(command,env=dict(self.env,**(extra_env or {})),capture_output=True,text=True,timeout=180)
        (self.evidence/(label+'.log')).write_text('$ '+' '.join(command)+'\n'+result.stdout+result.stderr+'\nEXIT_STATUS='+str(result.returncode)+'\n')
        self.assertEqual(result.returncode,expected,(label,result.stdout,result.stderr,work/'report.json'))
        report=json.loads((work/'report.json').read_text())
        self.assertNotIn('g5-synthetic-local-only',json.dumps(report))
        self.assertNotIn('g5synthetic',json.dumps(report))
        self.assertFalse((work/'transport/curl.conf').exists())
        self.assertFalse((work/'cluster/postmaster.pid').exists())
        return report

    def envelope(self,label,rehash):
        work=self.evidence/label; work.mkdir(mode=0o700)
        for name in ('database.dump','globals.sql','SHA256SUMS','versions.txt','backup-id.txt'):
            shutil.copy2(self.fixture/'restored'/name,work/name)
        with (work/'globals.sql').open('a') as f:
            f.write('\nGRANT pliego_owner TO pliego_app;\n')
        if rehash:
            (work/'SHA256SUMS').write_text(''.join(hashlib.sha256((work/name).read_bytes()).hexdigest()+'  '+name+'\n' for name in ('database.dump','globals.sql')))
        with tarfile.open(work/'backup.tar','w') as archive:
            for name in ('database.dump','globals.sql','SHA256SUMS','versions.txt','backup-id.txt'):
                archive.add(work/name,arcname=name)
        listing=subprocess.run(['gpg','--batch','--homedir',str(self.keyhome),'--with-colons','--list-keys'],capture_output=True,text=True,check=True)
        fingerprint=next(line.split(':')[9] for line in listing.stdout.splitlines() if line.startswith('fpr:'))
        command=['gpg','--batch','--no-tty','--homedir',str(work/'g'),'--no-default-keyring','--keyring',str(self.fixture/'public.gpg'),'--trust-model','always','--recipient',fingerprint,'--compress-algo','none','--cipher-algo','AES256','--output',str(work/'backup.tar.gpg'),'--encrypt',str(work/'backup.tar')]
        (work/'g').mkdir(mode=0o700)
        result=subprocess.run(command,capture_output=True,text=True)
        (work/'encrypt.log').write_text(result.stdout+result.stderr+'\nEXIT_STATUS='+str(result.returncode)+'\n')
        self.assertEqual(result.returncode,0)
        return (work/'backup.tar.gpg').read_bytes()

    def test_01_full_restore_ignores_partial_latest(self):
        self.upload(self.cipher)
        report=self.verify('positive')
        self.assertEqual(report['result'],'PASS')
        self.assertEqual(report['flyway_versions'],106)
        self.assertTrue(all(report['checks'].values()))
        self.assertEqual(report['archive']['id'],self.backup_id)

    def test_02_corrupt_cipher_fails_before_pg(self):
        self.upload(self.cipher)
        self.s3.put_object(Bucket=self.bucket,Key=self.key+'/backup.tar.gpg',Body=self.cipher[:-20]+b'corrupt')
        report=self.verify('corrupt-outer',expected=1)
        self.assertEqual(report['failed_step'],'archive_verification')

    def test_03_wrong_key_fails_before_pg(self):
        self.upload(self.cipher)
        home=self.evidence/'k';home.mkdir(mode=0o700)
        report=self.verify('wrong-key',expected=1,home=home)
        self.assertEqual(report['failed_step'],'archive_verification')

    def test_04_wrong_release_fails_and_stops_cluster(self):
        self.upload(self.cipher)
        report=self.verify('wrong-release',expected=1,flyway=107)
        self.assertEqual(report['failed_step'],'flyway_continuity')
        self.assertTrue(report['checks']['cluster_stopped'])

    def test_05_inner_hash_fails_even_with_valid_outer(self):
        self.upload(self.envelope('inner-corrupt',False))
        report=self.verify('inner-hash',expected=1)
        self.assertEqual(report['failed_step'],'archive_verification')

    def test_06_unsafe_grant_fails_and_stops_cluster(self):
        self.upload(self.envelope('bad-grant',True))
        report=self.verify('bad-grant',expected=1)
        self.assertEqual(report['failed_step'],'owner_grants_invariants')
        self.assertFalse(report['checks']['runtime_not_owner_member'])
        self.assertTrue(report['checks']['cluster_stopped'])


    def test_07_unapproved_not_valid_constraint_rejected(self):
        # Reuse only our stopped synthetic verifier cluster, never the source fixture.
        work=self.evidence/'v1'; pg=pathlib.Path('/usr/lib/postgresql/18/bin')
        ledger=[]
        def run(command, input=None):
            result=subprocess.run(list(map(str,command)),input=input,capture_output=True,text=True,timeout=30)
            ledger.append({'command':list(map(str,command)),'exit_status':result.returncode})
            self.assertEqual(result.returncode,0,result.stderr)
            return result.stdout.strip()
        try:
            run([pg/'pg_ctl','-D',work/'cluster','-l',work/'postgres.log','-w','start'])
            psql=[pg/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',work/'socket','-U','postgres','-d','pliego_benchmark']
            run(psql,input='ALTER TABLE pliego.inventario ADD CONSTRAINT g5_unapproved_constraint CHECK(stock_actual>=0) NOT VALID;')
            checks=json.loads(run(psql,input=(TOOLS/'verify-restore-checks.sql').read_text()))
            self.assertFalse(checks['only_approved_not_valid_constraints'])
        finally:
            run([pg/'pg_ctl','-D',work/'cluster','-m','fast','-w','stop'])
            (self.evidence/'unapproved-constraint.json').write_text(json.dumps({'commands':ledger,'unexpected_not_valid_rejected':True},indent=2)+'\n')


    def test_08_restore_timeout_stops_cluster(self):
        self.upload(self.cipher)
        pg_bin=self.evidence/'pg';pg_bin.mkdir(mode=0o700)
        for binary in ('postgres','initdb','pg_ctl','psql'):
            (pg_bin/binary).symlink_to(pathlib.Path('/usr/lib/postgresql/18/bin')/binary)
        wrapper=pg_bin/'pg_restore'
        wrapper.write_text('#!/bin/sh\nsleep 3\nexit 42\n');wrapper.chmod(0o700)
        report=self.verify('restore-timeout',expected=1,pg_bin=pg_bin,extra_env={'BACKUP_VERIFY_TEST_RESTORE_TIMEOUT':'1'})
        self.assertEqual(report['failed_step'],'fresh_cluster_restore')
        self.assertEqual(next(c['exit_status'] for c in report['commands'] if c['step']=='pg_restore'),124)
        self.assertTrue(report['checks']['cluster_stopped'])

def main():
    os.umask(0o077)
    unittest.main()

if __name__=='__main__':
    main()
