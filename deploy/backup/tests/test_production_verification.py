import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
cf=module('cf','deploy/backup/ops/cloudflare-bucket.py')
v=module('vr','deploy/backup/ops/verify-r2.py')
j=module('vj','deploy/backup/ops/verify-journal.py')
w=module('vw','deploy/backup/owner/verify-attended-restore.py')
LOCKED=b'<Error><Code>ObjectLockedByBucketPolicy</Code></Error>'
DENY=b'<Error><Code>AccessDenied</Code><Message>not evidence</Message></Error>'

class FakeAPI:
 def __init__(self,exists=False,defaults=False):
  self.exists=exists;self.calls=[]
  self.config={'bucket':{'name':cf.BUCKET,'storage_class':'Standard'},'managed':{'enabled':False},'custom':{'domains':[]},'cors':{},'lock':{'rules':[]},'lifecycle':{'rules':[]}}
  if defaults:self.config['lifecycle']['rules']=[{'id':'provider-default','enabled':True,'conditions':{'prefix':''},'abortMultipartUploadsTransition':{'condition':{'type':'Age','maxAge':604800}}}]
 def request(self,method,suffix='',body=None,missing=False):
  self.calls.append((method,suffix,copy.deepcopy(body)))
  if method=='POST':self.exists=True;return self.config['bucket']
  part=suffix.split(cf.BUCKET,1)[-1]
  key={'':'bucket','/domains/managed':'managed','/domains/custom':'custom','/cors':'cors','/lock':'lock','/lifecycle':'lifecycle'}[part]
  if method=='GET':return copy.deepcopy(self.config[key]) if self.exists else None
  if method=='DELETE':self.config[key]={};return {}
  self.config[key]=copy.deepcopy(body);return {}
 def read(self):return copy.deepcopy(self.config)

class QueueStore:
 def __init__(self,responses):self.responses=list(responses);self.calls=[]
 def request(self,*args,**kw):self.calls.append((args,kw));return self.responses.pop(0)
 def get(self,key):
  status,body=self.request('GET',key)
  if status!=200:raise ValueError('not200')
  return body

