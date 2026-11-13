#!/usr/bin/env python3
"""Focused contract tests; Moto integration lives in object-backup-local.py."""
import importlib.util
import pathlib
import hashlib
import os
import subprocess
import sys
import tempfile
from unittest.mock import patch
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'object-backup.py'

class InventoryTests(unittest.TestCase):
    def module(self):
        self.assertTrue(SCRIPT.exists(), 'object backup implementation missing')
        spec = importlib.util.spec_from_file_location('object_backup', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_source_bytes_must_match_database_checksum(self):
        mod = self.module()
        with self.assertRaises(ValueError):
            mod.verify_plain(b'changed invoice', {'checksum': '0'*64, 'size_bytes': 15})

    def test_inventory_rejects_keys_outside_invoice_prefix(self):
        mod = self.module()
        with self.assertRaises(ValueError):
            mod.validate_inventory([{'object_key':'covers/x', 'checksum':'0'*64,'size_bytes':5}], 'invoices/')

    def test_inventory_rejects_unsafe_and_missing_checksum(self):
        mod = self.module()
        for key,checksum in [('invoices/../x','0'*64),('invoices/x',None)]:
            with self.assertRaises(ValueError):
                mod.validate_inventory([{'object_key':key,'checksum':checksum,'size_bytes':5}], 'invoices/')

    def test_plaintext_size_must_match_even_with_matching_hash(self):
        mod=self.module()
        body=b'invoice'
        with self.assertRaises(ValueError):
            mod.verify_plain(body,{'checksum':hashlib.sha256(body).hexdigest(),'size_bytes':100})

    def test_expired_credential_is_rejected_before_network(self):
        mod=self.module()
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'PLIEGO_OBJECT_BACKUP_TEST_LOCAL':'1'}):
            root=pathlib.Path(directory)
            credential=root/'credential.json'
            credential.write_text('{"access_key":"LOCAL","secret_key":"LOCAL","expires_at":"2000-01-01T00:00:00Z"}')
            with self.assertRaisesRegex(ValueError,'expired'):
                mod.Store('http://127.0.0.1:1','test-store',credential,root,'source',readonly=True)

    def test_local_test_mode_cannot_target_external_host(self):
        mod=self.module()
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,{'PLIEGO_OBJECT_BACKUP_TEST_LOCAL':'1'}):
            root=pathlib.Path(directory)
            with self.assertRaisesRegex(ValueError,'endpoint'):
                mod.Store('https://example.com','test-store',root/'missing',root,'source')

    def test_copy_is_disabled_without_explicit_opt_in(self):
        environment=os.environ.copy()
        environment.pop('OBJECT_BACKUP_ENABLED',None)
        result=subprocess.run([sys.executable,SCRIPT,'copy'],env=environment,capture_output=True)
        self.assertEqual(result.returncode,1)
        self.assertNotIn(b'Traceback',result.stderr)

    def test_offline_inventory_pin_is_required_and_checked(self):
        mod=self.module()
        with tempfile.TemporaryDirectory() as directory:
            inventory=pathlib.Path(directory)/'covers.json'
            inventory.write_text('[]')
            with self.assertRaises(ValueError):
                mod.file_inventory(inventory,'covers/','0'*64)
            self.assertEqual(mod.file_inventory(inventory,'covers/',hashlib.sha256(b'[]').hexdigest()),[])

    def test_empty_database_inventory_is_valid(self):
        self.assertEqual(self.module().validate_inventory([], 'invoices/'), [])

if __name__ == '__main__': unittest.main()
