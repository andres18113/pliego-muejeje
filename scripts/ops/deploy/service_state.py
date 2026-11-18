#!/usr/bin/env python3
"""Named systemd state, bounded drain, and reset-before-start operations.

Never infer property order from a combined ``systemctl show --value`` call.
"""
import argparse
import math
import os
import re
import subprocess
import sys
import time

sys.dont_write_bytecode = True
from release_common import ReleaseError, cli, emit, require


def command(args, allow_failure=False, timeout=15):
    """Run without inherited libpq routing or secret command output."""
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    env['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=3000'
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env, check=False)
    except (OSError, subprocess.SubprocessError):
        raise ReleaseError('required read-only or service command failed') from None
    require(len(result.stdout) <= 1024 * 1024, 'command output exceeded safety limit')
    require(allow_failure or result.returncode == 0, 'required read-only or service command failed')
    return result.stdout.strip()


def parse_value(property_name, output):
    """Validate one value from a separate, explicitly named --value query."""
    require(property_name in {'ActiveState', 'MainPID'}, 'unsupported service property')
    value = output.strip()
    if property_name == 'MainPID':
        require(re.fullmatch(r'[0-9]+', value) is not None, 'invalid named MainPID value')
    else:
        require(re.fullmatch(r'[a-z-]+', value) is not None, 'invalid named ActiveState value')
    return value


def parse_state(output):
    """Parse key=value records in systemd's order, rejecting positional values."""
    fields = {}
    for line in output.splitlines():
        if not line.strip():
            continue
        key, separator, value = line.partition('=')
        require(separator, 'systemctl state requires named properties')
        if key in {'ActiveState', 'MainPID'}:
            require(key not in fields, 'duplicate named service property')
            fields[key] = parse_value(key, value)
    require(set(fields) == {'ActiveState', 'MainPID'}, 'missing named service property')
    return fields


def validate_service(service):
    require(isinstance(service, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.@-]*', service),
            'invalid service name')
    return service


def state(service='pliego', runner=None, values=False, timeout=15):
    """Read names with records, or with separate one-property --value calls."""
    runner = runner or command
    service = validate_service(service)
    if values:
        return {name: parse_value(name, runner(['systemctl', 'show', service,
                '--property=' + name, '--value'], timeout=timeout))
                for name in ('ActiveState', 'MainPID')}
    return parse_state(runner(['systemctl', 'show', service,
                              '--property=ActiveState,MainPID'], timeout=timeout))


def is_drained(fields):
    return fields.get('ActiveState') in {'failed', 'inactive'} and fields.get('MainPID') == '0'


def stop_and_drain(service='pliego', timeout=45, runner=None, clock=time.monotonic, sleep=time.sleep):
    """Stop within the unit budget, then wait for named stopped state and PID zero."""
    runner = runner or command
    service = validate_service(service)
    require(type(timeout) in {int, float} and math.isfinite(timeout) and 0 < timeout <= 300,
            'drain timeout must be positive and at most 300 seconds')
    # TimeoutStopSec=45s: the stop command itself must be allowed to finish.
    runner(['systemctl', 'stop', service], allow_failure=True, timeout=max(50, timeout + 5))
    deadline = clock() + timeout
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            raise ReleaseError('backend did not drain to failed/inactive with MainPID=0; pointers unchanged')
        fields = state(service, runner=runner, timeout=min(15, remaining))
        if is_drained(fields) and clock() <= deadline:
            return fields
        remaining = deadline - clock()
        if remaining > 0:
            sleep(min(1.0, remaining))


def start(service='pliego', runner=None):
    runner = runner or command
    service = validate_service(service)
    runner(['systemctl', 'reset-failed', service])
    runner(['systemctl', 'start', service])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['state', 'drain', 'start'])
    parser.add_argument('service', nargs='?', default='pliego')
    parser.add_argument('--timeout', type=float, default=45)
    args = parser.parse_args()
    if args.action == 'drain':
        emit(stop_and_drain(args.service, args.timeout))
    elif args.action == 'start':
        start(args.service)
        emit({'service': args.service, 'startRequested': True})
    else:
        emit(state(args.service))


if __name__ == '__main__':
    cli(main)
