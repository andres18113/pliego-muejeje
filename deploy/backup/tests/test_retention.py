#!/usr/bin/env python3
"""Actual backup.sh with deterministic clock and a file-backed transport; crypto is covered by PG/Moto drill."""
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

KIT = Path(__file__).resolve().parents[1]
ROOT = KIT.parents[1]
EVIDENCE = ROOT / '.release-evidence/2026-11-05-gaps/g1'

STUB = r'''#!/usr/bin/env python3
import json,os,pathlib,shutil,subprocess,sys
name=pathlib.Path(sys.argv[0]).name;a=sys.argv[1:]
if name=='date':
 if os.environ.get('MOVING_CLOCK')=='1' and '-u' in a and not any(x.startswith('--date') for x in a):
  counter=pathlib.Path(os.environ['TEST_REMOTE'])/'date-counter';count=int(counter.read_text()) if counter.exists() else 0;counter.write_text(str(count+1))
  moment='2026-12-31T23:59:59Z' if count==0 else '2027-01-01T00:00:01Z'
  sys.exit(subprocess.call(['/usr/bin/date','-u','--date='+moment,a[-1]]))
 sys.exit(subprocess.call(['/usr/bin/date',*a]))
elif name=='pg_dump':
 if '--version' in a: print('pg_dump (PostgreSQL) 18 test')
 else:
  if os.environ.get('FAIL_DUMP')=='1':sys.exit(2)
  pathlib.Path(next(x.split('=',1)[1] for x in a if x.startswith('--file='))).write_bytes(b'database-test')
elif name=='pg_dumpall':pathlib.Path(next(x.split('=',1)[1] for x in a if x.startswith('--file='))).write_text('globals-test')
elif name=='gpg':pathlib.Path(a[a.index('--output')+1]).write_bytes(sys.stdin.buffer.read())
elif name=='curl':
 remote=pathlib.Path(os.environ['TEST_REMOTE']);url=a[-1];key=url.split('/test-bucket/',1)[1];dest=remote/key
 with open(remote/'calls.jsonl','a') as f:f.write(json.dumps({'args':a,'key':key})+'\n')
 if os.environ.get('FAIL_KEY') and os.environ['FAIL_KEY'] in key:sys.exit(22)
 headers=[a[i+1] for i,x in enumerate(a) if x in ('--header','-H')]
 copy=next((x.split(':',1)[1].strip() for x in headers if x.lower().startswith('x-amz-copy-source:')),None)
 if copy:
  source=remote/copy.lstrip('/').split('/',1)[1];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,dest)
  result=b'<CopyObjectResult><ETag>test</ETag></CopyObjectResult>'
  if os.environ.get('COPY_EMBEDDED_ERROR')=='1':result=b'<Error><Code>InternalError</Code></Error>'
  if '--output' in a:pathlib.Path(a[a.index('--output')+1]).write_bytes(result)
  else:sys.stdout.buffer.write(result)
 elif '--upload-file' in a:dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(a[a.index('--upload-file')+1],dest)
 elif '--output' in a:
  if not dest.exists():sys.exit(22)
  shutil.copyfile(dest,a[a.index('--output')+1])
  if os.environ.get('CORRUPT_READBACK') and os.environ['CORRUPT_READBACK'] in key:pathlib.Path(a[a.index('--output')+1]).write_bytes(b'corrupted')
 else:sys.exit(3)
'''

