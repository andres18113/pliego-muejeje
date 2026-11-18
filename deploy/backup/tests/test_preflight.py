#!/usr/bin/env python3
"""Local synthetic allowlist and non-mutating lock probes; no root or production access."""
import fcntl
import importlib.util
import json
import pathlib
import tempfile
import unittest

path=pathlib.Path(__file__).resolve().parents[1]/'ops/preflight-facts.py'
spec=importlib.util.spec_from_file_location('preflight',path)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PreflightTests(unittest.TestCase):
 def test_missing_lock_never_created(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'absent';self.assertEqual(m.lock_status(p),{'present':False});self.assertFalse(p.exists())
 def test_lock_readonly_nontruncating_probe(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'lock';p.write_text('preserve');p.chmod(0o600);before=p.stat()
   self.assertFalse(m.lock_status(p)['held'])
   with p.open('rb') as held:
    fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB);self.assertTrue(m.lock_status(p)['held'])
   self.assertFalse(m.lock_status(p)['held']);self.assertEqual(p.read_text(),'preserve');self.assertEqual(p.stat().st_ino,before.st_ino);self.assertEqual(p.stat().st_mode,before.st_mode)
 def test_symlink_refused(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'lock';p.symlink_to('missing');self.assertEqual(m.lock_status(p)['probe'],'unavailable');self.assertFalse((p.parent/'missing').exists())
 def test_env_only_allowlisted_synthetic_fields(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'env';p.write_text('PLIEGO_DB_PASSWORD=SYNTHETIC_DO_NOT_PRINT\nPLIEGO_R2_ENDPOINT=https://'+'a'*32+'.r2.cloudflarestorage.com\nPLIEGO_R2_BUCKET=billing-pliego\nPLIEGO_R2_ENABLED=true\nEVIL=$(touch /tmp/should-never-exist)\n')
   result=m.env_facts(p);self.assertEqual(result,{'r2_account_id':'a'*32,'invoice_bucket':'billing-pliego','pliego_r2_enabled':'true'});self.assertNotIn('SYNTHETIC',json.dumps(result))
 def test_invalid_allowlisted_values_redacted(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'env';p.write_text('PLIEGO_R2_ENDPOINT=unexpected\nPLIEGO_R2_BUCKET=unsafe value\nPLIEGO_R2_ENABLED=unexpected\n');self.assertNotIn('unexpected',json.dumps(m.env_facts(p)))
if __name__ == '__main__':
 unittest.main(verbosity=2)
