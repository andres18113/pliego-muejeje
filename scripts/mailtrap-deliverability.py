#!/usr/bin/env python3
"""Read-only Mailtrap account audit. Never sends mail or changes suppressions.

Official schema: mailtrap/mailtrap-openapi specs/email-sending.openapi.yml.
All output is allowlisted; recipients are canonical SHA-256 hashes. No SMTP text.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE = 'https://mailtrap.io'
USER_AGENT = 'PLIEGO-deliverability-audit/1.0'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Redirección rechazada.')


urlopen = build_opener(NoRedirect()).open


def recipient_hash(address):
    return hashlib.sha256(address.strip().lower().encode('utf-8')).hexdigest()


def safe_id(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', value) else None


def safe_time(value):
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).isoformat()
    except (ValueError, TypeError, AttributeError):
        return None


def get(path, params, token):
    if path not in ('/api/suppressions', '/api/email_logs'):
        raise ValueError('Ruta de lectura no permitida.')
    request = Request(BASE + path + '?' + urlencode(params), method='GET',
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'User-Agent': USER_AGENT})
    with urlopen(request, timeout=20) as response:
        body = response.read(16_777_217)
    if len(body) > 16_777_216:
        raise ValueError('Respuesta demasiado grande.')
    return json.loads(body)


def emit(kind, row):
    address = row.get('email' if kind == 'suppression' else 'to')
    # Unexpected provider shapes never pass through to output.
    if not isinstance(address, str) or '@' not in address:
        raise ValueError('Formato de destinatario inesperado.')
    stream = row.get('sending_stream')
    result = {'kind': kind, 'id': safe_id(row.get('id' if kind == 'suppression' else 'message_id')),
        'recipient_sha256': recipient_hash(address),
        'sending_stream': stream if stream in ('transactional', 'bulk') else 'OTHER',
        'at': safe_time(row.get('created_at' if kind == 'suppression' else 'sent_at'))}
    if kind == 'suppression':
        reason = row.get('type')
        result['reason'] = reason if reason in ('hard bounce', 'spam complaint', 'unsubscription', 'manual import') else 'OTHER'
    else:
        result['status'] = 'not_delivered'
    print(json.dumps(result, ensure_ascii=False))


def report(token, hours, max_pages):
    if not token or '\r' in token or '\n' in token:
        raise ValueError('Configura PLIEGO_MAILTRAP_API_TOKEN.')
    last_id = None
    for page in range(max_pages):
        if page:
            time.sleep(6.1)  # Suppressions API: at most 10 requests/minute/account.
        rows = get('/api/suppressions', {'last_id': last_id} if last_id else {}, token)
        if not isinstance(rows, list):
            raise ValueError('Formato de supresiones inesperado.')
        for row in rows:
            emit('suppression', row)
        if len(rows) < 1000:
            break
        last_id = safe_id(rows[-1].get('id'))
        if not last_id:
            raise ValueError('Cursor de supresiones inválido.')
    else:
        print(json.dumps({'kind': 'pagination', 'collection': 'suppressions', 'more': True}))

    now = datetime.now(timezone.utc)
    filters = {'filters[sent_after]': (now-timedelta(hours=hours)).isoformat(),
        'filters[sent_before]': now.isoformat(), 'filters[status][operator]': 'equal',
        'filters[status][value][]': 'not_delivered'}
    cursor = None
    seen = set()
    for page in range(max_pages):
        if page:
            time.sleep(6.1)
        data = get('/api/email_logs', {**filters, **({'search_after': cursor} if cursor else {})}, token)
        if not isinstance(data, dict) or not isinstance(data.get('messages'), list):
            raise ValueError('Formato de logs inesperado.')
        for row in data['messages']:
            if row.get('status') == 'not_delivered':
                emit('not_delivered', row)
        cursor = safe_id(data.get('next_page_cursor'))
        if not cursor:
            break
        if cursor in seen:
            raise ValueError('Cursor de logs repetido.')
        seen.add(cursor)
    else:
        print(json.dumps({'kind': 'pagination', 'collection': 'email_logs', 'more': True}))


def main():
    parser = argparse.ArgumentParser(description='Consultar supresiones y logs recientes con destinatarios SHA-256; solo GET.')
    parser.add_argument('--hours', type=int, default=24, choices=range(1, 721), metavar='1..720')
    parser.add_argument('--max-pages', type=int, default=1, choices=range(1, 11), metavar='1..10')
    args = parser.parse_args()
    try:
        report(os.environ.get('PLIEGO_MAILTRAP_API_TOKEN', ''), args.hours, args.max_pages)
    except HTTPError as error:
        print(f'Mailtrap respondió HTTP {error.code}; no se muestra el cuerpo de error.', file=sys.stderr)
        return 1
    except (URLError, OSError, ValueError, RuntimeError):
        print('No se pudo completar la consulta. Revisa configuración, permisos y conectividad.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
