#!/usr/bin/env python3
"""Opt-in Healthchecks ping. Always nonfatal; never print URLs or exceptions."""
import http.client
import json
import os
import pathlib
import re
import sys
import urllib.parse


def main():
    if os.environ.get('BACKUP_HEARTBEAT_ENABLED') != '1':
        return
    try:
        event = sys.argv[1]
        if event not in ('success', 'fail'):
            raise ValueError('event')
        credential = pathlib.Path(os.environ['CREDENTIALS_DIRECTORY']) / 'heartbeat.json'
        url = json.loads(credential.read_text())['url']
        parsed = urllib.parse.urlsplit(url)
        if os.environ.get('PLIEGO_BACKUP_TEST_LOCAL') == '1':
            if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or not parsed.port:
                raise ValueError('local receiver required')
            connection = http.client.HTTPConnection('127.0.0.1', parsed.port, timeout=5)
        else:
            if not re.fullmatch(r'https://hc-ping\.com/[a-fA-F0-9-]{36}', url):
                raise ValueError('reviewed Healthchecks URL required')
            connection = http.client.HTTPSConnection('hc-ping.com', timeout=5)
        if parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError('unexpected URL component')
        try:
            path = parsed.path + ('/fail' if event == 'fail' else '')
            connection.request('POST', path, body=event.encode('ascii'), headers={'Content-Type':'text/plain'})
            response = connection.getresponse()
            if not 200 <= response.status < 300:
                raise ValueError('receiver rejected ping')
        finally:
            connection.close()
        print('backup_heartbeat_ok event=' + event)
    except Exception:
        # HTTP exceptions can embed the credential URL. Log a fixed message only.
        print('backup_heartbeat_warning: delivery failed; backup status unchanged; inspect receiver and credential', file=sys.stderr)


if __name__ == '__main__':
    main()
