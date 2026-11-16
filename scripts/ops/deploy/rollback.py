#!/usr/bin/env python3
"""Pinned application rollback with independent backend/frontend recovery targets.

--dry-run makes no writes or service calls.

Never changes database privileges, data, environment, Nginx or Flyway history.
Elevated runtime and partial migration prefixes require reviewed operator recovery.
"""
import argparse
import contextlib
import fcntl
import os
from pathlib import Path
import stat
import sys
sys.dont_write_bytecode = True
import uuid
import release_common as C
from compare_migrations import compare
from poll_catalog import poll, URL
from service_state import command, stop_and_drain, start

HISTORY_SQL = "SELECT installed_rank,version,checksum,success,type,script FROM public.flyway_schema_history /* PLIEGO_HELPER_HISTORY */ ORDER BY installed_rank"
PRIVILEGE_SQL = "SELECT has_schema_privilege('pliego_app','pliego','CREATE'),has_schema_privilege('pliego_app','public','CREATE'),has_database_privilege('pliego_app','pliego','CREATE'),pg_has_role('pliego_app','pliego_owner','MEMBER') /* PLIEGO_HELPER_PRIVILEGES */"
OWNED_SQL = "SELECT count(*) FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=(SELECT oid FROM pg_roles WHERE rolname='pliego_app') AND deptype='o' AND dbid IN (0,(SELECT oid FROM pg_database WHERE datname=current_database())) /* PLIEGO_HELPER_OWNED */"

ROLE_SQL = "SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='pliego_app' /* PLIEGO_HELPER_ROLE */"


def query(sql):
    return command(['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','--no-psqlrc','-A','-t','-v','ON_ERROR_STOP=1','-d','pliego','-c',sql])


def database_state(migrations):
    C.require(query(ROLE_SQL) == 't|f|f|f|f|f', 'runtime role has unexpected or elevated attributes; administrative cleanup required before rollback')
    C.require(query(PRIVILEGE_SQL) == 'f|f|f|f','runtime has owner membership or CREATE; administrative cleanup required before rollback')
    C.require(query(OWNED_SQL) == '0','runtime owns database objects; administrative cleanup required before rollback')
    raw = query(HISTORY_SQL)
    rows = [line.split('|') for line in raw.splitlines()]
    C.require(len(rows) in {migrations['historicalCount'],migrations['candidateCount']},'Flyway history is partial or unexpected; backend recovery requires review')
    expected = migrations['applied']+migrations['pending']
    for index,row in enumerate(rows):
        C.require(len(row) == 6,'malformed Flyway history')
        reference = expected[index]
        try:
            rank,version,checksum = map(int,row[:3])
        except ValueError:
            raise C.ReleaseError('Flyway history contains a non-versioned or malformed migration') from None
        C.require(rank == index+1 and version == index+1 and checksum == reference['flywayChecksum'] and row[3] == 't' and row[4] == 'SQL' and row[5] == reference['name'],'Flyway history differs from the recorded successful migration sequence')
    return len(rows)


