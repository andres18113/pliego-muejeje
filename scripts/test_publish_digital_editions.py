"""The publication adapter must keep prepared prices/identity and never create digital stock."""
import copy
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
from types import SimpleNamespace
import unittest

from publish_digital_editions import make_seed, ensure_prepared_work, import_prepared_edition, verify_public_images


def prepared():
    return {'libro': {'titulo': 'Obra documentada', 'subtitulo': None, 'sinopsis': None,
                      'autores': [{'nombre': 'Persona documentada', 'orden': 1}], 'categorias': ['Literatura']},
            'edicion': {'editorial': 'Editorial documentada', 'idioma': 'es', 'formato': 'AUDIOBOOK',
                        'paginas': None, 'fechaPublicacion': None, 'precio': '17.99', 'sku': 'PLG-BK-000057',
                        'isbn13': None, 'ebookFileFormat': None, 'audioDurationSeconds': 1234,
                        'narrators': ['Narrador DEMO PLIEGO'], 'inventarioInicial': None,
                        'portada': {'licencia': None, 'fuente': 'https://example.org/source', 'atribucion': None}},
            'preparacion': {'work': {'action': 'REUSE_EXISTING_WORK', 'bookId': '72'},
                           'author_bindings': [], 'publication_status': 'PENDING'}}


class FakeApi:
    def __init__(self, books=None, editions=None):
        self.books = books or []
        self.editions = editions or []
        self.writes = []

    def all_pages(self, path, **params):
        return self.books if path.endswith('/books') else self.editions if path.endswith('/editions') else []

    def page(self, path, **params):
        return self.all_pages(path, **params)

    def request(self, method, path, body=None):
        if method != 'GET': self.writes.append((method, path, body))
        if path.endswith('/editions'): return {'editionId': '1000'}
        if path.endswith('/authors'): return {'authorId': '88'}
        if path.endswith('/books'): return {'bookId': '73'}
        raise AssertionError(path)


class PublishDigitalTests(unittest.TestCase):
    def test_cdn_gate_uses_browser_http_access_and_verifies_content_headers_hash(self):
        contents = b'public cover fixture'
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.headers.get('User-Agent') != 'Mozilla/5.0':
                    self.send_error(403); return
                self.send_response(200)
                self.send_header('Content-Type', 'image/webp')
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
                self.end_headers(); self.wfile.write(contents)
            def log_message(self, *args): pass
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            result = verify_public_images([{'cover': {'cover_url': f'http://127.0.0.1:{server.server_port}/cover.webp'},
                                           'digest': hashlib.sha256(contents).hexdigest(),
                                           'seed': SimpleNamespace(sku='PLG-BK-000057')}])
            self.assertEqual(result[0]['status'], 200)
            self.assertEqual(result[0]['sha256'], hashlib.sha256(contents).hexdigest())
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_prepared_price_and_audio_are_preserved_in_official_edition_payload(self):
        raw = prepared(); saved = copy.deepcopy(raw)
        cover = {'cover_url': 'https://covers.pliegolibros.com/covers/editions/v2/PLG-BK-000057-123456789abc.webp'}
        value = make_seed(raw, cover)
        self.assertEqual(value.price, '17.99')
        self.assertEqual(value.audio_duration_seconds, 1234)
        self.assertEqual(value.narrators, ('Narrador DEMO PLIEGO',))
        api = FakeApi()
        result = import_prepared_edition(api, value, '72', '4')
        self.assertEqual(result['editionId'], '1000')
        self.assertEqual(len(api.writes), 1)
        self.assertEqual(api.writes[0][1], '/api/v1/admin/editions')
        self.assertEqual(api.writes[0][2]['price'], '17.99')
        self.assertEqual(api.writes[0][2]['audioDurationSeconds'], 1234)
        self.assertFalse(any('inventory' in x[1] for x in api.writes))
        self.assertEqual(raw, saved)

    def test_explicit_existing_work_is_reused_without_rewriting_categories(self):
        data = prepared()
        existing = {'bookId': '72', 'title': 'Obra documentada', 'subtitle': None, 'state': 'ACTIVE',
                    'authors': [{'name': 'Persona documentada', 'order': 1}],
                    'categories': [{'categoryId': '99'}]}
        api = FakeApi([existing])
        self.assertEqual(ensure_prepared_work(api, data, '3'), '72')
        self.assertEqual(api.writes, [])

    def test_mismatching_explicit_work_does_not_create_or_merge_another_one(self):
        data = prepared(); api = FakeApi([{'bookId': '72', 'title': 'Otra obra', 'subtitle': None,
                                          'state': 'ACTIVE', 'authors': [{'name': 'Persona documentada', 'order': 1}]}])
        with self.assertRaises(ValueError): ensure_prepared_work(api, data, '3')
        self.assertEqual(api.writes, [])

    def test_matching_imported_sku_is_idempotent_and_conflicts_are_not_overwritten(self):
        value = make_seed(prepared(), {'cover_url': 'https://covers.pliegolibros.com/new.webp'})
        existing = {'editionId': '1000', 'bookId': '72', 'publisherId': '4', 'sku': value.sku,
                    'isbn13': None, 'language': 'es', 'format': 'AUDIOBOOK', 'pageCount': None,
                    'publicationDate': None, 'price': '17.99', 'coverUrl': value.cover_url,
                    'ebookFileFormat': None, 'audioDurationSeconds': 1234,
                    'narrators': ['Narrador DEMO PLIEGO'], 'state': 'ACTIVE'}
        api = FakeApi(editions=[existing])
        self.assertEqual(import_prepared_edition(api, value, '72', '4')['editionId'], '1000')
        self.assertEqual(api.writes, [])
        existing['price'] = '20.00'
        with self.assertRaises(ValueError): import_prepared_edition(api, value, '72', '4')
        self.assertEqual(api.writes, [])


if __name__ == '__main__': unittest.main()
