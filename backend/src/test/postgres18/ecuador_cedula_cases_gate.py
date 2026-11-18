"""Shared synthetic vectors against PostgreSQL, with ADR-0043's SRI company-RUC relaxation."""
import json
from pathlib import Path
from checkout_last_unit import query


def main():
    cases = json.loads((Path(__file__).resolve().parents[4] / 'shared/validation/ec-identification-cases.json').read_text())['cases']
    for case in cases:
        # Input is synthetic and UTF8 hex encoded, avoiding SQL escape ambiguities.
        value = 'NULL' if case['input'] is None else "convert_from(decode('" + case['input'].encode().hex() + "','hex'),'UTF8')"
        actual = query(f"SELECT pliego.fn_is_valid_ec_identification('{case['type']}', {value})") == 't'
        assert actual == case['valid'], f"shared validator mismatch for case {case['id']}"
    print(f'Ecuador identification vectors: {len(cases)} PostgreSQL cases passed (including SRI no-check-digit company RUCs).')


if __name__ == '__main__':
    main()
