#!/usr/bin/env python3
"""Root-run local journal allowlist. Prints JSON facts only, never journal lines."""
import argparse
import json
import re
import subprocess
import sys


def checked(command):
    p = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    if p.returncode:
        raise RuntimeError('local_status_unavailable')
    return p.stdout.decode(errors='replace')


def facts(unit, invocation, text, result, code):
    skip = 'backup_skipped_deploy_lock:' in text
    if unit == 'pliego-backup.service':
        matches = re.findall(r'^backup_success id=(\d{8}T\d{6}Z-[a-f0-9]{32}) bytes=([0-9]+) duration_seconds=([0-9]+) prefixes=((?:frequent|daily|weekly|monthly)(?: (?:frequent|daily|weekly|monthly))*)$', text, re.M)
        success = len(matches) == 1
        details = ({'id': matches[0][0], 'bytes': int(matches[0][1]), 'duration_seconds': int(matches[0][2]),
                    'prefixes': matches[0][3].split()} if success else {})
    else:
        matches = []
        for line in text.splitlines():
            try:
                value = json.loads(line)
                if (isinstance(value, dict) and value.get('status') == 'PASS'
                        and type(value.get('objects')) is int and type(value.get('copied')) is int):
                    matches.append(value)
            except ValueError:
                pass
        success = len(matches) == 1
        details = ({'objects': matches[0]['objects'], 'copied': matches[0]['copied']} if success else {})
    return {'unit': unit, 'invocation_id': invocation, 'result_success': result == 'success',
            'exit_zero': code == '0', 'completion_marker': success, 'deploy_lock_skipped': skip,
            'heartbeat_success': 'backup_heartbeat_ok event=success' in text,
            'heartbeat_warning': 'backup_heartbeat_warning:' in text, **details,
            'result': 'PASS' if result == 'success' and code == '0' and success and not skip else 'FAIL'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--unit', choices=['pliego-backup.service', 'object-backup.service'], required=True)
    a = p.parse_args()
    try:
        values = {}
        for name in ('InvocationID', 'Result', 'ExecMainStatus'):
            values[name] = checked(['systemctl', 'show', a.unit, '--property='+name, '--value']).strip()
        if not re.fullmatch('[a-f0-9]{32}', values['InvocationID']):
            raise ValueError('invalid_invocation')
        body = checked(['journalctl', '--no-pager', '--output=cat', '_SYSTEMD_INVOCATION_ID='+values['InvocationID']])
        report = facts(a.unit, values['InvocationID'], body, values['Result'], values['ExecMainStatus'])
    except Exception:
        report = {'unit': a.unit, 'result': 'FAIL', 'stop': 'Journal/status not verified'}
    print(json.dumps(report, sort_keys=True))
    return 0 if report['result'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
