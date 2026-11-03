"""Catalog integer/string acceptance and bounded whole-request regressions."""
import json
import threading
import time
import unittest

import poll_catalog as P
from release_common import ReleaseError


class CatalogTest(unittest.TestCase):
    def test_catalog_validity_table(self):
        cases = [
            ('int', 200, {'items': [{}], 'totalCount': 7}, True),
            ('decimal string', 200, {'items': [{}], 'totalCount': '7'}, True),
            ('leading zeros', 200, {'items': [{}], 'totalCount': '007'}, True),
            ('wrong count', 200, {'items': [{}], 'totalCount': '8'}, False),
            ('negative int', 200, {'items': [{}], 'totalCount': -7}, False),
            ('negative string', 200, {'items': [{}], 'totalCount': '-7'}, False),
            ('bool', 200, {'items': [{}], 'totalCount': True}, False),
            ('non ASCII digits', 200, {'items': [{}], 'totalCount': '٧'}, False),
            ('unicode fullwidth', 200, {'items': [{}], 'totalCount': '７'}, False),
            ('float', 200, {'items': [{}], 'totalCount': 7.0}, False),
            ('plus', 200, {'items': [{}], 'totalCount': '+7'}, False),
            ('whitespace', 200, {'items': [{}], 'totalCount': ' 7'}, False),
            ('empty string', 200, {'items': [{}], 'totalCount': ''}, False),
            ('HTML', 200, '<html>healthy</html>', False),
            ('empty items', 200, {'items': [], 'totalCount': '7'}, False),
            ('500', 500, {'items': [{}], 'totalCount': '7'}, False),
            ('oversized', 200, {'items': [{}], 'totalCount': '7', 'padding': 'a' * (1024 * 1024)}, False),
        ]
        for name, status, value, expected in cases:
            body = value.encode() if isinstance(value, str) else json.dumps(value).encode()
            with self.subTest(name=name):
                self.assertIs(P.valid_catalog(status, body, 7), expected)
        self.assertFalse(P.valid_catalog(200, b'{"items":[{}],"totalCount":true}', 1))
        self.assertTrue(P.valid_catalog(200, b'{"items":[],"totalCount":"0"}', 0))

    def test_poll_accepts_string_count(self):
        calls = []
        def fetch(url, timeout):
            calls.append(timeout)
            return 200, b'{"items":[{}],"totalCount":"7"}'
        self.assertEqual(P.poll(expected=7, fetch=fetch)['totalCount'], 7)
        self.assertEqual(calls, [3.0])

    def test_poll_deadline_and_request_budgets_are_bounded(self):
        now = [0.0]
        budgets = []
        def fetch(url, timeout):
            budgets.append(timeout)
            return 500, b''
        def sleep(seconds):
            now[0] += seconds
        with self.assertRaisesRegex(ReleaseError, 'within 90 seconds'):
            P.poll(expected=7, fetch=fetch, clock=lambda: now[0], sleep=sleep)
        self.assertEqual(now[0], 90)
        self.assertTrue(all(0 < value <= 3 for value in budgets))

    def test_request_wall_time_cap_even_when_fetch_ignores_socket_timeout(self):
        # A blocked/trickling request must not consume the whole 90-second window.
        blocked = threading.Event()
        offset = [0.0]
        def fetch(url, timeout):
            blocked.wait(10)
            return 200, b'{"items":[{}],"totalCount":"7"}'
        before = time.monotonic()
        try:
            with self.assertRaises(ReleaseError):
                P.poll(expected=7, fetch=fetch, clock=lambda: time.monotonic() + offset[0],
                       sleep=lambda seconds: offset.__setitem__(0, 100.0))
            self.assertLess(time.monotonic() - before, 4.5)
        finally:
            blocked.set()

    def test_nonlocal_redirect_and_missing_baseline_are_refused(self):
        for url in ('https://127.0.0.1/api/v1/catalog/editions',
                    'http://example.invalid/api/v1/catalog/editions',
                    'http://127.0.0.1/private'):
            with self.subTest(url=url), self.assertRaises(ReleaseError):
                P.poll(url=url, expected=7)
        with self.assertRaises(ReleaseError):
            P.poll()
        self.assertIsNone(P.NoRedirect().redirect_request(None, None, None, None, None, None))


if __name__ == '__main__':
    unittest.main()
