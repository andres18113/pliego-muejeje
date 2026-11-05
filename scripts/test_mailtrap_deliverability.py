import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location('mailtrap_deliverability', Path(__file__).with_name('mailtrap-deliverability.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class DeliverabilityTests(unittest.TestCase):
    def test_get_only_explicit_ua_and_no_pii_or_smtp_in_output(self):
        requests = []

        def transport(request, timeout):
            requests.append(request)
            if '/suppressions' in request.full_url:
                return io.BytesIO(json.dumps([{'id': 'safe-id', 'email': 'Private@Example.com',
                    'type': 'hard bounce', 'sending_stream': 'transactional',
                    'response': 'private SMTP', 'created_at': '2026-11-01T15:33:37Z'}]).encode())
            return io.BytesIO(json.dumps({'messages': [{'message_id': 'provider-id', 'to': 'private@example.com',
                'status': 'not_delivered', 'sent_at': '2026-11-01T15:33:37Z',
                'subject': 'private subject', 'response': 'private SMTP', 'sending_stream': 'transactional'}],
                'next_page_cursor': None}).encode())

        with patch.object(ops, 'urlopen', transport), patch('sys.stdout', new_callable=io.StringIO) as output:
            ops.report('fake-token', 24, 1)
        raw = output.getvalue()
        self.assertNotIn('private', raw.lower())
        self.assertNotIn('fake-token', raw)
        self.assertIn(ops.recipient_hash('private@example.com'), raw)
        self.assertEqual(2, len(requests))
        for request in requests:
            self.assertEqual('GET', request.get_method())
            self.assertEqual('PLIEGO-deliverability-audit/1.0', request.get_header('User-agent'))
            self.assertEqual('mailtrap.io', urlsplit(request.full_url).netloc)
        filters = parse_qs(urlsplit(requests[1].full_url).query)
        self.assertEqual(['not_delivered'], filters['filters[status][value][]'])
        self.assertIn('filters[sent_after]', filters)

    def test_log_pagination_uses_cursor_and_never_follows_foreign_url(self):
        urls = []

        def transport(request, timeout):
            urls.append(request.full_url)
            data = [] if '/suppressions' in request.full_url else {'messages': [], 'next_page_cursor': 'next-id' if len(urls) == 2 else None}
            return io.BytesIO(json.dumps(data).encode())

        with patch.object(ops, 'urlopen', transport), patch.object(ops.time, 'sleep'), patch('sys.stdout', new_callable=io.StringIO):
            ops.report('fake-token', 24, 2)
        self.assertEqual(['next-id'], parse_qs(urlsplit(urls[-1]).query)['search_after'])

    def test_redirects_are_refused_so_token_cannot_leak(self):
        with self.assertRaises(Exception):
            ops.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.invalid')


if __name__ == '__main__':
    unittest.main()
