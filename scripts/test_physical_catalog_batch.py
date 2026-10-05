"""Source-grounded invariants for the imported physical batch, independent of global totals."""
import collections
import csv
import hashlib
import json
from pathlib import Path
import unittest

from PIL import Image

from cover_catalog import EXCLUDED_SKUS, metadata_errors, read_manifest
from prepare_covers_loader import module as allocator
from publish_physical_editions import load_batch
from fixtures.catalog_helpers import RETIRED_PHYSICAL_SKUS


ROOT = Path(__file__).resolve().parents[1]


class PhysicalCatalogBatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.batch = ROOT / 'covers/Fisicos180'
        with (cls.batch / 'provenance/inventario_fisicos.csv').open(encoding='utf-8-sig', newline='') as f:
            cls.source = list(csv.DictReader(f))
        cls.items = load_batch(ROOT)
        cls.registry = json.loads((ROOT / 'covers/sku-registry.json').read_text())
        cls.baseline = json.loads(Path(__file__).with_name('fixtures').joinpath('physical-cover-catalog.json').read_text())

    def test_inventory_and_prepared_candidates_have_exact_correspondence(self):
        original = {row['fuente_portada'].rstrip('/').split('/')[-1]: row for row in self.source}
        self.assertEqual(set(original), set(self.baseline['inventory_book_ids'].values()))
        retired_ids = {self.baseline['inventory_book_ids'][sku] for sku in RETIRED_PHYSICAL_SKUS}
        expected = {identity: row for identity, row in original.items() if identity not in retired_ids}
        actual = {i['record']['preparacion']['source']['provenance']['book_id']: i for i in self.items}
        self.assertEqual(actual.keys(), expected.keys())
        self.assertEqual(collections.Counter(row['categoria'] for row in expected.values()),
                         collections.Counter(i['seed'].category_name for i in self.items))
        for identity, row in expected.items():
            with self.subTest(identity=identity):
                item = actual[identity]
                self.assertEqual(item['seed'].title, row['titulo'])
                self.assertEqual(item['seed'].price, row['precio'])
                self.assertEqual(item['seed'].isbn13, None if row['isbn'].startswith('DEMO-') else row['isbn'])
                self.assertEqual(item['record']['preparacion']['source']['inventory_identifier'], row['isbn'])

    def test_physical_metadata_simulation_and_registry_identity(self):
        assignments = {a['sku']: a for a in self.registry['assignments']}
        identities = set()
        for item in self.items:
            record, seed = item['record'], item['seed']
            with self.subTest(sku=seed.sku):
                self.assertFalse(metadata_errors(record))
                self.assertIn(seed.format, {'PAPERBACK', 'HARDCOVER'})
                self.assertNotIn(seed.sku, EXCLUDED_SKUS)
                self.assertGreater(seed.page_count, 0)
                self.assertGreater(seed.stock, 0)
                synopsis = record['libro']['sinopsis']
                self.assertIsInstance(synopsis, str)
                self.assertTrue(synopsis.strip())
                self.assertNotRegex(synopsis, r'(?i)\b(?:DEMO|SIMULATED)\b')
                proof = record['preparacion']['field_provenance']
                for field in ['edicion.paginas', 'edicion.precio', 'edicion.inventarioInicial', 'edicion.formato']:
                    self.assertEqual(proof[field]['kind'], 'SIMULATED/DEMO')
                    self.assertFalse(proof[field]['real_source_claim'])
                identity = allocator._edition_identity(record, seed.isbn13)
                self.assertIn(identity, assignments[seed.sku]['identity_keys'])
                self.assertNotIn(identity, identities)
                identities.add(identity)

    def test_active_physical_catalog_is_exactly_the_inventory_batch(self):
        records = read_manifest(ROOT / 'covers/generated/manifest-normalized.json')['records']
        expected = {item['seed'].sku for item in self.items}
        assigned = {f'PLG-BK-{number:06d}' for number in range(316, 316 + len(self.source))}
        self.assertEqual(assigned, set(self.baseline['physical_manifest_sha256']))
        self.assertEqual(expected, assigned - RETIRED_PHYSICAL_SKUS)
        active = {record['permanent_sku'] for record in records
                  if record.get('format', 'PAPERBACK') in {'PAPERBACK', 'HARDCOVER'}}
        self.assertEqual(active, expected)
        self.assertEqual(len(expected), len(self.source) - len(RETIRED_PHYSICAL_SKUS))
        self.assertFalse(expected & EXCLUDED_SKUS)
        self.assertEqual(len(records), len({record['permanent_sku'] for record in records}))
        raw = read_manifest(ROOT / 'covers/generated/manifest.json')['records']
        self.assertEqual({record['permanent_sku'] for record in raw},
                         {record['permanent_sku'] for record in records})
        self.assertEqual(len(raw), len(records))

    def test_original_physical_cover_records_preserved_active_or_retired(self):
        active = read_manifest(ROOT / 'covers/generated/manifest-normalized.json')['records']
        retired = read_manifest(ROOT / 'covers/retired-manifest.json')['records']
        records = {record['permanent_sku']: record for record in active + retired}
        self.assertEqual(len(records), len(active) + len(retired))
        retired_skus = {record['permanent_sku'] for record in retired}
        self.assertEqual(set(self.baseline['physical_manifest_sha256']) & retired_skus,
                         RETIRED_PHYSICAL_SKUS)
        for sku, expected in self.baseline['physical_manifest_sha256'].items():
            with self.subTest(sku=sku):
                digest = hashlib.sha256(json.dumps(records[sku], sort_keys=True, ensure_ascii=False,
                                                   separators=(',', ':')).encode()).hexdigest()
                self.assertEqual(digest, expected)
                image_path = ROOT / 'covers/generated/r2-normalized' / records[sku]['r2_object_key']
                image_bytes = image_path.read_bytes()
                self.assertTrue(image_path.name.endswith('-' + hashlib.sha256(image_bytes).hexdigest()[:12] + '.webp'))
                with Image.open(image_path) as image:
                    self.assertEqual(image.format, 'WEBP')
                    self.assertEqual(image.size, (720, 1080))
                    self.assertEqual(getattr(image, 'n_frames', 1), 1)

    def test_all_original_images_and_retired_prepared_metadata_preserved(self):
        self.assertEqual(set(self.baseline['original_sources']), set(self.baseline['inventory_book_ids']))
        for sku, proof in self.baseline['original_sources'].items():
            with self.subTest(sku=sku):
                original = self.batch / proof['original_path']
                self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), proof['sha256'])
        self.assertEqual(set(self.baseline['retired_prepared_sha256']), RETIRED_PHYSICAL_SKUS)
        for sku, expected in self.baseline['retired_prepared_sha256'].items():
            with self.subTest(retired_sku=sku):
                archive = ROOT / 'covers/generated/retired/individual-editions' / sku / 'archive-report.json'
                records = [item['record'] for item in json.loads(archive.read_text())['source_records']
                           if item['record']['edicion']['sku'] == sku]
                self.assertTrue(records)
                for record in records:
                    digest = hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False,
                                                       separators=(',', ':')).encode()).hexdigest()
                    self.assertEqual(digest, expected)

    def test_original_bytes_and_official_normalized_covers(self):
        manifest = {r['permanent_sku']: r for r in read_manifest(ROOT / 'covers/generated/manifest-normalized.json')['records']}
        for item in self.items:
            with self.subTest(sku=item['seed'].sku):
                source = item['record']['preparacion']['source']
                original = self.batch / source['original_path']
                self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), source['provenance']['image']['sha256'])
                self.assertEqual(manifest[item['seed'].sku]['isbn13'], item['seed'].isbn13)
                with Image.open(item['image']) as image:
                    self.assertEqual(image.format, 'WEBP')
                    self.assertEqual(image.size, (720, 1080))
                    self.assertEqual(getattr(image, 'n_frames', 1), 1)


if __name__ == '__main__':
    unittest.main()
