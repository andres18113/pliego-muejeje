"""Publish a prepared physical batch using the existing ADMIN REST and R2 flows."""
from __future__ import annotations

import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from cover_catalog import (EXCLUDED_SKUS, category_slug, cover_evidence, metadata_errors,
                           publication_existing_keys, read_manifest, write_json)
from publish_digital_editions import (flow, upload, private_env, ensure_prepared_work,
                                      import_prepared_edition, verify_public_images)


def make_seed(record, cover):
    book, edition = record['libro'], record['edicion']
    if edition['formato'] not in {'PAPERBACK', 'HARDCOVER'} or type(edition.get('inventarioInicial')) is not int:
        raise ValueError('La importación física requiere formato físico e inventario DEMO explícito.')
    evidence = cover_evidence(edition)
    return flow.EditionSeed(edition['sku'], book['titulo'], book.get('subtitulo'),
        tuple(a['nombre'] for a in book['autores']), category_slug(book['categorias'][0]),
        edition['editorial'], edition['idioma'], edition['formato'], edition['paginas'],
        edition.get('fechaPublicacion'), edition['precio'], edition['inventarioInicial'],
        book.get('sinopsis'), edition.get('isbn13'), None, None, (), book['categorias'][0],
        cover['cover_url'], evidence['coverLicense'], evidence['coverSourceUrl'], evidence['coverAttribution'])


def assert_preserved(before, after):
    current = {row['sku']: row for row in after}
    for old in before:
        if current.get(old['sku']) != old:
            raise ValueError('Cambió una edición anterior: ' + old['sku'])


def validate_cover_receipts(items, audit):
    r2 = json.loads((audit / 'r2-upload.json').read_text())
    cdn = json.loads((audit / 'cdn-verification.json').read_text())['records']
    expected = {i['seed'].sku: (i['seed'].cover_url, i['digest'], 200) for i in items}
    actual = {r['sku']: (r['url'], r['sha256'], r['status']) for r in cdn}
    if (r2.get('errors') or r2.get('verified_count') != len(items)
            or len(cdn) != len(actual) or actual != expected):
        raise ValueError('La reanudación requiere recibos exactos y exitosos de R2/CDN para cada portada.')


def load_batch(repo):
    manifest = read_manifest(repo / 'covers/generated/manifest-normalized.json')
    covers = {r['permanent_sku']: r for r in manifest['records']}
    items, seen, identities = [], set(), set()
    for staging in sorted((repo / 'covers/generated/json/Fisicos180').glob('*/staging.json')):
        document = json.loads(staging.read_text())
        for index, record in enumerate(document['libros']):
            if metadata_errors(record):
                raise ValueError('Metadatos físicos inválidos: ' + str(metadata_errors(record)))
            edition = record['edicion']; sku = edition['sku']
            isbn = edition.get('isbn13')
            if sku in seen or sku in EXCLUDED_SKUS or sku not in covers:
                raise ValueError('SKU físico ausente, repetido o excluido: ' + sku)
            if isbn and (not flow.isbn_is_valid(isbn) or isbn in identities):
                raise ValueError('ISBN físico inválido o repetido: ' + str(isbn))
            if record['preparacion']['work']['action'] not in {'CREATE_NEW_WORK', 'REUSE_EXISTING_WORK'}:
                raise ValueError('Identidad bibliográfica sin resolver: ' + sku)
            seen.add(sku)
            if isbn: identities.add(isbn)
            cover = covers[sku]
            image = repo / 'covers/generated/r2-normalized' / cover['r2_object_key']
            digest = hashlib.sha256(image.read_bytes()).hexdigest()
            if not image.name.endswith('-' + digest[:12] + '.webp'):
                raise ValueError('Hash de portada incoherente: ' + sku)
            items.append({'record': record, 'seed': make_seed(record, cover), 'cover': cover,
                          'image': image, 'digest': digest, 'staging': staging, 'index': index})
    if not items:
        raise ValueError('No se encontró el lote físico preparado.')
    return items


