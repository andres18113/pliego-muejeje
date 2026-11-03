#!/usr/bin/env python3
"""Shared, standard-library-only release validation. Never prints secret contents."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tarfile
import zipfile
import sys

JAR_NAME = 'pliego-backend-0.1.0-SNAPSHOT.jar'
MAX_FILE = 256 * 1024 * 1024
SHA_PATTERN = re.compile(r'[0-9a-f]{64}\Z')
HASHED_ASSET = re.compile(r'(?:assets/)(?:[A-Za-z0-9_./-]+/)?[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico)\Z')


class ReleaseError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def sha256(path):
    file = regular_file(path)
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def regular_file(path):
    path = Path(path)
    require(path.is_absolute(), 'file path must be absolute')
    reject_symlink_components(path)
    require(stat.S_ISREG(path.lstat().st_mode), 'expected regular file')
    return path


def reject_symlink_components(path):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'invalid absolute path')
    for part in [path,*path.parents]:
        if part.exists() or part.is_symlink():
            require(not part.is_symlink(), 'symlink path component rejected')


def directory(path):
    path = Path(path)
    reject_symlink_components(path)
    require(path.is_dir(), 'directory does not exist')
    return path


def relative_name(name):
    require(isinstance(name,str) and bool(name) and '\\' not in name and '\x00' not in name, 'invalid relative filename')
    parts = name.split('/')
    require(not name.startswith('/') and all(part not in ('','.','..') for part in parts), 'unsafe archive/file path')
    require(all(re.fullmatch(r'[A-Za-z0-9_.@+-]+', part) for part in parts), 'unsupported filename characters')
    require(str(PurePosixPath(name)) == name, 'noncanonical relative filename')
    return name


def public_name(name):
    relative_name(name)
    parts = name.lower().split('/')
    require(not any(part.startswith('.') or part in {'src','source','sources','node_modules','.git'} for part in parts), 'private/source file rejected')
    require(not any(part in {'id_rsa','id_ed25519'} for part in parts), 'private key rejected')
    require(not name.lower().endswith(('.map','.key','.pem','.p12','.pfx','.ts','.tsx','.jsx','.java','.sql','.zip','.jar')), 'source/private file rejected')
    return name


def tree_hashes(path, public=False):
    root = directory(path)
    result = {}
    for base, dirs, files in os.walk(root, followlinks=False):
        for child in dirs:
            directory(Path(base)/child)
        for child in files:
            file = regular_file(Path(base)/child)
            name = file.relative_to(root).as_posix()
            (public_name if public else relative_name)(name)
            result[name] = sha256(file)
    return dict(sorted(result.items()))


def load_json(path):
    file = regular_file(path)
    require(file.stat().st_size <= 16*1024*1024, 'JSON input too large')
    def no_duplicates(pairs):
        result = {}
        for key,value in pairs:
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    with file.open(encoding='utf-8') as stream:
        result = json.load(stream,object_pairs_hook=no_duplicates)
    require(isinstance(result,dict), 'JSON object required')
    return result


def require_sha(value):
    require(isinstance(value,str) and SHA_PATTERN.fullmatch(value), 'invalid SHA-256')
    return value


def emit(value):
    print(json.dumps(value,indent=2,sort_keys=True))


def cli(function):
    try:
        function()
    except (ReleaseError,OSError,ValueError,KeyError,TypeError,zipfile.BadZipFile,tarfile.TarError,subprocess.SubprocessError) as error:
        # Do not echo command stderr, configuration values or document contents.
        print('ERROR: ' + (str(error) if isinstance(error,ReleaseError) else type(error).__name__),file=sys.stderr)
        sys.exit(2)


class Paths:
    """Production paths are fixed; a root override exists only for offline fixtures."""
    def __init__(self, release, previous=None, root=Path('/')):
        self.release = validate_release_name(release)
        self.previous = validate_release_name(previous) if previous is not None else None
        require(self.previous != self.release, 'previous and candidate release must differ')
        self.root = Path(root)
        directory(self.root)

    def at(self, absolute):
        require(str(absolute).startswith('/') and '..' not in Path(absolute).parts, 'invalid absolute path')
        return self.root / str(absolute).lstrip('/')

    def backend(self, release):
        require(release in {self.release, self.previous}, 'unknown backend release')
        return self.at('/opt/pliego/releases') / validate_release_name(release)

    def frontend(self, release):
        require(release in {self.release, self.previous, self.rollback_release()}, 'unknown frontend release')
        return self.at('/var/www/pliego/releases') / validate_release_name(release)

    def rollback_release(self):
        require(self.previous is not None, 'previous release is not recorded')
        return rollback_release(self.previous, self.release)

    def deployment(self):
        return self.at('/opt/pliego/deployment') / self.release

    def production_name(self, path):
        return '/' + str(Path(path).relative_to(self.root))

    def with_previous(self, previous):
        require(self.previous is None or self.previous == previous, 'previous release identity changed')
        return Paths(self.release, previous, self.root)


BRAND_PNGS = ('brand/pliego-logo-email.png','brand/pliego-logo.png')
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


def require_png_signature(prefix):
    require(prefix == PNG_SIGNATURE,'required email brand image does not have a PNG signature')


def validate_brand_pngs(root):
    root = directory(root)
    for name in BRAND_PNGS:
        file = root/name
        require(file.is_file(),'required email brand image is missing')
        with regular_file(file).open('rb') as stream:
            require_png_signature(stream.read(8))


def rollback_release(previous, release):
    return validate_release_name(previous) + '-rollback-web-for-' + validate_release_name(release)


def validate_release_name(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,199}', value), 'invalid release ID')
    return value


HELPER_NAMES = ('release_common.py', 'compare_migrations.py', 'prepare_frontend.py',
                'poll_catalog.py', 'release_json.py', 'rollback.py', 'service_state.py')


def helper_hashes():
    return {name: sha256(Path(__file__).absolute().with_name(name)) for name in HELPER_NAMES}


def validate_preflight(value, release=None):
    require(isinstance(value, dict), 'preflight object required')
    for name in ('releaseId', 'previousReleaseId'):
        validate_release_name(value.get(name))
    require(value['releaseId'] != value['previousReleaseId'], 'previous and candidate must differ')
    if release is not None:
        require(value['releaseId'] == release, 'preflight names another release')
    for name in ('sourceSha', 'previousSourceSha'):
        require(isinstance(value.get(name), str) and re.fullmatch(r'[0-9a-f]{40}', value[name]), 'invalid source SHA')
    for name in ('previousBackendSha256', 'previousIndexSha256'):
        require_sha(value.get(name))
    require(type(value.get('ciRunId')) is int and value['ciRunId'] > 0, 'invalid CI run')
    for name in ('previousMaxFlyway', 'candidateMaxFlyway'):
        require(type(value.get(name)) is int and 0 < value[name] <= 999999, 'invalid migration maximum')
    require(value['candidateMaxFlyway'] >= value['previousMaxFlyway'], 'candidate cannot remove migrations')
    require(type(value.get('expectedCatalogTotalCount')) is int and value['expectedCatalogTotalCount'] >= 0, 'invalid preflight catalog count')
    return value


def accepted_versions(pins):
    return sorted({pins['previousMaxFlyway'], pins['candidateMaxFlyway']})


def resolve_current(paths,kind,allowed):
    link = paths.at('/opt/pliego/current' if kind == 'backend' else '/var/www/pliego/current')
    directory(link.parent)
    require(link.is_symlink(),'current pointer must be a symlink')
    target = link.resolve(strict=True)
    require(target in set(allowed),'current pointer drifted to an unrecorded release')
    directory(target)
    return target


def validate_config(path):
    file = regular_file(path)
    require(file.stat().st_size <= 1024*1024,'configuration file too large')
    fields = {}
    with file.open(encoding='utf-8') as stream:
        for line in stream:
            line = line.strip()
            if not line or line.startswith(('#',';')):
                continue
            require(not re.match(r'export\s+',line),'EnvironmentFile does not support export assignments')
            key,separator,value = line.partition('=')
            key = key.strip()
            require(separator and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',key),'unsupported EnvironmentFile assignment')
            value = value.strip()
            # Narrow parsing deliberately refuses all multiline/continuation forms,
            # including unknown secrets: allowlisted names must not come from the
            # middle of another variable's quoted value or continued physical line.
            trailing_slashes = len(value)-len(value.rstrip('\\'))
            require(trailing_slashes % 2 == 0,'multiline/continuation EnvironmentFile syntax requires operator review')
            if value.startswith(('"',"'")):
                quote = value[0]
                index = 1
                while index < len(value):
                    if quote == '"' and value[index] == '\\':
                        index += 2
                        continue
                    if value[index] == quote:
                        break
                    index += 1
                require(index == len(value)-1,'multiline/complex quoted EnvironmentFile syntax requires operator review')
                value = value[1:-1]
            if key in {'PLIEGO_R2_ENABLED','PLIEGO_MAIL_ENABLED'}:
                require(key not in fields,'duplicate required environment key')
                fields[key] = value
    require(fields.get('PLIEGO_R2_ENABLED') == 'true','R2 must remain enabled')
    require(fields.get('PLIEGO_MAIL_ENABLED') == 'true','mail must remain enabled')
    return {'r2Enabled':True,'mailEnabled':True}


def validate_compatibility(value, pins, candidate_sha256=None):
    validate_preflight(pins)
    require(isinstance(value, dict), 'compatibility evidence must be an object')
    require(value.get('candidateSourceSha') == pins['sourceSha'], 'compatibility evidence names another candidate source')
    require_sha(value.get('candidateJarSha256'))
    if candidate_sha256 is not None:
        require(value['candidateJarSha256'] == require_sha(candidate_sha256), 'compatibility evidence names another candidate JAR')
    require(value.get('previousSourceSha') == pins['previousSourceSha'], 'compatibility evidence names another backend')
    require(value.get('supportedSchemaVersions') == accepted_versions(pins), 'previous backend is not approved for both recorded schemas')
    require(value.get('restrictedRuntime') is True, 'restricted-runtime compatibility was not proven')
    require(value.get('emergencyRollbackCompatible') is True, 'emergency rollback compatibility was not approved')
    require(type(value.get('fullFeatureParity')) is bool, 'feature parity verdict must be explicit')
    require(type(value.get('expectedProductionCatalogTotalCount')) is int and value['expectedProductionCatalogTotalCount'] == pins['expectedCatalogTotalCount'], 'expected catalog baseline differs from preflight')
    require(type(value.get('observedLocalCatalogTotalCount')) is int and value['observedLocalCatalogTotalCount'] >= 0, 'observed local catalog count is missing')
    require(isinstance(value.get('limitations'), list) and all(isinstance(item, str) and 0 < len(item) <= 1000 for item in value['limitations']), 'compatibility limitations must be explicit strings')
    require(value['fullFeatureParity'] or len(value['limitations']) > 0, 'degraded emergency recovery must state its limitations')
    return value


def validate_tree_modes(path,backend=False):
    import grp
    root = directory(path)
    expected_group = grp.getgrnam('pliego').gr_gid if backend else 0
    for entry in [root,*root.rglob('*')]:
        reject_symlink_components(entry)
        info = entry.stat()
        expected_mode = (0o750 if entry.is_dir() else 0o640) if backend else (0o755 if entry.is_dir() else 0o644)
        require(info.st_uid == 0 and info.st_gid == expected_group and stat.S_IMODE(info.st_mode) == expected_mode,'release ownership/mode mismatch')
