"""Publish only the verified digital batch through existing R2/ADMIN REST flows."""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import sys
from concurrent.futures import ThreadPoolExecutor
import urllib.request

from cover_catalog import (EXCLUDED_SKUS, category_slug, cover_evidence, metadata_errors,
                           publication_existing_keys, read_manifest, retired_records, write_json)
from prepare_digital_editions import canonical, readiness_errors


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


flow = module('pliego_official_catalog_import', 'seed-development-catalog.py')
upload = module('pliego_official_r2_sync', 'upload-r2-covers.py')


def private_env(path):
    result = {}
    for line in path.read_text().splitlines():
        line = line.strip().removeprefix('export ')
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            result[key] = shlex.split(value)[0] if value else ''
    return result


def make_seed(record, cover):
    book, edition = record['libro'], record['edicion']
    if edition['formato'] not in {'EBOOK', 'AUDIOBOOK'} or edition.get('inventarioInicial') is not None:
        raise ValueError('La importación solo admite ediciones digitales sin inventario.')
    evidence = cover_evidence(edition)
    return flow.EditionSeed(edition['sku'], book['titulo'], book.get('subtitulo'),
        tuple(a['nombre'] for a in book['autores']), category_slug(book['categorias'][0]),
        edition['editorial'], edition['idioma'], edition['formato'], edition.get('paginas'),
        edition.get('fechaPublicacion'), edition['precio'], 0, book.get('sinopsis'), edition.get('isbn13'),
        edition.get('ebookFileFormat'), edition.get('audioDurationSeconds'), tuple(edition.get('narrators') or []),
        book['categorias'][0], cover['cover_url'], evidence['coverLicense'], evidence['coverSourceUrl'], evidence['coverAttribution'])


def work_matches(book, record):
    wanted = record['libro']
    names = [a['name'] for a in sorted(book.get('authors', []), key=lambda a: a.get('order', 1))]
    return (canonical(book['title']) == canonical(wanted['titulo'])
            and canonical(book.get('subtitle') or '') == canonical(wanted.get('subtitulo') or '')
            and [canonical(n) for n in names] == [canonical(a['nombre']) for a in wanted['autores']])


def ensure_prepared_work(api, record, category_id):
    plan = record['preparacion']['work']
    candidates = api.all_pages('/api/v1/admin/books', query=record['libro']['titulo'])
    if plan['action'] == 'REUSE_EXISTING_WORK':
        found = [b for b in candidates if str(b['bookId']) == str(plan['bookId'])]
        if len(found) != 1 or not work_matches(found[0], record) or found[0]['state'] != 'ACTIVE':
            raise ValueError('La identidad existente de obra ya no coincide con el staging.')
        return found[0]['bookId']
    if plan['action'] != 'CREATE_NEW_WORK':
        raise ValueError('La obra tiene identidad pendiente.')
    exact = [b for b in candidates if work_matches(b, record)]
    if len(exact) > 1:
        raise ValueError('Hay más de una obra con la identidad exacta preparada.')
    if exact:
        if exact[0]['state'] != 'ACTIVE':
            raise ValueError('La obra exacta existente está inactiva; no se modificará.')
        return exact[0]['bookId']
    authors = []
    for author in record['libro']['autores']:
        ident = flow.ensure_author(api, author['nombre'])
        authors.append({'authorId': ident, 'order': author['orden']})
    book = record['libro']
    created = api.request('POST', '/api/v1/admin/books', {'title': book['titulo'], 'subtitle': book.get('subtitulo'),
        'synopsis': book.get('sinopsis'), 'authors': authors, 'categoryIds': [category_id]})
    return created['bookId']


def import_prepared_edition(api, seed, book_id, publisher_id):
    found = flow.find_existing_edition(api, seed)
    if found:
        wanted = {'bookId': book_id, 'publisherId': publisher_id, 'sku': seed.sku, 'isbn13': seed.isbn13,
            'language': seed.language, 'format': seed.format, 'pageCount': seed.page_count,
            'publicationDate': seed.publication_date, 'price': seed.price, 'coverUrl': seed.cover_url,
            'ebookFileFormat': seed.ebook_file_format, 'audioDurationSeconds': seed.audio_duration_seconds,
            'narrators': list(seed.narrators), 'state': 'ACTIVE'}
        if any(found.get(key) != value for key, value in wanted.items()):
            raise ValueError('El SKU existente difiere de la edición preparada: ' + seed.sku)
        return found
    return flow.ensure_edition(api, seed, book_id, publisher_id)


