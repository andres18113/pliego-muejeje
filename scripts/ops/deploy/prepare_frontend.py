#!/usr/bin/env python3
"""Install candidate and separate previous-build recovery tree, preserving hashed chunks."""
import argparse
import hashlib
import sys
sys.dont_write_bytecode = True
import os
from pathlib import Path
import tarfile
from release_common import BRAND_PNGS, require_png_signature, validate_brand_pngs, Paths, validate_release_name, HASHED_ASSET, MAX_FILE, cli, directory, emit, public_name, regular_file, reject_symlink_components, require, sha256, tree_hashes


def validate_members(archive):
    entries = {}
    total = 0
    for member in archive.getmembers():
        name = public_name(member.name)
        require(member.isfile() and not member.issym() and not member.islnk(),'archive must contain regular files only')
        require(name not in entries,'duplicate archive path')
        require(0 <= member.size <= MAX_FILE,'archive file too large')
        total += member.size
        require(total <= 1024*1024*1024,'archive too large')
        entries[name] = member
    require('index.html' in entries,'index.html missing')
    for name in entries:
        require(not any('/'.join(name.split('/')[:i]) in entries for i in range(1,len(name.split('/')))),'archive file/directory collision')
    for name in BRAND_PNGS:
        require(name in entries,'required email brand image is missing from archive')
        with archive.extractfile(entries[name]) as stream:
            require_png_signature(stream.read(8))
    return entries


def validate_archive(path):
    with tarfile.open(regular_file(path),'r:*') as archive:
        return validate_members(archive)


def install_file(destination,source,require_root):
    destination.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
    with open(destination,'xb') as output:
        while True:
            block = source.read(1024*1024)
            if not block:
                break
            output.write(block)
    os.chmod(destination,0o644)
    if require_root:
        os.chown(destination,0,0)


def finalize(root,require_root):
    for base,dirs,files in os.walk(root):
        os.chmod(base,0o755)
        if require_root:
            os.chown(base,0,0)
        for child in files:
            os.chmod(Path(base)/child,0o644)
            if require_root:
                os.chown(Path(base)/child,0,0)


def prepare(archive_path,previous,candidate,rollback,require_root=True):
    archive_path,previous,candidate,rollback = map(Path,(archive_path,previous,candidate,rollback))
    require(not require_root or os.geteuid() == 0,'root is required to install root-owned frontend files')
    regular_file(archive_path)
    directory(previous)
    for target in [candidate,rollback]:
        reject_symlink_components(target)
        require(not target.exists(),'refusing to overwrite an existing release directory')
    require(len({previous,candidate,rollback}) == 3,'frontend paths must differ')
    require(not any(a in b.parents for a in [previous,candidate,rollback] for b in [previous,candidate,rollback] if a != b),'frontend directories cannot be nested')
    previous_hashes = tree_hashes(previous,public=True)
    require('index.html' in previous_hashes,'previous index.html missing')
    validate_brand_pngs(previous)
    # Keep one inode and its validated TarInfo objects for the entire install.
    # A staging pathname replacement must never introduce new extraction names.
    with tarfile.open(archive_path,'r:*') as archive:
        entries = validate_members(archive)
        for name in set(entries) & set(previous_hashes):
            if HASHED_ASSET.fullmatch(name):
                with archive.extractfile(entries[name]) as stream:
                    require(hashlib.sha256(stream.read()).hexdigest() == previous_hashes[name],'same hashed asset name has different bytes')
        # Every input is validated before creating either target; failures retain evidence.
        candidate.mkdir(mode=0o755)
        rollback.mkdir(mode=0o755)
        for name,member in entries.items():
            with archive.extractfile(member) as stream:
                install_file(candidate/name,stream,require_root)
    for name in previous_hashes:
        with (previous/name).open('rb') as stream:
            install_file(rollback/name,stream,require_root)
    retained_old,retained_new = [],[]
    for source,destination,names,retained in [(previous,candidate,previous_hashes,retained_old),(candidate,rollback,entries,retained_new)]:
        for name in sorted(names):
            if HASHED_ASSET.fullmatch(name) and not (destination/name).exists():
                with (source/name).open('rb') as stream:
                    install_file(destination/name,stream,require_root)
                retained.append(name)
    finalize(candidate,require_root)
    finalize(rollback,require_root)
    require(sha256(rollback/'index.html') == previous_hashes['index.html'],'rollback index differs from previous build')
    return {'candidateFiles':tree_hashes(candidate,public=True),'rollbackFiles':tree_hashes(rollback,public=True),'rollbackIndexSha256':sha256(rollback/'index.html'),'retainedPreviousHashedAssets':retained_old,'retainedCandidateHashedAssets':retained_new}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive',type=lambda value:Path(value).absolute())
    parser.add_argument('previous',type=Path)
    parser.add_argument('candidate',type=Path)
    parser.add_argument('rollback',type=Path)
    parser.add_argument('--release',required=True,type=validate_release_name)
    parser.add_argument('--previous-release',required=True,type=validate_release_name)
    args = parser.parse_args()
    paths = Paths(args.release,previous_frontend=args.previous_release)
    require(args.previous == paths.frontend(args.previous_release),'previous frontend path differs from the pinned release')
    require(args.candidate == paths.frontend(args.release),'candidate frontend path differs from the pinned release')
    require(args.rollback == paths.frontend(paths.rollback_release()),'rollback frontend path differs from the pinned release')
    emit(prepare(args.archive,args.previous,args.candidate,args.rollback))


if __name__ == '__main__':
    cli(main)
