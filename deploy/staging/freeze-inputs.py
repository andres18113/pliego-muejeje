#!/usr/bin/env python3
"""Freeze already reviewed offline artifacts; never downloads or installs packages."""
import argparse
import hashlib
import json
from pathlib import Path

kit=Path(__file__).resolve().parent
root=kit.parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--artifacts',type=Path,required=True)
a=p.parse_args();folder=a.artifacts.resolve()
required=['temurin-25.0.5+8.tar.gz','pliego-backend-0.1.0-SNAPSHOT.jar']
if not folder.is_dir() or any(not (folder/name).is_file() for name in required):p.error('Supply reviewed Java archive and frozen tested JAR first')
debs=sorted(p.name for p in folder.glob('*.deb'))
if not debs:p.error('Supply the complete approved offline Ubuntu24.04 dependency closure, including PG18.6/nginx/sysstat/ufw/python3')
if (folder/'pins.json').exists() or (folder/'frozen-sources.sha256').exists():p.error('Fresh artifact directory required; do not overwrite reviewed manifests')
def sha(file):return hashlib.sha256(file.read_bytes()).hexdigest()
files=[p for p in kit.iterdir() if p.is_file()]
files += [root/name for name in ['perf/k6/bootstrap.py','perf/k6/seed.sql','scripts/LocalFlyway.java','docs/deployment/production-runbook.md','perf/k6/journeys.js','perf/k6/target-guard.js','perf/jvm/fatal-collector.py']]
files += [p for p in (root/'backend/src/main/resources/db/migration').glob('*') if p.is_file()]
(folder/'frozen-sources.sha256').write_text(''.join(sha(p)+'  '+str(p.relative_to(root))+'\n' for p in sorted(set(files))))
names=required+debs+['frozen-sources.sha256']
pins={'java_version':'25.0.5+8','postgres_version':'18.6','ubuntu_version':'24.04.5','debs':debs,'artifacts':{name:sha(folder/name) for name in names}}
(folder/'pins.json').write_text(json.dumps(pins,indent=2)+'\n')
print('Frozen local bytes. SHA256 establishes identity; operator must independently verify official vendor/package provenance and exact package versions before approval.')