def load_batch(repo):
    batch = repo / 'covers/generated/digital-batch/editions'
    covers = read_manifest(batch / 'manifest-cover-proposed.json')
    by_sku = {r['permanent_sku']: r for r in covers['records']}
    retired = {r['permanent_sku']: r for r in retired_records(repo / 'covers')}
    seen = set()
    items = []
    for path in sorted((batch / 'staging').rglob('staging.json')):
        for index, record in enumerate(json.loads(path.read_text())['libros']):
            if metadata_errors(record) or readiness_errors(record):
                raise ValueError('Hay metadatos pendientes en el lote.')
            sku = record['edicion']['sku']
            if sku not in by_sku or sku in seen or sku in EXCLUDED_SKUS:
                raise ValueError('El lote contiene un SKU desconocido, duplicado o excluido.')
            seen.add(sku)
            cover = by_sku[sku]
            if cover['title'] != record['libro']['titulo'] or cover.get('isbn13') != record['edicion'].get('isbn13'):
                raise ValueError('La identidad del staging no coincide con el manifiesto propuesto.')
            image = (path.parent / record['portadaArchivo']).resolve()
            digest = hashlib.sha256(image.read_bytes()).hexdigest()
            if digest != record['preparacion']['source']['cover_sha256'] or not cover['r2_object_key'].endswith('-' + digest[:12] + '.webp'):
                raise ValueError('La imagen no coincide con el staging/manifiesto.')
            if sku in retired:
                archived = retired[sku]
                if (cover['r2_object_key'] != archived['r2_object_key'] or cover['title'] != archived['title']
                        or cover.get('isbn13') != archived.get('isbn13')
                        or record['edicion']['formato'] != archived.get('format')):
                    raise ValueError('La identidad del lote no coincide con la edición retirada.')
                continue
            items.append({'record': record, 'cover': cover, 'image': image, 'staging': path, 'index': index,
                          'seed': make_seed(record, cover), 'digest': digest})
    if seen != set(by_sku):
        raise ValueError('El lote requiere una edición de staging por cada identidad del manifiesto propuesto.')
    return items


