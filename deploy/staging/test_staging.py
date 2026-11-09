#!/usr/bin/env python3
"""Safety and parity tests: no SSH, package install or service mutation."""
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock
from types import SimpleNamespace
import zipfile

HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('staging',HERE/'staging.py')
kit=importlib.util.module_from_spec(spec);spec.loader.exec_module(kit)

class StagingSafety(unittest.TestCase):
    def test_production_unit_is_byte_identical_to_readonly_inventory(self):
        lines=(kit.ROOT/'.release-evidence/2026-11-04-vps-audit/prod/inventory-221729.txt').read_text().splitlines(keepends=True)
        self.assertEqual((HERE/'pliego.service').read_text(),''.join(lines[251:295]))
        self.assertEqual((HERE/'99-pliego.conf').read_text(),''.join(lines[636:645]))

    def test_management_default_stays_disabled(self):
        default=(kit.ROOT/'backend/src/main/resources/application.yml').read_text()
        self.assertRegex(default,r'(?m)^management:\n(?:  #.*\n)*  server:\n    port: -1$')
        self.assertNotIn('NativeMemoryTracking',(HERE/'pliego.service').read_text())

    def test_record_rejects_public_target_and_shared_generator(self):
        record=json.loads((HERE/'isolated-record.example.json').read_text())
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'r.json'
            for field,value in [('target_ipv4','8.8.8.8'),('generator_ipv4',record['target_ipv4']),('purpose','production')]:
                modified={**record,field:value};path.write_text(json.dumps(modified))
                with self.subTest(field=field),self.assertRaises(ValueError):kit.load_record(path)
            path.write_text(json.dumps(record))
            with self.assertRaises(ValueError):kit.load_record(path,True)

    def test_matrix_is_bounded_and_contains_three_600s_15vu_repeats(self):
        self.assertEqual(len(kit.MATRIX),7)
        self.assertEqual([r for r in kit.MATRIX if r[1]==15 and r[2]=='600s' and not r[3]],kit.MATRIX[3:6])
        self.assertEqual(kit.MATRIX[-1],('users15-sse',15,'600s',True))
        self.assertLessEqual(max(row[1] for row in kit.MATRIX),15)

    def test_seed_failure_finally_restores_restrictive_hba_without_host_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=pathlib.Path(tmp)
            run=SimpleNamespace(out=out,write=mock.Mock(),command=mock.Mock(return_value={"exit_status":0}))
            (out/'bootstrap-trust-open').touch()
            with self.assertRaisesRegex(RuntimeError,'seed failed'):
                try:raise RuntimeError('seed failed')
                finally:kit.cleanup_bootstrap_trust(SimpleNamespace(apply=True),run)
            target,contents,mode=run.write.call_args.args
            self.assertEqual(target,'/etc/postgresql/18/main/pg_hba.conf')
            self.assertNotIn('trust',contents)
            self.assertIn('local all postgres peer',contents)
            self.assertIn('scram-sha-256',contents)
            self.assertEqual(mode,0o640)
            self.assertFalse((out/'bootstrap-trust-open').exists())
            run.command.assert_any_call(['systemctl','reload','postgresql@18-main'],check=False)
            run.command.assert_any_call(['systemctl','stop','pliego'],check=False)
            run.command.assert_any_call(['systemctl','stop','postgresql@18-main'],check=False)
            # A normal plan cannot write HBA even when presented a cleanup marker.
            run.write.reset_mock();(out/'bootstrap-trust-open').touch()
            kit.cleanup_bootstrap_trust(SimpleNamespace(apply=False),run)
            run.write.assert_not_called()

    def test_failed_cleanup_stops_postgres_and_retains_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=pathlib.Path(tmp);(out/'bootstrap-trust-open').touch()
            run=SimpleNamespace(out=out,write=mock.Mock(),command=mock.Mock(side_effect=[{'exit_status':0},{'exit_status':1},{'exit_status':0},{'exit_status':0}]))
            with self.assertRaisesRegex(ValueError,'cleanup incomplete'):
                kit.cleanup_bootstrap_trust(SimpleNamespace(apply=True),run)
            self.assertTrue((out/'bootstrap-trust-open').exists())
            run.command.assert_any_call(['systemctl','stop','postgresql@18-main'],check=False)
            self.assertNotIn('trust',run.write.call_args.args[1])

    def test_manifest_rejects_missing_corrupt_and_unfrozen_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=pathlib.Path(tmp)
            pins={'java_version':'25.0.5+8','postgres_version':'18.6','ubuntu_version':'24.04.5','debs':['pg.deb'],'artifacts':{}}
            files=[p for p in HERE.glob('*') if p.is_file()]
            files += [kit.ROOT/p for p in ['perf/k6/bootstrap.py','perf/k6/seed.sql','scripts/LocalFlyway.java','docs/deployment/production-runbook.md','perf/k6/journeys.js','perf/k6/target-guard.js','perf/jvm/fatal-collector.py']]
            files += [p for p in (kit.ROOT/'backend/src/main/resources/db/migration').glob('*') if p.is_file()]
            (folder/'frozen-sources.sha256').write_text(''.join(kit.sha(p)+'  '+str(p.relative_to(kit.ROOT))+'\n' for p in files))
            (folder/'temurin-25.0.5+8.tar.gz').write_bytes(b'synthetic immutable archive')
            (folder/'pg.deb').write_bytes(b'synthetic immutable package')
            jarpath=folder/'pliego-backend-0.1.0-SNAPSHOT.jar'
            with zipfile.ZipFile(jarpath,'w') as jar:
                for file in (kit.ROOT/'backend/src/main/resources/db/migration').glob('*.sql'):
                    jar.write(file,'BOOT-INF/classes/db/migration/'+file.name)
            for file in folder.iterdir():pins['artifacts'][file.name]=kit.sha(file)
            manifest=folder/'pins.json';manifest.write_text(json.dumps(pins))
            self.assertEqual(kit.validate_pins(folder,manifest)['postgres_version'],'18.6')
            (folder/'pg.deb').write_bytes(b'corrupted')
            with self.assertRaisesRegex(ValueError,'checksum mismatch'):kit.validate_pins(folder,manifest)
            (folder/'pg.deb').write_bytes(b'synthetic immutable package')
            (folder/'frozen-sources.sha256').write_text('')
            pins['artifacts']['frozen-sources.sha256']=kit.sha(folder/'frozen-sources.sha256');manifest.write_text(json.dumps(pins))
            with self.assertRaisesRegex(ValueError,'does not cover'):kit.validate_pins(folder,manifest)
            del pins['artifacts']['pg.deb'];manifest.write_text(json.dumps(pins))
            with self.assertRaisesRegex(ValueError,'Missing pinned'):kit.validate_pins(folder,manifest)

if __name__=='__main__':unittest.main(verbosity=2)