def preflight(paths,require_root=True,helper_override=None):
    C.require(not require_root or os.geteuid() == 0,'root is required to validate private production release metadata')
    manifest_path = paths.deployment()/'release.json'
    manifest = C.load_json(manifest_path)
    C.require(stat.S_IMODE(manifest_path.stat().st_mode) == 0o600 and stat.S_IMODE(manifest_path.parent.stat().st_mode) == 0o700,'release metadata must remain private')
    if require_root:
        C.require(manifest_path.stat().st_uid == 0 and manifest_path.parent.stat().st_uid == 0,'release metadata must be root-owned')
    pins, paths = C.manifest_identity(manifest, paths)
    C.validate_compatibility(manifest.get('compatibility'),pins,manifest.get('candidateBackendSha256'))
    C.require_sha(manifest.get('compatibilityEvidenceSha256'))
    backend = paths.backend(pins['releaseId'])
    previous_backend = paths.backend(paths.previous_backend)
    frontend = paths.frontend(pins['releaseId'])
    previous_frontend = paths.frontend(paths.previous_frontend)
    rollback_frontend = paths.frontend(paths.rollback_release())
    backend_current = C.resolve_current(paths,'backend',[backend,previous_backend])
    frontend_current = C.resolve_current(paths,'frontend',[frontend,previous_frontend,rollback_frontend])
    C.require(C.sha256(previous_backend/C.JAR_NAME) == pins['previousBackendSha256'],'previous backend JAR changed')
    C.require(C.sha256(backend/C.JAR_NAME) == C.require_sha(manifest.get('candidateBackendSha256')),'candidate backend JAR changed')
    C.require_sha(manifest.get('frontendArchiveSha256'))
    C.require(C.sha256(previous_frontend/'index.html') == pins['previousIndexSha256'] and C.sha256(rollback_frontend/'index.html') == pins['previousIndexSha256'],'previous/rollback frontend index changed')
    for tree in [frontend,previous_frontend,rollback_frontend]:
        C.validate_brand_pngs(tree)
    for path,key in [(frontend,'candidateFrontendFiles'),(previous_frontend,'previousFrontendFiles'),(rollback_frontend,'rollbackFrontendFiles')]:
        C.require(isinstance(manifest.get(key),dict) and C.tree_hashes(path,public=True) == manifest[key],'frontend tree no longer matches recorded hashes')
    scripts = manifest.get('scriptsSha256')
    expected_names = C.HELPER_NAMES
    C.require(isinstance(scripts,dict) and set(scripts) == set(expected_names),'helper hash manifest missing or malformed')
    for name,digest in scripts.items():
        expected_digest = C.require_sha(digest)
        if helper_override is not None and name == helper_override[0]:
            C.require(expected_digest == C.require_sha(helper_override[1]), 'recorded old helper hash differs')
            expected_digest = C.require_sha(helper_override[2])
        C.require(C.sha256(Path(__file__).absolute().with_name(name)) == expected_digest,'reviewed release helper changed')
    configuration = manifest.get('configurationSha256')
    C.require(isinstance(configuration,dict) and '/etc/pliego/pliego.env' in configuration,'recorded configuration hashes missing')
    prefixes = ('/etc/pliego/','/etc/systemd/system/','/etc/nginx/sites-available/','/etc/nginx/conf.d/')
    for name,digest in configuration.items():
        C.require(isinstance(name,str) and name.startswith(prefixes),'unapproved configuration path in manifest')
        C.require(C.sha256(paths.at(name)) == C.require_sha(digest),'configuration drift requires operator review')
    C.validate_config(paths.at('/etc/pliego/pliego.env'))
    actual = compare(previous_backend/C.JAR_NAME,backend/C.JAR_NAME,pins['previousMaxFlyway'],pins['candidateMaxFlyway'])
    recorded = manifest.get('migrations')
    C.require(isinstance(recorded,dict) and recorded == actual,'recorded migrations do not match the installed recovery/candidate JARs')
    plan = manifest.get('plannedRollback')
    C.require(isinstance(plan,dict) and plan.get('acceptedFlywayVersions') == C.accepted_versions(pins) and plan.get('runtimePrivileges') == 'f|f|f|f' and type(plan.get('appOwnedObjects')) is int and plan['appOwnedObjects'] == 0 and plan.get('r2MustRemainEnabled') is True and plan.get('mailMustRemainEnabled') is True and plan.get('databaseWrites') is False and plan.get('nginxChanges') is False and plan.get('backupRestore') is False and type(plan.get('catalogTotalCount')) is int and plan['catalogTotalCount'] == pins['expectedCatalogTotalCount'],'planned rollback safety contract differs')
    if require_root:
        for path in [previous_backend,backend]:
            C.validate_tree_modes(path,backend=True)
        for path in [previous_frontend,frontend,rollback_frontend]:
            C.validate_tree_modes(path)
    version = database_state(actual)
    command(['nginx','-t'])
    return {'releaseId':pins['releaseId'],'flywayVersion':version,'backendCurrent':paths.production_name(backend_current),'frontendCurrent':paths.production_name(frontend_current),'rollbackBackend':manifest['previousBackend'],'rollbackFrontend':manifest['rollbackFrontend'],'rollbackComponents':C.rollback_components(manifest),'runtimePrivileges':'f|f|f|f','appOwnedObjects':0,'r2Enabled':True,'mailEnabled':True,'compatibility':manifest['compatibility'],'manifestSha256':C.sha256(manifest_path),'expectedCatalogTotalCount':pins['expectedCatalogTotalCount']}


@contextlib.contextmanager
def deploy_lock(paths,lock_fd=None,require_root=True):
    lock = paths.at('/run/lock/pliego-deploy.lock')
    C.directory(lock.parent)
    C.reject_symlink_components(lock)
    owned = lock_fd is None
    fd = os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600) if owned else lock_fd
    try:
        info = os.fstat(fd)
        actual = lock.stat()
        C.require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not (stat.S_IMODE(info.st_mode) & 0o022) and (not require_root or info.st_uid == 0) and (info.st_dev,info.st_ino) == (actual.st_dev,actual.st_ino),'deployment lock is untrusted or its descriptor/path identity differs')
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            raise C.ReleaseError('another deployment holds the exclusive lock') from None
        after = lock.stat()
        C.require((info.st_dev,info.st_ino) == (after.st_dev,after.st_ino),'deployment lock pathname changed during acquisition')
        yield
    finally:
        if owned:
            os.close(fd)


