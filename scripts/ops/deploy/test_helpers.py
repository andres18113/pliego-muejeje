#!/usr/bin/env python3
"""Offline safety fixtures. No production paths, credentials or network are used."""
import ast
import base64
import fcntl
import hashlib
import importlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
from unittest.mock import patch
import zipfile

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNGcAAAAASUVORK5CYII=')
BRAND_FILES = ['brand/pliego-logo-email.png','brand/pliego-logo.png']
RELEASE = 'candidate-fixture'
PREVIOUS = 'previous-fixture'
SOURCE_SHA = 'a' * 40
PREVIOUS_SHA = 'b' * 40
CI_RUN = 73
PREVIOUS_MAX = 3
CANDIDATE_MAX = 5
CATALOG_COUNT = 7


def sha(data):
    return hashlib.sha256(data).hexdigest()


def jar(path, limit, mutated=None, duplicate=False):
    with zipfile.ZipFile(path, 'w') as archive:
        for version in range(1, limit + 1):
            payload = (f'SELECT {version};\n').encode()
            if version == mutated:
                payload += b'-- illegal historical edit\n'
            archive.writestr(f'BOOT-INF/classes/db/migration/V{version:03d}__fixture.sql', payload)
        if duplicate:
            archive.writestr('BOOT-INF/classes/db/migration/V001__other.sql', b'SELECT 1;')


def archive(path, files, special=None):
    with tarfile.open(path, 'w') as output:
        for name, payload in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(payload)
            output.addfile(member, io.BytesIO(payload))
        if special:
            output.addfile(special)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_migration_comparison_detects_changed_missing_duplicate_and_extra_versions(self):
        module = importlib.import_module('compare_migrations')
        old, candidate = self.root / 'old.jar', self.root / 'new.jar'
        jar(old, PREVIOUS_MAX)
        jar(candidate, CANDIDATE_MAX)
        report = module.compare(old, candidate, PREVIOUS_MAX, CANDIDATE_MAX)
        self.assertEqual(report['historicalCount'], PREVIOUS_MAX)
        self.assertEqual([row['version'] for row in report['pending']], list(range(PREVIOUS_MAX + 1, CANDIDATE_MAX + 1)))
        for limit, mutated, duplicate in [(CANDIDATE_MAX,2,False),(CANDIDATE_MAX-1,None,False),(CANDIDATE_MAX+1,None,False),(CANDIDATE_MAX,None,True)]:
            jar(candidate, limit, mutated, duplicate)
            with self.subTest(limit=limit, mutated=mutated, duplicate=duplicate), self.assertRaises(importlib.import_module('release_common').ReleaseError):
                module.compare(old, candidate, PREVIOUS_MAX, CANDIDATE_MAX)

    def test_invalid_zip_cli_returns_sanitized_error(self):
        broken = self.root/'broken.jar'
        broken.write_bytes(b'not a zip archive')
        result = subprocess.run(
            [sys.executable,str(SCRIPTS/'compare_migrations.py'),str(broken),str(broken),
             '--previous-max',str(PREVIOUS_MAX),'--candidate-max',str(CANDIDATE_MAX)],
            capture_output=True,text=True)
        self.assertEqual(result.returncode,2)
        self.assertNotIn('Traceback',result.stderr)
        self.assertNotIn(str(broken),result.stderr)


class FrontendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.previous = self.root / 'previous'
        (self.previous / 'assets').mkdir(parents=True)
        (self.previous / 'index.html').write_bytes(b'old index')
        (self.previous / 'assets/old-ABCdef12.js').write_bytes(b'old lazy')
        (self.previous / 'assets/shared-ABCDEFGH.js').write_bytes(b'same collision')
        (self.previous / 'unhashed.js').write_bytes(b'private old')
        self.files = {'index.html':b'new index', 'assets/new-1234abcd.js':b'new lazy', 'assets/shared-ABCDEFGH.js':b'same collision'}
        for name in BRAND_FILES:
            (self.previous/name).parent.mkdir(parents=True,exist_ok=True)
            (self.previous/name).write_bytes(PNG)
            self.files[name] = PNG
        self.tar = self.root / 'dist.tar'
        archive(self.tar, self.files)

    def test_bidirectional_assets_preserve_indices_and_never_overwrite(self):
        module = importlib.import_module('prepare_frontend')
        target, rollback = self.root / 'candidate', self.root / 'rollback'
        report = module.prepare(self.tar, self.previous, target, rollback, require_root=False)
        self.assertEqual((target/'index.html').read_bytes(), b'new index')
        self.assertEqual((rollback/'index.html').read_bytes(), b'old index')
        self.assertEqual((target/'assets/shared-ABCDEFGH.js').read_bytes(), b'same collision')
        self.assertEqual((rollback/'assets/shared-ABCDEFGH.js').read_bytes(), b'same collision')
        self.assertTrue((target/'assets/old-ABCdef12.js').is_file())
        self.assertTrue((rollback/'assets/new-1234abcd.js').is_file())
        self.assertFalse((target/'unhashed.js').exists())
        self.assertEqual((self.previous/'assets/shared-ABCDEFGH.js').read_bytes(), b'same collision')
        self.assertEqual(report['rollbackIndexSha256'], sha(b'old index'))
        for directory in [target,rollback]:
            for entry in [directory,*directory.rglob('*')]:
                self.assertEqual(stat.S_IMODE(entry.stat().st_mode), 0o755 if entry.is_dir() else 0o644)
        with self.assertRaises(importlib.import_module('release_common').ReleaseError):
            module.prepare(self.tar, self.previous, target, rollback, require_root=False)

    def test_rejects_archive_traversal_links_duplicates_secret_source_and_preexisting_symlinks(self):
        module = importlib.import_module('prepare_frontend')
        names = ['../escape','/absolute','assets/../../escape','./index.html','assets\\bad.js','.env','src/main.ts','assets/main.js.map','node_modules/x.js','id_rsa','assets/a//b.js']
        for number,name in enumerate(names):
            with self.subTest(name=name):
                archive(self.tar, {'index.html':b'new',name:b'bad'})
                with self.assertRaises(importlib.import_module('release_common').ReleaseError):
                    module.prepare(self.tar,self.previous,self.root/f'target{number}',self.root/f'rollback{number}',require_root=False)
        for kind in [tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.DIRTYPE,tarfile.FIFOTYPE]:
            member = tarfile.TarInfo('assets/special')
            member.type = kind
            member.linkname = '/etc/passwd'
            archive(self.tar, {'index.html':b'new'}, member)
            with self.subTest(kind=kind), self.assertRaises(importlib.import_module('release_common').ReleaseError):
                module.prepare(self.tar,self.previous,self.root/'target-special',self.root/'rollback-special',require_root=False)
        archive(self.tar, {'index.html':b'new'}, tarfile.TarInfo('index.html'))
        with self.assertRaises(importlib.import_module('release_common').ReleaseError):
            module.prepare(self.tar,self.previous,self.root/'target-dup',self.root/'rollback-dup',require_root=False)
        (self.previous/'assets/linked-abcdefgh.js').symlink_to('/etc/passwd')
        archive(self.tar,self.files)
        with self.assertRaises(importlib.import_module('release_common').ReleaseError):
            module.prepare(self.tar,self.previous,self.root/'target-link',self.root/'rollback-link',require_root=False)

    def test_hash_named_collision_with_different_bytes_is_rejected_before_writes(self):
        module = importlib.import_module('prepare_frontend')
        self.files['assets/shared-ABCDEFGH.js'] = b'hash collision'
        archive(self.tar,self.files)
        with self.assertRaises(importlib.import_module('release_common').ReleaseError):
            module.prepare(self.tar,self.previous,self.root/'candidate',self.root/'rollback',require_root=False)
        self.assertFalse((self.root/'candidate').exists())

    def test_missing_or_html_brand_images_refuse_frontend_preparation_before_creation(self):
        module = importlib.import_module('prepare_frontend')
        for location in ['archive','previous']:
            for name in BRAND_FILES:
                for bad in [None,b'<html>SPA fallback</html>']:
                    candidate,rollback = self.root/'candidate-brand',self.root/'rollback-brand'
                    payloads = dict(self.files)
                    if location == 'archive':
                        if bad is None: payloads.pop(name)
                        else: payloads[name] = bad
                    else:
                        if bad is None: (self.previous/name).unlink()
                        else: (self.previous/name).write_bytes(bad)
                    archive(self.tar,payloads)
                    with self.subTest(location=location,name=name,bad=bad),self.assertRaises(importlib.import_module('release_common').ReleaseError):
                        module.prepare(self.tar,self.previous,candidate,rollback,require_root=False)
                    self.assertFalse(candidate.exists())
                    self.assertFalse(rollback.exists())
                    (self.previous/name).write_bytes(PNG)

    def test_replacing_staging_archive_after_validation_cannot_change_extraction_names(self):
        module = importlib.import_module('prepare_frontend')
        evil = self.root/'evil.tar'
        archive(evil,{'../escaped':b'bad','index.html':b'evil'})
        original = module.validate_members
        def validate_then_swap(open_archive):
            entries = original(open_archive)
            os.replace(evil,self.tar)
            return entries
        with patch.object(module,'validate_members',side_effect=validate_then_swap):
            module.prepare(self.tar,self.previous,self.root/'candidate',self.root/'rollback',require_root=False)
        self.assertFalse((self.root/'escaped').exists())
        self.assertEqual((self.root/'candidate/index.html').read_bytes(),b'new index')


class ReleaseAndRollbackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'root'
        self.root.mkdir()
        self.common = importlib.import_module('release_common')
        self.paths = self.common.Paths(RELEASE, PREVIOUS, root=self.root)
        self.release_module = importlib.import_module('release_json')
        self.rollback_module = importlib.import_module('rollback')
        self.compare = importlib.import_module('compare_migrations')
        self.previous_backend = self.paths.backend(PREVIOUS)
        self.candidate_backend = self.paths.backend(RELEASE)
        self.previous_frontend = self.paths.frontend(PREVIOUS)
        self.candidate_frontend = self.paths.frontend(RELEASE)
        self.rollback_frontend = self.paths.frontend(PREVIOUS+'-rollback-web-for-'+RELEASE)
        for path in [self.previous_backend,self.candidate_backend,self.previous_frontend,self.candidate_frontend,self.rollback_frontend]:
            path.mkdir(parents=True)
        jar(self.previous_backend/self.common.JAR_NAME,PREVIOUS_MAX)
        jar(self.candidate_backend/self.common.JAR_NAME,CANDIDATE_MAX)
        (self.previous_frontend/'index.html').write_bytes(b'old index')
        (self.candidate_frontend/'index.html').write_bytes(b'new index')
        (self.rollback_frontend/'index.html').write_bytes(b'old index')
        for directory in [self.previous_frontend,self.candidate_frontend,self.rollback_frontend]:
            for name in BRAND_FILES:
                (directory/name).parent.mkdir(parents=True,exist_ok=True)
                (directory/name).write_bytes(PNG)
        for path in [self.paths.at('/opt/pliego/current'),self.paths.at('/var/www/pliego/current')]:
            path.symlink_to(self.previous_backend if str(path).endswith('/opt/pliego/current') else self.previous_frontend)
        env = self.paths.at('/etc/pliego/pliego.env')
        env.parent.mkdir(parents=True)
        env.write_text('PLIEGO_R2_ENABLED=true\nPLIEGO_MAIL_ENABLED=true\nPLIEGO_MAIL_TOKEN=DO-NOT-PRINT\n')
        env.chmod(0o600)
        self.inputs = Path(self.temp.name)/'inputs'
        self.inputs.mkdir()
        self.artifacts = {'sourceSha':SOURCE_SHA,'ciRunId':CI_RUN,'backendSha256':sha((self.candidate_backend/self.common.JAR_NAME).read_bytes()),'frontendArchiveSha256':sha(b'archive'),'frontendFiles':{'index.html':sha(b'new index')}}
        self.artifacts['frontendFiles'].update({name:sha(PNG) for name in BRAND_FILES})
        self.migrations = self.compare.compare(self.previous_backend/self.common.JAR_NAME,self.candidate_backend/self.common.JAR_NAME,PREVIOUS_MAX,CANDIDATE_MAX)
        self.compatibility = {'candidateSourceSha':SOURCE_SHA,'candidateJarSha256':self.artifacts['backendSha256'],'previousSourceSha':PREVIOUS_SHA,'supportedSchemaVersions':[PREVIOUS_MAX,CANDIDATE_MAX],'restrictedRuntime':True,'expectedProductionCatalogTotalCount':CATALOG_COUNT,'observedLocalCatalogTotalCount':1,'emergencyRollbackCompatible':True,'fullFeatureParity':False,'limitations':['new clients may need reload']}
        self.preflight = {'releaseId':RELEASE,'sourceSha':SOURCE_SHA,'ciRunId':CI_RUN,'previousReleaseId':PREVIOUS,'previousSourceSha':PREVIOUS_SHA,'previousBackendSha256':sha((self.previous_backend/self.common.JAR_NAME).read_bytes()),'previousIndexSha256':sha(b'old index'),'expectedCatalogTotalCount':CATALOG_COUNT,'previousMaxFlyway':PREVIOUS_MAX,'candidateMaxFlyway':CANDIDATE_MAX}
        self.preflight_input = self.write_input('preflight.json',self.preflight)
        self.archive_input = self.inputs/'frontend.tar'
        self.archive_input.write_bytes(b'archive')
        self.paths.at('/run/lock').mkdir(parents=True)
        self.manifest_input = self.write_input('candidate.json',self.artifacts)
        self.migration_input = self.write_input('migrations.json',self.migrations)
        self.compatibility_input = self.write_input('compatibility.json',self.compatibility)
        self.calls = Path(self.temp.name)/'calls.log'
        self.state = Path(self.temp.name)/'state.json'
        self.state_value = {'history':[[v,v,self.migrations['applied'][v-1]['flywayChecksum'],'t','SQL',f'V{v:03d}__fixture.sql'] for v in range(1,PREVIOUS_MAX+1)],'privileges':'f|f|f|f','owned':'0','role':'t|f|f|f|f|f','active':'active','pid':'321','nginx':True}
        self.save_state()
        self.bin = Path(self.temp.name)/'bin'
        self.bin.mkdir()
        stub = '''#!/usr/bin/env python3
import json,os,pathlib,sys
name=pathlib.Path(sys.argv[0]).name
with open(os.environ['FIXTURE_CALLS'],'a') as log: log.write(name+' '+json.dumps(sys.argv[1:])+'\\n')
state_path=pathlib.Path(os.environ['FIXTURE_STATE'])
state=json.loads(state_path.read_text())
if name=='runuser':
    assert sys.argv[1:4]==['-u','postgres','--']
    os.execvp(sys.argv[4],sys.argv[4:])
if name=='psql':
    assert sys.argv[sys.argv.index('-h')+1]=='/var/run/postgresql'
    assert sys.argv[sys.argv.index('-p')+1]=='5432'
    assert sys.argv[sys.argv.index('-U')+1]=='postgres'
    query=sys.argv[sys.argv.index('-c')+1]
    assert 'default_transaction_read_only=on' in os.environ.get('PGOPTIONS','')
    assert query.lstrip().startswith('SELECT')
    if 'PLIEGO_HELPER_HISTORY' in query:
        print('\\n'.join('|'.join(map(str,row)) for row in state['history']))
    elif 'PLIEGO_HELPER_PRIVILEGES' in query: print(state['privileges'])
    elif 'PLIEGO_HELPER_OWNED' in query: print(state['owned'])
    elif 'PLIEGO_HELPER_ROLE' in query: print(state['role'])
    else: sys.exit(7)
elif name=='nginx':
    assert sys.argv[1:]==['-t']
    sys.exit(0 if state['nginx'] else 1)
elif name=='systemctl':
    assert sys.argv[2]=='pliego'
    if sys.argv[1]=='show': print('ActiveState='+state['active']+'\\nResult=exit-code\\nMainPID='+state['pid'])
    elif sys.argv[1]=='stop': state.update(active='failed',pid='0')
    elif sys.argv[1]=='reset-failed': state.update(active='inactive',pid='0')
    elif sys.argv[1]=='start': state.update(active='active',pid='999')
    else: sys.exit(8)
    if sys.argv[1]!='show': state_path.write_text(json.dumps(state))
else: sys.exit(9)
'''
        for command in ['runuser','psql','nginx','systemctl']:
            file = self.bin/command
            file.write_text(stub)
            file.chmod(0o755)
        self.env_patch = patch.dict(os.environ,{'PATH':str(self.bin)+os.pathsep+os.environ['PATH'],'FIXTURE_CALLS':str(self.calls),'FIXTURE_STATE':str(self.state)})
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.http_calls = []
        fixture = self
        class Catalog(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                fixture.http_calls.append(self.path)
                payload = json.dumps({'items':[{}],'totalCount':str(CATALOG_COUNT)}).encode()
                self.send_response(200)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        self.server = ThreadingHTTPServer(('127.0.0.1',0),Catalog)
        self.server_thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.server_thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url = f'http://127.0.0.1:{self.server.server_port}/api/v1/catalog/editions?page=0&pageSize=1'

    def write_input(self,name,value):
        path = self.inputs/name
        path.write_text(json.dumps(value))
        return path

    def save_state(self):
        self.state.write_text(json.dumps(self.state_value))

    def build_manifest(self):
        return self.release_module.prepare_manifest(self.manifest_input,self.migration_input,self.compatibility_input,self.paths,configs=[],require_root=False,archive_path=self.archive_input,preflight_input=self.preflight_input)

    def snapshot(self):
        result = {}
        for path in self.root.rglob('*'):
            result[str(path.relative_to(self.root))] = (path.lstat().st_mode,path.lstat().st_uid,path.lstat().st_gid,path.lstat().st_mtime_ns,path.lstat().st_ctime_ns,os.readlink(path) if path.is_symlink() else path.read_bytes() if path.is_file() else None)
        return result

    def test_environment_export_and_duplicate_required_keys_fail_closed(self):
        env = self.paths.at('/etc/pliego/pliego.env')
        for contents in ['export PLIEGO_R2_ENABLED=true\nPLIEGO_MAIL_ENABLED=true\n','PLIEGO_R2_ENABLED=true\nexport PLIEGO_MAIL_ENABLED=true\n','PLIEGO_R2_ENABLED=false\nPLIEGO_R2_ENABLED=true\nPLIEGO_MAIL_ENABLED=true\n','OTHER="line1\nPLIEGO_R2_ENABLED=true\nPLIEGO_MAIL_ENABLED=true\n"\n','OTHER=value\\\nPLIEGO_R2_ENABLED=true\nPLIEGO_MAIL_ENABLED=true\n']:
            env.write_text(contents)
            with self.subTest(contents=contents),self.assertRaises(importlib.import_module('release_common').ReleaseError):
                self.common.validate_config(env)

    def test_manifest_private_and_refuses_overwrite_or_unsupported_compatibility(self):
        report = self.build_manifest()
        manifest = self.paths.deployment()/'release.json'
        self.assertEqual(stat.S_IMODE(manifest.stat().st_mode),0o600)
        self.assertEqual(stat.S_IMODE(manifest.parent.stat().st_mode),0o700)
        stored = json.loads(manifest.read_text())
        self.assertEqual(stored['sourceSha'],SOURCE_SHA)
        self.assertEqual(stored['scope'],'coordinated-backend-frontend')
        self.assertEqual(stored['previousBackend'],self.paths.production_name(self.previous_backend))
        self.assertNotEqual(stored['previousFrontend'],stored['rollbackFrontend'])
        self.assertNotIn('DO-NOT-PRINT',manifest.read_text())
        with self.assertRaises((importlib.import_module('release_common').ReleaseError,FileExistsError)): self.build_manifest()
        manifest.unlink()
        self.compatibility['supportedSchemaVersions'] = [PREVIOUS_MAX]
        self.compatibility_input.write_text(json.dumps(self.compatibility))
        with self.assertRaises((importlib.import_module('release_common').ReleaseError,FileExistsError)): self.build_manifest()
        self.assertFalse(manifest.exists())

    def test_preflight_rejects_unpinned_identities_types_and_unsafe_paths(self):
        for field,value in [
            ('ciRunId',True),('sourceSha','unreviewed'),
            ('previousSourceSha','short'),('releaseId','../candidate'),
            ('previousReleaseId','../previous'),
            ('previousReleaseId',RELEASE),('previousMaxFlyway',True),
            ('candidateMaxFlyway',PREVIOUS_MAX-1),
            ('expectedCatalogTotalCount',True),('expectedCatalogTotalCount',-1),
        ]:
            pins = dict(self.preflight)
            pins[field] = value
            self.preflight_input.write_text(json.dumps(pins))
            with self.subTest(field=field,value=value),self.assertRaises(self.common.ReleaseError):
                self.build_manifest()
            self.assertFalse((self.paths.deployment()/'release.json').exists())
        self.assertFalse(self.calls.exists())

    def test_no_pending_migrations_uses_single_accepted_version(self):
        jar(self.candidate_backend/self.common.JAR_NAME,PREVIOUS_MAX)
        self.preflight['candidateMaxFlyway'] = PREVIOUS_MAX
        self.artifacts['backendSha256'] = sha((self.candidate_backend/self.common.JAR_NAME).read_bytes())
        self.compatibility['candidateJarSha256'] = self.artifacts['backendSha256']
        self.compatibility['supportedSchemaVersions'] = [PREVIOUS_MAX]
        self.migrations = self.compare.compare(
            self.previous_backend/self.common.JAR_NAME,
            self.candidate_backend/self.common.JAR_NAME,PREVIOUS_MAX,PREVIOUS_MAX)
        for path,value in [(self.preflight_input,self.preflight),
                           (self.manifest_input,self.artifacts),
                           (self.compatibility_input,self.compatibility),
                           (self.migration_input,self.migrations)]:
            path.write_text(json.dumps(value))
        self.build_manifest()
        manifest = self.common.load_json(self.paths.deployment()/'release.json')
        self.assertEqual(manifest['plannedRollback']['acceptedFlywayVersions'],[PREVIOUS_MAX])
        report = self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
        self.assertEqual(report['flywayVersion'],PREVIOUS_MAX)
        self.assertEqual(report['catalog']['totalCount'],CATALOG_COUNT)

    def test_dry_run_refuses_each_elevated_runtime_role_flag_and_disabled_login(self):
        self.build_manifest()
        for index in range(6):
            flags = ['t','f','f','f','f','f']
            flags[index] = 'f' if index == 0 else 't'
            self.state_value['role'] = '|'.join(flags)
            self.save_state()
            before = self.snapshot()
            with self.subTest(flag=index),self.assertRaises(self.common.ReleaseError):
                self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
            self.assertEqual(self.snapshot(),before)
        self.assertNotIn('systemctl',self.calls.read_text())

    def test_dry_run_has_no_writes_service_calls_or_pointer_changes(self):
        self.build_manifest()
        before = self.snapshot()
        report = self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
        self.assertEqual(report['flywayVersion'],PREVIOUS_MAX)
        self.assertEqual(self.snapshot(),before)
        self.assertNotIn('systemctl',self.calls.read_text())
        self.assertIn('nginx',self.calls.read_text())
        self.assertNotIn('DO-NOT-PRINT',json.dumps(report))
        self.assertEqual(report['catalog']['totalCount'],CATALOG_COUNT)
        self.assertEqual(self.http_calls,['/api/v1/catalog/editions?page=0&pageSize=1'])
        self.assertFalse(self.paths.at('/run/lock/pliego-deploy.lock').exists())

    def test_dry_run_rejects_partial_failed_changed_history_privileges_owned_r2_and_nginx(self):
        self.build_manifest()
        original = json.loads(json.dumps(self.state_value))
        changes = [('partial',lambda: self.state_value['history'].append([PREVIOUS_MAX+1,PREVIOUS_MAX+1,12,'t','SQL',f'V{PREVIOUS_MAX+1:03d}__fixture.sql'])),('failed',lambda: self.state_value['history'][-1].__setitem__(3,'f')),('checksum',lambda: self.state_value['history'][-1].__setitem__(2,123)),('privilege',lambda:self.state_value.__setitem__('privileges','f|f|f|t')),('owner',lambda:self.state_value.__setitem__('owned','1')),('nginx',lambda:self.state_value.__setitem__('nginx',False))]
        for name,change in changes:
            self.state_value = json.loads(json.dumps(original))
            change()
            self.save_state()
            before = self.snapshot()
            with self.subTest(name=name),self.assertRaises(importlib.import_module('release_common').ReleaseError):
                self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
            self.assertEqual(self.snapshot(),before)
        env = self.paths.at('/etc/pliego/pliego.env')
        env.write_text('PLIEGO_R2_ENABLED=false\nPLIEGO_MAIL_ENABLED=true\n')
        with self.assertRaises(importlib.import_module('release_common').ReleaseError): self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
        self.assertNotIn('systemctl',self.calls.read_text())

    def test_real_rollback_accepts_failed_pid_zero_resets_and_atomically_switches_both(self):
        self.build_manifest()
        backend_link = self.paths.at('/opt/pliego/current')
        frontend_link = self.paths.at('/var/www/pliego/current')
        backend_link.unlink(); backend_link.symlink_to(self.candidate_backend)
        frontend_link.unlink(); frontend_link.symlink_to(self.candidate_frontend)
        self.state_value['history'] += [[v,v,self.migrations['pending'][v-PREVIOUS_MAX-1]['flywayChecksum'],'t','SQL',f'V{v:03d}__fixture.sql'] for v in range(PREVIOUS_MAX+1,CANDIDATE_MAX+1)]
        self.save_state()
        with patch.object(self.rollback_module,'poll',return_value={'catalog':'healthy','totalCount':CATALOG_COUNT}):
            report = self.rollback_module.rollback(self.paths,dry_run=False,require_root=False,url=self.url)
        self.assertEqual(backend_link.resolve(),self.previous_backend)
        self.assertEqual(frontend_link.resolve(),self.rollback_frontend)
        calls = self.calls.read_text()
        self.assertLess(calls.index('systemctl ["stop"'),calls.index('systemctl ["reset-failed"'))
        self.assertLess(calls.index('systemctl ["reset-failed"'),calls.index('systemctl ["start"'))
        self.assertFalse(any('.tmp-' in path.name for path in self.root.rglob('*')))
        self.assertEqual(report['flywayVersion'],CANDIDATE_MAX)

    def test_missing_or_html_brand_images_refuse_manifest_and_rollback_preflight(self):
        self.build_manifest()
        manifest_path = self.paths.deployment()/'release.json'
        good_manifest = manifest_path.read_bytes()
        for tree in [self.previous_frontend,self.candidate_frontend,self.rollback_frontend]:
            for name in BRAND_FILES:
                for bad in [None,b'<html>SPA fallback</html>']:
                    if bad is None: (tree/name).unlink()
                    else: (tree/name).write_bytes(bad)
                    with self.subTest(tree=tree.name,name=name,bad=bad):
                        manifest_path.unlink()
                        with self.assertRaisesRegex(self.common.ReleaseError,'required email brand image'): self.build_manifest()
                        manifest_path.write_bytes(good_manifest)
                        manifest_path.chmod(0o600)
                        with self.assertRaisesRegex(self.common.ReleaseError,'required email brand image'):
                            self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
                    (tree/name).write_bytes(PNG)
        self.assertFalse(self.calls.exists())

    def test_untrusted_or_competing_lock_refuses_before_service_calls(self):
        self.build_manifest()
        lock = self.paths.at('/run/lock/pliego-deploy.lock')
        lock.write_text('')
        lock.chmod(0o666)
        with self.assertRaises(importlib.import_module('release_common').ReleaseError):
            with self.rollback_module.deploy_lock(self.paths,require_root=False):
                self.fail('unsafe lock accepted')
        lock.chmod(0o600)
        with lock.open('w') as held:
            fcntl.flock(held.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(importlib.import_module('release_common').ReleaseError):
                self.rollback_module.rollback(self.paths,dry_run=False,require_root=False,url=self.url)
        self.assertFalse(self.calls.exists())

    def test_inherited_operator_lock_is_reused_without_deadlock(self):
        self.build_manifest()
        lock = self.paths.at('/run/lock/pliego-deploy.lock')
        with lock.open('w') as held:
            lock.chmod(0o600)
            fcntl.flock(held.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            with patch.object(self.rollback_module,'poll',return_value={'catalog':'healthy','totalCount':CATALOG_COUNT}):
                report = self.rollback_module.rollback(self.paths,dry_run=False,require_root=False,lock_fd=held.fileno(),url=self.url)
        self.assertEqual(report['flywayVersion'],PREVIOUS_MAX)
        self.assertEqual(self.paths.at('/var/www/pliego/current').resolve(),self.rollback_frontend)

    def test_lock_descriptor_is_inherited_by_child_without_releasing_operator_lock(self):
        lock = self.paths.at('/run/lock/pliego-deploy.lock')
        child = (
            "import sys; sys.path.insert(0,sys.argv[1]); "
            "from release_common import Paths; from rollback import deploy_lock; "
            "scope=deploy_lock(Paths(sys.argv[2],root=__import__('pathlib').Path(sys.argv[3])),int(sys.argv[4]),False); "
            "scope.__enter__(); print('inherited-lock-held'); scope.__exit__(None,None,None)"
        )
        with lock.open('w') as held:
            lock.chmod(0o600)
            fcntl.flock(held.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            result = subprocess.run(
                [sys.executable,'-c',child,str(SCRIPTS),RELEASE,str(self.root),str(held.fileno())],
                capture_output=True,text=True,pass_fds=(held.fileno(),),timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout.strip(),'inherited-lock-held')
            with lock.open('r') as competing:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(competing.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.assertFalse(self.calls.exists())

    def test_manifest_tampered_paths_hashes_or_drift_are_refused_before_service_calls(self):
        self.build_manifest()
        manifest_path = self.paths.deployment()/'release.json'
        original = json.loads(manifest_path.read_text())
        for field,value in [('previousBackend','/etc'),('previousFrontend','/var/www/pliego/releases/../etc'),('rollbackFrontend',str(self.previous_frontend)),('previousBackendSha256','0'*64)]:
            changed = dict(original); changed[field] = value
            manifest_path.write_text(json.dumps(changed))
            with self.subTest(field=field),self.assertRaises(importlib.import_module('release_common').ReleaseError):
                self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
        manifest_path.write_text(json.dumps(original))
        self.paths.at('/opt/pliego/current').unlink()
        other = self.paths.at('/opt/pliego/releases/unknown'); other.mkdir()
        self.paths.at('/opt/pliego/current').symlink_to(other)
        with self.assertRaises(importlib.import_module('release_common').ReleaseError): self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
        self.assertFalse(self.calls.exists())


    def test_helper_correction_preserves_original_and_only_updates_reviewed_hash(self):
        self.build_manifest()
        manifest = self.paths.deployment()/'release.json'
        original_bytes = manifest.read_bytes()
        original = json.loads(original_bytes)
        helper = 'poll_catalog.py'
        previous = original['scriptsSha256'][helper]
        replacement = sha(b'reviewed corrected helper')
        real_sha256 = self.common.sha256
        def changed_helper(path):
            if Path(path) == SCRIPTS/helper:
                return replacement
            return real_sha256(path)
        with patch.object(self.common,'sha256',side_effect=changed_helper):
            self.release_module.correct_helper(
                self.paths,helper,previous,replacement,'catalog-count',
                'accept ASCII decimal strings from the catalog API',require_root=False)
            corrected = json.loads(manifest.read_text())
            expected = json.loads(original_bytes)
            expected['scriptsSha256'][helper] = replacement
            corrections = corrected.pop('corrections')
            self.assertEqual(corrections[:-1],expected.pop('corrections',[]))
            correction = corrections[-1]
            self.assertEqual(corrected,expected)
            self.assertEqual(correction['helper'],helper)
            self.assertEqual(correction['previousSha256'],previous)
            self.assertEqual(correction['sha256'],replacement)
            self.assertEqual(correction['reason'],'catalog-count')
            self.assertEqual(correction['explanation'],'accept ASCII decimal strings from the catalog API')
            self.assertRegex(correction['at'],r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
            self.assertEqual((manifest.parent/'release.json.superseded-catalog-count').read_bytes(),original_bytes)
            self.assertEqual(stat.S_IMODE(manifest.stat().st_mode),0o600)
            self.assertEqual(stat.S_IMODE((manifest.parent/'release.json.superseded-catalog-count').stat().st_mode),0o600)
            report = self.rollback_module.rollback(self.paths,dry_run=True,require_root=False,url=self.url)
            self.assertFalse(report['writesPerformed'])
            with self.assertRaises((self.common.ReleaseError,FileExistsError)):
                self.release_module.correct_helper(
                    self.paths,helper,previous,replacement,'catalog-count',
                    'duplicate correction is refused',require_root=False)
        self.assertNotIn('systemctl',self.calls.read_text())
        self.assertFalse(any('.tmp-' in path.name for path in manifest.parent.iterdir()))

    def test_helper_correction_refuses_unreviewed_hash_path_or_reason_without_manifest_change(self):
        self.build_manifest()
        manifest = self.paths.deployment()/'release.json'
        original_bytes = manifest.read_bytes()
        original = json.loads(original_bytes)
        helper = 'poll_catalog.py'
        previous = original['scriptsSha256'][helper]
        changed = sha(b'not the installed helper')
        cases = [
            (helper,previous,changed,'unreviewed','installed hash must match'),
            (helper,'0'*64,previous,'wrong-old','old hash must match'),
            ('../poll_catalog.py',previous,changed,'path','only known helper names'),
            (helper,previous,changed,'../escape','reason is a safe filename'),
            (helper,previous,changed,'empty',''),
        ]
        for name,old,new,reason,explanation in cases:
            with self.subTest(reason=reason),self.assertRaises(self.common.ReleaseError):
                self.release_module.correct_helper(
                    self.paths,name,old,new,reason,explanation,require_root=False)
            self.assertEqual(manifest.read_bytes(),original_bytes)
            self.assertFalse(any(path.name.startswith('release.json.superseded-') for path in manifest.parent.iterdir()))
        self.assertFalse(self.calls.exists())

    def test_helper_correction_keeps_inherited_lock_held_and_refuses_existing_backup(self):
        self.build_manifest()
        manifest = self.paths.deployment()/'release.json'
        helper = 'poll_catalog.py'
        previous = json.loads(manifest.read_text())['scriptsSha256'][helper]
        replacement = sha(b'reviewed fix')
        real_sha256 = self.common.sha256
        def changed_helper(path):
            return replacement if Path(path) == SCRIPTS/helper else real_sha256(path)
        lock = self.paths.at('/run/lock/pliego-deploy.lock')
        with lock.open('w') as held:
            lock.chmod(0o600)
            fcntl.flock(held.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            backup = manifest.parent/'release.json.superseded-review'
            backup.write_bytes(b'older evidence')
            with patch.object(self.common,'sha256',side_effect=changed_helper),self.assertRaises((self.common.ReleaseError,FileExistsError)):
                self.release_module.correct_helper(
                    self.paths,helper,previous,replacement,'review','reviewed fix',
                    lock_fd=held.fileno(),require_root=False)
            self.assertEqual(backup.read_bytes(),b'older evidence')
            with lock.open('r') as competing:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(competing.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)


class ReusabilityTests(unittest.TestCase):
    def test_helpers_have_no_release_specific_constants(self):
        required = {'release_common.py','compare_migrations.py','prepare_frontend.py',
                    'poll_catalog.py','release_json.py','rollback.py','service_state.py'}
        self.assertTrue(required.issubset({path.name for path in SCRIPTS.glob('*.py')}))
        forbidden = (
            '20261103T204931Z-ec48e07','20261102T220936Z-64e3c60',
            'ec48e071854916cdf1051016e0c49fac9145e216',
            '64e3c60cb28acfd57960dc675ad83961e190a206',
            '2f5a3b3129b05d60a6153ee11f0b742d5de46c0cdcadc5b358929950931f674f',
            'b52f3dec531584e913a9c1d0d1ddc1511f9bbf4c7567ffa6f628f753b7aa841b',
            '5cc182c46c359c74db2ca7558144918551865a6db0efdec8b2f5fd7ed08495cc',
            '17182e41dc84288ca4904bd47762bef86c693e779bf22fefd0c807b31a1f663e',
            '85495a592b1580d7778b51a47ca270cb836ae8d5b9c1c4de44ee15effdc10799',
        )
        for path in SCRIPTS.glob('*.py'):
            if path.name.startswith('test_'):
                continue
            source = path.read_text()
            with self.subTest(helper=path.name):
                for literal in forbidden:
                    self.assertNotIn(literal,source)
                constants = [node.value for node in ast.walk(ast.parse(source)) if isinstance(node,ast.Constant)]
                self.assertFalse(any(type(value) is int and value in {425,100,105,41709777442} for value in constants),constants)


if __name__ == '__main__':
    unittest.main(verbosity=2)
