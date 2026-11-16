"""Invoice success/failure and deploy exclusion with disposable command stand-ins."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

KIT = Path(__file__).resolve().parents[1]
EVIDENCE = KIT.parents[1]/'.release-evidence/2026-11-05-gaps/g2'


class InvoiceUnitTests(unittest.TestCase):
    def setUp(self):
        EVIDENCE.mkdir(exist_ok=True, parents=True)
        self.tmp = tempfile.TemporaryDirectory(prefix='invoice-', dir=EVIDENCE)
        self.root = Path(self.tmp.name)
        self.wrapper = self.root/'invoice-backup.sh'
        shutil.copyfile(KIT/'invoice-backup.sh', self.wrapper)
        self.wrapper.chmod(0o755)
        self.heartbeat = self.root/'heartbeat-result'
        (self.root/'object-backup.py').write_text('import os,sys\nsys.exit(int(os.environ.get("COPY_STATUS","0")))\n')
        helper = self.root/'heartbeat.py'
        helper.write_text('#!/usr/bin/env python3\nimport os,sys\nfrom pathlib import Path\nPath(os.environ["HEARTBEAT_MARKER"]).touch()\nsys.exit(int(os.environ.get("HEARTBEAT_STATUS","0")))\n')
        helper.chmod(0o755)
        self.env = {**os.environ, 'BACKUP_HEARTBEAT_ENABLED': '1', 'HEARTBEAT_MARKER': str(self.heartbeat)}
        self.lock = self.root/'deploy.lock'
        self.lock.touch(mode=0o600)

    def tearDown(self):
        self.tmp.cleanup()

    def invoke(self, **extra):
        return subprocess.run([str(self.wrapper)], env={**self.env, **extra}, capture_output=True, text=True)

    def gate(self):
        return subprocess.run([str(KIT/'deploy-lock.py'), '--job', 'invoices'],
                              env={**self.env, 'PLIEGO_BACKUP_TEST_LOCAL': '1',
                                   'BACKUP_TEST_DEPLOY_LOCK': str(self.lock),
                                   'BACKUP_TEST_LOCK_COMMAND': json.dumps([str(self.wrapper)])},
                              capture_output=True, text=True)

    def test_copy_failure_never_sends_success(self):
        result = self.invoke(COPY_STATUS='7')
        self.assertEqual(result.returncode, 7)
        self.assertFalse(self.heartbeat.exists())

    def test_completed_copy_keeps_success_if_heartbeat_helper_fails(self):
        result = self.invoke(HEARTBEAT_STATUS='9')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.heartbeat.exists())
        self.assertIn('status unchanged', result.stderr)

    def test_completed_copy_keeps_success_if_heartbeat_helper_missing(self):
        (self.root/'heartbeat.py').unlink()
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('status unchanged', result.stderr)

    def test_disabled_heartbeat_does_not_invoke_helper(self):
        self.assertEqual(self.invoke(BACKUP_HEARTBEAT_ENABLED='0').returncode, 0)
        self.assertFalse(self.heartbeat.exists())

    def test_invoice_job_skip_does_not_copy_or_send_success(self):
        with self.lock.open('r') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.gate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('backup_skipped_deploy_lock', result.stdout)
        self.assertFalse(self.heartbeat.exists())

    def test_invoice_job_holds_deploy_lock_during_entire_copy(self):
        (self.root/'object-backup.py').write_text(
            'import fcntl,os,sys\nf=open(os.environ["BACKUP_TEST_DEPLOY_LOCK"],"r")\n'
            'try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\n'
            'except BlockingIOError: sys.exit(0)\nelse: sys.exit(18)\n')
        result = self.gate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.heartbeat.exists())
        with self.lock.open('r') as released:
            fcntl.flock(released, fcntl.LOCK_EX | fcntl.LOCK_NB)


if __name__ == '__main__':
    unittest.main(verbosity=2)
