#!/usr/bin/env python3
"""Backup-bucket REST plan/apply/readback. Default plan is completely offline.
Owner installs the private curl auth config; Claude runs apply/readback later.
Never run this against Cloudflare from Codex. No source bucket is addressable.
"""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

BUCKET = 'pliego-db-backups'
DAY = 86400
TIERS = [('frequent/', 7, 8), ('daily/', 30, 35), ('weekly/', 84, 91), ('monthly/', 365, 400), ('canary/', 1, 2)]


def desired():
    locks = [{'id': 'pliego-'+p[:-1]+'-lock', 'enabled': True, 'prefix': p,
              'condition': {'type': 'Age', 'maxAgeSeconds': lock*DAY}} for p, lock, _ in TIERS]
    # No fiscal deletion period is inferred. Indefinite backup-only lock prevents
    # aging content-addressed blobs from becoming deletable while still referenced.
    locks.append({'id': 'pliego-invoices-hold', 'enabled': True, 'prefix': 'object-backups/v1/',
                  'condition': {'type': 'Indefinite'}})
    lifecycle = [{'id': 'pliego-'+p[:-1]+'-expiry', 'enabled': True, 'conditions': {'prefix': p},
                  'deleteObjectsTransition': {'condition': {'type': 'Age', 'maxAge': expiry*DAY}}}
                 for p, _, expiry in TIERS]
    return {'lock': {'rules': locks}, 'lifecycle': {'rules': lifecycle}}


def canonical_rules(body):
    return sorted(body['rules'], key=lambda row: row['id'])


def multipart_only(rule):
    # R2 creates a seven-day incomplete-upload abort rule by default. It does
    # not expire objects, so preserve it while rejecting every unknown delete.
    return (set(rule) == {'id', 'enabled', 'conditions', 'abortMultipartUploadsTransition'}
            and rule['enabled'] is True and isinstance(rule['conditions'], dict)
            and set(rule['conditions']) <= {'prefix'} and rule['conditions'].get('prefix', '') == ''
            and rule['abortMultipartUploadsTransition'] == {'condition': {'type': 'Age', 'maxAge': 7*DAY}})


def lifecycle_parts(body):
    abort = [r for r in body.get('rules', []) if multipart_only(r)]
    ordinary = [r for r in body.get('rules', []) if not multipart_only(r)]
    return {'rules': ordinary}, abort


def verified(config):
    d = desired()
    return (config['bucket']['name'] == BUCKET and config['bucket']['storage_class'] == 'Standard'
            and config['bucket'].get('jurisdiction', 'default') == 'default'
            and config['managed']['enabled'] is False and config['custom']['domains'] == []
            and config['cors'].get('rules', []) == []
            and canonical_rules(config['lock']) == canonical_rules(d['lock'])
            and canonical_rules(lifecycle_parts(config['lifecycle'])[0]) == canonical_rules(d['lifecycle']))


class API:
    def __init__(self, account, auth):
        st = auth.lstat()
        if not stat.S_ISREG(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o600 or st.st_uid != os.geteuid():
            raise ValueError('private_auth_config_required')
        self.base = 'https://api.cloudflare.com/client/v4/accounts/'+account+'/r2/buckets'
        self.auth = auth

    def request(self, method, suffix='', body=None, missing=False):
        # No redirects/retries/debug output; request/response bodies never logged.
        cmd = ['curl', '--disable', '--config', str(self.auth), '--silent', '--show-error', '--noproxy', '*',
               '--connect-timeout', '10', '--max-time', '60', '--max-filesize', '1048576',
               '--request', method, '--header', 'Content-Type: application/json']
        with tempfile.TemporaryDirectory(prefix='pliego-cf-', dir='/tmp') as directory:
            out = Path(directory)/'response.json'
            cmd += ['--output', str(out), '--write-out', '%{http_code}']
            if body is not None:
                cmd += ['--data-binary', '@-']
            cmd += [self.base+suffix]
            r = subprocess.run(cmd, input=None if body is None else json.dumps(body).encode(),
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=70)
            if r.returncode:
                raise RuntimeError('api_transport_failed')
            code = int(r.stdout)
            if missing and code == 404:
                return None
            obj = json.loads(out.read_bytes())
            if not 200 <= code < 300 or obj.get('success') is not True:
                raise RuntimeError('api_request_failed')
            return obj['result']

    def read(self):
        base = '/'+BUCKET
        return {name: self.request('GET', base+path) for name, path in
                [('bucket', ''), ('managed', '/domains/managed'), ('custom', '/domains/custom'),
                 ('cors', '/cors'), ('lock', '/lock'), ('lifecycle', '/lifecycle')]}


def apply(api):
    base = '/'+BUCKET
    found = api.request('GET', base, missing=True)
    if found is None:
        api.request('POST', body={'name': BUCKET, 'storageClass': 'Standard'})
    else:
        if found.get('storage_class') != 'Standard' or found.get('jurisdiction', 'default') != 'default':
            raise ValueError('unexpected_existing_bucket')
    # Never silently remove a custom domain or change an unrelated configuration.
    # Exact intended rules may be safely reapplied; empty new-bucket rules are OK.
    custom = api.request('GET', base+'/domains/custom')
    if custom['domains']:
        raise ValueError('unexpected_custom_domain_stop')
    want = desired()
    for name in ('lock', 'lifecycle'):
        current = api.request('GET', base+'/'+name)
        ordinary, abort = lifecycle_parts(current) if name == 'lifecycle' else (current, [])
        if ordinary.get('rules', []) and canonical_rules(ordinary) != canonical_rules(want[name]):
            raise ValueError('unexpected_existing_rules_stop')
        if abort:
            want[name]['rules'] += abort
    api.request('PUT', base+'/domains/managed', {'enabled': False})
    cors = api.request('GET', base+'/cors')
    if cors.get('rules', []):
        api.request('DELETE', base+'/cors')
    for name in ('lock', 'lifecycle'):
        api.request('PUT', base+'/'+name, want[name])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['plan', 'apply', 'readback'])
    p.add_argument('--account-id', required=True)
    p.add_argument('--auth-config', type=Path)
    p.add_argument('--report', type=Path)
    a = p.parse_args()
    if not re.fullmatch('[a-f0-9]{32}', a.account_id):
        p.error('account-id must be 32 lowercase hexadecimal characters')
    os.umask(0o077)
    if a.action == 'plan':
        print(json.dumps({'bucket': BUCKET, 'create': {'name': BUCKET, 'storageClass': 'Standard'},
                          'managed': {'enabled': False}, 'custom_domains': [], 'cors': [], **desired()}, indent=2))
        return 0
    if a.auth_config is None or a.report is None or a.report.exists():
        p.error('auth-config and NEW report path required')
    result = {'result': 'FAIL', 'bucket': BUCKET, 'action': a.action}
    try:
        api = API(a.account_id, a.auth_config)
        if a.action == 'apply':
            apply(api)
        cfg = api.read()
        if not verified(cfg):
            raise ValueError('readback_mismatch')
        result.update(result='PASS', configuration=cfg)
    except Exception:
        result['stop'] = 'Cloudflare request/configuration not verified; inspect dashboard privately; no further mutation'
    a.report.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with a.report.open('x') as f:
        f.write(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'result': result['result'], 'report': str(a.report)}))
    return 0 if result['result'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
