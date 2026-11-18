#!/usr/bin/env python3
"""Loopback-only delivery tests; receiver credentials never leave this process tree."""
import contextlib
import http.server
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import unittest

HELPER = pathlib.Path(__file__).resolve().parents[1] / 'heartbeat.py'

class HeartbeatTest(unittest.TestCase):
    def invoke(self, path, event='success', enabled='1', **extra):
        env = dict(os.environ, BACKUP_HEARTBEAT_ENABLED=enabled,
                   CREDENTIALS_DIRECTORY=path, PLIEGO_BACKUP_TEST_LOCAL='1', **extra)
        return subprocess.run([sys.executable, HELPER, event], env=env,
                              capture_output=True, text=True, timeout=12)

    @contextlib.contextmanager
    def receiver(self, status=200):
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                requests.append((self.path, self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(status)
                self.send_header('Location', 'http://127.0.0.1:1/secret-redirect')
                self.end_headers()
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever); thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                secret = 'synthetic-token-never-log'
                pathlib.Path(directory, 'heartbeat.json').write_text(json.dumps({'url':f'http://127.0.0.1:{server.server_port}/{secret}'}))
                yield directory, requests, secret
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_success_and_failure_paths(self):
        with self.receiver() as (directory, requests, secret):
            for event in ('success', 'fail'):
                result = self.invoke(directory, event)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('backup_heartbeat_ok', result.stdout)
                self.assertNotIn(secret, result.stdout + result.stderr)
            self.assertEqual([r[0] for r in requests], ['/'+secret, '/'+secret+'/fail'])
            self.assertEqual([r[1] for r in requests], [b'success', b'fail'])

    def test_failed_delivery_does_not_fail_good_backup_or_expose_url(self):
        for status in (302, 500):
            with self.receiver(status) as (directory, requests, secret):
                result = self.invoke(directory)
                self.assertEqual(result.returncode, 0)
                self.assertIn('backup_heartbeat_warning', result.stderr)
                self.assertNotIn(secret, result.stdout + result.stderr)
                self.assertEqual(len(requests), 1)

    def test_opt_out_does_not_read_missing_credentials(self):
        result = self.invoke('/missing', enabled='0')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout + result.stderr, '')

    def test_missing_invalid_config_is_logged_nonfatal(self):
        result = self.invoke('/missing')
        self.assertEqual(result.returncode, 0)
        self.assertIn('backup_heartbeat_warning', result.stderr)

    def test_test_mode_refuses_external_url(self):
        with tempfile.TemporaryDirectory() as directory:
            pathlib.Path(directory, 'heartbeat.json').write_text('{"url":"https://hc-ping.com/synthetic-do-not-contact"}')
            result = self.invoke(directory)
            self.assertEqual(result.returncode, 0)
            self.assertIn('backup_heartbeat_warning', result.stderr)

if __name__ == '__main__':
    unittest.main()
