#!/usr/bin/env python3
"""Compare installed migration bytes against explicitly pinned migration maxima."""
import argparse
import sys
sys.dont_write_bytecode = True
import hashlib
import re
import zipfile
import zlib
from release_common import cli, emit, regular_file, require, sha256

PREFIX = 'BOOT-INF/classes/db/migration/'


def migrations(path):
    result = {}
    with zipfile.ZipFile(regular_file(path)) as archive:
        for entry in archive.infolist():
            if not entry.filename.startswith(PREFIX) or entry.is_dir():
                continue
            name = entry.filename[len(PREFIX):]
            match = re.fullmatch(r'V([0-9]{3,6})__[A-Za-z0-9_]+\.sql',name)
            require(match is not None,'unexpected migration entry')
            version = int(match.group(1))
            require(version not in result,'duplicate migration version')
            require(entry.file_size <= 16*1024*1024,'migration exceeds size limit')
            payload = archive.read(entry)
            result[version] = (name,payload)
    return result


def flyway_checksum(payload):
    crc = 0
    text = payload.decode('utf-8-sig')
    for line in re.split(r'\r\n|\r|\n',text):
        crc = zlib.crc32(line.encode('utf-8'),crc)
    return crc if crc < 2**31 else crc - 2**32


def compare(installed,candidate,previous_max,candidate_max):
    require(type(previous_max) is int and type(candidate_max) is int and 0 < previous_max <= candidate_max <= 999999, 'invalid pinned migration maxima')
    old,new = migrations(installed),migrations(candidate)
    require(set(old) == set(range(1,previous_max+1)),'installed JAR differs from the pinned migration maximum')
    require(set(new) == set(range(1,candidate_max+1)),'candidate JAR differs from the pinned migration maximum')
    for version in range(1,previous_max+1):
        require(old[version] == new[version],f'installed migration V{version:03d} changed')
    def row(version):
        name,payload = new[version]
        return {'version':version,'name':name,'sha256':hashlib.sha256(payload).hexdigest(),'flywayChecksum':flyway_checksum(payload)}
    return {'historicalCount':previous_max,'candidateCount':candidate_max,'installedJarSha256':sha256(installed),'candidateJarSha256':sha256(candidate),'applied':[row(v) for v in range(1,previous_max+1)],'pending':[row(v) for v in range(previous_max+1,candidate_max+1)]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('installed',type=lambda value:__import__('pathlib').Path(value).absolute())
    parser.add_argument('candidate',type=lambda value:__import__('pathlib').Path(value).absolute())
    parser.add_argument('--previous-max',required=True,type=int)
    parser.add_argument('--candidate-max',required=True,type=int)
    args = parser.parse_args()
    emit(compare(args.installed,args.candidate,args.previous_max,args.candidate_max))


if __name__ == '__main__':
    cli(main)
