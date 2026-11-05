#!/usr/bin/env python3
"""Dummy-only local probes; never invoke any owner prompt/key generation script."""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]

def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'deploy/backup'/f'{name}.py')
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

creds = module('owner-credentials')
keys = module('owner-protected-key')
paths = module('owner-key-paths')
count = 0

def passed(label):
    global count
    count += 1
    print('PASS ' + label)

def refuses(fn, label):
    try:
        fn()
    except (ValueError, IndexError, FileNotFoundError):
        passed(label)
    else:
        raise AssertionError(label)

now = dt.datetime.now(dt.timezone.utc)
expiry = (now + dt.timedelta(days=89)).strftime('%Y-%m-%dT%H:%M:%SZ')
# Obvious synthetic values only; no production source or environment is read.
a, s = 'DUMMY_ACCESS_KEY_1234', 'DUMMY_SECRET_KEY_' * 4
assert creds.credential(a, s, expiry)['expires_at'] == expiry
passed('future UTC expiry accepted without alteration')
for label, value in [('expired', now-dt.timedelta(seconds=1)), ('over90days', now+dt.timedelta(days=91))]:
    refuses(lambda: creds.credential(a,s,value.strftime('%Y-%m-%dT%H:%M:%SZ')), label+' refused')
refuses(lambda: creds.credential(a,s,'2027-02-03'), 'naive expiry refused')
refuses(lambda: creds.credential(a,'bad\nencoding',expiry), 'malformed credential refused')
with tempfile.TemporaryDirectory(prefix='pliego-owner-dummy-') as d:
    private = Path(d)/'restore'
    raw = '\0'.join((a,s,expiry,''))
    # Managed /tmp/.git is an environment marker. Hide only that marker for
    # this confined dummy success fixture; keep all real path guard code intact.
    original_exists = Path.exists
    def fixture_exists(path):
        return False if path == Path('/tmp/.git') else original_exists(path)
    output = io.StringIO()
    with patch.object(Path, 'exists', fixture_exists), patch.object(__import__('sys'), 'argv', ['owner-credentials.py','workstation',str(private)]), patch.object(__import__('sys'), 'stdin', type('DummyInput', (), {'buffer':io.BytesIO(raw.encode())})()), contextlib.redirect_stdout(output):
        creds.main()
    class Result:
        stdout = output.getvalue().encode()
        stderr = b''
    result = Result()
    assert stat.S_IMODE(private.stat().st_mode) == 0o700
    for name in ('s3.json','object-target.json'):
        f=private/name
        assert stat.S_IMODE(f.stat().st_mode)==0o600 and f.stat().st_uid == os.getuid()
        assert json.loads(f.read_text()) == {'access_key':a,'secret_key':s,'expires_at':expiry}
    assert a.encode() not in result.stdout + result.stderr and s.encode() not in result.stdout + result.stderr
    passed('dummy installer backend writes 0700 directory and two 0600 files; no values in output')
    def run_backend(mode, values):
        with patch.object(creds, 'private_directory', return_value=private), patch.object(__import__('sys'), 'argv', ['owner-credentials.py',mode,'/dummy-only']), patch.object(__import__('sys'), 'stdin', type('DummyInput', (), {'buffer':io.BytesIO(('\0'.join(values)+'\0').encode())})()), contextlib.redirect_stdout(io.StringIO()):
            creds.main()
    run_backend('vps',[a,s,expiry,a+'SOURCE',s,expiry])
    assert json.loads((private/'s3.json').read_text()) == json.loads((private/'object-target.json').read_text())
    assert json.loads((private/'object-source.json').read_text())['access_key'] != a
    passed('dummy VPS mapping reuses writer only for target and keeps source distinct')
    refuses(lambda:run_backend('vps',[a,s,expiry,a,s,expiry]),'same writer/source key refused')
    urls=['https://hc-ping.com/00000000-0000-0000-0000-000000000001','https://hc-ping.com/00000000-0000-0000-0000-000000000002']
    run_backend('pings',urls)
    assert json.loads((private/'heartbeat.json').read_text())['url'] == urls[0]
    assert json.loads((private/'object-heartbeat.json').read_text())['url'] == urls[1]
    passed('dummy DB/invoice ping JSON maps to separate fixed filenames')
    refuses(lambda:run_backend('pings',[urls[0],urls[0]]),'same DB/invoice ping refused')
    refuses(lambda:run_backend('pings',['https://other.invalid/secret',urls[1]]),'non-Healthchecks URL refused')
    old_inode=(private/'s3.json').stat().st_ino
    with contextlib.redirect_stdout(io.StringIO()):
        creds.write_json(private,'s3.json',{'dummy':True})
    assert (private/'s3.json').stat().st_ino != old_inode
    passed('credential replacement uses new inode in destination directory')
    (private/'unsafe.json').symlink_to(private/'s3.json')
    refuses(lambda:creds.write_json(private,'unsafe.json',{}),'symlink destination refused')
    assert not list(private.glob('.owner-install-*'))
    passed('atomic writer leaves no temporary files')
    bad = subprocess.run(['python3','deploy/backup/owner-credentials.py','workstation',str(private)],input=b'bad\0secret\0bad\0',capture_output=True)
    assert bad.returncode == 1 and b'bad\0secret' not in bad.stderr
    passed('dummy CLI failure reports fixed diagnostics only')
    repo=Path(d)/'repository'; repo.mkdir(); (repo/'.git').mkdir()
    refuses(lambda:creds.private_directory(repo/'no-credentials'),'nested repository credential path refused')
    evidence=Path(d)/'.release-evidence'; evidence.mkdir()
    refuses(lambda:paths.check(str(evidence/'new'),fresh=True),'offline key path under evidence refused')
    refuses(lambda:paths.check(str(repo/'new'),fresh=True),'offline key path under repository refused')
