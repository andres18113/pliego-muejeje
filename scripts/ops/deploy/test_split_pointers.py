"""Split-release regressions using only temporary trees, command stubs and loopback."""
import json
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_helpers as F

FRONTEND = 'previous-web-fixture'
FRONTEND_SHA = 'c' * 40


class SplitPointerTests(unittest.TestCase):
    write_input = F.ReleaseAndRollbackTests.write_input
    save_state = F.ReleaseAndRollbackTests.save_state
    snapshot = F.ReleaseAndRollbackTests.snapshot

    def build_manifest(self, rollback_component='all'):
        return self.release_module.prepare_manifest(
            self.manifest_input,self.migration_input,self.compatibility_input,self.paths,
            require_root=False,archive_path=self.archive_input,preflight_input=self.preflight_input,
            rollback_component=rollback_component)

    def setUp(self):
        F.ReleaseAndRollbackTests.setUp(self)
        previous = self.root/'var/www/pliego/releases'/FRONTEND
        recovery = previous.with_name(FRONTEND+'-rollback-web-for-'+F.RELEASE)
        self.previous_frontend.rename(previous)
        self.rollback_frontend.rename(recovery)
        self.previous_frontend, self.rollback_frontend = previous, recovery
        link = self.paths.at('/var/www/pliego/current')
        link.unlink()
        link.symlink_to(previous)
        self.paths = self.common.Paths(F.RELEASE,root=self.root)
        self.preflight.pop('previousReleaseId')
        self.preflight.pop('previousSourceSha')
        self.preflight.update(previousBackendReleaseId=F.PREVIOUS,
                              previousFrontendReleaseId=FRONTEND,
                              previousBackendSourceSha=F.PREVIOUS_SHA,
                              previousFrontendSourceSha=FRONTEND_SHA)
        self.preflight_input.write_text(json.dumps(self.preflight))

    def manifest(self):
        return self.common.load_json(self.paths.deployment()/'release.json')

    def activate(self):
        for name,target in [('/opt/pliego/current',self.candidate_backend),
                            ('/var/www/pliego/current',self.candidate_frontend)]:
            link = self.paths.at(name)
            link.unlink()
            link.symlink_to(target)
        self.state_value['history'] += [[v,v,self.migrations['pending'][v-F.PREVIOUS_MAX-1]['flywayChecksum'],'t','SQL',f'V{v:03d}__fixture.sql'] for v in range(F.PREVIOUS_MAX+1,F.CANDIDATE_MAX+1)]
        self.save_state()

    def test_split_manifest_records_independent_sources_and_validates_without_writes(self):
        self.build_manifest()
        manifest = self.manifest()
        self.assertEqual(manifest['manifestVersion'],3)
        self.assertEqual(manifest['previousBackendReleaseId'],F.PREVIOUS)
        self.assertEqual(manifest['previousFrontendReleaseId'],FRONTEND)
        self.assertEqual(manifest['previousBackendSourceSha'],F.PREVIOUS_SHA)
        self.assertEqual(manifest['previousFrontendSourceSha'],FRONTEND_SHA)
        self.assertEqual(manifest['rollbackFrontendSourceSha'],FRONTEND_SHA)
        self.assertEqual(manifest['rollbackFrontendReleaseId'],FRONTEND+'-rollback-web-for-'+F.RELEASE)
        self.assertEqual(manifest['previousBackendSha256'],self.preflight['previousBackendSha256'])
        self.assertEqual(manifest['previousFrontendFiles']['index.html'],F.sha(b'old index'))
        self.assertEqual(manifest['rollbackFrontendFiles']['index.html'],F.sha(b'old index'))
        before = self.snapshot()
        report = self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
        self.assertEqual(report['rollbackBackend'],'/opt/pliego/releases/'+F.PREVIOUS)
        self.assertEqual(report['rollbackFrontend'],'/var/www/pliego/releases/'+FRONTEND+'-rollback-web-for-'+F.RELEASE)
        self.assertEqual(self.snapshot(),before)
        self.assertNotIn('systemctl',self.calls.read_text())
        original = (self.paths.deployment()/'release.json').read_bytes()
        with self.assertRaises(FileExistsError): self.build_manifest()
        self.assertEqual((self.paths.deployment()/'release.json').read_bytes(),original)

    def test_each_pointer_drift_is_rejected_at_manifest_creation_and_rollback(self):
        for kind,link_name,previous in [('backend','/opt/pliego/current',self.previous_backend),
                                        ('frontend','/var/www/pliego/current',self.previous_frontend)]:
            with self.subTest(kind=kind):
                link = self.paths.at(link_name)
                other = previous.with_name('unrecorded-'+kind)
                other.mkdir()
                link.unlink(); link.symlink_to(other)
                before = self.snapshot()
                with self.assertRaisesRegex(self.common.ReleaseError,'pointer drifted'):
                    self.build_manifest()
                self.assertEqual(before,self.snapshot())
                link.unlink(); link.symlink_to(previous)
        self.build_manifest()
        for kind,link_name,previous in [('backend','/opt/pliego/current',self.previous_backend),
                                        ('frontend','/var/www/pliego/current',self.previous_frontend)]:
            with self.subTest(kind=kind):
                link = self.paths.at(link_name)
                link.unlink(); link.symlink_to(previous.with_name('unrecorded-'+kind))
                before = self.snapshot()
                for dry_run in [True,False]:
                    with self.assertRaisesRegex(self.common.ReleaseError,'pointer drifted'):
                        self.rollback_module.rollback(self.paths,dry_run=dry_run,require_root=False,url=self.url)
                # Actual rollback may create only the exclusive lock before refusing.
                after = self.snapshot()
                after.pop('run/lock/pliego-deploy.lock',None)
                before.pop('run/lock/pliego-deploy.lock',None)
                for name in ['run/lock']:
                    after.pop(name,None); before.pop(name,None)
                self.assertEqual(before,after)
                link.unlink(); link.symlink_to(previous)
        self.assertFalse(self.calls.exists())

    def test_actual_split_rollback_restores_backend_and_pf_recovery_with_complete_history(self):
        self.build_manifest()
        self.activate()
        before = self.snapshot()
        dry = self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
        self.assertEqual(before,self.snapshot())
        report = self.rollback_module.rollback(self.paths,require_root=False,url=self.url)
        self.assertEqual(self.paths.at('/opt/pliego/current').resolve(),self.previous_backend)
        self.assertEqual(self.paths.at('/var/www/pliego/current').resolve(),self.rollback_frontend)
        self.assertEqual(report['backendCurrent'],dry['rollbackBackend'])
        self.assertEqual(report['frontendCurrent'],dry['rollbackFrontend'])
        self.assertEqual(report['flywayVersion'],F.CANDIDATE_MAX)
        self.assertEqual(report['catalog']['totalCount'],F.CATALOG_COUNT)
        self.assertIn('systemctl ["stop"',self.calls.read_text())
        self.assertIn('systemctl ["start"',self.calls.read_text())

    def test_frontend_only_rollback_leaves_backend_pointer_and_service_untouched(self):
        self.build_manifest()
        self.activate()
        backend = self.paths.at('/opt/pliego/current')
        before = backend.lstat()
        dry = self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url,component='frontend')
        report = self.rollback_module.rollback(self.paths,require_root=False,url=self.url,component='frontend')
        self.assertEqual(dry['rollbackComponents'],['frontend'])
        self.assertEqual(report['backendCurrent'],'/opt/pliego/releases/'+F.RELEASE)
        self.assertEqual((backend.lstat().st_ino,backend.lstat().st_mtime_ns),(before.st_ino,before.st_mtime_ns))
        self.assertEqual(backend.resolve(),self.candidate_backend)
        self.assertEqual(self.paths.at('/var/www/pliego/current').resolve(),self.rollback_frontend)
        self.assertNotIn('systemctl',self.calls.read_text())

    def test_backend_only_rollback_leaves_frontend_pointer_untouched(self):
        self.build_manifest()
        self.activate()
        frontend = self.paths.at('/var/www/pliego/current')
        before = frontend.lstat()
        dry = self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url,component='backend')
        report = self.rollback_module.rollback(self.paths,require_root=False,url=self.url,component='backend')
        self.assertEqual(dry['rollbackComponents'],['backend'])
        self.assertEqual(report['frontendCurrent'],'/var/www/pliego/releases/'+F.RELEASE)
        self.assertEqual((frontend.lstat().st_ino,frontend.lstat().st_mtime_ns),(before.st_ino,before.st_mtime_ns))
        self.assertEqual(frontend.resolve(),self.candidate_frontend)
        self.assertEqual(self.paths.at('/opt/pliego/current').resolve(),self.previous_backend)
        self.assertIn('systemctl ["start"',self.calls.read_text())

    def test_incomplete_mixed_or_unsafe_split_pins_fail_closed(self):
        for key in ['previousBackendReleaseId','previousFrontendReleaseId','previousBackendSourceSha','previousFrontendSourceSha']:
            for value in [None,'../unsafe',True]:
                changed = dict(self.preflight)
                if value is None: changed.pop(key)
                else: changed[key] = value
                with self.subTest(key=key,value=value),self.assertRaises(self.common.ReleaseError):
                    self.common.validate_preflight(changed)
        mixed = dict(self.preflight,previousReleaseId=F.PREVIOUS,previousSourceSha=F.PREVIOUS_SHA)
        with self.assertRaises(self.common.ReleaseError): self.common.validate_preflight(mixed)

    def test_manifest_identity_and_each_tree_hash_cannot_be_rebound(self):
        self.build_manifest()
        path = self.paths.deployment()/'release.json'
        original = path.read_bytes()
        for key,value in [('previousBackendReleaseId',FRONTEND),('previousFrontendReleaseId',F.PREVIOUS),
                          ('previousBackendSourceSha',FRONTEND_SHA),('previousFrontendSourceSha',F.PREVIOUS_SHA),
                          ('rollbackFrontendReleaseId','unrecorded'),('rollbackFrontendSourceSha',F.SOURCE_SHA),
                          ('manifestVersion',2),('previousBackendSha256','0'*64),('previousIndexSha256','0'*64)]:
            manifest = json.loads(original); manifest[key] = value
            path.write_text(json.dumps(manifest))
            with self.subTest(key=key),self.assertRaises(self.common.ReleaseError):
                self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
        path.write_bytes(original)
        for tree in [self.previous_frontend,self.candidate_frontend,self.rollback_frontend]:
            target = tree/'index.html'; old = target.read_bytes(); target.write_bytes(b'drift')
            with self.subTest(tree=tree.name),self.assertRaises(self.common.ReleaseError):
                self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
            target.write_bytes(old)
        self.assertFalse(self.calls.exists())

    def test_poll_manifest_cli_validates_split_identity_and_catalog_count(self):
        self.build_manifest()
        path = self.paths.deployment()/'release.json'
        cmd = [sys.executable,'-B',str(F.SCRIPTS/'poll_catalog.py'),'--manifest',str(path),'--url',self.url]
        result = subprocess.run(cmd,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout)['totalCount'],F.CATALOG_COUNT)
        for key,value in [('previousFrontendReleaseId',F.PREVIOUS),('manifestVersion',2)]:
            manifest = self.manifest(); original = path.read_bytes(); manifest[key] = value
            path.write_text(json.dumps(manifest))
            before = len(self.http_calls)
            result = subprocess.run(cmd,capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,2,result.stderr)
            self.assertEqual(len(self.http_calls),before)
            path.write_bytes(original)

    def test_split_paths_cannot_cross_component_or_change_pinned_identities(self):
        paths = self.common.Paths(F.RELEASE,root=self.root,previous_backend=F.PREVIOUS,previous_frontend=FRONTEND)
        with self.assertRaises(self.common.ReleaseError): paths.backend(FRONTEND)
        with self.assertRaises(self.common.ReleaseError): paths.frontend(F.PREVIOUS)
        with self.assertRaises(self.common.ReleaseError): paths.with_previous(F.PREVIOUS)
        with self.assertRaises(self.common.ReleaseError): paths.with_previous_releases(FRONTEND,F.PREVIOUS)

    def test_plan_restricts_component_selection_before_any_service_or_pointer_change(self):
        self.build_manifest(rollback_component='frontend')
        self.activate()
        with self.assertRaises(self.common.ReleaseError):
            self.rollback_module.rollback(self.paths,require_root=False,url=self.url,component='backend')
        self.assertNotIn('systemctl',self.calls.read_text())
        self.assertEqual(self.paths.at('/opt/pliego/current').resolve(),self.candidate_backend)
        report = self.rollback_module.rollback(self.paths,require_root=False,url=self.url)
        self.assertEqual(report['rollbackComponents'],['frontend'])
        self.assertEqual(self.paths.at('/opt/pliego/current').resolve(),self.candidate_backend)
        self.assertEqual(self.paths.at('/var/www/pliego/current').resolve(),self.rollback_frontend)
        self.assertNotIn('systemctl',self.calls.read_text())

    def test_drain_time_drift_on_either_recorded_pointer_keeps_backend_stopped(self):
        self.build_manifest()
        self.activate()
        real_drain = self.rollback_module.stop_and_drain
        for kind,name,previous,candidate in [('backend','/opt/pliego/current',self.previous_backend,self.candidate_backend),
                                             ('frontend','/var/www/pliego/current',self.previous_frontend,self.candidate_frontend)]:
            link = self.paths.at(name)
            def drain_and_drift(**kwargs):
                real_drain(**kwargs)
                link.unlink(); link.symlink_to(previous)
            self.state_value.update(active='active',pid='321')
            self.save_state()
            with self.subTest(kind=kind),patch.object(self.rollback_module,'stop_and_drain',side_effect=drain_and_drift):
                with self.assertRaisesRegex(self.common.ReleaseError,'release state changed while draining'):
                    self.rollback_module.rollback(self.paths,require_root=False,url=self.url)
            state = json.loads(self.state.read_text())
            self.assertEqual((state['active'],state['pid']),('failed','0'))
            self.assertNotIn('systemctl ["start"',self.calls.read_text())
            link.unlink(); link.symlink_to(candidate)
        self.assertEqual(self.paths.at('/opt/pliego/current').resolve(),self.candidate_backend)
        self.assertEqual(self.paths.at('/var/www/pliego/current').resolve(),self.candidate_frontend)

    def test_split_manifest_preserves_root_and_private_mode_requirements(self):
        with patch.object(self.release_module.os,'geteuid',return_value=1000):
            with self.assertRaisesRegex(self.common.ReleaseError,'root is required'):
                self.release_module.prepare_manifest(self.manifest_input,self.migration_input,self.compatibility_input,
                    self.paths,archive_path=self.archive_input,preflight_input=self.preflight_input)
        self.build_manifest()
        with patch.object(self.rollback_module.os,'geteuid',return_value=1000):
            with self.assertRaisesRegex(self.common.ReleaseError,'root is required'):
                self.rollback_module.rollback(self.paths,dry_run=True,url=self.url)
        path = self.paths.deployment()/'release.json'
        for target,unsafe,safe in [(path,0o644,0o600),(path.parent,0o755,0o700)]:
            target.chmod(unsafe)
            with self.assertRaisesRegex(self.common.ReleaseError,'must remain private'):
                self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
            target.chmod(safe)
        self.assertFalse(self.calls.exists())

    def test_split_backend_bytes_and_compatibility_source_are_independently_pinned(self):
        original = self.compatibility_input.read_bytes()
        compatibility = dict(self.compatibility,previousSourceSha=FRONTEND_SHA)
        self.compatibility_input.write_text(json.dumps(compatibility))
        with self.assertRaisesRegex(self.common.ReleaseError,'another backend'): self.build_manifest()
        self.compatibility_input.write_bytes(original)
        old_jar = self.previous_backend/self.common.JAR_NAME
        original = old_jar.read_bytes(); old_jar.write_bytes(original+b'changed')
        with self.assertRaisesRegex(self.common.ReleaseError,'previous backend hash changed'): self.build_manifest()
        old_jar.write_bytes(original)
        self.build_manifest()
        old_jar.write_bytes(original+b'changed')
        with self.assertRaisesRegex(self.common.ReleaseError,'previous backend JAR changed'):
            self.rollback_module.rollback(self.paths,require_root=False,url=self.url)
        self.assertFalse(self.calls.exists())

    def test_frontend_only_drift_reports_unchanged_backend_without_service_calls(self):
        self.build_manifest()
        self.activate()
        real_preflight = self.rollback_module.preflight
        count = [0]
        def preflight_and_drift(*args,**kwargs):
            count[0] += 1
            if count[0] == 2:
                link = self.paths.at('/var/www/pliego/current')
                link.unlink(); link.symlink_to(self.previous_frontend)
            return real_preflight(*args,**kwargs)
        with patch.object(self.rollback_module,'preflight',side_effect=preflight_and_drift):
            with self.assertRaisesRegex(self.common.ReleaseError,'backend was not stopped'):
                self.rollback_module.rollback(self.paths,require_root=False,url=self.url,component='frontend')
        self.assertNotIn('systemctl',self.calls.read_text())
        self.assertEqual(self.paths.at('/opt/pliego/current').resolve(),self.candidate_backend)

    def test_split_cli_preparation_and_scoped_dry_run_and_actual_rollback(self):
        # Only the fixture root and production ownership checks are substituted.
        # Real argument parsing, validation, files, links, lock and command stubs run.
        wrapper = '''import functools,importlib,pathlib,sys
sys.path.insert(0,sys.argv[1])
import release_common as C
root=pathlib.Path(sys.argv[2]); module=importlib.import_module(sys.argv[3])
real_paths=C.Paths
C.Paths=lambda *a,**kw: real_paths(*a,**dict(kw,root=root))
if module.__name__=='release_json':
    module.prepare_manifest=functools.partial(module.prepare_manifest,require_root=False)
else:
    original=module.rollback
    url=sys.argv[4]
    module.rollback=functools.partial(original,require_root=False,url=url)
sys.argv=[module.__name__]+sys.argv[5:]
C.cli(module.main)
'''
        def run(module,args):
            result = subprocess.run([sys.executable,'-B','-c',wrapper,str(F.SCRIPTS),str(self.root),module,self.url,*args],
                                    capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            return json.loads(result.stdout)
        run('release_json',['--release',F.RELEASE,'--preflight',str(self.preflight_input),
            '--candidate-manifest',str(self.manifest_input),'--migrations',str(self.migration_input),
            '--compatibility-evidence',str(self.compatibility_input),'--frontend-archive',str(self.archive_input),
            '--rollback-component','frontend'])
        self.assertEqual(self.manifest()['plannedRollback']['components'],['frontend'])
        self.activate()
        before = self.snapshot()
        dry = run('rollback',['--release',F.RELEASE,'--component','frontend','--dry-run'])
        self.assertEqual(self.snapshot(),before)
        self.assertEqual(dry['rollbackComponents'],['frontend'])
        report = run('rollback',['--release',F.RELEASE,'--component','frontend'])
        self.assertEqual(report['backendCurrent'],'/opt/pliego/releases/'+F.RELEASE)
        self.assertEqual(self.paths.at('/var/www/pliego/current').resolve(),self.rollback_frontend)
        self.assertNotIn('systemctl',self.calls.read_text())


class LegacyPointerTests(unittest.TestCase):
    write_input = F.ReleaseAndRollbackTests.write_input
    save_state = F.ReleaseAndRollbackTests.save_state
    build_manifest = F.ReleaseAndRollbackTests.build_manifest
    snapshot = F.ReleaseAndRollbackTests.snapshot
    setUp = F.ReleaseAndRollbackTests.setUp

    def test_v2_manifest_retains_common_identity_dry_run_and_actual_rollback(self):
        self.build_manifest()
        manifest = self.common.load_json(self.paths.deployment()/'release.json')
        self.assertEqual(manifest['manifestVersion'],2)
        self.assertEqual(manifest['preflight'],self.preflight)
        self.assertEqual(manifest['previousSourceSha'],F.PREVIOUS_SHA)
        self.assertNotIn('previousBackendReleaseId',manifest)
        self.assertNotIn('components',manifest['plannedRollback'])
        before = self.snapshot()
        dry = self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
        self.assertEqual(self.snapshot(),before)
        report = self.rollback_module.rollback(self.paths,require_root=False,url=self.url)
        self.assertEqual(report['backendCurrent'],dry['rollbackBackend'])
        self.assertEqual(report['frontendCurrent'],dry['rollbackFrontend'])
        self.assertEqual(self.paths.at('/opt/pliego/current').resolve(),self.previous_backend)
        self.assertEqual(self.paths.at('/var/www/pliego/current').resolve(),self.rollback_frontend)

    def test_v2_manifest_poll_cli_preserves_decimal_string_count(self):
        self.build_manifest()
        result = subprocess.run([sys.executable,'-B',str(F.SCRIPTS/'poll_catalog.py'),
            '--manifest',str(self.paths.deployment()/'release.json'),'--url',self.url],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout)['totalCount'],F.CATALOG_COUNT)

    def test_same_id_v3_retains_same_targets_and_requires_matching_source_ids(self):
        self.preflight.pop('previousReleaseId'); self.preflight.pop('previousSourceSha')
        self.preflight.update(previousBackendReleaseId=F.PREVIOUS,previousFrontendReleaseId=F.PREVIOUS,
            previousBackendSourceSha=F.PREVIOUS_SHA,previousFrontendSourceSha=F.PREVIOUS_SHA)
        self.preflight_input.write_text(json.dumps(self.preflight))
        self.build_manifest()
        manifest = self.common.load_json(self.paths.deployment()/'release.json')
        self.assertEqual(manifest['manifestVersion'],3)
        report = self.rollback_module.rollback(self.paths,require_root=False,url=self.url)
        self.assertEqual(self.paths.at('/opt/pliego/current').resolve(),self.previous_backend)
        self.assertEqual(self.paths.at('/var/www/pliego/current').resolve(),self.rollback_frontend)
        self.preflight['previousFrontendSourceSha'] = FRONTEND_SHA
        with self.assertRaises(self.common.ReleaseError): self.common.validate_preflight(self.preflight)


if __name__ == '__main__':
    unittest.main()
