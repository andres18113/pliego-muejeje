"""Disposable PostgreSQL 18: complete anonymous sitemap equals public API identities."""
import json
import os
import uuid
import xml.etree.ElementTree as ET
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from checkout_last_unit import query


def main():
    assert os.environ.get('PLIEGO_TEST_DISPOSABLE_DB') == '1'
    suffix = uuid.uuid4().hex[:12]
    query(f"""
    DO $fixture$
    DECLARE a BIGINT; author_id BIGINT; pub BIGINT; cat BIGINT; book BIGINT;
      edition BIGINT; help_cat BIGINT; i INTEGER;
    BEGIN
      INSERT INTO pliego.usuario(email_normalizado,password_hash,rol,estado)
      VALUES('sitemap-{suffix}@example.invalid','fixture','ADMIN','ACTIVE') RETURNING usuario_id INTO a;
      CALL pliego.sp_author_create(a,'Autora sitemap {suffix}',NULL,author_id);
      CALL pliego.sp_publisher_create(a,'Editorial sitemap {suffix}',NULL,pub);
      CALL pliego.sp_category_create(a,'Sitemap {suffix}','sitemap-{suffix}',NULL,NULL,cat);
      CALL pliego.sp_book_create(a,'Sitemap {suffix}',NULL,NULL,
        jsonb_build_array(jsonb_build_object('authorId',author_id,'order',1)),jsonb_build_array(cat),book);
      FOR i IN 1..55 LOOP
        CALL pliego.sp_edition_create(a,book,pub,'SM-{suffix}-'||i,NULL,'es','EBOOK',NULL,NULL,
          10,NULL,NULL,NULL,NULL,NULL,NULL,NULL,edition);
      END LOOP;
      CALL pliego.sp_edition_set_status(a,edition,'INACTIVE');
      CALL pliego.sp_edition_create(a,book,pub,'SM-{suffix}-unlisted',NULL,'es','PAPERBACK',100,NULL,
        10,NULL,NULL,NULL,NULL,edition);
      INSERT INTO pliego.ayuda_categoria(slug,titulo,posicion,aplicabilidad,estado)
        VALUES('sitemap-{suffix}','Sitemap',999,'GENERAL','PUBLISHED') RETURNING categoria_id INTO help_cat;
      FOR i IN 1..55 LOOP
        INSERT INTO pliego.ayuda_articulo(categoria_id,slug,titulo,resumen,cuerpo,posicion,aplicabilidad,estado)
        VALUES(help_cat,'sitemap-{suffix}-'||i,'Sitemap','Resumen','Contenido',i,'GENERAL',
          CASE WHEN i=55 THEN 'DRAFT' ELSE 'PUBLISHED' END);
      END LOOP;
    END $fixture$;
    """)
    base = os.environ['CHECKOUT_BASE_URL'].rstrip('/')
    origin = os.environ['PLIEGO_APP_PUBLIC_URL'].rstrip('/')

    def all_items(path):
        result = []
        for page in range(1001):
            with urlopen(f'{base}{path}?page={page}&pageSize=50', timeout=30) as response:
                data = json.load(response)
            result.extend(data['items'])
            if len(result) == int(data['totalCount']):
                return result
        raise AssertionError('public API did not terminate')

    editions = all_items('/api/v1/catalog/editions')
    help_articles = all_items('/api/v1/help/articles')
    assert len(editions) >= 54 and len(help_articles) >= 54
    expected = {origin + p for p in ('/', '/catalog', '/ofertas', '/ayuda')}
    expected.update(origin + '/catalog/editions/' + x['editionId'] for x in editions)
    expected.update(origin + '/ayuda/' + x['slug'] for x in help_articles)
    url = base + '/api/v1/storefront/sitemap.xml'
    with urlopen(url, timeout=60) as response:
        document = response.read()
        assert response.status == 200
        assert response.headers.get_content_type() == 'application/xml'
        assert response.headers.get_content_charset().lower() == 'utf-8'
        assert response.headers['Cache-Control'] == 'max-age=3600, public'
        assert response.headers.get('Set-Cookie') is None
    root = ET.fromstring(document)
    ns = '{http://www.sitemaps.org/schemas/sitemap/0.9}'
    assert root.tag == ns + 'urlset'
    locations = [item.find(ns + 'loc').text for item in root]
    assert set(locations) == expected, (set(locations) - expected, expected - set(locations))
    assert locations == sorted(expected)
    assert all(len(item) == 1 for item in root)
    assert len(locations) <= 50000 and len(document) <= 50 * 1024 * 1024
    with urlopen(url, timeout=30) as response:
        assert response.read() == document
    try:
        urlopen(Request(url, method='POST'), timeout=30)
        raise AssertionError('POST must require authentication')
    except HTTPError as error:
        assert error.code == 401
    print(f'Sitemap HTTP gate passed: {len(editions)} editions, {len(help_articles)} articles, {len(locations)} URLs.')


if __name__ == '__main__':
    main()