class PhaseD(unittest.TestCase):
 def test_cf_new_and_repeat_are_idempotent_and_private(self):
  api=FakeAPI(defaults=True);cf.apply(api);self.assertTrue(cf.verified(api.read()))
  initial=api.read();cf.apply(api);self.assertEqual(initial,api.read())
  self.assertEqual(sum(method=='POST' for method,_,_ in api.calls),1)
  self.assertFalse(any(method=='DELETE' for method,_,_ in api.calls))
  self.assertTrue(any(cf.multipart_only(r) for r in initial['lifecycle']['rules']))
 def test_cf_default_multipart_empty_conditions_are_preserved(self):
  api=FakeAPI(defaults=True);api.config['lifecycle']['rules'][0]['conditions']={}
  cf.apply(api);self.assertTrue(cf.verified(api.read()))
  self.assertEqual(api.config['lifecycle']['rules'][-1]['conditions'],{})
 def test_cf_existing_cors_removed_once_then_skipped(self):
  api=FakeAPI(exists=True);api.config['cors']={'rules':[{'unexpected':'cors'}]}
  cf.apply(api);cf.apply(api)
  self.assertEqual(sum(method=='DELETE' for method,_,_ in api.calls),1)
 def test_cf_drift_custom_and_expiry_stop_before_mutation(self):
  for target,change in [('custom',{'domains':[{'domain':'do-not-touch'}]}),('lifecycle',{'rules':[{'id':'unrelated','enabled':True,'conditions':{'prefix':''},'deleteObjectsTransition':{'condition':{'type':'Age','maxAge':1}}}]}),('lock',{'rules':[{'id':'other'}]})]:
   api=FakeAPI(exists=True);api.config[target]=change
   with self.assertRaises(ValueError):cf.apply(api)
   self.assertTrue(all(method=='GET' for method,_,_ in api.calls))
 def test_cf_verified_rejects_invoice_expiry_publicity_missing_prefix(self):
  api=FakeAPI();cf.apply(api);config=api.read()
  for name,value in [('managed',{'enabled':True}),('cors',{'rules':[{}]}),('custom',{'domains':[{}]}),('lock',{'rules':config['lock']['rules'][:-1]})]:
   changed=copy.deepcopy(config);changed[name]=value;self.assertFalse(cf.verified(changed))
  changed=copy.deepcopy(config);changed['lifecycle']['rules'].append({'id':'invoice-expiry','conditions':{'prefix':'object-backups/'}})
  self.assertFalse(cf.verified(changed))
 def test_offline_plan_does_not_invoke_subprocess(self):
  with patch.object(cf.subprocess,'run',side_effect=AssertionError('network forbidden')),patch.object(sys,'argv',['cloudflare','plan','--account-id','a'*32]),patch('builtins.print') as printed:
   self.assertEqual(cf.main(),0)
  plan=json.loads(printed.call_args.args[0]);self.assertEqual(plan['bucket'],cf.BUCKET)
 def test_first_run_verifies_all_tiers_and_invoice_inventory_and_rejects_corruption(self):
  data=b'synthetic ciphertext; packet parsing tested separately'
  fingerprint='A'*40;run_id='20261105T001500Z-'+'a'*32;cipher_sha=v.sha(data);plain_sha='b'*64
  stamp=dt.datetime.now(dt.timezone.utc).isoformat();base='object-backups/v1/'+fingerprint+'/'
  bodies={};listed={}
  with tempfile.TemporaryDirectory() as t:
   work=Path(t);receipts=work/'receipts';(receipts/'retention').mkdir(parents=True)
   for tier in ['frequent','daily','weekly','monthly']:
    prefix=tier+'/'+run_id;marker={'id':run_id,'tier':tier,'bytes':len(data),'sha256':cipher_sha,'completed_at':stamp}
    (receipts/'retention'/f'{tier}.json').write_text(json.dumps(marker))
    bodies[prefix+'/complete.json']=json.dumps(marker).encode();bodies[prefix+'/backup.tar.gpg']=data
    bodies[prefix+'/backup.tar.gpg.sha256']=(cipher_sha+'  backup.tar.gpg\n').encode()
    listed[tier+'/']=[prefix+'/complete.json']
   run_key=base+'runs/'+run_id+'/complete.json';listed[base+'runs/']=[run_key]
   bodies[run_key]=json.dumps({'completed_at':stamp,'inventory_sha256':plain_sha,'objects':2}).encode()
   bodies[base+'index/'+plain_sha+'/complete.json']=json.dumps({'plain_sha256':plain_sha,'cipher_sha256':cipher_sha,'cipher_bytes':len(data)}).encode()
   bodies[base+'blobs/'+cipher_sha+'.gpg']=data;bodies[base+'blobs/'+cipher_sha+'.gpg.sha256']=(cipher_sha+'\n').encode()
   class Stored:
    def get(self,key):return bodies[key]
    def list(self,prefix):return listed[prefix]
   with patch.object(v,'packet_check') as packets:
    result=v.first_run(Stored(),work,receipts,fingerprint)
   self.assertEqual(packets.call_count,5)
   self.assertEqual(len(result['database_tiers']),4);self.assertEqual(result['invoices']['objects'],2)
   bodies['monthly/'+run_id+'/backup.tar.gpg']=data+b'corrupt'
   with patch.object(v,'packet_check'):
    with self.assertRaisesRegex(ValueError,'ciphertext_sha'):v.first_run(Stored(),work,receipts,fingerprint)
 def test_source_single_put_refused_no_delete(self):
  store=QueueStore([(200,b''),(403,DENY)]);report={}
  self.assertTrue(v.source_refusal(store,report)['single_put_access_denied'])
  self.assertEqual([c[0][0] for c in store.calls],['GET','PUT'])
  self.assertTrue(store.calls[-1][1]['create_only']);self.assertRegex(report['canary_key'],r'^pliego-backup-canary/[a-f0-9]{32}\.txt$')
 def test_source_unexpected_success_stops_without_cleanup(self):
  store=QueueStore([(200,b''),(200,b'')]);report={}
  with self.assertRaises(ValueError):v.source_refusal(store,report)
  self.assertIn('UNEXPECTED SOURCE WRITE SUCCESS',report['stop']);self.assertEqual(len(store.calls),2)
 def test_source_transport_error_not_accepted_as_permission_proof(self):
  for status,body in [(403,b'<Error><Code>InvalidAccessKeyId</Code></Error>'),(500,DENY),(412,b''),(301,b'')]:
   store=QueueStore([(200,b''),(status,body)])
   with self.assertRaises(ValueError):v.source_refusal(store,{})
 def test_source_invalid_reader_stops_before_put(self):
  store=QueueStore([(403,DENY)])
  with self.assertRaises(ValueError):v.source_refusal(store,{})
  self.assertEqual(len(store.calls),1)
 def test_lock_both_refusals_and_bytes(self):
  data=b'PLIEGO backup lock probe\n';store=QueueStore([(200,b''),(200,data),(409,LOCKED),(409,LOCKED),(200,data)])
  self.assertTrue(v.lock_canary(store,{})['original_bytes_equal'])
  self.assertEqual([c[0][0] for c in store.calls],['PUT','GET','PUT','DELETE','GET'])
 def test_lock_overwrite_success_stops_before_delete(self):
  store=QueueStore([(200,b''),(200,b'PLIEGO backup lock probe\n'),(200,b'')])
  with self.assertRaises(ValueError):v.lock_canary(store,{})
  self.assertEqual(len(store.calls),3)
 def test_lock_does_not_confuse_bad_credentials_with_retention(self):
  store=QueueStore([(200,b''),(200,b'PLIEGO backup lock probe\n'),(403,DENY)])
  with self.assertRaises(ValueError):v.lock_canary(store,{})
  self.assertEqual(len(store.calls),3)
 def test_packet_list_only_empty_home_and_failure_closed(self):
  with tempfile.TemporaryDirectory() as t:
   work=Path(t)
   response=subprocess.CompletedProcess([],0,b':pubkey enc packet:\n:encrypted data packet:\n',b'')
   with patch.object(v.subprocess,'run',return_value=response) as process:
    v.packet_check(b'synthetic ciphertext',work)
   command=process.call_args.args[0]
   self.assertIn('--list-only',command);self.assertIn('--no-autostart',command)
   self.assertEqual(list((work/'empty-public-only-home').iterdir()),[])
   response=subprocess.CompletedProcess([],2,b'invalid data',b'private provider text')
   with patch.object(v.subprocess,'run',return_value=response):
    with self.assertRaises(ValueError):v.packet_check(b'plaintext',work)
 def test_journal_drops_unrelated_secret_bodies_and_rejects_skip(self):
  text='UNRELATED_DO_NOT_OUTPUT\nbackup_success id=20261105T001500Z-'+'a'*32+' bytes=123 duration_seconds=4 prefixes=frequent daily weekly monthly\nbackup_heartbeat_ok event=success\n'
  report=j.facts('pliego-backup.service','b'*32,text,'success','0')
  self.assertEqual(report['result'],'PASS');self.assertNotIn('UNRELATED',json.dumps(report))
  self.assertEqual(j.facts('pliego-backup.service','b'*32,text+'backup_skipped_deploy_lock:','success','0')['result'],'FAIL')
 def test_journal_invoices_only_allowlists_counts(self):
  report=j.facts('object-backup.service','b'*32,json.dumps({'status':'PASS','objects':2,'copied':1,'secret':'NO'}),'success','0')
  self.assertEqual(report['objects'],2);self.assertNotIn('NO',json.dumps(report))
 def test_wrapper_rejects_other_repo_and_evidence_paths(self):
  with tempfile.TemporaryDirectory() as t:
   base=Path(t);(base/'.git').mkdir();self.assertFalse(w.outside(base/'new'))
  with tempfile.TemporaryDirectory() as t:self.assertFalse(w.outside(Path(t)/'.release-evidence'/'new'))
 def test_owner_wrapper_runs_only_restored_cluster_and_stops_after_invoice_failure(self):
  for fail in [False,True]:
   with tempfile.TemporaryDirectory(prefix='pliego-owner-mock-',dir='/tmp') as t:
    base=Path(t);home=base/'empty-owner-home';home.mkdir(mode=0o700);creds=base/'creds';creds.mkdir(mode=0o700)
    for name in ['s3.json','object-target.json']:
     f=creds/name;f.write_text('{}');f.chmod(0o600)
    work=base/'w';calls=[]
    def fake_run(command,env,steps,name,timeout=0):
     calls.append((command,env,name));steps.append({'step':name,'exit_status':1 if fail and name=='invoice_verifier' else 0})
     if name=='database_verifier':
      (work/'db/cluster').mkdir(parents=True);(work/'db/cluster/PG_VERSION').write_text('18')
      (work/'db/report.json').write_text(json.dumps({'result':'PASS','checks':{'cluster_stopped':True},'archive':{},'flyway_versions':106,'elapsed_seconds':1}))
     if name=='invoice_verifier':
      self.assertEqual(env['PGHOST'],str(work/'db/socket'));self.assertNotIn('OBJECT_SOURCE_ENDPOINT',env)
      self.assertEqual(env['PGOPTIONS'],'-c default_transaction_read_only=on')
      if fail:raise RuntimeError('invoice fail')
      return json.dumps({'status':'PASS','objects':2,'inventory_checksums_verified':True,'inventory_source':'database'}).encode()
     return b''
    argv=['wrapper','--private-work',str(work),'--gnupg-home',str(home),'--credentials-directory',str(creds),'--account-id','a'*32,'--fingerprint','A'*40,'--expected-flyway','106']
    signals={s:signal.getsignal(s) for s in [signal.SIGINT,signal.SIGTERM]}
    try:
     with patch.object(w,'outside',return_value=True),patch.object(w,'EVIDENCE',base/'report-only'),patch.object(w,'run',fake_run),patch.object(sys,'argv',argv),patch('builtins.print'):
      self.assertEqual(w.main(),1 if fail else 0)
    finally:
     for s,handler in signals.items():signal.signal(s,handler)
    self.assertEqual(calls[-1][2],'cluster_stop')
    reports=list((base/'report-only').glob('*/report.json'));self.assertEqual(len(reports),1)
    self.assertEqual(json.loads(reports[0].read_bytes())['result'],'FAIL' if fail else 'PASS')

if __name__=='__main__':unittest.main(verbosity=2)
