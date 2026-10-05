import copy
import json
from pathlib import Path
import tempfile
import unittest

from publish_physical_editions import assert_preserved, make_seed, validate_cover_receipts


class PhysicalPublicationTests(unittest.TestCase):
    def record(self):
        return {'libro': {'titulo': 'Libro DEMO', 'autores': [{'nombre': 'Autora', 'orden': 1}],
                          'categorias': ['Medicina'], 'sinopsis': 'Disponibilidad SIMULATED; precio DEMO.'},
                'edicion': {'sku': 'PLG-BK-000316', 'isbn13': None, 'editorial': 'Editorial',
                            'idioma': 'es', 'formato': 'PAPERBACK', 'paginas': 128,
                            'precio': '20.95', 'inventarioInicial': 10}}

    def test_demo_identifier_never_becomes_isbn(self):
        seed = make_seed(self.record(), {'cover_url': 'https://covers.pliegolibros.com/cover.webp'})
        self.assertIsNone(seed.isbn13)
        self.assertEqual(seed.stock, 10)
        self.assertEqual(seed.format, 'PAPERBACK')

    def test_physical_publisher_rejects_digital(self):
        record = self.record()
        record['edicion'].update(formato='EBOOK', inventarioInicial=None)
        with self.assertRaisesRegex(ValueError, 'físic'):
            make_seed(record, {'cover_url': 'https://example.com/cover.webp'})

    def test_existing_metadata_and_stock_must_be_preserved(self):
        before = [{'sku': 'PLG-BK-000001', 'format': 'PAPERBACK', 'stockActual': 5,
                   'coverUrl': 'old', 'updatedAt': 'old'}]
        assert_preserved(before, copy.deepcopy(before))
        for field, value in [('stockActual', 10), ('coverUrl', 'new'), ('format', 'EBOOK')]:
            after = copy.deepcopy(before)
            after[0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'PLG-BK-000001'):
                assert_preserved(before, after)

    def test_missing_existing_record_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'PLG-BK-000001'):
            assert_preserved([{'sku': 'PLG-BK-000001'}], [])

    def test_resume_requires_exact_verified_covers(self):
        item = {'seed': make_seed(self.record(), {'cover_url': 'https://example.com/cover.webp'}),
                'digest': 'abc'}
        with tempfile.TemporaryDirectory() as directory:
            audit = Path(directory)
            (audit / 'r2-upload.json').write_text(json.dumps({'verified_count': 1, 'errors': []}))
            good = {'sku': item['seed'].sku, 'url': item['seed'].cover_url, 'sha256': 'abc', 'status': 200}
            (audit / 'cdn-verification.json').write_text(json.dumps({'records': [good]}))
            validate_cover_receipts([item], audit)
            for change in [{'sha256': 'wrong'}, {'sku': 'PLG-BK-999999'}, {'url': 'https://wrong'}, {'status': 500}]:
                (audit / 'cdn-verification.json').write_text(json.dumps({'records': [{**good, **change}]}))
                with self.subTest(change=change), self.assertRaises(ValueError):
                    validate_cover_receipts([item], audit)


if __name__ == '__main__':
    unittest.main()
