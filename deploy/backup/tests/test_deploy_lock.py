#!/usr/bin/env python3
"""Stand-in lock tests: no root/production lock access or unit activation."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
KIT=Path(__file__).resolve().parents[1]
E=KIT.parents[1]/'.release-evidence/2026-11-05-gaps/g2'
class DeployLockTests(unittest.TestCase):
 def setUp(self):
  E.mkdir(exist_ok=True,parents=True);self.tmp=tempfile.TemporaryDirectory(prefix='case-',dir=E);self.w=Path(self.tmp.name);self.lock=self.w/'deploy.lock';self.lock.touch(mode=0o600);self.receipt=self.w/'child.json'
  self.child=self.w/'child.py';self.child.write_text('import json,os,sys\nfrom pathlib import Path\nPath(sys.argv[1]).write_text(json.dumps({"fds":os.listdir("/proc/self/fd")}))\n')
 def tearDown(self):self.tmp.cleanup()
 def gate(self,**extra):
  return subprocess.run([KIT/'deploy-lock.py'],env={**os.environ,'PLIEGO_BACKUP_TEST_LOCAL':'1','BACKUP_TEST_DEPLOY_LOCK':str(self.lock),'BACKUP_TEST_LOCK_COMMAND':json.dumps(['/usr/bin/python3',str(self.child),str(self.receipt)]),**extra},capture_output=True,text=True)
 def test_lock_contention_skips_without_running_backup(self):
  with self.lock.open('w') as f:
   fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);p=self.gate();self.assertEqual(p.returncode,0,p.stderr);self.assertIn('backup_skipped_deploy_lock',p.stdout);self.assertFalse(self.receipt.exists())
 def test_absent_lock_fails_closed_without_creating(self):
  self.lock.unlink();p=self.gate();self.assertNotEqual(p.returncode,0);self.assertFalse(self.lock.exists());self.assertFalse(self.receipt.exists())
 def test_existing_lock_mode_and_contents_preserved(self):
  self.lock.write_text('sentinel');self.lock.chmod(0o640);p=self.gate();self.assertEqual(p.returncode,0,p.stderr);self.assertTrue(self.receipt.exists());self.assertEqual(self.lock.read_text(),'sentinel');self.assertEqual(self.lock.stat().st_mode&0o777,0o640)
 def test_lock_held_for_full_child_duration(self):
  self.child.write_text('import fcntl,sys\nfrom pathlib import Path\nf=open(sys.argv[1],"w")\ntry:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError:Path(sys.argv[2]).write_text("held")\nelse:sys.exit(9)\n')
  p=self.gate(BACKUP_TEST_LOCK_COMMAND=json.dumps(['/usr/bin/python3',str(self.child),str(self.lock),str(self.receipt)]));self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(self.receipt.read_text(),'held')
  with self.lock.open('r') as f:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
 def test_symlink_lock_fails_closed(self):
  real=self.w/'real';self.lock.rename(real);self.lock.symlink_to(real);self.assertNotEqual(self.gate().returncode,0)
 def test_direct_execution_without_systemd_descriptor_fails_closed(self):
  p=subprocess.run([KIT/'deploy-lock.py'],env={**os.environ,'PLIEGO_BACKUP_TEST_LOCAL':'0'},capture_output=True,text=True);self.assertEqual(p.returncode,1);self.assertFalse(self.receipt.exists())
 def test_child_exit_status_propagated(self):
  self.assertEqual(self.gate(BACKUP_TEST_LOCK_COMMAND='["/usr/bin/false"]').returncode,1)
if __name__=='__main__':unittest.main(verbosity=2)