def atomic_link(paths,kind,target):
    link = paths.at('/opt/pliego/current' if kind == 'backend' else '/var/www/pliego/current')
    parent = paths.at('/opt/pliego/releases' if kind == 'backend' else '/var/www/pliego/releases')
    C.require(link.is_symlink(),'current pointer must remain a symlink')
    target = C.directory(target).resolve(strict=True)
    C.require(target.parent == C.directory(parent).resolve(strict=True),'pointer target must be an immediate release directory')
    temporary = link.with_name(link.name+'.tmp-'+uuid.uuid4().hex)
    temporary.symlink_to(target)
    try:
        os.replace(temporary,link)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def rollback(paths,dry_run=False,require_root=True,lock_fd=None,url=URL,component=None):
    if dry_run:
        report = preflight(paths,require_root)
        manifest = C.load_json(paths.deployment()/'release.json')
        C.require(C.sha256(paths.deployment()/'release.json') == report['manifestSha256'], 'manifest changed during dry-run')
        report['rollbackComponents'] = C.rollback_components(manifest,component)
        catalog = poll(url=url,expected=report['expectedCatalogTotalCount'])
        return dict(report,dryRun=True,writesPerformed=False,catalog=catalog)
    C.require(not require_root or os.geteuid() == 0,'root is required for application rollback')
    with deploy_lock(paths,lock_fd,require_root):
        initial = preflight(paths,require_root)
        manifest = C.load_json(paths.deployment()/'release.json')
        C.require(C.sha256(paths.deployment()/'release.json') == initial['manifestSha256'], 'manifest changed before rollback')
        components = C.rollback_components(manifest,component)
        if 'backend' in components:
            stop_and_drain(runner=command)
        current = preflight(paths,require_root)
        drift_message = ('release state changed while draining; backend remains stopped' if 'backend' in components
                         else 'release state changed before frontend recovery; backend was not stopped')
        C.require(current['manifestSha256'] == initial['manifestSha256'] and current['flywayVersion'] == initial['flywayVersion'] and current['backendCurrent'] == initial['backendCurrent'] and current['frontendCurrent'] == initial['frontendCurrent'],drift_message)
        pins = C.validate_preflight(manifest['preflight'],paths.release)
        paths = paths.with_preflight(pins)
        if 'backend' in components:
            atomic_link(paths,'backend',paths.backend(paths.previous_backend))
        if 'frontend' in components:
            atomic_link(paths,'frontend',paths.frontend(paths.rollback_release()))
        if 'backend' in components:
            start(runner=command)
        catalog = poll(url=url,expected=pins['expectedCatalogTotalCount'])
        # A fresh runtime must still have no migration privileges or ownership.
        after_version = database_state(manifest['migrations'])
        C.require(after_version == initial['flywayVersion'],'Flyway history changed during rollback startup')
        C.validate_config(paths.at('/etc/pliego/pliego.env'))
        backend_expected = paths.backend(paths.previous_backend) if 'backend' in components else paths.at(initial['backendCurrent'])
        frontend_expected = paths.frontend(paths.rollback_release()) if 'frontend' in components else paths.at(initial['frontendCurrent'])
        C.resolve_current(paths,'backend',[backend_expected])
        C.resolve_current(paths,'frontend',[frontend_expected])
        return dict(current,dryRun=False,writesPerformed=True,rollbackComponents=components,backendCurrent=paths.production_name(backend_expected),frontendCurrent=paths.production_name(frontend_expected),catalog=catalog)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',required=True,type=C.validate_release_name)
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--component',choices=('all','backend','frontend'),help='subset of the recorded plan; default: execute that plan')
    parser.add_argument('--lock-fd',type=int,help='inherited already-held /run/lock/pliego-deploy.lock FD')
    args = parser.parse_args()
    C.require(args.lock_fd is None or args.lock_fd >= 3,'invalid deployment lock descriptor')
    C.emit(rollback(C.Paths(args.release),dry_run=args.dry_run,lock_fd=args.lock_fd,component=args.component))


if __name__ == '__main__':
    C.cli(main)
