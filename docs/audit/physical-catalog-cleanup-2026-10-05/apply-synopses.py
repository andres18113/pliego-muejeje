"""Replayable, scoped metadata command; editions and bibliographic identities are preserved."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

repo = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(repo / 'scripts'))
from cover_catalog import discover_staging, read_manifest, write_json
from publish_digital_editions import flow, private_env

parser = argparse.ArgumentParser()
parser.add_argument('--apply', action='store_true')
parser.add_argument('--admin-env', type=Path, default=Path('/home/andres18123/.config/pliego/digital-admin.env'))
args = parser.parse_args()
audit = Path(__file__).resolve().parent
work = audit / 'synopses-work'
proposals = []
inputs = []
for kind in ['physical', 'ebook', 'audiobook']:
    inputs.extend(json.loads((work / (kind + '-input.json')).read_text())['records'])
    proposals.extend(json.loads((work / (kind + '-proposals.json')).read_text())['records'])
expected = {r['sku']: r for r in inputs}
actual = {r['sku']: r for r in proposals}
assert len(actual) == len(proposals) and set(actual) == set(expected), 'Synopsis identity set mismatch'
assert len({r['synopsis'] for r in proposals}) == len(proposals), 'Duplicate synopsis text'
for proposal in proposals:
    reference = expected[proposal['sku']]
    assert all(proposal[k] == reference[k] for k in ['book_id', 'title']), 'Book identity changed'
    assert 80 <= len(proposal['synopsis']) <= 10000, 'Invalid synopsis length'
    assert not re.search(r'\b(?:DEMO|SIMULATED)\b', proposal['synopsis'], re.I), 'Administrative marker in synopsis'
    assert proposal.get('sources'), 'Synopsis provenance missing'
active_manifest = read_manifest(repo / 'covers/generated/manifest-normalized.json')['records']
assert set(actual) == {r['permanent_sku'] for r in active_manifest}, 'Active catalog differs from proposals'
print('Synopsis preflight passed:', len(proposals), 'records.', flush=True)
if not args.apply:
    raise SystemExit(0)

config = private_env(args.admin_env)
api = flow.PliegoApi(config.get('PLIEGO_API_BASE_URL', flow.API_BASE))
api.login(config['PLIEGO_ADMIN_EMAIL'], config['PLIEGO_ADMIN_PASSWORD'])
before = json.loads((work / 'catalog-before-synopses.json').read_text())
current_books = {b['bookId']: b for b in api.all_pages('/api/v1/admin/books')}
current_editions = api.all_pages('/api/v1/admin/editions')
assert {e['sku']: e for e in before['editions']} == {e['sku']: e for e in current_editions}, 'Edition metadata changed before authoring'
active_by_sku = {e['sku']: e for e in current_editions if e['state'] == 'ACTIVE'}
assert set(active_by_sku) == set(actual), 'Active catalog changed before authoring'
for proposal in proposals:
    assert active_by_sku[proposal['sku']]['bookId'] == proposal['book_id'], 'Edition/book binding changed'

receipts = []
for proposal in proposals:
    book = current_books[proposal['book_id']]
    assert book['title'] == proposal['title'], 'Book title no longer matches proposal'
    changed = book['synopsis'] != proposal['synopsis']
    if changed:
        payload = {'title': book['title'], 'subtitle': book['subtitle'], 'synopsis': proposal['synopsis'],
                   'authors': [{'authorId': a['authorId'], 'order': a['order']} for a in book['authors']],
                   'categoryIds': [c['categoryId'] for c in book['categories']]}
        api.request('PUT', '/api/v1/admin/books/' + book['bookId'], payload)
    receipts.append({'sku': proposal['sku'], 'bookId': book['bookId'], 'changed': changed,
                     'synopsis_sha256': hashlib.sha256(proposal['synopsis'].encode()).hexdigest(),
                     'basis_kind': proposal['basis_kind']})
    if len(receipts) % 20 == 0 or len(receipts) == len(proposals):
        write_json(audit / 'synopsis-update-receipts.json', {'records': receipts})
        print('Synopses applied/verified:', len(receipts), '/', len(proposals), flush=True)

after_books = {b['bookId']: b for b in api.all_pages('/api/v1/admin/books')}
target_books = {r['book_id'] for r in proposals}
for old in before['books']:
    new = after_books[old['bookId']]
    if old['bookId'] in target_books:
        assert {k:v for k,v in old.items() if k not in {'synopsis','updatedAt'}} == {k:v for k,v in new.items() if k not in {'synopsis','updatedAt'}}, 'Bibliographic book metadata changed'
    else:
        assert old == new, 'Unrelated book changed'
for proposal in proposals:
    assert after_books[proposal['book_id']]['synopsis'] == proposal['synopsis'], 'Synopsis write did not persist'
assert {e['sku']: e for e in before['editions']} == {e['sku']: e for e in api.all_pages('/api/v1/admin/editions')}, 'Edition metadata changed during authoring'

paths = discover_staging(repo / 'covers')
paths += list((repo / 'covers/generated/json/Fisicos180').glob('*/staging.json'))
paths += list((repo / 'covers/generated/digital-batch/editions/staging').rglob('staging.json'))
for path in paths:
    document = json.loads(path.read_text())
    changed = False
    for row in document.get('libros', []):
        proposal = actual.get(row['edicion'].get('sku'))
        if proposal:
            row['libro']['sinopsis'] = proposal['synopsis']
            row.setdefault('preparacion', {})['synopsis_provenance'] = {
                'basis_kind': proposal['basis_kind'], 'sources': proposal['sources'],
                'original_editorial_text': True, 'public_administrative_markers': False,
            }
            changed = True
    if changed:
        write_json(path, document)
write_json(audit / 'books-after-synopses.json', {'records': list(after_books.values())})
write_json(audit / 'synopsis-summary.json', {'synopses_verified': len(proposals),
           'edition_metadata_preserved': len(current_editions), 'unrelated_books_preserved': len(before['books']) - len(target_books),
           'only_book_fields_changed': ['synopsis', 'updatedAt'], 'public_demonstration_markers_removed': True})
print('All synopsis updates verified; edition and bibliographic metadata preserved.', flush=True)
