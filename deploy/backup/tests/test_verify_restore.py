#!/usr/bin/env python3
import datetime
import importlib.util
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'verify-restore.py'
spec = importlib.util.spec_from_file_location('verifier', SCRIPT)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)

class VerifierTest(unittest.TestCase):
    def test_latest_complete_ignores_partial_and_other_tiers(self):
        old = 'frequent/20261105T001500Z-'+'a'*32+'/complete.json'
        new = 'frequent/20261105T061500Z-'+'b'*32+'/complete.json'
        self.assertEqual(verifier.newest_complete_key([old,new.replace('complete.json','backup.tar.gpg'),'monthly/'+new,new], 'frequent'), new)

    def test_missing_or_unsafe_complete_fails_closed(self):
        for keys in ([], ['frequent/../../complete.json'], ['frequent/new/complete.json']):
            with self.assertRaises(ValueError):
                verifier.newest_complete_key(keys, 'frequent')

    def test_marker_must_match_id_and_be_fresh(self):
        now = datetime.datetime(2026,11,5,7,tzinfo=datetime.timezone.utc)
        key = 'frequent/20261105T061500Z-'+'b'*32+'/complete.json'
        marker = {'id':key.split('/')[1], 'bytes':123, 'sha256':'a'*64,'completed_at':'2026-11-05T06:15:00Z'}
        verifier.validate_marker(marker, key, now, 7*3600)
        for mutation in ({'id':'wrong'}, {'completed_at':'2026-11-05T08:00:00Z'}, {'completed_at':'2026-11-01T00:00:00Z'}, {'sha256':'bad'}, {'bytes':0}):
            with self.assertRaises(ValueError):
                verifier.validate_marker(dict(marker, **mutation), key, now, 7*3600)

    def test_flyway_gap_failure_and_wrong_release_fail(self):
        self.assertTrue(verifier.flyway_valid({'versions':[1,2,3], 'all_success':True,'ranks':[1,2,3]}, 3))
        for data in ({'versions':[1,3], 'all_success':True,'ranks':[1,2]}, {'versions':[1,2,3], 'all_success':False,'ranks':[1,2,3]}, {'versions':[1,2], 'all_success':True,'ranks':[1,2]}, {'versions':[1,2,3], 'all_success':True,'ranks':[1,2,4]}):
            self.assertFalse(verifier.flyway_valid(data,3))

if __name__ == '__main__':
    unittest.main()
