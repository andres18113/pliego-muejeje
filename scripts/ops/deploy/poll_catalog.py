#!/usr/bin/env python3
"""Bounded read-only catalog polling: HTTP 200, items array, exact integer count."""
import argparse
import sys
sys.dont_write_bytecode = True
import queue
import threading
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from release_common import ReleaseError, cli, emit, load_json, require

URL = 'http://127.0.0.1:8080/api/v1/catalog/editions?page=0&pageSize=1'


def valid_catalog(status,body,expected):
    if status != 200 or type(expected) is not int or expected < 0 or len(body) > 1024*1024:
        return False
    try:
        value = json.loads(body)
        count = value.get('totalCount') if isinstance(value,dict) else None
        # Runbook §7: totalCount is a nonnegative integer or a decimal string integer (the API sends a string).
        count = count if type(count) is int else (int(count) if isinstance(count,str) and count.isascii() and count.isdigit() else None)
        return isinstance(value,dict) and isinstance(value.get('items'),list) and (expected == 0 or len(value['items']) > 0) and count is not None and count >= 0 and count == expected
    except (ValueError,UnicodeError,TypeError):
        return False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


def fetch_catalog(url,timeout):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    try:
        with opener.open(urllib.request.Request(url,headers={'Accept':'application/json'}),timeout=timeout) as response:
            return response.status,response.read(1024*1024+1)
    except (OSError,urllib.error.URLError):
        return 0,b''


def poll(url=URL,expected=None,fetch=fetch_catalog,clock=time.monotonic,sleep=time.sleep):
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1','localhost','::1'} and parsed.username is None and parsed.password is None and parsed.path == '/api/v1/catalog/editions' and not parsed.fragment,'catalog URL must be the local read-only catalog endpoint')
    require(type(expected) is int and expected >= 0,'invalid expected catalog count')
    deadline = clock()+90.0
    attempts = 0
    while True:
        remaining = deadline-clock()
        if remaining <= 0:
            raise ReleaseError('catalog did not satisfy the acceptance contract within 90 seconds')
        # A socket timeout only bounds inactivity: a trickled body can last forever.
        # Daemon work bounds the entire request, including headers and body reads.
        result = queue.Queue(maxsize=1)
        budget = min(3.0,remaining)
        def request(result=result,budget=budget):
            try:
                result.put(fetch(url,budget))
            except Exception:
                result.put((0,b''))
        worker = threading.Thread(target=request,daemon=True)
        worker.start()
        try:
            status,body = result.get(timeout=budget)
        except queue.Empty:
            status,body = 0,b''
        attempts += 1
        if len(body) <= 1024*1024 and valid_catalog(status,body,expected) and clock() <= deadline:
            return {'catalog':'healthy','totalCount':expected,'attempts':attempts}
        remaining = deadline-clock()
        if remaining > 0:
            sleep(min(2.0,remaining))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default=URL)
    baseline = parser.add_mutually_exclusive_group(required=True)
    baseline.add_argument('--expected',type=int,help='preflight catalog count')
    baseline.add_argument('--manifest',type=lambda value:Path(value).absolute(),help='prepared release.json')
    args = parser.parse_args()
    expected = args.expected if args.manifest is None else load_json(args.manifest)['plannedRollback']['catalogTotalCount']
    emit(poll(args.url,expected))


if __name__ == '__main__':
    cli(main)