class RetentionTests(unittest.TestCase):
 def setUp(self):
  EVIDENCE.mkdir(parents=True,exist_ok=True)
  self.t=tempfile.TemporaryDirectory(prefix='case-',dir=EVIDENCE);self.w=Path(self.t.name)
  self.bin=self.w/'bin';self.bin.mkdir();self.remote=self.w/'remote';self.remote.mkdir()
  stub=self.bin/'stub';stub.write_text(STUB);stub.chmod(0o755)
  for n in ('pg_dump','pg_dumpall','gpg','curl','date'):(self.bin/n).symlink_to(stub)
  creds=self.w/'credentials';creds.mkdir();(creds/'s3.json').write_text(json.dumps({'access_key':'localtest','secret_key':'localtest','expires_at':'2099-01-01T00:00:00Z'}))
  self.env={**os.environ,'PATH':str(self.bin)+':/usr/bin:/bin','BACKUP_STATE_DIR':str(self.w/'state'),'BACKUP_PUBLIC_KEYRING':str(self.w/'public.gpg'),'BACKUP_RECIPIENT':'A'*40,'BACKUP_ENDPOINT':'http://127.0.0.1:19089','BACKUP_BUCKET':'test-bucket','CREDENTIALS_DIRECTORY':str(creds),'PLIEGO_BACKUP_TEST_LOCAL':'1','TEST_REMOTE':str(self.remote)}
 def tearDown(self):self.t.cleanup()
 def backup(self,now,**changes):
  return subprocess.run([KIT/'backup.sh'],env={**self.env,'BACKUP_TEST_NOW':now,**changes},text=True,capture_output=True)
 def good(self,now,**changes):
  p=self.backup(now,**changes);self.assertEqual(p.returncode,0,p.stderr);return p
 def markers(self,tier):return list((self.remote/tier).glob('*/complete.json'))
 def state(self,tier):return json.loads((self.w/'state/retention'/f'{tier}.json').read_text())
 def test_midnight_failure_then_0615_success_promotes_daily(self):
  self.assertNotEqual(self.backup('2026-11-05T00:15:00Z',FAIL_DUMP='1').returncode,0)
  self.good('2026-11-05T06:15:00Z');self.assertEqual(len(self.markers('daily')),1);self.assertEqual(self.state('daily')['period'],'2026-11-05')
 def test_odd_hour_catchup_promotes_all_initial_tiers(self):
  self.good('2026-11-05T17:43:00Z')
  for tier in ('frequent','daily','weekly','monthly'):self.assertEqual(len(self.markers(tier)),1,tier)
 def test_second_run_same_day_does_not_promote(self):
  self.good('2026-11-05T06:15:00Z');self.good('2026-11-05T12:15:00Z')
  self.assertEqual(len(self.markers('frequent')),2)
  for tier in ('daily','weekly','monthly'):self.assertEqual(len(self.markers(tier)),1,tier)
 def test_week_month_boundary_and_iso_week_year(self):
  self.good('2026-12-31T18:15:00Z');self.assertEqual(self.state('weekly')['period'],'2026-W53')
  self.good('2027-01-01T06:15:00Z');self.assertEqual(len(self.markers('daily')),2);self.assertEqual(len(self.markers('monthly')),2);self.assertEqual(len(self.markers('weekly')),1)
  self.good('2027-01-04T09:15:00Z');self.assertEqual(self.state('weekly')['period'],'2027-W01');self.assertEqual(len(self.markers('weekly')),2)
 def test_state_loss_only_repromotes(self):
  self.good('2026-11-05T06:15:00Z');shutil.rmtree(self.w/'state');self.good('2026-11-05T12:15:00Z')
  for tier in ('frequent','daily','weekly','monthly'):self.assertEqual(len(self.markers(tier)),2,tier)
 def test_failed_tier_upload_does_not_advance_marker(self):
  self.good('2026-11-05T06:15:00Z');prior=self.state('daily')
  p=self.backup('2026-11-06T06:15:00Z',FAIL_KEY='daily/');self.assertNotEqual(p.returncode,0);self.assertEqual(self.state('daily'),prior)
  self.good('2026-11-06T12:15:00Z');self.assertEqual(self.state('daily')['period'],'2026-11-06')
 def test_failed_complete_marker_does_not_advance(self):
  self.assertNotEqual(self.backup('2026-11-05T06:15:00Z',FAIL_KEY='/complete.json').returncode,0)
  self.assertFalse((self.w/'state/retention/daily.json').exists());self.assertFalse((self.w/'state/last-success.json').exists())
 def test_heartbeat_delivery_failure_does_not_fail_completed_backup(self):
  p=self.good('2026-11-05T06:15:00Z',BACKUP_HEARTBEAT_ENABLED='1');self.assertIn('backup_heartbeat_warning',p.stderr)
  self.assertEqual(len(self.markers('monthly')),1)
 def test_tier_ciphertext_copies_use_server_side_copy(self):
  self.good('2026-11-05T06:15:00Z')
  calls=[json.loads(x) for x in (self.remote/'calls.jsonl').read_text().splitlines()]
  copies=[c for c in calls if any(x.lower().startswith('x-amz-copy-source:') for x in c['args'])]
  self.assertEqual(len(copies),6)
 def test_periods_derive_from_one_start_instant_across_midnight(self):
  self.good('1900-01-01T00:00:00Z',PLIEGO_BACKUP_TEST_LOCAL='0',MOVING_CLOCK='1',BACKUP_ENDPOINT='https://'+'a'*32+'.r2.cloudflarestorage.com')
  self.assertTrue(self.state('daily')['id'].startswith('20261231T235959Z'))
  self.assertEqual(self.state('daily')['period'],'2026-12-31');self.assertEqual(self.state('monthly')['period'],'2026-12')
 def test_clock_override_ignored_without_local_gate(self):
  p=self.good('1900-01-01T00:00:00Z',PLIEGO_BACKUP_TEST_LOCAL='0',BACKUP_ENDPOINT='https://'+'a'*32+'.r2.cloudflarestorage.com');self.assertEqual(self.state('daily')['period'],dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d'))
 def test_copy_http200_embedded_error_never_advances_tier(self):
  self.assertNotEqual(self.backup('2026-11-05T06:15:00Z',COPY_EMBEDDED_ERROR='1').returncode,0);self.assertFalse((self.w/'state/retention/daily.json').exists())
 def test_cipher_and_checksum_readback_corruption_never_publishes(self):
  for suffix in ('backup.tar.gpg','backup.tar.gpg.sha256'):
   with self.subTest(suffix=suffix):
    self.assertNotEqual(self.backup('2026-11-05T06:15:00Z',CORRUPT_READBACK=suffix).returncode,0);self.assertEqual(len(self.markers('frequent')),0)

class FreshnessTests(unittest.TestCase):
 def setUp(self):
  EVIDENCE.mkdir(parents=True,exist_ok=True);self.t=tempfile.TemporaryDirectory(prefix='fresh-',dir=EVIDENCE);self.w=Path(self.t.name);(self.w/'retention').mkdir()
  self.now=dt.datetime.now(dt.timezone.utc)
  for tier,age in [('frequent',0),('daily',0),('weekly',0),('monthly',0)]:self.receipt(tier,age)
 def tearDown(self):self.t.cleanup()
 def receipt(self,tier,age):
  file=self.w/'last-success.json' if tier=='frequent' else self.w/'retention'/f'{tier}.json'
  file.write_text(json.dumps({'completed_at':(self.now-dt.timedelta(seconds=age)).isoformat()}))
 def check(self):return subprocess.run([KIT/'freshness.py',self.w/'last-success.json'],capture_output=True,text=True)
 def test_fresh_all_tiers(self):self.assertEqual(self.check().returncode,0)
 def test_each_tier_stale_alerts(self):
  for tier,age in [('frequent',7*3600+5),('daily',31*3600+5),('weekly',8*86400+3600+5),('monthly',32*86400+5)]:
   with self.subTest(tier=tier):
    self.receipt(tier,age);p=self.check();self.assertNotEqual(p.returncode,0);self.assertIn(tier,p.stderr);self.receipt(tier,0)
 def test_missing_tier_alerts(self):
  (self.w/'retention/weekly.json').unlink();self.assertNotEqual(self.check().returncode,0)
 def test_future_and_malformed_receipts_alert(self):
  self.receipt('daily',-3600);self.assertNotEqual(self.check().returncode,0)
  self.receipt('daily',0);(self.w/'last-success.json').write_text('{broken');self.assertNotEqual(self.check().returncode,0)
 def test_naive_timestamp_fails_cleanly(self):
  (self.w/'last-success.json').write_text('{"completed_at":"2026-11-05T00:00:00"}');p=self.check();self.assertEqual(p.returncode,1);self.assertNotIn('Traceback',p.stderr)

if __name__=='__main__':unittest.main(verbosity=2)
