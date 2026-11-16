#!/usr/bin/env python3
"""G2-1: real systemd-tmpfiles under a private stand-in root, never /run itself.

The exact root:root rule is attempted unprivileged. A test-only numeric UID/GID
variant proves successful full cycles without claiming root ownership was tested.
"""
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

KIT = Path(__file__).resolve().parents[1]
EVIDENCE = KIT.parents[1]/'.release-evidence/2026-11-05-gaps/g2/correction-g2-1'
RULE = b'f /run/lock/pliego-deploy.lock 0600 root root - -\n'


class TmpfilesTests(unittest.TestCase):
    def setUp(self):
        EVIDENCE.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='case-', dir=EVIDENCE)
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name).resolve()
        self.sequence = 0

    def source_rule(self):
        source = KIT/'pliego-deploy-lock.tmpfiles.conf'
        self.assertTrue(source.is_file(), 'missing reviewed boot-time tmpfiles rule')
        self.assertEqual(source.read_bytes(), RULE)
        return source.read_text()

    def root(self, name, mapped):
        root = self.work/name
        (root/'etc/tmpfiles.d').mkdir(parents=True)
        (root/'run/lock').mkdir(parents=True)
        # --root applies only to this disposable filesystem; root identity stays
        # literal in the exact probe. The successful fixture changes owners only.
        (root/'etc/passwd').write_text('root:x:0:0:root:/root:/bin/sh\n')
        (root/'etc/group').write_text('root:x:0:\n')
        text = self.source_rule()
        if mapped:
            text = text.replace(' root root ', f' {os.getuid()} {os.getgid()} ')
        (root/'etc/tmpfiles.d/pliego-deploy-lock.conf').write_text(text)
        return root

    def run_logged(self, command, label, extra=None):
        self.sequence += 1
        process = subprocess.run(list(map(str, command)), capture_output=True,
                                 text=True, env={**os.environ, **(extra or {})}, timeout=15)
        name = f'{self.id().split(".")[-1]}-{self.sequence:02}-{label}.log'
        log = EVIDENCE/name
        log.write_text('$ '+' '.join(map(str, command))+'\n'+process.stdout+process.stderr+
                       f'\nEXIT_STATUS={process.returncode}\n')
        with (EVIDENCE/'tmpfiles-commands.jsonl').open('a') as ledger:
            ledger.write(json.dumps({'command':list(map(str,command)),
                                    'exit_status':process.returncode, 'log':name})+'\n')
        return process

    def create(self, root, label):
        return self.run_logged(['systemd-tmpfiles','--create','--root='+str(root),
                                'pliego-deploy-lock.conf'], label)

    def gate(self, lock, output):
        # Reuse the existing reviewed wrapper, not a reimplementation of flock.
        return self.run_logged([KIT/'deploy-lock.py'], 'wrapper', {
            'PLIEGO_BACKUP_TEST_LOCAL':'1', 'BACKUP_TEST_DEPLOY_LOCK':str(lock),
            'BACKUP_TEST_LOCK_COMMAND':json.dumps(['/usr/bin/touch',str(output)])})

    def exercise(self, mapped):
        root = self.root('mapped' if mapped else 'exact', mapped)
        lock = root/'run/lock/pliego-deploy.lock'
        self.assertFalse(lock.exists())
        attempts = []
        def create(label):
            result = self.create(root, label)
            attempts.append({'step':label,'exit_status':result.returncode,
                             'diagnostic':result.stderr.strip()})
            if mapped:
                self.assertEqual(result.returncode, 0, result.stderr)
            elif result.returncode:
                self.assertIn('fchown',result.stderr)
            return result
        create('absent')
        self.assertTrue(lock.is_file())
        self.assertEqual(lock.read_bytes(), b'')
        self.assertEqual(stat.S_IMODE(lock.stat().st_mode), 0o600)
        inode = (lock.stat().st_dev, lock.stat().st_ino)
        create('idempotent')
        self.assertEqual(lock.read_bytes(), b'')
        self.assertEqual((lock.stat().st_dev, lock.stat().st_ino), inode)
        body = b'G2-1 existing lock contents must survive\n'
        lock.write_bytes(body)
        # For the successful unprivileged ownership mapping, explicitly prove
        # f DOES adjust an existing mode: 0640 becomes requested 0600.
        if mapped:
            lock.chmod(0o640)
        output = root/'child-ran'
        with lock.open('rb') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            create('held-content')
            self.assertEqual(lock.read_bytes(), body)
            self.assertEqual((lock.stat().st_dev, lock.stat().st_ino), inode)
            with lock.open('rb') as contender:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
            skipped = self.gate(lock, output)
            self.assertEqual(skipped.returncode, 0, skipped.stderr)
            self.assertIn('backup_skipped_deploy_lock', skipped.stdout)
            self.assertFalse(output.exists())
        proceeded = self.gate(lock, output)
        self.assertEqual(proceeded.returncode, 0, proceeded.stderr)
        self.assertTrue(output.exists())
        self.assertEqual(lock.read_bytes(), body)
        self.assertEqual(stat.S_IMODE(lock.stat().st_mode), 0o600)
        if mapped:
            self.assertEqual((lock.stat().st_uid,lock.stat().st_gid), (os.getuid(),os.getgid()))
        # Persist proof before TemporaryDirectory cleanup, with precise scope.
        (EVIDENCE/('mapped-result.json' if mapped else 'exact-result.json')).write_text(
            json.dumps({'uid':os.getuid(),'gid':os.getgid(),'fixture_rule':(root/'etc/tmpfiles.d/pliego-deploy-lock.conf').read_text(),
                        'tmpfiles_attempts':attempts,'zero_byte_creation':True,'idempotent_same_inode':True,
                        'existing_bytes_preserved':True,'held_flock_survived':True,
                        'wrapper_skipped_while_locked_then_ran':True,'final_mode':oct(stat.S_IMODE(lock.stat().st_mode)),
                        'final_owner':[lock.stat().st_uid,lock.stat().st_gid],
                        'existing_mode_0640_to_0600_proven':mapped,
                        'actual_root_owner_creation_proven':not mapped and lock.stat().st_uid==0 and lock.stat().st_gid==0,
                        'scope':'Real systemd-tmpfiles in --root stand-in; no root privilege or real /run access'},indent=2)+'\n')

    def test_exact_rule_and_explicit_service_order(self):
        self.source_rule()
        service = (KIT/'pliego-backup.service').read_text()
        after = ' '.join(line.split('=',1)[1] for line in service.splitlines() if line.startswith('After='))
        self.assertIn('systemd-tmpfiles-setup.service', after.split())
        self.assertIn('OpenFile=/run/lock/pliego-deploy.lock:deploy-lock:read-only', service)
        self.assertIn('User=postgres\n', service)
        self.assertIn('CapabilityBoundingSet=\n', service)

    def test_exact_root_rule_unprivileged_creation_and_lock_survival(self):
        self.assertNotEqual(os.geteuid(),0,'This drill must run without root')
        self.exercise(mapped=False)

    def test_numeric_owner_fixture_success_and_existing_mode_adjustment(self):
        self.assertNotEqual(os.geteuid(),0,'This drill must run without root')
        self.exercise(mapped=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