def verify_public_images(items):
    def check(item):
        req = urllib.request.Request(item['cover']['cover_url'], headers={'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read()
            tokens = {x.strip() for x in response.headers.get('Cache-Control', '').split(',')}
            if (response.status != 200 or response.headers.get_content_type() != 'image/webp'
                    or not {'public', 'max-age=31536000', 'immutable'}.issubset(tokens)
                    or hashlib.sha256(data).hexdigest() != item['digest']):
                raise ValueError('El CDN público no coincide para ' + item['seed'].sku)
        return {'sku': item['seed'].sku, 'url': item['cover']['cover_url'], 'sha256': item['digest'],
                'Content-Type': 'image/webp', 'Cache-Control': upload.CACHE_CONTROL, 'status': 200}
    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(check, items))


def merge_registry(current, proposed):
    """Resume an older batch without losing assignments made by subsequent batches."""
    result = copy.deepcopy(current)
    by_sku = {row['sku']: row for row in result['assignments']}
    identities = {key: row['sku'] for row in result['assignments'] for key in row['identity_keys']}
    sources = {key: row['sku'] for row in result['assignments'] for key in row['source_keys']}
    for row in proposed['assignments']:
        sku = row['sku']
        if (any(identities.get(key, sku) != sku for key in row['identity_keys'])
                or any(sources.get(key, sku) != sku for key in row['source_keys'])):
            raise ValueError('El registro propuesto intenta reasignar una identidad o fuente existente.')
        if sku in by_sku:
            existing = by_sku[sku]
            if not set(row['identity_keys']).issubset(existing['identity_keys']):
                raise ValueError('El registro propuesto intenta cambiar la identidad de un SKU existente.')
        else:
            existing = copy.deepcopy(row)
            result['assignments'].append(existing)
            by_sku[sku] = existing
        for key in row['identity_keys']:
            identities[key] = sku
        for key in row['source_keys']:
            sources[key] = sku
    result['assignments'].sort(key=lambda row: row['sku'])
    result['next_sequence'] = max(current['next_sequence'], proposed['next_sequence'],
                                  max((int(row['sku'].rsplit('-', 1)[1]) for row in result['assignments']), default=0) + 1)
    return result


def execute(repo, admin_config, r2_config, audit):
    items = load_batch(repo)
    proposed = json.loads((repo / 'covers/generated/digital-batch/editions/sku-registry-proposed.json').read_text())
    current = json.loads((repo / 'covers/sku-registry.json').read_text())
    registry = merge_registry(current, proposed)
    api = flow.PliegoApi(admin_config.get('PLIEGO_API_BASE_URL', flow.API_BASE))
    api.login(admin_config['PLIEGO_ADMIN_EMAIL'], admin_config['PLIEGO_ADMIN_PASSWORD'])
    before = api.all_pages('/api/v1/admin/editions')
    write_json(audit / 'editions-before.json', {'records': before})
    historic = read_manifest(repo / 'covers/generated/manifest-normalized.json')
    own_skus = {item['seed'].sku for item in items}
    original_rows = [r for r in historic['records'] if r['permanent_sku'] not in own_skus]
    if any(r['permanent_sku'] in EXCLUDED_SKUS for r in historic['records']):
        raise ValueError('El manifiesto activo contiene un SKU excluido.')
    configuration = upload.required_configuration(r2_config)
    client = upload.create_s3_client(configuration)
    historic_keys = publication_existing_keys(repo / 'covers', historic['records'], own_skus)
    heads = {key: client.head_object(Bucket=configuration['bucket'], Key=key) for key in historic_keys}
    assets = [upload.UploadAsset(i['cover']['r2_object_key'], i['image'], i['image'].stat().st_size, i['digest']) for i in items]
    result = upload.sync_assets(client, configuration['bucket'], assets, 'covers/editions/v2/', allowed_existing_keys=historic_keys)
    write_json(audit / 'r2-upload.json', result)
    if result['errors'] or result['verified_count'] != len(items):
        raise ValueError('La sincronización R2 no pasó su gate: ' + '; '.join(result['errors']))
    for key, head in heads.items():
        current = client.head_object(Bucket=configuration['bucket'], Key=key)
        if any(current.get(k) != head.get(k) for k in ['ETag','ContentLength','ContentType','CacheControl','Metadata','LastModified']):
            raise ValueError('Se alteró un objeto histórico: ' + key)
    public = verify_public_images(items)
    write_json(audit / 'cdn-verification.json', {'records': public, 'verified': len(public)})
    print(f'R2 y CDN verificados: {len(items)} imágenes; históricos preservados.', flush=True)
    api.login(admin_config['PLIEGO_ADMIN_EMAIL'], admin_config['PLIEGO_ADMIN_PASSWORD'])
    definitions = {i['seed'].category: flow.CategorySeed(i['seed'].category, i['seed'].category_name) for i in items}
    category_ids = flow.ensure_categories(api, tuple(definitions.values()))
    publisher_ids = {}
    receipts_path = audit / 'import-receipts.json'
    receipts = json.loads(receipts_path.read_text())['records'] if receipts_path.exists() else []
    receipt_by_sku = {r['sku']: r for r in receipts}
    for item in items:
        record, seed = item['record'], item['seed']
        book_id = ensure_prepared_work(api, record, category_ids[seed.category])
        if seed.publisher not in publisher_ids:
            publisher_ids[seed.publisher] = flow.ensure_publisher(api, seed.publisher)
        edition = import_prepared_edition(api, seed, book_id, publisher_ids[seed.publisher])
        receipt_by_sku[seed.sku] = {'sku': seed.sku, 'editionId': edition['editionId'], 'bookId': book_id,
            'publisherId': publisher_ids[seed.publisher], 'format': seed.format, 'price': seed.price,
            'coverUrl': seed.cover_url, 'staging': item['staging'].relative_to(repo).as_posix(), 'record_index': item['index'],
            'simulation': copy.deepcopy(record['preparacion']['field_provenance']),
            'audioDurationSeconds': seed.audio_duration_seconds, 'narrators': list(seed.narrators), 'stock_action': 'NONE_DIGITAL'}
        write_json(receipts_path, {'schema': 'pliego-digital-import-receipts-v1', 'records': list(receipt_by_sku.values())})
        if len(receipt_by_sku) % 25 == 0:
            print('Importadas ' + str(len(receipt_by_sku)) + '/259 ediciones digitales.', flush=True)
    admin = api.all_pages('/api/v1/admin/editions')
    by_sku = {r['sku']: r for r in admin}
    for item in items:
        seed = item['seed'];row = by_sku[seed.sku]
        if row['format'] != seed.format or row['price'] != seed.price or row['stockActual'] is not None:
            raise ValueError('La edición importada no conserva formato/precio/sin stock: ' + seed.sku)
        detail = api.request('GET', '/api/v1/catalog/editions/' + row['editionId'])
        if (detail['sku'] != seed.sku or detail['coverUrl'] != seed.cover_url or detail['price'] != seed.price
                or detail['audioDurationSeconds'] != seed.audio_duration_seconds or detail['narrators'] != list(seed.narrators)
                or not detail['available']):
            raise ValueError('El detalle público no coincide: ' + seed.sku)
    for old in before:
        if old['sku'] in own_skus:
            continue
        current = by_sku.get(old['sku'])
        if current is None or any(current.get(k) != v for k,v in old.items() if k not in {'stockActual','totalCount'}):
            raise ValueError('Cambió una edición anterior: ' + old['sku'])
    active_sources = {}
    for item in items:
        record = copy.deepcopy(item['record'])
        receipt = receipt_by_sku[item['seed'].sku]
        active_path = repo / 'covers' / record['preparacion']['planned_staging']
        image_path = active_path.parent / 'portadas' / item['image'].name
        image_path.parent.mkdir(parents=True, exist_ok=True)
        if image_path.exists() and hashlib.sha256(image_path.read_bytes()).hexdigest() != item['digest']:
            raise ValueError('La portada activa existente no coincide con el lote.')
        if not image_path.exists():
            image_path.write_bytes(item['image'].read_bytes())
        record['portadaArchivo'] = 'portadas/' + item['image'].name
        record['preparacion'].update(publication_status='PUBLISHED', imported_edition_id=receipt['editionId'],
                                    imported_book_id=receipt['bookId'])
        active_sources.setdefault(active_path, []).append(record)
        item['active_source'] = image_path.relative_to(repo / 'covers').as_posix()
    for path, records in active_sources.items():
        write_json(path, {'schema':'pliego-published-digital-staging-v1','publication_status':'PUBLISHED','libros':records})
    new_rows = [dict(i['cover'], original_file=i['active_source'], format=i['seed'].format,
                    simulation={'price':'SIMULATED/DEMO','audio':i['record']['preparacion']['audio_metadata_type']},
                    provenance='docs/audit/digital-publication-2026-10-04/import-receipts.json') for i in items]
    merged = {'schema': historic['schema'], 'records': sorted(original_rows + new_rows, key=lambda r:r['permanent_sku'])}
    write_json(repo / 'covers/generated/manifest-normalized.json', merged)
    write_json(repo / 'covers/sku-registry.json', registry)
    materialized = repo / 'covers/generated/r2-normalized'
    for item in items:
        target = materialized / item['cover']['r2_object_key']
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(item['image'].read_bytes())
    read_manifest(repo / 'covers/generated/manifest-normalized.json')
    counts = {fmt: sum(item['seed'].format == fmt for item in items) for fmt in ('EBOOK', 'AUDIOBOOK')}
    write_json(audit / 'import-result.json', {'imported':len(items), **counts, 'manifest_total':len(merged['records']),
        'sku_assignments':len(registry['assignments']), 'historical_preserved':len(original_rows),
        'excluded_sku':'PLG-BK-000042','stock_created':0,'application_deployed':False})
    print(f"Importación API verificada: {counts}; manifiesto {len(merged['records'])}.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--admin-env', type=Path, required=True)
    parser.add_argument('--r2-env', type=Path, required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if not args.execute:
        print('Preflight local: ' + str(len(load_batch(args.repo))) + ' ediciones válidas; sin escrituras externas.')
        return 0
    execute(args.repo, private_env(args.admin_env), private_env(args.r2_env), args.repo / 'docs/audit/digital-publication-2026-10-04')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
