#!/usr/bin/env python3
"""Create immutable private release.json after validating installed/recovery artifacts."""
import argparse
import datetime
import re
import uuid
import json
import os
from pathlib import Path
import sys
sys.dont_write_bytecode = True
import release_common as C
from compare_migrations import compare


def prepare_manifest(candidate_input,migration_input,compatibility_input,paths=None,configs=(),require_root=True,archive_path=None,preflight_input=None):
    C.require(preflight_input is not None, 'captured preflight is required')
    pins = C.validate_preflight(C.load_json(preflight_input), paths.release if paths else None)
    paths = (paths or C.Paths(pins['releaseId'])).with_previous(pins['previousReleaseId'])
    C.require(not require_root or os.geteuid() == 0,'root is required for a private production release manifest')
    candidate = C.load_json(candidate_input)
    planned = C.load_json(migration_input)
    compatibility = C.validate_compatibility(C.load_json(compatibility_input),pins,candidate.get('backendSha256'))
    C.require(candidate.get('sourceSha') == pins['sourceSha'] and type(candidate.get('ciRunId')) is int and candidate['ciRunId'] == pins['ciRunId'],'candidate source/CI identity differs from pinned release')
    backend = paths.backend(pins['releaseId'])
    frontend = paths.frontend(pins['releaseId'])
    previous_backend = paths.backend(pins['previousReleaseId'])
    previous_frontend = paths.frontend(pins['previousReleaseId'])
    rollback_frontend = paths.frontend(paths.rollback_release())
    C.require(C.resolve_current(paths,'backend',[previous_backend]) == previous_backend,'previous backend pointer changed')
    C.require(C.resolve_current(paths,'frontend',[previous_frontend]) == previous_frontend,'previous frontend pointer changed')
    jar = backend/C.JAR_NAME
    old_jar = previous_backend/C.JAR_NAME
    C.require(C.sha256(old_jar) == pins['previousBackendSha256'],'installed previous backend hash changed')
    C.require(C.sha256(previous_frontend/'index.html') == pins['previousIndexSha256'],'installed previous frontend index hash changed')
    C.require(C.sha256(jar) == C.require_sha(candidate.get('backendSha256')),'candidate backend hash mismatch')
    C.require_sha(candidate.get('frontendArchiveSha256'))
    C.require(archive_path is not None,'frontend archive path is required')
    C.require(C.sha256(archive_path) == candidate['frontendArchiveSha256'],'frontend archive hash mismatch')
    actual_migrations = compare(old_jar,jar,pins['previousMaxFlyway'],pins['candidateMaxFlyway'])
    C.require(planned == actual_migrations,'migration evidence differs from installed JAR entries')
    C.require(planned.get('candidateJarSha256') == candidate['backendSha256'],'migration evidence names another candidate JAR')
    for tree in [frontend,previous_frontend,rollback_frontend]:
        C.validate_brand_pngs(tree)
    files = C.tree_hashes(frontend,public=True)
    previous_files = C.tree_hashes(previous_frontend,public=True)
    rollback_files = C.tree_hashes(rollback_frontend,public=True)
    source_files = candidate.get('frontendFiles')
    C.require(isinstance(source_files,dict) and 'index.html' in source_files,'candidate manifest lacks frontend file hashes')
    for name,digest in source_files.items():
        C.public_name(name)
        C.require(files.get(name) == C.require_sha(digest),'installed candidate frontend file hash mismatch')
    expected_candidate = dict(source_files)
    for name,digest in previous_files.items():
        if C.HASHED_ASSET.fullmatch(name):
            C.require(name not in source_files or source_files[name] == digest,'same hashed asset name has different bytes')
            expected_candidate.setdefault(name,digest)
    C.require(files == dict(sorted(expected_candidate.items())),'candidate frontend contains unexpected or missing files')
    expected_rollback = dict(previous_files)
    for name,digest in source_files.items():
        if C.HASHED_ASSET.fullmatch(name):
            expected_rollback.setdefault(name,digest)
    C.require(rollback_files == dict(sorted(expected_rollback.items())),'rollback frontend is not the exact previous build plus missing candidate hashed assets')
    C.require(rollback_files.get('index.html') == pins['previousIndexSha256'],'rollback index must equal previous index bytes')
    env = paths.at('/etc/pliego/pliego.env')
    config_state = C.validate_config(env)
    config_hashes = {}
    allowed_prefixes = ('/etc/pliego/','/etc/systemd/system/','/etc/nginx/sites-available/','/etc/nginx/conf.d/')
    for value in [env,*configs]:
        value = Path(value)
        name = paths.production_name(value)
        C.require(name.startswith(allowed_prefixes),'configuration path outside approved directories')
        config_hashes[name] = C.sha256(value)
    if require_root:
        for target in [previous_backend,backend]:
            C.validate_tree_modes(target,backend=True)
        for target in [previous_frontend,frontend,rollback_frontend]:
            C.validate_tree_modes(target)
    scripts = C.helper_hashes()
    manifest = {'manifestVersion':2,'preflight':pins,'preflightSha256':C.sha256(preflight_input),'releaseId':pins['releaseId'],'sourceSha':pins['sourceSha'],'ciRunId':pins['ciRunId'],'ciUrl':'https://github.com/andres18113/pliego-muejeje/actions/runs/' + str(pins['ciRunId']),'scope':'coordinated-backend-frontend','candidateBackend':paths.production_name(backend),'candidateFrontend':paths.production_name(frontend),'candidateBackendSha256':candidate['backendSha256'],'frontendArchiveSha256':candidate['frontendArchiveSha256'],'candidateFrontendFiles':files,'previousSourceSha':pins['previousSourceSha'],'previousBackend':paths.production_name(previous_backend),'previousFrontend':paths.production_name(previous_frontend),'rollbackFrontend':paths.production_name(rollback_frontend),'previousBackendSha256':pins['previousBackendSha256'],'previousIndexSha256':pins['previousIndexSha256'],'previousFrontendFiles':previous_files,'rollbackFrontendFiles':rollback_files,'migrations':actual_migrations,'configurationSha256':config_hashes,'requiredConfiguration':config_state,'scriptsSha256':scripts,'compatibility':compatibility,'compatibilityEvidenceSha256':C.sha256(compatibility_input),'plannedRollback':{'backend':paths.production_name(previous_backend),'frontend':paths.production_name(rollback_frontend),'acceptedFlywayVersions':C.accepted_versions(pins),'runtimePrivileges':'f|f|f|f','appOwnedObjects':0,'r2MustRemainEnabled':True,'mailMustRemainEnabled':True,'databaseWrites':False,'nginxChanges':False,'backupRestore':False,'catalogTotalCount':pins['expectedCatalogTotalCount'],'partialMigrationPrefix':'REFUSE_AND_KEEP_STOPPED','elevatedRuntime':'REFUSE_ADMIN_CLEANUP_REQUIRED'}}
    target_dir = paths.deployment()
    C.reject_symlink_components(target_dir)
    target_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chmod(target_dir,0o700)
    if require_root:
        os.chown(target_dir,0,0)
    destination = target_dir/'release.json'
    fd = os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as output:
        json.dump(manifest,output,indent=2,sort_keys=True)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    return {'releaseId':pins['releaseId'],'manifest':paths.production_name(destination),'manifestSha256':C.sha256(destination),'scope':manifest['scope']}