def execute(repo, admin_config, r2_config, audit):
    items = load_batch(repo)
    api = flow.PliegoApi(admin_config.get('PLIEGO_API_BASE_URL', flow.API_BASE))
    api.login(admin_config['PLIEGO_ADMIN_EMAIL'], admin_config['PLIEGO_ADMIN_PASSWORD'])
    before = api.all_pages('/api/v1/admin/editions')
    before_path = audit / 'editions-before.json'
    if before_path.exists():
        original = json.loads(before_path.read_text())['records']
        assert_preserved(original, [r for r in before if r['sku'] in {x['sku'] for x in original}])
    else:
        original = before
        write_json(before_path, {'records': before})
    own = {i['seed'].sku for i in items}
    original_skus = {r['sku'] for r in original}
    if own & original_skus:
        raise ValueError('El lote físico intenta modificar un SKU anterior.')
    existing_isbns = {r['isbn13'] for r in original if r.get('isbn13')}
    if existing_isbns & {i['seed'].isbn13 for i in items if i['seed'].isbn13}:
        raise ValueError('Un ISBN del lote ya pertenece al catálogo anterior.')
    manifest = read_manifest(repo / 'covers/generated/manifest-normalized.json')
    preserved = publication_existing_keys(repo / 'covers', manifest['records'], own)
    config = upload.required_configuration(r2_config); client = upload.create_s3_client(config)
    def head(key):
        return key, client.head_object(Bucket=config['bucket'], Key=key)
    with ThreadPoolExecutor(max_workers=8) as pool:
        heads = dict(pool.map(head, sorted(preserved)))
    assets = [upload.UploadAsset(i['cover']['r2_object_key'], i['image'], i['image'].stat().st_size, i['digest']) for i in items]
    result = upload.sync_assets(client, config['bucket'], assets, 'covers/editions/v2/', allowed_existing_keys=preserved)
    write_json(audit / 'r2-upload.json', result)
    if result['errors'] or result['verified_count'] != len(items):
        raise ValueError('La sincronización R2 falló: ' + '; '.join(result['errors']))
    fields = ['ETag', 'ContentLength', 'ContentType', 'CacheControl', 'Metadata', 'LastModified']
    with ThreadPoolExecutor(max_workers=8) as pool:
        current_heads = dict(pool.map(head, sorted(preserved)))
    for key, original_head in heads.items():
        current = current_heads[key]
        if any(current.get(k) != original_head.get(k) for k in fields):
            raise ValueError('Cambió una portada anterior: ' + key)
    write_json(audit / 'cdn-verification.json', {'records': verify_public_images(items)})
    print('R2/CDN verificados; portadas anteriores preservadas.', flush=True)
    api.login(admin_config['PLIEGO_ADMIN_EMAIL'], admin_config['PLIEGO_ADMIN_PASSWORD'])
    return import_batch(api, items, audit, original)


def import_batch(api, items, audit, original):
    original_skus = {r['sku'] for r in original}
    if original_skus & {i['seed'].sku for i in items}:
        raise ValueError('La importación física intenta modificar un SKU anterior.')
    definitions = {i['seed'].category: flow.CategorySeed(i['seed'].category, i['seed'].category_name) for i in items}
    categories = flow.ensure_categories(api, tuple(definitions.values()))
    publishers, receipts = {}, []
    for item in items:
        seed, record = item['seed'], item['record']
        book_id = ensure_prepared_work(api, record, categories[seed.category])
        if seed.publisher not in publishers:
            publishers[seed.publisher] = flow.ensure_publisher(api, seed.publisher)
        edition = import_prepared_edition(api, seed, book_id, publishers[seed.publisher])
        current_stock = api.page('/api/v1/admin/inventory', editionId=edition['editionId'])
        if len(current_stock) != 1:
            raise ValueError('Inventario físico ausente: ' + seed.sku)
        difference = seed.stock - int(current_stock[0]['stockActual'])
        if difference > 0:
            api.request('POST', '/api/v1/admin/inventory/' + edition['editionId'] + '/entries',
                        {'quantity': difference, 'reason': 'DEMO/SIMULATED: inventario académico del lote físico de 180; no acredita existencias comerciales.'})
        receipts.append({'sku': seed.sku, 'editionId': edition['editionId'], 'bookId': book_id,
                         'format': seed.format, 'isbn13': seed.isbn13, 'stock': seed.stock,
                         'work_action': record['preparacion']['work']['action'],
                         'simulation': record['preparacion']})
        write_json(audit / 'import-receipts.json', {'schema': 'pliego-physical-import-receipts-v1', 'records': receipts})
        if len(receipts) % 30 == 0:
            print('Importadas ' + str(len(receipts)) + '/' + str(len(items)) + ' ediciones físicas.', flush=True)
    after = api.all_pages('/api/v1/admin/editions')
    assert_preserved(original, [r for r in after if r['sku'] in original_skus])
    write_json(audit / 'editions-after.json', {'records': after})
    write_json(audit / 'publication-summary.json', {'imported': len(receipts), 'previous_editions_preserved': len(original),
               'covers_published': len(items)})
    return receipts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--admin-env', type=Path, required=True)
    parser.add_argument('--r2-env', type=Path, required=True)
    parser.add_argument('--audit', type=Path, required=True)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--resume-import', action='store_true', help='Reanudar ADMIN tras verificar los recibos R2/CDN exactos.')
    args = parser.parse_args()
    if args.resume_import:
        items = load_batch(args.repo)
        validate_cover_receipts(items, args.audit)
        config = private_env(args.admin_env)
        api = flow.PliegoApi(config.get('PLIEGO_API_BASE_URL', flow.API_BASE))
        api.login(config['PLIEGO_ADMIN_EMAIL'], config['PLIEGO_ADMIN_PASSWORD'])
        original = json.loads((args.audit / 'editions-before.json').read_text())['records']
        import_batch(api, items, args.audit, original)
    elif args.execute:
        execute(args.repo, private_env(args.admin_env), private_env(args.r2_env), args.audit)
    else:
        print('Preflight físico: ' + str(len(load_batch(args.repo))) + ' ediciones.')


if __name__ == '__main__':
    main()