# Minimal fake OpenPGP packet bodies, not cryptographic key generation/material.
def packet(tag, protected=True):
    body=bytes([4])+b'\0'*4+bytes([1])+b'\0\x05\x11'+b'\0\x02\x03'
    body += bytes([254,9,3,8]) if protected else b'\0'
    body += b'DUMMY-NON-KEY-BYTES'
    return bytes([0xc0|tag,len(body)])+body
keys.check(packet(5)+packet(7))
passed('synthetic protected v4 RSA packet metadata accepted')
refuses(lambda:keys.check(packet(5,False)+packet(7)),'synthetic unprotected secret primary refused')
refuses(lambda:keys.check(packet(5)+packet(7,False)),'synthetic unprotected secret subkey refused')
refuses(lambda:keys.check(packet(5)),'missing secret encryption subkey refused')
refuses(lambda:keys.check((packet(5)+packet(7))[:-1]),'truncated synthetic packet refused')
for rel in ('ops/install-credentials.sh','ops/install-ping-urls.sh','owner/install-workstation-credentials.sh'):
    text=(ROOT/'deploy/backup'/rel).read_text()
    assert 'read -rs' in text and 'set +xv' in text and 'export -n ' in text and 'ulimit -c 0' in text
    assert 'exec 3<>/dev/tty' in text
passed('three owner installers statically enforce silent terminal entry and disable tracing/export/core dumps')
key_script=(ROOT/'deploy/backup/owner/generate-offline-key.sh').read_text()
assert '--passphrase' not in key_script and 'pinentry-mode loopback' not in key_script
assert '--quick-generate-key' in key_script and 'min-passphrase-len 24' in key_script
passed('keygen static policy: pinentry and length floor; no passphrase argument')
for name in ('owner-credentials','owner-key-paths','owner-protected-key'):
    compile((ROOT/'deploy/backup'/f'{name}.py').read_text(),name,'exec')
passed('all Python helper sources compile')
print(f'PASS {count} dummy/static checks; no owner prompts, key generation or network calls executed')