def correct_helper(paths,helper,previous_sha256,new_sha256,reason,explanation,lock_fd=None,require_root=True):
    """Audited, explicit rebind of ONE reviewed helper; never accept other drift.

    Run only from the reverified root-only helper directory under the deploy lock.
    A new reason is required for each correction; existing evidence is never replaced.
    """
    from rollback import deploy_lock, preflight
    C.require(not require_root or os.geteuid() == 0, 'root is required for manifest correction')
    C.require(helper in C.HELPER_NAMES, 'unknown helper')
    C.require_sha(previous_sha256)
    C.require_sha(new_sha256)
    C.require(previous_sha256 != new_sha256, 'helper hashes must differ')
    C.require(isinstance(reason, str) and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', reason), 'invalid correction reason slug')
    C.require(isinstance(explanation, str) and 0 < len(explanation.strip()) <= 1000 and not any(ord(c) < 32 for c in explanation), 'a single-line review explanation is required')
    with deploy_lock(paths,lock_fd,require_root):
        path = paths.deployment()/'release.json'
        C.regular_file(path)
        original = path.read_bytes()
        manifest = C.load_json(path)
        C.require(manifest.get('scriptsSha256',{}).get(helper) == previous_sha256, 'previous helper hash differs from recorded manifest')
        C.require(C.helper_hashes().get(helper) == new_sha256, 'reviewed new helper hash differs from staged bytes')
        # All normal preflight gates still run, permitting exactly this explicit rebind.
        preflight(paths,require_root,helper_override=(helper,previous_sha256,new_sha256))
        C.require(path.read_bytes() == original, 'manifest changed during correction preflight')
        corrections = manifest.setdefault('corrections',[])
        C.require(isinstance(corrections,list), 'malformed correction history')
        superseded = path.with_name('release.json.superseded-'+reason)
        fd = os.open(superseded,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as output:
            output.write(original)
            output.flush()
            os.fsync(output.fileno())
        corrections.append({'at':datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                            'helper':helper,'previousSha256':previous_sha256,'sha256':new_sha256,
                            'reason':reason,'explanation':explanation})
        manifest['scriptsSha256'][helper] = new_sha256
        temporary = path.with_name('release.json.tmp-'+uuid.uuid4().hex)
        try:
            fd = os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'w',encoding='utf-8') as output:
                json.dump(manifest,output,indent=2,sort_keys=True)
                output.write('\n')
                output.flush()
                os.fsync(output.fileno())
            C.require(path.read_bytes() == original, 'manifest changed before correction replacement')
            os.replace(temporary,path)
            fd = os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            if temporary.exists():
                temporary.unlink()
        return {'releaseId':paths.release,'manifestSha256':C.sha256(path),
                'superseded':paths.production_name(superseded),'correction':corrections[-1]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',required=True,type=C.validate_release_name)
    for name in ('preflight','candidate-manifest','migrations','compatibility-evidence','frontend-archive'):
        parser.add_argument('--'+name,type=lambda value:Path(value).absolute())
    parser.add_argument('--config',action='append',default=[],type=Path)
    parser.add_argument('--correct-helper',choices=C.HELPER_NAMES)
    parser.add_argument('--previous-sha256')
    parser.add_argument('--sha256')
    parser.add_argument('--reason')
    parser.add_argument('--explanation')
    parser.add_argument('--lock-fd',type=int,help='inherited already-held deployment lock FD')
    args = parser.parse_args()
    paths = C.Paths(args.release)
    C.require(args.lock_fd is None or args.lock_fd >= 3, 'invalid deployment lock descriptor')
    if args.correct_helper:
        C.require(not any((args.preflight,args.candidate_manifest,args.migrations,args.compatibility_evidence,args.frontend_archive,args.config)), 'correction cannot change preparation inputs')
        C.emit(correct_helper(paths,args.correct_helper,args.previous_sha256,args.sha256,args.reason,args.explanation,args.lock_fd))
    else:
        C.require(not any((args.previous_sha256,args.sha256,args.reason,args.explanation,args.lock_fd)), 'correction options require --correct-helper')
        C.require(all((args.preflight,args.candidate_manifest,args.migrations,args.compatibility_evidence,args.frontend_archive)), 'all preparation inputs are required')
        C.emit(prepare_manifest(args.candidate_manifest,args.migrations,args.compatibility_evidence,paths=paths,
                               configs=args.config,archive_path=args.frontend_archive,preflight_input=args.preflight))


if __name__ == '__main__':
    C.cli(main)
