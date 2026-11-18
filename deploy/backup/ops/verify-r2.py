#!/usr/bin/env python3
"""Phase D readbacks and narrowly scoped refusal canaries. Operator execution only.
No secrets, private object names, provider bodies or exception text are printed.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET
from urllib.parse import urlencode

UTC = dt.timezone.utc
BACKUP_BUCKET = 'pliego-db-backups'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def private_file(path):
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o600 or st.st_uid != os.geteuid():
        raise ValueError('private_credential_required')


class S3:
    def __init__(self, endpoint, bucket, credential, work, allow_expired=False):
        if not re.fullmatch(r'https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com', endpoint):
            raise ValueError('reviewed_endpoint_required')
        if bucket not in (BACKUP_BUCKET, 'billing-pliego'):
            raise ValueError('bucket_not_allowed')
        private_file(credential)
        c = json.loads(credential.read_bytes())
        for name in ('access_key', 'secret_key'):
            if not re.fullmatch(r'[A-Za-z0-9/+=_-]+', c[name]):
                raise ValueError('credential_encoding')
        expiry = dt.datetime.fromisoformat(c['expires_at'].replace('Z', '+00:00'))
        if expiry.tzinfo is None or (not allow_expired and expiry <= dt.datetime.now(UTC)):
            raise ValueError('credential_expired')
        self.config = work/'auth.curl'
        self.config.write_text('user = "'+c['access_key']+':'+c['secret_key']+'"\n')
        self.config.chmod(0o600)
        self.base = endpoint+'/'+bucket
        self.work = work
        self.events = []

    def request(self, method, key='', data=None, query=None, create_only=False):
        if key and (not re.fullmatch(r'[A-Za-z0-9._/-]+', key) or '..' in key or key.startswith('/')):
            raise ValueError('unsafe_key')
        output = self.work/'response'
        cmd = ['curl', '--disable', '--silent', '--show-error', '--noproxy', '*', '--connect-timeout', '10',
               '--max-time', '180', '--max-filesize', '1073741824', '--config', str(self.config),
               '--aws-sigv4', 'aws:amz:auto:s3', '--request', method,
               '--output', str(output), '--write-out', '%{http_code}']
        if data is not None:
            payload = self.work/'payload'
            payload.write_bytes(data)
            cmd += ['--upload-file', str(payload), '--header', 'x-amz-content-sha256:'+sha(data)]
        if create_only:
            cmd += ['--header', 'If-None-Match: *']
        cmd += [self.base+'/'+key+('?' + urlencode(query) if query else '')]
        # Deliberately NO retry: the source refusal must be exactly one PUT.
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=190)
        if r.returncode:
            raise RuntimeError('transport_failed')
        status = int(r.stdout)
        body = output.read_bytes()
        # Numeric statuses only; no body/key/URL in evidence.
        self.events.append({'method': method, 'status': status})
        return status, body

    def get(self, key):
        status, body = self.request('GET', key)
        if status != 200:
            raise ValueError('readback_failed')
        return body

    def list(self, prefix):
        keys, token = [], None
        for _ in range(100):
            query = {'list-type': '2', 'prefix': prefix, 'max-keys': '1000'}
            if token:
                query['continuation-token'] = token
            status, data = self.request('GET', query=query)
            if status != 200:
                raise ValueError('list_failed')
            root = ET.fromstring(data)
            keys += [e.text for e in root.iter() if e.tag.rsplit('}', 1)[-1] == 'Key']
            fields = {e.tag.rsplit('}', 1)[-1]: e.text for e in root}
            if fields.get('IsTruncated') == 'false':
                return keys
            if fields.get('IsTruncated') != 'true' or not fields.get('NextContinuationToken'):
                raise ValueError('invalid_pagination')
            token = fields['NextContinuationToken']
        raise ValueError('listing_limit')


def error_is(status, body, expected_status, code):
    if status != expected_status:
        return False
    try:
        root = ET.fromstring(body)
        return any(e.tag.rsplit('}', 1)[-1] == 'Code' and e.text == code for e in root)
    except ET.ParseError:
        return False


def denied(status, body):
    return error_is(status, body, 403, 'AccessDenied')


def locked(status, body):
    return error_is(status, body, 409, 'ObjectLockedByBucketPolicy')


def token_refused(status, body):
    return denied(status, body) or error_is(status, body, 401, 'Unauthorized')


def packet_check(data, work):
    path = work/'ciphertext.gpg'
    path.write_bytes(data)
    home = work/'empty-public-only-home'
    home.mkdir(mode=0o700, exist_ok=True)
    # --list-only skips actual decryption. Empty home cannot possess private keys.
    r = subprocess.run(['gpg', '--homedir', str(home), '--batch', '--no-tty', '--no-autostart', '--no-auto-key-retrieve',
                        '--list-only', '--list-packets', str(path)], stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, timeout=30)
    if r.returncode or b':pubkey enc packet:' not in r.stdout or b':encrypted data packet:' not in r.stdout:
        raise ValueError('openpgp_packet_check_failed')


def fresh(marker, max_hours=7):
    stamp = dt.datetime.fromisoformat(marker['completed_at'].replace('Z', '+00:00'))
    if stamp.tzinfo is None or not 0 <= (dt.datetime.now(UTC)-stamp).total_seconds() <= max_hours*3600:
        raise ValueError('stale_or_future_marker')


def first_run(store, work, receipts, fingerprint):
    reports = []
    # First installation must have promoted all four DB tiers. Compare local
    # receipts to remote exact IDs rather than pretending a listing proves bytes.
    for tier in ('frequent', 'daily', 'weekly', 'monthly'):
        local = json.loads((receipts/'retention'/f'{tier}.json').read_bytes())
        run_id = local['id']
        if not re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{32}', run_id):
            raise ValueError('invalid_receipt')
        key = tier+'/'+run_id+'/complete.json'
        if key not in store.list(tier+'/'):
            raise ValueError('missing_complete_marker')
        marker = json.loads(store.get(key))
        if marker != local or marker.get('tier') != tier:
            raise ValueError('receipt_marker_mismatch')
        fresh(marker)
        if not re.fullmatch('[a-f0-9]{64}', marker['sha256']) or type(marker['bytes']) is not int:
            raise ValueError('invalid_marker')
        data = store.get(tier+'/'+run_id+'/backup.tar.gpg')
        sidecar = store.get(tier+'/'+run_id+'/backup.tar.gpg.sha256')
        if (sha(data) != marker['sha256'] or len(data) != marker['bytes']
                or sidecar != (marker['sha256']+'  backup.tar.gpg\n').encode()):
            raise ValueError('ciphertext_sha_size_sidecar_mismatch')
        packet_check(data, work)
        reports.append({'tier': tier, 'id': run_id, 'sha256': marker['sha256'], 'bytes': len(data),
                        'completion_listed': True, 'receipt_equal': True, 'openpgp_packets': True})
    base = 'object-backups/v1/'+fingerprint+'/'
    keys = [k for k in store.list(base+'runs/') if re.fullmatch(re.escape(base)+r'runs/\d{8}T\d{6}Z-[a-f0-9]{32}/complete.json', k)]
    if not keys:
        raise ValueError('invoice_completion_missing')
    invoice = json.loads(store.get(max(keys)))
    fresh(invoice)
    digest = invoice['inventory_sha256']
    if not re.fullmatch('[a-f0-9]{64}', digest) or type(invoice['objects']) is not int or invoice['objects'] < 0:
        raise ValueError('invoice_marker_invalid')
    marker = json.loads(store.get(base+'index/'+digest+'/complete.json'))
    cipher_sha = marker['cipher_sha256']
    if not re.fullmatch('[a-f0-9]{64}', cipher_sha) or marker['plain_sha256'] != digest:
        raise ValueError('invoice_inventory_index_invalid')
    data = store.get(base+'blobs/'+cipher_sha+'.gpg')
    if (sha(data) != cipher_sha or len(data) != marker['cipher_bytes']
            or store.get(base+'blobs/'+cipher_sha+'.gpg.sha256') != (cipher_sha+'\n').encode()):
        raise ValueError('invoice_inventory_ciphertext_invalid')
    packet_check(data, work)
    return {'database_tiers': reports, 'invoices': {'completion_fresh': True, 'objects': invoice['objects'],
            'inventory_cipher_sha256': cipher_sha, 'inventory_openpgp_packets': True},
            'scope': 'publication/ciphertext only; attended restore required for plaintext and restored DB references'}


def source_refusal(store, report):
    # Positive read baseline distinguishes valid read-only scope from a bad token.
    status, _ = store.request('GET', query={'list-type': '2', 'max-keys': '0'})
    if status != 200:
        raise ValueError('source_read_baseline_failed')
    key = 'pliego-backup-canary/'+uuid.uuid4().hex+'.txt'
    report['canary_key'] = key  # synthetic name only, needed for incident handoff
    status, body = store.request('PUT', key, b'PLIEGO source reader refusal probe\n', create_only=True)
    if 200 <= status < 300:
        report['stop'] = 'UNEXPECTED SOURCE WRITE SUCCESS: STOP, do not delete/overwrite/retry; report synthetic canary key'
        raise ValueError('unexpected_source_write')
    if not denied(status, body):
        raise ValueError('source_refusal_not_access_denied')
    return {'single_put_access_denied': True, 'read_baseline': True, 'cleanup_attempted': False}


def lock_canary(store, report):
    key = 'canary/'+uuid.uuid4().hex+'.txt'
    report['canary_key'] = key
    data = b'PLIEGO backup lock probe\n'
    status, _ = store.request('PUT', key, data, create_only=True)
    if status not in (200, 201):
        raise ValueError('canary_create_failed')
    if store.get(key) != data:
        raise ValueError('canary_readback_failed')
    status, body = store.request('PUT', key, b'overwrite must fail\n')
    if not locked(status, body):
        report['stop'] = 'Lock overwrite refusal not verified; STOP; leave canary untouched'
        raise ValueError('lock_overwrite_not_locked')
    status, body = store.request('DELETE', key)
    if not locked(status, body):
        report['stop'] = 'Lock delete refusal not verified; STOP; no cleanup/retry'
        raise ValueError('lock_delete_not_locked')
    if store.get(key) != data:
        raise ValueError('locked_canary_bytes_changed')
    return {'overwrite_object_locked': True, 'delete_object_locked': True, 'original_bytes_equal': True,
            'cleanup_attempted': False, 'expiry': 'lifecycle after 2 days; lock 1 day'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['first-run', 'lock-canary', 'source-refusal', 'reader-baseline', 'expired-reader'])
    p.add_argument('--endpoint', required=True)
    p.add_argument('--credential', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--receipts', type=Path, default=Path('/var/lib/pliego-backup'))
    p.add_argument('--fingerprint')
    a = p.parse_args()
    if a.report.exists():
        p.error('report must be new')
    if a.action == 'first-run' and not re.fullmatch('[A-F0-9]{40,64}', a.fingerprint or ''):
        p.error('first-run needs full uppercase original recipient fingerprint')
    os.umask(0o077)
    report = {'result': 'FAIL', 'action': a.action, 'completed_at': dt.datetime.now(UTC).isoformat()}
    store = None
    try:
        with tempfile.TemporaryDirectory(prefix='pliego-r2-verify-', dir='/run' if os.geteuid() == 0 else '/tmp') as directory:
            work = Path(directory)
            store = S3(a.endpoint, 'billing-pliego' if a.action == 'source-refusal' else BACKUP_BUCKET,
                       a.credential, work, allow_expired=a.action == 'expired-reader')
            if a.action == 'first-run':
                report['checks'] = first_run(store, work, a.receipts, a.fingerprint)
            elif a.action == 'source-refusal':
                report['checks'] = source_refusal(store, report)
            elif a.action == 'lock-canary':
                report['checks'] = lock_canary(store, report)
            elif a.action == 'reader-baseline':
                status, _ = store.request('GET', query={'list-type': '2', 'max-keys': '0'})
                if status != 200:
                    raise ValueError('token_baseline_not_valid')
                report['checks'] = {'server_read_baseline': True}
            else:
                # Intentionally bypass only client expiry check to prove server
                # refusal, on an owner-chosen disposable revoked/expired token.
                status, body = store.request('GET', query={'list-type': '2', 'max-keys': '0'})
                if not token_refused(status, body):
                    raise ValueError('server_token_refusal_not_verified')
                report['checks'] = {'server_authentication_or_access_refused': True, 'client_expiry_bypassed_for_probe_only': True}
            report['result'] = 'PASS'
    except Exception:
        report.setdefault('stop', 'Verification failed; stop activation; inspect privately without exposing provider responses')
    finally:
        if store:
            report['http_statuses'] = store.events
        a.report.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with a.report.open('x') as f:
            f.write(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'result': report['result'], 'report': str(a.report)}))
    return 0 if report['result'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
