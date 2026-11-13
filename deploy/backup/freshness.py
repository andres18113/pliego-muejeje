#!/usr/bin/env python3
"""Check every retention tier; independent monitoring is required for host loss."""
import datetime
import json
import pathlib
import sys

LIMITS = {'frequent': 7*3600, 'daily': 31*3600,
          'weekly': 8*86400+3600, 'monthly': 32*86400}

def check(receipt, now):
    ages = {}
    for tier, limit in LIMITS.items():
        path = receipt if tier == 'frequent' else receipt.parent/'retention'/f'{tier}.json'
        try:
            marker = json.loads(path.read_text())
            completed = datetime.datetime.fromisoformat(marker['completed_at'].replace('Z', '+00:00'))
            if completed.tzinfo is None:
                raise ValueError('completion lacks timezone')
            age = (now-completed).total_seconds()
            if not 0 <= age <= limit:
                raise ValueError('stale or future completion')
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            raise ValueError(f'{tier}: {error}') from error
        ages[tier] = round(age)
    return ages

if __name__ == '__main__':
    receipt = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/var/lib/pliego-backup/last-success.json')
    try:
        ages = check(receipt, datetime.datetime.now(datetime.timezone.utc))
    except ValueError as error:
        print('backup_freshness_failed: '+str(error), file=sys.stderr)
        sys.exit(1)
    print('backup_freshness_ok age_seconds='+json.dumps(ages, sort_keys=True))
